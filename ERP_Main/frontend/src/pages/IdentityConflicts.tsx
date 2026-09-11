/**
 * Identity Linking Conflicts Queue for ERP_Main Control Plane.
 *
 * Provides a dedicated administrator queue to resolve AMBIGUOUS_MATCH
 * and CONFLICT states arising from asynchronous identity synchronization.
 */

import { useEffect, useRef, useState } from "react";
import { apiGet, apiPost } from "@/lib/api";
import { useToast } from "@/lib/toast";
import { AppShell } from "@/components/AppShell";
import {
  StatusBadge,
  LoadingSpinner,
  Banner,
  Modal,
  EmptyState,
} from "@/components/ui";
import { ICONS } from "@/components/icons";
import type { IdentityConflict } from "@/types";

export function IdentityConflicts() {
  const toast = useToast();

  const [conflicts, setConflicts] = useState<IdentityConflict[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<unknown>(null);
  const inFlightRef = useRef(false);

  // Resolution Modal State
  const [selectedConflict, setSelectedConflict] = useState<IdentityConflict | null>(null);
  const [resolveAction, setResolveAction] = useState<"LINK" | "CREATE_NEW" | "REJECT">("LINK");
  const [targetGlobalUserId, setTargetGlobalUserId] = useState("");
  const [resolving, setResolving] = useState(false);

  const fetchConflicts = async (silent = false) => {
    if (inFlightRef.current) return;
    inFlightRef.current = true;
    if (!silent) {
      setLoading(true);
    }
    setError(null);
    try {
      const data = await apiGet<IdentityConflict[]>("/global/identity/conflicts");
      setConflicts(Array.isArray(data) ? data : []);
    } catch (err) {
      setError(err);
    } finally {
      inFlightRef.current = false;
      if (!silent) {
        setLoading(false);
      }
    }
  };

  useEffect(() => {
    fetchConflicts();

    // Conservative 30s monitoring poll that pauses when hidden
    const interval = setInterval(() => {
      if (document.visibilityState === "hidden") return;
      fetchConflicts(true);
    }, 30000);

    const handleVisibilityChange = () => {
      if (document.visibilityState === "visible") {
        fetchConflicts(true);
      }
    };
    document.addEventListener("visibilitychange", handleVisibilityChange);

    return () => {
      clearInterval(interval);
      document.removeEventListener("visibilitychange", handleVisibilityChange);
    };
  }, []);

  const handleResolve = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedConflict) return;
    setResolving(true);
    try {
      await apiPost(`/global/identity/conflicts/${selectedConflict.id}/resolve`, {
        action: resolveAction,
        target_global_user_id: resolveAction === "LINK" ? targetGlobalUserId || null : null,
      });

      toast(`Conflict marked as resolved via ${resolveAction}.`, "success");
      setSelectedConflict(null);
      await fetchConflicts();
    } catch (err) {
      toast("Failed to resolve conflict: " + (err instanceof Error ? err.message : String(err)), "error");
    } finally {
      setResolving(false);
    }
  };

  const pendingCount = conflicts.filter((c) => c.status === "PENDING").length;

  return (
    <AppShell
      activeKey="conflicts"
      pageTitle="Identity Linking Conflicts"
      breadcrumbs={["Identity & Access", "Identity Conflicts"]}
    >
      <Banner error={error} />

      <div style={{ marginBottom: "20px" }}>
        <p style={{ margin: 0, fontSize: "14px", color: "var(--color-muted)", maxWidth: "720px" }}>
          The control plane flags conflicts whenever local user creation matches multiple candidate global identities
          or when a candidate identity is already linked to another local account.
        </p>
      </div>

      {loading ? (
        <LoadingSpinner text="Loading conflict queue..." />
      ) : conflicts.length === 0 ? (
        <EmptyState
          title="No Identity Conflicts Found"
          description="All local ERP user identities are currently cleanly linked or registered without ambiguities."
        />
      ) : (
        <>
          <div style={{ marginBottom: "16px", fontSize: "13px", color: "var(--color-muted)" }}>
            Queue Status: <strong>{pendingCount}</strong> pending resolution, <strong>{conflicts.length}</strong> total
          </div>

          <div className="card" style={{ padding: 0, overflow: "hidden" }}>
            <div className="table-wrap">
              <table className="table">
                <thead>
                  <tr>
                    <th>Conflict Type</th>
                    <th>Normalized Email</th>
                    <th>Source ERP Instance</th>
                    <th>Local User ID</th>
                    <th>Status</th>
                    <th>Detected At</th>
                    <th style={{ textAlign: "right" }}>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {conflicts.map((conflict) => (
                    <tr key={conflict.id}>
                      <td>
                        <StatusBadge status={conflict.conflict_type} />
                      </td>
                      <td>
                        <div style={{ fontWeight: 700, fontSize: "14px", color: "var(--color-text)" }}>
                          {conflict.normalized_email}
                        </div>
                        <div style={{ fontSize: "11px", color: "var(--color-muted)", fontFamily: "monospace" }}>
                          ID: {conflict.id.slice(0, 8)}...
                        </div>
                      </td>
                      <td style={{ fontSize: "13px" }}>
                        {conflict.erp_name || conflict.erp_instance_id.slice(0, 8)}
                      </td>
                      <td style={{ fontFamily: "monospace", fontSize: "12px", color: "var(--color-primary)" }}>
                        {conflict.local_user_id}
                      </td>
                      <td>
                        <StatusBadge status={conflict.status} />
                      </td>
                      <td style={{ fontSize: "12px", color: "var(--color-muted)" }}>
                        {new Date(conflict.created_at).toLocaleString()}
                      </td>
                      <td style={{ textAlign: "right" }}>
                        {conflict.status === "PENDING" ? (
                          <button
                            type="button"
                            className="btn btn-sm btn-primary"
                            onClick={() => {
                              setSelectedConflict(conflict);
                              setResolveAction("LINK");
                              setTargetGlobalUserId(
                                conflict.candidate_global_user_ids && conflict.candidate_global_user_ids.length > 0
                                  ? conflict.candidate_global_user_ids[0]
                                  : ""
                              );
                            }}
                          >
                            Resolve
                          </button>
                        ) : (
                          <span style={{ fontSize: "12px", color: "var(--color-muted)" }}>
                            Resolved ({conflict.resolution_action})
                          </span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </>
      )}

      {/* Resolve Conflict Modal */}
      <Modal
        open={Boolean(selectedConflict)}
        onClose={() => setSelectedConflict(null)}
        title="Resolve Identity Linking Conflict"
        variant="center"
        cardStyle={{ maxWidth: "540px" }}
      >
        <form onSubmit={handleResolve} style={{ display: "flex", flexDirection: "column", gap: "16px" }}>
          <div className="conflict-card" style={{ margin: 0 }}>
            <div className="conflict-title">
              <ICONS.alertTriangle width={18} height={18} />
              {selectedConflict?.conflict_type === "AMBIGUOUS_MATCH"
                ? "Ambiguous Match Detected"
                : "Conflicting Global Identity Association"}
            </div>
            <div style={{ fontSize: "13px", marginTop: "6px" }}>
              Email: <strong>{selectedConflict?.normalized_email}</strong> <br />
              Local ERP User: <code style={{ fontSize: "12px" }}>{selectedConflict?.local_user_id}</code>
            </div>
          </div>

          <div className="form-group">
            <label className="form-label">Select Resolution Action *</label>
            <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
              <label style={{ display: "flex", alignItems: "flex-start", gap: "8px", fontSize: "13px", cursor: "pointer" }}>
                <input
                  type="radio"
                  name="action"
                  value="LINK"
                  checked={resolveAction === "LINK"}
                  onChange={() => setResolveAction("LINK")}
                />
                <div>
                  <strong>Link to an existing candidate Global User</strong>
                  <div style={{ color: "var(--color-muted)", fontSize: "12px" }}>
                    Associates this local user with the selected Global User and creates the membership.
                  </div>
                </div>
              </label>

              <label style={{ display: "flex", alignItems: "flex-start", gap: "8px", fontSize: "13px", cursor: "pointer" }}>
                <input
                  type="radio"
                  name="action"
                  value="CREATE_NEW"
                  checked={resolveAction === "CREATE_NEW"}
                  onChange={() => setResolveAction("CREATE_NEW")}
                />
                <div>
                  <strong>Create a brand new Global User</strong>
                  <div style={{ color: "var(--color-muted)", fontSize: "12px" }}>
                    Creates a separate Global User identity for this user rather than linking to candidate matches.
                  </div>
                </div>
              </label>

              <label style={{ display: "flex", alignItems: "flex-start", gap: "8px", fontSize: "13px", cursor: "pointer" }}>
                <input
                  type="radio"
                  name="action"
                  value="REJECT"
                  checked={resolveAction === "REJECT"}
                  onChange={() => setResolveAction("REJECT")}
                />
                <div>
                  <strong>Reject identity link</strong>
                  <div style={{ color: "var(--color-muted)", fontSize: "12px" }}>
                    Marks the conflict rejected. The local ERP user remains unlinked from any global identity.
                  </div>
                </div>
              </label>
            </div>
          </div>

          {resolveAction === "LINK" && (
            <div className="form-group">
              <label className="form-label" htmlFor="targetUser">
                Target Global User ID *
              </label>
              {selectedConflict?.candidate_global_user_ids && selectedConflict.candidate_global_user_ids.length > 0 ? (
                <select
                  id="targetUser"
                  className="form-select"
                  value={targetGlobalUserId}
                  onChange={(e) => setTargetGlobalUserId(e.target.value)}
                  required
                >
                  {selectedConflict.candidate_global_user_ids.map((id) => (
                    <option key={id} value={id}>
                      Candidate ID: {id}
                    </option>
                  ))}
                </select>
              ) : (
                <input
                  id="targetUser"
                  type="text"
                  className="form-input"
                  placeholder="UUID of target GlobalUser"
                  value={targetGlobalUserId}
                  onChange={(e) => setTargetGlobalUserId(e.target.value)}
                  required
                />
              )}
            </div>
          )}

          <div style={{ display: "flex", justifyContent: "flex-end", gap: "10px", marginTop: "12px" }}>
            <button
              type="button"
              className="btn btn-secondary"
              onClick={() => setSelectedConflict(null)}
              disabled={resolving}
            >
              Cancel
            </button>
            <button type="submit" className="btn btn-primary" disabled={resolving}>
              {resolving ? "Resolving..." : "Apply Resolution"}
            </button>
          </div>
        </form>
      </Modal>
    </AppShell>
  );
}
