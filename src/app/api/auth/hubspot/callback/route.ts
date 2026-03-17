import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/db";
import { encrypt } from "@/lib/crypto";
import logger from "@/lib/logger";

/**
 * GET /api/auth/hubspot/callback
 * HubSpot OAuth callback — exchanges code for tokens and stores them.
 */
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = request.nextUrl;
    const code = searchParams.get("code");
    const state = searchParams.get("state");
    const error = searchParams.get("error");

    if (error) {
      logger.error("HubSpot OAuth error:", error);
      return renderCallbackPage(false, "HubSpot authorization was denied");
    }

    if (!code || !state) {
      return renderCallbackPage(false, "Missing code or state parameter");
    }

    // Decode state
    let statePayload: { instanceId: string; installationId: string };
    try {
      statePayload = JSON.parse(
        Buffer.from(state, "base64url").toString("utf8"),
      );
    } catch {
      return renderCallbackPage(false, "Invalid state parameter");
    }

    const { instanceId, installationId } = statePayload;

    // Verify installation exists
    const installation = await prisma.installation.findUnique({
      where: { id: installationId },
    });

    if (!installation || installation.wixInstanceId !== instanceId) {
      return renderCallbackPage(false, "Invalid installation");
    }

    // Exchange code for tokens
    const clientId = process.env.HUBSPOT_CLIENT_ID!;
    const clientSecret = process.env.HUBSPOT_CLIENT_SECRET!;
    const redirectUri = `${process.env.NEXT_PUBLIC_APP_URL}/api/auth/hubspot/callback`;

    const tokenResponse = await fetch("https://api.hubapi.com/oauth/v1/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "authorization_code",
        client_id: clientId,
        client_secret: clientSecret,
        redirect_uri: redirectUri,
        code,
      }),
    });

    if (!tokenResponse.ok) {
      const text = await tokenResponse.text();
      logger.error("HubSpot token exchange failed:", text);
      return renderCallbackPage(false, "Failed to exchange authorization code");
    }

    const tokenData = await tokenResponse.json();
    const { access_token, refresh_token, expires_in } = tokenData;

    // Get HubSpot account info (portal ID)
    const accountInfo = await fetch(
      "https://api.hubapi.com/oauth/v1/access-tokens/" + access_token,
    );
    const accountData = accountInfo.ok ? await accountInfo.json() : {};

    // Encrypt tokens and store
    const encryptedAccess = encrypt(access_token);
    const encryptedRefresh = encrypt(refresh_token);
    const expiresAt = new Date(Date.now() + expires_in * 1000);

    await prisma.installation.update({
      where: { id: installationId },
      data: {
        hsAccessToken: encryptedAccess,
        hsRefreshToken: encryptedRefresh,
        tokenExpiresAt: expiresAt,
        hubspotPortalId: accountData.hub_id?.toString() || null,
        isConnected: true,
      },
    });

    logger.info(
      `HubSpot connected for installation ${installationId}, portal ${accountData.hub_id}`,
    );

    return renderCallbackPage(true);
  } catch (error) {
    logger.error("HubSpot OAuth callback error:", error);
    return renderCallbackPage(false, "An unexpected error occurred");
  }
}

/**
 * Render a simple HTML page that communicates the result back to the parent iframe.
 */
function renderCallbackPage(success: boolean, error?: string) {
  const html = `<!DOCTYPE html>
<html>
<head><title>HubSpot Connection</title></head>
<body>
  <script>
    const result = ${JSON.stringify({ success, error })};
    if (window.opener) {
      window.opener.postMessage({ type: 'hubspot-oauth-callback', ...result }, '*');
      window.close();
    } else if (window.parent) {
      window.parent.postMessage({ type: 'hubspot-oauth-callback', ...result }, '*');
    } else {
      document.body.innerHTML = result.success
        ? '<h2>Connected! You can close this window.</h2>'
        : '<h2>Error: ' + (result.error || 'Unknown error') + '</h2>';
    }
  </script>
  <noscript>
    ${success ? "<h2>Connected successfully! You can close this window.</h2>" : `<h2>Error: ${error || "Unknown"}</h2>`}
  </noscript>
</body>
</html>`;

  return new NextResponse(html, {
    status: 200,
    headers: { "Content-Type": "text/html" },
  });
}
