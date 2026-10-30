import { describe, it, expect } from "vitest";
import fs from "fs";
import path from "path";

describe("Feed Page Full-Width Layout Verification", () => {
  const cssPath = path.resolve(__dirname, "../../styles/feed.css");
  const cssContent = fs.readFileSync(cssPath, "utf-8");

  it("removes restrictive 920px max-width from .feed-page-container and sets width: 100%", () => {
    expect(cssContent).not.toMatch(/\.feed-page-container\s*\{[^}]*max-width:\s*920px/);
    expect(cssContent).toMatch(/\.feed-page-container\s*\{[^}]*width:\s*100%/);
    expect(cssContent).toMatch(/\.feed-page-container\s*\{[^}]*max-width:\s*100%/);
    expect(cssContent).toMatch(/\.feed-page-container\s*\{[^}]*margin:\s*0/);
    expect(cssContent).toMatch(/\.feed-page-container\s*\{[^}]*padding:\s*20px\s+24px\s+44px/);
  });

  it("ensures page header spans full width with heading on left and actions on right", () => {
    expect(cssContent).toMatch(/\.feed-header\s*\{[^}]*justify-content:\s*space-between/);
    expect(cssContent).toMatch(/\.feed-header\s*\{[^}]*width:\s*100%/);
  });

  it("ensures composer and announcement cards share 100% width and identical padding boundaries", () => {
    expect(cssContent).toMatch(/\.feed-composer-card\s*\{[^}]*width:\s*100%/);
    expect(cssContent).toMatch(/\.feed-composer-card\s*\{[^}]*padding:\s*16px\s+20px/);
    expect(cssContent).toMatch(/\.feed-post-card\s*\{[^}]*width:\s*100%/);
    expect(cssContent).toMatch(/\.feed-post-card\s*\{[^}]*padding:\s*16px\s+20px/);
    expect(cssContent).toMatch(/\.feed-posts-list\s*\{[^}]*width:\s*100%/);
  });

  it("ensures audience section and summary cards stretch across the composer width", () => {
    expect(cssContent).toMatch(/\.feed-audience-section\s*\{[^}]*width:\s*100%/);
    expect(cssContent).toMatch(/\.feed-audience-summary-card\s*\{[^}]*width:\s*100%/);
    expect(cssContent).toMatch(/\.feed-audience-confirm-notice\s*\{[^}]*width:\s*100%/);
  });

  it("includes responsive rules for mobile stacking and tablet comfortable gutters", () => {
    expect(cssContent).toMatch(/@media\s*\(max-width:\s*1024px\)\s*\{[\s\S]*?\.feed-page-container\s*\{[^}]*padding:\s*16px\s+20px\s+40px/);
    expect(cssContent).toMatch(/@media\s*\(max-width:\s*640px\)\s*\{[\s\S]*?\.feed-page-container\s*\{[^}]*padding:\s*12px\s+16px\s+36px/);
    expect(cssContent).toMatch(/@media\s*\(max-width:\s*640px\)\s*\{[\s\S]*?\.feed-header\s*\{[^}]*flex-direction:\s*column/);
    expect(cssContent).toMatch(/@media\s*\(max-width:\s*640px\)\s*\{[\s\S]*?\.feed-search-bar\s*\{[^}]*width:\s*100%/);
    expect(cssContent).toMatch(/@media\s*\(max-width:\s*640px\)\s*\{[\s\S]*?\.feed-composer-actions\s*\{[^}]*flex-direction:\s*column-reverse/);
  });
});
