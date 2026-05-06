// Monaco-based script editor (PR2). Lazy-loaded by ScriptEditorModal so
// the ~3MB worker bundles stay out of the initial Room render. Default
// export so React.lazy(() => import('./ScriptEditor')) works directly.
//
// Compiler options mirror packages/client/src/scripting/Compiler.ts so the
// editor's TS language service matches what the runtime actually accepts:
// target ES2022, CommonJS, isolatedModules. `strict: false` matches the
// runtime's permissive feel — Monaco's full type-check is strictly more
// thorough than transpileModule, so we don't pile on stricter rules. The
// `lib` is ES-only (no DOM) since user scripts run inside a SES
// Compartment without window/document.

import Editor, { type BeforeMount, loader } from '@monaco-editor/react';
import editorWorker from 'monaco-editor/esm/vs/editor/editor.worker?worker';
import tsWorker from 'monaco-editor/esm/vs/language/typescript/ts.worker?worker';
import * as monaco from 'monaco-editor';
import scriptGlobalsDts from '../scripting/script-globals.dts?raw';

// Worker selection runs at module load (this module is the lazy entry, so
// initialisation cost lives in the lazy chunk too). Editor uses base
// editor.worker; TypeScript/JavaScript uses ts.worker for the language
// service (autocomplete, hover, diagnostics).
if (typeof self !== 'undefined' && !self.MonacoEnvironment) {
  self.MonacoEnvironment = {
    getWorker(_workerId: string, label: string): Worker {
      if (label === 'typescript' || label === 'javascript') return new tsWorker();
      return new editorWorker();
    },
  };
}

// Tell @monaco-editor/react to use the locally-bundled monaco instead of
// loading from a CDN. Required for offline/air-gapped operation and to
// avoid version skew between the CDN copy and our compiled workers.
loader.config({ monaco });

// Expose the monaco namespace on window so e2e tests (and any debug UI)
// can call into the editor instance without an extra ref. Side-effect-only:
// nothing in the app reads `window.monaco`. Harmless: the namespace is
// already loaded in the realm by the import above.
if (typeof window !== 'undefined') {
  (window as unknown as { monaco?: typeof monaco }).monaco = monaco;
}

// One-time TS-service compiler options + extra-lib registration. The
// `beforeMount` callback gets a `monaco` value with the typescript
// language service typed correctly (the top-level `monaco-editor` module's
// published types deprecated the namespace path that worked in older
// versions).
let configured = false;
const configureTypeScriptDefaults: BeforeMount = (m) => {
  if (configured) return;
  configured = true;
  m.languages.typescript.typescriptDefaults.setCompilerOptions({
    target:               m.languages.typescript.ScriptTarget.ES2022,
    module:               m.languages.typescript.ModuleKind.CommonJS,
    isolatedModules:      true,
    strict:               false,
    allowNonTsExtensions: true,
    moduleResolution:     m.languages.typescript.ModuleResolutionKind.NodeJs,
    lib:                  ['es2022'],
  });
  // The `.dts` artifact is loaded as a raw string via Vite's `?raw`
  // suffix and registered as an extra-lib. URI is distinct from the
  // model URI so resolution doesn't conflict with the user-script model.
  m.languages.typescript.typescriptDefaults.addExtraLib(
    scriptGlobalsDts,
    'file:///script-globals.d.ts',
  );
};

interface Props {
  source:   string;
  onChange: (next: string) => void;
}

// `resize: vertical` paints a drag handle at the bottom-right corner. CSS
// requires `overflow: !visible` for the handle to render. The Editor
// component runs `editor.layout()` via `automaticLayout: true` (set in
// the Editor options below) so Monaco recomputes its viewport when the
// wrapper resizes.
const WRAPPER: React.CSSProperties = {
  flex:         '1 1 auto',
  minHeight:    220,
  border:       '1px solid rgba(255,255,255,0.2)',
  borderRadius: 3,
  overflow:     'hidden',
  background:   '#1e1e1e',
  resize:       'vertical',
};

// Stable URI lets @monaco-editor/react reuse the model across mounts so
// cursor + undo history survive closing and reopening the modal.
const MODEL_PATH = 'user-script.ts';

export default function ScriptEditor({ source, onChange }: Props) {
  return (
    <div style={WRAPPER}>
      <Editor
        height="100%"
        defaultLanguage="typescript"
        path={MODEL_PATH}
        theme="vs-dark"
        value={source}
        onChange={(v) => onChange(v ?? '')}
        beforeMount={configureTypeScriptDefaults}
        options={{
          minimap:              { enabled: false },
          fontSize:             13,
          scrollBeyondLastLine: false,
          tabSize:              2,
          automaticLayout:      true,
        }}
      />
    </div>
  );
}
