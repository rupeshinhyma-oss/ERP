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
          <Route path="/suppliers" element={<SuppliersPage />} />
          <Route path="/buyers" element={<BuyersPage />} />
          <Route path="/inquiries" element={<InquiriesPage />} />
          <Route path="/planning" element={<PlanningPage />} />
          <Route path="/tasks/my" element={<Navigate to="/tasks?tab=my" replace />} />
          <Route path="/tasks" element={<TasksPage />} />
          <Route path="/tasks/kanban" element={<Navigate to="/tasks?tab=kanban" replace />} />
          <Route path="/tasks/calendar" element={<Navigate to="/tasks?tab=calendar" replace />} />

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
          <Route path="/product-gallery" element={<ProductGalleryPage />} />
          <Route path="/product_gallery" element={<Navigate to="/product-gallery" replace />} />

          {/* Master modules from legacy ERP screenshot */}
          <Route path="/masters/taxes" element={<TaxesPage />} />
          <Route path="/tax/list" element={<Navigate to="/masters/taxes" replace />} />
          <Route path="/masters/additional-charges" element={<ComingSoonPage activeKey="masters-additional-charges" title="Additional Charges" subtitle="Manage freight, packaging, and surcharge rates" breadcrumbLabel="Additional Charges" featureName="Additional Charges" />} />
          <Route path="/masters/social-media" element={<ComingSoonPage activeKey="masters-social-media" title="Social Media" subtitle="Configure social platforms and communication channels" breadcrumbLabel="Social Media" featureName="Social Media" />} />
          <Route path="/masters/agent-types" element={<ComingSoonPage activeKey="masters-agent-types" title="Agent Types" subtitle="Manage agent classifications and commission tiers" breadcrumbLabel="Agent Types" featureName="Agent Types" />} />
          <Route path="/masters/company-categories" element={<ComingSoonPage activeKey="masters-company-categories" title="Company Categories" subtitle="Manage corporate tiers and classification categories" breadcrumbLabel="Company Categories" featureName="Company Categories" />} />
          <Route path="/masters/company-sectors" element={<ComingSoonPage activeKey="masters-company-sectors" title="Company Sectors" subtitle="Manage business industry verticals and sectors" breadcrumbLabel="Company Sectors" featureName="Company Sectors" />} />
          <Route path="/masters/warehouses" element={<ComingSoonPage activeKey="masters-warehouses" title="Warehouses" subtitle="Manage storage hubs, godowns, and inventory facilities" breadcrumbLabel="Warehouses" featureName="Warehouses" />} />
          <Route path="/masters/billing-company" element={<ComingSoonPage activeKey="masters-billing-company" title="Billing Company" subtitle="Manage invoicing legal entities and tax registrations" breadcrumbLabel="Billing Company" featureName="Billing Company" />} />
          <Route path="/masters/technicians" element={<ComingSoonPage activeKey="masters-technicians" title="Technicians" subtitle="Manage service engineers and field technicians" breadcrumbLabel="Technicians" featureName="Technicians" />} />
          <Route path="/masters/bank" element={<ComingSoonPage activeKey="masters-bank" title="Bank" subtitle="Manage settlement accounts and banking details" breadcrumbLabel="Bank" featureName="Bank" />} />
          <Route path="/masters/transport" element={<ComingSoonPage activeKey="masters-transport" title="Transport" subtitle="Manage logistics carriers and transport agencies" breadcrumbLabel="Transport" featureName="Transport" />} />
          <Route path="/masters/payment-terms" element={<ComingSoonPage activeKey="masters-payment-terms" title="Payment Terms" subtitle="Configure credit limits and payment condition cycles" breadcrumbLabel="Payment Terms" featureName="Payment Terms" />} />
          <Route path="/masters/lead-sources" element={<ComingSoonPage activeKey="masters-lead-sources" title="Lead Sources" subtitle="Track acquisition channels and campaign sources" breadcrumbLabel="Lead Sources" featureName="Lead Sources" />} />
          <Route path="/masters/adjustment-purpose" element={<ComingSoonPage activeKey="masters-adjustment-purpose" title="Adjustment Purpose" subtitle="Manage stock reconciliation reasons" breadcrumbLabel="Adjustment Purpose" featureName="Adjustment Purpose" />} />
          <Route path="/masters/call-types" element={<ComingSoonPage activeKey="masters-call-types" title="Call Types" subtitle="Configure CRM telecalling interaction types" breadcrumbLabel="Call Types" featureName="Call Types" />} />
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