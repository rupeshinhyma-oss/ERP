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

import { lazy, Suspense, useEffect, useRef } from "react";
import { Navigate, Route, Routes, useLocation, useNavigate } from "react-router-dom";
import { setUnauthorizedHandler } from "@/lib/api";
import { LEGACY_REDIRECTS } from "@/lib/nav";

// Critical path pages kept synchronous for 0ms initial render
import { LoginPage } from "@/pages/Login";
import { DashboardPage } from "@/pages/Dashboard";

// Lazy-loaded routes for code splitting and instant bundle loading
const AuthCallbackPage = lazy(() => import("@/pages/AuthCallback").then((m) => ({ default: m.AuthCallbackPage })));
const ForbiddenPage = lazy(() => import("@/pages/Forbidden").then((m) => ({ default: m.ForbiddenPage })));
const OrganizationPage = lazy(() => import("@/pages/Organization").then((m) => ({ default: m.OrganizationPage })));
const AuditPage = lazy(() => import("@/pages/Audit").then((m) => ({ default: m.AuditPage })));
const UsersPage = lazy(() => import("@/pages/Users").then((m) => ({ default: m.UsersPage })));
const ProfilePage = lazy(() => import("@/pages/Profile").then((m) => ({ default: m.ProfilePage })));
const RbacPage = lazy(() => import("@/pages/Rbac").then((m) => ({ default: m.RbacPage })));
const EffectivePermissionsPage = lazy(() => import("@/pages/EffectivePermissions").then((m) => ({ default: m.EffectivePermissionsPage })));
const PositionsPage = lazy(() => import("@/pages/org/Positions").then((m) => ({ default: m.PositionsPage })));
const SuppliersPage = lazy(() => import("@/pages/Suppliers").then((m) => ({ default: m.SuppliersPage })));
const BuyersPage = lazy(() => import("@/pages/Buyers").then((m) => ({ default: m.BuyersPage })));
const InquiriesPage = lazy(() => import("@/pages/Inquiries").then((m) => ({ default: m.InquiriesPage })));
const PlanningPage = lazy(() => import("@/pages/Planning").then((m) => ({ default: m.PlanningPage })));

const CountriesPage = lazy(() => import("@/pages/masters/Countries").then((m) => ({ default: m.CountriesPage })));
const StatesPage = lazy(() => import("@/pages/masters/States").then((m) => ({ default: m.StatesPage })));
const CitiesPage = lazy(() => import("@/pages/masters/Cities").then((m) => ({ default: m.CitiesPage })));
const CompanyListPage = lazy(() => import("@/pages/masters/CompanyList").then((m) => ({ default: m.CompanyListPage })));
const CurrenciesPage = lazy(() => import("@/pages/masters/Currencies").then((m) => ({ default: m.CurrenciesPage })));
const UomPage = lazy(() => import("@/pages/masters/Uom").then((m) => ({ default: m.UomPage })));
const HsnPage = lazy(() => import("@/pages/masters/Hsn").then((m) => ({ default: m.HsnPage })));
const BrandsPage = lazy(() => import("@/pages/masters/Brands").then((m) => ({ default: m.BrandsPage })));
const SupplierTypesPage = lazy(() => import("@/pages/masters/SupplierTypes").then((m) => ({ default: m.SupplierTypesPage })));
const BuyerTypesPage = lazy(() => import("@/pages/masters/BuyerTypes").then((m) => ({ default: m.BuyerTypesPage })));
const CategoriesPage = lazy(() => import("@/pages/masters/Categories").then((m) => ({ default: m.CategoriesPage })));
const SubCategoriesPage = lazy(() => import("@/pages/masters/SubCategories").then((m) => ({ default: m.SubCategoriesPage })));
const ProductsPage = lazy(() => import("@/pages/masters/Products").then((m) => ({ default: m.ProductsPage })));
const ProductPricesPage = lazy(() => import("@/pages/ProductPrices").then((m) => ({ default: m.ProductPricesPage })));
const ProductGalleryPage = lazy(() => import("@/pages/ProductGallery").then((m) => ({ default: m.ProductGalleryPage })));
const LocalPurchasesPage = lazy(() => import("@/pages/purchases/LocalPurchases").then((m) => ({ default: m.LocalPurchasesPage })));
const LocalPurchaseFormPage = lazy(() => import("@/pages/purchases/LocalPurchaseForm").then((m) => ({ default: m.LocalPurchaseFormPage })));
const SaleProcessListPage = lazy(() => import("@/pages/sales/SaleProcessList").then((m) => ({ default: m.SaleProcessListPage })));
const SaleProcessFormPage = lazy(() => import("@/pages/sales/SaleProcessForm").then((m) => ({ default: m.SaleProcessFormPage })));
const TrashPage = lazy(() => import("@/pages/Trash").then((m) => ({ default: m.TrashPage })));
const PublicSupplierQuotePage = lazy(() => import("@/pages/PublicSupplierQuotePage"));

import { NetworkStatusNotifier } from "@/components/NetworkStatusNotifier";
import { LiveConnectionIndicator } from "@/components/LiveConnectionIndicator";
import { ErrorBoundary } from "@/components/ErrorBoundary";
import { LiveConnectionLifecycle } from "@/lib/live/liveConnectionLifecycle";
import { initGlobalPasteSanitizer } from "@/lib/pasteSanitizer";
import { initGlobalAutocompleteBlocker } from "@/lib/autocompleteBlocker";
import { processIncomingSsoHandover } from "@/lib/ssoBridge";

export function App() {
  const navigate = useNavigate();

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
        <Suspense
          fallback={
            <div
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                minHeight: "calc(100vh - 120px)",
                background: "#f8fafc",
              }}
            >
              <div
                style={{
                  width: "32px",
                  height: "32px",
                  border: "3px solid #e2e8f0",
                  borderTopColor: "#0061f2",
                  borderRadius: "50%",
                  animation: "spin 0.6s linear infinite",
                }}
              />
            </div>
          }
        >
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
            <Route path="/suppliers" element={<SuppliersPage />} />
            <Route path="/buyers" element={<BuyersPage />} />
            <Route path="/inquiries" element={<InquiriesPage />} />
            <Route path="/planning" element={<PlanningPage />} />

            {/* Purchases */}
            <Route path="/purchase/local" element={<LocalPurchasesPage />} />
            <Route path="/purchase/local/new" element={<LocalPurchaseFormPage />} />
            <Route path="/purchase/local/:id/edit" element={<LocalPurchaseFormPage />} />
            <Route path="/local-purchase" element={<Navigate to="/purchase/local" replace />} />

            {/* Sales */}
            <Route path="/sale/process" element={<SaleProcessListPage />} />
            <Route path="/sale/process/new" element={<SaleProcessFormPage />} />
            <Route path="/sale/process/:id/edit" element={<SaleProcessFormPage />} />

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