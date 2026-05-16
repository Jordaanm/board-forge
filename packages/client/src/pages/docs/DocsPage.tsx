import { useParams } from 'react-router-dom';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import rehypeHighlight from 'rehype-highlight';
import 'highlight.js/styles/github-dark.css';
import './docs.css';

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

export function DocsPage() {
  const { slug } = useParams<{ slug: string }>();
  const raw = slug ? SLUG_TO_RAW[slug] : undefined;

  if (!raw) {
    return (
      <div className="docs-page">
        <h1>Doc not found</h1>
      </div>
    );
  }

  return (
    <div className="docs-page">
      <ReactMarkdown remarkPlugins={[remarkGfm]} rehypePlugins={[rehypeHighlight]}>
        {raw}
      </ReactMarkdown>
    </div>
  );
}
