import { createContext, useContext, useMemo, useState, type ReactNode } from 'react';
import './AnchorLayout.css';

export const ANCHORS = [
  'top-left',    'top-center',    'top-right',
  'middle-left', 'center',        'middle-right',
  'bottom-left', 'bottom-center', 'bottom-right',
] as const;

export type AnchorName = typeof ANCHORS[number];

type AnchorRefs    = Record<AnchorName, HTMLDivElement | null>;
type RefCallbacks  = Record<AnchorName, (el: HTMLDivElement | null) => void>;

const initialRefs = (): AnchorRefs =>
  Object.fromEntries(ANCHORS.map(a => [a, null])) as AnchorRefs;

const AnchorContext = createContext<AnchorRefs | null>(null);

export function AnchorLayout({ children }: { children?: ReactNode }) {
  const [refs, setRefs] = useState<AnchorRefs>(initialRefs);

  // Stable ref callbacks per anchor. Inline arrows would change identity each
  // render, causing React to detach and reattach the ref every render — which
  // would then drive setRefs in a loop.
  const refCallbacks = useMemo<RefCallbacks>(() => {
    const out = {} as RefCallbacks;
    for (const name of ANCHORS) {
      out[name] = (el) => {
        setRefs(prev => (prev[name] === el ? prev : { ...prev, [name]: el }));
      };
    }
    return out;
  }, []);

  return (
    <AnchorContext.Provider value={refs}>
      <div className="anchor-layout">
        {ANCHORS.map(name => (
          <div
            key={name}
            ref={refCallbacks[name]}
            className={`anchor anchor--${name}`}
            data-anchor={name}
          />
        ))}
      </div>
      {children}
    </AnchorContext.Provider>
  );
}

export function useAnchorTarget(anchor: AnchorName): HTMLDivElement | null {
  const map = useContext(AnchorContext);
  if (map === null) {
    throw new Error('UIPanel must be rendered inside an <AnchorLayout>');
  }
  if (!(anchor in map)) {
    throw new Error(`Invalid anchor: "${anchor}"`);
  }
  return map[anchor];
}
