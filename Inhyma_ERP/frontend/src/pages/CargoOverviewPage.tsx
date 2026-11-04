/**
 * Cargo Overview Page.
 *
 * Route: /reports/cargo-overview
 * Sidebar Section: REPORTS (permission: report.view)
 * Intentionally blank module shell ready for Cargo Overview specifications.
 */

import { AppShell } from "@/components/AppShell";
import { Breadcrumb } from "@/components/Breadcrumb";

export function CargoOverviewPage() {
  return (
    <AppShell activeKey="reports-cargo-overview">
      <main className="page" style={{ padding: "20px 24px" }}>
        <Breadcrumb trail={["Reports", "Cargo Overview"]} />

        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", margin: "0 0 16px" }}>
          <h1 style={{ margin: 0, fontSize: 22, fontWeight: 700, color: "#0f172a" }}>
            Cargo Overview
          </h1>
        </div>

        <div
          className="card"
          data-testid="cargo-overview-blank-canvas"
          style={{
            background: "#ffffff",
            border: "1px solid #e2e8f0",
            borderRadius: 10,
            minHeight: "calc(100vh - 180px)",
          }}
        />
      </main>
    </AppShell>
  );
}

