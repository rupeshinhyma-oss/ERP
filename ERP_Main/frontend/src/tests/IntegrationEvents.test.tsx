import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen, waitFor, fireEvent } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { IntegrationEvents } from "../pages/IntegrationEvents";
import { Auth } from "../lib/auth";
import { GlobalSessionProvider } from "../lib/session";
import { ToastProvider } from "../lib/toast";
import * as apiModule from "../lib/api";

describe("IntegrationEvents Page", () => {
  const mockDashboard = {
    active_erps: 2,
    total_erps: 2,
    global_users: 10,
    active_memberships: 15,
    events_received_total: 120,
    events_dead_lettered_total: 3,
    erp_health: [
      {
        erp_id: "erp-1",
        erp_key: "yinglima",
        display_name: "Yinglima ERP",
        status: "ACTIVE",
        last_seen_at: "2026-09-08T10:00:00Z",
        api_health: "HEALTHY",
        enabled_capabilities: ["buyer_catalog", "orders"],
        buyer_projection_count: 42,
      },
      {
        erp_id: "erp-2",
        erp_key: "inhyma",
        display_name: "Inhyma ERP",
        status: "ACTIVE",
        last_seen_at: "2026-09-08T09:30:00Z",
        api_health: "STALE",
        enabled_capabilities: ["buyer_catalog"],
        buyer_projection_count: 18,
      },
    ],
    projection_health: [
      {
        projection_type: "buyer_catalog",
        last_processed_at: "2026-09-08T10:00:00Z",
        events_processed_count: 117,
        error_count: 0,
        last_error: null,
        lag_seconds: 0.5,
      },
    ],
    data_as_of: "2026-09-08T10:00:00Z",
  };

  const mockErps = [
    {
      id: "erp-1",
      erp_key: "yinglima",
      name: "Yinglima ERP",
      status: "ACTIVE" as const,
      version: "1.0.0",
      base_url: "http://localhost:8001",
      capabilities: ["buyer_catalog", "orders"],
      created_at: "2026-01-01T00:00:00Z",
      updated_at: "2026-01-01T00:00:00Z",
    },
    {
      id: "erp-2",
      erp_key: "inhyma",
      name: "Inhyma ERP",
      status: "ACTIVE" as const,
      version: "1.0.0",
      base_url: "http://localhost:8002",
      capabilities: ["buyer_catalog"],
      created_at: "2026-01-01T00:00:00Z",
      updated_at: "2026-01-01T00:00:00Z",
    },
  ];

  const mockInboxEvents = [
    {
      id: "inbox-1",
      event_id: "evt-uuid-1111-2222",
      event_type: "buyer.created",
      event_version: 1,
      source_erp_id: "erp-1",
      source_entity_type: "buyer",
      source_entity_id: "buyer-uuid-1234",
      correlation_id: "corr-uuid-aaaa-bbbb",
      causation_id: null,
      status: "ROUTED",
      routed_to: ["inhyma"],
      attempt_count: 1,
      last_error: null,
      created_at: "2026-09-08T09:45:00Z",
    },
    {
      id: "inbox-2",
      event_id: "evt-uuid-3333-4444",
      event_type: "order.placed",
      event_version: 1,
      source_erp_id: "erp-2",
      source_entity_type: "order",
      source_entity_id: "order-uuid-5678",
      correlation_id: "corr-uuid-cccc-dddd",
      causation_id: null,
      status: "FAILED",
      routed_to: [],
      attempt_count: 3,
      last_error: "Connection timeout to consumer",
      created_at: "2026-09-08T09:50:00Z",
    },
  ];

  const mockDeadLetters = [
    {
      id: "dl-1",
      inbox_event_id: "inbox-3",
      event_id: "evt-uuid-9999-0000",
      event_type: "catalog.synced",
      source_erp_id: "erp-1",
      attempt_count: 5,
      last_error: "Target ERP refused connection after 5 attempts",
      failed_at: "2026-09-08T08:00:00Z",
      replayed_at: null,
      replayed_by: null,
    },
  ];

  const mockSubscriptions = [
    {
      id: "sub-1",
      event_type: "buyer.created",
      source_erp_id: "erp-1",
      target_kind: "SPECIFIC_ERP",
      target_erp_id: "erp-2",
      required_capability: "buyer_catalog",
      enabled: true,
      created_at: "2026-01-01T00:00:00Z",
      updated_at: "2026-01-01T00:00:00Z",
    },
    {
      id: "sub-2",
      event_type: "notification.broadcast",
      source_erp_id: "erp-2",
      target_kind: "BROADCAST",
      target_erp_id: null,
      required_capability: null,
      enabled: false,
      created_at: "2026-01-01T00:00:00Z",
      updated_at: "2026-01-01T00:00:00Z",
    },
  ];

  beforeEach(() => {
    localStorage.clear();
    Auth.setSession("test-token", {
      id: "admin-1",
      email: "admin@platform.local",
      display_name: "Admin",
      role: "SUPER_ADMIN",
      is_active: true,
      created_at: new Date().toISOString(),
    });
    vi.restoreAllMocks();
  });

  const setupApiMocks = () => {
    vi.spyOn(apiModule, "apiGet").mockImplementation((url: string) => {
      if (url.includes("/global/dashboard")) return Promise.resolve(mockDashboard);
      if (url.includes("/global/erps")) return Promise.resolve(mockErps);
      if (url.includes("/global/integration/inbox/")) {
        return Promise.resolve({
          ...mockInboxEvents[0],
          payload: {
            company_name: "Acme Industrial",
            password: "[REDACTED]",
            token: "[REDACTED]",
            tax_id: "TX-9988",
          },
        });
      }
      if (url.includes("/global/integration/inbox")) return Promise.resolve(mockInboxEvents);
      if (url.includes("/global/integration/dead-letters")) return Promise.resolve(mockDeadLetters);
      if (url.includes("/global/integration/subscriptions")) return Promise.resolve(mockSubscriptions);
      return Promise.resolve([]);
    });
  };

  const renderComponent = () =>
    render(
      <MemoryRouter>
        <GlobalSessionProvider>
          <ToastProvider>
            <IntegrationEvents />
          </ToastProvider>
        </GlobalSessionProvider>
      </MemoryRouter>
    );

  it("renders overview tab with fleet KPIs and registered ERP health cards", async () => {
    setupApiMocks();
    renderComponent();

    await waitFor(() => {
      expect(screen.getByText(/Global Integration Control Plane:/i)).toBeDefined();
      expect(screen.getByText("Total Ingested Events")).toBeDefined();
      expect(screen.getByText("Registered ERP Integration Status")).toBeDefined();
      expect(screen.getByText("Yinglima ERP")).toBeDefined();
      expect(screen.getByText("Inhyma ERP")).toBeDefined();
      expect(screen.getAllByText("buyer_catalog").length).toBeGreaterThanOrEqual(1);
    });
  });

  it("renders events directory and allows status filtering and correlation tracing", async () => {
    setupApiMocks();
    renderComponent();

    // Switch to Events tab
    const eventsTabBtn = screen.getByRole("button", { name: /Events Directory/i });
    fireEvent.click(eventsTabBtn);

    await waitFor(() => {
      expect(screen.getByText("buyer.created")).toBeDefined();
      expect(screen.getByText("order.placed")).toBeDefined();
      expect(screen.getByText("Routed")).toBeDefined();
    });

    // Trace button click sets filter
    const traceBtns = screen.getAllByText(/corr-uui/i);
    fireEvent.click(traceBtns[0]);

    await waitFor(() => {
      expect(screen.getByText(/Showing events scoped to trace correlation ID/i)).toBeDefined();
    });
  });

  it("opens event detail drawer and displays server-sanitized payload safely", async () => {
    setupApiMocks();
    renderComponent();

    // Switch to Events tab
    const eventsTabBtn = screen.getByRole("button", { name: /Events Directory/i });
    fireEvent.click(eventsTabBtn);

    await waitFor(() => {
      expect(screen.getByText("buyer.created")).toBeDefined();
    });

    const inspectButtons = screen.getAllByRole("button", { name: /Inspect/i });
    fireEvent.click(inspectButtons[0]);

    await waitFor(() => {
      expect(screen.getByText(/Sanitized Payload/i)).toBeDefined();
      expect(screen.getByText(/Sensitive keys \(passwords, tokens, credentials\) are redacted/i)).toBeDefined();
      expect(screen.getByText(/Acme Industrial/i)).toBeDefined();
      expect(screen.getAllByText(/\[REDACTED\]/i).length).toBeGreaterThanOrEqual(1);
    });
  });

  it("renders dead-letter queue and allows operator replay", async () => {
    setupApiMocks();
    const postSpy = vi.spyOn(apiModule, "apiPost").mockResolvedValue({
      id: "inbox-3",
      event_id: "evt-uuid-9999-0000",
      status: "ROUTED",
    });

    renderComponent();

    // Switch to Dead Letters tab
    const dlTabBtn = screen.getByRole("button", { name: /Dead Letters/i });
    fireEvent.click(dlTabBtn);

    await waitFor(() => {
      expect(screen.getByText("catalog.synced")).toBeDefined();
      expect(screen.getByText(/Target ERP refused connection after 5 attempts/i)).toBeDefined();
    });

    // Click Replay on the table row
    const replayBtn = screen.getByTitle("Replay Event");
    fireEvent.click(replayBtn);

    // Confirm Modal
    await waitFor(() => {
      expect(screen.getByText(/Replay Dead-Lettered Event\?/i)).toBeDefined();
      expect(screen.getByText(/Confirm Replay/i)).toBeDefined();
    });

    const confirmBtn = screen.getByRole("button", { name: /Confirm Replay/i });
    fireEvent.click(confirmBtn);

    await waitFor(() => {
      expect(postSpy).toHaveBeenCalledWith("/global/integration/dead-letters/dl-1/replay");
    });
  });

  it("renders routing subscriptions and toggles subscription status", async () => {
    setupApiMocks();
    const patchSpy = vi.spyOn(apiModule, "apiPatch").mockResolvedValue({
      ...mockSubscriptions[0],
      enabled: false,
    });

    renderComponent();

    // Switch to Subscriptions tab
    const subsTabBtn = screen.getByRole("button", { name: /Routing Subscriptions & Outbox/i });
    fireEvent.click(subsTabBtn);

    await waitFor(() => {
      expect(screen.getByText(/Transactional Outbox & Capability Routing Model/i)).toBeDefined();
      expect(screen.getByText("SPECIFIC_ERP")).toBeDefined();
      expect(screen.getByText("BROADCAST")).toBeDefined();
    });

    // Click Disable on first active subscription
    const disableBtn = screen.getByRole("button", { name: /Disable/i });
    fireEvent.click(disableBtn);

    // Confirm Modal
    await waitFor(() => {
      expect(screen.getByText(/Disable Routing Subscription\?/i)).toBeDefined();
    });

    const confirmBtn = screen.getByRole("button", { name: /Disable Subscription/i });
    fireEvent.click(confirmBtn);

    await waitFor(() => {
      expect(patchSpy).toHaveBeenCalledWith("/global/integration/subscriptions/sub-1", { enabled: false });
    });
  });

  it("renders reconciliation tab with honest Unknown status and executes reconciliation pass", async () => {
    setupApiMocks();
    const postSpy = vi.spyOn(apiModule, "apiPost").mockResolvedValue({
      erp_id: "erp-1",
      erp_key: "yinglima",
      projection_count: 42,
      outbox_published_count: null,
      status: "UNKNOWN",
    });

    renderComponent();

    // Switch to Reconciliation tab
    const reconTabBtn = screen.getByRole("button", { name: /Reconciliation & Sync/i });
    fireEvent.click(reconTabBtn);

    await waitFor(() => {
      expect(screen.getByText(/Data Boundary & Honest Reconciliation/i)).toBeDefined();
      expect(screen.getByText("42")).toBeDefined();
      expect(screen.getAllByText(/records/i).length).toBeGreaterThanOrEqual(1);
      expect(screen.getAllByText(/Unknown \(Unqueried\)/i).length).toBeGreaterThanOrEqual(1);
    });

    // Click Reconcile on Yinglima
    const reconcileBtns = screen.getAllByRole("button", { name: /Reconcile/i });
    fireEvent.click(reconcileBtns[0]);

    await waitFor(() => {
      expect(postSpy).toHaveBeenCalledWith("/global/reconciliation/erps/erp-1");
    });
  });
});
