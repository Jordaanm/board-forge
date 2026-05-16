// @vitest-environment jsdom
import { describe, test, expect, afterEach } from 'vitest';
import { render, cleanup } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { DocsLayout } from './DocsLayout';
import { DocsIndex } from './DocsIndex';
import { DOC_NAV } from './nav';

afterEach(cleanup);

function renderIndex() {
  return render(
    <MemoryRouter initialEntries={['/docs']}>
      <Routes>
        <Route path="/docs" element={<DocsLayout />}>
          <Route index element={<DocsIndex />} />
        </Route>
      </Routes>
    </MemoryRouter>,
  );
}

describe('DocsIndex', () => {
  test('renders hero with app name and description', () => {
    const { container } = renderIndex();
    const heroTitle = container.querySelector('.docs-index__title');
    expect(heroTitle?.textContent).toContain('Board Together');
    expect(container.querySelector('.docs-index__lede')?.textContent ?? '')
      .toMatch(/tabletop/i);
  });

  test('renders one card per doc nav entry, each linking to its slug', () => {
    const { container } = renderIndex();
    for (const entry of DOC_NAV) {
      const link = container.querySelector(
        `.docs-index__card[href="/docs/${entry.slug}"]`,
      );
      expect(link, `missing card for ${entry.slug}`).not.toBeNull();
      expect(link!.textContent).toContain(entry.title);
    }
  });

  test('renders inside DocsLayout (sidebar + header present)', () => {
    const { container } = renderIndex();
    expect(container.querySelector('.docs__sidebar')).not.toBeNull();
    expect(container.querySelector('.docs__header')).not.toBeNull();
  });

  test('sets document.title to "Docs · Board Together"', () => {
    renderIndex();
    expect(document.title).toBe('Docs · Board Together');
  });
});
