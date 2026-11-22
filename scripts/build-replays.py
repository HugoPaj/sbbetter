#!/usr/bin/env python3
"""
Builds public/replays.json from the SBB hackathon export (Daten.zip).

    python3 scripts/build-replays.py [path/to/Daten]

A "replay" is one real September 2026 disruption, update by update, as the three
sources published it:

  timetable   the VIA event log (Ereignismeldungen): when the disruption reached the
              timetable, which lines and which stops, when travel advice and
              replacement buses were first published, the end message
  ticker      every version of the public live ticker incident (incident_audit +
              incident): summary, description, SBB's end estimate, the advice lines
  message     the public ticker messages written by the traffic control centre
  staff       a hand-picked few of the internal KULT messages (French/German), with
              an English translation written here: the facts a traveller would want
              (buses ordered, power back, first trains), often well before the public
              ticker says them

The app replays one of these on top of today's live timetable: it moves the
incident to "now" and shows, step by step, what each source said and what the
app tells a traveller whose journey runs over the closed line.

These incidents are held out of the disruption model (it is fitted on data before
September 2026, see build-disruption-model.py), so the end forecasts shown during
a replay are honest predictions, not hindsight.
"""

import csv
import html
import json
import re
import sys
import unicodedata
from datetime import datetime, timedelta
from pathlib import Path
from zoneinfo import ZoneInfo

HERE = Path(__file__).resolve().parent
OUT = HERE.parent / "public/replays.json"
ZRH = ZoneInfo("Europe/Zurich")

csv.field_size_limit(10**9)
root = Path(sys.argv[1]) if len(sys.argv) > 1 else Path(__file__).resolve().parent.parent / "data/Daten"
ext, intern = root / "extern-liveticker", root / "intern-liveticker"

# ---- the replays: incident, KULT case, a journey that runs over the closed line, picked staff messages ----

REPLAYS = [
    dict(
        key="renens-morges",
        incident="2195005188970",
        journey=(("8501120", "Lausanne"), ("8501008", "Genève")),
        pitch="Lausanne – Genève cut for 4 h.",
        staff={
            "364370": ("info", "Overhead line damaged, with a fire. Operating concept active from 17:30."),
            "364377": ("forecast", "No way to get between Lausanne and Genève at the moment. Disruption until at least 18:30."),
            "364390": ("info", "Fire brigade on site."),
            "364399": ("forecast", "Concept being prepared for total interruption Bussigny – Morges – Renens VD. No forecast for reopening yet."),
            "364409": ("bus", "14 buses ordered. No arrival time yet."),
            "364415": ("bus", "Buses on site at Renens and Morges from 19:30, 80 seats each. 4 run direct Renens – Morges."),
            "364425": ("info", "Checking which first trains can run."),
            "364426": ("restored", "First trains: Lausanne → Genève 730, 44, 1732, 18436. Genève → Lausanne 1739, 1741, 18487."),
        },
    ),
    dict(
        key="puidoux-vauderens",
        incident="2195005195853",
        journey=(("8501120", "Lausanne"), ("8507000", "Bern")),
        pitch="Fire cuts Lausanne – Fribourg.",
        staff={
            "365405": ("forecast", "First forecast: 18:00."),
            "365407": ("bus", "4 buses, 150 seats, from Palézieux to Lausanne, Puidoux, Vauderens and Romont. At the stations from 17:15."),
            "365427": ("restored", "Power restored Puidoux – Vauderens and Palézieux – Moudon."),
            "365432": ("forecast", "The 18:00 forecast holds."),
            "365433": ("restored", "Proposed first long-distance trains: 2530 Romont – Genève-Aéroport, 733 Lausanne – St. Gallen, 728 Fribourg – Genève-Aéroport."),
        },
    ),
    dict(
        key="wadenswil-pfaffikon",
        incident="2195005182293",
        journey=(("8503000", "Zürich HB"), ("8509000", "Chur")),
        pitch="Lake Zurich line down for 9 h.",
        staff={
            "363074": ("info", "Power problem between Pfäffikon SZ and Thalwil. Being investigated."),
            "363084": ("bus", "Buses and drivers being called in. The first bus is sent to Wädenswil."),
            "363111": ("bus", "First bus now shuttles Wädenswil – Pfäffikon SZ. Second bus on site at 08:30."),
            "363114": ("forecast", "Forecast: 12:00."),
            "363120": ("bus", "From 08:00, four articulated buses in service."),
            "363160": ("restored", "One track usable again from 11:00. IC 3 runs (first trains 567 and 570), IR 35 Pfäffikon SZ – Zürich HB."),
            "363174": ("forecast", "First forecast for the second track: 16:00."),
            "363202": ("restored", "First trains possible on both tracks, incl. 105 Zürich HB – Sargans – Chur."),
        },
    ),
]

# ---- helpers ----


def rows(folder, pattern):
    return list(csv.DictReader(open(next(folder.glob(pattern)), encoding="utf-8-sig")))


def ts(s):
    s = s.strip()
    return datetime.strptime(s[:19] + s[-6:].replace(" ", ""), "%Y-%m-%d %H:%M:%S%z") if s else None


def excel(v):  # Excel serial date, Zurich local time
    return (datetime(1899, 12, 30) + timedelta(days=float(v))).replace(tzinfo=ZRH) if v else None


def norm(s):
    s = unicodedata.normalize("NFKD", s.lower())
    s = "".join(c for c in s if not unicodedata.combining(c))
    return " ".join(s.replace("ß", "ss").translate({ord(c): " " for c in ".,;:!?'’/-–()\"«»"}).split())


stops = json.loads((HERE / "train-stops.json").read_text())
by_name, by_id = {}, {}
for uic, name, lat, lon in stops:
    by_name.setdefault(norm(name), (uic, name, lat, lon))
    by_id[str(uic)] = (uic, name, lat, lon)
for uic, name, lat, lon in stops:
    if "/" in name:
        for half in name.split("/"):
            by_name.setdefault(norm(half), (uic, name, lat, lon))


def stop(name=None, uic=None):
    """{id, name, lat, lon} for a stop name as the ticker writes it ("Renens VD, gare"), or a UIC number."""
    s = by_id.get(str(uic)) if uic else None
    if not s and name:
        name = re.sub(r",\s*(gare|bahnhof|stazione)$", "", name.strip(), flags=re.I)
        s = by_name.get(norm(name))
    if not s:
        return None
    return dict(id=str(s[0]), name=s[1], lat=s[2], lon=s[3])


def names(text):
    """'Genève-Aéroport, Genève, Lausanne' → stops (unknown names dropped)."""
    return [s for s in (stop(n) for n in re.split(r",\s*", text)) if s]


def minutes(t, start):
    return round((t - start).total_seconds() / 60)


def clean(text):
    return re.sub(r"\s+", " ", re.sub("<[^>]+>", " ", html.unescape(text or ""))).strip()


# ---- parsing the public description ----


def segments(description):
    """Closed stretches from the first sentence: 'between Renens VD and Morges, as well as … between Renens VD and Bussigny'."""
    first = description.split("\n")[0]
    out = []
    for a, b in re.findall(r"between (.+?) and (.+?)(?=, as well as|[,.]|$)", first):
        sa, sb = stop(a), stop(b)
        if sa and sb:
            out.append([sa, sb])
    return out


def advice(description):
    out = []
    for line in description.split("\n"):
        m = re.match(r"Passengers travelling (?:between|from) (.+?) (?:and|to) (.+?) travel via (.+?)\.?$", line.strip())
        if m:
            via = stop(m.group(3))
            if via:
                out.append(dict(kind="via", a=names(m.group(1)), b=names(m.group(2)), via=via, text=line.strip()))
            continue
        m = re.match(r"Passengers travelling (?:between|from) (.+?) (?:and|to) (.+?),? use the replacement bus", line.strip())
        if m:
            out.append(dict(kind="bus", a=names(m.group(1)), b=names(m.group(2)), via=None, text=line.strip()))
    return out


def lines_of(description):
    m = re.search(r"Lines? (.+?) (?:is|are) affected", description)
    return [x.strip() for x in re.split(r",| and ", m.group(1)) if x.strip()] if m else []


def end_of(v, start):
    """SBB's announced end, minutes after the start, and whether it is 'at least'."""
    kind = v["duration_type"]
    if kind in ("UNTIL_APPROX_DATE_TIME", "UNTIL_DATE", "UNTIL_AT_LEAST_DATE_TIME", "FROM_TO", "UNTIL") and v["duration_to"]:
        return minutes(ts(v["duration_to"]), start), "AT_LEAST" in kind
    if kind == "UNTIL_AT_LEAST" and v["duration_at_least"]:
        t = ts(v["updated_at_source"]).astimezone(ZRH)
        h, m = map(int, v["duration_at_least"][:5].split(":"))
        end = t.replace(hour=h, minute=m, second=0)
        if end < t:
            end += timedelta(days=1)
        return minutes(end, start), True
    return None, False


# ---- data ----

incidents = rows(ext, "incident_2*.csv") + rows(ext, "incident_audit_*.csv")
messages = rows(ext, "message_2*.csv") + rows(ext, "message_audit_*.csv")
reasons = {r["id"]: r["reason_en"] for r in rows(ext, "reason_*.csv")}
kult = {r["id"].split(".")[0]: r for r in rows(intern, "3_*.csv")}

import zipfile  # noqa: E402

xlsx = zipfile.ZipFile(next((root / "Ereignismeldungen").glob("*.xlsx")))
strings = [re.sub("<[^>]+>", "", s) for s in re.findall(r"<si>(.*?)</si>", xlsx.read("xl/sharedStrings.xml").decode(), re.S)]


def cells(row):
    out = {}
    for attrs, v in re.findall(r"<c ([^>]*?)(?:/>|>(?:<v>(.*?)</v>)?</c>)", row):
        col = re.search(r'r="([A-Z]+)', attrs).group(1)
        out[col] = strings[int(v)] if 't="s"' in attrs and v else v
    return out


sheet = [cells(r) for r in re.findall(r"<row[^>]*>(.*?)</row>", xlsx.read("xl/worksheets/sheet1.xml").decode(), re.S)]
header = sheet[0]
via_log = [{header[c]: r.get(c, "") for c in header} for r in sheet[1:]]

model = json.loads((HERE.parent / "src/lib/disruption-model.json").read_text())
assert model["cutoff"] <= "2026-09-01", "the disruption model must not have seen the replayed incidents"

# ---- one replay ----


def build(cfg):
    iid = cfg["incident"]
    versions = sorted((v for v in incidents if v["id"] == iid), key=lambda v: v["last_modified_date"])
    if not versions:
        raise SystemExit(f"incident {iid} not in the export")
    start = ts(versions[0]["created_at_source"]).astimezone(ZRH)
    vias = sorted((v for v in via_log if v["alea_fall_id"] == iid), key=lambda v: float(v["logging_date_time"]))
    states, updates = [], []

    def add_update(t, at, source, kind, title, text, changes=()):
        updates.append(dict(t=t, at=at.isoformat(), source=source, kind=kind, title=title, text=text, changes=list(changes)))

    # Timetable (VIA): first publication, line list changes, milestones.
    last_lines, seen = None, set()
    for v in vias:
        at = excel(v["logging_date_time"])
        t = minutes(at, start)
        a, b = stop(uic=v["stoerungs_ort1"]), stop(uic=v["stoerungs_ort2"]) if v["stoerungs_ort2"] else None
        lines = [x.strip() for x in v["stoerungs_liniennummer"].split(",") if x.strip()]
        where = " – ".join(s["name"] for s in (a, b) if s)
        if last_lines is None:
            states.append(dict(t=t, source="timetable", summary=f"Interrupted service: {where}", description="", lines=lines, segments=[[s for s in (a, b) if s]] if a else [], advice=[], end=None, atLeast=False, lifecycle="INFO", limited=False))
            add_update(t, at, "timetable", "start", "Reaches the timetable", f"Trains between {where} are marked as disrupted. Lines {', '.join(lines)}.")
        elif lines != last_lines:
            gained = [x for x in lines if x not in last_lines]
            if states[-1]["source"] == "timetable":
                states.append({**states[-1], "t": t, "lines": lines})
            add_update(t, at, "timetable", "lines", "More lines affected" if gained else "Line list changed", f"Lines {', '.join(lines)}.", [f"Now also {', '.join(gained)}"] if gained else [])
        last_lines = lines
        for col, kind, title in (
            ("zeitpunkt_erstpublikation_reiseempfehlung", "advice", "Travel advice published"),
            ("zeitpunkt_erstpublikation_bahnersatz", "bus", "Replacement buses published"),
            ("zeitpunkt_globale_endmeldung", "end", "End of disruption published"),
        ):
            if v[col] and kind not in seen:
                seen.add(kind)
                when = excel(v[col])
                add_update(minutes(when, start), when, "timetable", kind, title, "")

    # Public ticker: each version that changes what a traveller reads.
    prev = None
    for v in versions:
        desc = v["description_en"].strip()
        key = (v["summary_en"], desc, v["duration_type"], v["duration_to"], v["duration_at_least"], v["lifecycle"])
        if prev and key == prev["key"] or v["lifecycle"] == "DELETED":
            continue
        at = ts(v["last_modified_date"]).astimezone(ZRH)
        t = minutes(at, start)
        end, at_least = end_of(v, start)
        st = dict(
            t=t,
            source="ticker",
            summary=v["summary_en"],
            description=desc,
            lines=lines_of(desc) or (states[-1]["lines"] if states else []),
            segments=segments(desc) or (states[-1]["segments"] if states else []),
            advice=advice(desc),
            end=end,
            atLeast=at_least,
            lifecycle=v["lifecycle"],
            limited=v["summary_en"].lower().startswith("limited"),
        )
        changes = []
        if not prev:
            title = "First public ticker message"
        else:
            title = "Ticker updated"
            p = prev["state"]
            if st["lifecycle"] == "ENDED" and p["lifecycle"] != "ENDED":
                changes.append("Service resumed")
            if st["limited"] and not p["limited"]:
                changes.append("Trains running again, limited service")
            if st["end"] != p["end"]:
                fmt = lambda m: (start + timedelta(minutes=m)).strftime("%H:%M") if m is not None else "unknown"  # noqa: E731
                changes.append(f"End estimate {fmt(p['end'])} → {fmt(st['end'])}")
            ps = {tuple(sorted((a["id"], b["id"]))) for a, b in p["segments"]}
            for a, b in st["segments"]:
                if tuple(sorted((a["id"], b["id"]))) not in ps:
                    changes.append(f"Now also closed {a['name']} – {b['name']}")
            gained = [x for x in st["lines"] if x not in p["lines"]]
            if gained:
                changes.append(f"More lines: {', '.join(gained)}")
            pa = {a["text"] for a in p["advice"]}
            for a in st["advice"]:
                if a["text"] not in pa:
                    changes.append(f"New advice: {a['text']}")
            sa = {a["text"] for a in st["advice"]}
            if any(a["text"] not in sa for a in p["advice"]):
                changes.append("Some advice withdrawn")
            if not changes:
                continue
        states.append(st)
        add_update(t, at, "ticker", "ticker", title, st["summary"], changes)
        prev = dict(key=key, state=st)

    # Public messages: each one once, when first published.
    first = {}
    for m in messages:
        if m["incident_id_fk"] != iid or m["status"] != "PUBLISHED":
            continue
        t = ts(m["created_date"])
        if m["id"] not in first or t < first[m["id"]][0]:
            first[m["id"]] = (t, m)
    for t, m in first.values():
        at = t.astimezone(ZRH)
        add_update(minutes(at, start), at, "message", "message", clean(m["title_en"]), clean(m["message_en"]))

    # Staff (KULT), the hand-picked ones.
    for mid, (kind, english) in cfg["staff"].items():
        k = kult[mid]
        at = datetime.strptime(k["timestamp"][:19], "%Y-%m-%d %H:%M:%S").replace(tzinfo=ZRH)
        add_update(minutes(at, start), at, "staff", kind, "Control centre (internal)", english, [clean(k["message"])])

    updates.sort(key=lambda u: (u["t"], ["timetable", "ticker", "message", "staff"].index(u["source"])))
    # Once the ticker has a text, it is what travellers read; the timetable's own state only covers the time before.
    public_from = min(s["t"] for s in states if s["source"] == "ticker")
    states = sorted((s for s in states if s["source"] == "ticker" or s["t"] < public_from), key=lambda s: s["t"])

    first_public = next(s for s in states if s["source"] == "ticker")
    first_estimate = next((s for s in states if s["end"] is not None), None)
    resumed = next((s["t"] for s in states if s["limited"] or s["lifecycle"] == "ENDED"), None)
    reason = versions[-1]["reason_id_fk"]
    milestone = lambda kind, source=None: next((u["t"] for u in updates if u["kind"] == kind and (source is None or u["source"] == source)), None)  # noqa: E731
    (fid, fname), (tid, tname) = cfg["journey"]
    return dict(
        key=cfg["key"],
        id=iid,
        title=re.sub(r"^[^:]+:\s*", "", first_public["summary"]),
        pitch=cfg["pitch"],
        start=start.isoformat(),
        cause=reason,
        causeLabel=reasons.get(reason, reason),
        journey=dict(**{"from": dict(id=fid, name=fname)}, to=dict(id=tid, name=tname)),
        states=states,
        updates=updates,
        outcome=dict(
            firstEstimate=first_estimate["end"] if first_estimate else None,
            firstEstimateAt=first_estimate["t"] if first_estimate else None,
            trainsAgain=resumed,
            ended=next((s["t"] for s in states if s["lifecycle"] == "ENDED"), None),
            publicAt=first_public["t"],
            adviceAt=next((s["t"] for s in states if any(a["kind"] == "via" for a in s["advice"])), None),
            busPublicAt=milestone("bus", "timetable"),
            busStaffAt=milestone("bus", "staff"),
            restoredStaffAt=milestone("restored", "staff"),
        ),
    )


replays = [build(c) for c in REPLAYS]
OUT.write_text(json.dumps(dict(builtFrom="SBB LauzHack 2026 export: VIA event log, public liveticker (incident + message audit), KULT internal liveticker", replays=replays), ensure_ascii=False, separators=(",", ":")))
for r in replays:
    o = r["outcome"]
    print(f"{r['key']:22} {len(r['states']):2} states {len(r['updates']):3} updates  public at +{o['publicAt']}  first estimate {o['firstEstimate']} (at +{o['firstEstimateAt']})  trains again +{o['trainsAgain']}  advice +{o['adviceAt']}  bus staff +{o['busStaffAt']} public +{o['busPublicAt']}")
print(f"→ {OUT.relative_to(HERE.parent)} ({OUT.stat().st_size // 1024} KB)")
