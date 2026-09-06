// helpers de DOM para enfocar elementos que se pintan tras una carga async,
// cuando tick() no basta porque el dato aún está en vuelo

const WAIT_FOR_ELEMENT_TIMEOUT_MS = 2000;

/** Resuelve en el siguiente frame de pintado */
export const nextFrame = () => new Promise<void>(r => requestAnimationFrame(() => r()));

/** Espera (por frames) a que un selector exista en el DOM; null si agota el tiempo */
export async function waitForElement(selector: string, timeoutMs = WAIT_FOR_ELEMENT_TIMEOUT_MS): Promise<HTMLElement | null> {
  const deadline = performance.now() + timeoutMs;
  let el = document.querySelector<HTMLElement>(selector);
  while (!el && performance.now() < deadline) {
    await nextFrame();
    el = document.querySelector<HTMLElement>(selector);
  }
  return el;
}
