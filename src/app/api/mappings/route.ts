import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/db";
import { getDefaultFieldMappings } from "@/lib/field-mapper";
import { SyncDirection } from "@/generated/prisma";
import logger from "@/lib/logger";

/**
 * GET /api/mappings?installationId=xxx
 * Returns all field mappings for the installation.
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

    const mappings = await prisma.fieldMapping.findMany({
      where: { installationId },
      orderBy: { createdAt: "asc" },
    });

    return NextResponse.json({
      success: true,
      data: mappings.map((m) => ({
        id: m.id,
        wixField: m.wixField,
        hubspotProperty: m.hubspotProperty,
        syncDirection: m.syncDirection,
        transform: m.transform,
      })),
    });
  } catch (error) {
    logger.error("GET /api/mappings error:", error);
    return NextResponse.json(
      { success: false, error: "Failed to load mappings" },
      { status: 500 },
    );
  }
}

/**
 * POST /api/mappings
 * Saves field mappings for the installation, replacing all existing mappings.
 * Body: { installationId, instanceId, mappings: FieldMappingConfig[] }
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { installationId, instanceId, mappings } = body;

    if (!installationId || !instanceId) {
      return NextResponse.json(
        { success: false, error: "Missing installationId or instanceId" },
        { status: 400 },
      );
    }

    // Verify installation ownership
    const installation = await prisma.installation.findUnique({
      where: { id: installationId },
    });
    if (!installation || installation.wixInstanceId !== instanceId) {
      return NextResponse.json(
        { success: false, error: "Invalid installation" },
        { status: 404 },
      );
    }

    // Validate mappings array
    if (!Array.isArray(mappings)) {
      return NextResponse.json(
        { success: false, error: "mappings must be an array" },
        { status: 400 },
      );
    }

    const validDirections = Object.values(SyncDirection);
    for (const m of mappings) {
      if (!m.wixField || !m.hubspotProperty) {
        return NextResponse.json(
          {
            success: false,
            error: "Each mapping must have wixField and hubspotProperty",
          },
          { status: 400 },
        );
      }
      if (m.syncDirection && !validDirections.includes(m.syncDirection)) {
        return NextResponse.json(
          {
            success: false,
            error: `Invalid syncDirection: ${m.syncDirection}`,
          },
          { status: 400 },
        );
      }
    }

    // Replace all mappings in a transaction
    await prisma.$transaction(async (tx) => {
      await tx.fieldMapping.deleteMany({ where: { installationId } });
      if (mappings.length > 0) {
        await tx.fieldMapping.createMany({
          data: mappings.map(
            (m: {
              wixField: string;
              hubspotProperty: string;
              syncDirection?: SyncDirection;
              transform?: string;
            }) => ({
              installationId,
              wixField: m.wixField,
              hubspotProperty: m.hubspotProperty,
              syncDirection: m.syncDirection || SyncDirection.BIDIRECTIONAL,
              transform: m.transform || null,
            }),
          ),
        });
      }
    });

    logger.info(
      `Saved ${mappings.length} field mappings for installation ${installationId}`,
    );

    return NextResponse.json({ success: true, count: mappings.length });
  } catch (error) {
    logger.error("POST /api/mappings error:", error);
    return NextResponse.json(
      { success: false, error: "Failed to save mappings" },
      { status: 500 },
    );
  }
}

/**
 * PUT /api/mappings
 * Reset mappings to defaults.
 * Body: { installationId, instanceId }
 */
export async function PUT(request: NextRequest) {
  try {
    const body = await request.json();
    const { installationId, instanceId } = body;

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

    const defaults = getDefaultFieldMappings();

    await prisma.$transaction(async (tx) => {
      await tx.fieldMapping.deleteMany({ where: { installationId } });
      await tx.fieldMapping.createMany({
        data: defaults.map((m) => ({
          installationId,
          wixField: m.wixField,
          hubspotProperty: m.hubspotProperty,
          syncDirection: m.syncDirection,
          transform: m.transform || null,
        })),
      });
    });

    return NextResponse.json({ success: true, count: defaults.length });
  } catch (error) {
    logger.error("PUT /api/mappings error:", error);
    return NextResponse.json(
      { success: false, error: "Failed to reset mappings" },
      { status: 500 },
    );
  }
}
