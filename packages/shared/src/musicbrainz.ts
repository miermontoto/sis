// helpers puros para consultar musicbrainz (la red y la db viven en la api)

// la búsqueda /recording de musicbrainz es lucene: "/" abre un regex, "()" agrupan,
// ":" separa campo y valor... un título con cualquiera de ellos cambia el sentido de
// la query en vez de buscarse literal ("One Way/Stolen Dance" devolvía "The Contract"
// con score 100; "House Of Gold (Demo)" devolvía "Doubt (demo)"). cada campo va
// citado como frase: dentro de una frase sólo escapan la barra invertida y la comilla
const escapeLucenePhrase = (s: string) => s.replace(/\\/g, '\\\\').replace(/"/g, '\\"');

export const mbRecordingQuery = (title: string, artist: string) =>
  `recording:"${escapeLucenePhrase(title)}" AND artist:"${escapeLucenePhrase(artist)}"`;

// igualdad de títulos tolerante a mayúsculas, diacríticos y puntuación ("Doubt (Demo)"
// = "Doubt (demo)", "The Run And Go" = "The Run and Go") pero no a palabras de más o
// de menos ("Murder, Murder (Remix)" ≠ "Murder Murder", "Tally/Believe" ≠ "Tally")
export const normalizeTitle = (s: string) =>
  s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^\p{L}\p{N}]+/gu, ' ').trim();

export const sameTitle = (a: string, b: string) => normalizeTitle(a) === normalizeTitle(b);

// el título sin el sufijo de remasterización con que spotify nombra la misma toma
// ("Tomorrow - Remastered", "X - 2011 Remaster", "X (Remasterizada)"). musicbrainz no lleva
// ese sufijo en el título, así que la búsqueda citada no encuentra nada. sólo este sufijo:
// " - Demo", " - Live …" o un remix son OTRA grabación, y el título base daría su duración mal.
// la lookbehind ancla el inicio tras un carácter: con un \s* suelto, cada espacio de una racha
// reintentaba hasta el final de la racha (cuadrático, 80k espacios en un título que llega por
// scrobble bloqueaban 42s el hilo principal), y un título que es sólo el sufijo quedaba vacío
const REMASTER_SUFFIX = /(?<=\S)\s*(?:-\s+|\()(?:\d{4}\s+)?(?:digital\s+)?remaster(?:ed|izad[ao])?(?:\s+(?:\d{4}|version))?\)?\s*$/i;

export const withoutRemasterSuffix = (title: string) => title.replace(REMASTER_SUFFIX, '');
