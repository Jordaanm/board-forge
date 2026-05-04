// Host-only modal listing every registered spawnable. Bare-bones for slice 1
// of issues--spawn-menu.md: flat alphabetical list, click-to-spawn, modal
// stays open for batch spawning. Search / grouping / keyboard nav land in
// slice 2.

import * as Dialog from '@radix-ui/react-dialog';
import { listSpawnables } from '../entity/SpawnableRegistry';
import './SpawnObjectModal.css';

interface Props {
  onSpawn: (type: string) => void;
}

const TRIGGER_BTN: React.CSSProperties = {
  background:   'rgba(20,20,32,0.92)',
  border:       '1px solid rgba(255,255,255,0.2)',
  color:        '#e8e8e8',
  padding:      '8px 16px',
  borderRadius: 6,
  cursor:       'pointer',
  fontFamily:   'sans-serif',
  fontSize:     13,
  fontWeight:   600,
  boxShadow:    '0 4px 20px rgba(0,0,0,0.5)',
};

const OVERLAY: React.CSSProperties = {
  position:   'fixed',
  inset:      0,
  background: 'rgba(0,0,0,0.55)',
  zIndex:     200,
};

const CONTENT: React.CSSProperties = {
  position:    'fixed',
  top:         '50%',
  left:        '50%',
  transform:   'translate(-50%, -50%)',
  width:       520,
  height:      600,
  background:  'rgba(20,20,32,0.98)',
  border:      '1px solid rgba(255,255,255,0.15)',
  borderRadius: 8,
  color:       '#e8e8e8',
  fontFamily:  'sans-serif',
  fontSize:    13,
  zIndex:      201,
  display:     'flex',
  flexDirection: 'column',
  boxShadow:   '0 12px 40px rgba(0,0,0,0.7)',
};

const HEADER: React.CSSProperties = {
  display:        'flex',
  alignItems:     'center',
  justifyContent: 'space-between',
  padding:        '12px 16px',
  borderBottom:   '1px solid rgba(255,255,255,0.1)',
};

const TITLE: React.CSSProperties = {
  fontSize:   14,
  fontWeight: 600,
  margin:     0,
};

const CLOSE_BTN: React.CSSProperties = {
  background: 'none',
  border:     'none',
  color:      '#aaa',
  cursor:     'pointer',
  fontSize:   18,
  lineHeight: 1,
  padding:    '0 4px',
};

const LIST: React.CSSProperties = {
  flex:        1,
  overflowY:   'auto',
  padding:     '8px 0',
  margin:      0,
  listStyle:   'none',
};

const ROW: React.CSSProperties = {
  padding:    '10px 20px',
  cursor:     'pointer',
  userSelect: 'none',
};

const ROW_HOVER_CLASS = 'spawn-modal__row';

export function SpawnObjectModal({ onSpawn }: Props) {
  return (
    <Dialog.Root>
      <Dialog.Trigger asChild>
        <button style={TRIGGER_BTN} type="button">+ Spawn Object</button>
      </Dialog.Trigger>
      <Dialog.Portal>
        <Dialog.Overlay style={OVERLAY} />
        <Dialog.Content style={CONTENT} aria-describedby={undefined}>
          <div style={HEADER}>
            <Dialog.Title style={TITLE}>Spawn Object</Dialog.Title>
            <Dialog.Close asChild>
              <button style={CLOSE_BTN} type="button" aria-label="Close">×</button>
            </Dialog.Close>
          </div>
          <ModalList onSpawn={onSpawn} />
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

// Reads the registry on mount. The Radix Portal/Content only mounts children
// when the dialog opens, so by the time this renders, the World constructor
// in ThreeCanvas has already run registerCorePrimitives().
function ModalList({ onSpawn }: { onSpawn: (type: string) => void }) {
  const items = [...listSpawnables()].sort((a, b) => a.label.localeCompare(b.label));
  return (
    <ul style={LIST}>
      {items.map(def => (
        <li
          key={def.type}
          className={ROW_HOVER_CLASS}
          style={ROW}
          onClick={() => onSpawn(def.type)}
        >
          {def.label}
        </li>
      ))}
    </ul>
  );
}
