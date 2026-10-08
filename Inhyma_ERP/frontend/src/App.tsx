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

import { useEffect } from "react";
import { Navigate, Route, Routes, useLocation, useNavigate } from "react-router-dom";
import { setUnauthorizedHandler } from "@/lib/api";
import { LEGACY_REDIRECTS } from "@/lib/nav";

import { auth } from "@/lib/auth";
import { LoginPage } from "@/pages/Login";
import { AuthCallbackPage } from "@/pages/AuthCallback";
import { DashboardPage } from "@/pages/Dashboard";
import { ForbiddenPage } from "@/pages/Forbidden";

function HrmsRouteGuard({ permission, children }: { permission: string; children: React.ReactNode }) {
  if (!auth.hasPermission(permission)) {
    return <ForbiddenPage />;
  }
  return <>{children}</>;
}
import { OrganizationPage } from "@/pages/Organization";
import { AuditPage } from "@/pages/Audit";
import { UsersPage } from "@/pages/Users";
import { ProfilePage } from "@/pages/Profile";
import { RbacPage } from "@/pages/Rbac";
import { EffectivePermissionsPage } from "@/pages/EffectivePermissions";
import { PositionsPage } from "@/pages/org/Positions";
import { CompaniesPage } from "@/pages/Companies";
import { LeadsPage } from "@/pages/LeadsPage";
import FollowUpsPage from "@/pages/FollowUpsPage";
import { SuppliersPage } from "@/pages/Suppliers";
import { ProformaInvoicesPage } from "@/pages/ProformaInvoicesPage";
import { ProformaInvoicePdfPage } from "@/pages/ProformaInvoicePdfPage";
import { SalesOrderPdfPage } from "@/pages/SalesOrderPdfPage";
import { SaleProcessListPage } from "@/pages/sales/SaleProcessList";
import { SaleProcessFormPage } from "@/pages/sales/SaleProcessForm";
import { DiscountPaymentsPage } from "@/pages/sales/DiscountPaymentsPage";
import { LocalPurchasePage } from "@/pages/purchase/LocalPurchasePage";
import { LocalPurchasePdfPage } from "@/pages/LocalPurchasePdfPage";
import { ImportPurchasePage } from "@/pages/purchase/ImportPurchasePage";
import { ImportPurchasePdfPage } from "@/pages/ImportPurchasePdfPage";
import { TasksPage } from "@/pages/tasks/TasksPage";
import { TechnicalTasksPage } from "@/pages/technicalTasks/TechnicalTasksPage";
import { TechnicianOperationsPage } from "@/pages/TechnicianOperationsPage";
import { AttendancePage } from "@/pages/hrms/AttendancePage";
import { LeavePage } from "@/pages/hrms/LeavePage";
import { ExpensesPage } from "@/pages/hrms/ExpensesPage";
import { SiteVisitPage } from "@/pages/hrms/SiteVisitPage";
import { PayrollPage } from "@/pages/hrms/PayrollPage";
import { SetupPage } from "@/pages/hrms/SetupPage";
import { AssetPage } from "@/pages/hrms/AssetPage";

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
import { TechniciansPage } from "@/pages/masters/Technicians";
import { BanksPage } from "@/pages/masters/Banks";
import { TransportPage } from "@/pages/masters/Transport";
import { PaymentTermsPage } from "@/pages/masters/PaymentTerms";
import { LeadSourcesPage } from "@/pages/masters/LeadSources";
import { AdjustmentPurposesPage } from "@/pages/masters/AdjustmentPurposes";
import { CallTypesPage } from "@/pages/masters/CallTypes";
import { NetworkStatusNotifier } from "@/components/NetworkStatusNotifier";
import { LiveConnectionIndicator } from "@/components/LiveConnectionIndicator";
import { ErrorBoundary } from "@/components/ErrorBoundary";
import { LiveConnectionLifecycle } from "@/lib/live/liveConnectionLifecycle";
import { ProductGalleryPage } from "@/pages/ProductGallery";
import { TrashPage } from "@/pages/Trash";
import PublicSupplierQuotePage from "@/pages/PublicSupplierQuotePage";
import { initGlobalPasteSanitizer } from "@/lib/pasteSanitizer";
import { initGlobalAutocompleteBlocker } from "@/lib/autocompleteBlocker";
import { ComingSoonPage } from "@/components/ComingSoon";
import { processIncomingSsoHandover } from "@/lib/ssoBridge";
import { ProductStockPage } from "@/pages/ProductStockPage";
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
  useEffect(() => {
    if (window.location.pathname.startsWith("/auth/callback")) {
      return;
    }
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
      <LiveConnectionIndicator />
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
          <Route path="/403" element={<ForbiddenPage />} />
          <Route path="/organization" element={<OrganizationPage />} />
          <Route path="/erp-settings" element={<OrganizationPage />} />
          <Route path="/audit" element={<AuditPage />} />
          <Route path="/trash" element={<TrashPage />} />
          <Route path="/profile" element={<ProfilePage />} />
          <Route path="/users" element={<UsersPage />} />
          <Route path="/rbac" element={<RbacPage />} />
          <Route path="/effective-permissions" element={<EffectivePermissionsPage />} />
          {/* Employee was merged into User -- /employees is now an alias for the same page. */}
          <Route path="/employees" element={<UsersPage />} />
          <Route path="/positions" element={<PositionsPage />} />
          <Route path="/companies" element={<CompaniesPage />} />
          <Route path="/companies/add" element={<CompaniesPage defaultAdd={true} />} />
          <Route path="/companies/addedit" element={<CompaniesPage defaultAdd={true} />} />
          <Route path="/companies/addedit/:id" element={<CompaniesPage defaultAdd={true} />} />
          <Route path="/user/addEdit" element={<CompaniesPage defaultAdd={true} />} />
          <Route path="/user/addedit" element={<CompaniesPage defaultAdd={true} />} />

          {/* AGENTS routes */}
          <Route path="/agents" element={<AgentsPage />} />
          <Route path="/agent/list" element={<Navigate to="/agents" replace />} />
          <Route path="/agents/list" element={<Navigate to="/agents" replace />} />

          {/* INDUSTRIAL ZONES routes */}
          <Route path="/industrial/zones/list" element={<IndustrialZonesPage />} />
          <Route path="/industrial-zones" element={<Navigate to="/industrial/zones/list" replace />} />
          <Route path="/industrial/zones" element={<Navigate to="/industrial/zones/list" replace />} />
          <Route path="/industrial-zone/list" element={<Navigate to="/industrial/zones/list" replace />} />

          {/* SUPPLIERS routes under /purchase/suppliers */}
          <Route path="/purchase/suppliers" element={<SuppliersPage />} />
          <Route path="/purchase/suppliers/add" element={<SuppliersPage defaultAdd={true} />} />
          <Route path="/purchase/suppliers/addedit" element={<SuppliersPage defaultAdd={true} />} />
          <Route path="/purchase/suppliers/addedit/:id" element={<SuppliersPage defaultAdd={true} />} />
          <Route path="/Purchase/suppliers" element={<Navigate to="/purchase/suppliers" replace />} />
          <Route path="/suppliers" element={<Navigate to="/purchase/suppliers" replace />} />
          <Route path="/supplier/list" element={<Navigate to="/purchase/suppliers" replace />} />
          <Route path="/supplier" element={<Navigate to="/purchase/suppliers" replace />} />
          <Route path="/suppliers/add" element={<Navigate to="/purchase/suppliers/add" replace />} />
          <Route path="/suppliers/addedit" element={<Navigate to="/purchase/suppliers/addedit" replace />} />

          <Route path="/inquiries" element={<Navigate to="/proforma-invoice/list" replace />} />
          <Route path="/proforma-invoice/list" element={<ProformaInvoicesPage />} />
          <Route path="/proforma-invoice/add" element={<ProformaInvoicesPage defaultAdd={true} />} />
          <Route path="/proforma-invoice/addedit" element={<ProformaInvoicesPage defaultAdd={true} />} />
          <Route path="/proforma-invoice/addedit/:id" element={<ProformaInvoicesPage defaultAdd={true} />} />
          <Route path="/proforma-invoice/download-proforma-invoice/:id" element={<ProformaInvoicePdfPage />} />
          <Route path="/proforma-invoice/download-proforma-invoice" element={<ProformaInvoicePdfPage />} />
          <Route path="/proforma-invoice/pdf/:id" element={<ProformaInvoicePdfPage />} />
          <Route path="/proforma-invoice/pdf" element={<ProformaInvoicePdfPage />} />
          <Route path="/proforma-invoice" element={<Navigate to="/proforma-invoice/list" replace />} />
          <Route path="/sales/process" element={<SaleProcessListPage />} />
          <Route path="/sales/process/add" element={<SaleProcessFormPage />} />
          <Route path="/sales/process/edit/:id" element={<SaleProcessFormPage />} />
          <Route path="/sale-process/list" element={<Navigate to="/sales/process" replace />} />
          <Route path="/sales-process/list" element={<Navigate to="/sales/process" replace />} />
          <Route path="/sale-order/list" element={<SaleProcessListPage />} />
          <Route path="/sale-order/add" element={<SaleProcessFormPage />} />
          <Route path="/sale-order/addedit" element={<SaleProcessFormPage />} />
          <Route path="/sale-order/addedit/:id" element={<SaleProcessFormPage />} />
          <Route path="/sale-order/invoice/:id" element={<SalesOrderPdfPage />} />
          <Route path="/sale-order/invoice" element={<SalesOrderPdfPage />} />
          <Route path="/sale-order/download-sale-order/:id" element={<SalesOrderPdfPage />} />
          <Route path="/sale-order/download-sale-order" element={<SalesOrderPdfPage />} />
          <Route path="/sale-order/pdf/:id" element={<SalesOrderPdfPage />} />
          <Route path="/sale-order/pdf" element={<SalesOrderPdfPage />} />
          <Route path="/sales/process/pdf/:id" element={<SalesOrderPdfPage />} />
          <Route path="/sales/process/pdf" element={<SalesOrderPdfPage />} />
          <Route path="/sale-order" element={<Navigate to="/sale-order/list" replace />} />
          <Route path="/discount-payments/list" element={<DiscountPaymentsPage />} />
          <Route path="/discount-payments" element={<Navigate to="/discount-payments/list" replace />} />
          <Route path="/sale-discount/list" element={<DiscountPaymentsPage />} />
          <Route path="/sale-discount" element={<Navigate to="/sale-discount/list" replace />} />

          {/* LOCAL PURCHASE routes under /purchase/localpurchase */}
          <Route path="/purchase/localpurchase" element={<LocalPurchasePage />} />
          <Route path="/purchase/localpurchase/add" element={<LocalPurchasePage defaultAdd={true} />} />
          <Route path="/purchase/localpurchase/addedit" element={<LocalPurchasePage defaultAdd={true} />} />
          <Route path="/purchase/localpurchase/addedit/:id" element={<LocalPurchasePage defaultAdd={true} />} />
          <Route path="/Purchase/localpurchase" element={<Navigate to="/purchase/localpurchase" replace />} />
          <Route path="/purchase/local-purchase" element={<Navigate to="/purchase/localpurchase" replace />} />
          <Route path="/purchase/local-purchase/add" element={<LocalPurchasePage defaultAdd={true} />} />
          <Route path="/purchase/local-purchase/addedit" element={<LocalPurchasePage defaultAdd={true} />} />
          <Route path="/purchase/local-purchase/addedit/:id" element={<LocalPurchasePage defaultAdd={true} />} />
          <Route path="/purchase-order/list" element={<Navigate to="/purchase/localpurchase" replace />} />
          <Route path="/purchase-order/add" element={<LocalPurchasePage defaultAdd={true} />} />
          <Route path="/purchase-order/addedit" element={<LocalPurchasePage defaultAdd={true} />} />
          <Route path="/purchase-order/addedit/:id" element={<LocalPurchasePage defaultAdd={true} />} />
          <Route path="/purchase-order/bill-file/:id" element={<LocalPurchasePdfPage />} />
          <Route path="/purchase-order/bill-file" element={<LocalPurchasePdfPage />} />
          <Route path="/purchase-order/pdf/:id" element={<LocalPurchasePdfPage />} />
          <Route path="/purchase-order/pdf" element={<LocalPurchasePdfPage />} />
          <Route path="/purchase/localpurchase/bill-file/:id" element={<LocalPurchasePdfPage />} />
          <Route path="/purchase/localpurchase/pdf/:id" element={<LocalPurchasePdfPage />} />
          <Route path="/purchase/bill-file/:id" element={<LocalPurchasePdfPage />} />
          <Route path="/purchase-order" element={<Navigate to="/purchase/localpurchase" replace />} />
          <Route path="/purchase/local" element={<Navigate to="/purchase/localpurchase" replace />} />
          <Route path="/purchase/local/list" element={<Navigate to="/purchase/localpurchase" replace />} />
          <Route path="/purchase/local/add" element={<Navigate to="/purchase/localpurchase/addedit" replace />} />
          <Route path="/purchase/local/addedit" element={<Navigate to="/purchase/localpurchase/addedit" replace />} />

          {/* IMPORT PURCHASE routes under /purchase/importpurchase */}
          <Route path="/purchase/importpurchase" element={<ImportPurchasePage />} />
          <Route path="/purchase/importpurchase/add" element={<ImportPurchasePage defaultAdd={true} />} />
          <Route path="/purchase/importpurchase/addedit" element={<ImportPurchasePage defaultAdd={true} />} />
          <Route path="/purchase/importpurchase/addedit/:id" element={<ImportPurchasePage defaultAdd={true} />} />
          <Route path="/Purchase/importpurchase" element={<Navigate to="/purchase/importpurchase" replace />} />
          <Route path="/purchase/import-purchase" element={<Navigate to="/purchase/importpurchase" replace />} />
          <Route path="/purchase/import-purchase/add" element={<ImportPurchasePage defaultAdd={true} />} />
          <Route path="/purchase/import-purchase/addedit" element={<ImportPurchasePage defaultAdd={true} />} />
          <Route path="/purchase/import-purchase/addedit/:id" element={<ImportPurchasePage defaultAdd={true} />} />
          <Route path="/purchase-order/import-purchase-list" element={<Navigate to="/purchase/importpurchase" replace />} />
          <Route path="/purchase/import" element={<Navigate to="/purchase/importpurchase" replace />} />
          <Route path="/purchase/import/list" element={<Navigate to="/purchase/importpurchase" replace />} />
          <Route path="/purchase-order/import" element={<Navigate to="/purchase/importpurchase" replace />} />
          <Route path="/purchase-order/import/list" element={<Navigate to="/purchase/importpurchase" replace />} />
          <Route path="/purchase-order/import-purchase/addedit" element={<ImportPurchasePage defaultAdd={true} />} />
          <Route path="/purchase-order/import-purchase/addedit/:id" element={<ImportPurchasePage defaultAdd={true} />} />
          <Route path="/purchase-order/import-purchase/add" element={<ImportPurchasePage defaultAdd={true} />} />
          <Route path="/purchase/import/add" element={<Navigate to="/purchase/importpurchase/addedit" replace />} />
          <Route path="/purchase-order/import-bill-file/:id" element={<ImportPurchasePdfPage />} />
          <Route path="/purchase-order/import-bill-file" element={<ImportPurchasePdfPage />} />
          <Route path="/purchase/importpurchase/bill-file/:id" element={<ImportPurchasePdfPage />} />
          <Route path="/purchase/importpurchase/pdf/:id" element={<ImportPurchasePdfPage />} />
          <Route path="/purchase/import/bill-file/:id" element={<ImportPurchasePdfPage />} />

          {/* REPORTS routes */}
          <Route path="/reports/re-order" element={<ProductReorderPage />} />
          <Route path="/product-reorder/list" element={<ProductReorderPage />} />
          <Route path="/product-reorder" element={<Navigate to="/reports/re-order" replace />} />
          <Route path="/re-order" element={<Navigate to="/reports/re-order" replace />} />

          <Route path="/reports/stock-transactions" element={<ProductStockPage />} />
          <Route path="/transaction_report/list" element={<ProductStockPage />} />
          <Route path="/transaction-report/list" element={<Navigate to="/reports/stock-transactions" replace />} />
          <Route path="/stock-transactions" element={<Navigate to="/reports/stock-transactions" replace />} />
          <Route path="/product-stock" element={<Navigate to="/reports/stock-transactions" replace />} />

          <Route path="/reports/deleted-orders" element={<DeletedOrdersPage />} />
          <Route path="/delete_order_report/list" element={<DeletedOrdersPage />} />
          <Route path="/delete-order-report/list" element={<Navigate to="/reports/deleted-orders" replace />} />
          <Route path="/deleted-orders" element={<Navigate to="/reports/deleted-orders" replace />} />

          <Route
            path="/reports/general"
            element={
              <ComingSoonPage
                activeKey="reports-general"
                title="General Reports"
                subtitle="Generate and download business summaries and consolidated reports"
                breadcrumbLabel="General Reports"
                featureName="General Reports"
              />
            }
          />

          <Route path="/planning" element={<Navigate to="/dashboard" replace />} />
          <Route path="/tasks/my" element={<Navigate to="/tasks?tab=my" replace />} />
          <Route path="/tasks" element={<TasksPage />} />
          <Route path="/tasks/kanban" element={<Navigate to="/tasks?tab=kanban" replace />} />
          <Route path="/tasks/calendar" element={<Navigate to="/tasks?tab=calendar" replace />} />
          <Route path="/technical-task/list" element={<TechnicalTasksPage />} />
          <Route path="/technical-tasks" element={<Navigate to="/technical-task/list" replace />} />
          <Route path="/technician-operations" element={<TechnicianOperationsPage />} />
          <Route path="/technicians/gatepass" element={<Navigate to="/technician-operations?tab=gatepasses" replace />} />
          <Route path="/technicians/wallet" element={<Navigate to="/technician-operations?tab=wallets" replace />} />
          <Route path="/technician-gatepass/list" element={<Navigate to="/technician-operations?tab=gatepasses" replace />} />
          <Route path="/technician-wallet/list" element={<Navigate to="/technician-operations?tab=wallets" replace />} />
          <Route path="/machine-warranty/list" element={<Navigate to="/technician-operations?tab=warranty" replace />} />
          <Route path="/warranty" element={<Navigate to="/technician-operations?tab=warranty" replace />} />
          <Route path="/marketing-task/list" element={<Navigate to="/tasks" replace />} />
          <Route path="/marketing-tasks" element={<Navigate to="/tasks" replace />} />

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

          <Route path="/masters/company-list" element={<CompanyListPage />} />
          <Route path="/masters/countries" element={<CountriesPage />} />
          <Route path="/masters/states" element={<StatesPage />} />
          <Route path="/masters/districts" element={<DistrictsPage />} />
          <Route path="/masters/cities" element={<CitiesPage />} />
          <Route path="/masters/currencies" element={<CurrenciesPage />} />
          <Route path="/masters/uom" element={<UomPage />} />
          <Route path="/masters/brands" element={<BrandsPage />} />
          <Route path="/masters/supplier-types" element={<SupplierTypesPage />} />
          <Route path="/masters/buyer-types" element={<BuyerTypesPage />} />
          <Route path="/masters/categories" element={<CategoriesPage />} />
          <Route path="/masters/subcategories" element={<SubCategoriesPage />} />
          <Route path="/masters/products" element={<ProductsPage />} />
          <Route path="/masters/price-list" element={<PriceListPage />} />
          <Route path="/price-list" element={<PriceListPage />} />
          <Route path="/product-prices" element={<PriceListPage />} />
          <Route path="/inventory/price-list" element={<PriceListPage />} />
          <Route path="/inventory/product-prices" element={<PriceListPage />} />
          <Route path="/product/list" element={<ProductsPage />} />
          <Route path="/product" element={<Navigate to="/product/list" replace />} />
          <Route path="/product/addEdit" element={<ProductsPage defaultAdd={true} />} />
          <Route path="/product/addedit" element={<ProductsPage defaultAdd={true} />} />
          <Route path="/product/add" element={<ProductsPage defaultAdd={true} />} />
          <Route path="/product/create" element={<ProductsPage defaultAdd={true} />} />
          <Route path="/product-stock/list" element={<ProductStockPage />} />
          <Route path="/product-stock" element={<Navigate to="/product-stock/list" replace />} />
          <Route path="/product_stock/list" element={<Navigate to="/product-stock/list" replace />} />
          <Route path="/product_stock" element={<Navigate to="/product-stock/list" replace />} />
          <Route path="/product-reorder/list" element={<ProductReorderPage />} />
          <Route path="/product-reorder" element={<Navigate to="/product-reorder/list" replace />} />
          <Route path="/product_reorder/list" element={<Navigate to="/product-reorder/list" replace />} />
          <Route path="/product_reorder" element={<Navigate to="/product-reorder/list" replace />} />
          <Route path="/stock-adjustment" element={<StockAdjustmentPage />} />
          <Route path="/stock-adjustment/add" element={<AddAdjustmentOrderPage />} />
          <Route path="/adjustment/list" element={<StockAdjustmentPage />} />
          <Route path="/adjustment/addEdit" element={<AddAdjustmentOrderPage />} />
          <Route path="/adjustment/addedit" element={<AddAdjustmentOrderPage />} />
          <Route path="/adjustment/add" element={<AddAdjustmentOrderPage />} />
          <Route path="/adjustment" element={<Navigate to="/adjustment/list" replace />} />
          <Route path="/adjustment/adjustment-order-pdf/:id" element={<AdjustmentOrderPdfPage />} />
          <Route path="/stock-transfer" element={<StockTransferPage />} />
          <Route path="/stock-transfer/list" element={<StockTransferPage />} />
          <Route path="/transfer/list" element={<StockTransferPage />} />
          <Route path="/transfer/addEdit" element={<AddTransferOrderPage />} />
          <Route path="/transfer/addedit" element={<AddTransferOrderPage />} />
          <Route path="/transfer/add" element={<AddTransferOrderPage />} />
          <Route path="/stock-transfer/add" element={<AddTransferOrderPage />} />
          <Route path="/stock-transfer/addEdit" element={<AddTransferOrderPage />} />
          <Route path="/transfer/transfer-order-pdf/:id" element={<TransferOrderPdfPage />} />
          <Route path="/transfer/transfer-order-pdf" element={<TransferOrderPdfPage />} />
          <Route path="/transfer/transfer_order_pdf/:id" element={<TransferOrderPdfPage />} />
          <Route path="/transfer/transfer_order_pdf" element={<TransferOrderPdfPage />} />
          <Route path="/transfer/transfer-order_pdf/:id" element={<TransferOrderPdfPage />} />
          <Route path="/transfer/transfer-order_pdf" element={<TransferOrderPdfPage />} />
          <Route path="/stock-transfer/transfer-order-pdf/:id" element={<TransferOrderPdfPage />} />
          <Route path="/stock-transfer/transfer-order-pdf" element={<TransferOrderPdfPage />} />
          <Route path="/transfer" element={<Navigate to="/transfer/list" replace />} />
          <Route path="/product-gallery" element={<ProductGalleryPage />} />
          <Route path="/product_gallery" element={<Navigate to="/product-gallery" replace />} />

          {/* Master modules from legacy ERP screenshot */}
          <Route path="/masters/taxes" element={<TaxesPage />} />
          <Route path="/tax/list" element={<Navigate to="/masters/taxes" replace />} />
          <Route path="/masters/additional-charges" element={<AdditionalChargesPage />} />
          <Route path="/additionalcharges/list" element={<Navigate to="/masters/additional-charges" replace />} />
          <Route path="/masters/social-media" element={<SocialMediaPage />} />
          <Route path="/social/list" element={<Navigate to="/masters/social-media" replace />} />
          <Route path="/masters/agent-types" element={<AgentTypesPage />} />
          <Route path="/agent/role/list" element={<Navigate to="/masters/agent-types" replace />} />
          <Route path="/masters/company-categories" element={<CompanyCategoriesPage />} />
          <Route path="/company/category/list" element={<Navigate to="/masters/company-categories" replace />} />
          <Route path="/masters/company-sectors" element={<CompanySectorsPage />} />
          <Route path="/company/sector/list" element={<Navigate to="/masters/company-sectors" replace />} />
          <Route path="/masters/warehouses" element={<WarehousesPage />} />
          <Route path="/warehouse/list" element={<Navigate to="/masters/warehouses" replace />} />
          <Route path="/masters/billing-company" element={<BillingCompaniesPage />} />
          <Route path="/company/list" element={<Navigate to="/masters/billing-company" replace />} />
          <Route path="/company/addedit" element={<Navigate to="/masters/billing-company" replace />} />
          <Route path="/masters/technicians" element={<TechniciansPage />} />
          <Route path="/technician/list" element={<Navigate to="/masters/technicians" replace />} />
          <Route path="/masters/banks" element={<BanksPage />} />
          <Route path="/masters/bank" element={<Navigate to="/masters/banks" replace />} />
          <Route path="/bank/list" element={<Navigate to="/masters/banks" replace />} />
          <Route path="/masters/transport" element={<TransportPage />} />
          <Route path="/masters/transports" element={<Navigate to="/masters/transport" replace />} />
          <Route path="/transport/list" element={<Navigate to="/masters/transport" replace />} />
          <Route path="/masters/payment-terms" element={<PaymentTermsPage />} />
          <Route path="/masters/payment_terms" element={<Navigate to="/masters/payment-terms" replace />} />
          <Route path="/payment-terms/list" element={<Navigate to="/masters/payment-terms" replace />} />
          <Route path="/paymentterms/list" element={<Navigate to="/masters/payment-terms" replace />} />
          <Route path="/masters/lead-sources" element={<LeadSourcesPage />} />
          <Route path="/masters/lead_sources" element={<Navigate to="/masters/lead-sources" replace />} />
          <Route path="/lead-sources/list" element={<Navigate to="/masters/lead-sources" replace />} />
          <Route path="/leadsources/list" element={<Navigate to="/masters/lead-sources" replace />} />
          <Route path="/lead_sources/list" element={<Navigate to="/masters/lead-sources" replace />} />
          <Route path="/masters/adjustment-purpose" element={<AdjustmentPurposesPage />} />
          <Route path="/masters/adjustment-purposes" element={<Navigate to="/masters/adjustment-purpose" replace />} />
          <Route path="/masters/adjustment_purpose" element={<Navigate to="/masters/adjustment-purpose" replace />} />
          <Route path="/masters/adjustment_purposes" element={<Navigate to="/masters/adjustment-purpose" replace />} />
          <Route path="/adjustment_purpose/list" element={<Navigate to="/masters/adjustment-purpose" replace />} />
          <Route path="/adjustment-purpose/list" element={<Navigate to="/masters/adjustment-purpose" replace />} />
          <Route path="/adjustmentpurpose/list" element={<Navigate to="/masters/adjustment-purpose" replace />} />
          <Route path="/masters/call-types" element={<CallTypesPage />} />
          <Route path="/masters/call_types" element={<Navigate to="/masters/call-types" replace />} />
          <Route path="/masters/call-type" element={<Navigate to="/masters/call-types" replace />} />
          <Route path="/masters/call_type" element={<Navigate to="/masters/call-types" replace />} />
          <Route path="/call_type/list" element={<Navigate to="/masters/call-types" replace />} />
          <Route path="/call-type/list" element={<Navigate to="/masters/call-types" replace />} />
          <Route path="/calltype/list" element={<Navigate to="/masters/call-types" replace />} />
          <Route path="/call_types/list" element={<Navigate to="/masters/call-types" replace />} />
          {/* Follow Up Logs Module (erp.inhymasolutions.com/follow-up/list) */}
          <Route path="/follow-up/list" element={<FollowUpsPage />} />
          <Route path="/follow-ups" element={<Navigate to="/follow-up/list" replace />} />
          <Route path="/follow-up" element={<Navigate to="/follow-up/list" replace />} />
          <Route path="/followups" element={<Navigate to="/follow-up/list" replace />} />
          <Route path="/call-logs/follow-up" element={<Navigate to="/follow-up/list" replace />} />
          <Route path="/call-logs/follow-ups" element={<Navigate to="/follow-up/list" replace />} />

          {/* Leads Module (erp.inhymasolutions.com/lead/list) */}
          <Route path="/lead/list" element={<LeadsPage />} />
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