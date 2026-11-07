/**
 * Prompt/schema-aware structured extraction used by `extractWebsiteData`.
 * Deterministic (no LLM): quote/author cards, embedded JSON, and schema shaping.
 */
import { decodeHtmlEntities } from "../engine/markdown.js";

export interface QuoteAuthor {
  text: string;
  author: string;
}

function schemaProperties(schema?: Record<string, unknown>): Record<string, unknown> {
  if (!schema || typeof schema !== "object") return {};
  const props = schema.properties;
  if (props && typeof props === "object" && !Array.isArray(props)) {
    return props as Record<string, unknown>;
  }
  return schema;
}

export function hasCustomExtractRequest(
  prompt?: string,
  schema?: Record<string, unknown>
): boolean {
  if (prompt && prompt.trim()) return true;
  return Object.keys(schemaProperties(schema)).length > 0;
}

function blobForIntent(prompt?: string, schema?: Record<string, unknown>): string {
  return `${prompt ?? ""} ${Object.keys(schemaProperties(schema)).join(" ")}`.toLowerCase();
}

export function wantsQuoteAuthorExtract(prompt?: string, schema?: Record<string, unknown>): boolean {
  const blob = blobForIntent(prompt, schema);
  if (/\bquotes?\b/.test(blob) && /\bauthors?\b/.test(blob)) return true;
  const props = schemaProperties(schema);
  if (props.quotes || props.quote || props.authors) return true;
  return false;
}

function cleanText(raw: string): string {
  return decodeHtmlEntities(raw.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim());
}

function pushPair(out: QuoteAuthor[], text: string, author: string): void {
  const t = cleanText(text).replace(/^["“]|["”]$/g, "").trim();
  const a = cleanText(author);
  if (t.length < 8 || a.length < 2) return;
  if (out.some((p) => p.text === t && p.author === a)) return;
  out.push({ text: t, author: a });
}

/** Pull quote/author pairs from HTML (cards, microdata, `var data = [...]`) and markdown. */
export function extractQuoteAuthorPairs(html: string, markdown = ""): QuoteAuthor[] {
  const out: QuoteAuthor[] = [];

  const dataAssign = html.match(/var\s+data\s*=\s*(\[[\s\S]*?\]);/);
  if (dataAssign) {
    try {
      const parsed = JSON.parse(dataAssign[1]) as Array<{
        text?: string;
        author?: { name?: string } | string;
      }>;
      if (Array.isArray(parsed)) {
        for (const row of parsed) {
          const author =
            typeof row.author === "string" ? row.author : row.author?.name ?? "";
          if (row.text && author) pushPair(out, row.text, author);
        }
      }
    } catch {
      /* not JSON */
    }
  }

  const cardRe =
    /<(?:div|figure|blockquote|li)[^>]*class=["'][^"']*\bquote\b[^"']*["'][^>]*>([\s\S]*?)<\/(?:div|figure|blockquote|li)>/gi;
  let card: RegExpExecArray | null;
  while ((card = cardRe.exec(html)) !== null) {
    const block = card[1];
    const text =
      block.match(/<(?:span|div|p|q)[^>]*class=["'][^"']*\btext\b[^"']*["'][^>]*>([\s\S]*?)<\//i)?.[1] ||
      block.match(/itemprop=["']text["'][^>]*>([\s\S]*?)<\//i)?.[1] ||
      "";
    const author =
      block.match(/<(?:small|span|div|p)[^>]*class=["'][^"']*\bauthor\b[^"']*["'][^>]*>([\s\S]*?)<\//i)?.[1] ||
      block.match(/itemprop=["']author["'][^>]*>([\s\S]*?)<\//i)?.[1] ||
      "";
    if (text && author) pushPair(out, text, author);
  }

  const microRe =
    /itemprop=["']text["'][^>]*>([\s\S]*?)<\/[^>]+>[\s\S]{0,400}?itemprop=["']author["'][^>]*>([\s\S]*?)<\//gi;
  let micro: RegExpExecArray | null;
  while ((micro = microRe.exec(html)) !== null) {
    pushPair(out, micro[1], micro[2]);
  }

  if (out.length === 0 && markdown) {
    const mdRe = /[“"]([^”"]{12,400})[”"]\s*(?:\n+)?\s*(?:by\s+|\u2014\s*|\s+[-–—]\s+)([A-Z][^\n]{1,80})/g;
    let md: RegExpExecArray | null;
    while ((md = mdRe.exec(markdown)) !== null) {
      pushPair(out, md[1], md[2]);
    }
  }

  return out;
}

function itemFieldNames(schema?: Record<string, unknown>): { arrayKey: string; textKey: string; authorKey: string } {
  const props = schemaProperties(schema);
  const keys = Object.keys(props);
  const arrayKey =
    keys.find((k) => {
      const p = props[k];
      if (!p || typeof p !== "object") return /quotes?|items|results|entries/i.test(k);
      const t = (p as { type?: unknown }).type;
      return t === "array" || /quotes?|items|results|entries/i.test(k);
    }) ||
    (keys.length === 0 ? "quotes" : undefined);

  const itemSchema =
    arrayKey && props[arrayKey] && typeof props[arrayKey] === "object"
      ? (props[arrayKey] as { items?: { properties?: Record<string, unknown> } })
      : undefined;
  const itemProps = itemSchema?.items?.properties ?? {};
  const itemKeys = Object.keys(itemProps);
  const textKey = itemKeys.find((k) => /quote|text|content|body/i.test(k)) ?? "quote";
  const authorKey = itemKeys.find((k) => /author|by|name/i.test(k)) ?? "author";
  return { arrayKey: arrayKey ?? "quotes", textKey, authorKey };
}

export function shapeQuoteAuthors(
  pairs: QuoteAuthor[],
  schema?: Record<string, unknown>
): Record<string, unknown> {
  const props = schemaProperties(schema);
  const keys = Object.keys(props);
  const quoteArr = keys.find((k) => /quotes?/i.test(k) && (props[k] as { type?: string })?.type === "array");
  const authorArr = keys.find((k) => /authors?/i.test(k) && (props[k] as { type?: string })?.type === "array");
  const quoteArrItems = quoteArr && (props[quoteArr] as { items?: { type?: string } })?.items?.type;
  if (quoteArr && authorArr && quoteArrItems === "string") {
    return {
      [quoteArr]: pairs.map((p) => p.text),
      [authorArr]: pairs.map((p) => p.author),
    };
  }
  const { arrayKey, textKey, authorKey } = itemFieldNames(schema);
  return {
    [arrayKey]: pairs.map((p) => ({ [textKey]: p.text, [authorKey]: p.author })),
  };
}

/**
 * Deterministic extract when the caller passed a prompt and/or JSON schema.
 * Returns null when this page/request has nothing this extractor can fill.
 */
export function extractByPromptAndSchema(
  html: string,
  markdown: string,
  prompt?: string,
  schema?: Record<string, unknown>
): Record<string, unknown> | null {
  if (!hasCustomExtractRequest(prompt, schema)) return null;
  if (wantsQuoteAuthorExtract(prompt, schema)) {
    const pairs = extractQuoteAuthorPairs(html, markdown);
    if (pairs.length > 0) return shapeQuoteAuthors(pairs, schema);
  }
  const pairs = extractQuoteAuthorPairs(html, markdown);
  if (pairs.length > 0 && /\bquotes?\b/i.test(blobForIntent(prompt, schema))) {
    return shapeQuoteAuthors(pairs, schema);
  }
  return null;
}
