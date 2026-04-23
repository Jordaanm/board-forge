import { useState } from 'react';
import { type SpawnableType } from '../net/SceneState';
import { OBJECT_TYPE_REGISTRY, type PropertyDef } from '../scene/objectTypes';
import { type TableProps } from '../scene/Table';

export interface ObjectSummary {
  id: string;
  objectType: SpawnableType;
  props: Record<string, unknown>;
}

interface Props {
  objects:            ObjectSummary[];
  selectedId:         string | null;
  isFreeCamera:       boolean;
  tableProps:         TableProps;
  onSelect:           (id: string | null) => void;
  onSpawn:            (type: SpawnableType) => void;
  onRollDice:         () => void;
  onUpdateProp:       (id: string, key: string, value: unknown) => void;
  onUpdateTableProp:  (key: keyof TableProps, value: unknown) => void;
  onToggleFreeCamera: (on: boolean) => void;
}

const SPAWN_TYPES: SpawnableType[] = ['board', 'die', 'token'];

const PANEL: React.CSSProperties = {
  position:    'absolute',
  top:         12,
  left:        12,
  width:       280,
  background:  'rgba(20,20,32,0.92)',
  border:      '1px solid rgba(255,255,255,0.15)',
  borderRadius: 8,
  color:       '#e8e8e8',
  fontFamily:  'sans-serif',
  fontSize:    13,
  zIndex:      100,
  boxShadow:   '0 4px 20px rgba(0,0,0,0.5)',
};

const HEADER: React.CSSProperties = {
  display:        'flex',
  alignItems:     'center',
  justifyContent: 'space-between',
  padding:        '8px 12px',
  borderBottom:   '1px solid rgba(255,255,255,0.1)',
  cursor:         'pointer',
  userSelect:     'none',
};

const SECTION: React.CSSProperties = {
  padding:      '10px 12px',
  borderBottom: '1px solid rgba(255,255,255,0.08)',
};

const SECTION_LABEL: React.CSSProperties = {
  fontSize:      10,
  textTransform: 'uppercase',
  letterSpacing: 1,
  color:         '#888',
  marginBottom:  6,
};

const LIST_ROW: React.CSSProperties = {
  display:        'flex',
  justifyContent: 'space-between',
  padding:        '4px 8px',
  borderRadius:   4,
  cursor:         'pointer',
};

const SPAWN_BTN: React.CSSProperties = {
  background:   'rgba(255,255,255,0.1)',
  border:       '1px solid rgba(255,255,255,0.2)',
  color:        '#e8e8e8',
  padding:      '6px 10px',
  borderRadius: 4,
  cursor:       'pointer',
  fontSize:     12,
  flex:         1,
};

const INPUT: React.CSSProperties = {
  width:        '100%',
  background:   'rgba(0,0,0,0.4)',
  border:       '1px solid rgba(255,255,255,0.2)',
  color:        '#e8e8e8',
  padding:      '4px 6px',
  borderRadius: 3,
  fontSize:     12,
  fontFamily:   'sans-serif',
  boxSizing:    'border-box',
};

export function EditorPanel({
  objects, selectedId, isFreeCamera, tableProps,
  onSelect, onSpawn, onRollDice, onUpdateProp, onUpdateTableProp, onToggleFreeCamera,
}: Props) {
  const [open, setOpen]           = useState(true);
  const [collapsed, setCollapsed] = useState(false);

  if (!open) {
    return (
      <button
        onClick={() => setOpen(true)}
        style={{ ...PANEL, width: 'auto', padding: '6px 12px', cursor: 'pointer' }}
      >
        Open Editor
      </button>
    );
  }

  const selected = selectedId ? objects.find(o => o.id === selectedId) ?? null : null;

  return (
    <div style={PANEL}>
      <div style={HEADER} onClick={() => setCollapsed(c => !c)}>
        <span style={{ fontWeight: 600 }}>Scene Editor {collapsed ? '▸' : '▾'}</span>
        <span>
          <button
            onClick={(e) => { e.stopPropagation(); setOpen(false); }}
            style={{ background: 'none', border: 'none', color: '#aaa', cursor: 'pointer', fontSize: 16 }}
            title="Close"
          >×</button>
        </span>
      </div>

      {!collapsed && (
        <>
          <SceneGraphList objects={objects} selectedId={selectedId} onSelect={onSelect} />
          <PropertyEditor selected={selected} onUpdateProp={onUpdateProp} />
          <TableSection tableProps={tableProps} onUpdateTableProp={onUpdateTableProp} />
          <SpawnSection onSpawn={onSpawn} onRollDice={onRollDice} />
          <CameraSection isFreeCamera={isFreeCamera} onToggleFreeCamera={onToggleFreeCamera} />
        </>
      )}
    </div>
  );
}

function TableSection({
  tableProps, onUpdateTableProp,
}: { tableProps: TableProps; onUpdateTableProp: (key: keyof TableProps, value: unknown) => void }) {
  return (
    <div style={SECTION}>
      <div style={SECTION_LABEL}>Table</div>
      <div style={{ marginBottom: 8 }}>
        <label style={{ display: 'block', color: '#aaa', fontSize: 11, marginBottom: 3 }}>Shape</label>
        <select
          style={INPUT}
          value={tableProps.shape}
          onChange={e => onUpdateTableProp('shape', e.target.value)}
        >
          <option value="rectangle">Rectangle</option>
          <option value="circle">Circle</option>
        </select>
      </div>
      <div>
        <label style={{ display: 'block', color: '#aaa', fontSize: 11, marginBottom: 3 }}>Decoration (color)</label>
        <input
          type="color"
          style={{ ...INPUT, padding: 2, height: 28 }}
          value={tableProps.color}
          onChange={e => onUpdateTableProp('color', e.target.value)}
        />
      </div>
    </div>
  );
}

function SceneGraphList({
  objects, selectedId, onSelect,
}: { objects: ObjectSummary[]; selectedId: string | null; onSelect: (id: string | null) => void }) {
  return (
    <div style={SECTION}>
      <div style={SECTION_LABEL}>Objects ({objects.length})</div>
      {objects.length === 0 && <div style={{ color: '#666', fontSize: 12 }}>No objects yet</div>}
      {objects.map(o => {
        const isSel = o.id === selectedId;
        return (
          <div
            key={o.id}
            style={{
              ...LIST_ROW,
              background: isSel ? 'rgba(80,140,220,0.3)' : 'transparent',
            }}
            onClick={() => onSelect(isSel ? null : o.id)}
          >
            <span>{o.id}</span>
            <span style={{ color: '#888' }}>{OBJECT_TYPE_REGISTRY[o.objectType].label}</span>
          </div>
        );
      })}
    </div>
  );
}

function PropertyEditor({
  selected, onUpdateProp,
}: { selected: ObjectSummary | null; onUpdateProp: (id: string, key: string, value: unknown) => void }) {
  if (!selected) {
    return (
      <div style={SECTION}>
        <div style={SECTION_LABEL}>Properties</div>
        <div style={{ color: '#666', fontSize: 12 }}>Select an object to edit its properties</div>
      </div>
    );
  }

  const def = OBJECT_TYPE_REGISTRY[selected.objectType];
  return (
    <div style={SECTION}>
      <div style={SECTION_LABEL}>Properties — {selected.id}</div>
      {def.propertySchema.length === 0 && (
        <div style={{ color: '#666', fontSize: 12 }}>No editable properties</div>
      )}
      {def.propertySchema.map(p => (
        <PropertyRow
          key={p.key}
          def={p}
          value={selected.props[p.key]}
          onChange={(v) => onUpdateProp(selected.id, p.key, v)}
        />
      ))}
    </div>
  );
}

function PropertyRow({
  def, value, onChange,
}: { def: PropertyDef; value: unknown; onChange: (v: unknown) => void }) {
  return (
    <div style={{ marginBottom: 8 }}>
      <label style={{ display: 'block', color: '#aaa', fontSize: 11, marginBottom: 3 }}>{def.label}</label>
      {def.type === 'number' && (
        <input
          type="number"
          step="0.1"
          style={INPUT}
          value={(value as number) ?? 0}
          onChange={e => onChange(parseFloat(e.target.value) || 0)}
        />
      )}
      {def.type === 'string' && (
        <input
          type="text"
          style={INPUT}
          value={(value as string) ?? ''}
          onChange={e => onChange(e.target.value)}
        />
      )}
      {def.type === 'color' && (
        <input
          type="color"
          style={{ ...INPUT, padding: 2, height: 28 }}
          value={(value as string) ?? '#ffffff'}
          onChange={e => onChange(e.target.value)}
        />
      )}
    </div>
  );
}

function SpawnSection({
  onSpawn, onRollDice,
}: { onSpawn: (type: SpawnableType) => void; onRollDice: () => void }) {
  return (
    <div style={SECTION}>
      <div style={SECTION_LABEL}>Spawn</div>
      <div style={{ display: 'flex', gap: 6, marginBottom: 6 }}>
        {SPAWN_TYPES.map(t => (
          <button key={t} style={SPAWN_BTN} onClick={() => onSpawn(t)}>
            + {OBJECT_TYPE_REGISTRY[t].label}
          </button>
        ))}
      </div>
      <button
        style={{ ...SPAWN_BTN, borderColor: 'rgba(255,200,0,0.4)', color: '#ffd740', width: '100%' }}
        onClick={onRollDice}
      >
        Roll All Dice
      </button>
    </div>
  );
}

function CameraSection({
  isFreeCamera, onToggleFreeCamera,
}: { isFreeCamera: boolean; onToggleFreeCamera: (on: boolean) => void }) {
  return (
    <div style={{ ...SECTION, borderBottom: 'none' }}>
      <div style={SECTION_LABEL}>Camera</div>
      <label style={{ display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer' }}>
        <input
          type="checkbox"
          checked={isFreeCamera}
          onChange={e => onToggleFreeCamera(e.target.checked)}
        />
        Unrestricted camera (no floor constraint)
      </label>
    </div>
  );
}
