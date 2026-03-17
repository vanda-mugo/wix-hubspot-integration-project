import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/db";
import logger from "@/lib/logger";

/**
 * POST /api/auth/hubspot/disconnect
 * Disconnects HubSpot by clearing tokens from the installation.
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { installationId, instanceId } = body;

    if (!installationId || !instanceId) {
      return NextResponse.json(
        { success: false, error: "Missing installationId or instanceId" },
        { status: 400 },
      );
    }

    // Verify installation
    const installation = await prisma.installation.findUnique({
      where: { id: installationId },
    });

    if (!installation || installation.wixInstanceId !== instanceId) {
      return NextResponse.json(
        { success: false, error: "Invalid installation" },
        { status: 404 },
      );
    }

    // Revoke HubSpot token (best effort)
    if (installation.hsRefreshToken) {
      try {
        const { decrypt } = await import("@/lib/crypto");
        const refreshToken = decrypt(installation.hsRefreshToken);
        await fetch(
          "https://api.hubapi.com/oauth/v1/refresh-tokens/" + refreshToken,
          {
            method: "DELETE",
          },
        );
      } catch {
        logger.warn("Failed to revoke HubSpot token — clearing locally anyway");
      }
    }

    // Clear all HubSpot data
    await prisma.installation.update({
      where: { id: installationId },
      data: {
        hsAccessToken: null,
        hsRefreshToken: null,
        tokenExpiresAt: null,
        hubspotPortalId: null,
        isConnected: false,
      },
    });

    logger.info(`HubSpot disconnected for installation ${installationId}`);

    return NextResponse.json({ success: true });
  } catch (error) {
    logger.error("HubSpot disconnect error:", error);
    return NextResponse.json(
      { success: false, error: "Failed to disconnect" },
      { status: 500 },
    );
  }
}
