// Menú contextual global (botón derecho). Una sola instancia monta <ContextMenu /> en el layout.
export interface ContextMenuAction {
  label: string;
  onClick: () => void | Promise<void>;
  danger?: boolean;
  disabled?: boolean;
}

interface ContextMenuState {
  x: number;
  y: number;
  actions: ContextMenuAction[];
}

let state = $state<ContextMenuState | null>(null);

export const contextMenu = {
  get state() { return state; },
  open(e: MouseEvent, actions: ContextMenuAction[]) {
    if (actions.length === 0) return;
    e.preventDefault();
    e.stopPropagation();
    state = { x: e.clientX, y: e.clientY, actions };
  },
  close() { state = null; },
};
