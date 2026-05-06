// Wraps `ts.transpileModule` with a tiny Result type. The TypeScript package
// is dynamic-imported on first compile so the ~3 MB doesn't land in the main
// bundle (PRD § Compilation).

export type CompileResult =
  | { ok: true;  js: string }
  | { ok: false; error: string };

let tsModulePromise: Promise<typeof import('typescript')> | null = null;

function loadTypescript(): Promise<typeof import('typescript')> {
  if (!tsModulePromise) tsModulePromise = import('typescript');
  return tsModulePromise;
}

export async function compileTypescript(source: string): Promise<CompileResult> {
  const ts = await loadTypescript();
  try {
    const out = ts.transpileModule(source, {
      compilerOptions: {
        target:           ts.ScriptTarget.ES2022,
        // CommonJS-style emission lets the Sandbox evaluate the compiled
        // output as a script (Compartment#evaluate) and read the default
        // export off a synthetic `exports` global. SES's ModuleSource
        // pipeline is unavailable in plain Node/Vite without an ECMA-262
        // ModuleSource intrinsic, so we route around it.
        module:           ts.ModuleKind.CommonJS,
        isolatedModules:  true,
      },
      reportDiagnostics: true,
    });

    const diags = out.diagnostics ?? [];
    if (diags.length > 0) {
      return { ok: false, error: formatDiagnostics(ts, diags) };
    }
    return { ok: true, js: out.outputText };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

function formatDiagnostics(
  ts: typeof import('typescript'),
  diags: readonly import('typescript').Diagnostic[],
): string {
  return diags
    .map(d => ts.flattenDiagnosticMessageText(d.messageText, '\n'))
    .join('\n');
}

// Test seam: clear the cached promise so a fresh dynamic import can be observed.
export function __resetCompilerForTests(): void {
  tsModulePromise = null;
}
