// Top-center action bar visible only to the host. Day-one contents: a single
// "Spawn Object" trigger. Pattern accommodates future host actions (Reset
// Scene, Save Layout, etc.) without rearchitecting.

import { SpawnObjectModal } from './SpawnObjectModal';

interface Props {
  onSpawn:           (type: string) => void;
  showAllZones:      boolean;
  onToggleShowAllZones: (on: boolean) => void;
}

const BAR: React.CSSProperties = {
  display:    'flex',
  alignItems: 'center',
  gap:        8,
};

const TOGGLE: React.CSSProperties = {
  display:      'inline-flex',
  alignItems:   'center',
  gap:          6,
  background:   'rgba(20,20,32,0.92)',
  border:       '1px solid rgba(255,255,255,0.2)',
  color:        '#e8e8e8',
  padding:      '8px 12px',
  borderRadius: 6,
  cursor:       'pointer',
  fontFamily:   'sans-serif',
  fontSize:     12,
  boxShadow:    '0 4px 20px rgba(0,0,0,0.5)',
  userSelect:   'none',
};

export function HostActionBar({ onSpawn, showAllZones, onToggleShowAllZones }: Props) {
  return (
    <div style={BAR}>
      <SpawnObjectModal onSpawn={onSpawn} />
      <label style={TOGGLE}>
        <input
          type="checkbox"
          checked={showAllZones}
          onChange={e => onToggleShowAllZones(e.target.checked)}
        />
        Show All Zones
      </label>
    </div>
  );
}
