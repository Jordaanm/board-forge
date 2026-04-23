import { type SpawnableType } from '../net/SceneState';
import { OBJECT_TYPE_REGISTRY } from '../scene/objectTypes';

interface Props {
  onSpawn:     (type: SpawnableType) => void;
  onRollDice:  () => void;
}

const SPAWN_TYPES: SpawnableType[] = ['board', 'die', 'token'];

const btnStyle: React.CSSProperties = {
  background: 'rgba(255,255,255,0.12)',
  border: '1px solid rgba(255,255,255,0.25)',
  color: '#e8e8e8',
  padding: '6px 14px',
  borderRadius: 6,
  cursor: 'pointer',
  fontSize: 13,
  fontFamily: 'sans-serif',
};

export function SpawnPanel({ onSpawn, onRollDice }: Props) {
  return (
    <div style={{ position: 'absolute', bottom: 16, left: 16, display: 'flex', gap: 8 }}>
      {SPAWN_TYPES.map(t => (
        <button key={t} style={btnStyle} onClick={() => onSpawn(t)}>
          + {OBJECT_TYPE_REGISTRY[t].label}
        </button>
      ))}
      <button style={{ ...btnStyle, borderColor: 'rgba(255,200,0,0.4)', color: '#ffd740' }} onClick={onRollDice}>
        Roll Dice
      </button>
    </div>
  );
}
