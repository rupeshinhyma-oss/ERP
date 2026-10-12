/**
 * Leads Module Page.
 *
 * Designed with the exact look, feel, and UI architecture of the Companies module:
 * - AppShell activeKey="leads" pageClassName="page-suppliers"
 * - main.page layout with Breadcrumb and .page-header
 * - Header Actions: Filter toggle, + QUICK ADD, + ADD NEW, DELETE (bulk action)
 * - Togglable Filter Options card (.card) with Reset Filters & Search action buttons
 * - Exact 10-Field Filter Grid dynamically extracted from list data with reactive filtering
 * - Main Data Card (.card) with Status Tabs (All Leads, New, Contacted, In Discussion, Qualified, Won, Lost)
 * - Toolbar with Items/Page selector and Search input with clear button
 * - .table-scroll responsive data table with sortable headers, checkbox selection,
 *   clickable Company Name opening SideDrawer with DetailFieldGrid, and action buttons
 * - SideDrawer for full Lead Profile details matching Companies module inspection pattern
 * - Quick Add SideDrawer & Comprehensive Add/Edit Drawer with ClientNameAutocomplete
 * - Pagination footer matching Companies design
 */

import React, { useState, useEffect, useMemo, useCallback } from "react";
import { AppShell } from "@/components/AppShell";
import { Breadcrumb } from "@/components/Breadcrumb";
import { DateRangePicker } from "@/components/DateRangePicker";
import { SideDrawer, DetailFieldGrid } from "@/components/SideDrawer";
import { TableMessageRow } from "@/components/ui";
import { apiGet, apiPost, apiPut, apiDelete } from "@/lib/api";
import { useToast } from "@/lib/toast";
import { useOptions, optionValues } from "@/lib/options";
import {
  ClientNameAutocomplete,
  type CompanyAutocompleteItem,
} from "@/components/ClientNameAutocomplete";
import { Combobox } from "@/components/Combobox";
import { CompanyForm1Modal } from "@/components/CompanyForm1Modal";
import { QuickAddContactModal } from "@/components/QuickAddContactModal";
import { AllotLeadModal } from "@/components/AllotLeadModal";
import type { Lead } from "@/types";

const LEAD_OPTION_GROUPS = ["lead.business_type", "lead.priority", "lead.status"] as const;

interface LeadFormData {
  company_name: string;
  business_type: string;
  source: string;
  call_type: string;
  address: string;
  area: string;
  city: string;
  district: string;
  state: string;
  contact_person: string;
  designation: string;
  contact_phone: string;
  contact_email: string;
  priority: string;
  requirements: string;
  allotted_to: string;
  created_by: string;
  lead_status: string;
  reason_for_won_loss: string;
  notes: string;
}

const EMPTY_FORM: LeadFormData = {
  company_name: "",
  business_type: "B2B",
  source: "",
  call_type: "Telecall",
  address: "",
  area: "",
  city: "",
  district: "",
  state: "",
  contact_person: "",
  designation: "",
  contact_phone: "",
  contact_email: "",
  priority: "B",
  requirements: "",
  allotted_to: "",
  created_by: "",
  lead_status: "Ongoing",
  reason_for_won_loss: "",
  notes: "",
};

// Shimmer Skeleton Rows for Leads Table loading state
function LeadsTableSkeletonRows({ count = 8 }: { count?: number }) {
  const companyWidths = ["140px", "180px", "130px", "160px", "150px", "170px"];
  const personWidths = ["100px", "120px", "90px", "110px", "95px", "105px"];

  return (
    <>
      {Array.from({ length: count }).map((_, idx) => (
        <tr key={`skeleton-${idx}`} style={{ borderBottom: "1px solid #f1f5f9" }}>
          {/* Checkbox */}
          <td style={{ textAlign: "center", padding: "12px 14px" }}>
            <div className="skeleton-line" style={{ width: "16px", height: "16px", borderRadius: "4px", margin: "0 auto" }} />
          </td>
          {/* Sr. No. */}
          <td style={{ textAlign: "center", padding: "12px 14px" }}>
            <div className="skeleton-line" style={{ width: "24px", height: "14px", borderRadius: "4px", margin: "0 auto" }} />
          </td>
          {/* Company Name */}
          <td style={{ padding: "12px 14px" }}>
            <div className="skeleton-line" style={{ width: companyWidths[idx % companyWidths.length], height: "15px", borderRadius: "4px" }} />
          </td>
          {/* Business Type */}
          <td style={{ padding: "12px 14px" }}>
            <div className="skeleton-badge" style={{ width: "75px", height: "20px", borderRadius: "12px" }} />
          </td>
          {/* Source */}
          <td style={{ padding: "12px 14px" }}>
            <div className="skeleton-line" style={{ width: "65px", height: "14px", borderRadius: "4px" }} />
          </td>
          {/* Contact Person */}
          <td style={{ padding: "12px 14px" }}>
            <div className="skeleton-line" style={{ width: personWidths[idx % personWidths.length], height: "14px", borderRadius: "4px" }} />
          </td>
          {/* Priority */}
          <td style={{ padding: "12px 14px" }}>
            <div className="skeleton-badge" style={{ width: "45px", height: "20px", borderRadius: "12px" }} />
          </td>
          {/* Area/City */}
          <td style={{ padding: "12px 14px" }}>
            <div className="skeleton-line" style={{ width: "80px", height: "14px", borderRadius: "4px" }} />
          </td>
          {/* District / State */}
          <td style={{ padding: "12px 14px" }}>
            <div className="skeleton-line" style={{ width: "95px", height: "14px", borderRadius: "4px" }} />
          </td>
          {/* Requirements */}
          <td style={{ padding: "12px 14px" }}>
            <div className="skeleton-line" style={{ width: "110px", height: "14px", borderRadius: "4px" }} />
          </td>
          {/* Allotted To */}
          <td style={{ padding: "12px 14px" }}>
            <div className="skeleton-line" style={{ width: "85px", height: "14px", borderRadius: "4px" }} />
          </td>
          {/* Added On */}
          <td style={{ padding: "12px 14px" }}>
            <div className="skeleton-line" style={{ width: "75px", height: "14px", borderRadius: "4px" }} />
          </td>
          {/* Action */}
          <td style={{ textAlign: "center", padding: "12px 14px" }}>
            <div style={{ display: "inline-flex", gap: "6px" }}>
              <div className="skeleton-line" style={{ width: "50px", height: "24px", borderRadius: "4px" }} />
              <div className="skeleton-line" style={{ width: "50px", height: "24px", borderRadius: "4px" }} />
            </div>
          </td>
        </tr>
      ))}
    </>
  );
}

// Date range parser helper for robust multi-format matching
function parseDateBoundary(dateStr: string): Date | null {
  if (!dateStr) return null;
  const trimmed = dateStr.trim();
  if (trimmed.includes("-")) {
    const parts = trimmed.split("-");
    if (parts.length === 3) {
      if (parts[0].length === 4) {
        return new Date(parseInt(parts[0], 10), parseInt(parts[1], 10) - 1, parseInt(parts[2], 10));
      } else {
        return new Date(parseInt(parts[2], 10), parseInt(parts[1], 10) - 1, parseInt(parts[0], 10));
      }
    }
  }
  if (trimmed.includes("/")) {
    const parts = trimmed.split("/");
    if (parts.length === 3) {
      return new Date(parseInt(parts[2], 10), parseInt(parts[0], 10) - 1, parseInt(parts[1], 10));
    }
  }
  const d = new Date(trimmed);
  return isNaN(d.getTime()) ? null : d;
}

function isDateInRange(leadDateStr: string | null | undefined, rangeStr: string): boolean {
  if (!rangeStr || !rangeStr.trim()) return true;
  if (!leadDateStr) return false;

  const leadDate = parseDateBoundary(leadDateStr);
  if (!leadDate) return false;

  const separator = rangeStr.includes(" - ") ? " - " : rangeStr.includes(" to ") ? " to " : "-";
  const [startStr, endStr] = rangeStr.split(separator).map((s) => s.trim());
  if (!startStr) return true;

  const startDate = parseDateBoundary(startStr);
  const endDate = endStr ? parseDateBoundary(endStr) : startDate;

  if (startDate) {
    const startOfDay = new Date(startDate.getFullYear(), startDate.getMonth(), startDate.getDate(), 0, 0, 0);
    if (leadDate < startOfDay) return false;
  }
  if (endDate) {
    const endOfDay = new Date(endDate.getFullYear(), endDate.getMonth(), endDate.getDate(), 23, 59, 59);
    if (leadDate > endOfDay) return false;
  }
  return true;
}

export function LeadsPage() {
  const showToast = useToast();

  // All leads stored from backend
  const [leads, setLeads] = useState<Lead[]>([]);
  const [loading, setLoading] = useState<boolean>(true);

  // Pagination & Search
  const [itemsPerPage, setItemsPerPage] = useState<number>(50);
  const [currentPage, setCurrentPage] = useState<number>(1);
  const [searchQuery, setSearchQuery] = useState<string>("");

  // Column Sorting matching Companies module (asc/desc per column)
  type SortField =
    | "sr_no"
    | "company_name"
    | "business_type"
    | "source"
    | "call_type"
    | "contact_person"
    | "priority"
    | "area_city"
    | "district_state"
    | "requirements"
    | "allotted_to"
    | "added_on";

  const [sortField, setSortField] = useState<SortField | null>(null);
  const [sortDirection, setSortDirection] = useState<"asc" | "desc">("asc");

  const handleHeaderSort = (field: SortField) => {
    if (sortField === field) {
      if (sortDirection === "asc") {
        setSortDirection("desc");
      } else {
        setSortField(null);
        setSortDirection("asc");
      }
    } else {
      setSortField(field);
      setSortDirection("asc");
    }
  };

  // Filter Panel Toggle (off by default matching Companies module)
  const [showFilterPanel, setShowFilterPanel] = useState<boolean>(false);

  // Filter States
  const [filterDateRange, setFilterDateRange] = useState<string>("");
  const [filterCreatedBy, setFilterCreatedBy] = useState<string>("");
  const [filterBusinessType, setFilterBusinessType] = useState<string>("");
  const [filterState, setFilterState] = useState<string>("");
  const [filterDistrict, setFilterDistrict] = useState<string>("");
  const [filterCity, setFilterCity] = useState<string>("");
  const [filterSource, setFilterSource] = useState<string>("");
  const [filterCallType, setFilterCallType] = useState<string>("");
  const [filterPriority, setFilterPriority] = useState<string>("");
  const [filterAllottedTo, setFilterAllottedTo] = useState<string>("");
  const [filterStatus, setFilterStatus] = useState<string>("");
  const [activeStatusTab, setActiveStatusTab] = useState<"all" | "ongoing" | "won" | "loss">("all");

  // Selection for bulk delete
  const [selectedLeadIds, setSelectedLeadIds] = useState<string[]>([]);

  // SideDrawer Detail View (Companies module inspect pattern)
  const [drawerLead, setDrawerLead] = useState<Lead | null>(null);

  // Add / Edit Modal / Drawer
  const [drawerOpen, setDrawerOpen] = useState<boolean>(false);
  const [isEditing, setIsEditing] = useState<boolean>(false);
  const [currentEditId, setCurrentEditId] = useState<string | null>(null);
  const [formData, setFormData] = useState<LeadFormData>(EMPTY_FORM);
  const [formSaving, setFormSaving] = useState<boolean>(false);

  // Delete Confirmation Modal
  const [deleteModalOpen, setDeleteModalOpen] = useState<boolean>(false);
  const [leadToDelete, setLeadToDelete] = useState<Lead | null>(null);
  const [isBulkDeleteModal, setIsBulkDeleteModal] = useState<boolean>(false);
  const [deleteLoading, setDeleteLoading] = useState<boolean>(false);

  // Quick Add Company Form 1 & Contact Person Modals
  const [isCompanyForm1Open, setIsCompanyForm1Open] = useState<boolean>(false);
  const [isQuickContactOpen, setIsQuickContactOpen] = useState<boolean>(false);

  // Allot Lead Modal
  const [allotModalOpen, setAllotModalOpen] = useState<boolean>(false);
  const [leadToAllot, setLeadToAllot] = useState<Lead | null>(null);

  const handleOpenAllotModal = (lead: Lead) => {
    setLeadToAllot(lead);
    setAllotModalOpen(true);
  };

  const handleAllotSuccess = (leadId: string, allottedTo: string) => {
    setLeads((prev) =>
      prev.map((l) => (l.id === leadId ? { ...l, allotted_to: allottedTo } : l))
    );
    showToast(`Lead allotted to ${allottedTo} successfully.`, "success");
  };

  // Master Lead Sources
  const [sourceOptions, setSourceOptions] = useState<string[]>([]);

  // Fixed-choice lists come from the database (option_lists)
  const { options: optionGroups } = useOptions(LEAD_OPTION_GROUPS);
  const BUSINESS_TYPES = useMemo(() => optionValues(optionGroups, "lead.business_type"), [optionGroups]);
  const PRIORITIES = useMemo(() => optionValues(optionGroups, "lead.priority"), [optionGroups]);
  const STATUSES = useMemo(() => optionValues(optionGroups, "lead.status"), [optionGroups]);

  // States, Districts, and Cities master lists for Add/Edit drawer cascading
  const [stateMasterList, setStateMasterList] = useState<Array<{ id: string; name: string }>>([]);
  const [districtList, setDistrictList] = useState<Array<{ id: string; name: string }>>([]);
  const [cityList, setCityList] = useState<Array<{ id: string; name: string }>>([]);

  // Load Lead Sources from master if available
  useEffect(() => {
    let active = true;
    apiGet<any[]>("/masters/lead-sources")
      .then((res) => {
        if (active && Array.isArray(res.data)) {
          setSourceOptions(Array.from(new Set(res.data.map((item) => item.name).filter(Boolean))));
        }
      })
      .catch(() => {
        setSourceOptions([]);
      });
    return () => {
      active = false;
    };
  }, []);

  // Fetch States on mount / drawer open
  useEffect(() => {
    let active = true;
    apiGet<Array<{ id: string; name: string }>>("/masters/states?page_size=250&status=active")
      .then((res) => {
        if (active && Array.isArray(res.data) && res.data.length > 0) {
          const sorted = [...res.data].sort((a, b) => a.name.localeCompare(b.name));
          setStateMasterList(sorted);
        } else if (active) {
          setStateMasterList([]);
        }
      })
      .catch(() => {
        if (active) setStateMasterList([]);
      });
    return () => {
      active = false;
    };
  }, []);

  // When formData.state changes, fetch cascading districts
  useEffect(() => {
    if (!formData.state) {
      setDistrictList([]);
      setCityList([]);
      return;
    }
    const matchedState = stateMasterList.find(
      (s) => s.name.toLowerCase() === formData.state.toLowerCase() || s.id === formData.state
    );
    const stateIdOrName = matchedState ? matchedState.id : formData.state;

    // Load districts for selected state
    apiGet<Array<{ id: string; name: string }>>(`/masters/districts/lookup?state_id=${stateIdOrName}`)
      .then((res) => {
        if (Array.isArray(res.data) && res.data.length > 0) {
          setDistrictList([...res.data].sort((a, b) => a.name.localeCompare(b.name)));
        } else {
          apiGet<Array<{ id: string; name: string }>>(`/masters/districts?state_id=${stateIdOrName}&page_size=200`)
            .then((res2) => {
              if (Array.isArray(res2.data)) {
                setDistrictList([...res2.data].sort((a, b) => a.name.localeCompare(b.name)));
              }
            })
            .catch(() => setDistrictList([]));
        }
      })
      .catch(() => setDistrictList([]));
  }, [formData.state, stateMasterList]);

  // When formData.district changes, fetch cascading cities for that specific district
  useEffect(() => {
    if (!formData.district || !formData.state) {
      setCityList([]);
      return;
    }
    const matchedDist = districtList.find(
      (d) => d.name.toLowerCase() === formData.district.toLowerCase() || d.id === formData.district
    );
    const matchedState = stateMasterList.find(
      (s) => s.name.toLowerCase() === formData.state.toLowerCase() || s.id === formData.state
    );
    const distId = matchedDist ? matchedDist.id : formData.district;
    const stateId = matchedState ? matchedState.id : formData.state;

    // Load cities for selected district
    apiGet<Array<{ id: string; name: string }>>(`/masters/cities/lookup?district_id=${distId}&state_id=${stateId}`)
      .then((res) => {
        if (Array.isArray(res.data) && res.data.length > 0) {
          setCityList([...res.data].sort((a, b) => a.name.localeCompare(b.name)));
        } else {
          apiGet<Array<{ id: string; name: string }>>(`/masters/cities?district_id=${distId}&page_size=200&status=active`)
            .then((res2) => {
              if (Array.isArray(res2.data) && res2.data.length > 0) {
                setCityList([...res2.data].sort((a, b) => a.name.localeCompare(b.name)));
              } else {
                apiGet<Array<{ id: string; name: string }>>(`/masters/cities?state_id=${stateId}&page_size=200&status=active`)
                  .then((res3) => {
                    if (Array.isArray(res3.data)) {
                      const filtered = res3.data.filter((c: any) => !c.district_id || c.district_id === distId);
                      setCityList((filtered.length > 0 ? filtered : res3.data).sort((a, b) => a.name.localeCompare(b.name)));
                    }
                  })
                  .catch(() => setCityList([]));
              }
            })
            .catch(() => setCityList([]));
        }
      })
      .catch(() => setCityList([]));
  }, [formData.district, formData.state, districtList, stateMasterList]);

  // Fetch Leads List from Backend
  const loadLeads = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      params.append("limit", "500");
      params.append("offset", "0");

      if (searchQuery.trim()) params.append("search", searchQuery.trim());
      if (filterCreatedBy.trim()) params.append("created_by", filterCreatedBy.trim());
      if (filterBusinessType.trim()) params.append("business_type", filterBusinessType.trim());
      if (filterState.trim()) params.append("state", filterState.trim());
      if (filterDistrict.trim()) params.append("district", filterDistrict.trim());
      if (filterCity.trim()) params.append("city", filterCity.trim());
      if (filterSource.trim()) params.append("source", filterSource.trim());
      if (filterCallType.trim()) params.append("call_type", filterCallType.trim());
      if (filterPriority.trim()) params.append("priority", filterPriority.trim());
      if (filterAllottedTo.trim()) params.append("allotted_to", filterAllottedTo.trim());
      if (filterStatus.trim()) params.append("lead_status", filterStatus.trim());

      const res = await apiGet<{ items: Lead[]; total: number }>(
        `/leads/?${params.toString()}`
      );

      if (res.data && Array.isArray(res.data.items)) {
        setLeads(res.data.items);
      } else {
        setLeads([]);
      }
    } catch (err: any) {
      console.warn("Failed to load leads from backend, fallback empty state:", err);
      setLeads([]);
    } finally {
      setLoading(false);
    }
  }, [
    searchQuery,
    filterCreatedBy,
    filterBusinessType,
    filterState,
    filterDistrict,
    filterCity,
    filterSource,
    filterCallType,
    filterPriority,
    filterAllottedTo,
    filterStatus,
  ]);

  useEffect(() => {
    loadLeads();
  }, [loadLeads]);

  /* -------------------------------------------------------------------------- */
  /* Dynamic Filter Option Extraction Based on Leads in the List                */
  /* -------------------------------------------------------------------------- */

  // 1. Lead Created By: extracted from distinct created_by values in leads
  const extractedCreatedBy = useMemo(() => {
    const set = new Set<string>();
    leads.forEach((l) => {
      if (l.created_by && l.created_by.trim()) set.add(l.created_by.trim());
    });
    return Array.from(set).sort();
  }, [leads]);

  // 2. Business Type: extracted from distinct business_type values in leads + standards
  const extractedBusinessTypes = useMemo(() => {
    const set = new Set<string>();
    leads.forEach((l) => {
      if (l.business_type && l.business_type.trim()) set.add(l.business_type.trim());
    });
    BUSINESS_TYPES.forEach((b) => set.add(b));
    return Array.from(set).sort();
  }, [leads, BUSINESS_TYPES]);

  // 3. State: extracted from distinct state values in leads
  const extractedStates = useMemo(() => {
    const set = new Set<string>();
    leads.forEach((l) => {
      if (l.state && l.state.trim()) set.add(l.state.trim());
    });
    return Array.from(set).sort();
  }, [leads]);

  // 4. District: extracted from distinct district values (refined by selected State)
  const extractedDistricts = useMemo(() => {
    const set = new Set<string>();
    leads.forEach((l) => {
      const stateMatch = !filterState || l.state?.toLowerCase() === filterState.toLowerCase();
      if (stateMatch && l.district && l.district.trim()) {
        set.add(l.district.trim());
      }
    });
    return Array.from(set).sort();
  }, [leads, filterState]);

  // 5. City: extracted from distinct city values (refined by District / State)
  const extractedCities = useMemo(() => {
    const set = new Set<string>();
    leads.forEach((l) => {
      const stateMatch = !filterState || l.state?.toLowerCase() === filterState.toLowerCase();
      const districtMatch = !filterDistrict || l.district?.toLowerCase() === filterDistrict.toLowerCase();
      if (stateMatch && districtMatch && l.city && l.city.trim()) {
        set.add(l.city.trim());
      }
    });
    return Array.from(set).sort();
  }, [leads, filterState, filterDistrict]);

  // Add / Edit form cascading options for State, District, and City strictly based on Masters
  const drawerStateOptions = useMemo(() => {
    const set = new Set<string>();
    stateMasterList.forEach((s) => set.add(s.name));
    if (formData.state && formData.state.trim()) set.add(formData.state.trim());
    return Array.from(set).sort();
  }, [stateMasterList, formData.state]);

  const drawerDistrictOptions = useMemo(() => {
    if (!formData.state) return [];
    const set = new Set<string>();
    districtList.forEach((d) => set.add(d.name));
    if (formData.district && formData.district.trim()) set.add(formData.district.trim());
    return Array.from(set).sort();
  }, [formData.state, districtList, formData.district]);

  const drawerCityOptions = useMemo(() => {
    if (!formData.district) return [];
    const set = new Set<string>();
    cityList.forEach((c) => set.add(c.name));
    if (formData.city && formData.city.trim()) set.add(formData.city.trim());
    return Array.from(set).sort();
  }, [formData.district, cityList, formData.city]);

  // 6. Lead Source: extracted from distinct source values in leads + master sources
  const extractedSources = useMemo(() => {
    const set = new Set<string>(sourceOptions);
    leads.forEach((l) => {
      if (l.source && l.source.trim()) set.add(l.source.trim());
    });
    return Array.from(set).sort();
  }, [leads, sourceOptions]);

  // 7. Lead Allotted To: extracted from distinct allotted_to values in leads
  const extractedAllottedTo = useMemo(() => {
    const set = new Set<string>();
    leads.forEach((l) => {
      if (l.allotted_to && l.allotted_to.trim()) set.add(l.allotted_to.trim());
    });
    return Array.from(set).sort();
  }, [leads]);

  // 8. Lead Status: extracted from distinct lead_status values in leads
  const extractedStatuses = useMemo(() => {
    const set = new Set<string>(["Ongoing", "Won", "Loss"]);
    STATUSES.forEach((s) => set.add(s));
    leads.forEach((l) => {
      if (l.lead_status && l.lead_status.trim()) set.add(l.lead_status.trim());
    });
    return Array.from(set).sort();
  }, [leads, STATUSES]);

  // 9. Call Type: extracted from distinct call_type values in leads + standards
  const extractedCallTypes = useMemo(() => {
    const set = new Set<string>(["Telecall", "Physical Visit", "WhatsApp", "Email", "Incoming Inquiry"]);
    leads.forEach((l) => {
      if (l.call_type && l.call_type.trim()) set.add(l.call_type.trim());
    });
    return Array.from(set).sort();
  }, [leads]);

  // Status Tab Counts
  const tabCounts = useMemo(() => {
    let all = leads.length;
    let ongoing = 0;
    let won = 0;
    let loss = 0;

    leads.forEach((l) => {
      const st = (l.lead_status || "").toLowerCase();
      if (st === "won") won++;
      else if (st === "loss" || st === "lost") loss++;
      else ongoing++;
    });

    return { all, ongoing, won, loss };
  }, [leads]);

  /* -------------------------------------------------------------------------- */
  /* Real-Time Filter Execution on Data                                         */
  /* -------------------------------------------------------------------------- */
  const filteredLeads = useMemo(() => {
    return leads.filter((lead) => {
      // Status Tab Filter
      if (activeStatusTab === "won") {
        if ((lead.lead_status || "").toLowerCase() !== "won") return false;
      } else if (activeStatusTab === "loss") {
        const st = (lead.lead_status || "").toLowerCase();
        if (st !== "loss" && st !== "lost") return false;
      } else if (activeStatusTab === "ongoing") {
        const st = (lead.lead_status || "").toLowerCase();
        if (st === "won" || st === "loss" || st === "lost") return false;
      }

      // Date Range Filter
      if (filterDateRange.trim()) {
        const leadDate = lead.added_on || lead.created_at;
        if (!isDateInRange(leadDate, filterDateRange)) {
          return false;
        }
      }

      // Created By Filter
      if (filterCreatedBy.trim()) {
        if (!lead.created_by || lead.created_by.toLowerCase() !== filterCreatedBy.toLowerCase()) {
          return false;
        }
      }

      // Business Type Filter
      if (filterBusinessType.trim()) {
        if (!lead.business_type || lead.business_type.toLowerCase() !== filterBusinessType.toLowerCase()) {
          return false;
        }
      }

      // State Filter
      if (filterState.trim()) {
        if (!lead.state || lead.state.toLowerCase() !== filterState.toLowerCase()) {
          return false;
        }
      }

      // District Filter
      if (filterDistrict.trim()) {
        if (!lead.district || lead.district.toLowerCase() !== filterDistrict.toLowerCase()) {
          return false;
        }
      }

      // City Filter
      if (filterCity.trim()) {
        if (!lead.city || lead.city.toLowerCase() !== filterCity.toLowerCase()) {
          return false;
        }
      }

      // Lead Source Filter
      if (filterSource.trim()) {
        if (!lead.source || lead.source.toLowerCase() !== filterSource.toLowerCase()) {
          return false;
        }
      }

      // Call Type Filter
      if (filterCallType.trim()) {
        if (!lead.call_type || lead.call_type.toLowerCase() !== filterCallType.toLowerCase()) {
          return false;
        }
      }

      // Priority Filter
      if (filterPriority.trim()) {
        if (!lead.priority || lead.priority.toLowerCase() !== filterPriority.toLowerCase()) {
          return false;
        }
      }

      // Lead Allotted To Filter
      if (filterAllottedTo.trim()) {
        if (!lead.allotted_to || lead.allotted_to.toLowerCase() !== filterAllottedTo.toLowerCase()) {
          return false;
        }
      }

      // Lead Status Filter
      if (filterStatus.trim()) {
        if (!lead.lead_status || lead.lead_status.toLowerCase() !== filterStatus.toLowerCase()) {
          return false;
        }
      }

      // Search Query
      if (searchQuery.trim()) {
        const q = searchQuery.toLowerCase();
        const comp = (lead.company_name || "").toLowerCase();
        const contact = (lead.contact_person || "").toLowerCase();
        const phone = (lead.contact_phone || "").toLowerCase();
        const city = (lead.city || "").toLowerCase();
        const state = (lead.state || "").toLowerCase();
        const src = (lead.source || "").toLowerCase();
        const ct = (lead.call_type || "").toLowerCase();
        const req = (lead.requirements || "").toLowerCase();
        const allotted = (lead.allotted_to || "").toLowerCase();
        if (
          !comp.includes(q) &&
          !contact.includes(q) &&
          !phone.includes(q) &&
          !city.includes(q) &&
          !state.includes(q) &&
          !src.includes(q) &&
          !ct.includes(q) &&
          !req.includes(q) &&
          !allotted.includes(q)
        ) {
          return false;
        }
      }

      return true;
    });
  }, [
    leads,
    activeStatusTab,
    filterDateRange,
    filterCreatedBy,
    filterBusinessType,
    filterState,
    filterDistrict,
    filterCity,
    filterSource,
    filterCallType,
    filterPriority,
    filterAllottedTo,
    filterStatus,
    searchQuery,
  ]);

  // Reset Filters Handler
  const handleResetFilters = () => {
    setFilterDateRange("");
    setFilterCreatedBy("");
    setFilterBusinessType("");
    setFilterState("");
    setFilterDistrict("");
    setFilterCity("");
    setFilterSource("");
    setFilterCallType("");
    setFilterPriority("");
    setFilterAllottedTo("");
    setFilterStatus("");
    setActiveStatusTab("all");
    setSearchQuery("");
    setSortField(null);
    setSortDirection("asc");
    setCurrentPage(1);
    loadLeads();
  };

  // Search Button Handler
  const handleSearchFilters = () => {
    setCurrentPage(1);
    loadLeads();
  };

  // Priority order weight for sorting
  const PRIORITY_ORDER: Record<string, number> = {
    Urgent: 4,
    High: 3,
    Medium: 2,
    Low: 1,
  };

  // Real-time sorted leads across each column (ascending and descending)
  const sortedLeads = useMemo(() => {
    if (!sortField) return filteredLeads;
    const list = [...filteredLeads];
    list.sort((a, b) => {
      let comparison = 0;
      switch (sortField) {
        case "sr_no": {
          const dateA = new Date(a.added_on || a.created_at || 0).getTime();
          const dateB = new Date(b.added_on || b.created_at || 0).getTime();
          comparison = dateA - dateB;
          break;
        }
        case "company_name":
          comparison = (a.company_name || "").localeCompare(b.company_name || "", undefined, { sensitivity: "base" });
          break;
        case "business_type":
          comparison = (a.business_type || "").localeCompare(b.business_type || "", undefined, { sensitivity: "base" });
          break;
        case "source":
          comparison = (a.source || "").localeCompare(b.source || "", undefined, { sensitivity: "base" });
          break;
        case "call_type":
          comparison = (a.call_type || "").localeCompare(b.call_type || "", undefined, { sensitivity: "base" });
          break;
        case "contact_person":
          comparison = (a.contact_person || "").localeCompare(b.contact_person || "", undefined, { sensitivity: "base" });
          break;
        case "priority": {
          const rankA = PRIORITY_ORDER[a.priority || ""] || 0;
          const rankB = PRIORITY_ORDER[b.priority || ""] || 0;
          comparison = rankA - rankB;
          break;
        }
        case "area_city": {
          const locA = [a.area, a.city].filter(Boolean).join(" ");
          const locB = [b.area, b.city].filter(Boolean).join(" ");
          comparison = locA.localeCompare(locB, undefined, { sensitivity: "base" });
          break;
        }
        case "district_state": {
          const locA = [a.district, a.state].filter(Boolean).join(" ");
          const locB = [b.district, b.state].filter(Boolean).join(" ");
          comparison = locA.localeCompare(locB, undefined, { sensitivity: "base" });
          break;
        }
        case "requirements":
          comparison = (a.requirements || "").localeCompare(b.requirements || "", undefined, { sensitivity: "base" });
          break;
        case "allotted_to":
          comparison = (a.allotted_to || "").localeCompare(b.allotted_to || "", undefined, { sensitivity: "base" });
          break;
        case "added_on": {
          const dateA = new Date(a.added_on || a.created_at || 0).getTime();
          const dateB = new Date(b.added_on || b.created_at || 0).getTime();
          comparison = dateA - dateB;
          break;
        }
        default:
          comparison = 0;
      }
      return sortDirection === "asc" ? comparison : -comparison;
    });
    return list;
  }, [filteredLeads, sortField, sortDirection]);

  // Paginated Sliced Leads
  const totalRecords = sortedLeads.length;
  const totalPages = Math.ceil(totalRecords / itemsPerPage) || 1;
  const paginatedLeads = useMemo(() => {
    const start = (currentPage - 1) * itemsPerPage;
    return sortedLeads.slice(start, start + itemsPerPage);
  }, [sortedLeads, currentPage, itemsPerPage]);

  const startIndex = totalRecords === 0 ? 0 : (currentPage - 1) * itemsPerPage + 1;
  const endIndex = Math.min(currentPage * itemsPerPage, totalRecords);

  // Selection for bulk delete
  const allVisibleSelected = useMemo(() => {
    if (paginatedLeads.length === 0) return false;
    return paginatedLeads.every((l) => selectedLeadIds.includes(l.id));
  }, [paginatedLeads, selectedLeadIds]);

  const handleToggleSelectAll = () => {
    if (allVisibleSelected) {
      setSelectedLeadIds([]);
    } else {
      setSelectedLeadIds(paginatedLeads.map((l) => l.id));
    }
  };

  const handleToggleSelectOne = (id: string) => {
    setSelectedLeadIds((prev) =>
      prev.includes(id) ? prev.filter((item) => item !== id) : [...prev, id]
    );
  };


  // Open Add Drawer
  const handleOpenAddDrawer = () => {
    setIsEditing(false);
    setCurrentEditId(null);
    setFormData(EMPTY_FORM);
    setDrawerOpen(true);
  };

  // Open Edit Drawer
  const handleOpenEditDrawer = (lead: Lead) => {
    setIsEditing(true);
    setCurrentEditId(lead.id);
    setFormData({
      company_name: lead.company_name || "",
      business_type: lead.business_type || "",
      source: lead.source || "IndiaMart",
      call_type: lead.call_type || "Telecall",
      address: lead.address || "",
      area: lead.area || "",
      city: lead.city || "",
      district: lead.district || "",
      state: lead.state || "",
      contact_person: lead.contact_person || "",
      designation: lead.designation || "",
      contact_phone: lead.contact_phone || "",
      contact_email: lead.contact_email || "",
      priority: lead.priority || "B",
      requirements: lead.requirements || "",
      allotted_to: lead.allotted_to || "",
      created_by: lead.created_by || "",
      lead_status: lead.lead_status || "Ongoing",
      reason_for_won_loss: lead.reason_for_won_loss || "",
      notes: lead.notes || "",
    });
    setDrawerOpen(true);
  };

  // Autocomplete Selection Handler
  const handleCompanySelect = (company: CompanyAutocompleteItem) => {
    setFormData((prev) => ({
      ...prev,
      company_name: company.company_name || prev.company_name,
      business_type: company.company_type || prev.business_type,
      address: (company as any).address_line1 || (company as any).address || prev.address,
      area: company.area || prev.area,
      district: company.district || prev.district,
      city: (company as any).city_name || company.city_id || prev.city,
      state: (company as any).state_name || company.state_id || prev.state,
      contact_person: company.contact_full_name || prev.contact_person,
      designation: (company as any).designation || (company as any).contact_designation || prev.designation,
      contact_phone:
        company.contact_calling_number ||
        company.contact_whatsapp_number ||
        company.contact_indiamart_number ||
        prev.contact_phone,
      contact_email: (company as any).contact_email || (company as any).email || prev.contact_email,
    }));
  };

  // Form Submission
  const handleSaveLead = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!formData.company_name.trim()) {
      showToast("Company Name is required.", "error");
      return;
    }

    setFormSaving(true);
    try {
      if (isEditing && currentEditId) {
        await apiPut(`/leads/${currentEditId}`, formData);
        showToast("Lead updated successfully.", "success");
      } else {
        await apiPost("/leads/", formData);
        showToast("New lead created successfully.", "success");
      }
      setDrawerOpen(false);
      loadLeads();
    } catch (err: any) {
      showToast(err?.message || "Failed to save lead.", "error");
    } finally {
      setFormSaving(false);
    }
  };

  // Bulk Delete Trigger
  const handleOpenBulkDelete = () => {
    if (selectedLeadIds.length === 0) {
      showToast("Please select at least one lead to delete.", "warning");
      return;
    }
    setIsBulkDeleteModal(true);
    setLeadToDelete(null);
    setDeleteModalOpen(true);
  };

  // Single Delete Trigger
  const handleOpenSingleDelete = (lead: Lead) => {
    setIsBulkDeleteModal(false);
    setLeadToDelete(lead);
    setDeleteModalOpen(true);
  };

  // Confirm Delete Action
  const handleConfirmDelete = async () => {
    setDeleteLoading(true);
    try {
      if (isBulkDeleteModal) {
        await apiPost("/leads/bulk-delete", { ids: selectedLeadIds });
        showToast(`${selectedLeadIds.length} lead(s) deleted successfully.`, "success");
        setSelectedLeadIds([]);
      } else if (leadToDelete) {
        await apiDelete(`/leads/${leadToDelete.id}`);
        showToast("Lead deleted successfully.", "success");
        setSelectedLeadIds((prev) => prev.filter((id) => id !== leadToDelete.id));
      }
      setDeleteModalOpen(false);
      loadLeads();
    } catch (err: any) {
      showToast(err?.message || "Failed to delete lead.", "error");
    } finally {
      setDeleteLoading(false);
    }
  };

  // Priority Badge Color Helper
  const getPriorityBadge = (priority?: string | null) => {
    const p = (priority || "").toLowerCase();
    if (p === "a" || p === "urgent" || p === "critical") {
      return (
        <span
          style={{
            display: "inline-block",
            padding: "2px 8px",
            fontSize: "11.5px",
            fontWeight: 700,
            borderRadius: "4px",
            background: "#fee2e2",
            color: "#b91c1c",
            border: "1px solid #fca5a5",
          }}
        >
          {priority === "A" || priority === "a" ? "Priority A" : priority}
        </span>
      );
    }
    if (p === "high") {
      return (
        <span
          style={{
            display: "inline-block",
            padding: "2px 8px",
            fontSize: "11.5px",
            fontWeight: 700,
            borderRadius: "4px",
            background: "#ffedd5",
            color: "#c2410c",
            border: "1px solid #fdba74",
          }}
        >
          {priority}
        </span>
      );
    }
    if (p === "b" || p === "medium") {
      return (
        <span
          style={{
            display: "inline-block",
            padding: "2px 8px",
            fontSize: "11.5px",
            fontWeight: 700,
            borderRadius: "4px",
            background: "#fef3c7",
            color: "#b45309",
            border: "1px solid #fde68a",
          }}
        >
          {priority === "B" || priority === "b" ? "Priority B" : priority}
        </span>
      );
    }
    return (
      <span
        style={{
          display: "inline-block",
          padding: "2px 8px",
          fontSize: "11.5px",
          fontWeight: 700,
          borderRadius: "4px",
          background: "#e0f2fe",
          color: "#0369a1",
          border: "1px solid #bae6fd",
        }}
      >
        {priority === "C" || priority === "c" ? "Priority C" : (priority || "Priority B")}
      </span>
    );
  };

  // Status Badge Helper
  const getStatusBadge = (status?: string | null) => {
    const s = (status || "Ongoing").toLowerCase();
    if (s === "won" || s === "qualified") {
      return (
        <span
          style={{
            display: "inline-block",
            padding: "2px 8px",
            fontSize: "11.5px",
            fontWeight: 700,
            borderRadius: "4px",
            background: "#dcfce7",
            color: "#15803d",
            border: "1px solid #bbf7d0",
          }}
        >
          {status || "Won"}
        </span>
      );
    }
    if (s === "loss" || s === "lost") {
      return (
        <span
          style={{
            display: "inline-block",
            padding: "2px 8px",
            fontSize: "11.5px",
            fontWeight: 700,
            borderRadius: "4px",
            background: "#fef2f2",
            color: "#dc2626",
            border: "1px solid #fecaca",
          }}
        >
          {status || "Loss"}
        </span>
      );
    }
    return (
      <span
        style={{
          display: "inline-block",
          padding: "2px 8px",
          fontSize: "11.5px",
          fontWeight: 700,
          borderRadius: "4px",
          background: "#eff6ff",
          color: "#0284c7",
          border: "1px solid #bae6fd",
        }}
      >
        {status || "Ongoing"}
      </span>
    );
  };

  // Format Date Helper
  const formatDate = (dateStr?: string | null) => {
    if (!dateStr) return "—";
    try {
      const d = new Date(dateStr);
      if (isNaN(d.getTime())) return dateStr;
      const day = String(d.getDate()).padStart(2, "0");
      const month = String(d.getMonth() + 1).padStart(2, "0");
      const year = d.getFullYear();
      return `${day}-${month}-${year}`;
    } catch {
      return dateStr;
    }
  };

  // Column Header Sort Renderer matching Companies module
  const renderSortableHeader = (field: SortField, label: string, styleExtra?: React.CSSProperties) => {
    const isSorted = sortField === field;
    return (
      <th
        key={field}
        style={{
          padding: "10px 14px",
          borderBottom: "2px solid #e2e8f0",
          fontSize: "12px",
          fontWeight: 700,
          color: "#475569",
          userSelect: "none",
          ...styleExtra,
        }}
      >
        <div
          onClick={() => handleHeaderSort(field)}
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: "5px",
            cursor: "pointer",
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
                color: "#0284c7",
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
      </th>
    );
  };

  const fieldLabelStyle: React.CSSProperties = {
    display: "block",
    fontSize: "13px",
    fontWeight: 600,
    color: "#334155",
    marginBottom: "6px",
    lineHeight: "18px",
    height: "18px",
  };

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

  return (
    <AppShell activeKey="leads" pageClassName="page-suppliers">
      <main className="page">
        {/* Breadcrumb matching Companies module */}
        <Breadcrumb trail={["Leads"]} />

        {/* Page Header Bar */}
        <div className="page-header">
          <div>
            <h1>Leads</h1>
            <div className="page-subtitle">
              Lead directory, sourcing pipeline, contact tracking, and assignments.
            </div>
          </div>

          <div className="page-header-actions" style={{ display: "flex", gap: "10px", alignItems: "center" }}>
            {/* Filter Toggle Button */}
            <button
              type="button"
              id="btn-filter-leads"
              className="btn"
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
                transition: "background 0.15s ease",
              }}
              onClick={() => setShowFilterPanel((prev) => !prev)}
              title="Toggle Filter Options"
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <polygon points="22 3 2 3 10 12.46 10 19 14 21 14 12.46 22 3" />
              </svg>
            </button>


            {/* + ADD NEW (matching Companies module) */}
            <button
              type="button"
              id="btn-add-new-lead"
              className="btn btn-add-new"
              onClick={handleOpenAddDrawer}
            >
              + ADD NEW
            </button>

            {/* Bulk Delete / Action Button */}
            <button
              type="button"
              id="btn-bulk-delete-leads"
              className="btn"
              style={{
                background: selectedLeadIds.length > 0 ? "#dc2626" : "#10b981",
                color: "#ffffff",
                fontWeight: 700,
                fontSize: "13px",
                padding: "8px 16px",
                borderRadius: "4px",
                border: "none",
                cursor: "pointer",
                display: "inline-flex",
                alignItems: "center",
                gap: "6px",
                boxShadow: "0 1px 2px rgba(0, 0, 0, 0.05)",
                transition: "background 0.15s ease",
              }}
              onClick={handleOpenBulkDelete}
            >
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M3 6h18" />
                <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
              </svg>
              DELETE {selectedLeadIds.length > 0 ? `(${selectedLeadIds.length})` : ""}
            </button>
          </div>
        </div>

        {/* ------------------------------------------------------------------ */}
        {/* Togglable Filter Panel (.card matching Companies module)           */}
        {/* ------------------------------------------------------------------ */}
        {showFilterPanel && (
          <div
            id="leads-filter-card"
            className="card"
            style={{
              background: "#ffffff",
              padding: "20px",
              borderRadius: "10px",
              border: "1px solid #cbd5e1",
              marginBottom: "16px",
              boxShadow: "0 4px 6px -1px rgba(0, 0, 0, 0.05)",
            }}
          >
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "14px" }}>
              <div style={{ fontWeight: 600, fontSize: "14px", color: "#0f172a", display: "flex", alignItems: "center", gap: "6px" }}>
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <polygon points="22 3 2 3 10 12.46 10 19 14 21 14 12.46 22 3" />
                </svg>
                Filter Options
              </div>
              <div style={{ display: "flex", gap: "8px", alignItems: "center" }}>
                <button
                  type="button"
                  id="btn-filter-reset"
                  className="btn btn-small"
                  style={{
                    background: "#f1f5f9",
                    color: "#475569",
                    border: "1px solid #cbd5e1",
                    borderRadius: "6px",
                    cursor: "pointer",
                    fontWeight: 600,
                    padding: "6px 14px",
                    fontSize: "13px",
                  }}
                  onClick={handleResetFilters}
                >
                  Reset Filters
                </button>
                <button
                  type="button"
                  id="btn-filter-search"
                  className="btn btn-small"
                  style={{
                    background: "#eab308",
                    color: "#ffffff",
                    border: "none",
                    borderRadius: "6px",
                    cursor: "pointer",
                    fontWeight: 600,
                    padding: "6px 18px",
                    fontSize: "13px",
                    boxShadow: "0 1px 2px rgba(0, 0, 0, 0.05)",
                  }}
                  onClick={handleSearchFilters}
                >
                  Search
                </button>
              </div>
            </div>

            {/* 4 Rows x 3 Columns Filter Grid */}
            <div
              style={{
                display: "grid",
                gridTemplateColumns: "repeat(3, 1fr)",
                columnGap: "20px",
                rowGap: "14px",
              }}
            >
              {/* Row 1, Col 1: Lead Date Range */}
              <div>
                <label
                  htmlFor="filter-lead-date-range"
                  style={{ fontSize: "12px", fontWeight: 600, color: "#475569", marginBottom: "4px", display: "block" }}
                >
                  Lead Date Range
                </label>
                <DateRangePicker
                  id="filter-lead-date-range"
                  value={filterDateRange}
                  onChange={(val) => setFilterDateRange(val)}
                  onApply={(val) => setFilterDateRange(val)}
                  placeholder="Filter: Date Range"
                />
              </div>

              {/* Row 1, Col 2: Lead Created By */}
              <div>
                <label
                  htmlFor="filter-lead-created-by"
                  style={{ fontSize: "12px", fontWeight: 600, color: "#475569", marginBottom: "4px", display: "block" }}
                >
                  Lead Created By
                </label>
                <select
                  id="filter-lead-created-by"
                  value={filterCreatedBy}
                  onChange={(e) => setFilterCreatedBy(e.target.value)}
                  style={{
                    width: "100%",
                    padding: "8px 10px",
                    borderRadius: "6px",
                    border: "1px solid #cbd5e1",
                    fontSize: "13px",
                    background: "#ffffff",
                    color: "#334155",
                    outline: "none",
                  }}
                >
                  <option value="">Select</option>
                  {extractedCreatedBy.map((c) => (
                    <option key={c} value={c}>
                      {c}
                    </option>
                  ))}
                </select>
              </div>

              {/* Row 1, Col 3: Business Type */}
              <div>
                <label
                  htmlFor="filter-business-type"
                  style={{ fontSize: "12px", fontWeight: 600, color: "#475569", marginBottom: "4px", display: "block" }}
                >
                  Business Type
                </label>
                <select
                  id="filter-business-type"
                  value={filterBusinessType}
                  onChange={(e) => setFilterBusinessType(e.target.value)}
                  style={{
                    width: "100%",
                    padding: "8px 10px",
                    borderRadius: "6px",
                    border: "1px solid #cbd5e1",
                    fontSize: "13px",
                    background: "#ffffff",
                    color: "#334155",
                    outline: "none",
                  }}
                >
                  <option value="">All</option>
                  {extractedBusinessTypes.map((bt) => (
                    <option key={bt} value={bt}>
                      {bt}
                    </option>
                  ))}
                </select>
              </div>

              {/* Row 2, Col 1: State */}
              <div>
                <label
                  htmlFor="filter-state"
                  style={{ fontSize: "12px", fontWeight: 600, color: "#475569", marginBottom: "4px", display: "block" }}
                >
                  State
                </label>
                <select
                  id="filter-state"
                  value={filterState}
                  onChange={(e) => {
                    setFilterState(e.target.value);
                    setFilterDistrict("");
                    setFilterCity("");
                  }}
                  style={{
                    width: "100%",
                    padding: "8px 10px",
                    borderRadius: "6px",
                    border: "1px solid #cbd5e1",
                    fontSize: "13px",
                    background: "#ffffff",
                    color: "#334155",
                    outline: "none",
                  }}
                >
                  <option value="">All</option>
                  {extractedStates.map((st) => (
                    <option key={st} value={st}>
                      {st}
                    </option>
                  ))}
                </select>
              </div>

              {/* Row 2, Col 2: District */}
              <div>
                <label
                  htmlFor="filter-district"
                  style={{ fontSize: "12px", fontWeight: 600, color: "#475569", marginBottom: "4px", display: "block" }}
                >
                  District
                </label>
                <select
                  id="filter-district"
                  value={filterDistrict}
                  onChange={(e) => {
                    setFilterDistrict(e.target.value);
                    setFilterCity("");
                  }}
                  style={{
                    width: "100%",
                    padding: "8px 10px",
                    borderRadius: "6px",
                    border: "1px solid #cbd5e1",
                    fontSize: "13px",
                    background: "#ffffff",
                    color: "#334155",
                    outline: "none",
                  }}
                >
                  <option value="">All</option>
                  {extractedDistricts.map((dst) => (
                    <option key={dst} value={dst}>
                      {dst}
                    </option>
                  ))}
                </select>
              </div>

              {/* Row 2, Col 3: City */}
              <div>
                <label
                  htmlFor="filter-city"
                  style={{ fontSize: "12px", fontWeight: 600, color: "#475569", marginBottom: "4px", display: "block" }}
                >
                  City
                </label>
                <select
                  id="filter-city"
                  value={filterCity}
                  onChange={(e) => setFilterCity(e.target.value)}
                  style={{
                    width: "100%",
                    padding: "8px 10px",
                    borderRadius: "6px",
                    border: "1px solid #cbd5e1",
                    fontSize: "13px",
                    background: "#ffffff",
                    color: "#334155",
                    outline: "none",
                  }}
                >
                  <option value="">All</option>
                  {extractedCities.map((ct) => (
                    <option key={ct} value={ct}>
                      {ct}
                    </option>
                  ))}
                </select>
              </div>

              {/* Row 3, Col 1: Lead Source */}
              <div>
                <label
                  htmlFor="filter-lead-source"
                  style={{ fontSize: "12px", fontWeight: 600, color: "#475569", marginBottom: "4px", display: "block" }}
                >
                  Lead Source
                </label>
                <select
                  id="filter-lead-source"
                  value={filterSource}
                  onChange={(e) => setFilterSource(e.target.value)}
                  style={{
                    width: "100%",
                    padding: "8px 10px",
                    borderRadius: "6px",
                    border: "1px solid #cbd5e1",
                    fontSize: "13px",
                    background: "#ffffff",
                    color: "#334155",
                    outline: "none",
                  }}
                >
                  <option value="">Select</option>
                  {extractedSources.map((src) => (
                    <option key={src} value={src}>
                      {src}
                    </option>
                  ))}
                </select>
              </div>

              {/* Row 3, Col 2: Priority */}
              <div>
                <label
                  htmlFor="filter-priority"
                  style={{ fontSize: "12px", fontWeight: 600, color: "#475569", marginBottom: "4px", display: "block" }}
                >
                  Priority
                </label>
                <select
                  id="filter-priority"
                  value={filterPriority}
                  onChange={(e) => setFilterPriority(e.target.value)}
                  style={{
                    width: "100%",
                    padding: "8px 10px",
                    borderRadius: "6px",
                    border: "1px solid #cbd5e1",
                    fontSize: "13px",
                    background: "#ffffff",
                    color: "#334155",
                    outline: "none",
                  }}
                >
                  <option value="">All</option>
                  {PRIORITIES.map((p) => (
                    <option key={p} value={p}>
                      {p}
                    </option>
                  ))}
                </select>
              </div>

              {/* Row 3, Col 3: Lead Allotted To */}
              <div>
                <label
                  htmlFor="filter-lead-allotted-to"
                  style={{ fontSize: "12px", fontWeight: 600, color: "#475569", marginBottom: "4px", display: "block" }}
                >
                  Lead Allotted To
                </label>
                <select
                  id="filter-lead-allotted-to"
                  value={filterAllottedTo}
                  onChange={(e) => setFilterAllottedTo(e.target.value)}
                  style={{
                    width: "100%",
                    padding: "8px 10px",
                    borderRadius: "6px",
                    border: "1px solid #cbd5e1",
                    fontSize: "13px",
                    background: "#ffffff",
                    color: "#334155",
                    outline: "none",
                  }}
                >
                  <option value="">All</option>
                  {extractedAllottedTo.map((alt) => (
                    <option key={alt} value={alt}>
                      {alt}
                    </option>
                  ))}
                </select>
              </div>

              {/* Row 4, Col 1: Lead Status */}
              <div>
                <label
                  htmlFor="filter-lead-status"
                  style={{ fontSize: "12px", fontWeight: 600, color: "#475569", marginBottom: "4px", display: "block" }}
                >
                  Lead Status
                </label>
                <select
                  id="filter-lead-status"
                  value={filterStatus}
                  onChange={(e) => setFilterStatus(e.target.value)}
                  style={{
                    width: "100%",
                    padding: "8px 10px",
                    borderRadius: "6px",
                    border: "1px solid #cbd5e1",
                    fontSize: "13px",
                    background: "#ffffff",
                    color: "#334155",
                    outline: "none",
                  }}
                >
                  <option value="">All</option>
                  {extractedStatuses.map((st) => (
                    <option key={st} value={st}>
                      {st}
                    </option>
                  ))}
                </select>
              </div>

              {/* Row 4, Col 2: Call Type */}
              <div>
                <label
                  htmlFor="filter-call-type"
                  style={{ fontSize: "12px", fontWeight: 600, color: "#475569", marginBottom: "4px", display: "block" }}
                >
                  Call Type
                </label>
                <select
                  id="filter-call-type"
                  value={filterCallType}
                  onChange={(e) => setFilterCallType(e.target.value)}
                  style={{
                    width: "100%",
                    padding: "8px 10px",
                    borderRadius: "6px",
                    border: "1px solid #cbd5e1",
                    fontSize: "13px",
                    background: "#ffffff",
                    color: "#334155",
                    outline: "none",
                  }}
                >
                  <option value="">All</option>
                  {extractedCallTypes.map((ct) => (
                    <option key={ct} value={ct}>
                      {ct}
                    </option>
                  ))}
                </select>
              </div>
            </div>
          </div>
        )}

        {/* ------------------------------------------------------------------ */}
        {/* Main Data Table Card (.card matching Companies module)            */}
        {/* ------------------------------------------------------------------ */}
        <div
          className="card"
          style={{
            background: "#ffffff",
            borderRadius: "10px",
            border: "1px solid #cbd5e1",
            boxShadow: "0 4px 6px -1px rgba(0, 0, 0, 0.05)",
            overflow: "hidden",
          }}
        >
          {/* Top Status Tabs */}
          <div
            data-testid="leads-status-tabs"
            style={{
              display: "flex",
              alignItems: "center",
              gap: "4px",
              padding: "10px 16px 0 16px",
              borderBottom: "1px solid #e2e8f0",
              background: "#fafafa",
            }}
          >
            {[
              { id: "all", label: "All Leads", count: tabCounts.all, color: "#0061f2" },
              { id: "ongoing", label: "Ongoing", count: tabCounts.ongoing, color: "#0284c7" },
              { id: "won", label: "Won", count: tabCounts.won, color: "#16a34a" },
              { id: "loss", label: "Loss", count: tabCounts.loss, color: "#dc2626" },
            ].map((tab) => {
              const isActive = activeStatusTab === tab.id;
              return (
                <button
                  key={tab.id}
                  type="button"
                  data-testid={`lead-tab-${tab.id}`}
                  onClick={() => {
                    setActiveStatusTab(tab.id as any);
                    setCurrentPage(1);
                  }}
                  style={{
                    background: "none",
                    border: "none",
                    borderBottom: isActive ? `3px solid ${tab.color}` : "3px solid transparent",
                    padding: "8px 16px",
                    fontWeight: isActive ? 700 : 500,
                    fontSize: "13.5px",
                    color: isActive ? tab.color : "#64748b",
                    cursor: "pointer",
                    display: "flex",
                    alignItems: "center",
                    gap: "6px",
                    marginBottom: "-1px",
                    transition: "all 0.15s ease",
                  }}
                >
                  <span>{tab.label}</span>
                  <span
                    style={{
                      background: isActive ? `${tab.color}15` : "#e2e8f0",
                      color: isActive ? tab.color : "#475569",
                      padding: "1px 7px",
                      borderRadius: "10px",
                      fontSize: "11px",
                      fontWeight: 700,
                    }}
                  >
                    {tab.count}
                  </span>
                </button>
              );
            })}
          </div>

          {/* Table Toolbar */}
          <div
            className="toolbar"
            style={{
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center",
              padding: "10px 16px",
              gap: "10px",
              flexWrap: "wrap",
              borderBottom: "1px solid #f1f5f9",
            }}
          >
            <div style={{ display: "flex", gap: "12px", alignItems: "center" }}>
              <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                <select
                  id="leads-items-per-page"
                  value={itemsPerPage}
                  onChange={(e) => {
                    setItemsPerPage(Number(e.target.value));
                    setCurrentPage(1);
                  }}
                  style={{
                    padding: "6px 12px",
                    borderRadius: "6px",
                    border: "1px solid #cbd5e1",
                    fontSize: "13px",
                    background: "#ffffff",
                    color: "#334155",
                    outline: "none",
                  }}
                >
                  <option value={10}>10</option>
                  <option value={20}>20</option>
                  <option value={50}>50</option>
                  <option value={100}>100</option>
                </select>
                <span style={{ fontSize: "13px", color: "#64748b", fontWeight: 500 }}>
                  Items/Page
                </span>
              </div>
            </div>

            <div style={{ position: "relative", display: "inline-flex", alignItems: "center" }}>
              <input
                type="text"
                id="leads-search-input"
                placeholder="Search..."
                value={searchQuery}
                onChange={(e) => {
                  setSearchQuery(e.target.value);
                  setCurrentPage(1);
                }}
                style={{
                  width: "300px",
                  padding: "8px 36px 8px 14px",
                  borderRadius: "6px",
                  border: "1px solid #cbd5e1",
                  fontSize: "13px",
                  outline: "none",
                  background: "#ffffff",
                  color: "#1e293b",
                }}
              />
              {searchQuery ? (
                <button
                  type="button"
                  onClick={() => setSearchQuery("")}
                  title="Clear search"
                  style={{
                    position: "absolute",
                    right: "8px",
                    background: "none",
                    border: "none",
                    cursor: "pointer",
                    color: "#94a3b8",
                    fontSize: "16px",
                    lineHeight: 1,
                    padding: "0 2px",
                    display: "flex",
                    alignItems: "center",
                  }}
                >
                  ×
                </button>
              ) : (
                <svg
                  width="15"
                  height="15"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="#94a3b8"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  style={{
                    position: "absolute",
                    right: "12px",
                    pointerEvents: "none",
                  }}
                >
                  <circle cx="11" cy="11" r="8" />
                  <line x1="21" y1="21" x2="16.65" y2="16.65" />
                </svg>
              )}
            </div>
          </div>

          {/* Table Container with Companies table-scroll styling */}
          <div className="table-scroll" style={{ maxHeight: "calc(100vh - 220px)", overflowY: "auto", overflowX: "auto" }}>
            <table
              id="leads-table"
              style={{
                width: "100%",
                borderCollapse: "separate",
                borderSpacing: 0,
                textAlign: "left",
                fontSize: "13px",
              }}
            >
              <thead>
                <tr style={{ background: "#f8fafc" }}>
                  <th style={{ width: "40px", minWidth: "40px", maxWidth: "45px", textAlign: "center", padding: "10px 14px", borderBottom: "2px solid #e2e8f0" }}>
                    <input
                      type="checkbox"
                      id="select-all-leads"
                      checked={allVisibleSelected}
                      onChange={handleToggleSelectAll}
                      style={{ cursor: "pointer", width: "16px", height: "16px" }}
                    />
                  </th>
                  {renderSortableHeader("sr_no", "Sr. No.", { width: "75px", minWidth: "75px", maxWidth: "85px", textAlign: "center" })}
                  {renderSortableHeader("company_name", "Company Name")}
                  {renderSortableHeader("business_type", "Business Type")}
                  {renderSortableHeader("source", "Source")}
                  {renderSortableHeader("call_type", "Call Type")}
                  {renderSortableHeader("contact_person", "Contact Person")}
                  {renderSortableHeader("priority", "Priority")}
                  {renderSortableHeader("area_city", "Area/City")}
                  {renderSortableHeader("district_state", "District / State")}
                  {renderSortableHeader("requirements", "Requirements")}
                  {renderSortableHeader("allotted_to", "Allotted To")}
                  {renderSortableHeader("added_on", "Added On")}
                  <th style={{ textAlign: "center", padding: "10px 14px", borderBottom: "2px solid #e2e8f0", fontSize: "12px", fontWeight: 700, color: "#475569" }}>Action</th>
                </tr>
              </thead>
              <tbody>
                {loading ? (
                  <LeadsTableSkeletonRows count={8} />
                ) : paginatedLeads.length === 0 ? (
                  <TableMessageRow colSpan={14}>No Data Available In Table</TableMessageRow>
                ) : (
                  paginatedLeads.map((lead, idx) => {
                    const rowNum = (currentPage - 1) * itemsPerPage + idx + 1;
                    const isSelected = selectedLeadIds.includes(lead.id);

                    return (
                      <tr
                        key={lead.id}
                        style={{
                          background: isSelected ? "#f0fdf4" : "transparent",
                          transition: "background 0.15s ease",
                        }}
                        onMouseEnter={(e) => {
                          if (!isSelected) e.currentTarget.style.background = "#f8fafc";
                        }}
                        onMouseLeave={(e) => {
                          if (!isSelected) e.currentTarget.style.background = "transparent";
                        }}
                      >
                        {/* Checkbox */}
                        <td style={{ textAlign: "center", padding: "10px 14px", borderBottom: "1px solid #f1f5f9" }}>
                          <input
                            type="checkbox"
                            checked={isSelected}
                            onChange={() => handleToggleSelectOne(lead.id)}
                            style={{ cursor: "pointer", width: "16px", height: "16px" }}
                          />
                        </td>

                        {/* Sr. No. */}
                        <td style={{ textAlign: "center", padding: "10px 14px", borderBottom: "1px solid #f1f5f9", color: "#64748b", fontWeight: 600 }}>
                          {rowNum}
                        </td>

                        {/* Company Name (clickable to open SideDrawer) */}
                        <td style={{ padding: "10px 14px", borderBottom: "1px solid #f1f5f9", fontWeight: 600 }}>
                          <a
                            href="#"
                            onClick={(e) => {
                              e.preventDefault();
                              setDrawerLead(lead);
                            }}
                            style={{ color: "#0061f2", textDecoration: "none", cursor: "pointer" }}
                            title="Click to view details in SideDrawer"
                          >
                            {lead.company_name}
                          </a>
                        </td>

                        {/* Business Type (B2B / B2C) */}
                        <td style={{ padding: "10px 14px", borderBottom: "1px solid #f1f5f9" }}>
                          <span
                            className="chip"
                            style={{
                              background: (lead.business_type || "").toUpperCase() === "B2B" ? "#eff6ff" : (lead.business_type || "").toUpperCase() === "B2C" ? "#fdf4ff" : "#f1f5f9",
                              color: (lead.business_type || "").toUpperCase() === "B2B" ? "#1d4ed8" : (lead.business_type || "").toUpperCase() === "B2C" ? "#86198f" : "#334155",
                              border: (lead.business_type || "").toUpperCase() === "B2B" ? "1px solid #bfdbfe" : (lead.business_type || "").toUpperCase() === "B2C" ? "1px solid #f5d0fe" : "1px solid #e2e8f0",
                              padding: "3px 8px",
                              borderRadius: "12px",
                              fontSize: "12px",
                              fontWeight: 600,
                            }}
                          >
                            {lead.business_type || "B2B"}
                          </span>
                        </td>

                        {/* Source */}
                        <td style={{ padding: "10px 14px", borderBottom: "1px solid #f1f5f9", color: "#475569" }}>
                          {lead.source || "—"}
                        </td>

                        {/* Call Type */}
                        <td style={{ padding: "10px 14px", borderBottom: "1px solid #f1f5f9" }}>
                          {lead.call_type ? (
                            <span
                              style={{
                                background:
                                  lead.call_type === "Physical Visit"
                                    ? "#fef3c7"
                                    : lead.call_type === "Telecall"
                                    ? "#e0e7ff"
                                    : "#f1f5f9",
                                color:
                                  lead.call_type === "Physical Visit"
                                    ? "#92400e"
                                    : lead.call_type === "Telecall"
                                    ? "#4338ca"
                                    : "#475569",
                                padding: "2px 8px",
                                borderRadius: "10px",
                                fontSize: "11px",
                                fontWeight: 600,
                                display: "inline-block",
                              }}
                            >
                              {lead.call_type}
                            </span>
                          ) : (
                            <span style={{ color: "#94a3b8" }}>—</span>
                          )}
                        </td>

                        {/* Contact Person */}
                        <td style={{ padding: "10px 14px", borderBottom: "1px solid #f1f5f9" }}>
                          <div style={{ fontWeight: 600, color: "#1e293b" }}>{lead.contact_person || "—"}</div>
                          {lead.contact_phone && (
                            <div style={{ fontSize: "11.5px", color: "#059669", fontWeight: 500 }}>
                              📞 {lead.contact_phone}
                            </div>
                          )}
                        </td>

                        {/* Priority */}
                        <td style={{ padding: "10px 14px", borderBottom: "1px solid #f1f5f9" }}>
                          {getPriorityBadge(lead.priority)}
                        </td>

                        {/* Area/City */}
                        <td style={{ padding: "10px 14px", borderBottom: "1px solid #f1f5f9", color: "#334155" }}>
                          {[lead.area, lead.city].filter(Boolean).join(", ") || "—"}
                        </td>

                        {/* District / State */}
                        <td style={{ padding: "10px 14px", borderBottom: "1px solid #f1f5f9", color: "#334155" }}>
                          {[lead.district, lead.state].filter(Boolean).join(" / ") || "—"}
                        </td>

                        {/* Requirements */}
                        <td
                          style={{
                            padding: "10px 14px",
                            borderBottom: "1px solid #f1f5f9",
                            maxWidth: "180px",
                            overflow: "hidden",
                            textOverflow: "ellipsis",
                            whiteSpace: "nowrap",
                            color: "#475569",
                          }}
                          title={lead.requirements || ""}
                        >
                          {lead.requirements || "—"}
                        </td>

                        {/* Allotted To */}
                        <td style={{ padding: "10px 14px", borderBottom: "1px solid #f1f5f9" }}>
                          <span style={{ color: lead.allotted_to ? "#0f172a" : "#94a3b8", fontWeight: 500 }}>
                            {lead.allotted_to || "Unassigned"}
                          </span>
                        </td>

                        {/* Added On */}
                        <td style={{ padding: "10px 14px", borderBottom: "1px solid #f1f5f9", color: "#64748b", whiteSpace: "nowrap" }}>
                          {formatDate(lead.added_on || lead.created_at)}
                        </td>

                        {/* Action buttons matching Leads module spec */}
                        <td style={{ textAlign: "center", padding: "10px 14px", borderBottom: "1px solid #f1f5f9" }}>
                          <div style={{ display: "inline-flex", gap: "6px", alignItems: "center", justifyContent: "center" }}>
                            <button
                              type="button"
                              id={`btn-allot-lead-${lead.id}`}
                              data-testid="btn-lead-allot"
                              className="btn btn-small"
                              style={{
                                background: "#f0fdf4",
                                color: "#16a34a",
                                border: "1px solid #bbf7d0",
                                borderRadius: "4px",
                                padding: "4px 8px",
                                fontSize: "12px",
                                fontWeight: 600,
                                cursor: "pointer",
                                display: "inline-flex",
                                alignItems: "center",
                                gap: "4px",
                              }}
                              onClick={() => handleOpenAllotModal(lead)}
                              title="Lead Allot"
                            >
                              👤 Allot
                            </button>
                            <button
                              type="button"
                              className="btn btn-small"
                              style={{
                                background: "#eff6ff",
                                color: "#0061f2",
                                border: "1px solid #bfdbfe",
                                borderRadius: "4px",
                                padding: "4px 8px",
                                fontSize: "12px",
                                fontWeight: 600,
                                cursor: "pointer",
                                display: "inline-flex",
                                alignItems: "center",
                                gap: "4px",
                              }}
                              onClick={() => handleOpenEditDrawer(lead)}
                              title="Edit Lead"
                            >
                              ✏️ Edit
                            </button>
                            <button
                              type="button"
                              className="btn btn-small"
                              style={{
                                background: "#fef2f2",
                                color: "#dc2626",
                                border: "1px solid #fecaca",
                                borderRadius: "4px",
                                padding: "4px 8px",
                                fontSize: "12px",
                                fontWeight: 600,
                                cursor: "pointer",
                                display: "inline-flex",
                                alignItems: "center",
                                gap: "4px",
                              }}
                              onClick={() => handleOpenSingleDelete(lead)}
                              title="Delete Lead"
                            >
                              🗑 Delete
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

          {/* Table Pagination Footer matching Companies design */}
          <div
            style={{
              padding: "12px 20px",
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              background: "#ffffff",
              borderTop: "1px solid #f1f5f9",
              flexWrap: "wrap",
              gap: "12px",
            }}
          >
            <div style={{ fontSize: "13px", color: "#64748b" }}>
              Showing {startIndex} To {endIndex} Of {totalRecords} Entries
            </div>

            <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
              <button
                type="button"
                id="btn-prev-page"
                disabled={currentPage <= 1}
                onClick={() => setCurrentPage((p) => Math.max(1, p - 1))}
                style={{
                  height: "32px",
                  padding: "0 14px",
                  borderRadius: "6px",
                  border: "1px solid #cbd5e1",
                  background: currentPage <= 1 ? "#f8fafc" : "#ffffff",
                  color: currentPage <= 1 ? "#94a3b8" : "#334155",
                  fontSize: "12.5px",
                  fontWeight: 600,
                  cursor: currentPage <= 1 ? "not-allowed" : "pointer",
                }}
              >
                Previous
              </button>

              <span
                style={{
                  height: "32px",
                  minWidth: "32px",
                  padding: "0 10px",
                  display: "inline-flex",
                  alignItems: "center",
                  justifyContent: "center",
                  borderRadius: "6px",
                  background: "#0061f2",
                  color: "#ffffff",
                  fontSize: "12.5px",
                  fontWeight: 700,
                }}
              >
                {currentPage}
              </span>

              <button
                type="button"
                id="btn-next-page"
                disabled={currentPage >= totalPages || totalRecords === 0}
                onClick={() => setCurrentPage((p) => Math.min(totalPages, p + 1))}
                style={{
                  height: "32px",
                  padding: "0 14px",
                  borderRadius: "6px",
                  border: "1px solid #cbd5e1",
                  background: currentPage >= totalPages || totalRecords === 0 ? "#f8fafc" : "#ffffff",
                  color: currentPage >= totalPages || totalRecords === 0 ? "#94a3b8" : "#334155",
                  fontSize: "12.5px",
                  fontWeight: 600,
                  cursor: currentPage >= totalPages || totalRecords === 0 ? "not-allowed" : "pointer",
                }}
              >
                Next
              </button>
            </div>
          </div>
        </div>
      </main>

      {/* ------------------------------------------------------------------ */}
      {/* SideDrawer for Full Lead Details (Companies pattern)               */}
      {/* ------------------------------------------------------------------ */}
      {drawerLead && (
        <SideDrawer
          open={Boolean(drawerLead)}
          title={`Lead #${drawerLead.company_name}`}
          subtitle={`Business Type: ${drawerLead.business_type || "—"} | Status: ${drawerLead.lead_status || "—"}`}
          onClose={() => setDrawerLead(null)}
          onEdit={() => {
            const l = drawerLead;
            setDrawerLead(null);
            handleOpenEditDrawer(l);
          }}
          editLabel="✏️ Edit Lead"
        >
          <div style={{ display: "flex", flexDirection: "column", gap: "20px" }}>
            <DetailFieldGrid
              fields={[
                { label: "Company Name", value: drawerLead.company_name, fullWidth: true },
                { label: "Business Type", value: drawerLead.business_type || "—" },
                { label: "Lead Source", value: drawerLead.source || "—" },
                { label: "Call Type", value: drawerLead.call_type || "—" },
                { label: "Priority", value: getPriorityBadge(drawerLead.priority) },
                { label: "Lead Status", value: getStatusBadge(drawerLead.lead_status) },
                ...(drawerLead.reason_for_won_loss
                  ? [{ label: "Reason for Won / Loss", value: drawerLead.reason_for_won_loss, fullWidth: true }]
                  : []),
                { label: "Address", value: drawerLead.address || "—", fullWidth: true },
                { label: "Area", value: drawerLead.area || "—" },
                { label: "District", value: drawerLead.district || "—" },
                { label: "City", value: drawerLead.city || "—" },
                { label: "State", value: drawerLead.state || "—" },
                { label: "Requirements", value: drawerLead.requirements || "—", fullWidth: true },
              ]}
            />

            <div style={{ background: "#f8fafc", padding: "16px", borderRadius: "10px", border: "1px solid #e2e8f0" }}>
              <h4 style={{ fontSize: "14px", fontWeight: 700, margin: "0 0 12px 0", color: "#0f172a" }}>
                Primary Contact Information
              </h4>
              <DetailFieldGrid
                fields={[
                  { label: "Contact Person", value: drawerLead.contact_person || "—" },
                  { label: "Designation", value: drawerLead.designation || "—" },
                  { label: "Calling Number", value: drawerLead.contact_phone || "—" },
                  { label: "Email Address", value: drawerLead.contact_email || "—" },
                  { label: "Allotted To", value: drawerLead.allotted_to || "—" },
                  { label: "Created By", value: drawerLead.created_by || "—" },
                  { label: "Added On", value: formatDate(drawerLead.added_on || drawerLead.created_at) },
                ]}
              />
            </div>

            {drawerLead.notes && (
              <DetailFieldGrid
                fields={[
                  { label: "Notes & Remarks", value: drawerLead.notes, fullWidth: true },
                ]}
              />
            )}
          </div>
        </SideDrawer>
      )}


      {/* ------------------------------------------------------------------ */}
      {/* Add / Edit Lead Drawer (Matching Screenshot media_1790675832944.png)*/}
      {/* ------------------------------------------------------------------ */}
      {drawerOpen && (
        <div
          className="side-drawer-backdrop open"
          onClick={(e) => {
            if (e.target === e.currentTarget) setDrawerOpen(false);
          }}
          style={{ zIndex: 1500 }}
        >
          <div
            className="side-drawer-card"
            style={{
              width: "100%",
              maxWidth: "600px",
              height: "100vh",
              background: "#ffffff",
              display: "flex",
              flexDirection: "column",
              boxShadow: "-8px 0 30px rgba(0,0,0,0.18)",
              overflow: "hidden",
            }}
          >
            {/* Header */}
            <div
              style={{
                padding: "20px 24px",
                borderBottom: "1px solid #e2e8f0",
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                background: "#ffffff",
              }}
            >
              <h2 style={{ margin: 0, fontSize: "18px", fontWeight: 700, color: "#1e293b" }}>
                {isEditing ? "Edit Lead" : "Add Lead"}
              </h2>
              <button
                type="button"
                onClick={() => setDrawerOpen(false)}
                style={{
                  background: "none",
                  border: "none",
                  fontSize: "20px",
                  color: "#64748b",
                  cursor: "pointer",
                  lineHeight: 1,
                  padding: "4px",
                }}
                title="Close"
              >
                ✕
              </button>
            </div>

            {/* Form Fields Matching Screenshot media_1790675832944.png */}
            <form
              onSubmit={handleSaveLead}
              style={{
                flex: 1,
                overflowY: "auto",
                padding: "24px",
                display: "flex",
                flexDirection: "column",
                gap: "16px",
              }}
            >
              {/* Field 1: Lead Source *, Business Type (B2B / B2C), and Call Type (3 columns) */}
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: "16px" }}>
                <div>
                  <label style={fieldLabelStyle}>
                    Lead Source <span style={{ color: "#ef4444" }}>*</span>
                  </label>
                  <Combobox
                    id="lead-source-select"
                    value={formData.source}
                    onChange={(val) => setFormData((prev) => ({ ...prev, source: val }))}
                    options={sourceOptions}
                    placeholder="Select"
                    required
                  />
                </div>
                <div>
                  <label style={fieldLabelStyle}>Business Type (B2B / B2C)</label>
                  <Combobox
                    id="lead-business-type-select"
                    value={formData.business_type || "B2B"}
                    onChange={(val) => setFormData((prev) => ({ ...prev, business_type: val }))}
                    options={["B2B", "B2C", "Manufacturer", "Trader", "OEM", "Distributor"]}
                    placeholder="Select"
                  />
                </div>
                <div>
                  <label style={fieldLabelStyle}>Call Type</label>
                  <Combobox
                    id="lead-call-type-select"
                    value={formData.call_type}
                    onChange={(val) => setFormData((prev) => ({ ...prev, call_type: val }))}
                    options={["Telecall", "Physical Visit", "WhatsApp", "Email", "Incoming Inquiry"]}
                    placeholder="Select Call Type"
                  />
                </div>
              </div>

              {/* Field 2: Company Name * with + Add New Company button */}
              <div>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "6px" }}>
                  <label style={{ ...fieldLabelStyle, marginBottom: 0 }}>
                    Company Name <span style={{ color: "#ef4444" }}>*</span>
                  </label>
                  <button
                    type="button"
                    id="btn-lead-quick-add-company"
                    data-testid="btn-lead-quick-add-company"
                    style={{
                      background: "#eff6ff",
                      color: "#0061f2",
                      border: "1px solid #bfdbfe",
                      borderRadius: "4px",
                      padding: "2px 8px",
                      fontSize: "12px",
                      fontWeight: 600,
                      cursor: "pointer",
                      display: "inline-flex",
                      alignItems: "center",
                      gap: "4px",
                    }}
                    onClick={() => setIsCompanyForm1Open(true)}
                    title="Add New Company (Form 1)"
                  >
                    + Add New Company
                  </button>
                </div>
                <ClientNameAutocomplete
                  value={formData.company_name}
                  onChange={(val) => setFormData((prev) => ({ ...prev, company_name: val }))}
                  onSelectCompany={handleCompanySelect}
                  placeholder="Search Company Name"
                  required
                />
              </div>

              {/* Field 3: Address */}
              <div>
                <label style={fieldLabelStyle}>Address</label>
                <input
                  type="text"
                  id="lead-address-input"
                  style={inputStyle}
                  placeholder=""
                  value={formData.address}
                  onChange={(e) => setFormData((prev) => ({ ...prev, address: e.target.value }))}
                />
              </div>

              {/* Field 4 & 5: Area and State * (2 columns) */}
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "16px" }}>
                <div>
                  <label style={fieldLabelStyle}>Area</label>
                  <input
                    type="text"
                    id="lead-area-input"
                    style={inputStyle}
                    placeholder=""
                    value={formData.area}
                    onChange={(e) => setFormData((prev) => ({ ...prev, area: e.target.value }))}
                  />
                </div>
                <div>
                  <label style={fieldLabelStyle}>
                    State <span style={{ color: "#ef4444" }}>*</span>
                  </label>
                  <Combobox
                    id="lead-state-select"
                    value={formData.state}
                    placeholder="Select"
                    options={drawerStateOptions}
                    required
                    onChange={(val) => {
                      setFormData((prev) => ({
                        ...prev,
                        state: val,
                        district: "",
                        city: "",
                      }));
                    }}
                  />
                </div>
              </div>

              {/* Field 6 & 7: District and City (2 columns) */}
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "16px" }}>
                <div>
                  <label style={fieldLabelStyle}>District</label>
                  <Combobox
                    id="lead-district-select"
                    value={formData.district}
                    placeholder={!formData.state ? "Select State First" : "Select"}
                    disabled={!formData.state}
                    options={drawerDistrictOptions}
                    onChange={(val) => {
                      setFormData((prev) => ({
                        ...prev,
                        district: val,
                        city: "",
                      }));
                    }}
                  />
                </div>
                <div>
                  <label style={fieldLabelStyle}>City</label>
                  <Combobox
                    id="lead-city-select"
                    value={formData.city}
                    placeholder={!formData.district ? "Select District First" : "Select"}
                    disabled={!formData.district}
                    options={drawerCityOptions}
                    onChange={(val) => {
                      setFormData((prev) => ({
                        ...prev,
                        city: val,
                      }));
                    }}
                  />
                </div>
              </div>

              {/* Field 8, 9, 10: Contact Person, Designation, Priority (3 columns) */}
              <div style={{ display: "grid", gridTemplateColumns: "1.2fr 1fr 1fr", gap: "16px", alignItems: "flex-start" }}>
                <div>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "4px" }}>
                    <label style={{ ...fieldLabelStyle, marginBottom: 0 }}>Contact Person</label>
                    <button
                      type="button"
                      id="btn-lead-quick-add-contact"
                      data-testid="btn-lead-quick-add-contact"
                      style={{
                        background: "#eff6ff",
                        color: "#0061f2",
                        border: "1px solid #bfdbfe",
                        borderRadius: "4px",
                        padding: "1px 6px",
                        fontSize: "11px",
                        fontWeight: 600,
                        cursor: "pointer",
                        display: "inline-flex",
                        alignItems: "center",
                        gap: "2px",
                      }}
                      onClick={() => setIsQuickContactOpen(true)}
                      title="Quick add new contact person"
                    >
                      + Add New Contact Person
                    </button>
                  </div>
                  <input
                    type="text"
                    id="lead-contact-person-input"
                    style={inputStyle}
                    placeholder="Contact Person"
                    value={formData.contact_person}
                    onChange={(e) => setFormData((prev) => ({ ...prev, contact_person: e.target.value }))}
                  />
                </div>
                <div>
                  <label style={fieldLabelStyle}>Designation</label>
                  <input
                    type="text"
                    id="lead-designation-input"
                    style={inputStyle}
                    placeholder=""
                    value={formData.designation}
                    onChange={(e) => setFormData((prev) => ({ ...prev, designation: e.target.value }))}
                  />
                </div>
                <div>
                  <label style={fieldLabelStyle}>Priority</label>
                  <div
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: "14px",
                      height: "38px",
                      boxSizing: "border-box",
                    }}
                  >
                    {(["A", "B", "C"] as const).map((p) => {
                      const isChecked =
                        formData.priority === p ||
                        (p === "A" && (formData.priority === "High" || formData.priority === "Urgent")) ||
                        (p === "B" && (formData.priority === "Medium" || !formData.priority)) ||
                        (p === "C" && formData.priority === "Low");
                      return (
                        <label
                          key={p}
                          style={{
                            display: "inline-flex",
                            alignItems: "center",
                            gap: "4px",
                            cursor: "pointer",
                            fontSize: "13px",
                            fontWeight: 500,
                            color: "#334155",
                            userSelect: "none",
                          }}
                        >
                          <span>{p}</span>
                          <input
                            type="radio"
                            name="lead-priority"
                            value={p}
                            checked={isChecked}
                            onChange={() => setFormData((prev) => ({ ...prev, priority: p }))}
                            style={{
                              cursor: "pointer",
                              accentColor: "#0061f2",
                              width: "15px",
                              height: "15px",
                              margin: 0,
                            }}
                          />
                        </label>
                      );
                    })}
                  </div>
                </div>
              </div>

              {/* Field 11 & 12: Contact Number and Email (2 columns) */}
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "16px" }}>
                <div>
                  <label style={fieldLabelStyle}>Contact Number</label>
                  <input
                    type="text"
                    id="lead-contact-phone-input"
                    style={inputStyle}
                    placeholder=""
                    value={formData.contact_phone}
                    onChange={(e) => setFormData((prev) => ({ ...prev, contact_phone: e.target.value }))}
                  />
                </div>
                <div>
                  <label style={fieldLabelStyle}>Email</label>
                  <input
                    type="email"
                    id="lead-contact-email-input"
                    style={inputStyle}
                    placeholder=""
                    value={formData.contact_email}
                    onChange={(e) => setFormData((prev) => ({ ...prev, contact_email: e.target.value }))}
                  />
                </div>
              </div>

              {/* Field 13: Clients Requirements */}
              <div>
                <label style={fieldLabelStyle}>Clients Requirements</label>
                <textarea
                  id="lead-requirements-input"
                  rows={4}
                  style={{
                    width: "100%",
                    minHeight: "90px",
                    padding: "10px 12px",
                    borderRadius: "6px",
                    border: "1px solid #cbd5e1",
                    fontSize: "13.5px",
                    fontFamily: "inherit",
                    background: "#ffffff",
                    color: "#1e293b",
                    outline: "none",
                    boxSizing: "border-box",
                    resize: "vertical",
                    transition: "border-color 0.15s ease, box-shadow 0.15s ease",
                  }}
                  placeholder=""
                  value={formData.requirements}
                  onChange={(e) => setFormData((prev) => ({ ...prev, requirements: e.target.value }))}
                />
              </div>

              {/* Field 14: Lead Status */}
              <div>
                <label style={fieldLabelStyle}>Lead Status</label>
                <Combobox
                  id="lead-status-select"
                  value={formData.lead_status || "Ongoing"}
                  placeholder="Select Status"
                  options={["Ongoing", "Won", "Loss"]}
                  onChange={(val) => setFormData((prev) => ({ ...prev, lead_status: val }))}
                />
              </div>

              {/* Conditional Field: Reason for Won / Loss */}
              {(formData.lead_status?.toLowerCase() === "won" || formData.lead_status?.toLowerCase() === "loss") && (
                <div>
                  <label style={fieldLabelStyle}>
                    Reason for {formData.lead_status?.toLowerCase() === "won" ? "Won" : "Loss"} <span style={{ color: "#ef4444" }}>*</span>
                  </label>
                  <textarea
                    id="lead-reason-won-loss"
                    data-testid="lead-reason-won-loss"
                    rows={3}
                    style={{
                      width: "100%",
                      minHeight: "64px",
                      padding: "8px 10px",
                      borderRadius: "6px",
                      border: "1px solid #cbd5e1",
                      fontSize: "13.5px",
                      fontFamily: "inherit",
                      background: "#ffffff",
                      color: "#1e293b",
                      outline: "none",
                      boxSizing: "border-box",
                      resize: "vertical",
                    }}
                    placeholder={`Enter detailed reason for ${formData.lead_status}...`}
                    value={formData.reason_for_won_loss}
                    onChange={(e) => setFormData((prev) => ({ ...prev, reason_for_won_loss: e.target.value }))}
                  />
                </div>
              )}

              {/* Submit Button (Full Width bright blue button matching screenshot) */}
              <div style={{ marginTop: "8px" }}>
                <button
                  type="submit"
                  id="btn-submit-lead"
                  disabled={formSaving}
                  style={{
                    width: "100%",
                    background: "#0061f2",
                    color: "#ffffff",
                    border: "none",
                    borderRadius: "6px",
                    padding: "11px 16px",
                    fontSize: "14px",
                    fontWeight: 600,
                    cursor: formSaving ? "not-allowed" : "pointer",
                    boxShadow: "0 1px 3px rgba(0, 97, 242, 0.25)",
                    transition: "background 0.15s ease",
                  }}
                  onMouseEnter={(e) => {
                    if (!formSaving) e.currentTarget.style.background = "#0052cc";
                  }}
                  onMouseLeave={(e) => {
                    if (!formSaving) e.currentTarget.style.background = "#0061f2";
                  }}
                >
                  {formSaving ? "Submitting..." : "Submit"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ------------------------------------------------------------------ */}
      {/* Delete Confirmation Modal                                          */}
      {/* ------------------------------------------------------------------ */}
      {deleteModalOpen && (
        <div
          style={{
            position: "fixed",
            inset: 0,
            zIndex: 1600,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            background: "rgba(15, 23, 42, 0.5)",
            backdropFilter: "blur(2px)",
          }}
        >
          <div
            style={{
              width: "100%",
              maxWidth: "460px",
              background: "#ffffff",
              borderRadius: "10px",
              boxShadow: "0 20px 25px -5px rgba(0, 0, 0, 0.15)",
              overflow: "hidden",
            }}
          >
            <div style={{ padding: "20px 24px" }}>
              <div style={{ display: "flex", alignItems: "center", gap: "12px", marginBottom: "12px" }}>
                <div
                  style={{
                    width: "40px",
                    height: "40px",
                    borderRadius: "50%",
                    background: "#fee2e2",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    color: "#dc2626",
                    fontSize: "20px",
                  }}
                >
                  ⚠️
                </div>
                <h3 style={{ margin: 0, fontSize: "17px", fontWeight: 700, color: "#0f172a" }}>
                  {isBulkDeleteModal ? "Bulk Delete Leads" : "Delete Lead"}
                </h3>
              </div>
              <p style={{ margin: 0, fontSize: "13.5px", color: "#475569", lineHeight: 1.5 }}>
                {isBulkDeleteModal
                  ? `Are you sure you want to permanently delete the selected ${selectedLeadIds.length} lead(s)? This action cannot be undone.`
                  : `Are you sure you want to delete lead "${leadToDelete?.company_name}"? This action cannot be undone.`}
              </p>
            </div>
            <div
              style={{
                padding: "14px 24px",
                background: "#f8fafc",
                borderTop: "1px solid #e2e8f0",
                display: "flex",
                justifyContent: "flex-end",
                gap: "10px",
              }}
            >
              <button
                type="button"
                className="btn"
                onClick={() => setDeleteModalOpen(false)}
                style={{
                  background: "#ffffff",
                  border: "1px solid #cbd5e1",
                  color: "#475569",
                  padding: "8px 16px",
                  borderRadius: "6px",
                  fontSize: "13px",
                  fontWeight: 600,
                  cursor: "pointer",
                }}
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={deleteLoading}
                onClick={handleConfirmDelete}
                style={{
                  background: "#dc2626",
                  color: "#ffffff",
                  border: "none",
                  padding: "8px 18px",
                  borderRadius: "6px",
                  fontSize: "13px",
                  fontWeight: 700,
                  cursor: deleteLoading ? "not-allowed" : "pointer",
                }}
              >
                {deleteLoading ? "Deleting..." : "Delete"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ------------------------------------------------------------------ */}
      {/* Quick Add Company Form 1 Modal                                     */}
      {/* ------------------------------------------------------------------ */}
      <CompanyForm1Modal
        isOpen={isCompanyForm1Open}
        onClose={() => setIsCompanyForm1Open(false)}
        onSuccess={(newCompany) => {
          setFormData((prev) => ({
            ...prev,
            company_name: newCompany.company_name,
            business_type: newCompany.company_type || prev.business_type || "B2B",
            contact_person: newCompany.contact_person || prev.contact_person,
            contact_phone: newCompany.contact_phone || prev.contact_phone,
            designation: newCompany.designation || prev.designation,
            city: newCompany.city || prev.city,
            state: newCompany.state || prev.state,
            area: newCompany.area || prev.area,
            district: newCompany.district || prev.district,
          }));
          showToast(`Company "${newCompany.company_name}" created & selected.`, "success");
        }}
      />

      {/* ------------------------------------------------------------------ */}
      {/* Quick Add Contact Person Modal                                     */}
      {/* ------------------------------------------------------------------ */}
      <QuickAddContactModal
        isOpen={isQuickContactOpen}
        onClose={() => setIsQuickContactOpen(false)}
        companyName={formData.company_name}
        onSuccess={(newContact) => {
          setFormData((prev) => ({
            ...prev,
            contact_person: newContact.person_name,
            designation: newContact.designation || prev.designation,
            contact_phone: newContact.phone || prev.contact_phone,
            contact_email: newContact.email || prev.contact_email,
          }));
          showToast(`Contact person "${newContact.person_name}" added & selected.`, "success");
        }}
      />

      {/* ------------------------------------------------------------------ */}
      {/* Allot Lead Modal                                                   */}
      {/* ------------------------------------------------------------------ */}
      <AllotLeadModal
        isOpen={allotModalOpen}
        onClose={() => {
          setAllotModalOpen(false);
          setLeadToAllot(null);
        }}
        lead={leadToAllot}
        onSuccess={handleAllotSuccess}
        availableAssignees={extractedAllottedTo.filter(Boolean)}
      />
    </AppShell>
  );
}

export default LeadsPage;