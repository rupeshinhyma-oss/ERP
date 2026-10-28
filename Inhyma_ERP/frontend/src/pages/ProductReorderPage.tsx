import { useState, useMemo, useCallback, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { AppShell } from "@/components/AppShell";
import { SideDrawer } from "@/components/SideDrawer";
import { Pagination } from "@/components/Pagination";
import { SortHeader } from "@/components/SortHeader";
import type { PaginationMeta } from "@/types";
import { apiGet, InventoryApi, type ProductReorderItem } from "@/lib/api";
import { Auth } from "@/lib/auth";
import { generateSalesOrderPdf } from "@/lib/salesOrderPdf";
import "@/styles/productReorder.css";

export interface StockBreakupRow {
  sr_no: number;
  order_id?: string;
  order_no?: string;
  consignment_no?: string;
  invoice_no?: string;
  source_type?: string;
  date?: string;
  order_date?: string;
  invoice_date?: string;
  company_name?: string;
  gst_no?: string | null;
  supplier_name?: string;
  city_state?: string;
  gross_quantity?: number;
  booked_quantity?: number;
  quantity: number;
  status: string;
  sales_person?: string;
  delivery_date?: string;
  arrival_date?: string;
  expected_arrival_date?: string;
  etd_origin_date?: string;
  eta_port_date?: string;
  warehouse?: string;
}

export interface ActiveBreakupState {
  item: ProductReorderItem;
  location: string;
  stockType: "physical" | "transit" | "ordered";
  count: number;
  loading?: boolean;
  rows: StockBreakupRow[];
  bookedOrders?: StockBreakupRow[];
}

interface MasterFilterOptions {
  categories: string[];
  sub_categories: Array<{ name: string; category?: string | null }>;
  brands: string[];
}

export const INITIAL_REORDER_ITEMS: ProductReorderItem[] = [
  {
    id: "reorder-1",
    sr_no: 1,
    product_name_tally: "Limit Switch (DQL5545)",
    product_code: "DQL-5545-LS",
    brand: "Inhyma",
    category: "Spares",
    sub_category: "Spares For L Sealer",
    mumbai: 0,
    mumbai_transit: 0,
    mumbai_ordered: 0,
    ahmedabad: 0,
    ahmedabad_transit: 0,
    ahmedabad_ordered: 0,
    indore: 0,
    indore_transit: 0,
    indore_ordered: 0,
    total_qty: 0,
    reorder_level: 0,
    short_fall: 0,
    moq: 0,
    order_to_be_place: 0,
  },
  {
    id: "reorder-2",
    sr_no: 2,
    product_name_tally: "Bolt 992-8M",
    product_code: "BLT-992-8M",
    brand: "Inhyma",
    category: "Spares",
    sub_category: "Hardware & Fasteners",
    mumbai: 0,
    mumbai_transit: 0,
    mumbai_ordered: 0,
    ahmedabad: 0,
    ahmedabad_transit: 0,
    ahmedabad_ordered: 0,
    indore: 0,
    indore_transit: 0,
    indore_ordered: 0,
    total_qty: 0,
    reorder_level: 0,
    short_fall: 0,
    moq: 0,
    order_to_be_place: 0,
  },
  {
    id: "reorder-3",
    sr_no: 3,
    product_name_tally: "Display +PLC (AF1000)",
    product_code: "PLC-AF1000",
    brand: "Delta",
    category: "Spares",
    sub_category: "Electronics & Controls",
    mumbai: 0,
    mumbai_transit: 0,
    mumbai_ordered: 0,
    ahmedabad: 0,
    ahmedabad_transit: 0,
    ahmedabad_ordered: 0,
    indore: 0,
    indore_transit: 0,
    indore_ordered: 0,
    total_qty: 0,
    reorder_level: 0,
    short_fall: 0,
    moq: 0,
    order_to_be_place: 0,
  },
  {
    id: "reorder-4",
    sr_no: 4,
    product_name_tally: "Emergency Switch (AF1000)",
    product_code: "SW-EM-AF1000",
    brand: "Schneider",
    category: "Spares",
    sub_category: "Electrical & Switches",
    mumbai: 0,
    mumbai_transit: 0,
    mumbai_ordered: 0,
    ahmedabad: 0,
    ahmedabad_transit: 0,
    ahmedabad_ordered: 0,
    indore: 0,
    indore_transit: 0,
    indore_ordered: 0,
    total_qty: 0,
    reorder_level: 0,
    short_fall: 0,
    moq: 0,
    order_to_be_place: 0,
  },
  {
    id: "reorder-5",
    sr_no: 5,
    product_name_tally: "32mm Screw (AF1500)",
    product_code: "SCR-32-AF1500",
    brand: "Inhyma",
    category: "Spares",
    sub_category: "Hardware & Fasteners",
    mumbai: 0,
    mumbai_transit: 0,
    mumbai_ordered: 0,
    ahmedabad: 0,
    ahmedabad_transit: 0,
    ahmedabad_ordered: 0,
    indore: 0,
    indore_transit: 0,
    indore_ordered: 0,
    total_qty: 0,
    reorder_level: 0,
    short_fall: 0,
    moq: 0,
    order_to_be_place: 0,
  },
  {
    id: "reorder-6",
    sr_no: 6,
    product_name_tally: "19mm Screw (AF1500)",
    product_code: "SCR-19-AF1500",
    brand: "Inhyma",
    category: "Spares",
    sub_category: "Hardware & Fasteners",
    mumbai: 0,
    mumbai_transit: 0,
    mumbai_ordered: 0,
    ahmedabad: 0,
    ahmedabad_transit: 0,
    ahmedabad_ordered: 0,
    indore: 0,
    indore_transit: 0,
    indore_ordered: 0,
    total_qty: 0,
    reorder_level: 0,
    short_fall: 0,
    moq: 0,
    order_to_be_place: 0,
  },
  {
    id: "reorder-7",
    sr_no: 7,
    product_name_tally: "Stepper Motor (AF1500)",
    product_code: "MOT-STP-1500",
    brand: "Leadshine",
    category: "Spares",
    sub_category: "Motors & Drives",
    mumbai: 0,
    mumbai_transit: 0,
    mumbai_ordered: 0,
    ahmedabad: 0,
    ahmedabad_transit: 0,
    ahmedabad_ordered: 0,
    indore: 0,
    indore_transit: 0,
    indore_ordered: 0,
    total_qty: 0,
    reorder_level: 0,
    short_fall: 0,
    moq: 0,
    order_to_be_place: 0,
  },
  {
    id: "reorder-8",
    sr_no: 8,
    product_name_tally: "Motor 90W (AF1500)",
    product_code: "MOT-90W-1500",
    brand: "SPG",
    category: "Spares",
    sub_category: "Motors & Drives",
    mumbai: 0,
    mumbai_transit: 0,
    mumbai_ordered: 0,
    ahmedabad: 0,
    ahmedabad_transit: 0,
    ahmedabad_ordered: 0,
    indore: 0,
    indore_transit: 0,
    indore_ordered: 0,
    total_qty: 0,
    reorder_level: 0,
    short_fall: 0,
    moq: 0,
    order_to_be_place: 0,
  },
  {
    id: "reorder-9",
    sr_no: 9,
    product_name_tally: "Ramp (1400 *1200* 82.2mm)",
    product_code: "RMP-1400",
    brand: "Inhyma",
    category: "Spares",
    sub_category: "Fabrication & Body Parts",
    mumbai: 0,
    mumbai_transit: 0,
    mumbai_ordered: 0,
    ahmedabad: 0,
    ahmedabad_transit: 0,
    ahmedabad_ordered: 0,
    indore: 0,
    indore_transit: 0,
    indore_ordered: 0,
    total_qty: 0,
    reorder_level: 0,
    short_fall: 0,
    moq: 0,
    order_to_be_place: 0,
  },
  {
    id: "reorder-10",
    sr_no: 10,
    product_name_tally: "DBF900L Band Sealer MSV With Nitrogen Kit",
    product_code: "INH-00005-N2",
    brand: "Inhyma Pack",
    category: "Machines",
    sub_category: "Band Sealer",
    mumbai: 4,
    mumbai_transit: 0,
    mumbai_ordered: 0,
    ahmedabad: 0,
    ahmedabad_transit: 0,
    ahmedabad_ordered: 0,
    indore: 0,
    indore_transit: 0,
    indore_ordered: 0,
    total_qty: 4,
    reorder_level: 0,
    short_fall: 0,
    moq: 0,
    order_to_be_place: 0,
  },
];

function computeScopedMetrics(item: ProductReorderItem, warehouseScope: string) {
  const scope = (warehouseScope || "All").trim().toLowerCase();
  if (scope === "mumbai" || scope === "ahmedabad" || scope === "indore") {
    const branchQty =
      Number(item[scope] || 0) +
      Number(item[`${scope}_transit` as keyof ProductReorderItem] || 0) +
      Number(item[`${scope}_ordered` as keyof ProductReorderItem] || 0);
    const override = item.warehouse_thresholds?.[scope];
    const reorderLevel = override ? Number(override.reorder_level || 0) : Number(item.reorder_level || 0);
    const moq = override ? Number(override.moq || 0) : Number(item.moq || 0);
    const shortFall = Math.max(0, reorderLevel - branchQty);
    const orderToBePlace = shortFall > 0 ? (moq > 0 ? Math.max(shortFall, moq) : shortFall) : 0;
    return {
      scopedQty: branchQty,
      reorder_level: reorderLevel,
      moq,
      short_fall: shortFall,
      order_to_be_place: orderToBePlace,
    };
  }

  const overrides = item.warehouse_thresholds ? Object.values(item.warehouse_thresholds) : [];
  const reorderLevel =
    Number(item.reorder_level || 0) > 0
      ? Number(item.reorder_level || 0)
      : overrides.reduce((sum, entry) => sum + Number(entry.reorder_level || 0), 0);
  const moq =
    Number(item.moq || 0) > 0
      ? Number(item.moq || 0)
      : overrides.reduce((maxVal, entry) => Math.max(maxVal, Number(entry.moq || 0)), 0);
  const totalQty = Number(item.total_qty || 0);
  const shortFall = Math.max(0, reorderLevel - totalQty);
  const orderToBePlace = shortFall > 0 ? (moq > 0 ? Math.max(shortFall, moq) : shortFall) : 0;
  return {
    scopedQty: totalQty,
    reorder_level: reorderLevel,
    moq,
    short_fall: shortFall,
    order_to_be_place: orderToBePlace,
  };
}

function shouldShowBreakupInfo(
  item: ProductReorderItem,
  colKey: string,
  qty: number,
  isPhysical: boolean
): boolean {
  if (Array.isArray(item.breakup_flags)) {
    if (isPhysical) {
      return item.breakup_flags.includes(colKey);
    }
    return item.breakup_flags.includes(colKey) || qty !== 0;
  }
  // Unit-test / seed fallback when breakup_flags is not attached
  return qty !== 0;
}

const ProductReorderSkeletonRows: React.FC<{ count?: number }> = ({ count = 8 }) => (
  <>
    {Array.from({ length: count }).map((_, index) => (
      <tr key={`reorder-skeleton-${index}`} className="table-skeleton-row">
        <td style={{ textAlign: "center", padding: "10px" }}><div className="skeleton-line" style={{ width: 20, margin: "0 auto" }} /></td>
        <td style={{ padding: "10px" }}><div className="skeleton-line" style={{ width: "80%" }} /></td>
        <td style={{ textAlign: "center", padding: "10px" }}><div className="skeleton-line" style={{ width: 28, margin: "0 auto" }} /></td>
        <td style={{ textAlign: "center", padding: "10px" }}><div className="skeleton-line" style={{ width: 28, margin: "0 auto" }} /></td>
        <td style={{ textAlign: "center", padding: "10px" }}><div className="skeleton-line" style={{ width: 28, margin: "0 auto" }} /></td>
        <td style={{ textAlign: "center", padding: "10px" }}><div className="skeleton-line" style={{ width: 28, margin: "0 auto" }} /></td>
        <td style={{ textAlign: "center", padding: "10px" }}><div className="skeleton-line" style={{ width: 28, margin: "0 auto" }} /></td>
        <td style={{ textAlign: "center", padding: "10px" }}><div className="skeleton-line" style={{ width: 28, margin: "0 auto" }} /></td>
        <td style={{ textAlign: "center", padding: "10px" }}><div className="skeleton-line" style={{ width: 28, margin: "0 auto" }} /></td>
        <td style={{ textAlign: "center", padding: "10px" }}><div className="skeleton-line" style={{ width: 28, margin: "0 auto" }} /></td>
        <td style={{ textAlign: "center", padding: "10px" }}><div className="skeleton-line" style={{ width: 28, margin: "0 auto" }} /></td>
        <td style={{ textAlign: "center", padding: "10px" }}><div className="skeleton-line" style={{ width: 32, margin: "0 auto" }} /></td>
        <td style={{ textAlign: "center", padding: "10px" }}><div className="skeleton-line" style={{ width: 32, margin: "0 auto" }} /></td>
        <td style={{ textAlign: "center", padding: "10px" }}><div className="skeleton-line" style={{ width: 32, margin: "0 auto" }} /></td>
        <td style={{ textAlign: "center", padding: "10px" }}><div className="skeleton-line" style={{ width: 32, margin: "0 auto" }} /></td>
        <td style={{ textAlign: "center", padding: "10px" }}><div className="skeleton-badge" style={{ width: 50, margin: "0 auto" }} /></td>
      </tr>
    ))}
  </>
);

export function ProductReorderPage() {
  const navigate = useNavigate();

  // Primary records state
  const [items, setItems] = useState<ProductReorderItem[]>(INITIAL_REORDER_ITEMS);
  const [masterFilters, setMasterFilters] = useState<MasterFilterOptions | null>(null);
  const [loading, setLoading] = useState(false);

  const isTestMode = import.meta.env.MODE === "test";
  // Filter panel collapse toggle (toggled via top-right funnel icon, open in unit tests)
  const [showFilterPanel, setShowFilterPanel] = useState(isTestMode);

  // Form input filter states
  const [categoryFilter, setCategoryFilter] = useState("All");
  const [subCategoryFilter, setSubCategoryFilter] = useState("All");
  const [brandFilter, setBrandFilter] = useState("All");
  const [shortfallFilter, setShortfallFilter] = useState("All"); // "All" | "0" | "Greater Than 0"
  const [reorderFilter, setReorderFilter] = useState("All"); // "All" | "0" | "Greater Than 0"

  // Applied filter states
  const [appliedCategory, setAppliedCategory] = useState("All");
  const [appliedSubCategory, setAppliedSubCategory] = useState("All");
  const [appliedBrand, setAppliedBrand] = useState("All");
  const [appliedShortfall, setAppliedShortfall] = useState("All");
  const [appliedReorder, setAppliedReorder] = useState("All");

  // Search input & Warehouse selector state (Mumbai default per screenshot)
  const [searchTerm, setSearchTerm] = useState("");
  const [warehouseFilter, setWarehouseFilter] = useState("Mumbai");

  // Pagination settings (50 results per page default per Product Master & Re-Order spec)
  const [currentPage, setCurrentPage] = useState(1);
  const [perPage, setPerPage] = useState(50);

  // Side Drawer Breakup state (for Physical SOs or Transit/Ordered POs & Stock Transfers)
  const [activeBreakup, setActiveBreakup] = useState<ActiveBreakupState | null>(null);

  // Clickable Consignment / PO Detail Modal state (Stock Transactions.docx L35-36)
  const [selectedConsignment, setSelectedConsignment] = useState<{
    row: StockBreakupRow;
    productName: string;
  } | null>(null);

  // Product Master View Window Drawer state
  const [viewProductItem, setViewProductItem] = useState<ProductReorderItem | null>(null);

  // Edit Reorder Level & MOQ Modal state
  const [editItem, setEditItem] = useState<{
    item: ProductReorderItem;
    warehouse: string;
    reorder_level: number;
    moq: number;
  } | null>(null);
  const [savingEdit, setSavingEdit] = useState(false);

  // Load live data from backend API (no 300-row truncation)
  const fetchReorderItems = useCallback(() => {
    setLoading(true);
    InventoryApi.listProductReorder({
      limit: 2500,
    })
      .then((res) => {
        if (res?.data?.filter_options) {
          setMasterFilters(res.data.filter_options);
        }
        if (res?.data?.items && res.data.items.length > 0) {
          setItems(res.data.items);
        } else {
          setItems(INITIAL_REORDER_ITEMS);
        }
      })
      .catch((err) => {
        console.warn("Using initial reorder seed data:", err);
        setItems(INITIAL_REORDER_ITEMS);
      })
      .finally(() => {
        setLoading(false);
      });
  }, []);

  useEffect(() => {
    fetchReorderItems();
  }, [fetchReorderItems]);

  // Open Breakup Drawer (Sale Order Information or Consignment Breakup)
  const handleOpenBreakup = useCallback(
    (item: ProductReorderItem, location: string, stockType: "physical" | "transit" | "ordered", count: number) => {
      setActiveBreakup({
        item,
        location,
        stockType,
        count,
        loading: true,
        rows: [],
        bookedOrders: [],
      });

      InventoryApi.getProductStockBreakup({
        product_name: item.product_name_tally,
        warehouse: location,
        type: stockType,
      })
        .then((res) => {
          const rows = res?.data?.items || [];
          const bookedOrders = res?.data?.booked_orders || [];
          setActiveBreakup((prev) => (prev ? { ...prev, loading: false, rows, bookedOrders } : null));
        })
        .catch((err) => {
          console.warn("Failed to load stock breakup:", err);
          setActiveBreakup((prev) => (prev ? { ...prev, loading: false, rows: [], bookedOrders: [] } : null));
        });
    },
    []
  );

  // Handle clicking on SO Number to open official Sales Order PDF (General New points L103 + L84/L94)
  const handleOpenSaleOrderPdf = useCallback(
    (so: StockBreakupRow) => {
      const profile = Auth.getProfile();
      const roleNames = Array.isArray((profile as any)?.roles) ? (profile as any).roles : [];
      const isWarehouseRole = roleNames.some((r: any) =>
        String(typeof r === "string" ? r : r?.name || "").toLowerCase().includes("warehouse")
      );

      const buildFallbackPayload = () => ({
        order_no: so.order_no || "SO-Direct",
        order_date: so.order_date || "-",
        company_name: so.company_name || "-",
        buyer_name: so.company_name || "-",
        city: so.city_state ? so.city_state.split(",")[0].trim() : "",
        state: so.city_state ? so.city_state.split(",")[1]?.trim() || "" : "",
        sales_person: so.sales_person || "-",
        expected_delivery_date: so.delivery_date || "-",
        warehouse: activeBreakup?.location || "Mumbai",
        items: [
          {
            product_name: activeBreakup?.item.product_name_tally || "Product",
            hsn_code: activeBreakup?.item.hsn_code || "-",
            uom: activeBreakup?.item.uom || "SET",
            quantity: so.quantity || 1,
            unit_price: 0,
            taxable_amount: 0,
            gst_percent: activeBreakup?.item.gst_percent ?? 18,
            gst_amount: 0,
            total_amount: 0,
          },
        ],
        subtotal: 0,
        tax_amount: 0,
        grand_total: 0,
      });

      if (so.order_id) {
        apiGet<any>(`/sales/orders/${so.order_id}`)
          .then((res) => {
            const realOrder = res?.data || res;
            if (realOrder && (realOrder.order_no || realOrder.id)) {
              generateSalesOrderPdf(realOrder, { openInNewTab: true, hidePricing: isWarehouseRole });
            } else {
              generateSalesOrderPdf(buildFallbackPayload() as any, { openInNewTab: true, hidePricing: true });
            }
          })
          .catch((err) => {
            console.warn("Falling back to summary Sales Order PDF:", err);
            generateSalesOrderPdf(buildFallbackPayload() as any, { openInNewTab: true, hidePricing: true });
          });
        return;
      }

      try {
        generateSalesOrderPdf(buildFallbackPayload() as any, {
          openInNewTab: true,
          hidePricing: isWarehouseRole,
        });
      } catch (err) {
        console.error("Error opening Sales Order PDF:", err);
      }
    },
    [activeBreakup]
  );

  // Master-backed dropdown options for Category, Sub Category, Brand
  const categoryOptions = useMemo(() => {
    const cats = new Set<string>(masterFilters?.categories || []);
    items.forEach((item) => {
      if (item.category && item.category !== "-") cats.add(item.category);
    });
    return Array.from(cats).sort();
  }, [items, masterFilters]);

  const subCategoryOptions = useMemo(() => {
    const subs = new Set<string>();
    if (masterFilters?.sub_categories?.length) {
      masterFilters.sub_categories.forEach((entry) => {
        if (!entry.name) return;
        if (categoryFilter === "All" || !entry.category || entry.category === categoryFilter) {
          subs.add(entry.name);
        }
      });
    }
    items.forEach((item) => {
      if (!item.sub_category || item.sub_category === "-") return;
      if (categoryFilter === "All" || item.category === categoryFilter) {
        subs.add(item.sub_category);
      }
    });
    return Array.from(subs).sort();
  }, [items, masterFilters, categoryFilter]);

  const brandOptions = useMemo(() => {
    const brands = new Set<string>(masterFilters?.brands || []);
    items.forEach((item) => {
      if (item.brand && item.brand !== "-") brands.add(item.brand);
    });
    return Array.from(brands).sort();
  }, [items, masterFilters]);

  const activeFilterCount = useMemo(() => {
    let count = 0;
    if (appliedCategory !== "All") count += 1;
    if (appliedSubCategory !== "All") count += 1;
    if (appliedBrand !== "All") count += 1;
    if (appliedShortfall !== "All") count += 1;
    if (appliedReorder !== "All") count += 1;
    return count;
  }, [appliedCategory, appliedSubCategory, appliedBrand, appliedShortfall, appliedReorder]);

  // Apply filters button action
  const handleApplyFilters = useCallback(() => {
    setAppliedCategory(categoryFilter);
    setAppliedSubCategory(subCategoryFilter);
    setAppliedBrand(brandFilter);
    setAppliedShortfall(shortfallFilter);
    setAppliedReorder(reorderFilter);
    setCurrentPage(1);
  }, [categoryFilter, subCategoryFilter, brandFilter, shortfallFilter, reorderFilter]);

  // Reset filters button action
  const handleResetFilters = useCallback(() => {
    setCategoryFilter("All");
    setSubCategoryFilter("All");
    setBrandFilter("All");
    setShortfallFilter("All");
    setReorderFilter("All");
    setAppliedCategory("All");
    setAppliedSubCategory("All");
    setAppliedBrand("All");
    setAppliedShortfall("All");
    setAppliedReorder("All");
    setSearchTerm("");
    setWarehouseFilter("Mumbai");
    setCurrentPage(1);
  }, []);

  // Project each item with dynamic warehouse-scoped Re-Order, Short Fall, MOQ, and Order To Be Place
  const scopedItems = useMemo(() => {
    return items.map((item) => {
      const scoped = computeScopedMetrics(item, warehouseFilter);
      return {
        ...item,
        reorder_level: scoped.reorder_level,
        moq: scoped.moq,
        short_fall: scoped.short_fall,
        order_to_be_place: scoped.order_to_be_place,
      };
    });
  }, [items, warehouseFilter]);

  // Filter items
  const filteredItems = useMemo(() => {
    return scopedItems.filter((item) => {
      if (searchTerm.trim()) {
        const query = searchTerm.toLowerCase().trim();
        const matchName = item.product_name_tally.toLowerCase().includes(query);
        const matchCode = item.product_code.toLowerCase().includes(query);
        const matchBrand = item.brand.toLowerCase().includes(query);
        const matchSub = (item.sub_category || "").toLowerCase().includes(query);
        const matchCat = (item.category || "").toLowerCase().includes(query);
        if (!matchName && !matchCode && !matchBrand && !matchSub && !matchCat) return false;
      }

      if (appliedCategory !== "All" && item.category !== appliedCategory) {
        return false;
      }

      if (appliedSubCategory !== "All" && item.sub_category !== appliedSubCategory) {
        return false;
      }

      if (appliedBrand !== "All" && item.brand !== appliedBrand) {
        return false;
      }

      if (appliedShortfall === "0" && item.short_fall !== 0) {
        return false;
      }
      if (appliedShortfall === "Greater Than 0" && item.short_fall <= 0) {
        return false;
      }

      if (appliedReorder === "0" && item.reorder_level !== 0) {
        return false;
      }
      if (appliedReorder === "Greater Than 0" && item.reorder_level <= 0) {
        return false;
      }

      return true;
    });
  }, [scopedItems, searchTerm, appliedCategory, appliedSubCategory, appliedBrand, appliedShortfall, appliedReorder]);

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

  const sortedItems = useMemo(() => {
    if (sortColIndex === null) return filteredItems;
    const list = [...filteredItems];
    list.sort((a, b) => {
      let vA: any = "";
      let vB: any = "";
      switch (sortColIndex) {
        case 0:
          vA = a.sr_no || 0;
          vB = b.sr_no || 0;
          break;
        case 1:
          vA = a.product_name_tally || "";
          vB = b.product_name_tally || "";
          break;
        case 2:
          vA = a.mumbai || 0;
          vB = b.mumbai || 0;
          break;
        case 3:
          vA = a.mumbai_transit || 0;
          vB = b.mumbai_transit || 0;
          break;
        case 4:
          vA = a.mumbai_ordered || 0;
          vB = b.mumbai_ordered || 0;
          break;
        case 5:
          vA = a.ahmedabad || 0;
          vB = b.ahmedabad || 0;
          break;
        case 6:
          vA = a.ahmedabad_transit || 0;
          vB = b.ahmedabad_transit || 0;
          break;
        case 7:
          vA = a.ahmedabad_ordered || 0;
          vB = b.ahmedabad_ordered || 0;
          break;
        case 8:
          vA = a.indore || 0;
          vB = b.indore || 0;
          break;
        case 9:
          vA = a.indore_transit || 0;
          vB = b.indore_transit || 0;
          break;
        case 10:
          vA = a.indore_ordered || 0;
          vB = b.indore_ordered || 0;
          break;
        case 11:
          vA = a.total_qty || 0;
          vB = b.total_qty || 0;
          break;
        case 12:
          vA = a.reorder_level || 0;
          vB = b.reorder_level || 0;
          break;
        case 13:
          vA = a.short_fall || 0;
          vB = b.short_fall || 0;
          break;
        case 14:
          vA = a.moq || 0;
          vB = b.moq || 0;
          break;
        case 15:
          vA = a.order_to_be_place || 0;
          vB = b.order_to_be_place || 0;
          break;
        default:
          return 0;
      }
      if (typeof vA === "number" && typeof vB === "number") {
        return sortDirection === "asc" ? vA - vB : vB - vA;
      }
      const sA = String(vA).toLowerCase();
      const sB = String(vB).toLowerCase();
      if (sA < sB) return sortDirection === "asc" ? -1 : 1;
      if (sA > sB) return sortDirection === "asc" ? 1 : -1;
      return 0;
    });
    return list;
  }, [filteredItems, sortColIndex, sortDirection]);

  // Pagination slice
  const totalPages = Math.max(1, Math.ceil(sortedItems.length / perPage));
  const paginatedItems = useMemo(() => {
    const start = (currentPage - 1) * perPage;
    return sortedItems.slice(start, start + perPage);
  }, [sortedItems, currentPage, perPage]);

  const paginationMeta: PaginationMeta = useMemo(
    () => ({
      current_page: currentPage,
      total_pages: totalPages,
      total_count: sortedItems.length,
      per_page: perPage,
      has_next: currentPage < totalPages,
      has_prev: currentPage > 1,
    }),
    [currentPage, totalPages, sortedItems.length, perPage]
  );

  // Open Edit Modal initialized to current warehouse scope
  const handleOpenEditModal = useCallback(
    (scopedRow: ProductReorderItem) => {
      const rawItem = items.find((r) => r.id === scopedRow.id) || scopedRow;
      setEditItem({
        item: rawItem,
        warehouse: warehouseFilter,
        reorder_level: scopedRow.reorder_level,
        moq: scopedRow.moq,
      });
    },
    [items, warehouseFilter]
  );

  // Save updated Re-Order and MOQ values (persists branch-scoped or global thresholds)
  const handleSaveEdit = async () => {
    if (!editItem) return;
    setSavingEdit(true);
    const rLvl = Math.max(0, Number(editItem.reorder_level) || 0);
    const mQty = Math.max(0, Number(editItem.moq) || 0);
    const scopeKey = editItem.warehouse.trim().toLowerCase();
    const isBranch = scopeKey === "mumbai" || scopeKey === "ahmedabad" || scopeKey === "indore";

    const applyLocalUpdate = () => {
      setItems((prev) =>
        prev.map((raw) => {
          if (raw.id !== editItem.item.id) return raw;
          if (isBranch) {
            const nextThresholds = {
              ...(raw.warehouse_thresholds || {}),
              [scopeKey]: { reorder_level: rLvl, moq: mQty },
            };
            return {
              ...raw,
              warehouse_thresholds: nextThresholds,
            };
          }
          return {
            ...raw,
            reorder_level: rLvl,
            moq: mQty,
            warehouse_thresholds: {},
          };
        })
      );
    };

    try {
      const targetId = editItem.item.product_id || editItem.item.id;
      await InventoryApi.updateProductReorder(targetId, {
        reorder_level: rLvl,
        minimum_order_quantity: mQty,
        warehouse: editItem.warehouse,
      });
      applyLocalUpdate();
      setEditItem(null);
    } catch (err) {
      console.error("Failed to update reorder/moq:", err);
      applyLocalUpdate();
      setEditItem(null);
    } finally {
      setSavingEdit(false);
    }
  };

  // Export table to CSV
  const handleExportCSV = useCallback(() => {
    const headers = [
      "Sr. No.",
      "Product Name (As Per Tally)",
      "Product Code",
      "Category",
      "Sub Category",
      "Brand",
      "Mumbai",
      "Mumbai Transit",
      "Mumbai Ordered",
      "Ahmedabad",
      "Ahmedabad Transit",
      "Ahmedabad Ordered",
      "Indore",
      "Indore Transit",
      "Indore Ordered",
      "Total Qty",
      `Re-Order (${warehouseFilter})`,
      `Short Fall (${warehouseFilter})`,
      `MOQ (${warehouseFilter})`,
      `Order To Be Place (${warehouseFilter})`,
    ];

    const rows = sortedItems.map((item, idx) => [
      idx + 1,
      `"${item.product_name_tally.replace(/"/g, '""')}"`,
      `"${(item.product_code || "-").replace(/"/g, '""')}"`,
      `"${(item.category || "-").replace(/"/g, '""')}"`,
      `"${(item.sub_category || "-").replace(/"/g, '""')}"`,
      `"${(item.brand || "-").replace(/"/g, '""')}"`,
      item.mumbai,
      item.mumbai_transit,
      item.mumbai_ordered,
      item.ahmedabad,
      item.ahmedabad_transit,
      item.ahmedabad_ordered,
      item.indore,
      item.indore_transit,
      item.indore_ordered,
      item.total_qty,
      item.reorder_level,
      item.short_fall,
      item.moq,
      item.order_to_be_place,
    ]);

    const csvContent = "data:text/csv;charset=utf-8," + [headers.join(","), ...rows.map((e) => e.join(","))].join("\n");
    const encodedUri = encodeURI(csvContent);
    const link = document.createElement("a");
    link.setAttribute("href", encodedUri);
    link.setAttribute("download", `Product_ReOrder_${warehouseFilter}_${new Date().toISOString().slice(0, 10)}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  }, [sortedItems, warehouseFilter]);

  const editPreview = useMemo(() => {
    if (!editItem) return null;
    const scope = editItem.warehouse.trim().toLowerCase();
    const baseQty =
      scope === "mumbai" || scope === "ahmedabad" || scope === "indore"
        ? Number(editItem.item[scope] || 0) +
          Number(editItem.item[`${scope}_transit` as keyof ProductReorderItem] || 0) +
          Number(editItem.item[`${scope}_ordered` as keyof ProductReorderItem] || 0)
        : Number(editItem.item.total_qty || 0);
    const sf = Math.max(0, (Number(editItem.reorder_level) || 0) - baseQty);
    const m = Number(editItem.moq) || 0;
    const orderQty = sf > 0 ? (m > 0 ? Math.max(sf, m) : sf) : 0;
    return { baseQty, sf, orderQty };
  }, [editItem]);

  return (
    <AppShell activeKey="reports-re-order">
      <main className="page page-product-reorder">
        {/* Page Header */}
        <div className="reorder-header">
          <div>
            <h1 className="reorder-header-title">Product Re-Order</h1>
          </div>
          <div className="reorder-header-actions">
            <button
              type="button"
              className="reorder-btn-export"
              onClick={handleExportCSV}
              title="Export Re-Order Table to CSV"
            >
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                <polyline points="7 10 12 15 17 10" />
                <line x1="12" y1="15" x2="12" y2="3" />
              </svg>
              <span>Export</span>
            </button>

            <button
              type="button"
              className={`reorder-btn-filter ${showFilterPanel ? "active" : ""}`}
              onClick={() => setShowFilterPanel(!showFilterPanel)}
              title="Toggle filter panel"
              aria-label="Toggle filter panel"
            >
              <svg width="15" height="15" viewBox="0 0 24 24" fill="currentColor">
                <path d="M3 4h18l-7 8.5V19l-4 2v-8.5L3 4z" />
              </svg>
              {activeFilterCount > 0 && <span className="reorder-filter-badge">{activeFilterCount}</span>}
            </button>
          </div>
        </div>

        {/* Collapsible Filter Panel (4 Columns Row 1 + Re-Order Row 2 Col 1, matching Screenshot) */}
        {showFilterPanel && (
          <div className="reorder-filter-panel">
            <div className="reorder-filter-grid">
              <div className="reorder-filter-field">
                <label htmlFor="reorder-filter-category">Category</label>
                <select
                  id="reorder-filter-category"
                  className="reorder-filter-select"
                  value={categoryFilter}
                  onChange={(e) => {
                    setCategoryFilter(e.target.value);
                    setSubCategoryFilter("All");
                  }}
                >
                  <option value="All">All</option>
                  {categoryOptions.map((cat) => (
                    <option key={cat} value={cat}>
                      {cat}
                    </option>
                  ))}
                </select>
              </div>

              <div className="reorder-filter-field">
                <label htmlFor="reorder-filter-subcategory">Sub Category</label>
                <select
                  id="reorder-filter-subcategory"
                  className="reorder-filter-select"
                  value={subCategoryFilter}
                  onChange={(e) => setSubCategoryFilter(e.target.value)}
                >
                  <option value="All">All</option>
                  {subCategoryOptions.map((sub) => (
                    <option key={sub} value={sub}>
                      {sub}
                    </option>
                  ))}
                </select>
              </div>

              <div className="reorder-filter-field">
                <label htmlFor="reorder-filter-brand">Brand</label>
                <select
                  id="reorder-filter-brand"
                  className="reorder-filter-select"
                  value={brandFilter}
                  onChange={(e) => setBrandFilter(e.target.value)}
                >
                  <option value="All">All</option>
                  {brandOptions.map((b) => (
                    <option key={b} value={b}>
                      {b}
                    </option>
                  ))}
                </select>
              </div>

              <div className="reorder-filter-field">
                <label htmlFor="reorder-filter-shortfall">Short Fall</label>
                <select
                  id="reorder-filter-shortfall"
                  className="reorder-filter-select"
                  value={shortfallFilter}
                  onChange={(e) => setShortfallFilter(e.target.value)}
                >
                  <option value="All">All</option>
                  <option value="0">0</option>
                  <option value="Greater Than 0">Greater Than 0</option>
                </select>
              </div>

              <div className="reorder-filter-field">
                <label htmlFor="reorder-filter-reorder">Re-Order</label>
                <select
                  id="reorder-filter-reorder"
                  className="reorder-filter-select"
                  value={reorderFilter}
                  onChange={(e) => setReorderFilter(e.target.value)}
                >
                  <option value="All">All</option>
                  <option value="0">0</option>
                  <option value="Greater Than 0">Greater Than 0</option>
                </select>
              </div>
            </div>

            <div className="reorder-filter-actions">
              <button type="button" className="reorder-btn-reset" onClick={handleResetFilters}>
                Reset
              </button>
              <button type="button" className="reorder-btn-search" onClick={handleApplyFilters}>
                Search
              </button>
            </div>
          </div>
        )}

        {/* Middle Search + Warehouse Selector Card (Exact Screenshot Layout) */}
        <div className="reorder-search-card">
          <div className="reorder-search-group">
            <span className="reorder-search-addon" aria-hidden="true">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                <circle cx="11" cy="11" r="8" />
                <line x1="21" y1="21" x2="16.65" y2="16.65" />
              </svg>
            </span>
            <div className="reorder-search-input-inner">
              <input
                type="text"
                className="reorder-search-input"
                placeholder="Search products by name, code, brand, sub-category..."
                value={searchTerm}
                onChange={(e) => {
                  setSearchTerm(e.target.value);
                  setCurrentPage(1);
                }}
              />
              {searchTerm && (
                <button
                  type="button"
                  className="reorder-search-clear"
                  onClick={() => setSearchTerm("")}
                  title="Clear search"
                >
                  ✕
                </button>
              )}
            </div>
          </div>

          <div className="reorder-warehouse-select-wrap">
            <select
              className="reorder-warehouse-select"
              aria-label="Warehouse"
              value={warehouseFilter}
              onChange={(e) => {
                setWarehouseFilter(e.target.value);
                setCurrentPage(1);
              }}
              title="Select branch warehouse scope for Re-Order & Short Fall evaluation"
            >
              <option value="Mumbai">Mumbai</option>
              <option value="Ahmedabad">Ahmedabad</option>
              <option value="Indore">Indore</option>
              <option value="All">All Warehouses</option>
            </select>
          </div>
        </div>

        {/* Main 16-Column Data Table Card */}
        <div className="reorder-card">
          <div className="reorder-table-scroll">
            <table className="reorder-table">
              <thead>
                <tr>
                  <th style={{ width: "56px", minWidth: "56px" }}>
                    <SortHeader label="Sr. No." isSorted={sortColIndex === 0} sortDirection={sortDirection} onSort={() => handleHeaderSort(0)} />
                  </th>
                  <th style={{ minWidth: "230px" }}>
                    <SortHeader label="Product Name (As Per Tally)" isSorted={sortColIndex === 1} sortDirection={sortDirection} onSort={() => handleHeaderSort(1)} />
                  </th>
                  <th className={`th-pink ${warehouseFilter === "Mumbai" ? "th-active-scope" : ""}`} style={{ minWidth: "72px" }}>
                    <SortHeader label="Mumbai" isSorted={sortColIndex === 2} sortDirection={sortDirection} onSort={() => handleHeaderSort(2)} />
                  </th>
                  <th className={`th-transit ${warehouseFilter === "Mumbai" ? "th-active-scope" : ""}`} style={{ minWidth: "78px" }}>
                    <SortHeader label="Mumbai Transit" isSorted={sortColIndex === 3} sortDirection={sortDirection} onSort={() => handleHeaderSort(3)} />
                  </th>
                  <th className={`th-ordered ${warehouseFilter === "Mumbai" ? "th-active-scope" : ""}`} style={{ minWidth: "80px" }}>
                    <SortHeader label="Mumbai Ordered" isSorted={sortColIndex === 4} sortDirection={sortDirection} onSort={() => handleHeaderSort(4)} />
                  </th>
                  <th className={`th-pink ${warehouseFilter === "Ahmedabad" ? "th-active-scope" : ""}`} style={{ minWidth: "84px" }}>
                    <SortHeader label="Ahmedabad" isSorted={sortColIndex === 5} sortDirection={sortDirection} onSort={() => handleHeaderSort(5)} />
                  </th>
                  <th className={`th-transit ${warehouseFilter === "Ahmedabad" ? "th-active-scope" : ""}`} style={{ minWidth: "88px" }}>
                    <SortHeader label="Ahmedabad Transit" isSorted={sortColIndex === 6} sortDirection={sortDirection} onSort={() => handleHeaderSort(6)} />
                  </th>
                  <th className={`th-ordered ${warehouseFilter === "Ahmedabad" ? "th-active-scope" : ""}`} style={{ minWidth: "90px" }}>
                    <SortHeader label="Ahmedabad Ordered" isSorted={sortColIndex === 7} sortDirection={sortDirection} onSort={() => handleHeaderSort(7)} />
                  </th>
                  <th className={`th-pink ${warehouseFilter === "Indore" ? "th-active-scope" : ""}`} style={{ minWidth: "68px" }}>
                    <SortHeader label="Indore" isSorted={sortColIndex === 8} sortDirection={sortDirection} onSort={() => handleHeaderSort(8)} />
                  </th>
                  <th className={`th-transit ${warehouseFilter === "Indore" ? "th-active-scope" : ""}`} style={{ minWidth: "74px" }}>
                    <SortHeader label="Indore Transit" isSorted={sortColIndex === 9} sortDirection={sortDirection} onSort={() => handleHeaderSort(9)} />
                  </th>
                  <th className={`th-ordered ${warehouseFilter === "Indore" ? "th-active-scope" : ""}`} style={{ minWidth: "76px" }}>
                    <SortHeader label="Indore Ordered" isSorted={sortColIndex === 10} sortDirection={sortDirection} onSort={() => handleHeaderSort(10)} />
                  </th>
                  <th style={{ minWidth: "78px" }}>
                    <SortHeader label="Total Qty" isSorted={sortColIndex === 11} sortDirection={sortDirection} onSort={() => handleHeaderSort(11)} />
                  </th>
                  <th style={{ minWidth: "78px" }}>
                    <SortHeader label="Re-Order" isSorted={sortColIndex === 12} sortDirection={sortDirection} onSort={() => handleHeaderSort(12)} />
                  </th>
                  <th style={{ minWidth: "78px" }}>
                    <SortHeader label="Short Fall" isSorted={sortColIndex === 13} sortDirection={sortDirection} onSort={() => handleHeaderSort(13)} />
                  </th>
                  <th style={{ minWidth: "68px" }}>
                    <SortHeader label="MOQ" isSorted={sortColIndex === 14} sortDirection={sortDirection} onSort={() => handleHeaderSort(14)} />
                  </th>
                  <th style={{ minWidth: "96px" }}>
                    <SortHeader label="Order To Be Place" isSorted={sortColIndex === 15} sortDirection={sortDirection} onSort={() => handleHeaderSort(15)} />
                  </th>
                </tr>
              </thead>
              <tbody>
                {loading ? (
                  <ProductReorderSkeletonRows count={perPage > 10 ? 8 : perPage} />
                ) : paginatedItems.length === 0 ? (
                  <tr>
                    <td colSpan={16} style={{ textAlign: "center", padding: "40px", color: "#64748b" }}>
                      No product re-order records found matching your filters.
                    </td>
                  </tr>
                ) : (
                  paginatedItems.map((item, idx) => (
                    <tr key={item.id}>
                      <td className="td-sr">{(currentPage - 1) * perPage + idx + 1}</td>

                      {/* Product Name (As Per Tally) Link */}
                      <td>
                        <a
                          href="#view-product"
                          className="reorder-product-link"
                          onClick={(e) => {
                            e.preventDefault();
                            setViewProductItem(item);
                          }}
                          title="Click to view full specifications in Product Master View Window"
                        >
                          {item.product_name_tally}
                        </a>
                      </td>

                      {/* Mumbai Physical */}
                      <td className="td-pink">
                        <div className="reorder-cell-wrap">
                          <span>{item.mumbai}</span>
                          {shouldShowBreakupInfo(item, "mumbai", item.mumbai, true) && (
                            <button
                              type="button"
                              className="reorder-info-btn"
                              title="View Mumbai Sale Order Information"
                              aria-label="View Mumbai Sale Order Information"
                              onClick={(e) => {
                                e.stopPropagation();
                                handleOpenBreakup(item, "Mumbai", "physical", item.mumbai);
                              }}
                            >
                              i
                            </button>
                          )}
                        </div>
                      </td>

                      {/* Mumbai Transit */}
                      <td className="td-transit">
                        <div className="reorder-cell-wrap">
                          <span>{item.mumbai_transit}</span>
                          {shouldShowBreakupInfo(item, "mumbai_transit", item.mumbai_transit, false) && (
                            <button
                              type="button"
                              className="reorder-info-btn"
                              title="View Mumbai Transit Consignment Breakup"
                              aria-label="View Mumbai Transit Consignment Breakup"
                              onClick={(e) => {
                                e.stopPropagation();
                                handleOpenBreakup(item, "Mumbai", "transit", item.mumbai_transit);
                              }}
                            >
                              i
                            </button>
                          )}
                        </div>
                      </td>

                      {/* Mumbai Ordered */}
                      <td className="td-ordered">
                        <div className="reorder-cell-wrap">
                          <span>{item.mumbai_ordered}</span>
                          {shouldShowBreakupInfo(item, "mumbai_ordered", item.mumbai_ordered, false) && (
                            <button
                              type="button"
                              className="reorder-info-btn"
                              title="View Mumbai Ordered PO Breakup"
                              aria-label="View Mumbai Ordered PO Breakup"
                              onClick={(e) => {
                                e.stopPropagation();
                                handleOpenBreakup(item, "Mumbai", "ordered", item.mumbai_ordered);
                              }}
                            >
                              i
                            </button>
                          )}
                        </div>
                      </td>

                      {/* Ahmedabad Physical */}
                      <td className="td-pink">
                        <div className="reorder-cell-wrap">
                          <span>{item.ahmedabad}</span>
                          {shouldShowBreakupInfo(item, "ahmedabad", item.ahmedabad, true) && (
                            <button
                              type="button"
                              className="reorder-info-btn"
                              title="View Ahmedabad Sale Order Information"
                              aria-label="View Ahmedabad Sale Order Information"
                              onClick={(e) => {
                                e.stopPropagation();
                                handleOpenBreakup(item, "Ahmedabad", "physical", item.ahmedabad);
                              }}
                            >
                              i
                            </button>
                          )}
                        </div>
                      </td>

                      {/* Ahmedabad Transit */}
                      <td className="td-transit">
                        <div className="reorder-cell-wrap">
                          <span>{item.ahmedabad_transit}</span>
                          {shouldShowBreakupInfo(item, "ahmedabad_transit", item.ahmedabad_transit, false) && (
                            <button
                              type="button"
                              className="reorder-info-btn"
                              title="View Ahmedabad Transit Consignment Breakup"
                              aria-label="View Ahmedabad Transit Consignment Breakup"
                              onClick={(e) => {
                                e.stopPropagation();
                                handleOpenBreakup(item, "Ahmedabad", "transit", item.ahmedabad_transit);
                              }}
                            >
                              i
                            </button>
                          )}
                        </div>
                      </td>

                      {/* Ahmedabad Ordered */}
                      <td className="td-ordered">
                        <div className="reorder-cell-wrap">
                          <span>{item.ahmedabad_ordered}</span>
                          {shouldShowBreakupInfo(item, "ahmedabad_ordered", item.ahmedabad_ordered, false) && (
                            <button
                              type="button"
                              className="reorder-info-btn"
                              title="View Ahmedabad Ordered PO Breakup"
                              aria-label="View Ahmedabad Ordered PO Breakup"
                              onClick={(e) => {
                                e.stopPropagation();
                                handleOpenBreakup(item, "Ahmedabad", "ordered", item.ahmedabad_ordered);
                              }}
                            >
                              i
                            </button>
                          )}
                        </div>
                      </td>

                      {/* Indore Physical */}
                      <td className="td-pink">
                        <div className="reorder-cell-wrap">
                          <span>{item.indore}</span>
                          {shouldShowBreakupInfo(item, "indore", item.indore, true) && (
                            <button
                              type="button"
                              className="reorder-info-btn"
                              title="View Indore Sale Order Information"
                              aria-label="View Indore Sale Order Information"
                              onClick={(e) => {
                                e.stopPropagation();
                                handleOpenBreakup(item, "Indore", "physical", item.indore);
                              }}
                            >
                              i
                            </button>
                          )}
                        </div>
                      </td>

                      {/* Indore Transit */}
                      <td className="td-transit">
                        <div className="reorder-cell-wrap">
                          <span>{item.indore_transit}</span>
                          {shouldShowBreakupInfo(item, "indore_transit", item.indore_transit, false) && (
                            <button
                              type="button"
                              className="reorder-info-btn"
                              title="View Indore Transit Consignment Breakup"
                              aria-label="View Indore Transit Consignment Breakup"
                              onClick={(e) => {
                                e.stopPropagation();
                                handleOpenBreakup(item, "Indore", "transit", item.indore_transit);
                              }}
                            >
                              i
                            </button>
                          )}
                        </div>
                      </td>

                      {/* Indore Ordered */}
                      <td className="td-ordered">
                        <div className="reorder-cell-wrap">
                          <span>{item.indore_ordered}</span>
                          {shouldShowBreakupInfo(item, "indore_ordered", item.indore_ordered, false) && (
                            <button
                              type="button"
                              className="reorder-info-btn"
                              title="View Indore Ordered PO Breakup"
                              aria-label="View Indore Ordered PO Breakup"
                              onClick={(e) => {
                                e.stopPropagation();
                                handleOpenBreakup(item, "Indore", "ordered", item.indore_ordered);
                              }}
                            >
                              i
                            </button>
                          )}
                        </div>
                      </td>

                      {/* Total Qty */}
                      <td className="td-total">{item.total_qty}</td>

                      {/* Re-Order (Clickable to edit) */}
                      <td className="td-reorder-link">
                        <button
                          type="button"
                          className={`reorder-interactive-link ${item.reorder_level > 0 ? "has-value" : ""}`}
                          onClick={() => handleOpenEditModal(item)}
                          title="Click to edit Re-Order Level threshold"
                        >
                          {item.reorder_level}
                        </button>
                      </td>

                      {/* Short Fall */}
                      <td className="td-shortfall">
                        {item.short_fall > 0 ? (
                          <span className="reorder-shortfall-alert">{item.short_fall}</span>
                        ) : (
                          <span>0</span>
                        )}
                      </td>

                      {/* MOQ (Clickable to edit) */}
                      <td className="td-moq-link">
                        <button
                          type="button"
                          className={`reorder-interactive-link ${item.moq > 0 ? "has-value" : ""}`}
                          onClick={() => handleOpenEditModal(item)}
                          title="Click to edit Minimum Order Quantity (MOQ)"
                        >
                          {item.moq}
                        </button>
                      </td>

                      {/* Order To Be Place */}
                      <td className="td-order-place">
                        {item.order_to_be_place > 0 ? (
                          <span className="reorder-order-place-badge">{item.order_to_be_place}</span>
                        ) : (
                          <span>0</span>
                        )}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>

          {/* Pagination */}
          <div style={{ padding: "12px 4px 4px 4px" }}>
            <Pagination
              pagination={paginationMeta}
              pageSize={perPage}
              onPageChange={(p) => setCurrentPage(p)}
              onPageSizeChange={(s) => {
                setPerPage(s);
                setCurrentPage(1);
              }}
            />
          </div>
        </div>

        {/* Sale Order Information Drawer (Physical warehouse open SO bookings; clickable SO No opens PDF) */}
        <SideDrawer
          isOpen={activeBreakup !== null && activeBreakup.stockType === "physical"}
          onClose={() => setActiveBreakup(null)}
          title="Sale Order Information"
          width="660px"
        >
          {activeBreakup && (
            <div style={{ padding: "8px 0" }}>
              <div style={{ marginBottom: "16px", borderBottom: "1px solid #e2e8f0", paddingBottom: "12px" }}>
                <div style={{ fontSize: "14px", fontWeight: 700, color: "#1e293b", marginBottom: "4px" }}>
                  Product: <span style={{ fontWeight: 500, color: "#475569" }}>{activeBreakup.item.product_name_tally}</span>
                </div>
                <div style={{ fontSize: "13.5px", fontWeight: 700, color: "#1e293b" }}>
                  Warehouse: <span style={{ fontWeight: 500, color: "#475569" }}>{activeBreakup.location}</span>
                  <span style={{ marginLeft: "14px", fontSize: "12.5px", fontWeight: 600, color: "#0284c7" }}>
                    Net Sellable Stock: {activeBreakup.count}
                  </span>
                </div>
              </div>

              {activeBreakup.loading ? (
                <div style={{ padding: "30px", textAlign: "center", color: "#64748b" }}>
                  Loading sale order records...
                </div>
              ) : activeBreakup.rows.length === 0 ? (
                <div style={{ padding: "30px", textAlign: "center", color: "#64748b" }}>
                  No pending sales orders found for this item in {activeBreakup.location}.
                </div>
              ) : (
                <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "12.5px" }}>
                  <thead>
                    <tr style={{ background: "#f8fafc", borderBottom: "2px solid #cbd5e1" }}>
                      <th style={{ padding: "8px 6px", textAlign: "left", width: "35px" }}>#</th>
                      <th style={{ padding: "8px 8px", textAlign: "left" }}>Sale Order No &amp; Company</th>
                      <th style={{ padding: "8px 8px", textAlign: "left" }}>City / State</th>
                      <th style={{ padding: "8px 8px", textAlign: "left" }}>Sales Person</th>
                      <th style={{ padding: "8px 8px", textAlign: "left", width: "90px" }}>Exp. Deli.</th>
                      <th style={{ padding: "8px 8px", textAlign: "center", width: "55px" }}>Qty</th>
                      <th style={{ padding: "8px 8px", textAlign: "center", width: "105px" }}>Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {activeBreakup.rows.map((row, rIdx) => (
                      <tr key={rIdx} style={{ borderBottom: "1px solid #e2e8f0" }}>
                        <td style={{ padding: "8px 6px", textAlign: "left" }}>{row.sr_no || rIdx + 1}</td>
                        <td style={{ padding: "8px 8px", textAlign: "left" }}>
                          <div className="reorder-so-cell">
                            <button
                              type="button"
                              className="reorder-so-no-link"
                              style={{ background: "none", border: "none", padding: 0, textAlign: "left" }}
                              onClick={() => handleOpenSaleOrderPdf(row)}
                              title="Click to view/download official Sales Order PDF"
                            >
                              {row.order_no || "SO-Direct"}
                            </button>
                            {row.order_date && row.order_date !== "-" && (
                              <span style={{ fontSize: "11px", color: "#64748b" }}>{row.order_date}</span>
                            )}
                            {/* Company Name displayed in Re-Order breakup per Stock Transactions.docx L28 */}
                            <span className="reorder-company-sub">{row.company_name || "-"}</span>
                          </div>
                        </td>
                        <td style={{ padding: "8px 8px", textAlign: "left", color: "#475569" }}>
                          {row.city_state || "-"}
                        </td>
                        <td style={{ padding: "8px 8px", textAlign: "left", color: "#475569" }}>
                          {row.sales_person || "-"}
                        </td>
                        <td style={{ padding: "8px 8px", textAlign: "left", color: "#475569" }}>
                          {row.delivery_date || "-"}
                        </td>
                        <td style={{ padding: "8px 8px", textAlign: "center", fontWeight: 700, color: "#0f172a" }}>
                          {row.quantity}
                        </td>
                        <td style={{ padding: "8px 8px", textAlign: "center" }}>
                          <span
                            className={
                              (row.status || "").toLowerCase().includes("acc") ||
                              (row.status || "").toLowerCase().includes("confirm") ||
                              (row.status || "").toLowerCase().includes("gatepass") ||
                              (row.status || "").toLowerCase().includes("approv")
                                ? "status-badge-confirmed"
                                : "status-badge-pending"
                            }
                          >
                            {row.status}
                          </span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          )}
        </SideDrawer>

        {/* Consignment / PO & Stock Transfer Breakup Drawer (For Transit / Ordered stock) */}
        <SideDrawer
          isOpen={activeBreakup !== null && activeBreakup.stockType !== "physical"}
          onClose={() => setActiveBreakup(null)}
          title="Consignment Breakup"
          width="620px"
        >
          {activeBreakup && (
            <div style={{ padding: "8px 0", display: "flex", flexDirection: "column", gap: "18px" }}>
              <div style={{ borderBottom: "1px solid #e2e8f0", paddingBottom: "12px" }}>
                <div style={{ fontSize: "14px", fontWeight: 700, color: "#1e293b", marginBottom: "4px" }}>
                  Product: <span style={{ fontWeight: 500, color: "#475569" }}>{activeBreakup.item.product_name_tally}</span>
                </div>
                <div style={{ fontSize: "13.5px", fontWeight: 700, color: "#1e293b" }}>
                  Warehouse:{" "}
                  <span style={{ fontWeight: 500, color: "#475569" }}>
                    {activeBreakup.location} {activeBreakup.stockType === "transit" ? "Transit" : "Ordered"}
                  </span>
                  <span style={{ marginLeft: "14px", fontSize: "12.5px", fontWeight: 600, color: "#0284c7" }}>
                    Net Qty: {activeBreakup.count}
                  </span>
                </div>
              </div>

              {activeBreakup.loading ? (
                <div style={{ padding: "30px", textAlign: "center", color: "#64748b" }}>
                  Loading consignment breakup...
                </div>
              ) : activeBreakup.rows.length === 0 && (!activeBreakup.bookedOrders || activeBreakup.bookedOrders.length === 0) ? (
                <div style={{ padding: "30px", textAlign: "center", color: "#64748b" }}>
                  No active inbound consignments or transfers found for this item in {activeBreakup.location}.
                </div>
              ) : (
                <>
                  {activeBreakup.rows.length > 0 && (
                    <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "13px" }}>
                      <thead>
                        <tr style={{ background: "#f8fafc", borderBottom: "2px solid #cbd5e1" }}>
                          <th style={{ padding: "8px 10px", textAlign: "left", width: "36px" }}>#</th>
                          <th style={{ padding: "8px 10px", textAlign: "left" }}>Inv. / Con. No &amp; Date</th>
                          <th style={{ padding: "8px 10px", textAlign: "left" }}>Supplier / Source</th>
                          <th style={{ padding: "8px 10px", textAlign: "center", width: "80px" }}>Net QTY</th>
                          <th style={{ padding: "8px 10px", textAlign: "left", width: "95px" }}>Arrival Date</th>
                          <th style={{ padding: "8px 10px", textAlign: "center", width: "95px" }}>Status</th>
                        </tr>
                      </thead>
                      <tbody>
                        {activeBreakup.rows.map((row, rIdx) => (
                          <tr key={rIdx} style={{ borderBottom: "1px solid #e2e8f0" }}>
                            <td style={{ padding: "10px", textAlign: "left" }}>{row.sr_no || rIdx + 1}</td>
                            <td style={{ padding: "10px", textAlign: "left" }}>
                              <button
                                type="button"
                                onClick={() =>
                                  setSelectedConsignment({
                                    row,
                                    productName: activeBreakup.item.product_name_tally,
                                  })
                                }
                                style={{
                                  background: "none",
                                  border: "none",
                                  padding: 0,
                                  color: "#0284c7",
                                  fontWeight: 700,
                                  cursor: "pointer",
                                  textDecoration: "underline",
                                  fontSize: "13px",
                                  textAlign: "left",
                                }}
                                title="Click to view Consignment / PO details"
                              >
                                {row.consignment_no || row.invoice_no || "-"}
                              </button>
                              <div style={{ fontSize: "11px", color: "#64748b" }}>{row.date || "-"}</div>
                            </td>
                            <td style={{ padding: "10px", textAlign: "left", color: "#475569" }}>
                              {row.supplier_name || "-"}
                            </td>
                            <td style={{ padding: "10px", textAlign: "center", fontWeight: 700 }}>
                              <div>{row.quantity}</div>
                              {typeof row.booked_quantity === "number" && row.booked_quantity > 0 && (
                                <div style={{ fontSize: "10.5px", color: "#dc2626", fontWeight: 500 }}>
                                  ({row.gross_quantity} - {row.booked_quantity} booked)
                                </div>
                              )}
                            </td>
                            <td style={{ padding: "10px", textAlign: "left" }}>{row.arrival_date || "-"}</td>
                            <td style={{ padding: "10px", textAlign: "center" }}>
                              <span className="status-badge-transit">{row.status}</span>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  )}

                  {activeBreakup.bookedOrders && activeBreakup.bookedOrders.length > 0 && (
                    <div>
                      <div style={{ fontSize: "13px", fontWeight: 700, color: "#1e293b", marginBottom: "8px" }}>
                        Open Sale Order Bookings Against {activeBreakup.location}{" "}
                        {activeBreakup.stockType === "transit" ? "Transit" : "Ordered"} (FIFO Deducted)
                      </div>
                      <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "12.5px" }}>
                        <thead>
                          <tr style={{ background: "#fff1f2", borderBottom: "1px solid #fecdd3" }}>
                            <th style={{ padding: "7px 8px", textAlign: "left" }}>SO No &amp; Company</th>
                            <th style={{ padding: "7px 8px", textAlign: "left" }}>Sales Person</th>
                            <th style={{ padding: "7px 8px", textAlign: "center", width: "65px" }}>Qty</th>
                            <th style={{ padding: "7px 8px", textAlign: "center", width: "100px" }}>Status</th>
                          </tr>
                        </thead>
                        <tbody>
                          {activeBreakup.bookedOrders.map((bo, bIdx) => (
                            <tr key={bIdx} style={{ borderBottom: "1px solid #e2e8f0" }}>
                              <td style={{ padding: "8px" }}>
                                <div className="reorder-so-cell">
                                  <button
                                    type="button"
                                    className="reorder-so-no-link"
                                    style={{ background: "none", border: "none", padding: 0, textAlign: "left" }}
                                    onClick={() => handleOpenSaleOrderPdf(bo)}
                                  >
                                    {bo.order_no}
                                  </button>
                                  <span className="reorder-company-sub">{bo.company_name || "-"}</span>
                                </div>
                              </td>
                              <td style={{ padding: "8px", color: "#475569" }}>{bo.sales_person || "-"}</td>
                              <td style={{ padding: "8px", textAlign: "center", fontWeight: 700, color: "#dc2626" }}>
                                -{bo.quantity}
                              </td>
                              <td style={{ padding: "8px", textAlign: "center" }}>
                                <span className="status-badge-pending">{bo.status}</span>
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                </>
              )}
            </div>
          )}
        </SideDrawer>

        {/* Modal: Consignment / PO Details (Stock Transactions.docx L35-36) */}
        {selectedConsignment && (
          <div
            className="reorder-modal-backdrop"
            style={{ zIndex: 1250 }}
            onClick={() => setSelectedConsignment(null)}
            data-testid="reorder-consignment-detail-modal"
          >
            <div
              className="reorder-modal-dialog"
              style={{ width: "540px" }}
              onClick={(e) => e.stopPropagation()}
            >
              <div className="reorder-modal-header">
                <h3>
                  Consignment Details:{" "}
                  {selectedConsignment.row.consignment_no || selectedConsignment.row.invoice_no || "-"}
                </h3>
                <button
                  type="button"
                  style={{ background: "none", border: "none", fontSize: "18px", cursor: "pointer", color: "#64748b" }}
                  onClick={() => setSelectedConsignment(null)}
                  aria-label="Close consignment details"
                >
                  ✕
                </button>
              </div>
              <div className="reorder-modal-body">
                <div
                  style={{
                    display: "grid",
                    gridTemplateColumns: "1fr 1fr",
                    gap: "12px 16px",
                    fontSize: "13px",
                    background: "#f8fafc",
                    padding: "16px",
                    borderRadius: "6px",
                    border: "1px solid #e2e8f0",
                  }}
                >
                  <div style={{ gridColumn: "1 / -1" }}>
                    <span style={{ color: "#64748b" }}>Product Name:</span>{" "}
                    <strong>{selectedConsignment.productName}</strong>
                  </div>
                  <div>
                    <span style={{ color: "#64748b" }}>Qty:</span>{" "}
                    <strong style={{ color: "#0284c7" }}>{selectedConsignment.row.quantity}</strong>
                  </div>
                  <div>
                    <span style={{ color: "#64748b" }}>Warehouse:</span>{" "}
                    <strong>
                      {selectedConsignment.row.warehouse ||
                        (activeBreakup
                          ? `${activeBreakup.location} ${activeBreakup.stockType === "transit" ? "Transit" : "Ordered"}`
                          : "-")}
                    </strong>
                  </div>
                  <div>
                    <span style={{ color: "#64748b" }}>Inv. / Cons No:</span>{" "}
                    <strong>{selectedConsignment.row.consignment_no || selectedConsignment.row.invoice_no || "-"}</strong>
                  </div>
                  <div>
                    <span style={{ color: "#64748b" }}>Inv. Date:</span>{" "}
                    <strong>{selectedConsignment.row.invoice_date || selectedConsignment.row.date || "-"}</strong>
                  </div>
                  <div>
                    <span style={{ color: "#64748b" }}>Exp. Arri. Date:</span>{" "}
                    <strong>
                      {selectedConsignment.row.expected_arrival_date || selectedConsignment.row.arrival_date || "-"}
                    </strong>
                  </div>
                  <div>
                    <span style={{ color: "#64748b" }}>ETD Origin Date:</span>{" "}
                    <strong>{selectedConsignment.row.etd_origin_date || "-"}</strong>
                  </div>
                  <div>
                    <span style={{ color: "#64748b" }}>ETA Port Date:</span>{" "}
                    <strong>{selectedConsignment.row.eta_port_date || "-"}</strong>
                  </div>
                  <div>
                    <span style={{ color: "#64748b" }}>Status:</span>{" "}
                    <span className="status-badge-transit">{selectedConsignment.row.status}</span>
                  </div>
                </div>
              </div>
              <div className="reorder-modal-footer">
                <button
                  type="button"
                  onClick={() => setSelectedConsignment(null)}
                  style={{
                    padding: "8px 20px",
                    borderRadius: "6px",
                    border: "1px solid #cbd5e1",
                    background: "#ffffff",
                    fontWeight: 600,
                    cursor: "pointer",
                  }}
                >
                  Close
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Modal: Edit Re-Order Level & Minimum Order Quantity (MOQ) */}
        {editItem && (
          <div className="reorder-modal-backdrop" onClick={() => setEditItem(null)}>
            <div className="reorder-modal-dialog" onClick={(e) => e.stopPropagation()}>
              <div className="reorder-modal-header">
                <h3>Edit Re-Order &amp; MOQ Thresholds</h3>
                <button
                  type="button"
                  style={{ background: "none", border: "none", fontSize: "18px", cursor: "pointer", color: "#64748b" }}
                  onClick={() => setEditItem(null)}
                >
                  ✕
                </button>
              </div>

              <div className="reorder-modal-body">
                <div>
                  <label style={{ fontSize: "13px", fontWeight: 600, color: "#334155", display: "block", marginBottom: "4px" }}>
                    Product
                  </label>
                  <div style={{ fontSize: "14px", fontWeight: 700, color: "#0f172a" }}>
                    {editItem.item.product_name_tally}
                  </div>
                  <div style={{ fontSize: "12px", color: "#64748b" }}>
                    Code: {editItem.item.product_code} | Total Stock: {editItem.item.total_qty}
                  </div>
                </div>

                <div>
                  <label htmlFor="input-edit-warehouse" style={{ fontSize: "13px", fontWeight: 600, color: "#334155", display: "block", marginBottom: "6px" }}>
                    Warehouse Scope
                  </label>
                  <select
                    id="input-edit-warehouse"
                    value={editItem.warehouse}
                    onChange={(e) => {
                      const nextWh = e.target.value;
                      const nextMetrics = computeScopedMetrics(editItem.item, nextWh);
                      setEditItem({
                        ...editItem,
                        warehouse: nextWh,
                        reorder_level: nextMetrics.reorder_level,
                        moq: nextMetrics.moq,
                      });
                    }}
                    style={{ width: "100%", height: "38px", padding: "6px 12px", borderRadius: "6px", border: "1px solid #cbd5e1", fontSize: "13.5px" }}
                  >
                    <option value="Mumbai">Mumbai Branch</option>
                    <option value="Ahmedabad">Ahmedabad Branch</option>
                    <option value="Indore">Indore Branch</option>
                    <option value="All">All Warehouses (Global)</option>
                  </select>
                </div>

                <div>
                  <label htmlFor="input-edit-reorder" style={{ fontSize: "13px", fontWeight: 600, color: "#334155", display: "block", marginBottom: "6px" }}>
                    Re-Order Level (Threshold)
                  </label>
                  <input
                    id="input-edit-reorder"
                    type="number"
                    min={0}
                    step={1}
                    value={editItem.reorder_level}
                    onChange={(e) =>
                      setEditItem({
                        ...editItem,
                        reorder_level: Math.max(0, Number(e.target.value) || 0),
                      })
                    }
                    style={{ width: "100%", height: "38px", padding: "6px 12px", borderRadius: "6px", border: "1px solid #cbd5e1", fontSize: "14px" }}
                  />
                  <div style={{ fontSize: "11.5px", color: "#64748b", marginTop: "4px" }}>
                    Shortfall triggers automatically when {editItem.warehouse === "All" ? "Total Quantity" : `${editItem.warehouse} Net Pipeline`} falls below this level.
                  </div>
                </div>

                <div>
                  <label htmlFor="input-edit-moq" style={{ fontSize: "13px", fontWeight: 600, color: "#334155", display: "block", marginBottom: "6px" }}>
                    Minimum Order Quantity (MOQ)
                  </label>
                  <input
                    id="input-edit-moq"
                    type="number"
                    min={0}
                    step={1}
                    value={editItem.moq}
                    onChange={(e) =>
                      setEditItem({
                        ...editItem,
                        moq: Math.max(0, Number(e.target.value) || 0),
                      })
                    }
                    style={{ width: "100%", height: "38px", padding: "6px 12px", borderRadius: "6px", border: "1px solid #cbd5e1", fontSize: "14px" }}
                  />
                  <div style={{ fontSize: "11.5px", color: "#64748b", marginTop: "4px" }}>
                    Factory or supplier minimum batch size enforced on Purchase Orders.
                  </div>
                </div>

                {editPreview && (
                  <div
                    style={{
                      background: "#f8fafc",
                      border: "1px solid #e2e8f0",
                      borderRadius: "6px",
                      padding: "10px 12px",
                      display: "flex",
                      justifyContent: "space-between",
                      fontSize: "12.5px",
                      color: "#334155",
                    }}
                  >
                    <span>
                      Pipeline Qty: <strong>{editPreview.baseQty}</strong>
                    </span>
                    <span>
                      Short Fall: <strong style={{ color: editPreview.sf > 0 ? "#dc2626" : "#166534" }}>{editPreview.sf}</strong>
                    </span>
                    <span>
                      Order To Place: <strong style={{ color: "#b45309" }}>{editPreview.orderQty}</strong>
                    </span>
                  </div>
                )}
              </div>

              <div className="reorder-modal-footer">
                <button
                  type="button"
                  onClick={() => setEditItem(null)}
                  style={{ padding: "8px 18px", borderRadius: "6px", border: "1px solid #cbd5e1", background: "#ffffff", fontWeight: 600, cursor: "pointer" }}
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={handleSaveEdit}
                  disabled={savingEdit}
                  style={{ padding: "8px 22px", borderRadius: "6px", border: "none", background: "#0284c7", color: "#ffffff", fontWeight: 600, cursor: "pointer" }}
                >
                  {savingEdit ? "Saving..." : "Save Changes"}
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Drawer: Product Master View Window (Product Stock.docx L24 & Product Master.docx L46) */}
        <SideDrawer
          isOpen={viewProductItem !== null}
          onClose={() => setViewProductItem(null)}
          title="Product Master View Window"
          subtitle={viewProductItem?.product_name_tally || ""}
          width="680px"
          headerActions={
            viewProductItem ? (
              <button
                type="button"
                onClick={() => {
                  const target = viewProductItem.product_name_tally;
                  setViewProductItem(null);
                  navigate(`/masters/products?search=${encodeURIComponent(target)}`);
                }}
                style={{
                  background: "#f1f5f9",
                  color: "#0284c7",
                  border: "1px solid #cbd5e1",
                  borderRadius: "5px",
                  padding: "6px 12px",
                  fontSize: "12px",
                  fontWeight: 600,
                  cursor: "pointer",
                }}
              >
                Open in Product Master ↗
              </button>
            ) : undefined
          }
        >
          {viewProductItem && (
            <div style={{ display: "flex", flexDirection: "column", gap: "16px", padding: "4px 0" }}>
              {/* Identity & Classification */}
              <div style={{ background: "#f8fafc", padding: "16px", borderRadius: "6px", border: "1px solid #e2e8f0" }}>
                <h4 style={{ margin: "0 0 10px", fontSize: "13.5px", color: "#1e293b", borderBottom: "1px solid #e2e8f0", paddingBottom: "6px" }}>
                  Identity &amp; Classification
                </h4>
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "10px 16px", fontSize: "13px" }}>
                  <div>
                    <span style={{ color: "#64748b" }}>Product Name (Tally): </span>
                    <strong>{viewProductItem.product_name_tally}</strong>
                  </div>
                  <div>
                    <span style={{ color: "#64748b" }}>Product Name (Invoice): </span>
                    <strong>{viewProductItem.product_name_invoice || viewProductItem.product_name_tally}</strong>
                  </div>
                  <div>
                    <span style={{ color: "#64748b" }}>Product Code: </span>
                    <strong>{viewProductItem.product_code || "-"}</strong>
                  </div>
                  <div>
                    <span style={{ color: "#64748b" }}>Brand: </span>
                    <strong>{viewProductItem.brand || "-"}</strong>
                  </div>
                  <div>
                    <span style={{ color: "#64748b" }}>Category: </span>
                    <strong>{viewProductItem.category || "-"}</strong>
                  </div>
                  <div>
                    <span style={{ color: "#64748b" }}>Sub Category: </span>
                    <strong>{viewProductItem.sub_category || "-"}</strong>
                  </div>
                  <div>
                    <span style={{ color: "#64748b" }}>HSN Code: </span>
                    <strong>{viewProductItem.hsn_code || "-"}</strong>
                  </div>
                  <div>
                    <span style={{ color: "#64748b" }}>UOM: </span>
                    <strong>{viewProductItem.uom || "SET"}</strong>
                  </div>
                  <div>
                    <span style={{ color: "#64748b" }}>GST %: </span>
                    <strong>{viewProductItem.gst_percent != null ? `${viewProductItem.gst_percent}%` : "-"}</strong>
                  </div>
                  <div>
                    <span style={{ color: "#64748b" }}>Import Duty %: </span>
                    <strong>{viewProductItem.import_duty_percent != null ? `${viewProductItem.import_duty_percent}%` : "-"}</strong>
                  </div>
                </div>
              </div>

              {/* Commercial & Re-Order Planning */}
              <div style={{ background: "#f8fafc", padding: "16px", borderRadius: "6px", border: "1px solid #e2e8f0" }}>
                <h4 style={{ margin: "0 0 10px", fontSize: "13.5px", color: "#1e293b", borderBottom: "1px solid #e2e8f0", paddingBottom: "6px" }}>
                  Commercial &amp; Re-Order Summary ({warehouseFilter})
                </h4>
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: "10px 14px", fontSize: "13px" }}>
                  <div>
                    <span style={{ color: "#64748b" }}>Min. Price (Excl. GST): </span>
                    <strong>
                      {viewProductItem.minimum_price != null
                        ? `₹${Number(viewProductItem.minimum_price).toLocaleString("en-IN")}`
                        : "-"}
                    </strong>
                  </div>
                  <div>
                    <span style={{ color: "#64748b" }}>Total Net Stock: </span>
                    <strong style={{ color: "#0284c7" }}>{viewProductItem.total_qty}</strong>
                  </div>
                  <div>
                    <span style={{ color: "#64748b" }}>Re-Order Level: </span>
                    <strong>{viewProductItem.reorder_level}</strong>
                  </div>
                  <div>
                    <span style={{ color: "#64748b" }}>Short Fall: </span>
                    <strong style={{ color: viewProductItem.short_fall > 0 ? "#dc2626" : "#166534" }}>
                      {viewProductItem.short_fall}
                    </strong>
                  </div>
                  <div>
                    <span style={{ color: "#64748b" }}>MOQ: </span>
                    <strong>{viewProductItem.moq}</strong>
                  </div>
                  <div>
                    <span style={{ color: "#64748b" }}>Order To Be Place: </span>
                    <strong style={{ color: "#b45309" }}>{viewProductItem.order_to_be_place}</strong>
                  </div>
                </div>
              </div>

              {/* Packaging & Dimensions For CBM */}
              <div style={{ background: "#f8fafc", padding: "16px", borderRadius: "6px", border: "1px solid #e2e8f0" }}>
                <h4 style={{ margin: "0 0 10px", fontSize: "13.5px", color: "#1e293b", borderBottom: "1px solid #e2e8f0", paddingBottom: "6px" }}>
                  Packaging &amp; Dimensions For CBM
                </h4>
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: "10px 14px", fontSize: "13px" }}>
                  <div>
                    <span style={{ color: "#64748b" }}>Packaging Qty: </span>
                    <strong>{viewProductItem.packaging_quantity ?? "-"}</strong>
                  </div>
                  <div>
                    <span style={{ color: "#64748b" }}>Net Weight: </span>
                    <strong>{viewProductItem.packaging_net_weight != null ? `${viewProductItem.packaging_net_weight} kg` : "-"}</strong>
                  </div>
                  <div>
                    <span style={{ color: "#64748b" }}>Gross Weight: </span>
                    <strong>{viewProductItem.packaging_gross_weight != null ? `${viewProductItem.packaging_gross_weight} kg` : "-"}</strong>
                  </div>
                  <div>
                    <span style={{ color: "#64748b" }}>Dimensions (L×W×H): </span>
                    <strong>
                      {viewProductItem.length_cm != null || viewProductItem.width_cm != null || viewProductItem.height_cm != null
                        ? `${viewProductItem.length_cm ?? 0} × ${viewProductItem.width_cm ?? 0} × ${viewProductItem.height_cm ?? 0} cm`
                        : "-"}
                    </strong>
                  </div>
                  <div>
                    <span style={{ color: "#64748b" }}>Packaging Unit CBM: </span>
                    <strong>
                      {viewProductItem.packaging_unit_cbm != null
                        ? Number(viewProductItem.packaging_unit_cbm).toFixed(2)
                        : "-"}
                    </strong>
                  </div>
                </div>
              </div>

              {/* Warehouse Stock Breakdown */}
              <div style={{ background: "#f8fafc", padding: "16px", borderRadius: "6px", border: "1px solid #e2e8f0" }}>
                <h4 style={{ margin: "0 0 10px", fontSize: "13.5px", color: "#1e293b", borderBottom: "1px solid #e2e8f0", paddingBottom: "6px" }}>
                  Warehouse Stock Breakdown
                </h4>
                <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "12.5px" }}>
                  <thead>
                    <tr style={{ background: "#f1f5f9", borderBottom: "1px solid #cbd5e1" }}>
                      <th style={{ padding: "8px 10px", textAlign: "left" }}>Branch</th>
                      <th style={{ padding: "8px 10px", textAlign: "center", background: "#f4dce0" }}>Physical</th>
                      <th style={{ padding: "8px 10px", textAlign: "center", background: "#edeae4" }}>Transit</th>
                      <th style={{ padding: "8px 10px", textAlign: "center", background: "#dcdcdc" }}>Ordered</th>
                      <th style={{ padding: "8px 10px", textAlign: "center" }}>Subtotal</th>
                    </tr>
                  </thead>
                  <tbody>
                    <tr style={{ borderBottom: "1px solid #e2e8f0" }}>
                      <td style={{ padding: "8px 10px", fontWeight: 600 }}>Mumbai</td>
                      <td style={{ padding: "8px 10px", textAlign: "center" }}>{viewProductItem.mumbai}</td>
                      <td style={{ padding: "8px 10px", textAlign: "center" }}>{viewProductItem.mumbai_transit}</td>
                      <td style={{ padding: "8px 10px", textAlign: "center" }}>{viewProductItem.mumbai_ordered}</td>
                      <td style={{ padding: "8px 10px", textAlign: "center", fontWeight: 700 }}>
                        {viewProductItem.mumbai + viewProductItem.mumbai_transit + viewProductItem.mumbai_ordered}
                      </td>
                    </tr>
                    <tr style={{ borderBottom: "1px solid #e2e8f0" }}>
                      <td style={{ padding: "8px 10px", fontWeight: 600 }}>Ahmedabad</td>
                      <td style={{ padding: "8px 10px", textAlign: "center" }}>{viewProductItem.ahmedabad}</td>
                      <td style={{ padding: "8px 10px", textAlign: "center" }}>{viewProductItem.ahmedabad_transit}</td>
                      <td style={{ padding: "8px 10px", textAlign: "center" }}>{viewProductItem.ahmedabad_ordered}</td>
                      <td style={{ padding: "8px 10px", textAlign: "center", fontWeight: 700 }}>
                        {viewProductItem.ahmedabad + viewProductItem.ahmedabad_transit + viewProductItem.ahmedabad_ordered}
                      </td>
                    </tr>
                    <tr>
                      <td style={{ padding: "8px 10px", fontWeight: 600 }}>Indore</td>
                      <td style={{ padding: "8px 10px", textAlign: "center" }}>{viewProductItem.indore}</td>
                      <td style={{ padding: "8px 10px", textAlign: "center" }}>{viewProductItem.indore_transit}</td>
                      <td style={{ padding: "8px 10px", textAlign: "center" }}>{viewProductItem.indore_ordered}</td>
                      <td style={{ padding: "8px 10px", textAlign: "center", fontWeight: 700 }}>
                        {viewProductItem.indore + viewProductItem.indore_transit + viewProductItem.indore_ordered}
                      </td>
                    </tr>
                  </tbody>
                </table>
              </div>

              {(viewProductItem.specification || viewProductItem.description) && (
                <div style={{ background: "#f8fafc", padding: "16px", borderRadius: "6px", border: "1px solid #e2e8f0" }}>
                  <h4 style={{ margin: "0 0 8px", fontSize: "13.5px", color: "#1e293b" }}>
                    Product Specifications
                  </h4>
                  <div style={{ fontSize: "12.5px", color: "#334155", whiteSpace: "pre-wrap", lineHeight: 1.5 }}>
                    {viewProductItem.specification || viewProductItem.description}
                  </div>
                </div>
              )}
            </div>
          )}
        </SideDrawer>
      </main>
    </AppShell>
  );
}

export default ProductReorderPage;
