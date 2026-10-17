import type { CSSProperties } from "react";
import { toMailto, toSafeUrl } from "@/lib/links";

interface OpenLinkProps {
  /** The text the user typed (web address or email). */
  value?: string | null;
  kind?: "web" | "email";
  style?: CSSProperties;
  testId?: string;
}

/** Small "open" link shown next to a URL / email field. Renders nothing until the value is a valid link. */
export function OpenLink({ value, kind = "web", style, testId }: OpenLinkProps) {
  const href = kind === "email" ? toMailto(value) : toSafeUrl(value);
  if (!href) return null;
  return (
    <a
      href={href}
      target={kind === "email" ? undefined : "_blank"}
      rel="noopener noreferrer"
      title={kind === "email" ? "Send email" : "Open link in a new tab"}
      aria-label={kind === "email" ? "Send email" : "Open link"}
      data-testid={testId || (kind === "email" ? "open-email" : "open-link")}
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: "3px",
        fontSize: "12px",
        fontWeight: 600,
        color: "#0061f2",
        textDecoration: "none",
        whiteSpace: "nowrap",
        ...style,
      }}
    >
      {kind === "email" ? "✉ Mail" : "↗ Open"}
    </a>
  );
}

export default OpenLink;
