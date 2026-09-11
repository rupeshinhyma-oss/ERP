/**
 * Connectivity Manager (Phase 2, Section 5).
 *
 * `navigator.onLine` only tells you the OS thinks SOME network
 * interface is up -- it says nothing about whether THIS ERP's API is
 * actually reachable (a captive portal, a VPN split, or the backend
 * itself being down all leave `navigator.onLine === true`). This module
 * combines both signals into one application-level state the rest of
 * the data layer (and the UI) can trust.
 *
 * States (exactly Section 5's required set):
 * - ONLINE: browser reports online AND the last API probe succeeded.
 * - DEGRADED: browser reports online, but the last API probe failed --
 *   the classic "wifi is connected but our server isn't reachable" case.
 * - OFFLINE: browser reports offline. No point probing the API at all.
 * - RECONNECTING: a probe is currently in flight after a prior
 *   OFFLINE/DEGRADED state, before we know the outcome.
 * - SYNCING: intentionally NOT set by this module -- the Sync Manager
 *   (sync.ts) owns that transition once connectivity is confirmed and
 *   it starts actually flushing the queue. Connectivity answers "can we
 *   reach the server"; syncing answers "are we currently doing
 *   something about it", which is a separate concern this module has no
 *   opinion on.
 *
 * Event-driven, not polled (Section 7's "no aggressive polling loop"
 * applies just as much here): probes only fire on `online`/`offline`
 * browser events, on the very first check at startup, and when a
 * caller explicitly asks via `probeNow()` (e.g. before the Sync Manager
 * starts a flush) -- never on a fixed interval timer.
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
   * Manager attempts to flush the queue, rather than trusting a
   * potentially-stale state from the last passive probe. Concurrent
   * callers share a single in-flight probe rather than firing multiple
   * simultaneous health checks.
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
      void isNetworkError(err); // reused for consistency with lib/api.ts's own classification; outcome is DEGRADED either way here
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
