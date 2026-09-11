/**
 * Connectivity Manager (Phase 2 / Phase 8C, Section 5).
 *
 * Combines `navigator.onLine` with an active `/health/live` probe into
 * one reliable application-level state.
 *
 * States:
 * - ONLINE: browser reports online AND API probe succeeded.
 * - DEGRADED: browser reports online, but API probe failed.
 * - OFFLINE: browser reports offline.
 * - RECONNECTING: probe is currently in flight after prior offline/degraded.
 */

import { API_BASE, isNetworkError } from "@/lib/api";

export type ConnectivityState = "ONLINE" | "DEGRADED" | "OFFLINE" | "RECONNECTING";

type ConnectivityListener = (state: ConnectivityState) => void;

const PROBE_TIMEOUT_MS = 5000;
const HEALTH_PATH = "/health/live";

class ConnectivityManager {
  private state: ConnectivityState = typeof navigator !== "undefined" && navigator.onLine ? "ONLINE" : "OFFLINE";
  private readonly listeners = new Set<ConnectivityListener>();
  private probeInFlight: Promise<boolean> | null = null;
  private started = false;

  /** Wire up browser event listeners and run the first reachability probe. Safe to call multiple times. */
  start(): void {
    if (this.started || typeof window === "undefined") return;
    this.started = true;

    window.addEventListener("online", this.handleBrowserOnline);
    window.addEventListener("offline", this.handleBrowserOffline);

    if (navigator.onLine) {
      void this.probeNow();
    } else {
      this.setState("OFFLINE");
    }
  }

  stop(): void {
    if (!this.started) return;
    this.started = false;
    window.removeEventListener("online", this.handleBrowserOnline);
    window.removeEventListener("offline", this.handleBrowserOffline);
  }

  getState(): ConnectivityState {
    return this.state;
  }

  /** True only in the ONLINE state -- DEGRADED/RECONNECTING/OFFLINE all mean "don't assume the API will answer". */
  isReachable(): boolean {
    return this.state === "ONLINE";
  }

  subscribe(listener: ConnectivityListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  /**
   * Explicitly re-check API reachability now, e.g. right before the Sync
   * Manager attempts to flush the queue. Concurrent callers share a
   * single in-flight probe.
   */
  async probeNow(): Promise<boolean> {
    if (this.probeInFlight) {
      return this.probeInFlight;
    }
    if (typeof navigator !== "undefined" && !navigator.onLine) {
      this.setState("OFFLINE");
      return false;
    }

    this.setState(this.state === "OFFLINE" ? "RECONNECTING" : this.state);
    this.probeInFlight = this.runProbe();
    try {
      return await this.probeInFlight;
    } finally {
      this.probeInFlight = null;
    }
  }

  private async runProbe(): Promise<boolean> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), PROBE_TIMEOUT_MS);
    try {
      const response = await fetch(`${API_BASE}${HEALTH_PATH}`, {
        method: "GET",
        signal: controller.signal,
        cache: "no-store",
      });
      const reachable = response.ok;
      this.setState(reachable ? "ONLINE" : "DEGRADED");
      return reachable;
    } catch (err) {
      void isNetworkError(err);
      this.setState("DEGRADED");
      return false;
    } finally {
      clearTimeout(timeout);
    }
  }

  private handleBrowserOnline = (): void => {
    void this.probeNow();
  };

  private handleBrowserOffline = (): void => {
    this.setState("OFFLINE");
  };

  private setState(next: ConnectivityState): void {
    if (this.state === next) return;
    this.state = next;
    this.listeners.forEach((listener) => listener(next));
  }
}

export const connectivityManager = new ConnectivityManager();
