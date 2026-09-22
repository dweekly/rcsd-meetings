import { parseDuration } from './lib/agenda-duration.mjs';

/**
 * Shared formal agenda parsing for Simbli board memos and BoardDocs scraped data.
 *
 * Both parsers produce a uniform item schema:
 *   { itemLabel, title, isSection, plannedMinutes, actionType, speaker, attachments }
 */

/** Decode common HTML entities in BoardDocs text. */
function decodeEntities(text) {
  return text
    .replace(/&#039;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(parseInt(n)))
    // &amp; must decode LAST: decoding it earlier turns &amp;lt; into &lt;
    // (and &amp;#60; into &#60;), which a later pass double-decodes into <.
    .replace(/&amp;/g, '&');
}

/**
 * Parse formal agenda from Simbli board memo items.
 *
 * Simbli memos have a flat `order` (sequential int) and titles like:
 *   "9. Approval of Bond Program Consent Items - 1 min"   (section header)
 *   "1. Approval of Steel Costs Change Order..."           (sub-item under section 9)
 *
 * Algorithm: track the highest prefix number seen. When a new prefix is higher,
 * it's a new section. When the prefix resets (drops), it's a sub-item under the
 * current section.
 *
 * @param {Array} memoItems - items array from board-memos/{date}.json
 * @returns {Array} structured agenda items
 */
export function parseSimbliAgenda(memoItems) {
  // Two-pass algorithm to distinguish section headers from sub-items.
  //
  // Pass 1: identify prefix numbers that appear with a time suffix ("- N min/hr").
  //         These are definitively section headers.
  // Pass 2: assign each item. A prefix is a section header if:
  //         - It has a time suffix (definite section), OR
  //         - Its prefix > highWaterMark AND the prefix is NOT claimed by a
  //           time-suffix item (which means the definite section hasn't appeared yet)

  const TIME_SUFFIX_RE = /\s*-\s*(\d+)\s*(min|hr|hour)s?\s*$/i;

  // Pass 1: collect all prefix numbers that have time suffixes
  const definiteSectionPrefixes = new Set();
  for (const item of memoItems) {
    const raw = item.title || '';
    const prefixMatch = raw.match(/^(\d+)\.\s*/);
    if (!prefixMatch) continue;
    const body = raw.slice(prefixMatch[0].length).trim();
    if (TIME_SUFFIX_RE.test(body)) {
      definiteSectionPrefixes.add(parseInt(prefixMatch[1]));
    }
  }

  // Pass 2: assign sections and sub-items
  const result = [];
  let currentSectionLabel = null;
  let currentSectionActionType = null;
  let highWaterMark = 0;
  // Track the last sub-item prefix to detect sub-item sequences that exceed
  // the parent section number. For example, a consent section numbered 15 may
  // have sub-items 1, 2, ..., 17, 18, 27. Once we see sub-item 17, we know
  // that item 18 is still a sub-item (17+1 == 18), not a new top-level section.
  let lastSubItemPrefix = null;

  for (const item of memoItems) {
    const raw = item.title || '';

    const prefixMatch = raw.match(/^(\d+)\.\s*/);
    if (!prefixMatch) {
      lastSubItemPrefix = null;
      result.push({
        itemLabel: String(item.order),
        title: raw.trim(),
        isSection: false,
        plannedMinutes: null,
        actionType: inferActionType(raw),
        speaker: item.memo?.Speaker || null,
        attachments: (item.attachments || []).map(a => ({
          title: a.name, aid: a.aid, filename: a.filename, href: a.href,
        })),
      });
      continue;
    }

    const prefixNum = parseInt(prefixMatch[1]);
    let titleBody = raw.slice(prefixMatch[0].length).trim();

    // Parse time suffix. TIME_SUFFIX_RE is the narrow form ("- 30 min") that also
    // marks a line as a section header, so it runs first and alone decides
    // hasTimeSuffix. parseDuration then catches the forms it does not cover
    // ("- 1 hr 20 min", "1.5 hrs", "(20 min)") for the minutes only, which keeps
    // section detection identical to what it was before durations got richer.
    let plannedMinutes = null;
    const timeSuffix = titleBody.match(TIME_SUFFIX_RE);
    if (timeSuffix) {
      const val = parseInt(timeSuffix[1]);
      plannedMinutes = timeSuffix[2].toLowerCase().startsWith('hr') || timeSuffix[2].toLowerCase().startsWith('hour')
        ? val * 60 : val;
      titleBody = titleBody.slice(0, -timeSuffix[0].length).trim();
    } else {
      const parsed = parseDuration(titleBody);
      if (parsed.minutes != null) {
        plannedMinutes = parsed.minutes;
        titleBody = parsed.title;
      }
    }

    const hasTimeSuffix = timeSuffix != null;

    // A sub-item continuation is when the prefix is exactly lastSubItemPrefix + 1.
    // This catches the case where sub-item numbers exceed the parent section number
    // (e.g., section 15 with sub-items 1..27: once we see 15.17, item "18" must
    // be 15.18 because 18 === 17 + 1, not a new top-level section 18).
    const isContinuation = lastSubItemPrefix !== null && prefixNum === lastSubItemPrefix + 1;

    // Determine if this is a section header:
    // - Must have prefix > highWaterMark (ascending section sequence)
    // - AND either has a time suffix (definite) or prefix is NOT claimed by a
    //   definite-section item (no time-suffix item exists with this prefix number)
    // - AND is NOT a continuation of the current sub-item sequence
    const isNewSection = prefixNum > highWaterMark &&
      (hasTimeSuffix || (!definiteSectionPrefixes.has(prefixNum) && !isContinuation));

    if (isNewSection) {
      highWaterMark = prefixNum;
      currentSectionLabel = String(prefixNum);
      lastSubItemPrefix = null;

      const sectionActionType = inferActionType(raw);
      // Track parent section type for child inheritance
      currentSectionActionType = sectionActionType;

      result.push({
        itemLabel: currentSectionLabel,
        title: titleBody,
        isSection: true,
        plannedMinutes,
        actionType: sectionActionType,
        speaker: item.memo?.Speaker || null,
        attachments: (item.attachments || []).map(a => ({
          title: a.name, aid: a.aid, filename: a.filename, href: a.href,
        })),
      });
    } else {
      const itemLabel = currentSectionLabel
        ? `${currentSectionLabel}.${prefixNum}`
        : String(prefixNum);

      lastSubItemPrefix = prefixNum;

      // Consent sections override children (items say "Approval of..." but are still consent).
      // For other sections (Information, Discussion), inherit if item has no clear type.
      let itemActionType;
      if (currentSectionActionType === 'Action (Consent)') {
        itemActionType = 'Action (Consent)';
      } else {
        const ownType = inferActionType(raw);
        itemActionType = ownType || currentSectionActionType;
      }

      result.push({
        itemLabel,
        title: titleBody,
        isSection: false,
        // Sub-items rarely state a time, but when one does it is that item's own
        // allocation rather than a share of its section's.
        plannedMinutes,
        actionType: itemActionType,
        speaker: item.memo?.Speaker || null,
        attachments: (item.attachments || []).map(a => ({
          title: a.name, aid: a.aid, filename: a.filename, href: a.href,
        })),
      });
    }
  }

  return result;
}

/**
 * Parse formal agenda from BoardDocs scraped meeting data.
 *
 * BoardDocs already has hierarchical `order` ("1.1", "6.2") and `category`/`actionType`.
 * Section headers are the `categories` array on the meeting object.
 *
 * @param {object} scrapedMeeting - a meeting object from boarddocs-scraped.json
 * @returns {Array} structured agenda items
 */
export function parseBoarddocsAgenda(scrapedMeeting) {
  const result = [];
  const categories = scrapedMeeting.categories || [];

  // Emit section headers from categories, interleaving with items
  const itemsByCategory = new Map();
  for (const item of (scrapedMeeting.items || [])) {
    const cat = item.category || '';
    if (!itemsByCategory.has(cat)) itemsByCategory.set(cat, []);
    itemsByCategory.get(cat).push(item);
  }

  for (const cat of categories) {
    // Parse section number from category order (e.g., "1.", "10.")
    const sectionNum = cat.order ? cat.order.replace(/\.$/, '') : null;

    // Parse planned minutes from category name
    let catName = decodeEntities(cat.name || '');
    const parsedCat = parseDuration(catName);
    const plannedMinutes = parsedCat.minutes;
    catName = parsedCat.title;

    // Emit section header
    result.push({
      itemLabel: sectionNum || '?',
      title: catName,
      isSection: true,
      plannedMinutes,
      actionType: null,
      speaker: null,
      attachments: [],
    });

    // Emit sub-items under this category
    const catItems = itemsByCategory.get(cat.name) || [];
    for (const item of catItems) {
      const parsedItem = parseDuration(decodeEntities(item.title));
      result.push({
        itemLabel: item.order || '?',
        title: parsedItem.title,
        isSection: false,
        plannedMinutes: parsedItem.minutes,
        actionType: item.actionType || null,
        speaker: null,
        attachments: (item.attachments || []).map(a => ({
          title: a.name, href: a.href, size: a.size,
        })),
        category: item.category ? decodeEntities(item.category) : null,
        url: item.url || null,
      });
    }
  }

  return result;
}

/**
 * Infer action type from Simbli title text.
 */
function inferActionType(title) {
  // Strip leading number prefix (e.g. "17. Information - 15 min" → "information - 15 min")
  const t = title.toLowerCase().replace(/^\d+\.\s*/, '');
  // Check consent BEFORE action — "Approval of Consent Items (Action Required)" is consent
  if (t.includes('consent')) return 'Action (Consent)';
  if (t.includes('(action required)')) return 'Action';
  if (t.includes('action required')) return 'Action';

  // Procedural patterns
  const procedural = [
    'call to order', 'roll call', 'pledge of allegiance', 'adjournment',
    'reconvene', 'welcome', 'changes to the agenda', 'report out',
  ];
  if (procedural.some(p => t.includes(p))) return 'Procedural';

  if (t.includes('public comment') || t.includes('public hearing')) return 'Information';
  if (t.includes('discussion')) return 'Discussion';

  // Information section patterns
  if (/^information\b/.test(t) || t.includes('school/community reports') ||
      t.includes('board and superintendent reports') || t.includes('correspondence') ||
      t.includes('other business') || t.includes('suggested items for future') ||
      t.includes('meeting reflection') || t.includes('meeting calendar')) return 'Information';

  if (t.includes('approval')) return 'Action';
  if (t.includes('adoption')) return 'Action';

  return null;
}
