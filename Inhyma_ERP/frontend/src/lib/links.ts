/**
 * Safe "open this link" helpers for the Company screens (webpage, website, email, social media).
 *
 * Only http(s) links are ever opened -- a value such as `javascript:...` typed or imported into a website field
 * must never become a clickable link.
 */

/** Normalise user text to an openable http(s) URL, or null when it is empty / not a web link. */
export function toSafeUrl(raw?: string | null): string | null {
  const text = (raw ?? "").trim();
  if (!text) return null;
  // Already has a scheme? Only http / https are allowed through.
  const scheme = text.match(/^([a-z][a-z0-9+.-]*):/i);
  if (scheme) {
    const s = scheme[1].toLowerCase();
    if (s !== "http" && s !== "https") {
      // "indiamart.com:8080/x" looks like a scheme but is host:port -> treat as a bare host
      if (!/^[^/\s]+:\d+(\/|$)/.test(text)) return null;
    } else {
      try {
        const u = new URL(text);
        return u.hostname ? u.toString() : null;
      } catch {
        return null;
      }
    }
  }
  if (/\s/.test(text) || !text.includes(".")) return null;
  try {
    const u = new URL("https://" + text.replace(/^\/+/, ""));
    return u.hostname.includes(".") ? u.toString() : null;
  } catch {
    return null;
  }
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

export function isValidEmail(value?: string | null): boolean {
  return EMAIL_RE.test((value ?? "").trim());
}

/** `mailto:` link for a valid address, else null. */
export function toMailto(value?: string | null): string | null {
  const v = (value ?? "").trim();
  return isValidEmail(v) ? `mailto:${v}` : null;
}
