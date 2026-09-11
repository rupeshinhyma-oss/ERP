import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { Login } from "../pages/Login";
import { GlobalSessionProvider } from "../lib/session";
import { Auth } from "../lib/auth";
import * as apiModule from "../lib/api";

describe("Global Login Page", () => {
  beforeEach(() => {
    localStorage.clear();
    sessionStorage.clear();
    Auth.clear();
    vi.restoreAllMocks();
  });

  it("renders the split login layout matching Yinglima/Inhyma ERP exactly", () => {
    render(
      <MemoryRouter>
        <GlobalSessionProvider>
          <Login />
        </GlobalSessionProvider>
      </MemoryRouter>
    );

    // Header & Illustration
    expect(screen.getByAltText("IHM Logo")).toBeDefined();
    expect(screen.getByAltText("ERP Login Illustration")).toBeDefined();

    // Form elements
    expect(screen.getByRole("heading", { name: "Sign In" })).toBeDefined();
    expect(screen.getByText("Welcome Back! Please Signin To Continue.")).toBeDefined();
    expect(screen.getByLabelText("Username, Email or Mobile Number")).toBeDefined();
    expect(screen.getByLabelText("Password")).toBeDefined();
    expect(screen.getByText("Remember Me")).toBeDefined();
    expect(screen.getByRole("button", { name: "Sign In" })).toBeDefined();

    // Footer
    expect(screen.getByText(/CREATED BY/i)).toBeDefined();
    expect(screen.getByText("INHYMA")).toBeDefined();
  });

  it("toggles password visibility with the eye icon", () => {
    render(
      <MemoryRouter>
        <GlobalSessionProvider>
          <Login />
        </GlobalSessionProvider>
      </MemoryRouter>
    );

    const passwordInput = screen.getByPlaceholderText("Enter your password") as HTMLInputElement;
    expect(passwordInput.type).toBe("password");

    const toggleButton = passwordInput.nextElementSibling as HTMLButtonElement;
    expect(toggleButton).toBeDefined();

    fireEvent.click(toggleButton);
    expect(passwordInput.type).toBe("text");

    fireEvent.click(toggleButton);
    expect(passwordInput.type).toBe("password");
  });

  it("executes successful Global User login flow", async () => {
    vi.spyOn(apiModule, "apiPost").mockImplementation((endpoint: string) => {
      if (endpoint === "/global/user-auth/login") {
        return Promise.resolve({
          data: {
            access_token: "test-global-token",
            token_type: "bearer",
            expires_at: new Date(Date.now() + 3600000).toISOString(),
            session_id: "sess-123",
          },
        });
      }
      return Promise.resolve({ data: null });
    });

    vi.spyOn(apiModule, "apiGet").mockImplementation((endpoint: string) => {
      if (endpoint === "/global/user-auth/me") {
        return Promise.resolve({
          data: {
            id: "user-1",
            display_name: "Test User",
            primary_email: "test@example.com",
            status: "ACTIVE",
          },
        });
      }
      if (endpoint.includes("/memberships")) {
        return Promise.resolve({ data: [] });
      }
      return Promise.resolve({ data: null });
    });

    render(
      <MemoryRouter>
        <GlobalSessionProvider>
          <Login />
        </GlobalSessionProvider>
      </MemoryRouter>
    );

    fireEvent.change(screen.getByLabelText("Username, Email or Mobile Number"), {
      target: { value: "test@example.com" },
    });
    fireEvent.change(screen.getByLabelText("Password"), {
      target: { value: "SecurePass123!" },
    });

    fireEvent.click(screen.getByRole("button", { name: "Sign In" }));

    await waitFor(() => {
      expect(Auth.isLoggedIn()).toBe(true);
      expect(Auth.getAccessToken()).toBe("test-global-token");
      expect(Auth.getPrincipalType()).toBe("global_user");
    });
  });

  it("displays ErrorBanner when authentication fails", async () => {
    vi.spyOn(apiModule, "apiPost").mockRejectedValue(new Error("Invalid email or password."));

    render(
      <MemoryRouter>
        <GlobalSessionProvider>
          <Login />
        </GlobalSessionProvider>
      </MemoryRouter>
    );

    fireEvent.change(screen.getByLabelText("Username, Email or Mobile Number"), {
      target: { value: "wrong@example.com" },
    });
    fireEvent.change(screen.getByLabelText("Password"), {
      target: { value: "WrongPass" },
    });

    fireEvent.click(screen.getByRole("button", { name: "Sign In" }));

    await waitFor(() => {
      expect(screen.getByText("Invalid email or password.")).toBeDefined();
    });
  });
});
