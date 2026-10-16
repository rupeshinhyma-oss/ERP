import { describe, expect, it } from "vitest";
import { isValidEmail, toMailto, toSafeUrl } from "../links";

describe("toSafeUrl", () => {
  it("opens http(s) links as typed", () => {
    expect(toSafeUrl("https://www.indiamart.com/acme/")).toBe("https://www.indiamart.com/acme/");
    expect(toSafeUrl("http://acme.in")).toBe("http://acme.in/");
  });
  it("adds https:// to a bare address", () => {
    expect(toSafeUrl("acme-pack.com")).toBe("https://acme-pack.com/");
    expect(toSafeUrl("  www.acme.com/path?x=1 ")).toBe("https://www.acme.com/path?x=1");
    expect(toSafeUrl("facebook.com/acme")).toBe("https://facebook.com/acme");
    expect(toSafeUrl("acme.com:8080/x")).toBe("https://acme.com:8080/x");
  });
  it("never produces a link from a non-web scheme or junk", () => {
    expect(toSafeUrl("javascript:alert(1)")).toBeNull();
    expect(toSafeUrl("JaVaScRiPt:alert(1)")).toBeNull();
    expect(toSafeUrl("data:text/html;base64,AAAA")).toBeNull();
    expect(toSafeUrl("file:///etc/passwd")).toBeNull();
    expect(toSafeUrl("ftp://acme.com")).toBeNull();
    expect(toSafeUrl("just some words")).toBeNull();
    expect(toSafeUrl("nodots")).toBeNull();
    expect(toSafeUrl("")).toBeNull();
    expect(toSafeUrl(null)).toBeNull();
    expect(toSafeUrl(undefined)).toBeNull();
  });
});

describe("email helpers", () => {
  it("validates addresses", () => {
    expect(isValidEmail("a@b.co")).toBe(true);
    expect(isValidEmail(" info@acme-pack.com ")).toBe(true);
    expect(isValidEmail("not-an-email")).toBe(false);
    expect(isValidEmail("a@b")).toBe(false);
    expect(isValidEmail("")).toBe(false);
  });
  it("builds mailto links only for valid addresses", () => {
    expect(toMailto("a@b.co")).toBe("mailto:a@b.co");
    expect(toMailto("bad")).toBeNull();
    expect(toMailto(null)).toBeNull();
  });
});
