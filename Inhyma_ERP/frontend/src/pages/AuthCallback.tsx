/**
 * Federation SSO Callback — the browser lands here after ERP_Main's
 * `/federation/authorize` redirects it with `?code=...&state=...`.
 *
 * This page never sees this ERP's `client_secret` and never sees the
 * raw federation `id_token`. It only holds the short-lived, single-use
 * authorization `code`, which it hands to this ERP's OWN backend
 * (`POST /federation/exchange`) to complete server-to-server. That
 * backend call is the only place the secret and the id_token exist.
 *
 * Works identically for every authorized user, including Platform
 * Super Admins — ERP_Main only ever issues a `code` after checking a
 * real Global User session and an ACTIVE membership for this ERP, so
 * there is nothing special-cased here based on role.
 */

import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { apiPost } from "@/lib/api";
import { Auth } from "@/lib/auth";
import { processIncomingSsoHandover } from "@/lib/ssoBridge";
import type { TokenPair } from "@/types";

const REDIRECT_STATE_KEY = "ihm_fed_callback_state";

export function AuthCallbackPage() {
  const navigate = useNavigate();
  const [error, setError] = useState<string | null>(null);
  const ranOnce = useRef(false);

  useEffect(() => {
    // Guard against React 18 StrictMode's double-invoke in dev, and
    // against this effect re-running on a route re-render: the
    // authorization code is single-use, so a second exchange attempt
    // with the same code would always fail and could mask the first
    // (successful) attempt's result with a confusing error.
    if (ranOnce.current) return;
    ranOnce.current = true;

    const params = new URLSearchParams(window.location.search);
    const code = params.get("code");
    const state = params.get("state");
    const ssoHandover = params.get("sso_handover");

    // Clean the code/state out of the visible URL and history
    // immediately, regardless of outcome, so a bookmark, browser-back,
    // or shoulder-surf never re-exposes a (possibly still momentarily
    // valid) authorization code.
    const cleanUrl = `${window.location.pathname}${window.location.hash}`;
    window.history.replaceState(null, "", cleanUrl);

    // Support fallback for legacy handover payload if ever sent to /auth/callback
    if (!code && ssoHandover) {
      processIncomingSsoHandover().then((result) => {
        if (result === "logged-in" || result === "already-logged-in") {
          navigate("/dashboard", { replace: true });
        } else {
          setError("Single sign-on handover ticket is invalid, expired, or unauthorized.");
        }
      });
      return;
    }

    if (!code) {
      setError("This sign-in link is missing its authorization code. Please launch this ERP again from the ERP Switcher.");
      return;
    }

    // Optional lightweight state echo for CSRF audit tracking
    if (state) {
      try {
        sessionStorage.setItem(REDIRECT_STATE_KEY, state);
      } catch {
        /* ignore storage errors */
      }
    }

    const redirectUri = `${window.location.origin}/auth/callback`;

    (async () => {
      try {
        const { data: tokens } = await apiPost<TokenPair>("/federation/exchange", {
          code,
          redirect_uri: redirectUri,
        });

        if (tokens.user) {
          Auth.setSession(tokens, tokens.user);
        } else {
          Auth.setSession(tokens);
        }

        navigate("/dashboard", { replace: true });
      } catch (err) {
        const message =
          err && typeof err === "object" && "message" in err
            ? String((err as { message?: unknown }).message)
            : "Could not complete sign-in from the ERP Switcher. Please try launching this ERP again.";
        setError(message);
      }
    })();
  }, [navigate]);

  if (error) {
    return (
      <div
        style={{
          minHeight: "100vh",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          background: "#f8fafc",
          padding: "24px",
        }}
      >
        <div
          style={{
            maxWidth: "440px",
            textAlign: "center",
            background: "#ffffff",
            border: "1px solid #fecaca",
            borderRadius: "10px",
            padding: "32px 28px",
            boxShadow: "0 1px 3px rgba(0,0,0,0.05)",
          }}
        >
          <div style={{ fontSize: "15px", fontWeight: 700, color: "#dc2626", marginBottom: "8px" }}>
            Sign-in didn't complete
          </div>
          <div style={{ fontSize: "13px", color: "#64748b", lineHeight: 1.5, marginBottom: "20px" }}>{error}</div>
          <a
            href="/login"
            style={{
              display: "inline-block",
              padding: "9px 18px",
              fontSize: "13px",
              fontWeight: 600,
              color: "#ffffff",
              background: "#0061f2",
              borderRadius: "6px",
              textDecoration: "none",
            }}
          >
            Go to Login
          </a>
        </div>
      </div>
    );
  }

  return (
    <div
      style={{
        minHeight: "100vh",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        background: "#f8fafc",
      }}
    >
      <div style={{ textAlign: "center" }}>
        <div
          style={{
            width: 36,
            height: 36,
            margin: "0 auto 16px",
            border: "3px solid #e2e8f0",
            borderTopColor: "#0284c7",
            borderRadius: "50%",
            animation: "spin 0.8s linear infinite",
          }}
        />
        <div style={{ fontSize: 14, color: "#64748b", fontWeight: 500 }}>Signing you in…</div>
      </div>
    </div>
  );
}

export default AuthCallbackPage;
