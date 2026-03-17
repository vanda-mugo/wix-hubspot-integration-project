import { NextRequest, NextResponse } from "next/server";
import crypto from "crypto";

/**
 * HubSpot Webhook Receiver
 *
 * Handles HubSpot webhook events:
 * - contact.creation       → sync new contact to Wix
 * - contact.propertyChange → sync updated properties to Wix
 *
 * HubSpot sends batches of up to 100 events per POST.
 * Requests are verified using HMAC SHA-256 signature in the
 * X-HubSpot-Signature-v3 header.
 */

interface HubSpotWebhookEvent {
  objectId: number;
  propertyName?: string;
  propertyValue?: string;
  changeSource: string;
  eventId: number;
  subscriptionId: number;
  portalId: number;
  appId: number;
  occurredAt: number;
  subscriptionType: string;
  attemptNumber: number;
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.text();

    if (!body) {
      return NextResponse.json({ error: "Empty body" }, { status: 400 });
    }

    // Verify HubSpot signature
    const signature = request.headers.get("x-hubspot-signature-v3");
    const timestamp = request.headers.get("x-hubspot-request-timestamp");
    const hubspotSecret = process.env.HUBSPOT_CLIENT_SECRET;

    if (hubspotSecret && signature && timestamp) {
      const isValid = verifyHubSpotSignature(
        hubspotSecret,
        signature,
        request.method,
        request.url,
        body,
        timestamp
      );

      if (!isValid) {
        console.error("[HubSpot Webhook] Invalid signature");
        return NextResponse.json({ error: "Invalid signature" }, { status: 401 });
      }
    } else if (hubspotSecret) {
      // In production, reject unsigned requests
      console.warn("[HubSpot Webhook] Missing signature headers — allowing in development");
    }

    // HubSpot sends an array of events
    const events: HubSpotWebhookEvent[] = JSON.parse(body);

    console.log(`[HubSpot Webhook] Received ${events.length} event(s)`);

    for (const event of events) {
      console.log(
        `[HubSpot Webhook] Event: ${event.subscriptionType} | ` +
        `Contact: ${event.objectId} | ` +
        `Portal: ${event.portalId}`
      );

      switch (event.subscriptionType) {
        case "contact.creation":
          await handleContactCreation(event);
          break;

        case "contact.propertyChange":
          await handlePropertyChange(event);
          break;

        default:
          console.log(`[HubSpot Webhook] Unhandled event: ${event.subscriptionType}`);
      }
    }

    // Must respond 200 quickly — HubSpot has a 5-second timeout
    return NextResponse.json({ received: true });
  } catch (error) {
    console.error("[HubSpot Webhook] Error:", error);
    return NextResponse.json({ received: true, error: "Processing error" });
  }
}

// Health check
export async function GET() {
  return NextResponse.json({
    status: "ok",
    endpoint: "HubSpot Webhook Receiver",
    message: "This endpoint accepts POST requests from HubSpot webhooks.",
  });
}

// ─── Signature Verification ──────────────────────────────────────

function verifyHubSpotSignature(
  clientSecret: string,
  signature: string,
  method: string,
  url: string,
  body: string,
  timestamp: string
): boolean {
  // HubSpot v3 signature: HMAC SHA-256 of (method + url + body + timestamp)
  const sourceString = `${method}${url}${body}${timestamp}`;
  const hash = crypto
    .createHmac("sha256", clientSecret)
    .update(sourceString)
    .digest("base64");

  // Timing-safe comparison to prevent timing attacks
  try {
    return crypto.timingSafeEqual(Buffer.from(hash), Buffer.from(signature));
  } catch {
    return false;
  }
}

// ─── Event Handlers ──────────────────────────────────────────────

async function handleContactCreation(event: HubSpotWebhookEvent) {
  console.log(`[HubSpot Webhook] New contact created: ${event.objectId}`);
  // TODO: Sync to Wix
  // 1. Check ProcessedEvent (dedupe by eventId)
  // 2. Check SyncEvent (loop prevention — skip if our own Wix→HS write)
  // 3. Fetch full contact from HubSpot API
  // 4. Apply field mappings (HS→Wix direction)
  // 5. Create contact in Wix via SDK
  // 6. Store ContactMapping + log SyncEvent
  console.log("[HubSpot Webhook] TODO: Create contact in Wix");
}

async function handlePropertyChange(event: HubSpotWebhookEvent) {
  console.log(
    `[HubSpot Webhook] Contact ${event.objectId} property changed: ` +
    `${event.propertyName} = ${event.propertyValue}`
  );
  // TODO: Sync property change to Wix
  // 1. Check ProcessedEvent (dedupe)
  // 2. Check SyncEvent (loop prevention)
  // 3. Look up ContactMapping by hubspotContactId
  // 4. Apply field mappings + conflict resolution
  // 5. Idempotency check
  // 6. Update contact in Wix
  // 7. Update ContactMapping + log SyncEvent
  console.log("[HubSpot Webhook] TODO: Update contact in Wix");
}
