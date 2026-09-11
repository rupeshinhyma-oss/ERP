/**
 * Error Classification (Phase 2 / Phase 8C, Section 15).
 *
 * A finer-grained category on top of `retryPolicy.ts`'s TEMPORARY/
 * PERMANENT split, deciding what a UI should actually SHOW the user
 * ("temporary errors should be recoverable silently... permanent
 * errors must remain visible and actionable... do not show raw
 * technical stack traces").
 */

import { ApiError, NETWORK_ERROR_STATUS, isAbortError } from "@/lib/api";
import { classifyFailure, type FailureClassification } from "./retryPolicy";

export type ErrorCategory =
  | "NETWORK"
  | "TIMEOUT"
  | "AUTH_SESSION"
  | "AUTHORIZATION"
  | "VALIDATION"
  | "CONFLICT"
  | "SERVER"
  | "UNKNOWN";

export interface ClassifiedError {
  category: ErrorCategory;
  classification: FailureClassification;
  userMessage: string;
  diagnosticMessage: string;
  httpStatus: number | null;
}

const GENERIC_TEMPORARY_MESSAGE = "This couldn't be saved right now. It will be retried automatically.";
const GENERIC_SERVER_MESSAGE = "Something went wrong on our end. This will be retried automatically.";

export function classifyError(error: unknown): ClassifiedError {
  if (isAbortError(error)) {
    return {
      category: "TIMEOUT",
      classification: "TEMPORARY",
      userMessage: GENERIC_TEMPORARY_MESSAGE,
      diagnosticMessage: "Request aborted (timeout or navigation).",
      httpStatus: null,
    };
  }

  if (error instanceof ApiError) {
    const classification = classifyFailure(error);

    if (error.status === NETWORK_ERROR_STATUS) {
      return {
        category: "NETWORK",
        classification,
        userMessage: GENERIC_TEMPORARY_MESSAGE,
        diagnosticMessage: `Network error: ${error.message}`,
        httpStatus: null,
      };
    }
    if (error.status === 401) {
      return {
        category: "AUTH_SESSION",
        classification: "PERMANENT",
        userMessage: "Your session has expired. Please sign in again.",
        diagnosticMessage: `401: ${error.message}`,
        httpStatus: 401,
      };
    }
    if (error.status === 403) {
      return {
        category: "AUTHORIZATION",
        classification: "PERMANENT",
        userMessage: "You don't have permission to do that.",
        diagnosticMessage: `403: ${error.message}`,
        httpStatus: 403,
      };
    }
    if (error.status === 409) {
      return {
        category: "CONFLICT",
        classification: "PERMANENT",
        userMessage: error.message || "This record was changed by someone else. Please refresh and try again.",
        diagnosticMessage: `409: ${error.message}`,
        httpStatus: 409,
      };
    }
    if (error.status === 400 || error.status === 422) {
      return {
        category: "VALIDATION",
        classification: "PERMANENT",
        userMessage: error.message || "Some of the information provided isn't valid.",
        diagnosticMessage: `${error.status}: ${error.message}`,
        httpStatus: error.status,
      };
    }
    if (error.status >= 500) {
      return {
        category: "SERVER",
        classification,
        userMessage: GENERIC_SERVER_MESSAGE,
        diagnosticMessage: `${error.status}: ${error.message}`,
        httpStatus: error.status,
      };
    }
    return {
      category: "UNKNOWN",
      classification,
      userMessage: error.message || "Something went wrong.",
      diagnosticMessage: `${error.status}: ${error.message}`,
      httpStatus: error.status,
    };
  }

  const message = error instanceof Error ? error.message : String(error);
  return {
    category: "UNKNOWN",
    classification: "TEMPORARY",
    userMessage: GENERIC_TEMPORARY_MESSAGE,
    diagnosticMessage: message,
    httpStatus: null,
  };
}
