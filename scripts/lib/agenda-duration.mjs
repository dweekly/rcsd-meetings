/**
 * Duration parsing for agenda item titles.
 *
 * Board agendas publish a time allocation for most sections, and occasionally for
 * individual sub-items. That allocation is the district's own statement of how
 * important an item is: a 35-minute report outranks a 1-minute consent block
 * holding sixteen contracts. Downstream consumers (summaries, rankings) use it,
 * so the number has to come out of the title reliably.
 *
 * The district writes it several ways, all seen in data/meetings-data.json:
 *   "Action Items (Action Required) - 1 hr 20 min"   compound
 *   "School/Community Reports - 1.5 hrs"             decimal
 *   "School/Community Reports 1 hr 30 min"           no separator
 *   "Measure T Bond Program Update (20 min)"         parenthesized, per sub-item
 *   "Closed Session at 5:50 PM - Approx. 1 hr"       hedged
 *
 * Note the "5:50 PM" in that last one: a clock time is not a duration, and the
 * patterns below deliberately require an explicit min/hr unit so start times are
 * never read as allocations.
 */

/** Number with optional decimal, e.g. "1", "1.5". */
const NUM = String.raw`\d+(?:\.\d+)?`;

/**
 * A duration phrase: hours, minutes, or hours followed by minutes.
 * Capture groups: 1 = hours (compound/hours-only), 2 = minutes (compound), 3 = minutes-only.
 */
const DURATION = String.raw`(?:(${NUM})\s*(?:hrs?|hours?)(?:\s*(${NUM})\s*(?:mins?|minutes?))?|(${NUM})\s*(?:mins?|minutes?))`;

/** Optional lead-in: a dash separator and/or an "approx." hedge. */
const LEAD = String.raw`(?:\s*[-–—:]\s*|\s+)(?:approx\.?|approximately|about)?\s*`;

/** Trailing "- 1 hr 20 min" / "1.5 hrs", anchored to end of title. */
const SUFFIX_RE = new RegExp(LEAD + DURATION + String.raw`\s*$`, 'i');

/** Trailing "(20 min)" / "( approx. 1 hr )", anchored to end of title. */
const PAREN_RE = new RegExp(
  String.raw`\s*[（(]\s*(?:approx\.?|approximately|about)?\s*` + DURATION + String.raw`\s*[)）]\s*$`,
  'i',
);

/**
 * Extract a trailing time allocation from an agenda title.
 *
 * @param {string} title - raw title text
 * @returns {{minutes: number|null, title: string}} minutes found (null if none),
 *   and the title with the duration phrase removed. The title is returned
 *   unchanged when nothing matched.
 */
export function parseDuration(title) {
  const text = String(title ?? '');
  // Parenthesized form first: "Update (20 min)" also satisfies the looser
  // suffix pattern, and matching that would leave a stray "(" behind.
  for (const re of [PAREN_RE, SUFFIX_RE]) {
    const m = text.match(re);
    if (!m) continue;
    const [, hoursCompound, minutesCompound, minutesOnly] = m;
    const minutes = hoursCompound !== undefined
      ? Math.round(parseFloat(hoursCompound) * 60 + parseFloat(minutesCompound ?? '0'))
      : Math.round(parseFloat(minutesOnly));
    // A zero-length allocation carries no signal and would divide badly downstream.
    if (!Number.isFinite(minutes) || minutes <= 0) return { minutes: null, title: text };
    return { minutes, title: text.slice(0, m.index).trim() };
  }
  return { minutes: null, title: text };
}
