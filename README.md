# Wix ↔ HubSpot Integration App

## Overview
This app provides seamless, bi-directional contact synchronization between Wix and HubSpot. It is built with Next.js (App Router), TypeScript, Prisma, and uses the official Wix and HubSpot APIs. The app is self-hosted and designed for deployment on Vercel.

**Features:**
- Bi-directional contact sync: Wix → HubSpot and HubSpot → Wix
- Field mapping UI for custom property mapping
- OAuth 2.0 secure connection to HubSpot
- Loop prevention (no infinite syncs)
- Form submission capture with UTM attribution
- Conflict resolution strategies (Last Updated Wins, Wix Wins, HubSpot Wins)
- Dashboard for connection status, mappings, and sync activity

## Tech Stack
- **Next.js 16 (App Router)**
- **TypeScript 5.9**
- **Prisma v7** (PostgreSQL via Neon)
- **@wix/sdk** (REST API, AppStrategy)
- **@hubspot/api-client**
- **AES-256-GCM** for token encryption
- **Vercel** (recommended deployment)

## Setup

### 1. Environment Variables
Create a `.env` file with the following:

```
DATABASE_URL=postgresql://... # Neon or other Postgres
WIX_APP_ID=...
WIX_APP_SECRET=...
HUBSPOT_CLIENT_ID=...
HUBSPOT_CLIENT_SECRET=...
ENCRYPTION_KEY=... # 32 bytes, base64
NEXTAUTH_SECRET=... # for NextAuth if used
```

### 2. Database
- Run `npx prisma migrate deploy` to apply migrations.
- The schema includes tables for installations, field mappings, contact mappings, sync events, and processed events.

### 3. HubSpot App
- Create a HubSpot developer app with the following scopes:
  - `crm.objects.contacts.read`
  - `crm.objects.contacts.write`
  - `crm.schemas.contacts.write`
- Set the OAuth redirect URI to: `https://<your-vercel-domain>/api/auth/hubspot/callback`
- Set the webhook target URL to: `https://<your-vercel-domain>/api/webhooks/hubspot`
- Add webhook subscriptions for:
  - `object.creation` (contact)
  - `object.propertyChange` (contact, email, firstname, lastname, phone, company)

### 4. Wix App
- Register your app in the Wix Developers Center.
- Set the app's redirect and webhook URLs to your Vercel deployment.
- Use the AppStrategy for authentication.

### 5. Deploy
- Deploy to Vercel (recommended) or your own Node.js host.
- Set all environment variables in your deployment environment.

## Usage

1. **Connect HubSpot**: Log in to your Wix dashboard, open the app, and connect your HubSpot account via OAuth.
2. **Configure Field Mappings**: Use the dashboard to map Wix fields to HubSpot properties. Six defaults are provided (first name, last name, email, phone, company, job title).
3. **Sync Contacts**: Contacts created or updated in either platform will sync to the other, respecting your field mappings and conflict strategy.
4. **View Sync Activity**: The dashboard shows recent sync events, errors, and status.

## Development
- `npx next dev` — Start local dev server
- `npx next build` — Build for production
- `npx prisma studio` — Open Prisma DB browser

## Key Files
- `src/app/api/webhooks/wix/route.ts` — Handles Wix webhooks
- `src/app/api/webhooks/hubspot/route.ts` — Handles HubSpot webhooks
- `src/lib/sync-engine.ts` — Core sync logic
- `src/lib/field-mapper.ts` — Field mapping and payload builders
- `src/app/dashboard/page.tsx` — Dashboard UI

## Notes
- **Loop prevention**: The app tracks sync events and prevents infinite update loops between platforms.
- **Custom properties**: If you want to sync custom fields, ensure they exist in both Wix and HubSpot and add mappings in the dashboard.
- **Error handling**: All sync errors are logged and visible in the dashboard.

