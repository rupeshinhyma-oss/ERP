import { AppShell } from "@/components/AppShell";
import { Breadcrumb } from "@/components/Breadcrumb";
import { IconCoins, IconFileText, IconLayers } from "@/components/icons";

export function PayrollPage() {
  return (
    <AppShell activeKey="hrms-payroll">
      <main className="page">
        <Breadcrumb trail={["HRMS", "Payroll"]} />

        <div className="page-header">
          <div>
            <h1>Payroll</h1>
            <div className="page-subtitle">
              Manage employee compensation, salary structures, and payslips.
            </div>
          </div>
        </div>

        {/* Section 1: Current Payslip */}
        <div className="card">
          <div className="card-header">
            <div>
              <h2 className="hrms-section-title">Current Payslip</h2>
              <div className="hrms-section-desc">Latest generated salary statement, earnings, and statutory deductions</div>
            </div>
            <span className="hrms-badge-shell">Current Cycle</span>
          </div>
          <div className="hrms-placeholder-box">
            <div className="hrms-placeholder-icon">
              <IconCoins />
            </div>
            <h3 className="hrms-placeholder-title">Current Payslip Statement</h3>
            <p className="hrms-placeholder-text">
              Monthly payslip details including basic pay, allowances, provident fund, tax deductions, and net payout summary will be presented here.
            </p>
          </div>
        </div>

        {/* Section 2: Salary Structure */}
        <div className="card">
          <div className="card-header">
            <div>
              <h2 className="hrms-section-title">Salary Structure</h2>
              <div className="hrms-section-desc">Designated CTC breakdown, allowances, and compensation grade</div>
            </div>
            <span className="hrms-badge-shell">Compensation</span>
          </div>
          <div className="hrms-placeholder-box">
            <div className="hrms-placeholder-icon">
              <IconLayers />
            </div>
            <h3 className="hrms-placeholder-title">Salary Structure Overview</h3>
            <p className="hrms-placeholder-text">
              Employee remuneration structure with breakdown of fixed pay, variable components, house rent allowance (HRA), and performance bonuses.
            </p>
          </div>
        </div>

        {/* Section 3: Payroll History */}
        <div className="card">
          <div className="card-header">
            <div>
              <h2 className="hrms-section-title">Payroll History</h2>
              <div className="hrms-section-desc">Historical payroll statements, tax deduction records, and disbursement logs</div>
            </div>
            <span className="hrms-badge-shell">0 Records</span>
          </div>
          <div className="hrms-placeholder-box">
            <div className="hrms-placeholder-icon">
              <IconFileText />
            </div>
            <h3 className="hrms-placeholder-title">No Payroll History Available</h3>
            <p className="hrms-placeholder-text">
              Archive of historical monthly payslips, downloadable PDF salary slips, and annual income statements will be listed here.
            </p>
          </div>
        </div>
      </main>
    </AppShell>
  );
}
