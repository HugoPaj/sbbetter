#!/usr/bin/env python3
"""
Builds src/lib/disruption-model.json from the SBB hackathon export (Daten.zip).

    python3 scripts/build-disruption-model.py [path/to/Daten]

Standard library only. What it learns, per disruption cause (EG_xxx):
  - how long disruptions last        public liveticker, everything before CUTOFF
  - how far the first SBB estimate   same history; stored as actual / announced
    overruns
  - replacement buses: how often and  VIA event log (September 2026), minus the
    how long until they're announced  events we replay in the demo

Events on/after CUTOFF are held out: they are replayed in the demo and used for
the backtest printed at the end (and stored in the JSON).
"""

import collections
import csv
import json
import re
import statistics as st
import sys
import zipfile
from datetime import datetime, timedelta, timezone
from pathlib import Path

CUTOFF = datetime(2026, 9, 1, tzinfo=timezone.utc)
MIN_SAMPLES = 8  # fewer samples for a cause → fall back to all causes
OUT = Path(__file__).resolve().parent.parent / "src/lib/disruption-model.json"

csv.field_size_limit(10**9)
root = Path(sys.argv[1]) if len(sys.argv) > 1 else Path(__file__).resolve().parent.parent / "data/Daten"
ext = root / "extern-liveticker"


def ts(s):
    s = s.strip()
    return datetime.strptime(s[:19] + s[-6:].replace(" ", ""), "%Y-%m-%d %H:%M:%S%z") if s else None


def rows(name):
    return list(csv.DictReader(open(next(ext.glob(name + "_*.csv")), encoding="utf-8")))


def quantile(xs, p):
    xs = sorted(xs)
    return xs[min(len(xs) - 1, int(p * len(xs)))]


reasons = {r["id"]: r["reason_en"] for r in rows("reason")}

# ---- public liveticker: one row per incident, from its version history ----

versions = collections.defaultdict(list)
for r in rows("incident_audit") + rows("incident"):
    versions[r["id"]].append(r)


def announced_minutes(v, start):
    """First announced end of the disruption, in minutes after its start (or None)."""
    for field in ("duration_to", "duration_at_least"):
        val = v[field]
        if not val:
            continue
        if len(val) > 12:  # full timestamp
            end = ts(val)
        else:  # time of day, e.g. "16:30:00"
            h, m = map(int, val.split(":")[:2])
            end = start.replace(hour=h, minute=m, second=0, microsecond=0)
            if end < start:
                end += timedelta(days=1)
        return (end - start).total_seconds() / 60
    return None


incidents = []
for iid, vs in versions.items():
    vs.sort(key=lambda v: ts(v["updated_at_source"]) or ts(v["last_modified_date"]))
    start = ts(vs[0]["created_at_source"])
    ended = [v for v in vs if v["lifecycle"] == "ENDED"]
    if not start or not ended:
        continue
    minutes = (ts(ended[0]["updated_at_source"]) - start).total_seconds() / 60
    if not 0 < minutes < 14 * 24 * 60:
        continue
    ann = announced_minutes(vs[0], start)
    incidents.append(
        dict(
            id=iid,
            cause=vs[0]["reason_id_fk"],
            start=start,
            minutes=minutes,
            announced=ann if ann and ann > 0 else None,
            summary=vs[0]["summary_en"],
            summary_de=vs[0]["summary_de"],
        )
    )

history = [i for i in incidents if i["start"] < CUTOFF]
held_out = {i["id"]: i for i in incidents if i["start"] >= CUTOFF}

# ---- VIA event log (xlsx, parsed by hand to stay dependency-free) ----

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
log = [{header[c]: r.get(c, "") for c in header} for r in sheet[1:]]


def excel_time(v):  # Excel serial date, Zurich local time
    return datetime(1899, 12, 30) + timedelta(days=float(v)) if v else None


via = collections.defaultdict(list)
for r in log:
    via[r["alea_fall_id"]].append(r)

via_events = []
for fid, vs in via.items():
    created = excel_time(vs[0]["alea_erstellungszeitpunkt"])

    def after(col):
        t = min((excel_time(v[col]) for v in vs if v[col]), default=None)
        return (t - created).total_seconds() / 60 if t else None

    last = vs[-1]
    via_events.append(
        dict(
            id=fid,
            cause=last["ereignisgrund"],
            created=created,
            bus=after("zeitpunkt_erstpublikation_bahnersatz"),
            lines=last["stoerungs_liniennummer"],
            stops=[s for s in (last["stoerungs_ort1"], last["stoerungs_ort2"], last["stoerungs_linie_von"], last["stoerungs_linie_bis"]) if s],
        )
    )

# ---- per-cause model ----


def group(items, key):
    g = collections.defaultdict(list)
    for i in items:
        g[i[key]].append(i)
    return g


def cause_model(hist, ratios, buses):
    bus_min = sorted(round(b["bus"]) for b in buses if b["bus"] is not None and b["bus"] >= 0)
    return dict(
        n=len(hist),
        minutes=sorted(round(i["minutes"]) for i in hist),
        overrun=sorted(round(i["minutes"] / i["announced"], 3) for i in ratios),
        busN=len(buses),
        busShare=round(len(bus_min) / len(buses), 3) if buses else None,
        busMinutes=bus_min,
    )


replay_ids = set(held_out)
bus_events = [e for e in via_events if e["id"] not in replay_ids]
with_ann = [i for i in history if i["announced"]]
by_cause, ratio_by_cause, bus_by_cause = group(history, "cause"), group(with_ann, "cause"), group(bus_events, "cause")

causes = {"ALL": dict(label="All causes", **cause_model(history, with_ann, bus_events))}
for code in sorted(set(by_cause) | set(bus_by_cause)):
    h, r, b = by_cause.get(code, []), ratio_by_cause.get(code, []), bus_by_cause.get(code, [])
    if max(len(h), len(b)) < MIN_SAMPLES:
        continue
    m = cause_model(h, r, b)
    # Each part falls back to ALL on its own when it is too thin.
    for part, n in (("minutes", len(h)), ("overrun", len(r))):
        if n < MIN_SAMPLES:
            m[part] = None
    if len(b) < MIN_SAMPLES:
        m["busShare"], m["busMinutes"] = None, None
    causes[code] = dict(label=reasons.get(code, code), **m)

# ---- replays + backtest on the held-out events ----

via_by_id = {e["id"]: e for e in via_events}


def model_for(code, part):
    c = causes.get(code)
    return c[part] if c and c.get(part) else causes["ALL"][part]


replays, hits_sbb, hits_model, n_bt = [], 0, 0, 0
for i in sorted(held_out.values(), key=lambda i: i["start"]):
    e = via_by_id.get(i["id"])
    replays.append(
        dict(
            id=i["id"],
            cause=i["cause"],
            causeLabel=reasons.get(i["cause"], i["cause"]),
            summary=i["summary"],
            start=i["start"].isoformat(),
            announcedMinutes=round(i["announced"]) if i["announced"] else None,
            actualMinutes=round(i["minutes"]),
            lines=e["lines"] if e else "",
            stops=e["stops"] if e else [],
            replacementBusAfter=round(e["bus"]) if e and e["bus"] is not None else None,
        )
    )
    if i["announced"]:
        n_bt += 1
        hits_sbb += i["minutes"] <= i["announced"]
        hits_model += i["minutes"] <= i["announced"] * quantile(model_for(i["cause"], "overrun"), 0.8)

backtest = dict(
    events=n_bt,
    endedBySbbEstimate=hits_sbb,
    endedByModel80=hits_model,
    note=f"Incidents from {CUTOFF.date()} on with an SBB estimate; model fitted on data before.",
)

OUT.write_text(
    json.dumps(
        dict(
            builtFrom="SBB LauzHack 2026 export: public liveticker 2024-03..2026-08 (durations, overruns), VIA log 2026-09 (replacement buses)",
            cutoff=CUTOFF.date().isoformat(),
            causes=causes,
            replays=replays,
            backtest=backtest,
        ),
        ensure_ascii=False,
        separators=(",", ":"),
    )
)

print(f"history: {len(history)} incidents ({len(with_ann)} with an SBB estimate), VIA: {len(via_events)} events")
print(f"causes modelled: {', '.join(k for k in causes if k != 'ALL')}")
for code, c in causes.items():
    mins, ov = c["minutes"], c["overrun"]
    print(
        f"  {c['label'][:38]:38} n={c['n']:3}"
        + (f"  median {st.median(mins):4.0f} min  p80 {quantile(mins, .8):4.0f}" if mins else "  (durations: ALL)       ")
        + (f"  overrun p80 x{quantile(ov, .8):.2f}" if ov else "  (overrun: ALL)")
        + (f"  bus {100 * c['busShare']:.0f}%" if c["busShare"] is not None else "")
    )
print(f"backtest on {n_bt} held-out events (from {CUTOFF.date()}): ended by SBB estimate {hits_sbb}/{n_bt}, by model p80 {hits_model}/{n_bt}")
print(f"wrote {OUT.relative_to(Path.cwd()) if OUT.is_relative_to(Path.cwd()) else OUT} ({OUT.stat().st_size // 1024} KB)")
