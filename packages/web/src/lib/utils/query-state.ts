import { goto } from '$app/navigation';
import { page } from '$app/stores';
import { get } from 'svelte/store';

export function getQueryParam(key: string, fallback: string): string {
  return get(page).url.searchParams.get(key) ?? fallback;
}

export function setQueryParams(params: Record<string, string | null>) {
  const url = new URL(get(page).url);
  for (const [k, v] of Object.entries(params)) {
    if (v === null) url.searchParams.delete(k);
    else url.searchParams.set(k, v);
  }
  goto(url.toString(), { replaceState: true, noScroll: true, keepFocus: true });
}
