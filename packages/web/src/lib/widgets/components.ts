// tipo de widget → componente. El registro (registry.ts) es puro y no puede
// importar componentes, así que el despacho vive aquí; un widget nuevo se
// declara en los dos sitios
import type { Component } from 'svelte';
import type { WidgetSettings, WidgetSize } from './registry';
import StatWidget from './types/StatWidget.svelte';
import WeekStripWidget from './types/WeekStripWidget.svelte';
import TopWidget from './types/TopWidget.svelte';
import LastReportWidget from './types/LastReportWidget.svelte';
import LastYearWidget from './types/LastYearWidget.svelte';
import GenresWidget from './types/GenresWidget.svelte';
import RankChangesWidget from './types/RankChangesWidget.svelte';
import RecentPlaysWidget from './types/RecentPlaysWidget.svelte';
import ClockWidget from './types/ClockWidget.svelte';
import CalendarWidget from './types/CalendarWidget.svelte';
import GoalWidget from './types/GoalWidget.svelte';
import OnThisDayWidget from './types/OnThisDayWidget.svelte';
import AnniversariesWidget from './types/AnniversariesWidget.svelte';
import MilestoneWidget from './types/MilestoneWidget.svelte';
import SessionWidget from './types/SessionWidget.svelte';
import FriendsWidget from './types/FriendsWidget.svelte';
import ChartWidget from './types/ChartWidget.svelte';
import RecordWidget from './types/RecordWidget.svelte';
import DiscoveriesWidget from './types/DiscoveriesWidget.svelte';
import ConcertsWidget from './types/ConcertsWidget.svelte';

export interface WidgetProps {
  // tamaño con el que se pinta (el del slot, o large si un xl no cabe)
  size: WidgetSize;
  settings: WidgetSettings;
  // controles rápidos dentro del widget (el selector de tipo de una lista): guardan
  // en sus ajustes. Ausente en la vista previa de la galería, que no tiene dónde
  onsettings?: (patch: Partial<WidgetSettings>) => void;
}

export const WIDGET_COMPONENTS: Record<string, Component<WidgetProps>> = {
  stat: StatWidget,
  weekStrip: WeekStripWidget,
  top: TopWidget,
  lastReport: LastReportWidget,
  lastYear: LastYearWidget,
  genres: GenresWidget,
  rankChanges: RankChangesWidget,
  recentPlays: RecentPlaysWidget,
  clock: ClockWidget,
  calendar: CalendarWidget,
  goal: GoalWidget,
  onThisDay: OnThisDayWidget,
  anniversaries: AnniversariesWidget,
  milestone: MilestoneWidget,
  session: SessionWidget,
  friends: FriendsWidget,
  chart: ChartWidget,
  record: RecordWidget,
  discoveries: DiscoveriesWidget,
  concerts: ConcertsWidget,
};
