/**
 * Federated Platform Search for ERP_Main Control Plane (Phase 7).
 *
 * Implements an extensible cross-ERP search experience over decentralized
 * projection read models with entity renderer registry, URL query state,
 * and inspection drawer.
 */

import { useEffect, useState, useCallback } from "react";
import { useSearchParams, Link } from "react-router-dom";
import { apiGet } from "@/lib/api";
import { useDebounce } from "@/lib/hooks";
import { AppShell } from "@/components/AppShell";
import { StatusBadge, LoadingSpinner, Banner, EmptyState, Modal } from "@/components/ui";
import { Pagination } from "@/components/Pagination";
import { ICONS } from "@/components/icons";
import type {
  SearchResponse,
  GlobalBuyerProjection,
  GlobalBuyerProjectionDetail,
  GenericSearchResult,
  ErpInstance,
} from "@/types";

// Supported & Planned Entity Types
const ENTITY_TYPES = [
  { key: "all", label: "All Projections", available: true },
  { key: "buyer", label: "Buyers (Supported)", available: true },
  { key: "supplier", label: "Suppliers (Not Yet Supported)", available: false },
  { key: "product", label: "Products (Not Yet Supported)", available: false },
  { key: "quotation", label: "Quotations (Not Yet Supported)", available: false },
];

export function Search() {
  const [searchParams, setSearchParams] = useSearchParams();

  // URL Query Parameters
  const initialQuery = searchParams.get("q") || "";
  const initialErp = searchParams.get("erp") || "ALL";
  const initialType = searchParams.get("type") || "buyer";
  const initialStatus = searchParams.get("status") || "ALL";
  const initialPage = parseInt(searchParams.get("page") || "1", 10);

  const [query, setQuery] = useState(initialQuery);
  const [selectedErp, setSelectedErp] = useState(initialErp);
  const [entityType, setEntityType] = useState(initialType);
  const [statusFilter, setStatusFilter] = useState(initialStatus);
  const [page, setPage] = useState(initialPage);
  const pageSize = 20;

  const [erps, setErps] = useState<ErpInstance[]>([]);
  const [results, setResults] = useState<GenericSearchResult[]>([]);
  const [total, setTotal] = useState(0);
  const [dataAsOf, setDataAsOf] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<unknown>(null);

  // Detail Inspection Drawer
  const [inspectItem, setInspectItem] = useState<GenericSearchResult | null>(null);
  const [inspectDetail, setInspectDetail] = useState<GlobalBuyerProjectionDetail | null>(null);
  const [loadingDetail, setLoadingDetail] = useState(false);

  // Debounced input for live typing
  const debouncedQuery = useDebounce(query, 350);

  // Load ERP instances for filter
  useEffect(() => {
    apiGet<ErpInstance[]>("/global/erp-instances")
      .then((data) => setErps(Array.isArray(data) ? data : []))
      .catch(() => setErps([]));
  }, []);

  // Sync state to URL params
  const updateUrl = useCallback(
    (newQ: string, newErp: string, newType: string, newStatus: string, newPage: number) => {
      const params = new URLSearchParams();
      if (newQ.trim()) params.set("q", newQ.trim());
      if (newErp !== "ALL") params.set("erp", newErp);
      if (newType !== "buyer") params.set("type", newType);
      if (newStatus !== "ALL") params.set("status", newStatus);
      if (newPage > 1) params.set("page", String(newPage));
      setSearchParams(params, { replace: true });
    },
    [setSearchParams]
  );

  const executeSearch = useCallback(
    async (qStr: string, erpId: string, statusVal: string, pageNum: number) => {
      setLoading(true);
      setError(null);
      try {
        const offset = (pageNum - 1) * pageSize;
        const queryParams = new URLSearchParams();
        if (qStr.trim()) queryParams.set("q", qStr.trim());
        if (statusVal !== "ALL") queryParams.set("status", statusVal);
        queryParams.set("limit", String(pageSize));
        queryParams.set("offset", String(offset));

        // Currently, search operates over /global/search/buyers
        const res = await apiGet<SearchResponse>(`/global/search/buyers?${queryParams.toString()}`);
        if (res) {
          // Client-side ERP filter if a specific ERP was picked and backend returned multi-ERP
          let rawList = res.results || [];
          if (erpId !== "ALL") {
            rawList = rawList.filter((r) => r.source_erp_id === erpId);
          }

          // Map to Generic Search Results (extensible architecture)
          const genericList: GenericSearchResult[] = rawList.map((b: GlobalBuyerProjection) => ({
            id: b.id,
            entity_type: b.source_entity_type || "buyer",
            display_title: b.company_name,
            display_subtitle: `Source Entity ID: ${b.source_entity_id}`,
            source_erp_id: b.source_erp_id,
            source_entity_id: b.source_entity_id,
            status: b.status,
            synced_at: b.synced_at,
            raw_data: { ...b },
          }));

          setResults(genericList);
          setTotal(erpId !== "ALL" ? genericList.length : res.total || 0);
          setDataAsOf(res.data_as_of || null);
        }
      } catch (err) {
        setError(err);
      } finally {
        setLoading(false);
      }
    },
    [pageSize]
  );

  // Trigger search on filter changes
  useEffect(() => {
    updateUrl(debouncedQuery, selectedErp, entityType, statusFilter, page);
    executeSearch(debouncedQuery, selectedErp, statusFilter, page);
  }, [debouncedQuery, selectedErp, entityType, statusFilter, page, updateUrl, executeSearch]);

  const handleInspect = async (item: GenericSearchResult) => {
    setInspectItem(item);
    setInspectDetail(null);
    setLoadingDetail(true);
    try {
      const detail = await apiGet<GlobalBuyerProjectionDetail>(`/global/projections/buyers/${item.id}`);
      setInspectDetail(detail);
    } catch {
      // If single endpoint not available, fallback to raw_data
      setInspectDetail({
        ...(item.raw_data as unknown as GlobalBuyerProjection),
        last_event_id: "N/A",
        last_event_occurred_at: item.synced_at,
        created_at: item.synced_at,
        updated_at: item.synced_at,
      });
    } finally {
      setLoadingDetail(false);
    }
  };

  const getErpName = (erpId: string) => {
    const found = erps.find((e) => e.id === erpId);
    return found ? (found.name || found.display_name || found.erp_key) : `${erpId.slice(0, 8)}...`;
  };

  return (
    <AppShell
      activeKey="search"
      pageTitle="Federated Platform Search"
      breadcrumbs={["Reporting & Search", "Federated Search"]}
    >
      <Banner error={error} />

      {/* Main Search Input Card */}
      <div className="card" style={{ padding: "24px", marginBottom: "20px" }}>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            setPage(1);
            executeSearch(query, selectedErp, statusFilter, 1);
          }}
        >
          <div style={{ position: "relative", marginBottom: "16px" }}>
            <ICONS.search
              width={20}
              height={20}
              style={{ position: "absolute", left: "16px", top: "14px", color: "var(--color-primary)" }}
            />
            <input
              type="text"
              className="form-input"
              style={{
                paddingLeft: "48px",
                paddingRight: "100px",
                height: "48px",
                fontSize: "16px",
                width: "100%",
                borderRadius: "var(--radius)",
              }}
              placeholder="Search cross-ERP projections by company or entity name (e.g. Acme, Horizon)..."
              value={query}
              onChange={(e) => {
                setQuery(e.target.value);
                setPage(1);
              }}
              autoFocus
            />
            <button
              type="submit"
              className="btn btn-primary"
              style={{ position: "absolute", right: "6px", top: "6px", height: "36px", padding: "0 16px" }}
            >
              Search
            </button>
          </div>
        </form>

        {/* Filter Controls Row */}
        <div style={{ display: "flex", gap: "12px", alignItems: "center", flexWrap: "wrap" }}>
          {/* Entity Type Selector */}
          <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
            <span style={{ fontSize: "12px", color: "var(--color-muted)", fontWeight: 600 }}>ENTITY:</span>
            <select
              className="form-select"
              style={{ height: "34px", fontSize: "13px", width: "auto" }}
              value={entityType}
              onChange={(e) => {
                setEntityType(e.target.value);
                setPage(1);
              }}
            >
              {ENTITY_TYPES.map((t) => (
                <option key={t.key} value={t.key} disabled={!t.available}>
                  {t.label}
                </option>
              ))}
            </select>
          </div>

          {/* ERP Filter */}
          <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
            <span style={{ fontSize: "12px", color: "var(--color-muted)", fontWeight: 600 }}>ERP:</span>
            <select
              className="form-select"
              style={{ height: "34px", fontSize: "13px", width: "auto" }}
              value={selectedErp}
              onChange={(e) => {
                setSelectedErp(e.target.value);
                setPage(1);
              }}
            >
              <option value="ALL">All Registered ERPs</option>
              {erps.map((e) => (
                <option key={e.id} value={e.id}>
                  {e.name || e.display_name || e.erp_key} ({e.erp_key || e.key})
                </option>
              ))}
            </select>
          </div>

          {/* Status Filter */}
          <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
            <span style={{ fontSize: "12px", color: "var(--color-muted)", fontWeight: 600 }}>STATUS:</span>
            <select
              className="form-select"
              style={{ height: "34px", fontSize: "13px", width: "auto" }}
              value={statusFilter}
              onChange={(e) => {
                setStatusFilter(e.target.value);
                setPage(1);
              }}
            >
              <option value="ALL">All Statuses</option>
              <option value="ACTIVE">Active</option>
              <option value="INACTIVE">Inactive</option>
            </select>
          </div>

          {(query || selectedErp !== "ALL" || statusFilter !== "ALL") && (
            <button
              type="button"
              className="btn btn-secondary btn-sm"
              onClick={() => {
                setQuery("");
                setSelectedErp("ALL");
                setStatusFilter("ALL");
                setPage(1);
              }}
              style={{ fontSize: "12px" }}
            >
              Reset Filters
            </button>
          )}
        </div>

        {/* Freshness & Guardrail Footer */}
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            marginTop: "16px",
            paddingTop: "12px",
            borderTop: "1px solid var(--color-border-light)",
            fontSize: "12px",
            color: "var(--color-muted)",
          }}
        >
          <span>
            Searches asynchronous read projections maintained in ERP_Main. Zero direct live queries to business ERP
            databases.
          </span>
          {dataAsOf && (
            <span>
              Projection Freshness: <strong>{new Date(dataAsOf).toLocaleTimeString()}</strong>
            </span>
          )}
        </div>
      </div>

      {/* Results Section */}
      {loading ? (
        <LoadingSpinner text="Searching global projection index..." />
      ) : results.length === 0 ? (
        <EmptyState
          title="No Projections Found"
          description={
            query.trim() || selectedErp !== "ALL" || statusFilter !== "ALL"
              ? "No projection records match your filter criteria. Verify spelling or check whether source ERP events have been ingested."
              : "No entity projections found in the control plane index."
          }
          action={
            <Link to="/integration" className="btn btn-secondary">
              Check Integration Event Stream
            </Link>
          }
        />
      ) : (
        <div>
          <div
            style={{
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center",
              marginBottom: "12px",
              fontSize: "13px",
              color: "var(--color-muted)",
            }}
          >
            <span>
              Found <strong>{total}</strong> projection record{total === 1 ? "" : "s"} matching query
            </span>
            <span>Page {page}</span>
          </div>

          <div className="card" style={{ padding: 0, overflow: "hidden", marginBottom: "16px" }}>
            <div className="table-wrap">
              <table className="table">
                <thead>
                  <tr>
                    <th>Entity / Company Name</th>
                    <th>Entity Type</th>
                    <th>Source ERP</th>
                    <th>Status</th>
                    <th>Last Projected At</th>
                    <th style={{ textAlign: "right" }}>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {results.map((r) => (
                    <tr key={r.id}>
                      {/* Entity Renderer Pattern: Specialized Buyer Rendering */}
                      <td>
                        <div style={{ fontWeight: 700, fontSize: "14px", color: "var(--color-text)" }}>
                          {r.display_title}
                        </div>
                        <div style={{ fontSize: "11px", color: "var(--color-muted)", fontFamily: "monospace" }}>
                          Local ID: {r.source_entity_id}
                        </div>
                      </td>
                      <td>
                        <span className="badge badge-info" style={{ textTransform: "capitalize" }}>
                          {r.entity_type}
                        </span>
                      </td>
                      <td>
                        <span style={{ fontWeight: 600, fontSize: "13px", color: "var(--color-text)" }}>
                          {getErpName(r.source_erp_id)}
                        </span>
                        <div style={{ fontSize: "11px", color: "var(--color-muted)", fontFamily: "monospace" }}>
                          {r.source_erp_id.slice(0, 8)}...
                        </div>
                      </td>
                      <td>
                        <StatusBadge status={r.status || "ACTIVE"} />
                      </td>
                      <td style={{ fontSize: "12px", color: "var(--color-muted)", whiteSpace: "nowrap" }}>
                        {new Date(r.synced_at).toLocaleString([], {
                          dateStyle: "short",
                          timeStyle: "short",
                        })}
                      </td>
                      <td style={{ textAlign: "right" }}>
                        <div style={{ display: "inline-flex", gap: "6px" }}>
                          <button
                            type="button"
                            className="btn btn-secondary btn-sm"
                            onClick={() => handleInspect(r)}
                          >
                            Inspect
                          </button>
                          {/* Safe Deep-linking action: honestly disabled if deep links not configured */}
                          <button
                            type="button"
                            className="btn btn-secondary btn-sm"
                            disabled
                            title="Deep linking to local buyer record in source ERP is not yet configured"
                            style={{ opacity: 0.6, cursor: "not-allowed" }}
                          >
                            Open in ERP
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          <Pagination
            pagination={{
              current_page: page,
              total_pages: Math.ceil(total / pageSize) || 1,
              total_records: total,
              page_size: pageSize,
              has_previous: page > 1,
              has_next: page < (Math.ceil(total / pageSize) || 1),
            }}
            pageSize={pageSize}
            onPageChange={(newPage) => {
              setPage(newPage);
              window.scrollTo({ top: 0, behavior: "smooth" });
            }}
          />
        </div>
      )}

      {/* Projection Detail Drawer */}
      <Modal
        open={Boolean(inspectItem)}
        onClose={() => setInspectItem(null)}
        title="Projection Record Inspection"
        variant="drawer"
        cardStyle={{ width: "540px" }}
      >
        {inspectItem && (
          <div style={{ display: "flex", flexDirection: "column", gap: "16px" }}>
            <div>
              <span className="drawer-detail-label">PROJECTION ENTITY</span>
              <h3 style={{ margin: "4px 0 0", fontSize: "18px", color: "var(--color-text)" }}>
                {inspectItem.display_title}
              </h3>
            </div>

            {loadingDetail ? (
              <LoadingSpinner text="Fetching projection metadata..." />
            ) : (
              <div className="drawer-detail-grid">
                <div className="drawer-detail-row">
                  <span className="drawer-detail-label">GLOBAL PROJECTION ID</span>
                  <code style={{ fontSize: "12px" }}>{inspectItem.id}</code>
                </div>

                <div className="drawer-detail-row">
                  <span className="drawer-detail-label">SOURCE ERP INSTANCE</span>
                  <div style={{ fontWeight: 600 }}>{getErpName(inspectItem.source_erp_id)}</div>
                  <code style={{ fontSize: "11px", color: "var(--color-muted)" }}>
                    Instance UUID: {inspectItem.source_erp_id}
                  </code>
                </div>

                <div className="drawer-detail-row">
                  <span className="drawer-detail-label">SOURCE ENTITY DETAILS</span>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                    <span>Type: <strong style={{ textTransform: "capitalize" }}>{inspectItem.entity_type}</strong></span>
                    <StatusBadge status={inspectItem.status || "ACTIVE"} />
                  </div>
                  <code style={{ fontSize: "11px", marginTop: "4px" }}>
                    Local ID: {inspectItem.source_entity_id}
                  </code>
                </div>

                <div className="drawer-detail-row">
                  <span className="drawer-detail-label">SYNCHRONIZATION METADATA</span>
                  <div style={{ fontSize: "13px" }}>
                    Last projected at: <strong>{new Date(inspectItem.synced_at).toLocaleString()}</strong>
                  </div>
                  {inspectDetail?.last_event_id && (
                    <div style={{ fontSize: "11px", color: "var(--color-muted)", marginTop: "4px" }}>
                      Integration Event ID: <code>{inspectDetail.last_event_id}</code>
                    </div>
                  )}
                  {inspectDetail?.last_event_occurred_at && (
                    <div style={{ fontSize: "11px", color: "var(--color-muted)" }}>
                      Event Occurred: {new Date(inspectDetail.last_event_occurred_at).toLocaleString()}
                    </div>
                  )}
                </div>

                <div
                  style={{
                    padding: "10px 12px",
                    background: "#f8fafc",
                    borderRadius: "var(--radius)",
                    border: "1px solid var(--color-border)",
                    fontSize: "12px",
                    color: "var(--color-muted)",
                  }}
                >
                  <strong>Data Sovereignty Note:</strong> This record is a read projection stored in ERP_Main.
                  The authoritative business entity resides inside {getErpName(inspectItem.source_erp_id)}&apos;s
                  database.
                </div>
              </div>
            )}

            <div style={{ display: "flex", justifyContent: "flex-end", gap: "8px", marginTop: "12px" }}>
              <button type="button" className="btn btn-secondary" onClick={() => setInspectItem(null)}>
                Close
              </button>
            </div>
          </div>
        )}
      </Modal>
    </AppShell>
  );
}
