/**
 * RCSD Open Data MCP Server
 *
 * Remote MCP server on Cloudflare Workers providing access to
 * Redwood City School District data. Public, no auth required.
 *
 * Tools:
 *   list-schools          — List all 12 RCSD schools
 *   query-school          — Detailed info for a specific school
 *   check-calendar        — Is there school on a given date?
 *   get-lunch-menu        — Live lunch menu from HealthePro API
 *   get-trustees          — Board of Trustees, superintendent, and cabinet
 *   list-meetings         — Enumerate board meetings with paging
 *   get-meeting-summary   — Board meeting summaries (EN/ES)
 *   get-meeting-details   — Comprehensive details for a single board meeting
 *   search-transcript     — Search one meeting's transcript for a word or phrase
 *   find-document         — Keyword search over board documents by title
 *   get-school-board-items — Board items for a specific school
 *   get-sped-data         — Special education stats
 *   list-policies         — List board policies, bylaws, and regulations
 *   get-policy            — Get plain-text rules and citations of a specific board policy
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { createMcpHandler } from "agents/mcp";
import { z } from "zod";

const DATA_BASE = "https://data.rcsd.info/json";

// ---- AI-content disclosure (project rule: AI-generated content must be labeled) ----

const AI_NOTE_EN =
  "Note: this summary is AI-generated from the meeting recording and documents and may contain errors; it is not an official record.";
const AI_NOTE_ES =
  "Nota: este resumen fue generado con IA a partir de la grabación y los documentos de la reunión; puede contener errores y no es un registro oficial.";
const ASR_NOTE_EN =
  "Note: transcripts are machine-generated (ASR) with AI speaker attribution and may contain errors; they are not an official record.";
const ASR_NOTE_ES =
  "Nota: la transcripción fue generada por computadora (ASR) y traducida automáticamente del inglés; puede contener errores y no es un registro oficial.";

// ---- Data fetching with caching ----

const cache = new Map<string, { data: any; expires: number }>();
const CACHE_TTL = 5 * 60 * 1000; // 5 minutes

// Accepts a path under DATA_BASE (the common case) or a full https:// URL
// (transcripts live at data.rcsd.info/transcripts/, outside /json/).
async function fetchJSON(path: string): Promise<any> {
  const now = Date.now();
  const cached = cache.get(path);
  if (cached && cached.expires > now) return cached.data;

  const url = path.startsWith("https://") ? path : `${DATA_BASE}/${path}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Failed to fetch ${path}: ${res.status}`);
  const data = await res.json();
  cache.set(path, { data, expires: now + CACHE_TTL });
  return data;
}

// ---- Helper: provenance footer (every tool output ends with a source line) ----

// Meeting summaries are stored with inline HTML (<strong>) for the website;
// MCP tool output is plain text, so strip markup at render time. Loops to a
// fixpoint so split constructions (<scr<b>ipt>) can't reassemble into a tag
// after one pass (CodeQL js/incomplete-multi-character-sanitization).
function stripHtml(s: string): string {
  let out = s || "";
  for (let prev = ""; prev !== out; ) {
    prev = out;
    out = out.replace(/<[^>]+>/g, "");
  }
  return out;
}

function sourceLine(file: string, asOf?: string | null): string {
  const url = file.startsWith("https://") ? file : `${DATA_BASE}/${file}`;
  return `Source: ${url}${asOf ? ` (as of ${asOf})` : ""}`;
}

// ---- Helper: school year for a date ----

// RCSD school years run roughly mid-August to early June; July 1 is the
// fiscal-year rollover, so July onward belongs to the next school year.
function schoolYearFor(date: string): string {
  const [y, m] = date.split("-").map(Number);
  const startYear = m >= 7 ? y : y - 1;
  return `${startYear}-${String((startYear + 1) % 100).padStart(2, "0")}`;
}

// Fetch the district calendar covering a date; null if not published yet.
// Calendar files are named district-calendar-<schoolYear>.json, so deriving
// the school year keeps this working every year without code changes.
async function fetchCalendarFor(
  date: string
): Promise<{ cal: any; schoolYear: string } | null> {
  const schoolYear = schoolYearFor(date);
  try {
    const cal = await fetchJSON(`district-calendar-${schoolYear}.json`);
    return { cal, schoolYear };
  } catch {
    return null;
  }
}

// ---- Helper: find a school by slug or name ----

function findSchool(schools: any[], query: string) {
  const q = query.toLowerCase().replace(/[^a-z0-9]/g, "");
  return schools.find(
    (s: any) =>
      s.slug.replace(/-/g, "") === q ||
      s.nameShort.toLowerCase().replace(/[^a-z0-9]/g, "") === q ||
      s.name.toLowerCase().replace(/[^a-z0-9]/g, "").includes(q)
  );
}

// ---- Helper: format school info ----

function formatBellSchedule(bs: any): string {
  const lines: string[] = [];
  const day = bs.earlyReleaseDay || "Thursday";
  if (bs.supervision) {
    lines.push(`  Supervision starts: ${bs.supervision}`);
  }
  // Regular schedule
  lines.push(`  Regular days (Mon/Tue/Wed/Fri):`);
  for (const r of bs.regular) {
    lines.push(`    ${r.grades}: ${r.start} – ${r.end}`);
  }
  // Early release
  lines.push(`  ${day} early release:`);
  for (const r of bs.earlyRelease) {
    lines.push(`    ${r.grades}: dismissal ${r.end}`);
  }
  // Super minimum
  if (bs.superMinimum) {
    lines.push("  Super-minimum days (no lunch served):");
    for (const r of bs.superMinimum) {
      const start = r.start ? `${r.start} – ` : "";
      lines.push(`    ${r.grades}: ${start}dismissal ${r.end}`);
    }
  }
  return lines.join("\n");
}

function formatSchool(s: any): string {
  const lines = [
    s.name,
    `  Slug: ${s.slug}`,
    `  Grades: ${s.grades} | Type: ${s.type}${s.program ? ` | Program: ${s.program}` : ""}`,
    `  Enrollment: ${s.enrollment} | High-Need: ${s.highNeedPct}%`,
    `  Principal: ${s.principal}`,
    `  Address: ${s.address}`,
    `  Phone: ${s.phone}`,
    `  Website: ${s.website}`,
  ];
  // Bell schedule — support both old flat and new detailed format
  if (s.bellSchedule.regular) {
    lines.push("  Bell Schedule:");
    lines.push(formatBellSchedule(s.bellSchedule));
  } else {
    lines.push(`  Bell Schedule: ${s.bellSchedule.start} – ${s.bellSchedule.end} (early release: ${s.bellSchedule.earlyRelease})`);
  }
  lines.push(`  Lunch Menu: ${s.lunchUrl}`);
  lines.push(`  Community School: ${s.communitySchool ? "Yes" : "No"}`);
  lines.push(`  CDS Code: ${s.cdsCode}`);
  if (s.parentLinks) {
    lines.push(`  Parent Platform: ${s.parentLinks.platform}`);
  }
  if (s.pto) {
    lines.push(
      `  PTO: ${s.pto.name} — $${s.pto.revenue?.toLocaleString() || "?"} revenue (${s.pto.revenueFY})`
    );
  } else {
    lines.push("  PTO: None — school is supported by RCEF (Redwood City Education Foundation)");
  }
  return lines.join("\n");
}

// ---- Helper: format seconds into HH:MM:SS or MM:SS ----

function formatTimestamp(seconds: number): string {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);
  const mm = String(m).padStart(2, "0");
  const ss = String(s).padStart(2, "0");
  return h > 0 ? `${h}:${mm}:${ss}` : `${mm}:${ss}`;
}

// ---- Helper: parse HealthePro menu ID from lunch URL ----

function parseMenuId(lunchUrl: string): number | null {
  const match = lunchUrl.match(/menus\/(\d+)/);
  return match ? parseInt(match[1]) : null;
}

// ---- Server factory (create per-request to prevent cross-client leakage) ----

function createServer(): McpServer {
  const server = new McpServer({
    name: "RCSD Open Data",
    version: "1.0.0",
    description: "Public data for the Redwood City School District — schools, calendars, lunch menus, board meetings, demographics, and special education",
    icons: [
      {
        src: "https://data.rcsd.info/logos/district.jpg",
        mimeType: "image/jpeg",
      },
    ],
  });

  // ---- list-schools ----
  server.tool(
    "list-schools",
    "List all 12 RCSD schools with key info (name, grades, type, enrollment)",
    {},
    async () => {
      const data = await fetchJSON("schools.json");
      const lines = data.schools.map(
        (s: any) =>
          `${s.slug.padEnd(16)} ${s.nameShort.padEnd(20)} ${s.grades.padEnd(6)} ${s.type.padEnd(14)} ${s.enrollment} students`
      );
      // Pre-computed aggregates: models miscount when asked to tally grade spans
      // themselves (observed 2026-07-21: "how many middle schools" answers ranged
      // 3-5 until these lines existed), so state the answers deterministically.
      // Grade-span floor: TK/K/PK count as 0.
      const spanOf = (g: string): [number, number] => {
        const [lo, hi] = g.split("-");
        const num = (x: string) => (/^\d+$/.test(x) ? parseInt(x, 10) : 0);
        return [num(lo), num(hi ?? lo)];
      };
      const serves = (s: any, lo: number, hi: number) => {
        const [a, b] = spanOf(s.grades);
        return a <= hi && b >= lo;
      };
      const names = (list: any[]) => list.map((s: any) => s.nameShort).join(", ");
      const elem = data.schools.filter((s: any) => serves(s, 0, 5));
      const mid = data.schools.filter((s: any) => serves(s, 6, 8));
      const midDedicated = mid.filter((s: any) => spanOf(s.grades)[0] >= 6);
      const midWider = mid.filter((s: any) => spanOf(s.grades)[0] < 6);
      const totalEnrollment = data.schools.reduce(
        (sum: number, s: any) => sum + (s.enrollment ?? 0), 0,
      );
      lines.push(
        "",
        `Totals (pre-computed - use these rather than counting yourself):`,
        `  Schools: ${data.schools.length} | Total enrollment: ${totalEnrollment} students`,
        `  Serving elementary grades (TK-5): ${elem.length} schools (${names(elem)})`,
        `  Serving middle grades (6-8): ${mid.length} schools - ${midDedicated.length} dedicated (${names(midDedicated)}) + ${midWider.length} wider-span (${names(midWider)})`,
      );
      lines.push("", sourceLine("schools.json", data.lastUpdated));
      return {
        content: [{ type: "text", text: lines.join("\n") }],
      };
    }
  );

  // ---- query-school ----
  server.tool(
    "query-school",
    "Get detailed information about a specific RCSD school by name or slug",
    { school: z.string().describe("School name or slug (e.g. 'orion', 'Roy Cloud', 'kennedy')") },
    async ({ school }) => {
      const data = await fetchJSON("schools.json");
      const found = findSchool(data.schools, school);
      if (!found) {
        return {
          isError: true,
          content: [
            {
              type: "text",
              text: `School not found: "${school}". Available: ${data.schools.map((s: any) => s.slug).join(", ")}`,
            },
          ],
        };
      }
      let text = formatSchool(found);
      // Append SSC membership if available
      try {
        const sscData = await fetchJSON("ssc-membership.json");
        const ssc = sscData[found.slug]?.["2025-26"];
        if (ssc?.members?.length) {
          const roleLabel: Record<string, string> = { principal: "Principal", classroomTeacher: "Teacher", otherStaff: "Staff", parentCommunity: "Parent/Community" };
          text += "\n  School Site Council (2025-26):";
          if (ssc.chairperson) text += `\n    Chair: ${ssc.chairperson}`;
          if (ssc.adoptionDate) text += `\n    SPSA adopted: ${ssc.adoptionDate}`;
          text += `\n    Members (${ssc.members.length}):`;
          for (const m of ssc.members) {
            text += `\n      ${m.name} — ${roleLabel[m.role] || m.role}`;
          }
        }
      } catch {
        // Distinguish a fetch outage from "this school has no SSC entry"
        // (which is the silent skip above when the slug key is absent).
        text += "\n  School Site Council: data temporarily unavailable (fetch failed).";
      }
      // Append CDE data if available
      try {
        const [absenteeism, ltel, staffEthnicity, staffExperience, staffRatios] = await Promise.all([
          fetchJSON("cde/absenteeism-2024-25.json"),
          fetchJSON("cde/ltel-2024-25.json"),
          fetchJSON("cde/staff-ethnicity-2024-25.json"),
          fetchJSON("cde/staff-experience-2024-25.json"),
          fetchJSON("cde/staff-ratios-2024-25.json"),
        ]);
        const slug = found.slug;
        const cdeLines: string[] = ["\n  CDE Data (2024-25):"];

        // Chronic absenteeism
        const abs = absenteeism[slug];
        if (abs) {
          const parts: string[] = [];
          if (abs.TA?.rate != null) parts.push(`${abs.TA.rate}% overall`);
          if (abs.RH?.rate != null) parts.push(`Hispanic ${abs.RH.rate}%`);
          if (abs.SE?.rate != null) parts.push(`EL ${abs.SE.rate}%`);
          if (abs.SS?.rate != null) parts.push(`SED ${abs.SS.rate}%`);
          if (parts.length) cdeLines.push(`    Chronic Absenteeism: ${parts.join(" | ")}`);
        }

        // English learners / LTEL
        const el = ltel[slug];
        if (el) {
          const parts: string[] = [];
          if (el.el != null) parts.push(`${el.el} EL`);
          if (el.ltel != null) parts.push(`${el.ltel} LTEL`);
          if (el.atRisk != null) parts.push(`${el.atRisk} At-Risk`);
          if (el.rfep != null) parts.push(`${el.rfep} Reclassified`);
          if (parts.length) cdeLines.push(`    English Learners: ${parts.join(", ")}`);
        }

        // Teacher diversity (ethnicity)
        const eth = staffEthnicity[slug];
        if (eth && eth.total) {
          // Build top 3 ethnicities by count (descending), skipping zero
          const categories: [string, number][] = [
            ["White", eth.white], ["Hispanic", eth.hispanicLatino],
            ["Asian", eth.asian], ["African American", eth.africanAmerican],
            ["Filipino", eth.filipino], ["Pacific Islander", eth.pacificIslander],
            ["Two+", eth.twoOrMore], ["Am. Indian", eth.americanIndian],
            ["Not Reported", eth.notReported],
          ];
          const top = categories
            .filter(([, n]) => n > 0)
            .sort((a, b) => b[1] - a[1])
            .slice(0, 3)
            .map(([label, n]) => `${((n / eth.total) * 100).toFixed(1)}% ${label}`);
          if (top.length) cdeLines.push(`    Teacher Diversity: ${eth.total} teachers — ${top.join(", ")}`);
        }

        // Teacher experience
        const exp = staffExperience[slug];
        if (exp) {
          const parts: string[] = [];
          if (exp.avgYearsTotal != null) parts.push(`${exp.avgYearsTotal} avg years`);
          if (exp.inexperienced != null) {
            let inexp = `${exp.inexperienced} inexperienced`;
            if (exp.firstYear != null && exp.firstYear > 0) inexp += ` (${exp.firstYear} first-year)`;
            parts.push(inexp);
          }
          if (parts.length) cdeLines.push(`    Teacher Experience: ${parts.join(", ")}`);
        }

        // Pupil ratios
        const rat = staffRatios[slug];
        if (rat) {
          const parts: string[] = [];
          if (rat.studentTeacherRatio != null) parts.push(`Pupil:Teacher ${rat.studentTeacherRatio}:1`);
          if (rat.studentPupilServicesRatio != null) parts.push(`Pupil:Counselor ${rat.studentPupilServicesRatio}:1`);
          if (parts.length) cdeLines.push(`    ${parts.join(" | ")}`);
        }

        // Only append if we have more than just the header
        if (cdeLines.length > 1) {
          text += cdeLines.join("\n");
        } else {
          text += "\n  CDE Data (2024-25): no school-level rows published for this school.";
        }
      } catch (err: any) {
        // A fetch failure is not the same as "no data exists" — say which it is.
        text += `\n  CDE Data (2024-25): temporarily unavailable (fetch failed: ${err.message}); this is a retrieval error, not missing data.`;
      }
      text += "\n\n" + sourceLine("schools.json", data.lastUpdated);
      return {
        content: [{ type: "text", text }],
        structuredContent: { school: found },
      };
    }
  );

  // ---- check-calendar ----
  server.tool(
    "check-calendar",
    "Check what falls on a given date (school day, holiday, break), or — called WITHOUT a date — list the school year's key dates (first/last day of school, breaks, holidays, board meetings). To find WHEN an event happens (e.g. 'when is the first day of school?'), call with no date and read the list; never guess-and-check specific dates.",
    {
      date: z
        .string()
        .optional()
        .describe(
          "Date in YYYY-MM-DD format. Omit to get the full key-dates list for the current (and, if published, next) school year."
        ),
    },
    async ({ date }) => {
      if (!date) {
        // Key-dates listing: current school year per America/Los_Angeles today,
        // plus the following year's calendar when it's already published.
        const today = new Date().toLocaleDateString("en-CA", { timeZone: "America/Los_Angeles" });
        const startYear = Number(schoolYearFor(today).split("-")[0]);
        const lines: string[] = [`Today is ${today}. Key district dates:`];
        const sources: string[] = [];
        for (const sy of [startYear, startYear + 1]) {
          const schoolYear = `${sy}-${String((sy + 1) % 100).padStart(2, "0")}`;
          try {
            const cal = await fetchJSON(`district-calendar-${schoolYear}.json`);
            lines.push(`\n${schoolYear} school year:`);
            for (const evt of cal.events) {
              const range = evt.dateEnd ? `${evt.date} to ${evt.dateEnd}` : evt.date;
              lines.push(`  ${range}: ${evt.en} (${evt.type})`);
            }
            sources.push(sourceLine(`district-calendar-${schoolYear}.json`).trim());
          } catch {
            /* that year's calendar not published yet */
          }
        }
        if (sources.length === 0) {
          return {
            content: [
              {
                type: "text",
                text: "No district calendars are published yet. Calendars are added to https://rcsd.info as the district releases them.",
              },
            ],
          };
        }
        return { content: [{ type: "text", text: lines.join("\n") + "\n" + sources.join("\n") }] };
      }
      if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
        return { isError: true, content: [{ type: "text", text: "Date must be YYYY-MM-DD format" }] };
      }

      const found = await fetchCalendarFor(date);
      if (!found) {
        return {
          content: [
            {
              type: "text",
              text: `No district calendar published yet for the ${schoolYearFor(date)} school year. Calendars are added to https://rcsd.info as the district releases them.`,
            },
          ],
        };
      }
      const { cal, schoolYear } = found;
      const src = "\n" + sourceLine(`district-calendar-${schoolYear}.json`);

      // Check for matching event
      for (const evt of cal.events) {
        const start = evt.date;
        const end = evt.dateEnd || evt.date;
        if (date >= start && date <= end) {
          const range = evt.dateEnd ? ` (${start} to ${end})` : "";
          return {
            content: [{ type: "text", text: `${date}: ${evt.en} (${evt.type})${range} [${schoolYear}]${src}` }],
          };
        }
      }

      // Check if within school year
      const first = cal.events.find((e: any) => e.en.includes("First Day"));
      const last = cal.events.find((e: any) => e.en.includes("Last Day"));
      if (first && last && date >= first.date && date <= last.date) {
        const dayOfWeek = new Date(date + "T12:00:00").getDay();
        if (dayOfWeek === 0 || dayOfWeek === 6) {
          return { content: [{ type: "text", text: `${date}: Weekend — no school${src}` }] };
        }
        return {
          content: [{ type: "text", text: `${date}: Regular school day (${schoolYear})${src}` }],
        };
      }

      return {
        content: [
          { type: "text", text: `${date}: Not within the ${schoolYear} school-year calendar range (summer break or before the first day of school)${src}` },
        ],
      };
    }
  );

  // ---- get-lunch-menu ----
  server.tool(
    "get-lunch-menu",
    "Get the lunch menu for a school on a specific date (fetches live from HealthePro)",
    {
      school: z.string().describe("School name or slug"),
      date: z.string().describe("Date in YYYY-MM-DD format"),
    },
    async ({ school, date }) => {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
        return { isError: true, content: [{ type: "text", text: "Date must be YYYY-MM-DD format" }] };
      }

      // Check if this is a no-school day before fetching menu
      const dayOfWeek = new Date(date + "T12:00:00").getDay();
      if (dayOfWeek === 0 || dayOfWeek === 6) {
        return { content: [{ type: "text", text: `${date} is a weekend — no school lunch.` }] };
      }
      const calFound = await fetchCalendarFor(date);
      if (calFound) {
        const { cal, schoolYear } = calFound;
        // Check no-school days (holidays, teacher training, planning days, breaks)
        for (const evt of cal.events) {
          if (evt.type === "no-school") {
            const start = evt.date;
            const end = evt.dateEnd || evt.date;
            if (date >= start && date <= end) {
              return {
                content: [{ type: "text", text: `No school lunch on ${date} — ${evt.en}. School is closed.\n` + sourceLine(`district-calendar-${schoolYear}.json`) }],
              };
            }
          }
          // Super-minimum / minimum days: students dismissed before lunch
          if (evt.type === "minimum-day" || evt.type === "super-minimum") {
            const start = evt.date;
            const end = evt.dateEnd || evt.date;
            if (date >= start && date <= end) {
              return {
                content: [{ type: "text", text: `No school lunch on ${date} — ${evt.en}. Students are dismissed before lunch on super-minimum days.\n` + sourceLine(`district-calendar-${schoolYear}.json`) }],
              };
            }
          }
        }
        // Check if date falls outside school year (summer, pre-session)
        const first = cal.events.find((e: any) => e.en.includes("First Day"));
        const last = cal.events.find((e: any) => e.en.includes("Last Day"));
        const withinSchoolYear = first && last && date >= first.date && date <= last.date;
        if (!withinSchoolYear) {
          return {
            content: [{ type: "text", text: `No school lunch on ${date} — school is not in session.\n` + sourceLine(`district-calendar-${schoolYear}.json`) }],
          };
        }
      }
      // No calendar published for that school year yet — proceed with menu fetch

      const data = await fetchJSON("schools.json");
      const found = findSchool(data.schools, school);
      if (!found) {
        return {
          isError: true,
          content: [
            {
              type: "text",
              text: `School not found: "${school}". Available: ${data.schools.map((s: any) => s.slug).join(", ")}`,
            },
          ],
        };
      }

      const menuId = parseMenuId(found.lunchUrl);
      if (!menuId) {
        return {
          isError: true,
          content: [{ type: "text", text: `Could not parse menu URL for ${found.nameShort}` }],
        };
      }

      const [year, monthStr] = date.split("-");
      const month = parseInt(monthStr);
      const url = `https://menus.healthepro.com/api/organizations/1184/menus/${menuId}/year/${year}/month/${month}/date_overwrites`;

      const res = await fetch(url);
      if (!res.ok) {
        return {
          isError: true,
          content: [{ type: "text", text: `HealthePro API returned ${res.status}` }],
        };
      }

      const json: any = await res.json();
      const days = json.data || [];
      const dayData = days.find((d: any) => d.day === date);

      if (!dayData) {
        const dayOfWeek = new Date(date + "T12:00:00").getDay();
        if (dayOfWeek === 0 || dayOfWeek === 6) {
          return { content: [{ type: "text", text: `${date} is a weekend — no school lunch.` }] };
        }
        return {
          content: [
            {
              type: "text",
              text: `No menu published for ${found.nameShort} on ${date}. The menu may not be available yet or it may be a holiday.`,
            },
          ],
        };
      }

      const setting = JSON.parse(dayData.setting);
      const items = setting.current_display || [];
      const lines: string[] = [`${found.nameShort} Lunch — ${date}`];
      for (const item of items) {
        if (item.type === "category") {
          lines.push(`  [${item.name}]`);
        } else if (item.type === "recipe") {
          lines.push(`    ${item.name}`);
        }
      }
      lines.push("", `Source: HealthePro live menu API (menus.healthepro.com), fetched ${new Date().toISOString().slice(0, 10)}`);
      return { content: [{ type: "text", text: lines.join("\n") }] };
    }
  );

  // ---- get-trustees ----
  server.tool(
    "get-trustees",
    "Get the RCSD Board of Trustees (name, trustee area, officer role, term years, email, school assignments) plus the superintendent, cabinet, and district office contact info (address, phone)",
    {
      lang: z
        .enum(["en", "es"])
        .optional()
        .describe("Label language: 'en' (default) or 'es'"),
    },
    async ({ lang }) => {
      const data = await fetchJSON("trustees.json");
      const es = lang === "es";
      const lines: string[] = [
        es ? "=== Mesa Directiva de RCSD (Board of Trustees) ===" : "=== RCSD Board of Trustees ===",
      ];

      for (const t of data.trustees || []) {
        const role = es ? t.roleEs : t.roleEn;
        const assignments = (es ? t.assignmentsEs : t.assignmentsEn) || [];
        lines.push("");
        lines.push(`${t.name}${role ? ` — ${role}` : ""}`);
        lines.push(`  ${es ? "Área" : "Trustee Area"}: ${t.area}`);
        // termEndYear is authoritative (from the district site); seats turn over
        // after the November election of the end year.
        lines.push(`  ${es ? "Período" : "Term"}: ${t.termStartYear}–${t.termEndYear}`);
        if (t.email) lines.push(`  Email: ${t.email}`);
        if (assignments.length) {
          lines.push(`  ${es ? "Escuelas asignadas" : "School assignments"}: ${assignments.join(", ")}`);
        }
      }

      const formatExec = (p: any): string[] => {
        const out = [`${p.name} — ${es ? p.titleEs : p.titleEn}`];
        const status = es ? p.statusEs : p.statusEn;
        if (status) out.push(`  ${status}`);
        if (p.email) out.push(`  Email: ${p.email}`);
        return out;
      };

      // Superintendent transition: current serves through 2026-06-30, incoming
      // starts 2026-07-01 — surface both so answers stay correct across the change.
      const sup = data.superintendent;
      if (sup?.current || sup?.incoming) {
        lines.push("", es ? "=== Superintendente ===" : "=== Superintendent ===");
        if (sup.current) lines.push(...formatExec(sup.current));
        if (sup.incoming) {
          lines.push("");
          lines.push(...formatExec(sup.incoming));
        }
      }

      if (data.cabinet?.length) {
        lines.push("", es ? "=== Gabinete ===" : "=== Cabinet ===");
        for (const c of data.cabinet) {
          lines.push(`${c.name} — ${es ? c.titleEs : c.titleEn}`);
        }
      }

      // Verified district office contact (rcsdk8.net site footer, checked
      // 2026-07-21). Kept here so agents cite a real number instead of
      // improvising one — 650-423-22xx numbers seen in old board docs are
      // department extensions, not the main line.
      lines.push(
        "",
        es ? "=== Oficina del Distrito ===" : "=== District Office ===",
        "750 Bradford St., Redwood City, CA 94063",
        `${es ? "Teléfono" : "Phone"}: (650) 482-2200`,
        `${es ? "Sitio oficial" : "Official site"}: https://www.rcsdk8.net`,
      );

      lines.push("", sourceLine("trustees.json", data._metadata?.retrieved));
      return {
        content: [{ type: "text", text: lines.join("\n") }],
        structuredContent: {
          trustees: data.trustees,
          superintendent: data.superintendent,
          cabinet: data.cabinet,
        },
      };
    }
  );

  // ---- list-meetings ----
  server.tool(
    "list-meetings",
    "List board meetings newest-first (date, type, slug, video/transcript availability, topic line) with optional year/type filters and offset/limit paging",
    {
      year: z
        .number()
        .int()
        .min(2020)
        .max(2100)
        .optional()
        .describe("Filter to a calendar year (e.g. 2026); corpus starts in 2020"),
      type: z
        .string()
        .optional()
        .describe("Filter by meeting type substring (e.g. 'Regular', 'Special', 'Study Session')"),
      limit: z
        .number()
        .min(1)
        .max(50)
        .default(20)
        .optional()
        .describe("Max meetings to return (default 20)"),
      offset: z
        .number()
        .min(0)
        .default(0)
        .optional()
        .describe("Skip this many meetings (for paging)"),
    },
    async ({ year, type, limit, offset }) => {
      const data = await fetchJSON("meetings-data.json");
      let meetings = data.meetings; // sorted newest-first
      if (year) meetings = meetings.filter((m: any) => m.date.startsWith(`${year}-`));
      if (type) {
        const t = type.toLowerCase();
        meetings = meetings.filter((m: any) => (m.type || "").toLowerCase().includes(t));
      }

      const total = meetings.length;
      const start = offset || 0;
      const page = meetings.slice(start, start + (limit || 20));
      if (page.length === 0) {
        return {
          content: [
            {
              type: "text",
              text: `No meetings match (${total} total${year ? ` in ${year}` : ""}${type ? ` of type ~"${type}"` : ""}). Try a different year/type or a smaller offset.`,
            },
          ],
        };
      }

      const lines = page.map((m: any) => {
        const flags = [m.youtube ? "video" : null, m.hasTranscript ? "transcript" : null]
          .filter(Boolean)
          .join(", ");
        // topics[0] is a one-line AI-generated summary of the meeting's contents
        const topic = m.topics?.[0] || "";
        let line = `${m.date}  ${m.type} (slug: ${m.slug})${flags ? ` [${flags}]` : ""}`;
        if (topic) line += `\n    ${topic.slice(0, 200)}${topic.length > 200 ? "…" : ""}`;
        return line;
      });

      const header = `Board meetings ${start + 1}–${start + page.length} of ${total}${year ? ` in ${year}` : ""}${type ? ` matching type "${type}"` : ""}, newest first (use get-meeting-details for agendas, search-transcript for transcripts):`;
      const footer = `${AI_NOTE_EN}\n${sourceLine("meetings-data.json", data.generated)}`;
      return {
        content: [{ type: "text", text: `${header}\n\n${lines.join("\n")}\n\n${footer}` }],
        structuredContent: {
          total,
          offset: start,
          meetings: page.map((m: any) => ({
            date: m.date,
            type: m.type,
            slug: m.slug,
            youtube: m.youtube || null,
            hasTranscript: !!m.hasTranscript,
          })),
        },
      };
    }
  );

  // ---- get-meeting-summary ----
  server.tool(
    "get-meeting-summary",
    "Get AI-generated board meeting summaries (English or Spanish). Returns the most recent meetings or a specific date.",
    {
      date: z
        .string()
        .optional()
        .describe("Specific meeting date (YYYY-MM-DD), or omit for recent meetings"),
      limit: z
        .number()
        .min(1)
        .max(20)
        .default(5)
        .optional()
        .describe("Number of recent meetings to return (default 5)"),
      lang: z
        .enum(["en", "es"])
        .optional()
        .describe("Summary language: 'en' (default) or 'es'"),
    },
    async ({ date, limit, lang }) => {
      const file = lang === "es" ? "meeting-summaries-es.json" : "meeting-summaries.json";
      const note = lang === "es" ? AI_NOTE_ES : AI_NOTE_EN;
      const summaries = await fetchJSON(file);
      const keys = Object.keys(summaries).sort().reverse();
      const footer = `\n\n${note}\n${sourceLine(file)}`;

      if (date) {
        // Dates with multiple meetings are keyed by slug (e.g.
        // "2020-04-01-board-meeting-2"), so fall back to prefix matches.
        const matched: [string, string][] = summaries[date]
          ? [[date, stripHtml(summaries[date])]]
          : keys.filter((k) => k.startsWith(date)).map((k) => [k, stripHtml(summaries[k])]);
        if (matched.length === 0) {
          const nearest = keys.slice(0, 5).join(", ");
          return {
            content: [
              {
                type: "text",
                text: `No meeting summary for ${date}. Recent meetings: ${nearest}`,
              },
            ],
          };
        }
        const body = matched.map(([k, s]) => `Board Meeting ${k}:\n${s}`).join("\n\n");
        return { content: [{ type: "text", text: `${body}${footer}` }] };
      }

      const count = limit || 5;
      const lines = keys.slice(0, count).map((d) => `${d}: ${stripHtml(summaries[d])}`);
      return { content: [{ type: "text", text: `${lines.join("\n\n")}${footer}` }] };
    }
  );

  // ---- get-meeting-details ----
  server.tool(
    "get-meeting-details",
    "Get comprehensive details about a specific board meeting: agenda items, timestamps, chapter markers, transcript link, topics, and threads",
    {
      meeting: z
        .string()
        .describe("Meeting date (YYYY-MM-DD) or slug (e.g. '2026-03-25-regular')"),
    },
    async ({ meeting }) => {
      // Fetch all required data in parallel
      const [meetingsData, summaries, timestampMap, chapterMarkers] = await Promise.all([
        fetchJSON("meetings-data.json"),
        fetchJSON("meeting-summaries.json"),
        fetchJSON("timestamp-map.json"),
        fetchJSON("chapter-markers.json"),
      ]);

      // board-memos holds the rich per-item body (Quick Summary / Rationale /
      // Financial Impact / etc). Scraped by scrape-board-packets.mjs into
      // data/board-memos/{date}.json. Keyed by lowercase item title since
      // meetings-data.json and board-memos use different item orderings.
      let memoByTitle: Map<string, any> = new Map();

      // Find the meeting by date or slug
      const isDate = /^\d{4}-\d{2}-\d{2}$/.test(meeting);
      const mtg = meetingsData.meetings.find((m: any) =>
        isDate ? m.date === meeting : m.slug === meeting
      );

      if (!mtg) {
        // meetings-data.json is sorted newest-first
        const recent = meetingsData.meetings
          .slice(0, 5)
          .map((m: any) => `${m.date} (${m.slug})`)
          .join(", ");
        return {
          isError: true,
          content: [
            {
              type: "text",
              text: `Meeting not found: "${meeting}". Recent meetings: ${recent}`,
            },
          ],
        };
      }

      // Lazy-load the memo file. Not all meetings have one (older meetings
      // predate the scraper), so swallow 404s and fall back to title-only.
      try {
        const memoDoc = await fetchJSON(`board-memos/${mtg.date}.json`);
        for (const it of memoDoc.items || []) {
          const key = (it.title || "").toLowerCase().trim();
          if (key && it.memo && Object.keys(it.memo).length > 0) {
            memoByTitle.set(key, it.memo);
          }
        }
      } catch {
        // no memo data for this meeting — continue without bodies
      }

      const lines: string[] = [];

      // 1. Basic info
      lines.push(`=== Board Meeting: ${mtg.date} (${mtg.type}) ===`);
      lines.push(`Slug: ${mtg.slug}`);
      lines.push(`Source: ${mtg.source}`);
      if (mtg.simbli) lines.push(`Simbli: ${mtg.simbli}`);
      if (mtg.boarddocs) lines.push(`BoardDocs: ${mtg.boarddocs}`);
      if (mtg.youtube) lines.push(`YouTube: https://www.youtube.com/watch?v=${mtg.youtube}`);
      if (mtg.zoom) lines.push(`Zoom: ${mtg.zoom}`);

      // 2. Summary (multi-meeting dates are keyed by slug)
      const summary = stripHtml(summaries[mtg.date] || summaries[mtg.slug] || "");
      if (summary) {
        lines.push("");
        lines.push("--- Summary ---");
        lines.push(summary);
        lines.push(AI_NOTE_EN);
      }

      // 3. Topics and threads
      if (mtg.topics && mtg.topics.length > 0) {
        lines.push("");
        lines.push("--- Topics ---");
        for (const topic of mtg.topics) {
          lines.push(`  - ${topic}`);
        }
      }
      if (mtg.threads && mtg.threads.length > 0) {
        lines.push("");
        lines.push("--- Threads ---");
        for (const thread of mtg.threads) {
          lines.push(`  - ${thread}`);
        }
      }

      // 4. Agenda items (skip procedural)
      const proceduralTitles = new Set([
        "call to order",
        "roll call",
        "pledge of allegiance",
        "adjournment",
        "closed session",
        "reconvene to open session",
        "report out of closed session",
      ]);

      if (mtg.items && mtg.items.length > 0) {
        const substantiveItems = mtg.items.filter((item: any) => {
          if (item.actionType === "Procedural") return false;
          const titleLower = (item.title || "").toLowerCase().trim();
          return !proceduralTitles.has(titleLower);
        });

        if (substantiveItems.length > 0) {
          lines.push("");
          lines.push(`--- Agenda Items (${substantiveItems.length} substantive) ---`);
          for (const item of substantiveItems) {
            const label = item.itemLabel ? `[${item.itemLabel}] ` : "";
            const action = item.actionType ? ` (${item.actionType})` : "";
            const speaker = item.speaker ? ` — ${item.speaker}` : "";
            lines.push(`  ${label}${item.title}${action}${speaker}`);

            // Surface the rich memo body fields (Quick Summary / Rationale /
            // Financial Impact / Recommendation) so callers don't have to fetch
            // and read PDFs to understand what's actually being voted on.
            const memo = memoByTitle.get((item.title || "").toLowerCase().trim());
            if (memo) {
              const fieldOrder = [
                "Quick Summary / Abstract",
                "Recommendation",
                "Rationale",
                "Financial Impact",
              ];
              for (const field of fieldOrder) {
                const v = memo[field];
                if (v) lines.push(`    ${field}: ${v}`);
              }
            }

            if (item.attachments && item.attachments.length > 0) {
              for (const att of item.attachments) {
                const url = `https://data.rcsd.info/board-packets/${mtg.date}/${att.filename}`;
                lines.push(`    📎 ${att.title}: ${url}`);
              }
            }
          }
        }
      }

      // 5. Timestamp mappings
      if (mtg.youtube && timestampMap[mtg.youtube]) {
        const timestamps = timestampMap[mtg.youtube];
        lines.push("");
        lines.push("--- Video Timestamps ---");
        for (const ts of timestamps) {
          const start = formatTimestamp(ts.startTime);
          const end = ts.endTime ? ` - ${formatTimestamp(ts.endTime)}` : "";
          lines.push(`  ${start}${end}: ${ts.item}`);
        }
      }

      // 6. Chapter markers
      const markers = chapterMarkers[mtg.slug] || chapterMarkers[mtg.date];
      if (markers && markers.length > 0) {
        lines.push("");
        lines.push("--- Chapter Markers ---");
        for (const ch of markers) {
          const time = formatTimestamp(ch.timestamp || ch.startTime || 0);
          lines.push(`  ${time}: ${ch.topic || ch.title}`);
        }
      }

      // 7. Transcript availability
      const transcriptUrl = `https://data.rcsd.info/transcripts/${mtg.date}.json`;
      const viewerUrl = `https://rcsd.info/meetings/${mtg.slug}/`;
      lines.push("");
      lines.push("--- Transcript ---");
      try {
        const res = await fetch(transcriptUrl, { method: "HEAD" });
        if (res.ok) {
          lines.push(`Transcript available: ${transcriptUrl}`);
          lines.push(`Viewer: ${viewerUrl}`);
          lines.push(ASR_NOTE_EN);
        } else {
          lines.push("No transcript available for this meeting.");
        }
      } catch {
        lines.push("Unable to check transcript availability.");
      }

      lines.push("");
      lines.push(sourceLine("meetings-data.json", meetingsData.generated));

      return { content: [{ type: "text", text: lines.join("\n") }] };
    }
  );

  // ---- search-transcript ----
  server.tool(
    "search-transcript",
    "Search one board meeting's transcript for a word or phrase; returns matching utterances with timestamps and speakers. (Full-corpus transcript search is not offered — transcripts are one file per meeting.)",
    {
      date: z
        .string()
        .describe("Meeting date (YYYY-MM-DD); use list-meetings to find dates with the transcript flag"),
      query: z
        .string()
        .min(2)
        .describe("Word or phrase to find (case-insensitive substring match)"),
      lang: z
        .enum(["en", "es"])
        .optional()
        .describe("Transcript language: 'en' (default) or 'es' (machine-translated)"),
      limit: z
        .number()
        .min(1)
        .max(50)
        .default(20)
        .optional()
        .describe("Max matching utterances to return (default 20)"),
    },
    async ({ date, query, lang, limit }) => {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
        return { isError: true, content: [{ type: "text", text: "Date must be YYYY-MM-DD format" }] };
      }
      // Transcripts are one ~130 KB JSON per meeting at /transcripts/<date>.json
      // (Spanish machine translation at <date>-es.json).
      const url = `https://data.rcsd.info/transcripts/${date}${lang === "es" ? "-es" : ""}.json`;
      let tr: any;
      try {
        tr = await fetchJSON(url);
      } catch {
        return {
          content: [
            {
              type: "text",
              text: `No ${lang === "es" ? "Spanish " : ""}transcript available for ${date}. Use list-meetings to find meetings with the [transcript] flag.`,
            },
          ],
        };
      }

      const q = query.toLowerCase();
      // The -es translation files ship an empty speakers map; the speaker
      // identities live in the English original, so borrow them from there.
      let speakers = tr.speakers || {};
      if (lang === "es" && Object.keys(speakers).length === 0) {
        try {
          const en = await fetchJSON(`https://data.rcsd.info/transcripts/${date}.json`);
          speakers = en.speakers || {};
        } catch {
          // fall back to letter labels
        }
      }
      const all = (tr.utterances || []).filter((u: any) =>
        (u.text || "").toLowerCase().includes(q)
      );
      const note = lang === "es" ? ASR_NOTE_ES : ASR_NOTE_EN;
      const footer = `${note}\n${sourceLine(url)}`;

      if (all.length === 0) {
        return {
          content: [
            {
              type: "text",
              text: `No matches for "${query}" in the ${date} transcript (${tr.utterances?.length || 0} utterances searched).\n\n${footer}`,
            },
          ],
        };
      }

      const shown = all.slice(0, limit || 20);
      const lines: string[] = [
        `Matches for "${query}" in the ${date} ${tr.type || ""} meeting transcript — showing ${shown.length} of ${all.length}:`,
      ];
      if (tr.videoId) {
        lines.push(
          `Video: https://www.youtube.com/watch?v=${tr.videoId} (append &t=<seconds>s to jump to a timestamp)`
        );
      }
      for (const u of shown) {
        const sp = speakers[u.speaker];
        const who = sp ? `${sp.name}${sp.role ? ` (${sp.role})` : ""}` : `Speaker ${u.speaker}`;
        // utterance start/end are in milliseconds
        const secs = Math.floor((u.start || 0) / 1000);
        const text = (u.text || "").length > 400 ? `${u.text.slice(0, 400)}…` : u.text;
        lines.push("");
        lines.push(`[${formatTimestamp(secs)} | t=${secs}s] ${who}:`);
        lines.push(`  ${text}`);
      }
      lines.push("", footer);
      return { content: [{ type: "text", text: lines.join("\n") }] };
    }
  );

  // ---- find-document ----
  server.tool(
    "find-document",
    "Find board documents by title keywords — searches board-packet attachments, the classified document index, and curated off-portal documents; returns title, meeting date, and direct URL",
    {
      query: z
        .string()
        .min(2)
        .describe("Keywords matched against document/agenda-item titles (all words must match, case-insensitive; e.g. 'facilities master plan')"),
      limit: z
        .number()
        .min(1)
        .max(25)
        .default(10)
        .optional()
        .describe("Max documents to return (default 10)"),
    },
    async ({ query, limit }) => {
      // document-index.json (~640 KB, 1000+ docs) and agenda-attachments.json
      // (~165 KB) are small enough to fetch in-Worker; the 5-minute module cache
      // means at most one refetch per file per isolate per TTL.
      const [docIndex, agendaAtt] = await Promise.all([
        fetchJSON("document-index.json"),
        fetchJSON("agenda-attachments.json"),
      ]);
      // Hand-curated off-portal docs (e.g. the adopted FMP); optional file.
      let linked: any = null;
      try {
        linked = await fetchJSON("linked-documents.json");
      } catch {
        // not published — search proceeds without it
      }

      const terms = query.toLowerCase().split(/\s+/).filter(Boolean);
      const matchesTerms = (hay: string) => terms.every((t) => hay.includes(t));

      type Hit = {
        title: string;
        meetingDate: string | null;
        itemLabel?: string | null;
        itemTitle?: string | null;
        url: string;
        source: string;
      };
      const hits: Hit[] = [];
      const seenAids = new Set<string>(); // same attachment appears in both indexes

      // 1. Classified document index (preferred: R2-hosted URLs, typed by kind)
      for (const doc of docIndex.documents || []) {
        const hay = `${doc.title} ${doc.itemTitle || ""} ${doc.type || ""} ${doc.subtype || ""}`.toLowerCase();
        if (!matchesTerms(hay)) continue;
        if (doc.aid) seenAids.add(doc.aid);
        hits.push({
          title: doc.title,
          meetingDate: doc.meetingDate || null,
          itemLabel: doc.itemLabel,
          itemTitle: doc.itemTitle,
          url: doc.url,
          source: "document-index",
        });
      }

      // 2. Raw agenda attachments (Simbli-hosted; covers docs the classifier skipped)
      for (const [date, mtg] of Object.entries(agendaAtt)) {
        if (date.startsWith("_")) continue;
        for (const att of (mtg as any).attachments || []) {
          if (att.aid && seenAids.has(att.aid)) continue;
          if (!matchesTerms((att.title || "").toLowerCase())) continue;
          hits.push({
            title: att.title,
            meetingDate: date,
            url: att.url,
            source: "agenda-attachments",
          });
        }
      }

      // 3. Curated off-portal documents (linked from agenda memos, hosted elsewhere)
      for (const doc of linked?.documents || []) {
        const hay = `${doc.title} ${doc.itemTitle || ""} ${doc.note || ""}`.toLowerCase();
        if (!matchesTerms(hay)) continue;
        hits.push({
          title: doc.title,
          meetingDate: doc.meetingDate || null,
          itemTitle: doc.itemTitle,
          url: doc.url,
          source: "linked-documents",
        });
      }

      const sources = `Sources: ${DATA_BASE}/document-index.json (as of ${docIndex.generated}), ${DATA_BASE}/agenda-attachments.json${linked ? `, ${DATA_BASE}/linked-documents.json` : ""}`;

      if (hits.length === 0) {
        return {
          content: [
            {
              type: "text",
              text: `No board documents match "${query}". All words must appear in the document or agenda-item title — try fewer or different keywords.\n\n${sources}`,
            },
          ],
        };
      }

      hits.sort((a, b) => (b.meetingDate || "").localeCompare(a.meetingDate || ""));
      const shown = hits.slice(0, limit || 10);
      const lines: string[] = [
        `Board documents matching "${query}" — showing ${shown.length} of ${hits.length}, newest first:`,
      ];
      for (const h of shown) {
        lines.push("");
        lines.push(`${h.meetingDate || "(no date)"} ${h.itemLabel ? `[${h.itemLabel}] ` : ""}${h.title}`);
        if (h.itemTitle) lines.push(`  Item: ${h.itemTitle}`);
        lines.push(`  ${h.url}`);
      }
      lines.push("", sources);
      return {
        content: [{ type: "text", text: lines.join("\n") }],
        structuredContent: { query, total: hits.length, results: shown },
      };
    }
  );

  // ---- get-school-board-items ----
  server.tool(
    "get-school-board-items",
    "Get board agenda items related to a specific school (AI-generated summaries, English or Spanish)",
    {
      school: z.string().describe("School name or slug"),
      limit: z
        .number()
        .min(1)
        .max(20)
        .default(10)
        .optional()
        .describe("Max items to return (default 10)"),
      lang: z
        .enum(["en", "es"])
        .optional()
        .describe("Summary language: 'en' (default) or 'es'"),
    },
    async ({ school, limit, lang }) => {
      const data = await fetchJSON("schools.json");
      const found = findSchool(data.schools, school);
      if (!found) {
        return {
          isError: true,
          content: [
            {
              type: "text",
              text: `School not found: "${school}". Available: ${data.schools.map((s: any) => s.slug).join(", ")}`,
            },
          ],
        };
      }

      const summaries = await fetchJSON("school-board-summaries.json");
      const entries: { date: string; title: string; summary: string }[] = [];

      for (const [key, schools] of Object.entries(summaries)) {
        const schoolData = (schools as Record<string, any>)[found.slug];
        if (schoolData) {
          const [date, ...titleParts] = key.split("|");
          entries.push({
            date,
            title: titleParts.join("|"),
            summary: stripHtml((lang === "es" ? schoolData.es : schoolData.en) || schoolData.en),
          });
        }
      }

      entries.sort((a, b) => b.date.localeCompare(a.date));
      const count = limit || 10;
      const result = entries.slice(0, count);

      if (result.length === 0) {
        return {
          content: [
            { type: "text", text: `No school-specific board items found for ${found.nameShort}` },
          ],
        };
      }

      const note = lang === "es" ? AI_NOTE_ES : AI_NOTE_EN;
      const lines = result.map((m) => `${m.date}: ${m.title}\n  ${m.summary}`);
      return {
        content: [
          {
            type: "text",
            text: `Board items for ${found.nameShort}:\n\n${lines.join("\n\n")}\n\n${note}\n${sourceLine("school-board-summaries.json")}`,
          },
        ],
      };
    }
  );

  // ---- get-sped-data ----
  server.tool(
    "get-sped-data",
    "Get special education (IEP) enrollment data for a school or district-wide",
    {
      school: z
        .string()
        .optional()
        .describe("School name or slug (omit for district-wide totals)"),
    },
    async ({ school }) => {
      const [sped, cats] = await Promise.all([
        fetchJSON("sped-enrollment.json"),
        fetchJSON("sped-categories.json"),
      ]);

      if (!school) {
        // District-wide
        const d = sped.district;
        const schoolsData = await fetchJSON("schools.json");
        const totalEnrollment = schoolsData.schools.reduce((sum: number, s: any) => sum + s.enrollment, 0);
        const districtPct = ((d.total / totalEnrollment) * 100).toFixed(1);
        const lines = [
          `RCSD District Special Education (${sped._source.year})`,
          `  Total enrollment: ${totalEnrollment.toLocaleString()}`,
          `  Total IEP students: ${d.total} (${districtPct}% district average)`,
          `  By grade: ${Object.entries(d.grades)
            .map(([g, n]) => `${g}: ${n ?? "suppressed (<11)"}`)
            .join(", ")}`,
          "",
          "Per school:",
        ];
        for (const [slug, data] of Object.entries(sped.schools) as [string, any][]) {
          lines.push(`  ${slug}: ${data.total} / ${data.totalEnrollment} students (${data.pct}%)`);
        }
        lines.push("", `Source: ${sped._source.dataset} ${sped._source.year} (retrieved ${sped._source.retrievedDate}) via ${DATA_BASE}/sped-enrollment.json`);
        return { content: [{ type: "text", text: lines.join("\n") }] };
      }

      const schoolsData = await fetchJSON("schools.json");
      const found = findSchool(schoolsData.schools, school);
      if (!found) {
        return {
          isError: true,
          content: [
            {
              type: "text",
              text: `School not found: "${school}". Available: ${schoolsData.schools.map((s: any) => s.slug).join(", ")}`,
            },
          ],
        };
      }

      const schoolSped = sped.schools[found.slug];
      if (!schoolSped) {
        return { content: [{ type: "text", text: `No SpEd data available for ${found.nameShort}` }] };
      }

      const lines = [
        `${found.name} — Special Education (${sped._source.year})`,
        `  IEP Students: ${schoolSped.total} / ${schoolSped.totalEnrollment} (${schoolSped.pct}%)`,
      ];

      if (schoolSped.grades) {
        lines.push(
          `  By grade: ${Object.entries(schoolSped.grades)
            .map(([g, n]) => `${g}: ${n ?? "suppressed (<11)"}`)
            .join(", ")}`
        );
      }

      const schoolCats = cats.schools?.[found.slug];
      if (schoolCats?.placement) {
        const p = schoolCats.placement;
        lines.push(
          "",
          "  LRE Placement:",
          `    Regular class >80%: ${p.regularGt80} (${Math.round((p.regularGt80 / p.total) * 100)}%)`,
          `    Regular class 40-79%: ${p.regular40to79}`,
          `    Regular class <40%: ${p.regularLt40}`,
          `    Separate school: ${p.separateSchool}`
        );
      }

      lines.push("", `Source: ${sped._source.dataset} ${sped._source.year} (retrieved ${sped._source.retrievedDate}) via ${DATA_BASE}/sped-enrollment.json`);
      return { content: [{ type: "text", text: lines.join("\n") }] };
    }
  );

  // ---- list-policies ----
  server.tool(
    "list-policies",
    "List all RCSD school board policies, bylaws, and regulations, with optional filtering",
    {
      section: z.string().optional().describe("Filter by section code (e.g. '0000', '1000', '5000', '9000')"),
      type: z.string().optional().describe("Filter by type (BP, AR, BB)"),
      query: z.string().optional().describe("Search keywords in code or title"),
    },
    async ({ section, type, query }) => {
      const data = await fetchJSON("policies-index.json");
      let list = data.policies || [];
      
      if (section) {
        list = list.filter((p: any) => p.section === section);
      }
      if (type) {
        const t = type.toUpperCase();
        list = list.filter((p: any) => p.type === t);
      }
      if (query) {
        const q = query.toLowerCase();
        list = list.filter((p: any) => 
          p.code.toLowerCase().includes(q) || 
          p.title.toLowerCase().includes(q)
        );
      }

      if (list.length === 0) {
        return { content: [{ type: "text", text: "No policies match the specified filters." }] };
      }

      const lines = list.map(
        (p: any) =>
          `[${p.code}] ${p.title} (${p.type}) - Revised: ${p.lastRevised || 'Unmodified'}`
      );

      const asOf = data._metadata?.scrapedAt?.slice(0, 10);
      return {
        content: [
          {
            type: "text",
            text: `Redwood City SD Board Policies (${list.length} matches):\n\n${lines.join("\n")}\n\n${sourceLine("policies-index.json", asOf)}`,
          },
        ],
      };
    }
  );

  // ---- get-policy ----
  server.tool(
    "get-policy",
    "Get the full plain-text rules, legal citations, and cross-references of a specific board policy by code and type",
    {
      code: z.string().describe("The policy code number (e.g., '0100', '5141.22')"),
      type: z.string().describe("The policy type abbreviation: 'BP' (Board Policy), 'AR' (Administrative Regulation), 'BB' (Board Bylaw), etc."),
    },
    async ({ code, type }) => {
      const formattedType = type.toUpperCase();
      const filename = `board-policies/${code}-${formattedType}.json`;
      
      try {
        const data = await fetchJSON(filename);
        const lines = [
          `=== RCSD Board Policy: ${data.code} (${data.type}) ===`,
          `Title: ${data.title}`,
          `Section: ${data.section || 'N/A'}`,
          `Last Revised: ${data.lastRevised || 'Unmodified'}`,
          `Last Reviewed: ${data.lastReviewed || 'N/A'}`,
          "",
          "--- Policy Rules & Content ---",
          data.contentText || "(No plain text content available)",
        ];

        // Footnotes / Legal References
        if (data.footnotes && data.footnotes.length > 0) {
          lines.push("", "--- Legal & Resource Citations ---");
          for (const group of data.footnotes) {
            lines.push(`[${group.type}]`);
            for (const ref of group.references || []) {
              const urlPart = ref.url ? ` (${ref.url})` : "";
              lines.push(`  - ${ref.code}: ${ref.description}${urlPart}`);
            }
          }
        }

        // Cross References
        if (data.crossRefs && data.crossRefs.length > 0) {
          lines.push("", "--- Cross References ---");
          for (const ref of data.crossRefs) {
            lines.push(`  - [${ref.code} ${ref.type}] ${ref.title}`);
          }
        }

        lines.push("", sourceLine(filename));
        return { content: [{ type: "text", text: lines.join("\n") }] };
      } catch (err: any) {
        return {
          isError: true,
          content: [
            {
              type: "text",
              text: `Failed to retrieve policy ${code} (${formattedType}). Verify that the code and type are correct.\nError: ${err.message}`,
            },
          ],
        };
      }
    }
  );

  return server;
}

// ---- Worker entry point ----

export default {
  async fetch(request: Request, env: any, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);

    // Serve MCP at /mcp
    if (url.pathname === "/mcp" || url.pathname.startsWith("/mcp/")) {
      const server = createServer();
      return createMcpHandler(server)(request, env, ctx);
    }

    // Favicon — static embed of docs/favicon.ico (5430 bytes, 16x16 + 32x32)
    if (url.pathname === "/favicon.ico") {
      const b64 = "AAABAAIAEBAAAAEAIABoBAAAJgAAACAgAAABACAAqBAAAI4EAAAoAAAAEAAAACAAAAABACAAAAAAAAAEAAAAAAAAAAAAAAAAAAAAAAAA0cN+/8u8dP/LvXT/zL11/8y9df/MvXX/zL11/8y9df/MvXX/zL12/8y9df/MvXX/zL11/8y9df/LvHT/0cR//8m8c//BtGb/wrVo/8K1Z//CtWf/wrRo/8K0aP/CtGf/wrVo/8K1aP/CtWj/wrVn/8K1Z//CtWf/wbRn/8m9c//Lv3j/xLhr/8S4bP/FuGz/xbhs/8W4bP/EuGz/yLx0/8W5bP/FuGz/xbhs/8W4bP/EuGz/xbhs/8S4a//LwHf/zMF7/8W5bv/Fum//xbpv/8W6b//FuW7/w7Zn/9DJkf/QxH3/ybpp/8a6bv/Fum//xbpu/8W6b//FuW7/zMJ7/83DfP/GvHH/x71y/8e8cv/HvHL/x7xx/9nRmv/Pzqf/ka2o/6Gwkf/IvXH/x71y/8e9cv/HvXL/xrxx/83Fff/NxX7/yL10/8i+dP/IvnT/xrtv/9/asP/9/fz/0tS+/1GHof8zj/P/jauk/87AcP/IvnT/yb50/8i9c//Nxn//zsiB/8fBdv/Iwnb/x8F0/87Ihv/5+PH/sbic/2FuMf9QZTD/PnaR/0mW3v+6vYH/ysJ1/8jCdv/HwXb/zsmC/8/KhP/JxXr/ycV6/8jDd//Tz5T//////8TJsv9YZyX/UWIg/0B3mf87kez/r7uO/8zGeP/JxXr/yMR5/8/Lhf/RzIf/zMZ9/8zGff/KxXn/2NSf///////u7+j/bntB/1BrKP9Bkr3/M470/6q6lv/QyHr/zMd9/8vGfP/RzYn/0s6L/83Igv/NyIL/zMd//9bSm//r6tD//Pz5/42Waf9QeTz/ab2g/3Cnw/+wvZb/0MqA/87Jgv/NyIL/0s+M/9TPjP/Qy4P/0MuE/9DLhP/PyoL/z8uG//v68//HzLb/XqJ4/4DMqf/PzIL/0MuD/9DLhP/Qy4T/0MuD/9TQjf/T0I//z8yG/9DMh//QzIf/0MyH/8/Lg//d26z/6/Tt/4rRt/+1zZX/0syF/9DMhv/QzIf/0MyH/9DMhv/U0Y//1NGR/9DNiP/RzYn/0c2I/9DMiP/RzYj/0MqB/9Tcs/+81KT/1MyF/9HNiP/RzYj/0c2I/9DMiP/QzIf/1NGQ/9TSkf/Rzoj/0c6J/9HOiP/Rzon/0s6I/9LOiP/QzYj/0s6J/9LOiP/Szoj/0c6I/9HOiP/Rzon/0c6I/9XTkf/V1JP/09GK/9LRi//T0Yv/0tGL/9LRiv/T0Yv/09GL/9PRiv/T0Yv/09GL/9PRi//T0Yv/09GL/9PRiv/W1ZL/2NmY/9bWkv/W1pP/1taT/9fWk//W1pP/1taT/9bWkv/W1pP/1taT/9bWkv/W1pL/1taT/9bWk//W1pL/2tqb/wAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAoAAAAIAAAAEAAAAABACAAAAAAAAAQAAAAAAAAAAAAAAAAAAAAAAAA0sSA/8y9dv/MvXb/zL12/8y9dv/MvXb/zL12/8y9dv/MvXb/zL12/8y9dv/MvXb/zL12/8y9dv/MvXb/zL12/8y9dv/MvXf/zb53/8y9d//MvXb/zL13/8y9d//MvXb/zL12/8y9dv/MvXb/zb52/8y+dv/MvXb/zL11/9LEgf/Ku3L/wrNl/8OzZv/Cs2b/w7Rm/8OzZv/Ds2b/w7Nm/8OzZv/Ds2b/w7Nm/8OzZv/Ds2b/w7Nm/8OzZv/Ds2b/w7Rm/8O0Z//DtGb/w7Nm/8O0Zv/Ds2b/w7Nm/8OzZv/Ds2b/w7Nm/8OzZv/DtGb/w7Rm/8OzZv/Ds2X/yrxz/8q9df/CtWf/w7Zo/8O1af/DtWn/w7Vo/8O1aP/Dtmj/w7Vo/8O1af/DtWj/w7Vp/8O1af/DtWn/w7Vp/8O1af/Ctmj/wrZp/8O2af/DtWn/w7Zp/8O2af/Ctmj/w7Vp/8K2af/Ctmn/w7Zo/8O2aP/Dtmn/w7Vp/8K1aP/KvnX/yr53/8K2af/Ct2r/wrZq/8O3av/Ctmr/wrZq/8K2av/Ctmr/wrZq/8K2av/Ctmr/wrdr/8K2av/Ctmr/wrZq/8K2av/Ctmr/wrdq/8K3av/Ctmr/wrdq/8K3av/Ct2r/wrdq/8K3av/Ct2r/wrdq/8K3av/Ct2r/wrZp/8q/d//Lv3n/xbdr/8W4bP/FuGz/xbhs/8W4bP/FuGz/xbhs/8W4bP/GuGz/xrhs/8W4bP/FuWz/xbls/8W4av/Et2j/xbls/8W5bP/FuWz/xbhs/8W4bP/FuGz/xbhs/8W4bP/FuGz/xbls/8W4bP/FuWz/xbhs/8W5bP/FuGv/y8B4/8zAe//FuG3/xblu/8W5bv/FuW7/xblu/8W5bv/FuW7/xblt/8W5bv/Gum7/xblu/8W6bf/FuGz/zMKC/9fPlf/EuGr/xblu/8W5bf/GuW3/xblt/8W5bf/FuW3/xblt/8W5bv/FuW7/xblu/8W5bv/Gum7/xblu/8W5bf/MwXr/zMJ8/8S5bv/FuW//xblv/8W5b//FuW//xrlv/8W5bv/FuW7/xblu/8W5bv/FuW7/xblu/8W5bP/HvX3/7uvV/8vBev/FuW3/xblu/8W5bv/FuW7/xblu/8W5bv/FuW7/xblu/8a5bv/FuW7/xrlu/8W6b//Gum7/xblu/8zCfP/Mw3z/xbpv/8W6cP/Fum//xbpw/8W6cP/FunD/xbpv/8W6cP/FunD/xrpw/8W6b//Fum//xblu/8K2Zv/HxZv/3dak/8i5Z//Hu2//xbpw/8W6b//Fum//xbpv/8W6cP/Fum//xbpv/8W6b//Fum7/xbpv/8W6cP/Fum7/zMN9/83Eff/GvHH/x7xy/8e8c//HvHL/x7xy/8e8cv/GvHL/xrxy/8e8cv/HvHL/xrtw/8W6bf/Lwn3/3dWi/6ere/+2xLP/nbCW/766ef/Mvm7/yLxx/8e8cv/HvHL/x7xy/8e8cv/GvHL/x7xy/8e8cv/HvHL/x7xy/8a7cf/MxX7/zsV+/8e9cv/HvnL/yL5z/8i+cv/IvnL/yL5y/8e+cv/IvnL/yL5y/8e8b//KwXv/5OC6//n58P//////rbOR/3+ajP9Dmff/SZTb/4Snqv/Cu3f/y75w/8i9cv/IvnL/yL5z/8e+cv/IvnL/yL5z/8i+c//IvXL/x7xx/87Gf//Oxn7/yL10/8i+dP/IvnT/yL50/8i+dP/IvnT/yL50/8i+dP/HvXH/0MiJ//Tz5f////////////////+ttJL/an5X/0+f8/80je//M47x/1maz/+0uIP/yr9y/8i+dP/IvnT/yL50/8i+dP/IvnT/yL50/8i+dP/HvXP/zcaA/83GgP/IvXX/yL52/8i9df/IvXX/yL51/8i+df/JvnX/yL51/8a7b//X0qP//v7////////9/f3/8PHt/6Orhv9abj7/SJbj/zSO7/84kvT/N5Dt/5ywl//PwHH/yb52/8m+df/IvnX/yb11/8m+df/JvnX/yL51/8i9df/NxoL/zsiB/8fBdf/HwXb/x8F2/8fBdv/IwXb/x8F2/8jBdf/HwXP/zMeE//b26//8/Pv/sbec/2x4Rv9fbTP/WGco/1NjJP9LZj//RmlQ/zx2j/81jej/VJnU/76+ff/KwnT/yMJ2/8fBdv/Iwnb/yMJ2/8jBdv/HwXb/xsF1/87Jg//OyYP/yMN2/8jDd//Iw3f/yMN3/8jDd//Jwnf/yMN3/8fAcv/m5MT///////39/P/Y3Mv/i5dn/1NjH/9TYh7/VGMf/1VhHP9OaEz/QYKx/ziQ6v8wjfP/f6iv/83Fc//Iw3f/yMN3/8jDd//Iw3f/yMJ3/8jDd//Hwnb/zsqE/87KhP/JxHr/yMR6/8nFev/JxHn/ycR5/8rEef/JxHn/yMR6/+bly//+/v3//////9TYyP+Mlm7/YnAz/1JhHv9UYx7/T2Qx/0Vncf86dK7/N47u/ziQ7P9ypLz/ycR5/8nFev/JxHr/ycR5/8nEef/JxHn/ycR6/8jEef/Py4b/0MuG/8rFe//Kxnv/ysV7/8rFe//KxXv/ysV7/8rFe//Iw3f/2tep/////v//////7O7l/5qkef9VZSL/U2Mf/1NkIP9TYh3/TG1P/z+GwP82juz/N5Dt/561m//Ox3j/ycV7/8nFe//JxXv/ycV7/8nFe//Kxnv/ycV6/8/Mh//RzIf/y8Z9/8zGff/Lxn3/y8Z9/8rFfP/Lxn3/y8Z9/8nDeP/q6dH/////////////////6+3l/5Oecv9RYx3/UmMe/1J6O/8/kr7/N5D1/zmR7P8zjvH/dqa6/9HIef/Lxn3/y8Z8/8vGff/Lxn3/y8Z8/8vGff/KxXz/0c2J/9LNh//Ox33/zsd9/83Hff/Nx33/zcd9/83Hff/Nx33/y8V8//Dv4P/////////////////Izrf/YXAy/1BjHv9SZB//UWon/1CNa/87leP/N5Dv/zWP8P9loMj/0ch6/83Hff/Nx33/zch+/87Hff/Ox33/zch9/83Gff/Szov/0c2L/8zIgf/MyIL/zMiC/8zIgf/MyIH/zMiB/8zIgf/Kxn//8O/g///////29ev//Pz5///////Jzrb/WWon/1BjIP9alGH/ZcCW/2C0qv9LmN7/LYv0/2Sgyf/QyX7/zMiB/8zIgf/MyIH/zMmC/8zJgf/MyIH/y8eB/9DPjf/Tzoz/zsmD/87JhP/OyYT/zsmE/87IhP/OyYT/zsmD/8zHgP/f3bj/4N21/9fUof/9/fz//v7+/661lv9VZiT/UGMf/1ePXP9nwqD/b8Oa/7LDkP+Drbn/jrGu/9HKgP/OyYP/zcmD/83Jg//OyYT/zsmE/87JhP/NyIP/0s+O/9TPjf/PyoP/z8uE/8/LhP/OyoP/z8qE/8/KhP/Py4P/z8uD/8zJgP/Lx3r/2den//3+/f//////8fPr/2h3Of9PaCj/aLmW/2zHqf9txaX/t8qK/9bNfv/Py4H/zsqD/8/LhP/Qy4T/0MuE/9DLhP/Py4T/z8uD/87Kgv/T0Y3/1NCN/8/Lg//Qy4T/0MuE/9DLhP/Qy4T/0MuE/9DLhP/Qy4T/0MuE/8/Lgv/Oy4n/7eza////////////rrSP/1eNXf9yzrT/bcmw/5LJoP/Lyob/0MuD/9DLg//Qy4T/0MuE/9DLhP/Qy4T/0MuE/9DLhP/Qy4T/z8uD/9TRjv/U0I7/0MuF/9DLhv/Qy4f/0MuG/9HLhv/Ry4b/0cuG/9HLhv/Ry4b/0cuG/8/IgP/e3Lb//f7+///////g5tn/cbye/3fPuP92zbf/scyX/9XLhP/Ry4b/0cuG/9HLhv/Ry4b/0cuG/9HLhv/Ry4b/0cuG/9HLhv/Ry4X/1NGQ/9TRkP/PzIf/0M2I/8/NiP/PzYf/0M2H/9DNh//QzIf/z8yH/8/Mh//QzYf/0MyG/9DOj//X1qX/9PPn//P9/f+C1cH/j8+t/7fNlf/KzYv/0M2G/8/Mh//PzIf/z8yG/9DMh//QzIf/z8yH/8/Mh//PzIf/0M2H/8/Mh//U0ZD/1NGS/9DNiP/QzYj/0M2I/9DNiP/Qzoj/0M6I/8/Nh//PzYj/0M2I/9DOiP/Qzoj/z82G/83Kgf/c2q//8fz8/4bVwf+4zpb/1M2F/9DNh//Qzoj/z82I/8/NiP/QzYj/0M6I/9DNiP/QzYj/0M2I/9DNiP/PzYj/z8yH/9TRkP/U0ZL/0cyI/9HNif/RzYn/0cyI/9HMiP/RzIj/0cyI/9HMiP/RzIj/0MyI/9HMiP/SzIj/0syH/9DKh//b6NX/ptWx/9LLhv/RzIj/0cyI/9HMiP/RzIj/0syI/9HMiP/RzIj/0cyI/9HMiP/RzIj/0cyI/9HMiP/QzIj/1NGR/9TSkv/QzYj/0M2J/9HNif/RzYn/0s2I/9LNif/SzYj/0c2J/9HNif/SzYj/0s2I/9LNiP/SzYj/0cyH/87QlP/Mz5L/0s2H/9LNiP/RzYj/0s2I/9LNif/SzYn/0c2J/9LNif/SzYn/0c2J/9LNif/RzYn/0c2J/9HNiP/V0pH/1dKS/9HOiP/Rzon/0c6J/9LOif/Szon/0s6I/9LOiP/Rzon/0c6J/9LOiP/Szoj/0s6I/9HOiP/Szoj/0c2H/9LOh//Szon/0s6I/9HOiP/Szon/0s6J/9LOiP/Szoj/0s6I/9LOiP/Rzon/0s6J/9HOif/Rzon/0s6I/9XTk//U05P/0c+I/9HPif/Rz4n/0c+J/9HPif/Rz4n/0c+J/9HPif/Rz4n/0c+J/9HPif/Rz4n/0c+J/9HPif/Rz4n/0c+J/9HPif/Rz4n/0c+J/9HPif/Rz4n/0c+J/9HPif/Rz4n/0c+J/9LPiv/Sz4r/0s+K/9LPiv/Rz4n/1NST/9bVlP/T0Yv/09GL/9PRi//S0Yv/09GL/9PRi//T0Yv/09GL/9LRi//T0Yv/09GL/9PRi//T0Yv/1NGM/9PRi//T0Yz/09GM/9PSjP/T0oz/09GM/9PRi//T0Yv/1NKM/9PSjP/U0Yz/1NGM/9TRjP/U0Yz/1NGM/9PRi//W1ZP/1tWU/9XTjP/V04z/1dON/9XTjf/V043/1dON/9XTjf/V043/1dOM/9XTjP/V04z/1dON/9XTjf/V043/1dKN/9XTjf/V043/1dON/9XTjf/V043/1dON/9XTjf/V043/1dOM/9XTjP/V043/1dON/9XTjf/V04z/1dOL/9bWlP/Z2Zn/1daS/9bWk//W1ZP/1tWU/9XVk//V1pP/1taT/9fWk//W1pP/1taS/9XWkv/V1pP/1daT/9bWk//W1pL/1taS/9bWk//V1pP/1tWT/9XWkv/V1ZP/1taS/9bWkv/W1pP/1taT/9bWk//V1ZP/1tWT/9bWk//V1ZP/2dqc/wAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA";
      const raw = Uint8Array.from(atob(b64), c => c.charCodeAt(0));
      return new Response(raw, {
        headers: {
          "content-type": "image/x-icon",
          "cache-control": "public, max-age=86400",
        },
      });
    }

    // Landing page
    if (url.pathname === "/" || url.pathname === "") {
      return new Response(
        `RCSD Open Data MCP Server

Connect this MCP server to Claude Desktop, claude.ai, VS Code, Cursor, or any MCP client.

Endpoint: ${url.origin}/mcp

Tools available:
  list-schools           — List all 12 RCSD schools
  query-school           — Detailed school info by name or slug
  check-calendar         — Is there school on a given date?
  get-lunch-menu         — Live lunch menu from HealthePro
  get-trustees           — Board of Trustees, superintendent, and cabinet
  list-meetings          — List board meetings with filters and paging
  get-meeting-summary    — Board meeting summaries (EN/ES)
  get-meeting-details    — Full details for a board meeting (agenda, timestamps, transcript)
  search-transcript      — Search one meeting's transcript for a word or phrase
  find-document          — Find board documents by title keyword
  get-school-board-items — Board items for a specific school
  get-sped-data          — Special education enrollment data
  list-policies          — List board policies, bylaws, and regulations
  get-policy             — Full plain-text rules of a specific policy by code and type

Data source: https://rcsd.info
GitHub: https://github.com/dweekly/rcsd-meetings
`,
        {
          headers: { "content-type": "text/plain; charset=utf-8" },
        }
      );
    }

    return new Response("Not found", { status: 404 });
  },
} satisfies ExportedHandler;
