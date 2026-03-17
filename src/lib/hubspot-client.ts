import { Client } from "@hubspot/api-client";
import { FilterOperatorEnum } from "@hubspot/api-client/lib/codegen/crm/contacts";
import {
  PropertyCreateTypeEnum,
  PropertyCreateFieldTypeEnum,
} from "@hubspot/api-client/lib/codegen/crm/properties";
import prisma from "./db";
import { encrypt, decrypt } from "./crypto";
import logger from "./logger";
import type { HubSpotContactProperties } from "@/types";

// ─── Custom UTM Properties ───────────────────────────────
// These are created in HubSpot on first use to store Wix form attribution data.

const UTM_PROPERTIES = [
  {
    name: "wix_utm_source",
    label: "Wix UTM Source",
    type: "string",
    fieldType: "text",
    groupName: "contactinformation",
  },
  {
    name: "wix_utm_medium",
    label: "Wix UTM Medium",
    type: "string",
    fieldType: "text",
    groupName: "contactinformation",
  },
  {
    name: "wix_utm_campaign",
    label: "Wix UTM Campaign",
    type: "string",
    fieldType: "text",
    groupName: "contactinformation",
  },
  {
    name: "wix_utm_term",
    label: "Wix UTM Term",
    type: "string",
    fieldType: "text",
    groupName: "contactinformation",
  },
  {
    name: "wix_utm_content",
    label: "Wix UTM Content",
    type: "string",
    fieldType: "text",
    groupName: "contactinformation",
  },
  {
    name: "wix_form_page_url",
    label: "Wix Form Page URL",
    type: "string",
    fieldType: "text",
    groupName: "contactinformation",
  },
  {
    name: "wix_form_referrer",
    label: "Wix Form Referrer",
    type: "string",
    fieldType: "text",
    groupName: "contactinformation",
  },
  {
    name: "wix_sync_source",
    label: "Wix Sync Source",
    type: "string",
    fieldType: "text",
    groupName: "contactinformation",
  },
];

/**
 * Creates an authenticated HubSpot API client for a specific installation.
 * Automatically handles token refresh if the access token is expired.
 */
export async function createHubSpotClient(
  installationId: string,
): Promise<Client> {
  const installation = await prisma.installation.findUnique({
    where: { id: installationId },
  });

  if (
    !installation ||
    !installation.hsAccessToken ||
    !installation.hsRefreshToken
  ) {
    throw new Error("HubSpot is not connected for this installation");
  }

  let accessToken = decrypt(installation.hsAccessToken);

  // Check if token needs refresh (refresh 5 minutes before expiry)
  const now = new Date();
  const expiresAt = installation.tokenExpiresAt;
  const fiveMinutes = 5 * 60 * 1000;

  if (expiresAt && now.getTime() > expiresAt.getTime() - fiveMinutes) {
    logger.info("HubSpot token expired, refreshing...");
    accessToken = await refreshHubSpotToken(
      installationId,
      decrypt(installation.hsRefreshToken),
    );
  }

  return new Client({ accessToken });
}

/**
 * Refresh HubSpot OAuth token using the refresh token.
 * Updates the stored tokens in the database.
 */
async function refreshHubSpotToken(
  installationId: string,
  refreshToken: string,
): Promise<string> {
  const clientId = process.env.HUBSPOT_CLIENT_ID;
  const clientSecret = process.env.HUBSPOT_CLIENT_SECRET;

  if (!clientId || !clientSecret) {
    throw new Error("HUBSPOT_CLIENT_ID and HUBSPOT_CLIENT_SECRET must be set");
  }

  const response = await fetch("https://api.hubapi.com/oauth/v1/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "refresh_token",
      client_id: clientId,
      client_secret: clientSecret,
      refresh_token: refreshToken,
    }),
  });

  if (!response.ok) {
    const errorText = await response.text();
    logger.error("HubSpot token refresh failed:", errorText);
    throw new Error(`HubSpot token refresh failed: ${response.status}`);
  }

  const data = await response.json();

  // Update tokens in database (encrypted)
  await prisma.installation.update({
    where: { id: installationId },
    data: {
      hsAccessToken: encrypt(data.access_token),
      hsRefreshToken: encrypt(data.refresh_token),
      tokenExpiresAt: new Date(Date.now() + data.expires_in * 1000),
    },
  });

  logger.info("HubSpot token refreshed successfully");
  return data.access_token;
}

// ─── HubSpot Contact Operations ──────────────────────────

/**
 * Get a HubSpot contact by ID with all properties.
 */
export async function getHubSpotContact(
  installationId: string,
  contactId: string,
) {
  const client = await createHubSpotClient(installationId);
  try {
    const response = await client.crm.contacts.basicApi.getById(
      contactId,
      undefined,
      undefined,
      undefined,
      false,
    );
    return response;
  } catch (error) {
    logger.error("Failed to get HubSpot contact:", contactId, error);
    throw error;
  }
}

/**
 * Create a new contact in HubSpot.
 */
export async function createHubSpotContact(
  installationId: string,
  properties: HubSpotContactProperties,
) {
  const client = await createHubSpotClient(installationId);
  try {
    const response = await client.crm.contacts.basicApi.create({
      properties: properties as Record<string, string>,
      associations: [],
    });
    logger.info("Created HubSpot contact:", response.id);
    return response;
  } catch (error) {
    logger.error("Failed to create HubSpot contact:", error);
    throw error;
  }
}

/**
 * Update a HubSpot contact by ID.
 */
export async function updateHubSpotContact(
  installationId: string,
  contactId: string,
  properties: HubSpotContactProperties,
) {
  const client = await createHubSpotClient(installationId);
  try {
    const response = await client.crm.contacts.basicApi.update(contactId, {
      properties: properties as Record<string, string>,
    });
    logger.info("Updated HubSpot contact:", contactId);
    return response;
  } catch (error) {
    logger.error("Failed to update HubSpot contact:", contactId, error);
    throw error;
  }
}

/**
 * Search for a HubSpot contact by email.
 */
export async function findHubSpotContactByEmail(
  installationId: string,
  email: string,
) {
  const client = await createHubSpotClient(installationId);
  try {
    const response = await client.crm.contacts.searchApi.doSearch({
      filterGroups: [
        {
          filters: [
            {
              propertyName: "email",
              operator: FilterOperatorEnum.Eq,
              value: email,
            },
          ],
        },
      ],
      properties: ["email", "firstname", "lastname", "phone", "company"],
      limit: 1,
      after: "0",
      sorts: [],
    });
    return response.results?.[0] || null;
  } catch (error) {
    logger.error("Failed to search HubSpot contact by email:", error);
    throw error;
  }
}

/**
 * Get all HubSpot contact properties (for the field mapping UI).
 */
export async function getHubSpotProperties(installationId: string) {
  const client = await createHubSpotClient(installationId);
  try {
    const response = await client.crm.properties.coreApi.getAll("contacts");
    return response.results.map((prop) => ({
      value: prop.name,
      label: prop.label,
      type: prop.type,
      readOnly: prop.modificationMetadata?.readOnlyValue ?? false,
    }));
  } catch (error) {
    logger.error("Failed to get HubSpot properties:", error);
    throw error;
  }
}

/**
 * Ensure custom UTM properties exist in HubSpot.
 * Called once when a form submission needs to push attribution data.
 */
export async function ensureUtmProperties(installationId: string) {
  const client = await createHubSpotClient(installationId);

  for (const prop of UTM_PROPERTIES) {
    try {
      await client.crm.properties.coreApi.getByName("contacts", prop.name);
      // Property already exists
    } catch {
      // Property doesn't exist — create it
      try {
        await client.crm.properties.coreApi.create("contacts", {
          name: prop.name,
          label: prop.label,
          type: PropertyCreateTypeEnum.String,
          fieldType: PropertyCreateFieldTypeEnum.Text,
          groupName: prop.groupName,
        });
        logger.info(`Created HubSpot property: ${prop.name}`);
      } catch (createError) {
        logger.error(
          `Failed to create HubSpot property ${prop.name}:`,
          createError,
        );
      }
    }
  }
}
