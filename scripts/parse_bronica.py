#!/usr/bin/env python3
"""Parse the Bronica lens tables from the Wikipedia "Bronica" article wikitext
into curated-lenses/bronica.jsonl. Adapted from the /tmp/parse_nikon.py pattern.
"""
import re, json, urllib.parse

text = open('/tmp/bronica.wiki').read()


def clean(s):
    s = s.replace('&nbsp;', ' ').replace('{{nbsp}}', ' ').replace('{{ndash}}', '-')
    s = re.sub(r"<ref[^>]*>.*?</ref>", "", s, flags=re.S)
    s = re.sub(r"<ref[^>]*/>", "", s)
    s = re.sub(r"\[\[File:[^\]]*\]\]", "", s)
    s = re.sub(r"\[\[[^\]|]*\|([^\]]*)\]\]", r"\1", s)
    s = re.sub(r"\[\[([^\]]*)\]\]", r"\1", s)
    s = re.sub(r"'''?", "", s)
    return s.strip()


def strip_attrs(cell):
    m = re.match(r'\s*((?:[a-zA-Z-]+\s*=\s*"[^"]*"\s*|colspan\s*=\s*\d+\s*|rowspan\s*=\s*\d+\s*|style\s*=\s*"[^"]*"\s*)+)\|(?!\|)(.*)', cell, re.S)
    if m and '{{' not in m.group(1) and '[[' not in m.group(1):
        return m.group(2).strip()
    return cell


def parse_focal_range(namecell):
    """Focal length lives in the second table column (e.g. '40' or '75~150')."""
    t = namecell.replace('&nbsp;', ' ')
    t = re.sub(r"style=\"[^\"]*\"\s*\|", "", t)
    t = t.strip()
    m = re.search(r"(\d+(?:\.\d+)?)\s*[~\-–]\s*(\d+(?:\.\d+)?)", t)
    if m:
        return float(m.group(1)), float(m.group(2))
    m = re.search(r"(\d+(?:\.\d+)?)", t)
    if m:
        v = float(m.group(1))
        return v, v
    return None


def parse_aperture(t):
    m = re.search(r"\{\{f/\|([^}|]+)(?:\|[^}]*)?\}\}", t)
    if not m:
        return None
    raw = m.group(1).strip()
    num = re.match(r"(\d+(?:\.\d+)?)", raw)
    if not num:
        return None
    return float(num.group(1))


def cells_of(row):
    body = row.replace('||', '\n|').replace('!!', '\n!')
    cells = []
    for ln in body.split('\n'):
        ln = ln.rstrip()
        if ln.startswith('|') or ln.startswith('!'):
            cells.append(strip_attrs(ln[1:].strip()))
    return cells


def extract_section(name):
    """Return the wikitext slice for a top-level === section === up to the next ===."""
    m = re.search(rf"==={re.escape(name)}===\n(.*?)(?=\n===|\Z)", text, re.S)
    return m.group(1) if m else ""


def extract_tables(section_text):
    tables, cur, cap, intable = [], [], None, False
    for line in section_text.splitlines():
        if line.strip().startswith('{|'):
            intable, cur, cap = True, [], None
            continue
        if line.strip().startswith('|}') and intable:
            tables.append((cap, cur))
            intable = False
            continue
        if intable:
            if line.startswith('|+') and cap is None:
                cap = clean(line[2:])
            else:
                cur.append(line)
    return tables


def parse_lens_table(body):
    """Parse a 'Lenses for Bronica ... series' sortable table into rows."""
    rows = ('\n'.join(body)).split('\n|-')
    out = []
    for row in rows:
        cells = cells_of(row)
        if len(cells) < 3:
            continue
        namecell = clean(cells[0])
        # section-header rows: colspan=10 category banners -- skip (no '!! Name' present)
        if 'colspan' in cells[0] and 'background' in cells[0]:
            continue
        if not namecell or namecell.lower().startswith('data-sort'):
            continue
        # name is in cells[0]; focal length in cells[1] (raw incl. style=... wrapper)
        name = namecell
        if not name:
            continue
        foc = parse_focal_range(cells[1]) if len(cells) > 1 else None
        apn = parse_aperture(cells[2]) if len(cells) > 2 else None
        if not foc or apn is None:
            continue
        out.append({"name": name, "fmin": foc[0], "fmax": foc[1], "ap": apn})
    return out


def commons_image_for(name_hint, section_text):
    """Best-effort: find a [[File:...]] near a lens name isn't reliable in these
    tables (photos are on the camera-body tables, not per-lens), so we do not
    attempt per-lens image matching here; camera-level photos aren't lenses."""
    return None


SYSTEMS = [
    ("Classic models", "S/EC (focal-plane)", "medium format", "Bronica"),
    ("ETR series", "ETR", "Bronica ETR", "Bronica"),
    ("SQ series", "SQ", "Bronica SQ", "Bronica"),
    ("GS series", "GS-1", "medium format", "Bronica"),
]

records = []
for section_name, system_label, mount, make in SYSTEMS:
    sect = extract_section(section_name)
    tables = extract_tables(sect)
    lens_tables = [t for t in tables if t[0] and t[0].lower().startswith('lenses for')]
    for cap, body in lens_tables:
        rows = parse_lens_table(body)
        for r in rows:
            name = r['name']
            fmin, fmax = r['fmin'], r['fmax']
            apn = r['ap']
            is_zoom = fmax != fmin
            is_macro = 'macro' in name.lower()
            is_fisheye = fmin <= 35 and 'zenzanon' in name.lower() and fmax == fmin and (
                (system_label == 'ETR' and fmin == 30) or
                (system_label == 'SQ' and fmin == 35) or
                (system_label == 'S/EC (focal-plane)' and fmin == 40)
            )
            # Determine kind
            if is_macro:
                kind = 'macro'
            elif is_zoom:
                kind = 'zoom'
            elif is_fisheye:
                kind = 'fisheye'
            else:
                kind = 'prime'

            # Build model name: "Bronica <Designator> <focal>mm f/<ap> (<system>)"
            desig = re.sub(r'\s+', ' ', name).strip()
            # normalize designator casing / spacing (keep as-is from source, it's already clean italic text)
            flabel = f"{int(fmin) if fmin == int(fmin) else fmin}" if fmin == fmax else \
                     f"{int(fmin) if fmin == int(fmin) else fmin}-{int(fmax) if fmax == int(fmax) else fmax}"
            model = f"Bronica {desig} {flabel}mm f/{apn:g} ({system_label})"

            records.append({
                "make": "Bronica",
                "model": model,
                "mount": mount,
                "mounts": [mount],
                "focalLengthMin": fmin,
                "focalLengthMax": fmax,
                "maxAperture": apn,
                "lensTypeKind": kind,
                "wikidata": None,
                "image": None,
                "source": "wikipedia:Bronica",
            })

# dedupe by model (identical rows can't occur here, but guard anyway)
seen = set()
uniq = []
for r in records:
    key = r['model']
    if key in seen:
        continue
    seen.add(key)
    uniq.append(r)

with open('/tmp/bronica_parsed.json', 'w') as f:
    json.dump(uniq, f, indent=1)

from collections import Counter
print("total:", len(uniq))
print("by mount:", dict(Counter(r['mount'] for r in uniq)))
print("by kind:", dict(Counter(r['lensTypeKind'] for r in uniq)))
