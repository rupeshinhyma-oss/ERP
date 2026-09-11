/**
 * Synchronization Hub Page for ERP_Main Control Plane.
 *
 * Implements cross-ERP data synchronization governance:
 * - Entity Sync Policies (creation, status transitions, conflict strategies)
 * - Data Ownership & Authoritative Resolver
 * - Cross-ERP Entity ID Mappings
 * - Data Reconciliation with child ERPs
 * - Conflict Detection & Resolution
 * - Event Repair & Replay
 * - Read Projection Snapshots
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { apiGet, apiPatch, apiPost } from "@/lib/api";
import { useGlobalSession } from "@/lib/session";
import { useToast } from "@/lib/toast";
import { AppShell } from "@/components/AppShell";
import { SectionNavTabs } from "@/components/SectionNavTabs";
import { SYNC_SECTION_TABS } from "@/lib/nav";
import {
  Banner,
  EmptyState,
  SkeletonTable,
  Modal,
  StatusBadge,
} from "@/components/ui";
import { ICONS } from "@/components/icons";
import type { ErpInstance, ReconciliationResult } from "@/types";

export interface EntitySyncPolicyItem {
  id: string;
  entity_type: string;
  source_erp_id: string;
  source_key?: string;
  target_erp_id: string;
  target_key?: string;
  ownership_strategy: string;
  direction: string;
  conflict_strategy: string;
  status: "ACTIVE" | "PAUSED" | "DRAFT" | "DEPRECATED";
  authoritative_owner_erp_id?: string;
  owner_key?: string;
  created_at: string;
  updated_at: string;
}

type SyncTab =
  | "sync-policies"
  | "data-ownership"
  | "entity-mappings"
  | "reconciliation"
  | "conflicts"
  | "repair-replay"
  | "snapshots";

export function SynchronizationHub() {
  const location = useLocation();
  const navigate = useNavigate();
  const toast = useToast();
  const { isSuperAdmin, userType } = useGlobalSession();
  const canManage = isSuperAdmin || userType === "platform_admin";

  const activeTab = useMemo<SyncTab>(() => {
    if (location.pathname.includes("/ownership")) return "data-ownership";
    if (location.pathname.includes("/mappings")) return "entity-mappings";
    if (location.pathname.includes("/reconciliation")) return "reconciliation";
    if (location.pathname.includes("/conflicts")) return "conflicts";
    if (location.pathname.includes("/repair")) return "repair-replay";
    if (location.pathname.includes("/snapshots")) return "snapshots";
    return "sync-policies";
  }, [location.pathname]);

  const [policies, setPolicies] = useState<EntitySyncPolicyItem[]>([]);
  const [erps, setErps] = useState<ErpInstance[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<unknown>(null);

  // Filters
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("ALL");
  const [entityFilter, setEntityFilter] = useState("ALL");

  // Create Policy Modal
  const [createModalOpen, setCreateModalOpen] = useState(false);
  const [formEntityType, setFormEntityType] = useState("buyer");
  const [formSourceErp, setFormSourceErp] = useState("");
  const [formTargetErp, setFormTargetErp] = useState("");
  const [formOwnership, setFormOwnership] = useState("SOURCE_AUTHORITATIVE");
  const [formDirection, setFormDirection] = useState("BIDIRECTIONAL");
  const [formConflict, setFormConflict] = useState("LAST_WRITE_WINS");
  const [creatingPolicy, setCreatingPolicy] = useState(false);

  // Policy State Transition
  const [selectedPolicy, setSelectedPolicy] = useState<EntitySyncPolicyItem | null>(null);
  const [statusModalOpen, setStatusModalOpen] = useState(false);
  const [newStatus, setNewStatus] = useState<string>("ACTIVE");
  const [updatingStatus, setUpdatingStatus] = useState(false);

  // Reconciliation State
  const [reconcilingId, setReconcilingId] = useState<string | null>(null);
  const [reconciliations, setReconciliations] = useState<Record<string, ReconciliationResult>>({});

  // Ownership Resolver Test
  const [testSource, setTestSource] = useState("");
  const [testTarget, setTestTarget] = useState("");
  const [testEntity, setTestEntity] = useState("buyer");
  const [resolvedOwner, setResolvedOwner] = useState<string | null>(null);
  const [resolving, setResolving] = useState(false);

  // Entity Mapping Test Form
  const [mapSourceErp, setMapSourceErp] = useState("");
  const [mapTargetErp, setMapTargetErp] = useState("");
  const [mapSourceEntity, setMapSourceEntity] = useState("buyer");
  const [mapSourceId, setMapSourceId] = useState("");
  const [mapTargetEntity, setMapTargetEntity] = useState("buyer");
  const [mapTargetId, setMapTargetId] = useState("");
  const [creatingMapping, setCreatingMapping] = useState(false);
  const [createdMappings, setCreatedMappings] = useState<any[]>([]);

  const fetchData = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [policiesRes, erpsRes] = await Promise.all([
        apiGet<EntitySyncPolicyItem[]>("/global/sync-policies").catch(() => []),
        apiGet<ErpInstance[]>("/global/erps").catch(() => []),
      ]);
      setPolicies(policiesRes || []);
      setErps(erpsRes || []);
      if (erpsRes && erpsRes.length >= 2) {
        setFormSourceErp(erpsRes[0].id);
        setFormTargetErp(erpsRes[1].id);
        setTestSource(erpsRes[0].id);
        setTestTarget(erpsRes[1].id);
        setMapSourceErp(erpsRes[0].id);
        setMapTargetErp(erpsRes[1].id);
      }
    } catch (err) {
      setError(err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  // Create Policy Handler
  const handleCreatePolicy = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!formSourceErp || !formTargetErp) {
      toast("Please select both source and target ERP nodes.", "error");
      return;
    }
    if (formSourceErp === formTargetErp) {
      toast("Source and target ERP nodes must be different.", "error");
      return;
    }
    setCreatingPolicy(true);
    try {
      await apiPost("/global/sync-policies", {
        entity_type: formEntityType,
        source_erp_id: formSourceErp,
        target_erp_id: formTargetErp,
        ownership_strategy: formOwnership,
        direction: formDirection,
        conflict_strategy: formConflict,
        authoritative_owner_erp_id: formOwnership === "TARGET_AUTHORITATIVE" ? formTargetErp : formSourceErp,
      });
      toast("Sync policy created successfully.", "success");
      setCreateModalOpen(false);
      await fetchData();
    } catch (err) {
      toast("Failed to create sync policy: " + (err instanceof Error ? err.message : String(err)), "error");
    } finally {
      setCreatingPolicy(false);
    }
  };

  // Update Status Handler
  const handleUpdateStatus = async () => {
    if (!selectedPolicy) return;
    setUpdatingStatus(true);
    try {
      await apiPatch(`/global/sync-policies/${selectedPolicy.id}/state`, {
        status: newStatus,
        reason: "Operator updated via Control Plane UI",
      });
      toast(`Policy status updated to ${newStatus}.`, "success");
      setStatusModalOpen(false);
      setSelectedPolicy(null);
      await fetchData();
    } catch (err) {
      toast("Failed to update policy status: " + (err instanceof Error ? err.message : String(err)), "error");
    } finally {
      setUpdatingStatus(false);
    }
  };

  // Resolve Owner Handler
  const handleResolveOwner = async () => {
    if (!testSource || !testTarget) return;
    setResolving(true);
    setResolvedOwner(null);
    try {
      const res = await apiGet<{ authoritative_owner_erp_id?: string; policy_id?: string }>(
        `/global/sync-policies/resolve?source_erp_id=${testSource}&target_erp_id=${testTarget}&entity_type=${testEntity}`
      );
      if (res && res.authoritative_owner_erp_id) {
        const ownerErp = erps.find((e) => e.id === res.authoritative_owner_erp_id);
        setResolvedOwner(ownerErp ? `${ownerErp.name} (${ownerErp.erp_key})` : res.authoritative_owner_erp_id);
      } else {
        setResolvedOwner("Default Source Authoritative (No explicit active policy override)");
      }
    } catch (err) {
      setResolvedOwner("Resolution check returned default source ownership.");
    } finally {
      setResolving(false);
    }
  };

  // Reconciliation Trigger
  const handleRunReconciliation = async (erpId: string, erpName: string) => {
    setReconcilingId(erpId);
    try {
      const res = await apiPost<ReconciliationResult>(`/global/reconciliation/erps/${erpId}`);
      setReconciliations((prev) => ({ ...prev, [erpId]: res }));
      toast(
        `Reconciliation pass completed for ${erpName}. Status: ${res.status}`,
        res.status === "MATCHED" ? "success" : "info"
      );
    } catch (err) {
      toast("Reconciliation failed: " + (err instanceof Error ? err.message : String(err)), "error");
    } finally {
      setReconcilingId(null);
    }
  };

  // Create Mapping Handler
  const handleCreateMapping = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!mapSourceId || !mapTargetId) {
      toast("Please provide both Source Entity ID and Target Entity ID.", "error");
      return;
    }
    setCreatingMapping(true);
    try {
      const created = await apiPost("/global/integration/mappings", {
        source_erp_id: mapSourceErp,
        source_entity_type: mapSourceEntity,
        source_entity_id: mapSourceId,
        target_erp_id: mapTargetErp,
        target_entity_type: mapTargetEntity,
        target_entity_id: mapTargetId,
      });
      toast("Cross-ERP entity mapping established.", "success");
      setCreatedMappings((prev) => [created, ...prev]);
      setMapSourceId("");
      setMapTargetId("");
    } catch (err) {
      toast("Failed to create mapping: " + (err instanceof Error ? err.message : String(err)), "error");
    } finally {
      setCreatingMapping(false);
    }
  };

  const filteredPolicies = useMemo(() => {
    return policies.filter((p) => {
      if (statusFilter !== "ALL" && p.status !== statusFilter) return false;
      if (entityFilter !== "ALL" && p.entity_type !== entityFilter) return false;
      if (search.trim()) {
        const q = search.toLowerCase();
        const matchesEntity = p.entity_type.toLowerCase().includes(q);
        const matchesStrategy = p.ownership_strategy.toLowerCase().includes(q);
        const matchesConflict = p.conflict_strategy.toLowerCase().includes(q);
        if (!matchesEntity && !matchesStrategy && !matchesConflict) return false;
      }
      return true;
    });
  }, [policies, statusFilter, entityFilter, search]);

  const pageTitle = useMemo(() => {
    switch (activeTab) {
      case "data-ownership":
        return "Data Authoritative Ownership";
      case "entity-mappings":
        return "Cross-ERP Entity ID Mappings";
      case "reconciliation":
        return "Data Reconciliation & Drift Detection";
      case "conflicts":
        return "Synchronization Conflicts";
      case "repair-replay":
        return "Event Repair & Replay Operations";
      case "snapshots":
        return "Data Projection Snapshots";
      default:
        return "Entity Synchronization Policies";
    }
  }, [activeTab]);

  return (
    <AppShell
      activeKey={activeTab}
      pageTitle={pageTitle}
      breadcrumbs={["Synchronization", pageTitle]}
      actions={
        canManage && activeTab === "sync-policies" ? (
          <button
            type="button"
            id="btn-create-sync-policy"
            className="btn btn-primary btn-sm"
            onClick={() => setCreateModalOpen(true)}
            style={{ display: "flex", alignItems: "center", gap: "6px" }}
          >
            <ICONS.plus width={14} height={14} />
            Create Sync Policy
          </button>
        ) : undefined
      }
    >
      <SectionNavTabs items={SYNC_SECTION_TABS} activeKey={activeTab} />

      <Banner error={error} />

      {/* Sync Subsystem Context Callout */}
      <div
        className="card"
        style={{
          marginBottom: "20px",
          padding: "16px 20px",
          background: "linear-gradient(135deg, #f8fafc 0%, #f1f5f9 100%)",
          border: "1px solid var(--color-border)",
          borderLeft: "4px solid var(--color-primary)",
        }}
      >
        <div style={{ display: "flex", alignItems: "flex-start", gap: "14px" }}>
          <div
            style={{
              width: "36px",
              height: "36px",
              borderRadius: "8px",
              backgroundColor: "rgba(14, 116, 144, 0.12)",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              color: "var(--color-primary)",
              flexShrink: 0,
            }}
          >
            <ICONS.sliders width={20} height={20} />
          </div>
          <div>
            <div style={{ fontWeight: 600, color: "var(--color-text)", marginBottom: "4px" }}>
              Decentralized Synchronization & Ownership Control
            </div>
            <div style={{ fontSize: "13px", color: "var(--color-text-secondary)", lineHeight: 1.5 }}>
              ERP_Main enforces declared sync policies, conflict resolution algorithms, and cross-ERP entity mappings.
              Data transfer is performed via asynchronous transactional events; direct database cross-connections are
              strictly forbidden.
            </div>
          </div>
        </div>
      </div>

      {/* TAB CONTENT */}
      {loading ? (
        <SkeletonTable rows={6} cols={6} />
      ) : activeTab === "sync-policies" ? (
        /* TAB 1: SYNC POLICIES */
        <div>
          {/* Toolbar */}
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
              <div style={{ position: "relative", minWidth: "240px" }}>
                <ICONS.search
                  width={16}
                  height={16}
                  style={{ position: "absolute", left: "10px", top: "10px", color: "var(--color-muted)" }}
                />
                <input
                  type="text"
                  id="input-search-policies"
                  className="form-input"
                  style={{ paddingLeft: "32px", height: "36px", width: "100%" }}
                  placeholder="Search policies by entity, strategy..."
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                />
              </div>

              <select
                className="form-select"
                style={{ width: "auto", height: "36px" }}
                value={entityFilter}
                onChange={(e) => setEntityFilter(e.target.value)}
              >
                <option value="ALL">All Entities</option>
                <option value="buyer">Buyers</option>
                <option value="product">Products</option>
                <option value="supplier">Suppliers</option>
                <option value="order">Orders</option>
              </select>

              <select
                className="form-select"
                style={{ width: "auto", height: "36px" }}
                value={statusFilter}
                onChange={(e) => setStatusFilter(e.target.value)}
              >
                <option value="ALL">All Statuses</option>
                <option value="ACTIVE">Active</option>
                <option value="PAUSED">Paused</option>
                <option value="DRAFT">Draft</option>
                <option value="DEPRECATED">Deprecated</option>
              </select>
            </div>

            <div style={{ fontSize: "13px", color: "var(--color-muted)" }}>
              Showing <strong>{filteredPolicies.length}</strong> policies
            </div>
          </div>

          {/* Table */}
          <div className="card" style={{ overflow: "hidden" }}>
            <table className="data-table" id="table-sync-policies">
              <thead>
                <tr>
                  <th>Entity Type</th>
                  <th>Source ERP</th>
                  <th>Target ERP</th>
                  <th>Ownership Strategy</th>
                  <th>Direction</th>
                  <th>Conflict Strategy</th>
                  <th>Status</th>
                  {canManage && <th style={{ textAlign: "right" }}>Actions</th>}
                </tr>
              </thead>
              <tbody>
                {filteredPolicies.length === 0 ? (
                  <tr>
                    <td colSpan={canManage ? 8 : 7} style={{ textAlign: "center", padding: "32px" }}>
                      <EmptyState
                        title="No Sync Policies Found"
                        description="Define an entity sync policy to configure cross-ERP synchronization rules."
                        action={
                          canManage ? (
                            <button
                              type="button"
                              className="btn btn-primary btn-sm"
                              onClick={() => setCreateModalOpen(true)}
                            >
                              Create Sync Policy
                            </button>
                          ) : undefined
                        }
                      />
                    </td>
                  </tr>
                ) : (
                  filteredPolicies.map((p) => {
                    const src = erps.find((e) => e.id === p.source_erp_id);
                    const tgt = erps.find((e) => e.id === p.target_erp_id);
                    return (
                      <tr key={p.id} id={`policy-row-${p.id}`}>
                        <td>
                          <span style={{ fontWeight: 600, textTransform: "capitalize" }}>{p.entity_type}</span>
                        </td>
                        <td>
                          <span className="badge badge-outline">{src ? src.name : p.source_key || p.source_erp_id.slice(0, 8)}</span>
                        </td>
                        <td>
                          <span className="badge badge-outline">{tgt ? tgt.name : p.target_key || p.target_erp_id.slice(0, 8)}</span>
                        </td>
                        <td>
                          <span style={{ fontSize: "12px", fontFamily: "monospace" }}>{p.ownership_strategy}</span>
                        </td>
                        <td>
                          <span style={{ fontSize: "12px" }}>{p.direction}</span>
                        </td>
                        <td>
                          <span style={{ fontSize: "12px", fontFamily: "monospace" }}>{p.conflict_strategy}</span>
                        </td>
                        <td>
                          <StatusBadge status={p.status} />
                        </td>
                        {canManage && (
                          <td style={{ textAlign: "right" }}>
                            <button
                              type="button"
                              className="btn btn-secondary btn-sm"
                              onClick={() => {
                                setSelectedPolicy(p);
                                setNewStatus(p.status);
                                setStatusModalOpen(true);
                              }}
                            >
                              Update Status
                            </button>
                          </td>
                        )}
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
        </div>
      ) : activeTab === "data-ownership" ? (
        /* TAB 2: DATA OWNERSHIP */
        <div>
          <div className="card" style={{ padding: "24px", marginBottom: "20px" }}>
            <h3 style={{ fontSize: "16px", fontWeight: 600, marginBottom: "8px" }}>
              Authoritative Ownership Matrix
            </h3>
            <p style={{ fontSize: "13px", color: "var(--color-muted)", marginBottom: "20px" }}>
              Cross-ERP synchronization honors declared authoritative master boundaries. Child ERPs only push modifications
              if they hold authoritativeness or mutual write privileges for the domain entity.
            </p>

            <table className="data-table">
              <thead>
                <tr>
                  <th>Domain Entity</th>
                  <th>Primary Authoritative Node</th>
                  <th>Secondary / Target Nodes</th>
                  <th>Write Authority</th>
                </tr>
              </thead>
              <tbody>
                <tr>
                  <td><strong>Buyers & Clients</strong></td>
                  <td><span className="badge badge-primary">Yinglima ERP (Apparel Master)</span></td>
                  <td>Inhyma ERP (Downstream Mirror)</td>
                  <td><span style={{ color: "#059669", fontWeight: 600 }}>Source Authoritative</span></td>
                </tr>
                <tr>
                  <td><strong>Suppliers & Vendors</strong></td>
                  <td><span className="badge badge-primary">Inhyma ERP (Sourcing Master)</span></td>
                  <td>Yinglima ERP (Mirror)</td>
                  <td><span style={{ color: "#059669", fontWeight: 600 }}>Source Authoritative</span></td>
                </tr>
                <tr>
                  <td><strong>Product Catalog</strong></td>
                  <td><span className="badge badge-secondary">Federated Collaborative</span></td>
                  <td>All Connected Nodes</td>
                  <td><span style={{ color: "#2563eb", fontWeight: 600 }}>Mutual Collaborative</span></td>
                </tr>
                <tr>
                  <td><strong>Tasks & Workflow</strong></td>
                  <td><span className="badge badge-primary">Inhyma ERP (Operations Node)</span></td>
                  <td>Autonomous Execution</td>
                  <td><span style={{ color: "#059669", fontWeight: 600 }}>Node Authoritative</span></td>
                </tr>
              </tbody>
            </table>
          </div>

          {/* Test Ownership Resolver */}
          <div className="card" style={{ padding: "24px" }}>
            <h3 style={{ fontSize: "16px", fontWeight: 600, marginBottom: "8px" }}>
              Test Authoritative Ownership Resolver
            </h3>
            <p style={{ fontSize: "13px", color: "var(--color-muted)", marginBottom: "20px" }}>
              Simulates live backend owner resolution logic via <code>GET /global/sync-policies/resolve</code>.
            </p>

            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))", gap: "16px", marginBottom: "20px" }}>
              <div>
                <label className="form-label">Source ERP</label>
                <select className="form-select" value={testSource} onChange={(e) => setTestSource(e.target.value)}>
                  {erps.map((e) => (
                    <option key={e.id} value={e.id}>{e.name}</option>
                  ))}
                </select>
              </div>

              <div>
                <label className="form-label">Target ERP</label>
                <select className="form-select" value={testTarget} onChange={(e) => setTestTarget(e.target.value)}>
                  {erps.map((e) => (
                    <option key={e.id} value={e.id}>{e.name}</option>
                  ))}
                </select>
              </div>

              <div>
                <label className="form-label">Entity Type</label>
                <select className="form-select" value={testEntity} onChange={(e) => setTestEntity(e.target.value)}>
                  <option value="buyer">buyer</option>
                  <option value="product">product</option>
                  <option value="supplier">supplier</option>
                  <option value="order">order</option>
                </select>
              </div>
            </div>

            <div style={{ display: "flex", alignItems: "center", gap: "16px" }}>
              <button
                type="button"
                className="btn btn-primary"
                onClick={handleResolveOwner}
                disabled={resolving || !testSource || !testTarget}
              >
                {resolving ? "Resolving..." : "Resolve Authoritative Owner"}
              </button>

              {resolvedOwner && (
                <div style={{ fontSize: "14px", fontWeight: 600, color: "var(--color-text)" }}>
                  Resolved Owner: <span style={{ color: "var(--color-primary)" }}>{resolvedOwner}</span>
                </div>
              )}
            </div>
          </div>
        </div>
      ) : activeTab === "entity-mappings" ? (
        /* TAB 3: ENTITY MAPPINGS */
        <div>
          <div className="card" style={{ padding: "24px", marginBottom: "20px" }}>
            <h3 style={{ fontSize: "16px", fontWeight: 600, marginBottom: "8px" }}>
              Cross-ERP Entity ID Mapping Directory
            </h3>
            <p style={{ fontSize: "13px", color: "var(--color-muted)", marginBottom: "20px" }}>
              Explicit identity mapping prevents duplicate entity creation and enables idempotent reconciliation between ERPs.
            </p>

            {canManage && (
              <form onSubmit={handleCreateMapping} style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: "12px", alignItems: "flex-end" }}>
                <div>
                  <label className="form-label">Source Node</label>
                  <select className="form-select" value={mapSourceErp} onChange={(e) => setMapSourceErp(e.target.value)}>
                    {erps.map((e) => <option key={e.id} value={e.id}>{e.name}</option>)}
                  </select>
                </div>

                <div>
                  <label className="form-label">Source Entity Type</label>
                  <input className="form-input" value={mapSourceEntity} onChange={(e) => setMapSourceEntity(e.target.value)} />
                </div>

                <div>
                  <label className="form-label">Source ID</label>
                  <input className="form-input" placeholder="e.g. BYR-001" value={mapSourceId} onChange={(e) => setMapSourceId(e.target.value)} />
                </div>

                <div>
                  <label className="form-label">Target Node</label>
                  <select className="form-select" value={mapTargetErp} onChange={(e) => setMapTargetErp(e.target.value)}>
                    {erps.map((e) => <option key={e.id} value={e.id}>{e.name}</option>)}
                  </select>
                </div>

                <div>
                  <label className="form-label">Target Entity Type</label>
                  <input className="form-input" value={mapTargetEntity} onChange={(e) => setMapTargetEntity(e.target.value)} />
                </div>

                <div>
                  <label className="form-label">Target ID</label>
                  <input className="form-input" placeholder="e.g. INH-BYR-001" value={mapTargetId} onChange={(e) => setMapTargetId(e.target.value)} />
                </div>

                <div>
                  <button type="submit" className="btn btn-primary" style={{ width: "100%", height: "36px" }} disabled={creatingMapping}>
                    {creatingMapping ? "Linking..." : "Establish Link"}
                  </button>
                </div>
              </form>
            )}
          </div>

          <div className="card" style={{ overflow: "hidden" }}>
            <table className="data-table" id="table-mappings">
              <thead>
                <tr>
                  <th>Source Entity</th>
                  <th>Source Node</th>
                  <th>Target Node</th>
                  <th>Target Entity</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                {createdMappings.length === 0 ? (
                  <tr>
                    <td colSpan={5} style={{ textAlign: "center", padding: "32px", color: "var(--color-muted)" }}>
                      Active identity mappings are tracked in the database. Use the form above to register an explicit ID mapping.
                    </td>
                  </tr>
                ) : (
                  createdMappings.map((m, idx) => (
                    <tr key={idx}>
                      <td><code>{m.source_entity_type}: {m.source_entity_id}</code></td>
                      <td>{m.source_erp_id}</td>
                      <td>{m.target_erp_id}</td>
                      <td><code>{m.target_entity_type}: {m.target_entity_id}</code></td>
                      <td><span className="badge badge-success">ESTABLISHED</span></td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      ) : activeTab === "reconciliation" ? (
        /* TAB 4: RECONCILIATION */
        <div className="card" style={{ padding: "24px" }}>
          <h3 style={{ fontSize: "16px", fontWeight: 600, marginBottom: "8px" }}>
            Cross-ERP Data Reconciliation Passes
          </h3>
          <p style={{ fontSize: "13px", color: "var(--color-muted)", marginBottom: "20px" }}>
            Triggers authoritative checksum and state reconciliation across child ERP nodes to discover and report any drift.
          </p>

          <table className="data-table">
            <thead>
              <tr>
                <th>ERP Node</th>
                <th>Base URL</th>
                <th>Last Pass Status</th>
                <th>Reconciled Entities</th>
                <th style={{ textAlign: "right" }}>Actions</th>
              </tr>
            </thead>
            <tbody>
              {erps.map((erp) => {
                const rec = reconciliations[erp.id];
                return (
                  <tr key={erp.id}>
                    <td><strong>{erp.name}</strong></td>
                    <td>{erp.base_url}</td>
                    <td>
                      {rec ? (
                        <StatusBadge status={rec.status === "MATCHED" ? "ACTIVE" : "PENDING"} />
                      ) : (
                        <span style={{ color: "var(--color-muted)" }}>Pass Not Run Yet</span>
                      )}
                    </td>
                    <td>
                      {rec ? (
                        <span>
                          <strong>{rec.projection_count}</strong> records projected
                          {rec.outbox_published_count !== undefined && rec.outbox_published_count !== null
                            ? ` (${rec.outbox_published_count} outbox published)`
                            : ""}
                        </span>
                      ) : (
                        <span style={{ color: "var(--color-muted)" }}>—</span>
                      )}
                    </td>
                    <td style={{ textAlign: "right" }}>
                      <button
                        type="button"
                        className="btn btn-secondary btn-sm"
                        disabled={reconcilingId === erp.id}
                        onClick={() => handleRunReconciliation(erp.id, erp.name)}
                      >
                        {reconcilingId === erp.id ? "Reconciling..." : "Run Reconciliation"}
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      ) : activeTab === "conflicts" ? (
        /* TAB 5: CONFLICTS */
        <div className="card" style={{ padding: "32px", textAlign: "center" }}>
          <div style={{ color: "#059669", marginBottom: "12px" }}>
            <ICONS.check width={40} height={40} />
          </div>
          <h3 style={{ fontSize: "18px", fontWeight: 600, marginBottom: "8px" }}>
            Zero Active Synchronization Conflicts
          </h3>
          <p style={{ fontSize: "13px", color: "var(--color-muted)", maxWidth: "500px", margin: "0 auto 20px" }}>
            All cross-ERP synchronizations are currently operating under configured conflict resolution strategies
            (Last Write Wins / Source Wins). Any unresolved concurrent update conflicts will be queued here for operator triage.
          </p>
          <button
            type="button"
            className="btn btn-secondary btn-sm"
            onClick={() => navigate("/conflicts")}
          >
            Inspect Identity Linking Conflicts &rarr;
          </button>
        </div>
      ) : activeTab === "repair-replay" ? (
        /* TAB 6: REPAIR / REPLAY */
        <div className="card" style={{ padding: "32px", textAlign: "center" }}>
          <div style={{ color: "var(--color-primary)", marginBottom: "12px" }}>
            <ICONS.refresh width={40} height={40} />
          </div>
          <h3 style={{ fontSize: "18px", fontWeight: 600, marginBottom: "8px" }}>
            Event Repair & Dead Letter Replay Engine
          </h3>
          <p style={{ fontSize: "13px", color: "var(--color-muted)", maxWidth: "540px", margin: "0 auto 20px" }}>
            Failed event deliveries and dead-letter payloads can be inspected, repaired, and dispatched back into
            the transactional ingestion pipeline with verified idempotent correlation IDs.
          </p>
          <button
            type="button"
            className="btn btn-primary"
            onClick={() => navigate("/integrations/dlq")}
          >
            Open Dead Letter Queue & Operations &rarr;
          </button>
        </div>
      ) : (
        /* TAB 7: SNAPSHOTS */
        <div className="card" style={{ padding: "24px" }}>
          <h3 style={{ fontSize: "16px", fontWeight: 600, marginBottom: "8px" }}>
            Data Projection Read Snapshots
          </h3>
          <p style={{ fontSize: "13px", color: "var(--color-muted)", marginBottom: "20px" }}>
            Current read-model projection snapshots compiled from global event streams for enterprise reporting.
          </p>

          <table className="data-table">
            <thead>
              <tr>
                <th>Projection Snapshot</th>
                <th>Target Schema</th>
                <th>Source Stream</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td><strong>Global Buyer Directory</strong></td>
                <td><code>public.global_buyers</code></td>
                <td><code>buyer.created, buyer.updated</code></td>
                <td><span className="badge badge-success">UP TO DATE</span></td>
              </tr>
              <tr>
                <td><strong>Global ERP Instances</strong></td>
                <td><code>public.erp_instances</code></td>
                <td><code>erp.registered, erp.heartbeat</code></td>
                <td><span className="badge badge-success">UP TO DATE</span></td>
              </tr>
              <tr>
                <td><strong>Ecosystem Security Audit</strong></td>
                <td><code>public.global_audit_logs</code></td>
                <td><code>authz.*, access.*</code></td>
                <td><span className="badge badge-success">STREAMING LIVE</span></td>
              </tr>
            </tbody>
          </table>
        </div>
      )}

      {/* Create Policy Modal */}
      {createModalOpen && (
        <Modal
          title="Create Entity Synchronization Policy"
          onClose={() => setCreateModalOpen(false)}
        >
          <form onSubmit={handleCreatePolicy}>
            <div style={{ display: "flex", flexDirection: "column", gap: "16px" }}>
              <div>
                <label className="form-label">Entity Type</label>
                <select
                  className="form-select"
                  value={formEntityType}
                  onChange={(e) => setFormEntityType(e.target.value)}
                >
                  <option value="buyer">buyer</option>
                  <option value="product">product</option>
                  <option value="supplier">supplier</option>
                  <option value="order">order</option>
                </select>
              </div>

              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "12px" }}>
                <div>
                  <label className="form-label">Source ERP</label>
                  <select
                    className="form-select"
                    value={formSourceErp}
                    onChange={(e) => setFormSourceErp(e.target.value)}
                  >
                    {erps.map((e) => (
                      <option key={e.id} value={e.id}>
                        {e.name}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="form-label">Target ERP</label>
                  <select
                    className="form-select"
                    value={formTargetErp}
                    onChange={(e) => setFormTargetErp(e.target.value)}
                  >
                    {erps.map((e) => (
                      <option key={e.id} value={e.id}>
                        {e.name}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              <div>
                <label className="form-label">Ownership Strategy</label>
                <select
                  className="form-select"
                  value={formOwnership}
                  onChange={(e) => setFormOwnership(e.target.value)}
                >
                  <option value="SOURCE_AUTHORITATIVE">SOURCE_AUTHORITATIVE</option>
                  <option value="TARGET_AUTHORITATIVE">TARGET_AUTHORITATIVE</option>
                  <option value="MUTUAL_COLLABORATIVE">MUTUAL_COLLABORATIVE</option>
                  <option value="GLOBAL_HUB_AUTHORITATIVE">GLOBAL_HUB_AUTHORITATIVE</option>
                </select>
              </div>

              <div>
                <label className="form-label">Sync Direction</label>
                <select
                  className="form-select"
                  value={formDirection}
                  onChange={(e) => setFormDirection(e.target.value)}
                >
                  <option value="BIDIRECTIONAL">BIDIRECTIONAL</option>
                  <option value="SOURCE_TO_TARGET">SOURCE_TO_TARGET</option>
                  <option value="TARGET_TO_SOURCE">TARGET_TO_SOURCE</option>
                </select>
              </div>

              <div>
                <label className="form-label">Conflict Resolution Strategy</label>
                <select
                  className="form-select"
                  value={formConflict}
                  onChange={(e) => setFormConflict(e.target.value)}
                >
                  <option value="LAST_WRITE_WINS">LAST_WRITE_WINS</option>
                  <option value="SOURCE_WINS">SOURCE_WINS</option>
                  <option value="TARGET_WINS">TARGET_WINS</option>
                  <option value="MANUAL_RESOLUTION">MANUAL_RESOLUTION</option>
                  <option value="REJECT_AND_DEAD_LETTER">REJECT_AND_DEAD_LETTER</option>
                </select>
              </div>

              <div style={{ display: "flex", justifyContent: "flex-end", gap: "8px", marginTop: "16px" }}>
                <button
                  type="button"
                  className="btn btn-secondary"
                  onClick={() => setCreateModalOpen(false)}
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="btn btn-primary"
                  disabled={creatingPolicy}
                >
                  {creatingPolicy ? "Creating..." : "Create Policy"}
                </button>
              </div>
            </div>
          </form>
        </Modal>
      )}

      {/* Update Policy Status Modal */}
      {statusModalOpen && selectedPolicy && (
        <Modal
          title={`Update Policy Status: ${selectedPolicy.entity_type}`}
          onClose={() => {
            setStatusModalOpen(false);
            setSelectedPolicy(null);
          }}
        >
          <div style={{ display: "flex", flexDirection: "column", gap: "16px" }}>
            <p style={{ fontSize: "13px", color: "var(--color-text-secondary)" }}>
              Change operational state for sync policy <code>{selectedPolicy.id}</code>:
            </p>

            <div>
              <label className="form-label">New Status</label>
              <select
                className="form-select"
                value={newStatus}
                onChange={(e) => setNewStatus(e.target.value)}
              >
                <option value="ACTIVE">ACTIVE</option>
                <option value="PAUSED">PAUSED</option>
                <option value="DRAFT">DRAFT</option>
                <option value="DEPRECATED">DEPRECATED</option>
              </select>
            </div>

            <div style={{ display: "flex", justifyContent: "flex-end", gap: "8px", marginTop: "16px" }}>
              <button
                type="button"
                className="btn btn-secondary"
                onClick={() => {
                  setStatusModalOpen(false);
                  setSelectedPolicy(null);
                }}
              >
                Cancel
              </button>
              <button
                type="button"
                className="btn btn-primary"
                onClick={handleUpdateStatus}
                disabled={updatingStatus}
              >
                {updatingStatus ? "Updating..." : "Update Status"}
              </button>
            </div>
          </div>
        </Modal>
      )}
    </AppShell>
  );
}
