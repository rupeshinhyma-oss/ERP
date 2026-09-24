/**
 * Organization Setup Page
 *
 * Simplified into exactly three dedicated tabs:
 * 1. Leave Types: Clean table with Leave Name, Paid/Unpaid, Created By, Updated By, Status Toggle, Edit Icon
 * 2. Expense Settings: Expense Categories, Approval Rules, Mileage Settings
 * 3. Geo Fencing: Office punch location configuration with Google Maps search, interactive map,
 *    instant radius selection (50m–1000m), verification card, and persistent backend storage.
 *
 * (Designations, Departments, Employment Types, and Branches have been removed from this page).
 */

import { useCallback, useEffect, useState } from "react";
import { useLocation } from "react-router-dom";
import { AppShell } from "@/components/AppShell";
import { Breadcrumb } from "@/components/Breadcrumb";
import { Banner, Modal } from "@/components/ui";
import {
  IconBuilding,
  IconCheckSquare,
  IconClock,
  IconEdit,
  IconFileText,
  IconMap,
  IconPin,
  IconPlus,
} from "@/components/icons";
import { AddressMapConfirmModal, type AddressMapConfirmData } from "@/components/hrms/AddressMapConfirmModal";
import { GeoFencing } from "@/pages/hrms/GeoFencing";
import { apiGet, apiPatch, apiPost, apiPut } from "@/lib/api";

export interface LeaveTypeItem {
  id: string;
  name: string;
  is_paid: boolean;
  annual_quota: number;
  created_by: string;
  updated_by: string;
  is_active: boolean;
}

export interface HrmsOfficeLocation {
  id: string;
  name: string;
  location_type: "OFFICE" | "BRANCH" | "WAREHOUSE" | "FACTORY" | "CLIENT_SITE" | "OTHER";
  address: string;
  latitude: number;
  longitude: number;
  radius_meters: number;
  place_id?: string | null;
  is_active: boolean;
  created_at?: string;
  updated_at?: string;
}

const INITIAL_LEAVE_TYPES: LeaveTypeItem[] = [
  {
    id: "lt-1",
    name: "Casual Leave (CL)",
    is_paid: true,
    annual_quota: 12,
    created_by: "Admin",
    updated_by: "Admin",
    is_active: true,
  },
  {
    id: "lt-2",
    name: "Sick Leave (SL)",
    is_paid: true,
    annual_quota: 10,
    created_by: "Admin",
    updated_by: "Admin",
    is_active: true,
  },
  {
    id: "lt-3",
    name: "Earned / Privilege Leave (PL)",
    is_paid: true,
    annual_quota: 15,
    created_by: "Admin",
    updated_by: "Admin",
    is_active: true,
  },
  {
    id: "lt-4",
    name: "Maternity Leave",
    is_paid: true,
    annual_quota: 180,
    created_by: "HR Admin",
    updated_by: "Admin",
    is_active: true,
  },
  {
    id: "lt-5",
    name: "Paternity Leave",
    is_paid: true,
    annual_quota: 15,
    created_by: "HR Admin",
    updated_by: "Admin",
    is_active: true,
  },
  {
    id: "lt-6",
    name: "Loss of Pay (Unpaid Leave)",
    is_paid: false,
    annual_quota: 0,
    created_by: "Admin",
    updated_by: "Admin",
    is_active: true,
  },
];

export function OrganizationPage() {
  const [activeTab, setActiveTab] = useState<"leave-types" | "expense-settings" | "geo-fencing">("leave-types");

  // Notifications
  const [success, setSuccess] = useState<string | null>(null);
  const [error, setError] = useState<unknown>(null);

  useEffect(() => {
    if (!success) return;
    const t = setTimeout(() => setSuccess(null), 4000);
    return () => clearTimeout(t);
  }, [success]);

  // ---------------------------------------------------------------------------
  // TAB 1: LEAVE TYPES STATE
  // ---------------------------------------------------------------------------
  const [leaveTypes, setLeaveTypes] = useState<LeaveTypeItem[]>(INITIAL_LEAVE_TYPES);
  const [editingLeave, setEditingLeave] = useState<LeaveTypeItem | null>(null);
  const [leaveModalOpen, setLeaveModalOpen] = useState(false);
  const [leaveForm, setLeaveForm] = useState({ name: "", is_paid: true, annual_quota: 12 });

  const handleOpenAddLeave = () => {
    setEditingLeave(null);
    setLeaveForm({ name: "", is_paid: true, annual_quota: 12 });
    setLeaveModalOpen(true);
  };

  const handleOpenEditLeave = (item: LeaveTypeItem) => {
    setEditingLeave(item);
    setLeaveForm({ name: item.name, is_paid: item.is_paid, annual_quota: item.annual_quota });
    setLeaveModalOpen(true);
  };

  const handleSaveLeave = (e: React.FormEvent) => {
    e.preventDefault();
    if (!leaveForm.name.trim()) return;

    if (editingLeave) {
      setLeaveTypes((prev) =>
        prev.map((lt) =>
          lt.id === editingLeave.id
            ? {
                ...lt,
                name: leaveForm.name.trim(),
                is_paid: leaveForm.is_paid,
                annual_quota: Number(leaveForm.annual_quota) || 0,
                updated_by: "Admin",
              }
            : lt
        )
      );
      setSuccess(`Updated leave type "${leaveForm.name.trim()}".`);
    } else {
      const newLt: LeaveTypeItem = {
        id: `lt-${Date.now()}`,
        name: leaveForm.name.trim(),
        is_paid: leaveForm.is_paid,
        annual_quota: Number(leaveForm.annual_quota) || 0,
        created_by: "Admin",
        updated_by: "Admin",
        is_active: true,
      };
      setLeaveTypes((prev) => [...prev, newLt]);
      setSuccess(`Added leave type "${newLt.name}".`);
    }
    setLeaveModalOpen(false);
  };

  const handleToggleLeaveStatus = (id: string) => {
    setLeaveTypes((prev) =>
      prev.map((lt) => (lt.id === id ? { ...lt, is_active: !lt.is_active } : lt))
    );
  };

  // ---------------------------------------------------------------------------
  // TAB 2: EXPENSE SETTINGS STATE
  // ---------------------------------------------------------------------------
  const [expenseCategories, setExpenseCategories] = useState<string[]>([
    "Local Travel & Conveyance",
    "Meals & Entertainment",
    "Fuel & Mileage",
    "Hotel & Accommodation",
    "Office Supplies & Stationery",
    "Client Hospitality",
  ]);
  const [newCategoryName, setNewCategoryName] = useState("");
  const [autoApproveLimit, setAutoApproveLimit] = useState("1000");
  const [multiTierLimit, setMultiTierLimit] = useState("10000");
  const [receiptMandatoryLimit, setReceiptMandatoryLimit] = useState("500");
  const [twoWheelerRate, setTwoWheelerRate] = useState("5.50");
  const [fourWheelerRate, setFourWheelerRate] = useState("12.00");
  const [requireGpsTracking, setRequireGpsTracking] = useState(true);

  const handleAddExpenseCategory = (e: React.FormEvent) => {
    e.preventDefault();
    if (!newCategoryName.trim()) return;
    if (expenseCategories.includes(newCategoryName.trim())) return;
    setExpenseCategories((prev) => [...prev, newCategoryName.trim()]);
    setNewCategoryName("");
    setSuccess("Added expense category.");
  };

  const handleRemoveCategory = (cat: string) => {
    setExpenseCategories((prev) => prev.filter((c) => c !== cat));
  };

  const handleSaveExpenseSettings = (e: React.FormEvent) => {
    e.preventDefault();
    setSuccess("Expense Settings saved successfully.");
  };

  const location = useLocation();
  const isHrmsSetup = location.pathname.startsWith("/hrms");

  return (
    <AppShell activeKey={isHrmsSetup ? "hrms" : "organization"}>
      <main className="page" style={{ maxWidth: "1200px", margin: "0 auto", padding: "20px 24px" }}>
        <Breadcrumb trail={isHrmsSetup ? ["Dashboard", "HRMS", "Setup"] : ["Settings", "Organization Setup"]} />

        <div className="page-header" style={{ marginBottom: "20px" }}>
          <div>
            <h1 style={{ fontSize: "24px", fontWeight: 700, margin: 0, color: "var(--color-text)" }}>
              {isHrmsSetup ? "HRMS Setup" : "Organization Setup"}
            </h1>
            <div className="page-subtitle" style={{ fontSize: "13px", color: "var(--color-muted)", marginTop: "4px" }}>
              Configure leave policies, expense parameters, and verified office punch locations.
            </div>
          </div>
        </div>

        <Banner error={error} success={success} />

        {/* HORIZONTAL TABS (Blue Active Underline) */}
        <div
          style={{
            display: "flex",
            gap: "24px",
            borderBottom: "2px solid var(--color-border)",
            marginBottom: "24px",
          }}
        >
          <button
            type="button"
            onClick={() => setActiveTab("leave-types")}
            style={{
              padding: "10px 4px",
              background: "none",
              border: "none",
              borderBottom: activeTab === "leave-types" ? "2px solid #2563eb" : "2px solid transparent",
              marginBottom: "-2px",
              fontSize: "14px",
              fontWeight: 600,
              color: activeTab === "leave-types" ? "#2563eb" : "var(--color-muted)",
              cursor: "pointer",
              display: "flex",
              alignItems: "center",
              gap: "8px",
            }}
          >
            <IconFileText width={16} height={16} />
            <span>Leave Types</span>
          </button>

          <button
            type="button"
            onClick={() => setActiveTab("expense-settings")}
            style={{
              padding: "10px 4px",
              background: "none",
              border: "none",
              borderBottom: activeTab === "expense-settings" ? "2px solid #2563eb" : "2px solid transparent",
              marginBottom: "-2px",
              fontSize: "14px",
              fontWeight: 600,
              color: activeTab === "expense-settings" ? "#2563eb" : "var(--color-muted)",
              cursor: "pointer",
              display: "flex",
              alignItems: "center",
              gap: "8px",
            }}
          >
            <IconClock width={16} height={16} />
            <span>Expense Settings</span>
          </button>

          <button
            type="button"
            onClick={() => setActiveTab("geo-fencing")}
            style={{
              padding: "10px 4px",
              background: "none",
              border: "none",
              borderBottom: activeTab === "geo-fencing" ? "2px solid #2563eb" : "2px solid transparent",
              marginBottom: "-2px",
              fontSize: "14px",
              fontWeight: 600,
              color: activeTab === "geo-fencing" ? "#2563eb" : "var(--color-muted)",
              cursor: "pointer",
              display: "flex",
              alignItems: "center",
              gap: "8px",
            }}
          >
            <IconPin width={16} height={16} />
            <span>Geo Fencing</span>
          </button>
        </div>

        {/* ------------------------------------------------------------------- */}
        {/* TAB 1: LEAVE TYPES                                                 */}
        {/* ------------------------------------------------------------------- */}
        {activeTab === "leave-types" && (
          <div className="card" style={{ padding: "20px 24px" }}>
            <div
              style={{
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
                marginBottom: "16px",
              }}
            >
              <div>
                <h2 style={{ fontSize: "16px", fontWeight: 700, margin: 0 }}>Company Leave Types</h2>
                <span style={{ fontSize: "12.5px", color: "var(--color-muted)" }}>
                  Standard leave entitlements applied to annual employee balances.
                </span>
              </div>
              <button
                type="button"
                className="btn btn-primary"
                onClick={handleOpenAddLeave}
                style={{ display: "inline-flex", alignItems: "center", gap: "6px" }}
              >
                <IconPlus width={15} height={15} />
                <span>Add Leave Type</span>
              </button>
            </div>

            <div className="table-responsive" style={{ border: "1px solid var(--color-border)", borderRadius: "var(--radius-sm)" }}>
              <table className="table" style={{ width: "100%", margin: 0 }}>
                <thead>
                  <tr style={{ background: "var(--color-bg)" }}>
                    <th style={{ padding: "12px 16px", textAlign: "left", fontSize: "12px" }}>Leave Name</th>
                    <th style={{ padding: "12px 16px", textAlign: "left", fontSize: "12px" }}>Paid / Unpaid</th>
                    <th style={{ padding: "12px 16px", textAlign: "left", fontSize: "12px" }}>Annual Quota</th>
                    <th style={{ padding: "12px 16px", textAlign: "left", fontSize: "12px" }}>Created By</th>
                    <th style={{ padding: "12px 16px", textAlign: "left", fontSize: "12px" }}>Updated By</th>
                    <th style={{ padding: "12px 16px", textAlign: "center", fontSize: "12px" }}>Status Toggle</th>
                    <th style={{ padding: "12px 16px", textAlign: "center", fontSize: "12px" }}>Action</th>
                  </tr>
                </thead>
                <tbody>
                  {leaveTypes.map((lt) => (
                    <tr key={lt.id} style={{ borderBottom: "1px solid var(--color-border)" }}>
                      <td style={{ padding: "14px 16px", fontWeight: 600, color: "var(--color-text)" }}>
                        {lt.name}
                      </td>
                      <td style={{ padding: "14px 16px" }}>
                        <span
                          style={{
                            padding: "3px 8px",
                            borderRadius: "12px",
                            fontSize: "11px",
                            fontWeight: 700,
                            background: lt.is_paid ? "var(--color-success-soft, #dcfce7)" : "var(--color-bg)",
                            color: lt.is_paid ? "var(--color-success, #16a34a)" : "var(--color-muted)",
                          }}
                        >
                          {lt.is_paid ? "Paid" : "Unpaid"}
                        </span>
                      </td>
                      <td style={{ padding: "14px 16px", color: "var(--color-text)" }}>
                        {lt.annual_quota > 0 ? `${lt.annual_quota} Days / Year` : "As Approved"}
                      </td>
                      <td style={{ padding: "14px 16px", color: "var(--color-muted)", fontSize: "12px" }}>
                        {lt.created_by}
                      </td>
                      <td style={{ padding: "14px 16px", color: "var(--color-muted)", fontSize: "12px" }}>
                        {lt.updated_by}
                      </td>
                      <td style={{ padding: "14px 16px", textAlign: "center" }}>
                        <button
                          type="button"
                          onClick={() => handleToggleLeaveStatus(lt.id)}
                          style={{
                            padding: "3px 10px",
                            borderRadius: "12px",
                            fontSize: "11px",
                            fontWeight: 600,
                            border: "none",
                            cursor: "pointer",
                            background: lt.is_active ? "#dcfce7" : "#fee2e2",
                            color: lt.is_active ? "#16a34a" : "#dc2626",
                          }}
                        >
                          {lt.is_active ? "Active" : "Inactive"}
                        </button>
                      </td>
                      <td style={{ padding: "14px 16px", textAlign: "center" }}>
                        <button
                          type="button"
                          className="btn btn-sm btn-secondary"
                          onClick={() => handleOpenEditLeave(lt)}
                          title="Edit Leave Policy"
                          style={{ padding: "4px 8px" }}
                        >
                          <IconEdit width={14} height={14} />
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* ------------------------------------------------------------------- */}
        {/* TAB 2: EXPENSE SETTINGS                                             */}
        {/* ------------------------------------------------------------------- */}
        {activeTab === "expense-settings" && (
          <form onSubmit={handleSaveExpenseSettings} style={{ display: "flex", flexDirection: "column", gap: "20px" }}>
            {/* Section 1: Expense Categories */}
            <div className="card" style={{ padding: "20px 24px" }}>
              <h2 style={{ fontSize: "16px", fontWeight: 700, margin: "0 0 4px 0" }}>Expense Categories</h2>
              <span style={{ fontSize: "12.5px", color: "var(--color-muted)" }}>
                Categories available when employees file reimbursement claims.
              </span>

              <div style={{ display: "flex", flexWrap: "wrap", gap: "8px", marginTop: "14px" }}>
                {expenseCategories.map((cat) => (
                  <div
                    key={cat}
                    style={{
                      display: "inline-flex",
                      alignItems: "center",
                      gap: "6px",
                      padding: "6px 12px",
                      borderRadius: "var(--radius-sm)",
                      background: "var(--color-bg)",
                      border: "1px solid var(--color-border)",
                      fontSize: "12.5px",
                      fontWeight: 500,
                    }}
                  >
                    <span>{cat}</span>
                    <button
                      type="button"
                      onClick={() => handleRemoveCategory(cat)}
                      style={{
                        background: "none",
                        border: "none",
                        color: "var(--color-muted)",
                        cursor: "pointer",
                        fontWeight: 700,
                        padding: "0 2px",
                      }}
                      title="Remove category"
                    >
                      &times;
                    </button>
                  </div>
                ))}
              </div>

              <div style={{ display: "flex", gap: "10px", marginTop: "16px", maxWidth: "420px" }}>
                <input
                  type="text"
                  className="form-control"
                  placeholder="New category name..."
                  value={newCategoryName}
                  onChange={(e) => setNewCategoryName(e.target.value)}
                />
                <button type="button" className="btn btn-secondary" onClick={handleAddExpenseCategory}>
                  Add Category
                </button>
              </div>
            </div>

            {/* Section 2: Approval Rules */}
            <div className="card" style={{ padding: "20px 24px" }}>
              <h2 style={{ fontSize: "16px", fontWeight: 700, margin: "0 0 4px 0" }}>Approval Rules</h2>
              <span style={{ fontSize: "12.5px", color: "var(--color-muted)" }}>
                Limits and thresholds governing manager verification and multi-tier approvals.
              </span>

              <div
                style={{
                  display: "grid",
                  gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))",
                  gap: "16px",
                  marginTop: "16px",
                }}
              >
                <div className="form-group">
                  <label className="form-label">Auto-Approval Threshold (₹)</label>
                  <input
                    type="number"
                    className="form-control"
                    value={autoApproveLimit}
                    onChange={(e) => setAutoApproveLimit(e.target.value)}
                    placeholder="e.g. 1000"
                  />
                  <span style={{ fontSize: "11px", color: "var(--color-muted)" }}>
                    Claims below this amount are auto-approved for verified categories.
                  </span>
                </div>

                <div className="form-group">
                  <label className="form-label">Multi-Tier Approval Threshold (₹)</label>
                  <input
                    type="number"
                    className="form-control"
                    value={multiTierLimit}
                    onChange={(e) => setMultiTierLimit(e.target.value)}
                    placeholder="e.g. 10000"
                  />
                  <span style={{ fontSize: "11px", color: "var(--color-muted)" }}>
                    Claims exceeding this value require Finance Director sign-off.
                  </span>
                </div>

                <div className="form-group">
                  <label className="form-label">Mandatory Receipt Upload (₹)</label>
                  <input
                    type="number"
                    className="form-control"
                    value={receiptMandatoryLimit}
                    onChange={(e) => setReceiptMandatoryLimit(e.target.value)}
                    placeholder="e.g. 500"
                  />
                  <span style={{ fontSize: "11px", color: "var(--color-muted)" }}>
                    Bills/vouchers strictly required above this threshold.
                  </span>
                </div>
              </div>
            </div>

            {/* Section 3: Mileage Settings */}
            <div className="card" style={{ padding: "20px 24px" }}>
              <h2 style={{ fontSize: "16px", fontWeight: 700, margin: "0 0 4px 0" }}>Mileage Settings</h2>
              <span style={{ fontSize: "12.5px", color: "var(--color-muted)" }}>
                Per-kilometer reimbursement tariffs for official client and field transit.
              </span>

              <div
                style={{
                  display: "grid",
                  gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))",
                  gap: "16px",
                  marginTop: "16px",
                }}
              >
                <div className="form-group">
                  <label className="form-label">Two-Wheeler Rate (₹ / km)</label>
                  <input
                    type="text"
                    className="form-control"
                    value={twoWheelerRate}
                    onChange={(e) => setTwoWheelerRate(e.target.value)}
                  />
                </div>

                <div className="form-group">
                  <label className="form-label">Four-Wheeler Rate (₹ / km)</label>
                  <input
                    type="text"
                    className="form-control"
                    value={fourWheelerRate}
                    onChange={(e) => setFourWheelerRate(e.target.value)}
                  />
                </div>

                <div className="form-group" style={{ display: "flex", alignItems: "center", gap: "10px", marginTop: "24px" }}>
                  <input
                    type="checkbox"
                    id="gps-tracking-cb"
                    checked={requireGpsTracking}
                    onChange={(e) => setRequireGpsTracking(e.target.checked)}
                    style={{ width: "16px", height: "16px", cursor: "pointer" }}
                  />
                  <label htmlFor="gps-tracking-cb" style={{ fontSize: "13px", fontWeight: 600, cursor: "pointer", margin: 0 }}>
                    Require GPS Route Tracking for Mileage Claims
                  </label>
                </div>
              </div>

              <div style={{ marginTop: "20px", display: "flex", justifyContent: "flex-end" }}>
                <button type="submit" className="btn btn-primary">
                  Save Expense Settings
                </button>
              </div>
            </div>
          </form>
        )}

        {/* ------------------------------------------------------------------- */}
        {/* TAB 3: GEO FENCING (OFFICE PUNCH LOCATIONS)                          */}
        {/* ------------------------------------------------------------------- */}
        {activeTab === "geo-fencing" && <GeoFencing />}

        {/* ------------------------------------------------------------------- */}
        {/* ADD/EDIT LEAVE TYPE MODAL                                           */}
        {/* ------------------------------------------------------------------- */}
        <Modal
          open={leaveModalOpen}
          title={editingLeave ? "Edit Leave Type" : "Add New Leave Type"}
          onClose={() => setLeaveModalOpen(false)}
          cardStyle={{ maxWidth: "480px" }}
        >
          <form onSubmit={handleSaveLeave} style={{ padding: "20px" }}>
            <div className="form-group" style={{ marginBottom: "14px" }}>
              <label className="form-label">Leave Name *</label>
              <input
                type="text"
                className="form-control"
                placeholder="e.g. Compensatory Off, Bereavement Leave"
                value={leaveForm.name}
                onChange={(e) => setLeaveForm((f) => ({ ...f, name: e.target.value }))}
                required
                autoFocus
              />
            </div>

            <div className="form-group" style={{ marginBottom: "14px" }}>
              <label className="form-label">Annual Quota (Days / Year)</label>
              <input
                type="number"
                className="form-control"
                value={leaveForm.annual_quota}
                onChange={(e) => setLeaveForm((f) => ({ ...f, annual_quota: parseInt(e.target.value) || 0 }))}
                min={0}
                max={365}
              />
            </div>

            <div className="form-group" style={{ display: "flex", alignItems: "center", gap: "10px", marginBottom: "20px" }}>
              <input
                type="checkbox"
                id="is-paid-cb"
                checked={leaveForm.is_paid}
                onChange={(e) => setLeaveForm((f) => ({ ...f, is_paid: e.target.checked }))}
                style={{ width: "16px", height: "16px", cursor: "pointer" }}
              />
              <label htmlFor="is-paid-cb" style={{ fontSize: "13px", fontWeight: 600, cursor: "pointer", margin: 0 }}>
                Paid Leave (Compensated during payroll)
              </label>
            </div>

            <div style={{ display: "flex", justifyContent: "flex-end", gap: "10px" }}>
              <button type="button" className="btn btn-secondary" onClick={() => setLeaveModalOpen(false)}>
                Cancel
              </button>
              <button type="submit" className="btn btn-primary">
                {editingLeave ? "Save Changes" : "Create Leave Type"}
              </button>
            </div>
          </form>
        </Modal>
      </main>
    </AppShell>
  );
}
