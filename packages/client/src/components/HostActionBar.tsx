// Top-center action bar visible only to the host. Day-one contents: a single
// "Spawn Object" trigger. Pattern accommodates future host actions (Reset
// Scene, Save Layout, etc.) without rearchitecting.

import { useState } from 'react';
import { SpawnObjectModal } from './SpawnObjectModal';
import { LoadSceneModal } from './LoadSceneModal';
import { RevertConfirmModal } from './RevertConfirmModal';
import { HistoryModal } from './HistoryModal';
import { ScriptEditorModal } from './ScriptEditorModal';
import { type SaveEnvelope } from '../entity/SaveFile';
import { type LastLoaded, type SceneHistoryService } from '../entity/SceneHistoryService';
import { type RunResult } from '../scripting/ScriptHost';
import { type ScriptErrorLog } from '../scripting/ScriptErrorLog';

interface Props {
  onSpawn:              (type: string) => void;
  showAllZones:         boolean;
  onToggleShowAllZones: (on: boolean) => void;
  onSave:               () => void;
  onLoad:               (envelope: SaveEnvelope, filename: string) => void;
  onRevert:             () => void;
  lastLoaded:           LastLoaded | null;
  currentEntityCount:   number;
  historyService:       SceneHistoryService | null;
  scriptSource:         string;
  onScriptChange:       (next: string) => void;
  onScriptSave:         () => void;
  onScriptRun:          (source: string) => Promise<RunResult>;
  scriptErrorLog:       ScriptErrorLog | null;
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

const BUTTON: React.CSSProperties = {
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

const BUTTON_DISABLED: React.CSSProperties = {
  ...BUTTON,
  opacity: 0.45,
  cursor:  'not-allowed',
};

const FILE_LABEL: React.CSSProperties = {
  display:    'inline-flex',
  alignItems: 'center',
  gap:        4,
  marginLeft: 4,
  color:      '#bdbdc0',
  fontFamily: 'sans-serif',
  fontSize:   11,
  userSelect: 'none',
};

const FILE_NAME: React.CSSProperties = {
  color:    '#e8e8e8',
  fontWeight: 600,
};

const FILE_TIMESTAMP: React.CSSProperties = {
  color: '#888',
};

export function HostActionBar({
  onSpawn,
  showAllZones,
  onToggleShowAllZones,
  onSave,
  onLoad,
  onRevert,
  lastLoaded,
  currentEntityCount,
  historyService,
  scriptSource,
  onScriptChange,
  onScriptSave,
  onScriptRun,
  scriptErrorLog,
}: Props) {
  const [revertOpen, setRevertOpen] = useState(false);
  const canRevert = lastLoaded !== null;

  return (
    <div style={BAR}>
      <SpawnObjectModal onSpawn={onSpawn} />
      <button type="button" style={BUTTON} onClick={onSave}>Save</button>
      <LoadSceneModal currentEntityCount={currentEntityCount} onConfirmLoad={onLoad} />
      <button
        type="button"
        style={canRevert ? BUTTON : BUTTON_DISABLED}
        onClick={() => canRevert && setRevertOpen(true)}
        disabled={!canRevert}
      >
        Revert
      </button>
      <HistoryModal service={historyService} />
      <ScriptEditorModal
        source={scriptSource}
        onChange={onScriptChange}
        onSave={onScriptSave}
        onRun={onScriptRun}
        errorLog={scriptErrorLog}
      />
      {lastLoaded && (
        <span style={FILE_LABEL}>
          <span style={FILE_NAME}>{lastLoaded.filename}</span>
          <span style={FILE_TIMESTAMP}>{formatLoadedAt(lastLoaded.savedAt)}</span>
        </span>
      )}
      <label style={TOGGLE}>
        <input
          type="checkbox"
          checked={showAllZones}
          onChange={e => onToggleShowAllZones(e.target.checked)}
        />
        Show All Zones
      </label>
      <RevertConfirmModal
        open={revertOpen}
        filename={lastLoaded?.filename ?? ''}
        onCancel={() => setRevertOpen(false)}
        onConfirm={() => { setRevertOpen(false); onRevert(); }}
      />
    </div>
  );
}

function formatLoadedAt(iso: string): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (isNaN(d.getTime())) return iso;
  return d.toLocaleString();
}
