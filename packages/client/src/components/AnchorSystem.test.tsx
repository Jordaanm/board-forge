// @vitest-environment jsdom
import { describe, test, expect, afterEach, vi } from 'vitest';
import { render, cleanup } from '@testing-library/react';
import { AnchorLayout } from './AnchorLayout';
import { UIPanel } from './UIPanel';

afterEach(cleanup);

describe('UIPanel + AnchorLayout', () => {
  test('panel portals into the anchor named by the `anchor` prop', () => {
    const { container } = render(
      <AnchorLayout>
        <UIPanel anchor="top-right">
          <div data-testid="panel-a">A</div>
        </UIPanel>
      </AnchorLayout>,
    );
    const anchor = container.querySelector('[data-anchor="top-right"]');
    expect(anchor).not.toBeNull();
    expect(anchor!.querySelector('[data-testid="panel-a"]')).not.toBeNull();
  });

  test('panels at the same anchor stack by ascending order; mount order tiebreaks ties', () => {
    const { container } = render(
      <AnchorLayout>
        <UIPanel anchor="top-left" order={20}><div>B</div></UIPanel>
        <UIPanel anchor="top-left" order={10}><div>A</div></UIPanel>
        <UIPanel anchor="top-left" order={10}><div>C</div></UIPanel>
      </AnchorLayout>,
    );
    const anchor = container.querySelector('[data-anchor="top-left"]')!;
    const wrappers = Array.from(anchor.children) as HTMLElement[];
    expect(wrappers).toHaveLength(3);
    const visualOrder = wrappers
      .map((el, i) => ({ el, order: Number(el.style.order), i }))
      .sort((x, y) => x.order - y.order || x.i - y.i)
      .map(s => s.el.textContent);
    // A (10, mounted 2nd) < C (10, mounted 3rd) < B (20, mounted 1st)
    expect(visualOrder).toEqual(['A', 'C', 'B']);
  });

  test('unmounting a UIPanel removes its content from the anchor', () => {
    const { container, rerender } = render(
      <AnchorLayout>
        <UIPanel anchor="bottom-right">
          <div data-testid="panel">P</div>
        </UIPanel>
      </AnchorLayout>,
    );
    const anchor = container.querySelector('[data-anchor="bottom-right"]')!;
    expect(anchor.querySelector('[data-testid="panel"]')).not.toBeNull();

    rerender(<AnchorLayout />);
    expect(anchor.querySelector('[data-testid="panel"]')).toBeNull();
  });

  test('mounting UIPanel outside an AnchorLayout fails loudly', () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    expect(() =>
      render(<UIPanel anchor="top-left"><div /></UIPanel>),
    ).toThrow(/AnchorLayout/);
    spy.mockRestore();
  });

  test('mounting UIPanel with an invalid anchor fails loudly', () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    expect(() =>
      render(
        <AnchorLayout>
          {/* @ts-expect-error testing runtime validation of anchor name */}
          <UIPanel anchor="not-a-real-anchor"><div /></UIPanel>
        </AnchorLayout>,
      ),
    ).toThrow(/Invalid anchor/);
    spy.mockRestore();
  });
});
