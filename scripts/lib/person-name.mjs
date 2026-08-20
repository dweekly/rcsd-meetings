/**
 * Person-name normalization, shared by the freshness prober and its guard.
 *
 * RCSD school sites are inconsistent about courtesy titles: Roy Cloud lists
 * "Ms. Melissa Bowdoin" and "Mrs. Joanne Ongoco" while every other school lists
 * bare names. Comparing raw strings would report drift every run for a person
 * who has not changed. So comparison runs on a normalized key while the site's
 * exact string is what gets stored and shown in a diff.
 *
 * Earned doctorates are NOT courtesy titles and are kept: `data/schools.json`
 * and `data/trustees.json` both carry "Dr." in display names, and dropping it
 * would make the published name differ from the district's own usage.
 */

/**
 * Courtesy titles stripped before comparison. Deliberately excludes Dr./Ed.D.
 * — see the module comment.
 */
const COURTESY_TITLES = ['mr', 'mrs', 'ms', 'miss', 'mx'];

/** Decode the small set of HTML entities Finalsite emits in heading text. */
export function decodeEntities(s) {
  const named = {
    amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ',
    aacute: 'á', eacute: 'é', iacute: 'í', oacute: 'ó', uacute: 'ú',
    ntilde: 'ñ', uuml: 'ü', Aacute: 'Á', Eacute: 'É', Iacute: 'Í',
    Oacute: 'Ó', Uacute: 'Ú', Ntilde: 'Ñ', rsquo: '’', lsquo: '‘',
    ldquo: '“', rdquo: '”', ndash: '–', mdash: '—',
  };
  return String(s)
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(Number(d)))
    .replace(/&#x([0-9a-fA-F]+);/g, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&([a-zA-Z]+);/g, (m, n) => (n in named ? named[n] : m));
}

/**
 * Comparison key for a person's name: courtesy titles dropped, accents folded,
 * punctuation and case flattened. "Ms. Melissa Bowdoin" and "Melissa Bowdoin"
 * share a key; "Dr. Luis Arreola" and "Nick Fanourgiakis" do not.
 */
export function nameKey(name) {
  const words = decodeEntities(name)
    // Drop post-nominals: the district writes the same person as "Wendy Kelly"
    // in one place and "Wendy Kelly, MPA, MA" in another, and credentials get
    // added over time. Everything after the first comma is a credential list,
    // not part of the name.
    .split(',')[0]
    .normalize('NFD').replace(/\p{Diacritic}/gu, '')  // fold á -> a
    .toLowerCase()
    .replace(/[.,]/g, ' ')
    .split(/\s+/)
    .filter(Boolean);
  while (words.length > 1 && COURTESY_TITLES.includes(words[0])) words.shift();
  return words.join(' ');
}

/** True when two names refer to the same person under {@link nameKey}. */
export function sameName(a, b) {
  return Boolean(a) && Boolean(b) && nameKey(a) === nameKey(b);
}

/**
 * Site-style display form: courtesy titles dropped so a scraped name matches
 * the house style already used across data/schools.json, accents preserved.
 */
export function displayName(name) {
  const raw = decodeEntities(name).trim().replace(/\s+/g, ' ');
  const words = raw.split(' ');
  while (words.length > 1 && COURTESY_TITLES.includes(words[0].toLowerCase().replace(/[.,]/g, ''))) {
    words.shift();
  }
  return words.join(' ');
}
