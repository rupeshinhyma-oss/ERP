import { AppShell } from "@/components/AppShell";
import { Breadcrumb } from "@/components/Breadcrumb";
import { IconCreditCard, IconFileText, IconCoins } from "@/components/icons";

export function ExpensesPage() {
  return (
    <AppShell activeKey="hrms-expenses">
      <main className="page">
        <Breadcrumb trail={["HRMS", "Expense Management"]} />

        <div className="page-header">
          <div>
            <h1>Expense Management</h1>
            <div className="page-subtitle">
              Track employee expense claims, reimbursements, and receipts.
            </div>
          </div>
        </div>

        {/* Section 1: Expense Summary */}
        <div className="card">
          <div className="card-header">
            <div>
              <h2 className="hrms-section-title">Expense Summary</h2>
              <div className="hrms-section-desc">Monthly expense breakdown, approved claims, and pending payouts</div>
            </div>
            <span className="hrms-badge-shell">Financial Summary</span>
          </div>
          <div className="hrms-placeholder-box">
            <div className="hrms-placeholder-icon">
              <IconCoins />
            </div>
            <h3 className="hrms-placeholder-title">Expense Claims Summary</h3>
            <p className="hrms-placeholder-text">
              Aggregated statistics of total claims submitted, reimbursements disbursed, and pending review amounts will appear here.
            </p>
          </div>
        </div>

        {/* Section 2: New Claim */}
        <div className="card">
          <div className="card-header">
            <div>
              <h2 className="hrms-section-title">New Claim</h2>
              <div className="hrms-section-desc">Submit travel, lodging, meal, or operational expenses</div>
            </div>
            <span className="hrms-badge-shell">Create Claim</span>
          </div>
          <div className="hrms-placeholder-box">
            <div className="hrms-placeholder-icon">
              <IconCreditCard />
            </div>
            <h3 className="hrms-placeholder-title">New Expense Claim Form</h3>
            <p className="hrms-placeholder-text">
              Expense claim submission with category selection, tax invoices, receipt attachments, and currency amounts will be enabled in subsequent phases.
            </p>
          </div>
        </div>

        {/* Section 3: Recent Claims */}
        <div className="card">
          <div className="card-header">
            <div>
              <h2 className="hrms-section-title">Recent Claims</h2>
              <div className="hrms-section-desc">List of employee reimbursement claims and approval status</div>
            </div>
            <span className="hrms-badge-shell">0 Claims</span>
          </div>
          <div className="hrms-placeholder-box">
            <div className="hrms-placeholder-icon">
              <IconFileText />
            </div>
            <h3 className="hrms-placeholder-title">No Recent Claims</h3>
            <p className="hrms-placeholder-text">
              Submitted expense reimbursement vouchers, multi-level manager approvals, and payment remittance statuses will be tracked here.
            </p>
          </div>
        </div>
      </main>
    </AppShell>
  );
}
