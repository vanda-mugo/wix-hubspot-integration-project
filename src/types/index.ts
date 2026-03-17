import {
  SyncDirection,
  SyncSource,
  ConflictStrategy,
  SyncStatus,
} from "@/generated/prisma";

// Re-export Prisma enums for convenience
export { SyncDirection, SyncSource, ConflictStrategy, SyncStatus };

// ─── Wix Types ────────────────────────────────────────────

export interface WixContactInfo {
  id?: string;
  firstName?: string;
  lastName?: string;
  emails?: string[];
  phones?: string[];
  company?: string;
  jobTitle?: string;
  birthdate?: string;
  addresses?: Array<{
    street?: string;
    city?: string;
    subdivision?: string;
    country?: string;
    postalCode?: string;
  }>;
  customFields?: Record<string, string>;
}

export interface WixWebhookPayload {
  data?: {
    eventType?: string;
    instanceId?: string;
    data?: string; // JSON string of the actual event data
  };
  eventType?: string;
  instanceId?: string;
}

export interface WixFormSubmission {
  formId?: string;
  submissionId?: string;
  submissions?: Record<string, string>;
  pageUrl?: string;
  createdDate?: string;
}

// ─── HubSpot Types ────────────────────────────────────────

export interface HubSpotContactProperties {
  email?: string;
  firstname?: string;
  lastname?: string;
  phone?: string;
  company?: string;
  jobtitle?: string;
  address?: string;
  city?: string;
  state?: string;
  country?: string;
  zip?: string;
  website?: string;
  // UTM / attribution properties (custom)
  wix_utm_source?: string;
  wix_utm_medium?: string;
  wix_utm_campaign?: string;
  wix_utm_term?: string;
  wix_utm_content?: string;
  wix_form_page_url?: string;
  wix_form_referrer?: string;
  wix_sync_source?: string;
  [key: string]: string | undefined;
}

export interface HubSpotWebhookEvent {
  objectId: number;
  propertyName?: string;
  propertyValue?: string;
  changeSource: string;
  eventId: number;
  subscriptionId: number;
  portalId: number;
  appId: number;
  occurredAt: number;
  subscriptionType: string;
  attemptNumber: number;
}

// ─── Field Mapping Types ──────────────────────────────────

export interface FieldMappingConfig {
  wixField: string;
  hubspotProperty: string;
  syncDirection: SyncDirection;
  transform?: string | null;
}

export interface MappedContactData {
  [key: string]: string | undefined;
}

// ─── Available Fields (for the mapping UI dropdowns) ──────

export interface AvailableField {
  value: string;
  label: string;
  type: string;
}

export const WIX_STANDARD_FIELDS: AvailableField[] = [
  { value: "firstName", label: "First Name", type: "string" },
  { value: "lastName", label: "Last Name", type: "string" },
  { value: "email", label: "Email", type: "string" },
  { value: "phone", label: "Phone", type: "string" },
  { value: "company", label: "Company", type: "string" },
  { value: "jobTitle", label: "Job Title", type: "string" },
  { value: "birthdate", label: "Birthdate", type: "date" },
  { value: "street", label: "Street Address", type: "string" },
  { value: "city", label: "City", type: "string" },
  { value: "state", label: "State/Province", type: "string" },
  { value: "country", label: "Country", type: "string" },
  { value: "postalCode", label: "Postal Code", type: "string" },
];

export const HUBSPOT_STANDARD_PROPERTIES: AvailableField[] = [
  { value: "email", label: "Email", type: "string" },
  { value: "firstname", label: "First Name", type: "string" },
  { value: "lastname", label: "Last Name", type: "string" },
  { value: "phone", label: "Phone Number", type: "string" },
  { value: "company", label: "Company Name", type: "string" },
  { value: "jobtitle", label: "Job Title", type: "string" },
  { value: "date_of_birth", label: "Date of Birth", type: "date" },
  { value: "address", label: "Street Address", type: "string" },
  { value: "city", label: "City", type: "string" },
  { value: "state", label: "State/Region", type: "string" },
  { value: "country", label: "Country/Region", type: "string" },
  { value: "zip", label: "Postal Code", type: "string" },
  { value: "website", label: "Website URL", type: "string" },
  { value: "lifecyclestage", label: "Lifecycle Stage", type: "string" },
  { value: "hs_lead_status", label: "Lead Status", type: "string" },
];

// ─── Sync Types ───────────────────────────────────────────

export interface SyncResult {
  success: boolean;
  contactMappingId?: string;
  wixContactId?: string;
  hubspotContactId?: string;
  error?: string;
}

// ─── API Response Types ───────────────────────────────────

export interface ApiResponse<T = unknown> {
  success: boolean;
  data?: T;
  error?: string;
}

export interface ConnectionStatus {
  connected: boolean;
  portalId?: string;
  connectedAt?: string;
}

export interface SyncStatusData {
  totalMappings: number;
  recentEvents: Array<{
    id: string;
    eventType: string;
    source: SyncSource;
    status: SyncStatus;
    createdAt: string;
    error?: string | null;
  }>;
  lastSyncAt?: string;
}
