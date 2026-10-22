import type { Component } from 'svelte';

// Menú contextual global (botón derecho). Una sola instancia monta <ContextMenu /> en el layout.
export interface MenuPoint {
  x: number;
  y: number;
}

export interface ContextMenuAction {
  label: string;
  // recibe el punto donde se abrió el menú: lo que se abre en su sitio (el selector de
  // playlists) lo necesita, y el menú ya se ha cerrado cuando corre la acción
  onClick: (at: MenuPoint) => void | Promise<void>;
  icon?: Component<{ size?: number }>;
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
