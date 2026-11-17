/**
 * Cargo Overview Page.
 *
 * Routes:
 *   - /reports/cargo-overview (List View or Detail View via ?key=...)
 *   - /reports/cargo-overview/detail/:key (Direct Detail View)
 * Sidebar Section: REPORTS (permission: report.view / cargo_overview.view)
 *
 * Unifies Finance Planning, Consignment Document Gallery (22 slots),
 * Cargo Status Shipment Checklist (12 Yes/No milestones + remarks), and
 * Product Summary into one List + Detail workspace.
 */

import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useNavigate, useParams, useSearchParams } from "react-router-dom";
import { AppShell } from "@/components/AppShell";
import { Breadcrumb } from "@/components/Breadcrumb";
import { DateRangePicker } from "@/components/DateRangePicker";
import { Pagination } from "@/components/Pagination";
import { Modal } from "@/components/ui";
import {
  apiDelete,
  apiGet,
  apiPatch,
  apiPostMultipart,
  errorMessage,
  isAbortError,
} from "@/lib/api";
import { Auth } from "@/lib/auth";
import { useToast } from "@/lib/toast";
import type { PaginationMeta } from "@/types";
import type {
  CargoChecklistItem,
  CargoCurrency,
  CargoDocumentSlot,
  CargoOverviewListResponse,
  CargoOverviewRow,
  CargoPartyRole,
  CargoStage,
} from "@/types/cargoOverview";

export interface CargoOverviewPageProps {
  initialData?: CargoOverviewListResponse;
}

const GRANULAR_CARGO_PERMS = [
  "cargo_overview.view",
  "cargo_overview.finance.view",
  "cargo_overview.gallery.view",
  "cargo_overview.gallery.upload",
  "cargo_overview.gallery.delete",
  "cargo_overview.cargo_status.view",
  "cargo_overview.cargo_status.edit",
  "cargo_overview.product_summary.view",
] as const;

function useCargoPermissions() {
  const profile = Auth.getProfile();
  if (!profile || Auth.isSuperAdmin()) {
    return {
      canViewFinance: true,
      canViewGallery: true,
      canUploadGallery: true,
      canDeleteGallery: true,
      canViewCargoStatus: true,
      canEditCargoStatus: true,
      canViewProductSummary: true,
    };
  }
  const perms = Array.isArray(profile.permissions) ? profile.permissions : [];
  const hasAnyGranular = GRANULAR_CARGO_PERMS.some((code) => perms.includes(code));
  const fallbackReportView = !hasAnyGranular && Auth.hasPermission("report.view");

  return {
    canViewFinance: Auth.hasPermission("cargo_overview.finance.view") || fallbackReportView,
    canViewGallery: Auth.hasPermission("cargo_overview.gallery.view") || fallbackReportView,
    canUploadGallery: Auth.hasPermission("cargo_overview.gallery.upload") || fallbackReportView,
    canDeleteGallery: Auth.hasPermission("cargo_overview.gallery.delete") || fallbackReportView,
    canViewCargoStatus: Auth.hasPermission("cargo_overview.cargo_status.view") || fallbackReportView,
    canEditCargoStatus: Auth.hasPermission("cargo_overview.cargo_status.edit") || fallbackReportView,
    canViewProductSummary:
      Auth.hasPermission("cargo_overview.product_summary.view") || fallbackReportView,
  };
}

function formatCargoAmount(val: number | undefined | null, currency: CargoCurrency = "INR"): string {
  const n = Number.isFinite(Number(val)) ? Number(val) : 0;
  if (currency === "USD") {
    return `$ ${n.toLocaleString("en-US", {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    })}`;
  }
  return `₹ ${n.toLocaleString("en-IN", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

function formatDisplayDate(d?: string | null): string {
  if (!d) return "—";
  const parts = d.slice(0, 10).split("-");
  if (parts.length === 3 && parts[0].length === 4) {
    return `${parts[2]}-${parts[1]}-${parts[0]}`;
  }
  return d;
}

function parseFilterDate(value?: string | null): Date | null {
  if (!value) return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  const mdy = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(trimmed);
  if (mdy) {
    const dt = new Date(Number(mdy[3]), Number(mdy[1]) - 1, Number(mdy[2]));
    return Number.isNaN(dt.getTime()) ? null : dt;
  }
  const dmy = /^(\d{2})-(\d{2})-(\d{4})$/.exec(trimmed);
  if (dmy) {
    const dt = new Date(Number(dmy[3]), Number(dmy[2]) - 1, Number(dmy[1]));
    return Number.isNaN(dt.getTime()) ? null : dt;
  }
  const iso = /^(\d{4})-(\d{2})-(\d{2})/.exec(trimmed);
  if (iso) {
    const dt = new Date(Number(iso[1]), Number(iso[2]) - 1, Number(iso[3]));
    return Number.isNaN(dt.getTime()) ? null : dt;
  }
  return null;
}

function matchesDateRange(dateStr: string | null | undefined, rangeStr: string): boolean {
  if (!rangeStr || !rangeStr.includes("-")) return true;
  const [rawStart, rawEnd] = rangeStr.split("-").map((p) => p.trim());
  const start = parseFilterDate(rawStart);
  const end = parseFilterDate(rawEnd);
  if (!start && !end) return true;
  const itemDate = parseFilterDate(dateStr);
  if (!itemDate) return false;
  if (start && itemDate < start) return false;
  if (end) {
    const endOfDay = new Date(end.getFullYear(), end.getMonth(), end.getDate(), 23, 59, 59, 999);
    if (itemDate > endOfDay) return false;
  }
  return true;
}

function resolveFileHref(url?: string | null): string {
  if (!url) return "#";
  if (url.startsWith("/uploads/private/") || url.startsWith("/api/v1/")) {
    const token =
      Auth.getAccessToken() ||
      (typeof localStorage !== "undefined" ? localStorage.getItem("erp_access_token") : null);
    return token ? `${url}${url.includes("?") ? "&" : "?"}token=${encodeURIComponent(token)}` : url;
  }
  return url;
}

function roleBadgeStyle(role: CargoPartyRole): React.CSSProperties {
  if (role === "Supplier") {
    return { background: "#fef3c7", color: "#b45309", border: "1px solid #fde68a" };
  }
  if (role === "Cargo Forwarder") {
    return { background: "#dbeafe", color: "#1d4ed8", border: "1px solid #bfdbfe" };
  }
  if (role === "Clearing Agent") {
    return { background: "#dcfce7", color: "#15803d", border: "1px solid #bbf7d0" };
  }
  if (role === "Taxes") {
    return { background: "#fee2e2", color: "#dc2626", border: "1px solid #fecaca" };
  }
  return { background: "#e0f2fe", color: "#0369a1", border: "1px solid #bae6fd" };
}

interface ConsignmentHeaderStripProps {
  consignment: CargoOverviewRow;
  editable?: boolean;
  etdDraft?: string;
  etaDraft?: string;
  arrivalDraft?: string;
  forwarderDraft?: string;
  agentDraft?: string;
  onEtdChange?: (val: string) => void;
  onEtaChange?: (val: string) => void;
  onArrivalChange?: (val: string) => void;
  onForwarderChange?: (val: string) => void;
  onAgentChange?: (val: string) => void;
  onCommit?: () => void;
}

function ConsignmentHeaderStrip({
  consignment,
  editable = false,
  etdDraft = "",
  etaDraft = "",
  arrivalDraft = "",
  forwarderDraft = "",
  agentDraft = "",
  onEtdChange,
  onEtaChange,
  onArrivalChange,
  onForwarderChange,
  onAgentChange,
  onCommit,
}: ConsignmentHeaderStripProps) {
  const inputStyle: React.CSSProperties = {
    fontSize: 12.5,
    padding: "4px 8px",
    borderRadius: 6,
    border: "1px solid #cbd5e1",
    color: "#0f172a",
    background: editable ? "#ffffff" : "#f8fafc",
    width: "100%",
    boxSizing: "border-box",
  };

  return (
    <div
      data-testid="cargo-detail-header-strip"
      style={{
        background: "#ffffff",
        borderRadius: 12,
        border: "1px solid #e2e8f0",
        padding: "16px 20px",
        marginBottom: 20,
        boxShadow: "0 1px 3px rgba(15, 23, 42, 0.04)",
        display: "grid",
        gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))",
        gap: 16,
      }}
    >
      <div>
        <div style={{ fontSize: 12, fontWeight: 700, color: "#334155", marginBottom: 4 }}>
          Invoice / Cons. No. & Date
        </div>
        <div style={{ fontSize: 13, fontWeight: 700, color: "#0f172a" }}>
          {consignment.display_title}
        </div>
        <div style={{ fontSize: 12, color: "#64748b", marginTop: 2 }}>
          {consignment.invoice_or_order_summary} • {formatDisplayDate(consignment.ordered_date)}
        </div>
      </div>

      <div>
        <div style={{ fontSize: 12, fontWeight: 700, color: "#334155", marginBottom: 4 }}>
          Supplier Name
        </div>
        <div style={{ fontSize: 13, color: "#334155", fontWeight: 600 }}>
          {consignment.supplier_summary || "—"}
        </div>
      </div>

      <div>
        <div style={{ fontSize: 12, fontWeight: 700, color: "#334155", marginBottom: 4 }}>
          Warehouse
        </div>
        <div style={{ fontSize: 13, color: "#334155", fontWeight: 600 }}>
          {consignment.warehouse || "—"}
        </div>
      </div>

      <div>
        <div style={{ fontSize: 12, fontWeight: 700, color: "#334155", marginBottom: 4 }}>
          Ordered Date
        </div>
        <div style={{ fontSize: 13, color: "#334155" }}>
          {formatDisplayDate(consignment.ordered_date)}
        </div>
      </div>

      <div>
        <div style={{ fontSize: 12, fontWeight: 700, color: "#334155", marginBottom: 4 }}>
          ETD Origin
        </div>
        {editable ? (
          <input
            type="date"
            aria-label="ETD Origin"
            value={etdDraft}
            onChange={(e) => onEtdChange?.(e.target.value)}
            onBlur={() => onCommit?.()}
            style={inputStyle}
          />
        ) : (
          <div style={{ fontSize: 13, color: "#334155" }}>
            {formatDisplayDate(consignment.etd_origin_date)}
          </div>
        )}
      </div>

      <div>
        <div style={{ fontSize: 12, fontWeight: 700, color: "#334155", marginBottom: 4 }}>
          ETA Port
        </div>
        {editable ? (
          <input
            type="date"
            aria-label="ETA Port"
            value={etaDraft}
            onChange={(e) => onEtaChange?.(e.target.value)}
            onBlur={() => onCommit?.()}
            style={inputStyle}
          />
        ) : (
          <div style={{ fontSize: 13, color: "#334155" }}>
            {formatDisplayDate(consignment.eta_port_date)}
          </div>
        )}
      </div>

      <div>
        <div style={{ fontSize: 12, fontWeight: 700, color: "#334155", marginBottom: 4 }}>
          Expected Arrival
        </div>
        {editable ? (
          <input
            type="date"
            aria-label="Expected Arrival"
            value={arrivalDraft}
            onChange={(e) => onArrivalChange?.(e.target.value)}
            onBlur={() => onCommit?.()}
            style={inputStyle}
          />
        ) : (
          <div style={{ fontSize: 13, color: "#334155" }}>
            {formatDisplayDate(consignment.expected_arrival_date)}
          </div>
        )}
      </div>

      <div>
        <div style={{ fontSize: 12, fontWeight: 700, color: "#334155", marginBottom: 4 }}>
          Forwarder Name
        </div>
        {editable ? (
          <input
            type="text"
            aria-label="Forwarder Name"
            placeholder="Shipping Forwarder"
            value={forwarderDraft}
            onChange={(e) => onForwarderChange?.(e.target.value)}
            onBlur={() => onCommit?.()}
            style={inputStyle}
          />
        ) : (
          <div style={{ fontSize: 13, color: "#334155" }}>
            {consignment.forwarder_name || "—"}
          </div>
        )}
      </div>

      <div>
        <div style={{ fontSize: 12, fontWeight: 700, color: "#334155", marginBottom: 4 }}>
          Clearing Agent
        </div>
        {editable ? (
          <input
            type="text"
            aria-label="Clearing Agent"
            placeholder="Clearing Agent"
            value={agentDraft}
            onChange={(e) => onAgentChange?.(e.target.value)}
            onBlur={() => onCommit?.()}
            style={inputStyle}
          />
        ) : (
          <div style={{ fontSize: 13, color: "#334155" }}>
            {consignment.clearing_agent_name || "—"}
          </div>
        )}
      </div>
    </div>
  );
}

interface DocumentGalleryGridProps {
  consignmentKey: string;
  documents: CargoDocumentSlot[];
  canUpload: boolean;
  canDelete: boolean;
  uploadingSlot: string | null;
  deletingSlot: string | null;
  onUpload: (consignmentKey: string, slotKey: string, file: File | null) => void;
  onDelete: (consignmentKey: string, slotKey: string) => void;
}

function DocumentGalleryGrid({
  consignmentKey,
  documents,
  canUpload,
  canDelete,
  uploadingSlot,
  deletingSlot,
  onUpload,
  onDelete,
}: DocumentGalleryGridProps) {
  return (
    <div
      data-testid="cargo-gallery-grid"
      style={{
        display: "grid",
        gridTemplateColumns: "repeat(auto-fill, minmax(275px, 1fr))",
        gap: 14,
      }}
    >
      {documents.map((doc) => {
        const isUploading = uploadingSlot === doc.slot_key;
        const isDeleting = deletingSlot === doc.slot_key;
        const hasFile = Boolean(doc.file_url);
        return (
          <div
            key={doc.slot_key}
            data-testid={`cargo-doc-slot-${doc.slot_key}`}
            style={{
              border: hasFile ? "1px solid #bfdbfe" : "1px solid #e2e8f0",
              borderRadius: 10,
              padding: "14px 16px",
              background: hasFile ? "#f8fbff" : "#ffffff",
              display: "flex",
              flexDirection: "column",
              justifyContent: "space-between",
              gap: 10,
            }}
          >
            <div
              style={{
                display: "flex",
                alignItems: "flex-start",
                justifyContent: "space-between",
                gap: 8,
              }}
            >
              <div style={{ fontSize: 13, fontWeight: 700, color: "#1e293b" }}>{doc.label}</div>
              {doc.is_auto_linked && (
                <span
                  style={{
                    fontSize: 10,
                    fontWeight: 700,
                    padding: "2px 6px",
                    borderRadius: 4,
                    background: "#e0f2fe",
                    color: "#0369a1",
                    whiteSpace: "nowrap",
                  }}
                >
                  Auto-linked
                </span>
              )}
            </div>

            <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
              {hasFile && doc.file_url && (
                <a
                  href={resolveFileHref(doc.file_url)}
                  target="_blank"
                  rel="noreferrer"
                  title={`Open ${doc.label}`}
                  style={{
                    display: "inline-flex",
                    alignItems: "center",
                    justifyContent: "center",
                    width: 36,
                    height: 32,
                    borderRadius: 6,
                    border: "1px solid #3b82f6",
                    background: "#ffffff",
                    color: "#2563eb",
                    textDecoration: "none",
                    fontSize: 14,
                    fontWeight: 700,
                  }}
                >
                  ☁⬇
                </a>
              )}

              {canUpload ? (
                <label
                  style={{
                    flex: 1,
                    display: "inline-flex",
                    alignItems: "center",
                    border: "1px solid #cbd5e1",
                    borderRadius: 6,
                    overflow: "hidden",
                    background: "#ffffff",
                    cursor: isUploading ? "wait" : "pointer",
                    fontSize: 12,
                    minWidth: 160,
                  }}
                >
                  <span
                    style={{
                      padding: "6px 10px",
                      background: "#f1f5f9",
                      borderRight: "1px solid #cbd5e1",
                      color: "#334155",
                      fontWeight: 600,
                      whiteSpace: "nowrap",
                    }}
                  >
                    {isUploading ? "Uploading..." : "Choose File"}
                  </span>
                  <span
                    style={{
                      padding: "6px 10px",
                      color: hasFile ? "#0f172a" : "#94a3b8",
                      overflow: "hidden",
                      textOverflow: "ellipsis",
                      whiteSpace: "nowrap",
                      maxWidth: 140,
                    }}
                    title={doc.filename || "No file uploaded."}
                  >
                    {doc.filename || "No file uploaded."}
                  </span>
                  <input
                    type="file"
                    accept=".pdf,.png,.jpg,.jpeg,.webp,.doc,.docx,.xls,.xlsx,.csv"
                    disabled={isUploading}
                    style={{ display: "none" }}
                    onChange={(e) => {
                      const f = e.target.files?.[0] ?? null;
                      onUpload(consignmentKey, doc.slot_key, f);
                      e.target.value = "";
                    }}
                  />
                </label>
              ) : (
                <span
                  style={{
                    flex: 1,
                    padding: "6px 10px",
                    border: "1px solid #e2e8f0",
                    borderRadius: 6,
                    background: "#f8fafc",
                    color: hasFile ? "#0f172a" : "#94a3b8",
                    fontSize: 12,
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                    whiteSpace: "nowrap",
                  }}
                  title={doc.filename || "No file uploaded."}
                >
                  {doc.filename || "No file uploaded."}
                </span>
              )}

              {canDelete && hasFile && !doc.is_auto_linked && (
                <button
                  type="button"
                  disabled={isDeleting}
                  onClick={() => onDelete(consignmentKey, doc.slot_key)}
                  title="Delete uploaded file"
                  style={{
                    width: 32,
                    height: 32,
                    borderRadius: 6,
                    border: "1px solid #fecaca",
                    background: "#fff1f2",
                    color: "#dc2626",
                    cursor: "pointer",
                    display: "inline-flex",
                    alignItems: "center",
                    justifyContent: "center",
                    fontSize: 13,
                  }}
                >
                  🗑
                </button>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}

interface ShipmentChecklistGridProps {
  consignmentKey: string;
  checklist: CargoChecklistItem[];
  canEdit: boolean;
  onToggle: (consignmentKey: string, checkKey: string, currentVal: boolean) => void;
}

function ShipmentChecklistGrid({
  consignmentKey,
  checklist,
  canEdit,
  onToggle,
}: ShipmentChecklistGridProps) {
  return (
    <div
      data-testid="cargo-checklist-grid"
      style={{
        display: "grid",
        gridTemplateColumns: "repeat(auto-fill, minmax(290px, 1fr))",
        gap: 12,
      }}
    >
      {checklist.map((item) => (
        <button
          key={item.key}
          type="button"
          data-testid={`cargo-check-${item.key}`}
          disabled={!canEdit}
          onClick={() => {
            if (canEdit) {
              onToggle(consignmentKey, item.key, item.value);
            }
          }}
          style={{
            border: item.value ? "1px solid #bbf7d0" : "1px solid #e2e8f0",
            borderRadius: 10,
            padding: "14px 16px",
            background: item.value ? "#f0fdf4" : "#ffffff",
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            gap: 12,
            cursor: canEdit ? "pointer" : "default",
            textAlign: "left",
            width: "100%",
            transition: "all 0.12s ease",
          }}
        >
          <span style={{ fontSize: 13, fontWeight: 600, color: "#1e293b" }}>{item.label}</span>
          <span
            style={{
              padding: "3px 10px",
              borderRadius: 6,
              fontSize: 12,
              fontWeight: 800,
              background: item.value ? "#16a34a" : "#fee2e2",
              color: item.value ? "#ffffff" : "#dc2626",
              minWidth: 38,
              textAlign: "center",
            }}
          >
            {item.value ? "Yes" : "No"}
          </span>
        </button>
      ))}
    </div>
  );
}

export function CargoOverviewPage({ initialData }: CargoOverviewPageProps = {}) {
  const navigate = useNavigate();
  const toast = useToast();
  const toastRef = useRef(toast);
  toastRef.current = toast;
  const { key: routeParamKey } = useParams<{ key?: string }>();
  const [searchParams, setSearchParams] = useSearchParams();
  const selectedKey = routeParamKey ? decodeURIComponent(routeParamKey) : searchParams.get("key");
  const isPropControlled = initialData !== undefined;

  const perms = useCargoPermissions();

  const [data, setData] = useState<CargoOverviewListResponse>(
    () =>
      initialData ?? {
        total_consignments: 0,
        pending_consignments: 0,
        cleared_consignments: 0,
        warehouses: [],
        items: [],
      },
  );
  const [loading, setLoading] = useState<boolean>(false);
  const [warehouseTab, setWarehouseTab] = useState<string>("ALL");
  const [stageTab, setStageTab] = useState<CargoStage>("all");
  const [showFilters, setShowFilters] = useState<boolean>(false);
  const [orderedDateRange, setOrderedDateRange] = useState<string>("");
  const [etdDateRange, setEtdDateRange] = useState<string>("");
  const [etaDateRange, setEtaDateRange] = useState<string>("");
  const [warehouseFilter, setWarehouseFilter] = useState<string>("ALL");
  const [stageFilter, setStageFilter] = useState<CargoStage>("all");
  const [forwarderFilter, setForwarderFilter] = useState<string>("");
  const [agentFilter, setAgentFilter] = useState<string>("");
  const [appliedFilters, setAppliedFilters] = useState<{
    orderedDateRange: string;
    etdDateRange: string;
    etaDateRange: string;
    forwarder: string;
    agent: string;
  }>({
    orderedDateRange: "",
    etdDateRange: "",
    etaDateRange: "",
    forwarder: "",
    agent: "",
  });
  const [searchQuery, setSearchQuery] = useState<string>("");
  const [pageSize, setPageSize] = useState<number>(50);
  const [currentPage, setCurrentPage] = useState<number>(1);

  // Detail & modal draft state
  const [uploadingSlot, setUploadingSlot] = useState<string | null>(null);
  const [deletingSlot, setDeletingSlot] = useState<string | null>(null);
  const [remarksDraft, setRemarksDraft] = useState<string>("");
  const [etdDraft, setEtdDraft] = useState<string>("");
  const [etaDraft, setEtaDraft] = useState<string>("");
  const [arrivalDraft, setArrivalDraft] = useState<string>("");
  const [forwarderDraft, setForwarderDraft] = useState<string>("");
  const [agentDraft, setAgentDraft] = useState<string>("");
  const [savingCargoMeta, setSavingCargoMeta] = useState<boolean>(false);

  // List Action Menu (document.body portal) + Quick Modals
  const [menuState, setMenuState] = useState<{
    key: string;
    top: number;
    left: number;
  } | null>(null);
  const [quickGalleryKey, setQuickGalleryKey] = useState<string | null>(null);
  const [quickChecklistKey, setQuickChecklistKey] = useState<string | null>(null);

  const mutationSeqRef = useRef<number>(0);

  useEffect(() => {
    if (initialData !== undefined) {
      setData(initialData);
    }
  }, [initialData]);

  const loadOverviews = useCallback(
    async (signal?: AbortSignal) => {
      if (isPropControlled) return;
      const reqSeq = mutationSeqRef.current;
      setLoading(true);
      try {
        const res = await apiGet<CargoOverviewListResponse>("/cargo-overview?stage=all", {
          signal,
        });
        if (signal?.aborted || reqSeq !== mutationSeqRef.current) return;
        if (res?.data) {
          setData(res.data);
        }
      } catch (err) {
        if (isAbortError(err) || signal?.aborted) return;
        if (Auth.getAccessToken()) {
          toastRef.current(errorMessage(err), "error");
        }
      } finally {
        if (!signal?.aborted) {
          setLoading(false);
        }
      }
    },
    [isPropControlled],
  );

  useEffect(() => {
    if (isPropControlled) return;
    const controller = new AbortController();
    void loadOverviews(controller.signal);
    return () => controller.abort();
  }, [isPropControlled, loadOverviews]);

  // Close action dropdown on outside click / scroll
  useEffect(() => {
    if (!menuState) return;
    const close = () => setMenuState(null);
    window.addEventListener("mousedown", close);
    window.addEventListener("scroll", close, true);
    return () => {
      window.removeEventListener("mousedown", close);
      window.removeEventListener("scroll", close, true);
    };
  }, [menuState]);

  const allItems = useMemo(() => data.items ?? [], [data]);

  const warehouseTabs = useMemo(() => {
    const seen = new Set<string>();
    const list: string[] = [];
    for (const wh of data.warehouses ?? []) {
      const clean = wh.trim();
      if (clean && !seen.has(clean.toLowerCase())) {
        seen.add(clean.toLowerCase());
        list.push(clean);
      }
    }
    for (const item of allItems) {
      const clean = (item.warehouse || "").trim();
      if (clean && !seen.has(clean.toLowerCase())) {
        seen.add(clean.toLowerCase());
        list.push(clean);
      }
    }
    return list;
  }, [data.warehouses, allItems]);

  const findByKey = useCallback(
    (key: string | null): CargoOverviewRow | null => {
      if (!key) return null;
      const norm = key.trim().toUpperCase();
      return allItems.find((x) => x.consignment_key.trim().toUpperCase() === norm) ?? null;
    },
    [allItems],
  );

  const activeConsignment = useMemo(() => findByKey(selectedKey), [findByKey, selectedKey]);
  const quickGalleryRow = useMemo(() => findByKey(quickGalleryKey), [findByKey, quickGalleryKey]);
  const quickChecklistRow = useMemo(
    () => findByKey(quickChecklistKey),
    [findByKey, quickChecklistKey],
  );

  useEffect(() => {
    if (activeConsignment) {
      setRemarksDraft(activeConsignment.cargo_remarks ?? "");
      setEtdDraft(activeConsignment.etd_origin_date?.slice(0, 10) ?? "");
      setEtaDraft(activeConsignment.eta_port_date?.slice(0, 10) ?? "");
      setArrivalDraft(activeConsignment.expected_arrival_date?.slice(0, 10) ?? "");
      setForwarderDraft(activeConsignment.forwarder_name ?? "");
      setAgentDraft(activeConsignment.clearing_agent_name ?? "");
    }
  }, [activeConsignment?.consignment_key]);

  const handleApplyFilters = () => {
    setWarehouseTab(warehouseFilter);
    setStageTab(stageFilter);
    setAppliedFilters({
      orderedDateRange,
      etdDateRange,
      etaDateRange,
      forwarder: forwarderFilter,
      agent: agentFilter,
    });
    setCurrentPage(1);
  };

  const handleResetFilters = () => {
    setOrderedDateRange("");
    setEtdDateRange("");
    setEtaDateRange("");
    setWarehouseFilter("ALL");
    setStageFilter("all");
    setForwarderFilter("");
    setAgentFilter("");
    setWarehouseTab("ALL");
    setStageTab("all");
    setAppliedFilters({
      orderedDateRange: "",
      etdDateRange: "",
      etaDateRange: "",
      forwarder: "",
      agent: "",
    });
    setSearchQuery("");
    setCurrentPage(1);
  };

  const filteredItems = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    const fwdQ = appliedFilters.forwarder.trim().toLowerCase();
    const agtQ = appliedFilters.agent.trim().toLowerCase();
    return allItems.filter((item) => {
      if (stageTab !== "all" && item.overall_stage !== stageTab) return false;
      if (
        warehouseTab !== "ALL" &&
        (item.warehouse || "").trim().toLowerCase() !== warehouseTab.toLowerCase()
      ) {
        return false;
      }
      if (!matchesDateRange(item.ordered_date, appliedFilters.orderedDateRange)) return false;
      if (!matchesDateRange(item.etd_origin_date, appliedFilters.etdDateRange)) return false;
      if (!matchesDateRange(item.eta_port_date, appliedFilters.etaDateRange)) return false;
      if (fwdQ && !(item.forwarder_name || "").toLowerCase().includes(fwdQ)) return false;
      if (agtQ && !(item.clearing_agent_name || "").toLowerCase().includes(agtQ)) return false;
      if (!q) return true;
      return (
        item.consignment_key.toLowerCase().includes(q) ||
        item.display_title.toLowerCase().includes(q) ||
        item.invoice_or_order_summary.toLowerCase().includes(q) ||
        (item.batch_no || "").toLowerCase().includes(q) ||
        item.supplier_summary.toLowerCase().includes(q) ||
        (item.warehouse || "").toLowerCase().includes(q) ||
        (item.forwarder_name || "").toLowerCase().includes(q) ||
        (item.clearing_agent_name || "").toLowerCase().includes(q) ||
        (item.cargo_remarks || "").toLowerCase().includes(q)
      );
    });
  }, [allItems, stageTab, warehouseTab, appliedFilters, searchQuery]);

  const totalPages = Math.max(1, Math.ceil(filteredItems.length / pageSize));
  const safePage = Math.min(currentPage, totalPages);
  const pagedItems = useMemo(() => {
    const start = (safePage - 1) * pageSize;
    return filteredItems.slice(start, start + pageSize);
  }, [filteredItems, safePage, pageSize]);

  const paginationMeta: PaginationMeta = useMemo(
    () => ({
      total_records: filteredItems.length,
      current_page: safePage,
      page_size: pageSize,
      total_pages: totalPages,
    }),
    [filteredItems.length, safePage, pageSize, totalPages],
  );

  // ---------------------------------------------------------------------------
  // Mutations (Optimistic Updates + Backend Persistence)
  // ---------------------------------------------------------------------------

  const handleToggleChecklistItem = async (
    consignmentKey: string,
    checkKey: string,
    currentVal: boolean,
  ) => {
    const nextVal = !currentVal;
    mutationSeqRef.current += 1;

    setData((prev) => ({
      ...prev,
      items: prev.items.map((item) => {
        if (item.consignment_key !== consignmentKey) return item;
        const nextChecklist = item.checklist.map((c) =>
          c.key === checkKey ? { ...c, value: nextVal } : c,
        );
        return {
          ...item,
          checklist: nextChecklist,
          checklist_yes_count: nextChecklist.filter((c) => c.value).length,
        };
      }),
    }));

    if (isPropControlled) return;
    try {
      await apiPatch(`/cargo-overview/checklist?key=${encodeURIComponent(consignmentKey)}`, {
        checklist: { [checkKey]: nextVal },
      });
    } catch (err) {
      toastRef.current(errorMessage(err), "error");
      void loadOverviews();
    }
  };

  const handleSaveInlineRemark = async (consignmentKey: string, nextRemarksRaw: string) => {
    const nextRemarks = nextRemarksRaw.trim() || null;
    const target = findByKey(consignmentKey);
    if (target && (target.cargo_remarks?.trim() || null) === nextRemarks) return;

    mutationSeqRef.current += 1;
    setData((prev) => ({
      ...prev,
      items: prev.items.map((item) =>
        item.consignment_key === consignmentKey ? { ...item, cargo_remarks: nextRemarks } : item,
      ),
    }));

    if (isPropControlled) return;
    try {
      await apiPatch(`/cargo-overview/checklist?key=${encodeURIComponent(consignmentKey)}`, {
        cargo_remarks: nextRemarks,
      });
      toastRef.current("Cargo remark saved.", "success");
    } catch (err) {
      toastRef.current(errorMessage(err), "error");
      void loadOverviews();
    }
  };

  const handleSaveCargoMeta = async () => {
    if (!activeConsignment) return;
    const nextRemarks = remarksDraft.trim() || null;
    const nextEtd = etdDraft || null;
    const nextEta = etaDraft || null;
    const nextArrival = arrivalDraft || null;
    const nextForwarder = forwarderDraft.trim() || null;
    const nextAgent = agentDraft.trim() || null;

    const prevRemarks = activeConsignment.cargo_remarks?.trim() || null;
    const prevEtd = activeConsignment.etd_origin_date?.slice(0, 10) || null;
    const prevEta = activeConsignment.eta_port_date?.slice(0, 10) || null;
    const prevArrival = activeConsignment.expected_arrival_date?.slice(0, 10) || null;
    const prevForwarder = activeConsignment.forwarder_name?.trim() || null;
    const prevAgent = activeConsignment.clearing_agent_name?.trim() || null;

    if (
      nextRemarks === prevRemarks &&
      nextEtd === prevEtd &&
      nextEta === prevEta &&
      nextArrival === prevArrival &&
      nextForwarder === prevForwarder &&
      nextAgent === prevAgent
    ) {
      return;
    }

    const consignmentKey = activeConsignment.consignment_key;
    mutationSeqRef.current += 1;
    setSavingCargoMeta(true);

    setData((prev) => ({
      ...prev,
      items: prev.items.map((item) =>
        item.consignment_key === consignmentKey
          ? {
              ...item,
              cargo_remarks: nextRemarks,
              etd_origin_date: nextEtd,
              eta_port_date: nextEta,
              expected_arrival_date: nextArrival,
              forwarder_name: nextForwarder,
              clearing_agent_name: nextAgent,
            }
          : item,
      ),
    }));

    if (isPropControlled) {
      setSavingCargoMeta(false);
      return;
    }

    try {
      await apiPatch(`/cargo-overview/checklist?key=${encodeURIComponent(consignmentKey)}`, {
        cargo_remarks: nextRemarks,
        etd_origin_date: nextEtd,
        eta_port_date: nextEta,
        expected_arrival_date: nextArrival,
        forwarder_name: nextForwarder,
        clearing_agent_name: nextAgent,
      });
      toastRef.current("Cargo status & shipment schedule saved.", "success");
    } catch (err) {
      toastRef.current(errorMessage(err), "error");
      void loadOverviews();
    } finally {
      setSavingCargoMeta(false);
    }
  };

  const handleUploadDocument = async (
    consignmentKey: string,
    slotKey: string,
    file: File | null,
  ) => {
    if (!file) return;
    mutationSeqRef.current += 1;
    setUploadingSlot(slotKey);
    try {
      const formData = new FormData();
      formData.append("file", file);
      const res = await apiPostMultipart<CargoDocumentSlot>(
        `/cargo-overview/documents?key=${encodeURIComponent(
          consignmentKey,
        )}&slot_key=${encodeURIComponent(slotKey)}`,
        formData,
      );
      const uploadedSlot = res?.data;
      if (uploadedSlot) {
        setData((prev) => ({
          ...prev,
          items: prev.items.map((item) => {
            if (item.consignment_key !== consignmentKey) return item;
            const nextDocs = item.documents.map((d) =>
              d.slot_key === slotKey ? uploadedSlot : d,
            );
            return {
              ...item,
              documents: nextDocs,
              docs_uploaded_count: nextDocs.filter((d) => Boolean(d.file_url)).length,
              pi_file_url:
                slotKey === "proforma_invoice" ? uploadedSlot.file_url : item.pi_file_url,
            };
          }),
        }));
        toastRef.current(`${uploadedSlot.label} uploaded.`, "success");
      }
    } catch (err) {
      toastRef.current(errorMessage(err), "error");
    } finally {
      setUploadingSlot(null);
    }
  };

  const handleDeleteDocument = async (consignmentKey: string, slotKey: string) => {
    mutationSeqRef.current += 1;
    setDeletingSlot(slotKey);

    setData((prev) => ({
      ...prev,
      items: prev.items.map((item) => {
        if (item.consignment_key !== consignmentKey) return item;
        const nextDocs = item.documents.map((d) =>
          d.slot_key === slotKey
            ? {
                ...d,
                file_url: null,
                filename: null,
                uploaded_at: null,
                uploaded_by: null,
                is_auto_linked: false,
              }
            : d,
        );
        return {
          ...item,
          documents: nextDocs,
          docs_uploaded_count: nextDocs.filter((d) => Boolean(d.file_url)).length,
          pi_file_url: slotKey === "proforma_invoice" ? null : item.pi_file_url,
        };
      }),
    }));

    if (isPropControlled) {
      setDeletingSlot(null);
      return;
    }

    try {
      await apiDelete(
        `/cargo-overview/documents?key=${encodeURIComponent(
          consignmentKey,
        )}&slot_key=${encodeURIComponent(slotKey)}`,
      );
      toastRef.current("Document removed from slot.", "success");
    } catch (err) {
      toastRef.current(errorMessage(err), "error");
      void loadOverviews();
    } finally {
      setDeletingSlot(null);
    }
  };

  const handleExportCsv = useCallback(() => {
    const headers = [
      "Consignment Key",
      "Invoice / Cons. No.",
      "Supplier Name",
      "Batch No.",
      "Warehouse",
      "Ordered Date",
      "ETD Origin",
      "ETA Port",
      "Expected Arrival",
      "Forwarder Name",
      "Clearing Agent",
      "Gallery Docs",
      "Cargo Checklist",
      "Finance Status",
      "Cargo Remark",
    ];

    const escapeCsv = (val: string | number) => {
      const str = String(val ?? "");
      return `"${str.replace(/"/g, '""')}"`;
    };

    const rows = filteredItems.map((row) =>
      [
        escapeCsv(row.consignment_key),
        escapeCsv(row.invoice_or_order_summary || row.display_title),
        escapeCsv(row.supplier_summary || "-"),
        escapeCsv(row.batch_no || "-"),
        escapeCsv(row.warehouse || "-"),
        escapeCsv(formatDisplayDate(row.ordered_date)),
        escapeCsv(formatDisplayDate(row.etd_origin_date)),
        escapeCsv(formatDisplayDate(row.eta_port_date)),
        escapeCsv(formatDisplayDate(row.expected_arrival_date)),
        escapeCsv(row.forwarder_name || "-"),
        escapeCsv(row.clearing_agent_name || "-"),
        escapeCsv(`${row.docs_uploaded_count}/${row.docs_total_count}`),
        escapeCsv(`${row.checklist_yes_count}/${row.checklist_total_count}`),
        escapeCsv(row.overall_stage === "cleared" ? "Cleared" : "Pending"),
        escapeCsv(row.cargo_remarks || ""),
      ].join(","),
    );

    const csvContent = "\uFEFF" + [headers.join(","), ...rows].join("\n");
    const blob = new Blob([csvContent], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `Cargo_Overview_${new Date().toISOString().slice(0, 10)}.csv`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  }, [filteredItems]);

  const openDetailView = (key: string) => {
    setMenuState(null);
    setSearchParams({ key });
  };

  const closeDetailView = () => {
    if (routeParamKey) {
      navigate("/reports/cargo-overview");
    } else {
      setSearchParams({});
    }
  };

  // ===========================================================================
  // DETAIL VIEW RENDER
  // ===========================================================================
  if (selectedKey && activeConsignment) {
    return (
      <AppShell activeKey="reports-cargo-overview">
        <main className="page" style={{ padding: "20px 24px 36px" }}>
          <Breadcrumb
            trail={["Reports", "Cargo Overview", `Overview — ${activeConsignment.display_title}`]}
          />

          {/* Top Bar */}
          <div
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              flexWrap: "wrap",
              gap: 12,
              marginBottom: 16,
            }}
          >
            <div>
              <h1 style={{ fontSize: 22, fontWeight: 800, color: "#0f172a", margin: 0 }}>
                Overview — {activeConsignment.display_title}
              </h1>
              <p style={{ margin: "3px 0 0", fontSize: 13, color: "#64748b" }}>
                Unified Finance Planning, Consignment Document Gallery &amp; Cargo Status Checklist
              </p>
            </div>

            <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
              <button
                type="button"
                onClick={() => navigate("/reports/financial-planning")}
                style={{
                  padding: "8px 14px",
                  borderRadius: 8,
                  border: "1px solid #cbd5e1",
                  background: "#ffffff",
                  color: "#1e293b",
                  fontSize: 13,
                  fontWeight: 600,
                  cursor: "pointer",
                }}
              >
                Open Financial Planning Report
              </button>
              <button
                type="button"
                data-testid="cargo-detail-back-btn"
                onClick={closeDetailView}
                style={{
                  padding: "8px 16px",
                  borderRadius: 8,
                  border: "1px solid #cbd5e1",
                  background: "#ffffff",
                  color: "#0f172a",
                  fontSize: 13,
                  fontWeight: 700,
                  cursor: "pointer",
                  display: "inline-flex",
                  alignItems: "center",
                  gap: 6,
                }}
              >
                ← Back
              </button>
            </div>
          </div>

          <ConsignmentHeaderStrip
            consignment={activeConsignment}
            editable={perms.canEditCargoStatus}
            etdDraft={etdDraft}
            etaDraft={etaDraft}
            arrivalDraft={arrivalDraft}
            forwarderDraft={forwarderDraft}
            agentDraft={agentDraft}
            onEtdChange={setEtdDraft}
            onEtaChange={setEtaDraft}
            onArrivalChange={setArrivalDraft}
            onForwarderChange={setForwarderDraft}
            onAgentChange={setAgentDraft}
            onCommit={() => void handleSaveCargoMeta()}
          />

          {/* SECTION 1: FINANCE PLANNING */}
          {perms.canViewFinance && (
            <section
              data-testid="cargo-section-finance"
              style={{
                background: "#ffffff",
                borderRadius: 12,
                border: "1px solid #e2e8f0",
                padding: "18px 20px",
                marginBottom: 20,
                boxShadow: "0 1px 3px rgba(15, 23, 42, 0.04)",
              }}
            >
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "space-between",
                  marginBottom: 14,
                }}
              >
                <h2 style={{ fontSize: 18, fontWeight: 800, color: "#0f172a", margin: 0 }}>
                  Finance Planning
                </h2>
                <span style={{ fontSize: 12, color: "#64748b" }}>
                  {activeConsignment.finance_rows.length} Linked Financial Record(s)
                </span>
              </div>

              <div style={{ overflowX: "auto" }}>
                <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
                  <thead>
                    <tr
                      style={{
                        background: "#f8fafc",
                        borderBottom: "1px solid #e2e8f0",
                        color: "#334155",
                        textAlign: "left",
                      }}
                    >
                      <th style={{ padding: "10px 12px", fontWeight: 700 }}>Party Name</th>
                      <th style={{ padding: "10px 12px", fontWeight: 700 }}>Invoice / Cons. No.</th>
                      <th style={{ padding: "10px 12px", fontWeight: 700 }}>Payment Terms</th>
                      <th style={{ padding: "10px 12px", fontWeight: 700 }}>Total Amount</th>
                      <th style={{ padding: "10px 12px", fontWeight: 700 }}>Paid Amount</th>
                      <th style={{ padding: "10px 12px", fontWeight: 700 }}>Balance Amount</th>
                      <th style={{ padding: "10px 12px", fontWeight: 700 }}>Due Date</th>
                      <th style={{ padding: "10px 12px", fontWeight: 700 }}>Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {activeConsignment.finance_rows.length === 0 ? (
                      <tr>
                        <td
                          colSpan={8}
                          style={{ padding: "20px", textAlign: "center", color: "#64748b" }}
                        >
                          No linked financial planning records found for this consignment.
                        </td>
                      </tr>
                    ) : (
                      activeConsignment.finance_rows.map((fin, idx) => (
                        <tr
                          key={fin.id}
                          style={{
                            background: idx % 2 === 0 ? "#f8fafc" : "#ffffff",
                            borderBottom: "1px solid #f1f5f9",
                          }}
                        >
                          <td style={{ padding: "12px" }}>
                            <div style={{ fontWeight: 700, color: "#0f172a", marginBottom: 4 }}>
                              {fin.party_name}
                            </div>
                            <span
                              style={{
                                display: "inline-block",
                                padding: "2px 8px",
                                borderRadius: 6,
                                fontSize: 11,
                                fontWeight: 700,
                                ...roleBadgeStyle(fin.role),
                              }}
                            >
                              {fin.role}
                            </span>
                          </td>
                          <td style={{ padding: "12px", color: "#334155", fontWeight: 600 }}>
                            {fin.doc_no}
                          </td>
                          <td style={{ padding: "12px", color: "#334155" }}>
                            <div>{fin.payment_terms || "—"}</div>
                            {fin.attachment_url && (
                              <a
                                href={resolveFileHref(fin.attachment_url)}
                                target="_blank"
                                rel="noreferrer"
                                style={{
                                  display: "inline-flex",
                                  alignItems: "center",
                                  gap: 4,
                                  marginTop: 4,
                                  color: "#2563eb",
                                  fontSize: 12,
                                  fontWeight: 700,
                                  textDecoration: "none",
                                }}
                              >
                                ⬇ {fin.attachment_name || "View Bill"}
                              </a>
                            )}
                          </td>
                          <td style={{ padding: "12px", fontWeight: 700, color: "#0f172a" }}>
                            {formatCargoAmount(fin.total_amount, fin.currency)}
                          </td>
                          <td style={{ padding: "12px", fontWeight: 700, color: "#15803d" }}>
                            {formatCargoAmount(fin.paid_amount, fin.currency)}
                          </td>
                          <td
                            style={{
                              padding: "12px",
                              fontWeight: 700,
                              color: fin.balance_amount > 0 ? "#b91c1c" : "#475569",
                            }}
                          >
                            {formatCargoAmount(fin.balance_amount, fin.currency)}
                          </td>
                          <td style={{ padding: "12px", color: "#334155" }}>
                            {formatDisplayDate(fin.due_date)}
                          </td>
                          <td style={{ padding: "12px" }}>
                            <span
                              style={{
                                display: "inline-block",
                                padding: "3px 10px",
                                borderRadius: 6,
                                fontSize: 11.5,
                                fontWeight: 700,
                                background: fin.stage === "cleared" ? "#dbeafe" : "#fef3c7",
                                color: fin.stage === "cleared" ? "#1d4ed8" : "#b45309",
                              }}
                            >
                              {fin.stage === "cleared" ? "Cleared" : "Pending"}
                            </span>
                          </td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
            </section>
          )}

          {/* SECTION 2: CONSIGNMENT GALLERY */}
          {perms.canViewGallery && (
            <section
              data-testid="cargo-section-gallery"
              style={{
                background: "#ffffff",
                borderRadius: 12,
                border: "1px solid #e2e8f0",
                padding: "18px 20px",
                marginBottom: 20,
                boxShadow: "0 1px 3px rgba(15, 23, 42, 0.04)",
              }}
            >
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "space-between",
                  marginBottom: 14,
                }}
              >
                <div>
                  <h2 style={{ fontSize: 18, fontWeight: 800, color: "#0f172a", margin: 0 }}>
                    Consignment Gallery
                  </h2>
                  <p style={{ margin: "2px 0 0", fontSize: 12, color: "#64748b" }}>
                    Upload or download import &amp; logistics trade documents.
                  </p>
                </div>
                <span
                  style={{
                    padding: "4px 10px",
                    borderRadius: 999,
                    fontSize: 12,
                    fontWeight: 700,
                    background: "#eff6ff",
                    color: "#1d4ed8",
                    border: "1px solid #bfdbfe",
                  }}
                >
                  {activeConsignment.docs_uploaded_count} / {activeConsignment.docs_total_count} Uploaded
                </span>
              </div>

              <DocumentGalleryGrid
                consignmentKey={activeConsignment.consignment_key}
                documents={activeConsignment.documents}
                canUpload={perms.canUploadGallery}
                canDelete={perms.canDeleteGallery}
                uploadingSlot={uploadingSlot}
                deletingSlot={deletingSlot}
                onUpload={(k, s, f) => void handleUploadDocument(k, s, f)}
                onDelete={(k, s) => void handleDeleteDocument(k, s)}
              />
            </section>
          )}

          {/* SECTION 3: CARGO STATUS — SHIPMENT CHECKLIST DETAILS */}
          {perms.canViewCargoStatus && (
            <section
              data-testid="cargo-section-status"
              style={{
                background: "#ffffff",
                borderRadius: 12,
                border: "1px solid #e2e8f0",
                padding: "18px 20px",
                marginBottom: 20,
                boxShadow: "0 1px 3px rgba(15, 23, 42, 0.04)",
              }}
            >
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "space-between",
                  marginBottom: 14,
                }}
              >
                <div>
                  <h2 style={{ fontSize: 18, fontWeight: 800, color: "#0f172a", margin: 0 }}>
                    Cargo Status — Shipment Checklist Details
                  </h2>
                  <p style={{ margin: "2px 0 0", fontSize: 12, color: "#64748b" }}>
                    {perms.canEditCargoStatus
                      ? "Click any checklist card to toggle between Yes (Completed) and No (Pending)."
                      : "Read-only view of shipment checklist milestones."}
                  </p>
                </div>
                <span
                  style={{
                    padding: "4px 10px",
                    borderRadius: 999,
                    fontSize: 12,
                    fontWeight: 700,
                    background:
                      activeConsignment.checklist_yes_count ===
                      activeConsignment.checklist_total_count
                        ? "#dcfce7"
                        : "#fef3c7",
                    color:
                      activeConsignment.checklist_yes_count ===
                      activeConsignment.checklist_total_count
                        ? "#15803d"
                        : "#b45309",
                  }}
                >
                  {activeConsignment.checklist_yes_count} / {activeConsignment.checklist_total_count}{" "}
                  Completed
                </span>
              </div>

              <div style={{ marginBottom: 16 }}>
                <ShipmentChecklistGrid
                  consignmentKey={activeConsignment.consignment_key}
                  checklist={activeConsignment.checklist}
                  canEdit={perms.canEditCargoStatus}
                  onToggle={(k, c, v) => void handleToggleChecklistItem(k, c, v)}
                />
              </div>

              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 10,
                  flexWrap: "wrap",
                  paddingTop: 12,
                  borderTop: "1px solid #f1f5f9",
                }}
              >
                <label
                  htmlFor="cargo-detail-remark-input"
                  style={{ fontSize: 12.5, fontWeight: 700, color: "#334155", minWidth: 110 }}
                >
                  Cargo Remark:
                </label>
                <input
                  id="cargo-detail-remark-input"
                  type="text"
                  placeholder="Add shipment / customs / container / BL remark..."
                  value={remarksDraft}
                  disabled={!perms.canEditCargoStatus}
                  onChange={(e) => setRemarksDraft(e.target.value)}
                  onBlur={() => {
                    if (perms.canEditCargoStatus) void handleSaveCargoMeta();
                  }}
                  style={{
                    flex: 1,
                    minWidth: 240,
                    padding: "8px 12px",
                    borderRadius: 8,
                    border: "1px solid #cbd5e1",
                    background: perms.canEditCargoStatus ? "#ffffff" : "#f8fafc",
                    fontSize: 13,
                  }}
                />
                {perms.canEditCargoStatus && (
                  <button
                    type="button"
                    disabled={savingCargoMeta}
                    onClick={() => void handleSaveCargoMeta()}
                    style={{
                      padding: "8px 16px",
                      borderRadius: 8,
                      border: "none",
                      background: "#2563eb",
                      color: "#ffffff",
                      fontSize: 12.5,
                      fontWeight: 700,
                      cursor: "pointer",
                    }}
                  >
                    {savingCargoMeta ? "Saving..." : "Save Cargo Info"}
                  </button>
                )}
              </div>
            </section>
          )}

          {/* SECTION 4: PRODUCT SUMMARY */}
          {perms.canViewProductSummary && (
            <section
              data-testid="cargo-section-products"
              style={{
                background: "#ffffff",
                borderRadius: 12,
                border: "1px solid #e2e8f0",
                padding: "18px 20px",
                boxShadow: "0 1px 3px rgba(15, 23, 42, 0.04)",
              }}
            >
              <h2 style={{ fontSize: 18, fontWeight: 800, color: "#0f172a", margin: "0 0 14px" }}>
                Product Summary
              </h2>

              <div style={{ overflowX: "auto" }}>
                <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
                  <thead>
                    <tr
                      style={{
                        background: "#f8fafc",
                        borderBottom: "1px solid #e2e8f0",
                        color: "#334155",
                        textAlign: "left",
                      }}
                    >
                      <th style={{ padding: "10px 12px", fontWeight: 700, width: 80 }}>Sr No.</th>
                      <th style={{ padding: "10px 12px", fontWeight: 700 }}>Product Name</th>
                      <th style={{ padding: "10px 12px", fontWeight: 700 }}>Supplier / Document</th>
                      <th style={{ padding: "10px 12px", fontWeight: 700 }}>Quantity</th>
                      <th style={{ padding: "10px 12px", fontWeight: 700 }}>Batch No.</th>
                    </tr>
                  </thead>
                  <tbody>
                    {activeConsignment.products.length === 0 ? (
                      <tr>
                        <td
                          colSpan={5}
                          style={{ padding: "20px", textAlign: "center", color: "#64748b" }}
                        >
                          No product line items found for this consignment.
                        </td>
                      </tr>
                    ) : (
                      activeConsignment.products.map((prod, idx) => (
                        <tr
                          key={`${prod.sr_no}-${prod.product_name}`}
                          style={{
                            background: idx % 2 === 0 ? "#f8fafc" : "#ffffff",
                            borderBottom: "1px solid #e2e8f0",
                          }}
                        >
                          <td style={{ padding: "12px", fontWeight: 600, color: "#334155" }}>
                            {prod.sr_no}
                          </td>
                          <td style={{ padding: "12px", fontWeight: 700, color: "#0f172a" }}>
                            {prod.product_name}
                            {prod.product_code && (
                              <div style={{ fontSize: 11, color: "#64748b", fontWeight: 500 }}>
                                Code: {prod.product_code}
                              </div>
                            )}
                          </td>
                          <td style={{ padding: "12px", color: "#475569" }}>
                            <div>{prod.supplier_name || "—"}</div>
                            {prod.source_doc_no && (
                              <div style={{ fontSize: 11, color: "#64748b" }}>
                                {prod.source_doc_no}
                              </div>
                            )}
                          </td>
                          <td style={{ padding: "12px" }}>
                            <div style={{ fontWeight: 700, color: "#0f172a" }}>
                              {prod.quantity.toLocaleString("en-IN")}
                            </div>
                            <div style={{ fontSize: 11, color: "#64748b" }}>{prod.uom}</div>
                          </td>
                          <td style={{ padding: "12px", fontWeight: 600, color: "#334155" }}>
                            {prod.batch_no || activeConsignment.batch_no || "—"}
                          </td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
            </section>
          )}

          {!perms.canViewFinance &&
            !perms.canViewGallery &&
            !perms.canViewCargoStatus &&
            !perms.canViewProductSummary && (
              <div
                style={{
                  background: "#ffffff",
                  borderRadius: 12,
                  border: "1px solid #e2e8f0",
                  padding: "32px 24px",
                  textAlign: "center",
                  color: "#64748b",
                  fontSize: 14,
                }}
              >
                None of the 4 Cargo Overview detail sections are enabled for your role. Contact an
                administrator in <strong>Departments &amp; Permissions</strong> to enable section
                access.
              </div>
            )}
        </main>
      </AppShell>
    );
  }

  // ===========================================================================
  // LIST VIEW RENDER
  // ===========================================================================
  return (
    <AppShell activeKey="reports-cargo-overview">
      <main className="page" style={{ padding: "20px 24px 36px" }}>
        <Breadcrumb trail={["Reports", "Cargo Overview"]} />

        {/* Header Bar (Universal Page Header & Action Buttons Standard) */}
        <div
          className="page-header"
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            flexWrap: "wrap",
            gap: 12,
            margin: "0 0 16px",
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <h1 style={{ margin: 0, fontSize: 22, fontWeight: 700, color: "#0f172a" }}>
              Cargo Overview
            </h1>
            {loading && allItems.length > 0 && (
              <span
                style={{
                  fontSize: "12px",
                  fontWeight: 600,
                  color: "#0284c7",
                  background: "#e0f2fe",
                  padding: "2px 8px",
                  borderRadius: "999px",
                }}
              >
                Syncing...
              </span>
            )}
          </div>

          <div className="page-header-actions" style={{ display: "flex", alignItems: "center", gap: "10px" }}>
            <button
              type="button"
              className="btn btn-filter-toggle"
              data-testid="cargo-btn-toggle-filter"
              aria-label="Filter"
              title="Toggle Filter Panel"
              onClick={() => setShowFilters((s) => !s)}
              style={{
                display: "inline-flex",
                alignItems: "center",
                justifyContent: "center",
                height: "35px",
                background: "#556987",
                color: "#ffffff",
                border: "none",
                borderRadius: "6px",
                padding: "8px 14px",
                cursor: "pointer",
                boxShadow: "0 1px 3px rgba(15, 23, 42, 0.12)",
              }}
            >
              <svg
                width="15"
                height="15"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
                aria-hidden="true"
              >
                <polygon points="22 3 2 3 10 12.46 10 19 14 21 14 12.46 22 3" />
              </svg>
            </button>

            <button
              type="button"
              className="btn btn-imp-exp"
              data-testid="cargo-btn-export"
              onClick={handleExportCsv}
              title="Export Cargo Overview to CSV"
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: "6px",
                height: "35px",
              }}
            >
              <svg
                width="14"
                height="14"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2.2"
                strokeLinecap="round"
                strokeLinejoin="round"
                aria-hidden="true"
              >
                <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                <polyline points="7 10 12 15 17 10" />
                <line x1="12" y1="15" x2="12" y2="3" />
              </svg>
              <span>Export</span>
            </button>
          </div>
        </div>

        {/* Collapsible Filter Panel (Universal Filter-Above-Table Placement) */}
        {showFilters && (
          <div
            data-testid="cargo-filter-panel"
            style={{
              background: "#ffffff",
              borderRadius: "8px",
              border: "1px solid #e2e8f0",
              padding: "16px 20px",
              marginBottom: "16px",
              boxShadow: "0 1px 2px rgba(15, 23, 42, 0.03)",
            }}
          >
            <div
              style={{
                display: "grid",
                gridTemplateColumns: "repeat(auto-fit, minmax(190px, 1fr))",
                gap: "16px",
              }}
            >
              <div>
                <label
                  htmlFor="cargo-filter-ordered-range"
                  style={{
                    display: "block",
                    fontSize: "12px",
                    fontWeight: 600,
                    color: "#1e293b",
                    marginBottom: "6px",
                  }}
                >
                  Ordered Date Range
                </label>
                <DateRangePicker
                  id="cargo-filter-ordered-range"
                  value={orderedDateRange}
                  onChange={(val) => setOrderedDateRange(val)}
                  onApply={(val) => setOrderedDateRange(val)}
                  placeholder="Select ordered date range"
                />
              </div>

              <div>
                <label
                  htmlFor="cargo-filter-etd-range"
                  style={{
                    display: "block",
                    fontSize: "12px",
                    fontWeight: 600,
                    color: "#1e293b",
                    marginBottom: "6px",
                  }}
                >
                  ETD Origin Date Range
                </label>
                <DateRangePicker
                  id="cargo-filter-etd-range"
                  value={etdDateRange}
                  onChange={(val) => setEtdDateRange(val)}
                  onApply={(val) => setEtdDateRange(val)}
                  placeholder="Select ETD range"
                />
              </div>

              <div>
                <label
                  htmlFor="cargo-filter-eta-range"
                  style={{
                    display: "block",
                    fontSize: "12px",
                    fontWeight: 600,
                    color: "#1e293b",
                    marginBottom: "6px",
                  }}
                >
                  ETA Port Date Range
                </label>
                <DateRangePicker
                  id="cargo-filter-eta-range"
                  value={etaDateRange}
                  onChange={(val) => setEtaDateRange(val)}
                  onApply={(val) => setEtaDateRange(val)}
                  placeholder="Select ETA range"
                />
              </div>

              <div>
                <label
                  htmlFor="cargo-filter-warehouse"
                  style={{
                    display: "block",
                    fontSize: "12px",
                    fontWeight: 600,
                    color: "#1e293b",
                    marginBottom: "6px",
                  }}
                >
                  Warehouse
                </label>
                <select
                  id="cargo-filter-warehouse"
                  aria-label="Warehouse"
                  value={warehouseFilter}
                  onChange={(e) => setWarehouseFilter(e.target.value)}
                  style={{
                    width: "100%",
                    height: "36px",
                    padding: "0 10px",
                    borderRadius: "4px",
                    border: "1px solid #cbd5e1",
                    fontSize: "13px",
                    background: "#ffffff",
                    color: "#1e293b",
                  }}
                >
                  <option value="ALL">All Warehouses</option>
                  {warehouseTabs.map((wh) => (
                    <option key={wh} value={wh}>
                      {wh}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label
                  htmlFor="cargo-filter-stage"
                  style={{
                    display: "block",
                    fontSize: "12px",
                    fontWeight: 600,
                    color: "#1e293b",
                    marginBottom: "6px",
                  }}
                >
                  Finance Status
                </label>
                <select
                  id="cargo-filter-stage"
                  aria-label="Finance Status"
                  value={stageFilter}
                  onChange={(e) => setStageFilter(e.target.value as CargoStage)}
                  style={{
                    width: "100%",
                    height: "36px",
                    padding: "0 10px",
                    borderRadius: "4px",
                    border: "1px solid #cbd5e1",
                    fontSize: "13px",
                    background: "#ffffff",
                    color: "#1e293b",
                  }}
                >
                  <option value="all">All</option>
                  <option value="pending">Pending</option>
                  <option value="cleared">Cleared</option>
                </select>
              </div>

              <div>
                <label
                  htmlFor="cargo-filter-forwarder"
                  style={{
                    display: "block",
                    fontSize: "12px",
                    fontWeight: 600,
                    color: "#1e293b",
                    marginBottom: "6px",
                  }}
                >
                  Forwarder Name
                </label>
                <input
                  id="cargo-filter-forwarder"
                  type="text"
                  placeholder="Filter by forwarder..."
                  value={forwarderFilter}
                  onChange={(e) => setForwarderFilter(e.target.value)}
                  style={{
                    width: "100%",
                    height: "36px",
                    padding: "0 10px",
                    borderRadius: "4px",
                    border: "1px solid #cbd5e1",
                    fontSize: "13px",
                    background: "#ffffff",
                    color: "#1e293b",
                    boxSizing: "border-box",
                  }}
                />
              </div>

              <div>
                <label
                  htmlFor="cargo-filter-agent"
                  style={{
                    display: "block",
                    fontSize: "12px",
                    fontWeight: 600,
                    color: "#1e293b",
                    marginBottom: "6px",
                  }}
                >
                  Clearing Agent
                </label>
                <input
                  id="cargo-filter-agent"
                  type="text"
                  placeholder="Filter by clearing agent..."
                  value={agentFilter}
                  onChange={(e) => setAgentFilter(e.target.value)}
                  style={{
                    width: "100%",
                    height: "36px",
                    padding: "0 10px",
                    borderRadius: "4px",
                    border: "1px solid #cbd5e1",
                    fontSize: "13px",
                    background: "#ffffff",
                    color: "#1e293b",
                    boxSizing: "border-box",
                  }}
                />
              </div>
            </div>

            <div style={{ display: "flex", justifyContent: "flex-end", gap: "10px", marginTop: "16px" }}>
              <button
                type="button"
                className="btn-filter-reset"
                data-testid="cargo-filter-reset"
                onClick={handleResetFilters}
              >
                Reset
              </button>
              <button
                type="button"
                className="btn-filter-search"
                data-testid="cargo-filter-search"
                onClick={handleApplyFilters}
              >
                Search
              </button>
            </div>
          </div>
        )}

        {/* Main Card */}
        <div
          className="card"
          data-testid="cargo-overview-list-card"
          style={{
            background: "#ffffff",
            border: "1px solid #e2e8f0",
            borderRadius: 10,
            padding: "16px 20px",
            boxShadow: "0 1px 3px rgba(15, 23, 42, 0.04)",
          }}
        >
          {/* Warehouse Tabs + Finance Stage Filter Pills */}
          <div
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              flexWrap: "wrap",
              gap: 12,
              borderBottom: "1px solid #e2e8f0",
              paddingBottom: 10,
              marginBottom: 14,
            }}
          >
            <div style={{ display: "flex", alignItems: "center", gap: 18, flexWrap: "wrap" }}>
              <button
                type="button"
                data-testid="cargo-wh-tab-all"
                onClick={() => {
                  setWarehouseTab("ALL");
                  setWarehouseFilter("ALL");
                  setCurrentPage(1);
                }}
                style={{
                  border: "none",
                  background: "transparent",
                  padding: "6px 4px",
                  fontSize: 13.5,
                  fontWeight: warehouseTab === "ALL" ? 700 : 500,
                  color: warehouseTab === "ALL" ? "#2563eb" : "#475569",
                  borderBottom:
                    warehouseTab === "ALL" ? "2px solid #2563eb" : "2px solid transparent",
                  cursor: "pointer",
                }}
              >
                All ({allItems.length})
              </button>
              {warehouseTabs.map((wh) => (
                <button
                  key={wh}
                  type="button"
                  data-testid={`cargo-wh-tab-${wh}`}
                  onClick={() => {
                    setWarehouseTab(wh);
                    setWarehouseFilter(wh);
                    setCurrentPage(1);
                  }}
                  style={{
                    border: "none",
                    background: "transparent",
                    padding: "6px 4px",
                    fontSize: 13.5,
                    fontWeight: warehouseTab === wh ? 700 : 500,
                    color: warehouseTab === wh ? "#2563eb" : "#475569",
                    borderBottom:
                      warehouseTab === wh ? "2px solid #2563eb" : "2px solid transparent",
                    cursor: "pointer",
                  }}
                >
                  {wh}
                </button>
              ))}
            </div>

            <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
              {(
                [
                  ["all", `All (${data.total_consignments})`],
                  ["pending", `Pending (${data.pending_consignments})`],
                  ["cleared", `Cleared (${data.cleared_consignments})`],
                ] as const
              ).map(([st, label]) => (
                <button
                  key={st}
                  type="button"
                  data-testid={`cargo-stage-tab-${st}`}
                  onClick={() => {
                    setStageTab(st);
                    setStageFilter(st);
                    setCurrentPage(1);
                  }}
                  style={{
                    padding: "5px 12px",
                    borderRadius: 6,
                    border: stageTab === st ? "1px solid #2563eb" : "1px solid #cbd5e1",
                    background: stageTab === st ? "#eff6ff" : "#ffffff",
                    color: stageTab === st ? "#1d4ed8" : "#475569",
                    fontSize: 12,
                    fontWeight: 700,
                    cursor: "pointer",
                  }}
                >
                  {label}
                </button>
              ))}
            </div>
          </div>

          {/* Page Size & Search */}
          <div
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              flexWrap: "wrap",
              gap: 12,
              marginBottom: 14,
            }}
          >
            <div style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13, color: "#475569" }}>
              <select
                data-testid="cargo-items-per-page"
                value={pageSize}
                onChange={(e) => {
                  setPageSize(Number(e.target.value));
                  setCurrentPage(1);
                }}
                style={{
                  padding: "6px 10px",
                  borderRadius: 6,
                  border: "1px solid #cbd5e1",
                  fontSize: 13,
                }}
              >
                <option value={25}>25</option>
                <option value={50}>50</option>
                <option value={100}>100</option>
              </select>
              <span>items/page</span>
            </div>

            <input
              type="text"
              data-testid="cargo-search-input"
              placeholder="Search consignment, supplier, batch, forwarder..."
              value={searchQuery}
              onChange={(e) => {
                setSearchQuery(e.target.value);
                setCurrentPage(1);
              }}
              style={{
                width: 340,
                maxWidth: "100%",
                padding: "7px 12px",
                borderRadius: 8,
                border: "1px solid #cbd5e1",
                fontSize: 13,
              }}
            />
          </div>

          {/* Table */}
          <div style={{ overflowX: "auto" }}>
            <table
              data-testid="cargo-overview-table"
              style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}
            >
              <thead>
                <tr
                  style={{
                    background: "#f8fafc",
                    borderBottom: "1px solid #e2e8f0",
                    color: "#334155",
                    textAlign: "left",
                  }}
                >
                  <th style={{ padding: "10px 12px", fontWeight: 700 }}>Invoice / Cons. No. &amp; Date</th>
                  <th style={{ padding: "10px 12px", fontWeight: 700 }}>Supplier Name</th>
                  <th style={{ padding: "10px 12px", fontWeight: 700 }}>Batch No.</th>
                  <th style={{ padding: "10px 12px", fontWeight: 700 }}>Warehouse</th>
                  <th style={{ padding: "10px 12px", fontWeight: 700, textAlign: "center" }}>PI</th>
                  <th style={{ padding: "10px 12px", fontWeight: 700 }}>Ordered Date</th>
                  <th style={{ padding: "10px 12px", fontWeight: 700 }}>ETD Origin</th>
                  <th style={{ padding: "10px 12px", fontWeight: 700 }}>ETA Port</th>
                  <th style={{ padding: "10px 12px", fontWeight: 700 }}>Forwarder Name</th>
                  <th style={{ padding: "10px 12px", fontWeight: 700 }}>Agent Name</th>
                  <th style={{ padding: "10px 12px", fontWeight: 700 }}>Gallery Docs</th>
                  <th style={{ padding: "10px 12px", fontWeight: 700 }}>Cargo Checklist</th>
                  <th style={{ padding: "10px 12px", fontWeight: 700 }}>Finance Status</th>
                  <th style={{ padding: "10px 12px", fontWeight: 700 }}>Cargo Remark</th>
                  <th style={{ padding: "10px 12px", fontWeight: 700, textAlign: "center" }}>
                    Action
                  </th>
                </tr>
              </thead>
              <tbody>
                {loading && pagedItems.length === 0 ? (
                  <tr>
                    <td
                      colSpan={15}
                      style={{ padding: "32px", textAlign: "center", color: "#64748b" }}
                    >
                      Loading Cargo Overviews...
                    </td>
                  </tr>
                ) : pagedItems.length === 0 ? (
                  <tr>
                    <td
                      colSpan={15}
                      data-testid="cargo-empty-state"
                      style={{ padding: "32px", textAlign: "center", color: "#64748b" }}
                    >
                      No Data Available In Table
                    </td>
                  </tr>
                ) : (
                  pagedItems.map((row, idx) => (
                    <tr
                      key={row.consignment_key}
                      data-testid={`cargo-row-${row.consignment_key}`}
                      style={{
                        background: idx % 2 === 0 ? "#f8fafc" : "#ffffff",
                        borderBottom: "1px solid #e2e8f0",
                      }}
                    >
                      <td style={{ padding: "10px 12px" }}>
                        <button
                          type="button"
                          onClick={() => openDetailView(row.consignment_key)}
                          style={{
                            border: "none",
                            background: "transparent",
                            padding: 0,
                            color: "#2563eb",
                            fontWeight: 700,
                            fontSize: 13.5,
                            cursor: "pointer",
                            textAlign: "left",
                          }}
                        >
                          {row.display_title}
                        </button>
                        <div style={{ fontSize: 11.5, color: "#64748b", marginTop: 2 }}>
                          {formatDisplayDate(row.ordered_date)}
                        </div>
                      </td>

                      <td style={{ padding: "10px 12px", color: "#334155", fontWeight: 600 }}>
                        {row.supplier_summary || "—"}
                      </td>

                      <td style={{ padding: "10px 12px", color: "#334155" }}>
                        {row.batch_no || "—"}
                      </td>

                      <td style={{ padding: "10px 12px", color: "#334155" }}>
                        {row.warehouse || "—"}
                      </td>

                      <td style={{ padding: "10px 12px", textAlign: "center" }}>
                        {row.pi_file_url ? (
                          <a
                            href={resolveFileHref(row.pi_file_url)}
                            target="_blank"
                            rel="noreferrer"
                            title="Download Proforma Invoice"
                            style={{ color: "#2563eb", fontWeight: 700, textDecoration: "none" }}
                          >
                            ⬇
                          </a>
                        ) : (
                          <span style={{ color: "#94a3b8" }}>—</span>
                        )}
                      </td>

                      <td style={{ padding: "10px 12px", color: "#334155", whiteSpace: "nowrap" }}>
                        {formatDisplayDate(row.ordered_date)}
                      </td>

                      <td style={{ padding: "10px 12px", color: "#334155", whiteSpace: "nowrap" }}>
                        {formatDisplayDate(row.etd_origin_date)}
                      </td>

                      <td style={{ padding: "10px 12px", color: "#334155", whiteSpace: "nowrap" }}>
                        {formatDisplayDate(row.eta_port_date)}
                      </td>

                      <td style={{ padding: "10px 12px", color: "#334155" }}>
                        {row.forwarder_name || "—"}
                      </td>

                      <td style={{ padding: "10px 12px", color: "#334155" }}>
                        {row.clearing_agent_name || "—"}
                      </td>

                      <td style={{ padding: "10px 12px" }}>
                        {perms.canViewGallery ? (
                          <button
                            type="button"
                            onClick={() => setQuickGalleryKey(row.consignment_key)}
                            style={{
                              display: "inline-block",
                              padding: "3px 9px",
                              borderRadius: 6,
                              border: "none",
                              fontSize: 11.5,
                              fontWeight: 700,
                              background: row.docs_uploaded_count > 0 ? "#eff6ff" : "#f1f5f9",
                              color: row.docs_uploaded_count > 0 ? "#1d4ed8" : "#64748b",
                              cursor: "pointer",
                              whiteSpace: "nowrap",
                            }}
                          >
                            📄 {row.docs_uploaded_count} / {row.docs_total_count}
                          </button>
                        ) : (
                          <span style={{ color: "#94a3b8" }}>—</span>
                        )}
                      </td>

                      <td style={{ padding: "10px 12px" }}>
                        {perms.canViewCargoStatus ? (
                          <button
                            type="button"
                            onClick={() => setQuickChecklistKey(row.consignment_key)}
                            style={{
                              display: "inline-block",
                              padding: "3px 9px",
                              borderRadius: 6,
                              border: "none",
                              fontSize: 11.5,
                              fontWeight: 700,
                              background: row.checklist_yes_count > 0 ? "#dcfce7" : "#fee2e2",
                              color: row.checklist_yes_count > 0 ? "#15803d" : "#dc2626",
                              cursor: "pointer",
                              whiteSpace: "nowrap",
                            }}
                          >
                            ✓ {row.checklist_yes_count} / {row.checklist_total_count}
                          </button>
                        ) : (
                          <span style={{ color: "#94a3b8" }}>—</span>
                        )}
                      </td>

                      <td style={{ padding: "10px 12px" }}>
                        {perms.canViewFinance ? (
                          <span
                            style={{
                              display: "inline-block",
                              padding: "3px 10px",
                              borderRadius: 6,
                              fontSize: 11.5,
                              fontWeight: 700,
                              background: row.overall_stage === "cleared" ? "#dbeafe" : "#fef3c7",
                              color: row.overall_stage === "cleared" ? "#1d4ed8" : "#b45309",
                            }}
                          >
                            {row.overall_stage === "cleared" ? "Cleared" : "Pending"}
                          </span>
                        ) : (
                          <span style={{ color: "#94a3b8" }}>—</span>
                        )}
                      </td>

                      <td style={{ padding: "10px 12px", minWidth: 140 }}>
                        <textarea
                          rows={1}
                          aria-label={`Cargo Remark for ${row.display_title}`}
                          defaultValue={row.cargo_remarks ?? ""}
                          disabled={!perms.canEditCargoStatus}
                          placeholder="Remark..."
                          onBlur={(e) => {
                            if (perms.canEditCargoStatus) {
                              void handleSaveInlineRemark(row.consignment_key, e.target.value);
                            }
                          }}
                          style={{
                            width: "100%",
                            minWidth: 120,
                            padding: "4px 8px",
                            borderRadius: 6,
                            border: "1px solid #cbd5e1",
                            fontSize: 12,
                            resize: "vertical",
                            background: perms.canEditCargoStatus ? "#ffffff" : "#f8fafc",
                            boxSizing: "border-box",
                          }}
                        />
                      </td>

                      <td style={{ padding: "10px 12px", textAlign: "center" }}>
                        <button
                          type="button"
                          aria-label={`Actions for ${row.display_title}`}
                          data-testid={`cargo-action-btn-${row.consignment_key}`}
                          onClick={(e) => {
                            e.stopPropagation();
                            const rect = e.currentTarget.getBoundingClientRect();
                            const flipUp = window.innerHeight - rect.bottom < 160;
                            setMenuState({
                              key: row.consignment_key,
                              top: flipUp ? rect.top - 128 : rect.bottom + 4,
                              left: Math.min(window.innerWidth - 210, Math.max(8, rect.right - 190)),
                            });
                          }}
                          style={{
                            width: 30,
                            height: 30,
                            borderRadius: 6,
                            border: "1px solid #cbd5e1",
                            background: "#ffffff",
                            color: "#334155",
                            cursor: "pointer",
                            fontWeight: 800,
                            fontSize: 15,
                          }}
                        >
                          ⋮
                        </button>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>

          {/* Pagination */}
          <div style={{ marginTop: 14 }}>
            <Pagination
              pagination={paginationMeta}
              pageSize={pageSize}
              onPageChange={(p) => setCurrentPage(p)}
              onPageSizeChange={(s) => {
                setPageSize(s);
                setCurrentPage(1);
              }}
            />
          </div>
        </div>
      </main>

      {/* Portal Action Menu */}
      {menuState &&
        createPortal(
          <div
            data-testid="cargo-action-menu"
            role="menu"
            onMouseDown={(e) => e.stopPropagation()}
            style={{
              position: "fixed",
              top: menuState.top,
              left: menuState.left,
              width: 200,
              background: "#ffffff",
              border: "1px solid #e2e8f0",
              borderRadius: 8,
              boxShadow: "0 10px 25px rgba(15, 23, 42, 0.14)",
              padding: "6px",
              display: "flex",
              flexDirection: "column",
              gap: 2,
              zIndex: 9999,
            }}
          >
            <button
              type="button"
              role="menuitem"
              onClick={() => openDetailView(menuState.key)}
              style={{
                textAlign: "left",
                padding: "8px 10px",
                borderRadius: 6,
                border: "none",
                background: "transparent",
                color: "#0f172a",
                fontSize: 13,
                fontWeight: 600,
                cursor: "pointer",
              }}
            >
              Open Cargo Overview
            </button>
            {perms.canViewGallery && (
              <button
                type="button"
                role="menuitem"
                onClick={() => {
                  setQuickGalleryKey(menuState.key);
                  setMenuState(null);
                }}
                style={{
                  textAlign: "left",
                  padding: "8px 10px",
                  borderRadius: 6,
                  border: "none",
                  background: "transparent",
                  color: "#0f172a",
                  fontSize: 13,
                  fontWeight: 600,
                  cursor: "pointer",
                }}
              >
                Consignment Gallery
              </button>
            )}
            {perms.canViewCargoStatus && (
              <button
                type="button"
                role="menuitem"
                onClick={() => {
                  setQuickChecklistKey(menuState.key);
                  setMenuState(null);
                }}
                style={{
                  textAlign: "left",
                  padding: "8px 10px",
                  borderRadius: 6,
                  border: "none",
                  background: "transparent",
                  color: "#0f172a",
                  fontSize: 13,
                  fontWeight: 600,
                  cursor: "pointer",
                }}
              >
                Shipment Checklist Details
              </button>
            )}
          </div>,
          document.body,
        )}

      {/* Quick Modal: Consignment Details (Gallery) */}
      <Modal
        open={Boolean(quickGalleryRow)}
        title="Consignment Details"
        onClose={() => setQuickGalleryKey(null)}
        variant="center"
        cardStyle={{ maxWidth: 1080, width: "95vw", maxHeight: "90vh", overflowY: "auto" }}
      >
        {quickGalleryRow && (
          <div style={{ padding: "16px 20px" }}>
            <ConsignmentHeaderStrip consignment={quickGalleryRow} />
            <DocumentGalleryGrid
              consignmentKey={quickGalleryRow.consignment_key}
              documents={quickGalleryRow.documents}
              canUpload={perms.canUploadGallery}
              canDelete={perms.canDeleteGallery}
              uploadingSlot={uploadingSlot}
              deletingSlot={deletingSlot}
              onUpload={(k, s, f) => void handleUploadDocument(k, s, f)}
              onDelete={(k, s) => void handleDeleteDocument(k, s)}
            />
          </div>
        )}
      </Modal>

      {/* Quick Modal: Shipment Checklist Details */}
      <Modal
        open={Boolean(quickChecklistRow)}
        title="Shipment Checklist Details"
        onClose={() => setQuickChecklistKey(null)}
        variant="center"
        cardStyle={{ maxWidth: 1040, width: "95vw", maxHeight: "90vh", overflowY: "auto" }}
      >
        {quickChecklistRow && (
          <div style={{ padding: "16px 20px" }}>
            <ConsignmentHeaderStrip consignment={quickChecklistRow} />
            <ShipmentChecklistGrid
              consignmentKey={quickChecklistRow.consignment_key}
              checklist={quickChecklistRow.checklist}
              canEdit={perms.canEditCargoStatus}
              onToggle={(k, c, v) => void handleToggleChecklistItem(k, c, v)}
            />
          </div>
        )}
      </Modal>
    </AppShell>
  );
}
