// Host-only Asset Manager. Issue #4 of issues--asset-registry.md.
//
// Four tabs:
//   - Primitives (read-only) — `prim:*` mesh entries from the bundled catalog.
//   - Base       (read-only) — `base:*` placeholder entries.
//   - Custom     (editable)  — host's own catalog stored in `ManifestStore`.
// A footer shows the unpushed-change count and a Push to peers button. The
// button is rendered for parity with the final UX but stays disabled in this
// slice — wire replication lands in #5.
//
// Custom-tab edits flow through `ManifestStore.editDraft`. Slug auto-suggests
// from the URL filename and is locked once the entry is committed (PRD §
// "slug is immutable after an asset is created"). New entries default to
// `preload: true` (PRD § Defaults).

import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import * as Dialog from '@radix-ui/react-dialog';
import { useAnchorTarget } from './AnchorLayout';
import { type ManifestStore } from '../assets/ManifestStore';
import { type AssetEntry, type AssetType, validateSlug } from '../assets/Manifest';
import { BASE_MANIFEST, PRIMITIVE_MANIFEST } from '../assets/baseManifest';
import { assetService, type AssetStatus } from '../assets/AssetService';
import { probe, type ProbeResult } from '../assets/corsPreflight';

interface Props {
  store:         ManifestStore | null;
  onPush:        () => void;
  open?:         boolean;
  onOpenChange?: (open: boolean) => void;
  hideTrigger?:  boolean;
}

type TabId = 'primitives' | 'base' | 'custom';

const TRIGGER_BTN: React.CSSProperties = {
  background:   'var(--surface)',
  border:       '1px solid var(--line-strong)',
  color:        'var(--ink)',
  padding:      '8px 12px',
  borderRadius: 'var(--panel-radius)',
  cursor:       'pointer',
  fontFamily:   'var(--font-sans)',
  fontSize:     12,
  boxShadow:    'var(--shadow-lg)',
  userSelect:   'none',
};

const OVERLAY: React.CSSProperties = {
  position:   'fixed',
  inset:      0,
  background: 'rgba(0,0,0,0.45)',
  zIndex:     200,
};

const CONTENT: React.CSSProperties = {
  width:         640,
  maxWidth:      '90vw',
  height:        '70vh',
  background:    'var(--surface)',
  border:        '1px solid var(--line)',
  borderRadius:  'var(--panel-radius)',
  color:         'var(--ink)',
  fontFamily:    'var(--font-sans)',
  fontSize:      13,
  zIndex:        201,
  display:       'flex',
  flexDirection: 'column',
  boxShadow:     'var(--shadow-lg)',
};

const HEADER: React.CSSProperties = {
  display:        'flex',
  alignItems:     'center',
  justifyContent: 'space-between',
  padding:        '12px 16px',
  borderBottom:   '1px solid var(--line)',
};

const TITLE: React.CSSProperties = {
  fontSize:      14,
  fontWeight:    600,
  margin:        0,
  fontFamily:    'var(--font-serif)',
  letterSpacing: '-0.01em',
};

const CLOSE_BTN: React.CSSProperties = {
  background: 'none', border: 'none', color: 'var(--ink-mute)',
  cursor: 'pointer', fontSize: 18, lineHeight: 1, padding: '0 4px',
};

const TAB_BAR: React.CSSProperties = {
  display:      'flex',
  borderBottom: '1px solid var(--line)',
};

const TAB_BTN: React.CSSProperties = {
  background:    'none',
  border:        'none',
  color:         'var(--ink-2)',
  padding:       '8px 14px',
  cursor:        'pointer',
  fontSize:      12,
  borderBottom:  '2px solid transparent',
};

const TAB_BTN_ACTIVE: React.CSSProperties = {
  ...TAB_BTN,
  color:        'var(--ink)',
  fontWeight:   600,
  borderBottom: '2px solid var(--accent)',
};

const BODY: React.CSSProperties = {
  flex:          1,
  overflowY:     'auto',
  padding:       '8px 12px',
};

const ROW: React.CSSProperties = {
  display:      'grid',
  gridTemplateColumns: '40px 1fr 70px 60px',
  alignItems:   'center',
  gap:          8,
  padding:      '6px 8px',
  borderRadius: 'var(--card-radius)',
  border:       '1px solid var(--line)',
  marginBottom: 4,
};

const PREVIEW_BOX: React.CSSProperties = {
  width:          40,
  height:         40,
  borderRadius:   3,
  background:     'var(--bg)',
  border:         '1px solid var(--line)',
  display:        'flex',
  alignItems:     'center',
  justifyContent: 'center',
  overflow:       'hidden',
};

const PREVIEW_IMG: React.CSSProperties = {
  width:     '100%',
  height:    '100%',
  objectFit: 'cover',
};

const PREVIEW_PLAY_BTN: React.CSSProperties = {
  background:   'none',
  border:       'none',
  color:        'var(--ink)',
  cursor:       'pointer',
  fontSize:     16,
  padding:      0,
  lineHeight:   1,
  width:        '100%',
  height:       '100%',
};

const ROW_LABEL: React.CSSProperties = { display: 'flex', flexDirection: 'column', gap: 2, minWidth: 0 };
const ROW_NAME:  React.CSSProperties = { fontWeight: 500, whiteSpace: 'nowrap', textOverflow: 'ellipsis', overflow: 'hidden' };
const ROW_SLUG:  React.CSSProperties = { fontSize: 11, color: 'var(--ink-mute)', whiteSpace: 'nowrap', textOverflow: 'ellipsis', overflow: 'hidden' };
const ROW_TYPE:  React.CSSProperties = { fontSize: 11, color: 'var(--ink-2)', textTransform: 'uppercase', letterSpacing: 0.5 };

const FOOTER: React.CSSProperties = {
  display:        'flex',
  alignItems:     'center',
  justifyContent: 'space-between',
  padding:        '10px 16px',
  borderTop:      '1px solid var(--line)',
  fontSize:       12,
};

const PUSH_BTN: React.CSSProperties = {
  background:   'color-mix(in oklab, var(--accent) 22%, transparent)',
  border:       '1px solid var(--accent)',
  color:        'var(--ink)',
  padding:      '6px 12px',
  borderRadius: 'var(--card-radius)',
  cursor:       'pointer',
  fontSize:     12,
};

const PUSH_BTN_DISABLED: React.CSSProperties = {
  ...PUSH_BTN,
  opacity: 0.4,
  cursor:  'not-allowed',
};

const SMALL_BTN: React.CSSProperties = {
  background:   'var(--surface-2)',
  border:       '1px solid var(--line-strong)',
  color:        'var(--ink)',
  padding:      '4px 8px',
  borderRadius: 3,
  cursor:       'pointer',
  fontSize:     11,
};

const DANGER_BTN: React.CSSProperties = {
  ...SMALL_BTN,
  background: 'color-mix(in oklab, var(--accent) 22%, transparent)',
  border:     '1px solid var(--accent-deep)',
  color:      'var(--accent-deep)',
};

const ADD_BAR: React.CSSProperties = {
  display:        'flex',
  alignItems:     'center',
  gap:            6,
  margin:         '8px 0',
  padding:        '8px',
  border:         '1px dashed var(--line-strong)',
  borderRadius:   'var(--card-radius)',
};

const INPUT: React.CSSProperties = {
  background:   'var(--bg)',
  border:       '1px solid var(--line-strong)',
  color:        'var(--ink)',
  padding:      '4px 6px',
  borderRadius: 3,
  fontSize:     12,
  fontFamily:   'inherit',
};

const FIELD_GRID: React.CSSProperties = {
  display:             'grid',
  gridTemplateColumns: '110px 1fr',
  gap:                 6,
  alignItems:          'center',
  marginBottom:        6,
};

const FIELD_LABEL: React.CSSProperties = {
  fontSize: 11,
  color:    'var(--ink-mute)',
};

const ERROR_LINE: React.CSSProperties = {
  color:    'var(--accent-deep)',
  fontSize: 11,
  margin:   '4px 0',
};

const PREFLIGHT_LINE: React.CSSProperties = {
  fontSize:  11,
  margin:    '4px 0',
  display:   'flex',
  alignItems: 'center',
  gap:        6,
};

const PREFLIGHT_OK: React.CSSProperties = {
  ...PREFLIGHT_LINE,
  color: 'var(--moss)',
};

const PREFLIGHT_WARN: React.CSSProperties = {
  ...PREFLIGHT_LINE,
  color: 'var(--gold)',
};

const PREFLIGHT_PENDING: React.CSSProperties = {
  ...PREFLIGHT_LINE,
  color: 'var(--ink-2)',
};

const WARNING_BADGE: React.CSSProperties = {
  display:        'inline-flex',
  alignItems:     'center',
  justifyContent: 'center',
  width:          16,
  height:         16,
  borderRadius:   '50%',
  background:     'color-mix(in oklab, var(--gold) 25%, transparent)',
  color:          'var(--gold)',
  fontSize:       11,
  fontWeight:     700,
  border:         '1px solid var(--gold)',
  marginLeft:     6,
  flexShrink:     0,
};

export function AssetManagerModal({ store, onPush, open: controlledOpen, onOpenChange, hideTrigger }: Props) {
  const centerAnchor    = useAnchorTarget('center');
  const [uncontrolledOpen, setUncontrolledOpen] = useState(false);
  const open = controlledOpen ?? uncontrolledOpen;
  const setOpen = (next: boolean) => {
    if (controlledOpen === undefined) setUncontrolledOpen(next);
    onOpenChange?.(next);
  };
  const [tab, setTab]   = useState<TabId>('custom');

  return (
    <>
      {!hideTrigger && (
        <button type="button" style={TRIGGER_BTN} onClick={() => setOpen(true)} disabled={!store}>
          Assets
        </button>
      )}
      <Dialog.Root open={open} onOpenChange={setOpen}>
        <Dialog.Portal container={centerAnchor ?? undefined}>
          <Dialog.Overlay style={OVERLAY} />
          <Dialog.Content style={CONTENT} aria-describedby={undefined}>
            <div style={HEADER}>
              <Dialog.Title style={TITLE}>Assets</Dialog.Title>
              <Dialog.Close asChild>
                <button style={CLOSE_BTN} type="button" aria-label="Close">×</button>
              </Dialog.Close>
            </div>
            <div style={TAB_BAR}>
              <button type="button" style={tab === 'primitives' ? TAB_BTN_ACTIVE : TAB_BTN} onClick={() => setTab('primitives')}>Primitives</button>
              <button type="button" style={tab === 'base'       ? TAB_BTN_ACTIVE : TAB_BTN} onClick={() => setTab('base')}>Base</button>
              <button type="button" style={tab === 'custom'     ? TAB_BTN_ACTIVE : TAB_BTN} onClick={() => setTab('custom')}>Custom</button>
            </div>
            <div style={BODY}>
              {tab === 'primitives' && <ReadOnlyList entries={PRIMITIVE_MANIFEST.toArray()} />}
              {tab === 'base'       && <ReadOnlyList entries={BASE_MANIFEST.toArray()} />}
              {tab === 'custom'     && store && <CustomTab store={store} />}
            </div>
            <Footer store={store} onPush={onPush} />
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>
    </>
  );
}

function ReadOnlyList({ entries }: { entries: AssetEntry[] }) {
  if (entries.length === 0) {
    return <div style={{ color: 'var(--ink-mute)', fontSize: 12, padding: 16 }}>Empty.</div>;
  }
  return (
    <>
      {entries.map((e) => (
        <div key={e.slug} style={ROW}>
          <RowPreview entry={e} />
          <div style={ROW_LABEL}>
            <div style={ROW_NAME}>{e.name}</div>
            <div style={ROW_SLUG}>{e.slug}</div>
          </div>
          <div style={ROW_TYPE}>{typeLabel(e.type)}</div>
          <div />
        </div>
      ))}
    </>
  );
}

function typeLabel(t: AssetType): string {
  return t === 'spritesheet' ? 'sprite' : t;
}

function RowPreview({ entry }: { entry: AssetEntry }) {
  if ((entry.type === 'image' || entry.type === 'spritesheet') && !isSyntheticUrl(entry.url)) {
    return (
      <div style={PREVIEW_BOX}>
        <img src={entry.url} alt={entry.name} style={PREVIEW_IMG} loading="lazy" />
      </div>
    );
  }
  if (entry.type === 'sound' && !isSyntheticUrl(entry.url)) {
    return <div style={PREVIEW_BOX}><SoundPreview url={entry.url} /></div>;
  }
  return <div style={PREVIEW_BOX} />;
}

function SoundPreview({ url }: { url: string }) {
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const [playing, setPlaying] = useState(false);

  useEffect(() => () => { audioRef.current?.pause(); }, []);

  const toggle = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (!audioRef.current || audioRef.current.src !== url) {
      audioRef.current?.pause();
      const a = new Audio(url);
      a.addEventListener('ended', () => setPlaying(false));
      audioRef.current = a;
    }
    if (playing) {
      audioRef.current.pause();
      audioRef.current.currentTime = 0;
      setPlaying(false);
    } else {
      audioRef.current.play().catch(() => setPlaying(false));
      setPlaying(true);
    }
  };

  return (
    <button type="button" style={PREVIEW_PLAY_BTN} onClick={toggle} aria-label={playing ? 'Stop' : 'Play'}>
      {playing ? '■' : '▶'}
    </button>
  );
}

function isSyntheticUrl(url: string): boolean {
  return url.startsWith('placeholder://') || url.startsWith('primitive://');
}

function CustomTab({ store }: { store: ManifestStore }) {
  const draft = useSyncExternalStore(
    (cb) => store.subscribe(cb),
    () => store.getDraft(),
  );
  const [editing, setEditing] = useState<string | null>(null);

  const customEntries = useMemo(
    () => draft.list().filter((e) => e.slug.startsWith('custom:')),
    [draft],
  );

  return (
    <>
      <AddRow store={store} />
      {customEntries.length === 0 && (
        <div style={{ color: 'var(--ink-mute)', fontSize: 12, padding: '12px 4px' }}>
          No custom assets yet. Paste a URL above to add one.
        </div>
      )}
      {customEntries.map((e) =>
        editing === e.slug
          ? <EditRow key={e.slug} entry={e} store={store} onClose={() => setEditing(null)} />
          : <CustomRow  key={e.slug} entry={e} onEdit={() => setEditing(e.slug)} onDelete={() => store.editDraft((d) => d.delete(e.slug))} />
      )}
    </>
  );
}

function CustomRow({ entry, onEdit, onDelete }: { entry: AssetEntry; onEdit: () => void; onDelete: () => void }) {
  const status = useAssetStatus(entry);
  return (
    <div style={ROW}>
      <RowPreview entry={entry} />
      <div style={ROW_LABEL}>
        <div style={ROW_NAME}>
          {entry.name}
          {status === 'broken' && (
            <span style={WARNING_BADGE} title="Asset failed to load — check the URL">!</span>
          )}
        </div>
        <div style={ROW_SLUG}>{entry.slug}{entry.preload ? ' · preload' : ''}</div>
      </div>
      <div style={ROW_TYPE}>{typeLabel(entry.type)}</div>
      <div style={{ display: 'flex', gap: 4, justifyContent: 'flex-end' }}>
        <button type="button" style={SMALL_BTN}  onClick={onEdit}>Edit</button>
        <button type="button" style={DANGER_BTN} onClick={onDelete}>×</button>
      </div>
    </div>
  );
}

// Subscribes to AssetService for the entry's slug so the row badge re-renders
// when load status changes. Routes through the type-appropriate channel —
// image, model, or sound — so a broken GLTF or sound flags the warning badge
// the same way a broken image does.
function useAssetStatus(entry: AssetEntry): AssetStatus | null {
  const [status, setStatus] = useState<AssetStatus | null>(null);
  useEffect(() => {
    if (entry.type === 'image') {
      return assetService.subscribe(entry.slug, 'image', (_tex, s) => setStatus(s));
    }
    if (entry.type === 'model') {
      return assetService.subscribe(entry.slug, 'model', (_obj, s) => setStatus(s));
    }
    if (entry.type === 'spritesheet') {
      return assetService.subscribeSheet(entry.slug, (s) => setStatus(s));
    }
    return assetService.subscribe(entry.slug, 'sound', (_buf, s) => setStatus(s));
  }, [entry.slug, entry.type, entry.url]);
  return status;
}

function EditRow({ entry, store, onClose }: { entry: AssetEntry; store: ManifestStore; onClose: () => void }) {
  const [name,        setName]        = useState(entry.name);
  const [url,         setUrl]         = useState(entry.url);
  const [preload,     setPreload]     = useState(entry.preload);
  const [description, setDescription] = useState(entry.description ?? '');
  const [tags,        setTags]        = useState((entry.tags ?? []).join(', '));
  const [cols,        setCols]        = useState(entry.cols !== undefined ? String(entry.cols) : '');
  const [rows,        setRows]        = useState(entry.rows !== undefined ? String(entry.rows) : '');
  const [error,       setError]       = useState<string | null>(null);
  const preflight = useUrlPreflight(url, entry.url);
  const isSheet   = entry.type === 'spritesheet';

  const commit = () => {
    if (name.trim().length === 0) { setError('Name is required.'); return; }
    let colsNum: number | undefined;
    let rowsNum: number | undefined;
    if (isSheet) {
      colsNum = Number(cols);
      rowsNum = Number(rows);
      if (!Number.isInteger(colsNum) || colsNum < 1) { setError('Cols must be a positive integer.'); return; }
      if (!Number.isInteger(rowsNum) || rowsNum < 1) { setError('Rows must be a positive integer.'); return; }
    }
    try {
      store.editDraft((d) => d.update(entry.slug, {
        name:        name.trim(),
        url,
        preload,
        description: description.trim() || undefined,
        tags:        tags.split(',').map((t) => t.trim()).filter(Boolean),
        ...(isSheet ? { cols: colsNum, rows: rowsNum } : {}),
      }));
      // URL changed → drop the cached fetch so subscribed consumers
      // observe the new asset on next resolve. For sheets, invalidate
      // refires every sprite-ref subscriber too.
      if (url !== entry.url) assetService.invalidate(entry.slug);
      // Grid changed → refire sprite subscribers against new cols/rows.
      else if (isSheet && (colsNum !== entry.cols || rowsNum !== entry.rows)) {
        assetService.invalidate(entry.slug);
      }
      onClose();
    } catch (e) {
      setError((e as Error).message);
    }
  };

  return (
    <div style={{ ...ROW, gridTemplateColumns: '1fr', display: 'block' }}>
      <div style={FIELD_GRID}>
        <div style={FIELD_LABEL}>Slug</div>
        <div style={ROW_SLUG}>{entry.slug} (immutable)</div>
        <div style={FIELD_LABEL}>Name</div>
        <input style={INPUT} value={name} onChange={(e) => setName(e.target.value)} />
        <div style={FIELD_LABEL}>URL</div>
        <input style={INPUT} value={url} onChange={(e) => setUrl(e.target.value)} />
        <div style={FIELD_LABEL}>Description</div>
        <input style={INPUT} value={description} onChange={(e) => setDescription(e.target.value)} />
        <div style={FIELD_LABEL}>Tags (comma)</div>
        <input style={INPUT} value={tags} onChange={(e) => setTags(e.target.value)} />
        <div style={FIELD_LABEL}>Preload</div>
        <label style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <input type="checkbox" checked={preload} onChange={(e) => setPreload(e.target.checked)} />
          <span style={{ fontSize: 11, color: 'var(--ink-2)' }}>Fetch at session start</span>
        </label>
        {isSheet && <>
          <div style={FIELD_LABEL}>Cols</div>
          <input style={INPUT} type="number" min={1} step={1} value={cols} onChange={(e) => setCols(e.target.value)} />
          <div style={FIELD_LABEL}>Rows</div>
          <input style={INPUT} type="number" min={1} step={1} value={rows} onChange={(e) => setRows(e.target.value)} />
        </>}
      </div>
      <PreflightLine state={preflight} />
      {error && <div style={ERROR_LINE}>{error}</div>}
      <div style={{ display: 'flex', gap: 6, justifyContent: 'flex-end' }}>
        <button type="button" style={SMALL_BTN} onClick={onClose}>Cancel</button>
        <button type="button" style={SMALL_BTN} onClick={commit}>Save</button>
      </div>
    </div>
  );
}

function AddRow({ store }: { store: ManifestStore }) {
  const [url,     setUrl]     = useState('');
  const [slug,    setSlug]    = useState('');
  const [name,    setName]    = useState('');
  const [type,    setType]    = useState<AssetType>('image');
  const [preload, setPreload] = useState(true);
  const [cols,    setCols]    = useState('');
  const [rows,    setRows]    = useState('');
  const [error,   setError]   = useState<string | null>(null);
  const [staging, setStaging] = useState(false);
  const preflight = useUrlPreflight(url, '');
  const isSheet   = type === 'spritesheet';

  // Auto-suggest slug from URL filename when the user hasn't manually typed
  // one. Once the user edits the slug field, stop syncing.
  const [slugTouched, setSlugTouched] = useState(false);
  useEffect(() => {
    if (slugTouched) return;
    const suggested = suggestSlugFromUrl(url);
    setSlug(suggested);
    if (!name && url) setName(suggested.replace(/^custom:/, '').replace(/[-_]/g, ' '));
  }, [url, slugTouched]);

  const reset = () => {
    setUrl(''); setSlug(''); setName(''); setType('image');
    setPreload(true); setCols(''); setRows('');
    setError(null); setSlugTouched(false); setStaging(false);
  };

  const commit = () => {
    setError(null);
    if (!url.trim())      return setError('URL is required.');
    if (!name.trim())     return setError('Name is required.');
    const check = validateSlug(slug, 'custom');
    if (!check.ok)        return setError(check.error);
    let colsNum: number | undefined;
    let rowsNum: number | undefined;
    if (isSheet) {
      colsNum = Number(cols);
      rowsNum = Number(rows);
      if (!Number.isInteger(colsNum) || colsNum < 1) return setError('Cols must be a positive integer.');
      if (!Number.isInteger(rowsNum) || rowsNum < 1) return setError('Rows must be a positive integer.');
    }
    try {
      store.editDraft((d) => d.add({
        slug, name: name.trim(), type, url: url.trim(), preload,
        ...(isSheet ? { cols: colsNum, rows: rowsNum } : {}),
      }));
      reset();
    } catch (e) {
      setError((e as Error).message);
    }
  };

  if (!staging) {
    return (
      <div style={ADD_BAR}>
        <input
          style={{ ...INPUT, flex: 1 }}
          placeholder="Paste a URL to add an asset…"
          value={url}
          onChange={(e) => { setUrl(e.target.value); setStaging(e.target.value.length > 0); }}
        />
      </div>
    );
  }

  return (
    <div style={ADD_BAR}>
      <div style={{ flex: 1 }}>
        <div style={FIELD_GRID}>
          <div style={FIELD_LABEL}>URL</div>
          <input style={INPUT} value={url} onChange={(e) => setUrl(e.target.value)} />
          <div style={FIELD_LABEL}>Slug</div>
          <input
            style={INPUT}
            value={slug}
            onChange={(e) => { setSlug(e.target.value); setSlugTouched(true); }}
            placeholder="custom:my-asset"
          />
          <div style={FIELD_LABEL}>Name</div>
          <input style={INPUT} value={name} onChange={(e) => setName(e.target.value)} />
          <div style={FIELD_LABEL}>Type</div>
          <select
            style={{ ...INPUT, padding: '3px 6px' }}
            value={type}
            onChange={(e) => setType(e.target.value as AssetType)}
          >
            <option value="image">image</option>
            <option value="model">model</option>
            <option value="sound">sound</option>
            <option value="spritesheet">sprite</option>
          </select>
          <div style={FIELD_LABEL}>Preload</div>
          <label style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <input type="checkbox" checked={preload} onChange={(e) => setPreload(e.target.checked)} />
            <span style={{ fontSize: 11, color: 'var(--ink-2)' }}>Fetch at session start</span>
          </label>
          {isSheet && <>
            <div style={FIELD_LABEL}>Cols</div>
            <input style={INPUT} type="number" min={1} step={1} value={cols} onChange={(e) => setCols(e.target.value)} />
            <div style={FIELD_LABEL}>Rows</div>
            <input style={INPUT} type="number" min={1} step={1} value={rows} onChange={(e) => setRows(e.target.value)} />
          </>}
        </div>
        <PreflightLine state={preflight} />
        {error && <div style={ERROR_LINE}>{error}</div>}
        <div style={{ display: 'flex', gap: 6, justifyContent: 'flex-end' }}>
          <button type="button" style={SMALL_BTN} onClick={reset}>Cancel</button>
          <button
            type="button"
            style={SMALL_BTN}
            onClick={commit}
            title={preflight.kind === 'fail' ? 'Preflight failed — committing anyway. The asset may not load.' : ''}
          >
            {preflight.kind === 'fail' ? 'Add anyway' : 'Add'}
          </button>
        </div>
      </div>
    </div>
  );
}

type PreflightState =
  | { kind: 'idle' }
  | { kind: 'pending' }
  | { kind: 'ok' }
  | { kind: 'fail'; message: string };

// Debounced HEAD/GET probe for the URL field. Skips slugs and synthetic
// markers; cancels in-flight checks when the URL changes again.
function useUrlPreflight(url: string, lastConfirmedUrl: string): PreflightState {
  const [state, setState] = useState<PreflightState>({ kind: 'idle' });
  useEffect(() => {
    const trimmed = url.trim();
    if (!trimmed)                        { setState({ kind: 'idle' }); return; }
    if (trimmed === lastConfirmedUrl)    { setState({ kind: 'idle' }); return; }
    if (trimmed.startsWith('placeholder://') || trimmed.startsWith('primitive://')) {
      setState({ kind: 'idle' });
      return;
    }
    let cancelled = false;
    const timer = setTimeout(async () => {
      setState({ kind: 'pending' });
      let res: ProbeResult;
      try {
        res = await probe(trimmed);
      } catch {
        if (cancelled) return;
        setState({ kind: 'fail', message: 'Probe threw unexpectedly.' });
        return;
      }
      if (cancelled) return;
      if (res.ok) setState({ kind: 'ok' });
      else        setState({ kind: 'fail', message: describeError(res.error) });
    }, 350);
    return () => { cancelled = true; clearTimeout(timer); };
  }, [url, lastConfirmedUrl]);
  return state;
}

function describeError(error: { kind: string; message: string; status?: number }): string {
  switch (error.kind) {
    case 'http':    return `HTTP ${error.status ?? '?'} — ${error.message}`;
    case 'cors':    return `CORS blocked — ${error.message}`;
    case 'network': return `Network error or CORS blocked — ${error.message}`;
    case 'invalid': return error.message;
    default:        return error.message;
  }
}

function PreflightLine({ state }: { state: PreflightState }) {
  if (state.kind === 'idle')    return null;
  if (state.kind === 'pending') return <div style={PREFLIGHT_PENDING}>Checking URL…</div>;
  if (state.kind === 'ok')      return <div style={PREFLIGHT_OK}>✓ URL reachable.</div>;
  return <div style={PREFLIGHT_WARN}>⚠ {state.message}</div>;
}

function Footer({ store, onPush }: { store: ManifestStore | null; onPush: () => void }) {
  const count = useSyncExternalStore(
    (cb) => store?.subscribe(cb) ?? (() => {}),
    () => store?.unpushedCount() ?? 0,
  );
  const disabled = count === 0;
  return (
    <div style={FOOTER}>
      <span style={{ color: count > 0 ? 'var(--gold)' : 'var(--ink-mute)' }}>
        {count === 0 ? 'No unpushed changes.' : `${count} unpushed change${count === 1 ? '' : 's'}.`}
      </span>
      <button
        type="button"
        style={disabled ? PUSH_BTN_DISABLED : PUSH_BTN}
        disabled={disabled}
        onClick={onPush}
      >
        Push to peers
      </button>
    </div>
  );
}

function suggestSlugFromUrl(url: string): string {
  if (!url) return '';
  // Take the last path segment, drop the extension, sanitise.
  let tail = url.split('?')[0].split('#')[0];
  tail = tail.substring(tail.lastIndexOf('/') + 1);
  tail = tail.substring(0, tail.lastIndexOf('.') >= 0 ? tail.lastIndexOf('.') : tail.length);
  const sanitised = tail.toLowerCase().replace(/[^a-z0-9_-]/g, '-').replace(/^-+|-+$/g, '');
  if (!sanitised) return '';
  return `custom:${sanitised}`;
}
