/**
 * Global Session Provider & Context for ERP_Main.
 *
 * Manages global authentication, active session monitoring, expiration detection,
 * memberships retrieval, and coordinates clean logout across the application.
 */

import React, { createContext, useCallback, useContext, useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { apiGet, apiPost } from "./api";
import { Auth, type CurrentUser } from "./auth";
import type {
  ErpMembership,
  GlobalLoginResponse,
  GlobalUserProfile,
  PlatformAdmin,
  PrincipalType,
  SessionState,
  TokenPair,
} from "@/types";

interface GlobalSessionContextType extends SessionState {
  login: (identifier: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
  refreshSession: () => Promise<void>;
  dismissExpiredModal: () => void;
}

const GlobalSessionContext = createContext<GlobalSessionContextType | undefined>(undefined);

export function GlobalSessionProvider({ children }: { children: React.ReactNode }) {
  const navigate = useNavigate();
  const [currentUser, setCurrentUser] = useState<CurrentUser | null>(() => Auth.getProfile());
  const [userType, setUserType] = useState<PrincipalType | null>(() => Auth.getPrincipalType());
  const [memberships, setMemberships] = useState<ErpMembership[]>([]);
  const [loading, setLoading] = useState<boolean>(true);
  const [sessionExpired, setSessionExpired] = useState<boolean>(false);

  const fetchMemberships = useCallback(async (userId: string) => {
    try {
      const res = await apiGet<ErpMembership[]>(`/global/users/${userId}/memberships`);
      const list = Array.isArray(res) ? res : Array.isArray((res as { data?: unknown })?.data) ? (res as { data: ErpMembership[] }).data : [];
      setMemberships(list);
    } catch {
      // Non-blocking: memberships may be restricted or user may be admin
      setMemberships([]);
    }
  }, []);

  const refreshSession = useCallback(async () => {
    if (!Auth.getAccessToken()) {
      setCurrentUser(null);
      setUserType(null);
      setMemberships([]);
      setLoading(false);
      return;
    }

    setLoading(true);
    const pType = Auth.getPrincipalType() || "global_user";

    try {
      if (pType === "global_user") {
        const resProfile = await apiGet<GlobalUserProfile>("/global/user-auth/me");
        const profile = (resProfile as { data?: GlobalUserProfile })?.data || resProfile;
        if (profile && (profile as GlobalUserProfile).id) {
          setCurrentUser(profile);
          setUserType("global_user");
          Auth.updateProfile(profile);
          await fetchMemberships((profile as GlobalUserProfile).id);
        }
      } else {
        const resProfile = await apiGet<PlatformAdmin>("/global/auth/me");
        const profile = (resProfile as { data?: PlatformAdmin })?.data || resProfile;
        if (profile && (profile as PlatformAdmin).id) {
          setCurrentUser(profile);
          setUserType("platform_admin");
          Auth.updateProfile(profile);
        }
      }
    } catch {
      // Non-blocking background check - maintain existing cached session state until explicit logout
    } finally {
      setLoading(false);
    }
  }, [fetchMemberships]);

  // Initial session hydration
  useEffect(() => {
    refreshSession();
  }, [refreshSession]);

  // Listen for auth store changes
  useEffect(() => {
    const unsubAuth = Auth.subscribe((profile) => {
      setCurrentUser(profile);
      setUserType(Auth.getPrincipalType());
    });

    return () => {
      unsubAuth();
    };
  }, []);

  // Login handler supporting Global Users first, then Platform Admin fallback
  const login = useCallback(
    async (identifier: string, password: string) => {
      const email = identifier.trim();
      let globalUserLoginSuccess = false;

      // 1. Attempt Global User Login
      try {
        const res = await apiPost<GlobalLoginResponse>("/global/user-auth/login", {
          email,
          password,
        });
        const loginData = (res as { data?: GlobalLoginResponse })?.data || res;

        if (loginData?.access_token) {
          Auth.setSession(
            loginData.access_token,
            undefined,
            "global_user",
            loginData.expires_at,
            loginData.session_id
          );

          // Fetch Global User profile
          const resProfile = await apiGet<GlobalUserProfile>("/global/user-auth/me");
          const profile = (resProfile as { data?: GlobalUserProfile })?.data || resProfile;
          Auth.updateProfile(profile);
          setCurrentUser(profile);
          setUserType("global_user");
          setSessionExpired(false);

          if (profile?.id) {
            await fetchMemberships(profile.id);
          }

          globalUserLoginSuccess = true;
          return;
        }
      } catch (err: unknown) {
        // If it's a 401 or 403 or 404, we check whether this is a Platform Administrator
        const status = (err as { status?: number })?.status;
        if (status && status >= 500) {
          // Re-throw server errors
          throw err;
        }
      }

      // 2. Fallback: Attempt Platform Admin Login
      if (!globalUserLoginSuccess) {
        try {
          const res = await apiPost<TokenPair>("/global/auth/login", {
            email,
            password,
          });
          const adminTokens = (res as { data?: TokenPair })?.data || res;

          if (adminTokens?.access_token) {
            Auth.setSession(adminTokens.access_token, undefined, "platform_admin", adminTokens.expires_at);

            // Fetch Platform Admin profile
            const resProfile = await apiGet<PlatformAdmin>("/global/auth/me");
            const adminProfile = (resProfile as { data?: PlatformAdmin })?.data || resProfile;
            Auth.updateProfile(adminProfile);
            setCurrentUser(adminProfile);
            setUserType("platform_admin");
            setSessionExpired(false);
            return;
          }
        } catch (adminErr: unknown) {
          // If platform admin login also fails, throw unified invalid credentials error
          throw adminErr;
        }
      }
    },
    [fetchMemberships]
  );

  // Global logout: revokes backend session and clears client storage
  const logout = useCallback(async () => {
    try {
      if (Auth.getPrincipalType() === "global_user" && Auth.isLoggedIn()) {
        await apiPost("/global/user-auth/logout", {});
      }
    } catch {
      /* ignore server error during logout */
    } finally {
      Auth.clear();
      setCurrentUser(null);
      setUserType(null);
      setMemberships([]);
      setSessionExpired(false);
      navigate("/login", { replace: true });
    }
  }, [navigate]);

  const dismissExpiredModal = useCallback(() => {
    Auth.clear();
    setCurrentUser(null);
    setUserType(null);
    setMemberships([]);
    setSessionExpired(false);
    navigate("/login", { replace: true });
  }, [navigate]);

  const value: GlobalSessionContextType = {
    isAuthenticated: Auth.isLoggedIn(),
    currentUser,
    userType,
    memberships,
    loading,
    sessionExpired,
    isSuperAdmin:
      Auth.isSuperAdmin() ||
      Boolean(currentUser && "role" in currentUser && (currentUser.role === "SUPER_ADMIN" || currentUser.role === "PLATFORM_ADMIN")),
    login,
    logout,
    refreshSession,
    dismissExpiredModal,
  };

  return (
    <GlobalSessionContext.Provider value={value}>
      {children}

      {/* Session Expiration Modal matching ERP visual standards */}
      {sessionExpired && (
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="session-expired-title"
          style={{
            position: "fixed",
            inset: 0,
            zIndex: 9999,
            backgroundColor: "rgba(15, 23, 42, 0.65)",
            backdropFilter: "blur(4px)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            padding: "20px",
          }}
        >
          <div
            style={{
              width: "100%",
              maxWidth: "420px",
              backgroundColor: "#ffffff",
              borderRadius: "10px",
              boxShadow: "0 20px 25px -5px rgba(0, 0, 0, 0.1), 0 8px 10px -6px rgba(0, 0, 0, 0.1)",
              padding: "28px 24px",
              textAlign: "center",
            }}
          >
            <div
              style={{
                width: "52px",
                height: "52px",
                borderRadius: "50%",
                backgroundColor: "#fee2e2",
                color: "#dc2626",
                display: "inline-flex",
                alignItems: "center",
                justifyContent: "center",
                marginBottom: "16px",
              }}
            >
              <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                <circle cx="12" cy="12" r="10" />
                <polyline points="12 6 12 12 16 14" />
              </svg>
            </div>

            <h3 id="session-expired-title" style={{ fontSize: "18px", fontWeight: 700, color: "#0f172a", margin: "0 0 8px" }}>
              Your session has expired.
            </h3>
            <p style={{ fontSize: "14px", color: "#64748b", margin: "0 0 24px", lineHeight: "1.5" }}>
              Please sign in again to continue accessing ERP_Main and your authorized ERP applications.
            </p>

            <button
              type="button"
              id="btn-signin-again"
              onClick={dismissExpiredModal}
              style={{
                width: "100%",
                padding: "12px",
                backgroundColor: "#003399",
                color: "#ffffff",
                fontSize: "14px",
                fontWeight: 700,
                borderRadius: "6px",
                border: "none",
                cursor: "pointer",
                transition: "background 0.2s ease",
              }}
            >
              Sign In Again
            </button>
          </div>
        </div>
      )}
    </GlobalSessionContext.Provider>
  );
}

export function useGlobalSession() {
  const context = useContext(GlobalSessionContext);
  if (!context) {
    throw new Error("useGlobalSession must be used within a GlobalSessionProvider");
  }
  return context;
}
