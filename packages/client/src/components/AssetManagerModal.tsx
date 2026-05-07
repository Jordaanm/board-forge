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

import { useEffect, useMemo, useState, useSyncExternalStore } from 'react';
import * as Dialog from '@radix-ui/react-dialog';
import { useAnchorTarget } from './AnchorLayout';
import { type ManifestStore } from '../assets/ManifestStore';
import { type AssetEntry, type AssetType, validateSlug } from '../assets/Manifest';
import { BASE_MANIFEST, PRIMITIVE_MANIFEST } from '../assets/baseManifest';

interface Props {
  store:  ManifestStore | null;
  onPush: () => void;
}

type TabId = 'primitives' | 'base' | 'custom';

const TRIGGER_BTN: React.CSSProperties = {
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

const OVERLAY: React.CSSProperties = {
  position:   'fixed',
  inset:      0,
  background: 'rgba(0,0,0,0.55)',
  zIndex:     200,
};

const CONTENT: React.CSSProperties = {
  width:         640,
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
  background:    'none',
  border:        'none',
  color:         '#bdbdc0',
  padding:       '8px 14px',
  cursor:        'pointer',
  fontSize:      12,
  borderBottom:  '2px solid transparent',
};

const TAB_BTN_ACTIVE: React.CSSProperties = {
  ...TAB_BTN,
  color:        '#e8e8e8',
  fontWeight:   600,
  borderBottom: '2px solid rgba(120,180,240,0.6)',
};

const BODY: React.CSSProperties = {
  flex:          1,
  overflowY:     'auto',
  padding:       '8px 12px',
};

const ROW: React.CSSProperties = {
  display:      'grid',
  gridTemplateColumns: '1fr 70px 60px',
  alignItems:   'center',
  gap:          8,
  padding:      '6px 8px',
  borderRadius: 4,
  border:       '1px solid rgba(255,255,255,0.06)',
  marginBottom: 4,
};

const ROW_LABEL: React.CSSProperties = { display: 'flex', flexDirection: 'column', gap: 2, minWidth: 0 };
const ROW_NAME:  React.CSSProperties = { fontWeight: 500, whiteSpace: 'nowrap', textOverflow: 'ellipsis', overflow: 'hidden' };
const ROW_SLUG:  React.CSSProperties = { fontSize: 11, color: '#888', whiteSpace: 'nowrap', textOverflow: 'ellipsis', overflow: 'hidden' };
const ROW_TYPE:  React.CSSProperties = { fontSize: 11, color: '#bdbdc0', textTransform: 'uppercase', letterSpacing: 0.5 };

const FOOTER: React.CSSProperties = {
  display:        'flex',
  alignItems:     'center',
  justifyContent: 'space-between',
  padding:        '10px 16px',
  borderTop:      '1px solid rgba(255,255,255,0.1)',
  fontSize:       12,
};

const PUSH_BTN: React.CSSProperties = {
  background:   'rgba(70,130,200,0.4)',
  border:       '1px solid rgba(120,180,240,0.45)',
  color:        '#e8e8e8',
  padding:      '6px 12px',
  borderRadius: 4,
  cursor:       'pointer',
  fontSize:     12,
};

const PUSH_BTN_DISABLED: React.CSSProperties = {
  ...PUSH_BTN,
  opacity: 0.4,
  cursor:  'not-allowed',
};

const SMALL_BTN: React.CSSProperties = {
  background:   'rgba(255,255,255,0.08)',
  border:       '1px solid rgba(255,255,255,0.18)',
  color:        '#e8e8e8',
  padding:      '4px 8px',
  borderRadius: 3,
  cursor:       'pointer',
  fontSize:     11,
};

const DANGER_BTN: React.CSSProperties = {
  ...SMALL_BTN,
  background: 'rgba(220,80,80,0.18)',
  border:     '1px solid rgba(220,80,80,0.4)',
  color:      '#ffd0d0',
};

const ADD_BAR: React.CSSProperties = {
  display:        'flex',
  alignItems:     'center',
  gap:            6,
  margin:         '8px 0',
  padding:        '8px',
  border:         '1px dashed rgba(255,255,255,0.18)',
  borderRadius:   4,
};

const INPUT: React.CSSProperties = {
  background:   'rgba(0,0,0,0.4)',
  border:       '1px solid rgba(255,255,255,0.18)',
  color:        '#e8e8e8',
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
  color:    '#888',
};

const ERROR_LINE: React.CSSProperties = {
  color:    '#ffb0b0',
  fontSize: 11,
  margin:   '4px 0',
};

export function AssetManagerModal({ store, onPush }: Props) {
  const centerAnchor    = useAnchorTarget('center');
  const [open, setOpen] = useState(false);
  const [tab, setTab]   = useState<TabId>('custom');

  return (
    <>
      <button type="button" style={TRIGGER_BTN} onClick={() => setOpen(true)} disabled={!store}>
        Assets
      </button>
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
    return <div style={{ color: '#666', fontSize: 12, padding: 16 }}>Empty.</div>;
  }
  return (
    <>
      {entries.map((e) => (
        <div key={e.slug} style={ROW}>
          <div style={ROW_LABEL}>
            <div style={ROW_NAME}>{e.name}</div>
            <div style={ROW_SLUG}>{e.slug}</div>
          </div>
          <div style={ROW_TYPE}>{e.type}</div>
          <div />
        </div>
      ))}
    </>
  );
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
        <div style={{ color: '#666', fontSize: 12, padding: '12px 4px' }}>
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
  return (
    <div style={ROW}>
      <div style={ROW_LABEL}>
        <div style={ROW_NAME}>{entry.name}</div>
        <div style={ROW_SLUG}>{entry.slug}{entry.preload ? ' · preload' : ''}</div>
      </div>
      <div style={ROW_TYPE}>{entry.type}</div>
      <div style={{ display: 'flex', gap: 4, justifyContent: 'flex-end' }}>
        <button type="button" style={SMALL_BTN}  onClick={onEdit}>Edit</button>
        <button type="button" style={DANGER_BTN} onClick={onDelete}>×</button>
      </div>
    </div>
  );
}

function EditRow({ entry, store, onClose }: { entry: AssetEntry; store: ManifestStore; onClose: () => void }) {
  const [name,        setName]        = useState(entry.name);
  const [url,         setUrl]         = useState(entry.url);
  const [preload,     setPreload]     = useState(entry.preload);
  const [description, setDescription] = useState(entry.description ?? '');
  const [tags,        setTags]        = useState((entry.tags ?? []).join(', '));
  const [error,       setError]       = useState<string | null>(null);

  const commit = () => {
    if (name.trim().length === 0) { setError('Name is required.'); return; }
    try {
      store.editDraft((d) => d.update(entry.slug, {
        name:        name.trim(),
        url,
        preload,
        description: description.trim() || undefined,
        tags:        tags.split(',').map((t) => t.trim()).filter(Boolean),
      }));
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
          <span style={{ fontSize: 11, color: '#bdbdc0' }}>Fetch at session start</span>
        </label>
      </div>
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
  const [error,   setError]   = useState<string | null>(null);
  const [staging, setStaging] = useState(false);

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
    setPreload(true); setError(null); setSlugTouched(false); setStaging(false);
  };

  const commit = () => {
    setError(null);
    if (!url.trim())      return setError('URL is required.');
    if (!name.trim())     return setError('Name is required.');
    const check = validateSlug(slug, 'custom');
    if (!check.ok)        return setError(check.error);
    try {
      store.editDraft((d) => d.add({
        slug, name: name.trim(), type, url: url.trim(), preload,
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
          </select>
          <div style={FIELD_LABEL}>Preload</div>
          <label style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <input type="checkbox" checked={preload} onChange={(e) => setPreload(e.target.checked)} />
            <span style={{ fontSize: 11, color: '#bdbdc0' }}>Fetch at session start</span>
          </label>
        </div>
        {error && <div style={ERROR_LINE}>{error}</div>}
        <div style={{ display: 'flex', gap: 6, justifyContent: 'flex-end' }}>
          <button type="button" style={SMALL_BTN} onClick={reset}>Cancel</button>
          <button type="button" style={SMALL_BTN} onClick={commit}>Add</button>
        </div>
      </div>
    </div>
  );
}

function Footer({ store, onPush }: { store: ManifestStore | null; onPush: () => void }) {
  const count = useSyncExternalStore(
    (cb) => store?.subscribe(cb) ?? (() => {}),
    () => store?.unpushedCount() ?? 0,
  );
  const disabled = count === 0;
  return (
    <div style={FOOTER}>
      <span style={{ color: count > 0 ? '#ffd07a' : '#888' }}>
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
