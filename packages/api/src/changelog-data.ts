// changelog "novedades" de sis: fuente de verdad hand-curated. el servicio
// (services/changelog.ts) siembra estas entradas en la tabla al arrancar.
// versión en formato snapshot (YYwWWx, igual que VERSION en constants.ts);
// publishedAt ISO; orden libre (la query ordena por fecha). bilingüe es/en
// aunque la UI de sis se renderiza en inglés.
import type { ChangelogEntryInput } from '@platform/changelog';

export const CHANGELOG: ChangelogEntryInput[] = [
  {
    version: '26w31j',
    publishedAt: '2026-07-27',
    title: 'Bracket and tier list',
    changes: [
      { type: 'feature', es: 'Nuevo generator "March Madness": siembra tus artistas, tracks o álbumes más escuchados en un cuadro de eliminación directa de hasta 64 puestos y ve eligiendo ganador enfrentamiento a enfrentamiento hasta coronar un campeón (las reproducciones y las horas se muestran como pista, pero decides tú). Al terminar puedes descargar el cuadro completo como imagen', en: 'New "March Madness" generator: seed your most-played artists, tracks or albums into a knockout bracket of up to 64 and pick a winner matchup by matchup until you crown a champion (plays and hours are shown as a hint, but the call is yours). When you finish you can download the full bracket as an image' },
      { type: 'feature', es: 'El cuadro de March Madness no tiene por qué salir de tu top: en modo aleatorio se sortea entre tus 50, 100 o 200 más escuchados, con más papeletas para lo que de verdad pones, así que la mayoría del cuadro son temas que llevabas tiempo sin recordar. Puedes volver a sortear sin recargar', en: 'A March Madness bracket does not have to be your top entries: random mode draws from your top 50, 100 or 200, weighting what you actually play, so most of the field ends up being things you had half-forgotten. You can redraw without reloading' },
      { type: 'feature', es: 'Nuevo generator "Tier List": arrastra artistas, álbumes o tracks a filas de tiers que puedes renombrar, recolorear, reordenar y añadir o quitar a tu gusto. En móvil, toca un elemento y luego la fila donde quieras dejarlo. La lista se descarga como imagen', en: 'New "Tier List" generator: drag artists, albums or tracks into tier rows you can rename, recolour, reorder, and add or remove at will. On mobile, tap an item and then the row you want it in. The list downloads as an image' },
      { type: 'feature', es: 'Los elementos de la tier list salen de donde quieras: tu top (20, 50 o 100), un sorteo aleatorio de un pool más profundo, una búsqueda para añadir cosas sueltas a mano, o la discografía entera de un artista (con álbumes y singles por separado)', en: 'Tier list items can come from wherever you want: your top (20, 50 or 100), a random draw from a deeper pool, a search to add individual things by hand, or an artist\'s whole discography (albums and singles toggled separately)' },
      { type: 'feature', es: 'El cuadro de March Madness también se puede montar a mano: busca artistas, álbumes o tracks sueltos, o mete la discografía entera de un artista para decidir de una vez cuál es su mejor disco. El tamaño del cuadro se ajusta solo a lo que metas', en: 'A March Madness bracket can also be built by hand: search for individual artists, albums or tracks, or drop in an artist\'s whole discography to settle which of their records is best. The bracket sizes itself to whatever you add' },
      { type: 'fix', es: 'Los generators antiguos (album quilt, artist velocity, bubbles, pie chart y receipt) no cancelaban sus peticiones al cambiar de rango u opciones, así que una respuesta vieja podía llegar tarde y pisar los datos nuevos', en: 'The older generators (album quilt, artist velocity, bubbles, pie chart and receipt) were not cancelling their requests when you changed range or options, so a stale response could arrive late and overwrite the fresh data' },
    ],
  },
  {
    version: '26w31a',
    publishedAt: '2026-07-27',
    title: 'Album singles',
    changes: [
      { type: 'feature', es: 'La página de un álbum lista sus singles de adelanto en una sección propia, en orden de lanzamiento y con lo que has escuchado cada tema (cuenta también las reproducciones de su copia en el álbum, que es donde suelen registrarse)', en: 'An album page lists its advance singles in their own section, in release order and with how much you have played each song (counting plays of the album\'s copy too, which is where they usually land)' },
    ],
  },
  {
    version: '26w30d',
    publishedAt: '2026-07-23',
    title: 'Release markers',
    changes: [
      { type: 'feature', es: 'Las gráficas de las vistas de detalle marcan las fechas de lanzamiento con la carátula sobre la línea: todos los álbumes y singles del artista en su página, la salida del álbum y sus singles de adelanto en la página del álbum, y las ediciones donde aparece el track en la suya (pasa el ratón por una carátula para ver el nombre, o haz clic para abrir el álbum)', en: 'Detail view charts mark release dates with the cover art above the line: every album and single by the artist on their page, the album\'s release and its advance singles on the album page, and the editions a track appears on in its own (hover a cover to see the name, or click it to open the album)' },
    ],
  },
  {
    version: '26w30c',
    publishedAt: '2026-07-20',
    title: 'Manual scrobbles',
    changes: [
      { type: 'feature', es: 'Añade scrobbles manuales desde el historial: registra a mano la escucha de un track o de un álbum entero, con la fecha y hora que elijas', en: 'Add manual scrobbles from your history: hand-log a play of a track or a whole album, at the date and time you choose' },
    ],
  },
  {
    version: '26w29v',
    publishedAt: '2026-07-15',
    title: 'Last.fm parity',
    changes: [
      { type: 'feature', es: 'Las cuentas de solo Last.fm muestran su "sonando ahora" en la app y en el feed de amigos (tarjeta de solo lectura, sin controles de Spotify)', en: 'Last.fm-only accounts show their "now playing" in the app and the friends feed (read-only card, no Spotify controls)' },
      { type: 'fix', es: 'Las notificaciones de hitos (récords, número 1 y cierres semanales de listas) ya llegan también a las cuentas de solo Last.fm', en: 'Milestone notifications (records, number one and weekly chart closings) now reach Last.fm-only accounts too' },
      { type: 'improvement', es: 'El historial de Last.fm se enriquece con duraciones y géneros desde Last.fm y MusicBrainz, aunque no haya ninguna cuenta de Spotify vinculada', en: 'Last.fm history gets durations and genres from Last.fm and MusicBrainz, even with no Spotify account linked' },
    ],
  },
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
      { type: 'improvement', es: 'Las listas de tracks en la página de un álbum muestran los artistas invitados de cada track, no solo el artista principal del álbum', en: 'Track lists on an album page show each track\'s featured artists, not just the album\'s main artist' },
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
