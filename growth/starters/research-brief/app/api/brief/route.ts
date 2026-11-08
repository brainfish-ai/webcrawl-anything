import { NextResponse } from "next/server";
import { buildBrief } from "@/lib/webcrawl";

export const runtime = "nodejs";
export const maxDuration = 60;

export async function POST(request: Request) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Send JSON with a query field." }, { status: 400 });
  }
  const rec = body && typeof body === "object" ? (body as { query?: unknown; limit?: unknown }) : {};
  const query = typeof rec.query === "string" ? rec.query : "";
  const limit = typeof rec.limit === "number" ? rec.limit : 4;

  try {
    const brief = await buildBrief(query, limit);
    return NextResponse.json(brief);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Brief failed.";
    const status = /Enter a search query/.test(message) ? 400 : 502;
    return NextResponse.json({ error: message }, { status });
  }
}
