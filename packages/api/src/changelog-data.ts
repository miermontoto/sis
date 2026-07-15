// changelog "novedades" de sis: fuente de verdad hand-curated. el servicio
// (services/changelog.ts) siembra estas entradas en la tabla al arrancar.
// versión en formato snapshot (YYwWWx, igual que VERSION en constants.ts);
// publishedAt ISO; orden libre (la query ordena por fecha). bilingüe es/en
// aunque la UI de sis se renderiza en inglés.
import type { ChangelogEntryInput } from '@platform/changelog';

export const CHANGELOG: ChangelogEntryInput[] = [
  {
    version: '26w29c',
    publishedAt: '2026-07-14',
    title: 'Leaner sidebar',
    changes: [
      { type: 'feature', es: 'Sidebar colapsable a un rail de solo iconos', en: 'Collapsible sidebar with an icon-only rail' },
      { type: 'improvement', es: 'La sección Social se pliega en el contenedor de Friends: clic para abrir el feed, clic en un avatar para ver su perfil', en: 'The Social section folds into the Friends container: click it to open the feed, click an avatar to view their profile' },
      { type: 'improvement', es: 'Descubre y sigue a usuarios directamente desde el feed; la vista Users desaparece', en: 'Discover and follow users right from the feed; the Users view is gone' },
      { type: 'feature', es: 'El reproductor muestra el tiempo transcurrido y la duración del track en una barra animada; arrástrala para saltar a cualquier punto', en: 'The player shows elapsed time and track duration on an animated bar; drag it to jump to any point' },
      { type: 'fix', es: 'Al reproducir un artista, álbum o track desde la app, el reproductor se actualiza al momento (antes esperaba al siguiente sondeo)', en: 'Playing an artist, album or track from the app now updates the player right away (it used to wait for the next poll)' },
      { type: 'feature', es: 'Personaliza las vistas de detalle desde Ajustes: reordena, oculta y mueve entre columnas las secciones de artistas, álbumes y tracks', en: 'Customize detail views from Settings: reorder, hide and move sections between columns for artists, albums and tracks' },
      { type: 'feature', es: 'Auto-regenera tus playlists generadas: elige una cadencia diaria, semanal o mensual y SIS las actualiza solas en segundo plano (con aviso push al hacerlo)', en: 'Auto-regenerate your generated playlists: pick a daily, weekly or monthly cadence and SIS refreshes them on its own in the background (with a push notification when it does)' },
    ],
  },
  {
    version: '26w27y',
    publishedAt: '2026-07-02',
    title: 'Last.fm integration',
    changes: [
      { type: 'feature', es: 'Inicia sesión con Last.fm: nuevas cuentas sin depender del límite de usuarios de Spotify', en: 'Sign in with Last.fm: new accounts without depending on the Spotify user cap' },
      { type: 'feature', es: 'Vincula tu cuenta de Last.fm en Ajustes: los scrobbles rellenan los huecos que el sondeo de Spotify pierde', en: 'Link your Last.fm account in Settings: scrobbles fill the gaps Spotify polling misses' },
      { type: 'feature', es: 'Importa tu historial completo de scrobbles con un clic', en: 'Import your full scrobble history in one click' },
    ],
  },
  {
    version: '26w27k',
    publishedAt: '2026-07-01',
    title: 'Push notifications',
    changes: [
      { type: 'feature', es: 'Notificaciones push que te avisan de tus hitos: nuevos récords, cuando llegas al número 1 y el cierre semanal de tus listas', en: 'Push notifications that alert you to your milestones: new records, reaching number one and your weekly chart closings' },
      { type: 'feature', es: 'Activa las notificaciones y elige qué tipos recibir desde Ajustes (en el móvil y en el navegador)', en: 'Enable notifications and choose which types to receive from Settings (on mobile and in the browser)' },
    ],
  },
  {
    version: '26w24b',
    publishedAt: '2026-06-12',
    title: 'SIS on Android',
    changes: [
      { type: 'feature', es: 'App de Android: instala SIS y entra con Spotify desde el móvil', en: 'Android app: install SIS and sign in with Spotify from your phone' },
      { type: 'feature', es: 'Los enlaces de sis.mier.info abren directamente la app', en: 'sis.mier.info links open the app directly' },
      { type: 'improvement', es: 'Las barras del sistema siguen el tema claro/oscuro de la app', en: 'System bars follow the app light/dark theme' },
    ],
  },
  {
    version: '26w24a',
    publishedAt: '2026-06-08',
    title: 'Settings & privacy',
    changes: [
      { type: 'feature', es: 'Ajustes reorganizados en pestañas (general, sesiones, admin)', en: 'Settings reorganized into tabs (general, sessions, admin)' },
      { type: 'feature', es: 'Gestiona tus sesiones de login activas y cierra las demás', en: 'Manage your active login sessions and log out the others' },
      { type: 'feature', es: 'Nueva página de política de privacidad', en: 'New privacy policy page' },
    ],
  },
  {
    version: '26w23a',
    publishedAt: '2026-06-01',
    title: 'Social',
    changes: [
      { type: 'feature', es: 'Sigue a otros usuarios y mira su actividad en el feed', en: 'Follow other users and see their activity in the feed' },
      { type: 'feature', es: 'Perfiles públicos y comparativa de gustos entre usuarios', en: 'Public profiles and taste comparison between users' },
      { type: 'feature', es: 'Enlaces para compartir tu perfil sin necesidad de cuenta', en: 'Shareable profile links that need no account' },
      { type: 'fix', es: 'Compartir ya no copiaba URLs del origen local en el móvil', en: 'Sharing no longer copied local-origin URLs on mobile' },
    ],
  },
];
