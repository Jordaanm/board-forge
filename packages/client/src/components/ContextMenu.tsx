import { type ContextMenuRequest } from '../input/ContextMenuController';

interface Props {
  menu:      ContextMenuRequest;
  onAction:  (actionId: string, objectId: string) => void;
  onDismiss: () => void;
}

const ITEM: React.CSSProperties = {
  display: 'block', width: '100%', padding: '8px 16px',
  background: 'none', border: 'none', cursor: 'pointer',
  textAlign: 'left', fontSize: 13, fontFamily: 'sans-serif',
};

export function ContextMenu({ menu, onAction, onDismiss }: Props) {
  const items = [...menu.actions, { id: 'delete', label: 'Delete' }];

  return (
    <>
      {/* Full-screen backdrop intercepts outside clicks without reaching the canvas */}
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
        {items.map(item => (
          <button
            key={item.id}
            role="menuitem"
            style={{ ...ITEM, color: item.id === 'delete' ? '#f47c7c' : '#e8e8e8' }}
            onClick={() => { onAction(item.id, menu.objectId); onDismiss(); }}
            onMouseEnter={e => (e.currentTarget.style.background = 'rgba(255,255,255,0.08)')}
            onMouseLeave={e => (e.currentTarget.style.background = 'none')}
          >
            {item.label}
          </button>
        ))}
      </div>
    </>
  );
}
