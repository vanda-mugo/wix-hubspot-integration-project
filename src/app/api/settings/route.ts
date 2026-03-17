import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/db";
import { ConflictStrategy } from "@/generated/prisma";
import logger from "@/lib/logger";

/**
 * GET /api/settings?installationId=xxx
 * Returns current settings for the installation.
 */
export async function GET(request: NextRequest) {
  try {
    const installationId = request.nextUrl.searchParams.get("installationId");
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
        conflictStrategy: installation.conflictStrategy,
      },
    });
  } catch (error) {
    logger.error("GET /api/settings error:", error);
    return NextResponse.json(
      { success: false, error: "Failed to load settings" },
      { status: 500 },
    );
  }
}

/**
 * PUT /api/settings
 * Updates settings for the installation.
 * Body: { installationId, instanceId, conflictStrategy?, syncEnabled? }
 */
export async function PUT(request: NextRequest) {
  try {
    const body = await request.json();
    const { installationId, instanceId, conflictStrategy } = body;

    if (!installationId || !instanceId) {
      return NextResponse.json(
        { success: false, error: "Missing installationId or instanceId" },
        { status: 400 },
      );
    }

    const installation = await prisma.installation.findUnique({
      where: { id: installationId },
    });
    if (!installation || installation.wixInstanceId !== instanceId) {
      return NextResponse.json(
        { success: false, error: "Invalid installation" },
        { status: 404 },
      );
    }

    // Validate conflict strategy
    const validStrategies = Object.values(ConflictStrategy);
    if (conflictStrategy && !validStrategies.includes(conflictStrategy)) {
      return NextResponse.json(
        {
          success: false,
          error: `Invalid conflictStrategy. Must be one of: ${validStrategies.join(", ")}`,
        },
        { status: 400 },
      );
    }

    const updateData: Record<string, unknown> = {};
    if (conflictStrategy !== undefined)
      updateData.conflictStrategy = conflictStrategy;

    await prisma.installation.update({
      where: { id: installationId },
      data: updateData,
    });

    logger.info(`Updated settings for installation ${installationId}`);

    return NextResponse.json({ success: true });
  } catch (error) {
    logger.error("PUT /api/settings error:", error);
    return NextResponse.json(
      { success: false, error: "Failed to update settings" },
      { status: 500 },
    );
  }
}
