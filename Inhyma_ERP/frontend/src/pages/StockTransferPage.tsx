import React, { useState, useEffect, useLayoutEffect, useMemo, useCallback, useRef } from "react";
import { useNavigate } from "react-router-dom";
import { AppShell } from "@/components/AppShell";
import { Breadcrumb } from "@/components/Breadcrumb";
import { SideDrawer, DetailFieldGrid } from "@/components/SideDrawer";
import { DateRangePicker } from "@/components/DateRangePicker";
import { Pagination } from "@/components/Pagination";
import type { PaginationMeta } from "@/types";
import { InventoryApi } from "@/lib/api";
import "@/styles/stockTransfer.css";

export interface StockTransferLineItem {
  id?: string;
  product_name: string;
  product_code?: string;
  category?: string;
  quantity: number;
  uom: string;
  rate: number;
  amount: number;
}

export interface StockTransferItem {
  id: string;
  sr_no: number;
  transfer_no: string;
  transfer_date: string;
  from_warehouse: string;
  to_warehouse: string;
  total_amount: number;
  added_by: string;
  status: "Received" | "Pending" | "Confirmed" | "Cancel" | string;
  remarks?: string;
  items?: StockTransferLineItem[];
}

export const INITIAL_TRANSFERS: StockTransferItem[] = [
  {
    id: "trf-52",
    sr_no: 52,
    transfer_no: "TRF-2026-052",
    transfer_date: "18-09-2026 04:37 PM",
    from_warehouse: "Ahmedabad",
    to_warehouse: "Mumbai",
    total_amount: 629534.06,
    added_by: "Akshata Wadekar",
    status: "Received",
    remarks: "Inter-branch stock transfer from Ahmedabad warehouse to Mumbai main hub",
    items: [
      { product_name: "FFS500 Centre sealer 300mm", quantity: 3, uom: "PCS", rate: 37494.85, amount: 112484.55 },
      { product_name: "FFS1000 Centre Sealer 420mm", quantity: 2, uom: "PCS", rate: 54023.78, amount: 108047.56 },
      { product_name: "GF100FD Granular Filler Double Head FFS", quantity: 2, uom: "PCS", rate: 17150.74, amount: 34301.48 },
      { product_name: "GF1000F Granular Filler FFS", quantity: 4, uom: "PCS", rate: 14315.88, amount: 57263.52 },
      { product_name: "GF1000FD Granular Filler Double Head FFS", quantity: 1, uom: "PCS", rate: 30442.71, amount: 30442.71 },
      { product_name: "GF5000 Granular Filler", quantity: 3, uom: "PCS", rate: 20423.10, amount: 61269.30 },
      { product_name: "DZ400 2B Vacuum machine", quantity: 2, uom: "PCS", rate: 24771.60, amount: 49543.20 },
      { product_name: "FXJ6050 Semi Automatic Carton Sealer 3\"", quantity: 1, uom: "PCS", rate: 49649.85, amount: 49649.85 },
      { product_name: "FQL450 Auto L-sealer w/o Connect parts", quantity: 1, uom: "PCS", rate: 126531.89, amount: 126531.89 },
    ],
  },
  {
    id: "trf-51",
    sr_no: 51,
    transfer_no: "TRF-2026-051",
    transfer_date: "18-09-2026 03:25 PM",
    from_warehouse: "Indore",
    to_warehouse: "Ahmedabad",
    total_amount: 46166.85,
    added_by: "Akshata Wadekar",
    status: "Received",
    remarks: "Urgent spare replenishment for client breakdown in Ahmedabad",
    items: [
      { product_name: "Temperature Controller Omron E5CC", product_code: "ELEC-012", category: "Spares", quantity: 5, uom: "PCS", rate: 9233.37, amount: 46166.85 },
    ],
  },
  {
    id: "trf-50",
    sr_no: 50,
    transfer_no: "TRF-2026-050",
    transfer_date: "18-09-2026 03:24 PM",
    from_warehouse: "Indore",
    to_warehouse: "Mumbai",
    total_amount: 2748194.00,
    added_by: "Akshata Wadekar",
    status: "Received",
    remarks: "Full automated line transfer for packaging exhibition consignment",
    items: [
      { product_name: "ISL250 Rotary PFS 8 Head With Zipper & Nitrogen", product_code: "MACH-001", category: "Machines", quantity: 1, uom: "SET", rate: 1850000, amount: 1850000 },
      { product_name: "AF1000T Automatic Liquid/Paste Filler Tube Sealer", product_code: "MACH-004", category: "Machines", quantity: 1, uom: "SET", rate: 898194, amount: 898194 },
    ],
  },
  {
    id: "trf-49",
    sr_no: 49,
    transfer_no: "TRF-2026-049",
    transfer_date: "12-09-2026 06:35 PM",
    from_warehouse: "Mumbai",
    to_warehouse: "Ahmedabad",
    total_amount: 1175450.00,
    added_by: "Akshata Wadekar",
    status: "Received",
    remarks: "Scheduled machine allocation for Gujarat distributor order",
    items: [
      { product_name: "XLSG36100 Capping Machine", product_code: "MACH-003", category: "Machines", quantity: 2, uom: "SET", rate: 587725, amount: 1175450 },
    ],
  },
  {
    id: "trf-48",
    sr_no: 48,
    transfer_no: "TRF-2026-048",
    transfer_date: "09-09-2026 04:03 PM",
    from_warehouse: "Mumbai",
    to_warehouse: "Ahmedabad",
    total_amount: 94440.00,
    added_by: "Akshata Wadekar",
    status: "Received",
    remarks: "Transfer of conveyor belts and sensor assemblies",
    items: [
      { product_name: "Conveyor Belt Replacement Roll 300mm", product_code: "BELT-300", category: "Spares", quantity: 4, uom: "PCS", rate: 23610, amount: 94440 },
    ],
  },
  {
    id: "trf-47",
    sr_no: 47,
    transfer_no: "TRF-2026-047",
    transfer_date: "01-09-2026 02:51 PM",
    from_warehouse: "Ahmedabad",
    to_warehouse: "Mumbai",
    total_amount: 1993055.00,
    added_by: "Akshata Wadekar",
    status: "Received",
    remarks: "Quarterly stock consolidation into central logistics warehouse",
    items: [
      { product_name: "Semi Automatic MAP Tray/Cup Sealing Machine", product_code: "MACH-005", category: "Machines", quantity: 2, uom: "SET", rate: 996527.5, amount: 1993055 },
    ],
  },
  {
    id: "trf-46",
    sr_no: 46,
    transfer_no: "TRF-2026-046",
    transfer_date: "01-09-2026 12:50 PM",
    from_warehouse: "Mumbai",
    to_warehouse: "Ahmedabad",
    total_amount: 287821.00,
    added_by: "Akshata Wadekar",
    status: "Received",
    remarks: "Flow wrap accessory shipment for client demonstration",
    items: [
      { product_name: "Infeed Chain Assembly 3.5M", product_code: "CHN-35", category: "Spares", quantity: 2, uom: "SET", rate: 143910.5, amount: 287821 },
    ],
  },
  {
    id: "trf-45",
    sr_no: 45,
    transfer_no: "TRF-2026-045",
    transfer_date: "22-08-2026 07:00 PM",
    from_warehouse: "Indore",
    to_warehouse: "Mumbai",
    total_amount: 834428.00,
    added_by: "Akshata Wadekar",
    status: "Received",
    remarks: "Pre-shipment inspection transfer",
    items: [
      { product_name: "PFFS200 Pneumatic Centre Sealer 240mm PLC", product_code: "MACH-010", category: "Machines", quantity: 1, uom: "SET", rate: 834428, amount: 834428 },
    ],
  },
  {
    id: "trf-44",
    sr_no: 44,
    transfer_no: "TRF-2026-044",
    transfer_date: "21-08-2026 11:35 AM",
    from_warehouse: "Mumbai",
    to_warehouse: "Indore",
    total_amount: 97080.00,
    added_by: "Akshata Wadekar",
    status: "Received",
    remarks: "Scheduled spares replenishment for central MP region",
    items: [
      { product_name: "Heater Cartridge 230V 500W", product_code: "HEAT-500", category: "Spares", quantity: 20, uom: "PCS", rate: 4854, amount: 97080 },
    ],
  },
  {
    id: "trf-43",
    sr_no: 43,
    transfer_no: "TRF-2026-043",
    transfer_date: "08-08-2026 02:26 PM",
    from_warehouse: "Ahmedabad",
    to_warehouse: "Mumbai",
    total_amount: 12160.00,
    added_by: "Akshata Wadekar",
    status: "Received",
    remarks: "Optical sensor emergency transfer",
    items: [
      { product_name: "Photoelectric Mark Sensor Banner", product_code: "SEN-OPT-01", category: "Spares", quantity: 2, uom: "PCS", rate: 6080, amount: 12160 },
    ],
  },
];

// Helper to format Indian currency
function formatIndianCurrency(amount: number): string {
  return "₹ " + amount.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

export const TRANSFER_COLUMN_LABELS = [
  "", // 0: Checkbox
  "Sr. No.", // 1
  "Transfer Date", // 2
  "From Warehouse", // 3
  "To Warehouse", // 4
  "Total", // 5
  "Added By", // 6
  "Status", // 7
  "Action", // 8
];

export function StockTransferSkeletonRows({
  count = 8,
  displayOrder = [0, 1, 2, 3, 4, 5, 6, 7, 8],
  getFreezeStyle = () => ({}),
}: {
  count?: number;
  displayOrder?: number[];
  getFreezeStyle?: (colIdx: number, isHeader?: boolean) => React.CSSProperties;
}) {
  const rowIndexes = Array.from({ length: count }, (_, i) => i);

  return (
    <>
      {rowIndexes.map((rowIndex) => (
        <tr
          key={`trf-sk-${rowIndex}`}
          className="skeleton-row"
          data-testid="transfer-skeleton-row"
          style={{ borderBottom: "1px solid #f1f5f9" }}
        >
          {displayOrder.map((colIdx) => {
            let content: React.ReactNode = null;
            switch (colIdx) {
              case 0:
                content = (
                  <div
                    className="skeleton-line"
                    style={{ width: "16px", height: "16px", borderRadius: "4px", margin: "0 auto" }}
                  />
                );
                break;
              case 1:
                content = (
                  <div
                    className="skeleton-line"
                    style={{ width: "24px", height: "14px", borderRadius: "4px", margin: "0 auto" }}
                  />
                );
                break;
              case 2:
                content = (
                  <div
                    className="skeleton-line"
                    style={{ width: "135px", height: "14px", borderRadius: "4px" }}
                  />
                );
                break;
              case 3:
                content = (
                  <div
                    className="skeleton-line"
                    style={{ width: "90px", height: "14px", borderRadius: "4px" }}
                  />
                );
                break;
              case 4:
                content = (
                  <div
                    className="skeleton-line"
                    style={{ width: "90px", height: "14px", borderRadius: "4px" }}
                  />
                );
                break;
              case 5:
                content = (
                  <div
                    className="skeleton-line"
                    style={{ width: "95px", height: "14px", borderRadius: "4px", marginLeft: "auto" }}
                  />
                );
                break;
              case 6:
                content = (
                  <div
                    className="skeleton-line"
                    style={{ width: "110px", height: "14px", borderRadius: "4px" }}
                  />
                );
                break;
              case 7:
                content = (
                  <div
                    className="skeleton-line"
                    style={{ width: "65px", height: "22px", borderRadius: "12px" }}
                  />
                );
                break;
              case 8:
                content = (
                  <div
                    className="skeleton-line"
                    style={{ width: "24px", height: "24px", borderRadius: "4px", margin: "0 auto" }}
                  />
                );
                break;
              default:
                content = <div className="skeleton-line" style={{ height: "14px", borderRadius: "4px" }} />;
            }

            return (
              <td
                key={`sk-cell-${colIdx}`}
                className={colIdx === 1 ? "cell-srno" : colIdx === 8 ? "transfer-action-cell" : undefined}
                style={{
                  padding: "14px 16px",
                  ...(colIdx === 0 ? { width: "40px", minWidth: "40px", maxWidth: "45px", textAlign: "center" } : {}),
                  ...(colIdx === 1 ? { width: "92px", minWidth: "92px", maxWidth: "100px", textAlign: "center" } : {}),
                  ...(colIdx === 5 ? { textAlign: "right", paddingRight: "16px" } : {}),
                  ...(colIdx === 8 ? { width: "70px", minWidth: "70px", textAlign: "center" } : {}),
                  ...getFreezeStyle(colIdx, false),
                }}
              >
                {content}
              </td>
            );
          })}
        </tr>
      ))}
    </>
  );
}

export interface StockTransferPageProps {
  initialLoading?: boolean;
}

export function StockTransferPage({
  initialLoading = import.meta.env.MODE !== "test",
}: StockTransferPageProps = {}) {
  const navigate = useNavigate();
  const [loading, setLoading] = useState<boolean>(initialLoading);
  const [items, setItems] = useState<StockTransferItem[]>(INITIAL_TRANSFERS);
  const [activeTab, setActiveTab] = useState<"All" | "Pending" | "Confirmed" | "Received" | "Cancel">("All");
  const [tabCounts, setTabCounts] = useState({
    all: 46,
    pending: 0,
    confirmed: 3,
    received: 41,
    cancel: 2,
  });

  const [searchTerm, setSearchTerm] = useState("");
  const [perPage, setPerPage] = useState<number>(50);
  const [currentPage, setCurrentPage] = useState<number>(1);
  const [showFilterPanel, setShowFilterPanel] = useState<boolean>(false);

  // Sorting state (normal default catalog order with null sortColIndex)
  const [sortColIndex, setSortColIndex] = useState<number | null>(null);
  const [sortDirection, setSortDirection] = useState<"asc" | "desc">("asc");

  const handleHeaderSort = (colIdx: number) => {
    if (sortColIndex === colIdx) {
      if (sortDirection === "asc") setSortDirection("desc");
      else {
        setSortColIndex(null);
        setSortDirection("asc");
      }
    } else {
      setSortColIndex(colIdx);
      setSortDirection("asc");
    }
  };

  // Dynamic Column Freezing
  const [pinnedCols, setPinnedCols] = useState<Record<number, "left" | "right">>(() => {
    const saved = localStorage.getItem("stock_transfer_pinned_cols_v1");
    if (saved !== null) {
      try {
        return JSON.parse(saved);
      } catch {}
    }
    return { 0: "left", 1: "left", 2: "left" };
  });

  useEffect(() => {
    localStorage.setItem("stock_transfer_pinned_cols_v1", JSON.stringify(pinnedCols));
  }, [pinnedCols]);

  const [colLeftOffsets, setColLeftOffsets] = useState<Record<number, number>>({});
  const [colRightOffsets, setColRightOffsets] = useState<Record<number, number>>({});
  const [pinMenuOpen, setPinMenuOpen] = useState(false);
  const pinMenuRef = useRef<HTMLDivElement>(null);
  const tableRef = useRef<HTMLTableElement>(null);

  // Bulk Actions & selection state
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [bulkMenuOpen, setBulkMenuOpen] = useState(false);
  const bulkMenuRef = useRef<HTMLDivElement>(null);

  const togglePin = useCallback((colIdx: number) => {
    setPinnedCols((prev) => {
      const next = { ...prev };
      if (next[colIdx]) {
        delete next[colIdx];
      } else {
        if (colIdx >= 8) {
          next[colIdx] = "right";
        } else {
          next[colIdx] = "left";
        }
      }
      return next;
    });
  }, []);

  const displayOrder = useMemo(() => {
    const allIndices = Array.from({ length: 9 }, (_, i) => i);
    const lefts = allIndices.filter((idx) => pinnedCols[idx] === "left");
    const unpinned = allIndices.filter((idx) => !pinnedCols[idx]);
    const rights = allIndices.filter((idx) => pinnedCols[idx] === "right");
    return [...lefts, ...unpinned, ...rights];
  }, [pinnedCols]);

  // Date range filter states (Exact Screenshot Replica)
  const [dateRangeFilter, setDateRangeFilter] = useState("");
  const [appliedDateRange, setAppliedDateRange] = useState("");

  // Filter drafts
  const [fromWhFilter, setFromWhFilter] = useState("All");
  const [toWhFilter, setToWhFilter] = useState("All");

  // Active drawer item
  const [activeItem, setActiveItem] = useState<StockTransferItem | null>(null);

  // Action menu opened ID
  const [openActionMenuId, setOpenActionMenuId] = useState<string | null>(null);

  // Add new modal state
  const [showAddModal, setShowAddModal] = useState<boolean>(false);
  const [newFromWh, setNewFromWh] = useState("Ahmedabad");
  const [newToWh, setNewToWh] = useState("Mumbai");
  const [newAmount, setNewAmount] = useState("");
  const [newRemarks, setNewRemarks] = useState("");

  // Close menus on outside click
  useEffect(() => {
    function handleDocClick(e: MouseEvent) {
      setOpenActionMenuId(null);
      if (pinMenuRef.current && !pinMenuRef.current.contains(e.target as Node)) {
        setPinMenuOpen(false);
      }
      if (bulkMenuRef.current && !bulkMenuRef.current.contains(e.target as Node)) {
        setBulkMenuOpen(false);
      }
    }
    document.addEventListener("mousedown", handleDocClick);
    return () => {
      document.removeEventListener("mousedown", handleDocClick);
    };
  }, []);

  // Sticky offset calculation using ResizeObserver
  useLayoutEffect(() => {
    if (!tableRef.current) return;
    const tableEl = tableRef.current;

    const updateOffsets = () => {
      const ths = tableEl.querySelectorAll("thead th");
      if (!ths.length) return;

      const lefts = displayOrder.filter((idx) => pinnedCols[idx] === "left");
      let accumLeft = 0;
      const nextLefts: Record<number, number> = {};
      for (const idx of lefts) {
        const thPos = displayOrder.indexOf(idx);
        if (ths[thPos]) {
          nextLefts[idx] = accumLeft;
          accumLeft += (ths[thPos] as HTMLElement).offsetWidth;
        }
      }

      const rights = displayOrder.filter((idx) => pinnedCols[idx] === "right").reverse();
      let accumRight = 0;
      const nextRights: Record<number, number> = {};
      for (const idx of rights) {
        const thPos = displayOrder.indexOf(idx);
        if (ths[thPos]) {
          nextRights[idx] = accumRight;
          accumRight += (ths[thPos] as HTMLElement).offsetWidth;
        }
      }

      setColLeftOffsets((prev) => {
        const isSame =
          Object.keys(nextLefts).length === Object.keys(prev).length &&
          Object.keys(nextLefts).every((k) => prev[Number(k)] === nextLefts[Number(k)]);
        return isSame ? prev : nextLefts;
      });
      setColRightOffsets((prev) => {
        const isSame =
          Object.keys(nextRights).length === Object.keys(prev).length &&
          Object.keys(nextRights).every((k) => prev[Number(k)] === nextRights[Number(k)]);
        return isSame ? prev : nextRights;
      });
    };

    updateOffsets();

    if (typeof ResizeObserver !== "undefined") {
      const ro = new ResizeObserver(() => updateOffsets());
      ro.observe(tableEl);
      return () => ro.disconnect();
    }
  }, [pinnedCols, items, loading, displayOrder]);

  const getFreezeStyle = useCallback(
    (colIdx: number, isHeader = false): React.CSSProperties => {
      const dir = pinnedCols[colIdx];
      const headerTopStyle: React.CSSProperties = isHeader
        ? {
            position: "sticky",
            top: 0,
            zIndex: dir ? 30 : 15,
            backgroundColor: "#f1f5f9",
            boxShadow: "0 2px 4px rgba(0, 0, 0, 0.06)",
          }
        : {};

      if (!dir) return headerTopStyle;

      const lefts = displayOrder.filter((idx) => pinnedCols[idx] === "left");
      const rights = displayOrder.filter((idx) => pinnedCols[idx] === "right");

      const isLastLeft = dir === "left" && colIdx === lefts[lefts.length - 1];
      const isFirstRight = dir === "right" && colIdx === rights[0];

      if (dir === "left") {
        const left = colLeftOffsets[colIdx] ?? 0;
        return {
          ...headerTopStyle,
          position: "sticky",
          left: `${left}px`,
          zIndex: isHeader ? 35 : 10,
          backgroundColor: isHeader ? "#f1f5f9" : "#ffffff",
          boxShadow: isLastLeft ? "3px 0 6px -2px rgba(0, 0, 0, 0.15)" : "none",
          borderRight: isLastLeft ? "2px solid #cbd5e1" : undefined,
        };
      }

      const right = colRightOffsets[colIdx] ?? 0;
      return {
        ...headerTopStyle,
        position: "sticky",
        right: `${right}px`,
        zIndex: isHeader ? 35 : 10,
        backgroundColor: isHeader ? "#f1f5f9" : "#ffffff",
        boxShadow: isFirstRight ? "-3px 0 6px -2px rgba(0, 0, 0, 0.15)" : "none",
        borderLeft: isFirstRight ? "2px solid #cbd5e1" : undefined,
      };
    },
    [pinnedCols, displayOrder, colLeftOffsets, colRightOffsets]
  );

  const handleToggleRow = (id: string, checked: boolean) => {
    setSelectedIds((prev) =>
      checked ? [...prev, id] : prev.filter((item) => item !== id)
    );
  };

  const handleBulkCancel = () => {
    if (selectedIds.length === 0) return;
    setItems((prev) =>
      prev.map((t) => (selectedIds.includes(t.id) ? { ...t, status: "Cancel" } : t))
    );
    for (const id of selectedIds) {
      InventoryApi.updateStockTransferStatus(id, "Cancel").catch((e) =>
        console.warn("Failed to update status in DB:", e)
      );
    }
    setBulkMenuOpen(false);
    setSelectedIds([]);
  };

  const handleBulkExport = () => {
    if (selectedIds.length === 0) return;
    const exportTargets = items.filter((i) => selectedIds.includes(i.id));
    const csvHeader = "Transfer No,Date,From Warehouse,To Warehouse,Total Amount,Added By,Status\n";
    const csvRows = exportTargets
      .map(
        (i) =>
          `"${i.transfer_no}","${i.transfer_date}","${i.from_warehouse}","${i.to_warehouse}",${i.total_amount},"${i.added_by}","${i.status}"`
      )
      .join("\n");
    const blob = new Blob([csvHeader + csvRows], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `stock_transfers_selected_${Date.now()}.csv`;
    a.click();
    URL.revokeObjectURL(url);
    setBulkMenuOpen(false);
  };

  const handleExportAllCsv = () => {
    const csvHeader = "Transfer No,Date,From Warehouse,To Warehouse,Total Amount,Added By,Status\n";
    const csvRows = items
      .map(
        (i) =>
          `"${i.transfer_no}","${i.transfer_date}","${i.from_warehouse}","${i.to_warehouse}",${i.total_amount},"${i.added_by}","${i.status}"`
      )
      .join("\n");
    const blob = new Blob([csvHeader + csvRows], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "stock_transfers.csv";
    a.click();
    URL.revokeObjectURL(url);
  };

  // Fetch live transfers from PostgreSQL database
  const loadTransfers = useCallback(() => {
    let cancelled = false;
    if (initialLoading) {
      setLoading(true);
    }
    InventoryApi.listStockTransfers({
      status: activeTab,
      from_warehouse: fromWhFilter !== "All" ? fromWhFilter : undefined,
      to_warehouse: toWhFilter !== "All" ? toWhFilter : undefined,
      limit: perPage,
    })
      .then((res) => {
        if (!cancelled && res?.data?.items && Array.isArray(res.data.items) && res.data.items.length > 0) {
          const savedStr = localStorage.getItem("local_stock_transfers");
          const localSaved: StockTransferItem[] = savedStr ? JSON.parse(savedStr) : [];
          const dbItems: StockTransferItem[] = res.data.items;
          const merged = [
            ...localSaved.filter((l) => !dbItems.some((d) => d.id === l.id || d.sr_no === l.sr_no)),
            ...dbItems,
          ];
          setItems(merged);
          if (res.data.tab_counts) {
            setTabCounts({
              ...res.data.tab_counts,
              all: res.data.tab_counts.all + localSaved.length,
              received: res.data.tab_counts.received + localSaved.length,
            });
          }
        }
      })
      .catch((err) => {
        console.warn("Using offline transfers fallback:", err);
        const savedStr = localStorage.getItem("local_stock_transfers");
        const localSaved: StockTransferItem[] = savedStr ? JSON.parse(savedStr) : [];
        setItems([...localSaved, ...INITIAL_TRANSFERS]);
      })
      .finally(() => {
        if (!cancelled) {
          setLoading(false);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [activeTab, fromWhFilter, toWhFilter, perPage, initialLoading]);

  useEffect(() => {
    const cleanup = loadTransfers();
    return cleanup;
  }, [loadTransfers]);

  // Handle Cancel action
  const handleCancelTransfer = useCallback((item: StockTransferItem) => {
    setItems((prev) =>
      prev.map((t) => (t.id === item.id ? { ...t, status: "Cancel" } : t))
    );
    setTabCounts((prev) => ({
      ...prev,
      received: Math.max(0, prev.received - (item.status === "Received" ? 1 : 0)),
      confirmed: Math.max(0, prev.confirmed - (item.status === "Confirmed" ? 1 : 0)),
      cancel: prev.cancel + (item.status !== "Cancel" ? 1 : 0),
    }));
    InventoryApi.updateStockTransferStatus(item.id, "Cancel").catch((e) =>
      console.warn("Failed to update status in DB:", e)
    );
  }, []);

  // Handle Download Transfer Order PDF matching legacy ERP
  const handleDownload = useCallback((item: StockTransferItem) => {
    const trfId = item.sr_no || item.id.replace(/\D/g, "") || "52";
    window.open(`/transfer/transfer-order-pdf/${trfId}`, "_blank");
  }, []);

  // Reset all filters
  const handleResetFilters = useCallback(() => {
    setDateRangeFilter("");
    setAppliedDateRange("");
    setFromWhFilter("All");
    setToWhFilter("All");
  }, []);

  // Apply search filters
  const handleSearchFilters = useCallback(() => {
    setAppliedDateRange(dateRangeFilter);
  }, [dateRangeFilter]);

  // Handle Add New Submission
  const handleCreateTransfer = async (e: React.FormEvent) => {
    e.preventDefault();
    if (newFromWh === newToWh) {
      alert("Origin and destination warehouse cannot be the same.");
      return;
    }

    const nextSr = (items[0]?.sr_no || 52) + 1;
    const now = new Date();
    const dateStr =
      now.toLocaleDateString("en-GB").replace(/\//g, "-") +
      " " +
      now.toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit" });

    const totalVal = parseFloat(newAmount) || 0;
    const newRecord: StockTransferItem = {
      id: `trf-${Date.now()}`,
      sr_no: nextSr,
      transfer_no: `TRF-2026-${String(nextSr).padStart(3, "0")}`,
      transfer_date: dateStr,
      from_warehouse: newFromWh,
      to_warehouse: newToWh,
      total_amount: totalVal,
      added_by: "Akshata Wadekar",
      status: "Received",
      remarks: newRemarks,
      items: [
        {
          product_name: "General Inventory Transfer Batch",
          category: "Machines",
          quantity: 1,
          uom: "SET",
          rate: totalVal,
          amount: totalVal,
        },
      ],
    };

    setItems((prev) => [newRecord, ...prev]);
    setTabCounts((prev) => ({
      ...prev,
      all: prev.all + 1,
      received: prev.received + 1,
    }));
    setShowAddModal(false);

    try {
      await InventoryApi.createStockTransfer({
        transfer_date: dateStr,
        from_warehouse: newFromWh,
        to_warehouse: newToWh,
        total_amount: totalVal,
        added_by: "Akshata Wadekar",
        status: "Received",
        remarks: newRemarks,
        items: newRecord.items || [],
      });
    } catch (err) {
      console.warn("Failed to persist transfer to DB:", err);
    }
  };

  // Filtered items
  const filteredItems = useMemo(() => {
    return items.filter((item) => {
      if (activeTab !== "All" && item.status.toLowerCase() !== activeTab.toLowerCase()) {
        return false;
      }
      if (fromWhFilter !== "All" && item.from_warehouse !== fromWhFilter) {
        return false;
      }
      if (toWhFilter !== "All" && item.to_warehouse !== toWhFilter) {
        return false;
      }
      // Applied Date Range filtering
      if (appliedDateRange && appliedDateRange.includes("-")) {
        const [sStr, eStr] = appliedDateRange.split("-").map((s) => s.trim());
        const [sm, sd, sy] = sStr.split("/").map((n) => parseInt(n, 10));
        const [em, ed, ey] = eStr.split("/").map((n) => parseInt(n, 10));
        if (!isNaN(sm) && !isNaN(sd) && !isNaN(sy) && !isNaN(em) && !isNaN(ed) && !isNaN(ey)) {
          const startDate = new Date(sy, sm - 1, sd, 0, 0, 0);
          const endDate = new Date(ey, em - 1, ed, 23, 59, 59);
          const datePart = item.transfer_date.split(" ")[0]; // e.g. "18-09-2026"
          const itemParts = datePart.split("-").map((n) => parseInt(n, 10));
          if (itemParts.length === 3) {
            const itemDate = new Date(itemParts[2], itemParts[1] - 1, itemParts[0], 12, 0, 0);
            if (itemDate < startDate || itemDate > endDate) {
              return false;
            }
          }
        }
      }
      if (searchTerm) {
        const q = searchTerm.toLowerCase();
        const matchNo = item.transfer_no.toLowerCase().includes(q);
        const matchFrom = item.from_warehouse.toLowerCase().includes(q);
        const matchTo = item.to_warehouse.toLowerCase().includes(q);
        const matchUser = item.added_by.toLowerCase().includes(q);
        const matchDate = item.transfer_date.toLowerCase().includes(q);
        if (!matchNo && !matchFrom && !matchTo && !matchUser && !matchDate) {
          return false;
        }
      }
      return true;
    });
  }, [items, activeTab, fromWhFilter, toWhFilter, appliedDateRange, searchTerm]);

  // Sorted items
  const sortedItems = useMemo(() => {
    const list = [...filteredItems];
    if (sortColIndex === null) return list;

    list.sort((a, b) => {
      let valA: string | number = "";
      let valB: string | number = "";

      switch (sortColIndex) {
        case 1:
          valA = a.sr_no;
          valB = b.sr_no;
          break;
        case 2:
          valA = a.transfer_date.toLowerCase();
          valB = b.transfer_date.toLowerCase();
          break;
        case 3:
          valA = a.from_warehouse.toLowerCase();
          valB = b.from_warehouse.toLowerCase();
          break;
        case 4:
          valA = a.to_warehouse.toLowerCase();
          valB = b.to_warehouse.toLowerCase();
          break;
        case 5:
          valA = a.total_amount;
          valB = b.total_amount;
          break;
        case 6:
          valA = a.added_by.toLowerCase();
          valB = b.added_by.toLowerCase();
          break;
        case 7:
          valA = a.status.toLowerCase();
          valB = b.status.toLowerCase();
          break;
        default:
          return 0;
      }

      if (valA < valB) return sortDirection === "asc" ? -1 : 1;
      if (valA > valB) return sortDirection === "asc" ? 1 : -1;
      return 0;
    });
    return list;
  }, [filteredItems, sortColIndex, sortDirection]);

  // Reset to page 1 on filter, search, sort or perPage change
  useEffect(() => {
    setCurrentPage(1);
  }, [searchTerm, activeTab, fromWhFilter, toWhFilter, appliedDateRange, perPage, sortColIndex, sortDirection]);

  // Pagination calculation
  const totalPages = Math.max(1, Math.ceil(sortedItems.length / perPage));
  const paginatedItems = useMemo(() => {
    const start = (currentPage - 1) * perPage;
    return sortedItems.slice(start, start + perPage);
  }, [sortedItems, currentPage, perPage]);

  const isAllSelected =
    paginatedItems.length > 0 &&
    paginatedItems.every((item) => selectedIds.includes(item.id));

  const handleToggleSelectAll = (checked: boolean) => {
    if (checked) {
      const pageIds = paginatedItems.map((item) => item.id);
      setSelectedIds((prev) => Array.from(new Set([...prev, ...pageIds])));
    } else {
      const pageIds = new Set(paginatedItems.map((item) => item.id));
      setSelectedIds((prev) => prev.filter((id) => !pageIds.has(id)));
    }
  };

  const paginationMeta: PaginationMeta = useMemo(() => ({
    current_page: currentPage,
    total_pages: totalPages,
    total_records: sortedItems.length,
    page_size: perPage,
    has_previous: currentPage > 1,
    has_next: currentPage < totalPages,
  }), [currentPage, totalPages, sortedItems.length, perPage]);

  return (
    <AppShell activeKey="stock-transfer" pageClassName="page-stock-transfer">
      <main className="page">
        {/* Breadcrumb Trail */}
        <Breadcrumb trail={["Inventory", "Stock Transfer"]} />

        {/* Top Header */}
        <div className="page-header" style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: "12px", marginBottom: "8px" }}>
          <div style={{ flex: 1, minWidth: 0 }}>
            <h1>Stock Transfer</h1>
            <div className="page-subtitle">
              Manage inter-warehouse stock movements, in-transit shipments, and receipts.
            </div>
          </div>

          <div className="page-header-actions" style={{ display: "flex", gap: "10px", alignItems: "center", flexShrink: 0 }}>
            {/* Filter Toggle Button */}
            <button
              type="button"
              className={`btn transfer-btn-filter ${showFilterPanel ? "active" : ""}`}
              style={{
                background: showFilterPanel ? "#0061f2" : "#475569",
                color: "#ffffff",
                padding: "8px 14px",
                borderRadius: "6px",
                border: "none",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                cursor: "pointer",
                boxShadow: "0 2px 4px rgba(0,0,0,0.1)",
              }}
              onClick={() => setShowFilterPanel((prev) => !prev)}
              title="Filter stock transfers"
              aria-label="Filter"
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <polygon points="22 3 2 3 10 12.46 10 19 14 21 14 12.46 22 3" />
              </svg>
            </button>

            {/* + ADD NEW Button */}
            <button
              type="button"
              className="btn btn-add-new transfer-btn-add"
              style={{
                background: "#0284c7",
                color: "#ffffff",
                padding: "8px 18px",
                borderRadius: "6px",
                fontWeight: 700,
                fontSize: "13.5px",
                border: "none",
                cursor: "pointer",
                boxShadow: "0 2px 4px rgba(2, 132, 199, 0.25)",
              }}
              onClick={() => navigate("/transfer/addEdit")}
            >
              + ADD NEW
            </button>

            {/* Imp / Exp Dropdown Button */}
            <button
              type="button"
              className="btn btn-warning"
              style={{
                background: "#f59e0b",
                color: "#ffffff",
                padding: "8px 16px",
                borderRadius: "6px",
                fontWeight: 700,
                fontSize: "13px",
                border: "none",
                cursor: "pointer",
                display: "inline-flex",
                alignItems: "center",
                gap: "6px",
                boxShadow: "0 2px 4px rgba(245, 158, 11, 0.25)",
              }}
              onClick={handleExportAllCsv}
            >
              Imp / Exp ▾
            </button>

            {/* Bulk Actions Dropdown */}
            <div ref={bulkMenuRef} style={{ position: "relative", display: "inline-block" }}>
              <button
                type="button"
                className="btn btn-success"
                style={{
                  background: "#10b981",
                  color: "#ffffff",
                  padding: "8px 16px",
                  borderRadius: "6px",
                  fontWeight: 700,
                  fontSize: "13px",
                  border: "none",
                  cursor: "pointer",
                  display: "inline-flex",
                  alignItems: "center",
                  gap: "6px",
                  boxShadow: "0 2px 4px rgba(16, 185, 129, 0.25)",
                }}
                onClick={() => setBulkMenuOpen((v) => !v)}
              >
                Bulk Actions {selectedIds.length > 0 ? `(${selectedIds.length})` : ""} ▾
              </button>
              {bulkMenuOpen && (
                <div
                  style={{
                    position: "absolute",
                    top: "100%",
                    right: 0,
                    marginTop: "4px",
                    background: "#ffffff",
                    borderRadius: "6px",
                    boxShadow: "0 10px 25px rgba(0,0,0,0.15)",
                    border: "1px solid #e2e8f0",
                    zIndex: 1000,
                    minWidth: "190px",
                    overflow: "hidden",
                  }}
                >
                  {selectedIds.length === 0 ? (
                    <div style={{ padding: "10px 14px", fontSize: "12.5px", color: "#64748b", fontStyle: "italic" }}>
                      Select 1 or more items from list first
                    </div>
                  ) : (
                    <>
                      <button
                        type="button"
                        onClick={handleBulkCancel}
                        style={{
                          width: "100%",
                          textAlign: "left",
                          padding: "10px 14px",
                          fontSize: "13px",
                          color: "#dc2626",
                          fontWeight: 600,
                          background: "none",
                          border: "none",
                          cursor: "pointer",
                          display: "flex",
                          alignItems: "center",
                          gap: "8px",
                        }}
                      >
                        ✕ Bulk Cancel ({selectedIds.length})
                      </button>
                      <button
                        type="button"
                        onClick={handleBulkExport}
                        style={{
                          width: "100%",
                          textAlign: "left",
                          padding: "10px 14px",
                          fontSize: "13px",
                          color: "#0284c7",
                          fontWeight: 600,
                          background: "none",
                          border: "none",
                          borderTop: "1px solid #f1f5f9",
                          cursor: "pointer",
                          display: "flex",
                          alignItems: "center",
                          gap: "8px",
                        }}
                      >
                        📥 Export Selected ({selectedIds.length})
                      </button>
                    </>
                  )}
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Collapsible Filter Panel */}
        {showFilterPanel && (
          <div
            className="filter-panel-card transfer-filter-panel"
            data-testid="transfer-filter-panel"
            style={{
              background: "#ffffff",
              padding: "20px 24px",
              borderRadius: "8px",
              border: "1px solid #e2e8f0",
              marginBottom: "16px",
              boxShadow: "0 1px 3px rgba(0, 0, 0, 0.04)",
            }}
          >
            <div
              style={{
                display: "grid",
                gridTemplateColumns: "repeat(auto-fit, minmax(240px, 1fr))",
                gap: "18px 24px",
              }}
            >
              <div className="transfer-filter-field">
                <label htmlFor="filter-transfer-date" style={{ display: "block", fontSize: "13px", fontWeight: 600, color: "#334155", marginBottom: "6px" }}>
                  Transfer Date
                </label>
                <DateRangePicker
                  id="filter-transfer-date"
                  className="transfer-filter-input"
                  value={dateRangeFilter}
                  onChange={(val) => setDateRangeFilter(val)}
                  onApply={(val) => {
                    setDateRangeFilter(val);
                    setAppliedDateRange(val);
                  }}
                  placeholder=""
                />
              </div>

              <div className="transfer-filter-field">
                <label htmlFor="filter-from-warehouse" style={{ display: "block", fontSize: "13px", fontWeight: 600, color: "#334155", marginBottom: "6px" }}>
                  From Warehouse
                </label>
                <select
                  id="filter-from-warehouse"
                  value={fromWhFilter}
                  onChange={(e) => setFromWhFilter(e.target.value)}
                  style={{ width: "100%", height: "38px", borderRadius: "5px", border: "1px solid #cbd5e1", padding: "0 10px", fontSize: "13.5px" }}
                >
                  <option value="All">All</option>
                  <option value="Ahmedabad">Ahmedabad</option>
                  <option value="Mumbai">Mumbai</option>
                  <option value="Indore">Indore</option>
                </select>
              </div>

              <div className="transfer-filter-field">
                <label htmlFor="filter-to-warehouse" style={{ display: "block", fontSize: "13px", fontWeight: 600, color: "#334155", marginBottom: "6px" }}>
                  To Warehouse
                </label>
                <select
                  id="filter-to-warehouse"
                  value={toWhFilter}
                  onChange={(e) => setToWhFilter(e.target.value)}
                  style={{ width: "100%", height: "38px", borderRadius: "5px", border: "1px solid #cbd5e1", padding: "0 10px", fontSize: "13.5px" }}
                >
                  <option value="All">All</option>
                  <option value="Ahmedabad">Ahmedabad</option>
                  <option value="Mumbai">Mumbai</option>
                  <option value="Indore">Indore</option>
                </select>
              </div>
            </div>

            <div className="transfer-filter-actions" style={{ display: "flex", justifyContent: "flex-end", gap: "10px", marginTop: "16px" }}>
              <button
                type="button"
                className="transfer-btn-reset"
                onClick={handleResetFilters}
                style={{
                  background: "#5c6f84",
                  color: "#ffffff",
                  border: "none",
                  borderRadius: "5px",
                  padding: "8px 24px",
                  fontWeight: 600,
                  fontSize: "13.5px",
                  cursor: "pointer",
                }}
              >
                Reset
              </button>
              <button
                type="button"
                className="transfer-btn-search"
                onClick={handleSearchFilters}
                style={{
                  background: "#f59e0b",
                  color: "#1e293b",
                  border: "none",
                  borderRadius: "5px",
                  padding: "8px 24px",
                  fontWeight: 600,
                  fontSize: "13.5px",
                  cursor: "pointer",
                }}
              >
                Search
              </button>
            </div>
          </div>
        )}

        {/* Main Data Card */}
        <div className="card" style={{ background: "#ffffff", border: "1px solid #e2e8f0", borderRadius: "8px", boxShadow: "0 1px 3px rgba(0,0,0,0.04)" }}>
          {/* Status Tabs with blue underline indicator */}
          <div
            className="transfer-tabs-card"
            data-testid="transfer-status-tabs"
            style={{
              display: "flex",
              gap: "20px",
              borderBottom: "1px solid #e2e8f0",
              padding: "6px 16px 0",
              background: "transparent",
              borderTop: "none",
              borderLeft: "none",
              borderRight: "none",
              borderRadius: 0,
              boxShadow: "none",
              marginBottom: 0,
            }}
          >
            <button
              type="button"
              data-testid="tab-All"
              className={`transfer-tab-btn ${activeTab === "All" ? "active" : ""}`}
              style={{
                background: "none",
                border: "none",
                borderBottom: activeTab === "All" ? "2.5px solid #0061f2" : "2.5px solid transparent",
                color: activeTab === "All" ? "#0061f2" : "#64748b",
                fontWeight: 700,
                fontSize: "13.5px",
                paddingBottom: "8px",
                cursor: "pointer",
              }}
              onClick={() => setActiveTab("All")}
            >
              All ({tabCounts.all})
            </button>
            <button
              type="button"
              data-testid="tab-Pending"
              className={`transfer-tab-btn ${activeTab === "Pending" ? "active" : ""}`}
              style={{
                background: "none",
                border: "none",
                borderBottom: activeTab === "Pending" ? "2.5px solid #0061f2" : "2.5px solid transparent",
                color: activeTab === "Pending" ? "#0061f2" : "#64748b",
                fontWeight: 700,
                fontSize: "13.5px",
                paddingBottom: "8px",
                cursor: "pointer",
              }}
              onClick={() => setActiveTab("Pending")}
            >
              Pending ({tabCounts.pending})
            </button>
            <button
              type="button"
              data-testid="tab-Confirmed"
              className={`transfer-tab-btn ${activeTab === "Confirmed" ? "active" : ""}`}
              style={{
                background: "none",
                border: "none",
                borderBottom: activeTab === "Confirmed" ? "2.5px solid #0061f2" : "2.5px solid transparent",
                color: activeTab === "Confirmed" ? "#0061f2" : "#64748b",
                fontWeight: 700,
                fontSize: "13.5px",
                paddingBottom: "8px",
                cursor: "pointer",
              }}
              onClick={() => setActiveTab("Confirmed")}
            >
              Confirmed ({tabCounts.confirmed})
            </button>
            <button
              type="button"
              data-testid="tab-Received"
              className={`transfer-tab-btn ${activeTab === "Received" ? "active" : ""}`}
              style={{
                background: "none",
                border: "none",
                borderBottom: activeTab === "Received" ? "2.5px solid #0061f2" : "2.5px solid transparent",
                color: activeTab === "Received" ? "#0061f2" : "#64748b",
                fontWeight: 700,
                fontSize: "13.5px",
                paddingBottom: "8px",
                cursor: "pointer",
              }}
              onClick={() => setActiveTab("Received")}
            >
              Received ({tabCounts.received})
            </button>
            <button
              type="button"
              data-testid="tab-Cancel"
              className={`transfer-tab-btn ${activeTab === "Cancel" ? "active" : ""}`}
              style={{
                background: "none",
                border: "none",
                borderBottom: activeTab === "Cancel" ? "2.5px solid #0061f2" : "2.5px solid transparent",
                color: activeTab === "Cancel" ? "#0061f2" : "#64748b",
                fontWeight: 700,
                fontSize: "13.5px",
                paddingBottom: "8px",
                cursor: "pointer",
              }}
              onClick={() => setActiveTab("Cancel")}
            >
              Cancel ({tabCounts.cancel})
            </button>
          </div>

          {/* Control Bar: Items per page, Freeze Columns button, and Search */}
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "12px 16px", borderBottom: "1px solid #f1f5f9" }}>
            <div style={{ display: "flex", alignItems: "center", gap: "12px" }}>
              <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
                <select
                  className="transfer-per-page-select"
                  value={perPage}
                  onChange={(e) => setPerPage(Number(e.target.value))}
                  aria-label="Items per page"
                  style={{ padding: "6px 12px", borderRadius: "6px", border: "1px solid #cbd5e1", fontSize: "13px" }}
                >
                  <option value={10}>10</option>
                  <option value={25}>25</option>
                  <option value={50}>50</option>
                  <option value={100}>100</option>
                </select>
                <span style={{ fontSize: "13px", color: "#64748b", fontWeight: 500 }}>Items/Page</span>
              </div>

              {/* Dynamic Freeze Columns Dropdown Menu */}
              <div ref={pinMenuRef} style={{ position: "relative" }}>
                <button
                  type="button"
                  onClick={() => setPinMenuOpen((v) => !v)}
                  style={{
                    padding: "6px 12px",
                    borderRadius: "6px",
                    border: "1px solid #cbd5e1",
                    fontSize: "13px",
                    background: pinMenuOpen ? "#e2e8f0" : "#ffffff",
                    cursor: "pointer",
                    color: "#0f172a",
                    fontWeight: 600,
                    display: "flex",
                    alignItems: "center",
                    gap: "6px",
                  }}
                >
                  📌 Freeze Columns ({Object.keys(pinnedCols).length})
                </button>
                {pinMenuOpen && (
                  <div
                    style={{
                      position: "absolute",
                      left: 0,
                      top: "38px",
                      zIndex: 100,
                      background: "#ffffff",
                      border: "1px solid #cbd5e1",
                      borderRadius: "8px",
                      boxShadow: "0 8px 24px rgba(0,0,0,0.15)",
                      padding: "12px",
                      minWidth: "240px",
                      display: "flex",
                      flexDirection: "column",
                    }}
                  >
                    <div
                      style={{
                        fontSize: "12px",
                        fontWeight: 700,
                        color: "#475569",
                        marginBottom: "8px",
                        borderBottom: "1px solid #f1f5f9",
                        paddingBottom: "6px",
                      }}
                    >
                      Toggle Frozen Columns
                    </div>
                    <div style={{ maxHeight: "200px", overflowY: "auto", paddingRight: "4px" }}>
                      {TRANSFER_COLUMN_LABELS.map((label, idx) => {
                        if (!label) return null;
                        const isPinned = Boolean(pinnedCols[idx]);
                        return (
                          <label
                            key={label}
                            style={{
                              display: "flex",
                              alignItems: "center",
                              gap: "8px",
                              fontSize: "13px",
                              cursor: "pointer",
                              padding: "4px 0",
                            }}
                          >
                            <input
                              type="checkbox"
                              checked={isPinned}
                              onChange={() => togglePin(idx)}
                            />{" "}
                            {label}
                          </label>
                        );
                      })}
                    </div>
                    <div style={{ borderTop: "1px solid #f1f5f9", marginTop: "8px", paddingTop: "8px" }}>
                      <button
                        type="button"
                        onClick={() => setPinnedCols({})}
                        style={{
                          width: "100%",
                          padding: "6px 8px",
                          fontSize: "12px",
                          borderRadius: "4px",
                          border: "1px solid #e2e8f0",
                          background: "#f8fafc",
                          cursor: "pointer",
                          color: "#dc2626",
                          fontWeight: 600,
                        }}
                      >
                        Clear All Freezes
                      </button>
                    </div>
                  </div>
                )}
              </div>
            </div>

            <div className="transfer-search-wrap" style={{ position: "relative", display: "inline-flex", alignItems: "center" }}>
              <input
                type="text"
                className="transfer-search-input"
                placeholder="Search..."
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                style={{ width: "320px", padding: "8px 36px 8px 14px", borderRadius: "6px", border: "1px solid #cbd5e1" }}
              />
              {searchTerm && (
                <button
                  type="button"
                  onClick={() => setSearchTerm("")}
                  style={{
                    position: "absolute",
                    right: "8px",
                    background: "none",
                    border: "none",
                    cursor: "pointer",
                    color: "#94a3b8",
                    fontSize: "16px",
                  }}
                >
                  ×
                </button>
              )}
            </div>
          </div>

          {/* Table Container */}
          <div className="table-scroll transfer-table-wrap" style={{ maxHeight: "calc(100vh - 220px)", overflowY: "auto", overflowX: "auto" }}>
            <table ref={tableRef} className="transfer-table" style={{ borderCollapse: "separate", borderSpacing: 0, width: "100%" }}>
              <thead>
                <tr>
                  {displayOrder.map((idx) => {
                    if (idx === 0) {
                      return (
                        <th
                          key="col-0"
                          style={{
                            width: "40px",
                            minWidth: "40px",
                            maxWidth: "45px",
                            textAlign: "center",
                            ...getFreezeStyle(0, true),
                          }}
                        >
                          <input
                            type="checkbox"
                            checked={isAllSelected}
                            onChange={(e) => handleToggleSelectAll(e.target.checked)}
                            style={{ cursor: "pointer", width: "16px", height: "16px" }}
                            aria-label="Select All"
                          />
                        </th>
                      );
                    }

                    const label = TRANSFER_COLUMN_LABELS[idx];
                    const isPinned = Boolean(pinnedCols[idx]);
                    const isSrNo = idx === 1;
                    const isTotal = idx === 5;
                    const isAction = idx === 8;
                    const isSorted = sortColIndex === idx;

                    return (
                      <th
                        key={`col-${idx}-${label}`}
                        style={{
                          ...(isSrNo ? { width: "92px", minWidth: "92px", maxWidth: "100px", textAlign: "center" } : isAction ? { width: "70px", minWidth: "70px", textAlign: "center" } : isTotal ? { textAlign: "right" } : {}),
                          ...getFreezeStyle(idx, true),
                        }}
                      >
                        <div
                          style={{
                            display: "flex",
                            alignItems: "center",
                            justifyContent: isAction ? "center" : isSrNo ? "center" : isTotal ? "flex-end" : "space-between",
                            gap: "4px",
                          }}
                        >
                          {isAction ? (
                            <span>{label}</span>
                          ) : (
                            <div
                              onClick={() => handleHeaderSort(idx)}
                              style={{
                                display: "inline-flex",
                                alignItems: "center",
                                justifyContent: isSrNo ? "center" : isTotal ? "flex-end" : "flex-start",
                                gap: "5px",
                                cursor: "pointer",
                                userSelect: "none",
                                flex: isSrNo ? undefined : 1,
                                minWidth: 0,
                                padding: "2px 0",
                              }}
                              title={
                                isSorted
                                  ? `Sorted by ${label} (${sortDirection === "asc" ? "Ascending — click for Descending" : "Descending — click to reset"})`
                                  : `Click to sort by ${label} (Ascending)`
                              }
                            >
                              <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                                {label}
                              </span>
                              {isSorted ? (
                                <span
                                  style={{
                                    display: "inline-flex",
                                    alignItems: "center",
                                    color: "#0061f2",
                                    fontSize: "10px",
                                    fontWeight: 800,
                                    background: "#e0f2fe",
                                    padding: "1px 4px",
                                    borderRadius: "3px",
                                    border: "1px solid #bae6fd",
                                    lineHeight: 1,
                                    flexShrink: 0,
                                  }}
                                >
                                  {sortDirection === "asc" ? "▲" : "▼"}
                                </span>
                              ) : (
                                <span
                                  style={{
                                    fontSize: "10px",
                                    color: "#94a3b8",
                                    opacity: 0.45,
                                    lineHeight: 1,
                                    flexShrink: 0,
                                  }}
                                >
                                  ↕
                                </span>
                              )}
                            </div>
                          )}
                          {!isAction && (
                            <button
                              type="button"
                              onClick={(e) => {
                                e.stopPropagation();
                                togglePin(idx);
                              }}
                              style={{
                                background: "none",
                                border: "none",
                                cursor: "pointer",
                                fontSize: "11px",
                                opacity: isPinned ? 1 : 0.3,
                                padding: "0 2px",
                                flexShrink: 0,
                              }}
                              title={isPinned ? "Unfreeze column" : "Freeze column"}
                            >
                              📌
                            </button>
                          )}
                        </div>
                      </th>
                    );
                  })}
                </tr>
              </thead>
              <tbody>
                {loading ? (
                  <StockTransferSkeletonRows
                    count={perPage > 10 ? 10 : perPage}
                    displayOrder={displayOrder}
                    getFreezeStyle={getFreezeStyle}
                  />
                ) : paginatedItems.length === 0 ? (
                  <tr>
                    <td colSpan={displayOrder.length} style={{ textAlign: "center", padding: "36px", color: "#64748b" }}>
                      No stock transfers found.
                    </td>
                  </tr>
                ) : (
                  paginatedItems.map((item) => (
                    <tr
                      key={item.id}
                      style={{ cursor: "pointer", transition: "background-color 0.15s ease" }}
                      onClick={() => setActiveItem(item)}
                      onMouseEnter={(e) => (e.currentTarget.style.backgroundColor = "#f0f7ff")}
                      onMouseLeave={(e) => (e.currentTarget.style.backgroundColor = "transparent")}
                    >
                      {displayOrder.map((colIdx) => {
                        switch (colIdx) {
                          case 0:
                            return (
                              <td
                                key="cell-0"
                                style={{ width: "40px", minWidth: "40px", maxWidth: "45px", textAlign: "center", ...getFreezeStyle(0, false) }}
                                onClick={(e) => e.stopPropagation()}
                              >
                                <input
                                  type="checkbox"
                                  checked={selectedIds.includes(item.id)}
                                  onChange={(e) => handleToggleRow(item.id, e.target.checked)}
                                  style={{ cursor: "pointer", width: "16px", height: "16px" }}
                                />
                              </td>
                            );
                          case 1:
                            return (
                              <td
                                key="cell-1"
                                className="cell-srno"
                                style={{
                                  width: "92px",
                                  minWidth: "92px",
                                  maxWidth: "100px",
                                  textAlign: "center",
                                  color: "#64748b",
                                  fontWeight: 500,
                                  ...getFreezeStyle(1, false),
                                }}
                              >
                                {item.sr_no}
                              </td>
                            );
                          case 2:
                            return (
                              <td key="cell-2" style={{ minWidth: "160px", ...getFreezeStyle(2, false) }}>
                                <a
                                  href="#view"
                                  className="transfer-date-link"
                                  onClick={(e) => {
                                    e.preventDefault();
                                    e.stopPropagation();
                                    setActiveItem(item);
                                  }}
                                  style={{ color: "#0061f2", fontWeight: 600, textDecoration: "none" }}
                                >
                                  {item.transfer_date}
                                </a>
                              </td>
                            );
                          case 3:
                            return (
                              <td key="cell-3" style={{ color: "#334155", minWidth: "130px", ...getFreezeStyle(3, false) }}>
                                {item.from_warehouse}
                              </td>
                            );
                          case 4:
                            return (
                              <td key="cell-4" style={{ color: "#334155", minWidth: "130px", ...getFreezeStyle(4, false) }}>
                                {item.to_warehouse}
                              </td>
                            );
                          case 5:
                            return (
                              <td
                                key="cell-5"
                                style={{
                                  textAlign: "right",
                                  fontWeight: 600,
                                  color: "#0f172a",
                                  paddingRight: "16px",
                                  minWidth: "120px",
                                  ...getFreezeStyle(5, false),
                                }}
                              >
                                {formatIndianCurrency(item.total_amount)}
                              </td>
                            );
                          case 6:
                            return (
                              <td key="cell-6" style={{ color: "#334155", minWidth: "130px", ...getFreezeStyle(6, false) }}>
                                {item.added_by}
                              </td>
                            );
                          case 7:
                            return (
                              <td key="cell-7" style={{ minWidth: "110px", ...getFreezeStyle(7, false) }}>
                                <span className={`badge-status ${item.status.toLowerCase()}`}>
                                  {item.status}
                                </span>
                              </td>
                            );
                          case 8:
                            return (
                              <td
                                key="cell-8"
                                className="transfer-action-cell"
                                style={{ width: "70px", minWidth: "70px", textAlign: "center", ...getFreezeStyle(8, false) }}
                                onClick={(e) => e.stopPropagation()}
                              >
                                <button
                                  type="button"
                                  className={`transfer-action-btn ${openActionMenuId === item.id ? "active" : ""}`}
                                  title="Actions"
                                  aria-label="Actions"
                                  aria-expanded={openActionMenuId === item.id}
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    setOpenActionMenuId((prev) => (prev === item.id ? null : item.id));
                                  }}
                                >
                                  ⋮
                                </button>

                                {openActionMenuId === item.id && (
                                  <div className="transfer-action-menu" data-testid="action-popup-menu">
                                    <button
                                      type="button"
                                      className="transfer-action-item"
                                      onClick={(e) => {
                                        e.stopPropagation();
                                        setActiveItem(item);
                                        setOpenActionMenuId(null);
                                      }}
                                    >
                                      <span>👁️</span>
                                      <span>View</span>
                                    </button>
                                    {item.status !== "Cancel" && (
                                      <button
                                        type="button"
                                        className="transfer-action-item"
                                        onClick={(e) => {
                                          e.stopPropagation();
                                          handleCancelTransfer(item);
                                          setOpenActionMenuId(null);
                                        }}
                                      >
                                        <span>✕</span>
                                        <span>Cancel</span>
                                      </button>
                                    )}
                                    <button
                                      type="button"
                                      className="transfer-action-item"
                                      onClick={(e) => {
                                        e.stopPropagation();
                                        handleDownload(item);
                                        setOpenActionMenuId(null);
                                      }}
                                    >
                                      <span>📥</span>
                                      <span>Download</span>
                                    </button>
                                  </div>
                                )}
                              </td>
                            );
                          default:
                            return null;
                        }
                      })}
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>

          <div style={{ padding: "0 16px 14px", borderTop: "1px solid #e2e8f0", background: "#ffffff" }}>
            <Pagination
              pagination={paginationMeta}
              pageSize={perPage}
              onPageChange={setCurrentPage}
              onPageSizeChange={(s) => {
                setPerPage(s);
                setCurrentPage(1);
              }}
            />
          </div>
        </div>

        {/* SideDrawer for Details */}
        <SideDrawer
          open={Boolean(activeItem)}
          onClose={() => setActiveItem(null)}
          title="Stock Transfer Details"
          subtitle={activeItem ? `${activeItem.transfer_no} • ${activeItem.from_warehouse} → ${activeItem.to_warehouse}` : ""}
          maxWidth="min(1000px, 96vw)"
        >
          {activeItem && (
            <div>
              <DetailFieldGrid
                fields={[
                  { label: "Transfer No.", value: activeItem.transfer_no },
                  { label: "Transfer Date", value: activeItem.transfer_date },
                  { label: "From Warehouse", value: activeItem.from_warehouse },
                  { label: "To Warehouse", value: activeItem.to_warehouse },
                  { label: "Total Amount", value: formatIndianCurrency(activeItem.total_amount) },
                  { label: "Added By", value: activeItem.added_by },
                  { label: "Status", value: activeItem.status },
                  { label: "Remarks", value: activeItem.remarks || "—" },
                ]}
              />

              <div style={{ marginTop: "24px" }}>
                <h3 style={{ fontSize: "15px", fontWeight: 700, color: "#0f172a", marginBottom: "12px" }}>
                  Transferred Line Items Breakdown
                </h3>
                <div style={{ overflowX: "auto", border: "1px solid #e2e8f0", borderRadius: "6px" }}>
                  <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "13px" }}>
                    <thead>
                      <tr style={{ backgroundColor: "#f8fafc", borderBottom: "1px solid #e2e8f0" }}>
                        <th style={{ padding: "10px 14px", textAlign: "left", color: "#475569" }}>Sr No.</th>
                        <th style={{ padding: "10px 14px", textAlign: "left", color: "#475569" }}>Product Name</th>
                        <th style={{ padding: "10px 14px", textAlign: "left", color: "#475569" }}>Code</th>
                        <th style={{ padding: "10px 14px", textAlign: "left", color: "#475569" }}>Category</th>
                        <th style={{ padding: "10px 14px", textAlign: "right", color: "#475569" }}>Quantity</th>
                        <th style={{ padding: "10px 14px", textAlign: "right", color: "#475569" }}>Rate</th>
                        <th style={{ padding: "10px 14px", textAlign: "right", color: "#475569" }}>Total Amount</th>
                      </tr>
                    </thead>
                    <tbody>
                      {activeItem.items && activeItem.items.length > 0 ? (
                        activeItem.items.map((it, idx) => (
                          <tr key={idx} style={{ borderBottom: "1px solid #f1f5f9" }}>
                            <td style={{ padding: "10px 14px" }}>{idx + 1}</td>
                            <td style={{ padding: "10px 14px", fontWeight: 600 }}>{it.product_name}</td>
                            <td style={{ padding: "10px 14px", color: "#64748b" }}>{it.product_code || "-"}</td>
                            <td style={{ padding: "10px 14px" }}>{it.category || "Machines"}</td>
                            <td style={{ padding: "10px 14px", textAlign: "right" }}>{it.quantity} {it.uom}</td>
                            <td style={{ padding: "10px 14px", textAlign: "right" }}>{formatIndianCurrency(it.rate)}</td>
                            <td style={{ padding: "10px 14px", textAlign: "right", fontWeight: 600 }}>{formatIndianCurrency(it.amount)}</td>
                          </tr>
                        ))
                      ) : (
                        <tr>
                          <td colSpan={7} style={{ padding: "16px", textAlign: "center", color: "#64748b" }}>
                            No individual line item details specified.
                          </td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>
          )}
        </SideDrawer>

        {/* Add New Modal */}
        {showAddModal && (
          <div
            style={{
              position: "fixed",
              top: 0,
              left: 0,
              right: 0,
              bottom: 0,
              backgroundColor: "rgba(15, 23, 42, 0.5)",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              zIndex: 1000,
              padding: "20px",
            }}
            onClick={() => setShowAddModal(false)}
          >
            <div
              style={{
                backgroundColor: "#ffffff",
                borderRadius: "8px",
                width: "100%",
                maxWidth: "520px",
                padding: "24px",
                boxShadow: "0 20px 25px -5px rgba(0, 0, 0, 0.1)",
              }}
              onClick={(e) => e.stopPropagation()}
            >
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "16px" }}>
                <h3 style={{ margin: 0, fontSize: "17px", fontWeight: 700, color: "#1e293b" }}>
                  Record New Stock Transfer
                </h3>
                <button
                  type="button"
                  style={{ background: "none", border: "none", fontSize: "20px", cursor: "pointer", color: "#94a3b8" }}
                  onClick={() => setShowAddModal(false)}
                >
                  ✕
                </button>
              </div>

              <form onSubmit={handleCreateTransfer}>
                <div style={{ display: "flex", flexDirection: "column", gap: "14px" }}>
                  <div>
                    <label style={{ display: "block", fontSize: "12.5px", fontWeight: 600, color: "#475569", marginBottom: "6px" }}>
                      From Warehouse *
                    </label>
                    <select
                      value={newFromWh}
                      onChange={(e) => setNewFromWh(e.target.value)}
                      style={{ width: "100%", padding: "8px 12px", border: "1px solid #cbd5e1", borderRadius: "6px", fontSize: "13px" }}
                    >
                      <option value="Ahmedabad">Ahmedabad</option>
                      <option value="Mumbai">Mumbai</option>
                      <option value="Indore">Indore</option>
                    </select>
                  </div>

                  <div>
                    <label style={{ display: "block", fontSize: "12.5px", fontWeight: 600, color: "#475569", marginBottom: "6px" }}>
                      To Warehouse *
                    </label>
                    <select
                      value={newToWh}
                      onChange={(e) => setNewToWh(e.target.value)}
                      style={{ width: "100%", padding: "8px 12px", border: "1px solid #cbd5e1", borderRadius: "6px", fontSize: "13px" }}
                    >
                      <option value="Mumbai">Mumbai</option>
                      <option value="Ahmedabad">Ahmedabad</option>
                      <option value="Indore">Indore</option>
                    </select>
                  </div>

                  <div>
                    <label style={{ display: "block", fontSize: "12.5px", fontWeight: 600, color: "#475569", marginBottom: "6px" }}>
                      Total Amount (₹) *
                    </label>
                    <input
                      type="number"
                      step="0.01"
                      required
                      placeholder="e.g. 150000"
                      value={newAmount}
                      onChange={(e) => setNewAmount(e.target.value)}
                      style={{ width: "100%", padding: "8px 12px", border: "1px solid #cbd5e1", borderRadius: "6px", fontSize: "13px" }}
                    />
                  </div>

                  <div>
                    <label style={{ display: "block", fontSize: "12.5px", fontWeight: 600, color: "#475569", marginBottom: "6px" }}>
                      Remarks
                    </label>
                    <textarea
                      rows={3}
                      placeholder="Transfer reasons, truck number, consignment notes..."
                      value={newRemarks}
                      onChange={(e) => setNewRemarks(e.target.value)}
                      style={{ width: "100%", padding: "8px 12px", border: "1px solid #cbd5e1", borderRadius: "6px", fontSize: "13px" }}
                    />
                  </div>
                </div>

                <div style={{ display: "flex", justifyContent: "flex-end", gap: "10px", marginTop: "20px" }}>
                  <button
                    type="button"
                    style={{ padding: "8px 16px", border: "1px solid #cbd5e1", borderRadius: "6px", background: "#ffffff", color: "#475569", fontWeight: 600, cursor: "pointer" }}
                    onClick={() => setShowAddModal(false)}
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    style={{ padding: "8px 18px", border: "none", borderRadius: "6px", background: "#0284c7", color: "#ffffff", fontWeight: 700, cursor: "pointer" }}
                  >
                    Save Transfer
                  </button>
                </div>
              </form>
            </div>
          </div>
        )}
      </main>
    </AppShell>
  );
}
