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

// 3 ciclos de 350 ms, el mismo total que las animaciones de app.css
const FLASH_MS = 1_050;

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
    vi.advanceTimersByTime(500);
    statFlashStore.flash(['track-b']);

    vi.advanceTimersByTime(FLASH_MS - 500);
    expect(statFlashStore.isFlashing('track-a')).toBe(false);
    expect(statFlashStore.isFlashing('track-b')).toBe(true);
  });

  it('el movimiento de puesto se guarda con su delta y caduca igual', () => {
    const { statFlashStore } = mod;
    statFlashStore.move(new Map([['track-a', 2], ['track-b', -1]]));

    expect(statFlashStore.moveOf('track-a')).toBe(2);
    expect(statFlashStore.moveOf('track-b')).toBe(-1);
    expect(statFlashStore.moveOf('otro')).toBeNull();

    vi.advanceTimersByTime(FLASH_MS);
    expect(statFlashStore.moveOf('track-a')).toBeNull();
  });

  it('moverse y cambiar de cifra son marcas independientes', () => {
    const { statFlashStore } = mod;
    // la fila adelantada cambia de puesto sin sumar nada: flecha, pero sin
    // parpadeo de la cifra
    statFlashStore.move(new Map([['track-b', -1]]));

    expect(statFlashStore.moveOf('track-b')).toBe(-1);
    expect(statFlashStore.isFlashing('track-b')).toBe(false);
  });
});
