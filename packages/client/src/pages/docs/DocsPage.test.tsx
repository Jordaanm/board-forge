// @vitest-environment jsdom
import { describe, test, expect, afterEach } from 'vitest';
import { render, cleanup } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { DocsPage } from './DocsPage';

afterEach(cleanup);

describe('DocsPage', () => {
  test('renders scripting doc with an h1', () => {
    const { container } = render(
      <MemoryRouter initialEntries={['/docs/scripting']}>
        <Routes>
          <Route path="/docs/:slug" element={<DocsPage />} />
        </Routes>
      </MemoryRouter>,
    );
    const h1 = container.querySelector('h1');
    expect(h1).not.toBeNull();
    expect(h1!.textContent).toBeTruthy();
  });

  test('renders "Doc not found" for unknown slug', () => {
    const { container } = render(
      <MemoryRouter initialEntries={['/docs/totally-not-a-doc']}>
        <Routes>
          <Route path="/docs/:slug" element={<DocsPage />} />
        </Routes>
      </MemoryRouter>,
    );
    expect(container.textContent).toContain('Doc not found');
  });
});
