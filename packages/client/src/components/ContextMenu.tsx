import { useState } from 'react';
import { type ContextMenuRequest } from '../input/ContextMenuController';
import { type MenuItem } from '../entity/EntityComponent';

interface Props {
  menu:      ContextMenuRequest;
  onAction:  (item: MenuItem & { kind: 'action' }, args: object | undefined) => void;
  onDismiss: () => void;
}

const ITEM: React.CSSProperties = {
  display: 'block', width: '100%', padding: '8px 16px',
  background: 'none', border: 'none', cursor: 'pointer',
  textAlign: 'left', fontSize: 13, fontFamily: 'sans-serif',
};

const HEADER: React.CSSProperties = {
  padding: '8px 16px',
  borderBottom: '1px solid rgba(255,255,255,0.1)',
  userSelect: 'none',
  fontFamily: 'sans-serif',
};

const SEPARATOR: React.CSSProperties = {
  height: 1, margin: '4px 0', background: 'rgba(255,255,255,0.1)',
};

const HEADING_STYLE: React.CSSProperties = {
  padding: '6px 16px', fontSize: 11, color: '#888',
  textTransform: 'uppercase', letterSpacing: 1,
  fontFamily: 'sans-serif', userSelect: 'none',
};

export function ContextMenu({ menu, onAction, onDismiss }: Props) {
  return (
    <>
      <div
        style={{ position: 'fixed', inset: 0, zIndex: 200 }}
        onClick={onDismiss}
        onContextMenu={(e) => { e.preventDefault(); onDismiss(); }}
      />
      <div
        role="menu"
        style={{
          position: 'fixed', left: menu.x, top: menu.y, zIndex: 201,
          background: '#1e1e2e', border: '1px solid rgba(255,255,255,0.15)',
          borderRadius: 6, padding: '4px 0', minWidth: 160,
          boxShadow: '0 4px 20px rgba(0,0,0,0.6)',
        }}
      >
        <div style={HEADER}>
          <div style={{ color: '#e8e8e8', fontSize: 13, fontWeight: 600 }}>
            {menu.entityName}
          </div>
          <div style={{ color: '#888', fontSize: 11, fontFamily: 'monospace' }}>
            {menu.entityId}
          </div>
        </div>
        <MenuList
          items={menu.items}
          onAction={(item, args) => { onAction(item, args); onDismiss(); }}
        />
      </div>
    </>
  );
}

function MenuList({
  items, onAction,
}: {
  items: MenuItem[];
  onAction: (item: MenuItem & { kind: 'action' }, args: object | undefined) => void;
}) {
  return (
    <>
      {items.map((item, i) => {
        if (item.kind === 'separator') return <div key={`sep-${i}`} style={SEPARATOR} />;
        if (item.kind === 'heading')   return <div key={`hd-${i}`}  style={HEADING_STYLE}>{item.label}</div>;
        if (item.kind === 'action')    return <ActionRow key={`act-${item.id}-${i}`} item={item} onAction={onAction} />;
        if (item.kind === 'submenu')   return <SubmenuRow key={`sub-${item.label}-${i}`} item={item} onAction={onAction} />;
        return null;
      })}
    </>
  );
}

function ActionRow({
  item, onAction,
}: {
  item: MenuItem & { kind: 'action' };
  onAction: (item: MenuItem & { kind: 'action' }, args: object | undefined) => void;
}) {
  const isDestructive = item.id === '__delete';
  return (
    <button
      role="menuitem"
      disabled={item.disabled}
      style={{
        ...ITEM,
        color: isDestructive ? '#f47c7c' : '#e8e8e8',
        opacity: item.disabled ? 0.5 : 1,
        cursor: item.disabled ? 'default' : 'pointer',
      }}
      onClick={() => {
        if (item.disabled) return;
        const args = maybePromptForCount(item);
        if (args === SKIP_ACTION) return;
        onAction(item, args);
      }}
      onMouseEnter={e => (e.currentTarget.style.background = 'rgba(255,255,255,0.08)')}
      onMouseLeave={e => (e.currentTarget.style.background = 'none')}
    >
      {item.label}
    </button>
  );
}

function SubmenuRow({
  item, onAction,
}: {
  item: MenuItem & { kind: 'submenu' };
  onAction: (item: MenuItem & { kind: 'action' }, args: object | undefined) => void;
}) {
  const [open, setOpen] = useState(false);
  return (
    <div
      style={{ position: 'relative' }}
      onMouseEnter={() => setOpen(true)}
      onMouseLeave={() => setOpen(false)}
    >
      <div style={{ ...ITEM, color: '#e8e8e8', display: 'flex', justifyContent: 'space-between' }}>
        <span>{item.label}</span><span style={{ color: '#888' }}>▸</span>
      </div>
      {open && (
        <div
          role="menu"
          style={{
            position: 'absolute', left: '100%', top: 0,
            background: '#1e1e2e', border: '1px solid rgba(255,255,255,0.15)',
            borderRadius: 6, padding: '4px 0', minWidth: 140,
            boxShadow: '0 4px 20px rgba(0,0,0,0.6)',
          }}
        >
          <MenuList items={item.items} onAction={onAction} />
        </div>
      )}
    </div>
  );
}

// Sentinel returned when the user cancels a numeric prompt — caller drops
// the click rather than firing an action with undefined args.
const SKIP_ACTION = Symbol('skip-action') as unknown as object;

// "Custom…" actions (id === 'custom' or label matching the convention)
// open a numeric prompt and forward the result as args: { count }.
function maybePromptForCount(item: MenuItem & { kind: 'action' }): object | undefined {
  if (item.id !== 'custom' && item.label !== 'Custom…') return undefined;
  const raw = window.prompt('Enter a count:', '1');
  if (raw === null) return SKIP_ACTION;
  const n = Number(raw);
  if (!Number.isFinite(n)) return SKIP_ACTION;
  return { count: n };
}
