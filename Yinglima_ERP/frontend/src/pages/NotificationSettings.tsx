import { useCallback, useEffect, useMemo, useState } from "react";
import { AppShell } from "@/components/AppShell";
import { Banner, Modal } from "@/components/ui";
import { useAuth } from "@/lib/auth";
import { apiGet, apiPut } from "@/lib/api";
import type { NotificationRule } from "@/types/notifications";

interface RoleOption {
  id: string;
  name: string;
  description?: string;
}

interface UserOption {
  id: string;
  username: string;
  display_name?: string;
  first_name?: string;
  last_name?: string;
  email?: string;
}

const MODULE_ICONS: Record<string, string> = {
  planning: "📦",
  sales: "💼",
  purchases: "🛒",
  inquiries: "📩",
};

export function NotificationSettings() {
  const { hasPermission } = useAuth();
  const canManage = hasPermission("notification_settings.manage");

  const [rules, setRules] = useState<NotificationRule[]>([]);
  const [roles, setRoles] = useState<RoleOption[]>([]);
  const [users, setUsers] = useState<UserOption[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<unknown>(null);
  const [success, setSuccess] = useState<string | null>(null);

  // Edit Modal State
  const [selectedRule, setSelectedRule] = useState<NotificationRule | null>(null);
  const [modalRoleIds, setModalRoleIds] = useState<string[]>([]);
  const [modalUserIds, setModalUserIds] = useState<string[]>([]);
  const [modalIsActive, setModalIsActive] = useState<boolean>(true);
  const [saving, setSaving] = useState(false);
  const [userSearch, setUserSearch] = useState("");

  const fetchData = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [rulesRes, rolesRes, usersRes] = await Promise.all([
        apiGet<NotificationRule[]>("/notifications/rules"),
        apiGet<any>("/notifications/roles").catch(() => apiGet<any>("/rbac/roles")),
        apiGet<any>("/notifications/users").catch(() => apiGet<any>("/users/all")),
      ]);

      const rList: NotificationRule[] = Array.isArray(rulesRes.data)
        ? rulesRes.data
        : (rulesRes.data as any)?.data || [];
      setRules(rList);

      const roleList: any[] = Array.isArray(rolesRes.data)
        ? rolesRes.data
        : rolesRes.data?.data || [];
      setRoles(
        roleList.map((r) => ({
          id: String(r.id),
          name: r.name || "Unnamed Role",
          description: r.description,
        }))
      );

      const rawUserData = usersRes?.data;
      const userList: any[] = Array.isArray(rawUserData)
        ? rawUserData
        : Array.isArray(rawUserData?.items)
        ? rawUserData.items
        : Array.isArray(rawUserData?.data)
        ? rawUserData.data
        : [];

      setUsers(
        userList.map((u) => ({
          id: String(u.id),
          username: u.username || u.employee_code || "user",
          display_name: u.display_name,
          first_name: u.first_name,
          last_name: u.last_name,
          email: u.email,
        }))
      );
    } catch (err) {
      setError(err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void fetchData();
  }, [fetchData]);

  const rolesMap = useMemo(() => {
    const map = new Map<string, string>();
    roles.forEach((r) => map.set(r.id, r.name));
    return map;
  }, [roles]);

  const usersMap = useMemo(() => {
    const map = new Map<string, string>();
    users.forEach((u) => {
      const full = [u.first_name, u.last_name].filter(Boolean).join(" ");
      map.set(u.id, full || u.display_name || u.username);
    });
    return map;
  }, [users]);

  const handleOpenEdit = (rule: NotificationRule) => {
    setSelectedRule(rule);
    setModalRoleIds(rule.role_ids || []);
    setModalUserIds(rule.user_ids || []);
    setModalIsActive(rule.is_active);
    setUserSearch("");
  };

  const handleSaveRule = async () => {
    if (!selectedRule) return;
    setSaving(true);
    setError(null);
    try {
      await apiPut(`/notifications/rules/${selectedRule.event_key}`, {
        role_ids: modalRoleIds,
        user_ids: modalUserIds,
        is_active: modalIsActive,
      });

      setSuccess(`Notification rule '${selectedRule.title}' updated successfully.`);
      setTimeout(() => setSuccess(null), 4000);
      setSelectedRule(null);
      await fetchData();
    } catch (err) {
      setError(err);
    } finally {
      setSaving(false);
    }
  };

  const handleToggleActiveQuick = async (rule: NotificationRule) => {
    try {
      await apiPut(`/notifications/rules/${rule.event_key}`, {
        is_active: !rule.is_active,
      });
      setRules((prev) =>
        prev.map((r) => (r.id === rule.id ? { ...r, is_active: !r.is_active } : r))
      );
    } catch (err) {
      setError(err);
    }
  };

  const filteredUsers = useMemo(() => {
    if (!userSearch.trim()) return users;
    const q = userSearch.toLowerCase().trim();
    const tokens = q.split(/\s+/).filter(Boolean);

    return users.filter((u) => {
      const full = [u.first_name, u.last_name].filter(Boolean).join(" ");
      const combined = `${full} ${u.username || ""} ${u.display_name || ""} ${u.email || ""} ${u.first_name || ""} ${u.last_name || ""}`.toLowerCase();
      return tokens.every((token) => combined.includes(token));
    });
  }, [users, userSearch]);

  return (
    <AppShell activeKey="notification-settings">
      <main className="page" style={{ padding: "20px 24px", width: "100%", maxWidth: "100%", boxSizing: "border-box" }}>
        {/* Page Title & Context */}
        <div style={{ marginBottom: "20px" }}>
          <div style={{ display: "flex", alignItems: "center", gap: "12px", marginBottom: "6px" }}>
            <span style={{ fontSize: "26px" }}>🔔</span>
            <h1 className="page-title" style={{ margin: 0, fontSize: "22px", fontWeight: 700, color: "#0f172a" }}>
              Notification Rules & Triggers
            </h1>
          </div>
          <p style={{ margin: 0, color: "#64748b", fontSize: "13.5px", lineHeight: "1.5" }}>
            Configure which departments and individual users receive alerts for critical workflows across Shipment Planning, Sales, Purchases, and Inquiries.
          </p>
        </div>

        <Banner error={error} success={success} />

        {/* Rules Table Card */}
        <div
          style={{
            background: "#ffffff",
            borderRadius: "12px",
            border: "1px solid #e2e8f0",
            boxShadow: "0 1px 3px rgba(0,0,0,0.05)",
            overflow: "hidden",
            width: "100%",
            boxSizing: "border-box",
          }}
        >
          <div
            style={{
              padding: "14px 20px",
              borderBottom: "1px solid #e2e8f0",
              background: "#f8fafc",
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center",
            }}
          >
            <div>
              <span style={{ fontSize: "14px", fontWeight: 700, color: "#1e293b" }}>
                Active Workflow Triggers
              </span>
              <span style={{ marginLeft: "8px", fontSize: "12px", color: "#64748b" }}>
                ({rules.length} configured rules)
              </span>
            </div>
            <button
              onClick={() => void fetchData()}
              disabled={loading}
              className="btn btn-secondary"
              style={{ fontSize: "12px", padding: "6px 12px" }}
            >
              🔄 Refresh
            </button>
          </div>

          <div style={{ overflowX: "auto", width: "100%", WebkitOverflowScrolling: "touch" }}>
            <table
              className="table"
              style={{
                width: "100%",
                minWidth: "900px",
                borderCollapse: "collapse",
                tableLayout: "auto",
              }}
            >
              <thead>
                <tr style={{ background: "#f8fafc", borderBottom: "1.5px solid #e2e8f0" }}>
                  <th style={{ padding: "12px 18px", textAlign: "left", fontSize: "12px", fontWeight: 700, color: "#475569", width: "36%" }}>
                    EVENT / WORKFLOW
                  </th>
                  <th style={{ padding: "12px 18px", textAlign: "left", fontSize: "12px", fontWeight: 700, color: "#475569", width: "26%" }}>
                    MAPPED DEPARTMENTS (ROLES)
                  </th>
                  <th style={{ padding: "12px 18px", textAlign: "left", fontSize: "12px", fontWeight: 700, color: "#475569", width: "22%" }}>
                    SPECIFIC USERS
                  </th>
                  <th style={{ padding: "12px 14px", textAlign: "center", fontSize: "12px", fontWeight: 700, color: "#475569", width: "90px" }}>
                    STATUS
                  </th>
                  <th style={{ padding: "12px 18px", textAlign: "center", fontSize: "12px", fontWeight: 700, color: "#475569", width: "100px" }}>
                    ACTION
                  </th>
                </tr>
              </thead>
            <tbody>
              {loading && rules.length === 0 ? (
                <tr>
                  <td colSpan={5} style={{ padding: "32px", textAlign: "center", color: "#64748b" }}>
                    Loading notification rules...
                  </td>
                </tr>
              ) : rules.length === 0 ? (
                <tr>
                  <td colSpan={5} style={{ padding: "32px", textAlign: "center", color: "#64748b" }}>
                    No notification rules configured.
                  </td>
                </tr>
              ) : (
                rules.map((rule) => {
                  const icon = MODULE_ICONS[rule.module] || "🔔";
                  return (
                    <tr
                      key={rule.id}
                      style={{
                        borderBottom: "1px solid #f1f5f9",
                        transition: "background 0.1s ease",
                      }}
                    >
                      {/* Event Title & Description */}
                      <td style={{ padding: "16px 18px", verticalAlign: "top", whiteSpace: "normal" }}>
                        <div style={{ display: "flex", alignItems: "flex-start", gap: "10px" }}>
                          <span style={{ fontSize: "20px", lineHeight: "1" }}>{icon}</span>
                          <div>
                            <div style={{ fontWeight: 600, color: "#0f172a", fontSize: "14px", whiteSpace: "normal" }}>
                              {rule.title}
                            </div>
                            {rule.description && (
                              <div style={{ fontSize: "12.5px", color: "#64748b", marginTop: "3px", whiteSpace: "normal", lineHeight: "1.4" }}>
                                {rule.description}
                              </div>
                            )}
                            <div style={{ marginTop: "6px" }}>
                              <span
                                style={{
                                  fontSize: "11px",
                                  fontWeight: 600,
                                  background: "#f1f5f9",
                                  color: "#475569",
                                  padding: "2px 8px",
                                  borderRadius: "4px",
                                  textTransform: "uppercase",
                                }}
                              >
                                {rule.module}
                              </span>
                            </div>
                          </div>
                        </div>
                      </td>

                      {/* Mapped Departments / Roles */}
                      <td style={{ padding: "16px 18px", verticalAlign: "top", whiteSpace: "normal" }}>
                        {(!rule.role_ids || rule.role_ids.length === 0) ? (
                          <span style={{ fontSize: "12.5px", color: "#94a3b8", fontStyle: "italic" }}>
                            None assigned
                          </span>
                        ) : (
                          <div style={{ display: "flex", flexWrap: "wrap", gap: "6px" }}>
                            {rule.role_ids.map((rid) => (
                              <span
                                key={rid}
                                style={{
                                  background: "#eff6ff",
                                  color: "#1d4ed8",
                                  border: "1px solid #bfdbfe",
                                  borderRadius: "16px",
                                  padding: "3px 10px",
                                  fontSize: "12px",
                                  fontWeight: 600,
                                  whiteSpace: "nowrap",
                                }}
                              >
                                🏢 {rolesMap.get(rid) || "Department"}
                              </span>
                            ))}
                          </div>
                        )}
                      </td>

                      {/* Mapped Specific Users */}
                      <td style={{ padding: "16px 18px", verticalAlign: "top", whiteSpace: "normal" }}>
                        {(!rule.user_ids || rule.user_ids.length === 0) ? (
                          <span style={{ fontSize: "12.5px", color: "#94a3b8", fontStyle: "italic" }}>
                            None assigned
                          </span>
                        ) : (
                          <div style={{ display: "flex", flexWrap: "wrap", gap: "6px" }}>
                            {rule.user_ids.map((uid) => (
                              <span
                                key={uid}
                                style={{
                                  background: "#f0fdf4",
                                  color: "#15803d",
                                  border: "1px solid #bbf7d0",
                                  borderRadius: "16px",
                                  padding: "3px 10px",
                                  fontSize: "12px",
                                  fontWeight: 600,
                                  whiteSpace: "nowrap",
                                }}
                              >
                                👤 {usersMap.get(uid) || "User"}
                              </span>
                            ))}
                          </div>
                        )}
                      </td>

                      {/* Active Status Toggle */}
                      <td style={{ padding: "16px 14px", textAlign: "center", verticalAlign: "middle", whiteSpace: "nowrap" }}>
                        <button
                          onClick={() => {
                            if (canManage) void handleToggleActiveQuick(rule);
                          }}
                          disabled={!canManage}
                          style={{
                            border: "none",
                            background: rule.is_active ? "#10b981" : "#cbd5e1",
                            color: "#ffffff",
                            padding: "4px 12px",
                            borderRadius: "12px",
                            fontSize: "11px",
                            fontWeight: 700,
                            cursor: canManage ? "pointer" : "default",
                            opacity: canManage ? 1 : 0.85,
                            transition: "background 0.2s ease",
                          }}
                          title={
                            !canManage
                              ? "View-only permission (manage permission required to toggle)"
                              : rule.is_active
                              ? "Click to deactivate"
                              : "Click to activate"
                          }
                        >
                          {rule.is_active ? "ACTIVE" : "OFF"}
                        </button>
                      </td>

                      {/* Action */}
                      <td style={{ padding: "16px 18px", textAlign: "center", verticalAlign: "middle", whiteSpace: "nowrap" }}>
                        {canManage ? (
                          <button
                            onClick={() => handleOpenEdit(rule)}
                            className="btn btn-secondary"
                            style={{
                              fontSize: "12.5px",
                              fontWeight: 600,
                              padding: "6px 14px",
                              display: "inline-flex",
                              alignItems: "center",
                              justifyContent: "center",
                              gap: "6px",
                              cursor: "pointer",
                              whiteSpace: "nowrap",
                              boxShadow: "0 1px 2px rgba(0,0,0,0.05)",
                            }}
                          >
                            ✏️ Edit
                          </button>
                        ) : (
                          <span
                            style={{
                              fontSize: "12px",
                              color: "#94a3b8",
                              display: "inline-flex",
                              alignItems: "center",
                              gap: "4px",
                            }}
                          >
                            🔒 Read Only
                          </span>
                        )}
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
          </div>
        </div>

        {/* Edit Rule Modal */}
        {selectedRule && (
          <Modal
            open={Boolean(selectedRule)}
            title={`Configure Rule: ${selectedRule.title}`}
            onClose={() => setSelectedRule(null)}
            variant="center"
            cardStyle={{
              maxWidth: "640px",
              width: "100%",
              maxHeight: "90vh",
              display: "flex",
              flexDirection: "column",
            }}
          >
            <form
              onSubmit={(e) => {
                e.preventDefault();
                void handleSaveRule();
              }}
              style={{
                display: "flex",
                flexDirection: "column",
                flex: 1,
                minHeight: 0,
                maxHeight: "calc(90vh - 65px)",
                overflow: "hidden",
              }}
            >
              <div
                style={{
                  flex: 1,
                  overflowY: "auto",
                  padding: "20px 24px",
                  display: "flex",
                  flexDirection: "column",
                  gap: "20px",
                }}
              >
              {/* Event Description */}
              <div
                style={{
                  background: "#f8fafc",
                  border: "1px solid #e2e8f0",
                  borderRadius: "8px",
                  padding: "12px 14px",
                  marginBottom: "20px",
                  fontSize: "13px",
                  color: "#475569",
                }}
              >
                <strong>Event Trigger:</strong> {selectedRule.description}
              </div>

              {/* Status Toggle */}
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "space-between",
                  padding: "12px 16px",
                  background: "#ffffff",
                  border: "1px solid #e2e8f0",
                  borderRadius: "8px",
                  marginBottom: "20px",
                }}
              >
                <div>
                  <div style={{ fontWeight: 600, fontSize: "13.5px", color: "#1e293b" }}>
                    Enable This Alert
                  </div>
                  <div style={{ fontSize: "12px", color: "#64748b" }}>
                    When disabled, no notifications will be dispatched for this event.
                  </div>
                </div>
                <input
                  type="checkbox"
                  checked={modalIsActive}
                  onChange={(e) => setModalIsActive(e.target.checked)}
                  style={{ width: "20px", height: "20px", cursor: "pointer" }}
                />
              </div>

              {/* Department / Role Selector */}
              <div style={{ marginBottom: "24px" }}>
                <label style={{ display: "block", fontWeight: 700, fontSize: "13.5px", color: "#0f172a", marginBottom: "6px" }}>
                  🏢 Select Departments / Roles to Notify
                </label>
                <div style={{ fontSize: "12px", color: "#64748b", marginBottom: "10px" }}>
                  All active team members assigned to any selected department will receive alerts.
                </div>
                <div
                  style={{
                    display: "grid",
                    gridTemplateColumns: "repeat(auto-fill, minmax(160px, 1fr))",
                    gap: "8px",
                    maxHeight: "180px",
                    overflowY: "auto",
                    padding: "10px",
                    background: "#f8fafc",
                    border: "1px solid #e2e8f0",
                    borderRadius: "8px",
                  }}
                >
                  {roles.map((r) => {
                    const isSelected = modalRoleIds.includes(r.id);
                    return (
                      <div
                        key={r.id}
                        onClick={() => {
                          setModalRoleIds((prev) =>
                            isSelected ? prev.filter((id) => id !== r.id) : [...prev, r.id]
                          );
                        }}
                        style={{
                          padding: "8px 12px",
                          borderRadius: "6px",
                          border: isSelected ? "2px solid #2563eb" : "1px solid #cbd5e1",
                          background: isSelected ? "#eff6ff" : "#ffffff",
                          color: isSelected ? "#1d4ed8" : "#334155",
                          fontWeight: isSelected ? 600 : 500,
                          fontSize: "12.5px",
                          cursor: "pointer",
                          display: "flex",
                          alignItems: "center",
                          gap: "8px",
                          transition: "all 0.15s ease",
                        }}
                      >
                        <input
                          type="checkbox"
                          checked={isSelected}
                          readOnly
                          style={{ pointerEvents: "none" }}
                        />
                        <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                          {r.name}
                        </span>
                      </div>
                    );
                  })}
                </div>
              </div>

              {/* Specific Users Selector */}
              <div style={{ marginBottom: "24px" }}>
                <label style={{ display: "block", fontWeight: 700, fontSize: "13.5px", color: "#0f172a", marginBottom: "6px" }}>
                  👤 Select Specific Users to Notify
                </label>
                <div style={{ fontSize: "12px", color: "#64748b", marginBottom: "10px" }}>
                  Directly notify specific team members, regardless of their department.
                </div>

                <div style={{ position: "relative", marginBottom: "10px" }}>
                  <input
                    type="text"
                    placeholder="🔍 Search users by name, username, or email..."
                    value={userSearch}
                    onChange={(e) => setUserSearch(e.target.value)}
                    className="input"
                    style={{ width: "100%", paddingRight: userSearch ? "32px" : "12px", fontSize: "13px" }}
                  />
                  {userSearch && (
                    <button
                      type="button"
                      onClick={() => setUserSearch("")}
                      style={{
                        position: "absolute",
                        right: "8px",
                        top: "50%",
                        transform: "translateY(-50%)",
                        border: "none",
                        background: "transparent",
                        cursor: "pointer",
                        color: "#94a3b8",
                        fontWeight: "bold",
                        fontSize: "14px",
                      }}
                      title="Clear search"
                    >
                      ✕
                    </button>
                  )}
                </div>

                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "6px", fontSize: "11.5px", color: "#64748b" }}>
                  <span>{filteredUsers.length} user{filteredUsers.length === 1 ? "" : "s"} found</span>
                  {modalUserIds.length > 0 && (
                    <span style={{ color: "#16a34a", fontWeight: 600 }}>
                      {modalUserIds.length} selected
                    </span>
                  )}
                </div>

                <div
                  style={{
                    maxHeight: "240px",
                    overflowY: "auto",
                    border: "1px solid #e2e8f0",
                    borderRadius: "8px",
                    background: "#f8fafc",
                    padding: "6px",
                  }}
                >
                  {filteredUsers.length === 0 ? (
                    <div style={{ padding: "16px", textAlign: "center", color: "#94a3b8", fontSize: "12.5px" }}>
                      No users match your search.
                    </div>
                  ) : (
                    filteredUsers.map((u) => {
                      const isSelected = modalUserIds.includes(u.id);
                      const full = [u.first_name, u.last_name].filter(Boolean).join(" ");
                      return (
                        <div
                          key={u.id}
                          onClick={() => {
                            setModalUserIds((prev) =>
                              isSelected ? prev.filter((id) => id !== u.id) : [...prev, u.id]
                            );
                          }}
                          style={{
                            padding: "8px 12px",
                            borderBottom: "1px solid #f1f5f9",
                            background: isSelected ? "#f0fdf4" : "transparent",
                            cursor: "pointer",
                            display: "flex",
                            alignItems: "center",
                            justifyContent: "space-between",
                            borderRadius: "4px",
                          }}
                        >
                          <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
                            <input
                              type="checkbox"
                              checked={isSelected}
                              readOnly
                              style={{ pointerEvents: "none" }}
                            />
                            <div>
                              <div style={{ fontSize: "13px", fontWeight: isSelected ? 600 : 500, color: "#1e293b" }}>
                                {full || u.display_name || u.username}
                              </div>
                              <div style={{ fontSize: "11px", color: "#64748b" }}>
                                @{u.username} {u.email ? `• ${u.email}` : ""}
                              </div>
                            </div>
                          </div>
                          {isSelected && (
                            <span style={{ fontSize: "11px", fontWeight: 700, color: "#16a34a" }}>
                              SELECTED
                            </span>
                          )}
                        </div>
                      );
                    })
                  )}
                </div>
              </div>

              </div>

              {/* Pinned Modal Actions */}
              <div
                style={{
                  flexShrink: 0,
                  display: "flex",
                  justifyContent: "flex-end",
                  alignItems: "center",
                  gap: "12px",
                  borderTop: "1px solid #e2e8f0",
                  padding: "14px 24px",
                  background: "#ffffff",
                }}
              >
                <button
                  type="button"
                  className="btn btn-secondary"
                  onClick={() => setSelectedRule(null)}
                  disabled={saving}
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="btn btn-primary"
                  disabled={saving}
                  style={{ minWidth: "130px" }}
                >
                  {saving ? "Saving..." : "Save Settings"}
                </button>
              </div>
            </form>
          </Modal>
        )}
      </main>
    </AppShell>
  );
}
export default NotificationSettings;
