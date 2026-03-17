
# Wix ↔ HubSpot Contact Sync App

Bi-directional contact sync between Wix and HubSpot with form capture, UTM attribution, and customizable field mapping.

# Demonstration video found in : 

https://drive.google.com/drive/folders/1hPQQaDhtESAS30q591FWuHoHQjT2FXGb?usp=drive_link

## Features
- Sync contacts between Wix and HubSpot in both directions
- Field mapping dashboard with support for custom properties
- Webhook-based updates for real-time sync
- Retry logic for failed syncs
- UTM attribution and form capture
- Dashboard UI for mapping, status, and logs
- Loop prevention logic to avoid infinite syncs
- Conflict resolution strategies (Last Updated Wins, Wix Wins, HubSpot Wins)

## Project Structure
- `src/app/api/webhooks/wix/route.ts`: Handles Wix webhooks
- `src/app/api/webhooks/hubspot/route.ts`: Handles HubSpot webhooks
- `src/lib/sync-engine.ts`: Core sync logic
- `src/lib/field-mapper.ts`: Field mapping and payload builders
- `src/app/dashboard/page.tsx`: Dashboard UI
- `src/types/index.ts`: Shared types and interfaces

## API Endpoints
- `/api/webhooks/wix`: Receives Wix webhook events
- `/api/webhooks/hubspot`: Receives HubSpot webhook events
- `/api/mappings`: Manage field mappings
- `/api/settings`: Manage sync settings and conflict strategy
- `/api/sync/status`: View sync status and recent events

## Advanced Features
- UTM attribution and form capture support
- Retry logic for failed syncs (409 revision errors)
- Custom property mapping (ensure custom fields exist in both Wix and HubSpot)

## Database Schema
- Prisma migrations and schema tables:
  - Installations
  - Field mappings
  - Contact mappings
  - Sync events
  - Processed events

## Security
- OAuth 2.0 for HubSpot authentication
- JWT handling for Wix webhooks
- HMAC signature verification for HubSpot webhooks

## Logging & Error Handling
- All sync errors are logged and visible in the dashboard
- Logs include webhook payloads, mapped fields, and sync results

## Custom Properties
- To sync custom fields, ensure they exist in both Wix and HubSpot and add mappings in the dashboard

## Testing
- Update contacts in Wix/HubSpot and check logs and dashboard for sync
- Use HubSpot’s test webhook feature for development

## Contributing
- Open issues or submit PRs for bug fixes and enhancements

## Limitations
- Only standard and mapped custom fields are synced
- Webhook events must include changed properties

## Architecture
- Sync flow: Wix ↔ Webhook ↔ Sync Engine ↔ HubSpot

## Setup

### Prerequisites
- Node.js 18+
- HubSpot developer account
- Wix developer account
- Vercel (for deployment)

### Environment Variables
Create a `.env` file with:
```
HUBSPOT_CLIENT_ID=your_client_id
HUBSPOT_CLIENT_SECRET=your_client_secret
HUBSPOT_APP_ID=your_app_id
WIX_APP_ID=your_wix_app_id
DATABASE_URL=your_postgres_url
NEXT_PUBLIC_WIX_INSTANCE=your_wix_instance
```

### HubSpot App Setup
- Create a HubSpot app in your developer portal
- Set redirect URLs and webhook target URL as per `public_app.json` and `webhooks.json`
- Add required scopes: `crm.objects.contacts.read`, `crm.objects.contacts.write`, `crm.schemas.contacts.read`
- Subscribe to property changes for `email`, `firstname`, `lastname`, `phone`, etc.

### Wix App Setup
- Create a Wix app and configure instance and permissions

### Local Development
```
npm install
npm run dev
```

## Usage
- Open the dashboard at `/dashboard`
- Connect HubSpot and Wix accounts
- Configure field mappings (select internal property names for HubSpot)
- Save mappings and test sync by updating contacts in either platform

## Deployment
- Deploy to Vercel or your preferred platform
- Ensure environment variables and webhook URLs are set correctly

## Troubleshooting
- Phone sync: Ensure HubSpot webhook sends the `phone` property
- Webhook errors: Check logs and verify webhook subscriptions
- Token issues: App auto-refreshes tokens, but check credentials if sync fails
