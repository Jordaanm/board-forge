import { describe, test, expect } from 'vitest';
import type { Root, Element } from 'hast';
import { rehypeRewriteLinks } from './rehype-rewrite-links';

function makeAnchor(href: string): Element {
  return {
    type: 'element',
    tagName: 'a',
    properties: { href },
    children: [],
  };
}

function run(href: string): string {
  const anchor = makeAnchor(href);
  const tree: Root = { type: 'root', children: [anchor] };
  rehypeRewriteLinks()(tree);
  return anchor.properties!.href as string;
}

describe('rehypeRewriteLinks', () => {
  test('rewrites ./foo.md to /docs/foo', () => {
    expect(run('./scripting.md')).toBe('/docs/scripting');
  });

  test('rewrites bare foo.md to /docs/foo', () => {
    expect(run('architecture.md')).toBe('/docs/architecture');
  });

  test('preserves fragment after rewrite', () => {
    expect(run('./controls.md#camera')).toBe('/docs/controls#camera');
  });

  test('leaves http(s) links untouched', () => {
    expect(run('https://bun.sh')).toBe('https://bun.sh');
  });

  test('leaves hash-only links untouched', () => {
    expect(run('#section')).toBe('#section');
  });

  test('leaves absolute SPA paths untouched', () => {
    expect(run('/docs')).toBe('/docs');
  });

  test('leaves non-md relative paths untouched', () => {
    expect(run('./image.png')).toBe('./image.png');
  });

  test('leaves mailto: untouched', () => {
    expect(run('mailto:x@y.com')).toBe('mailto:x@y.com');
  });
});
