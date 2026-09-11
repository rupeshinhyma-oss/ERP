import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { GlobalSessionProvider, useGlobalSession } from "../lib/session";
import { Auth } from "../lib/auth";

function TestConsumer() {
  const { isAuthenticated, currentUser, userType, sessionExpired, logout } = useGlobalSession();
  return (
    <div>
      <div data-testid="auth-status">{isAuthenticated ? "authenticated" : "unauthenticated"}</div>
      <div data-testid="user-type">{userType || "none"}</div>
      <div data-testid="user-name">{currentUser?.display_name || "none"}</div>
      <div data-testid="session-expired">{sessionExpired ? "expired" : "valid"}</div>
      <button onClick={() => logout()}>Logout Button</button>
    </div>
  );
}

describe("GlobalSessionProvider", () => {
  beforeEach(() => {
    localStorage.clear();
    sessionStorage.clear();
    Auth.clear();
    vi.restoreAllMocks();
  });

  it("provides unauthenticated state by default", () => {
    render(
      <MemoryRouter>
        <GlobalSessionProvider>
          <TestConsumer />
        </GlobalSessionProvider>
      </MemoryRouter>
    );

    expect(screen.getByTestId("auth-status").textContent).toBe("unauthenticated");
    expect(screen.getByTestId("user-type").textContent).toBe("none");
  });

  it("provides authenticated state when valid session exists", () => {
    Auth.setSession(
      "valid-token",
      {
        id: "usr-1",
        display_name: "John Doe",
        primary_email: "john@example.com",
        status: "ACTIVE",
      },
      "global_user",
      new Date(Date.now() + 3600000).toISOString()
    );

    render(
      <MemoryRouter>
        <GlobalSessionProvider>
          <TestConsumer />
        </GlobalSessionProvider>
      </MemoryRouter>
    );

    expect(screen.getByTestId("auth-status").textContent).toBe("authenticated");
    expect(screen.getByTestId("user-type").textContent).toBe("global_user");
    expect(screen.getByTestId("user-name").textContent).toBe("John Doe");
  });

  it("persists session without expiring until user logs out", async () => {
    // Set a session token
    Auth.setSession(
      "session-token",
      {
        id: "usr-1",
        display_name: "John Doe",
        primary_email: "john@example.com",
        status: "ACTIVE",
      },
      "global_user",
      new Date(Date.now() - 10000).toISOString()
    );

    render(
      <MemoryRouter>
        <GlobalSessionProvider>
          <TestConsumer />
        </GlobalSessionProvider>
      </MemoryRouter>
    );

    await waitFor(() => {
      expect(screen.getByTestId("auth-status").textContent).toBe("authenticated");
      expect(screen.queryByText("Your session has expired.")).toBeNull();
    });
  });

  it("handles logout by clearing session storage", async () => {
    Auth.setSession(
      "logout-token",
      {
        id: "usr-2",
        display_name: "Jane Smith",
        primary_email: "jane@example.com",
        status: "ACTIVE",
      },
      "global_user"
    );

    render(
      <MemoryRouter>
        <GlobalSessionProvider>
          <TestConsumer />
        </GlobalSessionProvider>
      </MemoryRouter>
    );

    expect(Auth.isLoggedIn()).toBe(true);

    fireEvent.click(screen.getByText("Logout Button"));

    await waitFor(() => {
      expect(Auth.isLoggedIn()).toBe(false);
      expect(screen.getByTestId("auth-status").textContent).toBe("unauthenticated");
    });
  });
});
