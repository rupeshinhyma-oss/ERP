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

import { Suspense, lazy, useEffect, useRef } from "react";
import { Navigate, Route, Routes, useLocation, useNavigate } from "react-router-dom";
import { setUnauthorizedHandler } from "@/lib/api";
import { LEGACY_REDIRECTS } from "@/lib/nav";

// Critical-path pages stay in the entry bundle.
import { LoginPage } from "@/pages/Login";
import { DashboardPage } from "@/pages/Dashboard";
import { AuthCallbackPage } from "@/pages/AuthCallback";
import { ForbiddenPage } from "@/pages/Forbidden";

// Every other page is code-split, then prefetched when the browser is idle
// (see prefetchAllPages below) so route switches still feel instant.
const pageLoaders = {
  Organization: () => import("@/pages/Organization").then((m) => ({ default: m.OrganizationPage })),
  Audit: () => import("@/pages/Audit").then((m) => ({ default: m.AuditPage })),
  Users: () => import("@/pages/Users").then((m) => ({ default: m.UsersPage })),
  Profile: () => import("@/pages/Profile").then((m) => ({ default: m.ProfilePage })),
  Rbac: () => import("@/pages/Rbac").then((m) => ({ default: m.RbacPage })),
  EffectivePermissions: () => import("@/pages/EffectivePermissions").then((m) => ({ default: m.EffectivePermissionsPage })),
  Positions: () => import("@/pages/org/Positions").then((m) => ({ default: m.PositionsPage })),
  Suppliers: () => import("@/pages/Suppliers").then((m) => ({ default: m.SuppliersPage })),
  Buyers: () => import("@/pages/Buyers").then((m) => ({ default: m.BuyersPage })),
  Inquiries: () => import("@/pages/Inquiries").then((m) => ({ default: m.InquiriesPage })),
  Planning: () => import("@/pages/Planning").then((m) => ({ default: m.PlanningPage })),
  Countries: () => import("@/pages/masters/Countries").then((m) => ({ default: m.CountriesPage })),
  States: () => import("@/pages/masters/States").then((m) => ({ default: m.StatesPage })),
  Cities: () => import("@/pages/masters/Cities").then((m) => ({ default: m.CitiesPage })),
  CompanyList: () => import("@/pages/masters/CompanyList").then((m) => ({ default: m.CompanyListPage })),
  Currencies: () => import("@/pages/masters/Currencies").then((m) => ({ default: m.CurrenciesPage })),
  Uom: () => import("@/pages/masters/Uom").then((m) => ({ default: m.UomPage })),
  Hsn: () => import("@/pages/masters/Hsn").then((m) => ({ default: m.HsnPage })),
  Brands: () => import("@/pages/masters/Brands").then((m) => ({ default: m.BrandsPage })),
  SupplierTypes: () => import("@/pages/masters/SupplierTypes").then((m) => ({ default: m.SupplierTypesPage })),
  BuyerTypes: () => import("@/pages/masters/BuyerTypes").then((m) => ({ default: m.BuyerTypesPage })),
  Categories: () => import("@/pages/masters/Categories").then((m) => ({ default: m.CategoriesPage })),
  SubCategories: () => import("@/pages/masters/SubCategories").then((m) => ({ default: m.SubCategoriesPage })),
  Products: () => import("@/pages/masters/Products").then((m) => ({ default: m.ProductsPage })),
  ProductPrices: () => import("@/pages/ProductPrices").then((m) => ({ default: m.ProductPricesPage })),
  ProductGallery: () => import("@/pages/ProductGallery").then((m) => ({ default: m.ProductGalleryPage })),
  StockMovements: () => import("@/pages/inventory/StockMovements").then((m) => ({ default: m.StockMovementsPage })),
  LocalPurchases: () => import("@/pages/purchases/LocalPurchases").then((m) => ({ default: m.LocalPurchasesPage })),
  LocalPurchaseForm: () => import("@/pages/purchases/LocalPurchaseForm").then((m) => ({ default: m.LocalPurchaseFormPage })),
  SaleProcessList: () => import("@/pages/sales/SaleProcessList").then((m) => ({ default: m.SaleProcessListPage })),
  SaleProcessForm: () => import("@/pages/sales/SaleProcessForm").then((m) => ({ default: m.SaleProcessFormPage })),
  Trash: () => import("@/pages/Trash").then((m) => ({ default: m.TrashPage })),
  PublicSupplierQuote: () => import("@/pages/PublicSupplierQuotePage"),
  NotificationSettings: () => import("@/pages/NotificationSettings").then((m) => ({ default: m.NotificationSettings })),
};

const NotificationSettingsPage = lazy(pageLoaders.NotificationSettings);
const OrganizationPage = lazy(pageLoaders.Organization);
const AuditPage = lazy(pageLoaders.Audit);
const UsersPage = lazy(pageLoaders.Users);
const ProfilePage = lazy(pageLoaders.Profile);
const RbacPage = lazy(pageLoaders.Rbac);
const EffectivePermissionsPage = lazy(pageLoaders.EffectivePermissions);
const PositionsPage = lazy(pageLoaders.Positions);
const SuppliersPage = lazy(pageLoaders.Suppliers);
const BuyersPage = lazy(pageLoaders.Buyers);
const InquiriesPage = lazy(pageLoaders.Inquiries);
const PlanningPage = lazy(pageLoaders.Planning);
const CountriesPage = lazy(pageLoaders.Countries);
const StatesPage = lazy(pageLoaders.States);
const CitiesPage = lazy(pageLoaders.Cities);
const CompanyListPage = lazy(pageLoaders.CompanyList);
const CurrenciesPage = lazy(pageLoaders.Currencies);
const UomPage = lazy(pageLoaders.Uom);
const HsnPage = lazy(pageLoaders.Hsn);
const BrandsPage = lazy(pageLoaders.Brands);
const SupplierTypesPage = lazy(pageLoaders.SupplierTypes);
const BuyerTypesPage = lazy(pageLoaders.BuyerTypes);
const CategoriesPage = lazy(pageLoaders.Categories);
const SubCategoriesPage = lazy(pageLoaders.SubCategories);
const ProductsPage = lazy(pageLoaders.Products);
const ProductPricesPage = lazy(pageLoaders.ProductPrices);
const ProductGalleryPage = lazy(pageLoaders.ProductGallery);
const StockMovementsPage = lazy(pageLoaders.StockMovements);
const LocalPurchasesPage = lazy(pageLoaders.LocalPurchases);
const LocalPurchaseFormPage = lazy(pageLoaders.LocalPurchaseForm);
const SaleProcessListPage = lazy(pageLoaders.SaleProcessList);
const SaleProcessFormPage = lazy(pageLoaders.SaleProcessForm);
const TrashPage = lazy(pageLoaders.Trash);
const PublicSupplierQuotePage = lazy(pageLoaders.PublicSupplierQuote);

/** Warm every page chunk in the background once the app is idle. */
function prefetchAllPages(): void {
  const run = () => {
    for (const load of Object.values(pageLoaders)) {
      void load().catch(() => undefined);
    }
  };
  const ric = (window as unknown as { requestIdleCallback?: (cb: () => void, opts?: { timeout: number }) => void })
    .requestIdleCallback;
  if (ric) ric(run, { timeout: 4000 });
  else window.setTimeout(run, 2000);
}


import { NetworkStatusNotifier } from "@/components/NetworkStatusNotifier";
import { LiveConnectionIndicator } from "@/components/LiveConnectionIndicator";
import { ErrorBoundary } from "@/components/ErrorBoundary";
import { LiveConnectionLifecycle } from "@/lib/live/liveConnectionLifecycle";
import { initGlobalPasteSanitizer } from "@/lib/pasteSanitizer";
import { initGlobalAutocompleteBlocker } from "@/lib/autocompleteBlocker";
import { processIncomingSsoHandover } from "@/lib/ssoBridge";

export function App() {
  const navigate = useNavigate();

  useEffect(() => {
    prefetchAllPages();
  }, []);

  // Initialize global paste auto-clean across all inputs and forms
  useEffect(() => {
    initGlobalPasteSanitizer();
  }, []);

  // Globally suppress intrusive browser autocomplete/autofill bubbles across all inputs
  useEffect(() => {
    return initGlobalAutocompleteBlocker();
  }, []);



  // Process incoming cross-ERP SSO handover immediately on load. Only a
  // genuine fresh auto-login ("logged-in") should redirect to /dashboard;
  // "already-logged-in" means nothing changed, so the user's current page
  // (wherever they navigated to) is left alone.
  const ssoProcessedRef = useRef(false);
  useEffect(() => {
    if (ssoProcessedRef.current) return;
    ssoProcessedRef.current = true;
    processIncomingSsoHandover().then((result) => {
      if (result === "logged-in") {
        navigate("/dashboard", { replace: true });
      }
    });
  }, [navigate]);



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
        <Suspense fallback={null}>
          <Routes>
            <Route path="/login" element={<LoginPage />} />
            <Route path="/auth/callback" element={<AuthCallbackPage />} />
            <Route path="/quote/:token" element={<PublicSupplierQuotePage />} />
            <Route path="/" element={<Navigate to="/dashboard" replace />} />
            <Route path="/dashboard" element={<DashboardPage />} />
            <Route path="/403" element={<ForbiddenPage />} />
            <Route path="/organization" element={<OrganizationPage />} />
            <Route path="/notification-settings" element={<NotificationSettingsPage />} />
            <Route path="/audit" element={<AuditPage />} />
            <Route path="/trash" element={<TrashPage />} />
            <Route path="/profile" element={<ProfilePage />} />
            <Route path="/users" element={<UsersPage />} />
            <Route path="/rbac" element={<RbacPage />} />
            <Route path="/effective-permissions" element={<EffectivePermissionsPage />} />
            {/* Employee was merged into User -- /employees is now an alias for the same page. */}
            <Route path="/employees" element={<UsersPage />} />
            <Route path="/positions" element={<PositionsPage />} />
            <Route path="/suppliers" element={<SuppliersPage />} />
            <Route path="/buyers" element={<BuyersPage />} />
            <Route path="/inquiries" element={<InquiriesPage />} />
            <Route path="/planning" element={<PlanningPage />} />

            {/* Inventory & Stock Movement */}
            <Route path="/inventory/stock-movements" element={<StockMovementsPage />} />
            <Route path="/stock" element={<Navigate to="/inventory/stock-movements" replace />} />
            <Route path="/stock-movements" element={<Navigate to="/inventory/stock-movements" replace />} />

            {/* Purchases */}
            <Route path="/purchase/local" element={<LocalPurchasesPage />} />
            <Route path="/purchase/local/new" element={<LocalPurchaseFormPage />} />
            <Route path="/purchase/local/:id/edit" element={<LocalPurchaseFormPage />} />
            <Route path="/local-purchase" element={<Navigate to="/purchase/local" replace />} />
            <Route path="/local-purchases" element={<Navigate to="/purchase/local" replace />} />

            {/* Sales */}
            <Route path="/sale/process" element={<SaleProcessListPage />} />
            <Route path="/sale/process/new" element={<SaleProcessFormPage />} />
            <Route path="/sale/process/:id/edit" element={<SaleProcessFormPage />} />
            <Route path="/sales/orders/:id" element={<Navigate to="/sale/process" replace />} />
            <Route path="/sales/orders" element={<Navigate to="/sale/process" replace />} />
            <Route path="/sales" element={<Navigate to="/sale/process" replace />} />

            <Route path="/masters/company-list" element={<CompanyListPage />} />
            <Route path="/masters/countries" element={<CountriesPage />} />
            <Route path="/masters/states" element={<StatesPage />} />
            <Route path="/masters/cities" element={<CitiesPage />} />
            <Route path="/masters/currencies" element={<CurrenciesPage />} />
            <Route path="/masters/uom" element={<UomPage />} />
            <Route path="/masters/hsn" element={<HsnPage />} />
            <Route path="/masters/brands" element={<BrandsPage />} />
            <Route path="/masters/supplier-types" element={<SupplierTypesPage />} />
            <Route path="/masters/buyer-types" element={<BuyerTypesPage />} />
            <Route path="/masters/categories" element={<CategoriesPage />} />
            <Route path="/masters/subcategories" element={<SubCategoriesPage />} />
            <Route path="/masters/products" element={<ProductsPage />} />
            <Route path="/inventory/product-prices" element={<ProductPricesPage />} />
            <Route path="/product-prices" element={<Navigate to="/inventory/product-prices" replace />} />
            <Route path="/masters/product-prices" element={<Navigate to="/inventory/product-prices" replace />} />
            <Route path="/product-gallery" element={<ProductGalleryPage />} />
            <Route path="/product_gallery" element={<Navigate to="/product-gallery" replace />} />

            {Object.entries(LEGACY_REDIRECTS).map(([from, to]) => (
              <Route key={from} path={from} element={<Navigate to={to} replace />} />
            ))}

            <Route path="*" element={<Navigate to="/dashboard" replace />} />
          </Routes>
        </Suspense>
      </ErrorBoundary>
    </>
  );
}