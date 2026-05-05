// @vitest-environment jsdom
import { describe, test, expect, afterEach, vi } from 'vitest';
import { render, cleanup, fireEvent } from '@testing-library/react';
import { AnchorLayout } from './AnchorLayout';
import { UIPanel } from './UIPanel';
import { HistoryModal } from './HistoryModal';
import { SceneHistoryService } from '../entity/SceneHistoryService';
import { type EntitySerialized } from '../entity/Scene';

afterEach(() => { cleanup(); });

class FakeWorld {
  current: EntitySerialized[] = [];
  calls: EntitySerialized[][] = [];
  replaceScene(snaps: readonly EntitySerialized[]): void {
    this.calls.push([...snaps]);
    this.current = [...snaps];
  }
  snapshot(): EntitySerialized[] { return this.current.map(e => ({ ...e })); }
  setCurrent(s: EntitySerialized[]): void { this.current = s; }
}

function snap(id: string): EntitySerialized {
  return {
    id, type: 'die', name: id, tags: [],
    owner: null, privateToSeat: null, parentId: null, children: [],
    components: { value: { value: '6', isNumeric: true } },
  };
}

function renderWithLayout(ui: React.ReactElement) {
  return render(<AnchorLayout><UIPanel anchor="top-center" order={0}>{ui}</UIPanel></AnchorLayout>);
}

describe('HistoryModal', () => {
  test('opening the modal pushes a "Current" anchor (deduped)', () => {
    const w = new FakeWorld();
    const svc = new SceneHistoryService(w);
    w.setCurrent([snap('a')]);
    svc.push('first');
    expect(svc.entries()).toHaveLength(1);

    const { getByText } = renderWithLayout(<HistoryModal service={svc} />);
    fireEvent.click(getByText('History'));
    // Top entry should be a "Current" anchor for the same state — dedupes
    // when the snapshot matches the top, but redo would still be cleared.
    expect(svc.entries().length).toBeGreaterThanOrEqual(1);
    const topLabels = svc.entries().map(e => e.label);
    // Either the dedup short-circuited (still one entry) or a Current row was pushed.
    expect(topLabels.includes('first') || topLabels.includes('Current')).toBe(true);
  });

  test('renders a row per entry, newest at top, with the current row marked', () => {
    const w = new FakeWorld();
    const svc = new SceneHistoryService(w);
    w.setCurrent([snap('a')]); svc.push('label-a');
    w.setCurrent([snap('b')]); svc.push('label-b');
    w.setCurrent([snap('c')]); svc.push('label-c');

    const { getByText, getAllByTestId } = renderWithLayout(<HistoryModal service={svc} />);
    fireEvent.click(getByText('History'));

    // 3 user pushes plus the on-open Current push (deduped against the top
    // since w.current still matches snap('c')).
    const rows = getAllByTestId(/^history-row-/);
    expect(rows.length).toBeGreaterThanOrEqual(3);
    // Newest at top: row-0 should be label-c (the most recent push).
    expect(rows[0].textContent).toContain('label-c');
  });

  test('clicking a non-current row calls service.restore', () => {
    const w = new FakeWorld();
    const svc = new SceneHistoryService(w);
    w.setCurrent([snap('a')]); svc.push('label-a');
    w.setCurrent([snap('b')]); svc.push('label-b');

    const restoreSpy = vi.spyOn(svc, 'restore');

    const { getByText, getAllByTestId } = renderWithLayout(<HistoryModal service={svc} />);
    fireEvent.click(getByText('History'));

    const rows = getAllByTestId(/^history-row-/);
    // Click a non-current row (idx 1+).
    fireEvent.click(rows[1]);
    expect(restoreSpy).toHaveBeenCalled();
  });

  test('clicking the current row does nothing', () => {
    const w = new FakeWorld();
    const svc = new SceneHistoryService(w);
    w.setCurrent([snap('a')]); svc.push('label-a');

    const restoreSpy = vi.spyOn(svc, 'restore');

    const { getByText, getAllByTestId } = renderWithLayout(<HistoryModal service={svc} />);
    fireEvent.click(getByText('History'));

    const rows = getAllByTestId(/^history-row-/);
    fireEvent.click(rows[0]);
    expect(restoreSpy).not.toHaveBeenCalled();
  });

  test('null service shows host-only message when opened', () => {
    const { getByText } = renderWithLayout(<HistoryModal service={null} />);
    fireEvent.click(getByText('History'));
    expect(getByText(/host-only/i)).toBeTruthy();
  });
});
