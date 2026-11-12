// recuerdos de hoy, compartidos por los widgets "On this day" y "Anniversaries":
// una sola petición por día (la fecha local va en la clave de la cache del cliente)
import { api, getTimeZone, type MemoriesResponse } from '$lib/api';

let _data = $state<MemoriesResponse | null>(null);
let _loading = $state(false);
let _key = '';

// 'YYYY-MM-DD' de hoy en la zona del calendario del usuario (en-CA da el formato ISO)
export const localToday = (): string => new Date().toLocaleDateString('en-CA', { timeZone: getTimeZone() });

export const memoriesStore = {
  // pide los de hoy si aún no están (o si el día ha cambiado); `force` relee
  ensure(force = false) {
    const date = localToday();
    if (!force && _key === date) return;
    _key = date;
    _loading = true;
    api.memories(date)
      .then(d => { if (_key === date) _data = d; })
      .catch(e => console.error('memories:', e))
      .finally(() => { if (_key === date) _loading = false; });
  },
  get data() { return _data; },
  get loading() { return _loading; },
};
