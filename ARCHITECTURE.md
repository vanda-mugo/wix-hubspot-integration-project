# Wix ↔ HubSpot Integration — Architecture & Design Document

> **Version:** 1.0  
> **Date:** March 12, 2026  
> **Status:** Design Phase

---

## Table of Contents

1. [Executive Summary](#1-executive-summary)
2. [System Overview](#2-system-overview)
3. [Architecture Diagram](#3-architecture-diagram)
4. [Technology Stack](#4-technology-stack)
5. [Component Breakdown](#5-component-breakdown)
   - 5.1 [Wix App (Platform Layer)](#51-wix-app-platform-layer)
   - 5.2 [React Frontend (Dashboard UI)](#52-react-frontend-dashboard-ui)
   - 5.3 [Node.js Backend (API & Sync Engine)](#53-nodejs-backend-api--sync-engine)
   - 5.4 [PostgreSQL Database](#54-postgresql-database)
6. [Data Flow Diagrams](#6-data-flow-diagrams)
   - 6.1 [HubSpot OAuth Connection Flow](#61-hubspot-oauth-connection-flow)
   - 6.2 [Wix → HubSpot Contact Sync](#62-wix--hubspot-contact-sync)
   - 6.3 [HubSpot → Wix Contact Sync](#63-hubspot--wix-contact-sync)
   - 6.4 [Wix Form → HubSpot Lead Capture](#64-wix-form--hubspot-lead-capture)
7. [Database Schema](#7-database-schema)
8. [API Endpoints](#8-api-endpoints)
9. [Infinite Loop Prevention Strategy](#9-infinite-loop-prevention-strategy)
10. [Security Model](#10-security-model)
11. [External APIs Used](#11-external-apis-used)
12. [Project Structure](#12-project-structure)
13. [Deployment Architecture](#13-deployment-architecture)
14. [Glossary](#14-glossary)

---

## 1. Executive Summary

This application is a **self-hosted Wix app** that integrates Wix websites with HubSpot CRM. It enables Wix site owners to:

- **Connect** their HubSpot account securely via OAuth 2.0
- **Sync contacts bidirectionally** between Wix and HubSpot in real-time
- **Capture form submissions** from Wix forms and push them to HubSpot with full UTM/source attribution
- **Configure field mappings** between Wix contact fields and HubSpot properties through a visual dashboard

The app is built as a **Next.js application** (React frontend + Node.js API backend) that runs on its own server and integrates with Wix as an iframe-based dashboard extension. A PostgreSQL database stores all configuration, sync state, and contact mappings.

---

## 2. System Overview

The system connects **four main layers**:

```
┌─────────────────────────────────────────────────────────────────────┐
│                        WIX PLATFORM                                 │
│  ┌─────────────┐  ┌──────────────┐  ┌───────────────────────────┐   │
│  │ Wix Site    │  │ Wix Contacts │  │ Wix Forms                 │   │
│  │ (end users) │  │ (CRM data)   │  │ (submissions)             │   │
│  └──────┬──────┘  └──────┬───────┘  └─────────────┬─────────────┘   │
│         │                │                        │                 │
│         │    Webhooks (contact.created/updated,   │                 │
│         │     form_submission.created)            │                 │
│         └─────────────────┼───────────────────────┘                 │
│                           ▼                                         │
│  ┌─────────────────────────────────────────────┐                    │
│  │  Wix Dashboard (iframe)                     │                    │
│  │  └── Our React App rendered here            │                    │
│  └─────────────────────────────────────────────┘                    │
└──────────────────────────────┬──────────────────────────────────────┘
                               │
                    HTTPS (iframe + API calls)
                               │
┌──────────────────────────────▼──────────────────────────────────────┐
│                    OUR APPLICATION (Self-Hosted)                    │
│                                                                     │
│  ┌──────────────────────┐    ┌──────────────────────────────────┐   │
│  │   React Frontend     │    │   Node.js Backend (Next.js API)  │   │
│  │   (Dashboard UI)     │◄──►│                                  │   │
│  │                      │    │   • Webhook receivers            │   │
│  │  • Connection panel  │    │   • OAuth handler                │   │
│  │  • Field mapping UI  │    │   • Sync engine                  │   │
│  │  • Sync status       │    │   • Field mapper                 │   │
│  │  • Conflict settings │    │   • Loop prevention              │   │
│  └──────────────────────┘    └───────────────┬──────────────────┘   │
│                                              │                      │
│                              ┌───────────────▼──────────────────┐   │
│                              │   PostgreSQL Database            │   │
│                              │                                  │   │
│                              │   • Installations & tokens       │   │
│                              │   • Contact ID mappings          │   │
│                              │   • Field mapping configs        │   │
│                              │   • Sync event logs              │   │
│                              └──────────────────────────────────┘   │
└──────────────────────────────┬──────────────────────────────────────┘
                               │
                    HTTPS (API calls + Webhooks)
                               │
┌──────────────────────────────▼───────────────────────────────────────┐
│                       HUBSPOT PLATFORM                               │
│  ┌──────────────┐  ┌──────────────┐  ┌─────────────────────────┐     │
│  │ HubSpot CRM  │  │ HubSpot      │  │ HubSpot Webhooks        │     │
│  │ Contacts API │  │ Properties   │  │ (contact.creation,      │     │
│  │ (CRUD)       │  │ API          │  │  contact.propertyChange)│     │
│  └──────────────┘  └──────────────┘  └─────────────────────────┘     │
└──────────────────────────────────────────────────────────────────────┘
```

**How they connect:**

| Connection | Mechanism | Purpose |
|---|---|---|
| Wix Dashboard → Our Frontend | **iframe** | Wix embeds our React app inside its dashboard |
| Our Frontend → Our Backend | **REST API** (fetch calls) | Dashboard UI reads/writes config, triggers actions |
| Wix → Our Backend | **Webhooks** (JWT-signed POST) | Real-time notifications of contact/form changes |
| HubSpot → Our Backend | **Webhooks** (HMAC-signed POST) | Real-time notifications of HubSpot contact changes |
| Our Backend → Wix | **Wix SDK** (`@wix/contacts`) | Create/update Wix contacts programmatically |
| Our Backend → HubSpot | **HubSpot REST API** (Bearer token) | Create/update HubSpot contacts programmatically |
| Our Backend → Database | **Prisma ORM** | Persist all state, mappings, tokens, and logs |

---

## 3. Architecture Diagram

```
                    ┌──────────────────────────────┐
                    │       Wix Site Owner         │
                    │    (uses Wix Dashboard)      │
                    └──────────────┬───────────────┘
                                   │ Opens dashboard
                                   ▼
┌───────────────────────────────────────────────────────────────┐
│                     WIX DASHBOARD                             │
│                                                               │
│   ┌─────────────────────────────────────────────────────┐     │
│   │              iframe (our app URL)                   │     │
│   │                                                     │     │
│   │   ┌─────────────────────────────────────────────┐   │     │
│   │   │         REACT FRONTEND (TypeScript)         │   │     │
│   │   │                                             │   │     │
│   │   │  ┌──────────┐ ┌──────────┐ ┌─────────────┐  │   │     │
│   │   │  │ Connect  │ │  Field   │ │   Sync      │  │   │     │
│   │   │  │ HubSpot  │ │ Mapping  │ │  Status &   │  │   │     │
│   │   │  │ Panel    │ │  Table   │ │  Settings   │  │   │     │
│   │   │  └────┬─────┘ └────┬─────┘ └──────┬──────┘  │   │     │
│   │   │       │            │              │         │   │     │
│   │   └───────┼────────────┼──────────────┼─────────┘   │     │
│   └───────────┼────────────┼──────────────┼─────────────┘     │
└───────────────┼────────────┼──────────────┼───────────────────┘
                │            │              │
                ▼            ▼              ▼
        ┌──────────────────────────────────────────┐
        │        NEXT.JS API ROUTES (Node.js)      │
        │                                          │
        │  /api/auth/hubspot      → OAuth flow     │
        │  /api/auth/hubspot/cb   → OAuth callback │
        │  /api/mappings          → CRUD mappings  │
        │  /api/sync/status       → sync overview  │
        │  /api/settings          → conflict cfg   │
        │  /api/webhooks/wix      → Wix events     │
        │  /api/webhooks/hubspot  → HS events      │
        │                                          │
        │  ┌──────────────────────────────────┐    │
        │  │         SYNC ENGINE              │    │
        │  │                                  │    │
        │  │  • Field Mapper (applies rules)  │    │
        │  │  • Loop Preventer (dedupe)       │    │
        │  │  • Conflict Resolver             │    │
        │  │  • Wix Client (SDK)              │    │
        │  │  • HubSpot Client (REST)         │    │
        │  └──────────────┬───────────────────┘    │
        └─────────────────┼────────────────────────┘
                          │
                          ▼
        ┌──────────────────────────────────────────┐
        │         POSTGRESQL DATABASE              │
        │         (Supabase / hosted)              │
        │                                          │
        │  installations    — per-site app state   │
        │  contact_mappings — WixID ↔ HubSpotID    │
        │  field_mappings   — user-configured maps │
        │  sync_events      — audit log            │
        │  processed_events — dedupe registry      │
        └──────────────────────────────────────────┘
```

---

## 4. Technology Stack

### Frontend
| Technology | Purpose |
|---|---|
| **React 18+** | UI framework for dashboard pages |
| **TypeScript** | Type safety across the entire frontend |
| **@wix/design-system** | Wix-native React component library (Button, Table, Dropdown, Page, Card, Modal, etc.) |
| **@wix/dashboard** | SDK for communicating with the Wix dashboard host (auth, navigation, state) |
| **React Query / SWR** | Data fetching and caching for API calls |
| **CSS Modules** | Scoped styling |

### Backend
| Technology | Purpose |
|---|---|
| **Next.js 14+ (App Router)** | Full-stack framework — serves React frontend + API routes |
| **Node.js 20+** | Runtime for the backend |
| **TypeScript** | Type safety across the entire backend |
| **@wix/sdk** | Wix SDK for server-side API calls and webhook processing |
| **@wix/contacts** | Wix Contacts API module |
| **@wix/forms** | Wix Forms/Submissions API module |
| **@hubspot/api-client** | Official HubSpot Node.js client |
| **Prisma** | Type-safe ORM for PostgreSQL |
| **jose** | JWT verification for Wix webhook payloads |
| **crypto (Node.js built-in)** | AES-256-GCM encryption for tokens at rest |

### Database
| Technology | Purpose |
|---|---|
| **PostgreSQL** | Relational database for all persistent state |
| **Supabase** (hosting) | Free-tier managed PostgreSQL with dashboard for inspection |
| **Prisma Migrate** | Schema migrations and version control |

### Infrastructure
| Technology | Purpose |
|---|---|
| **Vercel** | Deployment platform (auto HTTPS, serverless functions, CDN) |
| **ngrok** | Local HTTPS tunneling for development |
| **Git / GitHub** | Version control and collaboration |

---

## 5. Component Breakdown

### 5.1 Wix App (Platform Layer)

**What it is:** A registered app in the [Wix Custom Apps dashboard](https://manage.wix.com/account/custom-apps) configured as a **self-hosted** app.

**What it does:**
- Gives us an **App ID** and **App Secret** for authenticating with Wix APIs
- Provides a **Public Key** for verifying incoming webhook signatures
- Hosts a **Dashboard Page** extension that renders our React app as an iframe inside the Wix site dashboard
- Delivers **Webhooks** to our server whenever contacts are created/updated or forms are submitted

**Configuration in Wix:**

| Setting | Value |
|---|---|
| App type | Self-Hosted |
| Dashboard Page URL | `https://our-domain.vercel.app/dashboard` |
| Webhook Callback URL | `https://our-domain.vercel.app/api/webhooks/wix` |
| Webhook events subscribed | `contact.created`, `contact.updated`, `form_submission.created`, `app.installed` |
| Required permissions | Manage Contacts, Read Form Submissions |

**How it integrates:**
```
Wix site owner installs our app
        │
        ├── Wix sends `app.installed` webhook → we store the instanceId
        │
        ├── Dashboard sidebar shows our app → loads iframe with our React UI
        │
        ├── Contact created/updated on Wix → webhook fires → hits our /api/webhooks/wix
        │
        └── Form submitted on Wix → webhook fires → hits our /api/webhooks/wix
```

**Key credentials we receive:**
- `APP_ID` — identifies our app
- `APP_SECRET` — used to obtain access tokens for Wix API calls
- `PUBLIC_KEY` — used to verify webhook JWT signatures
- `instanceId` — unique per Wix site that installs our app (received at install time)

---

### 5.2 React Frontend (Dashboard UI)

**What it is:** A React + TypeScript single-page application rendered inside an iframe in the Wix site dashboard.

**What it does:** Provides the site owner with a visual interface to:
1. Connect/disconnect their HubSpot account
2. Configure field mappings between Wix and HubSpot
3. Choose a conflict resolution strategy
4. View sync status and recent activity

**Pages/Tabs:**

#### Tab 1: Connection
```
┌─────────────────────────────────────────────────────────┐
│  HubSpot Connection                                     │
│                                                         │
│  Status: ● Connected                                    │
│  Portal: Acme Corp (ID: 12345678)                       │
│  Connected: March 10, 2026                              │
│                                                         │
│  [Disconnect HubSpot]                                   │
│                                                         │
│  ── OR (if not connected) ──                            │
│                                                         │
│  Status: ○ Not Connected                                │
│                                                         │
│  [Connect HubSpot]  ← redirects to HubSpot OAuth        │
└─────────────────────────────────────────────────────────┘
```

#### Tab 2: Field Mapping
```
┌─────────────────────────────────────────────────────────────────────┐
│  Field Mapping                                                      │
│                                                                     │
│  ┌───────────────┬──────────────────┬────────────────┬────────────┐ │
│  │ Wix Field     │ HubSpot Property │ Direction      │ Transform  │ │
│  ├───────────────┼──────────────────┼────────────────┼────────────┤ │
│  │ ▼ First Name  │ ▼ firstname      │ ▼ Bi-direct.   │ trim       │ │
│  │ ▼ Last Name   │ ▼ lastname       │ ▼ Bi-direct.   │ trim       │ │
│  │ ▼ Email       │ ▼ email          │ ▼ Bi-direct.   │ lowercase  │ │
│  │ ▼ Phone       │ ▼ phone          │ ▼ Wix → HS     │            │ │
│  │ ▼ Company     │ ▼ company        │ ▼ HS → Wix     │            │ │
│  └───────────────┴──────────────────┴────────────────┴────────────┘ │
│                                                                     │
│  [+ Add Mapping]                                [Save Mappings]     │
│                                                                     │
│  ⚠  Validation: No duplicate HubSpot properties allowed             │
└─────────────────────────────────────────────────────────────────────┘
```

#### Tab 3: Sync Settings & Status
```
┌─────────────────────────────────────────────────────────┐
│  Sync Settings                                          │
│                                                         │
│  Conflict Resolution:                                   │
│  ○ Last updated wins (compare timestamps)               │
│  ○ HubSpot always wins                                  │
│  ○ Wix always wins                                      │
│                                           [Save]        │
│                                                         │
│  ─────────────────────────────────────────              │
│                                                         │
│  Sync Status                                            │
│  Last sync: 2 minutes ago                               │
│  Contacts synced: 1,247                                 │
│  Pending: 3                                             │
│                                                         │
│  Recent Activity:                                       │
│    John Doe synced Wix → HubSpot    (2 min ago)         │
│    Jane Smith synced HubSpot → Wix  (5 min ago)         │
│    Bob Wilson failed — rate limit    (8 min ago)        │
└─────────────────────────────────────────────────────────┘
```

**Technical details:**
- Components built with `@wix/design-system` for native Wix look
- Authenticates via `@wix/dashboard` SDK (`dashboard.auth()`) — no manual token handling
- All data operations go through our Next.js API routes (never calls Wix/HubSpot APIs directly from the browser)
- TypeScript interfaces ensure type safety between frontend and backend

---

### 5.3 Node.js Backend (API & Sync Engine)

**What it is:** Next.js API routes running as serverless functions (on Vercel) or as a Node.js server.

**What it does:** Handles all server-side logic:

#### A) API Routes (serve the frontend)

| Route | Method | Purpose |
|---|---|---|
| `/api/auth/hubspot` | `GET` | Initiate HubSpot OAuth — redirect user to HubSpot consent screen |
| `/api/auth/hubspot/callback` | `GET` | Handle OAuth callback — exchange code for tokens, store encrypted in DB |
| `/api/auth/hubspot/disconnect` | `POST` | Revoke tokens, remove from DB |
| `/api/auth/hubspot/status` | `GET` | Return connection status for the dashboard |
| `/api/mappings` | `GET` | Fetch saved field mappings for this installation |
| `/api/mappings` | `POST` | Save/update field mappings |
| `/api/mappings/fields` | `GET` | Fetch available Wix fields + HubSpot properties (for dropdowns) |
| `/api/settings` | `GET/PUT` | Read/update conflict resolution strategy |
| `/api/sync/status` | `GET` | Return sync statistics and recent activity |
| `/api/sync/trigger` | `POST` | Manually trigger a full sync |

#### B) Webhook Receivers (handle external events)

| Route | Method | Source | Events |
|---|---|---|---|
| `/api/webhooks/wix` | `POST` | Wix Platform | `contact.created`, `contact.updated`, `form_submission.created`, `app.installed` |
| `/api/webhooks/hubspot` | `POST` | HubSpot | `contact.creation`, `contact.propertyChange` |

#### C) Sync Engine (core business logic)

The sync engine is a set of internal modules (not API routes) that handle the actual synchronization:

```
Sync Engine Modules
│
├── sync-engine.ts          — Orchestrates the full sync flow
│   ├── Receives event (webhook) or manual trigger
│   ├── Determines direction (Wix→HS or HS→Wix)
│   ├── Calls field-mapper to transform data
│   ├── Calls loop-preventer to check for echoes
│   ├── Calls conflict-resolver if needed
│   └── Executes the write (create/update contact)
│
├── field-mapper.ts         — Applies field mapping rules
│   ├── Reads mapping config from DB
│   ├── Maps source fields → target fields
│   ├── Applies transforms (trim, lowercase, etc.)
│   └── Filters by sync direction
│
├── loop-prevention.ts      — Prevents infinite sync loops
│   ├── Origin tagging (marks writes with correlation ID)
│   ├── Dedupe window (ignores echoes within 60s)
│   ├── Idempotency check (skips if values unchanged)
│   └── Processed event registry (skips duplicate webhooks)
│
├── conflict-resolver.ts    — Resolves bidirectional conflicts
│   ├── Reads strategy from installation settings
│   ├── Compares timestamps (last-updated-wins)
│   └── Applies priority (HubSpot-wins / Wix-wins)
│
├── wix-client.ts           — Wix API wrapper
│   ├── Creates SDK client with AppStrategy
│   ├── Token lifecycle managed by SDK
│   └── Methods: createContact, updateContact, getContact, queryContacts
│
└── hubspot-client.ts       — HubSpot API wrapper
    ├── Manages OAuth tokens (refresh before expiry)
    ├── Encrypts/decrypts tokens from DB
    └── Methods: createContact, updateContact, getContact, upsertContact
```

**Sync flow example (Wix → HubSpot):**

```
1. Wix webhook arrives at /api/webhooks/wix
2. Verify JWT signature using Wix Public Key
3. Parse event → extract contactId, changed fields
4. Check ProcessedEvent table → skip if already handled (dedupe)
5. Check SyncEvent table → skip if this was caused by our own HS→Wix write (loop prevention)
6. Look up ContactMapping → find matching HubSpot contact (or mark as "new")
7. Load FieldMapping config → filter to WIX_TO_HS and BIDIRECTIONAL mappings
8. Apply field transforms (trim, lowercase, etc.)
9. Compare transformed values against last-known values → skip if identical (idempotency)
10. Call HubSpot API to create/update contact
11. Store/update ContactMapping with syncCorrelationId and timestamp
12. Log to SyncEvent table
13. Record in ProcessedEvent table
14. Return 200 to Wix
```

---

### 5.4 PostgreSQL Database

**What it is:** A PostgreSQL database (hosted on Supabase free tier) accessed via Prisma ORM.

**What it stores:**

| Table | Purpose | Key Fields |
|---|---|---|
| `Installation` | One row per Wix site that installs our app | `wixInstanceId`, `hubspotPortalId`, encrypted tokens, `conflictStrategy` |
| `ContactMapping` | Links a Wix contact to its HubSpot counterpart | `wixContactId`, `hubspotContactId`, `lastSyncSource`, `syncCorrelationId` |
| `FieldMapping` | User-configured field mapping rules | `wixField`, `hubspotProperty`, `syncDirection`, `transform` |
| `SyncEvent` | Audit log of every sync operation | `eventType`, `source`, `correlationId`, `status`, `payload`, `error` |
| `ProcessedEvent` | Registry of processed webhook event IDs | `eventId` (unique), `processedAt` |

**Why PostgreSQL (not SQLite/MongoDB):**
- **Concurrent writes** — webhook handlers run in parallel; PostgreSQL handles this safely
- **Relational integrity** — foreign keys between installations, mappings, and events
- **ACID transactions** — critical for the dedupe/loop-prevention logic
- **Free hosted option** — Supabase provides a managed instance with a web dashboard
- **Prisma support** — excellent TypeScript integration with auto-generated types

**Entity Relationship Diagram:**

```
┌──────────────────┐       ┌──────────────────────┐
│   Installation   │       │    FieldMapping      │
├──────────────────┤       ├──────────────────────┤
│ id (PK)          │──┐    │ id (PK)              │
│ wixInstanceId    │  │    │ installationId (FK)──│──┐
│ hubspotPortalId  │  │    │ wixField             │  │
│ hsAccessToken    │  │    │ hubspotProperty      │  │
│ hsRefreshToken   │  │    │ syncDirection        │  │
│ tokenExpiresAt   │  │    │ transform            │  │
│ conflictStrategy │  │    └──────────────────────┘  │
│ createdAt        │  │                              │
│ updatedAt        │  │    ┌──────────────────────┐  │
└──────────────────┘  ├───►│   ContactMapping     │  │
                      │    ├──────────────────────┤  │
                      │    │ id (PK)              │  │
                      │    │ installationId (FK)──│──┘
                      │    │ wixContactId         │
                      │    │ hubspotContactId     │
                      │    │ lastSyncedAt         │
                      │    │ lastSyncSource       │
                      │    │ syncCorrelationId    │
                      │    └──────────────────────┘
                      │
                      │    ┌──────────────────────┐
                      ├───►│    SyncEvent         │
                      │    ├──────────────────────┤
                      │    │ id (PK)              │
                      │    │ installationId (FK)  │
                      │    │ eventType            │
                      │    │ source (WIX|HUBSPOT) │
                      │    │ correlationId        │
                      │    │ status               │
                      │    │ payload (JSON)       │
                      │    │ error                │
                      │    │ createdAt            │
                      │    └──────────────────────┘
                      │
                      │    ┌──────────────────────┐
                      └───►│  ProcessedEvent      │
                           ├──────────────────────┤
                           │ id (PK)              │
                           │ installationId (FK)  │
                           │ eventId (UNIQUE)     │
                           │ processedAt          │
                           └──────────────────────┘
```

---

## 6. Data Flow Diagrams

### 6.1 HubSpot OAuth Connection Flow

```
 Site Owner          Our Frontend          Our Backend           HubSpot
     │                    │                     │                     │
     │  Click "Connect"   │                     │                     │
     │───────────────────►│                     │                     │
     │                    │  GET /api/auth/     │                     │
     │                    │  hubspot            │                     │
     │                    │────────────────────►│                     │
     │                    │                     │  Build auth URL     │
     │                    │                     │  (client_id, scope, │
     │                    │                     │   redirect_uri,     │
     │                    │                     │   state=CSRF token) │
     │                    │  302 Redirect       │                     │
     │◄───────────────────│◄────────────────────│                     │
     │                    │                     │                     │
     │  Redirect to HubSpot consent screen      │                     │
     │─────────────────────────────────────────────────────────────►  │
     │                    │                     │                     │
     │  User grants access │                    │                     │
     │◄─────────────────────────────────────────────────────────────  │
     │                    │                     │                     │
     │  Redirect to /api/auth/hubspot/callback?code=xxx&state=yyy     │
     │─────────────────────────────────────────►│                     │
     │                    │                     │                     │
     │                    │                     │  POST /oauth/v1/    │
     │                    │                     │  token              │
     │                    │                     │  (exchange code     │
     │                    │                     │   for tokens)       │
     │                    │                     │───────────────────► │
     │                    │                     │                     │
     │                    │                     │  { access_token,    │
     │                    │                     │    refresh_token,   │
     │                    │                     │    expires_in }     │
     │                    │                     │◄──────────────────  │
     │                    │                     │                     │
     │                    │                     │  Encrypt tokens     │
     │                    │                     │  Store in DB        │
     │                    │                     │                     │
     │  Redirect back to dashboard with success │                     │
     │◄────────────────────────────────────────│                      │
```

### 6.2 Wix → HubSpot Contact Sync

```
 Wix Platform         Our Webhook Handler       Sync Engine          HubSpot
     │                        │                       │                   │
     │  Contact created/      │                       │                   │
     │  updated event         │                       │                   │
     │  (JWT-signed POST)     │                       │                   │
     │───────────────────────►│                       │                   │
     │                        │                       │                   │
     │                        │  Verify JWT           │                   │
     │                        │  signature            │                   │
     │                        │                       │                   │
     │                        │  Check ProcessedEvent │                   │
     │                        │  (skip if duplicate)  │                   │
     │                        │                       │                   │
     │                        │  Check SyncEvent      │                   │
     │                        │  (skip if our own     │                   │
     │                        │   echo — loop         │                   │
     │                        │   prevention)         │                   │
     │                        │                       │                   │
     │  200 OK                │  Dispatch to          │                   │
     │◄──────────────────────│  sync engine           │                   │
     │                        │─────────────────────► │                   │
     │                        │                       │                   │
     │                        │                       │  Load field       │
     │                        │                       │  mappings from DB │
     │                        │                       │                   │
     │                        │                       │  Map Wix fields   │
     │                        │                       │  → HubSpot props  │
     │                        │                       │                   │
     │                        │                       │  Apply transforms │
     │                        │                       │  (trim, lowercase)│
     │                        │                       │                   │
     │                        │                       │  Idempotency      │
     │                        │                       │  check (skip if   │
     │                        │                       │  values unchanged)│
     │                        │                       │                   │
     │                        │                       │  PATCH /crm/v3/   │
     │                        │                       │  objects/contacts │
     │                        │                       │─────────────────► │
     │                        │                       │                   │
     │                        │                       │  200 OK           │
     │                        │                       │◄───────────────── │
     │                        │                       │                   │
     │                        │                       │  Update DB:       │
     │                        │                       │  - ContactMapping │
     │                        │                       │  - SyncEvent      │
     │                        │                       │  - ProcessedEvent │
```

### 6.3 HubSpot → Wix Contact Sync

```
 HubSpot              Our Webhook Handler       Sync Engine          Wix SDK
     │                        │                       │                    │
     │  contact.creation /    │                       │                    │
     │  contact.propertyChange│                       │                    │
     │  (batch of events,     │                       │                    │
     │   HMAC-signed)         │                       │                    │
     │───────────────────────►│                       │                    │
     │                        │                       │                    │
     │                        │  Verify HMAC          │                    │
     │                        │  X-HubSpot-Signature  │                    │
     │                        │                       │                    │
     │                        │  For each event:      │                    │
     │                        │  Check ProcessedEvent │                    │
     │                        │  Check SyncEvent      │                    │
     │                        │  (loop prevention)    │                    │
     │                        │                       │                    │
     │  200 OK                │  Dispatch to          │                    │
     │◄────────────────────── │  sync engine          │                    │
     │                        │─────────────────────► │                    │
     │                        │                       │                    │
     │                        │                       │  Load field        │
     │                        │                       │  mappings (HS→Wix) │
     │                        │                       │                    │
     │                        │                       │  Resolve conflicts │
     │                        │                       │  (per user config) │
     │                        │                       │                    │
     │                        │                       │  SDK: create or    │
     │                        │                       │  updateContact()   │
     │                        │                       │─────────────────►  │
     │                        │                       │                    │
     │                        │                       │  Contact updated   │
     │                        │                       │◄─────────────────  │
     │                        │                       │                    │
     │                        │                       │  Update DB         │
```

### 6.4 Wix Form → HubSpot Lead Capture

```
 Site Visitor         Wix Form            Our Webhook Handler        HubSpot
     │                   │                        │                      │
     │  Fills out form   │                        │                      │
     │  (with UTM params │                        │                      │
     │   in page URL)    │                        │                      │
     │──────────────────►│                        │                      │
     │                   │                        │                      │
     │                   │  form_submission.      │                      │
     │                   │  created webhook       │                      │
     │                   │  (JWT-signed POST)     │                      │
     │                   │───────────────────────►│                      │
     │                   │                        │                      │
     │                   │                        │  Extract from        │
     │                   │                        │  submission:         │
     │                   │                        │  • email             │
     │                   │                        │  • name              │
     │                   │                        │  • custom fields     │
     │                   │                        │                      │
     │                   │                        │  Extract attribution:│
     │                   │                        │  • utm_source        │
     │                   │                        │  • utm_medium        │
     │                   │                        │  • utm_campaign      │
     │                   │                        │  • utm_term          │
     │                   │                        │  • utm_content       │
     │                   │                        │  • page URL          │
     │                   │                        │  • referrer          │
     │                   │                        │  • timestamp         │
     │                   │                        │                      │
     │                   │                        │  Upsert contact      │
     │                   │                        │  with all properties │
     │                   │                        │  POST /crm/v3/       │
     │                   │                        │  objects/contacts/   │
     │                   │                        │  batch/upsert        │
     │                   │                        │───────────────────►  │
     │                   │                        │                      │
     │                   │                        │  Contact created/    │
     │                   │                        │  updated with UTM    │
     │                   │                        │  properties          │
     │                   │                        │◄───────────────────  │
     │                   │                        │                      │
     │                   │                        │  Store ContactMapping│
     │                   │                        │  Log SyncEvent       │
```

---

## 7. Database Schema

```prisma
// prisma/schema.prisma

generator client {
  provider = "prisma-client-js"
}

datasource db {
  provider = "postgresql"
  url      = env("DATABASE_URL")
}

// ─── Enums ────────────────────────────────────────────────

enum SyncDirection {
  WIX_TO_HUBSPOT
  HUBSPOT_TO_WIX
  BIDIRECTIONAL
}

enum SyncSource {
  WIX
  HUBSPOT
}

enum ConflictStrategy {
  LAST_UPDATED_WINS
  HUBSPOT_WINS
  WIX_WINS
}

enum SyncStatus {
  PENDING
  SUCCESS
  FAILED
}

// ─── Tables ───────────────────────────────────────────────

model Installation {
  id                String           @id @default(cuid())
  wixInstanceId     String           @unique
  hubspotPortalId   String?
  hsAccessToken     String?          // AES-256-GCM encrypted
  hsRefreshToken    String?          // AES-256-GCM encrypted
  tokenExpiresAt    DateTime?
  conflictStrategy  ConflictStrategy @default(LAST_UPDATED_WINS)
  isConnected       Boolean          @default(false)
  createdAt         DateTime         @default(now())
  updatedAt         DateTime         @updatedAt

  contactMappings   ContactMapping[]
  fieldMappings     FieldMapping[]
  syncEvents        SyncEvent[]
  processedEvents   ProcessedEvent[]
}

model ContactMapping {
  id                String       @id @default(cuid())
  installationId    String
  installation      Installation @relation(fields: [installationId], references: [id], onDelete: Cascade)
  wixContactId      String
  hubspotContactId  String
  lastSyncedAt      DateTime     @default(now())
  lastSyncSource    SyncSource
  syncCorrelationId String?

  @@unique([installationId, wixContactId])
  @@unique([installationId, hubspotContactId])
  @@index([wixContactId])
  @@index([hubspotContactId])
}

model FieldMapping {
  id              String        @id @default(cuid())
  installationId  String
  installation    Installation  @relation(fields: [installationId], references: [id], onDelete: Cascade)
  wixField        String
  hubspotProperty String
  syncDirection   SyncDirection
  transform       String?       // "trim", "lowercase", "uppercase", or null
  sortOrder       Int           @default(0)
  createdAt       DateTime      @default(now())
  updatedAt       DateTime      @updatedAt

  @@unique([installationId, hubspotProperty])
  @@index([installationId])
}

model SyncEvent {
  id              String      @id @default(cuid())
  installationId  String
  installation    Installation @relation(fields: [installationId], references: [id], onDelete: Cascade)
  eventType       String      // "contact.created", "contact.updated", "form.submitted"
  source          SyncSource
  correlationId   String
  status          SyncStatus
  wixContactId    String?
  hubspotContactId String?
  payload         Json?
  error           String?
  createdAt       DateTime    @default(now())

  @@index([installationId, createdAt])
  @@index([correlationId])
  @@index([wixContactId, createdAt])
  @@index([hubspotContactId, createdAt])
}

model ProcessedEvent {
  id              String       @id @default(cuid())
  installationId  String
  installation    Installation @relation(fields: [installationId], references: [id], onDelete: Cascade)
  eventId         String
  processedAt     DateTime     @default(now())

  @@unique([installationId, eventId])
  @@index([processedAt])
}
```

---

## 8. API Endpoints

### Dashboard APIs (called by the React frontend)

| Method | Endpoint | Auth | Request | Response |
|---|---|---|---|---|
| `GET` | `/api/auth/hubspot` | Wix instance | — | 302 → HubSpot OAuth |
| `GET` | `/api/auth/hubspot/callback` | — (state param) | `?code=xxx&state=yyy` | 302 → dashboard |
| `POST` | `/api/auth/hubspot/disconnect` | Wix instance | — | `{ success: true }` |
| `GET` | `/api/auth/hubspot/status` | Wix instance | — | `{ connected, portalId, connectedAt }` |
| `GET` | `/api/mappings` | Wix instance | — | `[{ wixField, hubspotProperty, direction, transform }]` |
| `POST` | `/api/mappings` | Wix instance | `{ mappings: [...] }` | `{ success: true }` |
| `GET` | `/api/mappings/fields` | Wix instance | — | `{ wixFields: [...], hubspotProperties: [...] }` |
| `GET` | `/api/settings` | Wix instance | — | `{ conflictStrategy }` |
| `PUT` | `/api/settings` | Wix instance | `{ conflictStrategy }` | `{ success: true }` |
| `GET` | `/api/sync/status` | Wix instance | — | `{ lastSync, totalSynced, pending, recentEvents }` |
| `POST` | `/api/sync/trigger` | Wix instance | — | `{ triggered: true }` |

### Webhook Endpoints (called by external platforms)

| Method | Endpoint | Source | Verification | Body |
|---|---|---|---|---|
| `POST` | `/api/webhooks/wix` | Wix | JWT signature (Public Key) | Raw text (JWT) |
| `POST` | `/api/webhooks/hubspot` | HubSpot | HMAC `X-HubSpot-Signature-v3` | JSON (batch of events) |

---

## 9. Infinite Loop Prevention Strategy

The most critical engineering challenge in bi-directional sync is preventing infinite update loops:

```
               WITHOUT PREVENTION:
               ═══════════════════
   Wix contact updated
        │
        ▼
   Webhook → sync to HubSpot (update contact)
        │
        ▼
   HubSpot webhook fires (contact.propertyChange)
        │
        ▼
   Webhook → sync to Wix (update contact)
        │
        ▼
   Wix webhook fires (contact.updated)
        │
        ▼
   ... INFINITE LOOP! ...
```

**Our three-layer defense:**

### Layer 1: Origin Tagging + Correlation ID
Every sync write generates a unique `syncCorrelationId` (UUID) stored in both the `ContactMapping` and `SyncEvent` tables. When the echo webhook arrives, we check: "Was this contact recently written by our system?" If the `SyncEvent` table shows a write to this contact within the last 60 seconds from the opposite source, we skip.

### Layer 2: Idempotent Writes
Before making any API call, we compare the new values against what we'd write. If all mapped properties are identical to the current values, we skip the API call entirely. No write = no webhook = no loop.

### Layer 3: Processed Event Deduplication
Every webhook event ID is stored in the `ProcessedEvent` table. If we receive the same event ID twice (Wix and HubSpot can retry failed deliveries), we skip it.

```
               WITH PREVENTION:
               ═════════════════
   Wix contact updated ("John" → "Johnny")
        │
        ▼
   Webhook → check ProcessedEvent (not seen) → continue
        │
        ▼
   Check SyncEvent (no recent HS→Wix write for this contact) → continue
        │
        ▼
   Map fields + transform → compare values against HubSpot → values differ → proceed
        │
        ▼
   Write to HubSpot + store correlationId="abc123" in SyncEvent
        │
        ▼
   HubSpot webhook fires (contact.propertyChange)
        │
        ▼
   Webhook → check SyncEvent → found recent WIX write with correlationId="abc123"
        │    within 60-second window → THIS IS OUR OWN ECHO
        │
        ▼
   SKIP ✓ (no write to Wix, loop broken)
```

---

## 10. Security Model

| Concern | Solution |
|---|---|
| **HubSpot OAuth tokens** | Encrypted at rest (AES-256-GCM) in PostgreSQL. Encryption key in env var, never in code. |
| **Token refresh** | HubSpot access tokens expire in 30 min. Backend auto-refreshes before expiry using the refresh token. |
| **Wix webhook verification** | JWT payload verified against Wix Public Key (asymmetric signature). |
| **HubSpot webhook verification** | HMAC SHA-256 signature in `X-HubSpot-Signature-v3` header, verified against App Secret. |
| **No tokens in browser** | OAuth callback is server-side. Tokens stored in DB, never sent to frontend. Dashboard API routes proxy all external calls. |
| **CSRF protection** | OAuth `state` parameter with random token stored in HTTP-only cookie. |
| **Least privilege scopes** | HubSpot OAuth requests only: `crm.objects.contacts.read`, `crm.objects.contacts.write`, `crm.schemas.contacts.read` |
| **Safe logging** | Logger utility that redacts tokens, emails, and PII before writing to console/log service. |
| **HTTPS everywhere** | Vercel provides automatic SSL. Wix and HubSpot require HTTPS for iframes and webhooks. |
| **Dashboard auth** | `instanceId` from Wix iframe JWT used to scope all API calls to the correct installation. |

---

## 11. External APIs Used

### Wix APIs (via SDK)

| API | Package | Usage |
|---|---|---|
| Contacts API | `@wix/contacts` | CRUD contacts, query contacts, extended fields |
| Forms / Submissions API | `@wix/forms` | Read form submission data |
| Dashboard SDK | `@wix/dashboard` | Authenticate dashboard iframe, navigate |
| Core SDK | `@wix/sdk` | `createClient`, `AppStrategy`, `webhooks.process()` |

### HubSpot APIs (REST)

| API | Base URL | Usage |
|---|---|---|
| OAuth | `https://api.hubapi.com/oauth/v1/token` | Token exchange and refresh |
| CRM Contacts v3 | `https://api.hubapi.com/crm/v3/objects/contacts` | CRUD contacts, batch upsert |
| Properties v3 | `https://api.hubapi.com/crm/v3/properties/contacts` | List properties, create custom UTM props |
| Webhooks v3 | `https://api.hubapi.com/webhooks/v3/{appId}` | Manage webhook subscriptions |

---

## 12. Project Structure

```
wix-hubspot-integration/
│
├── src/
│   ├── app/                                    # Next.js App Router
│   │   ├── layout.tsx                          # Root layout
│   │   ├── page.tsx                            # Landing/health-check page
│   │   │
│   │   ├── dashboard/                          # Dashboard (rendered in Wix iframe)
│   │   │   ├── layout.tsx                      # WixDesignSystemProvider wrapper
│   │   │   └── page.tsx                        # Main dashboard with tabs
│   │   │
│   │   └── api/                                # API Routes (Node.js serverless)
│   │       ├── auth/
│   │       │   └── hubspot/
│   │       │       ├── route.ts                # GET → initiate OAuth
│   │       │       ├── callback/
│   │       │       │   └── route.ts            # GET → handle OAuth callback
│   │       │       ├── disconnect/
│   │       │       │   └── route.ts            # POST → disconnect
│   │       │       └── status/
│   │       │           └── route.ts            # GET → connection status
│   │       ├── mappings/
│   │       │   ├── route.ts                    # GET/POST → field mappings CRUD
│   │       │   └── fields/
│   │       │       └── route.ts                # GET → available fields
│   │       ├── settings/
│   │       │   └── route.ts                    # GET/PUT → conflict strategy
│   │       ├── sync/
│   │       │   ├── status/
│   │       │   │   └── route.ts                # GET → sync stats
│   │       │   └── trigger/
│   │       │       └── route.ts                # POST → manual sync
│   │       └── webhooks/
│   │           ├── wix/
│   │           │   └── route.ts                # POST → Wix events
│   │           └── hubspot/
│   │               └── route.ts                # POST → HubSpot events
│   │
│   ├── lib/                                    # Shared backend logic
│   │   ├── wix-client.ts                       # Wix SDK client factory
│   │   ├── hubspot-client.ts                   # HubSpot REST client + token refresh
│   │   ├── sync-engine.ts                      # Core sync orchestrator
│   │   ├── field-mapper.ts                     # Field mapping transformer
│   │   ├── loop-prevention.ts                  # Dedupe + origin tracking
│   │   ├── conflict-resolver.ts                # Conflict resolution logic
│   │   ├── crypto.ts                           # Token encryption/decryption
│   │   ├── logger.ts                           # Safe logger (redacts PII/tokens)
│   │   └── db.ts                               # Prisma client singleton
│   │
│   ├── components/                             # React components (dashboard UI)
│   │   ├── ConnectionPanel.tsx                 # HubSpot connect/disconnect
│   │   ├── FieldMappingTable.tsx               # Field mapping configuration
│   │   ├── ConflictSettings.tsx                # Conflict strategy selector
│   │   ├── SyncStatus.tsx                      # Sync stats + recent activity
│   │   └── DashboardLayout.tsx                 # Tab navigation layout
│   │
│   └── types/                                  # TypeScript type definitions
│       ├── index.ts                            # Shared types
│       ├── wix.ts                              # Wix-specific types
│       └── hubspot.ts                          # HubSpot-specific types
│
├── prisma/
│   ├── schema.prisma                           # Database schema
│   └── migrations/                             # Auto-generated migration files
│
├── public/                                     # Static assets
│
├── .env.local                                  # Local env vars (git-ignored)
├── .env.example                                # Template for env vars
├── .gitignore
├── next.config.js                              # Next.js configuration
├── tsconfig.json                               # TypeScript configuration
├── package.json                                # Dependencies + scripts
├── README.md                                   # Setup/usage instructions
└── ARCHITECTURE.md                             # This document
```

---

## 13. Deployment Architecture

```
┌───────────────────────────────────────────────────────────── ┐
│                        VERCEL                                │
│                                                              │
│  ┌────────────────────────────────────────────────────────┐  │
│  │  Next.js Application                                   │  │
│  │                                                        │  │
│  │  ┌──────────────┐  ┌───────────────────────────────┐   │  │
│  │  │ Static Files │  │ Serverless Functions          │   │  │
│  │  │ (React SPA)  │  │ (API routes → Node.js)        │   │  │
│  │  │              │  │                               │   │  │
│  │  │ /dashboard   │  │ /api/webhooks/wix             │   │  │
│  │  │ (iframe src) │  │ /api/webhooks/hubspot         │   │  │
│  │  │              │  │ /api/auth/hubspot/*           │   │  │
│  │  │              │  │ /api/mappings/*               │   │  │
│  │  │              │  │ /api/sync/*                   │   │  │
│  │  │              │  │ /api/settings                 │   │  │
│  │  └──────────────┘  └───────────────┬───────────────┘   │  │
│  │                                    │                   │  │
│  │  Auto-HTTPS    CDN    Edge         │                   │  │
│  └────────────────────────────────────┼───────────────────┘  │
│                                       │                      │
│  Environment Variables:               │                      │
│  WIX_APP_ID, WIX_APP_SECRET,          │                      │
│  WIX_PUBLIC_KEY, HUBSPOT_CLIENT_ID,   │                      │
│  HUBSPOT_CLIENT_SECRET,               │                      │
│  HUBSPOT_APP_ID, DATABASE_URL,        │                      │
│  ENCRYPTION_KEY                       │                      │
└───────────────────────────────────────┼──────────────────────┘
                                        │
                            Prisma connection
                            (connection pooling)
                                        │
                                        ▼
                    ┌───────────────────────────────────┐
                    │        SUPABASE (Free Tier)       │
                    │                                   │
                    │   PostgreSQL Database             │
                    │   • installations                 │
                    │   • contact_mappings              │
                    │   • field_mappings                │
                    │   • sync_events                   │
                    │   • processed_events              │
                    │                                   │
                    │   Web Dashboard for inspection ✓  │
                    │   Auto-backups ✓                  │
                    │   Connection pooling ✓            │
                    └───────────────────────────────────┘
```

### Local Development Setup

```
Developer Machine
│
├── Next.js dev server (localhost:3000)
│   ├── React frontend (hot reload)
│   └── API routes (hot reload)
│
├── ngrok tunnel (https://xxx.ngrok.io → localhost:3000)
│   ├── Wix dashboard iframe points here
│   ├── Wix webhooks delivered here
│   └── HubSpot webhooks delivered here
│
└── Local/remote PostgreSQL
    └── Prisma connects via DATABASE_URL
```

---

## 14. Glossary

| Term | Definition |
|---|---|
| **Installation** | A single instance of our app installed on a Wix site. Each Wix site gets its own `instanceId`. |
| **instanceId** | Unique identifier per Wix site installation. Used to scope all data and API calls. |
| **ContactMapping** | A record linking a Wix contact ID to its corresponding HubSpot contact ID. |
| **FieldMapping** | A user-configured rule that maps a Wix field to a HubSpot property (with direction and transform). |
| **SyncCorrelationId** | A UUID generated for each sync write, used to identify echo webhooks and prevent loops. |
| **Dedupe Window** | A time window (60 seconds) during which echo webhooks from our own writes are suppressed. |
| **Idempotent Write** | A write that is skipped if the target already has the same values. Prevents unnecessary API calls. |
| **Origin Tagging** | Marking each sync write with its source (WIX or HUBSPOT) so the echo can be identified and skipped. |
| **Conflict Resolution** | The strategy used when the same contact was modified on both sides between sync cycles. |
| **UTM Parameters** | URL query parameters (`utm_source`, `utm_medium`, `utm_campaign`, `utm_term`, `utm_content`) used for marketing attribution. |
| **App Strategy** | Wix SDK authentication mode for self-hosted apps, using App ID + App Secret + Instance ID. |
| **JWT** | JSON Web Token — used by Wix to sign webhook payloads for verification. |
| **HMAC** | Hash-based Message Authentication Code — used by HubSpot to sign webhook requests. |

---

*This document serves as the single source of truth for the application's architecture. Update it as the implementation evolves.*
