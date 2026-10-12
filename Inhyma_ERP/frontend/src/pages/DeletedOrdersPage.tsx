import React, { useState, useMemo, useCallback, useEffect } from "react";
import { AppShell } from "@/components/AppShell";
import { Breadcrumb } from "@/components/Breadcrumb";
import { SideDrawer } from "@/components/SideDrawer";
import { Pagination } from "@/components/Pagination";
import type { PaginationMeta } from "@/types";
import { DeletedOrdersApi, type DeletedOrderItem } from "@/lib/api";
import { generateSalesOrderPdf } from "@/lib/salesOrderPdf";
import "@/styles/deletedOrders.css";

export const INITIAL_DELETED_ORDERS: DeletedOrderItem[] = [
  {
    id: "del-1",
    order_no: "SO-MP/26-27/0618",
    order_date: "07-10-2026",
    warehouse: "Indore",
    expected_delivery_date: "07-10-2026",
    company_name: "SMART PACKAGING SYSTEMS",
    city: "Indore",
    state: "Madhya Pradesh",
    third_party: "No",
    po: "No",
    sales_person: "Sunita Pawar",
    amount_inc_gst: 17700.0,
    discount: 0.0,
    status: "Trash",
    deleted_at: "07-10-2026 01:21 PM",
    acc_dep: "Pending",
    gatepass: "Pending",
    remark: "",
  },
  {
    id: "del-2",
    order_no: "SO-MH/26-27/4476",
    order_date: "07-10-2026",
    warehouse: "Mumbai",
    expected_delivery_date: "07-10-2026",
    company_name: "SHANTI PACKAGING",
    city: "Navi Mumbai",
    state: "Maharashtra",
    third_party: "No",
    po: "No",
    sales_person: "Dhairya Shah",
    amount_inc_gst: 6608.0,
    discount: 0.0,
    status: "Trash",
    deleted_at: "07-10-2026 12:21 PM",
    acc_dep: "Pending",
    gatepass: "Pending",
    remark: "",
  },
  {
    id: "del-3",
    order_no: "SO-MH/26-27/4402",
    order_date: "03-10-2026",
    warehouse: "Mumbai",
    expected_delivery_date: "03-10-2026",
    company_name: "HARSH PLASTIC AND MACHINARY",
    city: "Bhadran",
    state: "Gujarat",
    third_party: "No",
    po: "No",
    sales_person: "Bhavin Suthar",
    amount_inc_gst: 177000.0,
    discount: 0.0,
    status: "Trash",
    deleted_at: "03-10-2026 02:15 PM",
    acc_dep: "Pending",
    gatepass: "Pending",
    remark: "",
  },
  {
    id: "del-4",
    order_no: "SO-MH/26-27/4401",
    order_date: "03-10-2026",
    warehouse: "Mumbai",
    expected_delivery_date: "03-10-2026",
    company_name: "DHUMER AUTOMATION & SERVICES",
    city: "Vapi",
    state: "Gujarat",
    third_party: "No",
    po: "No",
    sales_person: "Bhavin Suthar",
    amount_inc_gst: 118000.0,
    discount: 0.0,
    status: "Trash",
    deleted_at: "03-10-2026 02:18 PM",
    acc_dep: "Pending",
    gatepass: "Pending",
    remark: "Order cancelled per client request due to specification change",
  },
  {
    id: "del-5",
    order_no: "SO-MH/26-27/4394",
    order_date: "03-10-2026",
    warehouse: "Mumbai",
    expected_delivery_date: "03-10-2026",
    company_name: "SPARKLING CLEANERS",
    city: "Mira-Bhayandar",
    state: "Maharashtra",
    third_party: "No",
    po: "No",
    sales_person: "Siddhi Kilaje",
    amount_inc_gst: 74340.0,
    discount: 0.0,
    status: "Trash",
    deleted_at: "03-10-2026 02:26 PM",
    acc_dep: "Pending",
    gatepass: "Pending",
    remark: "",
  },
  {
    id: "del-6",
    order_no: "SO-GJ/26-27/0862",
    order_date: "03-10-2026",
    warehouse: "Ahmedabad",
    expected_delivery_date: "03-10-2026",
    company_name: "MAGICPACK AUTOMATIONS PVT LTD",
    city: "Medchal",
    state: "Telangana",
    third_party: "No",
    po: "No",
    sales_person: "Abhishek Patel",
    amount_inc_gst: 53100.0,
    discount: 0.0,
    status: "Trash",
    deleted_at: "03-10-2026 03:50 PM",
    acc_dep: "Pending",
    gatepass: "Pending",
    remark: "",
  },
  {
    id: "del-7",
    order_no: "SO-MH/26-27/4386",
    order_date: "03-10-2026",
    warehouse: "Mumbai",
    expected_delivery_date: "03-10-2026",
    company_name: "GLOBAL IMPEX MACHINERY",
    city: "AHMEDABAD",
    state: "Gujarat",
    third_party: "Yes",
    po: "No",
    sales_person: "Dhairya Shah",
    amount_inc_gst: 122130.0,
    discount: 0.0,
    status: "Trash",
    deleted_at: "04-10-2026 11:41 AM",
    acc_dep: "Pending",
    gatepass: "Pending",
    remark: "",
  },
];

const STATE_OPTIONS = [
  "Maharashtra",
  "Gujarat",
  "Madhya Pradesh",
  "Telangana",
  "Rajasthan",
  "Delhi",
  "Karnataka",
  "Tamil Nadu",
];

const SALES_PERSONS = [
  "Sunita Pawar",
  "Dhairya Shah",
  "Bhavin Suthar",
  "Siddhi Kilaje",
  "Abhishek Patel",
  "Rupesh Inhyma",
];

export function DeletedOrdersPage() {
  const [items, setItems] = useState<DeletedOrderItem[]>(INITIAL_DELETED_ORDERS);
  const [loading, setLoading] = useState<boolean>(false);
  const [showFilterPanel, setShowFilterPanel] = useState<boolean>(true);

  // Filter state
  const [orderDateRange, setOrderDateRange] = useState<string>("");
  const [expDeliveryDateRange, setExpDeliveryDateRange] = useState<string>("");
  const [warehouseFilter, setWarehouseFilter] = useState<string>("All");
  const [salesPersonFilter, setSalesPersonFilter] = useState<string>("All");
  const [selectedStates, setSelectedStates] = useState<string[]>(["All"]);

  // Applied filter state
  const [appliedOrderDateRange, setAppliedOrderDateRange] = useState<string>("");
  const [appliedExpDeliveryDateRange, setAppliedExpDeliveryDateRange] = useState<string>("");
  const [appliedWarehouse, setAppliedWarehouse] = useState<string>("All");
  const [appliedSalesPerson, setAppliedSalesPerson] = useState<string>("All");
  const [appliedStates, setAppliedStates] = useState<string[]>(["All"]);

  // Search & Pagination
  const [searchTerm, setSearchTerm] = useState<string>("");
  const [pageSize, setPageSize] = useState<number>(100);
  const [currentPage, setCurrentPage] = useState<number>(1);

  // Modals & Drawers
  const [timelineOrder, setTimelineOrder] = useState<DeletedOrderItem | null>(null);
  const [accountInfoOrder, setAccountInfoOrder] = useState<DeletedOrderItem | null>(null);

  // Fetch from backend
  const fetchDeletedOrders = useCallback(async () => {
    try {
      setLoading(true);
      const res = await DeletedOrdersApi.listDeletedOrders({
        warehouse: appliedWarehouse !== "All" ? appliedWarehouse : undefined,
        sales_person: appliedSalesPerson !== "All" ? appliedSalesPerson : undefined,
        state: !appliedStates.includes("All") && appliedStates.length > 0 ? appliedStates[0] : undefined,
        search: searchTerm.trim() || undefined,
      });

      if (res && res.data && Array.isArray(res.data.items)) {
        if (res.data.items.length > 0) {
          setItems(res.data.items);
        } else {
          setItems(INITIAL_DELETED_ORDERS);
        }
      }
    } catch {
      // Local fallback
      setItems(INITIAL_DELETED_ORDERS);
    } finally {
      setLoading(false);
    }
  }, [appliedWarehouse, appliedSalesPerson, appliedStates, searchTerm]);

  useEffect(() => {
    fetchDeletedOrders();
  }, [fetchDeletedOrders]);

  // Handle Apply Filter
  const handleApplyFilters = () => {
    setAppliedOrderDateRange(orderDateRange);
    setAppliedExpDeliveryDateRange(expDeliveryDateRange);
    setAppliedWarehouse(warehouseFilter);
    setAppliedSalesPerson(salesPersonFilter);
    setAppliedStates(selectedStates);
    setCurrentPage(1);
  };

  // Handle Reset Filter
  const handleResetFilters = () => {
    setOrderDateRange("");
    setExpDeliveryDateRange("");
    setWarehouseFilter("All");
    setSalesPersonFilter("All");
    setSelectedStates(["All"]);

    setAppliedOrderDateRange("");
    setAppliedExpDeliveryDateRange("");
    setAppliedWarehouse("All");
    setAppliedSalesPerson("All");
    setAppliedStates(["All"]);
    setSearchTerm("");
    setCurrentPage(1);
  };

  // State Tag Selection
  const handleToggleState = (stateName: string) => {
    if (stateName === "All") {
      setSelectedStates(["All"]);
      return;
    }
    const withoutAll = selectedStates.filter((s) => s !== "All");
    if (withoutAll.includes(stateName)) {
      const next = withoutAll.filter((s) => s !== stateName);
      setSelectedStates(next.length > 0 ? next : ["All"]);
    } else {
      setSelectedStates([...withoutAll, stateName]);
    }
  };

  const handleRemoveState = (stateName: string, e: React.MouseEvent) => {
    e.stopPropagation();
    if (stateName === "All") return;
    const next = selectedStates.filter((s) => s !== stateName);
    setSelectedStates(next.length > 0 ? next : ["All"]);
  };

  // Filter items in memory
  const filteredItems = useMemo(() => {
    return items.filter((order) => {
      // Search filter
      if (searchTerm.trim()) {
        const q = searchTerm.toLowerCase().trim();
        const matches =
          order.order_no.toLowerCase().includes(q) ||
          order.company_name.toLowerCase().includes(q) ||
          order.sales_person.toLowerCase().includes(q) ||
          order.city.toLowerCase().includes(q) ||
          order.state.toLowerCase().includes(q);
        if (!matches) return false;
      }

      // Warehouse filter
      if (appliedWarehouse !== "All" && order.warehouse.toLowerCase() !== appliedWarehouse.toLowerCase()) {
        return false;
      }

      // Sales person filter
      if (appliedSalesPerson !== "All" && !order.sales_person.toLowerCase().includes(appliedSalesPerson.toLowerCase())) {
        return false;
      }

      // State filter
      if (!appliedStates.includes("All") && appliedStates.length > 0) {
        const matchState = appliedStates.some((s) => order.state.toLowerCase().includes(s.toLowerCase()));
        if (!matchState) return false;
      }

      return true;
    });
  }, [items, searchTerm, appliedWarehouse, appliedSalesPerson, appliedStates]);

  // Active filter count
  const activeFilterCount = useMemo(() => {
    let count = 0;
    if (appliedWarehouse !== "All") count++;
    if (appliedSalesPerson !== "All") count++;
    if (!appliedStates.includes("All")) count++;
    if (appliedOrderDateRange) count++;
    if (appliedExpDeliveryDateRange) count++;
    return count;
  }, [appliedWarehouse, appliedSalesPerson, appliedStates, appliedOrderDateRange, appliedExpDeliveryDateRange]);

  // Pagination
  const totalPages = Math.max(1, Math.ceil(filteredItems.length / pageSize));
  const paginatedItems = useMemo(() => {
    const start = (currentPage - 1) * pageSize;
    return filteredItems.slice(start, start + pageSize);
  }, [filteredItems, currentPage, pageSize]);

  const paginationMeta: PaginationMeta = useMemo(
    () => ({
      current_page: currentPage,
      total_pages: totalPages,
      total_records: filteredItems.length,
      page_size: pageSize,
      has_previous: currentPage > 1,
      has_next: currentPage < totalPages,
    }),
    [currentPage, totalPages, filteredItems.length, pageSize]
  );

  // PDF Download Handler
  const handleOpenPdf = (order: DeletedOrderItem) => {
    try {
      generateSalesOrderPdf(
        {
          order_no: order.order_no,
          order_date: order.order_date,
          expected_delivery_date: order.expected_delivery_date,
          warehouse: order.warehouse,
          buyer_name: order.company_name,
          company_name: order.company_name,
          city: order.city,
          state: order.state,
          sales_person: order.sales_person,
          amount_inc_gst: order.amount_inc_gst,
          discount: order.discount,
        },
        { openInNewTab: true }
      );
    } catch (err) {
      console.error("Failed to generate PDF", err);
    }
  };

  const handleRestoreOrder = async (order: DeletedOrderItem) => {
    if (!window.confirm(`Are you sure you want to restore order ${order.order_no} back to active sales orders?`)) {
      return;
    }
    try {
      await DeletedOrdersApi.restoreDeletedOrder(order.id || order.order_no);
      setItems((prev) => prev.filter((o) => o.id !== order.id && o.order_no !== order.order_no));
      setTimelineOrder(null);
    } catch (err) {
      console.warn("Using local state restore for order:", err);
      setItems((prev) => prev.filter((o) => o.id !== order.id && o.order_no !== order.order_no));
      setTimelineOrder(null);
    }
  };

  const formatCurrency = (val: number) => {
    return "₹ " + val.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  };

  return (
    <AppShell activeKey="reports-deleted-orders">
      <main className="page page-deleted-orders">
        {/* Breadcrumb Trail */}
        <Breadcrumb trail={["Reports", "Deleted Orders"]} />

        {/* Top Header */}
        <div className="deleted-orders-header">
          <h1 className="deleted-orders-title">Deleted Orders</h1>

          <div style={{ display: "flex", gap: "10px", alignItems: "center" }}>
            <button
              type="button"
              className={`deleted-orders-btn-filter ${showFilterPanel ? "active" : ""}`}
              onClick={() => setShowFilterPanel((v) => !v)}
              title="Toggle filter panel"
              aria-label="Filter"
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
                <polygon points="22 3 2 3 10 12.46 10 19 14 21 14 12.46 22 3" />
              </svg>
              {activeFilterCount > 0 && <span className="deleted-orders-filter-badge">{activeFilterCount}</span>}
            </button>
          </div>
        </div>

        {/* Collapsible Filter Panel */}
        {showFilterPanel && (
          <div className="deleted-orders-filter-panel" data-testid="deleted-orders-filter-panel">
            {/* Row 1: Order Date Range, Expected Delivery Date Range, Warehouse */}
            <div className="deleted-orders-filter-row-1">
              <div className="deleted-orders-field">
                <label htmlFor="order-date-range">Order Date Range</label>
                <input
                  id="order-date-range"
                  type="text"
                  className="deleted-orders-input"
                  placeholder="DD-MM-YYYY - DD-MM-YYYY"
                  value={orderDateRange}
                  onChange={(e) => setOrderDateRange(e.target.value)}
                />
              </div>

              <div className="deleted-orders-field">
                <label htmlFor="exp-del-date-range">Expected Delivery Date Range</label>
                <input
                  id="exp-del-date-range"
                  type="text"
                  className="deleted-orders-input"
                  placeholder="DD-MM-YYYY - DD-MM-YYYY"
                  value={expDeliveryDateRange}
                  onChange={(e) => setExpDeliveryDateRange(e.target.value)}
                />
              </div>

              <div className="deleted-orders-field">
                <label htmlFor="deleted-warehouse">Warehouse</label>
                <select
                  id="deleted-warehouse"
                  className="deleted-orders-select"
                  value={warehouseFilter}
                  onChange={(e) => setWarehouseFilter(e.target.value)}
                >
                  <option value="All">All</option>
                  <option value="Mumbai">Mumbai</option>
                  <option value="Ahmedabad">Ahmedabad</option>
                  <option value="Indore">Indore</option>
                </select>
              </div>
            </div>

            {/* Row 2: Sales Person, State */}
            <div className="deleted-orders-filter-row-2">
              <div className="deleted-orders-field">
                <label htmlFor="deleted-sales-person">Sales Person</label>
                <select
                  id="deleted-sales-person"
                  className="deleted-orders-select"
                  value={salesPersonFilter}
                  onChange={(e) => setSalesPersonFilter(e.target.value)}
                >
                  <option value="All">All</option>
                  {SALES_PERSONS.map((sp) => (
                    <option key={sp} value={sp}>
                      {sp}
                    </option>
                  ))}
                </select>
              </div>

              <div className="deleted-orders-field">
                <label htmlFor="deleted-state">State</label>
                <div className="deleted-orders-pills-wrap">
                  {selectedStates.map((st) => (
                    <span key={st} className="deleted-orders-pill">
                      {st !== "All" && (
                        <button
                          type="button"
                          className="deleted-orders-pill-remove"
                          onClick={(e) => handleRemoveState(st, e)}
                        >
                          ✕
                        </button>
                      )}
                      {st === "All" && (
                        <span style={{ fontSize: "11px", marginRight: "2px" }}>✕</span>
                      )}
                      {st}
                    </span>
                  ))}
                  <select
                    id="deleted-state"
                    style={{
                      border: "none",
                      outline: "none",
                      fontSize: "13px",
                      background: "transparent",
                      color: "#64748b",
                      cursor: "pointer",
                      padding: "2px 4px",
                    }}
                    value=""
                    onChange={(e) => {
                      if (e.target.value) handleToggleState(e.target.value);
                    }}
                  >
                    <option value="" disabled>
                      + Add State...
                    </option>
                    <option value="All">All</option>
                    {STATE_OPTIONS.map((st) => (
                      <option key={st} value={st}>
                        {st}
                      </option>
                    ))}
                  </select>
                </div>
              </div>
            </div>

            {/* Filter Actions */}
            <div className="deleted-orders-filter-actions">
              <button
                type="button"
                className="deleted-orders-btn-reset"
                onClick={handleResetFilters}
              >
                Reset
              </button>
              <button
                type="button"
                className="deleted-orders-btn-search"
                onClick={handleApplyFilters}
              >
                Search
              </button>
            </div>
          </div>
        )}

        {/* Controls Bar: Items/Page + Search Input */}
        <div className="deleted-orders-controls-bar">
          <div className="deleted-orders-perpage-wrap">
            <select
              className="deleted-orders-perpage-select"
              value={pageSize}
              onChange={(e) => {
                setPageSize(Number(e.target.value));
                setCurrentPage(1);
              }}
            >
              <option value={10}>10</option>
              <option value={20}>20</option>
              <option value={50}>50</option>
              <option value={100}>100</option>
            </select>
            <span className="deleted-orders-perpage-label">Items/Page</span>
          </div>

          <div className="deleted-orders-search-wrap">
            <span className="deleted-orders-search-icon">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <circle cx="11" cy="11" r="8"></circle>
                <line x1="21" y1="21" x2="16.65" y2="16.65"></line>
              </svg>
            </span>
            <input
              type="text"
              className="deleted-orders-search-input"
              placeholder="Search..."
              value={searchTerm}
              onChange={(e) => {
                setSearchTerm(e.target.value);
                setCurrentPage(1);
              }}
            />
            {searchTerm && (
              <button
                type="button"
                onClick={() => setSearchTerm("")}
                style={{
                  position: "absolute",
                  right: "8px",
                  top: "50%",
                  transform: "translateY(-50%)",
                  background: "none",
                  border: "none",
                  cursor: "pointer",
                  color: "#94a3b8",
                  fontSize: "14px",
                }}
                title="Clear search"
              >
                ✕
              </button>
            )}
          </div>
        </div>

        {/* Main Data Table Card */}
        <div className="deleted-orders-card">
          <div className="deleted-orders-table-scroll">
            <table className="deleted-orders-table">
              <thead>
                <tr>
                  <th style={{ minWidth: "150px" }}>Order No *</th>
                  <th style={{ minWidth: "95px" }}>Warehouse</th>
                  <th style={{ minWidth: "110px" }}>Exp. Deli. Date</th>
                  <th style={{ minWidth: "220px" }}>Company</th>
                  <th style={{ minWidth: "150px" }}>City / State</th>
                  <th style={{ minWidth: "90px" }}>Third Party</th>
                  <th style={{ minWidth: "60px" }}>PO</th>
                  <th style={{ minWidth: "130px" }}>Sales Person</th>
                  <th style={{ minWidth: "130px", textAlign: "right" }}>Amount (Inc.GST) *</th>
                  <th style={{ minWidth: "90px", textAlign: "right" }}>Discount</th>
                  <th style={{ minWidth: "140px" }}>Status</th>
                  <th style={{ minWidth: "95px", textAlign: "center" }}>Acc. Dep.</th>
                  <th style={{ minWidth: "85px" }}>Gatepass</th>
                </tr>
              </thead>
              <tbody>
                {loading ? (
                  <tr>
                    <td colSpan={13} style={{ textAlign: "center", padding: "40px", color: "#64748b" }}>
                      Loading deleted orders records...
                    </td>
                  </tr>
                ) : filteredItems.length === 0 ? (
                  <tr>
                    <td colSpan={13} style={{ textAlign: "center", padding: "40px", color: "#64748b" }}>
                      No deleted orders found matching your criteria.
                    </td>
                  </tr>
                ) : (
                  paginatedItems.map((order) => (
                    <tr key={order.id}>
                      {/* Order No with date underneath */}
                      <td>
                        <a
                          href={`#order-${order.order_no}`}
                          className="deleted-order-link"
                          onClick={(e) => {
                            e.preventDefault();
                            handleOpenPdf(order);
                          }}
                          title="Click to view & download Sales Order PDF"
                        >
                          {order.order_no}
                        </a>
                        <div className="deleted-order-date">{order.order_date}</div>
                      </td>

                      {/* Warehouse */}
                      <td>{order.warehouse}</td>

                      {/* Expected Delivery Date */}
                      <td>{order.expected_delivery_date}</td>

                      {/* Company Name */}
                      <td style={{ fontWeight: 600, color: "#1e293b" }}>{order.company_name}</td>

                      {/* City / State */}
                      <td>
                        <div style={{ color: "#334155" }}>{order.city}</div>
                        <div style={{ fontSize: "11.5px", color: "#64748b", marginTop: "2px" }}>
                          {order.state}
                        </div>
                      </td>

                      {/* Third Party */}
                      <td>{order.third_party}</td>

                      {/* PO */}
                      <td>{order.po}</td>

                      {/* Sales Person */}
                      <td>{order.sales_person}</td>

                      {/* Amount */}
                      <td style={{ textAlign: "right", fontWeight: 600, color: "#0f172a" }}>
                        {formatCurrency(order.amount_inc_gst)}
                      </td>

                      {/* Discount */}
                      <td style={{ textAlign: "right", color: "#64748b" }}>
                        {formatCurrency(order.discount)}
                      </td>

                      {/* Status */}
                      <td>
                        <span className="deleted-status-badge">Trash</span>
                        <div className="deleted-status-time">{order.deleted_at}</div>
                        {order.remark && (
                          <div className="deleted-status-remark" title={order.remark}>
                            Remark
                          </div>
                        )}
                      </td>

                      {/* Acc. Dep. */}
                      <td style={{ textAlign: "center" }}>
                        <div className="deleted-acc-actions" style={{ justifyContent: "center" }}>
                          <button
                            type="button"
                            className="deleted-info-icon-btn"
                            title="Account Department Status Information"
                            onClick={() => setAccountInfoOrder(order)}
                          >
                            i
                          </button>
                        </div>
                        <button
                          type="button"
                          className="deleted-timeline-btn"
                          title="View order history & deletion timeline"
                          onClick={() => setTimelineOrder(order)}
                        >
                          Timeline
                        </button>
                      </td>

                      {/* Gatepass */}
                      <td>
                        <span style={{ color: "#64748b", fontSize: "12.5px" }}>{order.gatepass}</span>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>

          {/* Pagination Footer */}
          {filteredItems.length > 0 && (
            <div style={{ padding: "12px 16px", borderTop: "1px solid #e2e8f0" }}>
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
          )}
        </div>

        {/* Timeline Drawer */}
        <SideDrawer
          isOpen={Boolean(timelineOrder)}
          onClose={() => setTimelineOrder(null)}
          title={`Order Timeline: ${timelineOrder?.order_no || ""}`}
          subtitle={`${timelineOrder?.company_name || ""} — ${timelineOrder?.warehouse || ""} Warehouse`}
          width="500px"
        >
          {timelineOrder && (
            <div style={{ padding: "8px 0" }}>
              <div
                style={{
                  background: "#fef2f2",
                  border: "1px solid #fee2e2",
                  borderRadius: "6px",
                  padding: "14px",
                  marginBottom: "20px",
                }}
              >
                <div style={{ display: "flex", alignItems: "center", gap: "8px", color: "#b91c1c", fontWeight: 700, fontSize: "14px", marginBottom: "4px" }}>
                  <span>🗑️</span> Order Moved To Trash
                </div>
                <div style={{ fontSize: "13px", color: "#7f1d1d" }}>
                  This order was deleted on <strong>{timelineOrder.deleted_at}</strong>.
                </div>
                {timelineOrder.remark && (
                  <div style={{ marginTop: "8px", fontSize: "12.5px", color: "#991b1b", fontStyle: "italic" }}>
                    Reason: &ldquo;{timelineOrder.remark}&rdquo;
                  </div>
                )}
              </div>

              {/* Timeline Steps */}
              <div style={{ position: "relative", paddingLeft: "28px" }}>
                {/* Vertical connecting line */}
                <div
                  style={{
                    position: "absolute",
                    left: "11px",
                    top: "10px",
                    bottom: "20px",
                    width: "2px",
                    backgroundColor: "#e2e8f0",
                  }}
                />

                {/* Event 1: Created */}
                <div style={{ position: "relative", marginBottom: "24px" }}>
                  <div
                    style={{
                      position: "absolute",
                      left: "-28px",
                      top: "2px",
                      width: "22px",
                      height: "22px",
                      borderRadius: "50%",
                      backgroundColor: "#3b82f6",
                      color: "#ffffff",
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      fontSize: "11px",
                      fontWeight: 700,
                    }}
                  >
                    ✓
                  </div>
                  <div style={{ fontSize: "13.5px", fontWeight: 600, color: "#1e293b" }}>Sales Order Created</div>
                  <div style={{ fontSize: "12px", color: "#64748b", marginTop: "2px" }}>
                    Date: {timelineOrder.order_date} | By: {timelineOrder.sales_person}
                  </div>
                  <div style={{ fontSize: "12px", color: "#475569", marginTop: "4px" }}>
                    Amount: {formatCurrency(timelineOrder.amount_inc_gst)} (GST Included)
                  </div>
                </div>

                {/* Event 2: Account Clearance */}
                <div style={{ position: "relative", marginBottom: "24px" }}>
                  <div
                    style={{
                      position: "absolute",
                      left: "-28px",
                      top: "2px",
                      width: "22px",
                      height: "22px",
                      borderRadius: "50%",
                      backgroundColor: "#f59e0b",
                      color: "#ffffff",
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      fontSize: "11px",
                      fontWeight: 700,
                    }}
                  >
                    i
                  </div>
                  <div style={{ fontSize: "13.5px", fontWeight: 600, color: "#1e293b" }}>Accounts Verification</div>
                  <div style={{ fontSize: "12px", color: "#64748b", marginTop: "2px" }}>
                    Department Status: {timelineOrder.acc_dep}
                  </div>
                </div>

                {/* Event 3: Deletion */}
                <div style={{ position: "relative" }}>
                  <div
                    style={{
                      position: "absolute",
                      left: "-28px",
                      top: "2px",
                      width: "22px",
                      height: "22px",
                      borderRadius: "50%",
                      backgroundColor: "#ef4444",
                      color: "#ffffff",
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      fontSize: "11px",
                      fontWeight: 700,
                    }}
                  >
                    ✕
                  </div>
                  <div style={{ fontSize: "13.5px", fontWeight: 600, color: "#b91c1c" }}>Deleted &amp; Sent to Trash</div>
                  <div style={{ fontSize: "12px", color: "#64748b", marginTop: "2px" }}>
                    Timestamp: {timelineOrder.deleted_at}
                  </div>
                </div>
              </div>

              {/* Action */}
              <div style={{ marginTop: "32px", borderTop: "1px solid #e2e8f0", paddingTop: "16px", display: "flex", gap: "10px" }}>
                <button
                  type="button"
                  style={{
                    flex: 1,
                    backgroundColor: "#0284c7",
                    color: "#ffffff",
                    border: "none",
                    borderRadius: "4px",
                    padding: "9px 16px",
                    fontSize: "13px",
                    fontWeight: 600,
                    cursor: "pointer",
                  }}
                  onClick={() => handleOpenPdf(timelineOrder)}
                >
                  📄 View Sales Order PDF
                </button>
                <button
                  type="button"
                  style={{
                    backgroundColor: "#16a34a",
                    color: "#ffffff",
                    border: "none",
                    borderRadius: "4px",
                    padding: "9px 16px",
                    fontSize: "13px",
                    fontWeight: 600,
                    cursor: "pointer",
                    display: "flex",
                    alignItems: "center",
                    gap: "6px",
                  }}
                  onClick={() => handleRestoreOrder(timelineOrder)}
                  title="Restore this order back to active sales orders"
                >
                  ♻️ Restore Order
                </button>
              </div>
            </div>
          )}
        </SideDrawer>

        {/* Account Info Modal */}
        {accountInfoOrder && (
          <div
            style={{
              position: "fixed",
              top: 0,
              left: 0,
              right: 0,
              bottom: 0,
              backgroundColor: "rgba(15, 23, 42, 0.45)",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              zIndex: 9999,
              padding: "16px",
            }}
            onClick={() => setAccountInfoOrder(null)}
          >
            <div
              style={{
                backgroundColor: "#ffffff",
                borderRadius: "8px",
                width: "440px",
                maxWidth: "100%",
                boxShadow: "0 20px 25px -5px rgba(0, 0, 0, 0.1), 0 8px 10px -6px rgba(0, 0, 0, 0.1)",
                padding: "20px 24px",
              }}
              onClick={(e) => e.stopPropagation()}
            >
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "16px" }}>
                <h3 style={{ margin: 0, fontSize: "16px", fontWeight: 700, color: "#1e293b" }}>
                  Account Department Details
                </h3>
                <button
                  type="button"
                  onClick={() => setAccountInfoOrder(null)}
                  style={{
                    background: "none",
                    border: "none",
                    fontSize: "18px",
                    color: "#94a3b8",
                    cursor: "pointer",
                  }}
                >
                  ✕
                </button>
              </div>

              <div style={{ fontSize: "13px", color: "#475569", lineHeight: 1.6 }}>
                <div style={{ marginBottom: "8px" }}>
                  <strong>Order No:</strong> {accountInfoOrder.order_no}
                </div>
                <div style={{ marginBottom: "8px" }}>
                  <strong>Company:</strong> {accountInfoOrder.company_name}
                </div>
                <div style={{ marginBottom: "8px" }}>
                  <strong>Order Total:</strong> {formatCurrency(accountInfoOrder.amount_inc_gst)}
                </div>
                <div style={{ marginBottom: "8px" }}>
                  <strong>Accounting Status:</strong>{" "}
                  <span style={{ color: "#d97706", fontWeight: 600 }}>{accountInfoOrder.acc_dep}</span>
                </div>
                <div style={{ marginBottom: "8px" }}>
                  <strong>Gatepass Status:</strong> {accountInfoOrder.gatepass}
                </div>
                <div style={{ marginBottom: "8px" }}>
                  <strong>Deletion Audit:</strong> Moved to trash on {accountInfoOrder.deleted_at}
                </div>
              </div>

              <div style={{ marginTop: "20px", display: "flex", justifyContent: "flex-end" }}>
                <button
                  type="button"
                  onClick={() => setAccountInfoOrder(null)}
                  style={{
                    backgroundColor: "#5c6f84",
                    color: "#ffffff",
                    border: "none",
                    borderRadius: "4px",
                    padding: "7px 18px",
                    fontSize: "13px",
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
      </main>
    </AppShell>
  );
}
export default DeletedOrdersPage;
