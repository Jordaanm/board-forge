import { useState } from 'react';
import { PreferencesModal } from './PreferencesModal';

const BTN: React.CSSProperties = {
  display:        'inline-flex',
  alignItems:     'center',
  justifyContent: 'center',
  width:          32,
  height:         32,
  background:     'rgba(20,20,32,0.92)',
  border:         '1px solid rgba(255,255,255,0.2)',
  color:          '#e8e8e8',
  borderRadius:   16,
  cursor:         'pointer',
  padding:        0,
  boxShadow:      '0 4px 20px rgba(0,0,0,0.5)',
};

export function PreferencesTrigger() {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button
        type="button"
        style={BTN}
        aria-label="Preferences"
        title="Preferences"
        onClick={() => setOpen(true)}
      >
        <GearIcon />
      </button>
      <PreferencesModal open={open} onOpenChange={setOpen} />
    </>
  );
}

function GearIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <circle cx="12" cy="12" r="3" />
      <path d="M19.4 15a1.7 1.7 0 0 0 .34 1.87l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.7 1.7 0 0 0-1.87-.34 1.7 1.7 0 0 0-1.03 1.56V21a2 2 0 1 1-4 0v-.09A1.7 1.7 0 0 0 9 19.4a1.7 1.7 0 0 0-1.87.34l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06A1.7 1.7 0 0 0 4.6 15a1.7 1.7 0 0 0-1.56-1.03H3a2 2 0 1 1 0-4h.09A1.7 1.7 0 0 0 4.6 9a1.7 1.7 0 0 0-.34-1.87l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06A1.7 1.7 0 0 0 9 4.6h0A1.7 1.7 0 0 0 10.03 3.04V3a2 2 0 1 1 4 0v.09A1.7 1.7 0 0 0 15 4.6h0a1.7 1.7 0 0 0 1.87-.34l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06A1.7 1.7 0 0 0 19.4 9h0a1.7 1.7 0 0 0 1.56 1.03H21a2 2 0 1 1 0 4h-.09A1.7 1.7 0 0 0 19.4 15Z" />
    </svg>
  );
}
