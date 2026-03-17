import { NextResponse } from "next/server";

/**
 * Dashboard Page
 *
 * This page is loaded inside an iframe in the Wix site dashboard.
 * For now, it renders a simple placeholder confirming the app is working.
 * Will be replaced with the full React dashboard UI (connection panel,
 * field mapping table, sync status).
 */
export default function DashboardPage() {
  return (
    <div style={{ padding: "40px", fontFamily: "sans-serif", maxWidth: "800px", margin: "0 auto" }}>
      <h1 style={{ fontSize: "24px", marginBottom: "8px" }}>
        Wix ↔ HubSpot Integration
      </h1>
      <p style={{ color: "#666", marginBottom: "32px" }}>
        Connect your HubSpot account, configure field mappings, and sync contacts automatically.
      </p>

      {/* Connection Status */}
      <div style={{
        border: "1px solid #e0e0e0",
        borderRadius: "8px",
        padding: "24px",
        marginBottom: "24px",
        backgroundColor: "#fafafa"
      }}>
        <h2 style={{ fontSize: "18px", marginBottom: "12px" }}>HubSpot Connection</h2>
        <p style={{ color: "#888", marginBottom: "16px" }}>
          Status: <span style={{ color: "#e74c3c" }}>● Not Connected</span>
        </p>
        <button
          style={{
            backgroundColor: "#ff7a59",
            color: "white",
            border: "none",
            padding: "10px 24px",
            borderRadius: "4px",
            cursor: "pointer",
            fontSize: "14px",
          }}
        >
          Connect HubSpot
        </button>
      </div>

      {/* Field Mapping Placeholder */}
      <div style={{
        border: "1px solid #e0e0e0",
        borderRadius: "8px",
        padding: "24px",
        marginBottom: "24px",
        backgroundColor: "#fafafa"
      }}>
        <h2 style={{ fontSize: "18px", marginBottom: "12px" }}>Field Mapping</h2>
        <p style={{ color: "#888" }}>
          Connect HubSpot first to configure field mappings.
        </p>
      </div>

      {/* Sync Status Placeholder */}
      <div style={{
        border: "1px solid #e0e0e0",
        borderRadius: "8px",
        padding: "24px",
        backgroundColor: "#fafafa"
      }}>
        <h2 style={{ fontSize: "18px", marginBottom: "12px" }}>Sync Status</h2>
        <p style={{ color: "#888" }}>
          No sync activity yet.
        </p>
      </div>

      <p style={{ marginTop: "32px", fontSize: "12px", color: "#aaa" }}>
        App Version: 0.1.0 | Dashboard loaded successfully
      </p>
    </div>
  );
}
