/**
 * HRMS Employee Location Assignment Page.
 *
 * Allows HR/Admin to manage employee location allocations:
 * - Exactly one mandatory Primary Location
 * - Zero or more optional Additional Locations
 * - Managed strictly by HR/Admin; employees cannot assign themselves office locations.
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import { AppShell } from "@/components/AppShell";
import { Breadcrumb } from "@/components/Breadcrumb";
import { Banner, Modal } from "@/components/ui";
import {
  IconBuilding,
  IconPin,
  IconShield,
  IconUsers,
} from "@/components/icons";
import { apiGet, apiPut } from "@/lib/api";
import { useAuth, useDebouncedValue } from "@/lib/hooks";
import type { HrmsLocationItem } from "./HrmsLocationsPage";

interface EmployeeAssignmentItem {
  user_id: string;
  employee_name: string;
  employee_code?: string | null;
  email?: string | null;
  department?: string | null;
  role?: string | null;
  primary_location?: {
    id: string;
    name: string;
    location_type: string;
    address: string;
    radius_meters: number;
    is_primary: boolean;
  } | null;
  additional_locations: Array<{
    id: string;
    name: string;
    location_type: string;
    address: string;
    radius_meters: number;
    is_primary: boolean;
  }>;
}

export function HrmsEmployeeLocationsPage() {
  const { profile, isSuperAdmin } = useAuth();
  const [employees, setEmployees] = useState<EmployeeAssignmentItem[]>([]);
  const [locations, setLocations] = useState<HrmsLocationItem[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<unknown>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);

  // Search & Filter state
  const [searchTerm, setSearchTerm] = useState("");
  const debouncedSearch = useDebouncedValue(searchTerm, 300);

  // Assignment Modal state
  const [selectedEmployee, setSelectedEmployee] = useState<EmployeeAssignmentItem | null>(null);
  const [primaryLocId, setPrimaryLocId] = useState<string>("");
  const [additionalLocIds, setAdditionalLocIds] = useState<string[]>([]);
  const [isSubmitting, setIsSubmitting] = useState(false);

  // Check HR/Admin role
  const isHrAdmin = useMemo(() => {
    if (isSuperAdmin) return true;
    const userRole = String(profile?.role || "").toLowerCase();
    const roles = Array.isArray(profile?.roles) ? profile.roles.map((r) => String(r).toLowerCase()) : [];
    return isSuperAdmin || ["admin", "hr", "hr_manager", "super_admin"].includes(userRole) || roles.some((r) => ["admin", "hr", "hr_manager", "super_admin"].includes(r));
  }, [profile, isSuperAdmin]);

  // Load assignments and locations
  const loadData = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    try {
      const [empRes, locRes] = await Promise.all([
        apiGet<EmployeeAssignmentItem[]>("/api/v1/hrms/employee-assignments"),
        apiGet<HrmsLocationItem[]>("/api/v1/hrms/locations?active_only=true"),
      ]);
      setEmployees(empRes.data || []);
      setLocations(locRes.data || []);
    } catch (err) {
      console.error("Failed to load employee assignments:", err);
      setError(err);
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    loadData();
  }, [loadData]);

  // Auto-dismiss success notifications
  useEffect(() => {
    if (!successMsg) return;
    const timer = setTimeout(() => setSuccessMsg(null), 4000);
    return () => clearTimeout(timer);
  }, [successMsg]);

  // Filtered employees
  const filteredEmployees = useMemo(() => {
    if (!debouncedSearch.trim()) return employees;
    const q = debouncedSearch.toLowerCase();
    return employees.filter(
      (emp) =>
        emp.employee_name.toLowerCase().includes(q) ||
        (emp.employee_code && emp.employee_code.toLowerCase().includes(q)) ||
        (emp.email && emp.email.toLowerCase().includes(q)) ||
        (emp.primary_location && emp.primary_location.name.toLowerCase().includes(q))
    );
  }, [employees, debouncedSearch]);

  // Open Assign Modal
  const handleOpenAssign = (emp: EmployeeAssignmentItem) => {
    setSelectedEmployee(emp);
    setPrimaryLocId(emp.primary_location?.id || (locations[0]?.id ?? ""));
    setAdditionalLocIds((emp.additional_locations || []).map((l) => l.id));
  };

  // Toggle additional location checkbox
  const handleToggleAdditional = (locId: string) => {
    if (locId === primaryLocId) return; // Cannot be primary and additional
    setAdditionalLocIds((prev) =>
      prev.includes(locId) ? prev.filter((id) => id !== locId) : [...prev, locId]
    );
  };

  // Save Assignment
  const handleSaveAssignment = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedEmployee) return;
    if (!primaryLocId) {
      setError(new Error("Please select a Primary Location for this employee."));
      return;
    }

    setIsSubmitting(true);
    setError(null);
    try {
      await apiPut(`/api/v1/hrms/employees/${selectedEmployee.user_id}/locations`, {
        primary_location_id: primaryLocId,
        additional_location_ids: additionalLocIds.filter((id) => id !== primaryLocId),
      });

      setSuccessMsg(`Locations assigned to ${selectedEmployee.employee_name} successfully!`);
      setSelectedEmployee(null);
      loadData();
    } catch (err) {
      console.error("Failed to assign locations:", err);
      setError(err);
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <AppShell activeKey="hrms">
      <main className="page" data-testid="hrms-employee-locations-page">
        <Breadcrumb trail={["HRMS", "Employee Location Assignments"]} />

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
              Employee Location Allocation
            </h1>
            <p style={{ margin: 0, fontSize: "13.5px", color: "var(--color-muted)" }}>
              Assign Primary and Additional office/plant locations for attendance geofencing. Managed only by HR/Admin.
            </p>
          </div>

          <div
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: "8px",
              padding: "6px 14px",
              background: "var(--color-surface-subtle)",
              borderRadius: "var(--radius-sm, 6px)",
              border: "1px solid var(--color-border)",
              fontSize: "12.5px",
              color: "var(--color-muted)",
            }}
          >
            <IconShield width={16} height={16} style={{ color: "var(--color-primary)" }} />
            <span>HR/Admin Authorization Enforced</span>
          </div>
        </div>

        {/* Search Bar */}
        <div
          className="card"
          style={{
            padding: "14px 18px",
            marginBottom: "16px",
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            flexWrap: "wrap",
            gap: "12px",
          }}
        >
          <input
            type="text"
            placeholder="Search employee by name, code, email, or office..."
            className="form-control"
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            style={{ width: "320px" }}
            data-testid="employee-search-input"
          />

          <div style={{ fontSize: "12.5px", color: "var(--color-muted)" }}>
            Showing {filteredEmployees.length} of {employees.length} employees
          </div>
        </div>

        {/* Assignments Table */}
        <div className="card" style={{ padding: 0, overflow: "hidden" }}>
          <div className="table-responsive">
            <table className="table" data-testid="employee-assignments-table">
              <thead>
                <tr>
                  <th style={{ width: "24%" }}>Employee</th>
                  <th style={{ width: "16%" }}>Designation / Role</th>
                  <th style={{ width: "22%" }}>Primary Location</th>
                  <th style={{ width: "24%" }}>Additional Locations</th>
                  <th style={{ width: "14%", textAlign: "right" }}>Action</th>
                </tr>
              </thead>
              <tbody>
                {isLoading ? (
                  <tr>
                    <td colSpan={5} style={{ textAlign: "center", padding: "40px" }}>
                      <div className="skeleton-line" style={{ width: "200px", margin: "0 auto 10px" }} />
                      <div style={{ color: "var(--color-muted)", fontSize: "13px" }}>Loading employees...</div>
                    </td>
                  </tr>
                ) : filteredEmployees.length === 0 ? (
                  <tr>
                    <td colSpan={5} style={{ textAlign: "center", padding: "40px" }}>
                      <IconUsers width={32} height={32} style={{ color: "var(--color-muted)", marginBottom: "8px" }} />
                      <div style={{ fontWeight: 600, color: "var(--color-text)" }}>No employees found</div>
                    </td>
                  </tr>
                ) : (
                  filteredEmployees.map((emp) => (
                    <tr key={emp.user_id} data-testid={`emp-row-${emp.user_id}`}>
                      <td>
                        <div style={{ fontWeight: 600, color: "var(--color-text)" }}>{emp.employee_name}</div>
                        <div style={{ fontSize: "11.5px", color: "var(--color-muted)" }}>
                          {emp.employee_code || "No Code"} • {emp.email || "No Email"}
                        </div>
                      </td>
                      <td>
                        <span style={{ fontSize: "13px", color: "var(--color-text)" }}>
                          {emp.role || emp.department || "Staff"}
                        </span>
                      </td>
                      <td>
                        {emp.primary_location ? (
                          <div style={{ display: "inline-flex", alignItems: "center", gap: "6px" }}>
                            <span
                              className="badge badge-active"
                              style={{ padding: "4px 10px", fontSize: "12px", display: "inline-flex", alignItems: "center", gap: "4px" }}
                            >
                              <IconPin width={12} height={12} />
                              {emp.primary_location.name}
                            </span>
                          </div>
                        ) : (
                          <span style={{ color: "var(--color-muted)", fontSize: "12.5px", fontStyle: "italic" }}>
                            Not Assigned
                          </span>
                        )}
                      </td>
                      <td>
                        {emp.additional_locations && emp.additional_locations.length > 0 ? (
                          <div style={{ display: "flex", flexWrap: "wrap", gap: "6px" }}>
                            {emp.additional_locations.map((loc) => (
                              <span
                                key={loc.id}
                                className="badge"
                                style={{
                                  background: "var(--color-surface-subtle)",
                                  border: "1px solid var(--color-border)",
                                  fontSize: "11.5px",
                                }}
                              >
                                {loc.name}
                              </span>
                            ))}
                          </div>
                        ) : (
                          <span style={{ color: "var(--color-muted)", fontSize: "12px" }}>None</span>
                        )}
                      </td>
                      <td style={{ textAlign: "right" }}>
                        <button
                          type="button"
                          className="btn btn-sm btn-primary"
                          onClick={() => handleOpenAssign(emp)}
                          disabled={!isHrAdmin}
                          title={isHrAdmin ? "Assign Office Locations" : "HR/Admin privileges required"}
                          data-testid={`assign-btn-${emp.user_id}`}
                          style={{ padding: "4px 10px", fontSize: "12px", fontWeight: 600 }}
                        >
                          Assign Locations
                        </button>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>

        {/* ================================================================= */}
        {/* ASSIGN LOCATIONS MODAL                                            */}
        {/* ================================================================= */}
        {selectedEmployee && (
          <Modal
            open={Boolean(selectedEmployee)}
            variant="center"
            cardStyle={{ width: "100%", maxWidth: "600px" }}
            title={
              <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                <IconBuilding width={18} height={18} style={{ color: "var(--color-primary)" }} />
                <span>Assign Locations — {selectedEmployee.employee_name}</span>
              </div>
            }
            onClose={() => !isSubmitting && setSelectedEmployee(null)}
          >
            <form onSubmit={handleSaveAssignment} data-testid="assign-locations-form">
              <div style={{ display: "flex", flexDirection: "column", gap: "16px", padding: "14px 0" }}>
                {/* Authorization alert */}
                <div
                  style={{
                    background: "var(--color-primary-soft, rgba(37,99,235,0.08))",
                    border: "1px solid var(--color-primary)",
                    borderRadius: "var(--radius-sm, 6px)",
                    padding: "10px 14px",
                    fontSize: "12.5px",
                    color: "var(--color-text)",
                  }}
                >
                  <strong>Admin Managed:</strong> Employees cannot assign themselves office locations. The primary location serves as the default reporting office for attendance.
                </div>

                {/* 1. Primary Location (Single Select) */}
                <div>
                  <label className="form-label" style={{ fontWeight: 600 }}>
                    Primary Location (Mandatory 1 default location) <span style={{ color: "red" }}>*</span>
                  </label>
                  <select
                    className="form-control"
                    required
                    value={primaryLocId}
                    onChange={(e) => {
                      const newPrim = e.target.value;
                      setPrimaryLocId(newPrim);
                      // Remove from additional if previously selected
                      setAdditionalLocIds((prev) => prev.filter((id) => id !== newPrim));
                    }}
                    data-testid="select-primary-location"
                  >
                    <option value="" disabled>
                      -- Select Primary Office --
                    </option>
                    {locations.map((loc) => (
                      <option key={loc.id} value={loc.id}>
                        {loc.name} ({loc.location_type}) — {loc.address}
                      </option>
                    ))}
                  </select>
                  <div style={{ fontSize: "11px", color: "var(--color-muted)", marginTop: "4px" }}>
                    Standard office where employee marks primary daily attendance.
                  </div>
                </div>

                {/* 2. Additional Locations (Optional Multiple Select) */}
                <div>
                  <label className="form-label" style={{ fontWeight: 600 }}>
                    Additional Locations (Optional multiple facilities)
                  </label>
                  <div
                    style={{
                      maxHeight: "200px",
                      overflowY: "auto",
                      border: "1px solid var(--color-border)",
                      borderRadius: "var(--radius-sm, 6px)",
                      padding: "8px 12px",
                      background: "var(--color-surface-subtle)",
                      display: "flex",
                      flexDirection: "column",
                      gap: "8px",
                    }}
                    data-testid="additional-locations-list"
                  >
                    {locations.length <= 1 ? (
                      <div style={{ fontSize: "12px", color: "var(--color-muted)" }}>
                        No additional locations available. Add more locations under Location Management.
                      </div>
                    ) : (
                      locations
                        .filter((loc) => loc.id !== primaryLocId)
                        .map((loc) => {
                          const isChecked = additionalLocIds.includes(loc.id);
                          return (
                            <label
                              key={loc.id}
                              style={{
                                display: "flex",
                                alignItems: "center",
                                gap: "10px",
                                fontSize: "13px",
                                cursor: "pointer",
                                margin: 0,
                              }}
                            >
                              <input
                                type="checkbox"
                                checked={isChecked}
                                onChange={() => handleToggleAdditional(loc.id)}
                                data-testid={`checkbox-additional-${loc.id}`}
                              />
                              <div>
                                <strong>{loc.name}</strong>{" "}
                                <span style={{ color: "var(--color-muted)", fontSize: "11.5px" }}>
                                  ({loc.location_type}) — {loc.radius_meters}m
                                </span>
                              </div>
                            </label>
                          );
                        })
                    )}
                  </div>
                  <div style={{ fontSize: "11px", color: "var(--color-muted)", marginTop: "4px" }}>
                    Branch offices, warehouses, or client plants the employee is authorized to visit and clock in from.
                  </div>
                </div>
              </div>

              <div
                style={{
                  display: "flex",
                  justifyContent: "flex-end",
                  gap: "10px",
                  paddingTop: "14px",
                  borderTop: "1px solid var(--color-border)",
                }}
              >
                <button
                  type="button"
                  className="btn"
                  onClick={() => setSelectedEmployee(null)}
                  disabled={isSubmitting}
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="btn btn-primary"
                  disabled={isSubmitting || !primaryLocId}
                  data-testid="save-assignment-btn"
                >
                  {isSubmitting ? "Saving Assignments..." : "Save Assignments"}
                </button>
              </div>
            </form>
          </Modal>
        )}
      </main>
    </AppShell>
  );
}
