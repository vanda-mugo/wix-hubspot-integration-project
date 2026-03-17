import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/db";

/**
 * GET /api/auth/hubspot/status
 * Returns connection status for a given installation.
 * Query params: installationId
 */
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = request.nextUrl;
    const installationId = searchParams.get("installationId");

    if (!installationId) {
      return NextResponse.json(
        { success: false, error: "Missing installationId" },
        { status: 400 },
      );
    }

    const installation = await prisma.installation.findUnique({
      where: { id: installationId },
    });

    if (!installation) {
      return NextResponse.json(
        { success: false, error: "Installation not found" },
        { status: 404 },
      );
    }

    return NextResponse.json({
      success: true,
      data: {
        connected: installation.isConnected,
        portalId: installation.hubspotPortalId,
        connectedAt: installation.isConnected
          ? installation.updatedAt.toISOString()
          : null,
      },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return NextResponse.json(
      { success: false, error: message },
      { status: 500 },
    );
  }
}
