import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

// estado a nivel de módulo (marcas + temporizadores): instancia limpia por caso
let mod: typeof import('./stat-flash.svelte');

beforeEach(async () => {
  vi.useFakeTimers();
  vi.resetModules();
  mod = await import('./stat-flash.svelte');
});

afterEach(() => {
  vi.useRealTimers();
});

// 6 ciclos de 350 ms, el mismo total que la animación de app.css
const FLASH_MS = 2_100;

describe('statFlashStore', () => {
  it('marca los ids indicados', () => {
    const { statFlashStore } = mod;
    statFlashStore.flash(['track-a', 'album-a']);

    expect(statFlashStore.isFlashing('track-a')).toBe(true);
    expect(statFlashStore.isFlashing('album-a')).toBe(true);
    expect(statFlashStore.isFlashing('otro')).toBe(false);
  });

  it('descarta ids vacíos sin marcar nada', () => {
    const { statFlashStore } = mod;
    // el álbum de un track puede ser null: llega tal cual desde el PlayUpdate
    statFlashStore.flash([null, undefined]);
    expect(statFlashStore.isFlashing(null)).toBe(false);
    expect(statFlashStore.isFlashing(undefined)).toBe(false);
  });

  it('retira la marca cuando la animación ha terminado', () => {
    const { statFlashStore } = mod;
    statFlashStore.flash(['track-a']);

    vi.advanceTimersByTime(FLASH_MS - 1);
    expect(statFlashStore.isFlashing('track-a')).toBe(true);

    vi.advanceTimersByTime(1);
    expect(statFlashStore.isFlashing('track-a')).toBe(false);
  });

  it('un segundo cambio reinicia la cuenta en vez de cortarla a medias', () => {
    const { statFlashStore } = mod;
    statFlashStore.flash(['track-a']);
    vi.advanceTimersByTime(FLASH_MS - 100);

    statFlashStore.flash(['track-a']);
    // con el temporizador viejo aún vivo, la marca se habría ido a los 100 ms
    vi.advanceTimersByTime(200);
    expect(statFlashStore.isFlashing('track-a')).toBe(true);

    vi.advanceTimersByTime(FLASH_MS);
    expect(statFlashStore.isFlashing('track-a')).toBe(false);
  });

  it('cada id caduca por su cuenta', () => {
    const { statFlashStore } = mod;
    statFlashStore.flash(['track-a']);
    vi.advanceTimersByTime(1_000);
    statFlashStore.flash(['track-b']);

    vi.advanceTimersByTime(FLASH_MS - 1_000);
    expect(statFlashStore.isFlashing('track-a')).toBe(false);
    expect(statFlashStore.isFlashing('track-b')).toBe(true);
  });
});
