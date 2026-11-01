/**
 * Zero-key Local Execution Engine for Webcrawl Anything.
 *
 * Implements the exact same method surface as `WebcrawlClient` (`search`, `scrape`,
 * `parse`, `map`, `crawl`, `extract`, `rerank`, `categories`, `targets`) in-process
 * using the shared `src/engine/`, `src/search/`, `src/parse/`, `src/extract/`,
 * `src/ranker/`, and `src/targets/` pipeline.
 *
 * Every community improvement to extractors, parsers, or targets in `src/` immediately
 * powers both this local engine (`npx webcrawl`) and the hosted `webcrawl.app` API.
 */
import {
  extractWebsiteData,
  fastHtmlToMarkdown,
  fetchWithTlsImpersonation,
  getCachedPageAsync,
  mapWebsiteUrls,
  setCachedPage,
  sha256,
} from "./engine.js";
import { fetchResource, lastFetchTier } from "./engine/fetcher.js";
import { parseFile, publicParseMeta } from "./parse/index.js";
import { isBinaryContentType, looksLikeBinaryUrl } from "./parse/fetch.js";
import { maxDownloadBytes } from "./parse/limits.js";
import { parseYouTubeCached, youtubeVideoId } from "./parse/youtube.js";
import { rankDocuments, type RawCandidateDocument } from "./ranker.js";
import { getSearchCategoriesCatalog, searchWeb } from "./search.js";
import { inspectTarget, listTargets, resolveTarget } from "./targets.js";

export interface LocalEngineBackend {
  readonly baseUrl: string;
  search(p: Record<string, unknown>): Promise<Record<string, unknown>>;
  scrape(p: { url: string; formats?: Array<"markdown" | "links" | "html">; noCache?: boolean }): Promise<Record<string, unknown>>;
  parse(p: Record<string, unknown>): Promise<Record<string, unknown>>;
  run(id: string): Promise<Record<string, unknown>>;
  map(p: { url: string; limit?: number; search?: string }): Promise<Record<string, unknown>>;
  crawl(p: { url: string; maxPages?: number; extractStructured?: boolean }): Promise<Record<string, unknown>>;
  extract(p: { url: string; prompt?: string; schema?: Record<string, unknown> }): Promise<Record<string, unknown>>;
  rerank(p: { query: string; documents: Array<string | Record<string, unknown>>; topK?: number }): Promise<Record<string, unknown>>;
  categories(): Promise<Record<string, unknown>>;
  targets(): Promise<Record<string, unknown>>;
  usage(): Promise<Record<string, unknown>>;
}

export function createLocalEngineClient(): LocalEngineBackend {
  return {
    baseUrl: "local://engine",

    async search(p: Record<string, unknown>): Promise<Record<string, unknown>> {
      const query = String(p.query ?? "").trim();
      const category = typeof p.category === "string" ? p.category : undefined;
      const subcategory = typeof p.subcategory === "string" ? p.subcategory : undefined;
      const limit = typeof p.limit === "number" ? p.limit : 5;
      const country = typeof p.country === "string" ? p.country : undefined;
      const city = typeof p.city === "string" ? p.city : undefined;
      const sites = Array.isArray(p.sites) ? p.sites.map(String) : undefined;
      const scrapeContent = Boolean(p.scrapeContent);

      const res = await searchWeb({
        query,
        category: category as never,
        subcategory,
        limit,
        country,
        city,
        filters: sites?.length ? { sites } : undefined,
        scrapeOptions: scrapeContent ? { formats: ["markdown"] } : undefined,
      });

      const resolved = resolveTarget({ query, category });
      return {
        ...res,
        success: true,
        mode: "local",
        target: {
          id: resolved.plugin.id,
          name: resolved.plugin.name,
          confidence: resolved.match.confidence,
        },
      };
    },

    async scrape(p: {
      url: string;
      formats?: Array<"markdown" | "links" | "html">;
      noCache?: boolean;
    }): Promise<Record<string, unknown>> {
      const targetUrl = /^https?:\/\//i.test(p.url) ? p.url : `https://${p.url}`;
      const start = Date.now();

      // 1. Check if YouTube URL
      if (youtubeVideoId(targetUrl)) {
        const yt = await parseYouTubeCached(targetUrl, { bypassCache: p.noCache });
        return {
          success: true,
          mode: "local",
          url: targetUrl,
          title: yt.title,
          markdown: yt.markdown,
          data: {
            url: targetUrl,
            title: yt.title,
            markdown: yt.markdown,
            metadata: { parse: publicParseMeta(yt) },
          },
          evidence: {
            targetId: "youtube-media",
            tier: "native-parser",
            contentHash: yt.contentHash,
            latencyMs: Date.now() - start,
            sourceUrl: targetUrl,
            matchedSignals: ["youtube:captions"],
            limitations: yt.meta.warnings,
          },
        };
      }

      // 2. Check if binary document URL (PDF, DOCX, XLSX, PPTX)
      if (looksLikeBinaryUrl(targetUrl)) {
        const fetched = await fetchResource(targetUrl, { maxBytes: maxDownloadBytes() });
        if (isBinaryContentType(fetched.contentType) || looksLikeBinaryUrl(fetched.url)) {
          const parsed = await parseFile(
            { bytes: fetched.body, contentType: fetched.contentType, fileName: fetched.url },
            { bypassCache: p.noCache }
          );
          return {
            success: true,
            mode: "local",
            url: fetched.url,
            title: parsed.title,
            markdown: parsed.markdown,
            data: {
              url: fetched.url,
              title: parsed.title,
              markdown: parsed.markdown,
              metadata: { parse: publicParseMeta(parsed) },
            },
            evidence: {
              targetId: "pdf-office",
              tier: parsed.meta.method === "ocr" ? "ocr" : "native-parser",
              contentHash: parsed.contentHash,
              latencyMs: Date.now() - start,
              sourceUrl: fetched.url,
              matchedSignals: [`parse:${parsed.meta.kind}:${parsed.meta.method}`],
              limitations: parsed.meta.warnings,
            },
          };
        }
      }

      // 3. Check local cache first
      if (!p.noCache) {
        const cached = await getCachedPageAsync(targetUrl, "none");
        if (cached) {
          const targetInspection = await inspectTarget({
            url: targetUrl,
            markdown: cached.markdown,
          });
          return {
            success: true,
            mode: "local",
            url: targetUrl,
            title: cached.title,
            markdown: cached.markdown,
            links: cached.links,
            cached: true,
            data: {
              url: targetUrl,
              title: cached.title,
              markdown: cached.markdown,
              links: cached.links,
              structured: targetInspection.structured,
            },
            evidence: {
              ...targetInspection.evidence,
              tier: "cache",
              contentHash: cached.contentHash,
              latencyMs: Date.now() - start,
            },
          };
        }
      }

      // 4. Fetch with TLS impersonation (impit) + target-aware extraction
      const fetched = await fetchWithTlsImpersonation(targetUrl);
      const { title, markdown, links } = fastHtmlToMarkdown(fetched.html, targetUrl);
      const contentHash = sha256(markdown || fetched.html);

      setCachedPage(targetUrl, "none", {
        title,
        markdown,
        links,
        statusCode: fetched.status,
        contentHash,
      });

      const targetInspection = await inspectTarget({
        url: targetUrl,
        html: fetched.html,
        markdown,
      });

      return {
        success: true,
        mode: "local",
        url: targetUrl,
        title: title || targetInspection.title || targetUrl,
        markdown: targetInspection.markdown || markdown,
        links,
        data: {
          url: targetUrl,
          title: title || targetInspection.title || targetUrl,
          markdown: targetInspection.markdown || markdown,
          links,
          structured: targetInspection.structured,
        },
        evidence: {
          ...targetInspection.evidence,
          tier: lastFetchTier() === "impersonate" ? "impersonate" : "impit-tls",
          contentHash,
          latencyMs: Date.now() - start,
        },
      };
    },

    async parse(p: Record<string, unknown>): Promise<Record<string, unknown>> {
      const url = typeof p.url === "string" ? p.url : undefined;
      if (url && youtubeVideoId(url)) {
        const yt = await parseYouTubeCached(url, {
          language: typeof p.language === "string" ? p.language : undefined,
          bypassCache: Boolean(p.noCache),
        });
        return {
          success: true,
          mode: "local",
          title: yt.title,
          markdown: yt.markdown,
          metadata: { parse: publicParseMeta(yt) },
        };
      }

      let bytes = p.bytes instanceof Uint8Array ? p.bytes : undefined;
      let contentType = typeof p.contentType === "string" ? p.contentType : undefined;
      let fileName = typeof p.fileName === "string" ? p.fileName : url;

      if (!bytes && typeof p.base64 === "string") {
        bytes = new Uint8Array(Buffer.from(p.base64, "base64"));
      }
      if (!bytes && url) {
        const fetched = await fetchResource(url, { maxBytes: maxDownloadBytes() });
        bytes = fetched.body;
        contentType = contentType ?? fetched.contentType;
        fileName = fileName ?? fetched.url;
      }
      if (!bytes) {
        throw new Error("parse requires `url`, `bytes`, or `base64`");
      }

      const parsed = await parseFile(
        { bytes, contentType, fileName },
        {
          ocr: (p.ocr as "auto" | "force" | "off" | undefined) ?? "auto",
          pages: Array.isArray(p.pages) ? p.pages.map(Number) : undefined,
          language: typeof p.language === "string" ? p.language : undefined,
          bypassCache: Boolean(p.noCache),
        }
      );

      return {
        success: true,
        mode: "local",
        title: parsed.title,
        markdown: parsed.markdown,
        metadata: { parse: publicParseMeta(parsed) },
      };
    },

    async run(id: string): Promise<Record<string, unknown>> {
      return {
        success: false,
        mode: "local",
        id,
        status: "not_found",
        error: "Background runs require cloud mode (`webcrawl login` or WEBCRAWL_API_KEY).",
      };
    },

    async map(p: { url: string; limit?: number; search?: string }): Promise<Record<string, unknown>> {
      const targetUrl = /^https?:\/\//i.test(p.url) ? p.url : `https://${p.url}`;
      const mapped = await mapWebsiteUrls(targetUrl, {
        limit: p.limit ?? 100,
      });
      const needle = p.search?.trim().toLowerCase();
      const links = needle
        ? mapped.links.filter((l) => l.toLowerCase().includes(needle))
        : mapped.links;
      return {
        success: true,
        mode: "local",
        url: targetUrl,
        links,
        source: mapped.source,
        total: links.length,
      };
    },

    async crawl(p: { url: string; maxPages?: number }): Promise<Record<string, unknown>> {
      const targetUrl = /^https?:\/\//i.test(p.url) ? p.url : `https://${p.url}`;
      const maxPages = Math.min(25, Math.max(1, p.maxPages ?? 5));
      const mapped = await mapWebsiteUrls(targetUrl, { limit: maxPages * 3 });
      const urls = Array.from(new Set([targetUrl, ...mapped.links])).slice(0, maxPages);

      const pages: Array<Record<string, unknown>> = [];
      for (const u of urls) {
        try {
          const scraped = await this.scrape({ url: u });
          pages.push({
            url: scraped.url ?? u,
            title: scraped.title ?? u,
            markdown: scraped.markdown ?? "",
            evidence: scraped.evidence,
          });
        } catch {
          // continue crawling remaining pages
        }
      }

      return {
        success: true,
        mode: "local",
        url: targetUrl,
        total: pages.length,
        data: pages,
        pages,
      };
    },

    async extract(p: {
      url: string;
      prompt?: string;
      schema?: Record<string, unknown>;
    }): Promise<Record<string, unknown>> {
      const targetUrl = /^https?:\/\//i.test(p.url) ? p.url : `https://${p.url}`;
      const fetched = await fetchWithTlsImpersonation(targetUrl);
      const targetInspection = await inspectTarget({
        url: targetUrl,
        html: fetched.html,
      });
      const siteData = await extractWebsiteData(targetUrl);
      return {
        success: true,
        mode: "local",
        url: targetUrl,
        data: {
          ...siteData,
          ...(targetInspection.structured ? { target: targetInspection.structured } : {}),
        },
        evidence: targetInspection.evidence,
      };
    },

    async rerank(p: {
      query: string;
      documents: Array<string | Record<string, unknown>>;
      topK?: number;
    }): Promise<Record<string, unknown>> {
      const candidates: RawCandidateDocument[] = p.documents.map((doc, idx) => {
        if (typeof doc === "string") {
          return {
            url: `doc://${idx + 1}`,
            title: doc.slice(0, 80),
            description: doc,
            markdown: doc,
            sourceEngine: "direct" as const,
          };
        }
        const text = String(doc.text ?? doc.description ?? doc.markdown ?? doc.title ?? "");
        return {
          url: String(doc.url ?? `doc://${idx + 1}`),
          title: String(doc.title ?? text.slice(0, 80)),
          description: text,
          markdown: text,
          sourceEngine: "direct" as const,
        };
      });

      const ranked = await rankDocuments(p.query, candidates, {
        topK: p.topK ?? candidates.length,
      });

      return {
        success: true,
        mode: "local",
        results: ranked.results.map((r) => ({
          url: r.url,
          title: r.title,
          description: r.description,
          score: r.score,
          scoreBreakdown: r.scoreBreakdown,
        })),
      };
    },

    async categories(): Promise<Record<string, unknown>> {
      return {
        success: true,
        mode: "local",
        ...getSearchCategoriesCatalog(),
      };
    },

    async targets(): Promise<Record<string, unknown>> {
      return {
        success: true,
        mode: "local",
        targets: listTargets().map((t) => ({
          id: t.id,
          name: t.name,
          category: t.category,
          returns: t.returns,
          requirements: t.requirements,
          examples: t.examples,
        })),
      };
    },

    async usage(): Promise<Record<string, unknown>> {
      return {
        success: true,
        mode: "local",
        plan: "open-source-local",
        note: "Running locally with zero API key. Set WEBCRAWL_API_KEY or run `webcrawl login` to use webcrawl.app cloud stealth browsers and global cache.",
      };
    },
  };
}
