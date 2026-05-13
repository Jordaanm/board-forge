import { useState } from 'react';
import { type ContextMenuRequest } from '../input/ContextMenuController';
import { type MenuItem } from '../entity/EntityComponent';
import { useFlipPosition } from './useFlipPosition';

interface Props {
  menu:      ContextMenuRequest;
  onAction:  (item: MenuItem & { kind: 'action' | 'colorpicker' }, args: object | undefined) => void;
  onDismiss: () => void;
}

const ITEM: React.CSSProperties = {
  display: 'block', width: '100%', padding: '8px 16px',
  background: 'none', border: 'none', cursor: 'pointer',
  textAlign: 'left', fontSize: 13, fontFamily: 'var(--font-sans)',
  color: 'var(--ink)',
};

const HEADER: React.CSSProperties = {
  padding: '8px 16px',
  borderBottom: '1px solid var(--line)',
  background: 'var(--surface-2)',
  userSelect: 'none',
  fontFamily: 'var(--font-sans)',
};

const SEPARATOR: React.CSSProperties = {
  height: 1, margin: '4px 0', background: 'var(--line)',
};

const HEADING_STYLE: React.CSSProperties = {
  padding: '6px 16px', fontSize: 11, color: 'var(--ink-mute)',
  textTransform: 'uppercase', letterSpacing: '0.14em', fontWeight: 700,
  fontFamily: 'var(--font-sans)', userSelect: 'none',
};

const TAG_STYLE: React.CSSProperties = {
  background: 'var(--bg)', color: 'var(--ink-2)',
  border: '1px solid var(--line)',
  padding: '1px 6px', borderRadius: 3, fontSize: 10,
  fontFamily: 'var(--font-sans)', userSelect: 'none', fontWeight: 600,
};

const MENU: React.CSSProperties = {
  background: 'var(--surface)',
  border: '1px solid var(--line)',
  borderRadius: 'var(--panel-radius)',
  padding: '4px 0',
  minWidth: 160,
  boxShadow: 'var(--shadow-lg)',
  color: 'var(--ink)',
};

const HOVER_BG = 'var(--surface-2)';

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
        style={{ ...MENU, position: 'fixed', left: menu.x, top: menu.y, zIndex: 201 }}
      >
        <div style={HEADER}>
          <div style={{ color: 'var(--ink)', fontSize: 13, fontWeight: 700, fontFamily: 'var(--font-serif)', letterSpacing: '-0.01em' }}>
            {menu.entityName}
          </div>
          <div style={{ color: 'var(--ink-mute)', fontSize: 11, fontFamily: 'var(--font-mono)' }}>
            {menu.entityId}
          </div>
          {menu.entityTags.length > 0 && (
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, marginTop: 6 }}>
              {menu.entityTags.map(t => (
                <span key={t} style={TAG_STYLE}>{t}</span>
              ))}
            </div>
          )}
        </div>
        <MenuList
          items={menu.items}
          onAction={(item, args) => {
            onAction(item, args);
            if (item.kind !== 'colorpicker') onDismiss();
          }}
        />
      </div>
    </>
  );
}

function MenuList({
  items, onAction,
}: {
  items: MenuItem[];
  onAction: (item: MenuItem & { kind: 'action' | 'colorpicker' }, args: object | undefined) => void;
}) {
  return (
    <>
      {items.map((item, i) => {
        if (item.kind === 'separator') return <div key={`sep-${i}`} style={SEPARATOR} />;
        if (item.kind === 'heading')   return <div key={`hd-${i}`}  style={HEADING_STYLE}>{item.label}</div>;
        if (item.kind === 'action')      return <ActionRow      key={`act-${item.id}-${i}`}   item={item} onAction={onAction} />;
        if (item.kind === 'colorpicker') return <ColorPickerRow key={`color-${item.id}-${i}`} item={item} onAction={onAction} />;
        if (item.kind === 'numeric')     return <NumericRow     key={`num-${item.id}-${i}`}   item={item} onAction={onAction} />;
        if (item.kind === 'submenu')     return <SubmenuRow     key={`sub-${item.label}-${i}`} item={item} onAction={onAction} />;
        return null;
      })}
    </>
  );
}

function ActionRow({
  item, onAction,
}: {
  item: MenuItem & { kind: 'action' };
  onAction: (item: MenuItem & { kind: 'action' | 'colorpicker' }, args: object | undefined) => void;
}) {
  const isDestructive = item.id === '__delete';
  return (
    <button
      role="menuitem"
      disabled={item.disabled}
      style={{
        ...ITEM,
        color: isDestructive ? 'var(--accent-deep)' : 'var(--ink)',
        opacity: item.disabled ? 0.5 : 1,
        cursor: item.disabled ? 'default' : 'pointer',
      }}
      onClick={() => {
        if (item.disabled) return;
        const promptArgs = maybePromptForCount(item);
        if (promptArgs === SKIP_ACTION) return;
        const args = promptArgs ?? item.args;
        onAction(item, args);
      }}
      onMouseEnter={e => (e.currentTarget.style.background = HOVER_BG)}
      onMouseLeave={e => (e.currentTarget.style.background = 'none')}
    >
      {item.label}
    </button>
  );
}

function ColorPickerRow({
  item, onAction,
}: {
  item: MenuItem & { kind: 'colorpicker' };
  onAction: (item: MenuItem & { kind: 'action' | 'colorpicker' }, args: object | undefined) => void;
}) {
  return (
    <label
      style={{ ...ITEM, display: 'flex', alignItems: 'center', justifyContent: 'space-between', cursor: 'pointer' }}
      onMouseEnter={e => (e.currentTarget.style.background = HOVER_BG)}
      onMouseLeave={e => (e.currentTarget.style.background = 'none')}
    >
      <span>{item.label}</span>
      <input
        type="color"
        value={item.value || '#ffffff'}
        onChange={e => onAction(item, { value: e.target.value })}
        style={{ width: 28, height: 18, border: 'none', background: 'none', padding: 0, cursor: 'pointer' }}
      />
    </label>
  );
}

function NumericRow({
  item, onAction,
}: {
  item: MenuItem & { kind: 'numeric' };
  onAction: (item: MenuItem & { kind: 'action' | 'colorpicker' }, args: object | undefined) => void;
}) {
  const [value, setValue] = useState<number>(item.default ?? 1);
  const submit = () => {
    let n = Number(value);
    if (!Number.isFinite(n)) return;
    if (item.min !== undefined && n < item.min) n = item.min;
    if (item.max !== undefined && n > item.max) n = item.max;
    const action = {
      kind: 'action' as const,
      id:   item.id,
      label: item.label,
      ...(item.componentTypeId ? { componentTypeId: item.componentTypeId } : {}),
    };
    onAction(action, { count: n });
  };
  return (
    <div
      style={{
        ...ITEM,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        gap: 6,
      }}
      onMouseEnter={e => (e.currentTarget.style.background = HOVER_BG)}
      onMouseLeave={e => (e.currentTarget.style.background = 'none')}
    >
      <span style={{ flexShrink: 0 }}>{item.label}</span>
      <span style={{ display: 'flex', gap: 4 }}>
        <input
          type="number"
          min={item.min}
          max={item.max}
          value={value}
          onChange={e => setValue(Number(e.target.value))}
          onKeyDown={e => { if (e.key === 'Enter') submit(); }}
          style={{
            width: 56, padding: '2px 4px', fontSize: 12,
            background: 'var(--bg)', border: '1px solid var(--line)',
            color: 'var(--ink)', borderRadius: 3, fontFamily: 'inherit',
          }}
        />
        <button
          onClick={submit}
          style={{
            padding: '2px 8px', fontSize: 12, fontWeight: 700,
            background: 'var(--accent)', border: '1px solid var(--accent-deep)',
            color: 'var(--accent-ink)', borderRadius: 3, cursor: 'pointer',
            fontFamily: 'inherit',
          }}
        >
          OK
        </button>
      </span>
    </div>
  );
}

function SubmenuRow({
  item, onAction,
}: {
  item: MenuItem & { kind: 'submenu' };
  onAction: (item: MenuItem & { kind: 'action' | 'colorpicker' }, args: object | undefined) => void;
}) {
  const [open, setOpen] = useState(false);
  const { ref, style } = useFlipPosition(open);
  return (
    <div
      style={{ position: 'relative' }}
      onMouseEnter={() => setOpen(true)}
      onMouseLeave={() => setOpen(false)}
    >
      <div style={{ ...ITEM, display: 'flex', justifyContent: 'space-between' }}>
        <span>{item.label}</span><span style={{ color: 'var(--ink-mute)' }}>▸</span>
      </div>
      {open && (
        <div
          ref={ref}
          role="menu"
          style={{ ...MENU, position: 'absolute', ...style, minWidth: 140 }}
        >
          <MenuList items={item.items} onAction={onAction} />
        </div>
      )}
    </div>
  );
}

const SKIP_ACTION = Symbol('skip-action') as unknown as object;

function maybePromptForCount(item: MenuItem & { kind: 'action' }): object | undefined {
  if (item.id !== 'custom' && item.label !== 'Custom…') return undefined;
  const raw = window.prompt('Enter a count:', '1');
  if (raw === null) return SKIP_ACTION;
  const n = Number(raw);
  if (!Number.isFinite(n)) return SKIP_ACTION;
  return { count: n };
}
