import { useState } from "react";
import { AppShell } from "@/components/AppShell";
import { Breadcrumb } from "@/components/Breadcrumb";
import { IconClock, IconCalendar, IconCheckSquare, IconSettings } from "@/components/icons";

export function AttendancePage() {
  const [activeTab, setActiveTab] = useState<"view" | "approval" | "settings">("view");
  const [settingsSubTab, setSettingsSubTab] = useState<"policy" | "exemption" | "overtime">("policy");

  return (
    <AppShell activeKey="hrms-attendance">
      <main className="page">
        <Breadcrumb trail={["HRMS", "Attendance"]} />

        <div className="page-header">
          <div>
            <h1>Attendance</h1>
            <div className="page-subtitle">
              Enterprise punch tracking, geofence verification, calendar, and regularization.
            </div>
          </div>
        </div>

        {/* Internal Screen Tabs */}
        <div className="hrms-tabs-nav">
          <button
            type="button"
            className={`hrms-tab-btn ${activeTab === "view" ? "active" : ""}`}
            onClick={() => setActiveTab("view")}
          >
            <IconCalendar />
            <span>View</span>
          </button>
          <button
            type="button"
            className={`hrms-tab-btn ${activeTab === "approval" ? "active" : ""}`}
            onClick={() => setActiveTab("approval")}
          >
            <IconCheckSquare />
            <span>Approval</span>
          </button>
          <button
            type="button"
            className={`hrms-tab-btn ${activeTab === "settings" ? "active" : ""}`}
            onClick={() => setActiveTab("settings")}
          >
            <IconSettings />
            <span>Settings</span>
          </button>
        </div>

        {/* View Tab */}
        {activeTab === "view" && (
          <div className="hrms-tab-content">
            <div className="card">
              <div className="card-header">
                <div>
                  <h2 className="hrms-section-title">Punch Card Container</h2>
                  <div className="hrms-section-desc">Live punch logging and geofenced attendance tracking</div>
                </div>
                <span className="hrms-badge-shell">
                  <span className="hrms-badge-dot" />
                  Foundation Shell
                </span>
              </div>
              <div className="hrms-placeholder-box">
                <div className="hrms-placeholder-icon">
                  <IconClock />
                </div>
                <h3 className="hrms-placeholder-title">Punch functionality will be available here.</h3>
                <p className="hrms-placeholder-text">
                  Clock-in, clock-out, GPS location validation, and active work session tracking will be integrated in the upcoming phase.
                </p>
              </div>
            </div>

            <div className="card">
              <div className="card-header">
                <div>
                  <h2 className="hrms-section-title">Monthly Calendar Container</h2>
                  <div className="hrms-section-desc">Comprehensive monthly employee attendance matrix</div>
                </div>
                <span className="hrms-badge-shell">
                  <span className="hrms-badge-dot" />
                  Monthly View
                </span>
              </div>
              <div className="hrms-placeholder-box">
                <div className="hrms-placeholder-icon">
                  <IconCalendar />
                </div>
                <h3 className="hrms-placeholder-title">Attendance calendar will appear here.</h3>
                <p className="hrms-placeholder-text">
                  Daily attendance status, punch records, regularization triggers, and shift timings will be visualized here.
                </p>
              </div>
            </div>
          </div>
        )}

        {/* Approval Tab */}
        {activeTab === "approval" && (
          <div className="hrms-tab-content">
            <div className="hrms-grid-2">
              <div className="card">
                <div className="card-header">
                  <div>
                    <h2 className="hrms-section-title">Pending Requests</h2>
                    <div className="hrms-section-desc">Attendance regularizations and manual punch approvals</div>
                  </div>
                  <span className="hrms-badge-shell">0 Pending</span>
                </div>
                <div className="hrms-placeholder-box">
                  <div className="hrms-placeholder-icon">
                    <IconClock />
                  </div>
                  <h3 className="hrms-placeholder-title">No Pending Requests</h3>
                  <p className="hrms-placeholder-text">
                    There are currently no attendance correction or regularization requests awaiting supervisor review.
                  </p>
                </div>
              </div>

              <div className="card">
                <div className="card-header">
                  <div>
                    <h2 className="hrms-section-title">Approved Requests</h2>
                    <div className="hrms-section-desc">Recently processed attendance regularizations</div>
                  </div>
                  <span className="hrms-badge-shell">0 Approved</span>
                </div>
                <div className="hrms-placeholder-box">
                  <div className="hrms-placeholder-icon">
                    <IconCheckSquare />
                  </div>
                  <h3 className="hrms-placeholder-title">No Approved Requests</h3>
                  <p className="hrms-placeholder-text">
                    No approved attendance modifications have been recorded for the current active cycle.
                  </p>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Settings Tab */}
        {activeTab === "settings" && (
          <div className="hrms-tab-content">
            <div className="hrms-subtabs-nav">
              <button
                type="button"
                className={`hrms-subtab-btn ${settingsSubTab === "policy" ? "active" : ""}`}
                onClick={() => setSettingsSubTab("policy")}
              >
                Attendance Policy
              </button>
              <button
                type="button"
                className={`hrms-subtab-btn ${settingsSubTab === "exemption" ? "active" : ""}`}
                onClick={() => setSettingsSubTab("exemption")}
              >
                Attendance Exemption
              </button>
              <button
                type="button"
                className={`hrms-subtab-btn ${settingsSubTab === "overtime" ? "active" : ""}`}
                onClick={() => setSettingsSubTab("overtime")}
              >
                Overtime
              </button>
            </div>

            {settingsSubTab === "policy" && (
              <div className="card">
                <div className="card-header">
                  <div>
                    <h2 className="hrms-section-title">Attendance Policy</h2>
                    <div className="hrms-section-desc">Shift schedules, minimum daily hours, and grace period settings</div>
                  </div>
                </div>
                <div className="hrms-placeholder-box">
                  <div className="hrms-placeholder-icon">
                    <IconSettings />
                  </div>
                  <h3 className="hrms-placeholder-title">Attendance Policy Configuration</h3>
                  <p className="hrms-placeholder-text">
                    Define standard work shifts, allowed late-in grace minutes, early-departure rules, and half-day duration policies.
                  </p>
                </div>
              </div>
            )}

            {settingsSubTab === "exemption" && (
              <div className="card">
                <div className="card-header">
                  <div>
                    <h2 className="hrms-section-title">Attendance Exemption</h2>
                    <div className="hrms-section-desc">Exemption rules for specific roles, field agents, and executive staff</div>
                  </div>
                </div>
                <div className="hrms-placeholder-box">
                  <div className="hrms-placeholder-icon">
                    <IconSettings />
                  </div>
                  <h3 className="hrms-placeholder-title">Attendance Exemption Management</h3>
                  <p className="hrms-placeholder-text">
                    Configure role-based exemptions from geofencing constraints, strict punch windows, and automated late markings.
                  </p>
                </div>
              </div>
            )}

            {settingsSubTab === "overtime" && (
              <div className="card">
                <div className="card-header">
                  <div>
                    <h2 className="hrms-section-title">Overtime</h2>
                    <div className="hrms-section-desc">Overtime threshold calculations, approvals, and payout rules</div>
                  </div>
                </div>
                <div className="hrms-placeholder-box">
                  <div className="hrms-placeholder-icon">
                    <IconClock />
                  </div>
                  <h3 className="hrms-placeholder-title">Overtime Calculation Rules</h3>
                  <p className="hrms-placeholder-text">
                    Set up overtime multipliers, minimum extra duration thresholds, weekend overtime policies, and supervisor approval chains.
                  </p>
                </div>
              </div>
            )}
          </div>
        )}
      </main>
    </AppShell>
  );
}
