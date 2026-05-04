import { type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { useAnchorTarget, type AnchorName } from './AnchorLayout';

interface Props {
  anchor:   AnchorName;
  order?:   number;
  id?:      string;
  children: ReactNode;
}

const DEFAULT_ORDER = 100;

export function UIPanel({ anchor, order = DEFAULT_ORDER, id, children }: Props) {
  const target = useAnchorTarget(anchor);
  if (!target) return null;
  return createPortal(
    <div
      className="ui-panel"
      style={{ order, pointerEvents: 'auto' }}
      data-panel-id={id}
    >
      {children}
    </div>,
    target,
  );
}
