import { NextResponse } from "next/server";
import { WIX_STANDARD_FIELDS, HUBSPOT_STANDARD_PROPERTIES } from "@/types";

/**
 * GET /api/mappings/fields
 * Returns the available fields from both Wix and HubSpot for mapping dropdowns.
 */
export async function GET() {
  return NextResponse.json({
    success: true,
    data: {
      wixFields: WIX_STANDARD_FIELDS,
      hubspotProperties: HUBSPOT_STANDARD_PROPERTIES,
    },
  });
}
