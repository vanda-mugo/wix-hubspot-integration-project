"use client";

import { useState, useEffect, useCallback } from "react";

// ─── Types ────────────────────────────────────────────────

interface ConnectionStatus {
  connected: boolean;
  portalId?: string;
  connectedAt?: string;
}

interface FieldMapping {
  id?: string;
  wixField: string;
  hubspotProperty: string;
  syncDirection: string;
  transform?: string | null;
}

interface AvailableField {
  value: string;
  label: string;
}

interface SyncEvent {
  id: string;
  eventType: string;
  source: string;
  status: string;
  createdAt: string;
  error?: string | null;
  wixContactId?: string;
  hubspotContactId?: string;
}

interface SyncStatusData {
  totalMappings: number;
  recentEvents: SyncEvent[];
  lastSyncAt?: string | null;
}

// ─── Helper: Get installation context from Wix iframe ────

function getWixInstanceToken(): string {
  if (typeof window !== "undefined") {
    const params = new URLSearchParams(window.location.search);
    return params.get("instance") || "";
  }
  return "";
}

// ─── Main Dashboard ──────────────────────────────────────

export default function DashboardPage() {
  const [ctx, setCtx] = useState({ installationId: "", instanceId: "" });
  const [connection, setConnection] = useState<ConnectionStatus | null>(null);
  const [mappings, setMappings] = useState<FieldMapping[]>([]);
  const [wixFields, setWixFields] = useState<AvailableField[]>([]);
  const [hubspotFields, setHubspotFields] = useState<AvailableField[]>([]);
  const [syncStatus, setSyncStatus] = useState<SyncStatusData | null>(null);
  const [conflictStrategy, setConflictStrategy] = useState("LAST_UPDATED_WINS");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [initError, setInitError] = useState("");
  const [message, setMessage] = useState<{
    text: string;
    type: "success" | "error";
  } | null>(null);

  const baseUrl = typeof window !== "undefined" ? window.location.origin : "";

  // ─── Load all data on mount ────────────────────────────

  const loadData = useCallback(async () => {
    if (!ctx.installationId) return;
    setLoading(true);

    try {
      const [connRes, mapRes, fieldRes, syncRes, settRes] = await Promise.all([
        fetch(
          `${baseUrl}/api/auth/hubspot/status?installationId=${ctx.installationId}`,
        ),
        fetch(`${baseUrl}/api/mappings?installationId=${ctx.installationId}`),
        fetch(`${baseUrl}/api/mappings/fields`),
        fetch(
          `${baseUrl}/api/sync/status?installationId=${ctx.installationId}`,
        ),
        fetch(`${baseUrl}/api/settings?installationId=${ctx.installationId}`),
      ]);

      const [connData, mapData, fieldData, syncData, settData] =
        await Promise.all([
          connRes.json(),
          mapRes.json(),
          fieldRes.json(),
          syncRes.json(),
          settRes.json(),
        ]);

      if (connData.success) setConnection(connData.data);
      if (mapData.success) setMappings(mapData.data);
      if (fieldData.success) {
        setWixFields(fieldData.data.wixFields);
        setHubspotFields(fieldData.data.hubspotProperties);
      }
      if (syncData.success) setSyncStatus(syncData.data);
      if (settData.success) setConflictStrategy(settData.data.conflictStrategy);
    } catch (err) {
      console.error("Failed to load dashboard data:", err);
    } finally {
      setLoading(false);
    }
  }, [ctx.installationId, baseUrl]);

  useEffect(() => {
    async function resolveContext() {
      const instanceToken = getWixInstanceToken();
      if (!instanceToken) {
        setInitError(
          "Missing installation context. This page should be loaded from the Wix dashboard.",
        );
        setLoading(false);
        return;
      }

      try {
        const res = await fetch(`${baseUrl}/api/auth/wix/resolve`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ instance: instanceToken }),
        });
        const data = await res.json();
        if (data.success) {
          setCtx({
            installationId: data.data.installationId,
            instanceId: data.data.instanceId,
          });
        } else {
          setInitError(data.error || "Failed to resolve installation context.");
          setLoading(false);
        }
      } catch (err) {
        console.error("Failed to resolve Wix instance:", err);
        setInitError("Failed to connect to server.");
        setLoading(false);
      }
    }
    resolveContext();
  }, [baseUrl]);

  useEffect(() => {
    if (ctx.installationId) loadData();
  }, [ctx.installationId, loadData]);

  // Listen for OAuth callback message
  useEffect(() => {
    function handleMessage(event: MessageEvent) {
      if (event.data?.type === "hubspot-oauth-callback") {
        if (event.data.success) {
          showMessage("HubSpot connected successfully!", "success");
          loadData();
        } else {
          showMessage(event.data.error || "Connection failed", "error");
        }
      }
    }
    window.addEventListener("message", handleMessage);
    return () => window.removeEventListener("message", handleMessage);
  }, [loadData]);

  function showMessage(text: string, type: "success" | "error") {
    setMessage({ text, type });
    setTimeout(() => setMessage(null), 5000);
  }

  // ─── Actions ───────────────────────────────────────────

  function connectHubSpot() {
    const url = `${baseUrl}/api/auth/hubspot?installationId=${ctx.installationId}&instanceId=${ctx.instanceId}`;
    window.open(url, "hubspot-oauth", "width=600,height=700");
  }

  async function disconnectHubSpot() {
    try {
      const res = await fetch(`${baseUrl}/api/auth/hubspot/disconnect`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          installationId: ctx.installationId,
          instanceId: ctx.instanceId,
        }),
      });
      const data = await res.json();
      if (data.success) {
        showMessage("HubSpot disconnected", "success");
        loadData();
      } else {
        showMessage(data.error || "Failed to disconnect", "error");
      }
    } catch {
      showMessage("Failed to disconnect", "error");
    }
  }

  async function saveMappings() {
    setSaving(true);
    try {
      const res = await fetch(`${baseUrl}/api/mappings`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          installationId: ctx.installationId,
          instanceId: ctx.instanceId,
          mappings: mappings.map((m) => ({
            wixField: m.wixField,
            hubspotProperty: m.hubspotProperty,
            syncDirection: m.syncDirection,
            transform: m.transform,
          })),
        }),
      });
      const data = await res.json();
      if (data.success) {
        showMessage(`Saved ${data.count} mapping(s)`, "success");
      } else {
        showMessage(data.error || "Failed to save", "error");
      }
    } catch {
      showMessage("Failed to save mappings", "error");
    } finally {
      setSaving(false);
    }
  }

  async function resetMappings() {
    try {
      const res = await fetch(`${baseUrl}/api/mappings`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          installationId: ctx.installationId,
          instanceId: ctx.instanceId,
        }),
      });
      const data = await res.json();
      if (data.success) {
        showMessage("Reset to default mappings", "success");
        loadData();
      }
    } catch {
      showMessage("Failed to reset", "error");
    }
  }

  async function saveConflictStrategy() {
    try {
      const res = await fetch(`${baseUrl}/api/settings`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          installationId: ctx.installationId,
          instanceId: ctx.instanceId,
          conflictStrategy,
        }),
      });
      const data = await res.json();
      if (data.success) {
        showMessage("Conflict strategy updated", "success");
      } else {
        showMessage(data.error || "Failed to save", "error");
      }
    } catch {
      showMessage("Failed to save settings", "error");
    }
  }

  function addMapping() {
    setMappings([
      ...mappings,
      {
        wixField: wixFields[0]?.value || "",
        hubspotProperty: hubspotFields[0]?.value || "",
        syncDirection: "BIDIRECTIONAL",
        transform: null,
      },
    ]);
  }

  function removeMapping(index: number) {
    setMappings(mappings.filter((_, i) => i !== index));
  }

  function updateMapping(index: number, field: string, value: string) {
    setMappings(
      mappings.map((m, i) => (i === index ? { ...m, [field]: value } : m)),
    );
  }

  // ─── Render ────────────────────────────────────────────

  if (initError) {
    return (
      <div style={styles.container}>
        <h1 style={styles.title}>Wix ↔ HubSpot Integration</h1>
        <div style={styles.card}>
          <p style={styles.muted}>{initError}</p>
        </div>
      </div>
    );
  }

  if (loading) {
    return (
      <div style={styles.container}>
        <h1 style={styles.title}>Wix ↔ HubSpot Integration</h1>
        <div style={styles.card}>
          <p>Loading...</p>
        </div>
      </div>
    );
  }

  return (
    <div style={styles.container}>
      <h1 style={styles.title}>Wix ↔ HubSpot Integration</h1>
      <p style={styles.subtitle}>
        Connect your HubSpot account, configure field mappings, and sync
        contacts automatically.
      </p>

      {/* Toast message */}
      {message && (
        <div
          style={{
            ...styles.toast,
            backgroundColor: message.type === "success" ? "#d4edda" : "#f8d7da",
            color: message.type === "success" ? "#155724" : "#721c24",
            border: `1px solid ${message.type === "success" ? "#c3e6cb" : "#f5c6cb"}`,
          }}
        >
          {message.text}
        </div>
      )}

      {/* ─── Connection Panel ─────────────────────────────── */}
      <div style={styles.card}>
        <h2 style={styles.cardTitle}>HubSpot Connection</h2>
        {connection?.connected ? (
          <div>
            <div style={styles.statusRow}>
              <span style={styles.statusDot}>●</span>
              <span style={{ color: "#28a745", fontWeight: 600 }}>
                Connected
              </span>
              {connection.portalId && (
                <span style={styles.muted}>
                  {" "}
                  — Portal ID: {connection.portalId}
                </span>
              )}
            </div>
            <button onClick={disconnectHubSpot} style={styles.btnDanger}>
              Disconnect
            </button>
          </div>
        ) : (
          <div>
            <div style={styles.statusRow}>
              <span style={{ ...styles.statusDot, color: "#dc3545" }}>●</span>
              <span style={{ color: "#dc3545" }}>Not Connected</span>
            </div>
            <button onClick={connectHubSpot} style={styles.btnPrimary}>
              Connect HubSpot
            </button>
          </div>
        )}
      </div>

      {/* ─── Field Mapping Table ──────────────────────────── */}
      <div style={styles.card}>
        <div style={styles.cardHeader}>
          <h2 style={styles.cardTitle}>Field Mappings</h2>
          <div>
            <button onClick={addMapping} style={styles.btnSmall}>
              + Add Mapping
            </button>
            <button
              onClick={resetMappings}
              style={{ ...styles.btnSmall, marginLeft: 8 }}
            >
              Reset Defaults
            </button>
          </div>
        </div>

        {mappings.length === 0 ? (
          <p style={styles.muted}>
            No mappings configured. Add mappings or reset to defaults.
          </p>
        ) : (
          <div style={{ overflowX: "auto" as const }}>
            <table style={styles.table}>
              <thead>
                <tr>
                  <th style={styles.th}>Wix Field</th>
                  <th style={styles.th}>HubSpot Property</th>
                  <th style={styles.th}>Direction</th>
                  <th style={styles.th}>Transform</th>
                  <th style={styles.th}></th>
                </tr>
              </thead>
              <tbody>
                {mappings.map((m, i) => (
                  <tr key={i}>
                    <td style={styles.td}>
                      <select
                        value={m.wixField}
                        onChange={(e) =>
                          updateMapping(i, "wixField", e.target.value)
                        }
                        style={styles.select}
                      >
                        {wixFields.map((f) => (
                          <option key={f.value} value={f.value}>
                            {f.label}
                          </option>
                        ))}
                      </select>
                    </td>
                    <td style={styles.td}>
                      <select
                        value={m.hubspotProperty}
                        onChange={(e) =>
                          updateMapping(i, "hubspotProperty", e.target.value)
                        }
                        style={styles.select}
                      >
                        {hubspotFields.map((f) => (
                          <option key={f.value} value={f.value}>
                            {f.label}
                          </option>
                        ))}
                      </select>
                    </td>
                    <td style={styles.td}>
                      <select
                        value={m.syncDirection}
                        onChange={(e) =>
                          updateMapping(i, "syncDirection", e.target.value)
                        }
                        style={styles.select}
                      >
                        <option value="BIDIRECTIONAL">↔ Both</option>
                        <option value="WIX_TO_HUBSPOT">→ Wix → HS</option>
                        <option value="HUBSPOT_TO_WIX">← HS → Wix</option>
                      </select>
                    </td>
                    <td style={styles.td}>
                      <select
                        value={m.transform || ""}
                        onChange={(e) =>
                          updateMapping(i, "transform", e.target.value || null!)
                        }
                        style={styles.select}
                      >
                        <option value="">None</option>
                        <option value="trim">Trim</option>
                        <option value="lowercase">Lowercase</option>
                        <option value="uppercase">Uppercase</option>
                      </select>
                    </td>
                    <td style={styles.td}>
                      <button
                        onClick={() => removeMapping(i)}
                        style={styles.btnRemove}
                        title="Remove"
                      >
                        ×
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        <div style={{ marginTop: 16 }}>
          <button
            onClick={saveMappings}
            style={styles.btnPrimary}
            disabled={saving}
          >
            {saving ? "Saving..." : "Save Mappings"}
          </button>
        </div>
      </div>

      {/* ─── Conflict Resolution ──────────────────────────── */}
      <div style={styles.card}>
        <h2 style={styles.cardTitle}>Conflict Resolution</h2>
        <p style={styles.muted}>
          When both Wix and HubSpot have updates for the same contact, which one
          wins?
        </p>
        <div
          style={{ display: "flex", gap: 12, marginTop: 12, flexWrap: "wrap" }}
        >
          {[
            {
              value: "LAST_UPDATED_WINS",
              label: "Last Updated Wins",
              desc: "Most recent change takes priority",
            },
            {
              value: "HUBSPOT_WINS",
              label: "HubSpot Wins",
              desc: "HubSpot is the source of truth",
            },
            {
              value: "WIX_WINS",
              label: "Wix Wins",
              desc: "Wix is the source of truth",
            },
          ].map((opt) => (
            <label
              key={opt.value}
              style={{
                ...styles.radioCard,
                borderColor:
                  conflictStrategy === opt.value ? "#0070f3" : "#e0e0e0",
                backgroundColor:
                  conflictStrategy === opt.value ? "#f0f7ff" : "#fff",
              }}
            >
              <input
                type="radio"
                name="conflictStrategy"
                value={opt.value}
                checked={conflictStrategy === opt.value}
                onChange={(e) => setConflictStrategy(e.target.value)}
                style={{ marginRight: 8 }}
              />
              <div>
                <strong>{opt.label}</strong>
                <div style={{ fontSize: 12, color: "#666" }}>{opt.desc}</div>
              </div>
            </label>
          ))}
        </div>
        <button
          onClick={saveConflictStrategy}
          style={{ ...styles.btnPrimary, marginTop: 16 }}
        >
          Save Strategy
        </button>
      </div>

      {/* ─── Sync Status ──────────────────────────────────── */}
      <div style={styles.card}>
        <h2 style={styles.cardTitle}>Sync Status</h2>
        <div style={styles.statsRow}>
          <div style={styles.stat}>
            <div style={styles.statValue}>{syncStatus?.totalMappings ?? 0}</div>
            <div style={styles.statLabel}>Synced Contacts</div>
          </div>
          <div style={styles.stat}>
            <div style={styles.statValue}>
              {syncStatus?.lastSyncAt
                ? new Date(syncStatus.lastSyncAt).toLocaleString()
                : "Never"}
            </div>
            <div style={styles.statLabel}>Last Sync</div>
          </div>
        </div>

        {syncStatus?.recentEvents && syncStatus.recentEvents.length > 0 && (
          <div style={{ marginTop: 20 }}>
            <h3 style={{ fontSize: 14, marginBottom: 8 }}>Recent Activity</h3>
            <div style={{ overflowX: "auto" as const }}>
              <table style={styles.table}>
                <thead>
                  <tr>
                    <th style={styles.th}>Time</th>
                    <th style={styles.th}>Type</th>
                    <th style={styles.th}>Direction</th>
                    <th style={styles.th}>Status</th>
                    <th style={styles.th}>Details</th>
                  </tr>
                </thead>
                <tbody>
                  {syncStatus.recentEvents.map((evt) => (
                    <tr key={evt.id}>
                      <td style={styles.td}>
                        {new Date(evt.createdAt).toLocaleTimeString()}
                      </td>
                      <td style={styles.td}>{evt.eventType}</td>
                      <td style={styles.td}>
                        {evt.source === "WIX" ? "Wix → HS" : "HS → Wix"}
                      </td>
                      <td style={styles.td}>
                        <span
                          style={{
                            color:
                              evt.status === "SUCCESS" ? "#28a745" : "#dc3545",
                            fontWeight: 600,
                          }}
                        >
                          {evt.status}
                        </span>
                      </td>
                      <td
                        style={{
                          ...styles.td,
                          fontSize: 12,
                          color: "#666",
                          wordBreak: "break-word" as const,
                          overflow: "hidden" as const,
                          textOverflow: "ellipsis" as const,
                          maxWidth: 0,
                        }}
                        title={evt.error || ""}
                      >
                        {evt.error || "—"}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

        <button
          onClick={loadData}
          style={{ ...styles.btnSmall, marginTop: 16 }}
        >
          Refresh
        </button>
      </div>
    </div>
  );
}

// ─── Inline Styles ────────────────────────────────────────

const styles: Record<string, React.CSSProperties> = {
  container: {
    padding: "32px 24px",
    fontFamily:
      '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
    maxWidth: "100%",
    margin: "0 auto",
    color: "#1a1a1a",
    boxSizing: "border-box" as const,
    overflowX: "hidden" as const,
  },
  title: {
    fontSize: 24,
    fontWeight: 700,
    marginBottom: 4,
  },
  subtitle: {
    color: "#666",
    marginBottom: 28,
    fontSize: 14,
  },
  card: {
    border: "1px solid #e0e0e0",
    borderRadius: 8,
    padding: "24px",
    marginBottom: 24,
    backgroundColor: "#fff",
  },
  cardHeader: {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 16,
  },
  cardTitle: {
    fontSize: 16,
    fontWeight: 600,
    marginBottom: 12,
  },
  statusRow: {
    display: "flex",
    alignItems: "center",
    gap: 8,
    marginBottom: 16,
  },
  statusDot: {
    color: "#28a745",
    fontSize: 20,
  },
  muted: {
    color: "#888",
    fontSize: 13,
  },
  toast: {
    padding: "12px 16px",
    borderRadius: 6,
    marginBottom: 20,
    fontSize: 14,
  },
  table: {
    width: "100%",
    borderCollapse: "collapse" as const,
    fontSize: 13,
    tableLayout: "fixed" as const,
  },
  th: {
    textAlign: "left" as const,
    padding: "8px 10px",
    borderBottom: "2px solid #e0e0e0",
    fontSize: 12,
    fontWeight: 600,
    color: "#666",
    textTransform: "uppercase" as const,
  },
  td: {
    padding: "8px 10px",
    borderBottom: "1px solid #f0f0f0",
  },
  select: {
    width: "100%",
    padding: "6px 8px",
    border: "1px solid #d0d0d0",
    borderRadius: 4,
    fontSize: 13,
    backgroundColor: "#fff",
    boxSizing: "border-box" as const,
  },
  btnPrimary: {
    backgroundColor: "#0070f3",
    color: "#fff",
    border: "none",
    borderRadius: 6,
    padding: "10px 20px",
    fontSize: 14,
    fontWeight: 600,
    cursor: "pointer",
  },
  btnDanger: {
    backgroundColor: "#dc3545",
    color: "#fff",
    border: "none",
    borderRadius: 6,
    padding: "10px 20px",
    fontSize: 14,
    fontWeight: 600,
    cursor: "pointer",
  },
  btnSmall: {
    backgroundColor: "#f0f0f0",
    color: "#333",
    border: "1px solid #d0d0d0",
    borderRadius: 4,
    padding: "6px 12px",
    fontSize: 12,
    cursor: "pointer",
  },
  btnRemove: {
    backgroundColor: "transparent",
    border: "none",
    color: "#dc3545",
    fontSize: 20,
    cursor: "pointer",
    padding: "0 6px",
  },
  radioCard: {
    display: "flex",
    alignItems: "flex-start",
    padding: "12px 16px",
    border: "2px solid",
    borderRadius: 8,
    cursor: "pointer",
    flex: "1 1 200px",
  },
  statsRow: {
    display: "flex",
    gap: 32,
  },
  stat: {
    textAlign: "center" as const,
  },
  statValue: {
    fontSize: 20,
    fontWeight: 700,
    color: "#0070f3",
  },
  statLabel: {
    fontSize: 12,
    color: "#888",
    marginTop: 4,
  },
};
