/**
 * Routes.
 *
 * Each `*.html` page in the original app becomes one route. The old filenames
 * are kept as redirects so existing bookmarks and any links still pointing at
 * `/masters-countries.html` continue to resolve -- including
 * `employee-detail.html` and `employee-form.html`, which were already just
 * redirect stubs pointing at User Management.
 *
 * FIX (nav redirect bug): EffectivePermissionsPage was a fully built page
 * (linked from LEGACY_REDIRECTS' "/effective-permissions.html" -> "/effective-permissions"
 * mapping) that was never imported or given its own route here. Visiting
 * /effective-permissions fell through the "*" catch-all and bounced to
 * /dashboard. It is now imported and routed below.
 */

import { useEffect, useRef } from "react";
import { Navigate, Route, Routes, useLocation, useNavigate } from "react-router-dom";
import { setUnauthorizedHandler } from "@/lib/api";
import { LEGACY_REDIRECTS } from "@/lib/nav";

import { auth } from "@/lib/auth";
import { useAuth } from "@/lib/hooks";
import { LoginPage } from "@/pages/Login";
import { AuthCallbackPage } from "@/pages/AuthCallback";
import { DashboardPage } from "@/pages/Dashboard";
import { FeedPage } from "@/pages/FeedPage";
import { ForbiddenPage } from "@/pages/Forbidden";

function HrmsRouteGuard({
  permission,
  anyPermissions,
  children,
}: {
  permission?: string;
  anyPermissions?: string[];
  children: React.ReactNode;
}) {
  const { hasPermission } = useAuth();
  if (!auth.isLoggedIn()) {
    return <ForbiddenPage />;
  }
  if (permission && !hasPermission(permission)) {
    return <ForbiddenPage />;
  }
  if (anyPermissions && anyPermissions.length > 0 && !anyPermissions.some((p) => hasPermission(p))) {
    return <ForbiddenPage />;
  }
  return <>{children}</>;
}
import { OrganizationPage } from "@/pages/Organization";
import { AuditPage } from "@/pages/Audit";
import { UsersPage } from "@/pages/Users";
import { ProfilePage } from "@/pages/Profile";
import { RbacPage } from "@/pages/Rbac";
import { PositionsPage } from "@/pages/org/Positions";
import { CompaniesPage } from "@/pages/Companies";
import { LeadsPage } from "@/pages/LeadsPage";
import FollowUpsPage from "@/pages/FollowUpsPage";
import { SuppliersPage } from "@/pages/Suppliers";
import { ProformaInvoicesPage } from "@/pages/ProformaInvoicesPage";
import { ProformaInvoicePdfPage } from "@/pages/ProformaInvoicePdfPage";
import { SalesOrderPdfPage } from "@/pages/SalesOrderPdfPage";
import { GatePassPdfPage } from "@/pages/GatePassPdfPage";
import { SaleProcessListPage } from "@/pages/sales/SaleProcessList";
import { SaleProcessFormPage } from "@/pages/sales/SaleProcessForm";
import { DiscountPaymentsPage } from "@/pages/sales/DiscountPaymentsPage";
import { LocalPurchasePage } from "@/pages/purchase/LocalPurchasePage";
import { LocalPurchasePdfPage } from "@/pages/LocalPurchasePdfPage";
import { ImportPurchasePage } from "@/pages/purchase/ImportPurchasePage";
import { ImportPurchasePdfPage } from "@/pages/ImportPurchasePdfPage";
import { TasksPage } from "@/pages/tasks/TasksPage";
import { TechnicalTasksPage } from "@/pages/technicalTasks/TechnicalTasksPage";
import { TechnicalTaskDetailPage } from "@/pages/technicalTasks/TechnicalTaskDetailPage";
import { PaymentsPage } from "@/pages/PaymentsPage";
import { GeneralReportsPage } from "@/pages/GeneralReportsPage";
import { FinancialPlanningReportPage } from "@/pages/FinancialPlanningReportPage";
import { CargoOverviewPage } from "@/pages/CargoOverviewPage";
import { TechnicalTaskTypesPage } from "@/pages/masters/TechnicalTaskTypes";
import { TechnicianOperationsPage } from "@/pages/TechnicianOperationsPage";
import { AttendancePage } from "@/pages/hrms/AttendancePage";
import { LeavePage } from "@/pages/hrms/LeavePage";
import { ExpensesPage } from "@/pages/hrms/ExpensesPage";
import { SiteVisitPage } from "@/pages/hrms/SiteVisitPage";
import { PayrollPage } from "@/pages/hrms/PayrollPage";
import { SetupPage } from "@/pages/hrms/SetupPage";
import { AssetPage } from "@/pages/hrms/AssetPage";
import { PipelineSetupPage } from "@/pages/crm/PipelineSetupPage";
import { SalespersonDistributionPage } from "@/pages/crm/SalespersonDistributionPage";
import { CrmLeadsPage } from "@/pages/crm/CrmLeadsPage";

import { CountriesPage } from "@/pages/masters/Countries";
import { StatesPage } from "@/pages/masters/States";
import { DistrictsPage } from "@/pages/masters/Districts";
import { CitiesPage } from "@/pages/masters/Cities";
import { CompanyListPage } from "@/pages/masters/CompanyList";
import { CurrenciesPage } from "@/pages/masters/Currencies";
import { UomPage } from "@/pages/masters/Uom";
import { BrandsPage } from "@/pages/masters/Brands";
import { SupplierTypesPage } from "@/pages/masters/SupplierTypes";
import { BuyerTypesPage } from "@/pages/masters/BuyerTypes";
import { CategoriesPage } from "@/pages/masters/Categories";
import { SubCategoriesPage } from "@/pages/masters/SubCategories";
import { ProductsPage } from "@/pages/masters/Products";
import { PriceListPage } from "@/pages/PriceListPage";
import { TaxesPage } from "@/pages/masters/Taxes";
import { AdditionalChargesPage } from "@/pages/masters/AdditionalCharges";
import { SocialMediaPage } from "@/pages/masters/SocialMedia";
import { AgentTypesPage } from "@/pages/masters/AgentTypes";
import { CompanyCategoriesPage } from "@/pages/masters/CompanyCategories";
import { CompanySectorsPage } from "@/pages/masters/CompanySectors";
import { WarehousesPage } from "@/pages/masters/Warehouses";
import { BillingCompaniesPage } from "@/pages/masters/BillingCompanies";
import { BanksPage } from "@/pages/masters/Banks";
import { TransportPage } from "@/pages/masters/Transport";
import { PaymentTermsPage } from "@/pages/masters/PaymentTerms";
import { LeadSourcesPage } from "@/pages/masters/LeadSources";
import { AdjustmentPurposesPage } from "@/pages/masters/AdjustmentPurposes";
import { CallTypesPage } from "@/pages/masters/CallTypes";
import { NetworkStatusNotifier } from "@/components/NetworkStatusNotifier";
import { ErrorBoundary } from "@/components/ErrorBoundary";
import { LiveConnectionLifecycle } from "@/lib/live/liveConnectionLifecycle";
import { ProductGalleryPage } from "@/pages/ProductGallery";
import { TrashPage } from "@/pages/Trash";
import PublicSupplierQuotePage from "@/pages/PublicSupplierQuotePage";
import { initGlobalPasteSanitizer } from "@/lib/pasteSanitizer";
import { initGlobalAutocompleteBlocker } from "@/lib/autocompleteBlocker";
import { processIncomingSsoHandover } from "@/lib/ssoBridge";
import { ProductStockPage } from "@/pages/ProductStockPage";
import { StockTransactionDetailPage } from "@/pages/StockTransactionDetailPage";
import { ProductReorderPage } from "@/pages/ProductReorderPage";
import { DeletedOrdersPage } from "@/pages/DeletedOrdersPage";
import { StockAdjustmentPage } from "@/pages/StockAdjustmentPage";
import { AdjustmentOrderPdfPage } from "@/pages/AdjustmentOrderPdfPage";
import { AddAdjustmentOrderPage } from "@/pages/AddAdjustmentOrderPage";
import { StockTransferPage } from "@/pages/StockTransferPage";
import { TransferOrderPdfPage } from "@/pages/TransferOrderPdfPage";
import { AddTransferOrderPage } from "@/pages/AddTransferOrderPage";
import { AgentsPage } from "@/pages/AgentsPage";
import { IndustrialZonesPage } from "@/pages/IndustrialZonesPage";

export function App() {
  const navigate = useNavigate();

  // Process incoming cross-ERP SSO handover immediately on load. Only a
  // genuine fresh auto-login ("logged-in") should redirect to /dashboard;
  // "already-logged-in" means nothing changed, so the user's current page
  // (wherever they navigated to) is left alone.
  const ssoProcessedRef = useRef(false);
  useEffect(() => {
    if (window.location.pathname.startsWith("/auth/callback")) {
      return;
    }
    if (ssoProcessedRef.current) return;
    ssoProcessedRef.current = true;
    processIncomingSsoHandover().then((result) => {
      if (result === "logged-in") {
        navigate("/dashboard", { replace: true });
      }
    });
  }, [navigate]);

  // Initialize global paste auto-clean across all inputs and forms
  useEffect(() => {
    return initGlobalPasteSanitizer();
  }, []);

  // Globally suppress intrusive browser autocomplete/autofill bubbles across all inputs
  useEffect(() => {
    return initGlobalAutocompleteBlocker();
  }, []);

  // Let the API client bounce expired sessions through the router rather than
  // a full page load.
  useEffect(() => {
    setUnauthorizedHandler(() => navigate("/login", { replace: true }));
    return () => setUnauthorizedHandler(null);
  }, [navigate]);

  const location = useLocation();

  return (
    <>
      <NetworkStatusNotifier />
      <LiveConnectionLifecycle />
      {/*
        Keyed by pathname: if a page crashes and the user navigates away
        (rather than clicking "Try Again"), this mounts a fresh boundary
        instance for the new route instead of carrying over the previous
        page's crashed state.
      */}
      <ErrorBoundary key={location.pathname} title="This page ran into a problem.">
        <Routes>
          <Route path="/login" element={<LoginPage />} />
          <Route path="/auth/callback" element={<AuthCallbackPage />} />
          <Route path="/quote/:token" element={<PublicSupplierQuotePage />} />
          <Route path="/" element={<Navigate to="/dashboard" replace />} />
          <Route path="/dashboard" element={<DashboardPage />} />
          <Route path="/feed" element={<HrmsRouteGuard><FeedPage /></HrmsRouteGuard>} />
          <Route path="/403" element={<ForbiddenPage />} />
          <Route path="/organization" element={<HrmsRouteGuard><OrganizationPage /></HrmsRouteGuard>} />
          <Route path="/erp-settings" element={<HrmsRouteGuard><OrganizationPage /></HrmsRouteGuard>} />
          <Route path="/audit" element={<HrmsRouteGuard><AuditPage /></HrmsRouteGuard>} />
          <Route path="/trash" element={<HrmsRouteGuard><TrashPage /></HrmsRouteGuard>} />
          <Route path="/profile" element={<HrmsRouteGuard><ProfilePage /></HrmsRouteGuard>} />
          <Route path="/users" element={<HrmsRouteGuard><UsersPage /></HrmsRouteGuard>} />
          <Route path="/rbac" element={<HrmsRouteGuard><RbacPage /></HrmsRouteGuard>} />
          <Route path="/effective-permissions" element={<Navigate to="/rbac" replace />} />
          {/* Employee was merged into User -- /employees is now an alias for the same page. */}
          <Route path="/employees" element={<HrmsRouteGuard><UsersPage /></HrmsRouteGuard>} />
          <Route path="/positions" element={<HrmsRouteGuard><PositionsPage /></HrmsRouteGuard>} />
          <Route path="/companies" element={<HrmsRouteGuard anyPermissions={["company.view", "company.manage"]}><CompaniesPage /></HrmsRouteGuard>} />
          <Route path="/companies/add" element={<HrmsRouteGuard anyPermissions={["company.view", "company.create", "company.manage"]}><CompaniesPage defaultAdd={true} /></HrmsRouteGuard>} />
          <Route path="/companies/addedit" element={<HrmsRouteGuard anyPermissions={["company.view", "company.create", "company.update", "company.manage"]}><CompaniesPage defaultAdd={true} /></HrmsRouteGuard>} />
          <Route path="/companies/addedit/:id" element={<HrmsRouteGuard anyPermissions={["company.view", "company.update", "company.manage"]}><CompaniesPage defaultAdd={true} /></HrmsRouteGuard>} />
          <Route path="/user/addEdit" element={<HrmsRouteGuard anyPermissions={["company.view", "company.create", "company.update", "company.manage"]}><CompaniesPage defaultAdd={true} /></HrmsRouteGuard>} />
          <Route path="/user/addedit" element={<HrmsRouteGuard anyPermissions={["company.view", "company.create", "company.update", "company.manage"]}><CompaniesPage defaultAdd={true} /></HrmsRouteGuard>} />

          {/* AGENTS routes */}
          <Route path="/agents" element={<HrmsRouteGuard permission="agent.view"><AgentsPage /></HrmsRouteGuard>} />
          <Route path="/agent/list" element={<Navigate to="/agents" replace />} />
          <Route path="/agents/list" element={<Navigate to="/agents" replace />} />

          {/* INDUSTRIAL ZONES routes */}
          <Route path="/industrial/zones/list" element={<HrmsRouteGuard permission="zone.view"><IndustrialZonesPage /></HrmsRouteGuard>} />
          <Route path="/industrial-zones" element={<Navigate to="/industrial/zones/list" replace />} />
          <Route path="/industrial/zones" element={<Navigate to="/industrial/zones/list" replace />} />
          <Route path="/industrial-zone/list" element={<Navigate to="/industrial/zones/list" replace />} />

          {/* SUPPLIERS routes under /purchase/suppliers */}
          <Route path="/purchase/suppliers" element={<HrmsRouteGuard><SuppliersPage /></HrmsRouteGuard>} />
          <Route path="/purchase/suppliers/add" element={<HrmsRouteGuard><SuppliersPage defaultAdd={true} /></HrmsRouteGuard>} />
          <Route path="/purchase/suppliers/addedit" element={<HrmsRouteGuard><SuppliersPage defaultAdd={true} /></HrmsRouteGuard>} />
          <Route path="/purchase/suppliers/addedit/:id" element={<HrmsRouteGuard><SuppliersPage defaultAdd={true} /></HrmsRouteGuard>} />
          <Route path="/Purchase/suppliers" element={<Navigate to="/purchase/suppliers" replace />} />
          <Route path="/suppliers" element={<Navigate to="/purchase/suppliers" replace />} />
          <Route path="/supplier/list" element={<Navigate to="/purchase/suppliers" replace />} />
          <Route path="/supplier" element={<Navigate to="/purchase/suppliers" replace />} />
          <Route path="/suppliers/add" element={<Navigate to="/purchase/suppliers/add" replace />} />
          <Route path="/suppliers/addedit" element={<Navigate to="/purchase/suppliers/addedit" replace />} />

          <Route path="/inquiries" element={<Navigate to="/proforma-invoice/list" replace />} />
          <Route path="/proforma-invoice/list" element={<HrmsRouteGuard anyPermissions={["proforma.view", "proforma.pending.view", "proforma.admin_approved.view", "proforma.confirmed.view", "proforma.cancelled.view", "proforma.manage"]}><ProformaInvoicesPage /></HrmsRouteGuard>} />
          <Route path="/proforma-invoice/add" element={<HrmsRouteGuard anyPermissions={["proforma.create", "proforma.manage"]}><ProformaInvoicesPage defaultAdd={true} /></HrmsRouteGuard>} />
          <Route path="/proforma-invoice/addedit" element={<HrmsRouteGuard anyPermissions={["proforma.create", "proforma.manage"]}><ProformaInvoicesPage defaultAdd={true} /></HrmsRouteGuard>} />
          <Route path="/proforma-invoice/addedit/:id" element={<HrmsRouteGuard anyPermissions={["proforma.update", "proforma.manage"]}><ProformaInvoicesPage defaultAdd={true} /></HrmsRouteGuard>} />
          <Route path="/proforma-invoice/download-proforma-invoice/:id" element={<HrmsRouteGuard anyPermissions={["proforma.download", "proforma.manage"]}><ProformaInvoicePdfPage /></HrmsRouteGuard>} />
          <Route path="/proforma-invoice/download-proforma-invoice" element={<HrmsRouteGuard anyPermissions={["proforma.download", "proforma.manage"]}><ProformaInvoicePdfPage /></HrmsRouteGuard>} />
          <Route path="/proforma-invoice/pdf/:id" element={<HrmsRouteGuard anyPermissions={["proforma.download", "proforma.manage"]}><ProformaInvoicePdfPage /></HrmsRouteGuard>} />
          <Route path="/proforma-invoice/pdf" element={<HrmsRouteGuard anyPermissions={["proforma.download", "proforma.manage"]}><ProformaInvoicePdfPage /></HrmsRouteGuard>} />
          <Route path="/proforma-invoice" element={<Navigate to="/proforma-invoice/list" replace />} />
          <Route path="/sales/process" element={<HrmsRouteGuard anyPermissions={["saleorder.view", "saleorder.pending.view", "saleorder.sales_confirmed.view", "saleorder.admin_approved.view", "saleorder.acc_confirmed.view", "saleorder.gatepass_created.view", "saleorder.dispatched.view", "saleorder.gatepass_cancelled.view", "saleorder.lr.view", "saleorder.cancelled.view", "saleorder.approve", "saleorder.accounts", "saleorder.warehouse", "saleorder.manage"]}><SaleProcessListPage /></HrmsRouteGuard>} />
          <Route path="/sales/process/add" element={<HrmsRouteGuard anyPermissions={["saleorder.create", "saleorder.duplicate", "saleorder.manage", "technician_operations.gatepass.create_so", "technician_operations.manage"]}><SaleProcessFormPage /></HrmsRouteGuard>} />
          <Route path="/sales/process/edit/:id" element={<HrmsRouteGuard anyPermissions={["saleorder.update", "saleorder.manage"]}><SaleProcessFormPage /></HrmsRouteGuard>} />
          <Route path="/sale-process/list" element={<Navigate to="/sales/process" replace />} />
          <Route path="/sales-process/list" element={<Navigate to="/sales/process" replace />} />
          <Route path="/sale-order/list" element={<HrmsRouteGuard anyPermissions={["saleorder.view", "saleorder.pending.view", "saleorder.sales_confirmed.view", "saleorder.admin_approved.view", "saleorder.acc_confirmed.view", "saleorder.gatepass_created.view", "saleorder.dispatched.view", "saleorder.gatepass_cancelled.view", "saleorder.lr.view", "saleorder.cancelled.view", "saleorder.approve", "saleorder.accounts", "saleorder.warehouse", "saleorder.manage"]}><SaleProcessListPage /></HrmsRouteGuard>} />
          <Route path="/sale-order/add" element={<HrmsRouteGuard anyPermissions={["saleorder.create", "saleorder.duplicate", "saleorder.manage", "technician_operations.gatepass.create_so", "technician_operations.manage"]}><SaleProcessFormPage /></HrmsRouteGuard>} />
          <Route path="/sale-order/addedit" element={<HrmsRouteGuard anyPermissions={["saleorder.create", "saleorder.duplicate", "saleorder.manage", "technician_operations.gatepass.create_so", "technician_operations.manage"]}><SaleProcessFormPage /></HrmsRouteGuard>} />
          <Route path="/sale-order/addedit/:id" element={<HrmsRouteGuard anyPermissions={["saleorder.update", "saleorder.manage"]}><SaleProcessFormPage /></HrmsRouteGuard>} />
          <Route path="/sale-order/invoice/:id" element={<HrmsRouteGuard anyPermissions={["saleorder.download", "saleorder.details.view", "saleorder.manage"]}><SalesOrderPdfPage /></HrmsRouteGuard>} />
          <Route path="/sale-order/invoice" element={<HrmsRouteGuard anyPermissions={["saleorder.download", "saleorder.details.view", "saleorder.manage"]}><SalesOrderPdfPage /></HrmsRouteGuard>} />
          <Route path="/sale-order/download-sale-order/:id" element={<HrmsRouteGuard anyPermissions={["saleorder.download", "saleorder.details.view", "saleorder.manage"]}><SalesOrderPdfPage /></HrmsRouteGuard>} />
          <Route path="/sale-order/download-sale-order" element={<HrmsRouteGuard anyPermissions={["saleorder.download", "saleorder.details.view", "saleorder.manage"]}><SalesOrderPdfPage /></HrmsRouteGuard>} />
          <Route path="/sale-order/pdf/:id" element={<HrmsRouteGuard anyPermissions={["saleorder.download", "saleorder.details.view", "saleorder.manage"]}><SalesOrderPdfPage /></HrmsRouteGuard>} />
          <Route path="/sale-order/pdf" element={<HrmsRouteGuard anyPermissions={["saleorder.download", "saleorder.details.view", "saleorder.manage"]}><SalesOrderPdfPage /></HrmsRouteGuard>} />
          <Route path="/sales/process/pdf/:id" element={<HrmsRouteGuard anyPermissions={["saleorder.download", "saleorder.details.view", "saleorder.manage"]}><SalesOrderPdfPage /></HrmsRouteGuard>} />
          <Route path="/sales/process/pdf" element={<HrmsRouteGuard anyPermissions={["saleorder.download", "saleorder.details.view", "saleorder.manage"]}><SalesOrderPdfPage /></HrmsRouteGuard>} />
          <Route path="/sale-order/gatepass-pdf/:id" element={<HrmsRouteGuard anyPermissions={["saleorder.download", "saleorder.manage"]}><GatePassPdfPage /></HrmsRouteGuard>} />
          <Route path="/sale-order/gatepass-pdf" element={<HrmsRouteGuard anyPermissions={["saleorder.download", "saleorder.manage"]}><GatePassPdfPage /></HrmsRouteGuard>} />
          <Route path="/sales/gatepass-pdf/:id" element={<HrmsRouteGuard anyPermissions={["saleorder.download", "saleorder.manage"]}><GatePassPdfPage /></HrmsRouteGuard>} />
          <Route path="/sales/gatepass-pdf" element={<HrmsRouteGuard anyPermissions={["saleorder.download", "saleorder.manage"]}><GatePassPdfPage /></HrmsRouteGuard>} />
          <Route path="/sale-order" element={<Navigate to="/sale-order/list" replace />} />
          <Route path="/discount-payments/list" element={<HrmsRouteGuard anyPermissions={["saleorder.view", "saleorder.create", "saleorder.update", "saleorder.accounts", "saleorder.approve", "saleorder.delete", "crm.leads.view", "crm.leads.manage", "report.view"]}><DiscountPaymentsPage /></HrmsRouteGuard>} />
          <Route path="/discount-payments" element={<Navigate to="/discount-payments/list" replace />} />
          <Route path="/sale-discount/list" element={<HrmsRouteGuard anyPermissions={["saleorder.view", "saleorder.create", "saleorder.update", "saleorder.accounts", "saleorder.approve", "saleorder.delete", "crm.leads.view", "crm.leads.manage", "report.view"]}><DiscountPaymentsPage /></HrmsRouteGuard>} />
          <Route path="/sale-discount" element={<Navigate to="/sale-discount/list" replace />} />

          {/* LOCAL PURCHASE routes under /purchase/localpurchase */}
          <Route path="/purchase/localpurchase" element={<HrmsRouteGuard><LocalPurchasePage /></HrmsRouteGuard>} />
          <Route path="/purchase/localpurchase/add" element={<HrmsRouteGuard><LocalPurchasePage defaultAdd={true} /></HrmsRouteGuard>} />
          <Route path="/purchase/localpurchase/addedit" element={<HrmsRouteGuard><LocalPurchasePage defaultAdd={true} /></HrmsRouteGuard>} />
          <Route path="/purchase/localpurchase/addedit/:id" element={<HrmsRouteGuard><LocalPurchasePage defaultAdd={true} /></HrmsRouteGuard>} />
          <Route path="/Purchase/localpurchase" element={<Navigate to="/purchase/localpurchase" replace />} />
          <Route path="/purchase/local-purchase" element={<Navigate to="/purchase/localpurchase" replace />} />
          <Route path="/purchase/local-purchase/add" element={<HrmsRouteGuard><LocalPurchasePage defaultAdd={true} /></HrmsRouteGuard>} />
          <Route path="/purchase/local-purchase/addedit" element={<HrmsRouteGuard><LocalPurchasePage defaultAdd={true} /></HrmsRouteGuard>} />
          <Route path="/purchase/local-purchase/addedit/:id" element={<HrmsRouteGuard><LocalPurchasePage defaultAdd={true} /></HrmsRouteGuard>} />
          <Route path="/purchase-order/list" element={<Navigate to="/purchase/localpurchase" replace />} />
          <Route path="/purchase-order/add" element={<HrmsRouteGuard><LocalPurchasePage defaultAdd={true} /></HrmsRouteGuard>} />
          <Route path="/purchase-order/addedit" element={<HrmsRouteGuard><LocalPurchasePage defaultAdd={true} /></HrmsRouteGuard>} />
          <Route path="/purchase-order/addedit/:id" element={<HrmsRouteGuard><LocalPurchasePage defaultAdd={true} /></HrmsRouteGuard>} />
          <Route path="/purchase-order/bill-file/:id" element={<HrmsRouteGuard><LocalPurchasePdfPage /></HrmsRouteGuard>} />
          <Route path="/purchase-order/bill-file" element={<HrmsRouteGuard><LocalPurchasePdfPage /></HrmsRouteGuard>} />
          <Route path="/purchase-order/pdf/:id" element={<HrmsRouteGuard><LocalPurchasePdfPage /></HrmsRouteGuard>} />
          <Route path="/purchase-order/pdf" element={<HrmsRouteGuard><LocalPurchasePdfPage /></HrmsRouteGuard>} />
          <Route path="/purchase/localpurchase/bill-file/:id" element={<HrmsRouteGuard><LocalPurchasePdfPage /></HrmsRouteGuard>} />
          <Route path="/purchase/localpurchase/pdf/:id" element={<HrmsRouteGuard><LocalPurchasePdfPage /></HrmsRouteGuard>} />
          <Route path="/purchase/bill-file/:id" element={<HrmsRouteGuard><LocalPurchasePdfPage /></HrmsRouteGuard>} />
          <Route path="/purchase-order" element={<Navigate to="/purchase/localpurchase" replace />} />
          <Route path="/purchase/local" element={<Navigate to="/purchase/localpurchase" replace />} />
          <Route path="/purchase/local/list" element={<Navigate to="/purchase/localpurchase" replace />} />
          <Route path="/purchase/local/add" element={<Navigate to="/purchase/localpurchase/addedit" replace />} />
          <Route path="/purchase/local/addedit" element={<Navigate to="/purchase/localpurchase/addedit" replace />} />

          {/* IMPORT PURCHASE routes under /purchase/importpurchase */}
          <Route path="/purchase/importpurchase" element={<HrmsRouteGuard><ImportPurchasePage /></HrmsRouteGuard>} />
          <Route path="/purchase/importpurchase/add" element={<HrmsRouteGuard><ImportPurchasePage defaultAdd={true} /></HrmsRouteGuard>} />
          <Route path="/purchase/importpurchase/addedit" element={<HrmsRouteGuard><ImportPurchasePage defaultAdd={true} /></HrmsRouteGuard>} />
          <Route path="/purchase/importpurchase/addedit/:id" element={<HrmsRouteGuard><ImportPurchasePage defaultAdd={true} /></HrmsRouteGuard>} />
          <Route path="/Purchase/importpurchase" element={<Navigate to="/purchase/importpurchase" replace />} />
          <Route path="/purchase/import-purchase" element={<Navigate to="/purchase/importpurchase" replace />} />
          <Route path="/purchase/import-purchase/add" element={<HrmsRouteGuard><ImportPurchasePage defaultAdd={true} /></HrmsRouteGuard>} />
          <Route path="/purchase/import-purchase/addedit" element={<HrmsRouteGuard><ImportPurchasePage defaultAdd={true} /></HrmsRouteGuard>} />
          <Route path="/purchase/import-purchase/addedit/:id" element={<HrmsRouteGuard><ImportPurchasePage defaultAdd={true} /></HrmsRouteGuard>} />
          <Route path="/purchase-order/import-purchase-list" element={<Navigate to="/purchase/importpurchase" replace />} />
          <Route path="/purchase/import" element={<Navigate to="/purchase/importpurchase" replace />} />
          <Route path="/purchase/import/list" element={<Navigate to="/purchase/importpurchase" replace />} />
          <Route path="/purchase-order/import" element={<Navigate to="/purchase/importpurchase" replace />} />
          <Route path="/purchase-order/import/list" element={<Navigate to="/purchase/importpurchase" replace />} />
          <Route path="/purchase-order/import-purchase/addedit" element={<HrmsRouteGuard><ImportPurchasePage defaultAdd={true} /></HrmsRouteGuard>} />
          <Route path="/purchase-order/import-purchase/addedit/:id" element={<HrmsRouteGuard><ImportPurchasePage defaultAdd={true} /></HrmsRouteGuard>} />
          <Route path="/purchase-order/import-purchase/add" element={<HrmsRouteGuard><ImportPurchasePage defaultAdd={true} /></HrmsRouteGuard>} />
          <Route path="/purchase/import/add" element={<Navigate to="/purchase/importpurchase/addedit" replace />} />
          <Route path="/purchase-order/import-bill-file/:id" element={<HrmsRouteGuard><ImportPurchasePdfPage /></HrmsRouteGuard>} />
          <Route path="/purchase-order/import-bill-file" element={<HrmsRouteGuard><ImportPurchasePdfPage /></HrmsRouteGuard>} />
          <Route path="/purchase/importpurchase/bill-file/:id" element={<HrmsRouteGuard><ImportPurchasePdfPage /></HrmsRouteGuard>} />
          <Route path="/purchase/importpurchase/pdf/:id" element={<HrmsRouteGuard><ImportPurchasePdfPage /></HrmsRouteGuard>} />
          <Route path="/purchase/import/bill-file/:id" element={<HrmsRouteGuard><ImportPurchasePdfPage /></HrmsRouteGuard>} />

          {/* REPORTS routes */}
          <Route path="/reports/re-order" element={<HrmsRouteGuard><ProductReorderPage /></HrmsRouteGuard>} />
          <Route path="/product-reorder/list" element={<HrmsRouteGuard><ProductReorderPage /></HrmsRouteGuard>} />
          <Route path="/product-reorder" element={<Navigate to="/reports/re-order" replace />} />
          <Route path="/re-order" element={<Navigate to="/reports/re-order" replace />} />

          <Route path="/reports/stock-transactions" element={<HrmsRouteGuard><ProductStockPage /></HrmsRouteGuard>} />
          <Route path="/transaction_report/list" element={<HrmsRouteGuard><ProductStockPage /></HrmsRouteGuard>} />
          <Route path="/transaction-report/list" element={<HrmsRouteGuard><ProductStockPage /></HrmsRouteGuard>} />
          <Route path="/stock-transactions" element={<Navigate to="/reports/stock-transactions" replace />} />
          <Route path="/stock-transaction/list/:id" element={<HrmsRouteGuard><StockTransactionDetailPage /></HrmsRouteGuard>} />
          <Route path="/stock_transaction/list/:id" element={<HrmsRouteGuard><StockTransactionDetailPage /></HrmsRouteGuard>} />
          <Route path="/reports/stock-transactions/:id" element={<HrmsRouteGuard><StockTransactionDetailPage /></HrmsRouteGuard>} />

          <Route path="/reports/goods-expected" element={<Navigate to="/reports/stock-transactions" replace />} />
          <Route path="/inventory/goods-expected" element={<Navigate to="/reports/stock-transactions" replace />} />
          <Route path="/goods-expected" element={<Navigate to="/reports/stock-transactions" replace />} />

          <Route path="/reports/deleted-orders" element={<HrmsRouteGuard anyPermissions={["report.view", "trash.view", "saleorder.view", "saleorder.approve", "saleorder.delete"]}><DeletedOrdersPage /></HrmsRouteGuard>} />
          <Route path="/delete_order_report/list" element={<HrmsRouteGuard anyPermissions={["report.view", "trash.view", "saleorder.view", "saleorder.approve", "saleorder.delete"]}><DeletedOrdersPage /></HrmsRouteGuard>} />
          <Route path="/delete-order-report/list" element={<Navigate to="/reports/deleted-orders" replace />} />
          <Route path="/deleted-orders" element={<Navigate to="/reports/deleted-orders" replace />} />

          <Route path="/reports/general" element={<HrmsRouteGuard><GeneralReportsPage /></HrmsRouteGuard>} />
          <Route path="/reports/financial-planning" element={<HrmsRouteGuard><FinancialPlanningReportPage /></HrmsRouteGuard>} />
          <Route path="/financial-planning-report" element={<Navigate to="/reports/financial-planning" replace />} />
          <Route path="/financial-planning-report/list" element={<Navigate to="/reports/financial-planning" replace />} />
          <Route path="/finance-planning-report/list" element={<Navigate to="/reports/financial-planning" replace />} />
          <Route path="/reports/cargo-overview" element={<HrmsRouteGuard><CargoOverviewPage /></HrmsRouteGuard>} />
          <Route path="/reports/cargo-overview/detail/:key" element={<HrmsRouteGuard><CargoOverviewPage /></HrmsRouteGuard>} />
          <Route path="/cargo-overview" element={<Navigate to="/reports/cargo-overview" replace />} />
          <Route path="/cargo-overview/detail/:key" element={<HrmsRouteGuard><CargoOverviewPage /></HrmsRouteGuard>} />

          <Route path="/planning" element={<Navigate to="/dashboard" replace />} />
          <Route path="/tasks/my" element={<Navigate to="/tasks?tab=my" replace />} />
          <Route path="/tasks" element={<HrmsRouteGuard><TasksPage /></HrmsRouteGuard>} />
          <Route path="/tasks/kanban" element={<Navigate to="/tasks?tab=kanban" replace />} />
          <Route path="/tasks/calendar" element={<Navigate to="/tasks?tab=calendar" replace />} />
          <Route path="/technical-task/list" element={<HrmsRouteGuard><TechnicalTasksPage /></HrmsRouteGuard>} />
          <Route path="/technical-task/detail/:id" element={<HrmsRouteGuard><TechnicalTaskDetailPage /></HrmsRouteGuard>} />
          <Route path="/technical-tasks/detail/:id" element={<HrmsRouteGuard><TechnicalTaskDetailPage /></HrmsRouteGuard>} />
          <Route path="/technical-tasks" element={<Navigate to="/technical-task/list" replace />} />
          <Route path="/technical-task/call-logs" element={<Navigate to="/reports/general?tab=call-logs" replace />} />
          <Route path="/payments" element={<HrmsRouteGuard anyPermissions={["payment.view", "payment.manage"]}><PaymentsPage /></HrmsRouteGuard>} />
          <Route path="/task-payments" element={<Navigate to="/payments" replace />} />
          <Route path="/technical-task/payments" element={<Navigate to="/payments" replace />} />
          <Route path="/masters/technical-task-types" element={<HrmsRouteGuard><TechnicalTaskTypesPage /></HrmsRouteGuard>} />
          <Route path="/technician-operations" element={<HrmsRouteGuard anyPermissions={["technician_operations.view", "technician_operations.gatepasses.view", "technician_operations.wallets.view", "technician_operations.warranty.view", "technician_operations.manage"]}><TechnicianOperationsPage /></HrmsRouteGuard>} />
          <Route path="/technicians/gatepass" element={<Navigate to="/technician-operations?tab=gatepasses" replace />} />
          <Route path="/technicians/wallet" element={<Navigate to="/technician-operations?tab=wallets" replace />} />
          <Route path="/technician-gatepass/list" element={<Navigate to="/technician-operations?tab=gatepasses" replace />} />
          <Route path="/technician-wallet/list" element={<Navigate to="/technician-operations?tab=wallets" replace />} />
          <Route path="/machine-warranty/list" element={<Navigate to="/technician-operations?tab=warranty" replace />} />
          <Route path="/warranty" element={<Navigate to="/technician-operations?tab=warranty" replace />} />
          <Route path="/marketing-task/list" element={<Navigate to="/tasks" replace />} />
          <Route path="/marketing-tasks" element={<Navigate to="/tasks" replace />} />

          {/* CRM routes */}
          <Route path="/crm/leads" element={<HrmsRouteGuard permission="crm.leads.view"><CrmLeadsPage /></HrmsRouteGuard>} />
          <Route path="/crm/lead-database" element={<Navigate to="/crm/leads" replace />} />
          <Route path="/crm/pipelines" element={<HrmsRouteGuard permission="crm.pipelines.manage"><PipelineSetupPage /></HrmsRouteGuard>} />
          <Route path="/crm/pipeline" element={<Navigate to="/crm/pipelines" replace />} />
          <Route path="/crm/distribution" element={<HrmsRouteGuard permission="crm.distribution.view"><SalespersonDistributionPage /></HrmsRouteGuard>} />
          <Route path="/crm/salespeople" element={<Navigate to="/crm/distribution" replace />} />
          <Route path="/crm/import" element={<Navigate to="/crm/leads?import=open" replace />} />
          <Route path="/crm/reports" element={<Navigate to="/crm/leads" replace />} />
          <Route path="/crm/analytics" element={<Navigate to="/crm/leads" replace />} />
          <Route path="/crm" element={<Navigate to="/crm/leads" replace />} />

          {/* HRMS routes */}
          <Route path="/hrms" element={<HrmsRouteGuard permission="hrms.attendance"><AttendancePage /></HrmsRouteGuard>} />
          <Route path="/hrms/attendance" element={<HrmsRouteGuard permission="hrms.attendance"><AttendancePage /></HrmsRouteGuard>} />
          <Route path="/hrms/regularization" element={<Navigate to="/hrms/attendance" replace />} />
          <Route path="/hrms/leave" element={<HrmsRouteGuard permission="hrms.leave"><LeavePage /></HrmsRouteGuard>} />
          <Route path="/hrms/assets" element={<HrmsRouteGuard permission="hrms.assets"><AssetPage /></HrmsRouteGuard>} />
          <Route path="/hrms/expenses" element={<HrmsRouteGuard permission="hrms.expenses"><ExpensesPage /></HrmsRouteGuard>} />
          <Route path="/hrms/site-visit" element={<HrmsRouteGuard permission="hrms.site_visits"><SiteVisitPage /></HrmsRouteGuard>} />
          <Route path="/hrms/site-visits" element={<Navigate to="/hrms/site-visit" replace />} />
          <Route path="/hrms/payroll" element={<HrmsRouteGuard permission="hrms.payroll"><PayrollPage /></HrmsRouteGuard>} />
          <Route path="/hrms/setup" element={<HrmsRouteGuard permission="hrms.setup"><SetupPage /></HrmsRouteGuard>} />

          <Route path="/masters/company-list" element={<HrmsRouteGuard><CompanyListPage /></HrmsRouteGuard>} />
          <Route path="/masters/countries" element={<HrmsRouteGuard><CountriesPage /></HrmsRouteGuard>} />
          <Route path="/masters/states" element={<HrmsRouteGuard><StatesPage /></HrmsRouteGuard>} />
          <Route path="/masters/districts" element={<HrmsRouteGuard><DistrictsPage /></HrmsRouteGuard>} />
          <Route path="/masters/cities" element={<HrmsRouteGuard><CitiesPage /></HrmsRouteGuard>} />
          <Route path="/masters/currencies" element={<HrmsRouteGuard><CurrenciesPage /></HrmsRouteGuard>} />
          <Route path="/masters/uom" element={<HrmsRouteGuard><UomPage /></HrmsRouteGuard>} />
          <Route path="/masters/brands" element={<HrmsRouteGuard anyPermissions={["brand.view", "brand.manage"]}><BrandsPage /></HrmsRouteGuard>} />
          <Route path="/masters/supplier-types" element={<HrmsRouteGuard><SupplierTypesPage /></HrmsRouteGuard>} />
          <Route path="/masters/buyer-types" element={<HrmsRouteGuard><BuyerTypesPage /></HrmsRouteGuard>} />
          <Route path="/masters/categories" element={<HrmsRouteGuard anyPermissions={["category.view", "category.manage"]}><CategoriesPage /></HrmsRouteGuard>} />
          <Route path="/masters/subcategories" element={<HrmsRouteGuard anyPermissions={["subcategory.view", "subcategory.manage"]}><SubCategoriesPage /></HrmsRouteGuard>} />
          <Route path="/masters/products" element={<HrmsRouteGuard anyPermissions={["product.view", "product.manage"]}><ProductsPage /></HrmsRouteGuard>} />
          <Route path="/masters/price-list" element={<HrmsRouteGuard anyPermissions={["product.view", "product.manage"]}><PriceListPage /></HrmsRouteGuard>} />
          <Route path="/price-list" element={<Navigate to="/masters/price-list" replace />} />
          <Route path="/product-prices" element={<Navigate to="/masters/price-list" replace />} />
          <Route path="/inventory/price-list" element={<Navigate to="/masters/price-list" replace />} />
          <Route path="/inventory/product-prices" element={<Navigate to="/masters/price-list" replace />} />
          <Route path="/product/list" element={<HrmsRouteGuard anyPermissions={["product.view", "product.manage"]}><ProductsPage /></HrmsRouteGuard>} />
          <Route path="/product" element={<Navigate to="/product/list" replace />} />
          <Route path="/product/addEdit" element={<HrmsRouteGuard anyPermissions={["product.view", "product.create", "product.update", "product.manage"]}><ProductsPage defaultAdd={true} /></HrmsRouteGuard>} />
          <Route path="/product/addedit" element={<HrmsRouteGuard anyPermissions={["product.view", "product.create", "product.update", "product.manage"]}><ProductsPage defaultAdd={true} /></HrmsRouteGuard>} />
          <Route path="/product/add" element={<HrmsRouteGuard anyPermissions={["product.view", "product.create", "product.manage"]}><ProductsPage defaultAdd={true} /></HrmsRouteGuard>} />
          <Route path="/product/create" element={<HrmsRouteGuard anyPermissions={["product.view", "product.create", "product.manage"]}><ProductsPage defaultAdd={true} /></HrmsRouteGuard>} />
          <Route path="/product-stock/list" element={<HrmsRouteGuard anyPermissions={["product_stock.view", "product_stock.manage"]}><ProductStockPage /></HrmsRouteGuard>} />
          <Route path="/product-stock" element={<Navigate to="/product-stock/list" replace />} />
          <Route path="/product_stock/list" element={<Navigate to="/product-stock/list" replace />} />
          <Route path="/product_stock" element={<Navigate to="/product-stock/list" replace />} />
          <Route path="/product-reorder/list" element={<HrmsRouteGuard><ProductReorderPage /></HrmsRouteGuard>} />
          <Route path="/product-reorder" element={<Navigate to="/product-reorder/list" replace />} />
          <Route path="/product_reorder/list" element={<Navigate to="/product-reorder/list" replace />} />
          <Route path="/product_reorder" element={<Navigate to="/product-reorder/list" replace />} />
          <Route path="/stock-adjustment" element={<HrmsRouteGuard anyPermissions={["stock_adjustment.view", "stock_adjustment.manage"]}><StockAdjustmentPage /></HrmsRouteGuard>} />
          <Route path="/stock-adjustment/add" element={<HrmsRouteGuard anyPermissions={["stock_adjustment.create", "stock_adjustment.manage"]}><AddAdjustmentOrderPage /></HrmsRouteGuard>} />
          <Route path="/adjustment/list" element={<HrmsRouteGuard anyPermissions={["stock_adjustment.view", "stock_adjustment.manage"]}><StockAdjustmentPage /></HrmsRouteGuard>} />
          <Route path="/adjustment/addEdit" element={<HrmsRouteGuard anyPermissions={["stock_adjustment.create", "stock_adjustment.manage"]}><AddAdjustmentOrderPage /></HrmsRouteGuard>} />
          <Route path="/adjustment/addedit" element={<HrmsRouteGuard anyPermissions={["stock_adjustment.create", "stock_adjustment.manage"]}><AddAdjustmentOrderPage /></HrmsRouteGuard>} />
          <Route path="/adjustment/add" element={<HrmsRouteGuard anyPermissions={["stock_adjustment.create", "stock_adjustment.manage"]}><AddAdjustmentOrderPage /></HrmsRouteGuard>} />
          <Route path="/adjustment" element={<Navigate to="/adjustment/list" replace />} />
          <Route path="/adjustment/adjustment-order-pdf/:id" element={<HrmsRouteGuard anyPermissions={["stock_adjustment.download", "stock_adjustment.manage"]}><AdjustmentOrderPdfPage /></HrmsRouteGuard>} />
          <Route path="/stock-transfer" element={<HrmsRouteGuard anyPermissions={["stock_transfer.view", "stock_transfer.pending.view", "stock_transfer.confirmed.view", "stock_transfer.received.view", "stock_transfer.cancel.view", "stock_transfer.manage"]}><StockTransferPage /></HrmsRouteGuard>} />
          <Route path="/stock-transfer/list" element={<HrmsRouteGuard anyPermissions={["stock_transfer.view", "stock_transfer.pending.view", "stock_transfer.confirmed.view", "stock_transfer.received.view", "stock_transfer.cancel.view", "stock_transfer.manage"]}><StockTransferPage /></HrmsRouteGuard>} />
          <Route path="/transfer/list" element={<HrmsRouteGuard anyPermissions={["stock_transfer.view", "stock_transfer.pending.view", "stock_transfer.confirmed.view", "stock_transfer.received.view", "stock_transfer.cancel.view", "stock_transfer.manage"]}><StockTransferPage /></HrmsRouteGuard>} />
          <Route path="/transfer/addEdit" element={<HrmsRouteGuard anyPermissions={["stock_transfer.create", "stock_transfer.manage"]}><AddTransferOrderPage /></HrmsRouteGuard>} />
          <Route path="/transfer/addedit" element={<HrmsRouteGuard anyPermissions={["stock_transfer.create", "stock_transfer.manage"]}><AddTransferOrderPage /></HrmsRouteGuard>} />
          <Route path="/transfer/add" element={<HrmsRouteGuard anyPermissions={["stock_transfer.create", "stock_transfer.manage"]}><AddTransferOrderPage /></HrmsRouteGuard>} />
          <Route path="/stock-transfer/add" element={<HrmsRouteGuard anyPermissions={["stock_transfer.create", "stock_transfer.manage"]}><AddTransferOrderPage /></HrmsRouteGuard>} />
          <Route path="/stock-transfer/addEdit" element={<HrmsRouteGuard anyPermissions={["stock_transfer.create", "stock_transfer.manage"]}><AddTransferOrderPage /></HrmsRouteGuard>} />
          <Route path="/transfer/transfer-order-pdf/:id" element={<HrmsRouteGuard anyPermissions={["stock_transfer.download", "stock_transfer.manage"]}><TransferOrderPdfPage /></HrmsRouteGuard>} />
          <Route path="/transfer/transfer-order-pdf" element={<HrmsRouteGuard anyPermissions={["stock_transfer.download", "stock_transfer.manage"]}><TransferOrderPdfPage /></HrmsRouteGuard>} />
          <Route path="/transfer/transfer_order_pdf/:id" element={<HrmsRouteGuard anyPermissions={["stock_transfer.download", "stock_transfer.manage"]}><TransferOrderPdfPage /></HrmsRouteGuard>} />
          <Route path="/transfer/transfer_order_pdf" element={<HrmsRouteGuard anyPermissions={["stock_transfer.download", "stock_transfer.manage"]}><TransferOrderPdfPage /></HrmsRouteGuard>} />
          <Route path="/transfer/transfer-order_pdf/:id" element={<HrmsRouteGuard anyPermissions={["stock_transfer.download", "stock_transfer.manage"]}><TransferOrderPdfPage /></HrmsRouteGuard>} />
          <Route path="/transfer/transfer-order_pdf" element={<HrmsRouteGuard anyPermissions={["stock_transfer.download", "stock_transfer.manage"]}><TransferOrderPdfPage /></HrmsRouteGuard>} />
          <Route path="/stock-transfer/transfer-order-pdf/:id" element={<HrmsRouteGuard anyPermissions={["stock_transfer.download", "stock_transfer.manage"]}><TransferOrderPdfPage /></HrmsRouteGuard>} />
          <Route path="/stock-transfer/transfer-order-pdf" element={<HrmsRouteGuard anyPermissions={["stock_transfer.download", "stock_transfer.manage"]}><TransferOrderPdfPage /></HrmsRouteGuard>} />
          <Route path="/transfer" element={<Navigate to="/transfer/list" replace />} />
          <Route path="/product-gallery" element={<HrmsRouteGuard><ProductGalleryPage /></HrmsRouteGuard>} />
          <Route path="/product_gallery" element={<Navigate to="/product-gallery" replace />} />

          {/* Master modules from legacy ERP screenshot */}
          <Route path="/masters/taxes" element={<HrmsRouteGuard><TaxesPage /></HrmsRouteGuard>} />
          <Route path="/tax/list" element={<Navigate to="/masters/taxes" replace />} />
          <Route path="/masters/additional-charges" element={<HrmsRouteGuard><AdditionalChargesPage /></HrmsRouteGuard>} />
          <Route path="/additionalcharges/list" element={<Navigate to="/masters/additional-charges" replace />} />
          <Route path="/masters/social-media" element={<HrmsRouteGuard><SocialMediaPage /></HrmsRouteGuard>} />
          <Route path="/social/list" element={<Navigate to="/masters/social-media" replace />} />
          <Route path="/masters/agent-types" element={<HrmsRouteGuard><AgentTypesPage /></HrmsRouteGuard>} />
          <Route path="/agent/role/list" element={<Navigate to="/masters/agent-types" replace />} />
          <Route path="/masters/company-categories" element={<HrmsRouteGuard><CompanyCategoriesPage /></HrmsRouteGuard>} />
          <Route path="/company/category/list" element={<Navigate to="/masters/company-categories" replace />} />
          <Route path="/masters/company-sectors" element={<HrmsRouteGuard><CompanySectorsPage /></HrmsRouteGuard>} />
          <Route path="/company/sector/list" element={<Navigate to="/masters/company-sectors" replace />} />
          <Route path="/masters/warehouses" element={<HrmsRouteGuard><WarehousesPage /></HrmsRouteGuard>} />
          <Route path="/warehouse/list" element={<Navigate to="/masters/warehouses" replace />} />
          <Route path="/masters/billing-company" element={<HrmsRouteGuard><BillingCompaniesPage /></HrmsRouteGuard>} />
          <Route path="/company/list" element={<Navigate to="/masters/billing-company" replace />} />
          <Route path="/company/addedit" element={<Navigate to="/masters/billing-company" replace />} />
          <Route path="/masters/technicians" element={<Navigate to="/rbac" replace />} />
          <Route path="/technician/list" element={<Navigate to="/rbac" replace />} />
          <Route path="/masters/banks" element={<HrmsRouteGuard><BanksPage /></HrmsRouteGuard>} />
          <Route path="/masters/bank" element={<Navigate to="/masters/banks" replace />} />
          <Route path="/bank/list" element={<Navigate to="/masters/banks" replace />} />
          <Route path="/masters/transport" element={<HrmsRouteGuard><TransportPage /></HrmsRouteGuard>} />
          <Route path="/masters/transports" element={<Navigate to="/masters/transport" replace />} />
          <Route path="/transport/list" element={<Navigate to="/masters/transport" replace />} />
          <Route path="/masters/payment-terms" element={<HrmsRouteGuard><PaymentTermsPage /></HrmsRouteGuard>} />
          <Route path="/masters/payment_terms" element={<Navigate to="/masters/payment-terms" replace />} />
          <Route path="/payment-terms/list" element={<Navigate to="/masters/payment-terms" replace />} />
          <Route path="/paymentterms/list" element={<Navigate to="/masters/payment-terms" replace />} />
          <Route path="/masters/lead-sources" element={<HrmsRouteGuard permission="lead_source.view"><LeadSourcesPage /></HrmsRouteGuard>} />
          <Route path="/masters/lead_sources" element={<Navigate to="/masters/lead-sources" replace />} />
          <Route path="/lead-sources/list" element={<Navigate to="/masters/lead-sources" replace />} />
          <Route path="/leadsources/list" element={<Navigate to="/masters/lead-sources" replace />} />
          <Route path="/lead_sources/list" element={<Navigate to="/masters/lead-sources" replace />} />
          <Route path="/masters/adjustment-purpose" element={<HrmsRouteGuard><AdjustmentPurposesPage /></HrmsRouteGuard>} />
          <Route path="/masters/adjustment-purposes" element={<Navigate to="/masters/adjustment-purpose" replace />} />
          <Route path="/masters/adjustment_purpose" element={<Navigate to="/masters/adjustment-purpose" replace />} />
          <Route path="/masters/adjustment_purposes" element={<Navigate to="/masters/adjustment-purpose" replace />} />
          <Route path="/adjustment_purpose/list" element={<Navigate to="/masters/adjustment-purpose" replace />} />
          <Route path="/adjustment-purpose/list" element={<Navigate to="/masters/adjustment-purpose" replace />} />
          <Route path="/adjustmentpurpose/list" element={<Navigate to="/masters/adjustment-purpose" replace />} />
          <Route path="/masters/call-types" element={<HrmsRouteGuard><CallTypesPage /></HrmsRouteGuard>} />
          <Route path="/masters/call_types" element={<Navigate to="/masters/call-types" replace />} />
          <Route path="/masters/call-type" element={<Navigate to="/masters/call-types" replace />} />
          <Route path="/masters/call_type" element={<Navigate to="/masters/call-types" replace />} />
          <Route path="/call_type/list" element={<Navigate to="/masters/call-types" replace />} />
          <Route path="/call-type/list" element={<Navigate to="/masters/call-types" replace />} />
          <Route path="/calltype/list" element={<Navigate to="/masters/call-types" replace />} />
          <Route path="/call_types/list" element={<Navigate to="/masters/call-types" replace />} />
          {/* Follow Up Logs Module (erp.inhymasolutions.com/follow-up/list) */}
          <Route path="/follow-up/list" element={<HrmsRouteGuard permission="crm.leads.view"><FollowUpsPage /></HrmsRouteGuard>} />
          <Route path="/follow-ups" element={<Navigate to="/follow-up/list" replace />} />
          <Route path="/follow-up" element={<Navigate to="/follow-up/list" replace />} />
          <Route path="/followups" element={<Navigate to="/follow-up/list" replace />} />
          <Route path="/call-logs/follow-up" element={<Navigate to="/follow-up/list" replace />} />
          <Route path="/call-logs/follow-ups" element={<Navigate to="/follow-up/list" replace />} />

          {/* Leads Module (erp.inhymasolutions.com/lead/list) */}
          <Route path="/lead/list" element={<HrmsRouteGuard permission="crm.leads.view"><LeadsPage /></HrmsRouteGuard>} />
          <Route path="/leads" element={<Navigate to="/lead/list" replace />} />
          <Route path="/lead" element={<Navigate to="/lead/list" replace />} />
          <Route path="/leads/list" element={<Navigate to="/lead/list" replace />} />

          {Object.entries(LEGACY_REDIRECTS).map(([from, to]) => (
            <Route key={from} path={from} element={<Navigate to={to} replace />} />
          ))}

          <Route path="*" element={<Navigate to="/dashboard" replace />} />
        </Routes>
      </ErrorBoundary>
    </>
  );
}