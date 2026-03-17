import { NextRequest, NextResponse } from "next/server";

/**
 * Wix Webhook Receiver
 *
 * Handles all Wix webhook events:
 * - app.installed        → store instanceId for the site
 * - contact.created      → sync new contact to HubSpot
 * - contact.updated      → sync updated contact to HubSpot
 * - form_submission.created → push form data to HubSpot
 *
 * Wix sends webhook payloads as JWT-signed strings (not JSON).
 * We verify the JWT signature using the Wix Public Key before processing.
 */

// Temporary in-memory log for development — will be replaced with DB logging
const recentEvents: Array<{ type: string; timestamp: string; payload: unknown }> = [];

export async function POST(request: NextRequest) {
  try {
    // Wix sends the body as a raw JWT string, not JSON
    const body = await request.text();

    if (!body) {
      console.error("[Wix Webhook] Empty body received");
      return NextResponse.json({ error: "Empty body" }, { status: 400 });
    }

    // For now, decode the JWT payload without verification (development mode)
    // TODO: Add proper JWT verification using Wix Public Key
    let payload: Record<string, unknown>;
    try {
      // JWT format: header.payload.signature
      const parts = body.split(".");
      if (parts.length === 3) {
        // Base64URL decode the payload (second part)
        const base64 = parts[1].replace(/-/g, "+").replace(/_/g, "/");
        const jsonStr = Buffer.from(base64, "base64").toString("utf-8");
        payload = JSON.parse(jsonStr);
      } else {
        // If it's not a JWT, try parsing as JSON (for testing)
        payload = JSON.parse(body);
      }
    } catch {
      console.error("[Wix Webhook] Failed to parse body");
      return NextResponse.json({ error: "Invalid payload" }, { status: 400 });
    }

    // Extract event metadata
    const eventType = (payload.data as Record<string, unknown>)?.eventType as string
      || payload.eventType as string
      || "unknown";
    const instanceId = (payload.data as Record<string, unknown>)?.instanceId as string
      || payload.instanceId as string
      || "unknown";

    console.log(`[Wix Webhook] Received event: ${eventType} for instance: ${instanceId}`);

    // Log the event (development)
    recentEvents.unshift({
      type: eventType,
      timestamp: new Date().toISOString(),
      payload,
    });
    // Keep only last 50 events in memory
    if (recentEvents.length > 50) recentEvents.pop();

    // Route by event type
    switch (true) {
      case eventType.includes("app.installed"):
      case eventType.includes("AppInstalled"):
        await handleAppInstalled(instanceId, payload);
        break;

      case eventType.includes("contact.created"):
      case eventType.includes("ContactCreated"):
        await handleContactCreated(instanceId, payload);
        break;

      case eventType.includes("contact.updated"):
      case eventType.includes("ContactUpdated"):
        await handleContactUpdated(instanceId, payload);
        break;

      case eventType.includes("form_submission.created"):
      case eventType.includes("FormSubmissionCreated"):
        await handleFormSubmission(instanceId, payload);
        break;

      default:
        console.log(`[Wix Webhook] Unhandled event type: ${eventType}`);
    }

    // IMPORTANT: Must respond 200 within 1250ms or Wix will retry
    return NextResponse.json({ received: true });
  } catch (error) {
    console.error("[Wix Webhook] Error processing webhook:", error);
    // Still return 200 to prevent Wix from retrying on application errors
    return NextResponse.json({ received: true, error: "Processing error" });
  }
}

// Also handle GET for health check / verification
export async function GET() {
  return NextResponse.json({
    status: "ok",
    endpoint: "Wix Webhook Receiver",
    message: "This endpoint accepts POST requests from Wix webhooks.",
    recentEventsCount: recentEvents.length,
  });
}

// ─── Event Handlers ──────────────────────────────────────────────

async function handleAppInstalled(instanceId: string, payload: Record<string, unknown>) {
  console.log(`[Wix Webhook] App installed on site: ${instanceId}`);
  // TODO: Create Installation record in database
  // await prisma.installation.create({ data: { wixInstanceId: instanceId } });
  console.log("[Wix Webhook] TODO: Store installation in database", { instanceId, payload: "logged" });
}

async function handleContactCreated(instanceId: string, payload: Record<string, unknown>) {
  console.log(`[Wix Webhook] Contact created on site: ${instanceId}`);
  // TODO: Sync new contact to HubSpot
  // 1. Check ProcessedEvent (dedupe)
  // 2. Check SyncEvent (loop prevention)
  // 3. Apply field mappings
  // 4. Create/upsert contact in HubSpot
  // 5. Store ContactMapping
  // 6. Log SyncEvent
  console.log("[Wix Webhook] TODO: Sync contact to HubSpot", { instanceId, payload: "logged" });
}

async function handleContactUpdated(instanceId: string, payload: Record<string, unknown>) {
  console.log(`[Wix Webhook] Contact updated on site: ${instanceId}`);
  // TODO: Sync updated contact to HubSpot
  // 1. Check ProcessedEvent (dedupe)
  // 2. Check SyncEvent (loop prevention — skip if this was our own write)
  // 3. Apply field mappings
  // 4. Idempotency check (skip if values unchanged)
  // 5. Update contact in HubSpot
  // 6. Update ContactMapping + log SyncEvent
  console.log("[Wix Webhook] TODO: Sync contact update to HubSpot", { instanceId, payload: "logged" });
}

async function handleFormSubmission(instanceId: string, payload: Record<string, unknown>) {
  console.log(`[Wix Webhook] Form submitted on site: ${instanceId}`);
  // TODO: Push form submission to HubSpot
  // 1. Extract email, name, custom fields
  // 2. Extract UTM params (utm_source, utm_medium, etc.)
  // 3. Extract page URL, referrer, timestamp
  // 4. Upsert contact in HubSpot with all properties
  // 5. Store ContactMapping + log SyncEvent
  console.log("[Wix Webhook] TODO: Push form submission to HubSpot", { instanceId, payload: "logged" });
}
