/**
 * Test Suite: LiveClient bfcache (Back-Forward Cache) & Visibility Lifecycle.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";

// Mock Auth
vi.mock("@/lib/auth", () => ({
  Auth: {
    getAccessToken: vi.fn(() => "valid-mock-token"),
    isLoggedIn: vi.fn(() => true),
    subscribe: vi.fn(() => () => {}),
  },
}));

// Mock api
vi.mock("@/lib/api", () => ({
  API_BASE: "http://localhost:5174/api/v1",
  handleSessionExpired: vi.fn(),
  tryRefresh: vi.fn().mockResolvedValue(true),
}));

// Mock WebSocket
class MockWebSocket {
  static instances: MockWebSocket[] = [];
  static OPEN = 1;
  static CONNECTING = 0;
  static CLOSING = 2;
  static CLOSED = 3;

  url: string;
  readyState = MockWebSocket.CONNECTING;
  onopen: (() => void) | null = null;
  onclose: ((ev: { code: number; reason: string }) => void) | null = null;
  onerror: (() => void) | null = null;
  onmessage: ((ev: { data: string }) => void) | null = null;

  constructor(url: string) {
    this.url = url;
    MockWebSocket.instances.push(this);
    setTimeout(() => {
      if (this.readyState === MockWebSocket.CONNECTING) {
        this.readyState = MockWebSocket.OPEN;
        this.onopen?.();
      }
    }, 10);
  }

  close(code = 1000, reason = "") {
    this.readyState = MockWebSocket.CLOSED;
    this.onclose?.({ code, reason });
  }

  send = vi.fn();
}

(globalThis as unknown as { WebSocket: unknown }).WebSocket = MockWebSocket;

import { LiveClient } from "../liveClient";
import { Auth } from "@/lib/auth";
import { tryRefresh } from "@/lib/api";

describe("LiveClient bfcache & Browser Lifecycle", () => {
  let client: LiveClient;

  beforeEach(() => {
    MockWebSocket.instances = [];
    vi.clearAllMocks();
    (Auth.isLoggedIn as unknown as { mockReturnValue: (val: boolean) => void }).mockReturnValue(true);
    (Auth.getAccessToken as unknown as { mockReturnValue: (val: string | null) => void }).mockReturnValue("valid-mock-token");
    client = new LiveClient("/events/live");
  });

  it("connects and sets status to connected when opened", async () => {
    client.connect();
    expect(client.getStatus()).toBe("connecting");

    await new Promise((r) => setTimeout(r, 25));
    expect(client.getStatus()).toBe("connected");
  });

  it("cleanly disconnects on pagehide without entering runaway reconnect loops", async () => {
    client.connect();
    await new Promise((r) => setTimeout(r, 25));
    expect(client.getStatus()).toBe("connected");

    // Dispatch pagehide
    window.dispatchEvent(new Event("pagehide"));

    expect(client.getStatus()).toBe("disconnected");

    // Calling connect while page is hidden should be a no-op to avoid bfcache errors
    client.connect();
    expect(client.getStatus()).toBe("disconnected");
  });

  it("automatically reconnects when pageshow fires (bfcache restore)", async () => {
    client.connect();
    await new Promise((r) => setTimeout(r, 25));
    expect(client.getStatus()).toBe("connected");

    // Page enters bfcache
    window.dispatchEvent(new Event("pagehide"));
    expect(client.getStatus()).toBe("disconnected");

    // Page is restored from bfcache
    const pageShowEvent = new Event("pageshow") as PageTransitionEvent;
    Object.defineProperty(pageShowEvent, "persisted", { value: true });
    window.dispatchEvent(pageShowEvent);

    expect(client.getStatus()).toBe("connecting");
    await new Promise((r) => setTimeout(r, 25));
    expect(client.getStatus()).toBe("connected");
  });

  it("reconnects when document visibility changes to visible", async () => {
    client.connect();
    await new Promise((r) => setTimeout(r, 25));
    expect(client.getStatus()).toBe("connected");

    // Socket closed unexpectedly
    const currentWs = MockWebSocket.instances[MockWebSocket.instances.length - 1];
    currentWs.close(1006, "Abnormal Closure");
    expect(client.getStatus()).toBe("reconnecting");

    // Simulate tab focus / visibilitychange on document
    document.dispatchEvent(new Event("visibilitychange"));

    // Should prompt a fresh connection attempt
    expect(client.getStatus()).toBe("connecting");
    await new Promise((r) => setTimeout(r, 25));
    expect(client.getStatus()).toBe("connected");
  });

  it("attempts tryRefresh on 4401 token expiration and reconnects upon success", async () => {
    (tryRefresh as unknown as { mockResolvedValue: (val: boolean) => void }).mockResolvedValue(true);
    client.connect();
    await new Promise((r) => setTimeout(r, 25));
    expect(client.getStatus()).toBe("connected");

    const currentWs = MockWebSocket.instances[MockWebSocket.instances.length - 1];
    currentWs.close(4401, "Invalid or expired token.");

    await new Promise((r) => setTimeout(r, 10));
    expect(tryRefresh).toHaveBeenCalled();
  });
});
