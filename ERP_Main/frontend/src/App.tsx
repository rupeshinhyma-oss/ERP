/**
 * Application Routes for ERP_Main Central Control Plane.
 *
 * Configures the complete 8-section navigation architecture:
 * 1. Dashboard
 * 2. ERPs (Switcher/Launcher, Registry, Instances, Modules)
 * 3. Users & Access (Global Users, Roles, Permissions, Memberships, Access Policies)
 * 4. Organizations (Companies, Organizations, Departments, Business Units)
 * 5. Integrations (Network, Subscriptions, Events, Deliveries, Failed, DLQ)
 * 6. Synchronization (Sync Policies, Ownership, Mappings, Reconciliation, Conflicts, Repair, Snapshots)
 * 7. Monitoring & Audit (Subsystem Health, ERP Health, Queue, Realtime, Workers, Alerts, Audit, Security)
 * 8. Settings (General, Security, Sessions, Notifications)
 * Plus Universal Search & Error boundaries.
 *
 * FIX (nav redirect bug): ErpRegistry, ErpInstances, ErpModules, GlobalAudit,
 * and Health were fully built pages that were never imported/routed here.
 * Their real paths either fell through the catch-all "*" route (bounce to
 * /dashboard) or were hard-redirected to a sibling page (/erps/switcher,
 * MonitoringHub). They are now imported and routed to themselves below.
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
import { ErpInstances } from "./pages/ErpInstances";
import { ErpModules } from "./pages/ErpModules";

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
import { Search } from "./pages/Search";
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
          <Route path="/erps/instances" element={<ErpInstances />} />
          <Route path="/erps/modules" element={<ErpModules />} />
          <Route path="/erps/:id" element={<ErpDetail />} />

          {/* Section 3: Users & Access */}
          <Route path="/access" element={<Navigate to="/access/users" replace />} />
          <Route path="/access/users" element={<GlobalUsers />} />
          <Route path="/access/users/:id" element={<GlobalUsers />} />
          <Route path="/users" element={<GlobalUsers />} />
          <Route path="/users/:id" element={<GlobalUsers />} />
          <Route path="/access/roles" element={<PlatformAuthz defaultTab="roles" />} />
          <Route path="/access/permissions" element={<PlatformAuthz defaultTab="permissions" />} />
          <Route path="/access/memberships" element={<Navigate to="/access/users" replace />} />
          <Route path="/memberships" element={<Navigate to="/access/users" replace />} />
          <Route path="/access/policies" element={<PlatformAuthz defaultTab="matrix" />} />
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
          <Route path="/search" element={<Search />} />
          <Route path="/403" element={<Forbidden />} />
          <Route path="*" element={<Navigate to="/dashboard" replace />} />
        </Routes>
      </ErrorBoundary>
    </GlobalSessionProvider>
  );
}

export default App;