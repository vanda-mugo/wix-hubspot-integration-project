import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/db";

/**
 * GET /api/debug/webhooks — view stored debug payloads
 * POST /api/debug/webhooks — store a webhook payload for inspection
 */

export async function POST(request: NextRequest) {
  try {
    const { headers, body, parsed } = await request.json();

    // Store as a SyncEvent with special eventType for debugging
    await prisma.syncEvent.create({
      data: {
        installationId: "debug",
        eventType: "DEBUG_WEBHOOK",
        source: "WIX",
        status: "SUCCESS",
        wixContactId: null,
        hubspotContactId: null,
        error: JSON.stringify({
          headers,
          body: typeof body === "string" ? body.substring(0, 3000) : body,
          parsed,
        }),
      },
    });

    return NextResponse.json({ stored: true });
  } catch (error) {
    console.error("Debug store error:", error);
    return NextResponse.json({ error: String(error) }, { status: 500 });
  }
}

export async function GET(request: NextRequest) {
  const key = request.nextUrl.searchParams.get("key");
  if (key !== "debug123") {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const events = await prisma.syncEvent.findMany({
    where: { eventType: "DEBUG_WEBHOOK" },
    orderBy: { createdAt: "desc" },
    take: 10,
  });

  return NextResponse.json({
    count: events.length,
    payloads: events.map((e) => ({
      id: e.id,
      createdAt: e.createdAt,
      data: e.error ? JSON.parse(e.error) : null,
    })),
  });
}
