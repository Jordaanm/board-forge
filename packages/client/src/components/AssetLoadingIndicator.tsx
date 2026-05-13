// Small non-blocking HUD strip that shows how many assets are still loading.
// Issue #7 of issues--asset-registry.md.
//
// Subscribes to AssetService.subscribeProgress and renders only while there
// is at least one pending fetch. Anchored into the bottom-left corner via
// AnchorLayout so it stays out of the way and never blocks gameplay input.

import { useSyncExternalStore } from 'react';
import { assetService } from '../assets/AssetService';

const STRIP: React.CSSProperties = {
  background:   'var(--surface)',
  border:       '1px solid var(--line)',
  borderRadius: 'var(--card-radius)',
  color:        'var(--ink)',
  fontFamily:   'var(--font-sans)',
  fontSize:     12,
  padding:      '6px 10px',
  display:      'flex',
  alignItems:   'center',
  gap:          8,
  boxShadow:    'var(--shadow)',
};

const SPINNER: React.CSSProperties = {
  width:        12,
  height:       12,
  borderRadius: '50%',
  border:       '2px solid var(--line-strong)',
  borderTopColor: 'var(--accent)',
  animation:    'asset-loading-spin 0.8s linear infinite',
};

export function AssetLoadingIndicator() {
  const pending = useSyncExternalStore(
    (cb) => assetService.subscribeProgress(cb),
    () => assetService.pendingCount(),
    () => 0,
  );
  if (pending <= 0) return null;
  return (
    <div style={STRIP}>
      <style>{`@keyframes asset-loading-spin { to { transform: rotate(360deg); } }`}</style>
      <span style={SPINNER} />
      <span>Loading {pending} asset{pending === 1 ? '' : 's'}…</span>
    </div>
  );
}
