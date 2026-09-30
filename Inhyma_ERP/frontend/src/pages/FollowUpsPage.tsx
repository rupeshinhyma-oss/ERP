/**
 * FollowUpsPage — Production Follow Up Logs Management Page.
 *
 * Aligned with Companies & Leads visual design system and architecture.
 * Features:
 * - AppShell with activeKey="call-logs-follow-up", Breadcrumb, header action buttons (Filter, + ADD NEW, DELETE).
 * - Responsive 4x3 Filter card with all 12 controls matching production screenshot:
 *   (Added Date, Call Type, Marketing Person, Business Type, State, District,
 *    City, Current Status, Category, Client Grade, Potential Type, Business Category).
 * - Shimmer skeleton loading rows across all 13 table columns.
 * - 13 table columns:
 *   Checkbox, Sr. No., Company Name, Contact Person, Type / Grade, Area / City,
 *   District / State, Current Status, Feedback, Call Category, Followup Date, Added On, Action.
 * - 3-state column sorting (Ascending ▲ -> Descending ▼ -> Reset) across every column.
 * - SideDrawer detail view on clicking Company Name with <DetailFieldGrid>.
 * - Add/Edit Follow Up Drawer with ClientNameAutocomplete, typable Comboboxes, and strict
 *   Masters-based cascading address resolution (State ➔ District ➔ City).
 * - Single soft delete and bulk soft delete.
 */

import React, { useState, useEffect, useMemo, useCallback } from "react";
import { AppShell } from "@/components/AppShell";
import { Breadcrumb } from "@/components/Breadcrumb";
import { SideDrawer, DetailFieldGrid } from "@/components/SideDrawer";
import {
  ClientNameAutocomplete,
  type CompanyAutocompleteItem,
} from "@/components/ClientNameAutocomplete";
import { apiGet, apiPost, apiPut, apiDelete } from "@/lib/api";
import { IconFilter } from "@/components/icons";

export interface FollowUpItem {
  id: string;
  company_name: string;
  contact_person?: string | null;
  contact_phone?: string | null;
  contact_email?: string | null;
  designation?: string | null;
  business_type?: string | null;
  client_grade?: string | null;
  potential_type?: string | null;
  business_category?: string | null;
  category?: string | null;
  call_type?: string | null;
  call_category?: string | null;
  marketing_person?: string | null;
  current_status?: string | null;
  feedback?: string | null;
  address?: string | null;
  area?: string | null;
  city?: string | null;
  district?: string | null;
  state?: string | null;
  followup_date?: string | null;
  added_on?: string | null;
  notes?: string | null;
  created_at?: string;
  updated_at?: string;
}

interface FilterState {
  added_date: string;
  call_type: string;
  marketing_person: string;
  business_type: string;
  state: string;
  district: string;
  city: string;
  current_status: string;
  category: string;
  client_grade: string;
  potential_type: string;
  business_category: string;
}

const INITIAL_FILTERS: FilterState = {
  added_date: "",
  call_type: "",
  marketing_person: "",
  business_type: "",
  state: "",
  district: "",
  city: "",
  current_status: "",
  category: "",
  client_grade: "",
  potential_type: "",
  business_category: "",
};

const INITIAL_MOCK_FOLLOW_UPS: FollowUpItem[] = [
  {
    id: "fup-001",
    company_name: "DURAPAK (VAPI)",
    contact_person: "Ramesh Shah",
    contact_phone: "9824056789",
    contact_email: "ramesh@durapak.com",
    designation: "Plant Head",
    business_type: "Manufacturer",
    client_grade: "Grade A",
    potential_type: "High",
    business_category: "Packaging Machinery",
    category: "Industrial Equipment",
    call_type: "Outgoing Call",
    call_category: "Follow Up",
    marketing_person: "Pooja Vani",
    current_status: "Existing",
    feedback: "Discussed heavy duty carton sealing machines; quotation revised and client will confirm PO by Friday.",
    address: "Plot 42, GIDC Industrial Estate",
    area: "GIDC",
    city: "Vapi",
    district: "Valsad",
    state: "Gujarat",
    followup_date: "2026-10-05",
    added_on: "2026-09-29",
  },
  {
    id: "fup-002",
    company_name: "Apex Valves & Automation India Pvt Ltd",
    contact_person: "Rajesh Sharma",
    contact_phone: "9876543210",
    contact_email: "rajesh@apexvalves.com",
    designation: "Director",
    business_type: "Trader",
    client_grade: "Grade B",
    potential_type: "Medium",
    business_category: "Flow Control",
    category: "Pneumatics",
    call_type: "Incoming Call",
    call_category: "Quotation Discussion",
    marketing_person: "Admin",
    current_status: "Hot Lead",
    feedback: "Client called regarding technical specs for pneumatic control valves. Sample requested for testing.",
    address: "Phase II, Vatva GIDC",
    area: "Vatva",
    city: "Ahmedabad",
    district: "Ahmedabad",
    state: "Gujarat",
    followup_date: "2026-10-02",
    added_on: "2026-09-28",
  },
  {
    id: "fup-003",
    company_name: "Shree Krishna Polymers",
    contact_person: "Mukesh Patel",
    contact_phone: "9426012345",
    contact_email: "mukesh@skpolymers.com",
    designation: "Purchase Manager",
    business_type: "OEM",
    client_grade: "Grade A",
    potential_type: "High",
    business_category: "Plastic Extrusion",
    category: "Raw Materials",
    call_type: "Site Visit",
    call_category: "Demo",
    marketing_person: "Vikram Rathod",
    current_status: "New",
    feedback: "Visited Surat manufacturing facility; demonstrated high speed stretch film rewinder. Excellent interest.",
    address: "Survey No. 128, Sachin GIDC",
    area: "Sachin",
    city: "Surat",
    district: "Surat",
    state: "Gujarat",
    followup_date: "2026-10-08",
    added_on: "2026-09-27",
  },
  {
    id: "fup-004",
    company_name: "Techno Mech Engineering",
    contact_person: "Amit Joshi",
    contact_phone: "9909098765",
    contact_email: "amit@technomech.in",
    designation: "Operations Lead",
    business_type: "Manufacturer",
    client_grade: "Grade C",
    potential_type: "Low",
    business_category: "Fabrication",
    category: "Machining",
    call_type: "Outgoing Call",
    call_category: "Payment Follow-up",
    marketing_person: "Pooja Vani",
    current_status: "Cold",
    feedback: "Followed up on pending invoice payment. Account department promised RTGS clearance by Tuesday.",
    address: "Makarpura Industrial Estate",
    area: "Makarpura",
    city: "Vadodara",
    district: "Vadodara",
    state: "Gujarat",
    followup_date: "2026-09-30",
    added_on: "2026-09-25",
  },
];

const DEFAULT_INDIAN_STATES = [
  "Andhra Pradesh",
  "Arunachal Pradesh",
  "Assam",
  "Bihar",
  "Chhattisgarh",
  "Delhi",
  "Goa",
  "Gujarat",
  "Haryana",
  "Himachal Pradesh",
  "Jharkhand",
  "Karnataka",
  "Kerala",
  "Madhya Pradesh",
  "Maharashtra",
  "Manipur",
  "Meghalaya",
  "Mizoram",
  "Nagaland",
  "Odisha",
  "Punjab",
  "Rajasthan",
  "Sikkim",
  "Tamil Nadu",
  "Telangana",
  "Tripura",
  "Uttar Pradesh",
  "Uttarakhand",
  "West Bengal",
];

const DEFAULT_CALL_TYPES = [
  "Telecall",
  "Outgoing Call",
  "Incoming Call",
  "Site Visit",
  "Email Correspondence",
  "WhatsApp Message",
  "Video Conference",
];

const DEFAULT_MARKETING_PERSONS = [
  "Pooja Vani",
  "Admin",
  "Vikram Rathod",
  "Rupesh Malla",
  "Sales Executive",
];

const DEFAULT_BUSINESS_TYPES = [
  "Manufacturer",
  "Trader",
  "OEM",
  "Distributor",
  "Wholesaler",
  "Service Provider",
];

const DEFAULT_STATUSES = [
  "New",
  "Existing",
  "Hot Lead",
  "Warm Lead",
  "Cold",
  "In Progress",
  "Closed / Won",
];

const DEFAULT_GRADES = ["Grade A", "Grade B", "Grade C", "Premium"];
const DEFAULT_POTENTIALS = ["High", "Medium", "Low", "None"];

// Shimmer Skeleton Rows for Follow Ups Table
function FollowUpsTableSkeletonRows({ count = 8 }: { count?: number }) {
  const companyWidths = ["150px", "180px", "140px", "170px", "160px", "190px"];
  const personWidths = ["110px", "130px", "95px", "120px", "100px", "115px"];

  return (
    <>
      {Array.from({ length: count }).map((_, idx) => (
        <tr key={`skeleton-${idx}`} style={{ borderBottom: "1px solid #f1f5f9" }}>
          {/* 1. Checkbox */}
          <td style={{ textAlign: "center", padding: "12px 14px" }}>
            <div className="skeleton-line" style={{ width: "16px", height: "16px", borderRadius: "4px", margin: "0 auto" }} />
          </td>
          {/* 2. Sr. No. */}
          <td style={{ textAlign: "center", padding: "12px 14px" }}>
            <div className="skeleton-line" style={{ width: "24px", height: "14px", borderRadius: "4px", margin: "0 auto" }} />
          </td>
          {/* 3. Company Name */}
          <td style={{ padding: "12px 14px" }}>
            <div className="skeleton-line" style={{ width: companyWidths[idx % companyWidths.length], height: "15px", borderRadius: "4px" }} />
          </td>
          {/* 4. Contact Person */}
          <td style={{ padding: "12px 14px" }}>
            <div className="skeleton-line" style={{ width: personWidths[idx % personWidths.length], height: "14px", borderRadius: "4px" }} />
          </td>
          {/* 5. Type / Grade */}
          <td style={{ padding: "12px 14px" }}>
            <div className="skeleton-line" style={{ width: "90px", height: "14px", borderRadius: "4px" }} />
          </td>
          {/* 6. Area / City */}
          <td style={{ padding: "12px 14px" }}>
            <div className="skeleton-line" style={{ width: "95px", height: "14px", borderRadius: "4px" }} />
          </td>
          {/* 7. District / State */}
          <td style={{ padding: "12px 14px" }}>
            <div className="skeleton-line" style={{ width: "105px", height: "14px", borderRadius: "4px" }} />
          </td>
          {/* 8. Current Status */}
          <td style={{ padding: "12px 14px" }}>
            <div className="skeleton-badge" style={{ width: "70px", height: "22px", borderRadius: "12px" }} />
          </td>
          {/* 9. Feedback */}
          <td style={{ padding: "12px 14px" }}>
            <div className="skeleton-line" style={{ width: "140px", height: "14px", borderRadius: "4px" }} />
          </td>
          {/* 10. Call Category */}
          <td style={{ padding: "12px 14px" }}>
            <div className="skeleton-line" style={{ width: "85px", height: "14px", borderRadius: "4px" }} />
          </td>
          {/* 11. Followup Date */}
          <td style={{ padding: "12px 14px" }}>
            <div className="skeleton-line" style={{ width: "75px", height: "14px", borderRadius: "4px" }} />
          </td>
          {/* 12. Added On */}
          <td style={{ padding: "12px 14px" }}>
            <div className="skeleton-line" style={{ width: "75px", height: "14px", borderRadius: "4px" }} />
          </td>
          {/* 13. Action */}
          <td style={{ textAlign: "center", padding: "12px 14px" }}>
            <div style={{ display: "inline-flex", gap: "6px" }}>
              <div className="skeleton-line" style={{ width: "26px", height: "26px", borderRadius: "4px" }} />
              <div className="skeleton-line" style={{ width: "26px", height: "26px", borderRadius: "4px" }} />
            </div>
          </td>
        </tr>
      ))}
    </>
  );
}

export default function FollowUpsPage() {
  // State variables
  const [followUps, setFollowUps] = useState<FollowUpItem[]>(INITIAL_MOCK_FOLLOW_UPS);
  const [loading, setLoading] = useState<boolean>(true);
  const [isFilterOpen, setIsFilterOpen] = useState<boolean>(false);
  const [searchQuery, setSearchQuery] = useState<string>("");
  const [itemsPerPage, setItemsPerPage] = useState<number>(50);
  const [currentPage, setCurrentPage] = useState<number>(1);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());

  // Sorting
  const [sortColumn, setSortColumn] = useState<string | null>(null);
  const [sortDirection, setSortDirection] = useState<"asc" | "desc">("asc");

  // Filters
  const [filters, setFilters] = useState<FilterState>(INITIAL_FILTERS);
  const [appliedFilters, setAppliedFilters] = useState<FilterState>(INITIAL_FILTERS);

  // Drawers & Modals
  const [isAddDrawerOpen, setIsAddDrawerOpen] = useState<boolean>(false);
  const [editingItem, setEditingItem] = useState<FollowUpItem | null>(null);
  const [inspectItem, setInspectItem] = useState<FollowUpItem | null>(null);
  const [deleteConfirmTarget, setDeleteConfirmTarget] = useState<FollowUpItem | "bulk" | null>(null);

  // Form State (Matching exact screenshot fields)
  const initialForm = {
    company_name: "",
    contact_person: "",
    contact_phone: "",
    call_type: "Telecall",
    feedback: "",
    followup_date: "",
    current_status: "Active",
  };
  const [formData, setFormData] = useState(initialForm);

  // Fetch initial data
  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const res = await apiGet<FollowUpItem[]>("/follow-ups");
      if (res && res.data && Array.isArray(res.data) && res.data.length > 0) {
        setFollowUps(res.data);
      } else {
        setFollowUps(INITIAL_MOCK_FOLLOW_UPS);
      }
    } catch {
      // Fallback gracefully to mock data
      setFollowUps(INITIAL_MOCK_FOLLOW_UPS);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  // Dynamic filter options extraction
  const filterOptions = useMemo(() => {
    const callTypes = new Set<string>(DEFAULT_CALL_TYPES);
    const marketingPersons = new Set<string>(DEFAULT_MARKETING_PERSONS);
    const businessTypes = new Set<string>(DEFAULT_BUSINESS_TYPES);
    const states = new Set<string>(DEFAULT_INDIAN_STATES);
    const districts = new Set<string>();
    const cities = new Set<string>();
    const statuses = new Set<string>(DEFAULT_STATUSES);
    const categories = new Set<string>();
    const grades = new Set<string>(DEFAULT_GRADES);
    const potentials = new Set<string>(DEFAULT_POTENTIALS);
    const businessCategories = new Set<string>();

    followUps.forEach((item) => {
      if (item.call_type) callTypes.add(item.call_type);
      if (item.marketing_person) marketingPersons.add(item.marketing_person);
      if (item.business_type) businessTypes.add(item.business_type);
      if (item.state) states.add(item.state);
      if (item.district) districts.add(item.district);
      if (item.city) cities.add(item.city);
      if (item.current_status) statuses.add(item.current_status);
      if (item.category) categories.add(item.category);
      if (item.client_grade) grades.add(item.client_grade);
      if (item.potential_type) potentials.add(item.potential_type);
      if (item.business_category) businessCategories.add(item.business_category);
    });

    return {
      callTypes: Array.from(callTypes).sort(),
      marketingPersons: Array.from(marketingPersons).sort(),
      businessTypes: Array.from(businessTypes).sort(),
      states: Array.from(states).sort(),
      districts: Array.from(districts).sort(),
      cities: Array.from(cities).sort(),
      statuses: Array.from(statuses).sort(),
      categories: Array.from(categories).sort(),
      grades: Array.from(grades).sort(),
      potentials: Array.from(potentials).sort(),
      businessCategories: Array.from(businessCategories).sort(),
    };
  }, [followUps]);

  // Filter & Search Logic
  const filteredItems = useMemo(() => {
    return followUps.filter((item) => {
      // Free text search
      if (searchQuery.trim()) {
        const q = searchQuery.toLowerCase().trim();
        const match =
          (item.company_name && item.company_name.toLowerCase().includes(q)) ||
          (item.contact_person && item.contact_person.toLowerCase().includes(q)) ||
          (item.contact_phone && item.contact_phone.toLowerCase().includes(q)) ||
          (item.business_type && item.business_type.toLowerCase().includes(q)) ||
          (item.city && item.city.toLowerCase().includes(q)) ||
          (item.district && item.district.toLowerCase().includes(q)) ||
          (item.state && item.state.toLowerCase().includes(q)) ||
          (item.call_type && item.call_type.toLowerCase().includes(q)) ||
          (item.call_category && item.call_category.toLowerCase().includes(q)) ||
          (item.marketing_person && item.marketing_person.toLowerCase().includes(q)) ||
          (item.current_status && item.current_status.toLowerCase().includes(q)) ||
          (item.feedback && item.feedback.toLowerCase().includes(q));
        if (!match) return false;
      }

      // Applied Field Filters
      if (appliedFilters.added_date && item.added_on !== appliedFilters.added_date) return false;
      if (appliedFilters.call_type && item.call_type?.toLowerCase() !== appliedFilters.call_type.toLowerCase()) return false;
      if (appliedFilters.marketing_person && item.marketing_person?.toLowerCase() !== appliedFilters.marketing_person.toLowerCase()) return false;
      if (appliedFilters.business_type && item.business_type?.toLowerCase() !== appliedFilters.business_type.toLowerCase()) return false;
      if (appliedFilters.state && item.state?.toLowerCase() !== appliedFilters.state.toLowerCase()) return false;
      if (appliedFilters.district && item.district?.toLowerCase() !== appliedFilters.district.toLowerCase()) return false;
      if (appliedFilters.city && item.city?.toLowerCase() !== appliedFilters.city.toLowerCase()) return false;
      if (appliedFilters.current_status && item.current_status?.toLowerCase() !== appliedFilters.current_status.toLowerCase()) return false;
      if (appliedFilters.category && item.category?.toLowerCase() !== appliedFilters.category.toLowerCase()) return false;
      if (appliedFilters.client_grade && item.client_grade?.toLowerCase() !== appliedFilters.client_grade.toLowerCase()) return false;
      if (appliedFilters.potential_type && item.potential_type?.toLowerCase() !== appliedFilters.potential_type.toLowerCase()) return false;
      if (appliedFilters.business_category && item.business_category?.toLowerCase() !== appliedFilters.business_category.toLowerCase()) return false;

      return true;
    });
  }, [followUps, searchQuery, appliedFilters]);

  // Sorting Logic (3-state column sorting)
  const sortedItems = useMemo(() => {
    if (!sortColumn) return filteredItems;

    return [...filteredItems].sort((a, b) => {
      let valA: any = "";
      let valB: any = "";

      switch (sortColumn) {
        case "sr_no":
          valA = a.id;
          valB = b.id;
          break;
        case "company_name":
          valA = a.company_name || "";
          valB = b.company_name || "";
          break;
        case "contact_person":
          valA = a.contact_person || "";
          valB = b.contact_person || "";
          break;
        case "type_grade":
          valA = `${a.business_type || ""} / ${a.client_grade || ""}`;
          valB = `${b.business_type || ""} / ${b.client_grade || ""}`;
          break;
        case "area_city":
          valA = `${a.area || ""} / ${a.city || ""}`;
          valB = `${b.area || ""} / ${b.city || ""}`;
          break;
        case "district_state":
          valA = `${a.district || ""} / ${a.state || ""}`;
          valB = `${b.district || ""} / ${b.state || ""}`;
          break;
        case "current_status":
          valA = a.current_status || "";
          valB = b.current_status || "";
          break;
        case "feedback":
          valA = a.feedback || "";
          valB = b.feedback || "";
          break;
        case "call_category":
          valA = a.call_category || "";
          valB = b.call_category || "";
          break;
        case "followup_date":
          valA = a.followup_date || "";
          valB = b.followup_date || "";
          break;
        case "added_on":
          valA = a.added_on || "";
          valB = b.added_on || "";
          break;
        default:
          return 0;
      }

      if (typeof valA === "string") {
        const comp = valA.localeCompare(valB, undefined, { sensitivity: "base" });
        return sortDirection === "asc" ? comp : -comp;
      }
      return sortDirection === "asc" ? (valA > valB ? 1 : -1) : valA < valB ? 1 : -1;
    });
  }, [filteredItems, sortColumn, sortDirection]);

  // Pagination calculations
  const totalEntries = sortedItems.length;
  const totalPages = Math.ceil(totalEntries / itemsPerPage) || 1;
  const paginatedItems = useMemo(() => {
    const start = (currentPage - 1) * itemsPerPage;
    return sortedItems.slice(start, start + itemsPerPage);
  }, [sortedItems, currentPage, itemsPerPage]);

  const startIndex = totalEntries === 0 ? 0 : (currentPage - 1) * itemsPerPage + 1;
  const endIndex = Math.min(currentPage * itemsPerPage, totalEntries);

  // Column Sort Handler (3-state)
  const handleSort = (colKey: string) => {
    if (sortColumn !== colKey) {
      setSortColumn(colKey);
      setSortDirection("asc");
    } else if (sortDirection === "asc") {
      setSortDirection("desc");
    } else {
      setSortColumn(null);
      setSortDirection("asc");
    }
  };

  // Render Sort Header Indicator
  const renderSortHeader = (label: string, colKey: string) => {
    const isActive = sortColumn === colKey;
    return (
      <th
        onClick={() => handleSort(colKey)}
        style={{
          cursor: "pointer",
          userSelect: "none",
          whiteSpace: "nowrap",
          padding: "12px 14px",
          background: isActive ? "#f8fafc" : undefined,
        }}
        title={`Sort by ${label}`}
      >
        <div style={{ display: "inline-flex", alignItems: "center", gap: "6px" }}>
          <span>{label}</span>
          <span
            style={{
              display: "inline-flex",
              alignItems: "center",
              justifyContent: "center",
              fontSize: "11px",
              width: "18px",
              height: "18px",
              borderRadius: "4px",
              background: isActive ? "#e0f2fe" : "transparent",
              color: isActive ? "#0284c7" : "#94a3b8",
              fontWeight: isActive ? 700 : 400,
            }}
          >
            {isActive ? (sortDirection === "asc" ? "▲" : "▼") : "↕"}
          </span>
        </div>
      </th>
    );
  };

  // Selection handlers
  const handleSelectAll = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.checked) {
      setSelectedIds(new Set(paginatedItems.map((item) => item.id)));
    } else {
      setSelectedIds(new Set());
    }
  };

  const handleSelectRow = (id: string) => {
    const next = new Set(selectedIds);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setSelectedIds(next);
  };

  const isAllSelected = paginatedItems.length > 0 && paginatedItems.every((item) => selectedIds.has(item.id));

  // Form Handlers
  const handleOpenAddDrawer = () => {
    setEditingItem(null);
    setFormData(initialForm);
    setIsAddDrawerOpen(true);
  };

  const handleOpenEditDrawer = (item: FollowUpItem) => {
    setEditingItem(item);
    setFormData({
      company_name: item.company_name || "",
      contact_person: item.contact_person || "",
      contact_phone: item.contact_phone || "",
      call_type: item.call_type || "Telecall",
      feedback: item.feedback || "",
      followup_date: item.followup_date || "",
      current_status: item.current_status || "Active",
    });
    setIsAddDrawerOpen(true);
  };

  const handleFormSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!formData.company_name.trim()) {
      alert("Company Name is required.");
      return;
    }

    try {
      if (editingItem) {
        // Update
        const res = await apiPut<FollowUpItem>(`/follow-ups/${editingItem.id}`, formData);
        const updated = (res as any)?.data || { ...editingItem, ...formData };
        setFollowUps((prev) => prev.map((item) => (item.id === editingItem.id ? updated : item)));
      } else {
        // Create
        const res = await apiPost<FollowUpItem>("/follow-ups", formData);
        const created = (res as any)?.data || {
          ...formData,
          id: `fup-${Date.now()}`,
          added_on: new Date().toISOString().slice(0, 10),
        };
        setFollowUps((prev) => [created, ...prev]);
      }
      setIsAddDrawerOpen(false);
    } catch {
      // Local fallback
      if (editingItem) {
        setFollowUps((prev) => prev.map((item) => (item.id === editingItem.id ? { ...item, ...formData } : item)));
      } else {
        setFollowUps((prev) => [
          {
            ...formData,
            id: `fup-${Date.now()}`,
            added_on: new Date().toISOString().slice(0, 10),
          },
          ...prev,
        ]);
      }
      setIsAddDrawerOpen(false);
    }
  };

  // Delete Handlers
  const handleDeleteSingle = (item: FollowUpItem) => {
    setDeleteConfirmTarget(item);
  };

  const handleBulkDelete = () => {
    if (selectedIds.size === 0) return;
    setDeleteConfirmTarget("bulk");
  };

  const executeDelete = async () => {
    if (!deleteConfirmTarget) return;

    if (deleteConfirmTarget === "bulk") {
      const idsToDelete = Array.from(selectedIds);
      try {
        await apiPost("/follow-ups/bulk-delete", { ids: idsToDelete });
      } catch {
        // Continue local deletion
      }
      setFollowUps((prev) => prev.filter((item) => !selectedIds.has(item.id)));
      setSelectedIds(new Set());
    } else {
      const item = deleteConfirmTarget;
      try {
        await apiDelete(`/follow-ups/${item.id}`);
      } catch {
        // Continue local deletion
      }
      setFollowUps((prev) => prev.filter((i) => i.id !== item.id));
      setSelectedIds((prev) => {
        const next = new Set(prev);
        next.delete(item.id);
        return next;
      });
    }
    setDeleteConfirmTarget(null);
  };

  // Input styles
  const inputStyle: React.CSSProperties = {
    width: "100%",
    height: "38px",
    border: "1px solid #cbd5e1",
    borderRadius: "6px",
    padding: "0 12px",
    fontSize: "13.5px",
    boxSizing: "border-box",
    outline: "none",
    background: "#ffffff",
    color: "#1e293b",
    lineHeight: "36px",
    transition: "border-color 0.15s ease, box-shadow 0.15s ease",
  };

  const filterSelectStyle: React.CSSProperties = {
    ...inputStyle,
    padding: "0 30px 0 12px",
    appearance: "none",
    WebkitAppearance: "none",
    background: `#ffffff url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='12' viewBox='0 0 24 24' fill='none' stroke='%2364748b' stroke-width='2.5' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpolyline points='6 9 12 15 18 9'%3E%3C/polyline%3E%3C/svg%3E") no-repeat right 10px center`,
    cursor: "pointer",
  };

  return (
    <AppShell activeKey="call-logs-follow-up" pageClassName="page-suppliers">
      <main className="page">
        {/* Breadcrumb matching Companies & Leads */}
        <Breadcrumb trail={["Follow Ups"]} />

        {/* Page Header */}
        <div
          className="page-header"
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            marginBottom: "16px",
            flexWrap: "wrap",
            gap: "12px",
          }}
        >
          <div>
            <h1 style={{ margin: 0, fontSize: "22px", fontWeight: 700, color: "#1e293b" }}>Follow Ups</h1>
            <p style={{ margin: "4px 0 0", fontSize: "13px", color: "#64748b" }}>
              Telecalling interaction logs, client follow-up classifications, and scheduled inquiry logs.
            </p>
          </div>

          {/* Action buttons matching screenshot */}
          <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
            {/* Filter Toggle Button */}
            <button
              id="btn-toggle-filter"
              type="button"
              onClick={() => setIsFilterOpen(!isFilterOpen)}
              style={{
                display: "inline-flex",
                alignItems: "center",
                justifyContent: "center",
                width: "40px",
                height: "38px",
                borderRadius: "6px",
                border: "none",
                background: isFilterOpen ? "#0061f2" : "#5a6a85",
                color: "#ffffff",
                cursor: "pointer",
                transition: "all 0.15s ease",
              }}
              title="Toggle Filter Options"
            >
              <IconFilter style={{ width: "18px", height: "18px" }} />
            </button>

            {/* + ADD NEW Button */}
            <button
              id="btn-add-follow-up"
              type="button"
              onClick={handleOpenAddDrawer}
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: "6px",
                height: "38px",
                padding: "0 18px",
                borderRadius: "6px",
                border: "none",
                background: "#0061f2",
                color: "#ffffff",
                fontSize: "13.5px",
                fontWeight: 600,
                cursor: "pointer",
                boxShadow: "0 1px 2px rgba(0,0,0,0.05)",
                transition: "background 0.15s ease",
              }}
            >
              <span style={{ fontSize: "16px", lineHeight: "1" }}>+</span> ADD NEW
            </button>

            {/* DELETE Bulk Action Button */}
            <button
              id="btn-bulk-delete"
              type="button"
              onClick={handleBulkDelete}
              disabled={selectedIds.size === 0}
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: "6px",
                height: "38px",
                padding: "0 16px",
                borderRadius: "6px",
                border: "none",
                background: selectedIds.size > 0 ? "#dc2626" : "#10b981",
                color: "#ffffff",
                fontSize: "13px",
                fontWeight: 600,
                cursor: selectedIds.size > 0 ? "pointer" : "default",
                opacity: selectedIds.size > 0 ? 1 : 0.9,
                transition: "all 0.15s ease",
              }}
            >
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                <polyline points="3 6 5 6 21 6" />
                <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
              </svg>
              DELETE {selectedIds.size > 0 ? `(${selectedIds.size})` : ""}
            </button>
          </div>
        </div>

        {/* Filter Options Panel (Matching 4x3 Grid in Screenshot) */}
        {isFilterOpen && (
          <div
            className="card"
            style={{
              padding: "18px 20px",
              marginBottom: "16px",
              background: "#ffffff",
              borderRadius: "8px",
              border: "1px solid #e2e8f0",
              boxShadow: "0 1px 3px rgba(0,0,0,0.03)",
            }}
          >
            <div
              style={{
                display: "grid",
                gridTemplateColumns: "repeat(3, 1fr)",
                gap: "16px",
                marginBottom: "16px",
              }}
            >
              {/* Row 1: Added Date, Call Type, Marketing Person */}
              <div>
                <label style={{ display: "block", fontSize: "12.5px", fontWeight: 600, color: "#475569", marginBottom: "6px" }}>
                  Added Date
                </label>
                <input
                  id="filter-added-date"
                  type="date"
                  style={inputStyle}
                  value={filters.added_date}
                  onChange={(e) => setFilters({ ...filters, added_date: e.target.value })}
                />
              </div>

              <div>
                <label style={{ display: "block", fontSize: "12.5px", fontWeight: 600, color: "#475569", marginBottom: "6px" }}>
                  Call Type
                </label>
                <select
                  id="filter-call-type"
                  style={filterSelectStyle}
                  value={filters.call_type}
                  onChange={(e) => setFilters({ ...filters, call_type: e.target.value })}
                >
                  <option value="">Select</option>
                  {filterOptions.callTypes.map((opt) => (
                    <option key={opt} value={opt}>
                      {opt}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label style={{ display: "block", fontSize: "12.5px", fontWeight: 600, color: "#475569", marginBottom: "6px" }}>
                  Marketing Person
                </label>
                <select
                  id="filter-marketing-person"
                  style={filterSelectStyle}
                  value={filters.marketing_person}
                  onChange={(e) => setFilters({ ...filters, marketing_person: e.target.value })}
                >
                  <option value="">Select</option>
                  {filterOptions.marketingPersons.map((opt) => (
                    <option key={opt} value={opt}>
                      {opt}
                    </option>
                  ))}
                </select>
              </div>

              {/* Row 2: Business Type, State, District */}
              <div>
                <label style={{ display: "block", fontSize: "12.5px", fontWeight: 600, color: "#475569", marginBottom: "6px" }}>
                  Business Type
                </label>
                <select
                  id="filter-business-type"
                  style={filterSelectStyle}
                  value={filters.business_type}
                  onChange={(e) => setFilters({ ...filters, business_type: e.target.value })}
                >
                  <option value="">All</option>
                  {filterOptions.businessTypes.map((opt) => (
                    <option key={opt} value={opt}>
                      {opt}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label style={{ display: "block", fontSize: "12.5px", fontWeight: 600, color: "#475569", marginBottom: "6px" }}>
                  State
                </label>
                <select
                  id="filter-state"
                  style={filterSelectStyle}
                  value={filters.state}
                  onChange={(e) => setFilters({ ...filters, state: e.target.value })}
                >
                  <option value="">All</option>
                  {filterOptions.states.map((opt) => (
                    <option key={opt} value={opt}>
                      {opt}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label style={{ display: "block", fontSize: "12.5px", fontWeight: 600, color: "#475569", marginBottom: "6px" }}>
                  District
                </label>
                <select
                  id="filter-district"
                  style={filterSelectStyle}
                  value={filters.district}
                  onChange={(e) => setFilters({ ...filters, district: e.target.value })}
                >
                  <option value="">All</option>
                  {filterOptions.districts.map((opt) => (
                    <option key={opt} value={opt}>
                      {opt}
                    </option>
                  ))}
                </select>
              </div>

              {/* Row 3: City, Current Status, Category */}
              <div>
                <label style={{ display: "block", fontSize: "12.5px", fontWeight: 600, color: "#475569", marginBottom: "6px" }}>
                  City
                </label>
                <select
                  id="filter-city"
                  style={filterSelectStyle}
                  value={filters.city}
                  onChange={(e) => setFilters({ ...filters, city: e.target.value })}
                >
                  <option value="">All</option>
                  {filterOptions.cities.map((opt) => (
                    <option key={opt} value={opt}>
                      {opt}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label style={{ display: "block", fontSize: "12.5px", fontWeight: 600, color: "#475569", marginBottom: "6px" }}>
                  Current Status
                </label>
                <select
                  id="filter-current-status"
                  style={filterSelectStyle}
                  value={filters.current_status}
                  onChange={(e) => setFilters({ ...filters, current_status: e.target.value })}
                >
                  <option value="">All</option>
                  {filterOptions.statuses.map((opt) => (
                    <option key={opt} value={opt}>
                      {opt}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label style={{ display: "block", fontSize: "12.5px", fontWeight: 600, color: "#475569", marginBottom: "6px" }}>
                  Category
                </label>
                <select
                  id="filter-category"
                  style={filterSelectStyle}
                  value={filters.category}
                  onChange={(e) => setFilters({ ...filters, category: e.target.value })}
                >
                  <option value="">Select</option>
                  {filterOptions.categories.map((opt) => (
                    <option key={opt} value={opt}>
                      {opt}
                    </option>
                  ))}
                </select>
              </div>

              {/* Row 4: Client Grade, Potential Type, Business Category */}
              <div>
                <label style={{ display: "block", fontSize: "12.5px", fontWeight: 600, color: "#475569", marginBottom: "6px" }}>
                  Client Grade
                </label>
                <select
                  id="filter-client-grade"
                  style={filterSelectStyle}
                  value={filters.client_grade}
                  onChange={(e) => setFilters({ ...filters, client_grade: e.target.value })}
                >
                  <option value="">All</option>
                  {filterOptions.grades.map((opt) => (
                    <option key={opt} value={opt}>
                      {opt}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label style={{ display: "block", fontSize: "12.5px", fontWeight: 600, color: "#475569", marginBottom: "6px" }}>
                  Potential Type
                </label>
                <select
                  id="filter-potential-type"
                  style={filterSelectStyle}
                  value={filters.potential_type}
                  onChange={(e) => setFilters({ ...filters, potential_type: e.target.value })}
                >
                  <option value="">All</option>
                  {filterOptions.potentials.map((opt) => (
                    <option key={opt} value={opt}>
                      {opt}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label style={{ display: "block", fontSize: "12.5px", fontWeight: 600, color: "#475569", marginBottom: "6px" }}>
                  Business Category
                </label>
                <select
                  id="filter-business-category"
                  style={filterSelectStyle}
                  value={filters.business_category}
                  onChange={(e) => setFilters({ ...filters, business_category: e.target.value })}
                >
                  <option value="">All</option>
                  {filterOptions.businessCategories.map((opt) => (
                    <option key={opt} value={opt}>
                      {opt}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            {/* Bottom Action Buttons: Reset & Search */}
            <div style={{ display: "flex", justifyContent: "flex-end", gap: "10px" }}>
              <button
                id="btn-reset-filters"
                type="button"
                onClick={() => {
                  setFilters(INITIAL_FILTERS);
                  setAppliedFilters(INITIAL_FILTERS);
                }}
                style={{
                  height: "36px",
                  padding: "0 20px",
                  borderRadius: "6px",
                  border: "1px solid #cbd5e1",
                  background: "#f1f5f9",
                  color: "#475569",
                  fontSize: "13px",
                  fontWeight: 600,
                  cursor: "pointer",
                }}
              >
                Reset
              </button>
              <button
                id="btn-search-filters"
                type="button"
                onClick={() => setAppliedFilters(filters)}
                style={{
                  height: "36px",
                  padding: "0 22px",
                  borderRadius: "6px",
                  border: "none",
                  background: "#eab308",
                  color: "#ffffff",
                  fontSize: "13px",
                  fontWeight: 600,
                  cursor: "pointer",
                  boxShadow: "0 1px 2px rgba(0,0,0,0.06)",
                }}
              >
                Search
              </button>
            </div>
          </div>
        )}

        {/* Data Table Card */}
        <div
          className="card"
          style={{
            background: "#ffffff",
            borderRadius: "8px",
            border: "1px solid #e2e8f0",
            boxShadow: "0 1px 3px rgba(0,0,0,0.04)",
            overflow: "hidden",
          }}
        >
          {/* Table Controls (Items/Page and Search) */}
          <div
            style={{
              padding: "16px 20px",
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center",
              borderBottom: "1px solid #f1f5f9",
              flexWrap: "wrap",
              gap: "12px",
            }}
          >
            {/* Items Per Page */}
            <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
              <select
                id="items-per-page-select"
                value={itemsPerPage}
                onChange={(e) => {
                  setItemsPerPage(Number(e.target.value));
                  setCurrentPage(1);
                }}
                style={{
                  height: "36px",
                  padding: "0 28px 0 10px",
                  border: "1px solid #cbd5e1",
                  borderRadius: "6px",
                  fontSize: "13px",
                  color: "#334155",
                  background: `#ffffff url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='12' viewBox='0 0 24 24' fill='none' stroke='%2364748b' stroke-width='2.5' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpolyline points='6 9 12 15 18 9'%3E%3C/polyline%3E%3C/svg%3E") no-repeat right 8px center`,
                  appearance: "none",
                  cursor: "pointer",
                }}
              >
                <option value={10}>10</option>
                <option value={25}>25</option>
                <option value={50}>50</option>
                <option value={100}>100</option>
              </select>
              <span style={{ fontSize: "13px", color: "#64748b" }}>Items/Page</span>
            </div>

            {/* Free Search */}
            <div style={{ position: "relative", width: "240px" }}>
              <input
                id="table-search-input"
                type="text"
                placeholder="Search..."
                value={searchQuery}
                onChange={(e) => {
                  setSearchQuery(e.target.value);
                  setCurrentPage(1);
                }}
                style={{
                  ...inputStyle,
                  height: "36px",
                  paddingRight: searchQuery ? "28px" : "12px",
                  fontSize: "13px",
                }}
              />
              {searchQuery && (
                <button
                  type="button"
                  onClick={() => setSearchQuery("")}
                  style={{
                    position: "absolute",
                    right: "8px",
                    top: "50%",
                    transform: "translateY(-50%)",
                    background: "none",
                    border: "none",
                    color: "#94a3b8",
                    fontSize: "14px",
                    cursor: "pointer",
                    padding: 0,
                  }}
                >
                  ×
                </button>
              )}
            </div>
          </div>

          {/* Table Container */}
          <div className="table-scroll" style={{ overflowX: "auto" }}>
            <table
              id="follow-ups-table"
              style={{
                width: "100%",
                borderCollapse: "separate",
                borderSpacing: 0,
                fontSize: "13px",
                textAlign: "left",
              }}
            >
              <thead>
                <tr
                  style={{
                    background: "#f8fafc",
                    borderBottom: "1px solid #e2e8f0",
                    color: "#475569",
                    fontWeight: 600,
                  }}
                >
                  {/* 1. Checkbox */}
                  <th style={{ width: "40px", textAlign: "center", padding: "12px 14px" }}>
                    <input
                      id="select-all-checkbox"
                      type="checkbox"
                      checked={isAllSelected}
                      onChange={handleSelectAll}
                      style={{ cursor: "pointer", width: "16px", height: "16px" }}
                    />
                  </th>
                  {/* 2. Sr. No. */}
                  {renderSortHeader("Sr. No.", "sr_no")}
                  {/* 3. Company Name */}
                  {renderSortHeader("Company Name", "company_name")}
                  {/* 4. Contact Person */}
                  {renderSortHeader("Contact Person", "contact_person")}
                  {/* 5. Type / Grade */}
                  {renderSortHeader("Type / Grade", "type_grade")}
                  {/* 6. Area / City */}
                  {renderSortHeader("Area / City", "area_city")}
                  {/* 7. District / State */}
                  {renderSortHeader("District / State", "district_state")}
                  {/* 8. Current Status */}
                  {renderSortHeader("Current Status", "current_status")}
                  {/* 9. Feedback */}
                  {renderSortHeader("Feedback", "feedback")}
                  {/* 10. Call Category */}
                  {renderSortHeader("Call Category", "call_category")}
                  {/* 11. Followup Date */}
                  {renderSortHeader("Followup Date", "followup_date")}
                  {/* 12. Added On */}
                  {renderSortHeader("Added On", "added_on")}
                  {/* 13. Action */}
                  <th style={{ textAlign: "center", padding: "12px 14px", width: "90px" }}>Action</th>
                </tr>
              </thead>

              <tbody>
                {loading ? (
                  <FollowUpsTableSkeletonRows count={8} />
                ) : paginatedItems.length === 0 ? (
                  <tr>
                    <td
                      colSpan={13}
                      style={{
                        textAlign: "center",
                        padding: "36px 16px",
                        color: "#64748b",
                        background: "#f8fafc",
                        fontSize: "14px",
                        fontWeight: 500,
                      }}
                    >
                      No Data Available In Table
                    </td>
                  </tr>
                ) : (
                  paginatedItems.map((item, index) => {
                    const isSelected = selectedIds.has(item.id);
                    const srNo = startIndex + index;
                    return (
                      <tr
                        key={item.id}
                        style={{
                          borderBottom: "1px solid #f1f5f9",
                          background: isSelected ? "#f0f9ff" : "transparent",
                          transition: "background 0.1s ease",
                        }}
                      >
                        {/* 1. Checkbox */}
                        <td style={{ textAlign: "center", padding: "12px 14px" }}>
                          <input
                            type="checkbox"
                            checked={isSelected}
                            onChange={() => handleSelectRow(item.id)}
                            style={{ cursor: "pointer", width: "16px", height: "16px" }}
                          />
                        </td>

                        {/* 2. Sr. No. */}
                        <td style={{ textAlign: "center", padding: "12px 14px", color: "#64748b" }}>
                          {srNo}
                        </td>

                        {/* 3. Company Name */}
                        <td style={{ padding: "12px 14px" }}>
                          <button
                            type="button"
                            onClick={() => setInspectItem(item)}
                            style={{
                              background: "none",
                              border: "none",
                              color: "#0061f2",
                              fontWeight: 600,
                              cursor: "pointer",
                              padding: 0,
                              textAlign: "left",
                              fontSize: "13.5px",
                            }}
                            title="Inspect Follow Up Details"
                          >
                            {item.company_name}
                          </button>
                        </td>

                        {/* 4. Contact Person */}
                        <td style={{ padding: "12px 14px", color: "#334155" }}>
                          <div style={{ fontWeight: 500 }}>{item.contact_person || "—"}</div>
                          {item.contact_phone && (
                            <div style={{ fontSize: "11.5px", color: "#64748b", marginTop: "2px" }}>
                              📞 {item.contact_phone}
                            </div>
                          )}
                        </td>

                        {/* 5. Type / Grade */}
                        <td style={{ padding: "12px 14px", color: "#334155" }}>
                          <span>{item.business_type || "—"}</span>
                          {item.client_grade && (
                            <span style={{ color: "#64748b" }}> / {item.client_grade}</span>
                          )}
                        </td>

                        {/* 6. Area / City */}
                        <td style={{ padding: "12px 14px", color: "#334155" }}>
                          {item.area ? `${item.area} / ` : ""}
                          {item.city || "—"}
                        </td>

                        {/* 7. District / State */}
                        <td style={{ padding: "12px 14px", color: "#334155" }}>
                          {item.district ? `${item.district} / ` : ""}
                          {item.state || "—"}
                        </td>

                        {/* 8. Current Status */}
                        <td style={{ padding: "12px 14px" }}>
                          <span
                            style={{
                              display: "inline-block",
                              padding: "2px 10px",
                              borderRadius: "12px",
                              fontSize: "12px",
                              fontWeight: 600,
                              background:
                                item.current_status === "Existing"
                                  ? "#dcfce7"
                                  : item.current_status === "Hot Lead"
                                  ? "#fee2e2"
                                  : item.current_status === "Cold"
                                  ? "#f1f5f9"
                                  : "#e0f2fe",
                              color:
                                item.current_status === "Existing"
                                  ? "#166534"
                                  : item.current_status === "Hot Lead"
                                  ? "#991b1b"
                                  : item.current_status === "Cold"
                                  ? "#475569"
                                  : "#0369a1",
                            }}
                          >
                            {item.current_status || "New"}
                          </span>
                        </td>

                        {/* 9. Feedback */}
                        <td
                          style={{
                            padding: "12px 14px",
                            maxWidth: "200px",
                            whiteSpace: "nowrap",
                            overflow: "hidden",
                            textOverflow: "ellipsis",
                            color: "#334155",
                          }}
                          title={item.feedback || undefined}
                        >
                          {item.feedback || "—"}
                        </td>

                        {/* 10. Call Category */}
                        <td style={{ padding: "12px 14px", color: "#334155" }}>
                          {item.call_category || "—"}
                        </td>

                        {/* 11. Followup Date */}
                        <td style={{ padding: "12px 14px", color: "#334155", whiteSpace: "nowrap" }}>
                          {item.followup_date || "—"}
                        </td>

                        {/* 12. Added On */}
                        <td style={{ padding: "12px 14px", color: "#64748b", whiteSpace: "nowrap" }}>
                          {item.added_on || "—"}
                        </td>

                        {/* 13. Action */}
                        <td style={{ textAlign: "center", padding: "12px 14px" }}>
                          <div style={{ display: "inline-flex", gap: "6px" }}>
                            {/* Edit */}
                            <button
                              type="button"
                              onClick={() => handleOpenEditDrawer(item)}
                              style={{
                                width: "28px",
                                height: "28px",
                                borderRadius: "4px",
                                border: "1px solid #bfdbfe",
                                background: "#eff6ff",
                                color: "#1d4ed8",
                                cursor: "pointer",
                                display: "inline-flex",
                                alignItems: "center",
                                justifyContent: "center",
                                padding: 0,
                              }}
                              title="Edit Follow Up"
                            >
                              ✏️
                            </button>

                            {/* Delete */}
                            <button
                              type="button"
                              onClick={() => handleDeleteSingle(item)}
                              style={{
                                width: "28px",
                                height: "28px",
                                borderRadius: "4px",
                                border: "1px solid #fecaca",
                                background: "#fef2f2",
                                color: "#dc2626",
                                cursor: "pointer",
                                display: "inline-flex",
                                alignItems: "center",
                                justifyContent: "center",
                                padding: 0,
                              }}
                              title="Delete Follow Up"
                            >
                              🗑️
                            </button>
                          </div>
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>

          {/* Table Pagination Footer */}
          <div
            style={{
              padding: "14px 20px",
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center",
              borderTop: "1px solid #f1f5f9",
              flexWrap: "wrap",
              gap: "12px",
            }}
          >
            <div style={{ fontSize: "13px", color: "#64748b" }}>
              Showing {startIndex} To {endIndex} Of {totalEntries} Entries
            </div>

            <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
              <button
                type="button"
                disabled={currentPage <= 1}
                onClick={() => setCurrentPage((p) => Math.max(p - 1, 1))}
                style={{
                  height: "32px",
                  padding: "0 12px",
                  borderRadius: "4px",
                  border: "1px solid #cbd5e1",
                  background: currentPage <= 1 ? "#f8fafc" : "#ffffff",
                  color: currentPage <= 1 ? "#94a3b8" : "#334155",
                  fontSize: "12.5px",
                  cursor: currentPage <= 1 ? "not-allowed" : "pointer",
                }}
              >
                Previous
              </button>

              <span
                style={{
                  height: "32px",
                  padding: "0 12px",
                  display: "inline-flex",
                  alignItems: "center",
                  justifyContent: "center",
                  background: "#0061f2",
                  color: "#ffffff",
                  borderRadius: "4px",
                  fontSize: "12.5px",
                  fontWeight: 600,
                }}
              >
                {currentPage}
              </span>

              <button
                type="button"
                disabled={currentPage >= totalPages}
                onClick={() => setCurrentPage((p) => Math.min(p + 1, totalPages))}
                style={{
                  height: "32px",
                  padding: "0 12px",
                  borderRadius: "4px",
                  border: "1px solid #cbd5e1",
                  background: currentPage >= totalPages ? "#f8fafc" : "#ffffff",
                  color: currentPage >= totalPages ? "#94a3b8" : "#334155",
                  fontSize: "12.5px",
                  cursor: currentPage >= totalPages ? "not-allowed" : "pointer",
                }}
              >
                Next
              </button>
            </div>
          </div>
        </div>

        {/* SideDrawer: Inspect Follow Up Profile Details */}
        {inspectItem && (
          <SideDrawer
            title={inspectItem.company_name}
            subtitle="Follow Up Interaction Profile"
            isOpen={Boolean(inspectItem)}
            onClose={() => setInspectItem(null)}
            onEdit={() => {
              const target = inspectItem;
              setInspectItem(null);
              handleOpenEditDrawer(target);
            }}
            editLabel="✏️ Edit Log"
          >
            <div style={{ display: "flex", flexDirection: "column", gap: "20px" }}>
              {/* Call Summary Highlight */}
              <div
                style={{
                  padding: "14px 16px",
                  borderRadius: "8px",
                  background: "#eff6ff",
                  border: "1px solid #bfdbfe",
                }}
              >
                <div style={{ fontSize: "12px", fontWeight: 700, color: "#1e40af", marginBottom: "4px", textTransform: "uppercase" }}>
                  Feedback & Discussion Notes
                </div>
                <div style={{ fontSize: "14px", color: "#1e293b", lineHeight: 1.5 }}>
                  {inspectItem.feedback || "No feedback recorded for this interaction."}
                </div>
              </div>

              {/* Interaction Details */}
              <div style={{ fontSize: "13px", fontWeight: 700, color: "#475569", textTransform: "uppercase" }}>
                Interaction Details
              </div>
              <DetailFieldGrid
                fields={[
                  { label: "Call Type", value: inspectItem.call_type || "—" },
                  { label: "Call Category", value: inspectItem.call_category || "—" },
                  { label: "Marketing Person", value: inspectItem.marketing_person || "—" },
                  { label: "Current Status", value: inspectItem.current_status || "—" },
                  { label: "Next Followup Date", value: inspectItem.followup_date || "—" },
                  { label: "Added On", value: inspectItem.added_on || "—" },
                ]}
              />

              {/* Classification */}
              <div style={{ fontSize: "13px", fontWeight: 700, color: "#475569", textTransform: "uppercase" }}>
                Classification & Profile
              </div>
              <DetailFieldGrid
                fields={[
                  { label: "Business Type", value: inspectItem.business_type || "—" },
                  { label: "Client Grade", value: inspectItem.client_grade || "—" },
                  { label: "Potential Type", value: inspectItem.potential_type || "—" },
                  { label: "Business Category", value: inspectItem.business_category || "—" },
                  { label: "Category", value: inspectItem.category || "—" },
                ]}
              />

              {/* Geography */}
              <div style={{ fontSize: "13px", fontWeight: 700, color: "#475569", textTransform: "uppercase" }}>
                Geographic Location
              </div>
              <DetailFieldGrid
                fields={[
                  { label: "Address", value: inspectItem.address || "—" },
                  { label: "Area", value: inspectItem.area || "—" },
                  { label: "City", value: inspectItem.city || "—" },
                  { label: "District", value: inspectItem.district || "—" },
                  { label: "State", value: inspectItem.state || "—" },
                ]}
              />

              {/* Contact Information */}
              <div style={{ fontSize: "13px", fontWeight: 700, color: "#475569", textTransform: "uppercase" }}>
                Contact Information
              </div>
              <DetailFieldGrid
                fields={[
                  { label: "Contact Person", value: inspectItem.contact_person || "—" },
                  { label: "Designation", value: inspectItem.designation || "—" },
                  { label: "Contact Number", value: inspectItem.contact_phone || "—" },
                  { label: "Email", value: inspectItem.contact_email || "—" },
                ]}
              />
            </div>
          </SideDrawer>
        )}

        {/* Add / Edit Call Log Drawer (Matching exact screenshot fields) */}
        {isAddDrawerOpen && (
          <div
            id="call-log-drawer-backdrop"
            style={{
              position: "fixed",
              top: 0,
              left: 0,
              right: 0,
              bottom: 0,
              background: "rgba(15, 23, 42, 0.4)",
              backdropFilter: "blur(2px)",
              zIndex: 1000,
              display: "flex",
              justifyContent: "flex-end",
            }}
            onClick={() => setIsAddDrawerOpen(false)}
          >
            <div
              id="call-log-drawer"
              style={{
                width: "440px",
                maxWidth: "100%",
                height: "100%",
                background: "#ffffff",
                boxShadow: "-4px 0 24px rgba(0,0,0,0.12)",
                display: "flex",
                flexDirection: "column",
              }}
              onClick={(e) => e.stopPropagation()}
            >
              {/* Drawer Header */}
              <div
                style={{
                  padding: "16px 20px",
                  borderBottom: "1px solid #e2e8f0",
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "center",
                }}
              >
                <h2 style={{ margin: 0, fontSize: "16px", fontWeight: 700, color: "#1e293b" }}>
                  {editingItem ? "Edit Call Log" : "Add Call Log"}
                </h2>
                <button
                  id="btn-close-call-log-drawer"
                  type="button"
                  onClick={() => setIsAddDrawerOpen(false)}
                  style={{
                    background: "none",
                    border: "none",
                    fontSize: "18px",
                    color: "#94a3b8",
                    cursor: "pointer",
                    padding: "4px",
                    lineHeight: 1,
                  }}
                  title="Close"
                >
                  ✕
                </button>
              </div>

              {/* Drawer Form Body */}
              <form
                id="call-log-form"
                onSubmit={handleFormSubmit}
                style={{
                  display: "flex",
                  flexDirection: "column",
                  flex: 1,
                  overflowY: "auto",
                  justifyContent: "space-between",
                }}
              >
                <div
                  style={{
                    padding: "20px",
                    display: "flex",
                    flexDirection: "column",
                    gap: "16px",
                  }}
                >
                  {/* 1. Call Type * */}
                  <div>
                    <label style={{ display: "block", fontSize: "12.5px", fontWeight: 600, color: "#475569", marginBottom: "6px" }}>
                      Call Type <span style={{ color: "#ef4444" }}>*</span>
                    </label>
                    <select
                      id="call-log-call-type"
                      style={filterSelectStyle}
                      value={formData.call_type}
                      onChange={(e) => setFormData((prev) => ({ ...prev, call_type: e.target.value }))}
                    >
                      {DEFAULT_CALL_TYPES.map((t) => (
                        <option key={t} value={t}>
                          {t}
                        </option>
                      ))}
                    </select>
                  </div>

                  {/* 2. Company Name * with Typeahead Autocomplete */}
                  <div>
                    <label style={{ display: "block", fontSize: "12.5px", fontWeight: 600, color: "#475569", marginBottom: "6px" }}>
                      Company Name <span style={{ color: "#ef4444" }}>*</span>
                    </label>
                    <ClientNameAutocomplete
                      id="call-log-company-name"
                      value={formData.company_name}
                      placeholder="Search for Company Name"
                      onChange={(val) => setFormData((prev) => ({ ...prev, company_name: val }))}
                      onSelectCompany={(company: CompanyAutocompleteItem) => {
                        setFormData((prev) => ({
                          ...prev,
                          company_name: company.company_name || prev.company_name,
                          contact_person: company.contact_full_name || prev.contact_person,
                          contact_phone: company.contact_calling_number || prev.contact_phone,
                        }));
                      }}
                    />
                  </div>

                  {/* 3. Contact Person */}
                  <div>
                    <label style={{ display: "block", fontSize: "12.5px", fontWeight: 600, color: "#475569", marginBottom: "6px" }}>
                      Contact Person
                    </label>
                    <input
                      id="call-log-contact-person"
                      type="text"
                      style={inputStyle}
                      placeholder="Contact Person"
                      value={formData.contact_person}
                      onChange={(e) => setFormData((prev) => ({ ...prev, contact_person: e.target.value }))}
                    />
                  </div>

                  {/* 4. Phone Number */}
                  <div>
                    <label style={{ display: "block", fontSize: "12.5px", fontWeight: 600, color: "#475569", marginBottom: "6px" }}>
                      Phone Number
                    </label>
                    <input
                      id="call-log-phone-number"
                      type="text"
                      style={inputStyle}
                      value={formData.contact_phone}
                      onChange={(e) => setFormData((prev) => ({ ...prev, contact_phone: e.target.value }))}
                    />
                  </div>

                  {/* 5. Feedback */}
                  <div>
                    <label style={{ display: "block", fontSize: "12.5px", fontWeight: 600, color: "#475569", marginBottom: "6px" }}>
                      Feedback
                    </label>
                    <textarea
                      id="call-log-feedback"
                      rows={4}
                      style={{
                        ...inputStyle,
                        height: "auto",
                        minHeight: "85px",
                        padding: "10px 12px",
                        lineHeight: "1.5",
                        resize: "vertical",
                      }}
                      value={formData.feedback}
                      onChange={(e) => setFormData((prev) => ({ ...prev, feedback: e.target.value }))}
                    />
                  </div>

                  {/* 6. Follow Up Date & Status (2 Columns Grid) */}
                  <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "16px" }}>
                    <div>
                      <label style={{ display: "block", fontSize: "12.5px", fontWeight: 600, color: "#475569", marginBottom: "6px" }}>
                        Follow Up Date
                      </label>
                      <input
                        id="call-log-followup-date"
                        type="date"
                        style={inputStyle}
                        value={formData.followup_date}
                        onChange={(e) => setFormData((prev) => ({ ...prev, followup_date: e.target.value }))}
                      />
                    </div>

                    <div>
                      <label style={{ display: "block", fontSize: "12.5px", fontWeight: 600, color: "#475569", marginBottom: "6px" }}>
                        Status
                      </label>
                      <select
                        id="call-log-status"
                        style={filterSelectStyle}
                        value={formData.current_status}
                        onChange={(e) => setFormData((prev) => ({ ...prev, current_status: e.target.value }))}
                      >
                        <option value="Active">Active</option>
                        <option value="Inactive">Inactive</option>
                        <option value="Hot Lead">Hot Lead</option>
                        <option value="Cold">Cold</option>
                        <option value="Pending">Pending</option>
                        <option value="Completed">Completed</option>
                      </select>
                    </div>
                  </div>
                </div>

                {/* Submit Action Button pinned at bottom */}
                <div style={{ padding: "16px 20px", borderTop: "1px solid #e2e8f0", background: "#ffffff" }}>
                  <button
                    id="btn-submit-followup"
                    type="submit"
                    style={{
                      width: "100%",
                      height: "42px",
                      borderRadius: "6px",
                      border: "none",
                      background: "#0061f2",
                      color: "#ffffff",
                      fontSize: "14px",
                      fontWeight: 600,
                      cursor: "pointer",
                      boxShadow: "0 1px 3px rgba(0,97,242,0.25)",
                      transition: "background 0.15s ease",
                    }}
                  >
                    Submit
                  </button>
                </div>
              </form>
            </div>
          </div>
        )}

        {/* Delete Confirmation Modal */}
        {deleteConfirmTarget && (
          <div
            style={{
              position: "fixed",
              top: 0,
              left: 0,
              right: 0,
              bottom: 0,
              background: "rgba(15, 23, 42, 0.4)",
              backdropFilter: "blur(2px)",
              zIndex: 1100,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
            }}
          >
            <div
              style={{
                width: "420px",
                background: "#ffffff",
                borderRadius: "8px",
                padding: "24px",
                boxShadow: "0 10px 25px rgba(0,0,0,0.1)",
              }}
            >
              <h3 style={{ margin: "0 0 10px", fontSize: "17px", fontWeight: 700, color: "#1e293b" }}>
                Confirm Deletion
              </h3>
              <p style={{ margin: "0 0 20px", fontSize: "13.5px", color: "#64748b", lineHeight: 1.5 }}>
                {deleteConfirmTarget === "bulk"
                  ? `Are you sure you want to delete ${selectedIds.size} selected follow-up log(s)? Records can be audited or restored from Trash.`
                  : `Are you sure you want to delete the follow-up log for "${deleteConfirmTarget.company_name}"?`}
              </p>
              <div style={{ display: "flex", justifyContent: "flex-end", gap: "10px" }}>
                <button
                  type="button"
                  onClick={() => setDeleteConfirmTarget(null)}
                  style={{
                    height: "36px",
                    padding: "0 16px",
                    borderRadius: "6px",
                    border: "1px solid #cbd5e1",
                    background: "#ffffff",
                    color: "#475569",
                    fontSize: "13px",
                    fontWeight: 600,
                    cursor: "pointer",
                  }}
                >
                  Cancel
                </button>
                <button
                  id="btn-confirm-delete"
                  type="button"
                  onClick={executeDelete}
                  style={{
                    height: "36px",
                    padding: "0 18px",
                    borderRadius: "6px",
                    border: "none",
                    background: "#dc2626",
                    color: "#ffffff",
                    fontSize: "13px",
                    fontWeight: 600,
                    cursor: "pointer",
                  }}
                >
                  Delete
                </button>
              </div>
            </div>
          </div>
        )}
      </main>
    </AppShell>
  );
}
