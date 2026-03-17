import { NextRequest, NextResponse } from "next/server";
import crypto from "crypto";
import logger from "@/lib/logger";

/**
 * GET /api/auth/hubspot
 * Initiates HubSpot OAuth flow.
 * Query params:
 *   - instanceId: Wix site instance ID (required)
 *   - installationId: Our DB installation ID (required)
 */
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = request.nextUrl;
    const instanceId = searchParams.get("instanceId");
    const installationId = searchParams.get("installationId");

    if (!instanceId || !installationId) {
      return NextResponse.json(
        { success: false, error: "Missing instanceId or installationId" },
        { status: 400 },
      );
    }

    const clientId = process.env.HUBSPOT_CLIENT_ID;
    const redirectUri = `${process.env.NEXT_PUBLIC_APP_URL}/api/auth/hubspot/callback`;

    if (!clientId || !redirectUri) {
      logger.error("Missing HUBSPOT_CLIENT_ID or NEXT_PUBLIC_APP_URL env vars");
      return NextResponse.json(
        { success: false, error: "Server configuration error" },
        { status: 500 },
      );
    }

    // Build state parameter (CSRF protection + routing info)
    const statePayload = {
      instanceId,
      installationId,
      nonce: crypto.randomBytes(16).toString("hex"),
    };
    const state = Buffer.from(JSON.stringify(statePayload)).toString(
      "base64url",
    );

    // HubSpot scopes needed for contact sync
    const scopes = [
      "crm.objects.contacts.read",
      "crm.objects.contacts.write",
      "crm.schemas.contacts.read",
    ].join(" ");

    const authUrl = new URL("https://app.hubspot.com/oauth/authorize");
    authUrl.searchParams.set("client_id", clientId);
    authUrl.searchParams.set("redirect_uri", redirectUri);
    authUrl.searchParams.set("scope", scopes);
    authUrl.searchParams.set("state", state);

    logger.info(`Initiating HubSpot OAuth for installation ${installationId}`);

    return NextResponse.redirect(authUrl.toString());
  } catch (error) {
    logger.error("HubSpot OAuth initiation failed:", error);
    return NextResponse.json(
      { success: false, error: "Failed to initiate OAuth" },
      { status: 500 },
    );
  }
}
