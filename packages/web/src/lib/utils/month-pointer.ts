import type * as echarts from 'echarts/core';
import { bucketIndexOf, type TimelineBucket } from './entity-timeline';

// el mes destacado (`highlightedMonth`) enlaza las gráficas del detalle entre sí y con las
// celdas del chart run. Cada gráfica traduce mes ↔ columna con SUS buckets, así que la de
// actividad puede ir por años mientras la de ranking va por meses y seguir enlazadas

// echarts tipa el evento como unknown; en un eje de categorías `value` es el índice
interface AxisPointerEvent { axesInfo?: { axisDim: string; value: number }[] }

export interface MonthPointerLink {
  buckets: () => TimelineBucket[];
  highlighted: () => string;
  setHighlighted: (month: string) => void;
  /** columna bajo el puntero (ratón o showTip), -1 fuera del eje */
  setPointer: (idx: number) => void;
  onClick: (bucket: TimelineBucket) => void;
}

/** Puntero de echarts → mes destacado, y click sobre la columna. Devuelve el cleanup. */
export function linkMonthPointer(chart: echarts.ECharts, link: MonthPointerLink): () => void {
  const zr = chart.getZr();
  let pointer = -1;
  const onPointer = (e: unknown) => {
    const x = (e as AxisPointerEvent).axesInfo?.find(a => a.axisDim === 'x');
    pointer = x ? x.value : -1;
    link.setPointer(pointer);
    const b = link.buckets()[pointer];
    // un bucket que ya contiene el mes destacado no lo pisa: si vino de la otra gráfica o
    // de una celda del chart run, moverlo al cierre del trimestre apagaría la de origen
    if (b && bucketIndexOf([b], link.highlighted()) < 0) link.setHighlighted(b.months[b.months.length - 1]);
  };
  const onClick = () => {
    const b = link.buckets()[pointer];
    if (b) link.onClick(b);
  };
  // sólo la salida del ratón limpia: un hideTip programático (el destacado vino de fuera y
  // no cae en este eje) no puede borrar el destacado de quien lo puso
  const onOut = () => {
    pointer = -1;
    link.setPointer(-1);
    link.setHighlighted('');
  };
  chart.on('updateAxisPointer', onPointer);
  zr.on('click', onClick);
  zr.on('globalout', onOut);
  return () => {
    if (chart.isDisposed()) return;
    chart.off('updateAxisPointer', onPointer);
    zr.off('click', onClick);
    zr.off('globalout', onOut);
  };
}

/** Mes destacado desde fuera → tooltip en su columna, o fuera si no cae en este eje. */
export function showMonthTip(chart: echarts.ECharts, buckets: TimelineBucket[], month: string, pointer: number, seriesIndex: number): void {
  const idx = month ? bucketIndexOf(buckets, month) : -1;
  if (idx === pointer) return;
  if (idx >= 0) {
    chart.dispatchAction({ type: 'showTip', seriesIndex, dataIndex: idx });
    return;
  }
  // hideTip esconde el tooltip pero no el puntero que puso un showTip: la línea vertical
  // se quedaba en la otra gráfica después de sacar el ratón de ésta
  chart.dispatchAction({ type: 'hideTip' });
  chart.dispatchAction({ type: 'updateAxisPointer', currTrigger: 'leave' });
}
