import { AppShell } from "@/components/AppShell";
import { Breadcrumb } from "@/components/Breadcrumb";
import { IconCalendar, IconFileText, IconCheckSquare } from "@/components/icons";

export function LeavePage() {
  return (
    <AppShell activeKey="hrms-leave">
      <main className="page">
        <Breadcrumb trail={["HRMS", "Leave"]} />

        <div className="page-header">
          <div>
            <h1>Leave</h1>
            <div className="page-subtitle">
              Manage employee leave requests, allowances, and balances.
            </div>
          </div>
        </div>

        {/* Section 1: Leave Balance */}
        <div className="card">
          <div className="card-header">
            <div>
              <h2 className="hrms-section-title">Leave Balance</h2>
              <div className="hrms-section-desc">Entitled, consumed, and remaining annual leave quotas</div>
            </div>
            <span className="hrms-badge-shell">Annual Quota</span>
          </div>
          <div className="hrms-placeholder-box">
            <div className="hrms-placeholder-icon">
              <IconCalendar />
            </div>
            <h3 className="hrms-placeholder-title">Leave Balance Overview</h3>
            <p className="hrms-placeholder-text">
              Employee leave balances (Casual Leave, Sick Leave, Earned Leave) and accrued leaves will appear here.
            </p>
          </div>
        </div>

        {/* Section 2: Apply Leave */}
        <div className="card">
          <div className="card-header">
            <div>
              <h2 className="hrms-section-title">Apply Leave</h2>
              <div className="hrms-section-desc">Submit new leave application with duration and justification</div>
            </div>
            <span className="hrms-badge-shell">New Request</span>
          </div>
          <div className="hrms-placeholder-box">
            <div className="hrms-placeholder-icon">
              <IconFileText />
            </div>
            <h3 className="hrms-placeholder-title">Leave Application Form</h3>
            <p className="hrms-placeholder-text">
              Leave application form with date range picker, leave type selection, half-day options, and hand-over notes will be available here.
            </p>
          </div>
        </div>

        {/* Section 3: Leave History */}
        <div className="card">
          <div className="card-header">
            <div>
              <h2 className="hrms-section-title">Leave History</h2>
              <div className="hrms-section-desc">Chronological history of applied, approved, and cancelled leaves</div>
            </div>
            <span className="hrms-badge-shell">0 Records</span>
          </div>
          <div className="hrms-placeholder-box">
            <div className="hrms-placeholder-icon">
              <IconCheckSquare />
            </div>
            <h3 className="hrms-placeholder-title">No Leave History</h3>
            <p className="hrms-placeholder-text">
              Past leave applications, approval progression, and reviewer feedback comments will be recorded here.
            </p>
          </div>
        </div>
      </main>
    </AppShell>
  );
}
