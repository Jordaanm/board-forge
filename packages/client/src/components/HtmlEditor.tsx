// Monaco-based HTML editor lazy-loaded by HtmlEditorModal. Sister to
// ScriptEditor.tsx — but for HTML rather than TypeScript, and with no
// extra-libs (Satori's HTML subset isn't expressible as a `lib.d.ts`).
// The module-load-time worker setup is idempotent with ScriptEditor's
// (both check `self.MonacoEnvironment` before assigning).

import { useRef } from 'react';
import Editor, { type OnMount, loader } from '@monaco-editor/react';
import editorWorker from 'monaco-editor/esm/vs/editor/editor.worker?worker';
import htmlWorker from 'monaco-editor/esm/vs/language/html/html.worker?worker';
import * as monaco from 'monaco-editor';

if (typeof self !== 'undefined' && !self.MonacoEnvironment) {
  self.MonacoEnvironment = {
    getWorker(_workerId: string, label: string): Worker {
      if (label === 'html' || label === 'handlebars' || label === 'razor') return new htmlWorker();
      return new editorWorker();
    },
  };
}

loader.config({ monaco });

interface Props {
  source:   string;
  onChange: (next: string) => void;
  onSave:   () => void;
}

const WRAPPER: React.CSSProperties = {
  flex:         '1 1 auto',
  minHeight:    260,
  border:       '1px solid rgba(255,255,255,0.2)',
  borderRadius: 3,
  overflow:     'hidden',
  background:   '#1e1e1e',
};

const MODEL_PATH = 'rich-element.html';

export default function HtmlEditor({ source, onChange, onSave }: Props) {
  const onSaveRef = useRef(onSave);
  onSaveRef.current = onSave;

  const handleMount: OnMount = (editor, m) => {
    editor.addCommand(m.KeyMod.CtrlCmd | m.KeyCode.KeyS, () => {
      onSaveRef.current();
    });
  };

  return (
    <div style={WRAPPER}>
      <Editor
        height="100%"
        defaultLanguage="html"
        path={MODEL_PATH}
        theme="vs-dark"
        value={source}
        onChange={(v) => onChange(v ?? '')}
        onMount={handleMount}
        options={{
          minimap:              { enabled: false },
          fontSize:             13,
          scrollBeyondLastLine: false,
          tabSize:              2,
          automaticLayout:      true,
          wordWrap:             'on',
        }}
      />
    </div>
  );
}
