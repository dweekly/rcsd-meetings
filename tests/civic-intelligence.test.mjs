import assert from 'node:assert/strict';
import { readFileSync, existsSync, rmSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { describe, it } from 'node:test';

import {
  extractPublicCommentInfo,
  extractMeetingTimes,
  extractTopHeadlines,
  isClosedSessionAgendaItem,
  buildWhatsAppNotice,
  loadParticipationContext,
} from '../scripts/lib/meeting-participation.mjs';

import {
  attachmentInventory,
  expandItemLabels,
  extractDollarAmounts,
  readMemoField,
  screenConsentCalendar,
  validateDocketBrief,
} from '../scripts/lib/docket-brief.mjs';

import {
  isAmbiguousDiarizationLabel,
  validateDeliberationRecap,
  formatTimestamp,
  findUnresolvedEvidenceFiles,
} from '../scripts/lib/deliberation-recap.mjs';

import {
  subscriberHashId,
  computeMeetingDigestHash,
  buildRfc8058Headers,
  createSubscriptionStore,
  requestSubscription,
  confirmSubscription,
  unsubscribeByToken,
  evaluateAndRecordDispatch,
} from '../scripts/lib/alert-subscriptions.mjs';

import {
  resolveSourceRegime,
  buildReconciledMeetingDataset,
} from '../platform/lib/reconcile-meetings.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');

const meetingsData = JSON.parse(readFileSync(resolve(ROOT, 'data/meetings-data.json'), 'utf-8'));
const meetingsByDate = new Map(meetingsData.meetings.map((m) => [m.date, m]));
const participationCtx = loadParticipationContext(ROOT);

describe('Stage 1 — Immediate RCSD Participation Utility & Unified ICS', () => {
  it('dynamically detects Public Comment section across historical and modern agendas and disambiguates EN/ES Google Forms', () => {
    const m20261028 = meetingsByDate.get('2026-10-28');
    const m20260624 = meetingsByDate.get('2026-06-24');
    assert.ok(m20261028, '2026-10-28 meeting should exist');
    assert.ok(m20260624, '2026-06-24 meeting should exist');

    const rulesOct = extractPublicCommentInfo(m20261028, participationCtx.memosByDate['2026-10-28']);
    assert.ok(rulesOct.generalComment, 'Public comment rules extracted for 2026-10-28');
    assert.equal(rulesOct.generalComment.sectionLabel, '5');
    assert.equal(rulesOct.generalComment.formUrlEn, 'https://forms.gle/8T3u7KA7xJurWakB7');
    assert.equal(rulesOct.generalComment.formUrlEs, 'https://forms.gle/FAXi2G9mBDBRWxsi7');
    assert.equal(rulesOct.generalComment.minutesPerSpeaker, 3);

    const rulesJun = extractPublicCommentInfo(m20260624, participationCtx.memosByDate['2026-06-24']);
    assert.ok(rulesJun.generalComment, 'Public comment rules extracted for 2026-06-24 (Section 9)');
    assert.equal(rulesJun.generalComment.sectionLabel, '9');
    assert.equal(rulesJun.generalComment.formUrlEn, 'https://forms.gle/gMSiytW1abM9n33e8');
    assert.equal(rulesJun.generalComment.formUrlEs, 'https://forms.gle/CYDWUEU2nKHPDS8Y7');
  });

  it('distinguishes Closed Session vs Open Session start times across regular and study session meetings', () => {
    const m20260810 = meetingsByDate.get('2026-08-10');
    const m20261028 = meetingsByDate.get('2026-10-28');
    const m20260930 = meetingsByDate.get('2026-09-30');

    const timesAug10 = extractMeetingTimes(
      m20260810,
      participationCtx.memosByDate['2026-08-10'],
      participationCtx.announcedIndex,
    );
    assert.equal(timesAug10.closedSession?.time24, '18:20');
    assert.equal(timesAug10.openSession?.time24, '19:00');
    assert.equal(timesAug10.primaryStart?.time24, '19:00');

    const timesOct = extractMeetingTimes(
      m20261028,
      participationCtx.memosByDate['2026-10-28'],
      participationCtx.announcedIndex,
    );
    assert.equal(timesOct.openSession?.time24, '19:00');
    assert.equal(timesOct.primaryStart?.time24, '19:00');

    const timesSep30 = extractMeetingTimes(
      m20260930,
      participationCtx.memosByDate['2026-09-30'],
      participationCtx.announcedIndex,
    );
    assert.equal(timesSep30.primaryStart?.time24, '18:00');
  });

  it('excludes Closed Session items from extractTopHeadlines() and WhatsApp share copy', () => {
    assert.equal(
      isClosedSessionAgendaItem({ title: '2.1 Public Employee Discipline/Dismissal/Release (Gov. Code §54957)' }),
      true,
    );
    assert.equal(
      isClosedSessionAgendaItem({ title: '9.1 Human Resources and Staffing Levels Update' }),
      false,
    );

    const m20261028 = meetingsByDate.get('2026-10-28');
    const topHeadlines = extractTopHeadlines(
      m20261028,
      participationCtx.memosEsByDate['2026-10-28'],
      participationCtx.agendaTitlesEs,
      3,
    );
    assert.equal(topHeadlines.headlines.length, 3);
    for (const h of topHeadlines.headlines) {
      assert.equal(
        isClosedSessionAgendaItem({ title: h.titleEn }),
        false,
        `Closed session item leaked into headlines: ${h.titleEn}`,
      );
    }

    const timesOct = extractMeetingTimes(
      m20261028,
      participationCtx.memosByDate['2026-10-28'],
      participationCtx.announcedIndex,
    );
    const pcOct = extractPublicCommentInfo(m20261028, participationCtx.memosByDate['2026-10-28']);

    const waEn = buildWhatsAppNotice({
      meeting: m20261028,
      dateFormattedEn: 'Wednesday, October 28, 2026',
      dateFormattedEs: 'miércoles, 28 de octubre de 2026',
      localTypeEn: 'Regular Meeting',
      localTypeEs: 'Reunión Ordinaria',
      canonicalUrlEn: 'https://rcsd.info/meetings/2026-10-28/',
      canonicalUrlEs: 'https://rcsd.info/reuniones/2026-10-28/',
      times: timesOct,
      publicComment: pcOct,
      topHeadlines,
      lang: 'en',
    });
    const waEs = buildWhatsAppNotice({
      meeting: m20261028,
      dateFormattedEn: 'Wednesday, October 28, 2026',
      dateFormattedEs: 'miércoles, 28 de octubre de 2026',
      localTypeEn: 'Regular Meeting',
      localTypeEs: 'Reunión Ordinaria',
      canonicalUrlEn: 'https://rcsd.info/meetings/2026-10-28/',
      canonicalUrlEs: 'https://rcsd.info/reuniones/2026-10-28/',
      times: timesOct,
      publicComment: pcOct,
      topHeadlines,
      lang: 'es',
    });

    assert.doesNotMatch(waEn.text, /Public Employee Discipline/i);
    assert.match(waEn.text, /Human Resources and Staffing Levels Update/);
    assert.match(waEs.text, /Recursos Humanos|Dotaci[óo]n de Personal/i);
  });

  it('emits unified UIDs and verified start times in docs/board-meetings.ics and docs/reuniones-junta.ics', () => {
    const icsEn = readFileSync(resolve(ROOT, 'docs/board-meetings.ics'), 'utf-8');
    const icsEs = readFileSync(resolve(ROOT, 'docs/reuniones-junta.ics'), 'utf-8');

    // Unified UID format across published (2026-10-28) and provisional (2026-11-18) meetings
    assert.match(icsEn, /UID:board-meeting-2026-10-28@rcsd\.info/);
    assert.match(icsEn, /UID:board-meeting-2026-11-18@rcsd\.info/);
    assert.doesNotMatch(icsEn, /UID:provisional-/);

    // Verified start times: 18:00 for 2026-09-30 Study Session, 19:00 for 2026-10-28 Open Session
    assert.match(icsEn, /UID:board-meeting-2026-09-30@rcsd\.info[\s\S]*?DTSTART;TZID=America\/Los_Angeles:20260930T180000/);
    assert.match(icsEn, /UID:board-meeting-2026-10-28@rcsd\.info[\s\S]*?DTSTART;TZID=America\/Los_Angeles:20261028T190000/);
    assert.match(icsEs, /UID:board-meeting-2026-10-28@rcsd\.info[\s\S]*?DTSTART;TZID=America\/Los_Angeles:20261028T190000/);
  });

  it('renders bilingual Participation Banner and Meetings Index Calendar Callout in docs/', () => {
    const htmlEn = readFileSync(resolve(ROOT, 'docs/meetings/2026-10-28/index.html'), 'utf-8');
    const htmlEs = readFileSync(resolve(ROOT, 'docs/reuniones/2026-10-28/index.html'), 'utf-8');

    assert.match(htmlEn, /id="participation-heading"/);
    assert.match(htmlEn, /How to Attend, Speak & Share This Meeting/);
    assert.match(htmlEn, /https:\/\/forms\.gle\/8T3u7KA7xJurWakB7/);
    assert.match(htmlEn, /Copy Notice Text/);

    assert.match(htmlEs, /id="participation-heading"/);
    assert.match(htmlEs, /Cómo asistir, hablar y compartir esta reunión/);
    assert.match(htmlEs, /https:\/\/forms\.gle\/FAXi2G9mBDBRWxsi7/);
    assert.match(htmlEs, /Copiar texto del aviso/);

    const indexEn = readFileSync(resolve(ROOT, 'docs/meetings/index.html'), 'utf-8');
    const indexEs = readFileSync(resolve(ROOT, 'docs/reuniones/index.html'), 'utf-8');
    assert.match(indexEn, /Get Meeting Reminders & Bilingual Pre-Meeting Notices/);
    assert.match(indexEs, /Reciba recordatorios de reuniones y avisos en español o inglés/);
  });
});

describe('Stage 2 — Pre-Meeting Packet Digest & 100% Consent Calendar Screening', () => {
  it('screens 100% of consent items and flags dollar thresholds, policy revisions, and charter/parcel tax items', () => {
    const m20261028 = meetingsByDate.get('2026-10-28');
    const m20260923 = meetingsByDate.get('2026-09-23');

    const amounts = extractDollarAmounts('Total of $3,625,840.29 and $295,000');
    assert.deepEqual(amounts.map((a) => a.amount), [3625840.29, 295000]);

    const screenOct = screenConsentCalendar(
      m20261028,
      participationCtx.memosByDate['2026-10-28'],
      participationCtx.memosEsByDate['2026-10-28'],
    );
    assert.equal(screenOct.totalConsentItems, 23);
    assert.equal(screenOct.flaggedItems.length + screenOct.routineItems.length, 23);
    assert.ok(screenOct.flaggedItems.length >= 6, 'Should flag policy, charter, and contract items on 2026-10-28');

    const screenSep = screenConsentCalendar(
      m20260923,
      participationCtx.memosByDate['2026-09-23'],
      participationCtx.memosEsByDate['2026-09-23'],
    );
    assert.equal(screenSep.totalConsentItems, 16);
    assert.equal(screenSep.flaggedItems.length + screenSep.routineItems.length, 16);
    assert.ok(screenSep.flaggedItems.length >= 4, 'Should flag high-value contracts on 2026-09-23');
  });

  it('validates all generated data/docket-briefs/*.json files and renders Packet Digest in EN & ES', () => {
    const index = JSON.parse(readFileSync(resolve(ROOT, 'data/docket-briefs/index.json'), 'utf-8'));
    assert.ok(index.briefs.length >= 4);

    for (const entry of index.briefs) {
      const brief = JSON.parse(readFileSync(resolve(ROOT, entry.path), 'utf-8'));
      const result = validateDocketBrief(brief);
      assert.equal(result.valid, true, `Docket brief ${entry.date} failed validation: ${JSON.stringify(result.errors)}`);

      // Grounded validation: citations resolve to archived attachments, Simbli MIDs match,
      // and every automated consent flag is spotlighted or explicitly excepted.
      const memo = participationCtx.memosByDate[entry.date];
      assert.ok(memo, `board memo for ${entry.date} should load`);
      const meeting = meetingsByDate.get(entry.date);
      const screen = screenConsentCalendar(meeting, memo, participationCtx.memosEsByDate[entry.date]);
      const grounded = validateDocketBrief(brief, {
        attachmentFilenames: attachmentInventory(memo),
        meetingMid: memo.mid,
        automatedFlags: screen.flaggedItems,
      });
      assert.equal(
        grounded.valid,
        true,
        `Docket brief ${entry.date} failed grounded validation: ${JSON.stringify(grounded.errors)}`,
      );
    }

    const htmlEn = readFileSync(resolve(ROOT, 'docs/meetings/2026-10-28/index.html'), 'utf-8');
    const htmlEs = readFileSync(resolve(ROOT, 'docs/reuniones/2026-10-28/index.html'), 'utf-8');
    assert.match(htmlEn, /id="packet-digest"/);
    assert.match(htmlEn, /Reviewed Board Packet Digest & Consent Calendar Spotlight/);
    assert.match(htmlEn, /100% Consent Calendar Screening \(18 of 23 items spotlighted/);
    assert.match(htmlEs, /id="packet-digest"/);
    assert.match(htmlEs, /Resumen Verificado del Paquete de la Junta y Calendario de Consentimiento/);
    assert.match(htmlEs, /Revisión del 100% del Calendario de Consentimiento \(18 de 23 puntos destacados/);
  });

  it('rejects citations outside the meeting attachment inventory, foreign Simbli MIDs, uncovered consent flags, and mis-ordered top items', () => {
    const date = '2026-10-14';
    const memo = participationCtx.memosByDate[date];
    const meeting = meetingsByDate.get(date);
    const screen = screenConsentCalendar(meeting, memo, participationCtx.memosEsByDate[date]);
    const brief = JSON.parse(readFileSync(resolve(ROOT, `data/docket-briefs/${date}.json`), 'utf-8'));
    const ctx = {
      attachmentFilenames: attachmentInventory(memo),
      meetingMid: memo.mid,
      automatedFlags: screen.flaggedItems,
    };
    assert.equal(validateDocketBrief(brief, ctx).valid, true, 'baseline brief should pass grounded validation');
    const clone = () => JSON.parse(JSON.stringify(brief));
    const messages = (doc) => validateDocketBrief(doc, ctx).errors.map((e) => e.message).join(' | ');

    // 1. A plausible-looking but non-archived filename fails, on topItems and on spotlights.
    const badFile = clone();
    badFile.topItems[0].citations[0].filename = 'Health-and-Wellness-Board-Presentation-10.14.26.pdf';
    assert.match(messages(badFile), /not an archived attachment of the 2026-10-14 meeting/);
    const badSpot = clone();
    badSpot.consentScreening.spotlightItems[0].citations[0].filename = 'MIT-Solar-Project-Phase-2-CO-3.pdf';
    assert.match(messages(badSpot), /MIT-Solar-Project-Phase-2-CO-3\.pdf" is not an archived attachment/);

    // 2. An R2 board-packet URL for a file that is not archived fails even without a filename.
    const badUrl = clone();
    delete badUrl.topItems[0].citations[0].filename;
    badUrl.topItems[0].citations[0].r2Url = 'https://data.rcsd.info/board-packets/2026-10-14/Not-A-Real-File.pdf';
    assert.match(messages(badUrl), /Board-packet URL file "Not-A-Real-File\.pdf"/);

    // 3. A Simbli URL carrying another meeting's MID fails.
    const badMid = clone();
    badMid.consentScreening.spotlightItems[0].citations.push({
      labelEn: 'x',
      url: 'https://simbli.eboardsolutions.com/SB_Meetings/ViewMeeting.aspx?S=36030397&MID=51864',
      extractionStatus: 'text-extracted',
    });
    assert.match(messages(badMid), /MID 51864 does not match this meeting's MID 77696/);

    // 4. Dropping the spotlight for an automated flag (11.6, $218,880) fails unless it is a reviewed exception.
    assert.ok(screen.flaggedItems.some((f) => f.itemLabel === '11.6'), 'screener should flag 11.6');
    const uncovered = clone();
    uncovered.consentScreening.spotlightItems = uncovered.consentScreening.spotlightItems.filter((s) => s.itemLabel !== '11.6');
    assert.match(messages(uncovered), /flagged consent item 11\.6 .* neither spotlighted nor listed in reviewedExceptions/);
    uncovered.consentScreening.reviewedExceptions = [{ itemLabel: '11.6', reasonEn: 'Reviewed.', reasonEs: 'Revisado.' }];
    assert.equal(validateDocketBrief(uncovered, ctx).valid, true, 'a bilingual reviewed exception covers the flag');
    uncovered.consentScreening.reviewedExceptions = [{ itemLabel: '11.6', reasonEn: 'Reviewed.' }];
    assert.match(messages(uncovered), /Both reasonEn and reasonEs are required/);

    // 5. Ranges in spotlight labels cover each item; top items must be time-ordered.
    assert.deepEqual(expandItemLabels('10.12–10.22').length, 11);
    assert.deepEqual(expandItemLabels('6.1 & 11.1–11.3'), ['6.1', '11.1', '11.2', '11.3']);
    const misordered = clone();
    misordered.topItems.reverse();
    assert.match(messages(misordered), /ordered by allocatedMinutes/);
  });

  it('reads Spanish memo section names (with English fallback) for consent screening', () => {
    assert.equal(readMemoField({ 'Impacto Financiero': 'Ninguno.' }, 'financialImpact', 'es'), 'Ninguno.');
    assert.equal(readMemoField({ 'Impacto financiero': 'Ninguno.' }, 'financialImpact', 'es'), 'Ninguno.');
    assert.equal(readMemoField({ 'Resumen ejecutivo / Extracto': 'Resumen.' }, 'summary', 'es'), 'Resumen.');
    assert.equal(readMemoField({ 'Financial Impact': 'None.' }, 'financialImpact', 'es'), 'None.');

    const date = '2026-10-28';
    const screen = screenConsentCalendar(
      meetingsByDate.get(date),
      participationCtx.memosByDate[date],
      participationCtx.memosEsByDate[date],
    );
    const items = [...screen.flaggedItems, ...screen.routineItems];
    assert.equal(items.length, 23);
    for (const it of items) {
      assert.ok(it.summaryEs, `${it.itemLabel} should have a Spanish summary`);
      assert.ok(it.financialImpactEs, `${it.itemLabel} should have a Spanish financial impact`);
    }
    const kipp = items.find((it) => it.itemLabel === '10.4');
    assert.match(kipp.financialImpactEs, /\$156,326\.00/);
  });
});

describe('Stage 3 — Evidence-Typed Post-Meeting Deliberation Recap & Diarization Hygiene', () => {
  it('blocks ambiguous, generic, or slash-delimited speaker labels and enforces interval-verified attribution', () => {
    assert.equal(isAmbiguousDiarizationLabel('Speaker A'), true);
    assert.equal(isAmbiguousDiarizationLabel('UNKNOWN'), true);
    assert.equal(isAmbiguousDiarizationLabel('Speaker A / Speaker B'), true);
    assert.equal(isAmbiguousDiarizationLabel('President David Weekly / Finance Staff'), true);
    assert.equal(isAmbiguousDiarizationLabel('CBO Rick Edson'), false);
    assert.equal(isAmbiguousDiarizationLabel('Assistant Superintendent Anna Herrera'), false);
    assert.equal(formatTimestamp(6484), '1:48:04');
    assert.equal(formatTimestamp(308), '5:08');

    const index = JSON.parse(readFileSync(resolve(ROOT, 'data/deliberation-recaps/index.json'), 'utf-8'));
    assert.ok(index.recaps.length >= 3);

    for (const entry of index.recaps) {
      const recap = JSON.parse(readFileSync(resolve(ROOT, entry.path), 'utf-8'));
      const result = validateDeliberationRecap(recap);
      assert.equal(result.valid, true, `Deliberation recap ${entry.date} failed validation: ${JSON.stringify(result.errors)}`);
    }

    // Verify 2026-09-23 attributes Unaudited Actuals (6450s) to CBO Rick Edson, not top-level Speaker D collision ("David Li")
    const recapSep23 = JSON.parse(readFileSync(resolve(ROOT, 'data/deliberation-recaps/2026-09-23.json'), 'utf-8'));
    const item94 = recapSep23.items.find((i) => i.itemLabel === '9.4 & 9.5');
    assert.ok(item94);
    assert.match(item94.discussion.highlights[1].speakerLabelEn, /Chief Business Official Rick Edson/);

    // Verify 2026-09-30 attributes K-5 Assessment presentation (2467s) to Assistant Superintendent Anna Herrera, not Speaker B collision ("Evelyn Sanchez")
    const recapSep30 = JSON.parse(readFileSync(resolve(ROOT, 'data/deliberation-recaps/2026-09-30.json'), 'utf-8'));
    const item61 = recapSep30.items.find((i) => i.itemLabel === '6.1');
    assert.ok(item61);
    assert.match(item61.discussion.highlights[0].speakerLabelEn, /Assistant Superintendent Anna Herrera/);
  });

  it('resolves every recap citation and minutes URL to a real archived board-memo attachment', () => {
    const loadMemos = (date) => {
      const p = resolve(ROOT, `data/board-memos/${date}.json`);
      return existsSync(p) ? JSON.parse(readFileSync(p, 'utf-8')) : null;
    };
    const index = JSON.parse(readFileSync(resolve(ROOT, 'data/deliberation-recaps/index.json'), 'utf-8'));
    for (const entry of index.recaps) {
      const recap = JSON.parse(readFileSync(resolve(ROOT, entry.path), 'utf-8'));
      assert.deepEqual(findUnresolvedEvidenceFiles(recap, loadMemos), [], `${entry.date} has unresolved evidence files`);
    }

    // An invented filename (the one the 10/14 recap first cited for the KIPP petition) is caught
    const recapOct14 = JSON.parse(readFileSync(resolve(ROOT, 'data/deliberation-recaps/2026-10-14.json'), 'utf-8'));
    const kipp = recapOct14.items.find((i) => i.itemLabel === '8.1');
    assert.equal(kipp.proposal.citations[0].filename, 'KIPP-Excelencia-Charter-Renewal-Packet.pdf');
    const broken = structuredClone(recapOct14);
    broken.items.find((i) => i.itemLabel === '8.1').proposal.citations[0].filename =
      'KIPP-Excelencia-Charter-Renewal-Petition-2027-2032.pdf';
    broken.items[0].minutes_reconciled.minutesUrl = 'https://data.rcsd.info/board-packets/2026-10-14/Made-Up-Minutes.pdf';
    const unresolved = findUnresolvedEvidenceFiles(broken, loadMemos);
    assert.deepEqual(
      unresolved.map((u) => u.filename).sort(),
      ['KIPP-Excelencia-Charter-Renewal-Petition-2027-2032.pdf', 'Made-Up-Minutes.pdf'],
    );

    // A meeting with no archived memo manifest cannot resolve anything
    assert.equal(findUnresolvedEvidenceFiles({ ...broken, date: '1999-01-01' }, loadMemos)[0].reason, 'no data/board-memos/1999-01-01.json');
  });

  it('declares transcript, packet and minutes as separately hashed provenance sources', () => {
    const prov = JSON.parse(readFileSync(resolve(ROOT, 'data/provenance/rcsd.deliberation-recaps.json'), 'utf-8'));
    const byId = new Map(prov.sources.map((s) => [s.sourceId, s]));
    for (const date of ['2026-09-23', '2026-09-30', '2026-10-14']) {
      const transcript = byId.get(`rcsd.transcript.${date}`);
      assert.equal(transcript?.snapshot.path, `artifacts/transcripts-slim/${date}.json`);
      assert.equal(transcript.url, `https://data.rcsd.info/transcripts/${date}.json`);
      const packet = byId.get(`rcsd.simbli.board-memos.${date}`);
      assert.equal(packet?.snapshot.path, `data/board-memos/${date}.json`);
      assert.notEqual(transcript.hash, packet.hash);
      // The recording itself is not archived, so it must not claim a hash
      assert.equal(byId.get(`rcsd.youtube.recording.${date}`)?.hash, undefined);
    }
    assert.equal(byId.get('rcsd.simbli.minutes.2026-09-23')?.snapshot.path, 'artifacts/board-packets/2026-10-28/2026.09.23-Minutes-DRAFT.pdf');
    assert.equal(byId.get('rcsd.simbli.minutes.2026-09-30')?.snapshot.path, 'artifacts/board-packets/2026-10-14/2026.09.30-Minutes-DRAFT.pdf');
    assert.equal(byId.has('rcsd.simbli.minutes.2026-10-14'), false, '10/14 minutes are not yet published');

    // Committed board memos are hashed as they stand
    for (const s of prov.sources.filter((x) => x.snapshot?.path.startsWith('data/'))) {
      const actual = 'sha256:' + createHash('sha256').update(readFileSync(resolve(ROOT, s.snapshot.path))).digest('hex');
      assert.equal(s.hash, actual, `${s.sourceId} hash must match ${s.snapshot.path}`);
    }
    // Every hashed source is a lineage input with the same hash
    for (const s of prov.sources.filter((x) => x.hash)) {
      assert.ok(prov.lineage.inputs.some((i) => i.sourceId === s.sourceId && i.hash === s.hash), `${s.sourceId} lineage input`);
    }
  });

  it('renders Deliberation Recap with clickable video seek buttons and preserves template-literal regex backslashes', () => {
    const htmlEn = readFileSync(resolve(ROOT, 'docs/meetings/2026-10-14/index.html'), 'utf-8');
    const htmlEs = readFileSync(resolve(ROOT, 'docs/reuniones/2026-10-14/index.html'), 'utf-8');

    assert.match(htmlEn, /id="deliberation-recap"/);
    assert.match(htmlEn, /Evidence-Typed Post-Meeting Deliberation Recap/);
    assert.match(htmlEn, /class="tv-seek-btn" data-seek-sec="2848"/);
    assert.match(htmlEs, /id="deliberation-recap"/);
    assert.match(htmlEs, /Recapitulación Post-Reunión con Evidencia Separada/);

    // AGENTS.md rule: verify client JS emitted from template literal preserves \s+ regex backslashes
    assert.ok(
      htmlEn.includes('var sentences = text.match(/[^.!?]*[.!?]+(?:\\s+|$)/g)'),
      'Emitted client JS must preserve \\s+ backslash in sentence regex',
    );
  });
});

describe('Stage 4 — Durable Opt-In Alert State Machine & Workers Text-Agent KV Suppression', () => {
  it('enforces double opt-in, RFC 8058 headers, stale-meeting expiry, and (meetingSlug, digestHash) idempotency', () => {
    const store = createSubscriptionStore();
    const req = requestSubscription(store, {
      recipient: 'Parent@Example.org ',
      lang: 'es',
      channel: 'email',
      nowIso: '2026-10-25T18:00:00.000Z',
    });
    assert.equal(req.status, 'pending');
    assert.equal(req.subscriberId, subscriberHashId('parent@example.org'));

    // Pending subscriber cannot receive alerts before confirming double opt-in
    const m20261028 = meetingsByDate.get('2026-10-28');
    const digestHash = computeMeetingDigestHash(m20261028);
    const pendingEval = evaluateAndRecordDispatch(store, {
      subscriberId: req.subscriberId,
      meetingSlug: '2026-10-28-regular',
      meetingDate: '2026-10-28',
      digestHash,
      todayDate: '2026-10-27',
    });
    assert.equal(pendingEval.dispatch, false);
    assert.equal(pendingEval.reason, 'subscriber-pending-confirmation');

    // Wrong token rejected
    assert.equal(confirmSubscription(store, 'wrong-token').ok, false);

    // Valid confirmation transitions pending -> active
    const confirmed = confirmSubscription(store, req.verifyToken, '2026-10-25T18:30:00.000Z');
    assert.equal(confirmed.ok, true);
    assert.equal(confirmed.status, 'active');

    // RFC 8058 one-click headers
    const headers = buildRfc8058Headers(`https://rcsd.info/api/alerts/unsubscribe?token=${req.unsubscribeToken}`);
    assert.match(headers['List-Unsubscribe'], /^<https:\/\/rcsd\.info\/api\/alerts\/unsubscribe\?token=/);
    assert.equal(headers['List-Unsubscribe-Post'], 'List-Unsubscribe=One-Click');

    // Stale meeting guard blocks alerts when meetingDate < todayDate
    const staleEval = evaluateAndRecordDispatch(store, {
      subscriberId: req.subscriberId,
      meetingSlug: '2026-10-28-regular',
      meetingDate: '2026-10-28',
      digestHash,
      todayDate: '2026-10-29',
    });
    assert.equal(staleEval.dispatch, false);
    assert.equal(staleEval.reason, 'stale-meeting-expired');

    // Fresh pre-meeting alert allowed once, then deduplicated on (meetingSlug, digestHash)
    const freshEval = evaluateAndRecordDispatch(store, {
      subscriberId: req.subscriberId,
      meetingSlug: '2026-10-28-regular',
      meetingDate: '2026-10-28',
      digestHash,
      todayDate: '2026-10-27',
    });
    assert.equal(freshEval.dispatch, true);
    assert.equal(freshEval.reason, 'initial-notice');

    const dupEval = evaluateAndRecordDispatch(store, {
      subscriberId: req.subscriberId,
      meetingSlug: '2026-10-28-regular',
      meetingDate: '2026-10-28',
      digestHash,
      todayDate: '2026-10-27',
    });
    assert.equal(dupEval.dispatch, false);
    assert.equal(dupEval.reason, 'duplicate-digest-suppressed');

    // Material addendum (different digestHash) triggers material-addendum-update
    const addendumEval = evaluateAndRecordDispatch(store, {
      subscriberId: req.subscriberId,
      meetingSlug: '2026-10-28-regular',
      meetingDate: '2026-10-28',
      digestHash: 'sha256:new-addendum-hash',
      todayDate: '2026-10-27',
    });
    assert.equal(addendumEval.dispatch, true);
    assert.equal(addendumEval.reason, 'material-addendum-update');

    // Unsubscribe blocks future dispatches
    const unsubbed = unsubscribeByToken(store, req.unsubscribeToken, 'rfc8058-one-click');
    assert.equal(unsubbed.ok, true);
    assert.equal(unsubbed.status, 'unsubscribed');

    const suppressedEval = evaluateAndRecordDispatch(store, {
      subscriberId: req.subscriberId,
      meetingSlug: '2026-11-18-regular',
      meetingDate: '2026-11-18',
      digestHash: 'sha256:nov-hash',
      todayDate: '2026-11-16',
    });
    assert.equal(suppressedEval.dispatch, false);
    assert.equal(suppressedEval.reason, 'subscriber-suppressed');
  });

  it('rejects confirmation tokens revoked by unsubscribe or superseded by a newer request', () => {
    const store = createSubscriptionStore();
    const first = requestSubscription(store, { recipient: 'a@example.org', nowIso: '2026-10-25T18:00:00.000Z' });
    const second = requestSubscription(store, { recipient: 'a@example.org', nowIso: '2026-10-25T18:05:00.000Z' });
    assert.notEqual(first.verifyToken, second.verifyToken);
    assert.equal(store.tokens[`verify:${first.verifyToken}`], undefined, 'superseded token lookup must be deleted');
    assert.equal(confirmSubscription(store, first.verifyToken).ok, false, 'superseded token must not confirm');
    assert.equal(store.subscribers[second.subscriberId].status, 'pending');

    // request -> unsubscribe -> confirm(old token) must not lift the suppression
    const unsub = unsubscribeByToken(store, second.unsubscribeToken, 'sms-stop');
    assert.equal(unsub.status, 'unsubscribed');
    assert.equal(store.tokens[`verify:${second.verifyToken}`], undefined, 'unsubscribe must delete the verify token lookup');
    assert.equal(confirmSubscription(store, second.verifyToken).ok, false);
    assert.equal(store.subscribers[second.subscriberId].status, 'unsubscribed');
    const blocked = evaluateAndRecordDispatch(store, {
      subscriberId: second.subscriberId,
      meetingSlug: '2026-11-04-regular',
      meetingDate: '2026-11-04',
      digestHash: 'sha256:x',
      todayDate: '2026-11-02',
    });
    assert.equal(blocked.reason, 'subscriber-suppressed');

    // Even a stale lookup entry that points at the record cannot confirm a token the record no longer holds
    store.tokens[`verify:${first.verifyToken}`] = first.subscriberId;
    assert.equal(confirmSubscription(store, first.verifyToken).ok, false);

    // A fresh opt-in after unsubscribing works only with the newest token
    const fresh = requestSubscription(store, { recipient: 'a@example.org', nowIso: '2026-10-26T18:00:00.000Z' });
    assert.equal(fresh.status, 'pending');
    assert.equal(confirmSubscription(store, fresh.verifyToken).ok, true);
    assert.equal(store.subscribers[fresh.subscriberId].status, 'active');
    assert.equal(confirmSubscription(store, fresh.verifyToken).ok, false, 'a token is single-use');
  });

  it('keeps an active subscription active through a repeat signup until the new settings are confirmed', () => {
    const store = createSubscriptionStore();
    const req = requestSubscription(store, { recipient: 'b@example.org', lang: 'en', nowIso: '2026-10-25T18:00:00.000Z' });
    confirmSubscription(store, req.verifyToken, '2026-10-25T18:10:00.000Z');

    const repeat = requestSubscription(store, { recipient: 'b@example.org', lang: 'es', channel: 'sms', nowIso: '2026-10-27T09:00:00.000Z' });
    assert.equal(repeat.status, 'active');
    assert.equal(repeat.pendingChange, true);
    assert.equal(repeat.unsubscribeToken, req.unsubscribeToken);
    const sub = store.subscribers[req.subscriberId];
    assert.equal(sub.status, 'active');
    assert.equal(sub.lang, 'en');
    assert.equal(sub.channel, 'email');
    assert.equal(sub.confirmedAt, '2026-10-25T18:10:00.000Z');

    const dispatch = evaluateAndRecordDispatch(store, {
      subscriberId: req.subscriberId,
      meetingSlug: '2026-11-04-regular',
      meetingDate: '2026-11-04',
      digestHash: 'sha256:y',
      todayDate: '2026-11-02',
    });
    assert.equal(dispatch.dispatch, true, 'repeat signup must not demote an active subscriber');

    assert.equal(confirmSubscription(store, repeat.verifyToken, '2026-10-27T09:05:00.000Z').ok, true);
    assert.equal(sub.status, 'active');
    assert.equal(sub.lang, 'es');
    assert.equal(sub.channel, 'sms');
    assert.equal(sub.pendingChange, null);
  });

  it('changes the digest when an attachment or financial impact is amended, but not for scrape-only metadata', () => {
    const memos = JSON.parse(readFileSync(resolve(ROOT, 'data/board-memos/2026-11-04.json'), 'utf-8'));
    const meeting = meetingsByDate.get('2026-11-04');
    assert.ok(meeting, '2026-11-04 meeting should exist');
    const base = computeMeetingDigestHash(meeting, null, memos);
    const qkaIndex = memos.items.findIndex((i) => /QKA/.test(i.title));
    assert.ok(qkaIndex >= 0);

    // Revised QKA agreement attachment, same item title
    const amendedAttachment = structuredClone(memos);
    const qkaAtt = amendedAttachment.items[qkaIndex].attachments.find((a) => /Agreement-for-Facilities-Master-Plan/.test(a.filename));
    qkaAtt.filename = qkaAtt.filename.replace('4680227.1', '4680227.2');
    assert.notEqual(computeMeetingDigestHash(meeting, null, amendedAttachment), base);

    // Changed financial impact
    const amendedFinance = structuredClone(memos);
    amendedFinance.items[qkaIndex].memo['Financial Impact'] = 'Revised: not to exceed $250,000.';
    assert.notEqual(computeMeetingDigestHash(meeting, null, amendedFinance), base);

    // Changed recommendation
    const amendedRec = structuredClone(memos);
    amendedRec.items[qkaIndex].memo.Recommendation += ' (revised)';
    assert.notEqual(computeMeetingDigestHash(meeting, null, amendedRec), base);

    // Re-scrape of the same agenda: new scrapedAt and editor stamps only
    const rescraped = structuredClone(memos);
    rescraped.scrapedAt = '2026-11-03T12:00:00.000Z';
    rescraped.items[qkaIndex].provenance = { ...rescraped.items[qkaIndex].provenance, modifiedOn: '11:59 PM' };
    assert.equal(computeMeetingDigestHash(meeting, null, rescraped), base);

    // A meetings-data attachment swap is also material
    const meetingAmended = structuredClone(meeting);
    const item = meetingAmended.items.find((i) => /QKA/.test(i.title));
    item.attachments[1].aid = '9999999';
    assert.notEqual(computeMeetingDigestHash(meetingAmended), computeMeetingDigestHash(meeting));
  });

  it('executes workers/text-agent/src/index.ts end-to-end with bundled TypeScript worker and mock KV store', () => {
    const bundlePath = '/tmp/rcsd-text-agent-test-bundle.mjs';
    execFileSync(
      resolve(ROOT, 'node_modules/.bin/esbuild'),
      [
        resolve(ROOT, 'workers/text-agent/src/index.ts'),
        '--bundle',
        '--format=esm',
        `--outfile=${bundlePath}`,
      ],
      { stdio: 'pipe' },
    );
    assert.equal(existsSync(bundlePath), true, 'esbuild should bundle workers/text-agent/src/index.ts');

    // Run the text-agent test suite against the bundled worker
    const output = execFileSync(
      process.execPath,
      [
        '--input-type=module',
        '-e',
        `
          import assert from 'node:assert/strict';
          import worker from '${bundlePath}';

          function createMockKV() {
            const map = new Map();
            return {
              map,
              async get(key, type) {
                const raw = map.get(key) ?? null;
                if (raw === null) return null;
                return type === 'json' ? JSON.parse(raw) : raw;
              },
              async put(key, value) { map.set(key, value); },
              async delete(key) { map.delete(key); },
            };
          }

          async function signTwilio(authToken, url, params) {
            const sortedKeys = Object.keys(params).sort();
            let data = url;
            for (const k of sortedKeys) data += k + params[k];
            const enc = new TextEncoder();
            const key = await crypto.subtle.importKey('raw', enc.encode(authToken), { name: 'HMAC', hash: 'SHA-1' }, false, ['sign']);
            const sig = await crypto.subtle.sign('HMAC', key, enc.encode(data));
            return btoa(String.fromCharCode(...new Uint8Array(sig)));
          }

          const kv = createMockKV();
          const env = {
            ANTHROPIC_API_KEY: 'test-key',
            TWILIO_AUTH_TOKEN: 'secret-token',
            PUBLIC_BASE_URL: 'https://text.rcsd.info',
            DRY_RUN: '1',
            TEXT_AGENT_KV: kv,
          };
          const url = 'https://text.rcsd.info/twilio/inbound';
          const esLine = 'whatsapp:+16503997203';
          const parentFrom = 'whatsapp:+16505550199';

          // 1. Send PARAR from Spanish-speaking parent on WhatsApp
          const stopParams = { From: parentFrom, To: esLine, Body: 'PARAR' };
          const stopSig = await signTwilio(env.TWILIO_AUTH_TOKEN, url, stopParams);
          const stopRes = await worker.fetch(new Request(url, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/x-www-form-urlencoded',
              'X-Twilio-Signature': stopSig,
            },
            body: new URLSearchParams(stopParams).toString(),
          }), env, { waitUntil() {} });

          assert.equal(stopRes.status, 200);
          const stopXml = await stopRes.text();
          assert.match(stopXml, /Se ha cancelado su suscripción/);

          // Verify durable optout:<sha256> key written in KV
          const optOutKeys = [...kv.map.keys()].filter((k) => k.startsWith('optout:'));
          assert.equal(optOutKeys.length, 1);

          // 2. Subsequent message while opted out is suppressed before Claude API call (returns empty TwiML)
          const msgParams = { From: parentFrom, To: esLine, Body: 'When is the next meeting?' };
          const msgSig = await signTwilio(env.TWILIO_AUTH_TOKEN, url, msgParams);
          const msgRes = await worker.fetch(new Request(url, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/x-www-form-urlencoded',
              'X-Twilio-Signature': msgSig,
            },
            body: new URLSearchParams(msgParams).toString(),
          }), env, { waitUntil() {} });
          const msgXml = await msgRes.text();
          assert.equal(msgXml, '<?xml version="1.0" encoding="UTF-8"?><Response></Response>');

          // 3. Send ALTA to re-subscribe and verify optout:<sha256> is cleared
          const startParams = { From: parentFrom, To: esLine, Body: 'ALTA' };
          const startSig = await signTwilio(env.TWILIO_AUTH_TOKEN, url, startParams);
          const startRes = await worker.fetch(new Request(url, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/x-www-form-urlencoded',
              'X-Twilio-Signature': startSig,
            },
            body: new URLSearchParams(startParams).toString(),
          }), env, { waitUntil() {} });
          const startXml = await startRes.text();
          assert.match(startXml, /Ha vuelto a activar la línea de información/);
          assert.equal([...kv.map.keys()].filter((k) => k.startsWith('optout:')).length, 0);
        `,
      ],
      { encoding: 'utf-8' },
    );
    rmSync(bundlePath, { force: true });
    assert.equal(output, '');
  });
});

describe('Stage 5 — Multi-District Pilot (SMFCSD) Cross-Regime Reconciliation', () => {
  it('reconciles SMFCSD Agenda Online (2019-2022) and Simbli (2022-present) regimes with 4-axis provenance while keeping districts/active.json empty', () => {
    const activeConfig = JSON.parse(readFileSync(resolve(ROOT, 'districts/active.json'), 'utf-8'));
    assert.deepEqual(activeConfig.districtSlugs, [], 'districts/active.json must remain empty');

    const smfcsdManifest = JSON.parse(
      readFileSync(resolve(ROOT, 'districts/san-mateo-foster-city-sd/manifest.json'), 'utf-8'),
    );

    const regime2021 = resolveSourceRegime(smfcsdManifest, '2021-11-18');
    assert.equal(regime2021?.id, 'governance-agenda-online-observed');

    const regime2026 = resolveSourceRegime(smfcsdManifest, '2026-05-14');
    assert.equal(regime2026?.id, 'governance-simbli-observed-current');
    // The July 2022 gap between the two known bounds belongs to neither regime
    assert.equal(resolveSourceRegime(smfcsdManifest, '2022-07-15'), null);

    const dataset = buildReconciledMeetingDataset(smfcsdManifest, [
      {
        id: 'ca.cde.district.4169039.meeting.20211118',
        title: { text: 'Regular Board of Trustees Meeting (Agenda Online Archive)', locale: 'en-US' },
        startsAt: '2021-11-18T19:00:00-08:00',
        occurrence: {
          state: 'held',
          evidence: [
            {
              sourceId: 'governance-agenda-online',
              url: 'https://www.smfcsd.net/board-of-trustees/board-agendas-minutes#2021-11-18',
              checkedAt: '2026-07-09T18:00:00.000Z',
            },
          ],
        },
        agenda: {
          state: 'published',
          evidence: [
            {
              sourceId: 'governance-agenda-online',
              url: 'https://www.smfcsd.net/board-of-trustees/board-agendas-minutes#2021-11-18-agenda',
              checkedAt: '2026-07-09T18:00:00.000Z',
            },
          ],
        },
        minutes: {
          state: 'approved',
          evidence: [
            {
              sourceId: 'governance-landing',
              url: 'https://www.smfcsd.net/board-of-trustees/board-agendas-minutes#2021-11-18-minutes',
              checkedAt: '2026-07-09T18:00:00.000Z',
            },
          ],
        },
        recording: {
          state: 'published',
          evidence: [
            {
              sourceId: 'meeting-video',
              url: 'https://www.youtube.com/channel/UCV5QW3IqM4iKzZEiOrAWc5Q',
              checkedAt: '2026-07-09T18:00:00.000Z',
            },
          ],
        },
      },
      {
        id: 'ca.cde.district.4169039.meeting.20260514',
        title: { text: 'Regular Board of Trustees Meeting (Simbli Regime)', locale: 'en-US' },
        startsAt: '2026-05-14T19:00:00-07:00',
        occurrence: {
          state: 'held',
          evidence: [
            {
              sourceId: 'governance-simbli',
              url: 'https://simbli.eboardsolutions.com/SB_Meetings/SB_MeetingListing.aspx?S=36030428',
              checkedAt: '2026-07-09T18:00:00.000Z',
            },
          ],
        },
        agenda: {
          state: 'published',
          evidence: [
            {
              sourceId: 'governance-simbli',
              url: 'https://simbli.eboardsolutions.com/SB_Meetings/SB_MeetingListing.aspx?S=36030428#2026-05-14',
              checkedAt: '2026-07-09T18:00:00.000Z',
            },
          ],
        },
        minutes: {
          state: 'absent',
          vendorState: 'absent',
          cmsState: 'approved',
          evidence: [
            {
              sourceId: 'governance-simbli',
              url: 'https://simbli.eboardsolutions.com/SB_Meetings/SB_MeetingListing.aspx?S=36030428#2026-05-14-minutes',
              checkedAt: '2026-07-09T18:00:00.000Z',
            },
            {
              sourceId: 'governance-landing',
              url: 'https://www.smfcsd.net/board-of-trustees/board-agendas-minutes#2026-05-14-minutes-pdf',
              checkedAt: '2026-07-09T18:00:00.000Z',
            },
          ],
        },
        recording: {
          state: 'published',
          evidence: [
            {
              sourceId: 'meeting-video',
              url: 'https://www.youtube.com/channel/UCV5QW3IqM4iKzZEiOrAWc5Q',
              checkedAt: '2026-07-09T18:00:00.000Z',
            },
          ],
        },
      },
      {
        id: 'ca.cde.district.4169039.meeting.20260409.visitation',
        meetingSubtype: 'school-visitation',
        title: { text: 'Special Meeting — School Visitation', locale: 'en-US' },
        startsAt: '2026-04-09T08:30:00-07:00',
        occurrence: {
          state: 'held',
          evidence: [
            {
              sourceId: 'governance-landing',
              url: 'https://www.smfcsd.net/board-of-trustees/board-agendas-minutes#2026-04-09-visitation',
              checkedAt: '2026-07-09T18:00:00.000Z',
            },
          ],
        },
        agenda: {
          state: 'published',
          evidence: [
            {
              sourceId: 'governance-simbli',
              url: 'https://simbli.eboardsolutions.com/SB_Meetings/SB_MeetingListing.aspx?S=36030428#2026-04-09',
              checkedAt: '2026-07-09T18:00:00.000Z',
            },
          ],
        },
        minutes: {
          state: 'absent',
          evidence: [
            {
              sourceId: 'governance-landing',
              url: 'https://www.smfcsd.net/board-of-trustees/board-agendas-minutes#2026-04-09',
              checkedAt: '2026-07-09T18:00:00.000Z',
            },
          ],
        },
        recording: {
          state: 'not-applicable',
          evidence: [
            {
              sourceId: 'governance-landing',
              url: 'https://www.smfcsd.net/board-of-trustees/board-agendas-minutes#2026-04-09-no-video',
              checkedAt: '2026-07-09T18:00:00.000Z',
            },
          ],
        },
      },
    ]);

    assert.equal(dataset.records.length, 3);
    assert.equal(dataset.records[1].minutes.state, 'approved');
    assert.equal(dataset.records[1].discrepancies.length, 1);
    assert.equal(dataset.records[1].discrepancies[0].field, 'minutes.state');
    assert.equal(dataset.records[2].recording.state, 'not-applicable');
  });

  it('does not pick the first regime when null (unknown) bounds leave several possible', () => {
    const rcsdManifest = JSON.parse(readFileSync(resolve(ROOT, 'districts/rcsd/manifest.json'), 'utf-8'));
    // Both RCSD governance regimes have null bounds; 10/14/2026 is past both observation windows
    assert.equal(resolveSourceRegime(rcsdManifest, '2026-10-14'), null);
    // Inside exactly one observation window, that regime is supported
    assert.equal(resolveSourceRegime(rcsdManifest, '2026-03-11')?.id, 'governance-simbli-observed');
    assert.equal(resolveSourceRegime(rcsdManifest, '2024-05-01')?.id, 'governance-boarddocs-observed');
    // Between the windows (BoardDocs last seen 2025-05-28, Simbli first seen 2025-06-11): ambiguous
    assert.equal(resolveSourceRegime(rcsdManifest, '2025-06-05'), null);
    assert.equal(resolveSourceRegime(rcsdManifest, 'not-a-date'), null);
  });
});
