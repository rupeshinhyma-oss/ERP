/**
 * Application Routes for ERP_Main Control Plane.
 */

import { useEffect } from "react";
import { Routes, Route, Navigate, useNavigate } from "react-router-dom";
import { setUnauthorizedHandler } from "./lib/api";
import { GlobalSessionProvider } from "./lib/session";
import { ErrorBoundary } from "./components/ErrorBoundary";
import { Login } from "./pages/Login";
import { AuthCallback } from "./pages/AuthCallback";
import { Dashboard } from "./pages/Dashboard";
import { ErpRegistry } from "./pages/ErpRegistry";
import { ErpDetail } from "./pages/ErpDetail";
import { ErpLauncher } from "./pages/ErpLauncher";
import { GlobalUsers } from "./pages/GlobalUsers";
import { Memberships } from "./pages/Memberships";
import { IdentityConflicts } from "./pages/IdentityConflicts";
import { PlatformAuthz } from "./pages/PlatformAuthz";
import { IntegrationEvents } from "./pages/IntegrationEvents";
import { GlobalAudit } from "./pages/GlobalAudit";
import { Reporting } from "./pages/Reporting";
import { Search } from "./pages/Search";
import { Health } from "./pages/Health";
import { Forbidden } from "./pages/Forbidden";

export function App() {
  const navigate = useNavigate();

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

          {/* Protected Control Plane Routes */}
          <Route path="/" element={<Navigate to="/dashboard" replace />} />
          <Route path="/dashboard" element={<Dashboard />} />
          <Route path="/erps" element={<ErpRegistry />} />
          <Route path="/erps/:id" element={<ErpDetail />} />
          <Route path="/my-erps" element={<ErpLauncher />} />
          <Route path="/launcher" element={<Navigate to="/my-erps" replace />} />
          <Route path="/users" element={<GlobalUsers />} />
          <Route path="/memberships" element={<Memberships />} />
          <Route path="/conflicts" element={<IdentityConflicts />} />
          <Route path="/authz" element={<PlatformAuthz />} />
          <Route path="/integration" element={<IntegrationEvents />} />
          <Route path="/audit" element={<GlobalAudit />} />
          <Route path="/reporting" element={<Reporting />} />
          <Route path="/search" element={<Search />} />
          <Route path="/health" element={<Health />} />
          <Route path="/403" element={<Forbidden />} />

          {/* Fallback */}
          <Route path="*" element={<Navigate to="/dashboard" replace />} />
        </Routes>
      </ErrorBoundary>
    </GlobalSessionProvider>
  );
}

export default App;
