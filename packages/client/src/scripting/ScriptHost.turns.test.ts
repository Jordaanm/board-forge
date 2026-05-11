// Behavioural tests for the ScriptHost <-> TurnsBridge integration: the
// turn-end gating contract that scripts override `onTurnEndRequested` to
// short-circuit, and the dispatch of turn events into Game hooks.

import { describe, test, expect } from 'vitest';
import { ScriptHost } from './ScriptHost';
import { type TurnAction, type TurnState } from '../seats/TurnTracker';

interface RecordingConsole {
  log:   (...a: unknown[]) => void;
  error: (...a: unknown[]) => void;
  warn:  (...a: unknown[]) => void;
  info:  (...a: unknown[]) => void;
  debug: (...a: unknown[]) => void;
  logs:  string[];
}

function recordingConsole(): RecordingConsole {
  const logs: string[] = [];
  const noop = () => {};
  return {
    log:   (...a) => logs.push(a.map(String).join(' ')),
    error: noop, warn: noop, info: noop, debug: noop,
    logs,
  };
}

class FakeBridge {
  state: TurnState = {
    enabled:    true,
    order:      [0, 1] as never,
    activeSeat: 0 as never,
    turnNumber: 1,
    orderIndex: 0,
  };
  actions: TurnAction[] = [];
  dispatch(a: TurnAction): void { this.actions.push(a); }
  getState(): TurnState { return this.state; }
}

class StubScene {
  private m = new Map<string, unknown>();
  add(): void {}
  all(): unknown[] { return []; }
  getEntity(): undefined { return undefined; }
  has(): boolean { return false; }
}

describe('ScriptHost — turn hooks', () => {
  test('default onTurnEndRequested: engine bypasses hook and preserves endedBy', async () => {
    const c = recordingConsole();
    const bridge = new FakeBridge();
    const host = new ScriptHost({
      console: c,
      scene:   new StubScene() as never,
      turns:   bridge,
    });
    const result = await host.runScript('export default class extends Game {}');
    expect(result.ok).toBe(true);
    host.dispatchEndTurnRequest(0 as never, 'player');
    host.dispatchEndTurnRequest(0 as never, 'host');
    expect(bridge.actions).toEqual([
      { kind: 'next', endedBy: 'player' },
      { kind: 'next', endedBy: 'host' },
    ]);
  });

  test('override that returns without calling next() stops the advance', async () => {
    const c = recordingConsole();
    const bridge = new FakeBridge();
    const host = new ScriptHost({
      console: c,
      scene:   new StubScene() as never,
      turns:   bridge,
    });
    await host.runScript(`
      export default class extends Game {
        onTurnEndRequested(seat) {
          console.log('ignored ' + seat);
        }
      }
    `);
    host.dispatchEndTurnRequest(0 as never, 'player');
    expect(bridge.actions).toEqual([]);
    expect(c.logs).toContain('ignored 0');
  });

  test('dispatchTurnEvent fans out to onTurnStart and onTurnEnd', async () => {
    const c = recordingConsole();
    const host = new ScriptHost({
      console: c,
      scene:   new StubScene() as never,
      turns:   new FakeBridge(),
    });
    await host.runScript(`
      export default class extends Game {
        onTurnStart(seat, n) { console.log('start ' + seat + '/' + n); }
        onTurnEnd(seat, n, endedBy) { console.log('end ' + seat + '/' + n + '/' + endedBy); }
      }
    `);
    host.dispatchTurnEvent({ kind: 'turn-start', seat: 2 as never, turnNumber: 1 });
    host.dispatchTurnEvent({ kind: 'turn-end',   seat: 2 as never, turnNumber: 1, endedBy: 'player' });
    expect(c.logs).toContain('start 2/1');
    expect(c.logs).toContain('end 2/1/player');
  });

  test('scene.turns reads return mirrored bridge state', async () => {
    const c = recordingConsole();
    const bridge = new FakeBridge();
    const host = new ScriptHost({
      console: c,
      scene:   new StubScene() as never,
      turns:   bridge,
    });
    await host.runScript(`
      export default class extends Game {
        onSceneInitialised(scene) {
          console.log('enabled=' + scene.turns.isEnabled());
          console.log('active=' + scene.turns.getActive());
          console.log('turnN=' + scene.turns.getTurnNumber());
          console.log('order=' + scene.turns.getOrder().join(','));
        }
      }
    `);
    expect(c.logs).toContain('enabled=true');
    expect(c.logs).toContain('active=0');
    expect(c.logs).toContain('turnN=1');
    expect(c.logs).toContain('order=0,1');
  });

  test('with no script instantiated, end-turn-request still advances through the bridge', () => {
    const bridge = new FakeBridge();
    const host = new ScriptHost({
      console: recordingConsole(),
      scene:   new StubScene() as never,
      turns:   bridge,
    });
    host.dispatchEndTurnRequest(0 as never, 'player');
    expect(bridge.actions).toEqual([
      { kind: 'next', endedBy: 'player' },
    ]);
  });

  test('override that calls scene.turns.next() advances with endedBy=script', async () => {
    const bridge = new FakeBridge();
    const host = new ScriptHost({
      console: recordingConsole(),
      scene:   new StubScene() as never,
      turns:   bridge,
    });
    await host.runScript(`
      export default class extends Game {
        onTurnEndRequested(seat) { this.scene.turns.next(); }
      }
    `);
    host.dispatchEndTurnRequest(0 as never, 'player');
    expect(bridge.actions).toEqual([
      { kind: 'next', endedBy: 'script' },
    ]);
  });
});
