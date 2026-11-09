"""Independent, standard-library-only finite synthetic graph reference."""
import hashlib
import json
import re
import sys
from datetime import datetime, timedelta, timezone
from typing import Literal, TypedDict


class Available(TypedDict):
    status: Literal['available']


class Unavailable(TypedDict):
    status: Literal['unavailable']
    reason: Literal['identity_unverified', 'history_incomplete', 'target_unavailable', 'budget_exceeded']


Availability = Available | Unavailable


class Coverage(TypedDict):
    start: str
    complete: bool


class Observation(TypedDict):
    corpus_sha256: str
    query_sha256: str
    semantics_sha256: str
    availability: Availability
    currency: str
    namespace: str
    source_prefix: int
    coverage: Coverage
    truncated: bool
    metrics: dict | None

VERSION = "local_synthetic_graph_v1"
MAX_BYTES = 2097152
MAX_OUTPUT = 16777216

class Invalid(ValueError):
    pass

def check(ok):
    if not ok:
        raise Invalid("GRAPH_CONTRACT_INVALID")

def canonical(x):
    return json.dumps(x, sort_keys=True, separators=(",", ":"), ensure_ascii=False)

def digest(x):
    return hashlib.sha256(canonical(x).encode()).hexdigest()

def detach(x, depth=0):
    check(depth <= 16)
    if type(x) is dict:
        check(all(type(k) is str for k in x))
        return {k: detach(v, depth+1) for k,v in x.items()}
    if type(x) is list:
        check(len(x) <= 2000)
        return [detach(v, depth+1) for v in x]
    check(x is None or type(x) in (str, bool, int))
    return x

def keys(x, names):
    check(type(x) is dict and set(x) == set(names.split()))

def integer(x, low, high=2147483647):
    check(type(x) is int and low <= x <= high)

def lexical(x, pattern):
    check(type(x) is str and re.fullmatch(pattern, x, re.ASCII) is not None)

def identifier(x):
    lexical(x, r"[A-Za-z0-9][A-Za-z0-9_.:-]{0,127}")

def namespace(x):
    lexical(x, r"synthetic_[a-z0-9_]{1,40}")

def utc(x):
    lexical(x, r"[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}\.000Z")
    try:
        return datetime.strptime(x, "%Y-%m-%dT%H:%M:%S.000Z").replace(tzinfo=timezone.utc)
    except ValueError:
        raise Invalid("GRAPH_CONTRACT_INVALID") from None

def cents(x):
    lexical(x, r"(0|[1-9][0-9]{0,21})\.[0-9]{2}")
    return int(x.replace(".", ""))

def target(x):
    keys(x, "namespace transaction_id revision_number")
    namespace(x["namespace"]); identifier(x["transaction_id"])
    integer(x["revision_number"], 1)

def validate(value):
    x = detach(value)
    check(len(canonical(x).encode()) <= MAX_BYTES)
    keys(x, "version mode corpus_id workspace_key deliveries queries")
    check(x["version"] == VERSION and x["mode"] == "local_synthetic" and x["workspace_key"] == "synthetic_local")
    identifier(x["corpus_id"])
    check(type(x["deliveries"]) is list and len(x["deliveries"]) <= 2000)
    check(type(x["queries"]) is list and 1 <= len(x["queries"]) <= 8)
    previous = 0
    revisions = {}
    for d in x["deliveries"]:
        keys(d, "source_position event"); integer(d["source_position"], previous+1)
        previous = d["source_position"]
        e = d["event"]
        keys(e, "namespace transaction_id revision_number sender receiver occurred_at available_at currency amount status reversed_amount")
        target({k:e[k] for k in ("namespace", "transaction_id", "revision_number")})
        for k in ("sender", "receiver"):
            lexical(e[k], r"synthetic_[A-Za-z0-9_.:-]{1,70}")
        utc(e["occurred_at"]); utc(e["available_at"])
        lexical(e["currency"], r"[A-Z]{3}")
        a,r = cents(e["amount"]), cents(e["reversed_amount"])
        check(r <= a and e["status"] in ("pending", "succeeded", "failed", "partially_reversed", "reversed"))
        check(0 < r < a if e["status"] == "partially_reversed" else r == a if e["status"] == "reversed" else r == 0)
        key = (e["namespace"], e["transaction_id"], e["revision_number"])
        check(key not in revisions or revisions[key] == e)
        revisions[key] = e
    seen = set()
    for q in x["queries"]:
        keys(q, "id namespace target currency as_of anchor_at source_prefix window_seconds max_hops identity_status coverage")
        identifier(q["id"]); check(q["id"] not in seen); seen.add(q["id"])
        namespace(q["namespace"]); target(q["target"])
        check(q["namespace"] == q["target"]["namespace"])
        lexical(q["currency"], r"[A-Z]{3}")
        check(utc(q["anchor_at"]) <= utc(q["as_of"]))
        integer(q["source_prefix"], 0); integer(q["window_seconds"], 3600, 3600); integer(q["max_hops"], 1, 4)
        check(q["identity_status"] in ("synthetic_declared", "unverified"))
        keys(q["coverage"], "start complete"); utc(q["coverage"]["start"])
        check(type(q["coverage"]["complete"]) is bool)
    return x

def parse(raw):
    check(type(raw) is bytes and len(raw) <= MAX_BYTES)
    def pairs(items):
        obj = {}
        for k,v in items:
            check(k not in obj); obj[k] = v
        return obj
    try:
        return validate(json.loads(raw.decode("utf-8"), object_pairs_hook=pairs))
    except (ValueError, UnicodeError, RecursionError):
        raise Invalid("GRAPH_CONTRACT_INVALID") from None

def observe(corpus) -> list[Observation]:
    x = validate(corpus)
    source_hash = digest(x)
    results = []
    for q in x["queries"]:
        result = dict(corpus_sha256=source_hash, query_sha256=digest(dict(corpus_sha256=source_hash, query=q, semantics=SEMANTICS)), semantics_sha256=digest(SEMANTICS), currency=q["currency"], namespace=q["namespace"], source_prefix=q["source_prefix"], coverage=q["coverage"].copy(), truncated=False, metrics=None)
        results.append(result)
        def unavailable(reason):
            result["availability"] = dict(status="unavailable", reason=reason)
            result["truncated"] = reason == "budget_exceeded"
        if q["identity_status"] != "synthetic_declared":
            unavailable("identity_unverified"); continue
        start = utc(q["anchor_at"]) - timedelta(seconds=3600)
        if not q["coverage"]["complete"] or utc(q["coverage"]["start"]) > start:
            unavailable("history_incomplete"); continue
        latest = {}
        for d in x["deliveries"]:
            e = d["event"]
            if d["source_position"] <= q["source_prefix"] and e["available_at"] <= q["as_of"] and e["namespace"] == q["namespace"]:
                old = latest.get(e["transaction_id"])
                if old is None or old["revision_number"] < e["revision_number"]:
                    latest[e["transaction_id"]] = e
        t = latest.get(q["target"]["transaction_id"])
        if t is None or t["revision_number"] != q["target"]["revision_number"] or t["currency"] != q["currency"]:
            unavailable("target_unavailable"); continue
        edges = sorted((e for e in latest.values() if e["currency"] == q["currency"] and start < utc(e["occurred_at"]) <= utc(q["anchor_at"]) and e["status"] in ("succeeded", "partially_reversed") and cents(e["amount"]) > cents(e["reversed_amount"])), key=lambda e: (e["occurred_at"], e["namespace"], e["transaction_id"], e["revision_number"]))
        nodes = sorted({e[k] for e in edges for k in ("sender", "receiver")})
        if len(nodes) > 256 or len(edges) > 1024:
            unavailable("budget_exceeded"); continue
        paths, cycles = [], []
        adjacency = {n:[e for e in edges if e["sender"] == n] for n in nodes}
        states = 0
        def walk(origin, node, visited, chain, last_time):
            nonlocal states
            for e in adjacency[node]:
                if last_time is not None and e["occurred_at"] <= last_time:
                    continue
                dest = e["receiver"]
                closure = dest == origin
                if dest in visited and not closure:
                    continue
                states += 1
                if states > 5000:
                    raise OverflowError
                next_chain = chain + [{k:e[k] for k in ("namespace", "transaction_id", "revision_number")}]
                (cycles if closure else paths).append(dict(edges=next_chain))
                if not closure and len(next_chain) < q["max_hops"]:
                    walk(origin, dest, visited | {dest}, next_chain, e["occurred_at"])
        try:
            for n in nodes:
                walk(n, n, {n}, [], None)
        except OverflowError:
            unavailable("budget_exceeded"); continue
        result["availability"] = dict(status="available")
        result["metrics"] = dict(nodes=len(nodes), edges=len(edges), emitted_path_states=states, net_cents=str(sum(cents(e["amount"]) - cents(e["reversed_amount"]) for e in edges)), fan_in=[dict(handle=n, count=len({e["sender"] for e in edges if e["receiver"] == n})) for n in nodes], fan_out=[dict(handle=n, count=len({e["receiver"] for e in edges if e["sender"] == n})) for n in nodes], paths=paths, cycles=cycles)
    return results

def main():
    try:
        check(len(sys.argv) == 1)
        raw = sys.stdin.buffer.read(MAX_BYTES+1)
        output = canonical(dict(version=VERSION, observations=observe(parse(raw)))).encode()
        check(len(output) <= MAX_OUTPUT)
    except (Invalid, ValueError, TypeError, KeyError, RecursionError, OverflowError):
        sys.stdout.write("{\"error\":\"GRAPH_CONTRACT_INVALID\"}\n")
        return 2
    sys.stdout.buffer.write(output + b"\n")
    return 0

# Frozen protocol policy metadata; no expected observations are imported.
SEMANTICS = {'revision': 'Select highest revision per namespace/transaction at source_position <= prefix and available_at <= as_of, before window filtering. Exact revision replay deduplicates; changed payload at the same revision rejects globally.', 'lifecycle': 'Only succeeded and partially_reversed positive amount-minus-reversed_amount contribute. Revisions replace rather than add.', 'window': '(anchor_at minus 3600 seconds, anchor_at]; availability independently bounded by as_of and prefix.', 'identity': 'Identity is (namespace, declared handle), never masked-string linkage. Unverified identity or incomplete history is unavailable, never fabricated zero.', 'traversal': 'Enumerate from every selected node, not just the target sender. Fan-in/out count distinct positive-net counterparties per node. Strictly increasing occurred_at; paths have distinct nodes; cycles repeat only the starting node on the last edge. Count each emitted prefix including cycle closure as one path state. Exceeding any bound returns unavailable with no partial observations.', 'witness': 'Depth-first enumeration over edges sorted by occurred_at, namespace, transaction_id, revision_number using code-point ordering. Witness is an ordered list of edge targets; never evidence of the same funds.', 'comparison': 'Existing TS overlap only: small complete single-revision succeeded fan-in/out and strict-time chain/cycle fixtures. Equal-time, corrections, lifecycle, identity/history and budget-divergent cases unsupported. Emitted path-state budget is separate from existing TS edge-inspection budget; no reference or threshold changes.', 'scope': 'Finite synthetic evidence only; no production capacity, accuracy, enforcement or P05-05/P05-06 completion. Source/identity/masking, history, policy/legal, workload/SLO and adoption gates open. Neo4j/GDS untested.'}

if __name__ == '__main__':
    sys.exit(main())
