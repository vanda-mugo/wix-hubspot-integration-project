import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/db";
import logger from "@/lib/logger";
import { syncWixToHubSpot, syncFormToHubSpot } from "@/lib/sync-engine";
import { getDefaultFieldMappings } from "@/lib/field-mapper";
import { v4 as uuidv4 } from "uuid";

/**
 * Wix Webhook Receiver
 *
 * Handles all Wix webhook events:
 * - app.installed              → create Installation record
 * - contact.created            → sync new contact to HubSpot
 * - contact.updated            → sync updated contact to HubSpot
 * - form_submission.created    → push form data to HubSpot
 *
 * Wix sends webhook payloads as JWT-signed strings (not JSON).
 */

export async function POST(request: NextRequest) {
  try {
    // Log all relevant headers
    const headersObj: Record<string, string> = {};
    request.headers.forEach((value, key) => {
      if (key.startsWith("x-wix") || key.startsWith("x-") || key === "content-type") {
        headersObj[key] = value;
      }
    });
    console.log("[WIX WEBHOOK] Headers:", JSON.stringify(headersObj));

    const body = await request.text();
    console.log("[WIX WEBHOOK] Raw body length:", body?.length);
    console.log("[WIX WEBHOOK] Raw body (first 1000 chars):", body?.substring(0, 1000));

    if (!body) {
      return NextResponse.json({ error: "Empty body" }, { status: 400 });
    }

    // Decode JWT payload
    let payload: Record<string, unknown>;
    try {
      const parts = body.split(".");
      if (parts.length === 3) {
        const base64 = parts[1].replace(/-/g, "+").replace(/_/g, "/");
        const jsonStr = Buffer.from(base64, "base64").toString("utf-8");
        payload = JSON.parse(jsonStr);
        console.log("[WIX WEBHOOK] Decoded JWT payload keys:", Object.keys(payload));
        console.log("[WIX WEBHOOK] Decoded JWT payload:", JSON.stringify(payload).substring(0, 2000));
      } else {
        payload = JSON.parse(body);
        console.log("[WIX WEBHOOK] Parsed JSON payload keys:", Object.keys(payload));
        console.log("[WIX WEBHOOK] Parsed JSON payload:", JSON.stringify(payload).substring(0, 2000));
      }
    } catch (parseErr) {
      console.error("[WIX WEBHOOK] Failed to parse body:", parseErr);
      logger.error("Wix webhook: Failed to parse body");
      return NextResponse.json({ error: "Invalid payload" }, { status: 400 });
    }

    // Extract event metadata — check multiple possible locations
    const dataObj = payload.data as Record<string, unknown> | undefined;
    const eventType =
      (payload.webhookEvent as string) ||
      (payload.eventType as string) ||
      (payload.event as string) ||
      (dataObj?.eventType as string) ||
      (dataObj?.type as string) ||
      (request.headers.get("x-wix-event-type")) ||
      (request.headers.get("x-wix-webhook-event")) ||
      "unknown";
    const instanceId =
      (payload.instanceId as string) ||
      (dataObj?.instanceId as string) ||
      (payload.instance as string) ||
      "unknown";

    console.log("[WIX WEBHOOK] Resolved eventType:", eventType, "instanceId:", instanceId);

    logger.info(`Wix webhook: ${eventType} for instance ${instanceId}`);

    // Route by event type
    switch (true) {
      case eventType.includes("app.installed") ||
        eventType.includes("AppInstalled"):
        await handleAppInstalled(instanceId);
        break;

      case eventType.includes("contact.created") ||
        eventType.includes("ContactCreated"):
        await handleContactEvent(instanceId, payload, "contact.created");
        break;

      case eventType.includes("contact.updated") ||
        eventType.includes("ContactUpdated"):
        await handleContactEvent(instanceId, payload, "contact.updated");
        break;

      case eventType.includes("form_submission") ||
        eventType.includes("FormSubmission"):
        await handleFormSubmission(instanceId, payload);
        break;

      default:
        logger.info(`Wix webhook: Unhandled event type: ${eventType}`);
    }

    // Must respond 200 within 1250ms or Wix will retry
    return NextResponse.json({ received: true });
  } catch (error) {
    logger.error("Wix webhook error:", error);
    return NextResponse.json({ received: true, error: "Processing error" });
  }
}

export async function GET() {
  return NextResponse.json({
    status: "ok",
    endpoint: "Wix Webhook Receiver",
  });
}

// ─── Event Handlers ──────────────────────────────────────

async function handleAppInstalled(instanceId: string) {
  logger.info(`App installed on Wix site: ${instanceId}`);

  // Create installation record (upsert to handle re-installs)
  const installation = await prisma.installation.upsert({
    where: { wixInstanceId: instanceId },
    create: { wixInstanceId: instanceId },
    update: {}, // No updates on re-install
  });

  // Seed default field mappings
  const existingMappings = await prisma.fieldMapping.count({
    where: { installationId: installation.id },
  });

  if (existingMappings === 0) {
    const defaults = getDefaultFieldMappings();
    await prisma.fieldMapping.createMany({
      data: defaults.map((m) => ({
        installationId: installation.id,
        wixField: m.wixField,
        hubspotProperty: m.hubspotProperty,
        syncDirection: m.syncDirection,
        transform: m.transform || null,
      })),
    });
    logger.info(`Seeded ${defaults.length} default field mappings`);
  }
}

async function handleContactEvent(
  instanceId: string,
  payload: Record<string, unknown>,
  eventType: string,
) {
  // Find installation
  const installation = await prisma.installation.findUnique({
    where: { wixInstanceId: instanceId },
  });

  if (!installation) {
    logger.warn(`No installation found for Wix instance ${instanceId}`);
    return;
  }

  if (!installation.isConnected) {
    logger.info("HubSpot not connected — skipping sync");
    return;
  }

  // Extract contact ID from the payload
  const dataObj = payload.data as Record<string, unknown> | undefined;
  const innerData = dataObj?.data;
  let contactId: string | undefined;

  if (typeof innerData === "string") {
    try {
      const parsed = JSON.parse(innerData);
      contactId = parsed.contactId || parsed.id;
    } catch {
      // Not JSON
    }
  } else if (innerData && typeof innerData === "object") {
    contactId =
      (innerData as Record<string, string>).contactId ||
      (innerData as Record<string, string>).id;
  }

  // Also check top-level entityId
  contactId =
    contactId || (payload.entityId as string) || (dataObj?.entityId as string);

  if (!contactId) {
    logger.warn("Could not extract contact ID from webhook payload");
    return;
  }

  const eventId =
    (payload.eventId as string) ||
    (dataObj?.eventId as string) ||
    `wix-${contactId}-${Date.now()}`;

  // Fire-and-forget sync (respond 200 immediately)
  syncWixToHubSpot(
    installation.id,
    instanceId,
    contactId,
    eventId,
    eventType,
  ).catch((err) => {
    logger.error("Background Wix→HubSpot sync failed:", err);
  });
}

async function handleFormSubmission(
  instanceId: string,
  payload: Record<string, unknown>,
) {
  const installation = await prisma.installation.findUnique({
    where: { wixInstanceId: instanceId },
  });

  if (!installation) {
    logger.warn(`No installation found for Wix instance ${instanceId}`);
    return;
  }

  if (!installation.isConnected) {
    logger.info("HubSpot not connected — skipping form sync");
    return;
  }

  // Extract form data
  const dataObj = payload.data as Record<string, unknown> | undefined;
  const innerData = dataObj?.data;
  let formData: Record<string, unknown> = {};

  if (typeof innerData === "string") {
    try {
      formData = JSON.parse(innerData);
    } catch {
      formData = {};
    }
  } else if (innerData && typeof innerData === "object") {
    formData = innerData as Record<string, unknown>;
  }

  const submissions =
    (formData.submissions as Record<string, string>) ||
    (formData.values as Record<string, string>) ||
    {};

  const eventId =
    (payload.eventId as string) ||
    (formData.submissionId as string) ||
    `form-${uuidv4()}`;

  const submission = {
    fields: submissions,
    pageUrl: formData.pageUrl as string | undefined,
    referrer: formData.referrer as string | undefined,
    utmParams: formData.utmParams as Record<string, string> | undefined,
    submittedAt: formData.createdDate as string | undefined,
  };

  // Fire-and-forget
  syncFormToHubSpot(installation.id, instanceId, submission, eventId).catch(
    (err) => {
      logger.error("Background form→HubSpot sync failed:", err);
    },
  );
}
