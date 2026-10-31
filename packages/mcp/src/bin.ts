#!/usr/bin/env node
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { WebcrawlClient, resolveConfig } from "@webcrawl/client";
import { createServer, resolveSchemaProfile, type WebcrawlLikeClient } from "./server.js";

const cfg = resolveConfig();
let client: WebcrawlLikeClient;

if (cfg.effectiveMode === "local") {
  try {
    // Load the shared local engine when running from the monorepo / local install without an API key
    const localEngineSpec = ["..", "..", "..", "src", "local-engine.js"].join("/");
    const localMod = (await import(localEngineSpec)) as {
      createLocalEngineClient: () => WebcrawlLikeClient;
    };
    client = localMod.createLocalEngineClient();
    process.stderr.write(
      "webcrawl-mcp: running in zero-key LOCAL engine mode. Set WEBCRAWL_API_KEY (or run `webcrawl login`) to upgrade to webcrawl.app cloud.\n"
    );
  } catch {
    process.stderr.write(
      "webcrawl-mcp: no API key configured; falling back to https://webcrawl.app (set WEBCRAWL_API_KEY or run `webcrawl login`).\n"
    );
    client = new WebcrawlClient({ apiKey: cfg.apiKey, baseUrl: cfg.baseUrl, userAgent: "webcrawl-mcp/0.1" });
  }
} else {
  client = new WebcrawlClient({ apiKey: cfg.apiKey, baseUrl: cfg.baseUrl, userAgent: "webcrawl-mcp/0.1" });
}

await createServer(client, { schemaProfile: resolveSchemaProfile() }).connect(new StdioServerTransport());
