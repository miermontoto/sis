// changelog "novedades" de sis: fuente de verdad hand-curated, servida tal cual
// por GET /api/changelog (sin tabla ni estado por usuario). versión en formato
// snapshot (YYwWWx, igual que VERSION en constants.ts); publishedAt ISO; orden
// libre (el cliente las pinta en el orden del array). bilingüe es/en aunque la
// UI de sis se renderiza en inglés. una línea por cambio: qué cambia para el
// usuario, sin explicar la causa.
import type { ChangelogEntry } from '@platform/changelog';

export const CHANGELOG: ChangelogEntry[] = [
  {
    version: '26w32c',
    publishedAt: '2026-08-06',
    title: 'No more blank tiles',
    changes: [
      { type: 'fix', es: 'El mosaico de portadas por mes ya no deja huecos en blanco', en: 'The monthly cover mosaic no longer leaves blank tiles' },
    ],
  },
  {
    version: '26w32b',
    publishedAt: '2026-08-06',
    title: 'Rerank: the top you wish you had',
    changes: [
      { type: 'feature', es: 'Nuevo generador "Rerank": arrastra tu top de artistas, álbumes o temas al orden que te gustaría y te dice cuánto tiempo y cuántas escuchas le falta a cada puesto', en: 'New "Rerank" generator: drag your top artists, albums or tracks into the order you wish they had and it tells you the listening time and plays each position needs' },
      { type: 'feature', es: 'El plan de escuchas del Rerank se convierte en una playlist de Spotify de un clic', en: 'The Rerank listening plan turns into a Spotify playlist in one click' },
    ],
  },
  {
    version: '26w32a',
    publishedAt: '2026-08-05',
    title: 'Every artist on the chart',
    changes: [
      { type: 'improvement', es: 'Los charts de canciones listan todos los artistas del tema, no solo el principal', en: 'Track charts list every artist on the song, not just the lead one' },
    ],
  },
  {
    version: '26w31ai',
    publishedAt: '2026-08-01',
    title: 'Quieter release notes',
    changes: [
      { type: 'improvement', es: 'Las novedades ya no se abren solas al entrar: se leen cuando quieras, pulsando el número de versión del menú lateral', en: 'What\'s new no longer opens on its own when you log in: read it whenever you like from the version number in the sidebar' },
      { type: 'improvement', es: 'Cada cambio se resume en una línea en vez de un párrafo', en: 'Each change is a single line now instead of a paragraph' },
    ],
  },
  {
    version: '26w31ah',
    publishedAt: '2026-08-01',
    title: 'No fake singles on local albums',
    changes: [
      { type: 'fix', es: 'Los álbumes locales (setlists, bootlegs) ya no listan como suyos los singles de adelanto del artista', en: 'Local albums (setlists, bootlegs) no longer list the artist\'s advance singles as their own' },
    ],
  },
  {
    version: '26w31ag',
    publishedAt: '2026-08-01',
    title: 'Merges responsive again',
    changes: [
      { type: 'fix', es: 'El aviso de impacto de los merges ya no bloquea el servidor: de más de un segundo por clic a unos milisegundos', en: 'The merge impact notice no longer blocks the server: from over a second per click down to milliseconds' },
      { type: 'fix', es: 'Las sugerencias del modal de merges vuelven a servirse al instante desde caché', en: 'Merge modal suggestions are served instantly from cache again' },
      { type: 'improvement', es: 'Deshacer un merge en Settings › Merges quita la fila al momento', en: 'Undoing a merge in Settings › Merges removes the row immediately' },
    ],
  },
  {
    version: '26w31ae',
    publishedAt: '2026-07-29',
    title: 'Your all-time best position',
    changes: [
      { type: 'feature', es: 'La tarjeta "All" enseña la mejor posición que ha llegado a tener un artista, álbum o tema ("#21 ▲#9")', en: 'The "All" badge shows the best position an artist, album or track has ever reached ("#21 ▲#9")' },
    ],
  },
  {
    version: '26w31ad',
    publishedAt: '2026-07-29',
    title: 'See the damage before merging',
    changes: [
      { type: 'feature', es: 'Antes de aplicar merges se te avisa de cómo van a mover tu ranking, con el salto de cada fila ("#212 → #74")', en: 'Before applying merges you see how they will move your ranking, with each row\'s jump ("#212 → #74")' },
      { type: 'feature', es: 'En el scan puedes invertir un par con ⇅ antes de crearlo: eliges cuál de los dos temas se queda', en: 'In the scan you can flip a pair with ⇅ before creating it: pick which of the two tracks stays' },
      { type: 'fix', es: 'El botón "Rescan" no hacía nada: las vistas de merges se servían de caché durante 10 minutos', en: 'The "Rescan" button did nothing: merge views were served from cache for 10 minutes' },
      { type: 'fix', es: 'Aplicar merges desde el scan deja visible la confirmación con cuántos se han creado', en: 'Applying merges from the scan leaves the confirmation visible with how many were created' },
    ],
  },
  {
    version: '26w31ab',
    publishedAt: '2026-07-29',
    title: 'Swap a merge around',
    changes: [
      { type: 'feature', es: 'Nuevo botón "Make canonical" (⇅): elige cuál de las entidades fusionadas da nombre, portada y página', en: 'New "Make canonical" (⇅) button: pick which of the merged entities gives the group its name, cover and page' },
      { type: 'improvement', es: 'Promover una entidad repunta el grupo entero de una vez, sin deshacer nada a mano', en: 'Promoting one entity repoints the whole group at once, with nothing to undo by hand' },
      { type: 'improvement', es: 'Al cambiar el álbum canónico, los merges de temas entre esos dos álbumes se giran con él', en: 'When the canonical album changes, track merges between those two albums flip with it' },
    ],
  },
  {
    version: '26w31z',
    publishedAt: '2026-07-29',
    title: 'Bulk duplicate scan',
    changes: [
      { type: 'feature', es: 'Nueva página "Scan for duplicates" en Settings › Merges: busca temas duplicados en tus álbumes más escuchados de una pasada', en: 'New "Scan for duplicates" page under Settings › Merges: finds duplicate songs across your most-played albums in one pass' },
      { type: 'improvement', es: 'El scan viene marcado solo con los duplicados por créditos; los de posición y nombre los revisas tú', en: 'The scan pre-ticks only credit duplicates; position and name matches are left for you to review' },
    ],
  },
  {
    version: '26w31x',
    publishedAt: '2026-07-29',
    title: 'Duplicate tracks in one album',
    changes: [
      { type: 'feature', es: 'El auto-merge detecta duplicados dentro de un mismo álbum ("Walk On Water" y "Walk On Water (feat. Beyoncé)")', en: 'Auto-merge finds duplicates inside a single album ("Walk On Water" and "Walk On Water (feat. Beyoncé)")' },
      { type: 'improvement', es: 'La opción "Auto-merge tracks" está disponible en cualquier álbum, no solo en los fusionados', en: 'The "Auto-merge tracks" option is available on any album, not just merged ones' },
      { type: 'improvement', es: 'Cada pareja indica cómo se emparejó: duplicado ("="), posición ("#") o parecido de nombre ("~")', en: 'Each pair shows how it was matched: duplicate ("="), position ("#") or name similarity ("~")' },
    ],
  },
  {
    version: '26w31v',
    publishedAt: '2026-07-28',
    title: 'Snappier now playing',
    changes: [
      { type: 'fix', es: 'Saltar, pausar o cambiar de dispositivo actualiza el "now playing" al momento, sin esperar al siguiente sondeo', en: 'Skipping, pausing or switching device updates now playing right away, without waiting for the next poll' },
      { type: 'fix', es: 'Un tema terminado aparece en tu historial en segundos, en vez de tardar hasta 5 minutos', en: 'A finished song lands in your history within seconds instead of taking up to 5 minutes' },
      { type: 'improvement', es: 'La tarjeta sabe cuándo va a acabar el tema y comprueba justo en ese momento', en: 'The card knows when a song is due to end and checks right then' },
    ],
  },
  {
    version: '26w31s',
    publishedAt: '2026-07-28',
    title: 'Exact top playlists',
    changes: [
      { type: 'fix', es: 'Las playlists "Top Tracks", "Top Artist" y "Top Genre" devuelven tu top exacto y en orden, no un sorteo', en: 'The "Top Tracks", "Top Artist" and "Top Genre" playlists return your exact top in order, not a random draw' },
      { type: 'feature', es: 'Nuevo selector "Selección" en el generador de playlists: top exacto o aleatorio', en: 'New "Selection" picker in the playlist generator: exact top or random' },
      { type: 'improvement', es: 'Las playlists generadas tienen en cuenta los merges: ya no salen dos copias del mismo tema', en: 'Generated playlists are merge-aware: both copies of the same song can no longer appear' },
    ],
  },
  {
    version: '26w31j',
    publishedAt: '2026-07-27',
    title: 'Bracket and tier list',
    changes: [
      { type: 'feature', es: 'Nuevo generator "March Madness": un cuadro de eliminación de hasta 64 puestos que decides tú, descargable como imagen', en: 'New "March Madness" generator: a knockout bracket of up to 64 that you decide yourself, downloadable as an image' },
      { type: 'feature', es: 'El cuadro se sortea entre tus 50, 100 o 200 más escuchados, o lo montas a mano con búsquedas o una discografía entera', en: 'The bracket is drawn from your top 50, 100 or 200, or built by hand from searches or a whole discography' },
      { type: 'feature', es: 'Nuevo generator "Tier List": arrastra artistas, álbumes o tracks a filas que puedes renombrar, recolorear y reordenar', en: 'New "Tier List" generator: drag artists, albums or tracks into rows you can rename, recolour and reorder' },
      { type: 'feature', es: 'Los elementos de la tier list salen de tu top, de un sorteo, de una búsqueda o de la discografía de un artista', en: 'Tier list items can come from your top, a random draw, a search or an artist\'s discography' },
      { type: 'fix', es: 'Los generators antiguos cancelan sus peticiones al cambiar de rango: una respuesta vieja ya no pisa los datos nuevos', en: 'The older generators cancel their requests when you change range: a stale response no longer overwrites fresh data' },
    ],
  },
  {
    version: '26w31a',
    publishedAt: '2026-07-27',
    title: 'Album singles',
    changes: [
      { type: 'feature', es: 'La página de un álbum lista sus singles de adelanto en una sección propia, en orden de lanzamiento', en: 'An album page lists its advance singles in their own section, in release order' },
    ],
  },
  {
    version: '26w30d',
    publishedAt: '2026-07-23',
    title: 'Release markers',
    changes: [
      { type: 'feature', es: 'Las gráficas de las vistas de detalle marcan las fechas de lanzamiento con la carátula sobre la línea', en: 'Detail view charts mark release dates with the cover art above the line' },
    ],
  },
  {
    version: '26w30c',
    publishedAt: '2026-07-20',
    title: 'Manual scrobbles',
    changes: [
      { type: 'feature', es: 'Registra a mano la escucha de un track o de un álbum entero, con la fecha y hora que elijas', en: 'Hand-log a play of a track or a whole album, at the date and time you choose' },
    ],
  },
  {
    version: '26w29v',
    publishedAt: '2026-07-15',
    title: 'Last.fm parity',
    changes: [
      { type: 'feature', es: 'Las cuentas de solo Last.fm muestran su "sonando ahora" en la app y en el feed de amigos', en: 'Last.fm-only accounts show their "now playing" in the app and the friends feed' },
      { type: 'fix', es: 'Las notificaciones de hitos llegan también a las cuentas de solo Last.fm', en: 'Milestone notifications reach Last.fm-only accounts too' },
      { type: 'improvement', es: 'El historial de Last.fm se enriquece con duraciones y géneros aunque no haya cuenta de Spotify', en: 'Last.fm history gets durations and genres even with no Spotify account linked' },
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
      { type: 'feature', es: 'El reproductor muestra el tiempo transcurrido en una barra animada; arrástrala para saltar a cualquier punto', en: 'The player shows elapsed time on an animated bar; drag it to jump to any point' },
      { type: 'fix', es: 'Al reproducir algo desde la app, el reproductor se actualiza al momento', en: 'Playing something from the app updates the player right away' },
      { type: 'feature', es: 'Personaliza las vistas de detalle desde Ajustes: reordena, oculta y mueve entre columnas sus secciones', en: 'Customize detail views from Settings: reorder, hide and move their sections between columns' },
      { type: 'feature', es: 'Auto-regenera tus playlists generadas con cadencia diaria, semanal o mensual', en: 'Auto-regenerate your generated playlists on a daily, weekly or monthly cadence' },
      { type: 'improvement', es: 'Las listas de tracks de un álbum muestran los artistas invitados de cada track', en: 'Track lists on an album page show each track\'s featured artists' },
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
      { type: 'feature', es: 'Notificaciones push de tus hitos: nuevos récords, número 1 y cierre semanal de tus listas', en: 'Push notifications for your milestones: new records, number one and your weekly chart closings' },
      { type: 'feature', es: 'Activa las notificaciones y elige qué tipos recibir desde Ajustes', en: 'Enable notifications and choose which types to receive from Settings' },
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
