/**
 * Centralized API Client for ERP_Main Control Plane.
 *
 * All network calls funnel through here. Automatically attaches the
 * Bearer token from Auth and normalizes API error responses.
 */

import { Auth } from "./auth";
import type { ApiResponse } from "@/types";

export const API_BASE = "/api/v1";

export class ApiError extends Error {
  status: number;
  code?: string;
  details?: unknown;
  requestId?: string;

  constructor(message: string, status: number, code?: string, details?: unknown, requestId?: string) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.code = code;
    this.details = details;
    this.requestId = requestId;
  }
}

export function isAbortError(err: unknown): boolean {
  return (
    (err instanceof DOMException && err.name === "AbortError") ||
    (err instanceof Error && err.name === "AbortError")
  );
}

export function errorMessage(err: unknown, fallback = "An unexpected error occurred."): string {
  if (!err) return fallback;
  if (typeof err === "string") return err;
  if (err instanceof ApiError) return err.message;
  if (err instanceof Error) return err.message;
  return fallback;
}

let unauthorizedHandler: (() => void) | null = null;

export function setUnauthorizedHandler(handler: (() => void) | null): void {
  unauthorizedHandler = handler;
}

export function invokeUnauthorizedHandler(): void {
  if (unauthorizedHandler) {
    unauthorizedHandler();
  }
}

interface RequestOptions extends RequestInit {
  timeoutMs?: number;
}

async function request<T>(endpoint: string, options: RequestOptions = {}): Promise<T> {
  const { timeoutMs = 30000, ...fetchOptions } = options;

  const url = endpoint.startsWith("http")
    ? endpoint
    : `${API_BASE}${endpoint.startsWith("/") ? endpoint : `/${endpoint}`}`;

  const headers = new Headers(fetchOptions.headers || {});
  if (!headers.has("Content-Type") && !(fetchOptions.body instanceof FormData)) {
    headers.set("Content-Type", "application/json");
  }

  const token = Auth.getAccessToken();
  if (token && !headers.has("Authorization")) {
    headers.set("Authorization", `Bearer ${token}`);
  }

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

  if (fetchOptions.signal) {
    fetchOptions.signal.addEventListener("abort", () => controller.abort());
  }

  try {
    const response = await fetch(url, {
      ...fetchOptions,
      headers,
      signal: controller.signal,
    });

    clearTimeout(timeoutId);

    if (response.status === 401) {
      // Sessions persist until explicit user logout - do not clear or force expired modal
      throw new ApiError("Unauthorized request.", 401, "UNAUTHORIZED");
    }

    if (response.status === 204) {
      return null as unknown as T;
    }

    const contentType = response.headers.get("content-type") || "";
    const isJson = contentType.includes("application/json");

    if (!response.ok) {
      let errorMsg = `Request failed with status ${response.status}`;
      let errorCode = "HTTP_ERROR";
      let errorDetails: unknown = null;
      let reqId: string | undefined;

      if (isJson) {
        try {
          const body = (await response.json()) as ApiResponse<unknown>;
          reqId = body.request_id;
          if (body.error) {
            errorMsg = body.error.message || errorMsg;
            errorCode = body.error.code || errorCode;
            errorDetails = body.error.details;
          } else if (body.message) {
            errorMsg = body.message;
          }
        } catch {
          // ignore json parse error
        }
      }

      throw new ApiError(errorMsg, response.status, errorCode, errorDetails, reqId);
    }

    if (!isJson) {
      return (await response.text()) as unknown as T;
    }

    const json = (await response.json()) as ApiResponse<T> | T;
    if (json && typeof json === "object" && "data" in json && "success" in json) {
      return (json as ApiResponse<T>).data;
    }

    return json as T;
  } catch (err: unknown) {
    clearTimeout(timeoutId);
    if (isAbortError(err)) {
      throw err;
    }
    if (err instanceof ApiError) {
      throw err;
    }
    throw new ApiError(errorMessage(err), 0, "NETWORK_ERROR");
  }
}

export async function apiGet<T>(endpoint: string, options?: RequestOptions): Promise<T> {
  return request<T>(endpoint, { ...options, method: "GET" });
}

export async function apiPost<T>(endpoint: string, body?: unknown, options?: RequestOptions): Promise<T> {
  return request<T>(endpoint, {
    ...options,
    method: "POST",
    body: body ? JSON.stringify(body) : undefined,
  });
}

export async function apiPatch<T>(endpoint: string, body?: unknown, options?: RequestOptions): Promise<T> {
  return request<T>(endpoint, {
    ...options,
    method: "PATCH",
    body: body ? JSON.stringify(body) : undefined,
  });
}

export async function apiDelete<T>(endpoint: string, options?: RequestOptions): Promise<T> {
  return request<T>(endpoint, { ...options, method: "DELETE" });
}
