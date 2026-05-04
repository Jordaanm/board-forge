// Top-center action bar visible only to the host. Day-one contents: a single
// "Spawn Object" trigger. Pattern accommodates future host actions (Reset
// Scene, Save Layout, etc.) without rearchitecting.

import { SpawnObjectModal } from './SpawnObjectModal';

interface Props {
  onSpawn: (type: string) => void;
}

const BAR: React.CSSProperties = {
  display: 'flex',
  gap:     8,
};

export function HostActionBar({ onSpawn }: Props) {
  return (
    <div style={BAR}>
      <SpawnObjectModal onSpawn={onSpawn} />
    </div>
  );
}
