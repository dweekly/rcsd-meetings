#!/usr/bin/env python3
"""Extract per-meeting planned topics from the district's Schedule of Agenda Items.

The Schedule ("26-27 Schedule of Board Agenda Items") is a board-packet attachment
listing, for each scheduled meeting of the school year, the topics staff intend to
bring: department, topic, administrator, presentation duration, and a note. It is
the only source of what a future meeting will cover before its formal agenda posts
(~72 hours ahead), which is what `provisionalTopics` shows on the homepage, the
meeting calendar and the ICS feed.

Two things about the document decide how it must be read, both stated in its own
header: "This Schedule of Agenda Items will be updated as needed, with additions in
red and deletions shown in strikethrough."

  * A red row is an addition. It is current and must be kept.
  * A struck-through row is a deletion. It must NOT be published as planned.

Flattened text extraction shows neither, so `pdftotext` on the 2026-27 Schedule
yields a "Communications Update" topic for September 9 that the district has
already removed. This reads spans with their colour and matches them against the
horizontal rules drawn on the page, so a struck row is dropped and counted.

Usage:
    .venv/bin/python scripts/extract-governance-calendar.py \
        --pdf artifacts/board-packets/2026-09-09/26-27-Schedule-of-Board-Agenda-Items.pdf \
        --source-url https://data.rcsd.info/board-packets/2026-09-09/26-27-Schedule-of-Board-Agenda-Items.pdf

Writes data/governance-calendar.json. English only: `es` is filled by
scripts/translate-governance-calendar.mjs, which preserves any translation already
present so a re-extraction does not re-buy the whole file.
"""
from __future__ import annotations

import argparse
import json
import re
import sys
from dataclasses import dataclass, field
from datetime import date
from pathlib import Path

import pymupdf

ROOT = Path(__file__).resolve().parent.parent
OUT_PATH = ROOT / "data" / "governance-calendar.json"

RED = 0xFF0000
BLACK = 0x000000

# The five columns, in order. Their x boundaries are NOT fixed: each table in the
# Schedule draws its own header row, and the Department column is narrower on some
# tables than others. Boundaries are therefore read from the header cells of the
# table a row belongs to, and a span is assigned to the column it overlaps most
# rather than the one its left edge lands in — cell text can start a few points
# outside its own border ("Declaration of Need" begins 7pt left of the boundary,
# and a left-edge test files it under Department, where summarise() drops it).
COLUMN_ORDER = ["department", "topic", "administrator", "duration", "note"]

# A heading may carry a qualifier after the date — "September 30, 2026 - Study
# Session" is one of them, and requiring the line to end at the year dropped that
# meeting entirely, filing its topics under the meeting before it.
DATE_RE = re.compile(
    r"^(?:(?:Mon|Tues|Wednes|Thurs|Fri|Satur|Sun)day,\s*)?"
    r"(January|February|March|April|May|June|July|August|September|October|November|December)"
    r"\s+(\d{1,2}),\s*(\d{4})"
    r"(?:\s*[-–—]\s*(?P<label>.+?))?\s*$"
)

# The Schedule ends with an undated "Future Agenda Items/Suggestions:" table —
# ideas trustees have raised that are not scheduled for any meeting. Everything
# from that heading on belongs to no date.
END_OF_MEETINGS_RE = re.compile(r"Future Agenda Items\s*/\s*Suggestions", re.I)
MONTHS = {m: i for i, m in enumerate(
    "January February March April May June July August September October November December".split(), 1)}

HEADER_CELLS = {"department", "topic", "administrator", "presentation", "duration", "note"}


@dataclass
class Row:
    department: str = ""
    topic: str = ""
    administrator: str = ""
    duration: str = ""
    note: str = ""
    added: bool = False

    def is_empty(self) -> bool:
        return not (self.topic or self.department)


@dataclass
class Meeting:
    iso: str
    label: str = ""
    rows: list[Row] = field(default_factory=list)
    dropped: list[str] = field(default_factory=list)


def horizontal_rules(page: pymupdf.Page) -> list[tuple[float, float, float]]:
    """Every thin horizontal rule on the page, as (x0, x1, y).

    Both line and rectangle primitives are collected: a strikethrough may be drawn
    either way, and table borders come back here too. Borders are harmless because
    a rule only counts as a strikethrough when it crosses the vertical middle of a
    span's own box, which a cell border never does.
    """
    rules: list[tuple[float, float, float]] = []
    for drawing in page.get_drawings():
        for item in drawing["items"]:
            if item[0] == "l":
                p1, p2 = item[1], item[2]
                if abs(p1.y - p2.y) < 1.0 and abs(p2.x - p1.x) > 8:
                    rules.append((min(p1.x, p2.x), max(p1.x, p2.x), (p1.y + p2.y) / 2))
            elif item[0] == "re":
                rect = item[1]
                if rect.height < 2.0 and rect.width > 8:
                    rules.append((rect.x0, rect.x1, (rect.y0 + rect.y1) / 2))
    return rules


def is_struck(span: dict, rules: list[tuple[float, float, float]]) -> bool:
    x0, y0, x1, y1 = span["bbox"]
    middle = (y0 + y1) / 2
    tolerance = (y1 - y0) * 0.45
    return any(
        rx0 <= x1 and rx1 >= x0 and abs(ry - middle) <= tolerance
        for rx0, rx1, ry in rules
    )


def header_columns(page: pymupdf.Page) -> list[tuple[float, list[tuple[float, float]]]]:
    """Column x-ranges for each table on the page, as (header_y, [(x0, x1), ...]).

    Every table repeats the green header row, and that row is drawn as one filled
    rectangle per column, so it states the table's own geometry exactly.
    """
    rows: dict[float, set[tuple[float, float]]] = {}
    for drawing in page.get_drawings():
        for item in drawing["items"]:
            if item[0] != "re":
                continue
            rect = item[1]
            if rect.width > 40 and 20 < rect.height < 60:
                rows.setdefault(round(rect.y0, 1), set()).add((round(rect.x0, 1), round(rect.x1, 1)))
    return [
        (y, sorted(cols))
        for y, cols in sorted(rows.items())
        if len(cols) == len(COLUMN_ORDER)
    ]


def column_for(span: dict, columns: list[tuple[float, float]]) -> str | None:
    """The column this span sits in, by greatest horizontal overlap."""
    x0, x1 = span["bbox"][0], span["bbox"][2]
    best, best_overlap = None, 0.0
    for name, (cx0, cx1) in zip(COLUMN_ORDER, columns):
        overlap = min(x1, cx1) - max(x0, cx0)
        if overlap > best_overlap:
            best, best_overlap = name, overlap
    return best


def row_bands(page: pymupdf.Page) -> list[float]:
    """Y positions of the full-width rules that separate one table row from the next.

    Cells wrap onto several text lines, so a text line is not a row. The table
    draws a rule across its whole width between rows, and those rules are what
    actually bound a row — using them keeps a wrapped topic in one piece instead of
    splitting it across two entries.
    """
    edges: set[float] = set()
    for drawing in page.get_drawings():
        for item in drawing["items"]:
            if item[0] == "l":
                p1, p2 = item[1], item[2]
                if abs(p1.y - p2.y) < 1.0 and abs(p2.x - p1.x) > 600:
                    edges.add(round((p1.y + p2.y) / 2, 1))
            elif item[0] == "re":
                rect = item[1]
                if rect.width > 600:
                    if rect.height < 2.0:
                        edges.add(round((rect.y0 + rect.y1) / 2, 1))
                    else:
                        edges.update((round(rect.y0, 1), round(rect.y1, 1)))
    # Collapse rules drawn twice a fraction of a point apart.
    merged: list[float] = []
    for y in sorted(edges):
        if not merged or y - merged[-1] > 1.5:
            merged.append(y)
    return merged


def parse(pdf_path: Path) -> tuple[list[Meeting], str | None]:
    doc = pymupdf.open(pdf_path)
    meetings: list[Meeting] = []
    current: Meeting | None = None
    last_update: str | None = None

    ended = False
    for page in doc:
        if ended:
            break
        rules = horizontal_rules(page)
        bands = row_bands(page)
        tables = header_columns(page)
        if len(bands) < 2 or not tables:
            continue

        # Bucket every span into the row band its vertical centre falls in.
        buckets: dict[int, list[dict]] = {}
        for block in page.get_text("dict")["blocks"]:
            for line in block.get("lines", []):
                for span in line["spans"]:
                    if not span["text"].strip():
                        continue
                    y0, y1 = span["bbox"][1], span["bbox"][3]
                    middle = (y0 + y1) / 2
                    for i in range(len(bands) - 1):
                        if bands[i] <= middle < bands[i + 1]:
                            buckets.setdefault(i, []).append(span)
                            break

        for index in sorted(buckets):
            spans = sorted(buckets[index], key=lambda s: (round(s["bbox"][1]), s["bbox"][0]))
            # Concatenate without inserting spaces: the date band splits "Thursday"
            # and ", July 16, 2026" into separate spans, and a space between them
            # ("Thursday , July 16, 2026") stops the date matching at all.
            flat = re.sub(r"\s+", " ", "".join(s["text"] for s in spans)).strip()

            if last_update is None:
                m = re.search(r"Last Update:\s*([\d/]+)", flat)
                if m:
                    last_update = m.group(1)

            if END_OF_MEETINGS_RE.search(flat):
                # Undated suggestions from here on: they belong to no meeting, and
                # attaching them to the last date would publish an unscheduled item
                # as planned and file the trustee who raised it as an administrator.
                current = None
                ended = True
                break

            m = DATE_RE.match(flat)
            if m:
                month, day, year = MONTHS[m.group(1)], int(m.group(2)), int(m.group(3))
                current = Meeting(iso=f"{year:04d}-{month:02d}-{day:02d}",
                                  label=(m.group("label") or "").strip())
                meetings.append(current)
                continue

            if current is None:
                continue
            if all(s["color"] == 0xFFFFFF for s in spans):   # green column header
                continue
            if re.fullmatch(r"p\.\s*\d+", flat):
                continue

            row_top = min(s["bbox"][1] for s in spans)
            above = [t for t in tables if t[0] <= row_top]
            columns = (above[-1] if above else tables[0])[1]

            row = Row()
            struck_topic = False
            for span in spans:
                col = column_for(span, columns)
                if col is None:
                    continue
                piece = span["text"].strip()
                if not piece:
                    continue
                if is_struck(span, rules):
                    if col == "topic":
                        struck_topic = True
                    continue
                if span["color"] == RED:
                    row.added = True
                existing = getattr(row, col)
                setattr(row, col, f"{existing} {piece}".strip() if existing else piece)

            if struck_topic:
                current.dropped.append(flat)
                continue
            if not row.is_empty():
                current.rows.append(row)

    return meetings, last_update


def summarise(rows: list[Row]) -> str:
    """One provisional-topic line for a meeting.

    Closed session is dropped: it appears on nearly every meeting and says nothing
    about what that meeting is for.
    """
    topics = []
    for row in rows:
        topic = re.sub(r"\s+", " ", row.topic).strip(" ;,")
        if not topic or topic.lower().startswith("closed session"):
            continue
        if topic not in topics:
            topics.append(topic)
    return "; ".join(topics)


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--pdf", required=True, type=Path)
    ap.add_argument("--source-url", required=True)
    ap.add_argument("--out", type=Path, default=OUT_PATH)
    args = ap.parse_args()

    if not args.pdf.exists():
        print(f"error: {args.pdf} not found", file=sys.stderr)
        return 1

    meetings, last_update = parse(args.pdf)
    meetings = [m for m in meetings if m.rows or m.dropped]
    if not meetings:
        print("error: no meeting dates parsed — the Schedule's layout may have changed",
              file=sys.stderr)
        return 1

    existing = {}
    if args.out.exists():
        existing = json.loads(args.out.read_text(encoding="utf-8")).get("provisionalTopics", {})

    provisional = {}
    dropped_total = 0
    for meeting in sorted(meetings, key=lambda m: m.iso):
        dropped_total += len(meeting.dropped)
        summary = summarise(meeting.rows)
        if not summary:
            continue
        entry = {
            "en": summary,
            "items": [
                {k: v for k, v in
                 (("department", r.department), ("topic", re.sub(r"\s+", " ", r.topic).strip()),
                  ("administrator", r.administrator), ("duration", r.duration), ("note", r.note))
                 if v}
                for r in meeting.rows
            ],
        }
        # Keep a translation already on file; translate-governance-calendar.mjs
        # refreshes it only when the English has moved.
        prior = existing.get(meeting.iso)
        if prior and prior.get("es") and prior.get("en") == summary:
            entry["es"] = prior["es"]
        provisional[meeting.iso] = entry

    payload = {
        "_source": f"2026–27 Schedule of Agenda Items (last updated {last_update or 'unknown'}), "
                   "board-packet attachment for the 2026-09-09 meeting",
        "_sourceUrl": args.source_url,
        "_sourceFile": str(args.pdf).replace(str(ROOT) + "/", ""),
        "_generated": date.today().isoformat(),
        "_method": "scripts/extract-governance-calendar.py — PyMuPDF span colours and "
                   "horizontal rules; rows struck through in the Schedule are deletions and "
                   "are excluded, rows in red are additions and are kept",
        "_droppedStruckRows": dropped_total,
        "provisionalTopics": provisional,
    }
    args.out.write_text(json.dumps(payload, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")

    translated = sum(1 for v in provisional.values() if v.get("es"))
    print(f"  meetings with topics: {len(provisional)}")
    print(f"  struck rows excluded: {dropped_total}")
    print(f"  Spanish already on file: {translated}/{len(provisional)}")
    try:
        shown = args.out.relative_to(ROOT)
    except ValueError:
        shown = args.out
    print(f"  wrote {shown}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
