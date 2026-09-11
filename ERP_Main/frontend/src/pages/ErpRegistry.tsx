/**
 * ERP Registry Page for ERP_Main Control Plane.
 *
 * Manages registered ERP instances across the enterprise ecosystem.
 */

import { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { apiGet, apiPost } from "@/lib/api";
import { useToast } from "@/lib/toast";
import { AppShell } from "@/components/AppShell";
import { SectionNavTabs } from "@/components/SectionNavTabs";
import {
  StatusBadge,
  SkeletonTable,
  Banner,
  Modal,
  ConfirmDialog,
  EmptyState,
} from "@/components/ui";
import { ICONS } from "@/components/icons";
import type { ErpInstance } from "@/types";

export function ErpRegistry() {
  const toast = useToast();

  const [erps, setErps] = useState<ErpInstance[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<unknown>(null);
  const inFlightRef = useRef(false);

  // Filters
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<string>("ALL");

  // Register Modal
  const [createModalOpen, setCreateModalOpen] = useState(false);
  const [formKey, setFormKey] = useState("");
  const [formName, setFormName] = useState("");
  const [formBaseUrl, setFormBaseUrl] = useState("");
  const [formVersion, setFormVersion] = useState("1.0.0");
  const [formCapabilities, setFormCapabilities] = useState("buyers,products,inquiries,orders");
  const [submitting, setSubmitting] = useState(false);

  // Decommission / Reactivate Dialogs
  const [selectedErp, setSelectedErp] = useState<ErpInstance | null>(null);
  const [confirmAction, setConfirmAction] = useState<"decommission" | "reactivate" | null>(null);
  const [actionLoading, setActionLoading] = useState(false);

  const fetchErps = async (silent = false) => {
    if (inFlightRef.current) return;
    inFlightRef.current = true;
    if (!silent) {
      setLoading(true);
    }
    setError(null);
    try {
      const data = await apiGet<ErpInstance[]>("/global/erps");
      setErps(Array.isArray(data) ? data : []);
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
    fetchErps();

    // Conservative 30s monitoring poll that pauses when hidden
    const interval = setInterval(() => {
      if (document.visibilityState === "hidden") return;
      fetchErps(true);
    }, 30000);

    const handleVisibilityChange = () => {
      if (document.visibilityState === "visible") {
        fetchErps(true);
      }
    };
    document.addEventListener("visibilitychange", handleVisibilityChange);

    return () => {
      clearInterval(interval);
      document.removeEventListener("visibilitychange", handleVisibilityChange);
    };
  }, []);

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitting(true);
    try {
      const caps = formCapabilities
        .split(",")
        .map((c) => c.trim())
        .filter(Boolean);

      await apiPost<ErpInstance>("/global/erps", {
        erp_key: formKey.trim().toLowerCase(),
        name: formName.trim(),
        base_url: formBaseUrl.trim(),
        version: formVersion.trim(),
        capabilities: caps,
      });

      toast("ERP instance registered successfully.", "success");
      setCreateModalOpen(false);
      setFormKey("");
      setFormName("");
      setFormBaseUrl("");
      await fetchErps();
    } catch (err) {
      toast("Failed to register ERP: " + (err instanceof Error ? err.message : String(err)), "error");
    } finally {
      setSubmitting(false);
    }
  };

  const handleActionConfirm = async () => {
    if (!selectedErp || !confirmAction) return;
    setActionLoading(true);
    try {
      if (confirmAction === "decommission") {
        await apiPost(`/global/erps/${selectedErp.id}/decommission`);
        toast(`ERP ${selectedErp.name} decommissioned.`, "info");
      } else {
        await apiPost(`/global/erps/${selectedErp.id}/reactivate`);
        toast(`ERP ${selectedErp.name} reactivated.`, "success");
      }
      setSelectedErp(null);
      setConfirmAction(null);
      await fetchErps();
    } catch (err) {
      toast("Action failed: " + (err instanceof Error ? err.message : String(err)), "error");
    } finally {
      setActionLoading(false);
    }
  };

  const filtered = erps.filter((erp) => {
    const matchesSearch =
      search.trim() === "" ||
      erp.name.toLowerCase().includes(search.toLowerCase()) ||
      erp.erp_key.toLowerCase().includes(search.toLowerCase());

    const matchesStatus =
      statusFilter === "ALL" || erp.status === statusFilter;

    return matchesSearch && matchesStatus;
  });

  return (
    <AppShell
      activeKey="erps"
      pageTitle="ERP Registry"
      breadcrumbs={["ERP Management", "ERP Registry"]}
      actions={
        <div style={{ display: "flex", gap: "8px" }}>
          <button
            type="button"
            className="btn btn-primary btn-sm"
            onClick={() => setCreateModalOpen(true)}
            style={{ display: "flex", alignItems: "center", gap: "6px" }}
          >
            <ICONS.plus width={14} height={14} />
            Register ERP
          </button>
        </div>
      }
    >
      <SectionNavTabs
        items={[
          { key: "switcher", label: "ERP Switcher", path: "/erps/switcher", icon: "layers" },
          { key: "registry", label: "ERP Registry", path: "/erps/registry", icon: "server" },
          { key: "instances", label: "ERP Instances", path: "/erps/instances", icon: "cpu" },
          { key: "modules", label: "ERP Modules", path: "/erps/modules", icon: "sliders" },
        ]}
        activeKey="registry"
      />

      <Banner error={error} />

      {/* Filter and Search Bar */}
      <div
        className="card"
        style={{
          padding: "16px 20px",
          marginBottom: "20px",
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          flexWrap: "wrap",
          gap: "12px",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: "12px", flexWrap: "wrap", flex: 1 }}>
          <div style={{ position: "relative", minWidth: "260px" }}>
            <ICONS.search
              width={16}
              height={16}
              style={{ position: "absolute", left: "10px", top: "10px", color: "var(--color-muted)" }}
            />
            <input
              type="text"
              className="form-input"
              style={{ paddingLeft: "32px", height: "36px", width: "100%" }}
              placeholder="Search ERPs by name or key..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>

          <select
            className="form-select"
            style={{ width: "auto", height: "36px" }}
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
          >
            <option value="ALL">All Statuses</option>
            <option value="ACTIVE">Active</option>
            <option value="INACTIVE">Inactive</option>
            <option value="DECOMMISSIONED">Decommissioned</option>
          </select>
        </div>

        <div style={{ fontSize: "13px", color: "var(--color-muted)" }}>
          Showing <strong>{filtered.length}</strong> of <strong>{erps.length}</strong> instances
        </div>
      </div>

      {/* Table / List */}
      {loading ? (
        <SkeletonTable rows={4} cols={5} />
      ) : filtered.length === 0 ? (
        <EmptyState
          title="No ERP instances found"
          description={
            search || statusFilter !== "ALL"
              ? "No ERPs matched your current filter criteria."
              : "No ERP instances have been registered in the control plane yet."
          }
          action={
            <button type="button" className="btn btn-primary" onClick={() => setCreateModalOpen(true)}>
              Register First ERP
            </button>
          }
        />
      ) : (
        <div className="card" style={{ padding: 0, overflow: "hidden" }}>
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th>ERP Name / Key</th>
                  <th>Status</th>
                  <th>Version</th>
                  <th>Base URL</th>
                  <th>Capabilities</th>
                  <th style={{ textAlign: "right" }}>Actions</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((erp) => (
                  <tr key={erp.id}>
                    <td>
                      <div style={{ fontWeight: 700, color: "var(--color-text)", fontSize: "14px" }}>
                        <Link to={`/erps/${erp.id}`} style={{ color: "var(--color-text)", textDecoration: "none" }}>
                          {erp.name}
                        </Link>
                      </div>
                      <div style={{ fontSize: "12px", color: "var(--color-muted)", fontFamily: "monospace" }}>
                        {erp.erp_key}
                      </div>
                    </td>
                    <td>
                      <StatusBadge status={erp.status} />
                    </td>
                    <td style={{ fontSize: "13px", color: "var(--color-text-secondary)" }}>
                      v{erp.version}
                    </td>
                    <td style={{ fontSize: "12px", fontFamily: "monospace", color: "var(--color-primary)" }}>
                      {erp.base_url}
                    </td>
                    <td>
                      <div className="capability-pills">
                        {erp.capabilities && erp.capabilities.length > 0 ? (
                          erp.capabilities.slice(0, 3).map((cap) => (
                            <span key={cap} className="capability-pill">
                              {cap}
                            </span>
                          ))
                        ) : (
                          <span style={{ fontSize: "11px", color: "var(--color-muted)" }}>None declared</span>
                        )}
                        {erp.capabilities && erp.capabilities.length > 3 && (
                          <span className="capability-pill">+{erp.capabilities.length - 3}</span>
                        )}
                      </div>
                    </td>
                    <td style={{ textAlign: "right" }}>
                      <div style={{ display: "inline-flex", gap: "6px" }}>
                        <Link
                          to={`/erps/${erp.id}`}
                          className="btn btn-sm btn-secondary"
                          title="View Details"
                        >
                          Details
                        </Link>

                        {erp.status === "ACTIVE" ? (
                          <button
                            type="button"
                            className="btn btn-sm btn-outline"
                            style={{ color: "var(--color-danger)", borderColor: "#fecaca" }}
                            onClick={() => {
                              setSelectedErp(erp);
                              setConfirmAction("decommission");
                            }}
                          >
                            Decommission
                          </button>
                        ) : (
                          <button
                            type="button"
                            className="btn btn-sm btn-outline"
                            style={{ color: "var(--color-success)", borderColor: "#bbf7d0" }}
                            onClick={() => {
                              setSelectedErp(erp);
                              setConfirmAction("reactivate");
                            }}
                          >
                            Reactivate
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Register ERP Modal Dialog */}
      <Modal
        open={createModalOpen}
        onClose={() => setCreateModalOpen(false)}
        title="Register New ERP Instance"
        variant="center"
        cardStyle={{ maxWidth: "520px" }}
      >
        <form onSubmit={handleCreate} style={{ display: "flex", flexDirection: "column", gap: "16px" }}>
          <div className="form-group">
            <label className="form-label" htmlFor="erpKey">
              ERP Key (Unique Identifier) *
            </label>
            <input
              id="erpKey"
              type="text"
              className="form-input"
              placeholder="e.g. yinglima, inhyma, future_erp"
              value={formKey}
              onChange={(e) => setFormKey(e.target.value)}
              required
              pattern="^[a-z0-9_-]+$"
              title="Lowercase alphanumeric, hyphen, underscore only"
            />
            <span className="form-helper">Immutable machine identifier used in event routing.</span>
          </div>

          <div className="form-group">
            <label className="form-label" htmlFor="erpName">
              Display Name *
            </label>
            <input
              id="erpName"
              type="text"
              className="form-input"
              placeholder="e.g. Yinglima ERP"
              value={formName}
              onChange={(e) => setFormName(e.target.value)}
              required
            />
          </div>

          <div className="form-group">
            <label className="form-label" htmlFor="baseUrl">
              Base URL *
            </label>
            <input
              id="baseUrl"
              type="url"
              className="form-input"
              placeholder="http://localhost:8001"
              value={formBaseUrl}
              onChange={(e) => setFormBaseUrl(e.target.value)}
              required
            />
          </div>

          <div className="form-group">
            <label className="form-label" htmlFor="version">
              Software Version
            </label>
            <input
              id="version"
              type="text"
              className="form-input"
              placeholder="1.0.0"
              value={formVersion}
              onChange={(e) => setFormVersion(e.target.value)}
            />
          </div>

          <div className="form-group">
            <label className="form-label" htmlFor="capabilities">
              Enabled Capabilities (comma-separated)
            </label>
            <input
              id="capabilities"
              type="text"
              className="form-input"
              placeholder="buyers, suppliers, products, inquiries"
              value={formCapabilities}
              onChange={(e) => setFormCapabilities(e.target.value)}
            />
          </div>

          <div style={{ display: "flex", justifyContent: "flex-end", gap: "10px", marginTop: "12px" }}>
            <button
              type="button"
              className="btn btn-secondary"
              onClick={() => setCreateModalOpen(false)}
              disabled={submitting}
            >
              Cancel
            </button>
            <button type="submit" className="btn btn-primary" disabled={submitting}>
              {submitting ? "Registering..." : "Register Instance"}
            </button>
          </div>
        </form>
      </Modal>

      {/* Decommission / Reactivate Confirmation */}
      <ConfirmDialog
        open={Boolean(selectedErp && confirmAction)}
        title={confirmAction === "decommission" ? "Decommission ERP Instance" : "Reactivate ERP Instance"}
        message={
          confirmAction === "decommission" ? (
            <span>
              Are you sure you want to decommission <strong>{selectedErp?.name}</strong>?
              New user provisioning will be rejected, but existing audit and historical event logs will be preserved.
            </span>
          ) : (
            <span>
              Are you sure you want to reactivate <strong>{selectedErp?.name}</strong>?
              This will re-enable event sync and identity provisioning.
            </span>
          )
        }
        confirmLabel={confirmAction === "decommission" ? "Decommission" : "Reactivate"}
        danger={confirmAction === "decommission"}
        loading={actionLoading}
        onConfirm={handleActionConfirm}
        onCancel={() => {
          setSelectedErp(null);
          setConfirmAction(null);
        }}
      />
    </AppShell>
  );
}
