// Composición de los sub-routers de /stats:
// - top.ts:       top-tracks/artists/albums/genres
// - insights.ts:  listening-time, history (GET/DELETE), discovery, heatmap, monthly-distribution, streaks
// - detail.ts:    artist/:id, album/:id, track/:id, search
// - charts.ts:    charts/periods, charts, charts/peaks, chart-history/:type/:id
// - records.ts:   records, accolades/:type/:id, rankings/:type/:id, ranking-history/:type/:id, projected-rankings

import { Hono } from 'hono';
import type { AppVariables } from '../app.js';
import top from './stats/top.js';
import insights from './stats/insights.js';
import detail from './stats/detail.js';
import charts from './stats/charts.js';
import records from './stats/records.js';

const stats = new Hono<{ Variables: AppVariables }>();

stats.route('/', top);
stats.route('/', insights);
stats.route('/', detail);
stats.route('/', charts);
stats.route('/', records);

export default stats;
