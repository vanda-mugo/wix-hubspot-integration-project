import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/db";
import logger from "@/lib/logger";
import { syncWixToHubSpot, syncFormToHubSpot } from "@/lib/sync-engine";
import { getDefaultFieldMappings } from "@/lib/field-mapper";
import { v4 as uuidv4 } from "uuid";

/**
 * Wix Webhook Receiver
 *
 * Wix sends webhooks as JWT tokens. The payload is triple-nested:
 *   JWT body → { data: "<JSON string>" }
 *     → parse data → { data: "<JSON string>", instanceId: "..." }
 *       → parse inner data → { entityFqdn, slug, entityId, updatedEvent/createdEvent }
 *
 * Event type is derived from entityFqdn + slug:
 *   "wix.contacts.v4.contact" + "updated" → contact update
 */

export async function POST(request: NextRequest) {
  try {
    const body = await request.text();

    if (!body) {
      return NextResponse.json({ error: "Empty body" }, { status: 400 });
    }

    // ── Step 1: Decode JWT payload ─────────────────────────
    let jwtPayload: Record<string, unknown>;
    try {
      const parts = body.split(".");
      if (parts.length === 3) {
        const base64 = parts[1].replace(/-/g, "+").replace(/_/g, "/");
        const jsonStr = Buffer.from(base64, "base64").toString("utf-8");
        jwtPayload = JSON.parse(jsonStr);
      } else {
        jwtPayload = JSON.parse(body);
      }
    } catch {
      logger.error("Wix webhook: Failed to parse body");
      return NextResponse.json({ error: "Invalid payload" }, { status: 400 });
    }

    // ── Step 2: Parse outer data string ────────────────────
    let outerData: Record<string, unknown> = {};
    const rawOuter = jwtPayload.data;
    if (typeof rawOuter === "string") {
      try {
        outerData = JSON.parse(rawOuter);
      } catch {
        logger.error("Wix webhook: Failed to parse outer data string");
        return NextResponse.json({ received: true });
      }
    } else if (rawOuter && typeof rawOuter === "object") {
      outerData = rawOuter as Record<string, unknown>;
    }

    const instanceId = (outerData.instanceId as string) || "unknown";

    // ── Step 3: Parse inner data string (the actual event) ─
    let eventData: Record<string, unknown> = {};
    const rawInner = outerData.data;
    if (typeof rawInner === "string") {
      try {
        eventData = JSON.parse(rawInner);
      } catch {
        logger.error("Wix webhook: Failed to parse inner data string");
        return NextResponse.json({ received: true });
      }
    } else if (rawInner && typeof rawInner === "object") {
      eventData = rawInner as Record<string, unknown>;
    }

    // ── Step 4: Derive event type from entityFqdn + slug ──
    const entityFqdn = (eventData.entityFqdn as string) || "";
    const slug = (eventData.slug as string) || "";
    const entityId = (eventData.entityId as string) || "";

    let eventType = "unknown";
    if (entityFqdn.includes("contact")) {
      if (slug === "created") eventType = "contact.created";
      else if (slug === "updated") eventType = "contact.updated";
      else if (slug === "deleted") eventType = "contact.deleted";
      else eventType = `contact.${slug || "unknown"}`;
    } else if (entityFqdn.includes("form_submission") || entityFqdn.includes("submission")) {
      eventType = "form_submission.created";
    } else if (slug === "app_installed" || entityFqdn.includes("app")) {
      eventType = "app.installed";
    }

    // Also check for app install via top-level payload fields
    if (eventType === "unknown") {
      const topEventType =
        (jwtPayload.eventType as string) ||
        (jwtPayload.webhookEvent as string) ||
        request.headers.get("x-wix-event-type") ||
        "";
      if (topEventType.toLowerCase().includes("install")) {
        eventType = "app.installed";
      }
    }

    console.log(
      `[WIX WEBHOOK] eventType=${eventType} entityFqdn=${entityFqdn} slug=${slug} entityId=${entityId} instanceId=${instanceId}`,
    );
    logger.info(`Wix webhook: ${eventType} for instance ${instanceId}`);

    // ── Step 5: Route to handler ───────────────────────────
    switch (true) {
      case eventType === "app.installed":
        await handleAppInstalled(instanceId);
        break;

      case eventType === "contact.created":
      case eventType === "contact.updated":
        await handleContactEvent(instanceId, eventData, entityId, eventType);
        break;

      case eventType.startsWith("form_submission"):
        await handleFormSubmission(instanceId, eventData);
        break;

      default:
        logger.info(`Wix webhook: Unhandled event type: ${eventType}`);
    }

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
  eventData: Record<string, unknown>,
  entityId: string,
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

  // Contact ID comes from entityId (already extracted from the nested payload)
  const contactId = entityId || (eventData.entityId as string);

  if (!contactId) {
    logger.warn("Could not extract contact ID from webhook payload");
    return;
  }

  const eventId =
    (eventData.id as string) || `wix-${contactId}-${Date.now()}`;

  console.log(
    `[WIX WEBHOOK] Syncing contact ${contactId} (event: ${eventType}, eventId: ${eventId})`,
  );

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
  eventData: Record<string, unknown>,
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

  // eventData is the already-parsed inner event object
  const formData = eventData;

  const submissions =
    (formData.submissions as Record<string, string>) ||
    (formData.values as Record<string, string>) ||
    {};

  const eventId =
    (formData.id as string) ||
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
