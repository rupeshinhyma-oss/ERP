import { render, screen, fireEvent, waitFor, cleanup } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { MemoryRouter } from "react-router-dom";
import { LoginPage } from "../Login";
import * as apiModule from "@/lib/api";
import * as ecosystemModule from "@/lib/ecosystemSession";
import { resetIncomingSsoHandoverForTests } from "@/lib/ssoBridge";
import { Auth } from "@/lib/auth";

const mockNavigate = vi.fn();
vi.mock("react-router-dom", async () => {
  const actual = await vi.importActual("react-router-dom");
  return {
    ...actual,
    useNavigate: () => mockNavigate,
  };
});

describe("LoginPage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
    sessionStorage.clear();
    document.cookie.split(";").forEach((c) => {
      document.cookie = c.split("=")[0].trim() + "=;expires=Thu, 01 Jan 1970 00:00:00 GMT;path=/";
    });
    resetIncomingSsoHandoverForTests();
    window.history.pushState({}, "", "/login");
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it("signs in Admin via /auth/login and navigates to /dashboard", async () => {
    vi.spyOn(apiModule, "apiGet").mockResolvedValue({
      data: { company_name: "Inhyma" },
    } as never);
    const apiPostSpy = vi.spyOn(apiModule, "apiPost").mockResolvedValue({
      data: {
        access_token: "admin-access-token",
        refresh_token: "admin-refresh-token",
        session_id: "central-sid-1",
        session_mode: "central",
        user: {
          id: "admin-uuid",
          username: "admin",
          email: "admin@example.com",
          roles: ["super_admin", "Admin"],
          permissions: ["*"],
          is_active: true,
        },
      },
    } as never);
    vi.spyOn(ecosystemModule, "establishCentralEcosystemSession").mockResolvedValue({
      session_id: "central-sid-1",
      email: "admin@example.com",
      display_name: "Platform Super Admin",
      role: "super_admin",
      user_type: "platform_admin",
      allowed_erps: ["*"],
    });

    render(
      <MemoryRouter initialEntries={["/login"]}>
        <LoginPage />
      </MemoryRouter>,
    );

    fireEvent.change(screen.getByLabelText(/Username, Email or Mobile Number/i), {
      target: { value: "admin@example.com" },
    });
    fireEvent.change(screen.getByLabelText(/^Password$/i), {
      target: { value: "ChangeMe!12345" },
    });
    fireEvent.click(screen.getByRole("button", { name: /^Sign In$/i }));

    await waitFor(() => {
      expect(apiPostSpy).toHaveBeenCalledWith(
        "/auth/login",
        { identifier: "admin@example.com", password: "ChangeMe!12345" },
        expect.objectContaining({ signal: expect.any(AbortSignal) }),
      );
      expect(Auth.isLoggedIn()).toBe(true);
      expect(mockNavigate).toHaveBeenCalledWith("/dashboard", { replace: true });
    });
  });

  it("preserves ihm_login_notice error banner even when browser autofill fires onChange on mount", async () => {
    vi.spyOn(apiModule, "apiGet").mockResolvedValue({ data: { company_name: "Inhyma" } } as never);
    sessionStorage.setItem("ihm_login_notice", "The sign-in service is temporarily unavailable.");

    render(
      <MemoryRouter initialEntries={["/login"]}>
        <LoginPage />
      </MemoryRouter>,
    );

    // Simulate Chrome password manager autofilling immediately after mount
    fireEvent.change(screen.getByLabelText(/Username, Email or Mobile Number/i), {
      target: { value: "admin@example.com" },
    });
    fireEvent.change(screen.getByLabelText(/^Password$/i), {
      target: { value: "ChangeMe!12345" },
    });

    await waitFor(() => {
      expect(screen.getByText(/temporarily unavailable/i)).toBeTruthy();
    });
  });

  it("shows backend error directly instead of looping into sso-handover when local backend is down (502)", async () => {
    vi.spyOn(apiModule, "apiGet").mockResolvedValue({ data: { company_name: "Inhyma" } } as never);
    vi.spyOn(apiModule, "apiPost").mockRejectedValue(
      new apiModule.ApiError("Bad Gateway: backend port 8002 unreachable.", 502),
    );
    // Even if ERP_Main (central control plane) is alive and returns a valid session:
    vi.spyOn(ecosystemModule, "establishCentralEcosystemSession").mockResolvedValue({
      session_id: "central-sid-2",
      email: "admin@example.com",
      display_name: "Platform Super Admin",
      role: "super_admin",
      user_type: "platform_admin",
      allowed_erps: ["*"],
    });

    render(
      <MemoryRouter initialEntries={["/login"]}>
        <LoginPage />
      </MemoryRouter>,
    );

    fireEvent.change(screen.getByLabelText(/Username, Email or Mobile Number/i), {
      target: { value: "admin@example.com" },
    });
    fireEvent.change(screen.getByLabelText(/^Password$/i), {
      target: { value: "ChangeMe!12345" },
    });
    fireEvent.click(screen.getByRole("button", { name: /^Sign In$/i }));

    await waitFor(() => {
      expect(screen.getByText(/backend port 8002 unreachable/i)).toBeTruthy();
    });
    expect(mockNavigate).not.toHaveBeenCalled();
  });
});
