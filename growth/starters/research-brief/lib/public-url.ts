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

export function parsePublicHttpUrl(raw: string): URL | null {
  const trimmed = raw.trim();
  if (!trimmed) {
    return null;
  }
  let url: URL;
  try {
    url = new URL(trimmed);
  } catch {
    return null;
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    return null;
  }
  if (url.username || url.password) {
    return null;
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
    return null;
  }
  return url;
}
