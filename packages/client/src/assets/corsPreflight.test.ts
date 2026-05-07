import { describe, test, expect } from 'vitest';
import { probe, type Fetcher } from './corsPreflight';

const okResponse  = (status = 200): Response => ({ ok: true,  status, statusText: 'OK' } as unknown as Response);
const errResponse = (status: number, statusText = ''): Response => ({ ok: false, status, statusText } as unknown as Response);

describe('corsPreflight.probe', () => {
  test('happy path — HEAD 200 → ok', async () => {
    const calls: string[] = [];
    const fetcher: Fetcher = async (_url, { method }) => {
      calls.push(method);
      return okResponse();
    };
    const res = await probe('https://example.com/img.png', fetcher);
    expect(res.ok).toBe(true);
    expect(calls).toEqual(['HEAD']);
  });

  test('HEAD-rejecting server (405) → falls back to GET', async () => {
    const calls: string[] = [];
    const fetcher: Fetcher = async (_url, { method }) => {
      calls.push(method);
      return method === 'HEAD' ? errResponse(405, 'Method Not Allowed') : okResponse();
    };
    const res = await probe('https://picky.example.com/img.png', fetcher);
    expect(res.ok).toBe(true);
    expect(calls).toEqual(['HEAD', 'GET']);
  });

  test('HEAD 501 → falls back to GET', async () => {
    const fetcher: Fetcher = async (_url, { method }) =>
      method === 'HEAD' ? errResponse(501, 'Not Implemented') : okResponse();
    const res = await probe('https://example.com/img.png', fetcher);
    expect(res.ok).toBe(true);
  });

  test('non-2xx HTTP status surfaces as { kind: "http", status }', async () => {
    const fetcher: Fetcher = async () => errResponse(404, 'Not Found');
    const res = await probe('https://example.com/missing.png', fetcher);
    expect(res.ok).toBe(false);
    if (!res.ok) {
      expect(res.error.kind).toBe('http');
      if (res.error.kind === 'http') expect(res.error.status).toBe(404);
    }
  });

  test('thrown TypeError → { kind: "network" }', async () => {
    const fetcher: Fetcher = async () => { throw new TypeError('Failed to fetch'); };
    const res = await probe('https://blocked.example.com/img.png', fetcher);
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error.kind).toBe('network');
  });

  test('error message mentioning CORS → { kind: "cors" }', async () => {
    const fetcher: Fetcher = async () => { throw new Error('Blocked by CORS policy'); };
    const res = await probe('https://blocked.example.com/img.png', fetcher);
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error.kind).toBe('cors');
  });

  test('empty URL → { kind: "invalid" }', async () => {
    const res = await probe('   ', async () => okResponse());
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error.kind).toBe('invalid');
  });

  test('non-parseable URL → { kind: "invalid" }', async () => {
    const res = await probe('not a url', async () => okResponse());
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error.kind).toBe('invalid');
  });
});
