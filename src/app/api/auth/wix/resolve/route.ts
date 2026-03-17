import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/db";

/**
 * POST /api/auth/wix/resolve
 * Decodes the Wix instance token and resolves or creates an Installation record.
 * Body: { instance: string }
 *
 * The Wix instance token format: <base64-signature>.<base64-payload>
 * The payload JSON contains: { instanceId, appDefId, signDate, ... }
 */
export async function POST(request: NextRequest) {
  try {
    const { instance } = await request.json();

    if (!instance) {
      return NextResponse.json(
        { success: false, error: "Missing instance token" },
        { status: 400 },
      );
    }

    // Decode the Wix instance token
    // Format: base64url(signature).base64url(payload)
    const parts = instance.split(".");
    if (parts.length < 2) {
      return NextResponse.json(
        { success: false, error: "Invalid instance token format" },
        { status: 400 },
      );
    }

    let payload: { instanceId?: string; appDefId?: string };
    try {
      const payloadBase64 = parts[1].replace(/-/g, "+").replace(/_/g, "/");
      const payloadStr = Buffer.from(payloadBase64, "base64").toString("utf8");
      payload = JSON.parse(payloadStr);
    } catch {
      return NextResponse.json(
        { success: false, error: "Failed to decode instance token" },
        { status: 400 },
      );
    }

    const instanceId = payload.instanceId;
    if (!instanceId) {
      return NextResponse.json(
        { success: false, error: "No instanceId in token" },
        { status: 400 },
      );
    }

    // Find or create the installation record
    const installation = await prisma.installation.upsert({
      where: { wixInstanceId: instanceId },
      create: { wixInstanceId: instanceId },
      update: {},
    });

    return NextResponse.json({
      success: true,
      data: {
        installationId: installation.id,
        instanceId: instanceId,
        isConnected: installation.isConnected,
      },
    });
  } catch (error) {
    console.error("Error resolving Wix instance:", error);
    return NextResponse.json(
      { success: false, error: "Internal server error" },
      { status: 500 },
    );
  }
}
