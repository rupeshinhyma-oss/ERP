/**
 * HRMS WFH Requests & Manager Approval Queue Page.
 *
 * Provides:
 * - Manager Approval Queue: Pending employee WFH requests requiring approval/rejection
 * - My Requests tab: Current employee's submitted requests and real-time status
 * - Quick "Request WFH" modal trigger
 * - Review modal to approve or reject with manager remarks
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import { AppShell } from "@/components/AppShell";
import { Breadcrumb } from "@/components/Breadcrumb";
import { Banner, Modal, StatusBadge } from "@/components/ui";
import {
  IconBriefcase,
  IconClock,
  IconPin,
  IconShield,
} from "@/components/icons";
import { LocationMapPicker } from "@/components/hrms/LocationMapPicker";
import { WfhRequestModal } from "@/components/hrms/WfhRequestModal";
import { apiGet, apiPatch } from "@/lib/api";
import { useAuth } from "@/lib/hooks";

interface WfhRequestItem {
  id: string;
  user_id: string;
  employee_name: string;
  employee_code?: string | null;
  wfh_date: string;
  reason: string;
  address: string;
  latitude: number;
  longitude: number;
  radius_meters: number;
  status: "PENDING" | "APPROVED" | "REJECTED";
  manager_id?: string | null;
  manager_remarks?: string | null;
  submitted_at: string;
  reviewed_at?: string | null;
}

export function HrmsWfhRequestsPage() {
  const { profile, isSuperAdmin } = useAuth();
  const [activeTab, setActiveTab] = useState<"pending" | "my">("pending");
  const [pendingRequests, setPendingRequests] = useState<WfhRequestItem[]>([]);
  const [myRequests, setMyRequests] = useState<WfhRequestItem[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<unknown>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);

  // New Request modal
  const [isWfhModalOpen, setIsWfhModalOpen] = useState(false);

  // Review modal state (Manager)
  const [reviewTarget, setReviewTarget] = useState<WfhRequestItem | null>(null);
  const [managerRemarks, setManagerRemarks] = useState("");
  const [isSubmittingReview, setIsSubmittingReview] = useState(false);

  // Map preview modal
  const [mapPreviewTarget, setMapPreviewTarget] = useState<WfhRequestItem | null>(null);

  // Check HR/Admin role
  const isHrAdmin = useMemo(() => {
    if (isSuperAdmin) return true;
    const userRole = String(profile?.role || "").toLowerCase();
    const roles = Array.isArray(profile?.roles) ? profile.roles.map((r) => String(r).toLowerCase()) : [];
    return isSuperAdmin || ["admin", "hr", "hr_manager", "super_admin", "manager"].includes(userRole) || roles.some((r) => ["admin", "hr", "hr_manager", "super_admin", "manager"].includes(r));
  }, [profile, isSuperAdmin]);

  // Load data
  const loadData = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    try {
      const [pendRes, myRes] = await Promise.all([
        apiGet<WfhRequestItem[]>("/api/v1/hrms/wfh-requests/pending").catch(() => null),
        apiGet<WfhRequestItem[]>("/api/v1/hrms/wfh-requests/my").catch(() => null),
      ]);
      setPendingRequests(pendRes?.data || []);
      setMyRequests(myRes?.data || []);
    } catch (err) {
      console.error("Failed to load WFH requests:", err);
      setError(err);
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    loadData();
  }, [loadData]);

  // Auto-dismiss success notification
  useEffect(() => {
    if (!successMsg) return;
    const timer = setTimeout(() => setSuccessMsg(null), 4000);
    return () => clearTimeout(timer);
  }, [successMsg]);

  // Open review modal
  const handleOpenReview = (req: WfhRequestItem) => {
    setReviewTarget(req);
    setManagerRemarks("");
  };

  // Submit approval or rejection
  const handleReviewAction = async (status: "APPROVED" | "REJECTED") => {
    if (!reviewTarget) return;
    setIsSubmittingReview(true);
    setError(null);
    try {
      await apiPatch(`/api/v1/hrms/wfh-requests/${reviewTarget.id}/review`, {
        status,
        manager_remarks: managerRemarks.trim() || undefined,
      });

      const actionLabel = status === "APPROVED" ? "approved" : "rejected";
      setSuccessMsg(`WFH request for ${reviewTarget.employee_name} ${actionLabel}!`);
      setReviewTarget(null);
      loadData();
    } catch (err) {
      console.error("Failed to review WFH request:", err);
      setError(err);
    } finally {
      setIsSubmittingReview(false);
    }
  };

  const currentList = activeTab === "pending" ? pendingRequests : myRequests;

  return (
    <AppShell activeKey="hrms">
      <main className="page" data-testid="hrms-wfh-requests-page">
        <Breadcrumb trail={["HRMS", "WFH Location Requests"]} />

        <Banner error={error} success={successMsg} />

        {/* Page Header */}
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            marginBottom: "20px",
            flexWrap: "wrap",
            gap: "12px",
          }}
        >
          <div>
            <h1
              style={{
                fontSize: "22px",
                fontWeight: 700,
                color: "var(--color-text)",
                margin: "0 0 4px 0",
              }}
            >
              Work From Home (WFH) Requests
            </h1>
            <p style={{ margin: 0, fontSize: "13.5px", color: "var(--color-muted)" }}>
              Manage remote workspace submissions, map-confirmed pins, and manager approval workflows.
            </p>
          </div>

          <button
            type="button"
            className="btn btn-primary"
            onClick={() => setIsWfhModalOpen(true)}
            data-testid="request-wfh-btn"
            style={{ display: "inline-flex", alignItems: "center", gap: "8px", fontWeight: 600 }}
          >
            <IconBriefcase width={16} height={16} />
            <span>Request WFH</span>
          </button>
        </div>

        {/* Navigation Tabs */}
        <div style={{ display: "flex", gap: "8px", marginBottom: "16px", borderBottom: "1px solid var(--color-border)" }}>
          <button
            type="button"
            className={`tab-btn ${activeTab === "pending" ? "active" : ""}`}
            onClick={() => setActiveTab("pending")}
            data-testid="tab-pending-queue"
            style={{
              padding: "10px 18px",
              background: "none",
              border: "none",
              borderBottom: activeTab === "pending" ? "2px solid var(--color-primary)" : "2px solid transparent",
              fontWeight: activeTab === "pending" ? 700 : 500,
              color: activeTab === "pending" ? "var(--color-primary)" : "var(--color-muted)",
              cursor: "pointer",
              display: "flex",
              alignItems: "center",
              gap: "8px",
            }}
          >
            <IconShield width={16} height={16} />
            <span>Manager Approval Queue</span>
            {pendingRequests.length > 0 && (
              <span
                style={{
                  background: "var(--color-primary)",
                  color: "#ffffff",
                  fontSize: "11px",
                  fontWeight: 700,
                  borderRadius: "10px",
                  padding: "1px 7px",
                }}
              >
                {pendingRequests.length}
              </span>
            )}
          </button>

          <button
            type="button"
            className={`tab-btn ${activeTab === "my" ? "active" : ""}`}
            onClick={() => setActiveTab("my")}
            data-testid="tab-my-requests"
            style={{
              padding: "10px 18px",
              background: "none",
              border: "none",
              borderBottom: activeTab === "my" ? "2px solid var(--color-primary)" : "2px solid transparent",
              fontWeight: activeTab === "my" ? 700 : 500,
              color: activeTab === "my" ? "var(--color-primary)" : "var(--color-muted)",
              cursor: "pointer",
              display: "flex",
              alignItems: "center",
              gap: "8px",
            }}
          >
            <IconClock width={16} height={16} />
            <span>My Requests ({myRequests.length})</span>
          </button>
        </div>

        {/* Table Content */}
        <div className="card" style={{ padding: 0, overflow: "hidden" }}>
          <div className="table-responsive">
            <table className="table" data-testid="wfh-requests-table">
              <thead>
                <tr>
                  <th style={{ width: "20%" }}>Employee</th>
                  <th style={{ width: "12%" }}>WFH Date</th>
                  <th style={{ width: "22%" }}>Reason</th>
                  <th style={{ width: "24%" }}>Confirmed Work Address</th>
                  <th style={{ width: "12%" }}>Submitted</th>
                  <th style={{ width: "10%" }}>Status</th>
                  <th style={{ width: "12%", textAlign: "right" }}>Action</th>
                </tr>
              </thead>
              <tbody>
                {isLoading ? (
                  <tr>
                    <td colSpan={7} style={{ textAlign: "center", padding: "40px" }}>
                      <div className="skeleton-line" style={{ width: "200px", margin: "0 auto 10px" }} />
                      <div style={{ color: "var(--color-muted)", fontSize: "13px" }}>Loading requests...</div>
                    </td>
                  </tr>
                ) : currentList.length === 0 ? (
                  <tr>
                    <td colSpan={7} style={{ textAlign: "center", padding: "40px" }}>
                      <IconBriefcase width={32} height={32} style={{ color: "var(--color-muted)", marginBottom: "8px" }} />
                      <div style={{ fontWeight: 600, color: "var(--color-text)", marginBottom: "4px" }}>
                        {activeTab === "pending"
                          ? "No pending requests in queue"
                          : "You have not submitted any WFH requests yet."}
                      </div>
                      <div style={{ fontSize: "13px", color: "var(--color-muted)" }}>
                        {activeTab === "pending"
                          ? "All employee submissions are up to date."
                          : "Use the 'Request WFH' button above to submit a new remote request."}
                      </div>
                    </td>
                  </tr>
                ) : (
                  currentList.map((req) => (
                    <tr key={req.id} data-testid={`wfh-row-${req.id}`}>
                      <td>
                        <div style={{ fontWeight: 600, color: "var(--color-text)" }}>{req.employee_name}</div>
                        <div style={{ fontSize: "11.5px", color: "var(--color-muted)" }}>
                          {req.employee_code || "Staff Member"}
                        </div>
                      </td>
                      <td>
                        <div style={{ fontWeight: 600, color: "var(--color-text)" }}>{req.wfh_date}</div>
                      </td>
                      <td>
                        <div
                          title={req.reason}
                          style={{
                            maxWidth: "220px",
                            whiteSpace: "nowrap",
                            overflow: "hidden",
                            textOverflow: "ellipsis",
                            fontSize: "13px",
                          }}
                        >
                          {req.reason}
                        </div>
                      </td>
                      <td>
                        <div style={{ display: "flex", flexDirection: "column", gap: "3px" }}>
                          <div
                            title={req.address}
                            style={{
                              maxWidth: "240px",
                              whiteSpace: "nowrap",
                              overflow: "hidden",
                              textOverflow: "ellipsis",
                              fontSize: "13px",
                              color: "var(--color-text)",
                            }}
                          >
                            {req.address}
                          </div>
                          <button
                            type="button"
                            onClick={() => setMapPreviewTarget(req)}
                            data-testid={`preview-map-btn-${req.id}`}
                            style={{
                              border: "none",
                              background: "none",
                              padding: 0,
                              color: "var(--color-primary)",
                              fontSize: "11.5px",
                              cursor: "pointer",
                              textAlign: "left",
                              display: "inline-flex",
                              alignItems: "center",
                              gap: "3px",
                            }}
                          >
                            <IconPin width={12} height={12} />
                            <span>
                              {req.latitude.toFixed(4)}, {req.longitude.toFixed(4)} (Preview Map)
                            </span>
                          </button>
                        </div>
                      </td>
                      <td>
                        <div style={{ fontSize: "12px", color: "var(--color-muted)" }}>
                          {new Date(req.submitted_at).toLocaleDateString("en-US", {
                            month: "short",
                            day: "numeric",
                            hour: "2-digit",
                            minute: "2-digit",
                          })}
                        </div>
                      </td>
                      <td>
                        <StatusBadge status={req.status} />
                      </td>
                      <td style={{ textAlign: "right" }}>
                        {activeTab === "pending" ? (
                          <button
                            type="button"
                            className="btn btn-sm btn-primary"
                            onClick={() => handleOpenReview(req)}
                            disabled={!isHrAdmin}
                            title={isHrAdmin ? "Review Submission" : "Manager privileges required"}
                            data-testid={`review-btn-${req.id}`}
                            style={{ padding: "4px 10px", fontSize: "12px", fontWeight: 600 }}
                          >
                            Review
                          </button>
                        ) : (
                          <span style={{ fontSize: "12px", color: "var(--color-muted)" }}>
                            {req.status === "PENDING" ? "Awaiting Decision" : "Completed"}
                          </span>
                        )}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>

        {/* ================================================================= */}
        {/* REVIEW MODAL (MANAGER APPROVE / REJECT)                           */}
        {/* ================================================================= */}
        {reviewTarget && (
          <Modal
            open={Boolean(reviewTarget)}
            variant="center"
            cardStyle={{ width: "100%", maxWidth: "600px" }}
            title={
              <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                <IconShield width={18} height={18} style={{ color: "var(--color-primary)" }} />
                <span>Review WFH Request — {reviewTarget.employee_name}</span>
              </div>
            }
            onClose={() => !isSubmittingReview && setReviewTarget(null)}
          >
            <div style={{ display: "flex", flexDirection: "column", gap: "14px", padding: "14px 0" }}>
              <div
                style={{
                  display: "grid",
                  gridTemplateColumns: "1fr 1fr",
                  gap: "10px",
                  padding: "12px 14px",
                  background: "var(--color-surface-subtle)",
                  borderRadius: "var(--radius-sm, 6px)",
                  fontSize: "12.5px",
                }}
              >
                <div>
                  <div style={{ color: "var(--color-muted)" }}>WFH Date</div>
                  <div style={{ fontWeight: 700, fontSize: "13.5px" }}>{reviewTarget.wfh_date}</div>
                </div>
                <div>
                  <div style={{ color: "var(--color-muted)" }}>Employee Code</div>
                  <div style={{ fontWeight: 600 }}>{reviewTarget.employee_code || "N/A"}</div>
                </div>
                <div style={{ gridColumn: "span 2" }}>
                  <div style={{ color: "var(--color-muted)" }}>Reason</div>
                  <div style={{ fontWeight: 500, color: "var(--color-text)" }}>{reviewTarget.reason}</div>
                </div>
                <div style={{ gridColumn: "span 2" }}>
                  <div style={{ color: "var(--color-muted)" }}>Confirmed Remote Address</div>
                  <div style={{ fontWeight: 500, color: "var(--color-text)" }}>{reviewTarget.address}</div>
                </div>
              </div>

              {/* Map Preview in Review Modal */}
              <div style={{ borderRadius: "6px", overflow: "hidden" }}>
                <LocationMapPicker
                  latitude={reviewTarget.latitude}
                  longitude={reviewTarget.longitude}
                  radiusMeters={reviewTarget.radius_meters || 150}
                  readOnly={true}
                  height="200px"
                />
              </div>

              {/* Optional Manager Remarks */}
              <div>
                <label className="form-label">Manager Remarks / Feedback (Optional)</label>
                <textarea
                  className="form-control"
                  rows={2}
                  placeholder="e.g. Approved. Please ensure client deliverables are updated by 5 PM."
                  value={managerRemarks}
                  onChange={(e) => setManagerRemarks(e.target.value)}
                  data-testid="textarea-manager-remarks"
                />
              </div>
            </div>

            <div
              style={{
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
                gap: "10px",
                paddingTop: "14px",
                borderTop: "1px solid var(--color-border)",
              }}
            >
              <button
                type="button"
                className="btn"
                onClick={() => setReviewTarget(null)}
                disabled={isSubmittingReview}
              >
                Cancel
              </button>

              <div style={{ display: "flex", gap: "10px" }}>
                <button
                  type="button"
                  className="btn"
                  onClick={() => handleReviewAction("REJECTED")}
                  disabled={isSubmittingReview}
                  data-testid="btn-reject-wfh"
                  style={{
                    color: "var(--color-danger, #ef4444)",
                    borderColor: "var(--color-danger, #ef4444)",
                  }}
                >
                  {isSubmittingReview ? "Processing..." : "Reject Request"}
                </button>
                <button
                  type="button"
                  className="btn btn-primary"
                  onClick={() => handleReviewAction("APPROVED")}
                  disabled={isSubmittingReview}
                  data-testid="btn-approve-wfh"
                >
                  {isSubmittingReview ? "Processing..." : "Approve Request"}
                </button>
              </div>
            </div>
          </Modal>
        )}

        {/* ================================================================= */}
        {/* MAP PREVIEW MODAL                                                 */}
        {/* ================================================================= */}
        {mapPreviewTarget && (
          <Modal
            open={Boolean(mapPreviewTarget)}
            variant="center"
            cardStyle={{ width: "100%", maxWidth: "620px" }}
            title={`Confirmed Work Pin — ${mapPreviewTarget.employee_name}`}
            onClose={() => setMapPreviewTarget(null)}
          >
            <div style={{ display: "flex", flexDirection: "column", gap: "12px", padding: "12px 0" }}>
              <div style={{ fontSize: "13px", color: "var(--color-text)" }}>
                <strong>Address:</strong> {mapPreviewTarget.address}
              </div>
              <LocationMapPicker
                latitude={mapPreviewTarget.latitude}
                longitude={mapPreviewTarget.longitude}
                radiusMeters={mapPreviewTarget.radius_meters || 150}
                readOnly={true}
                height="300px"
              />
            </div>
            <div style={{ display: "flex", justifyContent: "flex-end", paddingTop: "12px", borderTop: "1px solid var(--color-border)" }}>
              <button type="button" className="btn" onClick={() => setMapPreviewTarget(null)}>
                Close
              </button>
            </div>
          </Modal>
        )}

        {/* WFH Request Submission Modal */}
        <WfhRequestModal
          open={isWfhModalOpen}
          onClose={() => setIsWfhModalOpen(false)}
          onSuccess={() => {
            setSuccessMsg("Your WFH request has been submitted to your manager.");
            loadData();
          }}
        />
      </main>
    </AppShell>
  );
}
