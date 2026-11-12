// estado del dashboard de widgets, compartido por la página (modo edición en
// sitio) y el editor de lista de Settings: los dos aplican las operaciones puras
// de layout.ts sobre el mismo $state y cada cambio se guarda en el ajuste
// sincronizado `dashboardWidgets`.
//
// Mientras el usuario no toca nada no se guarda nada: el default (o lo migrado
// del dashboard de secciones) se recalcula en cada arranque, así que un widget
// que entre en el default le aparece también a quien nunca lo personalizó
import { getDashboardWidgets, setDashboardWidgets, getLegacyDashboardLayout } from '$lib/api';
import { defaultDashboard, migrateLegacyLayout, parseDashboard, serializeDashboard, type DashboardLayout } from './layout';

// null = sin tocar: se sirve `_initial`, que no es $state porque se calcula en la
// primera lectura y esa lectura suele ir dentro de un $derived (escribir $state ahí
// es state_unsafe_mutation). El $state sólo lo escriben apply() y reset()
let _layout = $state<DashboardLayout | null>(null);
let _initial: DashboardLayout | null = null;
let _editing = $state(false);
// sube con cada pull-to-refresh: los widgets que piden sus propios datos lo leen
// en su efecto de carga y releen (la página ya ha purgado la cache)
let _reloadSeq = $state(0);

function initial(): DashboardLayout {
  return parseDashboard(getDashboardWidgets()) ?? migrateLegacyLayout(getLegacyDashboardLayout()) ?? defaultDashboard();
}

export const dashboardStore = {
  get layout(): DashboardLayout {
    return _layout ?? (_initial ??= initial());
  },
  // aplica una operación de layout.ts y la persiste; una que no cambia nada
  // devuelve el mismo objeto y no escribe
  apply(op: (layout: DashboardLayout) => DashboardLayout) {
    const current = dashboardStore.layout;
    const next = op(current);
    if (next === current) return;
    _layout = next;
    setDashboardWidgets(serializeDashboard(next));
  },
  // vuelve al default y borra lo guardado, así el default vuelve a seguir al registro
  reset() {
    _layout = defaultDashboard();
    setDashboardWidgets('');
  },
  get editing() { return _editing; },
  set editing(v: boolean) { _editing = v; },
  get reloadSeq() { return _reloadSeq; },
  reload() { _reloadSeq++; },
};
