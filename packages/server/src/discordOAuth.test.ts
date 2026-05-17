import { describe, test, expect, beforeAll, afterAll, beforeEach, afterEach, vi } from 'vitest';

vi.hoisted(() => {
  process.env.DISCORD_CLIENT_ID              = 'test-client-id';
  process.env.DISCORD_CLIENT_SECRET          = 'test-client-secret';
  process.env.DISCORD_REDIRECT_URI_ALLOWLIST = 'http://localhost:5173/auth/discord/callback';
});

import { server } from './app';

const PORT = 3098;
const URL = `http://localhost:${PORT}/oauth/discord/exchange`;

beforeAll(() => new Promise<void>((r) => server.listen(PORT, r)));
afterAll(() => new Promise<void>((r) => server.close(() => r())));

const realFetch = globalThis.fetch;

interface FetchCall {
  url:  string;
  init: RequestInit | undefined;
}

let calls: FetchCall[] = [];

function stubFetch(response: { status: number; body: unknown }) {
  const fn = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
    calls.push({ url: String(url), init });
    return new Response(JSON.stringify(response.body), {
      status:  response.status,
      headers: { 'Content-Type': 'application/json' },
    });
  });
  globalThis.fetch = fn as unknown as typeof fetch;
}

beforeEach(() => { calls = []; });
afterEach(() => { globalThis.fetch = realFetch; });

async function post(body: unknown) {
  return realFetch(URL, {
    method:  'POST',
    headers: { 'Content-Type': 'application/json' },
    body:    JSON.stringify(body),
  });
}

describe('POST /oauth/discord/exchange', () => {
  test('authorization_code happy path forwards to Discord and returns tokens', async () => {
    stubFetch({
      status: 200,
      body:   { access_token: 'AT', refresh_token: 'RT', expires_in: 604800, token_type: 'Bearer', scope: 'identify' },
    });

    const res = await post({
      grant_type:    'authorization_code',
      code:          'abc',
      code_verifier: 'verifier',
      redirect_uri:  'http://localhost:5173/auth/discord/callback',
    });

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ access_token: 'AT', refresh_token: 'RT', expires_in: 604800 });

    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe('https://discord.com/api/oauth2/token');
    const form = new URLSearchParams(calls[0].init?.body as string);
    expect(form.get('grant_type')).toBe('authorization_code');
    expect(form.get('client_id')).toBe('test-client-id');
    expect(form.get('client_secret')).toBe('test-client-secret');
    expect(form.get('code')).toBe('abc');
    expect(form.get('code_verifier')).toBe('verifier');
    expect(form.get('redirect_uri')).toBe('http://localhost:5173/auth/discord/callback');
  });

  test('refresh_token happy path forwards refresh grant', async () => {
    stubFetch({
      status: 200,
      body:   { access_token: 'AT2', refresh_token: 'RT2', expires_in: 604800 },
    });

    const res = await post({ grant_type: 'refresh_token', refresh_token: 'old-rt' });

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ access_token: 'AT2', refresh_token: 'RT2', expires_in: 604800 });

    const form = new URLSearchParams(calls[0].init?.body as string);
    expect(form.get('grant_type')).toBe('refresh_token');
    expect(form.get('refresh_token')).toBe('old-rt');
    expect(form.has('code')).toBe(false);
  });

  test('Discord 4xx is sanitised and passed through', async () => {
    stubFetch({
      status: 400,
      body:   { error: 'invalid_grant', error_description: 'Invalid "code" in request.' },
    });

    const res = await post({
      grant_type:    'authorization_code',
      code:          'stale',
      code_verifier: 'verifier',
      redirect_uri:  'http://localhost:5173/auth/discord/callback',
    });

    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: 'invalid_grant', error_description: 'Invalid "code" in request.' });
  });

  test('missing required fields → 400 with no upstream call', async () => {
    stubFetch({ status: 200, body: {} });

    const res = await post({ grant_type: 'authorization_code', code: 'abc' });

    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: 'invalid_request' });
    expect(calls).toHaveLength(0);
  });

  test('redirect_uri not in allowlist → 400 with no upstream call', async () => {
    stubFetch({ status: 200, body: {} });

    const res = await post({
      grant_type:    'authorization_code',
      code:          'abc',
      code_verifier: 'verifier',
      redirect_uri:  'https://evil.example.com/cb',
    });

    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: 'redirect_uri_not_allowed' });
    expect(calls).toHaveLength(0);
  });

  test('unsupported grant_type → 400', async () => {
    stubFetch({ status: 200, body: {} });

    const res = await post({ grant_type: 'client_credentials' });

    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: 'unsupported_grant_type' });
    expect(calls).toHaveLength(0);
  });

  test('refresh_token missing the token → 400', async () => {
    stubFetch({ status: 200, body: {} });

    const res = await post({ grant_type: 'refresh_token' });

    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: 'invalid_request' });
    expect(calls).toHaveLength(0);
  });

  test('rpc flow exchanges without code_verifier or allowlist check', async () => {
    stubFetch({
      status: 200,
      body:   { access_token: 'rpc-at', refresh_token: 'rpc-rt', expires_in: 604800 },
    });

    const res = await post({
      grant_type: 'authorization_code',
      code:       'rpc-code',
      flow:       'rpc',
    });

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ access_token: 'rpc-at', refresh_token: 'rpc-rt', expires_in: 604800 });

    const form = new URLSearchParams(calls[0].init?.body as string);
    expect(form.get('grant_type')).toBe('authorization_code');
    expect(form.get('code')).toBe('rpc-code');
    expect(form.get('redirect_uri')).toBe('');
    expect(form.has('code_verifier')).toBe(false);
  });

  test('rpc flow still rejects when code is missing', async () => {
    stubFetch({ status: 200, body: {} });

    const res = await post({ grant_type: 'authorization_code', flow: 'rpc' });

    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: 'invalid_request' });
    expect(calls).toHaveLength(0);
  });
});
