/**
 * Rank agenda items by the time the official agenda allocates to them.
 *
 * The problem this solves: an agenda lists a sixteen-contract consent block and a
 * single staff report as sixteen lines against one. Counting lines makes the
 * consent block look like the meeting. The agenda itself says otherwise — the
 * consent block gets 1 minute and the report gets 35 — so time allocation, not
 * line count, is the district's own ranking of what the meeting is about.
 *
 * Minutes are published per section. An item inherits its section's allocation,
 * split evenly across the section's substantive children, unless the item states
 * its own allocation (some sub-items do, e.g. "Measure T Bond Program Update
 * (20 min)"). Where a section states no time at all, its items get a null weight
 * and sort below everything that has one — absent is not the same as zero, so
 * they are reported as unranked rather than dismissed.
 */

import { parseDuration } from './agenda-duration.mjs';

/** An item on the consent calendar is approved as a block, without discussion. */
export function isConsentItem(item) {
  return /consent/i.test(item.actionType || '') || /consent/i.test(item.category || '');
}

/**
 * Group a meeting's flat item list into sections with per-item time weights.
 *
 * @param {Array} items - meeting.items from meetings-data.json
 * @param {(item: object) => boolean} [isProcedural] - items to exclude from the
 *   ranking and from the split of a section's minutes (roll call, pledge, ...).
 * @returns {Array<{section: object|null, minutes: number|null, children: Array}>}
 *   sections in agenda order; each child carries `weightMinutes`.
 */
export function groupBySection(items, isProcedural = () => false) {
  const sections = [];
  let current = null;

  const open = (section) => {
    current = { section, minutes: section ? section.plannedMinutes ?? null : null, children: [] };
    sections.push(current);
    return current;
  };

  for (const item of items || []) {
    if (item.isSection) { open(item); continue; }
    if (!current) open(null);
    current.children.push(item);
  }

  for (const group of sections) {
    // A section with no children of its own is its own headline (the agenda gives
    // the time to the section line), so it competes on its full allocation.
    const substantive = group.children.filter((c) => !isProcedural(c));
    for (const child of group.children) {
      // Prefer the parsed field; fall back to the title for data written before
      // the parser learned the compound and parenthesized forms.
      const own = child.plannedMinutes ?? parseDuration(child.title).minutes;
      child.weightMinutes = own ?? (
        group.minutes != null && substantive.length > 0
          ? group.minutes / substantive.length
          : null
      );
    }
  }

  return sections;
}

/**
 * Flatten a meeting into substantive items ordered by time allocation, richest first.
 *
 * Consent items are collapsed: they are returned as a single entry describing the
 * block, because that is how the board takes them — one vote, no discussion.
 *
 * @returns {{ranked: Array, consent: Array, consentMinutes: number|null, unranked: Array}}
 */
export function rankItems(items, isProcedural = () => false) {
  const sections = groupBySection(items, isProcedural);

  const consent = [];
  let consentMinutes = null;
  const scored = [];

  for (const group of sections) {
    const sectionIsConsent = group.section ? isConsentItem(group.section) : false;
    const substantive = group.children.filter((c) => !isProcedural(c));

    if (sectionIsConsent || (substantive.length > 0 && substantive.every(isConsentItem))) {
      consent.push(...substantive);
      if (group.minutes != null) consentMinutes = (consentMinutes ?? 0) + group.minutes;
      continue;
    }

    if (substantive.length === 0) {
      // Section header with no sub-items: the section line is the item.
      if (group.section && group.minutes != null && !isProcedural(group.section)) {
        scored.push({ item: group.section, section: group.section, minutes: group.minutes });
      }
      continue;
    }

    for (const child of substantive) {
      if (isConsentItem(child)) { consent.push(child); continue; }
      scored.push({ item: child, section: group.section, minutes: child.weightMinutes });
    }
  }

  const ranked = scored.filter((s) => s.minutes != null)
    .sort((a, b) => b.minutes - a.minutes);
  const unranked = scored.filter((s) => s.minutes == null);

  return { ranked, consent, consentMinutes, unranked };
}
