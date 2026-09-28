/**
 * Breadcrumb trail: a Dashboard link followed by `/`-separated segments.
 *
 * Ported from the `.breadcrumb` markup repeated at the top of every page. The
 * original marked every segment after the link with `class="current"`
 * (including intermediate ones like "Master Data"), so that is preserved.
 */

import { Link } from "react-router-dom";

export function Breadcrumb({ trail }: { trail: string[] }) {
  // Prevent duplicate Dashboard if passed in trail since Dashboard link is already root
  const normalizedTrail = trail[0]?.toLowerCase() === "dashboard" ? trail.slice(1) : trail;
  return (
    <div className="breadcrumb">
      <Link to="/dashboard">Dashboard</Link>
      {normalizedTrail.map((segment, index) => (
        <span key={`${segment}-${index}`}>
          <span className="sep">/</span>
          <span className="current">{segment}</span>
        </span>
      ))}
    </div>
  );
}
