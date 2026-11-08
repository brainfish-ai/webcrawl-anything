const PRIVATE_V4 = /^(0\.|10\.|127\.|169\.254\.|192\.168\.|::1$)/;

function isPrivateV4(host: string): boolean {
  if (PRIVATE_V4.test(host)) {
    return true;
  }
  const m = host.match(/^172\.(\d+)\./);
  if (!m) {
    return false;
  }
  const second = Number(m[1]);
  return second >= 16 && second <= 31;
}

/**
 * Accept only http(s) URLs that look like public sites.
 * This is a starter guard, not a full SSRF proxy filter.
 */
export function parsePublicHttpUrl(raw: string): URL {
  const trimmed = raw.trim();
  if (!trimmed) {
    throw new Error("Enter a URL.");
  }
  let url: URL;
  try {
    url = new URL(trimmed);
  } catch {
    throw new Error("That URL is not valid.");
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error("Only http and https URLs are allowed.");
  }
  if (url.username || url.password) {
    throw new Error("URLs with userinfo are not allowed.");
  }
  const host = url.hostname.replace(/^\[|\]$/g, "").toLowerCase();
  if (
    host === "localhost" ||
    host === "0.0.0.0" ||
    host === "::1" ||
    host.endsWith(".local") ||
    host.endsWith(".internal") ||
    host === "metadata.google.internal" ||
    isPrivateV4(host)
  ) {
    throw new Error("That host is not a public web URL.");
  }
  return url;
}
