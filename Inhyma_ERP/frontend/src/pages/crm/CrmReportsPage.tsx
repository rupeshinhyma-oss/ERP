/**
 * CrmReportsPage — CRM Reports & Analytics Module.
 *
 * Implements real-time CRM performance, pipeline progression, campaign attribution,
 * and workload metrics derived directly from actual CRM database records.
 *
 * Enforces strict role-based data isolation:
 * - Admin: Company-wide metrics with optional salesperson/pipeline filters.
 * - Manager: Scoped to authorized team/department representatives.
 * - Salesperson: Personal metrics only (assigned/created leads, personal follow-ups).
 */

import { useState, useEffect, useCallback } from "react";
import { Link } from "react-router-dom";
import { AppShell } from "@/components/AppShell";
import { Breadcrumb } from "@/components/Breadcrumb";
import { apiGet, errorMessage } from "@/lib/api";
import { Auth } from "@/lib/auth";
import { IconRefresh } from "@/components/icons";

export interface CrmAnalyticsOverview {
  total_leads_in_range: number;
  total_active_leads: number;
  total_all_time_leads: number;
  won_count: number;
  lost_count: number;
  closed_count: number;
  conversion_rate: number | null;
  win_rate_on_new: number | null;
  assigned_count: number;
  unassigned_count: number;
  total_follow_ups: number;
  overdue_follow_ups: number;
  total_activities: number;
}

export interface CrmStageCountItem {
  stage_id: string;
  stage_name: string;
  stage_type?: string | null;
  count?: number;
  lead_count?: number;
  order_index?: number;
}

export interface CrmPipelineDistributionItem {
  pipeline_id: string;
  pipeline_name: string;
  lead_count: number;
  total_leads?: number;
  won_count: number;
  lost_count: number;
  active_count: number;
  conversion_rate?: number | null;
  stages: CrmStageCountItem[];
}

export interface CrmCampaignPerformanceItem {
  campaign: string;
  total_leads?: number;
  lead_count?: number;
  won_leads?: number;
  won_count?: number;
  lost_leads?: number;
  lost_count?: number;
  active_leads?: number;
  active_count?: number;
  conversion_rate: number | null;
}

export interface CrmSourceDistributionItem {
  source_type?: string;
  source?: string;
  total_leads?: number;
  lead_count?: number;
  won_leads?: number;
  won_count?: number;
  percentage?: number;
  conversion_rate: number | null;
}

export interface CrmRepPerformanceItem {
  salesperson_id?: string;
  user_id?: string;
  salesperson_name?: string;
  display_name?: string;
  salesperson_email?: string | null;
  email?: string | null;
  assigned_leads: number;
  active_leads: number;
  new_leads_in_range?: number;
  won_count?: number;
  won_leads?: number;
  lost_count?: number;
  lost_leads?: number;
  conversion_rate: number | null;
  total_follow_ups?: number;
  overdue_follow_ups: number;
  activities_count: number;
  max_capacity?: number | null;
  capacity_utilization?: number | null;
}

export interface CrmTimeTrendItem {
  date: string;
  new_leads: number;
  won_leads: number;
  lost_leads: number;
  activities_count: number;
}

export interface CrmAnalyticsResponseData {
  start_date: string;
  end_date: string;
  timezone: string;
  role_type: string;
  scope_type: string;
  pipeline_id?: string | null;
  salesperson_id?: string | null;
  overview: CrmAnalyticsOverview;
  pipelines: CrmPipelineDistributionItem[];
  campaigns: CrmCampaignPerformanceItem[];
  sources: CrmSourceDistributionItem[];
  reps: CrmRepPerformanceItem[];
  trends: CrmTimeTrendItem[];
  pipeline_distribution?: CrmPipelineDistributionItem[];
  campaign_performance?: CrmCampaignPerformanceItem[];
  source_distribution?: CrmSourceDistributionItem[];
  rep_performance?: CrmRepPerformanceItem[];
  time_trends?: CrmTimeTrendItem[];
}

interface CrmPipelineOption {
  id: string;
  name: string;
}

interface CrmSalespersonOption {
  user_id: string;
  display_name?: string;
  full_name?: string;
  username: string;
}

type DatePreset = "7d" | "30d" | "this_month" | "last_month" | "custom";

function formatDateIso(d: Date): string {
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

export function CrmReportsPage() {
  const profile = Auth.getProfile();
  const isSuperAdmin = Auth.isSuperAdmin();
  const hasManagePerm = Auth.hasPermission("crm.leads.manage");
  const isSalesManager = !isSuperAdmin && hasManagePerm;
  const isSalesperson = !isSuperAdmin && !hasManagePerm;

  // Date Range state (Default to last 30 days)
  const [datePreset, setDatePreset] = useState<DatePreset>("30d");
  const [startDate, setStartDate] = useState<string>(() => {
    const d = new Date();
    d.setDate(d.getDate() - 29);
    return formatDateIso(d);
  });
  const [endDate, setEndDate] = useState<string>(() => formatDateIso(new Date()));

  // Filters
  const [selectedPipelineId, setSelectedPipelineId] = useState<string>("");
  const [selectedSalespersonId, setSelectedSalespersonId] = useState<string>("");

  // Metadata options
  const [pipelines, setPipelines] = useState<CrmPipelineOption[]>([]);
  const [salespeople, setSalespeople] = useState<CrmSalespersonOption[]>([]);

  // Analytics Data
  const [analytics, setAnalytics] = useState<CrmAnalyticsResponseData | null>(null);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);

  // Preset Handler
  const handleApplyPreset = (preset: DatePreset) => {
    setDatePreset(preset);
    const now = new Date();
    if (preset === "7d") {
      const s = new Date();
      s.setDate(now.getDate() - 6);
      setStartDate(formatDateIso(s));
      setEndDate(formatDateIso(now));
    } else if (preset === "30d") {
      const s = new Date();
      s.setDate(now.getDate() - 29);
      setStartDate(formatDateIso(s));
      setEndDate(formatDateIso(now));
    } else if (preset === "this_month") {
      const s = new Date(now.getFullYear(), now.getMonth(), 1);
      setStartDate(formatDateIso(s));
      setEndDate(formatDateIso(now));
    } else if (preset === "last_month") {
      const s = new Date(now.getFullYear(), now.getMonth() - 1, 1);
      const e = new Date(now.getFullYear(), now.getMonth(), 0);
      setStartDate(formatDateIso(s));
      setEndDate(formatDateIso(e));
    }
  };

  // Fetch Options (Pipelines & Salespeople)
  useEffect(() => {
    async function loadOptions() {
      try {
        const pipeRes = await apiGet<any>("/api/v1/crm/pipelines");
        const pipeList = Array.isArray(pipeRes?.data?.items)
          ? pipeRes.data.items
          : Array.isArray(pipeRes?.data)
          ? pipeRes.data
          : Array.isArray(pipeRes)
          ? pipeRes
          : [];
        setPipelines(
          pipeList.map((p: any) => ({
            id: p.id,
            name: p.name,
          }))
        );
      } catch (e) {
        console.error("Failed to load pipelines", e);
      }

      // Salespeople only for managers and admins
      if (!isSalesperson) {
        try {
          const spRes = await apiGet<any>("/api/v1/crm/distribution/salespeople");
          const spList = Array.isArray(spRes?.data?.salespeople)
            ? spRes.data.salespeople
            : Array.isArray(spRes?.data)
            ? spRes.data
            : Array.isArray(spRes)
            ? spRes
            : [];
          setSalespeople(
            spList.map((s: any) => ({
              user_id: s.user_id,
              display_name: s.display_name,
              full_name: s.full_name,
              username: s.username,
            }))
          );
        } catch (e) {
          console.error("Failed to load salespeople options", e);
        }
      }
    }
    loadOptions();
  }, [isSalesperson]);

  // Fetch Analytics
  const fetchAnalytics = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams();
      if (startDate) params.set("start_date", startDate);
      if (endDate) params.set("end_date", endDate);
      if (selectedPipelineId) params.set("pipeline_id", selectedPipelineId);
      if (!isSalesperson && selectedSalespersonId) {
        params.set("salesperson_id", selectedSalespersonId);
      }

      const res = await apiGet<any>(`/api/v1/crm/reports/analytics?${params.toString()}`);
      const payload =
        res?.data !== undefined
          ? res.data?.data !== undefined
            ? res.data.data
            : res.data
          : res;
      if (payload && payload.overview) {
        setAnalytics(payload);
      } else {
        setAnalytics(null);
      }
    } catch (err: any) {
      setError(errorMessage(err) || "Failed to load CRM reports and analytics.");
      setAnalytics(null);
    } finally {
      setLoading(false);
    }
  }, [startDate, endDate, selectedPipelineId, selectedSalespersonId, isSalesperson]);

  useEffect(() => {
    fetchAnalytics();
  }, [fetchAnalytics]);

  const overview = analytics?.overview;
  const pipelineDistribution: CrmPipelineDistributionItem[] =
    analytics?.pipelines || analytics?.pipeline_distribution || [];
  const timeTrends: CrmTimeTrendItem[] =
    analytics?.trends || analytics?.time_trends || [];
  const campaignPerformance: CrmCampaignPerformanceItem[] =
    analytics?.campaigns || analytics?.campaign_performance || [];
  const sourceDistribution: CrmSourceDistributionItem[] =
    analytics?.sources || analytics?.source_distribution || [];
  const repPerformance: CrmRepPerformanceItem[] =
    analytics?.reps || analytics?.rep_performance || [];

  return (
    <AppShell activeKey="crm-reports">
      <div style={{ padding: "1.5rem", maxWidth: "1600px", margin: "0 auto" }}>
        {/* Breadcrumb Navigation */}
        <Breadcrumb trail={["CRM", "Reports & Analytics"]} />

        {/* Header Bar */}
        <div
          style={{
            display: "flex",
            flexWrap: "wrap",
            justifyContent: "space-between",
            alignItems: "center",
            gap: "1rem",
            marginTop: "0.5rem",
            marginBottom: "1.25rem",
          }}
        >
          <div>
            <div style={{ display: "flex", alignItems: "center", gap: "0.75rem" }}>
              <h1
                data-testid="crm-reports-title"
                style={{ fontSize: "1.5rem", fontWeight: 700, color: "#0f172a", margin: 0 }}
              >
                CRM Reports & Analytics
              </h1>
              <span
                data-testid="scope-badge"
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  gap: "0.35rem",
                  padding: "0.2rem 0.65rem",
                  borderRadius: "9999px",
                  fontSize: "0.75rem",
                  fontWeight: 600,
                  backgroundColor: isSalesperson ? "#dbeafe" : isSalesManager ? "#e0e7ff" : "#f1f5f9",
                  color: isSalesperson ? "#1e40af" : isSalesManager ? "#3730a3" : "#334155",
                  border: "1px solid #cbd5e1",
                }}
              >
                {isSalesperson
                  ? "Personal Performance Scope"
                  : isSalesManager
                  ? "Team Scoped"
                  : "Company-Wide Scope"}
              </span>
            </div>
            <p style={{ margin: "0.25rem 0 0 0", fontSize: "0.875rem", color: "#64748b" }}>
              Real-time pipeline progression, conversion rates, campaign attribution, and rep workloads.
            </p>
          </div>

          <div style={{ display: "flex", alignItems: "center", gap: "0.75rem", flexWrap: "wrap" }}>
            <Link
              to="/crm/leads"
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: "0.4rem",
                padding: "0.5rem 0.85rem",
                fontSize: "0.8125rem",
                fontWeight: 600,
                color: "#334155",
                backgroundColor: "#fff",
                border: "1px solid #cbd5e1",
                borderRadius: "0.375rem",
                textDecoration: "none",
              }}
            >
              ← Back to Leads
            </Link>
            <button
              type="button"
              data-testid="refresh-analytics-btn"
              onClick={fetchAnalytics}
              disabled={loading}
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: "0.4rem",
                padding: "0.5rem 0.85rem",
                fontSize: "0.8125rem",
                fontWeight: 600,
                color: "#fff",
                backgroundColor: "#2563eb",
                border: "none",
                borderRadius: "0.375rem",
                cursor: loading ? "not-allowed" : "pointer",
              }}
            >
              <IconRefresh style={{ width: "14px", height: "14px" }} />
              {loading ? "Refreshing..." : "Refresh Analytics"}
            </button>
          </div>
        </div>

        {/* Filter Toolbar & Presets */}
        <div
          data-testid="filter-toolbar"
          style={{
            backgroundColor: "#fff",
            border: "1px solid #e2e8f0",
            borderRadius: "0.5rem",
            padding: "1rem",
            marginBottom: "1.25rem",
            boxShadow: "0 1px 3px rgba(0,0,0,0.04)",
            display: "flex",
            flexDirection: "column",
            gap: "0.85rem",
          }}
        >
          {/* Quick Presets Row */}
          <div style={{ display: "flex", alignItems: "center", gap: "0.5rem", flexWrap: "wrap" }}>
            <span style={{ fontSize: "0.8125rem", fontWeight: 600, color: "#475569", marginRight: "0.25rem" }}>
              Date Range:
            </span>
            {(
              [
                { key: "7d", label: "Last 7 Days" },
                { key: "30d", label: "Last 30 Days" },
                { key: "this_month", label: "This Month" },
                { key: "last_month", label: "Last Month" },
                { key: "custom", label: "Custom Range" },
              ] as const
            ).map((p) => {
              const active = datePreset === p.key;
              return (
                <button
                  key={p.key}
                  type="button"
                  data-testid={`preset-btn-${p.key}`}
                  onClick={() => handleApplyPreset(p.key)}
                  style={{
                    padding: "0.35rem 0.75rem",
                    fontSize: "0.75rem",
                    fontWeight: active ? 700 : 500,
                    borderRadius: "0.375rem",
                    border: active ? "1px solid #2563eb" : "1px solid #cbd5e1",
                    backgroundColor: active ? "#eff6ff" : "#fff",
                    color: active ? "#1d4ed8" : "#475569",
                    cursor: "pointer",
                  }}
                >
                  {p.label}
                </button>
              );
            })}
          </div>

          {/* Explicit Inputs and Dropdowns */}
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))",
              gap: "0.75rem",
              alignItems: "flex-end",
            }}
          >
            {/* Start Date */}
            <div>
              <label htmlFor="crm-start-date" style={{ display: "block", fontSize: "0.75rem", fontWeight: 600, color: "#475569", marginBottom: "0.25rem" }}>
                Start Date
              </label>
              <input
                id="crm-start-date"
                type="date"
                data-testid="crm-start-date"
                value={startDate}
                onChange={(e) => {
                  setDatePreset("custom");
                  setStartDate(e.target.value);
                }}
                style={{
                  width: "100%",
                  padding: "0.45rem 0.65rem",
                  fontSize: "0.8125rem",
                  borderRadius: "0.375rem",
                  border: "1px solid #cbd5e1",
                  backgroundColor: "#fff",
                  boxSizing: "border-box",
                }}
              />
            </div>

            {/* End Date */}
            <div>
              <label htmlFor="crm-end-date" style={{ display: "block", fontSize: "0.75rem", fontWeight: 600, color: "#475569", marginBottom: "0.25rem" }}>
                End Date
              </label>
              <input
                id="crm-end-date"
                type="date"
                data-testid="crm-end-date"
                value={endDate}
                onChange={(e) => {
                  setDatePreset("custom");
                  setEndDate(e.target.value);
                }}
                style={{
                  width: "100%",
                  padding: "0.45rem 0.65rem",
                  fontSize: "0.8125rem",
                  borderRadius: "0.375rem",
                  border: "1px solid #cbd5e1",
                  backgroundColor: "#fff",
                  boxSizing: "border-box",
                }}
              />
            </div>

            {/* Pipeline Selector */}
            <div>
              <label htmlFor="crm-pipeline-select" style={{ display: "block", fontSize: "0.75rem", fontWeight: 600, color: "#475569", marginBottom: "0.25rem" }}>
                Sales Pipeline
              </label>
              <select
                id="crm-pipeline-select"
                data-testid="crm-pipeline-select"
                value={selectedPipelineId}
                onChange={(e) => setSelectedPipelineId(e.target.value)}
                style={{
                  width: "100%",
                  padding: "0.45rem 0.65rem",
                  fontSize: "0.8125rem",
                  borderRadius: "0.375rem",
                  border: "1px solid #cbd5e1",
                  backgroundColor: "#fff",
                  boxSizing: "border-box",
                }}
              >
                <option value="">All Pipelines</option>
                {pipelines.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </select>
            </div>

            {/* Salesperson Selector (Only visible for Admins & Managers) */}
            {!isSalesperson ? (
              <div>
                <label htmlFor="crm-rep-select" style={{ display: "block", fontSize: "0.75rem", fontWeight: 600, color: "#475569", marginBottom: "0.25rem" }}>
                  Sales Representative
                </label>
                <select
                  id="crm-rep-select"
                  data-testid="crm-rep-select"
                  value={selectedSalespersonId}
                  onChange={(e) => setSelectedSalespersonId(e.target.value)}
                  style={{
                    width: "100%",
                    padding: "0.45rem 0.65rem",
                    fontSize: "0.8125rem",
                    borderRadius: "0.375rem",
                    border: "1px solid #cbd5e1",
                    backgroundColor: "#fff",
                    boxSizing: "border-box",
                  }}
                >
                  <option value="">All Scoped Representatives</option>
                  {salespeople.map((s) => (
                    <option key={s.user_id} value={s.user_id}>
                      {s.display_name || s.full_name || s.username}
                    </option>
                  ))}
                </select>
              </div>
            ) : (
              <div>
                <label style={{ display: "block", fontSize: "0.75rem", fontWeight: 600, color: "#475569", marginBottom: "0.25rem" }}>
                  Assigned Representative
                </label>
                <div
                  style={{
                    padding: "0.45rem 0.65rem",
                    fontSize: "0.8125rem",
                    backgroundColor: "#f8fafc",
                    border: "1px solid #e2e8f0",
                    borderRadius: "0.375rem",
                    color: "#334155",
                    fontWeight: 600,
                  }}
                >
                  👤 {String((profile as any)?.display_name || profile?.full_name || profile?.username || "Self")}
                </div>
              </div>
            )}

            {/* Apply Button */}
            <div>
              <button
                type="button"
                data-testid="apply-filters-btn"
                onClick={fetchAnalytics}
                style={{
                  width: "100%",
                  padding: "0.48rem 1rem",
                  fontSize: "0.8125rem",
                  fontWeight: 600,
                  backgroundColor: "#059669",
                  color: "#fff",
                  border: "none",
                  borderRadius: "0.375rem",
                  cursor: "pointer",
                }}
              >
                Apply Filters
              </button>
            </div>
          </div>
        </div>

        {/* Error Alert */}
        {error && (
          <div
            data-testid="crm-reports-error"
            role="alert"
            style={{
              padding: "1rem",
              backgroundColor: "#fef2f2",
              border: "1px solid #fecaca",
              borderRadius: "0.5rem",
              color: "#991b1b",
              fontSize: "0.875rem",
              marginBottom: "1.25rem",
            }}
          >
            ⚠️ {error}
          </div>
        )}

        {/* Loading Indicator */}
        {loading && (
          <div
            data-testid="analytics-loading"
            style={{
              padding: "4rem 2rem",
              textAlign: "center",
              backgroundColor: "#fff",
              borderRadius: "0.5rem",
              border: "1px solid #e2e8f0",
              color: "#64748b",
              marginBottom: "1.5rem",
            }}
          >
            Loading CRM analytics and performance data...
          </div>
        )}

        {/* Main Content Area */}
        {!loading && analytics && (
          <div style={{ display: "flex", flexDirection: "column", gap: "1.5rem" }}>
            {/* 1. KPI Overview Summary Cards */}
            <div
              data-testid="kpi-cards-grid"
              style={{
                display: "grid",
                gridTemplateColumns: "repeat(auto-fit, minmax(210px, 1fr))",
                gap: "1rem",
              }}
            >
              {/* Total Leads In Range */}
              <div
                style={{
                  backgroundColor: "#fff",
                  border: "1px solid #e2e8f0",
                  borderRadius: "0.5rem",
                  padding: "1.125rem",
                  boxShadow: "0 1px 3px rgba(0,0,0,0.04)",
                }}
              >
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
                  <span style={{ fontSize: "0.8125rem", fontWeight: 600, color: "#64748b" }}>
                    Total Leads in Period
                  </span>
                  <span style={{ fontSize: "0.7rem", backgroundColor: "#f1f5f9", padding: "0.15rem 0.45rem", borderRadius: "9999px", color: "#475569" }}>
                    Created
                  </span>
                </div>
                <div
                  data-testid="kpi-total-leads"
                  style={{ fontSize: "1.875rem", fontWeight: 700, color: "#0f172a", marginTop: "0.35rem" }}
                >
                  {overview?.total_leads_in_range ?? 0}
                </div>
                <div style={{ fontSize: "0.75rem", color: "#64748b", marginTop: "0.35rem" }}>
                  All-time in scope: <strong>{overview?.total_all_time_leads ?? 0}</strong>
                </div>
              </div>

              {/* Active Pipeline Leads */}
              <div
                style={{
                  backgroundColor: "#fff",
                  border: "1px solid #e2e8f0",
                  borderRadius: "0.5rem",
                  padding: "1.125rem",
                  boxShadow: "0 1px 3px rgba(0,0,0,0.04)",
                }}
              >
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
                  <span style={{ fontSize: "0.8125rem", fontWeight: 600, color: "#2563eb" }}>
                    Active Leads
                  </span>
                  <span style={{ fontSize: "0.7rem", backgroundColor: "#eff6ff", padding: "0.15rem 0.45rem", borderRadius: "9999px", color: "#1d4ed8" }}>
                    In Progress
                  </span>
                </div>
                <div
                  data-testid="kpi-active-leads"
                  style={{ fontSize: "1.875rem", fontWeight: 700, color: "#2563eb", marginTop: "0.35rem" }}
                >
                  {overview?.total_active_leads ?? 0}
                </div>
                <div style={{ fontSize: "0.75rem", color: "#64748b", marginTop: "0.35rem" }}>
                  Open opportunities requiring action
                </div>
              </div>

              {/* Won Deals */}
              <div
                style={{
                  backgroundColor: "#fff",
                  border: "1px solid #e2e8f0",
                  borderRadius: "0.5rem",
                  padding: "1.125rem",
                  boxShadow: "0 1px 3px rgba(0,0,0,0.04)",
                }}
              >
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
                  <span style={{ fontSize: "0.8125rem", fontWeight: 600, color: "#059669" }}>
                    Won Deals
                  </span>
                  <span style={{ fontSize: "0.7rem", backgroundColor: "#ecfdf5", padding: "0.15rem 0.45rem", borderRadius: "9999px", color: "#065f46" }}>
                    Converted
                  </span>
                </div>
                <div
                  data-testid="kpi-won-deals"
                  style={{ fontSize: "1.875rem", fontWeight: 700, color: "#059669", marginTop: "0.35rem" }}
                >
                  {overview?.won_count ?? 0}
                </div>
                <div style={{ fontSize: "0.75rem", color: "#64748b", marginTop: "0.35rem" }}>
                  Closed won within selected period
                </div>
              </div>

              {/* Lost Deals */}
              <div
                style={{
                  backgroundColor: "#fff",
                  border: "1px solid #e2e8f0",
                  borderRadius: "0.5rem",
                  padding: "1.125rem",
                  boxShadow: "0 1px 3px rgba(0,0,0,0.04)",
                }}
              >
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
                  <span style={{ fontSize: "0.8125rem", fontWeight: 600, color: "#dc2626" }}>
                    Lost Deals
                  </span>
                  <span style={{ fontSize: "0.7rem", backgroundColor: "#fef2f2", padding: "0.15rem 0.45rem", borderRadius: "9999px", color: "#991b1b" }}>
                    Disqualified
                  </span>
                </div>
                <div
                  data-testid="kpi-lost-deals"
                  style={{ fontSize: "1.875rem", fontWeight: 700, color: "#dc2626", marginTop: "0.35rem" }}
                >
                  {overview?.lost_count ?? 0}
                </div>
                <div style={{ fontSize: "0.75rem", color: "#64748b", marginTop: "0.35rem" }}>
                  Closed lost within selected period
                </div>
              </div>

              {/* Win Conversion Rate */}
              <div
                style={{
                  backgroundColor: "#fff",
                  border: "1px solid #e2e8f0",
                  borderRadius: "0.5rem",
                  padding: "1.125rem",
                  boxShadow: "0 1px 3px rgba(0,0,0,0.04)",
                }}
              >
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
                  <span style={{ fontSize: "0.8125rem", fontWeight: 600, color: "#0f172a" }}>
                    Win Conversion Rate
                  </span>
                  <span style={{ fontSize: "0.7rem", backgroundColor: "#f1f5f9", padding: "0.15rem 0.45rem", borderRadius: "9999px", color: "#475569" }}>
                    Closed
                  </span>
                </div>
                <div
                  data-testid="kpi-conversion-rate"
                  style={{ fontSize: "1.875rem", fontWeight: 700, color: overview && overview.conversion_rate !== null ? "#0f172a" : "#64748b", marginTop: "0.35rem" }}
                >
                  {overview && overview.conversion_rate !== null ? `${overview.conversion_rate}%` : "N/A"}
                </div>
                <div style={{ fontSize: "0.75rem", color: "#64748b", marginTop: "0.35rem" }}>
                  {overview?.closed_count && overview.closed_count > 0
                    ? `Won / Closed (${overview.won_count}/${overview.closed_count})`
                    : "No closed deals in range"}
                </div>
              </div>

              {/* Overdue Follow-ups */}
              <div
                style={{
                  backgroundColor: "#fff",
                  border: "1px solid #e2e8f0",
                  borderRadius: "0.5rem",
                  padding: "1.125rem",
                  boxShadow: "0 1px 3px rgba(0,0,0,0.04)",
                }}
              >
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
                  <span style={{ fontSize: "0.8125rem", fontWeight: 600, color: (overview?.overdue_follow_ups ?? 0) > 0 ? "#dc2626" : "#64748b" }}>
                    Overdue Follow-ups
                  </span>
                  {(overview?.overdue_follow_ups ?? 0) > 0 && (
                    <span style={{ fontSize: "0.7rem", backgroundColor: "#fee2e2", padding: "0.15rem 0.45rem", borderRadius: "9999px", color: "#dc2626", fontWeight: 700 }}>
                      Action Due
                    </span>
                  )}
                </div>
                <div
                  data-testid="kpi-overdue-followups"
                  style={{
                    fontSize: "1.875rem",
                    fontWeight: 700,
                    color: (overview?.overdue_follow_ups ?? 0) > 0 ? "#dc2626" : "#0f172a",
                    marginTop: "0.35rem",
                  }}
                >
                  {overview?.overdue_follow_ups ?? 0}
                </div>
                <div style={{ fontSize: "0.75rem", color: "#64748b", marginTop: "0.35rem" }}>
                  Pending follow-ups past deadline
                </div>
              </div>
            </div>

            {/* 2. Visual Stage-wise Pipeline Progression */}
            <div
              data-testid="pipeline-stages-card"
              style={{
                backgroundColor: "#fff",
                border: "1px solid #e2e8f0",
                borderRadius: "0.5rem",
                padding: "1.25rem",
                boxShadow: "0 1px 3px rgba(0,0,0,0.04)",
              }}
            >
              <h2 style={{ fontSize: "1rem", fontWeight: 700, color: "#0f172a", margin: "0 0 1rem 0" }}>
                Stage-wise Pipeline Funnel & Distribution
              </h2>

              {pipelineDistribution.length === 0 ? (
                <div style={{ padding: "2rem", textAlign: "center", color: "#64748b" }}>
                  No pipeline stage data found.
                </div>
              ) : (
                <div style={{ display: "flex", flexDirection: "column", gap: "1.25rem" }}>
                  {pipelineDistribution.map((pipe) => {
                    const totalPipeLeads = pipe.stages.reduce((acc, st) => acc + (st.lead_count ?? (st as any).count ?? 0), 0);

                    return (
                      <div
                        key={pipe.pipeline_id}
                        data-testid={`pipeline-row-${pipe.pipeline_id}`}
                        style={{
                          backgroundColor: "#f8fafc",
                          border: "1px solid #e2e8f0",
                          borderRadius: "0.375rem",
                          padding: "1rem",
                        }}
                      >
                        <div
                          style={{
                            display: "flex",
                            justifyContent: "space-between",
                            alignItems: "center",
                            marginBottom: "0.75rem",
                            flexWrap: "wrap",
                            gap: "0.5rem",
                          }}
                        >
                          <span style={{ fontWeight: 700, fontSize: "0.9375rem", color: "#0f172a" }}>
                            {pipe.pipeline_name}
                          </span>
                          <span style={{ fontSize: "0.8125rem", color: "#64748b" }}>
                            Total Pipeline Leads: <strong>{pipe.total_leads ?? (pipe as any).lead_count ?? totalPipeLeads}</strong> | Won:{" "}
                            <span style={{ color: "#059669", fontWeight: 600 }}>{pipe.won_count}</span> | Lost:{" "}
                            <span style={{ color: "#dc2626", fontWeight: 600 }}>{pipe.lost_count}</span>
                          </span>
                        </div>

                        {/* Stage Funnel Progress Bars */}
                        <div
                          style={{
                            display: "grid",
                            gridTemplateColumns: `repeat(auto-fit, minmax(130px, 1fr))`,
                            gap: "0.5rem",
                          }}
                        >
                          {pipe.stages.map((st) => {
                            const isWon = st.stage_type === "won";
                            const isLost = st.stage_type === "lost";
                            const color = isWon ? "#059669" : isLost ? "#dc2626" : "#2563eb";
                            const bg = isWon ? "#ecfdf5" : isLost ? "#fef2f2" : "#eff6ff";
                            const stageCount = st.lead_count ?? (st as any).count ?? 0;
                            const pct = totalPipeLeads > 0 ? Math.round((stageCount / totalPipeLeads) * 100) : 0;

                            return (
                              <div
                                key={st.stage_id}
                                data-testid={`stage-item-${st.stage_id}`}
                                style={{
                                  backgroundColor: "#fff",
                                  border: `1px solid #cbd5e1`,
                                  borderRadius: "0.375rem",
                                  padding: "0.6rem 0.75rem",
                                  display: "flex",
                                  flexDirection: "column",
                                  gap: "0.35rem",
                                }}
                              >
                                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                                  <span style={{ fontSize: "0.75rem", fontWeight: 600, color: "#334155" }}>
                                    {st.stage_name}
                                  </span>
                                  <span
                                    style={{
                                      fontSize: "0.65rem",
                                      fontWeight: 700,
                                      padding: "0.1rem 0.35rem",
                                      borderRadius: "0.25rem",
                                      backgroundColor: bg,
                                      color: color,
                                    }}
                                  >
                                    {st.stage_type?.toUpperCase() || "OPEN"}
                                  </span>
                                </div>
                                <div style={{ fontSize: "1.25rem", fontWeight: 700, color: color }}>
                                  {stageCount}
                                </div>
                                <div style={{ height: "4px", backgroundColor: "#e2e8f0", borderRadius: "2px", overflow: "hidden" }}>
                                  <div style={{ width: `${pct}%`, height: "100%", backgroundColor: color }} />
                                </div>
                                <span style={{ fontSize: "0.65rem", color: "#64748b" }}>
                                  {pct}% of pipeline
                                </span>
                              </div>
                            );
                          })}
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>

            {/* 3. Time Trends Section */}
            <div
              data-testid="time-trends-card"
              style={{
                backgroundColor: "#fff",
                border: "1px solid #e2e8f0",
                borderRadius: "0.5rem",
                padding: "1.25rem",
                boxShadow: "0 1px 3px rgba(0,0,0,0.04)",
              }}
            >
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "1rem" }}>
                <h2 style={{ fontSize: "1rem", fontWeight: 700, color: "#0f172a", margin: 0 }}>
                  Volume Trends Over Time (Asia/Kolkata)
                </h2>
                <span style={{ fontSize: "0.75rem", color: "#64748b" }}>
                  Daily breakdown across selected range
                </span>
              </div>

              {timeTrends.length === 0 ? (
                <div style={{ padding: "2rem", textAlign: "center", color: "#64748b" }}>
                  No volume activity found in this date range.
                </div>
              ) : (
                <div
                  style={{
                    overflowX: "auto",
                    paddingBottom: "0.5rem",
                  }}
                >
                  <div
                    style={{
                      display: "flex",
                      alignItems: "flex-end",
                      gap: "0.5rem",
                      minWidth: `${timeTrends.length * 32}px`,
                      height: "180px",
                      borderBottom: "1px solid #cbd5e1",
                      paddingTop: "1rem",
                    }}
                  >
                    {timeTrends.map((pt) => {
                      const maxVol = Math.max(
                        ...timeTrends.map((t) => Math.max(t.new_leads, t.won_leads, t.activities_count, 1))
                      );
                      const barHeight = Math.max(Math.round((pt.new_leads / maxVol) * 120), 4);
                      const wonHeight = Math.max(Math.round((pt.won_leads / maxVol) * 120), pt.won_leads > 0 ? 4 : 0);

                      return (
                        <div
                          key={pt.date}
                          title={`${pt.date}: ${pt.new_leads} new leads, ${pt.won_leads} won, ${pt.activities_count} activities`}
                          style={{
                            flex: "1 0 24px",
                            display: "flex",
                            flexDirection: "column",
                            alignItems: "center",
                            gap: "0.25rem",
                            cursor: "pointer",
                          }}
                        >
                          <div style={{ display: "flex", alignItems: "flex-end", gap: "2px", height: "120px" }}>
                            {/* New Leads Bar */}
                            <div
                              style={{
                                width: "10px",
                                height: `${barHeight}px`,
                                backgroundColor: "#3b82f6",
                                borderRadius: "2px 2px 0 0",
                              }}
                            />
                            {/* Won Deals Bar */}
                            {wonHeight > 0 && (
                              <div
                                style={{
                                  width: "10px",
                                  height: `${wonHeight}px`,
                                  backgroundColor: "#10b981",
                                  borderRadius: "2px 2px 0 0",
                                }}
                              />
                            )}
                          </div>
                          <span style={{ fontSize: "0.6rem", color: "#64748b", transform: "rotate(-45deg)", transformOrigin: "top left", whiteSpace: "nowrap" }}>
                            {pt.date.slice(5)}
                          </span>
                        </div>
                      );
                    })}
                  </div>
                  <div style={{ display: "flex", gap: "1rem", marginTop: "1.5rem", fontSize: "0.75rem", color: "#475569" }}>
                    <div style={{ display: "flex", alignItems: "center", gap: "0.35rem" }}>
                      <span style={{ width: "10px", height: "10px", backgroundColor: "#3b82f6", display: "inline-block", borderRadius: "2px" }} />
                      <span>New Leads</span>
                    </div>
                    <div style={{ display: "flex", alignItems: "center", gap: "0.35rem" }}>
                      <span style={{ width: "10px", height: "10px", backgroundColor: "#10b981", display: "inline-block", borderRadius: "2px" }} />
                      <span>Won Deals</span>
                    </div>
                  </div>
                </div>
              )}
            </div>

            {/* 4. Campaign Attribution & Source Performance */}
            <div
              style={{
                display: "grid",
                gridTemplateColumns: "repeat(auto-fit, minmax(360px, 1fr))",
                gap: "1.5rem",
              }}
            >
              {/* Campaign Performance Table */}
              <div
                data-testid="campaign-performance-card"
                style={{
                  backgroundColor: "#fff",
                  border: "1px solid #e2e8f0",
                  borderRadius: "0.5rem",
                  padding: "1.25rem",
                  boxShadow: "0 1px 3px rgba(0,0,0,0.04)",
                }}
              >
                <h2 style={{ fontSize: "1rem", fontWeight: 700, color: "#0f172a", margin: "0 0 1rem 0" }}>
                  Campaign Performance (Attribution)
                </h2>

                {campaignPerformance.length === 0 ? (
                  <div style={{ padding: "2rem", textAlign: "center", color: "#64748b" }}>
                    No campaign records in this period.
                  </div>
                ) : (
                  <div style={{ overflowX: "auto" }}>
                    <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "0.8125rem", textAlign: "left" }}>
                      <thead>
                        <tr style={{ backgroundColor: "#f8fafc", borderBottom: "1px solid #e2e8f0", color: "#475569" }}>
                          <th style={{ padding: "0.6rem 0.75rem", fontWeight: 600 }}>Campaign</th>
                          <th style={{ padding: "0.6rem 0.75rem", fontWeight: 600 }}>Leads</th>
                          <th style={{ padding: "0.6rem 0.75rem", fontWeight: 600 }}>Won</th>
                          <th style={{ padding: "0.6rem 0.75rem", fontWeight: 600 }}>Lost</th>
                          <th style={{ padding: "0.6rem 0.75rem", fontWeight: 600 }}>Win Rate</th>
                        </tr>
                      </thead>
                      <tbody>
                        {campaignPerformance.map((c) => (
                          <tr key={c.campaign} style={{ borderBottom: "1px solid #f1f5f9" }}>
                            <td style={{ padding: "0.6rem 0.75rem", fontWeight: 600, color: "#0f172a" }}>
                              {c.campaign}
                            </td>
                            <td style={{ padding: "0.6rem 0.75rem" }}>{c.lead_count ?? (c as any).total_leads ?? 0}</td>
                            <td style={{ padding: "0.6rem 0.75rem", color: "#059669", fontWeight: 600 }}>{c.won_count ?? (c as any).won_leads ?? 0}</td>
                            <td style={{ padding: "0.6rem 0.75rem", color: "#dc2626" }}>{c.lost_count ?? (c as any).lost_leads ?? 0}</td>
                            <td style={{ padding: "0.6rem 0.75rem", fontWeight: 600 }}>
                              {c.conversion_rate !== null ? `${c.conversion_rate}%` : "—"}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>

              {/* Source Distribution Breakdown */}
              <div
                data-testid="source-distribution-card"
                style={{
                  backgroundColor: "#fff",
                  border: "1px solid #e2e8f0",
                  borderRadius: "0.5rem",
                  padding: "1.25rem",
                  boxShadow: "0 1px 3px rgba(0,0,0,0.04)",
                }}
              >
                <h2 style={{ fontSize: "1rem", fontWeight: 700, color: "#0f172a", margin: "0 0 1rem 0" }}>
                  Lead Source Distribution
                </h2>

                {sourceDistribution.length === 0 ? (
                  <div style={{ padding: "2rem", textAlign: "center", color: "#64748b" }}>
                    No source data found.
                  </div>
                ) : (
                  <div style={{ display: "flex", flexDirection: "column", gap: "0.75rem" }}>
                    {sourceDistribution.map((s) => {
                      const sourceName = s.source || (s as any).source_type || "Unknown";
                      const leadCount = s.lead_count ?? (s as any).total_leads ?? 0;
                      return (
                        <div
                          key={sourceName}
                          style={{
                            backgroundColor: "#f8fafc",
                            border: "1px solid #e2e8f0",
                            borderRadius: "0.375rem",
                            padding: "0.6rem 0.85rem",
                            display: "flex",
                            justifyContent: "space-between",
                            alignItems: "center",
                          }}
                        >
                          <div>
                            <span style={{ fontWeight: 600, fontSize: "0.8125rem", color: "#1e293b", textTransform: "capitalize" }}>
                              {sourceName.replace(/_/g, " ")}
                            </span>
                          </div>
                          <div style={{ display: "flex", alignItems: "center", gap: "0.85rem" }}>
                            <span style={{ fontSize: "0.8125rem", color: "#64748b" }}>
                              <strong>{leadCount}</strong> leads
                            </span>
                            <span style={{ fontSize: "0.75rem", backgroundColor: "#ecfdf5", color: "#065f46", padding: "0.15rem 0.45rem", borderRadius: "9999px", fontWeight: 600 }}>
                              {s.percentage ?? 0}%
                            </span>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            </div>

            {/* 5. Sales Representative Performance & Workload */}
            <div
              data-testid="rep-performance-card"
              style={{
                backgroundColor: "#fff",
                border: "1px solid #e2e8f0",
                borderRadius: "0.5rem",
                padding: "1.25rem",
                boxShadow: "0 1px 3px rgba(0,0,0,0.04)",
              }}
            >
              <h2 style={{ fontSize: "1rem", fontWeight: 700, color: "#0f172a", margin: "0 0 1rem 0" }}>
                {isSalesperson ? "My Sales Performance & Workload" : "Sales Representative Performance & Workload"}
              </h2>

              {repPerformance.length === 0 ? (
                <div style={{ padding: "2rem", textAlign: "center", color: "#64748b" }}>
                  No representative performance records in scope.
                </div>
              ) : (
                <div style={{ overflowX: "auto" }}>
                  <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "0.8125rem", textAlign: "left" }}>
                    <thead>
                      <tr style={{ backgroundColor: "#f8fafc", borderBottom: "1px solid #e2e8f0", color: "#475569" }}>
                        <th style={{ padding: "0.75rem 1rem", fontWeight: 600 }}>Sales Representative</th>
                        <th style={{ padding: "0.75rem 1rem", fontWeight: 600 }}>Assigned Leads</th>
                        <th style={{ padding: "0.75rem 1rem", fontWeight: 600 }}>Active Leads</th>
                        <th style={{ padding: "0.75rem 1rem", fontWeight: 600 }}>Won</th>
                        <th style={{ padding: "0.75rem 1rem", fontWeight: 600 }}>Lost</th>
                        <th style={{ padding: "0.75rem 1rem", fontWeight: 600 }}>Win Rate</th>
                        <th style={{ padding: "0.75rem 1rem", fontWeight: 600 }}>Overdue FU</th>
                        <th style={{ padding: "0.75rem 1rem", fontWeight: 600 }}>Activities</th>
                      </tr>
                    </thead>
                    <tbody>
                      {repPerformance.map((rep) => {
                        const repId = rep.user_id || (rep as any).salesperson_id;
                        const repName = rep.display_name || (rep as any).salesperson_name || "Representative";
                        const repEmail = rep.email || (rep as any).salesperson_email;
                        const wonCount = rep.won_leads ?? (rep as any).won_count ?? 0;
                        const lostCount = rep.lost_leads ?? (rep as any).lost_count ?? 0;

                        return (
                          <tr
                            key={repId}
                            data-testid={`rep-row-${repId}`}
                            style={{ borderBottom: "1px solid #f1f5f9" }}
                          >
                            <td style={{ padding: "0.75rem 1rem" }}>
                              <div style={{ fontWeight: 600, color: "#0f172a" }}>{repName}</div>
                              {repEmail && (
                                <div style={{ fontSize: "0.7rem", color: "#64748b" }}>{repEmail}</div>
                              )}
                            </td>
                            <td style={{ padding: "0.75rem 1rem", fontWeight: 500 }}>{rep.assigned_leads}</td>
                            <td style={{ padding: "0.75rem 1rem", color: "#2563eb", fontWeight: 600 }}>
                              {rep.active_leads}
                              {rep.max_capacity ? ` / ${rep.max_capacity}` : ""}
                            </td>
                            <td style={{ padding: "0.75rem 1rem", color: "#059669", fontWeight: 600 }}>{wonCount}</td>
                            <td style={{ padding: "0.75rem 1rem", color: "#dc2626" }}>{lostCount}</td>
                            <td style={{ padding: "0.75rem 1rem", fontWeight: 700 }}>
                              {rep.conversion_rate !== null ? `${rep.conversion_rate}%` : "—"}
                            </td>
                            <td style={{ padding: "0.75rem 1rem", color: rep.overdue_follow_ups > 0 ? "#dc2626" : "#64748b", fontWeight: rep.overdue_follow_ups > 0 ? 700 : 400 }}>
                              {rep.overdue_follow_ups}
                            </td>
                            <td style={{ padding: "0.75rem 1rem" }}>{rep.activities_count}</td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    </AppShell>
  );
}

export default CrmReportsPage;
