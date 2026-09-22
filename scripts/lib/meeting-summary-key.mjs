/**
 * The key a meeting's summary is stored under, in data/meeting-summaries.json
 * and data/meeting-summaries-es.json.
 *
 * Almost always the date. When two meetings share one date — a special session
 * before a regular meeting, say — the date cannot identify either, so both are
 * keyed by slug instead.
 *
 * This lives here because more than one generator writes those files, and a
 * second implementation of the rule would quietly write summaries under keys
 * that nothing reads.
 */

/**
 * @param {{date: string, slug: string}} meeting
 * @param {Array<{date: string}>} allMeetings - every meeting, to spot shared dates
 * @returns {string} the storage key
 */
export function getSummaryKey(meeting, allMeetings) {
  const sameDateMeetings = allMeetings.filter(m => m.date === meeting.date);
  if (sameDateMeetings.length > 1) {
    return meeting.slug;
  }
  return meeting.date;
}

/**
 * Read a summary for a meeting, tolerating the older files that keyed some
 * entries by date and others by slug.
 *
 * @returns {string|undefined}
 */
export function lookupSummary(summaries, meeting, allMeetings) {
  const key = getSummaryKey(meeting, allMeetings);
  return summaries[key] ?? summaries[meeting.date] ?? summaries[meeting.slug];
}
