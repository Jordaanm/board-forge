import { useEffect, type AnchorHTMLAttributes } from 'react';
import { Link, useParams } from 'react-router-dom';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import rehypeHighlight from 'rehype-highlight';
import { rehypeRewriteLinks } from './rehype-rewrite-links';
import 'highlight.js/styles/github-dark.css';
import './docs.css';

function DocLink({ href, children, ...rest }: AnchorHTMLAttributes<HTMLAnchorElement>) {
  if (href && href.startsWith('/')) {
    return <Link to={href}>{children}</Link>;
  }
  return (
    <a href={href} target="_blank" rel="noopener noreferrer" {...rest}>
      {children}
    </a>
  );
}

const RAW_DOCS = import.meta.glob('../../../../../docs/*.md', {
  query: '?raw',
  import: 'default',
  eager: true,
}) as Record<string, string>;

const SLUG_TO_RAW: Record<string, string> = Object.fromEntries(
  Object.entries(RAW_DOCS).map(([path, raw]) => {
    const slug = path.split('/').pop()!.replace(/\.md$/, '');
    return [slug, raw];
  }),
);

function extractH1(raw: string): string | null {
  const match = /^#\s+(.+?)\s*$/m.exec(raw);
  return match ? match[1] : null;
}

export function DocsPage() {
  const { slug } = useParams<{ slug: string }>();
  const raw = slug ? SLUG_TO_RAW[slug] : undefined;

  useEffect(() => {
    const previous = document.title;
    if (!raw) {
      document.title = 'Doc not found · Board Together Docs';
    } else {
      const h1 = extractH1(raw);
      document.title = h1
        ? `${h1} · Board Together Docs`
        : 'Board Together Docs';
    }
    return () => { document.title = previous; };
  }, [raw]);

  if (!raw) {
    return (
      <div className="docs-page">
        <h1>Doc not found</h1>
        <p>
          <Link to="/docs">← Back to docs</Link>
        </p>
      </div>
    );
  }

  return (
    <div className="docs-page">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        rehypePlugins={[rehypeRewriteLinks, rehypeHighlight]}
        components={{ a: DocLink }}
      >
        {raw}
      </ReactMarkdown>
    </div>
  );
}
