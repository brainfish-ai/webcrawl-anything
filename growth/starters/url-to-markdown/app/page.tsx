"use client";

import { FormEvent, useMemo, useState } from "react";
import { markdownToHtml } from "@/lib/markdown";

type PageResult = {
  url: string;
  title: string;
  markdown: string;
  mode: "hosted" | "local";
  cached?: boolean;
};

function Logo() {
  return (
    <svg width="28" height="28" viewBox="0 0 32 32" aria-hidden="true">
      <rect width="32" height="32" rx="7" fill="#1b1631" />
      <g strokeLinejoin="round" strokeLinecap="round" fill="none" strokeWidth="3">
        <path d="M5 21.5L16 27.5L27 21.5" stroke="#8a80b8" />
        <path d="M5 16L16 22L27 16" stroke="#c9b8ff" />
      </g>
      <path
        d="M16 4.5L27 10.5L16 16.5L5 10.5Z"
        fill="#8b6cff"
        stroke="#8b6cff"
        strokeWidth="2"
        strokeLinejoin="round"
      />
    </svg>
  );
}

export default function HomePage() {
  const [url, setUrl] = useState("https://example.com");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [page, setPage] = useState<PageResult | null>(null);

  const html = useMemo(() => (page ? markdownToHtml(page.markdown) : ""), [page]);

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/read", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ url }),
      });
      const data = (await res.json()) as PageResult & { error?: string };
      if (!res.ok) {
        throw new Error(data.error || `Request failed (${res.status})`);
      }
      setPage(data);
    } catch (err) {
      setPage(null);
      setError(err instanceof Error ? err.message : "Could not read that URL.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="shell">
      <div className="brand">
        <Logo />
        Webcrawl
      </div>
      <header className="lede">
        <h1>URL to clean Markdown</h1>
        <p>
          Fetch a public page through webcrawl and read the retrieved Markdown. The server holds any
          API key. No language-model rewrite is applied.
        </p>
      </header>

      <section className="panel">
        <form className="row" onSubmit={onSubmit}>
          <label className="sr" htmlFor="url">
            Page URL
          </label>
          <input
            id="url"
            type="url"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            placeholder="https://example.com"
            autoComplete="off"
            required
          />
          <button type="submit" disabled={loading}>
            {loading ? "Reading…" : "Read page"}
          </button>
        </form>
        {page ? (
          <div className="meta">
            <span className="chip accent">{page.mode}</span>
            {page.cached ? <span className="chip">cached</span> : null}
            <a className="chip" href={page.url} rel="noreferrer">
              {page.url}
            </a>
          </div>
        ) : (
          <div className="meta">
            <span className="chip">Try https://example.com</span>
          </div>
        )}
        {error ? <div className="err">{error}</div> : null}
        {page ? (
          <article className="article">
            <h1>{page.title}</h1>
            <div dangerouslySetInnerHTML={{ __html: html }} />
          </article>
        ) : null}
      </section>

      <footer className="foot">
        <nav>
          <a href="https://webcrawl.app/?utm_source=github&utm_medium=starter&utm_campaign=url-to-markdown">
            webcrawl.app
          </a>
          <a href="https://github.com/brainfish-ai/webcrawl-anything">GitHub</a>
          <a href="https://github.com/brainfish-ai/webcrawl-anything/blob/main/CONTRIBUTING.md">
            Contribute
          </a>
        </nav>
        Markdown is the page webcrawl returned, not a generated summary.
      </footer>
    </main>
  );
}
