import { useEffect, useState } from 'react';
import * as THREE from 'three';
import { type SpawnableType } from '../net/SceneState';
import { resolveObjectMeta, type PropertyDef } from '../scene/objectMeta';
import { SEAT_COLOURS } from '../seats/SeatLayout';
import { type TableProps } from '../scene/Table';
import { type SkydomeProps } from '../scene/Skydome';
import { type KeyLightProps } from '../scene/KeyLight';
import { type ManifestStore } from '../assets/ManifestStore';
import { type AssetType } from '../assets/Manifest';
import { AssetPicker } from './AssetPicker';
import { assetService } from '../assets/AssetService';
import { BASE_MANIFEST, PRIMITIVE_MANIFEST } from '../assets/baseManifest';

export interface ObjectSummary {
  id: string;
  objectType: SpawnableType;
  tags: string[];
  props: Record<string, unknown>;
  parentId: string | null;
}

interface Props {
  objects:              ObjectSummary[];
  selectedId:           string | null;
  isFreeCamera:         boolean;
  tableProps:           TableProps;
  skydomeProps:         SkydomeProps;
  keyLightProps:        KeyLightProps;
  manifestStore:        ManifestStore | null;
  onSelect:             (id: string | null) => void;
  onRollDice:           () => void;
  onUpdateProp:         (id: string, key: string, value: unknown) => void;
  onUpdateTableProp:    (key: keyof TableProps, value: unknown) => void;
  onUpdateSkydomeProp:  (key: keyof SkydomeProps, value: unknown) => void;
  onUpdateKeyLightProp: (key: keyof KeyLightProps, value: unknown) => void;
  onToggleFreeCamera:   (on: boolean) => void;
}

const PANEL: React.CSSProperties = {
  width:       280,
  background:  'rgba(20,20,32,0.92)',
  border:      '1px solid rgba(255,255,255,0.15)',
  borderRadius: 8,
  color:       '#e8e8e8',
  fontFamily:  'sans-serif',
  fontSize:    13,
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

const CHIP: React.CSSProperties = {
  display:      'inline-flex',
  alignItems:   'center',
  gap:          4,
  background:   'rgba(255,255,255,0.08)',
  color:        '#bdbdbd',
  padding:      '2px 4px 2px 8px',
  borderRadius: 3,
  fontSize:     11,
};

const CHIP_X: React.CSSProperties = {
  background:   'none',
  border:       'none',
  color:        '#888',
  cursor:       'pointer',
  fontSize:     14,
  lineHeight:   1,
  padding:      '0 2px',
};

export function EditorPanel({
  objects, selectedId, isFreeCamera, tableProps, skydomeProps, keyLightProps,
  manifestStore,
  onSelect, onRollDice, onUpdateProp,
  onUpdateTableProp, onUpdateSkydomeProp, onUpdateKeyLightProp, onToggleFreeCamera,
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
          <PropertyEditor selected={selected} manifestStore={manifestStore} onUpdateProp={onUpdateProp} />
          <TableSection tableProps={tableProps} onUpdateTableProp={onUpdateTableProp} />
          <SkydomeSection skydomeProps={skydomeProps} manifestStore={manifestStore} onUpdateSkydomeProp={onUpdateSkydomeProp} />
          <KeyLightSection keyLightProps={keyLightProps} onUpdateKeyLightProp={onUpdateKeyLightProp} />
          <RollSection onRollDice={onRollDice} />
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

function SkydomeSection({
  skydomeProps, manifestStore, onUpdateSkydomeProp,
}: {
  skydomeProps:        SkydomeProps;
  manifestStore:       ManifestStore | null;
  onUpdateSkydomeProp: (key: keyof SkydomeProps, value: unknown) => void;
}) {
  return (
    <div style={SECTION}>
      <div style={SECTION_LABEL}>Skydome</div>
      <div>
        <label style={{ display: 'block', color: '#aaa', fontSize: 11, marginBottom: 3 }}>Image</label>
        <AssetField
          assetType="image"
          value={skydomeProps.textureUrl}
          manifestStore={manifestStore}
          onChange={(v) => onUpdateSkydomeProp('textureUrl', v)}
        />
      </div>
    </div>
  );
}

function KeyLightSection({
  keyLightProps, onUpdateKeyLightProp,
}: { keyLightProps: KeyLightProps; onUpdateKeyLightProp: (key: keyof KeyLightProps, value: unknown) => void }) {
  return (
    <div style={SECTION}>
      <div style={SECTION_LABEL}>Key Light</div>
      <div style={{ marginBottom: 8 }}>
        <label style={{ display: 'block', color: '#aaa', fontSize: 11, marginBottom: 3 }}>Color</label>
        <input
          type="color"
          style={{ ...INPUT, padding: 2, height: 28 }}
          value={keyLightProps.color}
          onChange={e => onUpdateKeyLightProp('color', e.target.value)}
        />
      </div>
      <div>
        <label style={{ display: 'block', color: '#aaa', fontSize: 11, marginBottom: 3 }}>
          Intensity ({keyLightProps.intensity.toFixed(2)})
        </label>
        <input
          type="range"
          min={0}
          max={5}
          step={0.05}
          style={{ ...INPUT, padding: 0, height: 24 }}
          value={keyLightProps.intensity}
          onChange={e => onUpdateKeyLightProp('intensity', parseFloat(e.target.value))}
        />
      </div>
    </div>
  );
}

function SceneGraphList({
  objects, selectedId, onSelect,
}: { objects: ObjectSummary[]; selectedId: string | null; onSelect: (id: string | null) => void }) {
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set());
  const toggle = (id: string) => setExpanded(prev => {
    const next = new Set(prev);
    if (next.has(id)) next.delete(id); else next.add(id);
    return next;
  });

  const byId      = new Map(objects.map(o => [o.id, o]));
  const childrenOf = new Map<string | null, ObjectSummary[]>();
  for (const o of objects) {
    const p = o.parentId && byId.has(o.parentId) ? o.parentId : null;
    const arr = childrenOf.get(p) ?? [];
    arr.push(o);
    childrenOf.set(p, arr);
  }
  const roots = childrenOf.get(null) ?? [];

  return (
    <div style={SECTION}>
      <div style={SECTION_LABEL}>Objects ({objects.length})</div>
      {objects.length === 0 && <div style={{ color: '#666', fontSize: 12 }}>No objects yet</div>}
      {roots.map(o => (
        <SceneGraphNode
          key={o.id}
          node={o}
          depth={0}
          childrenOf={childrenOf}
          expanded={expanded}
          selectedId={selectedId}
          onToggle={toggle}
          onSelect={onSelect}
        />
      ))}
    </div>
  );
}

function SceneGraphNode({
  node, depth, childrenOf, expanded, selectedId, onToggle, onSelect,
}: {
  node:        ObjectSummary;
  depth:       number;
  childrenOf:  Map<string | null, ObjectSummary[]>;
  expanded:    Set<string>;
  selectedId:  string | null;
  onToggle:    (id: string) => void;
  onSelect:    (id: string | null) => void;
}) {
  const kids   = childrenOf.get(node.id) ?? [];
  const hasKids = kids.length > 0;
  const isOpen = expanded.has(node.id);
  const isSel  = node.id === selectedId;

  return (
    <>
      <div
        style={{
          ...LIST_ROW,
          paddingLeft: 8 + depth * 12,
          background:  isSel ? 'rgba(80,140,220,0.3)' : 'transparent',
        }}
        onClick={() => onSelect(isSel ? null : node.id)}
      >
        <span style={{ display: 'flex', alignItems: 'center', gap: 4, minWidth: 0 }}>
          <span
            onClick={e => { e.stopPropagation(); if (hasKids) onToggle(node.id); }}
            style={{
              display:        'inline-flex',
              alignItems:     'center',
              justifyContent: 'center',
              width:          22,
              height:         22,
              marginLeft:     -4,
              color:          '#aaa',
              cursor:         hasKids ? 'pointer' : 'default',
              fontSize:       16,
              lineHeight:     1,
              userSelect:     'none',
            }}
          >
            {hasKids ? (isOpen ? '▾' : '▸') : ''}
          </span>
          <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{node.id}</span>
        </span>
        <span style={{ color: '#888', flexShrink: 0, marginLeft: 6 }}>{resolveObjectMeta(node.objectType).label}</span>
      </div>
      {hasKids && isOpen && kids.map(k => (
        <SceneGraphNode
          key={k.id}
          node={k}
          depth={depth + 1}
          childrenOf={childrenOf}
          expanded={expanded}
          selectedId={selectedId}
          onToggle={onToggle}
          onSelect={onSelect}
        />
      ))}
    </>
  );
}

function PropertyEditor({
  selected, manifestStore, onUpdateProp,
}: {
  selected:      ObjectSummary | null;
  manifestStore: ManifestStore | null;
  onUpdateProp:  (id: string, key: string, value: unknown) => void;
}) {
  if (!selected) {
    return (
      <div style={SECTION}>
        <div style={SECTION_LABEL}>Properties</div>
        <div style={{ color: '#666', fontSize: 12 }}>Select an object to edit its properties</div>
      </div>
    );
  }

  const def = resolveObjectMeta(selected.objectType);
  return (
    <div style={SECTION}>
      <div style={SECTION_LABEL}>Properties — {selected.id}</div>
      {def.propertySchema.map(p => (
        <PropertyRow
          key={p.key}
          def={p}
          value={selected.props[p.key]}
          manifestStore={manifestStore}
          onChange={(v) => onUpdateProp(selected.id, p.key, v)}
        />
      ))}
      <TagsRow
        tags={selected.tags}
        onChange={(next) => onUpdateProp(selected.id, 'tags', next)}
      />
    </div>
  );
}

function TagsRow({
  tags, onChange,
}: { tags: string[]; onChange: (next: string[]) => void }) {
  const [draft, setDraft] = useState('');

  const commit = () => {
    const t = draft.trim().toLowerCase();
    setDraft('');
    if (!t || tags.includes(t)) return;
    onChange([...tags, t]);
  };
  const remove = (t: string) => onChange(tags.filter(x => x !== t));

  return (
    <div style={{ marginBottom: 8 }}>
      <label style={{ display: 'block', color: '#aaa', fontSize: 11, marginBottom: 3 }}>Tags</label>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, marginBottom: 4 }}>
        {tags.map(t => (
          <span key={t} style={CHIP}>
            {t}
            <button
              onClick={() => remove(t)}
              style={CHIP_X}
              title="Remove tag"
            >×</button>
          </span>
        ))}
      </div>
      <input
        type="text"
        style={INPUT}
        placeholder="Add tag…"
        value={draft}
        onChange={e => setDraft(e.target.value)}
        onKeyDown={e => {
          if (e.key === 'Enter' || e.key === ',') { e.preventDefault(); commit(); }
          else if (e.key === 'Backspace' && draft === '' && tags.length > 0) {
            remove(tags[tags.length - 1]);
          }
        }}
        onBlur={commit}
      />
    </div>
  );
}

function PropertyRow({
  def, value, manifestStore, onChange,
}: {
  def:           PropertyDef;
  value:         unknown;
  manifestStore: ManifestStore | null;
  onChange:      (v: unknown) => void;
}) {
  const isAsset = def.type === 'asset:image' || def.type === 'asset:model' || def.type === 'asset:sound';
  const assetType: AssetType | null = isAsset
    ? (def.type.slice('asset:'.length) as AssetType)
    : null;
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
      {def.type === 'boolean' && (
        <input
          type="checkbox"
          checked={Boolean(value)}
          onChange={e => onChange(e.target.checked)}
        />
      )}
      {def.type === 'seat' && (
        <SeatSelect value={value as number} onChange={onChange} />
      )}
      {assetType && (
        <AssetField
          assetType={assetType}
          value={(value as string) ?? ''}
          manifestStore={manifestStore}
          onChange={(v) => onChange(v)}
        />
      )}
    </div>
  );
}

const ASSET_ROW: React.CSSProperties = {
  display:      'flex',
  alignItems:   'center',
  gap:          6,
  background:   'rgba(0,0,0,0.4)',
  border:       '1px solid rgba(255,255,255,0.2)',
  borderRadius: 3,
  padding:      4,
  cursor:       'pointer',
  minHeight:    32,
  boxSizing:    'border-box',
};

const ASSET_THUMB: React.CSSProperties = {
  width:           28,
  height:          28,
  flex:            '0 0 auto',
  background:      'rgba(255,255,255,0.06)',
  border:          '1px solid rgba(255,255,255,0.08)',
  borderRadius:    2,
  display:         'flex',
  alignItems:      'center',
  justifyContent:  'center',
  fontSize:        9,
  color:           '#888',
  textTransform:   'uppercase',
  overflow:        'hidden',
};

const ASSET_THUMB_IMG: React.CSSProperties = {
  width:    '100%',
  height:   '100%',
  objectFit: 'cover',
};

const ASSET_LABEL: React.CSSProperties = {
  flex:         1,
  fontSize:     12,
  color:        '#e8e8e8',
  whiteSpace:   'nowrap',
  overflow:     'hidden',
  textOverflow: 'ellipsis',
  minWidth:     0,
};

const ASSET_BTN: React.CSSProperties = {
  background:   'none',
  border:       'none',
  color:        '#aaa',
  cursor:       'pointer',
  fontSize:     14,
  padding:      '0 4px',
  flex:         '0 0 auto',
};

function AssetField({
  assetType, value, manifestStore, onChange,
}: {
  assetType:     AssetType;
  value:         string;
  manifestStore: ManifestStore | null;
  onChange:      (v: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const ref = value || '';
  const display = describeRef(ref, manifestStore);

  return (
    <>
      <div
        style={ASSET_ROW}
        onClick={() => setOpen(true)}
        title={ref || 'No asset selected'}
      >
        <AssetThumbnail assetType={assetType} ref_={ref} />
        <span style={ASSET_LABEL}>{display}</span>
        <span style={{ color: '#888', flex: '0 0 auto' }}>▼</span>
        {ref && (
          <button
            type="button"
            style={ASSET_BTN}
            title="Clear"
            onClick={(e) => { e.stopPropagation(); onChange(''); }}
          >×</button>
        )}
      </div>
      <AssetPicker
        open={open}
        onClose={() => setOpen(false)}
        onSelect={(v) => onChange(v)}
        type={assetType}
        store={manifestStore}
        currentRef={ref || undefined}
      />
    </>
  );
}

function describeRef(ref: string, store: ManifestStore | null): string {
  if (!ref) return 'No asset';
  if (ref.includes(':') && !/^https?:|^data:|^blob:/i.test(ref)) {
    const entry = store?.getDraft().get(ref)
      ?? PRIMITIVE_MANIFEST.get(ref)
      ?? BASE_MANIFEST.get(ref);
    if (entry) return entry.name;
    return ref;
  }
  return shortUrl(ref);
}

function shortUrl(url: string): string {
  if (url.length <= 40) return url;
  const idx = url.lastIndexOf('/');
  const tail = idx >= 0 ? url.slice(idx + 1) : url;
  return tail.length > 0 ? '…/' + tail : url;
}

function AssetThumbnail({ assetType, ref_ }: { assetType: AssetType; ref_: string }) {
  const [src, setSrc] = useState<string | null>(null);

  useEffect(() => {
    setSrc(null);
    if (!ref_ || assetType !== 'image') return;
    const unsub = assetService.subscribe(ref_, 'image', (tex, status) => {
      if (status !== 'loaded') { setSrc(null); return; }
      setSrc(textureToDataUrl(tex));
    });
    return unsub;
  }, [ref_, assetType]);

  if (assetType === 'image' && src) {
    return (
      <div style={ASSET_THUMB}>
        <img src={src} alt="" style={ASSET_THUMB_IMG} />
      </div>
    );
  }
  return <div style={ASSET_THUMB}>{assetType[0]}</div>;
}

// Snapshot a Three texture into an <img>-friendly data URL by drawing the
// underlying image to a small canvas. Returns null on environments without a
// usable image (e.g. tests with the magenta placeholder DataTexture).
function textureToDataUrl(tex: THREE.Texture): string | null {
  if (typeof document === 'undefined') return null;
  const img = (tex as { image?: unknown }).image;
  if (!img) return null;
  const w = (img as { width?: number }).width  ?? 0;
  const h = (img as { height?: number }).height ?? 0;
  if (!w || !h) return null;
  try {
    const canvas = document.createElement('canvas');
    const SIZE = 64;
    canvas.width = canvas.height = SIZE;
    const ctx = canvas.getContext('2d');
    if (!ctx) return null;
    ctx.drawImage(img as CanvasImageSource, 0, 0, SIZE, SIZE);
    return canvas.toDataURL('image/png');
  } catch {
    return null;
  }
}

function SeatSelect({ value, onChange }: { value: number | undefined; onChange: (v: unknown) => void }) {
  const current = typeof value === 'number' ? value : -1;
  const swatch = current >= 0 && current < SEAT_COLOURS.length ? SEAT_COLOURS[current] : 'transparent';
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
      <span style={{
        width: 14, height: 14, borderRadius: 3,
        background: swatch,
        border: '1px solid rgba(255,255,255,0.3)',
        flex: '0 0 auto',
      }} />
      <select
        style={INPUT}
        value={current}
        onChange={e => onChange(parseInt(e.target.value, 10))}
      >
        <option value={-1}>None</option>
        {SEAT_COLOURS.map((c, i) => (
          <option key={i} value={i} style={{ background: c, color: '#000' }}>
            Seat {i} — {c}
          </option>
        ))}
      </select>
    </div>
  );
}

function RollSection({ onRollDice }: { onRollDice: () => void }) {
  return (
    <div style={SECTION}>
      <div style={SECTION_LABEL}>Dice</div>
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
