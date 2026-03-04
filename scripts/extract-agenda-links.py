#!/usr/bin/env python3
"""Extract all Simbli attachment links from agenda PDFs.

Reads agenda PDFs from artifacts/agendas/ and outputs a JSON file
mapping meeting dates to their attachment links with context text.

Usage:
    .venv/bin/python3 scripts/extract-agenda-links.py
"""

import fitz  # pymupdf
import json
import os
import re
import sys

AGENDAS_DIR = os.path.join(os.path.dirname(__file__), '..', 'artifacts', 'agendas')
OUT_PATH = os.path.join(os.path.dirname(__file__), '..', 'data', 'agenda-attachments.json')

AID_PATTERN = re.compile(r'AID=(\d+)')
DATE_FROM_FILENAME = re.compile(r'^(\d{4}-\d{2}-\d{2})')


def extract_links_from_pdf(path):
    """Extract all Simbli attachment links from a PDF."""
    doc = fitz.open(path)
    links = []
    for page_num, page in enumerate(doc):
        for link in page.get_links():
            uri = link.get('uri', '')
            if not uri or 'AID=' not in uri:
                continue
            aid_match = AID_PATTERN.search(uri)
            if not aid_match:
                continue
            aid = aid_match.group(1)

            # Get text at the link rect
            rect = fitz.Rect(link['from'])
            # Expand rect slightly for better text capture
            expanded = fitz.Rect(rect.x0 - 2, rect.y0 - 2, rect.x1 + 300, rect.y1 + 2)
            text = page.get_text('text', clip=expanded).strip().replace('\n', ' ')

            links.append({
                'aid': aid,
                'title': text[:300] if text else '',
                'url': uri,
                'page': page_num + 1,
            })
    doc.close()
    return links


def main():
    if not os.path.isdir(AGENDAS_DIR):
        print(f'Agendas directory not found: {AGENDAS_DIR}', file=sys.stderr)
        sys.exit(1)

    results = {}
    total_links = 0

    for fname in sorted(os.listdir(AGENDAS_DIR)):
        if not fname.endswith('.pdf'):
            continue
        date_match = DATE_FROM_FILENAME.match(fname)
        if not date_match:
            continue
        date = date_match.group(1)
        path = os.path.join(AGENDAS_DIR, fname)
        links = extract_links_from_pdf(path)
        if links:
            results[date] = {
                'file': fname,
                'attachments': links,
            }
            total_links += len(links)
            print(f'  {date}: {len(links)} attachments')

    with open(OUT_PATH, 'w') as f:
        json.dump(results, f, indent=2)

    print(f'\nWrote {total_links} attachment links from {len(results)} agendas to {OUT_PATH}')


if __name__ == '__main__':
    main()
