import prisma from "./db";
import logger from "./logger";
import type { FieldMappingConfig, MappedContactData } from "@/types";
import { SyncDirection } from "@/generated/prisma";

/**
 * Wix contact field → flat value extraction.
 * Maps nested Wix contact structure to flat key-value pairs.
 */
export function extractWixContactFields(
  contact: Record<string, unknown>,
): Record<string, string> {
  const fields: Record<string, string> = {};

  // Name fields
  const name = contact.name as Record<string, unknown> | undefined;
  if (name?.first) fields.firstName = String(name.first);
  if (name?.last) fields.lastName = String(name.last);

  // Email (take first)
  const emails = contact.emails as
    | { items?: Array<{ email?: string }> }
    | undefined;
  if (emails?.items?.[0]?.email) fields.email = emails.items[0].email;

  // Phone (take first)
  const phones = contact.phones as
    | { items?: Array<{ phone?: string }> }
    | undefined;
  if (phones?.items?.[0]?.phone) fields.phone = phones.items[0].phone;

  // Company
  const company = contact.company as Record<string, unknown> | undefined;
  if (company?.name) fields.company = String(company.name);

  // Job title
  if (contact.jobTitle) fields.jobTitle = String(contact.jobTitle);

  // Birthdate
  if (contact.birthdate) fields.birthdate = String(contact.birthdate);

  // Address (take first)
  const addresses = contact.addresses as
    | { items?: Array<Record<string, unknown>> }
    | undefined;
  if (addresses?.items?.[0]) {
    const addr = addresses.items[0];
    if (addr.street) fields.street = String(addr.street);
    if (addr.city) fields.city = String(addr.city);
    if (addr.subdivision) fields.state = String(addr.subdivision);
    if (addr.country) fields.country = String(addr.country);
    if (addr.postalCode) fields.postalCode = String(addr.postalCode);
  }

  return fields;
}

/**
 * Apply a transform function to a value.
 */
function applyTransform(value: string, transform?: string | null): string {
  if (!transform || !value) return value;

  switch (transform.toLowerCase()) {
    case "trim":
      return value.trim();
    case "lowercase":
      return value.toLowerCase();
    case "uppercase":
      return value.toUpperCase();
    case "trim_lowercase":
      return value.trim().toLowerCase();
    case "trim_uppercase":
      return value.trim().toUpperCase();
    default:
      return value;
  }
}

/**
 * Load field mapping configuration from the database for an installation.
 */
export async function getFieldMappings(
  installationId: string,
): Promise<FieldMappingConfig[]> {
  const mappings = await prisma.fieldMapping.findMany({
    where: { installationId },
    orderBy: { sortOrder: "asc" },
  });

  return mappings.map((m) => ({
    wixField: m.wixField,
    hubspotProperty: m.hubspotProperty,
    syncDirection: m.syncDirection,
    transform: m.transform,
  }));
}

/**
 * Map Wix contact fields to HubSpot properties using the configured mappings.
 * Only includes mappings with direction WIX_TO_HUBSPOT or BIDIRECTIONAL.
 */
export function mapWixToHubSpot(
  wixFields: Record<string, string>,
  mappings: FieldMappingConfig[],
): MappedContactData {
  const result: MappedContactData = {};

  for (const mapping of mappings) {
    // Only apply mappings that sync towards HubSpot
    if (
      mapping.syncDirection !== SyncDirection.WIX_TO_HUBSPOT &&
      mapping.syncDirection !== SyncDirection.BIDIRECTIONAL
    ) {
      continue;
    }

    const value = wixFields[mapping.wixField];
    if (value !== undefined && value !== "") {
      result[mapping.hubspotProperty] = applyTransform(
        value,
        mapping.transform,
      );
    }
  }

  return result;
}

/**
 * Map HubSpot properties to Wix contact fields using the configured mappings.
 * Only includes mappings with direction HUBSPOT_TO_WIX or BIDIRECTIONAL.
 */
export function mapHubSpotToWix(
  hubspotProps: Record<string, string | null>,
  mappings: FieldMappingConfig[],
): Record<string, string> {
  const result: Record<string, string> = {};

  for (const mapping of mappings) {
    // Only apply mappings that sync towards Wix
    if (
      mapping.syncDirection !== SyncDirection.HUBSPOT_TO_WIX &&
      mapping.syncDirection !== SyncDirection.BIDIRECTIONAL
    ) {
      continue;
    }

    const value = hubspotProps[mapping.hubspotProperty];
    if (value !== undefined && value !== null && value !== "") {
      result[mapping.wixField] = applyTransform(value, mapping.transform);
    }
  }

  return result;
}

/**
 * Convert flat Wix field key-values back into the nested Wix contact structure
 * that the Wix SDK expects for create/update operations.
 */
export function buildWixContactPayload(fields: Record<string, string>): {
  firstName?: string;
  lastName?: string;
  emails?: string[];
  phones?: string[];
  company?: string;
  jobTitle?: string;
} {
  const payload: {
    firstName?: string;
    lastName?: string;
    emails?: string[];
    phones?: string[];
    company?: string;
    jobTitle?: string;
  } = {};

  if (fields.firstName) payload.firstName = fields.firstName;
  if (fields.lastName) payload.lastName = fields.lastName;
  if (fields.email) payload.emails = [fields.email];
  if (fields.phone) payload.phones = [fields.phone];
  if (fields.company) payload.company = fields.company;
  if (fields.jobTitle) payload.jobTitle = fields.jobTitle;

  return payload;
}

/**
 * Get the default field mappings (used when creating a new installation).
 */
export function getDefaultFieldMappings(): FieldMappingConfig[] {
  return [
    {
      wixField: "firstName",
      hubspotProperty: "firstname",
      syncDirection: SyncDirection.BIDIRECTIONAL,
      transform: "trim",
    },
    {
      wixField: "lastName",
      hubspotProperty: "lastname",
      syncDirection: SyncDirection.BIDIRECTIONAL,
      transform: "trim",
    },
    {
      wixField: "email",
      hubspotProperty: "email",
      syncDirection: SyncDirection.BIDIRECTIONAL,
      transform: "trim_lowercase",
    },
    {
      wixField: "phone",
      hubspotProperty: "phone",
      syncDirection: SyncDirection.BIDIRECTIONAL,
      transform: "trim",
    },
    {
      wixField: "company",
      hubspotProperty: "company",
      syncDirection: SyncDirection.BIDIRECTIONAL,
      transform: "trim",
    },
    {
      wixField: "jobTitle",
      hubspotProperty: "jobtitle",
      syncDirection: SyncDirection.BIDIRECTIONAL,
      transform: "trim",
    },
  ];
}

logger.debug("Field mapper module loaded");
