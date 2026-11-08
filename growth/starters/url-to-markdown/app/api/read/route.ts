import { NextResponse } from "next/server";
import { parsePublicHttpUrl } from "@/lib/public-url";
import { scrapePage } from "@/lib/webcrawl";

export const runtime = "nodejs";
export const maxDuration = 60;

export async function POST(request: Request) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Send JSON with a url field." }, { status: 400 });
  }
  const urlRaw = body && typeof body === "object" && "url" in body ? String((body as { url?: unknown }).url ?? "") : "";
  let url: URL;
  try {
    url = parsePublicHttpUrl(urlRaw);
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : "Invalid URL." }, { status: 400 });
  }

  try {
    const page = await scrapePage(url.toString());
    return NextResponse.json(page);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Scrape failed.";
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
