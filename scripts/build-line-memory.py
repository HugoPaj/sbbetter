#!/usr/bin/env python3
"""
Builds public/line-memory.json from the SBB hackathon export (Daten.zip).

    python3 scripts/build-line-memory.py [path/to/Daten]

"Line memory": what happened the last times a stretch of line was disrupted.
Standard library only. Per stretch (two neighbouring stations, or one station):
  - every time it was disrupted, and how long    public liveticker, 2024-03 on
  - where staff sent travellers instead ("via")   the ticker messages they wrote,
    and how long into the disruption              plus the control centre's travel
                                                  advice (KULT, September 2026)
  - whether tickets were valid via another route  KULT goodwill measures and the
                                                  few public messages that say so
And per cause (EG_xxx): the usual order of events, as minutes after the start
(replacement buses announced, detour advice, specialists on site, new forecast).

Station names are matched to the official stop list (data.sbb.ch, train stops),
downloaded once to scripts/train-stops.json.
"""

import collections
import csv
import html
import json
import math
import re
import statistics as st
import sys
import unicodedata
import urllib.parse
import urllib.request
from datetime import datetime
from pathlib import Path

HERE = Path(__file__).resolve().parent
OUT = HERE.parent / "public/line-memory.json"
STOPS = HERE / "train-stops.json"
STOPS_URL = "https://data.sbb.ch/api/explore/v2.1/catalog/datasets/dienststellen-gemass-opentransportdataswiss/exports/json"
MIN_SAMPLES = 8  # fewer incidents with a step for a cause → that step falls back to all causes

csv.field_size_limit(10**9)
root = Path(sys.argv[1]) if len(sys.argv) > 1 else Path(__file__).resolve().parent.parent / "data/Daten"
ext, intern = root / "extern-liveticker", root / "intern-liveticker"


def ts(s):
    s = s.strip()
    return datetime.strptime(s[:19] + s[-6:].replace(" ", ""), "%Y-%m-%d %H:%M:%S%z") if s else None


def rows(folder, name):
    return list(csv.DictReader(open(next(folder.glob(name)), encoding="utf-8-sig")))


def median(xs):
    return round(st.median(xs))


# ---- official stops: name → (uic, name, lat, lon) ----

if not STOPS.exists():
    query = urllib.parse.urlencode({"select": "number,designationofficial,geopos", "where": 'meansoftransport like "TRAIN" and hasgeolocation="true"'})
    data = json.load(urllib.request.urlopen(f"{STOPS_URL}?{query}", timeout=120))
    compact = sorted([r["number"], r["designationofficial"], round(r["geopos"]["lat"], 5), round(r["geopos"]["lon"], 5)] for r in data)
    STOPS.write_text(json.dumps(compact, ensure_ascii=False, separators=(",", ":")))
stops = json.loads(STOPS.read_text())


def norm(s):
    s = unicodedata.normalize("NFKD", s.lower())
    s = "".join(c for c in s if not unicodedata.combining(c))
    return " ".join(s.replace("ß", "ss").translate({ord(c): " " for c in ".,;:!?'’/-–()\"«»"}).split())


by_name = {}
for uic, name, lat, lon in stops:
    by_name.setdefault(norm(name), (uic, name, lat, lon))
# Both halves of bilingual names ("Biel/Bienne"), unless one is a stop of its own.
for uic, name, lat, lon in stops:
    if "/" in name:
        for half in name.split("/"):
            by_name.setdefault(norm(half), (uic, name, lat, lon))
# How travellers (and machine translation) write the big ones.
ALIASES = {
    "zurich": "Zürich HB", "zuerich": "Zürich HB", "zurich main station": "Zürich HB", "zurich airport": "Zürich Flughafen",
    "geneva": "Genève", "genf": "Genève", "geneva airport": "Genève-Aéroport", "lucerne": "Luzern", "berne": "Bern",
    "basel": "Basel SBB", "basle": "Basel SBB", "bale": "Basel SBB", "yverdon": "Yverdon-les-Bains", "neuenburg": "Neuchâtel",
    "st gall": "St. Gallen", "saint gall": "St. Gallen", "coire": "Chur", "soleure": "Solothurn", "bienne": "Biel/Bienne",
    "romont": "Romont FR", "wil": "Wil SG", "buchs": "Buchs SG", "wetzikon": "Wetzikon ZH", "pfaffikon": "Pfäffikon SZ",
}  # fmt: skip
for alias, name in ALIASES.items():
    if norm(name) in by_name:
        by_name[alias] = by_name[norm(name)]


# "Alle" is a stop in the Jura and German for "all".
del by_name["alle"]


def station(name):
    return by_name.get(norm(name))


def off_stretch(via, ends):
    """
    False for a stop on the closed stretch itself: within 2 km of the straight line between its ends.
    Only for short stretches. Between two hubs (Olten - Bern) a stop that close is on the other line.
    """
    if len(ends) < 2 or any(e["lat"] is None for e in ends):
        return True
    kx = 111.32 * math.cos(math.radians(via[2]))
    (ax, ay), (bx, by) = [((e["lon"] - via[3]) * kx, (e["lat"] - via[2]) * 110.57) for e in ends]
    dx, dy = bx - ax, by - ay
    if math.hypot(dx, dy) > 20:
        return True
    t = max(0, min(1, -(ax * dx + ay * dy) / ((dx * dx + dy * dy) or 1)))
    return math.hypot(ax + t * dx, ay + t * dy) > 2


# ---- public liveticker: one record per incident ----

reasons = {r["id"]: r["reason_en"] for r in rows(ext, "reason_*.csv")}
versions = collections.defaultdict(list)
for r in rows(ext, "incident_audit_*.csv") + rows(ext, "incident_2*.csv"):
    versions[r["id"]].append(r)
messages = collections.defaultdict(list)
for m in rows(ext, "message_2*.csv"):
    if m["status"] == "PUBLISHED":
        messages[m["incident_id_fk"]].append(m)

VIA = re.compile(r"\b(?:via|über|par)\s+(.{2,60})", re.I)
# Not after "St." (St. Gallen), nor before a small letter (Langnau i.E. travel …): no sentence ends there.
SENTENCE = re.compile(r"(?<=[.!?])(?<!\bSt\.)(?<!\bSte\.)\s+(?![a-zäöüéèà\s])|[\n\r  ]+")
# Where the replacement buses drive is not a way round for someone on a train.
ROAD = re.compile(r"\bbus|\bcar\b|taxi|bahnersatz", re.I)


def via_stations(text):
    """Stations named after "via …" (longest official name that fits), sentence by sentence."""
    found = []
    for sentence in SENTENCE.split(text):
        if ROAD.search(sentence):
            continue
        for tail in VIA.findall(sentence):
            words = tail.split()
            for n in range(min(4, len(words)), 0, -1):
                s = station(" ".join(words[:n]))
                if s:
                    found.append(s)
                    break
    return found


def sentence_with(text, needle):
    parts = SENTENCE.split(text)
    for i, s in enumerate(parts):
        if needle.lower() in s.lower() and "via" in s.lower() and not ROAD.search(s):
            # A line break in the middle of a sentence: the quote starts on the line before.
            if s[:1].islower() and i and not ROAD.search(parts[i - 1]):
                s = parts[i - 1] + " " + s
            # Without the bullet, arrow or emoji the ticker puts in front.
            s = re.sub(r"^[^\w«“\"(]+", "", " ".join(s.split()))
            if len(s) < 25:
                continue
            return s if len(s) <= 170 else s[:167].rsplit(" ", 1)[0] + "…"
    return None


def texts(m, langs=("de", "fr", "en")):
    return " \n ".join(f"{m['title_' + l]} \n {m['message_' + l]}" for l in langs)


# What usually happens, and the words staff use for it (English machine translation of every message).
STEPS = {
    "bus": r"\bbus|replacement (service|transport)",
    "detour": r"\bvia\b",
    "onsite": r"on.site|specialist|technician",
    "forecast": r"prognos|forecast|until (at least|approx|around|about)",
}
TICKETS = re.compile(r"tickets?\b[^.\n]{0,80}\bvalid\b[^.\n]{0,60}", re.I)

incidents = []
for iid, vs in sorted(versions.items()):
    vs.sort(key=lambda v: v["last_modified_date"])
    first = vs[0]
    start = ts(first["created_at_source"])
    kind, _, where = first["summary_en"].partition(": ")
    if not start or not where:
        continue
    # "A - B and C" is two stretches from A (a junction): the incident counts on both.
    a, _, rest = where.partition(" - ")
    pairs = [[a.strip(), b.strip()] for b in rest.split(" and ")] if rest else [[a.strip()]]
    names = sorted({n for pair in pairs for n in pair})
    ended = next((ts(v["updated_at_source"]) for v in vs if v["lifecycle"] == "ENDED"), None)
    minutes = (ended - start).total_seconds() / 60 if ended else None
    line = re.search(r"on the ([^,.\n]{3,60}? - [^,.\n]{3,60}?) line between", first["description_en"] or "")
    ms = sorted(messages.get(iid, []), key=lambda m: m["created_date"])

    def after(m):
        d = (ts(m["created_date"]) - start).total_seconds() / 60
        return d if 0 <= d < 24 * 60 else None

    steps = {}
    for key, pattern in STEPS.items():
        hit = next((m for m in ms if re.search(pattern, f"{m['title_en']} {m['message_en']}".lower())), None)
        if hit and after(hit) is not None:
            steps[key] = after(hit)
    vias, tickets = {}, []
    for m in ms:
        for s in via_stations(texts(m)):
            if s[1] in names or s[1] in vias:
                continue
            # The English text may spell it differently ("Bienne", "Geneva"): then any "via" sentence of the message.
            quote = sentence_with(m["message_en"], s[1]) or sentence_with(m["message_en"], s[1].split("/")[0]) or sentence_with(m["message_en"], "via")
            vias[s[1]] = dict(station=s, after=after(m), quote=quote)
        for t in TICKETS.findall(f"{m['title_en']}. {m['message_en']}"):
            tickets += [s[1] for s in via_stations(t)]
    incidents.append(
        dict(
            i=len(incidents),
            pairs=pairs,
            closed=kind.startswith("Interrupted"),
            cause=first["reason_id_fk"],
            start=start,
            minutes=minutes if minutes and 0 < minutes < 14 * 24 * 60 else None,
            line=line.group(1) if line else None,
            messages=len(ms),
            steps=steps,
            vias=vias,
            tickets=tickets,
        )
    )

# ---- the usual order of events, per cause ----


def script_for(items):
    out = {}
    with_ticker = [i for i in items if i["messages"]]
    for key in STEPS:
        mins = sorted(round(i["steps"][key]) for i in with_ticker if key in i["steps"])
        out[key] = dict(n=len(with_ticker), minutes=mins)
    return out


by_cause = collections.defaultdict(list)
for i in incidents:
    by_cause[i["cause"]].append(i)
script = {"ALL": script_for(incidents)}
for code, items in sorted(by_cause.items()):
    s = {k: v for k, v in script_for(items).items() if len(v["minutes"]) >= MIN_SAMPLES}
    if s:
        script[code] = s

# ---- stretches ----


def stretch_key(names):
    return " | ".join(sorted(norm(n) for n in names))


stretches = {}


def stretch(names):
    key = stretch_key(names)
    if key not in stretches:
        ends = []
        for n in sorted(names, key=norm):
            s = station(n)
            ends.append(dict(name=s[1] if s else n, id=str(s[0]) if s else None, lat=s[2] if s else None, lon=s[3] if s else None))
        stretches[key] = dict(key=key, ends=ends, incidents=[], staff_vias=collections.Counter(), tickets=collections.Counter())
    return stretches[key]


for i in incidents:
    for pair in i["pairs"]:
        stretch(pair)["incidents"].append(i)
        for v in i["tickets"]:
            stretch(pair)["tickets"][v] += 1

# ---- control centre (KULT, September 2026): travel advice and goodwill measures per case ----

cases = {r["id"]: r for r in rows(intern, "1_*.csv")}
kult = collections.Counter()
for r in rows(intern, "4_*.csv"):
    if r["entity"] != "InfoboardModule":
        continue
    title = re.search(r"titel='([^']*)'", r["data"])
    body = re.search(r"text='(.*)', textVia=", r["data"])
    case = cases.get(r["ereignisfall_id"])
    if not title or not body or not case or " - " not in case["zug_nr_strecke"]:
        continue
    names = [p.strip() for p in case["zug_nr_strecke"].split(" - ")][:2]
    if not all(names) or not all(station(n) for n in names):
        continue  # typos and one-ended entries ("Küssnacht am Rigi - ")
    text = html.unescape(re.sub(r"<[^>]+>", " ", body.group(1)))
    what = {"INFOBOARD_TITLE_KULANZMASNAHMEN": "tickets", "INFOBOARD_TITLE_REISEEMPFEHLUNG": "staff_vias"}.get(title.group(1))
    if not what:
        continue
    official = [station(n)[1] for n in names]
    for s in via_stations(text):
        if s[1] not in official:
            # Once per case and station: the log holds every edit of a module.
            kult[(stretch_key(names), what, s[1], r["ereignisfall_id"])] += 1
for (key, what, via, _case), _n in kult.items():
    names = key.split(" | ")
    stretch(names)[what][via] += 1

out = []
for s in stretches.values():
    inc = sorted(s["incidents"], key=lambda i: i["start"], reverse=True)
    detours = {}
    for i in inc:
        for name, v in i["vias"].items():
            if not v["quote"] or not off_stretch(v["station"], s["ends"]):
                continue
            d = detours.setdefault(name, dict(via=name, id=str(v["station"][0]), n=0, after=[], quote=None, quoted=None, staff=False))
            d["n"] += 1
            if v["after"] is not None:
                d["after"].append(v["after"])
            if not d["quote"] and v["quote"]:
                d["quote"], d["quoted"] = v["quote"], i["start"].date().isoformat()
    for name, n in s["staff_vias"].items():
        if not off_stretch(station(name), s["ends"]):
            continue
        d = detours.setdefault(name, dict(via=name, id=str(station(name)[0]), n=0, after=[], quote=None, quoted=None, staff=False))
        d["staff"] = True
    for d in detours.values():
        d["after"] = median(d["after"]) if d["after"] else None
    detours = sorted(detours.values(), key=lambda d: (-d["n"], not d["staff"], d["via"]))
    # Once, with nothing to pass on, is not a memory worth carrying.
    if len(inc) < 2 and not detours and not s["tickets"]:
        continue
    lines = collections.Counter(i["line"] for i in inc if i["line"])
    with_ticker = [i for i in inc if i["messages"]]
    bus = [i["steps"]["bus"] for i in with_ticker if "bus" in i["steps"]]
    out.append(
        dict(
            key=s["key"],
            ends=s["ends"],
            line=lines.most_common(1)[0][0] if lines else None,
            n=len(inc),
            closed=sum(i["closed"] for i in inc),
            causes=collections.Counter(i["cause"] for i in inc).most_common(3),
            bus=dict(of=len(with_ticker), n=len(bus), after=median(bus) if bus else None),
            detours=detours[:4],
            ticketVia=[v for v, _ in s["tickets"].most_common(2)],
            # Newest first. `i` identifies the incident: one at a junction counts on two stretches.
            incidents=[dict(i=i["i"], d=i["start"].date().isoformat(), c=i["cause"], m=round(i["minutes"]) if i["minutes"] else None, via=sorted(i["vias"]) or None) for i in inc],
        )
    )
out.sort(key=lambda s: (-s["n"], s["key"]))

used = {c for s in out for c, _ in s["causes"]} | set(script)
model = dict(
    builtFrom="SBB LauzHack 2026 export: public liveticker incidents and staff messages (history, detours, order of events), KULT control-centre log 2026-09 (travel advice, ticket goodwill)",
    since=min(i["start"] for i in incidents).date().isoformat(),
    until=max(i["start"] for i in incidents).date().isoformat(),
    incidents=len(incidents),
    causes={c: reasons[c] for c in sorted(used) if c in reasons},
    script=script,
    stretches=out,
)
OUT.write_text(json.dumps(model, ensure_ascii=False, separators=(",", ":")))

located = sum(all(e["id"] for e in s["ends"]) for s in out)
print(f"incidents: {len(incidents)} ({sum(1 for i in incidents if i['messages'])} with ticker messages) on {sum(1 for s in stretches.values() if s['incidents'])} stretches")
print(f"stretches written: {len(out)}, with coordinates for every end: {located}")
print(f"  disrupted 2+ times: {sum(s['n'] >= 2 for s in out)}, 3+: {sum(s['n'] >= 3 for s in out)}")
print(f"  with a detour: {sum(bool(s['detours']) for s in out)} (advice in {sum(bool(i['vias']) for i in incidents)} incidents), with ticket validity: {sum(bool(s['ticketVia']) for s in out)}")
missing = sorted({e["name"] for s in out for e in s["ends"] if not e["id"]})
print(f"  stations not in the stop list ({len(missing)}): {', '.join(missing[:40])}")
print("order of events (all causes), minutes after the start:")
for key, v in script["ALL"].items():
    m = v["minutes"]
    print(f"  {key:9} in {len(m) / v['n']:4.0%} of {v['n']}  median +{median(m)}  (p25 +{m[len(m) // 4]}, p75 +{m[3 * len(m) // 4]})")
print(f"causes with their own script: {', '.join(c for c in script if c != 'ALL')}")
print(f"wrote {OUT.relative_to(Path.cwd()) if OUT.is_relative_to(Path.cwd()) else OUT} ({OUT.stat().st_size // 1024} KB)")
