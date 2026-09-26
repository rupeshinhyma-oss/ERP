import { render, screen, waitFor, cleanup } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { AuthCallbackPage } from "../AuthCallback";
import * as apiModule from "@/lib/api";
import { Auth } from "@/lib/auth";

const mockNavigate = vi.fn();
vi.mock("react-router-dom", async () => {
  const actual = await vi.importActual("react-router-dom");
  return {
    ...actual,
    useNavigate: () => mockNavigate,
  };
});

describe("AuthCallbackPage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    sessionStorage.clear();
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it("exchanges authorization code, sets local session, and navigates to /dashboard", async () => {
    const apiPostSpy = vi.spyOn(apiModule, "apiPost").mockResolvedValue({
      data: {
        access_token: "local-access-token",
        refresh_token: "local-refresh-token",
        token_type: "bearer",
        expires_in: 900,
        user: {
          id: "local-user-uuid",
          username: "sso_tester",
          email: "sso@inhyma.test",
          permissions: ["sales.read"],
          roles: ["Sales User"],
          is_active: true,
        },
      },
    } as any);

    const setSessionSpy = vi.spyOn(Auth, "setSession").mockImplementation(() => {});
    const replaceStateSpy = vi.spyOn(window.history, "replaceState");

    window.history.pushState({}, "", "/auth/callback?code=test-auth-code-123&state=state-xyz");

    render(
      <MemoryRouter initialEntries={["/auth/callback?code=test-auth-code-123&state=state-xyz"]}>
        <Routes>
          <Route path="/auth/callback" element={<AuthCallbackPage />} />
        </Routes>
      </MemoryRouter>
    );

    expect(replaceStateSpy).toHaveBeenCalledWith(null, "", expect.not.stringContaining("code="));

    await waitFor(() => {
      expect(apiPostSpy).toHaveBeenCalledWith("/federation/exchange", {
        code: "test-auth-code-123",
        redirect_uri: expect.stringContaining("/auth/callback"),
      });
    });

    await waitFor(() => {
      expect(setSessionSpy).toHaveBeenCalled();
      expect(mockNavigate).toHaveBeenCalledWith("/dashboard", { replace: true });
    });
  });

  it("displays error when authorization code is absent", async () => {
    window.history.pushState({}, "", "/auth/callback");

    render(
      <MemoryRouter initialEntries={["/auth/callback"]}>
        <Routes>
          <Route path="/auth/callback" element={<AuthCallbackPage />} />
        </Routes>
      </MemoryRouter>
    );

    await waitFor(() => {
      expect(screen.getByText(/missing its authorization code/i)).toBeTruthy();
      expect(screen.getByRole("link", { name: /Go to Login/i })).toBeTruthy();
    });
  });

  it("displays error message if server rejects code exchange", async () => {
    vi.spyOn(apiModule, "apiPost").mockRejectedValue({
      message: "Authorization code has expired or is invalid.",
    });

    window.history.pushState({}, "", "/auth/callback?code=bad-expired-code");

    render(
      <MemoryRouter initialEntries={["/auth/callback?code=bad-expired-code"]}>
        <Routes>
          <Route path="/auth/callback" element={<AuthCallbackPage />} />
        </Routes>
      </MemoryRouter>
    );

    await waitFor(() => {
      expect(screen.getByText("Authorization code has expired or is invalid.")).toBeTruthy();
      expect(screen.getByRole("link", { name: /Go to Login/i })).toBeTruthy();
    });
  });
});
