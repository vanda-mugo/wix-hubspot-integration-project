import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/db";
import logger from "@/lib/logger";
import { verifyHubSpotSignature } from "@/lib/crypto";
import { syncHubSpotToWix } from "@/lib/sync-engine";

/**
 * HubSpot Webhook Receiver
 *
 * Handles HubSpot webhook events:
 * - contact.creation       → sync new contact to Wix
 * - contact.propertyChange → sync updated properties to Wix
 *
 * HubSpot sends batches of up to 100 events per POST.
 * Requests are verified using HMAC SHA-256 signature (v3).
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
        timestamp,
      );

      if (!isValid) {
        logger.error("HubSpot webhook: Invalid signature");
        return NextResponse.json(
          { error: "Invalid signature" },
          { status: 401 },
        );
      }
    } else if (hubspotSecret && process.env.NODE_ENV === "production") {
      logger.error("HubSpot webhook: Missing signature in production");
      return NextResponse.json({ error: "Missing signature" }, { status: 401 });
    }

    // HubSpot sends an array of events
    const events: HubSpotWebhookEvent[] = JSON.parse(body);
    logger.info(`HubSpot webhook: Received ${events.length} event(s)`);

    // Find installation by portal ID (from the first event)
    if (events.length === 0) {
      return NextResponse.json({ received: true });
    }

    const portalId = events[0].portalId.toString();
    const installation = await prisma.installation.findFirst({
      where: { hubspotPortalId: portalId, isConnected: true },
    });

    if (!installation) {
      logger.warn(`No installation found for HubSpot portal ${portalId}`);
      return NextResponse.json({ received: true });
    }

    // Process each event — must await on Vercel (serverless kills after response)
    for (const event of events) {
      // Skip events from INTEGRATION (our own writes) to prevent loops
      if (event.changeSource === "INTEGRATION") {
        logger.info(`Skipping INTEGRATION event for contact ${event.objectId}`);
        continue;
      }

      const eventId = `hs-${event.eventId}`;
      const hubspotContactId = event.objectId.toString();

      switch (event.subscriptionType) {
        case "contact.creation":
        case "contact.propertyChange":
        case "object.creation":
        case "object.propertyChange":
          try {
            await syncHubSpotToWix(
              installation.id,
              installation.wixInstanceId,
              hubspotContactId,
              eventId,
              event.subscriptionType,
            );
          } catch (err) {
            logger.error(
              `HubSpot→Wix sync failed for contact ${hubspotContactId}:`,
              err,
            );
          }
          break;

        default:
          logger.info(
            `HubSpot webhook: Unhandled event type: ${event.subscriptionType}`,
          );
      }
    }

    return NextResponse.json({ received: true });
  } catch (error) {
    logger.error("HubSpot webhook error:", error);
    return NextResponse.json({ received: true, error: "Processing error" });
  }
}

export async function GET() {
  return NextResponse.json({
    status: "ok",
    endpoint: "HubSpot Webhook Receiver",
  });
}
