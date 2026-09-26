import { useState } from "react";
import { AppShell } from "@/components/AppShell";
import { Breadcrumb } from "@/components/Breadcrumb";
import { IconCalendar, IconCreditCard, IconPin, IconSettings } from "@/components/icons";

export function SetupPage() {
  const [activeTab, setActiveTab] = useState<"leaveTypes" | "expenseSettings" | "geoFencing">("leaveTypes");

  return (
    <AppShell activeKey="hrms-setup">
      <main className="page">
        <Breadcrumb trail={["HRMS", "Setup"]} />

        <div className="page-header">
          <div>
            <h1>HRMS Setup</h1>
            <div className="page-subtitle">
              Configure HRMS global policies, leave types, expense limits, and geofencing parameters.
            </div>
          </div>
        </div>

        {/* Setup Internal Screen Tabs */}
        <div className="hrms-tabs-nav">
          <button
            type="button"
            className={`hrms-tab-btn ${activeTab === "leaveTypes" ? "active" : ""}`}
            onClick={() => setActiveTab("leaveTypes")}
          >
            <IconCalendar />
            <span>Leave Types</span>
          </button>
          <button
            type="button"
            className={`hrms-tab-btn ${activeTab === "expenseSettings" ? "active" : ""}`}
            onClick={() => setActiveTab("expenseSettings")}
          >
            <IconCreditCard />
            <span>Expense Settings</span>
          </button>
          <button
            type="button"
            className={`hrms-tab-btn ${activeTab === "geoFencing" ? "active" : ""}`}
            onClick={() => setActiveTab("geoFencing")}
          >
            <IconPin />
            <span>Geo Fencing</span>
          </button>
        </div>

        {/* Tab 1: Leave Types */}
        {activeTab === "leaveTypes" && (
          <div className="hrms-tab-content">
            <div className="card">
              <div className="card-header">
                <div>
                  <h2 className="hrms-section-title">Leave Types & Entitlements</h2>
                  <div className="hrms-section-desc">Manage standard organizational leave categories and accrual rules</div>
                </div>
                <span className="hrms-badge-shell">Policy Master</span>
              </div>
              <div className="hrms-placeholder-box">
                <div className="hrms-placeholder-icon">
                  <IconCalendar />
                </div>
                <h3 className="hrms-placeholder-title">Leave Types Configuration</h3>
                <p className="hrms-placeholder-text">
                  Configure corporate leave categories (Casual, Sick, Earned, Maternity, Paternity), yearly entitlements, encashment policies, and carry-over limits.
                </p>
              </div>
            </div>
          </div>
        )}

        {/* Tab 2: Expense Settings */}
        {activeTab === "expenseSettings" && (
          <div className="hrms-tab-content">
            <div className="card">
              <div className="card-header">
                <div>
                  <h2 className="hrms-section-title">Expense Settings & Categories</h2>
                  <div className="hrms-section-desc">Approval hierarchy, per-diem caps, and receipt requirement policies</div>
                </div>
                <span className="hrms-badge-shell">Finance Master</span>
              </div>
              <div className="hrms-placeholder-box">
                <div className="hrms-placeholder-icon">
                  <IconCreditCard />
                </div>
                <h3 className="hrms-placeholder-title">Expense Policy Configuration</h3>
                <p className="hrms-placeholder-text">
                  Set eligible reimbursement expense types, daily allowance caps, manager approval thresholds, and mandatory receipt upload thresholds.
                </p>
              </div>
            </div>
          </div>
        )}

        {/* Tab 3: Geo Fencing */}
        {activeTab === "geoFencing" && (
          <div className="hrms-tab-content">
            <div className="card">
              <div className="card-header">
                <div>
                  <h2 className="hrms-section-title">Geo Fencing Parameters</h2>
                  <div className="hrms-section-desc">Office boundary coordinates, GPS accuracy tolerance, and geofence enforcement</div>
                </div>
                <span className="hrms-badge-shell">Location Master</span>
              </div>
              <div className="hrms-placeholder-box">
                <div className="hrms-placeholder-icon">
                  <IconSettings />
                </div>
                <h3 className="hrms-placeholder-title">Geofencing & Boundary Setup</h3>
                <p className="hrms-placeholder-text">
                  Define authorized office perimeter radius, GPS geofence validation rules, and location-based punch restrictions. Office location mapping will be configured here.
                </p>
              </div>
            </div>
          </div>
        )}
      </main>
    </AppShell>
  );
}
