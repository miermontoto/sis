import type { Granularity } from '$lib/api';
import { getClosedCharts, dismissClosedChart, dismissAllClosedCharts, type ClosedChart } from '$lib/utils/periods';

let _charts = $state<ClosedChart[]>([]);

export const closedChartsStore = {
  get charts() { return _charts; },

  refresh() {
    _charts = getClosedCharts();
  },

  dismiss(gran: Granularity) {
    dismissClosedChart(gran);
    _charts = _charts.filter(c => c.granularity !== gran);
  },

  dismissAll() {
    dismissAllClosedCharts();
    _charts = [];
  },
};
