"use client";

import { FormEvent, useState } from "react";

type SourceCard = {
  title: string;
  url: string;
  excerpt: string;
  kind: "page-excerpt" | "search-snippet";
  error?: string;
};

type Brief = {
  query: string;
  mode: "hosted" | "local";
  disclaimer: string;
  sources: SourceCard[];
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
  const [query, setQuery] = useState("example domain IANA");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [brief, setBrief] = useState<Brief | null>(null);

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/brief", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ query, limit: 4 }),
      });
      const data = (await res.json()) as Brief & { error?: string };
      if (!res.ok) {
        throw new Error(data.error || `Request failed (${res.status})`);
      }
      setBrief(data);
    } catch (err) {
      setBrief(null);
      setError(err instanceof Error ? err.message : "Could not build a brief.");
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
        <h1>Multi-source research brief</h1>
        <p>
          Search the live web, scrape the hits, and quote what came back. If a page cannot be
          fetched, the search snippet is shown and labeled. Nothing here is model-written.
        </p>
      </header>

      <p className="banner">
        Retrieved excerpts only. No language model is called. Cite the source URL before you reuse a
        claim.
      </p>

      <section className="panel">
        <form className="row" onSubmit={onSubmit}>
          <label className="sr" htmlFor="query">
            Research query
          </label>
          <input
            id="query"
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="What should we look up?"
            autoComplete="off"
            required
          />
          <button type="submit" disabled={loading}>
            {loading ? "Fetching sources…" : "Build brief"}
          </button>
        </form>
        {error ? <div className="err">{error}</div> : null}
        {brief ? (
          <div className="sources">
            {brief.sources.map((source) => (
              <article className="source" key={source.url}>
                <h2>{source.title}</h2>
                <div className="chips">
                  <span className="chip">{brief.mode}</span>
                  <span className="chip">{source.kind === "page-excerpt" ? "scraped page" : "search snippet"}</span>
                  <a className="chip" href={source.url} rel="noreferrer">
                    {source.url}
                  </a>
                </div>
                <blockquote>{source.excerpt}</blockquote>
              </article>
            ))}
          </div>
        ) : null}
      </section>

      <footer className="foot">
        <nav>
          <a href="https://webcrawl.app/?utm_source=github&utm_medium=starter&utm_campaign=research-brief">
            webcrawl.app
          </a>
          <a href="https://github.com/brainfish-ai/webcrawl-anything">GitHub</a>
          <a href="https://github.com/brainfish-ai/webcrawl-anything/blob/main/CONTRIBUTING.md">
            Contribute
          </a>
        </nav>
        {brief ? brief.disclaimer : "Star the repo if this saved you a copy-paste loop."}
      </footer>
    </main>
  );
}
