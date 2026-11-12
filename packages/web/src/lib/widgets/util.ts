// piezas comunes a los widgets que piden sus propios datos
import { getRankingMetric, type RankingMetric } from '$lib/api';
import { attributionVersion } from '$lib/stores/attribution';
import type { EntityType } from '$lib/utils/entity-context';
import { dashboardStore } from './dashboard-store.svelte';
import { RANGE_PHRASES, type WidgetSettings, type WidgetSize } from './registry';

// la métrica de un widget: la elegida en sus ajustes o, con 'auto', la de ranking
export const widgetMetric = (s: WidgetSettings): RankingMetric =>
  s.metric === 'plays' || s.metric === 'time' ? s.metric : getRankingMetric();

// lo que obliga a un widget a releer, además de sus ajustes: el pull-to-refresh
// (la página ya purgó la cache) y cualquier mutación que cambie a qué entidad
// cuenta un play (merges, colecciones, créditos: ver attributionVersion). Leerlo
// dentro del efecto de carga lo suscribe a los dos
export const reloadKey = (): string => `${dashboardStore.reloadSeq}:${attributionVersion()}`;

export const isEntity = (v: unknown): v is EntityType => v === 'track' || v === 'album' || v === 'artist';
export const entityOf = (s: WidgetSettings, fallback: EntityType = 'track'): EntityType => isEntity(s.entity) ? s.entity : fallback;

const PLURAL: Record<EntityType, string> = { track: 'tracks', album: 'albums', artist: 'artists' };
export const pluralOf = (e: EntityType) => PLURAL[e];
export const rangePhrase = (range: unknown) => RANGE_PHRASES[String(range)] ?? '';

// filas que pide una lista según el tamaño: un tope, que fitRows recorta a las
// que caben de verdad en el alto de ese slot y esa pantalla
export const LIST_MAX: Record<WidgetSize, number> = { tile: 1, band: 1, small: 1, medium: 5, large: 10, tall: 20, xl: 16 };

// los controles rápidos de la cabecera (selector de tipo) sólo caben a partir de large
export const roomForActions = (size: WidgetSize) => size === 'large' || size === 'tall' || size === 'xl';
