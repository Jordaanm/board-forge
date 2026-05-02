import { useLayoutEffect, useRef, useState } from 'react';

// Side-anchored positioning for nested menus that flips to the opposite edge
// when the menu would overflow the viewport. Starts each open from the default
// (right of parent, top-aligned), then measures and corrects in useLayoutEffect
// before the browser paints.
export interface FlipStyle {
  left?:   number | string;
  right?:  number | string;
  top?:    number | string;
  bottom?: number | string;
}

const DEFAULT: FlipStyle = { left: '100%', top: 0 };

export function useFlipPosition(open: boolean): {
  ref:   React.RefObject<HTMLDivElement>;
  style: FlipStyle;
} {
  const ref = useRef<HTMLDivElement>(null);
  const [style, setStyle] = useState<FlipStyle>(DEFAULT);

  useLayoutEffect(() => {
    if (!open) { setStyle(DEFAULT); return; }
    const el = ref.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const next: FlipStyle = { left: '100%', top: 0 };
    if (rect.right  > window.innerWidth)  { delete next.left; next.right  = '100%'; }
    if (rect.bottom > window.innerHeight) { delete next.top;  next.bottom = 0;      }
    setStyle(next);
  }, [open]);

  return { ref, style };
}
