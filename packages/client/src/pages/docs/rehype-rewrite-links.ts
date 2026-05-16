import type { Root } from 'hast';
import { visit } from 'unist-util-visit';

export function rehypeRewriteLinks() {
  return (tree: Root) => {
    visit(tree, 'element', (node) => {
      if (node.tagName !== 'a') return;
      const href = node.properties?.href;
      if (typeof href !== 'string') return;

      if (/^[a-z][a-z0-9+.-]*:/i.test(href)) return;
      if (href.startsWith('#')) return;
      if (href.startsWith('/')) return;

      const hashIdx = href.indexOf('#');
      const path = hashIdx === -1 ? href : href.slice(0, hashIdx);
      const hash = hashIdx === -1 ? ''   : href.slice(hashIdx);

      const match = /^(?:\.\/)?([^/]+)\.md$/.exec(path);
      if (!match) return;

      node.properties.href = `/docs/${match[1]}${hash}`;
    });
  };
}
