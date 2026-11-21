#!/usr/bin/env python3
"""
Builds the travelcard catalog from open transport data (LINDAS SPARQL,
https://lindas.admin.ch/query — the NOVA tariff data of opentransportdata.swiss):

    python3 scripts/build-passes.py

public/passes/index.json        every pass the traveller can pick (national, area, zone passes)
public/passes/<id>.json         per pass: the edges (stop pairs) it covers — for zone passes with
                                the zones each edge runs through — plus each stop's own zone and
                                coordinates; the app loads only the passes selected

NOVA attaches zones to edges, not stops: a train edge from Lausanne runs through
many zones, so a stop's "own" zone is the one most of its edges are in.

National passes (GA, Half Fare, Night GA…) are valid on (nearly) every edge and
are handled by rules in src/lib/passes.ts; they need no stop list.
Standard library only.
"""
import collections, html, json, re, sys, time, urllib.parse, urllib.request
from pathlib import Path

ENDPOINT = "https://lindas.admin.ch/query"
OUT = Path(__file__).resolve().parent.parent / "public/passes"
PREFIXES = """
PREFIX otd: <https://lod.opentransportdata.swiss/vocab/>
PREFIX gtfs: <http://vocab.gtfs.org/terms#>
PREFIX schema: <http://schema.org/>
PREFIX rdfs: <http://www.w3.org/2000/01/rdf-schema#>
PREFIX geo: <http://www.w3.org/2003/01/geo/wgs84_pos#>
"""

# Area passes: one product valid on a fixed network (an "anwendungsbereich" in NOVA).
AREA_SCOPES = {
    "t656-2-berner-oberland-pass": "Berner Oberland Pass",
    "t656-3-tell-pass-sommer": "Tell-Pass (summer)",
    "t656-3-tell-pass-winter": "Tell-Pass (winter)",
    "t656-1-regional-pass-leman-alpes": "Regional Pass Léman–Alpes",
    "rh-b-graubundenpass-gesamt": "Graubündenpass",
    "rh-b-graubundenpass-zone-nord": "Graubündenpass, north",
    "rh-b-graubundenpass-zone-sud": "Graubündenpass, south",
    "jb-jungfrau-travel-pass": "Jungfrau Travel Pass",
    "mgb-oberwallis-pass-manu": "Oberwallis Pass",
    "tmr-manu-unterwallis-pass": "Unterwallis Pass",
    "t651-42-engadin-mobil-gaste-abo": "engadin mobil guest pass",
    "pag-easy-card-valais-bas": "EasyCard Valais-Bas",
    "trans-n-pass-temps-val-de-travers": "Pass'Temps Val-de-Travers",
}


def sparql(query: str, retries: int = 4) -> list[dict]:
    body = urllib.parse.urlencode({"query": PREFIXES + query}).encode()
    for attempt in range(retries):
        try:
            req = urllib.request.Request(ENDPOINT, data=body, headers={"Accept": "application/sparql-results+json"})
            with urllib.request.urlopen(req, timeout=300) as r:
                return [{k: v["value"] for k, v in b.items()} for b in json.load(r)["results"]["bindings"]]
        except Exception as e:  # LINDAS is occasionally slow; retry
            print(f"  retry {attempt + 1}: {e}", file=sys.stderr)
            time.sleep(10 * (attempt + 1))
    raise SystemExit("SPARQL failed")


def slug(s: str) -> str:
    return re.sub(r"[^a-z0-9]+", "-", s.lower()).strip("-")


EDGE = re.compile(r"/transportedge/(\d+)/(\d+)/")
# Internal or duplicate subscription plans that travellers don't buy as such.
SKIP_PLAN = re.compile(r"fiktiv|Abo Ex[A-Z]|transfrontalier|Modul-Abo|ZZ_Kombi", re.I)


def coords_of(stop_ids: set[str]) -> dict:
    out: dict = {}
    ids = sorted(stop_ids)
    for i in range(0, len(ids), 400):
        values = " ".join(f"<https://lod.opentransportdata.swiss/didok/{x}>" for x in ids[i : i + 400])
        for r in sparql(f"SELECT ?id ?lat ?lon WHERE {{ VALUES ?s {{ {values} }} ?s schema:identifier ?id; geo:lat ?lat; geo:long ?lon }}"):
            out[r["id"]] = [round(float(r["lat"]), 5), round(float(r["lon"]), 5)]
    return out


def pass_file(edges: dict[str, set[str]] | set[str]) -> dict:
    """Edges as "a-b" keys (lower id first); zone passes map each to its zones."""
    zoned = isinstance(edges, dict)
    stops = {x for k in edges for x in k.split("-")}
    out: dict = {"edges": {k: sorted(v, key=lambda z: (len(z), z)) for k, v in edges.items()} if zoned else sorted(edges)}
    if zoned:
        votes: dict[str, collections.Counter] = collections.defaultdict(collections.Counter)
        for k, zs in edges.items():
            for x in k.split("-"):
                votes[x].update(zs)
        out["stopZone"] = {x: c.most_common(1)[0][0] for x, c in votes.items()}
    out["coords"] = coords_of(stops)
    return out


def edge_key(uri: str) -> str | None:
    m = EDGE.search(uri)
    return "-".join(sorted(m.groups(), key=int)) if m else None


OUT.mkdir(parents=True, exist_ok=True)
index = {"source": "NOVA tariff data, opentransportdata.swiss via LINDAS SPARQL", "built": time.strftime("%Y-%m-%d"), "zonePasses": [], "areaPasses": []}

# --- Zone passes: every subscription ("Abo") zoning plan, by network -----------
plans = sparql("""
SELECT ?plan ?label ?alliance ?allianceLabel WHERE {
  ?plan a otd:ZoningPlan; rdfs:label ?label; otd:alliance ?alliance.
  OPTIONAL { ?alliance rdfs:label ?allianceLabel }
  FILTER(CONTAINS(LCASE(STR(?label)), "abo"))
}""")
print(f"{len(plans)} subscription zone plans")
seen = set()
for p in sorted(plans, key=lambda p: p["label"]):
    label = html.unescape(p["label"])
    if SKIP_PLAN.search(label) or label in seen:
        continue
    seen.add(label)
    zones = sparql(f"""
SELECT ?id ?label WHERE {{ ?z a otd:Zone; otd:zoningPlan <{p['plan']}>; schema:identifier ?id. OPTIONAL {{ ?z rdfs:label ?label }} }}""")
    rows = sparql(f"""
SELECT DISTINCT ?e ?zone WHERE {{ ?e a otd:TransportEdge; otd:zone ?z. ?z otd:zoningPlan <{p['plan']}>; schema:identifier ?zone. }}""")
    edges: dict[str, set[str]] = collections.defaultdict(set)
    for r in rows:
        if (k := edge_key(r["e"])):
            edges[k].add(r["zone"])
    if not zones or not edges:
        continue
    pid = "zone-" + slug(p["plan"].split("/zoningplan/")[1])
    (OUT / f"{pid}.json").write_text(json.dumps(pass_file(edges), separators=(",", ":")))
    network = html.unescape(p.get("allianceLabel") or p["alliance"].rsplit("/", 1)[-1])
    index["zonePasses"].append({
        "id": pid,
        "network": network,
        "label": re.sub(r"\s*\((Abo|Abo & Billett)\)\s*", " ", label).strip(),
        "zones": sorted(({"id": z["id"], "name": html.unescape(z.get("label", ""))} for z in zones), key=lambda z: (len(z["id"]), z["id"])),
    })
    print(f"  {label}: {len(zones)} zones, {len(edges)} edges")

# --- Area passes: products valid on a fixed network ---------------------------
for scope, name in AREA_SCOPES.items():
    rows = sparql(f"""
SELECT DISTINCT ?e WHERE {{ ?e a otd:TransportEdge; otd:anwendungsbereich <https://lod.opentransportdata.swiss/anwendungsbereich/{scope}> }}""")
    edges = {k for r in rows if (k := edge_key(r["e"]))}
    if not edges:
        continue
    pid = "area-" + scope
    (OUT / f"{pid}.json").write_text(json.dumps(pass_file(edges), separators=(",", ":")))
    index["areaPasses"].append({"id": pid, "name": name})
    print(f"  {name}: {len(edges)} edges")

(OUT / "index.json").write_text(json.dumps(index, ensure_ascii=False, separators=(",", ":")))
size = sum(f.stat().st_size for f in OUT.glob("*.json"))
print(f"wrote {len(list(OUT.glob('*.json')))} files, {size / 1e6:.1f} MB")
