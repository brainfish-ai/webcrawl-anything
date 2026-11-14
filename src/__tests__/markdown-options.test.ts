import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fastHtmlToMarkdown, keepElements, removeElements } from "../engine/markdown.js";

const filler = "Lorem ipsum dolor sit amet. ".repeat(20);
const page = `<html><head><title>T</title></head><body>
<header>SITE HEADER</header>
<nav>NAV LINKS</nav>
<main><h1>Main</h1><p>${filler}</p>
<div class="cookie-banner"><div>inner</div>COOKIE TEXT</div>
<div id="related"><p>RELATED POSTS</p></div>
</main>
<footer>SITE FOOTER</footer>
</body></html>`;

const pricingHtml = readFileSync(
  new URL("./fixtures/pricing-full-page.html", import.meta.url),
  "utf8"
);

const FULL_PAGE_LINES = [
  "Skip to content",
  "ProntoHQ is now PipeCorn",
  "Get a demo",
  "Our API Pricing",
  "Pay per usage pricing model",
  "500K real-time searches",
  "30,000 credits",
  "500,000 credits",
  "Includes 200 credits/month",
  "Total credits needed",
  "Start free verification",
  "Unused credits roll over for 90 days",
  "Credits expire at the end of each billing cycle",
  "Terms of Service",
  "All systems operational",
  "2026 DataMagnet Inc",
];

describe("fastHtmlToMarkdown content options", () => {
  it("defaults to the full page, including header, footer, and nav", () => {
    const { markdown } = fastHtmlToMarkdown(page, "https://x.test/");
    assert.match(markdown, /Main/);
    assert.match(markdown, /SITE HEADER/);
    assert.match(markdown, /SITE FOOTER/);
    assert.match(markdown, /NAV LINKS/);
  });
  it("onlyMainContent:true trims header, footer, and nav", () => {
    const { markdown } = fastHtmlToMarkdown(page, "https://x.test/", { onlyMainContent: true });
    assert.match(markdown, /Main/);
    assert.doesNotMatch(markdown, /SITE HEADER|SITE FOOTER|NAV LINKS/);
  });
  it("onlyMainContent:false keeps the whole body", () => {
    const html = page.replace(/<main>[\s\S]*<\/main>/, `<p>${filler}</p>`) ;
    const { markdown } = fastHtmlToMarkdown(html, "https://x.test/", { onlyMainContent: false });
    assert.match(markdown, /SITE HEADER/);
    assert.match(markdown, /SITE FOOTER/);
  });
  it("excludeTags removes nested elements by class and id", () => {
    const { markdown } = fastHtmlToMarkdown(page, "https://x.test/", {
      excludeTags: [".cookie-banner", "#related"],
    });
    assert.doesNotMatch(markdown, /COOKIE TEXT|inner|RELATED POSTS/);
    assert.match(markdown, /Main/);
  });
  it("includeTags keeps only matching elements", () => {
    const { markdown } = fastHtmlToMarkdown(page, "https://x.test/", { includeTags: ["#related"] });
    assert.match(markdown, /RELATED POSTS/);
    assert.doesNotMatch(markdown, /Main|SITE FOOTER/);
  });
});

describe("pricing page full-page markdown", () => {
  it("default markdown keeps nav, table, form, details, and accordion text", () => {
    const { markdown } = fastHtmlToMarkdown(pricingHtml, "https://pricing.test/pricing");
    for (const line of FULL_PAGE_LINES) {
      assert.ok(markdown.includes(line), `missing: ${line}`);
    }
    assert.match(markdown, /\*\*Unused credits roll over for 90 days\*\*/);
  });
  it("onlyMainContent:true drops skip link and footer but keeps the pricing heading", () => {
    const { markdown } = fastHtmlToMarkdown(pricingHtml, "https://pricing.test/pricing", {
      onlyMainContent: true,
    });
    assert.match(markdown, /Our API Pricing/);
    assert.doesNotMatch(markdown, /Skip to content/);
    assert.doesNotMatch(markdown, /Terms of Service/);
  });
});

describe("element helpers", () => {
  it("removeElements balances nested same-tag elements", () => {
    const out = removeElements('<div class="a"><div>x</div>y</div><div>keep</div>', [".a"]);
    assert.equal(out, "<div>keep</div>");
  });
  it("ignores invalid selectors", () => {
    assert.equal(removeElements("<p>a</p>", ["div > p", "[x]"]), "<p>a</p>");
    assert.equal(keepElements("<p>a</p>", ["???"]), "<p>a</p>");
  });
});
