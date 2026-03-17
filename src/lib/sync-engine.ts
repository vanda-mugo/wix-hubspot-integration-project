import { v4 as uuidv4 } from "uuid";
import prisma from "./db";
import logger from "./logger";
import {
  getFieldMappings,
  mapWixToHubSpot,
  mapHubSpotToWix,
  extractWixContactFields,
  buildWixContactPayload,
} from "./field-mapper";
import {
  isDuplicateEvent,
  markEventProcessed,
  isEchoEvent,
  isIdempotentWrite,
} from "./loop-prevention";
import {
  createHubSpotContact,
  updateHubSpotContact,
  getHubSpotContact,
  findHubSpotContactByEmail,
  ensureUtmProperties,
} from "./hubspot-client";
import {
  createWixContact,
  updateWixContact,
  getWixContact,
} from "./wix-client";
import type { SyncResult, HubSpotContactProperties } from "@/types";
import { ConflictStrategy, SyncSource, SyncStatus } from "@/generated/prisma";

// ─── Wix → HubSpot Sync ─────────────────────────────────

/**
 * Sync a Wix contact to HubSpot.
 * Called when a contact.created or contact.updated webhook arrives from Wix.
 */
export async function syncWixToHubSpot(
  installationId: string,
  wixInstanceId: string,
  wixContactId: string,
  eventId: string,
  eventType: string,
): Promise<SyncResult> {
  const correlationId = uuidv4();

  try {
    // Step 1: Dedupe check
    if (await isDuplicateEvent(installationId, eventId)) {
      logger.info(`Dedupe: Skipping already-processed event ${eventId}`);
      return { success: true, wixContactId };
    }

    // Step 2: Loop prevention — skip if this was our own echo
    if (await isEchoEvent(installationId, wixContactId, SyncSource.WIX)) {
      await markEventProcessed(installationId, eventId);
      return { success: true, wixContactId };
    }

    // Step 3: Fetch the Wix contact
    const wixContact = await getWixContact(wixInstanceId, wixContactId);
    if (!wixContact?.contact) {
      throw new Error(`Wix contact ${wixContactId} not found`);
    }

    // Step 4: Extract fields and apply mappings
    const wixFields = extractWixContactFields(
      wixContact.contact as unknown as Record<string, unknown>,
    );
    console.log(`[SYNC] Extracted Wix fields:`, JSON.stringify(wixFields));

    const mappings = await getFieldMappings(installationId);
    console.log(`[SYNC] Field mappings count: ${mappings.length}`);

    const hubspotProps = mapWixToHubSpot(
      wixFields,
      mappings,
    ) as HubSpotContactProperties;
    console.log(`[SYNC] Mapped HubSpot props:`, JSON.stringify(hubspotProps));

    if (Object.keys(hubspotProps).length === 0) {
      logger.info("No mapped fields to sync for this contact");
      await markEventProcessed(installationId, eventId);
      return { success: true, wixContactId };
    }

    // Add sync source marker for loop prevention
    hubspotProps.wix_sync_source = correlationId;

    // Step 5: Check for existing mapping
    const existingMapping = await prisma.contactMapping.findUnique({
      where: { installationId_wixContactId: { installationId, wixContactId } },
    });

    let hubspotContactId: string;

    if (existingMapping) {
      // Step 6a: Update existing HubSpot contact
      // Idempotency check
      try {
        const currentHsContact = await getHubSpotContact(
          installationId,
          existingMapping.hubspotContactId,
        );
        const currentProps = currentHsContact.properties as Record<
          string,
          string
        >;
        if (isIdempotentWrite(currentProps, hubspotProps)) {
          logger.info(
            "Idempotent: HubSpot contact already has these values, skipping",
          );
          await markEventProcessed(installationId, eventId);
          return {
            success: true,
            wixContactId,
            hubspotContactId: existingMapping.hubspotContactId,
          };
        }
      } catch {
        // If we can't fetch current values, proceed with the update anyway
      }

      await updateHubSpotContact(
        installationId,
        existingMapping.hubspotContactId,
        hubspotProps,
      );
      hubspotContactId = existingMapping.hubspotContactId;
    } else {
      // Step 6b: Try to find by email first, else create new
      const email = hubspotProps.email || wixFields.email;
      let existingContact = null;

      if (email) {
        existingContact = await findHubSpotContactByEmail(
          installationId,
          email,
        );
      }

      if (existingContact) {
        await updateHubSpotContact(
          installationId,
          existingContact.id,
          hubspotProps,
        );
        hubspotContactId = existingContact.id;
      } else {
        const newContact = await createHubSpotContact(
          installationId,
          hubspotProps,
        );
        hubspotContactId = newContact.id;
      }
    }

    // Step 7: Update/create contact mapping
    await prisma.contactMapping.upsert({
      where: { installationId_wixContactId: { installationId, wixContactId } },
      create: {
        installationId,
        wixContactId,
        hubspotContactId,
        lastSyncSource: SyncSource.WIX,
        syncCorrelationId: correlationId,
      },
      update: {
        hubspotContactId,
        lastSyncedAt: new Date(),
        lastSyncSource: SyncSource.WIX,
        syncCorrelationId: correlationId,
      },
    });

    // Step 8: Log sync event
    await prisma.syncEvent.create({
      data: {
        installationId,
        eventType,
        source: SyncSource.WIX,
        correlationId,
        status: SyncStatus.SUCCESS,
        wixContactId,
        hubspotContactId,
      },
    });

    // Step 9: Mark event as processed
    await markEventProcessed(installationId, eventId);

    logger.info(
      `Synced Wix contact ${wixContactId} → HubSpot ${hubspotContactId}`,
    );
    return { success: true, wixContactId, hubspotContactId };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    logger.error(`Sync Wix→HubSpot failed for ${wixContactId}:`, errorMessage);

    // Log failed sync event
    await prisma.syncEvent.create({
      data: {
        installationId,
        eventType,
        source: SyncSource.WIX,
        correlationId,
        status: SyncStatus.FAILED,
        wixContactId,
        error: errorMessage,
      },
    });

    return { success: false, wixContactId, error: errorMessage };
  }
}

// ─── HubSpot → Wix Sync ─────────────────────────────────

/**
 * Sync a HubSpot contact to Wix.
 * Called when a contact.creation or contact.propertyChange webhook arrives from HubSpot.
 */
export async function syncHubSpotToWix(
  installationId: string,
  wixInstanceId: string,
  hubspotContactId: string,
  eventId: string,
  eventType: string,
): Promise<SyncResult> {
  const correlationId = uuidv4();

  try {
    // Step 1: Dedupe check
    if (await isDuplicateEvent(installationId, eventId)) {
      logger.info(`Dedupe: Skipping already-processed event ${eventId}`);
      return { success: true, hubspotContactId };
    }

    // Step 2: Loop prevention
    if (
      await isEchoEvent(installationId, hubspotContactId, SyncSource.HUBSPOT)
    ) {
      await markEventProcessed(installationId, eventId);
      return { success: true, hubspotContactId };
    }

    // Step 3: Fetch the HubSpot contact with all properties
    const hsContact = await getHubSpotContact(installationId, hubspotContactId);
    const hsProps = hsContact.properties as Record<string, string>;

    // Check if this was our own write (by sync source marker)
    if (hsProps.wix_sync_source && hsProps.wix_sync_source.length > 0) {
      // Check if we generated this sync source recently
      const recentSync = await prisma.syncEvent.findFirst({
        where: {
          installationId,
          correlationId: hsProps.wix_sync_source,
          source: SyncSource.WIX,
          createdAt: { gte: new Date(Date.now() - 60_000) },
        },
      });
      if (recentSync) {
        logger.info(
          "Loop prevention: wix_sync_source matches recent WIX write, skipping",
        );
        await markEventProcessed(installationId, eventId);
        return { success: true, hubspotContactId };
      }
    }

    // Step 4: Apply field mappings
    const mappings = await getFieldMappings(installationId);
    const wixFields = mapHubSpotToWix(hsProps, mappings);

    if (Object.keys(wixFields).length === 0) {
      logger.info("No mapped fields to sync for this contact");
      await markEventProcessed(installationId, eventId);
      return { success: true, hubspotContactId };
    }

    // Step 5: Check for existing mapping
    const existingMapping = await prisma.contactMapping.findUnique({
      where: {
        installationId_hubspotContactId: { installationId, hubspotContactId },
      },
    });

    let wixContactId: string;

    // Step 6: Conflict resolution (if updating an existing contact)
    if (existingMapping) {
      const installation = await prisma.installation.findUnique({
        where: { id: installationId },
      });
      const strategy =
        installation?.conflictStrategy ?? ConflictStrategy.LAST_UPDATED_WINS;

      // For WIX_WINS, skip HubSpot → Wix updates (only allow creates)
      if (
        strategy === ConflictStrategy.WIX_WINS &&
        eventType === "contact.propertyChange"
      ) {
        logger.info(
          "Conflict resolution: Wix wins — skipping HubSpot → Wix update",
        );
        await markEventProcessed(installationId, eventId);
        return {
          success: true,
          hubspotContactId,
          wixContactId: existingMapping.wixContactId,
        };
      }

      // For LAST_UPDATED_WINS, compare timestamps
      if (strategy === ConflictStrategy.LAST_UPDATED_WINS) {
        const lastWixWrite = await prisma.syncEvent.findFirst({
          where: {
            installationId,
            wixContactId: existingMapping.wixContactId,
            source: SyncSource.WIX,
            status: SyncStatus.SUCCESS,
          },
          orderBy: { createdAt: "desc" },
        });

        // If Wix was updated more recently than this HubSpot event, skip
        if (
          lastWixWrite &&
          lastWixWrite.createdAt > new Date(Date.now() - 5000)
        ) {
          logger.info(
            "Conflict resolution: Last updated wins — Wix is more recent, skipping",
          );
          await markEventProcessed(installationId, eventId);
          return {
            success: true,
            hubspotContactId,
            wixContactId: existingMapping.wixContactId,
          };
        }
      }

      // HUBSPOT_WINS or LAST_UPDATED_WINS (HubSpot is newer): proceed with update
      const wixPayload = buildWixContactPayload(wixFields);
      await updateWixContact(
        wixInstanceId,
        existingMapping.wixContactId,
        wixPayload,
      );
      wixContactId = existingMapping.wixContactId;
    } else {
      // No existing mapping — create new Wix contact
      const wixPayload = buildWixContactPayload(wixFields);
      const newContact = await createWixContact(wixInstanceId, wixPayload);
      if (!newContact?.id) {
        throw new Error("Failed to create Wix contact — no ID returned");
      }
      wixContactId = newContact.id;
    }

    // Step 7: Update/create contact mapping
    await prisma.contactMapping.upsert({
      where: {
        installationId_hubspotContactId: { installationId, hubspotContactId },
      },
      create: {
        installationId,
        wixContactId,
        hubspotContactId,
        lastSyncSource: SyncSource.HUBSPOT,
        syncCorrelationId: correlationId,
      },
      update: {
        wixContactId,
        lastSyncedAt: new Date(),
        lastSyncSource: SyncSource.HUBSPOT,
        syncCorrelationId: correlationId,
      },
    });

    // Step 8: Log sync event
    await prisma.syncEvent.create({
      data: {
        installationId,
        eventType,
        source: SyncSource.HUBSPOT,
        correlationId,
        status: SyncStatus.SUCCESS,
        wixContactId,
        hubspotContactId,
      },
    });

    // Step 9: Mark event as processed
    await markEventProcessed(installationId, eventId);

    logger.info(
      `Synced HubSpot contact ${hubspotContactId} → Wix ${wixContactId}`,
    );
    return { success: true, wixContactId, hubspotContactId };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    logger.error(
      `Sync HubSpot→Wix failed for ${hubspotContactId}:`,
      errorMessage,
    );

    await prisma.syncEvent.create({
      data: {
        installationId,
        eventType,
        source: SyncSource.HUBSPOT,
        correlationId,
        status: SyncStatus.FAILED,
        hubspotContactId,
        error: errorMessage,
      },
    });

    return { success: false, hubspotContactId, error: errorMessage };
  }
}

// ─── Form Submission → HubSpot ───────────────────────────

/**
 * Push a Wix form submission to HubSpot as a contact with UTM attribution.
 */
export async function syncFormToHubSpot(
  installationId: string,
  wixInstanceId: string,
  submission: {
    fields: Record<string, string>;
    pageUrl?: string;
    referrer?: string;
    utmParams?: Record<string, string>;
    submittedAt?: string;
  },
  eventId: string,
): Promise<SyncResult> {
  const correlationId = uuidv4();

  try {
    // Dedupe
    if (await isDuplicateEvent(installationId, eventId)) {
      return { success: true };
    }

    // Ensure UTM properties exist in HubSpot
    await ensureUtmProperties(installationId);

    // Build HubSpot properties from form fields
    const properties: HubSpotContactProperties = {};

    // Map standard form fields
    const fieldMap: Record<string, string> = {
      email: "email",
      first_name: "firstname",
      firstName: "firstname",
      "first name": "firstname",
      last_name: "lastname",
      lastName: "lastname",
      "last name": "lastname",
      phone: "phone",
      company: "company",
    };

    for (const [formField, value] of Object.entries(submission.fields)) {
      const hsProperty =
        fieldMap[formField.toLowerCase()] || fieldMap[formField];
      if (hsProperty) {
        properties[hsProperty] = value;
      }
    }

    // Add UTM attribution
    if (submission.utmParams) {
      if (submission.utmParams.utm_source)
        properties.wix_utm_source = submission.utmParams.utm_source;
      if (submission.utmParams.utm_medium)
        properties.wix_utm_medium = submission.utmParams.utm_medium;
      if (submission.utmParams.utm_campaign)
        properties.wix_utm_campaign = submission.utmParams.utm_campaign;
      if (submission.utmParams.utm_term)
        properties.wix_utm_term = submission.utmParams.utm_term;
      if (submission.utmParams.utm_content)
        properties.wix_utm_content = submission.utmParams.utm_content;
    }

    // Add page context
    if (submission.pageUrl) properties.wix_form_page_url = submission.pageUrl;
    if (submission.referrer) properties.wix_form_referrer = submission.referrer;

    // Add sync source marker
    properties.wix_sync_source = correlationId;

    if (!properties.email) {
      logger.warn(
        "Form submission has no email — cannot create HubSpot contact",
      );
      await markEventProcessed(installationId, eventId);
      return { success: false, error: "No email in form submission" };
    }

    // Upsert in HubSpot (find by email or create)
    let hubspotContactId: string;
    const existing = await findHubSpotContactByEmail(
      installationId,
      properties.email,
    );

    if (existing) {
      await updateHubSpotContact(installationId, existing.id, properties);
      hubspotContactId = existing.id;
    } else {
      const newContact = await createHubSpotContact(installationId, properties);
      hubspotContactId = newContact.id;
    }

    // Also sync to Wix contact if not already mapped
    // (The form submission already created a Wix contact, but we need the mapping)
    if (properties.email) {
      // Try to find the Wix contact by searching (best effort)
      try {
        const { createWixClient } = await import("./wix-client");
        const wixClient = createWixClient(wixInstanceId);
        const wixContacts = await wixClient.contacts
          .queryContacts()
          .limit(1)
          .find();

        const wixContact = wixContacts.items?.find((c) => {
          const emails = (c as unknown as Record<string, unknown>).emails as
            | { items?: Array<{ email?: string }> }
            | undefined;
          return emails?.items?.some(
            (e) => e.email?.toLowerCase() === properties.email?.toLowerCase(),
          );
        });

        if (wixContact?.id) {
          await prisma.contactMapping.upsert({
            where: {
              installationId_hubspotContactId: {
                installationId,
                hubspotContactId,
              },
            },
            create: {
              installationId,
              wixContactId: String(wixContact.id),
              hubspotContactId,
              lastSyncSource: SyncSource.WIX,
              syncCorrelationId: correlationId,
            },
            update: {
              lastSyncedAt: new Date(),
              lastSyncSource: SyncSource.WIX,
              syncCorrelationId: correlationId,
            },
          });
        }
      } catch {
        // Best effort — form submission still succeeded
        logger.warn(
          "Could not find Wix contact for mapping after form submission",
        );
      }
    }

    // Log sync event
    await prisma.syncEvent.create({
      data: {
        installationId,
        eventType: "form.submitted",
        source: SyncSource.WIX,
        correlationId,
        status: SyncStatus.SUCCESS,
        hubspotContactId,
        payload: {
          formFields: Object.keys(submission.fields),
          hasUtm: !!submission.utmParams,
          pageUrl: submission.pageUrl,
        },
      },
    });

    await markEventProcessed(installationId, eventId);

    logger.info(
      `Form submission synced to HubSpot contact ${hubspotContactId}`,
    );
    return { success: true, hubspotContactId };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    logger.error("Form→HubSpot sync failed:", errorMessage);

    await prisma.syncEvent.create({
      data: {
        installationId,
        eventType: "form.submitted",
        source: SyncSource.WIX,
        correlationId,
        status: SyncStatus.FAILED,
        error: errorMessage,
      },
    });

    return { success: false, error: errorMessage };
  }
}
