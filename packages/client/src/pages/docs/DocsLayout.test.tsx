// @vitest-environment jsdom
import { describe, test, expect, afterEach } from 'vitest';
import { render, cleanup } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { DocsLayout } from './DocsLayout';
import { DocsPage } from './DocsPage';
import { DOC_NAV, DOC_GROUPS } from './nav';

afterEach(cleanup);

describe('DocsLayout', () => {
  test('renders sidebar with all nav entries grouped by audience', () => {
    const { container } = render(
      <MemoryRouter initialEntries={['/docs/scripting']}>
        <Routes>
          <Route path="/docs" element={<DocsLayout />}>
            <Route path=":slug" element={<DocsPage />} />
          </Route>
        </Routes>
      </MemoryRouter>,
    );

    const headings = Array.from(container.querySelectorAll('.docs__nav-heading'))
      .map(el => el.textContent);
    for (const group of DOC_GROUPS) {
      expect(headings).toContain(group);
    }

    for (const entry of DOC_NAV) {
      const link = container.querySelector(`a[href="/docs/${entry.slug}"]`);
      expect(link).not.toBeNull();
    }
  });

  test('marks the current slug as active', () => {
    const { container } = render(
      <MemoryRouter initialEntries={['/docs/scripting']}>
        <Routes>
          <Route path="/docs" element={<DocsLayout />}>
            <Route path=":slug" element={<DocsPage />} />
          </Route>
        </Routes>
      </MemoryRouter>,
    );

    const active = container.querySelector('.docs__nav-link--active');
    expect(active).not.toBeNull();
    expect(active!.getAttribute('href')).toBe('/docs/scripting');
  });

  test('wordmark links to /', () => {
    const { container } = render(
      <MemoryRouter initialEntries={['/docs/scripting']}>
        <Routes>
          <Route path="/docs" element={<DocsLayout />}>
            <Route path=":slug" element={<DocsPage />} />
          </Route>
        </Routes>
      </MemoryRouter>,
    );
    const brand = container.querySelector('.docs__brand');
    expect(brand).not.toBeNull();
    expect(brand!.getAttribute('href')).toBe('/');
  });

  test('not-found page renders inside layout with sidebar and back link', () => {
    const { container } = render(
      <MemoryRouter initialEntries={['/docs/no-such-doc']}>
        <Routes>
          <Route path="/docs" element={<DocsLayout />}>
            <Route path=":slug" element={<DocsPage />} />
          </Route>
        </Routes>
      </MemoryRouter>,
    );
    expect(container.querySelector('.docs__sidebar')).not.toBeNull();
    expect(container.textContent).toContain('Doc not found');
    const back = container.querySelector('a[href="/docs"]');
    expect(back).not.toBeNull();
  });

  test('sets document.title from H1 on slug change', () => {
    render(
      <MemoryRouter initialEntries={['/docs/scripting']}>
        <Routes>
          <Route path="/docs" element={<DocsLayout />}>
            <Route path=":slug" element={<DocsPage />} />
          </Route>
        </Routes>
      </MemoryRouter>,
    );
    expect(document.title).toMatch(/· Board Together Docs$/);
    expect(document.title.toLowerCase()).toContain('scripting');
  });
});
