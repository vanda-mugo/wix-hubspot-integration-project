import prisma from "./db";
import logger from "./logger";
import type { FieldMappingConfig, MappedContactData } from "@/types";
import { SyncDirection } from "@/generated/prisma";

/**
 * Wix contact field → flat value extraction.
 * Maps nested Wix contact structure to flat key-value pairs.
 * Wix v4 API nests contact data under `info`, so we check both paths.
 */
export function extractWixContactFields(
  contact: Record<string, unknown>,
): Record<string, string> {
  const fields: Record<string, string> = {};

  // Wix v4 API nests fields under `info`
  const info = (contact.info as Record<string, unknown>) || {};

  // Name fields — check info.name first, then top-level name
  const name =
    (info.name as Record<string, unknown>) ||
    (contact.name as Record<string, unknown>);
  if (name?.first) fields.firstName = String(name.first);
  if (name?.last) fields.lastName = String(name.last);

  // Email — check info.emails, then top-level emails, then primaryInfo
  const emails =
    (info.emails as { items?: Array<{ email?: string }> }) ||
    (contact.emails as { items?: Array<{ email?: string }> });
  if (emails?.items?.[0]?.email) {
    fields.email = emails.items[0].email;
  } else {
    // Fallback to primaryInfo or primaryEmail
    const primaryInfo = contact.primaryInfo as
      | Record<string, unknown>
      | undefined;
    const primaryEmail = contact.primaryEmail as
      | Record<string, unknown>
      | undefined;
    const email =
      (primaryInfo?.email as string) || (primaryEmail?.email as string);
    if (email) fields.email = email;
  }

  // Phone — check info.phones, then top-level phones, then primaryInfo
  const phones =
    (info.phones as { items?: Array<{ phone?: string }> }) ||
    (contact.phones as { items?: Array<{ phone?: string }> });
  if (phones?.items?.[0]?.phone) {
    fields.phone = phones.items[0].phone;
  } else {
    const primaryInfo = contact.primaryInfo as
      | Record<string, unknown>
      | undefined;
    const primaryPhone = contact.primaryPhone as
      | Record<string, unknown>
      | undefined;
    const phone =
      (primaryInfo?.phone as string) || (primaryPhone?.phone as string);
    if (phone) fields.phone = phone;
  }

  // Company — check info.company, then top-level company
  const company =
    (info.company as Record<string, unknown>) ||
    (contact.company as Record<string, unknown>);
  if (company?.name) fields.company = String(company.name);

  // Job title — check info.jobTitle, then top-level
  const jobTitle = (info.jobTitle as string) || (contact.jobTitle as string);
  if (jobTitle) fields.jobTitle = String(jobTitle);

  // Birthdate
  const birthdate = (info.birthdate as string) || (contact.birthdate as string);
  if (birthdate) fields.birthdate = String(birthdate);

  // Address — check info.addresses, then top-level
  const addresses =
    (info.addresses as { items?: Array<Record<string, unknown>> }) ||
    (contact.addresses as { items?: Array<Record<string, unknown>> });
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
 * Convert flat Wix field key-values back into the nested Wix v4 contact structure
 * that the Wix REST API expects for create/update operations.
 *
 * Wix v4 Contacts API shape:
 *   info.name.first / info.name.last
 *   info.emails.items[{ tag, email }]
 *   info.phones.items[{ tag, phone }]
 *   info.company          (top-level shortcut)
 *   info.jobTitle          (top-level shortcut)
 */
export function buildWixContactPayload(
  fields: Record<string, string>,
): Record<string, unknown> {
  const payload: Record<string, unknown> = {};

  // Name
  if (fields.firstName || fields.lastName) {
    payload.name = {
      ...(fields.firstName ? { first: fields.firstName } : {}),
      ...(fields.lastName ? { last: fields.lastName } : {}),
    };
  }

  // Emails — array of objects
  if (fields.email) {
    payload.emails = { items: [{ tag: "MAIN", email: fields.email }] };
  }

  // Phones — array of objects
  if (fields.phone) {
    payload.phones = { items: [{ tag: "MAIN", phone: fields.phone }] };
  }

  // Company & job title (top-level info shortcuts supported by v4)
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
