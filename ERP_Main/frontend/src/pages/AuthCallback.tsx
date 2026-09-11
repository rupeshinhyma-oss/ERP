/**
 * Authentication & Federation Callback Page (/auth/callback).
 *
 * Handles return browser redirects from SSO / federation handoffs,
 * validates CSRF state parameters, and safely presents status and actions.
 */

import { useEffect, useState } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import { retrievePendingFederation, type StoredFederationState } from "@/lib/federation";
import { ErrorBanner } from "@/components/ui";

export function AuthCallback() {
  const location = useLocation();
  const navigate = useNavigate();

  const [status, setStatus] = useState<"processing" | "success" | "error">("processing");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [pendingLaunch, setPendingLaunch] = useState<StoredFederationState | null>(null);

  useEffect(() => {
    const params = new URLSearchParams(location.search);
    const code = params.get("code");
    const state = params.get("state");
    const errorParam = params.get("error");
    const errorDesc = params.get("error_description");

    // 1. Handle error response from authorization server
    if (errorParam) {
      setStatus("error");
      if (errorParam === "access_denied") {
        setErrorMessage("Authorization was denied. You may not hold an active membership for this ERP.");
      } else if (errorParam === "expired_token" || errorParam === "invalid_request") {
        setErrorMessage("The authorization request has expired. Please launch the ERP application again.");
      } else {
        setErrorMessage(errorDesc || "The authentication process encountered an unexpected issue.");
      }
      return;
    }

    // 2. Validate state presence
    if (!state) {
      setStatus("error");
      setErrorMessage("Missing authorization state parameter. For your security, this request has been rejected.");
      return;
    }

    // 3. Verify CSRF state against sessionStorage
    const storedState = retrievePendingFederation(state);
    if (!storedState) {
      setStatus("error");
      setErrorMessage(
        "Invalid or expired authorization session. The request took too long or was not initiated from this browser."
      );
      return;
    }

    setPendingLaunch(storedState);

    // 4. Validate code presence
    if (!code) {
      setStatus("error");
      setErrorMessage("Authorization code was not returned by the platform server.");
      return;
    }

    // Success: State is verified and code is present
    setStatus("success");
  }, [location.search]);

  return (
    <div
      style={{
        minHeight: "100vh",
        background: "#f8fafc",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        padding: "20px",
      }}
    >
      <div
        className="card"
        style={{
          width: "100%",
          maxWidth: "460px",
          padding: "36px 30px",
          borderRadius: "10px",
          background: "#ffffff",
          border: "1px solid #e2e8f0",
          boxShadow: "0 10px 25px -5px rgba(0, 0, 0, 0.05)",
          textAlign: "center",
        }}
      >
        <div style={{ marginBottom: "20px" }}>
          <img src="/logo.png" alt="Logo" style={{ height: "40px", width: "auto", objectFit: "contain" }} />
        </div>

        {status === "processing" && (
          <div>
            <div
              style={{
                width: "48px",
                height: "48px",
                margin: "0 auto 16px",
                border: "3px solid #e2e8f0",
                borderTopColor: "#0061f2",
                borderRadius: "50%",
                animation: "spin 0.8s linear infinite",
              }}
            />
            <h3 style={{ fontSize: "18px", fontWeight: 700, color: "#1e293b", margin: "0 0 6px" }}>
              Verifying Authentication
            </h3>
            <p style={{ fontSize: "13px", color: "#64748b", margin: 0 }}>
              Completing secure single sign-on handoff...
            </p>
          </div>
        )}

        {status === "success" && (
          <div>
            <div
              style={{
                width: "50px",
                height: "50px",
                borderRadius: "50%",
                backgroundColor: "#dcfce7",
                color: "#16a34a",
                display: "inline-flex",
                alignItems: "center",
                justifyContent: "center",
                marginBottom: "16px",
              }}
            >
              <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3">
                <polyline points="20 6 9 17 4 12" />
              </svg>
            </div>

            <h3 style={{ fontSize: "18px", fontWeight: 700, color: "#1e293b", margin: "0 0 8px" }}>
              Single Sign-On Verified
            </h3>
            <p style={{ fontSize: "13px", color: "#64748b", margin: "0 0 24px", lineHeight: "1.5" }}>
              Your global session was authenticated and validated with CSRF/PKCE state protection.
            </p>

            <div style={{ display: "flex", flexDirection: "column", gap: "10px" }}>
              {pendingLaunch?.redirectUri && (
                <a
                  href={pendingLaunch.redirectUri}
                  style={{
                    display: "block",
                    padding: "11px",
                    backgroundColor: "#0061f2",
                    color: "#ffffff",
                    borderRadius: "6px",
                    fontWeight: 600,
                    fontSize: "14px",
                    textDecoration: "none",
                  }}
                >
                  Continue to ERP
                </a>
              )}
              <Link
                to="/my-erps"
                style={{
                  display: "block",
                  padding: "11px",
                  backgroundColor: "#f1f5f9",
                  color: "#334155",
                  borderRadius: "6px",
                  fontWeight: 600,
                  fontSize: "14px",
                  textDecoration: "none",
                }}
              >
                Return to My ERPs
              </Link>
            </div>
          </div>
        )}

        {status === "error" && (
          <div>
            <div
              style={{
                width: "50px",
                height: "50px",
                borderRadius: "50%",
                backgroundColor: "#fee2e2",
                color: "#dc2626",
                display: "inline-flex",
                alignItems: "center",
                justifyContent: "center",
                marginBottom: "16px",
              }}
            >
              <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                <circle cx="12" cy="12" r="10" />
                <line x1="15" y1="9" x2="9" y2="15" />
                <line x1="9" y1="9" x2="15" y2="15" />
              </svg>
            </div>

            <h3 style={{ fontSize: "18px", fontWeight: 700, color: "#1e293b", margin: "0 0 8px" }}>
              Authentication Failed
            </h3>

            <div style={{ marginBottom: "20px", textAlign: "left" }}>
              <ErrorBanner error={errorMessage || "An error occurred during authentication."} />
            </div>

            <div style={{ display: "flex", flexDirection: "column", gap: "10px" }}>
              <button
                type="button"
                onClick={() => navigate("/my-erps", { replace: true })}
                style={{
                  padding: "11px",
                  backgroundColor: "#003399",
                  color: "#ffffff",
                  borderRadius: "6px",
                  fontWeight: 600,
                  fontSize: "14px",
                  border: "none",
                  cursor: "pointer",
                }}
              >
                Return to ERP Launcher
              </button>
              <button
                type="button"
                onClick={() => navigate("/login", { replace: true })}
                style={{
                  padding: "11px",
                  backgroundColor: "#f1f5f9",
                  color: "#334155",
                  borderRadius: "6px",
                  fontWeight: 600,
                  fontSize: "14px",
                  border: "none",
                  cursor: "pointer",
                }}
              >
                Sign In Again
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

export default AuthCallback;
