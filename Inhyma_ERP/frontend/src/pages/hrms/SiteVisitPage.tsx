import { AppShell } from "@/components/AppShell";
import { Breadcrumb } from "@/components/Breadcrumb";
import { IconMap, IconClock, IconFileText } from "@/components/icons";

export function SiteVisitPage() {
  return (
    <AppShell activeKey="hrms-site-visit">
      <main className="page">
        <Breadcrumb trail={["HRMS", "Site Visit"]} />

        <div className="page-header">
          <div>
            <h1>Site Visit</h1>
            <div className="page-subtitle">
              Track employee on-field visits, client locations, and visit logs.
            </div>
          </div>
        </div>

        {/* Section 1: Today's Visits */}
        <div className="card">
          <div className="card-header">
            <div>
              <h2 className="hrms-section-title">Today's Visits</h2>
              <div className="hrms-section-desc">Client visits, site inspections, and assignments scheduled for today</div>
            </div>
            <span className="hrms-badge-shell">0 Scheduled</span>
          </div>
          <div className="hrms-placeholder-box">
            <div className="hrms-placeholder-icon">
              <IconMap />
            </div>
            <h3 className="hrms-placeholder-title">No Visits Scheduled Today</h3>
            <p className="hrms-placeholder-text">
              Scheduled on-site client demonstrations, customer location surveys, and field engineer visits will appear here.
            </p>
          </div>
        </div>

        {/* Section 2: Active Visit */}
        <div className="card">
          <div className="card-header">
            <div>
              <h2 className="hrms-section-title">Active Visit</h2>
              <div className="hrms-section-desc">Currently ongoing customer visit session</div>
            </div>
            <span className="hrms-badge-shell">Idle</span>
          </div>
          <div className="hrms-placeholder-box">
            <div className="hrms-placeholder-icon">
              <IconClock />
            </div>
            <h3 className="hrms-placeholder-title">No Active Visit In Progress</h3>
            <p className="hrms-placeholder-text">
              When an employee checks in at a client destination, visit timer, location verification, and visit notes will be managed here.
            </p>
          </div>
        </div>

        {/* Section 3: Visit History */}
        <div className="card">
          <div className="card-header">
            <div>
              <h2 className="hrms-section-title">Visit History</h2>
              <div className="hrms-section-desc">Complete record of past on-site visits, durations, and outcomes</div>
            </div>
            <span className="hrms-badge-shell">0 Records</span>
          </div>
          <div className="hrms-placeholder-box">
            <div className="hrms-placeholder-icon">
              <IconFileText />
            </div>
            <h3 className="hrms-placeholder-title">No Visit History Available</h3>
            <p className="hrms-placeholder-text">
              Historical logs of customer interactions, check-in timestamps, visit meeting summaries, and customer sign-offs will be archived here.
            </p>
          </div>
        </div>
      </main>
    </AppShell>
  );
}
