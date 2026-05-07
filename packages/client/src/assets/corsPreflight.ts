// Lightweight CORS / reachability probe used by AssetManagerModal at add /
// edit time. Issue #8 of issues--asset-registry.md.
//
// `probe(url)` does a HEAD first and falls back to GET for servers that
// reject HEAD (e.g. some CDNs return 405). Network failures and non-2xx
// status codes are surfaced as a structured error so the manager UI can
// render an actionable inline message ("CORS blocked", "404 Not found",
// "Network unreachable"). The probe is a heads-up, not a gate — the host
// can still commit the entry on failure.

export type ProbeError =
  | { kind: 'network';   message: string }
  | { kind: 'cors';      message: string }
  | { kind: 'http';      message: string; status: number }
  | { kind: 'invalid';   message: string };

export type ProbeResult =
  | { ok: true }
  | { ok: false; error: ProbeError };

export type Fetcher = (url: string, init: { method: string }) => Promise<Response>;

const defaultFetcher: Fetcher = (url, init) => fetch(url, init);

export async function probe(url: string, fetcher: Fetcher = defaultFetcher): Promise<ProbeResult> {
  const trimmed = url.trim();
  if (!trimmed) {
    return { ok: false, error: { kind: 'invalid', message: 'URL is empty.' } };
  }
  try {
    new URL(trimmed);
  } catch {
    return { ok: false, error: { kind: 'invalid', message: 'URL is not parseable.' } };
  }

  const head = await runOnce(trimmed, 'HEAD', fetcher);
  if (head.ok) return { ok: true };
  // 405 / 501 from picky servers — try a GET before giving up.
  if (head.error.kind === 'http' && (head.error.status === 405 || head.error.status === 501)) {
    const get = await runOnce(trimmed, 'GET', fetcher);
    if (get.ok) return { ok: true };
    return get;
  }
  return head;
}

async function runOnce(url: string, method: string, fetcher: Fetcher): Promise<ProbeResult> {
  let res: Response;
  try {
    res = await fetcher(url, { method });
  } catch (e) {
    const message = (e as Error).message ?? '';
    // Browsers report opaque CORS failures as a TypeError with a generic
    // "Failed to fetch" or "NetworkError" message; we can't tell CORS apart
    // from a real network outage at the JS level, so we hint at both.
    if (/cors/i.test(message)) {
      return { ok: false, error: { kind: 'cors', message: message || 'CORS blocked.' } };
    }
    return { ok: false, error: { kind: 'network', message: message || 'Network error or CORS blocked.' } };
  }
  if (!res.ok) {
    return {
      ok: false,
      error: { kind: 'http', status: res.status, message: `${res.status} ${res.statusText || 'request failed'}` },
    };
  }
  return { ok: true };
}
