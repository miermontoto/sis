export function canShare(): boolean {
  return typeof navigator !== 'undefined' && !!navigator.share;
}

export async function shareEntity(title: string, url: string): Promise<void> {
  if (!canShare()) return;
  try {
    await navigator.share({ title, url });
  } catch (e) {
    if (e instanceof DOMException && e.name === 'AbortError') return;
    throw e;
  }
}
