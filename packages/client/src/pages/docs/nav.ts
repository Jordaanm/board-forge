export type DocGroup = 'Playing' | 'Hosting' | 'Scripting and Automation';

export interface DocNavEntry {
  slug:  string;
  title: string;
  group: DocGroup;
}

export const DOC_NAV: readonly DocNavEntry[] = [
  { slug: 'controls',        title: 'Controls',        group: 'Playing' },
  { slug: 'hosting',         title: 'Hosting',         group: 'Hosting' },
  { slug: 'spawnables',      title: 'Spawnable Pieces',      group: 'Hosting' },
  { slug: 'scripting',       title: 'Scripting',       group: 'Scripting and Automation' },
];

export const DOC_GROUPS: readonly DocGroup[] = [
  'Playing',
  'Hosting',
  'Scripting and Automation',
];
