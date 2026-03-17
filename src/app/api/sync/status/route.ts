import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/db";
import { SyncStatus } from "@/generated/prisma";

/**
 * GET /api/sync/status?installationId=xxx
 * Returns sync status: total mappings, recent events, last sync time.
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

    const [totalMappings, recentEvents, lastSuccess] = await Promise.all([
      prisma.contactMapping.count({ where: { installationId } }),
      prisma.syncEvent.findMany({
        where: { installationId },
        orderBy: { createdAt: "desc" },
        take: 20,
        select: {
          id: true,
          eventType: true,
          source: true,
          status: true,
          createdAt: true,
          error: true,
          wixContactId: true,
          hubspotContactId: true,
        },
      }),
      prisma.syncEvent.findFirst({
        where: { installationId, status: SyncStatus.SUCCESS },
        orderBy: { createdAt: "desc" },
        select: { createdAt: true },
      }),
    ]);

    return NextResponse.json({
      success: true,
      data: {
        totalMappings,
        recentEvents: recentEvents.map((e) => ({
          id: e.id,
          eventType: e.eventType,
          source: e.source,
          status: e.status,
          createdAt: e.createdAt.toISOString(),
          error: e.error,
          wixContactId: e.wixContactId,
          hubspotContactId: e.hubspotContactId,
        })),
        lastSyncAt: lastSuccess?.createdAt?.toISOString() || null,
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
