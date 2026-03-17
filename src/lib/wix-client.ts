import { createClient, AppStrategy } from "@wix/sdk";
import logger from "./logger";

const WIX_API_BASE = "https://www.wixapis.com";

/**
 * Gets auth headers for a specific Wix site installation.
 * Uses AppStrategy to automatically handle token acquisition.
 */
async function getAuthHeaders(
  instanceId: string,
): Promise<Record<string, string>> {
  const appId = process.env.APP_ID;
  const appSecret = process.env.APP_SECRET;

  if (!appId || !appSecret) {
    throw new Error("APP_ID and APP_SECRET must be set in environment");
  }

  const client = createClient({
    auth: AppStrategy({
      appId,
      appSecret: appSecret,
      instanceId,
    }),
  });

  const authData = await client.auth.getAuthHeaders();
  return authData.headers;
}

/**
 * Make an authenticated request to the Wix REST API.
 */
async function wixFetch(
  instanceId: string,
  path: string,
  options: RequestInit = {},
): Promise<Response> {
  const authHeaders = await getAuthHeaders(instanceId);

  const response = await fetch(`${WIX_API_BASE}${path}`, {
    ...options,
    headers: {
      ...authHeaders,
      "Content-Type": "application/json",
      ...options.headers,
    },
  });

  if (!response.ok) {
    const text = await response.text();
    logger.error(`Wix API ${path} failed (${response.status}):`, text);
    throw new Error(`Wix API error ${response.status}: ${text}`);
  }

  return response;
}

// ─── Wix Contact Operations (REST API)

/**
 * Fetch a Wix contact by ID.
 */
export async function getWixContact(
  instanceId: string,
  contactId: string,
): Promise<{ contact: Record<string, unknown> }> {
  try {
    const response = await wixFetch(
      instanceId,
      `/contacts/v4/contacts/${contactId}`,
    );
    return response.json();
  } catch (error) {
    logger.error("Failed to get Wix contact:", contactId, error);
    throw error;
  }
}

/**
 * Create a new contact in Wix.
 */
export async function createWixContact(
  instanceId: string,
  contactData: Record<string, unknown>,
): Promise<{ id?: string; [key: string]: unknown }> {
  try {
    const response = await wixFetch(instanceId, "/contacts/v4/contacts", {
      method: "POST",
      body: JSON.stringify({ info: contactData }),
    });
    const result = await response.json();
    const contact = result.contact || result;
    logger.info("Created Wix contact:", contact?.id);
    return contact;
  } catch (error) {
    logger.error("Failed to create Wix contact:", error);
    throw error;
  }
}

/**
 * Update an existing contact in Wix.
 * First fetches the current revision number for optimistic concurrency.
 */
export async function updateWixContact(
  instanceId: string,
  contactId: string,
  contactData: Record<string, unknown>,
): Promise<{ id?: string; [key: string]: unknown }> {
  let attempts = 0;
  while (attempts < 2) {
    try {
      // Get current revision
      const current = await getWixContact(instanceId, contactId);
      const revision =
        (current.contact as Record<string, unknown>)?.revision ?? 1;

      const response = await wixFetch(
        instanceId,
        `/contacts/v4/contacts/${contactId}`,
        {
          method: "PATCH",
          body: JSON.stringify({
            info: contactData,
            revision,
          }),
        },
      );
      const result = await response.json();
      if (
        result?.message ===
          "Contact has been updated since the requested revision." ||
        result?.details?.applicationError?.code === "CONTACT_ALREADY_CHANGED"
      ) {
        logger.warn(
          "Wix contact update 409: retrying with latest revision",
          contactId,
        );
        attempts++;
        continue;
      }
      logger.info("Updated Wix contact:", contactId);
      return result.contact || result;
    } catch (error) {
      logger.error("Failed to update Wix contact:", contactId, error);
      throw error;
    }
  }
  throw new Error("Failed to update Wix contact after retrying revision");
}

/**
 * Query Wix contacts, optionally by email.
 */
export async function queryWixContacts(
  instanceId: string,
  options: { email?: string; limit?: number } = {},
): Promise<Array<Record<string, unknown>>> {
  try {
    const filter: Record<string, unknown> = {};
    if (options.email) {
      filter["info.emails.email"] = { $eq: options.email };
    }

    const response = await wixFetch(instanceId, "/contacts/v4/contacts/query", {
      method: "POST",
      body: JSON.stringify({
        query: {
          filter,
          paging: { limit: options.limit || 50 },
        },
      }),
    });
    const result = await response.json();
    return result.contacts || [];
  } catch (error) {
    logger.error("Failed to query Wix contacts:", error);
    throw error;
  }
}

/**
 * Export the createWixClient function (used by sync-engine for form queries).
 * Returns a simplified client object.
 */
export function createWixClient(instanceId: string) {
  return {
    contacts: {
      queryContacts: () => ({
        limit: (n: number) => ({
          find: async () => {
            const contacts = await queryWixContacts(instanceId, { limit: n });
            return { items: contacts };
          },
        }),
      }),
    },
  };
}
