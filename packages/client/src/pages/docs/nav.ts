export type DocGroup = 'Playing' | 'Hosting & authoring' | 'Working on the codebase';

export interface DocNavEntry {
  slug:  string;
  title: string;
  group: DocGroup;
}

export const DOC_NAV: readonly DocNavEntry[] = [
  { slug: 'getting-started', title: 'Getting Started', group: 'Playing' },
  { slug: 'controls',        title: 'Controls',        group: 'Playing' },
  { slug: 'hosting',         title: 'Hosting',         group: 'Hosting & authoring' },
  { slug: 'scripting',       title: 'Scripting',       group: 'Hosting & authoring' },
  { slug: 'architecture',    title: 'Architecture',    group: 'Working on the codebase' },
  { slug: 'contributing',    title: 'Contributing',    group: 'Working on the codebase' },
];

export const DOC_GROUPS: readonly DocGroup[] = [
  'Playing',
  'Hosting & authoring',
  'Working on the codebase',
];
