/**
 * Application Routes for ERP_Main Central Control Plane.
 *
 * Configures the complete navigation architecture:
 * 1. Dashboard
 * 2. ERPs (Registry, Detail) -- kept: Registry is the only UI to
 *    register a new ERP; Detail is its per-ERP drill-down. Instances
 *    and Modules were removed (redundant list views / no backend of
 *    their own -- see the removed-pages note below).
 * 3. Users & Access (Global Users, Roles, Identity Conflicts)
 * 4. Organizations (Companies, Organizations, Departments, Business Units)
 * 5. Integrations (Network, Subscriptions, Events, Deliveries, Failed, DLQ)
 * 6. Synchronization (Sync Policies, Ownership, Mappings, Reconciliation, Conflicts, Repair, Snapshots)
 * 7. Monitoring & Audit (Subsystem Health, ERP Health, Queue, Realtime, Workers, Alerts, Audit, Security)
 * 8. Settings (General, Security, Sessions, Notifications)
 * Plus Error boundaries.
 *
 * FIX (nav redirect bug): ErpRegistry, GlobalAudit, and Health were
 * fully built pages that were never imported/routed here. Their real
 * paths either fell through the catch-all "*" route (bounce to
 * /dashboard) or were hard-redirected to a sibling page. They are now
 * imported and routed to themselves below.
 *
 * REMOVED PAGES (2026, per explicit approval): ErpInstances, ErpModules,
 * Search, and ErpLauncher were deleted outright -- ErpInstances was a
 * redundant second list view of the exact data ErpRegistry already
 * shows; ErpModules had no backend of its own and only linked to the
 * other ERP pages; Search had no backend module behind it at all;
 * ErpLauncher was never imported/routed anywhere already. Memberships
 * was likewise deleted (never imported here either, and redundant with
 * what GlobalUsers already shows). IdentityConflicts and ErpRegistry/
 * ErpDetail were deliberately KEPT even though unlinked from the
 * sidebar: IdentityConflicts is the only UI that can actually resolve
 * an identity-linking conflict (GlobalUsers only displays a warning
 * banner for one), and ErpRegistry is the only UI that can register a
 * new ERP instance.
 */

import { useEffect } from "react";
import { Routes, Route, Navigate, useNavigate } from "react-router-dom";
import { setUnauthorizedHandler } from "./lib/api";
import { GlobalSessionProvider } from "./lib/session";
import { processIncomingSsoHandover } from "./lib/ssoBridge";
import { ErrorBoundary } from "./components/ErrorBoundary";
import { Login } from "./pages/Login";
import { AuthCallback } from "./pages/AuthCallback";
import { Dashboard } from "./pages/Dashboard";

// ERPs Section
import { ErpDetail } from "./pages/ErpDetail";
import { ErpRegistry } from "./pages/ErpRegistry";

// Users & Access Section
import { GlobalUsers } from "./pages/GlobalUsers";
import { IdentityConflicts } from "./pages/IdentityConflicts";
import { PlatformAuthz } from "./pages/PlatformAuthz";




// Monitoring & Audit Section
import { GlobalAudit } from "./pages/GlobalAudit";
import { Health } from "./pages/Health";
import { Reporting } from "./pages/Reporting";

// Settings & Utilities
import { SettingsHub } from "./pages/SettingsHub";
import { Forbidden } from "./pages/Forbidden";

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

  useEffect(() => {
    setUnauthorizedHandler(() => {
      navigate("/login", { replace: true });
    });
    return () => setUnauthorizedHandler(null);
  }, [navigate]);

  return (
    <GlobalSessionProvider>
      <ErrorBoundary title="Page failed to render.">
        <Routes>
          <Route path="/login" element={<Login />} />
          <Route path="/auth/callback" element={<AuthCallback />} />

          {/* Section 1: Dashboard */}
          <Route path="/" element={<Navigate to="/dashboard" replace />} />
          <Route path="/dashboard" element={<Dashboard />} />

          {/* Section 2: ERPs (redirect to dashboard) */}
          <Route path="/erps" element={<Navigate to="/dashboard" replace />} />
          <Route path="/erps/switcher" element={<Navigate to="/dashboard" replace />} />
          <Route path="/erps/launcher" element={<Navigate to="/dashboard" replace />} />
          <Route path="/my-erps" element={<Navigate to="/dashboard" replace />} />
          <Route path="/launcher" element={<Navigate to="/dashboard" replace />} />
          <Route path="/erps/registry" element={<ErpRegistry />} />
          {/* ErpInstances and ErpModules removed (2026, approved): redundant
              list views with no unique backend/capability of their own --
              see the removed-pages note in this file's header comment. */}
          <Route path="/erps/instances" element={<Navigate to="/erps/registry" replace />} />
          <Route path="/erps/modules" element={<Navigate to="/erps/registry" replace />} />
          <Route path="/erps/:id" element={<ErpDetail />} />

          {/* Section 3: Users & Access */}
          <Route path="/access" element={<Navigate to="/access/users" replace />} />
          <Route path="/access/users" element={<GlobalUsers />} />
          <Route path="/access/users/:id" element={<GlobalUsers />} />
          <Route path="/users" element={<GlobalUsers />} />
          <Route path="/users/:id" element={<GlobalUsers />} />
          <Route path="/access/roles" element={<PlatformAuthz />} />
          <Route path="/access/permissions" element={<Navigate to="/access/roles" replace />} />
          {/* Memberships page removed (2026, approved): never routed here
              even before removal, and redundant with what GlobalUsers
              already shows -- see the removed-pages note above. */}
          <Route path="/access/memberships" element={<Navigate to="/access/users" replace />} />
          <Route path="/memberships" element={<Navigate to="/access/users" replace />} />
          <Route path="/access/policies" element={<Navigate to="/access/roles" replace />} />
          <Route path="/authz" element={<PlatformAuthz />} />
          <Route path="/conflicts" element={<IdentityConflicts />} />

          {/* Section 4: Organizations (removed - redirect to dashboard) */}
          <Route path="/organizations" element={<Navigate to="/dashboard" replace />} />
          <Route path="/organizations/*" element={<Navigate to="/dashboard" replace />} />

          {/* Section 5: Integrations (removed from UI - redirect to dashboard) */}
          <Route path="/integrations" element={<Navigate to="/dashboard" replace />} />
          <Route path="/integration" element={<Navigate to="/dashboard" replace />} />
          <Route path="/integrations/*" element={<Navigate to="/dashboard" replace />} />

          {/* Section 6: Synchronization (removed from UI - redirect to dashboard) */}
          <Route path="/sync" element={<Navigate to="/dashboard" replace />} />
          <Route path="/sync/*" element={<Navigate to="/dashboard" replace />} />

          {/* Section 7: Monitoring & Audit (Audit Logs Only) */}
          <Route path="/monitoring" element={<Navigate to="/monitoring/audit" replace />} />
          <Route path="/monitoring/audit" element={<GlobalAudit />} />
          <Route path="/audit" element={<GlobalAudit />} />
          <Route path="/monitoring/*" element={<Navigate to="/monitoring/audit" replace />} />
          <Route path="/health" element={<Health />} />
          <Route path="/reporting" element={<Reporting />} />

          {/* Section 8: Settings (ERP_Main Settings Only) */}
          <Route path="/settings" element={<SettingsHub />} />
          <Route path="/settings/general" element={<SettingsHub />} />
          <Route path="/settings/*" element={<Navigate to="/settings" replace />} />

          {/* Utilities & Fallbacks */}
          {/* Search page removed (2026, approved): no backend module
              existed behind it -- see the removed-pages note above. */}
          <Route path="/search" element={<Navigate to="/dashboard" replace />} />
          <Route path="/403" element={<Forbidden />} />
          <Route path="*" element={<Navigate to="/dashboard" replace />} />
        </Routes>
      </ErrorBoundary>
    </GlobalSessionProvider>
  );
}

export default App;