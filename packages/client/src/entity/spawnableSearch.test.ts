import { describe, test, expect } from 'vitest';
import { groupByCategory, searchSpawnables } from './spawnableSearch';
import { type SpawnableDef } from './SpawnableRegistry';

function def(over: Partial<SpawnableDef> = {}): SpawnableDef {
  return {
    type:        over.type        ?? 'x',
    label:       over.label       ?? 'X',
    category:    over.category    ?? 'Misc',
    defaultTags: over.defaultTags ?? [],
    components:  [],
  };
}

describe('groupByCategory', () => {
  test('preserves first-appearance (registration) order of categories', () => {
    const defs = [
      def({ type: 'a', category: 'B' }),
      def({ type: 'b', category: 'A' }),
      def({ type: 'c', category: 'B' }),
      def({ type: 'd', category: 'C' }),
    ];
    expect(groupByCategory(defs).map(g => g.category)).toEqual(['B', 'A', 'C']);
  });

  test('sorts items alphabetically by label inside each category', () => {
    const defs = [
      def({ type: '1', label: 'Charlie', category: 'X' }),
      def({ type: '2', label: 'alpha',   category: 'X' }),
      def({ type: '3', label: 'Bravo',   category: 'X' }),
    ];
    const [group] = groupByCategory(defs);
    // localeCompare is case-insensitive by default in node ICU
    expect(group.items.map(i => i.label)).toEqual(['alpha', 'Bravo', 'Charlie']);
  });

  test('empty input → empty groups', () => {
    expect(groupByCategory([])).toEqual([]);
  });
});

describe('searchSpawnables', () => {
  test('empty query returns the input array unchanged (reference-equal)', () => {
    const defs = [def({ type: 'a', label: 'Z' }), def({ type: 'b', label: 'A' })];
    expect(searchSpawnables(defs, '')).toBe(defs);
    expect(searchSpawnables(defs, '   ')).toBe(defs);
  });

  test('label-prefix outranks label-substring outranks tag/category/type', () => {
    const prefix    = def({ type: 'p', label: 'Diamond Token',   category: 'Tokens' });
    const substring = def({ type: 's', label: 'Roll the Die',    category: 'Tokens' });
    const metaCat   = def({ type: 'c', label: 'Meeple',          category: 'Dice'   });
    const metaType  = def({ type: 'die-special', label: 'Cube',  category: 'Tokens' });
    const metaTag   = def({ type: 't', label: 'Doodad',          category: 'Tokens', defaultTags: ['die'] });
    const ranked = searchSpawnables([metaTag, substring, metaCat, prefix, metaType], 'di');
    // prefix → substring → meta (alphabetical by label inside meta: Cube, Doodad, Meeple)
    expect(ranked.map(r => r.type)).toEqual(['p', 's', 'die-special', 't', 'c']);
  });

  test('within a tier, ties break alphabetically by label', () => {
    const banana = def({ type: 'b', label: 'Banana' });
    const apple  = def({ type: 'a', label: 'Apple'  });
    const cherry = def({ type: 'c', label: 'Cherry' });
    expect(searchSpawnables([banana, cherry, apple], 'a').map(d => d.label))
      // Apple (prefix), then substring matches Banana, Cherry alphabetical
      .toEqual(['Apple', 'Banana']);
    // Cherry has no 'a' so excluded. Verify with broader query:
    expect(searchSpawnables([banana, cherry, apple], 'r').map(d => d.label))
      // none start with r — all are substring tier; alphabetical
      .toEqual(['Cherry']);
  });

  test('case-insensitive matching', () => {
    const d = def({ type: 't', label: 'BoArD' });
    expect(searchSpawnables([d], 'board')).toEqual([d]);
    expect(searchSpawnables([d], 'BOARD')).toEqual([d]);
    expect(searchSpawnables([d], 'OaR')).toEqual([d]);
  });

  test('matches against defaultTags', () => {
    const d = def({ type: 'q', label: 'Mystery', defaultTags: ['cube', 'six-sided'] });
    expect(searchSpawnables([d], 'six')).toEqual([d]);
    expect(searchSpawnables([d], 'cube')).toEqual([d]);
  });

  test('matches against category', () => {
    const d = def({ type: 'q', label: 'Mystery', category: 'Pieces' });
    expect(searchSpawnables([d], 'piece')).toEqual([d]);
  });

  test('matches against type id', () => {
    const d = def({ type: 'special-token', label: 'Mystery', category: 'Foo' });
    expect(searchSpawnables([d], 'token')).toEqual([d]);
  });

  test('non-matches are excluded', () => {
    const d = def({ type: 'q', label: 'Apple', category: 'Fruit', defaultTags: ['red'] });
    expect(searchSpawnables([d], 'banana')).toEqual([]);
  });
});
