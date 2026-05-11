// Lightweight asset picker opened from EditorPanel asset:* property rows.
// Issue #6 of issues--asset-registry.md.
//
// Four tabs: Primitives | Base | Custom | URL paste. Entries are filtered to
// the requested asset type so an `asset:image` row never sees model/sound
// entries. Selecting an entry calls `onSelect(slug)`. The URL tab writes a
// raw URL into the property without creating a manifest entry.

import { useEffect, useMemo, useState, useSyncExternalStore } from 'react';
import * as Dialog from '@radix-ui/react-dialog';
import { useAnchorTarget } from './AnchorLayout';
import { type ManifestStore } from '../assets/ManifestStore';
import { type AssetEntry, type AssetType } from '../assets/Manifest';
import { parseRef, serializeSpriteRef } from '../assets/spriteRef';
import { BASE_MANIFEST, PRIMITIVE_MANIFEST } from '../assets/baseManifest';

interface Props {
  open:        boolean;
  onClose:     () => void;
  onSelect:    (ref: string) => void;
  type:        AssetType;
  store:       ManifestStore | null;
  currentRef?: string;
}

type TabId = 'primitives' | 'base' | 'custom' | 'url';

const OVERLAY: React.CSSProperties = {
  position:   'fixed',
  inset:      0,
  background: 'rgba(0,0,0,0.55)',
  zIndex:     200,
};

const CONTENT: React.CSSProperties = {
  width:         600,
  maxWidth:      '90vw',
  height:        '70vh',
  background:    'rgba(20,20,32,0.98)',
  border:        '1px solid rgba(255,255,255,0.15)',
  borderRadius:  8,
  color:         '#e8e8e8',
  fontFamily:    'sans-serif',
  fontSize:      13,
  zIndex:        201,
  display:       'flex',
  flexDirection: 'column',
  boxShadow:     '0 12px 40px rgba(0,0,0,0.7)',
};

const HEADER: React.CSSProperties = {
  display:        'flex',
  alignItems:     'center',
  justifyContent: 'space-between',
  padding:        '12px 16px',
  borderBottom:   '1px solid rgba(255,255,255,0.1)',
};

const TITLE: React.CSSProperties = { fontSize: 14, fontWeight: 600, margin: 0 };

const CLOSE_BTN: React.CSSProperties = {
  background: 'none', border: 'none', color: '#aaa',
  cursor: 'pointer', fontSize: 18, lineHeight: 1, padding: '0 4px',
};

const TAB_BAR: React.CSSProperties = {
  display:      'flex',
  borderBottom: '1px solid rgba(255,255,255,0.08)',
};

const TAB_BTN: React.CSSProperties = {
  background:   'none',
  border:       'none',
  color:        '#bdbdc0',
  padding:      '8px 14px',
  cursor:       'pointer',
  fontSize:     12,
  borderBottom: '2px solid transparent',
};

const TAB_BTN_ACTIVE: React.CSSProperties = {
  ...TAB_BTN,
  color:        '#e8e8e8',
  fontWeight:   600,
  borderBottom: '2px solid rgba(120,180,240,0.6)',
};

const BODY: React.CSSProperties = {
  flex:      1,
  overflowY: 'auto',
  padding:   '8px 12px',
};

const SEARCH_ROW: React.CSSProperties = {
  display: 'flex',
  gap:     6,
  padding: '8px 12px 0',
};

const INPUT: React.CSSProperties = {
  background:   'rgba(0,0,0,0.4)',
  border:       '1px solid rgba(255,255,255,0.18)',
  color:        '#e8e8e8',
  padding:      '4px 6px',
  borderRadius: 3,
  fontSize:     12,
  fontFamily:   'inherit',
  flex:         1,
};

const GRID: React.CSSProperties = {
  display:             'grid',
  gridTemplateColumns: 'repeat(auto-fill, minmax(110px, 1fr))',
  gap:                 8,
};

const TILE: React.CSSProperties = {
  display:        'flex',
  flexDirection:  'column',
  alignItems:     'stretch',
  border:         '1px solid rgba(255,255,255,0.12)',
  borderRadius:   4,
  background:     'rgba(255,255,255,0.04)',
  cursor:         'pointer',
  padding:        6,
  gap:            4,
  overflow:       'hidden',
};

const TILE_SELECTED: React.CSSProperties = {
  ...TILE,
  borderColor: 'rgba(120,180,240,0.8)',
  background:  'rgba(70,130,200,0.18)',
};

const THUMB_BOX: React.CSSProperties = {
  width:           '100%',
  aspectRatio:     '1 / 1',
  background:      'rgba(0,0,0,0.4)',
  border:          '1px solid rgba(255,255,255,0.06)',
  display:         'flex',
  alignItems:      'center',
  justifyContent:  'center',
  color:           '#666',
  fontSize:        10,
  textTransform:   'uppercase',
  letterSpacing:   1,
  overflow:        'hidden',
};

const THUMB_IMG: React.CSSProperties = {
  width:    '100%',
  height:   '100%',
  objectFit: 'cover',
};

const TILE_NAME: React.CSSProperties = {
  fontSize:     12,
  fontWeight:   500,
  whiteSpace:   'nowrap',
  textOverflow: 'ellipsis',
  overflow:     'hidden',
};

const TILE_SLUG: React.CSSProperties = {
  fontSize:     10,
  color:        '#888',
  whiteSpace:   'nowrap',
  textOverflow: 'ellipsis',
  overflow:     'hidden',
};

const FOOTER: React.CSSProperties = {
  display:        'flex',
  alignItems:     'center',
  justifyContent: 'flex-end',
  padding:        '10px 16px',
  borderTop:      '1px solid rgba(255,255,255,0.1)',
  gap:            6,
};

const BTN: React.CSSProperties = {
  background:   'rgba(255,255,255,0.08)',
  border:       '1px solid rgba(255,255,255,0.18)',
  color:        '#e8e8e8',
  padding:      '5px 10px',
  borderRadius: 3,
  cursor:       'pointer',
  fontSize:     12,
};

const BTN_PRIMARY: React.CSSProperties = {
  ...BTN,
  background:  'rgba(70,130,200,0.4)',
  borderColor: 'rgba(120,180,240,0.45)',
};

const BTN_DISABLED: React.CSSProperties = {
  ...BTN,
  opacity: 0.4,
  cursor:  'not-allowed',
};

const URL_PREVIEW: React.CSSProperties = {
  width:           '100%',
  maxHeight:       260,
  marginTop:       8,
  border:          '1px solid rgba(255,255,255,0.1)',
  background:      'rgba(0,0,0,0.4)',
  display:         'flex',
  alignItems:      'center',
  justifyContent:  'center',
  padding:         8,
  minHeight:       120,
  color:           '#888',
  fontSize:        12,
};

const PREVIEW_IMG: React.CSSProperties = {
  maxWidth:  '100%',
  maxHeight: 240,
  objectFit: 'contain',
};

type PickerMode = { kind: 'list' } | { kind: 'sheet'; sheet: AssetEntry };

export function AssetPicker({ open, onClose, onSelect, type, store, currentRef }: Props) {
  const centerAnchor   = useAnchorTarget('center');
  const [tab, setTab]  = useState<TabId>('custom');
  const [query, setQuery] = useState('');
  const [pasted, setPasted] = useState('');
  const [mode,   setMode]   = useState<PickerMode>({ kind: 'list' });

  const draft = useSyncExternalStore(
    (cb) => store?.subscribe(cb) ?? (() => {}),
    () => store?.getDraft() ?? null,
  );

  // Reset transient state when the modal opens. If currentRef is a sprite
  // ref, jump straight into the drill-in for that sheet so the host lands on
  // their existing selection without an extra click.
  useEffect(() => {
    if (!open) return;
    setQuery('');
    setPasted('');
    setTab('custom');
    const parsed = currentRef ? parseRef(currentRef) : null;
    if (parsed?.kind === 'sprite') {
      const sheet = findSheet(draft?.toArray() ?? [], parsed.sheetSlug);
      if (sheet) { setMode({ kind: 'sheet', sheet }); return; }
    }
    setMode({ kind: 'list' });
  }, [open]);

  const primitiveEntries = useMemo(
    () => filterEntries(PRIMITIVE_MANIFEST.toArray(), type, query),
    [type, query],
  );
  const baseEntries = useMemo(
    () => filterEntries(BASE_MANIFEST.toArray(), type, query),
    [type, query],
  );
  const customEntries = useMemo(
    () => filterEntries(
      (draft?.toArray() ?? []).filter((e) => e.slug.startsWith('custom:')),
      type,
      query,
    ),
    [draft, type, query],
  );

  const pick = (ref: string) => {
    onSelect(ref);
    onClose();
  };

  // Sheet tiles drill in instead of emitting — a single-asset slot can't
  // accept a 2-segment sheet slug.
  const pickEntry = (entry: AssetEntry) => {
    if (entry.type === 'spritesheet') {
      setMode({ kind: 'sheet', sheet: entry });
      return;
    }
    pick(entry.slug);
  };

  const commitUrl = () => {
    const v = pasted.trim();
    if (!v) return;
    // URL tab continues to emit raw URLs only — never a sheet ref.
    onSelect(v);
    onClose();
  };

  const inSheet = mode.kind === 'sheet';

  return (
    <Dialog.Root open={open} onOpenChange={(o) => { if (!o) onClose(); }}>
      <Dialog.Portal container={centerAnchor ?? undefined}>
        <Dialog.Overlay style={OVERLAY} />
        <Dialog.Content style={CONTENT} aria-describedby={undefined}>
          <div style={HEADER}>
            <Dialog.Title style={TITLE}>
              {inSheet ? (
                <span>
                  <button
                    type="button"
                    style={BREADCRUMB_BTN}
                    onClick={() => setMode({ kind: 'list' })}
                  >‹ Pick {type} asset</button>
                  <span style={{ color: '#888' }}> / {mode.sheet.name}</span>
                </span>
              ) : `Pick ${type} asset`}
            </Dialog.Title>
            <Dialog.Close asChild>
              <button style={CLOSE_BTN} type="button" aria-label="Close">×</button>
            </Dialog.Close>
          </div>
          {!inSheet && (
            <div style={TAB_BAR}>
              <button type="button" style={tab === 'primitives' ? TAB_BTN_ACTIVE : TAB_BTN} onClick={() => setTab('primitives')}>Primitives</button>
              <button type="button" style={tab === 'base'       ? TAB_BTN_ACTIVE : TAB_BTN} onClick={() => setTab('base')}>Base</button>
              <button type="button" style={tab === 'custom'     ? TAB_BTN_ACTIVE : TAB_BTN} onClick={() => setTab('custom')}>Custom</button>
              <button type="button" style={tab === 'url'        ? TAB_BTN_ACTIVE : TAB_BTN} onClick={() => setTab('url')}>URL</button>
            </div>
          )}
          {!inSheet && tab !== 'url' && (
            <div style={SEARCH_ROW}>
              <input
                type="text"
                style={INPUT}
                placeholder="Search by name, slug, or tag…"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
              />
            </div>
          )}
          <div style={BODY}>
            {inSheet && <SpriteGrid sheet={mode.sheet} currentRef={currentRef} onPick={pick} />}
            {!inSheet && tab === 'primitives' && <Grid entries={primitiveEntries} currentRef={currentRef} onPick={pickEntry} />}
            {!inSheet && tab === 'base'       && <Grid entries={baseEntries}      currentRef={currentRef} onPick={pickEntry} />}
            {!inSheet && tab === 'custom'     && <Grid entries={customEntries}    currentRef={currentRef} onPick={pickEntry} />}
            {!inSheet && tab === 'url'        && (
              <UrlTab
                pasted={pasted}
                setPasted={setPasted}
                type={type}
              />
            )}
          </div>
          <div style={FOOTER}>
            <button type="button" style={BTN} onClick={onClose}>Cancel</button>
            {!inSheet && tab === 'url' && (
              <button
                type="button"
                style={pasted.trim() ? BTN_PRIMARY : BTN_DISABLED}
                disabled={!pasted.trim()}
                onClick={commitUrl}
              >
                Use URL
              </button>
            )}
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

const BREADCRUMB_BTN: React.CSSProperties = {
  background:   'none',
  border:       'none',
  color:        '#e8e8e8',
  cursor:       'pointer',
  fontSize:     14,
  fontWeight:   600,
  padding:      0,
  font:         'inherit',
};

function findSheet(entries: AssetEntry[], slug: string): AssetEntry | null {
  return entries.find((e) => e.slug === slug && e.type === 'spritesheet') ?? null;
}

function Grid({
  entries, currentRef, onPick,
}: { entries: AssetEntry[]; currentRef: string | undefined; onPick: (entry: AssetEntry) => void }) {
  if (entries.length === 0) {
    return <div style={{ color: '#666', fontSize: 12, padding: 16 }}>No matching entries.</div>;
  }
  // A sprite ref like `custom:deck:5` highlights the sheet tile `custom:deck`.
  const parsedCurrent = currentRef ? parseRef(currentRef) : null;
  const sheetSlugForCurrent = parsedCurrent?.kind === 'sprite' ? parsedCurrent.sheetSlug : null;
  return (
    <div style={GRID}>
      {entries.map((e) => {
        const selected = e.slug === currentRef || e.slug === sheetSlugForCurrent;
        return (
          <div
            key={e.slug}
            style={selected ? TILE_SELECTED : TILE}
            onClick={() => onPick(e)}
            title={e.description ?? e.slug}
          >
            <Thumbnail entry={e} />
            <div style={TILE_NAME}>{e.name}</div>
            <div style={TILE_SLUG}>{e.slug}{e.type === 'spritesheet' ? ` (${e.cols}×${e.rows})` : ''}</div>
          </div>
        );
      })}
    </div>
  );
}

function Thumbnail({ entry }: { entry: AssetEntry }) {
  if ((entry.type === 'image' || entry.type === 'spritesheet') && !isSyntheticUrl(entry.url)) {
    return (
      <div style={THUMB_BOX}>
        <img src={entry.url} alt={entry.name} style={THUMB_IMG} loading="lazy" />
      </div>
    );
  }
  return <div style={THUMB_BOX}>{entry.type}</div>;
}

// Sub-grid drill-in for a single spritesheet. Each cell uses CSS background
// positioning of the sheet URL — no per-cell canvas/draw work — so the grid
// appears instantly once the sheet image is in the browser cache.
function SpriteGrid({
  sheet, currentRef, onPick,
}: { sheet: AssetEntry; currentRef: string | undefined; onPick: (ref: string) => void }) {
  const cols = sheet.cols ?? 1;
  const rows = sheet.rows ?? 1;
  const total = cols * rows;
  const parsed = currentRef ? parseRef(currentRef) : null;
  const selectedIndex = parsed?.kind === 'sprite' && parsed.sheetSlug === sheet.slug ? parsed.index : -1;

  // Min tile size ~70px; cap to keep huge sheets manageable.
  const cells: number[] = [];
  for (let i = 0; i < total; i++) cells.push(i);

  return (
    <div style={{ display: 'grid', gridTemplateColumns: `repeat(${cols}, minmax(48px, 1fr))`, gap: 4 }}>
      {cells.map((i) => {
        const col       = i % cols;
        const row       = Math.floor(i / cols);
        const bgPosX    = cols === 1 ? '50%' : `${(col / (cols - 1)) * 100}%`;
        const bgPosY    = rows === 1 ? '50%' : `${(row / (rows - 1)) * 100}%`;
        const isSelected = i === selectedIndex;
        return (
          <div
            key={i}
            onClick={() => onPick(serializeSpriteRef(sheet.slug, i))}
            title={`${sheet.slug}:${i}`}
            style={{
              aspectRatio:        '1 / 1',
              backgroundImage:    `url("${sheet.url}")`,
              backgroundSize:     `${cols * 100}% ${rows * 100}%`,
              backgroundPosition: `${bgPosX} ${bgPosY}`,
              backgroundRepeat:   'no-repeat',
              border:             isSelected
                ? '2px solid rgba(120,180,240,0.85)'
                : '1px solid rgba(255,255,255,0.12)',
              borderRadius:       3,
              cursor:             'pointer',
            }}
          />
        );
      })}
    </div>
  );
}

function UrlTab({
  pasted, setPasted, type,
}: { pasted: string; setPasted: (v: string) => void; type: AssetType }) {
  const url = pasted.trim();
  return (
    <div>
      <input
        type="text"
        style={{ ...INPUT, width: '100%' }}
        placeholder={`Paste a ${type} URL…`}
        value={pasted}
        onChange={(e) => setPasted(e.target.value)}
        autoFocus
      />
      <div style={URL_PREVIEW}>
        {!url && 'Paste a URL above to preview.'}
        {url && type === 'image' && <img src={url} alt="preview" style={PREVIEW_IMG} />}
        {url && type === 'sound' && <audio controls src={url} style={{ width: '100%' }} />}
        {url && type === 'model' && <span>Model preview not available.</span>}
      </div>
    </div>
  );
}

function filterEntries(entries: AssetEntry[], type: AssetType, query: string): AssetEntry[] {
  const q = query.trim().toLowerCase();
  return entries.filter((e) => {
    // Spritesheets surface in the image picker as drill-in tiles. Other
    // types (model, sound) match exactly.
    const matches = type === 'image'
      ? (e.type === 'image' || e.type === 'spritesheet')
      : e.type === type;
    if (!matches) return false;
    if (!q) return true;
    if (e.name.toLowerCase().includes(q)) return true;
    if (e.slug.toLowerCase().includes(q)) return true;
    if (e.tags?.some((t) => t.toLowerCase().includes(q))) return true;
    return false;
  });
}

function isSyntheticUrl(url: string): boolean {
  return url.startsWith('placeholder://') || url.startsWith('primitive://');
}
