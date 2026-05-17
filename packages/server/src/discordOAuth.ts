import type { Request, Response } from 'express';
import { discordClientId, discordClientSecret, discordRedirectAllowlist } from './config';

const DISCORD_TOKEN_URL = 'https://discord.com/api/oauth2/token';

interface DiscordTokenResponse {
  access_token?:  unknown;
  refresh_token?: unknown;
  expires_in?:    unknown;
  error?:         unknown;
  error_description?: unknown;
}

function isNonEmptyString(v: unknown): v is string {
  return typeof v === 'string' && v.length > 0;
}

function sanitiseDiscordError(body: DiscordTokenResponse): { error: string; error_description?: string } {
  const error = isNonEmptyString(body.error) ? body.error : 'discord_error';
  const desc  = isNonEmptyString(body.error_description) ? body.error_description : undefined;
  return desc ? { error, error_description: desc } : { error };
}

export async function handleDiscordExchange(req: Request, res: Response): Promise<void> {
  if (!discordClientId || !discordClientSecret) {
    console.error('[discord-oauth] missing DISCORD_CLIENT_ID or DISCORD_CLIENT_SECRET');
    res.status(500).json({ error: 'server_misconfigured' });
    return;
  }

  const body = req.body as Record<string, unknown> | undefined;
  if (!body || typeof body !== 'object') {
    res.status(400).json({ error: 'invalid_request' });
    return;
  }

  const grantType = body.grant_type;
  const form = new URLSearchParams();
  form.set('client_id',     discordClientId);
  form.set('client_secret', discordClientSecret);

  if (grantType === 'authorization_code') {
    const { code, code_verifier, redirect_uri } = body;
    if (!isNonEmptyString(code) || !isNonEmptyString(code_verifier) || !isNonEmptyString(redirect_uri)) {
      res.status(400).json({ error: 'invalid_request' });
      return;
    }
    if (!discordRedirectAllowlist.has(redirect_uri)) {
      res.status(400).json({ error: 'redirect_uri_not_allowed' });
      return;
    }
    form.set('grant_type',    'authorization_code');
    form.set('code',          code);
    form.set('code_verifier', code_verifier);
    form.set('redirect_uri',  redirect_uri);
  } else if (grantType === 'refresh_token') {
    const { refresh_token } = body;
    if (!isNonEmptyString(refresh_token)) {
      res.status(400).json({ error: 'invalid_request' });
      return;
    }
    form.set('grant_type',    'refresh_token');
    form.set('refresh_token', refresh_token);
  } else {
    res.status(400).json({ error: 'unsupported_grant_type' });
    return;
  }

  let upstream: globalThis.Response;
  try {
    upstream = await fetch(DISCORD_TOKEN_URL, {
      method:  'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body:    form.toString(),
    });
  } catch (err) {
    console.error('[discord-oauth] upstream fetch failed', err);
    res.status(502).json({ error: 'upstream_unreachable' });
    return;
  }

  let payload: DiscordTokenResponse;
  try {
    payload = await upstream.json() as DiscordTokenResponse;
  } catch {
    console.error('[discord-oauth] upstream returned non-JSON', upstream.status);
    res.status(502).json({ error: 'upstream_invalid' });
    return;
  }

  if (!upstream.ok) {
    const status = upstream.status;
    console.warn('[discord-oauth] upstream error', status, isNonEmptyString(payload.error) ? payload.error : 'unknown');
    res.status(status >= 400 && status < 500 ? status : 502).json(sanitiseDiscordError(payload));
    return;
  }

  if (!isNonEmptyString(payload.access_token) || typeof payload.expires_in !== 'number') {
    console.error('[discord-oauth] upstream missing fields');
    res.status(502).json({ error: 'upstream_invalid' });
    return;
  }

  const out: { access_token: string; expires_in: number; refresh_token?: string } = {
    access_token: payload.access_token,
    expires_in:   payload.expires_in,
  };
  if (isNonEmptyString(payload.refresh_token)) out.refresh_token = payload.refresh_token;
  res.json(out);
}
