/**
 * Sign-in page. Exact replica of INHYMA ERP Login Page.
 */

import { useEffect, useRef, useState } from "react";
import { Link, Navigate, useNavigate } from "react-router-dom";
import { ApiError, apiGet, apiPost, isAbortError, isNetworkError } from "@/lib/api";
import { Auth } from "@/lib/auth";
import { setBrandName, getCachedBrandLogo, setBrandLogo, resolveImageUrl, subscribeBrandLogo } from "@/lib/brand";
import { controlPlaneUrl, createSsoHandoverUrlFromSession, processIncomingSsoHandover, routeForCentralSession } from "@/lib/ssoBridge";
import { ErrorBanner } from "@/components/ui";
import type { Profile, TokenPair } from "@/types";

const DEFAULT_LOGIN_BRAND = "ERP Portal";

interface PublicOrgInfo {
  company_name: string;
  legal_name?: string | null;
  logo_url?: string | null;
  logo_data?: string | null;
}

function EyeIcon({ visible }: { visible: boolean }) {
  return visible ? (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} width={18} height={18}>
      <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24" />
      <line x1="1" y1="1" x2="23" y2="23" />
    </svg>
  ) : (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} width={18} height={18}>
      <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
      <circle cx="12" cy="12" r="3" />
    </svg>
  );
}

/** Vector illustration matching INHYMA ERP login screen: woman working on laptop at desk with chat bubbles */
function LoginIllustration() {
  return (
    <img
      src="/login-illustration.png"
      alt="ERP Login Illustration"
      style={{
        width: "100%",
        maxWidth: "400px",
        height: "auto",
        objectFit: "contain",
        display: "block",
      }}
    />
  );
}

const BRAND_CACHE_KEY = "erp_brand_name";

import { establishCentralEcosystemSession, setEcosystemCookie } from "@/lib/ecosystemSession";

export function LoginPage() {
  const navigate = useNavigate();
  const [brand, setBrand] = useState(() => {
    try {
      return localStorage.getItem(BRAND_CACHE_KEY) || DEFAULT_LOGIN_BRAND;
    } catch {
      return DEFAULT_LOGIN_BRAND;
    }
  });
  const [identifier, setIdentifier] = useState("");
  const [password, setPassword] = useState("");
  const [passwordVisible, setPasswordVisible] = useState(false);
  const [rememberMe, setRememberMe] = useState(true);
  const [error, setError] = useState<unknown>(null);
  const [submitting, setSubmitting] = useState(false);
  const [signingIn, setSigningIn] = useState(() => {
    try {
      return sessionStorage.getItem("ihm_handover_pending") === "1";
    } catch {
      return false;
    }
  });
  const [brandLogo, setBrandLogoState] = useState<string | null>(() => getCachedBrandLogo());
  const [forgotOpen, setForgotOpen] = useState(false);
  const [forgotIdentifier, setForgotIdentifier] = useState("");
  const [forgotSubmitting, setForgotSubmitting] = useState(false);
  const [forgotMessage, setForgotMessage] = useState<string | null>(null);
  const [forgotError, setForgotError] = useState<unknown>(null);
  const identifierRef = useRef<HTMLInputElement>(null);
  const noticeProtectedUntilRef = useRef<number>(0);

  useEffect(() => {
    return subscribeBrandLogo(setBrandLogoState);
  }, []);

  useEffect(() => {
    let cancelled = false;
    document.title = `Sign In - ${brand}`;

    // Fast background pre-warm & brand check
    (async () => {
      try {
        const { data } = await apiGet<PublicOrgInfo>("/organizations/public");
        if (cancelled || !data) return;
        if (data.company_name) {
          setBrand(data.company_name);
          setBrandName(data.company_name);
          try {
            localStorage.setItem(BRAND_CACHE_KEY, data.company_name);
          } catch {
            /* ignore */
          }
          document.title = `Sign In - ${data.company_name}`;
        }
        const logo = data.logo_url || data.logo_data || null;
        if (logo) {
          setBrandLogo(logo);
          setBrandLogoState(logo);
        }
      } catch {
        /* fallback to default */
      }
    })();

    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    identifierRef.current?.focus();
    // If an automatic sign-in (switching ERPs) could not complete, say why instead of showing a bare login page.
    try {
      const notice = sessionStorage.getItem("ihm_login_notice");
      if (notice) {
        sessionStorage.removeItem("ihm_login_notice");
        noticeProtectedUntilRef.current = Date.now() + 1000;
        setError(new Error(notice));
      }
    } catch {
      /* storage unavailable */
    }
    processIncomingSsoHandover().then((result) => {
      setSigningIn(false);
      // Unlike AppShell/App, being on the Login page itself means either
      // outcome ("logged-in" or "already-logged-in") should move on to
      // /dashboard -- there's no reason to stay on the login form once we
      // know the user is authenticated either way.
      if (result === "logged-in" || result === "already-logged-in") {
        navigate("/dashboard", { replace: true });
      }
    });
  }, [navigate]);

  if (Auth.isLoggedIn()) {
    return <Navigate to="/dashboard" replace />;
  }

  if (signingIn) {
    return (
      <div
        role="status"
        style={{ minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center", background: "#f8fafc", color: "#334155", fontFamily: "inherit" }}
      >
        <div style={{ textAlign: "center" }}>
          <div style={{ fontSize: "18px", fontWeight: 600 }}>Signing you in…</div>
          <div style={{ marginTop: "6px", fontSize: "13px", color: "#64748b" }}>Connecting to the ERP. This can take a few seconds.</div>
        </div>
      </div>
    );
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!identifier.trim() || !password) return;

    if (typeof sessionStorage !== "undefined") {
      sessionStorage.removeItem("ihm_explicit_logout");
    }

    noticeProtectedUntilRef.current = 0;
    setError(null);
    setSubmitting(true);

    const ERP_KEY = "inhyma";
    const typed = identifier.trim();
    const email = typed.includes("@") ? typed : `${typed}@example.com`;

    try {
      // 1. Local sign-in on THIS ERP (works for anyone provisioned here).
      //    Guard with a 15s timeout so a hung/restarting backend never freezes "Signing In..." forever.
      let tokens: TokenPair | null = null;
      let localError: unknown = null;
      let backendUnreachable = false;
      const loginController = typeof AbortController !== "undefined" ? new AbortController() : null;
      const loginTimer = loginController ? setTimeout(() => loginController.abort(), 15_000) : null;
      try {
        const { data } = await apiPost<TokenPair>(
          "/auth/login",
          { identifier: typed, password },
          loginController ? { signal: loginController.signal } : {},
        );
        tokens = data;
      } catch (e) {
        if (isAbortError(e)) {
          backendUnreachable = true;
          localError = new Error(
            "Inhyma ERP backend service timed out. Please ensure the backend server is running and try again.",
          );
        } else {
          backendUnreachable =
            isNetworkError(e) || (e instanceof ApiError && e.status >= 500);
          localError = e;
        }
      } finally {
        if (loginTimer) clearTimeout(loginTimer);
      }

      // 2. Ask ERP_Main who this person is and which ERPs they may use.
      //    If the ERP already opened THIS login's central session (session_mode "central"), just read it: its id is
      //    inside the tokens, so signing out later ends exactly this login.  Otherwise (ERP_Main was unreachable for
      //    the ERP, or the local password did not match) fall back to proving identity with the password, as before.
      //    Every password login is its own session: a session id of another login is never reused.
      let central: Awaited<ReturnType<typeof establishCentralEcosystemSession>> = null;
      if (tokens?.session_mode === "central" && tokens.session_id) {
        central = await establishCentralEcosystemSession({
          email,
          source_erp: ERP_KEY,
          existing_session_id: tokens.session_id,
        });
      }
      if (!central) {
        central = await establishCentralEcosystemSession({ email, password, source_erp: ERP_KEY });
      }

      if (central) {
        const route = routeForCentralSession(ERP_KEY, central);
        if (route.kind === "redirect") {
          // Not an ERP they were granted (or they have several / none): send them where they belong.
          window.location.href = route.url;
          return;
        }
        if (route.kind === "none") {
          // No ERP access (or no known address for where they belong): the ERP Dashboard -- never a guessed address.
          const dashboard = controlPlaneUrl(central);
          if (!dashboard) {
            throw new Error("This account cannot open this ERP, and the ERP Dashboard address is not configured. Please contact your administrator.");
          }
          window.location.href = createSsoHandoverUrlFromSession(dashboard, central);
          return;
        }
        // This ERP is allowed.  If the local password did not match (for example a password change that has
        // not reached this ERP yet) the verified central session is enough: sign in through the handover.
        // However, if THIS ERP's backend itself was unreachable/timed out/5xx, redirecting into sso-handover on
        // this same origin will fail on the same unreachable backend and bounce right back to /login.
        if (!tokens) {
          if (backendUnreachable) {
            throw (
              localError ??
              new Error("Inhyma ERP backend service is currently unavailable. Please try again.")
            );
          }
          window.location.href = createSsoHandoverUrlFromSession(`${window.location.origin}/dashboard`, central);
          return;
        }
      }
      if (!tokens) throw localError ?? new Error("Invalid credentials.");

      const sessionId =
        central?.session_id ||
        (tokens.session_mode === "central" ? tokens.session_id : undefined) ||
        `ihm-sess-${Date.now()}`;
      let resolvedProfile: Profile | undefined = tokens.user;
      if (tokens.user) {
        Auth.setSession(tokens, tokens.user, sessionId);
      } else {
        Auth.setSession(tokens, undefined, sessionId);
        try {
          const { data: profile } = await apiGet<Profile>("/auth/profile");
          resolvedProfile = profile;
          Auth.updateProfile(profile);
        } catch {
          /* navigate to dashboard regardless */
        }
      }

      if (!central) {
        const resolvedDisplayName =
          resolvedProfile?.display_name ||
          resolvedProfile?.full_name ||
          [resolvedProfile?.first_name, resolvedProfile?.last_name].filter(Boolean).join(" ").trim() ||
          resolvedProfile?.email ||
          email;
        const sessionData = {
          session_id: sessionId,
          email: resolvedProfile?.email || email,
          display_name: resolvedDisplayName,
          role: (resolvedProfile?.role === "super_admin" ? "super_admin" : "admin") as any,
          user_type: (resolvedProfile?.role === "super_admin" ? "platform_admin" : "global_user") as any,
          allowed_erps: ["inhyma"],
        };
        setEcosystemCookie(sessionData);
      }

      navigate("/dashboard", { replace: true });
    } catch (err) {
      setError(err);
      setSubmitting(false);
    }
  }

  async function handleForgotSubmit(e: React.FormEvent) {
    e.preventDefault();
    const cleanId = forgotIdentifier.trim();
    if (!cleanId) {
      setForgotError(new Error("Please enter your username or email."));
      return;
    }
    setForgotSubmitting(true);
    setForgotError(null);
    try {
      const res = await apiPost<{ message?: string }>("/auth/forgot-password", {
        identifier: cleanId,
      });
      setForgotMessage(
        res?.data?.message ||
          "If an account matches that username or email, an administrator has been notified to reset your password."
      );
    } catch (err) {
      setForgotError(err);
    } finally {
      setForgotSubmitting(false);
    }
  }

  return (
    <div style={{ minHeight: "100vh", width: "100%", background: "#f8fafc", display: "flex", flexDirection: "column" }}>
      {/* Top Header Logo */}
      <header style={{ padding: "10px 32px", background: "#ffffff", borderBottom: "1px solid #e2e8f0", display: "flex", alignItems: "center" }}>
        <Link to="/dashboard" style={{ display: "inline-flex", alignItems: "center", textDecoration: "none", cursor: "pointer" }}>
          <img
            src={resolveImageUrl(brandLogo) || "/logo.png"}
            alt={`${brand || "ERP"} Logo`}
            crossOrigin="anonymous"
            onError={(e) => {
              if (e.currentTarget.src !== window.location.origin + "/logo.png") {
                e.currentTarget.src = "/logo.png";
              }
            }}
            style={{ height: "40px", width: "auto", maxWidth: "200px", objectFit: "contain" }}
          />
        </Link>
      </header>

      {/* Main Login Content */}
      <div style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center", padding: "clamp(24px, 5vw, 40px) clamp(20px, 5vw, 60px)", boxSizing: "border-box" }}>
        <div style={{ width: "100%", maxWidth: "1350px", display: "flex", alignItems: "center", justifyContent: "space-between", gap: "clamp(32px, 8vw, 160px)", flexWrap: "wrap" }}>

          {/* Left Illustration Pane */}
          <div style={{ flex: 1, minWidth: "min(320px, 100%)", display: "flex", justifyContent: "center" }}>
            <LoginIllustration />
          </div>

          {/* Right Sign In Form Pane */}
          <div style={{ width: "100%", maxWidth: "380px", background: "transparent", padding: "0", borderRadius: "0", boxShadow: "none", border: "none" }}>
            <h2 style={{ fontSize: "24px", fontWeight: 800, color: "#1e293b", margin: "0 0 6px" }}>Sign In</h2>
            <p style={{ fontSize: "13px", color: "#64748b", margin: "0 0 24px" }}>Welcome Back! Please Signin To Continue.</p>

            <ErrorBanner error={error} />

            <form onSubmit={handleSubmit}>
              <div style={{ marginBottom: "18px" }}>
                <label htmlFor="identifier" style={{ display: "block", fontSize: "13px", fontWeight: "600", color: "#334155", marginBottom: "6px" }}>
                  Username, Email or Mobile Number
                </label>
                <input
                  ref={identifierRef}
                  id="identifier"
                  type="text"
                  placeholder="Username, email, or mobile number"
                  autoComplete="username"
                  required
                  style={{ width: "100%", padding: "10px 14px", fontSize: "14px", borderRadius: "6px", border: "1px solid #cbd5e1", outline: "none" }}
                  value={identifier}
                  onChange={(e) => {
                    setIdentifier(e.target.value);
                    if (error && Date.now() >= noticeProtectedUntilRef.current) setError(null);
                  }}
                />
              </div>

              <div style={{ marginBottom: "18px" }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "6px" }}>
                  <label htmlFor="password" style={{ fontSize: "13px", fontWeight: "600", color: "#334155" }}>
                    Password
                  </label>
                  <a
                    href="#forgot-password"
                    onClick={(e) => {
                      e.preventDefault();
                      setForgotIdentifier(identifier.trim());
                      setForgotMessage(null);
                      setForgotError(null);
                      setForgotOpen(true);
                    }}
                    style={{ fontSize: "12px", color: "#0061f2", fontWeight: 600, textDecoration: "none" }}
                  >
                    Forgot Password?
                  </a>
                </div>
                <div style={{ position: "relative", display: "flex", alignItems: "center" }}>
                  <input
                    id="password"
                    type={passwordVisible ? "text" : "password"}
                    placeholder="Enter your password"
                    required
                    style={{ width: "100%", padding: "10px 40px 10px 14px", fontSize: "14px", borderRadius: "6px", border: "1px solid #cbd5e1", outline: "none" }}
                    value={password}
                    onChange={(e) => {
                      setPassword(e.target.value);
                      if (error && Date.now() >= noticeProtectedUntilRef.current) setError(null);
                    }}
                  />
                  <button
                    type="button"
                    onClick={() => setPasswordVisible((v) => !v)}
                    style={{ position: "absolute", right: "12px", background: "none", border: "none", color: "#64748b", cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center" }}
                  >
                    <EyeIcon visible={passwordVisible} />
                  </button>
                </div>
              </div>

              <div style={{ display: "flex", alignItems: "center", marginBottom: "24px" }}>
                <label style={{ display: "flex", alignItems: "center", gap: "8px", cursor: "pointer", fontSize: "13px", color: "#475569" }}>
                  <input
                    type="checkbox"
                    checked={rememberMe}
                    onChange={(e) => setRememberMe(e.target.checked)}
                    style={{ width: "16px", height: "16px", borderRadius: "4px" }}
                  />
                  Remember Me
                </label>
              </div>

              <button
                type="submit"
                disabled={submitting}
                style={{
                  width: "100%",
                  padding: "12px",
                  background: submitting ? "#1e40af" : "#003399",
                  color: "#ffffff",
                  fontSize: "14px",
                  fontWeight: 700,
                  border: "none",
                  borderRadius: "6px",
                  cursor: submitting ? "not-allowed" : "pointer",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  gap: "8px",
                  transition: "background 0.2s ease",
                }}
              >
                {submitting ? (
                  <>
                    <svg
                      width="16"
                      height="16"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="2.5"
                      style={{ animation: "spin 0.8s linear infinite" }}
                    >
                      <path d="M21 12a9 9 0 1 1-6.219-8.56" />
                    </svg>
                    <span>Signing In...</span>
                  </>
                ) : (
                  "Sign In"
                )}
              </button>
            </form>
          </div>
        </div>
      </div>

      {forgotOpen && (
        <div
          role="dialog"
          aria-modal="true"
          aria-label="Reset Password"
          style={{
            position: "fixed",
            inset: 0,
            background: "rgba(15, 23, 42, 0.45)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            padding: "16px",
            zIndex: 9999,
          }}
        >
          <div
            style={{
              width: "100%",
              maxWidth: "400px",
              background: "#ffffff",
              borderRadius: "10px",
              border: "1px solid #e2e8f0",
              padding: "24px",
              boxShadow: "0 20px 40px rgba(15,23,42,0.18)",
            }}
          >
            <h3 style={{ margin: "0 0 6px", fontSize: "18px", fontWeight: 700, color: "#1e293b" }}>
              Reset Password
            </h3>
            <p style={{ margin: "0 0 16px", fontSize: "13px", color: "#64748b", lineHeight: 1.5 }}>
              Enter your username or email to notify your administrator for a password reset.
            </p>
            <ErrorBanner error={forgotError} />
            {forgotMessage ? (
              <div
                role="status"
                style={{
                  padding: "12px 14px",
                  borderRadius: "8px",
                  background: "#f0fdf4",
                  border: "1px solid #bbf7d0",
                  color: "#166534",
                  fontSize: "13px",
                  lineHeight: 1.5,
                  marginBottom: "16px",
                }}
              >
                {forgotMessage}
              </div>
            ) : (
              <form onSubmit={handleForgotSubmit}>
                <label
                  htmlFor="forgot-identifier"
                  style={{ display: "block", fontSize: "13px", fontWeight: 600, color: "#334155", marginBottom: "6px" }}
                >
                  Username or Email
                </label>
                <input
                  id="forgot-identifier"
                  type="text"
                  required
                  value={forgotIdentifier}
                  onChange={(e) => setForgotIdentifier(e.target.value)}
                  placeholder="Enter username or email"
                  style={{
                    width: "100%",
                    padding: "10px 12px",
                    fontSize: "14px",
                    borderRadius: "6px",
                    border: "1px solid #cbd5e1",
                    boxSizing: "border-box",
                    marginBottom: "16px",
                  }}
                />
                <div style={{ display: "flex", justifyContent: "flex-end", gap: "8px" }}>
                  <button
                    type="button"
                    onClick={() => setForgotOpen(false)}
                    style={{
                      padding: "8px 14px",
                      fontSize: "13px",
                      fontWeight: 600,
                      borderRadius: "6px",
                      border: "1px solid #cbd5e1",
                      background: "#ffffff",
                      color: "#475569",
                      cursor: "pointer",
                    }}
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    disabled={forgotSubmitting}
                    style={{
                      padding: "8px 16px",
                      fontSize: "13px",
                      fontWeight: 700,
                      borderRadius: "6px",
                      border: "none",
                      background: "#003399",
                      color: "#ffffff",
                      cursor: forgotSubmitting ? "wait" : "pointer",
                    }}
                  >
                    {forgotSubmitting ? "Submitting..." : "Send Reset Request"}
                  </button>
                </div>
              </form>
            )}
            {forgotMessage && (
              <div style={{ display: "flex", justifyContent: "flex-end" }}>
                <button
                  type="button"
                  onClick={() => setForgotOpen(false)}
                  style={{
                    padding: "8px 16px",
                    fontSize: "13px",
                    fontWeight: 700,
                    borderRadius: "6px",
                    border: "none",
                    background: "#003399",
                    color: "#ffffff",
                    cursor: "pointer",
                  }}
                >
                  Done
                </button>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Footer */}
      <footer style={{ padding: "16px clamp(20px, 5vw, 40px)", borderTop: "1px solid #e2e8f0", background: "#ffffff", fontSize: "12px", color: "#64748b", textTransform: "uppercase" }}>
        © 2026 CREATED BY <span style={{ fontWeight: 700, color: "#0061f2" }}>INHYMA</span>
      </footer>
    </div>
  );
}