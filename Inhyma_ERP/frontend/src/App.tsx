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

import { LoginPage } from "@/pages/Login";
import { AuthCallbackPage } from "@/pages/AuthCallback";
import { DashboardPage } from "@/pages/Dashboard";
import { ForbiddenPage } from "@/pages/Forbidden";
import { OrganizationPage } from "@/pages/Organization";
import { AuditPage } from "@/pages/Audit";
import { UsersPage } from "@/pages/Users";
import { ProfilePage } from "@/pages/Profile";
import { RbacPage } from "@/pages/Rbac";
import { EffectivePermissionsPage } from "@/pages/EffectivePermissions";
import { PositionsPage } from "@/pages/org/Positions";
import { CompaniesPage } from "@/pages/Companies";
import { SuppliersPage } from "@/pages/Suppliers";
import { BuyersPage } from "@/pages/Buyers";
import { InquiriesPage } from "@/pages/Inquiries";
import { PlanningPage } from "@/pages/Planning";
import { TasksPage } from "@/pages/tasks/TasksPage";
import { TechnicalTasksPage } from "@/pages/technicalTasks/TechnicalTasksPage";

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
import { ComingSoonPage } from "@/components/ComingSoon";
import { processIncomingSsoHandover } from "@/lib/ssoBridge";
import { ProductStockPage } from "@/pages/ProductStockPage";
import { StockAdjustmentPage } from "@/pages/StockAdjustmentPage";
import { AdjustmentOrderPdfPage } from "@/pages/AdjustmentOrderPdfPage";

export function App() {
  const navigate = useNavigate();

  // Process incoming cross-ERP SSO handover immediately on load. Only a
  // genuine fresh auto-login ("logged-in") should redirect to /dashboard;
  // "already-logged-in" means nothing changed, so the user's current page
  // (wherever they navigated to) is left alone.
  useEffect(() => {
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
          <Route path="/user/addEdit" element={<CompaniesPage defaultAdd={true} />} />
          <Route path="/user/addedit" element={<CompaniesPage defaultAdd={true} />} />
          <Route path="/suppliers" element={<SuppliersPage />} />
          <Route path="/buyers" element={<BuyersPage />} />
          <Route path="/inquiries" element={<InquiriesPage />} />
          <Route path="/planning" element={<PlanningPage />} />
          <Route path="/tasks/my" element={<Navigate to="/tasks?tab=my" replace />} />
          <Route path="/tasks" element={<TasksPage />} />
          <Route path="/tasks/kanban" element={<Navigate to="/tasks?tab=kanban" replace />} />
          <Route path="/tasks/calendar" element={<Navigate to="/tasks?tab=calendar" replace />} />
          <Route path="/technical-task/list" element={<TechnicalTasksPage />} />
          <Route path="/technical-tasks" element={<Navigate to="/technical-task/list" replace />} />
          <Route
            path="/marketing-task/list"
            element={
              <ComingSoonPage
                activeKey="marketing-tasks"
                title="Marketing Tasks"
                subtitle="Track and manage client outreach and marketing activities"
                breadcrumbLabel="Marketing Tasks"
                featureName="Marketing Tasks"
              />
            }
          />
          <Route path="/marketing-tasks" element={<Navigate to="/marketing-task/list" replace />} />

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
          <Route path="/product-stock/list" element={<ProductStockPage />} />
          <Route path="/product-stock" element={<Navigate to="/product-stock/list" replace />} />
          <Route path="/product_stock/list" element={<Navigate to="/product-stock/list" replace />} />
          <Route path="/product_stock" element={<Navigate to="/product-stock/list" replace />} />
          <Route path="/stock-adjustment" element={<StockAdjustmentPage />} />
          <Route path="/adjustment/list" element={<StockAdjustmentPage />} />
          <Route path="/adjustment" element={<Navigate to="/adjustment/list" replace />} />
          <Route path="/adjustment/adjustment-order-pdf/:id" element={<AdjustmentOrderPdfPage />} />
          <Route path="/adjustment/adjustment-order-pdf" element={<AdjustmentOrderPdfPage />} />
          <Route
            path="/stock-transfer"
            element={
              <ComingSoonPage
                activeKey="stock-transfer"
                title="Stock Transfer"
                subtitle="Manage warehouse and branch inventory transfers"
                breadcrumbLabel="Stock Transfer"
                featureName="Stock Transfer"
              />
            }
          />
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
          <Route path="/call-types/list" element={<Navigate to="/masters/call-types" replace />} />
          <Route path="/call-logs/follow-up" element={<ComingSoonPage activeKey="call-logs-follow-up" title="Follow Up Logs" subtitle="View and track interaction logs and scheduled follow-ups" breadcrumbLabel="Follow Up Logs" featureName="Follow Up Logs" />} />

          {Object.entries(LEGACY_REDIRECTS).map(([from, to]) => (
            <Route key={from} path={from} element={<Navigate to={to} replace />} />
          ))}

          <Route path="*" element={<Navigate to="/dashboard" replace />} />
        </Routes>
      </ErrorBoundary>
    </>
  );
}