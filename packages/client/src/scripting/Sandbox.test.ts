import { describe, test, expect } from 'vitest';
import { compileTypescript } from './Compiler';
import { loadModule } from './Sandbox';
import { Game } from './Game';

async function compile(source: string): Promise<string> {
  const result = await compileTypescript(source);
  if (!result.ok) throw new Error(`compile failed: ${result.error}`);
  return result.js;
}

describe('Sandbox.loadModule', () => {
  test('returns the default export of a module', async () => {
    const js = await compile(`export default class extends Game { onScriptLoaded() { return 'ok'; } }`);
    const ns = loadModule(js, { Game });
    expect(typeof ns.default).toBe('function');
  });

  test('blocks realm-scoped host APIs (window, document, timers, fetch, XMLHttpRequest)', async () => {
    const js = await compile(`
      export const probes = {
        window:           typeof window,
        document:         typeof document,
        setTimeout:       typeof setTimeout,
        setInterval:      typeof setInterval,
        fetch:            typeof fetch,
        XMLHttpRequest:   typeof XMLHttpRequest,
      };
    `);
    const ns = loadModule(js, {});
    const probes = ns.probes as Record<string, string>;
    expect(probes.window).toBe('undefined');
    expect(probes.document).toBe('undefined');
    expect(probes.setTimeout).toBe('undefined');
    expect(probes.setInterval).toBe('undefined');
    expect(probes.fetch).toBe('undefined');
    expect(probes.XMLHttpRequest).toBe('undefined');
  });

  test('exposes JS intrinsics (Math, JSON, Promise, Array)', async () => {
    const js = await compile(`
      export const probes = {
        math:    Math.floor(3.7),
        json:    JSON.stringify({ a: 1 }),
        promise: Promise.resolve(7),
        array:   Array.isArray([1, 2, 3]),
      };
    `);
    const ns = loadModule(js, {});
    const probes = ns.probes as Record<string, unknown>;
    expect(probes.math).toBe(3);
    expect(probes.json).toBe('{"a":1}');
    expect(probes.array).toBe(true);
    await expect(probes.promise as Promise<number>).resolves.toBe(7);
  });

  test('passes injected globals through to the module', async () => {
    const js = await compile(`
      export const echoed = injected;
    `);
    const ns = loadModule(js, { injected: 'hello' });
    expect(ns.echoed).toBe('hello');
  });
});
