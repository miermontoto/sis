import { goto } from '$app/navigation';
import { api } from '$lib/api';
import { nowPlayingStore } from '$lib/stores/now-playing.svelte';

export interface ShortcutDef {
  key: string;
  description: string;
  category: 'navigation' | 'now-playing' | 'playback' | 'ui' | 'page';
}

let _showHelp = $state(false);
let _pageShortcuts = $state<ShortcutDef[]>([]);
let _pageHandler = $state<((e: KeyboardEvent) => boolean) | null>(null);

const NAV_MAP: Record<string, string> = {
  d: '/',
  h: '/history',
  r: '/top',
  c: '/charts',
  i: '/insights',
  e: '/records',
  p: '/playlists',
  g: '/generators',
  s: '/settings',
};

const GLOBAL_SHORTCUTS: ShortcutDef[] = [
  { key: 'D', description: 'Dashboard', category: 'navigation' },
  { key: 'H', description: 'History', category: 'navigation' },
  { key: 'R', description: 'Rankings', category: 'navigation' },
  { key: 'C', description: 'Charts', category: 'navigation' },
  { key: 'I', description: 'Insights', category: 'navigation' },
  { key: 'E', description: 'Records', category: 'navigation' },
  { key: 'P', description: 'Playlists', category: 'navigation' },
  { key: 'G', description: 'Generators', category: 'navigation' },
  { key: 'S', description: 'Settings', category: 'navigation' },
  { key: 'T', description: 'Go to current track', category: 'now-playing' },
  { key: 'A', description: 'Go to current album', category: 'now-playing' },
  { key: 'X', description: 'Go to current artist', category: 'now-playing' },
  { key: 'Space', description: 'Play / Pause', category: 'playback' },
  { key: 'Shift+→', description: 'Next track', category: 'playback' },
  { key: 'Shift+←', description: 'Previous track', category: 'playback' },
  { key: 'L', description: 'Like / Unlike', category: 'playback' },
  { key: '?', description: 'Keyboard shortcuts', category: 'ui' },
  { key: '⌘K', description: 'Search', category: 'ui' },
  { key: 'Esc', description: 'Close overlay', category: 'ui' },
];

function isTyping(e: KeyboardEvent): boolean {
  const el = e.target as HTMLElement;
  const tag = el?.tagName;
  if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return true;
  if (el?.isContentEditable) return true;
  return false;
}

function handleKeydown(
  e: KeyboardEvent,
  callbacks: {
    openSearch: () => void;
    isSearchOpen: () => boolean;
  },
) {
  if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
    e.preventDefault();
    callbacks.openSearch();
    return;
  }

  if (e.key === 'Escape') {
    if (_showHelp) {
      _showHelp = false;
      e.preventDefault();
      return;
    }
    return;
  }

  if (callbacks.isSearchOpen()) return;
  if (isTyping(e)) return;
  if (e.metaKey || e.ctrlKey || e.altKey) return;

  if (e.key === '?') {
    e.preventDefault();
    _showHelp = !_showHelp;
    return;
  }

  if (_showHelp) return;

  if (e.key === ' ') {
    e.preventDefault();
    if (nowPlayingStore.isPlaying) api.playbackPause().then(() => nowPlayingStore.pollLive());
    else api.playbackPlay().then(() => nowPlayingStore.pollLive());
    return;
  }

  if (e.shiftKey && e.key === 'ArrowRight') {
    e.preventDefault();
    api.playbackNext().then(() => nowPlayingStore.pollLive());
    return;
  }

  if (e.shiftKey && e.key === 'ArrowLeft') {
    e.preventDefault();
    api.playbackPrevious().then(() => nowPlayingStore.pollLive());
    return;
  }

  if (e.shiftKey) return;

  const key = e.key.toLowerCase();

  if (key === 'l') {
    e.preventDefault();
    nowPlayingStore.toggleLike();
    return;
  }

  if (key === 't' && nowPlayingStore.trackId) {
    e.preventDefault();
    goto(`/track/${encodeURIComponent(nowPlayingStore.trackId)}`);
    return;
  }

  if (key === 'a' && nowPlayingStore.albumId) {
    e.preventDefault();
    goto(`/album/${encodeURIComponent(nowPlayingStore.albumId)}`);
    return;
  }

  if (key === 'x' && nowPlayingStore.artistIds.length > 0) {
    e.preventDefault();
    goto(`/artist/${encodeURIComponent(nowPlayingStore.artistIds[0])}`);
    return;
  }

  if (_pageHandler?.(e)) return;

  const navTarget = NAV_MAP[key];
  if (navTarget) {
    e.preventDefault();
    goto(navTarget);
    return;
  }
}

export const shortcutStore = {
  get showHelp() { return _showHelp; },
  set showHelp(v: boolean) { _showHelp = v; },
  get globalShortcuts() { return GLOBAL_SHORTCUTS; },
  get pageShortcuts() { return _pageShortcuts; },
  handleKeydown,
  registerPageShortcuts(defs: ShortcutDef[], handler: (e: KeyboardEvent) => boolean) {
    _pageShortcuts = defs;
    _pageHandler = handler;
  },
  unregisterPageShortcuts() {
    _pageShortcuts = [];
    _pageHandler = null;
  },
};
