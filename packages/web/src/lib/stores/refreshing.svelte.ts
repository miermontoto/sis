// rastro de paths que están revalidándose en background.
// el indicador en el header se suscribe a `count` para mostrar el punto pulsante.

let _paths = $state(new Set<string>());

export const refreshing = {
  get paths(): ReadonlySet<string> { return _paths; },
  get count(): number { return _paths.size; },
  add(path: string) {
    if (_paths.has(path)) return;
    const next = new Set(_paths);
    next.add(path);
    _paths = next;
  },
  remove(path: string) {
    if (!_paths.has(path)) return;
    const next = new Set(_paths);
    next.delete(path);
    _paths = next;
  },
};
