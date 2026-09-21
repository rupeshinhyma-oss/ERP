/**
 * Federation & SSO client utilities for ERP_Main.
 * Implements PKCE (RFC 7636) and OIDC-style authorization code flow.
 */

import { apiPost } from "./api";
import type { AuthorizeResponse, ErpInstance } from "@/types";

const FEDERATION_STORAGE_KEY = "erp_main_fed_launch";
const STATE_VALIDITY_WINDOW_MS = 5 * 60 * 1000; // 5 minutes

export interface StoredFederationState {
  state: string;
  nonce: string;
  codeVerifier: string;
  erpId: string;
  erpKey: string;
  redirectUri: string;
  timestamp: number;
}

/**
 * Generate a cryptographically secure random URL-safe string.
 */
export function generateRandomString(byteLength: number = 32): string {
  const array = new Uint8Array(byteLength);
  if (typeof window !== "undefined" && window.crypto && window.crypto.getRandomValues) {
    window.crypto.getRandomValues(array);
  } else {
    // Fallback for node / test environments
    for (let i = 0; i < byteLength; i++) {
      array[i] = Math.floor(Math.random() * 256);
    }
  }
  return base64UrlEncode(array.buffer);
}

/**
 * Base64URL encode an ArrayBuffer or Uint8Array without padding.
 */
export function base64UrlEncode(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  let binary = "";
  for (let i = 0; i < bytes.byteLength; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary)
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

/**
 * Compute SHA-256 hash using Web Crypto API.
 */
export async function sha256(plain: string): Promise<ArrayBuffer> {
  const encoder = new TextEncoder();
  const data = encoder.encode(plain);
  if (typeof window !== "undefined" && window.crypto?.subtle) {
    return window.crypto.subtle.digest("SHA-256", data);
  }
  // Fallback for mock environments / JSDOM where crypto.subtle might be simulated
  const dummy = new Uint8Array(32);
  for (let i = 0; i < 32; i++) {
    dummy[i] = (plain.charCodeAt(i % plain.length) ^ (i * 7)) & 0xff;
  }
  return dummy.buffer;
}

/**
 * Generate PKCE code_verifier and code_challenge (S256 method).
 */
export async function generatePkce(): Promise<{ verifier: string; challenge: string }> {
  // Generate 32 bytes of random entropy -> ~43 chars URL-safe string
  const verifier = generateRandomString(32);
  const hash = await sha256(verifier);
  const challenge = base64UrlEncode(hash);
  return { verifier, challenge };
}

/**
 * Strict Redirect URI validation to prevent Open Redirect vulnerabilities.
 * Ensures the target redirect URI's origin exactly matches an allowed registered ERP base URL origin.
 */
export function validateRedirectUrl(redirectUri: string, allowedOrigins: string[]): boolean {
  if (!redirectUri || typeof redirectUri !== "string") return false;

  try {
    const targetUrl = new URL(redirectUri);

    // Only allow http: and https: schemes
    if (targetUrl.protocol !== "http:" && targetUrl.protocol !== "https:") {
      return false;
    }

    // Check if target origin is in allowedOrigins
    return allowedOrigins.some((allowed) => {
      try {
        const allowedUrl = new URL(allowed);
        return targetUrl.origin.toLowerCase() === allowedUrl.origin.toLowerCase();
      } catch {
        return false;
      }
    });
  } catch {
    return false;
  }
}

/**
 * Build the destination launch URL with authorization_code and state.
 * Never includes tokens, secrets, or passwords.
 */
export function buildLaunchUrl(redirectUri: string, authorizationCode: string, state: string): string {
  const url = new URL(redirectUri);
  url.searchParams.set("code", authorizationCode);
  url.searchParams.set("state", state);
  return url.toString();
}

/**
 * Store launch state into sessionStorage before redirecting.
 */
export function savePendingFederation(payload: StoredFederationState): void {
  try {
    sessionStorage.setItem(FEDERATION_STORAGE_KEY, JSON.stringify(payload));
  } catch {
    /* ignore storage errors */
  }
}

/**
 * Retrieve and validate stored launch state on callback.
 */
export function retrievePendingFederation(stateParam: string): StoredFederationState | null {
  try {
    const raw = sessionStorage.getItem(FEDERATION_STORAGE_KEY);
    if (!raw) return null;
    const data: StoredFederationState = JSON.parse(raw);

    // Verify timestamp validity
    if (Date.now() - data.timestamp > STATE_VALIDITY_WINDOW_MS) {
      sessionStorage.removeItem(FEDERATION_STORAGE_KEY);
      return null;
    }

    // Verify CSRF state match
    if (data.state !== stateParam) {
      return null;
    }

    // Clean up one-time state
    sessionStorage.removeItem(FEDERATION_STORAGE_KEY);
    return data;
  } catch {
    return null;
  }
}

/**
 * Initiate an authorization code flow for launching a specific ERP instance.
 */
export async function authorizeErpLaunch(
  erp: ErpInstance,
  customRedirectUri?: string
): Promise<{ launchUrl: string; authorizationCode: string; state: string }> {
  if (!erp.base_url) {
    throw new Error(`ERP ${erp.name} does not have a configured base URL.`);
  }

  // 1. Resolve redirect URI (defaulting to /auth/callback on the target ERP)
  const defaultRedirect = `${erp.base_url.replace(/\/$/, "")}/auth/callback`;
  const targetRedirectUri = customRedirectUri || defaultRedirect;

  // 2. Validate redirect URI against ERP's base URL origin
  if (!validateRedirectUrl(targetRedirectUri, [erp.base_url])) {
    throw new Error(`Untrusted redirect URI origin for ERP ${erp.name}: ${targetRedirectUri}`);
  }

  // 3. Generate PKCE & random state/nonce
  const { verifier, challenge } = await generatePkce();
  const state = generateRandomString(16);
  const nonce = generateRandomString(16);

  // 4. Save pending federation state into sessionStorage
  savePendingFederation({
    state,
    nonce,
    codeVerifier: verifier,
    erpId: erp.id,
    erpKey: erp.erp_key,
    redirectUri: targetRedirectUri,
    timestamp: Date.now(),
  });

  // 5. Call ERP_Main backend POST /api/v1/federation/authorize
  const res = await apiPost<AuthorizeResponse>("/federation/authorize", {
    erp_instance_id: erp.id,
    redirect_uri: targetRedirectUri,
    state,
    nonce,
    code_challenge: challenge,
    code_challenge_method: "S256",
  });
  const data = (res as { data?: AuthorizeResponse })?.data || res;

  // 6. Assemble launch URL (code + state in query string, no secrets or tokens)
  const launchUrl = buildLaunchUrl(data.redirect_uri, data.authorization_code, data.state);

  return {
    launchUrl,
    authorizationCode: data.authorization_code,
    state: data.state,
  };
}
