import { describe, expect, it } from "vitest";

import { userDisplayName, userInitials } from "../auth";
import type { Profile } from "../../types";

function makeProfile(overrides: Partial<Profile> = {}): Profile {
  return {
    id: "00000000-0000-0000-0000-000000000001",
    first_name: "First",
    last_name: "Last",
    display_name: "Primary Display Name",
    full_name: "Primary Display Name",
    employee_code: "EMP-001",
    username: "internal_username",
    email: "person@inhyma.com",
    phone: null,
    status: "ACTIVE",
    is_active: true,
    must_change_password: false,
    last_login_at: null,
    password_changed_at: null,
    created_at: "2026-11-02T00:00:00Z",
    roles: ["user"],
    permissions: [],
    ...overrides,
  };
}

describe("Display Name Primary Identity Helpers", () => {
  it("prioritizes display_name first for userDisplayName and userInitials", () => {
    const p = makeProfile({
      display_name: "Sales Star",
      full_name: "Other Full",
      first_name: "Alpha",
      last_name: "Beta",
    });
    expect(userDisplayName(p)).toBe("Sales Star");
    expect(userInitials(p)).toBe("SS");
  });

  it("falls back cleanly to full_name, then first_name + last_name, then email without exposing raw username", () => {
    const fromFull = makeProfile({ display_name: null, full_name: "Jane Doe" });
    expect(userDisplayName(fromFull)).toBe("Jane Doe");
    expect(userInitials(fromFull)).toBe("JD");

    const fromParts = makeProfile({
      display_name: "",
      full_name: "",
      first_name: "Kiran",
      last_name: "Patel",
    });
    expect(userDisplayName(fromParts)).toBe("Kiran Patel");
    expect(userInitials(fromParts)).toBe("KP");

    const fromEmail = makeProfile({
      display_name: null,
      full_name: null,
      first_name: null,
      last_name: null,
      email: "ops@inhyma.com",
    });
    expect(userDisplayName(fromEmail)).toBe("ops@inhyma.com");
    expect(userInitials(fromEmail)).toBe("OP");
  });
});
