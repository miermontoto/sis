// changelog "novedades" de sis: fuente de verdad hand-curated. el servicio
// (services/changelog.ts) siembra estas entradas en la tabla al arrancar.
// versión en formato snapshot (YYwWWx, igual que VERSION en constants.ts);
// publishedAt ISO; orden libre (la query ordena por fecha). bilingüe es/en
// aunque la UI de sis se renderiza en inglés.
import type { ChangelogEntryInput } from '@platform/changelog';

export const CHANGELOG: ChangelogEntryInput[] = [
  {
    version: '26w31ag',
    publishedAt: '2026-08-01',
    title: 'Merges responsive again',
    changes: [
      { type: 'fix', es: 'La interfaz de merges se quedaba esperando en cada clic. El aviso de impacto recalculaba tu ranking completo cada vez que marcabas una casilla, y ese cálculo bloqueaba el servidor entero, así que también se paraba todo lo demás. Ahora se calcula fuera del hilo principal y se reaprovecha entre clics: de más de un segundo por clic a unos milisegundos', en: 'The merge interface stalled on every click. The impact notice recalculated your entire ranking each time you ticked a box, and that calculation blocked the whole server, so everything else stalled with it. It is now computed off the main thread and reused between clicks: from over a second per click down to milliseconds' },
      { type: 'fix', es: 'Abrir el modal de merges volvía a pedir las sugerencias a la red cada vez, tardando entre un cuarto y medio segundo. Vuelven a servirse al instante desde caché, y se refrescan solas en cuanto creas, deshaces o inviertes un merge', en: 'Opening the merge modal hit the network for its suggestions every single time, taking a quarter to half a second. They are served instantly from cache again, and refresh on their own as soon as you create, undo or flip a merge' },
      { type: 'improvement', es: 'Deshacer un merge en Settings › Merges quita la fila al momento en vez de esperar a que responda el servidor', en: 'Undoing a merge in Settings › Merges removes the row immediately instead of waiting for the server to answer' },
    ],
  },
  {
    version: '26w31ae',
    publishedAt: '2026-07-29',
    title: 'Your all-time best position',
    changes: [
      { type: 'feature', es: 'La tarjeta "All" de artistas, álbumes y temas enseña ahora, junto a tu posición actual en el top de todos los tiempos, la mejor que ha llegado a tener nunca ("#21 ▲#9"). Pasando el ratón por encima se te dice en qué mes llegó ahí y se resalta ese punto en el gráfico de posición. Si no aparece nada es que está en su mejor momento ahora mismo', en: 'The "All" badge on artist, album and track pages now shows, next to your current all-time position, the best position it has ever reached ("#21 ▲#9"). Hovering it tells you which month it got there and highlights that point on the ranking chart. If nothing shows up, it is at its best right now' },
    ],
  },
  {
    version: '26w31ad',
    publishedAt: '2026-07-29',
    title: 'See the damage before merging',
    changes: [
      { type: 'feature', es: 'Antes de aplicar unos merges se te avisa de cómo van a mover tu ranking: cuántas entradas suben en tu top de todos los tiempos, cuáles son los mayores saltos y cuántas entran en el top 50. En el scan cada fila enseña además el salto concreto ("#212 → #74") y las escuchas que gana. Sale también al fusionar artistas, álbumes o temas desde el modal, en los tres pasos', en: 'Before you apply any merges you now get told how they will move your ranking: how many entries climb in your all-time top, which are the biggest jumps, and how many enter the top 50. In the scan each row also shows its own jump ("#212 → #74") and the plays it gains. It shows up when merging artists, albums or tracks from the modal too, on all three steps' },
      { type: 'feature', es: 'En el scan puedes invertir un par antes de crearlo con el botón ⇅: elige cuál de los dos temas se queda como bueno. Si varios duplicados caían en el mismo, el grupo entero se repunta al que elijas', en: 'In the scan you can flip a pair before creating it with the ⇅ button: pick which of the two tracks is the one that stays. If several duplicates were falling into the same one, the whole group repoints to the one you pick' },
      { type: 'fix', es: 'El botón "Rescan" no hacía nada: las vistas de merges se servían de la caché durante 10 minutos, así que devolvía el resultado anterior. Por lo mismo la lista no encogía al aplicar y la lista de Settings › Merges no se refrescaba tras invertir un merge. Ahora estas vistas van siempre a la red', en: 'The "Rescan" button did nothing: the merge views were served from cache for 10 minutes, so it handed back the previous result. For the same reason the list did not shrink after applying, and the Settings › Merges list did not refresh after swapping a merge. These views now always go to the network' },
      { type: 'fix', es: 'Al aplicar merges desde el scan no aparecía ninguna confirmación: se borraba en el mismo instante en que se creaba, al relanzarse el escaneo. Ahora se queda visible con cuántos merges se han creado', en: 'Applying merges from the scan showed no confirmation at all: it was wiped the instant it was created, when the scan re-ran. It now stays visible with how many merges were created' },
    ],
  },
  {
    version: '26w31ab',
    publishedAt: '2026-07-29',
    title: 'Swap a merge around',
    changes: [
      { type: 'feature', es: 'Ahora puedes darle la vuelta a un merge sin deshacerlo: el botón "Make canonical" (⇅) elige cuál de las entidades fusionadas manda, es decir, cuál da el nombre, la portada y la página que ves. Está en el aviso "Merged into..." de las páginas de artista, álbum y tema, en las filas de Settings › Merges y en la lista de fusionados del propio modal de merges', en: 'You can now flip a merge around without undoing it: the "Make canonical" (⇅) button picks which of the merged entities is the one in charge, the one that gives the group its name, cover and page. It lives in the "Merged into..." notice on artist, album and track pages, in the Settings › Merges rows, and in the merged list inside the merge modal itself' },
      { type: 'improvement', es: 'Si el grupo tiene varias entidades fusionadas, al promover una se repunta el grupo entero de una vez, así que no hay que deshacer nada a mano ni queda ninguna fusión colgando. Las reproducciones siguen sumando igual: lo único que cambia es cuál de ellas representa al grupo', en: 'If the group has several merged entities, promoting one repoints the whole group at once, so there is nothing to undo by hand and no merge is left dangling. Play counts keep adding up the same way: the only thing that changes is which one represents the group' },
      { type: 'improvement', es: 'Al cambiar el álbum canónico, los merges de temas que cruzaban esos dos álbumes se giran con él, para que el álbum que has elegido no acabe mostrando pistas fusionadas hacia las del álbum antiguo', en: 'When you change which album is canonical, the track merges that crossed those two albums flip with it, so the album you picked does not end up showing tracks that are merged into the old album\'s ones' },
    ],
  },
  {
    version: '26w31z',
    publishedAt: '2026-07-29',
    title: 'Bulk duplicate scan',
    changes: [
      { type: 'feature', es: 'Nueva página "Scan for duplicates" en Settings › Merges: busca temas duplicados en tus álbumes más escuchados de una sola pasada y te los presenta agrupados por álbum, en vez de tener que abrir el auto-merge álbum por álbum. Puedes elegir el alcance (top 100, 200, 500 o todos los álbumes con reproducciones) y aplicar todo lo que marques de una vez', en: 'New "Scan for duplicates" page under Settings › Merges: it finds duplicate songs across your most-played albums in one pass and groups them by album, instead of making you open auto-merge one album at a time. You pick the scope (top 100, 200, 500, or every album with plays) and apply everything you tick in one go' },
      { type: 'improvement', es: 'En el scan vienen marcados de partida sólo los duplicados por créditos (los del emparejado conservador); los de posición y parecido de nombre, que fallan más, quedan sin marcar para que los revises tú. Cada álbum se puede marcar o desmarcar entero, y los contadores de arriba seleccionan un tipo concreto de golpe', en: 'The scan pre-ticks only the credit duplicates (the ones from the conservative matcher); position and name-similarity matches, which are more error-prone, start unticked for you to review. Each album can be ticked or unticked as a whole, and the counters at the top select one kind at a time' },
    ],
  },
  {
    version: '26w31x',
    publishedAt: '2026-07-29',
    title: 'Duplicate tracks in one album',
    changes: [
      { type: 'feature', es: 'El auto-merge de tracks ahora también detecta duplicados dentro de un mismo álbum: el mismo tema repetido con IDs y nombres distintos, típicamente uno acreditando a los invitados y otro no ("Walk On Water" y "Walk On Water (feat. Beyoncé)"). Antes sólo se comparaban tracks de álbumes distintos, así que estas parejas eran invisibles y el tema aparecía dos veces en tu top con las escuchas partidas', en: 'Track auto-merge now also finds duplicates inside a single album: the same song repeated under different IDs and names, typically one crediting the featured artists and one not ("Walk On Water" and "Walk On Water (feat. Beyoncé)"). It only ever compared tracks across different albums before, so those pairs were invisible and the song showed up twice in your top with its plays split' },
      { type: 'improvement', es: 'Ya no hace falta haber fusionado álbumes para usar el auto-merge: la opción "Auto-merge tracks" está disponible en cualquier álbum y escanea también sus propias pistas', en: 'You no longer need merged albums to use auto-merge: the "Auto-merge tracks" option is available on any album and scans its own tracks too' },
      { type: 'improvement', es: 'Las parejas detectadas por duplicado se marcan con "=" para distinguirlas de las emparejadas por posición ("#") o por parecido de nombre ("~"). El emparejado es conservador a propósito: una versión en directo, un remix o una remasterización nunca se fusionan con la de estudio, y dos temas con duraciones muy distintas tampoco', en: 'Pairs found as duplicates are tagged with "=" to tell them apart from those matched by position ("#") or by name similarity ("~"). The matching is deliberately conservative: a live version, a remix or a remaster never merges into the studio take, and neither do two tracks with clearly different lengths' },
    ],
  },
  {
    version: '26w31v',
    publishedAt: '2026-07-28',
    title: 'Snappier now playing',
    changes: [
      { type: 'fix', es: 'Al saltar de tema, la tarjeta de "now playing" podía tardar hasta un minuto en cambiar, y a veces volvía un rato al tema anterior antes de acertar: el servidor sólo releía Spotify cuando le tocaba por reloj, así que ninguna acción tuya (siguiente, anterior, play, pausa, seek o cambio de dispositivo) le hacía mirar antes. Ahora cualquiera de esas acciones fuerza una relectura inmediata', en: 'When you skipped a song, the now playing card could take up to a minute to change, and sometimes flipped back to the previous song for a while before settling: the server only re-read Spotify on its own schedule, so nothing you did (next, previous, play, pause, seek or switching device) made it look sooner. Any of those actions now forces an immediate re-read' },
      { type: 'fix', es: 'Un tema terminado tardaba hasta 5 minutos en aparecer en tu historial, porque sólo se guardaba en el barrido periódico de reproducciones recientes. Ahora, en cuanto se detecta que el tema ha acabado, se vuelca al historial en segundos', en: 'A finished song took up to 5 minutes to show up in your history, because it was only saved on the periodic recently-played sweep. Now, as soon as a song is detected as finished, it lands in your history within seconds' },
      { type: 'improvement', es: 'El cambio de tema al acabar uno se nota casi al instante: la tarjeta sabe cuándo va a terminar y comprueba justo en ese momento, en vez de esperar a su siguiente refresco', en: 'The switch to the next song at the end of a track now shows up almost instantly: the card knows when the song is due to end and checks right then, instead of waiting for its next refresh' },
    ],
  },
  {
    version: '26w31s',
    publishedAt: '2026-07-28',
    title: 'Exact top playlists',
    changes: [
      { type: 'fix', es: 'Las playlists de "Top Tracks", "Top Artist" y "Top Genre" no daban tu top real: pedían 2,5 veces más temas de los que querías y luego sorteaban entre ellos, así que con 50 tracks en YTD sólo la mitad eran de tu top 50 y el orden era aleatorio. Ahora devuelven tu top exacto, en orden de ranking y coincidiendo con lo que ves en Top', en: 'The "Top Tracks", "Top Artist" and "Top Genre" playlists were not giving you your actual top: they pulled 2.5× more tracks than you asked for and then drew at random from those, so a 50-track YTD playlist was only half your real top 50 and the order was random. They now return your exact top, in ranking order, matching what you see on Top' },
      { type: 'feature', es: 'Nuevo selector "Selección" en el generador de playlists: top exacto (por defecto en las estrategias de ranking) o aleatorio, que sortea entre un pool 2,5 veces mayor para que la lista cambie cada vez que la regeneras (por defecto en deep cuts, time vibes y rediscovery)', en: 'New "Selection" picker in the playlist generator: exact top (the default for the ranking strategies) or random, which draws from a 2.5× larger pool so the list changes every time you regenerate it (the default for deep cuts, time vibes and rediscovery)' },
      { type: 'improvement', es: 'Las playlists generadas tienen en cuenta los merges de tracks: las escuchas de un tema fusionado suman a su versión canónica en vez de repartirse, y ya no pueden aparecer las dos copias del mismo tema en la misma lista', en: 'Generated playlists are now aware of track merges: plays of a merged song add up on its canonical version instead of being split, and both copies of the same song can no longer land in the same list' },
    ],
  },
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
