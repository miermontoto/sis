import { getQueryParam, setQueryParams } from './query-state';

export interface UrlParam<T> {
  get value(): T;
  set value(v: T);
}

// estado reactivo enlazado a un query param. Úsalo en el top del <script>
// de una ruta para que los filtros sobrevivan a refresh/bookmark.
//
//   const tab = urlParam<'tracks' | 'albums' | 'artists'>(
//     'tab', 'tracks',
//     (v): v is 'tracks' | 'albums' | 'artists' => ['tracks','albums','artists'].includes(v),
//   );
//   tab.value            // lectura reactiva
//   tab.value = 'albums' // set (y la URL se actualiza sola)
//
// Cuando el valor coincide con `fallback` el param se borra de la URL para
// evitar clutter. Si `validate` se provee, cualquier string del URL que no
// pase la comprobación cae al fallback.
export function urlParam<T extends string>(
  key: string,
  fallback: T,
  validate?: (v: string) => v is T,
): UrlParam<T> {
  const raw = getQueryParam(key, '');
  const valid = raw && (!validate || validate(raw));
  let val = $state<T>(valid ? (raw as T) : fallback);
  let ready = false;
  $effect(() => {
    const v = val;
    if (!ready) { ready = true; return; }
    setQueryParams({ [key]: v === fallback ? null : v });
  });
  return {
    get value() { return val; },
    set value(v: T) { val = v; },
  };
}

// helper para cuando el dominio del valor es un array fijo.
//   const tab = urlEnumParam('tab', ['tracks','albums','artists'] as const, 'tracks');
export function urlEnumParam<T extends string>(
  key: string,
  values: readonly T[],
  fallback: T,
): UrlParam<T> {
  return urlParam<T>(key, fallback, (v): v is T => (values as readonly string[]).includes(v));
}
