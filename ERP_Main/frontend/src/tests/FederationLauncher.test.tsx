import { describe, it, expect } from "vitest";
import {
  generateRandomString,
  generatePkce,
  validateRedirectUrl,
  buildLaunchUrl,
  savePendingFederation,
  retrievePendingFederation,
} from "../lib/federation";

describe("Federation & SSO Security Utilities", () => {
  it("generates cryptographically random URL-safe strings", () => {
    const str1 = generateRandomString(16);
    const str2 = generateRandomString(16);

    expect(str1).toBeTruthy();
    expect(str2).toBeTruthy();
    expect(str1).not.toBe(str2);
    // Base64URL string should not contain +, /, or =
    expect(str1).not.toMatch(/[+/=]/);
  });

  it("generates valid PKCE code_verifier and code_challenge", async () => {
    const { verifier, challenge } = await generatePkce();

    expect(verifier).toBeTruthy();
    expect(challenge).toBeTruthy();
    expect(verifier.length).toBeGreaterThanOrEqual(40);
    expect(challenge.length).toBeGreaterThanOrEqual(40);
  });

  it("strictly validates redirect URIs and prevents open redirects", () => {
    const trustedOrigins = ["http://localhost:8001", "https://yinglima.example.com"];

    // Valid URLs matching allowed origins
    expect(validateRedirectUrl("http://localhost:8001/auth/callback", trustedOrigins)).toBe(true);
    expect(validateRedirectUrl("https://yinglima.example.com/sso/callback", trustedOrigins)).toBe(true);

    // Open redirect attempts & mismatched origins
    expect(validateRedirectUrl("https://evil.com/callback", trustedOrigins)).toBe(false);
    expect(validateRedirectUrl("http://localhost:8002/auth/callback", trustedOrigins)).toBe(false);
    expect(validateRedirectUrl("javascript:alert(1)", trustedOrigins)).toBe(false);
    expect(validateRedirectUrl("data:text/html,<html>", trustedOrigins)).toBe(false);
    expect(validateRedirectUrl("", trustedOrigins)).toBe(false);
    expect(validateRedirectUrl("not-a-valid-url", trustedOrigins)).toBe(false);
  });

  it("builds secure launch URLs without leaking tokens or credentials", () => {
    const launchUrl = buildLaunchUrl(
      "http://localhost:8001/auth/callback",
      "auth-code-xyz",
      "state-abc-123"
    );

    const url = new URL(launchUrl);
    expect(url.origin).toBe("http://localhost:8001");
    expect(url.pathname).toBe("/auth/callback");
    expect(url.searchParams.get("code")).toBe("auth-code-xyz");
    expect(url.searchParams.get("state")).toBe("state-abc-123");

    // Must never leak access_token, password, or secret in URL
    expect(url.searchParams.get("access_token")).toBeNull();
    expect(url.searchParams.get("token")).toBeNull();
    expect(url.searchParams.get("secret")).toBeNull();
  });

  it("protects against CSRF state tampering via sessionStorage", () => {
    sessionStorage.clear();

    const testState = {
      state: "csrf-state-999",
      nonce: "nonce-888",
      codeVerifier: "pkce-verifier-777",
      erpId: "erp-uuid-1",
      erpKey: "yinglima",
      redirectUri: "http://localhost:8001/auth/callback",
      timestamp: Date.now(),
    };

    savePendingFederation(testState);

    // Forged state rejection
    const forged = retrievePendingFederation("forged-state-000");
    expect(forged).toBeNull();

    // Valid state retrieval
    const retrieved = retrievePendingFederation("csrf-state-999");
    expect(retrieved).not.toBeNull();
    expect(retrieved?.codeVerifier).toBe("pkce-verifier-777");
    expect(retrieved?.erpKey).toBe("yinglima");

    // Single-use check: subsequent retrieval returns null
    const secondTry = retrievePendingFederation("csrf-state-999");
    expect(secondTry).toBeNull();
  });
});
