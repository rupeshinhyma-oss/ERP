import { describe, it, expect, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { AuthCallback } from "../pages/AuthCallback";
import { savePendingFederation } from "../lib/federation";

describe("AuthCallback Page", () => {
  beforeEach(() => {
    localStorage.clear();
    sessionStorage.clear();
  });

  it("rejects callback missing state parameter", () => {
    render(
      <MemoryRouter initialEntries={["/auth/callback?code=test-code"]}>
        <AuthCallback />
      </MemoryRouter>
    );

    expect(screen.getByText("Authentication Failed")).toBeDefined();
    expect(
      screen.getByText("Missing authorization state parameter. For your security, this request has been rejected.")
    ).toBeDefined();
  });

  it("rejects untracked or expired state parameter", () => {
    render(
      <MemoryRouter initialEntries={["/auth/callback?code=test-code&state=unknown-state"]}>
        <AuthCallback />
      </MemoryRouter>
    );

    expect(screen.getByText("Authentication Failed")).toBeDefined();
    expect(
      screen.getByText(
        "Invalid or expired authorization session. The request took too long or was not initiated from this browser."
      )
    ).toBeDefined();
  });

  it("handles authorization server error parameters gracefully", () => {
    render(
      <MemoryRouter initialEntries={["/auth/callback?error=access_denied"]}>
        <AuthCallback />
      </MemoryRouter>
    );

    expect(screen.getByText("Authentication Failed")).toBeDefined();
    expect(
      screen.getByText(
        "Authorization was denied. You may not hold an active membership for this ERP."
      )
    ).toBeDefined();
  });

  it("successfully displays verified state for valid callback and state", () => {
    savePendingFederation({
      state: "valid-state-123",
      nonce: "nonce-123",
      codeVerifier: "verifier-123",
      erpId: "erp-1",
      erpKey: "yinglima",
      redirectUri: "http://localhost:8001/auth/callback",
      timestamp: Date.now(),
    });

    render(
      <MemoryRouter initialEntries={["/auth/callback?code=auth-code-777&state=valid-state-123"]}>
        <AuthCallback />
      </MemoryRouter>
    );

    expect(screen.getByText("Single Sign-On Verified")).toBeDefined();
    expect(
      screen.getByText(
        "Your global session was authenticated and validated with CSRF/PKCE state protection."
      )
    ).toBeDefined();
    expect(screen.getByText("Continue to ERP")).toBeDefined();
  });
});
