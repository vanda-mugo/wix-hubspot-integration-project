import prisma from "./db";
import logger from "./logger";
import { SyncSource } from "@/types";

const DEDUPE_WINDOW_MS = 60_000; // 60 seconds

/**
 * Check if a webhook event has already been processed (by eventId).
 * Returns true if it's a duplicate that should be skipped.
 */
export async function isDuplicateEvent(
  installationId: string,
  eventId: string,
): Promise<boolean> {
  const existing = await prisma.processedEvent.findUnique({
    where: {
      installationId_eventId: { installationId, eventId },
    },
  });
  return !!existing;
}

/**
 * Mark an event as processed.
 */
export async function markEventProcessed(
  installationId: string,
  eventId: string,
): Promise<void> {
  await prisma.processedEvent.upsert({
    where: {
      installationId_eventId: { installationId, eventId },
    },
    create: { installationId, eventId },
    update: { processedAt: new Date() },
  });
}

/**
 * Check if a contact was recently written by our sync system from the opposite source.
 * This detects echo webhooks that would cause infinite loops.
 *
 * Example: We write a contact to HubSpot (source=WIX). HubSpot fires a webhook.
 * When that webhook arrives, we check: "Was this HubSpot contact recently synced
 * from WIX?" → Yes → Skip (it's our own echo).
 *
 * @param installationId - The installation to check
 * @param contactId - Either wixContactId or hubspotContactId
 * @param incomingSource - The source of the incoming event (WIX or HUBSPOT)
 * @returns true if this is an echo that should be skipped
 */
export async function isEchoEvent(
  installationId: string,
  contactId: string,
  incomingSource: SyncSource,
): Promise<boolean> {
  const windowStart = new Date(Date.now() - DEDUPE_WINDOW_MS);

  // If incoming from HubSpot, check if WE recently wrote to HubSpot for this contact
  // If incoming from Wix, check if WE recently wrote to Wix for this contact
  const oppositeSource = incomingSource === "WIX" ? "HUBSPOT" : "WIX";

  // We check by looking for a successful sync event that wrote TO the incoming source
  // within the dedupe window
  const recentWrite = await prisma.syncEvent.findFirst({
    where: {
      installationId,
      source: oppositeSource as SyncSource,
      status: "SUCCESS",
      createdAt: { gte: windowStart },
      // Match by the contact ID on the incoming source's side
      ...(incomingSource === "HUBSPOT"
        ? { hubspotContactId: contactId }
        : { wixContactId: contactId }),
    },
    orderBy: { createdAt: "desc" },
  });

  if (recentWrite) {
    logger.info(
      `Loop prevention: Skipping echo event for contact ${contactId}. ` +
        `Recent ${oppositeSource} sync at ${recentWrite.createdAt.toISOString()}`,
    );
    return true;
  }

  return false;
}

/**
 * Check if the values we would write are identical to what's already there.
 * If all values match, skip the write (idempotent).
 *
 * @returns true if all proposed values match current values (should skip)
 */
export function isIdempotentWrite(
  currentValues: Record<string, string | undefined>,
  proposedValues: Record<string, string | undefined>,
): boolean {
  for (const [key, value] of Object.entries(proposedValues)) {
    if (value !== undefined && currentValues[key] !== value) {
      return false; // At least one value differs → must write
    }
  }
  return true; // All values match → skip
}

/**
 * Clean up old processed events (older than 7 days).
 * Should be called periodically to prevent table bloat.
 */
export async function cleanupOldEvents(
  installationId: string,
): Promise<number> {
  const cutoff = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);

  const result = await prisma.processedEvent.deleteMany({
    where: {
      installationId,
      processedAt: { lt: cutoff },
    },
  });

  if (result.count > 0) {
    logger.info(`Cleaned up ${result.count} old processed events`);
  }

  return result.count;
}
