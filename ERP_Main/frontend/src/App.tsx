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
import { ErpRegistry } from "./pages/ErpRegistry";
import { ErpDetail } from "./pages/ErpDetail";
import { ErpLauncher } from "./pages/ErpLauncher";
import { ErpInstances } from "./pages/ErpInstances";
import { ErpModules } from "./pages/ErpModules";

// Users & Access Section
import { GlobalUsers } from "./pages/GlobalUsers";
import { Memberships } from "./pages/Memberships";
import { IdentityConflicts } from "./pages/IdentityConflicts";
import { PlatformAuthz } from "./pages/PlatformAuthz";

// Organizations Section
import { Organizations } from "./pages/Organizations";

// Integrations Section
import { IntegrationEvents } from "./pages/IntegrationEvents";

// Synchronization Section
import { SynchronizationHub } from "./pages/SynchronizationHub";

// Monitoring & Audit Section
import { MonitoringHub } from "./pages/MonitoringHub";
import { Reporting } from "./pages/Reporting";

// Settings & Utilities
import { SettingsHub } from "./pages/SettingsHub";
import { Search } from "./pages/Search";
import { Forbidden } from "./pages/Forbidden";

export function App() {
  const navigate = useNavigate();

  // Process incoming cross-ERP SSO handover immediately on load
  useEffect(() => {
    processIncomingSsoHandover().then((loggedIn) => {
      if (loggedIn) {
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

          {/* Section 2: ERPs */}
          <Route path="/erps" element={<Navigate to="/erps/switcher" replace />} />
          <Route path="/erps/switcher" element={<ErpLauncher />} />
          <Route path="/erps/launcher" element={<Navigate to="/erps/switcher" replace />} />
          <Route path="/my-erps" element={<Navigate to="/erps/switcher" replace />} />
          <Route path="/launcher" element={<Navigate to="/erps/switcher" replace />} />
          <Route path="/erps/registry" element={<Navigate to="/erps/switcher" replace />} />
          <Route path="/erps/instances" element={<Navigate to="/erps/switcher" replace />} />
          <Route path="/erps/modules" element={<Navigate to="/erps/switcher" replace />} />
          <Route path="/erps/:id" element={<ErpDetail />} />

          {/* Section 3: Users & Access */}
          <Route path="/access" element={<Navigate to="/access/users" replace />} />
          <Route path="/access/users" element={<GlobalUsers />} />
          <Route path="/users" element={<GlobalUsers />} />
          <Route path="/access/roles" element={<PlatformAuthz defaultTab="roles" />} />
          <Route path="/access/permissions" element={<PlatformAuthz defaultTab="permissions" />} />
          <Route path="/access/memberships" element={<Memberships />} />
          <Route path="/memberships" element={<Memberships />} />
          <Route path="/access/policies" element={<PlatformAuthz defaultTab="matrix" />} />
          <Route path="/authz" element={<PlatformAuthz />} />
          <Route path="/conflicts" element={<IdentityConflicts />} />

          {/* Section 4: Organizations */}
          <Route path="/organizations" element={<Organizations />} />
          <Route path="/organizations/companies" element={<Organizations />} />
          <Route path="/organizations/departments" element={<Organizations />} />
          <Route path="/organizations/business-units" element={<Organizations />} />

          {/* Section 5: Integrations */}
          <Route path="/integrations" element={<IntegrationEvents />} />
          <Route path="/integration" element={<IntegrationEvents />} />
          <Route path="/integrations/subscriptions" element={<IntegrationEvents />} />
          <Route path="/integrations/events" element={<IntegrationEvents />} />
          <Route path="/integrations/deliveries" element={<IntegrationEvents />} />
          <Route path="/integrations/failed" element={<IntegrationEvents />} />
          <Route path="/integrations/dlq" element={<IntegrationEvents />} />

          {/* Section 6: Synchronization */}
          <Route path="/sync" element={<SynchronizationHub />} />
          <Route path="/sync/policies" element={<SynchronizationHub />} />
          <Route path="/sync/ownership" element={<SynchronizationHub />} />
          <Route path="/sync/mappings" element={<SynchronizationHub />} />
          <Route path="/sync/reconciliation" element={<SynchronizationHub />} />
          <Route path="/sync/conflicts" element={<SynchronizationHub />} />
          <Route path="/sync/repair" element={<SynchronizationHub />} />
          <Route path="/sync/snapshots" element={<SynchronizationHub />} />

          {/* Section 7: Monitoring & Audit */}
          <Route path="/monitoring" element={<MonitoringHub />} />
          <Route path="/monitoring/system" element={<MonitoringHub />} />
          <Route path="/monitoring/erps" element={<MonitoringHub />} />
          <Route path="/monitoring/queue" element={<MonitoringHub />} />
          <Route path="/monitoring/realtime" element={<MonitoringHub />} />
          <Route path="/monitoring/workers" element={<MonitoringHub />} />
          <Route path="/monitoring/alerts" element={<MonitoringHub />} />
          <Route path="/monitoring/audit" element={<MonitoringHub />} />
          <Route path="/monitoring/security" element={<MonitoringHub />} />
          <Route path="/audit" element={<MonitoringHub />} />
          <Route path="/health" element={<MonitoringHub />} />
          <Route path="/reporting" element={<Reporting />} />

          {/* Section 8: Settings */}
          <Route path="/settings" element={<SettingsHub />} />
          <Route path="/settings/general" element={<SettingsHub />} />
          <Route path="/settings/security" element={<SettingsHub />} />
          <Route path="/settings/sessions" element={<SettingsHub />} />
          <Route path="/settings/notifications" element={<SettingsHub />} />

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
