import { render, screen, fireEvent, waitFor, cleanup } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { MemoryRouter } from "react-router-dom";
import type { ReactNode } from "react";
import * as apiModule from "@/lib/api";
import { BLANK_FAVICON_URL, getCachedBrandLogo, resolveBrandInfo, setBrandLogo } from "@/lib/brand";
import { LoginPage } from "@/pages/Login";
import { OrganizationPage } from "@/pages/Organization";

vi.mock("@/components/AppShell", () => ({
  AppShell: ({ children }: { children: ReactNode }) => <div data-testid="app-shell">{children}</div>,
}));

vi.mock("@/components/ui", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/components/ui")>();
  return {
    ...actual,
    Can: ({ children }: { children: ReactNode }) => <>{children}</>,
  };
});

vi.mock("@/lib/ssoBridge", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/ssoBridge")>();
  return {
    ...actual,
    processIncomingSsoHandover: vi.fn().mockResolvedValue("none"),
  };
});

describe("Yinglima Organization logo blank-state, Change PNG Logo, and Remove Logo behavior", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
    sessionStorage.clear();
    setBrandLogo(null);
    document.head.innerHTML = '<link id="dynamic-favicon" rel="icon" type="image/svg+xml" href="" />';
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it("uses blank white header and blank favicon when organization has no logo (zero /logo.png fallback)", async () => {
    setBrandLogo("data:image/png;base64,OLD_STALE_LOGO");
    vi.spyOn(apiModule, "apiGet").mockResolvedValue({
      data: { company_name: "Yinglima Machinery", logo_url: null, logo_data: null },
    } as never);

    const info = await resolveBrandInfo();
    expect(info.logoUrl).toBeNull();
    expect(getCachedBrandLogo()).toBeNull();
    const fav = document.getElementById("dynamic-favicon") as HTMLLinkElement;
    expect(fav.href).toBe(BLANK_FAVICON_URL);

    render(
      <MemoryRouter initialEntries={["/login"]}>
        <LoginPage />
      </MemoryRouter>
    );

    await waitFor(() => {
      expect(screen.getByRole("heading", { name: /Sign In/i })).toBeTruthy();
    });
    expect(screen.queryByAltText(/Logo/i)).toBeNull();
  });

  it("keeps old logo on Change PNG Logo upload failure and replaces it cleanly on upload or Remove Logo", async () => {
    const oldLogo = "data:image/png;base64,OLD_LOGO";
    const newLogo = "data:image/png;base64,NEW_LOGO";

    vi.spyOn(apiModule, "apiGet").mockResolvedValue({
      data: {
        company_name: "Yinglima Machinery",
        status: "ACTIVE",
        timezone: "UTC",
        currency: "INR",
        logo_url: "/uploads/branding/old.png",
        logo_data: oldLogo,
      },
    } as never);
    vi.spyOn(window, "confirm").mockReturnValue(true);

    const uploadSpy = vi
      .spyOn(apiModule, "apiPostMultipart")
      .mockRejectedValueOnce(new Error("Upload failed"))
      .mockResolvedValueOnce({
        data: {
          logo_url: "/uploads/branding/new.png",
          logo_data: newLogo,
          organization: {
            company_name: "Yinglima Machinery",
            status: "ACTIVE",
            timezone: "UTC",
            currency: "INR",
            logo_url: "/uploads/branding/new.png",
            logo_data: newLogo,
          },
        },
      } as never);

    const deleteSpy = vi.spyOn(apiModule, "apiDelete").mockResolvedValue({
      data: {
        logo_url: null,
        logo_data: null,
        organization: {
          company_name: "Yinglima Machinery",
          status: "ACTIVE",
          timezone: "UTC",
          currency: "INR",
          logo_url: null,
          logo_data: null,
        },
      },
    } as never);

    const { container } = render(
      <MemoryRouter initialEntries={["/organization"]}>
        <OrganizationPage />
      </MemoryRouter>
    );

    const imgBefore = (await screen.findByAltText("Company Logo")) as HTMLImageElement;
    expect(imgBefore.src).toBe(oldLogo);
    expect(getCachedBrandLogo()).toBe(oldLogo);

    const fileInput = container.querySelector('input[type="file"]') as HTMLInputElement;
    const pngFile = new File(["png"], "new-logo.png", { type: "image/png" });

    fireEvent.change(fileInput, { target: { files: [pngFile] } });
    await waitFor(() => expect(uploadSpy).toHaveBeenCalledTimes(1));
    expect((screen.getByAltText("Company Logo") as HTMLImageElement).src).toBe(oldLogo);
    expect(getCachedBrandLogo()).toBe(oldLogo);

    fireEvent.change(fileInput, { target: { files: [pngFile] } });
    await waitFor(() => {
      expect((screen.getByAltText("Company Logo") as HTMLImageElement).src).toBe(newLogo);
    });
    expect(getCachedBrandLogo()).toBe(newLogo);

    fireEvent.click(screen.getByRole("button", { name: /Remove Logo/i }));
    await waitFor(() => {
      expect(deleteSpy).toHaveBeenCalledWith("/organizations/logo");
      expect(screen.queryByAltText("Company Logo")).toBeNull();
    });
    expect(getCachedBrandLogo()).toBeNull();
    const fav = document.getElementById("dynamic-favicon") as HTMLLinkElement;
    expect(fav.href).toBe(BLANK_FAVICON_URL);
  });
});
