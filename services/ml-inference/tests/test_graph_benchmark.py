"""Independent literal oracle and hostile protocol checks."""
import copy
import hashlib
import json
from pathlib import Path
import subprocess
import sys
import unittest

ROOT = Path(__file__).resolve().parents[3]
sys.path.insert(0, str(ROOT / "services/ml-inference"))
from lmps_ml import graph_benchmark as g

FIXTURE = json.loads((ROOT / "apps/risk-workers/fixtures/graph-benchmark.json").read_text())

def fresh():
    return copy.deepcopy(FIXTURE["cases"][0]["corpus"])

def event(name, sender="synthetic_A", receiver="synthetic_B", later=False):
    e = fresh()["deliveries"][0]["event"]
    e.update(transaction_id=name, sender=sender, receiver=receiver)
    if later:
        e["occurred_at"] = "2026-01-01T11:02:00.000Z"
    return e

def generated(events):
    c = fresh()
    c["deliveries"] = [dict(source_position=i+1,event=e) for i,e in enumerate(events)]
    c["queries"][0]["target"]["transaction_id"] = events[0]["transaction_id"]
    c["queries"][0]["source_prefix"] = len(events)
    return c

def result(c):
    return g.observe(c)[0]

def ids(witnesses):
    return [[e["transaction_id"] for e in w["edges"]] for w in witnesses]

class GraphTests(unittest.TestCase):
    def test_profiles_and_separation(self):
        profiles = [
            generated([event(f'b{i}', f'synthetic_b{i}', 'synthetic_H') for i in range(128)]),
            generated([event('replay') for _ in range(2000)]),
            generated([event(f'd{i}', f'synthetic_l{i//8}', f'synthetic_r{i%8}') for i in range(64)]),
        ]
        for c, counts in zip(profiles, [(129,128,128),(2,1,1),(16,64,64)]):
            m=result(c)['metrics']
            self.assertEqual((m['nodes'],m['edges'],m['emitted_path_states']),counts)
        c=generated([event('a'),dict(event('a'),namespace='synthetic_other',amount='99.00'),dict(event('eur'),currency='EUR',amount='88.00')])
        self.assertEqual(result(c)['metrics']['net_cents'],'1000')
        c['queries'][0].update(currency='EUR',target=dict(namespace='synthetic_graph',transaction_id='eur',revision_number=1))
        self.assertEqual(result(c)['metrics']['net_cents'],'8800')
        c['queries'][0].update(namespace='synthetic_other',currency='USD',target=dict(namespace='synthetic_other',transaction_id='a',revision_number=1))
        self.assertEqual(result(c)['metrics']['net_cents'],'9900')

    def test_original_oracles(self):
        # These literal expectations are independently asserted, not read from oracle fields.
        expected = {
            "fan": ("4000", ["in1","in2","out1","out2"], [["in1","out1"],["in1","out2"],["in2","out1"],["in2","out2"]], []),
            "chain_cycle": ("3000", ["a","b","c"], [["a","b"],["b","c"]], [["a","b","c"]]),
            "equal_time": ("2000", ["a","b"], [], []),
            "lifecycle": ("1500", ["a"], [], []),
            "isolation": ("1000", ["a"], [], []),
            "future_revision": ("1000", ["a"], [], []),
            "prefix_revision": ("1000", ["a"], [], []),
            "window": ("1000", ["end"], [], []),
        }
        unavailable = dict(future_only="target_unavailable", identity="identity_unverified", partial_history="history_incomplete", missing_history="history_incomplete")
        self.assertEqual(len(FIXTURE["cases"]),12)
        for case in FIXTURE["cases"]:
            name = case["name"]
            with self.subTest(name=name):
                r = result(case["corpus"])
                if name in unavailable:
                    self.assertEqual(r["availability"], dict(status="unavailable",reason=unavailable[name]))
                    self.assertIsNone(r["metrics"])
                    continue
                money, singles, pairs, cycles = expected[name]
                m = r["metrics"]
                self.assertEqual(m["net_cents"], money)
                self.assertEqual(sorted(p[0] for p in ids(m["paths"]) if len(p)==1),sorted(singles))
                self.assertEqual(sorted(p for p in ids(m["paths"]) if len(p)==2),sorted(pairs))
                self.assertEqual(ids(m["cycles"]),cycles)
                if name == "fan":
                    for field in ("fan_in","fan_out"):
                        self.assertEqual(next(v["count"] for v in m[field] if v["handle"]=="synthetic_H"),2)

    def test_detachment_hashes_replays_and_latest(self):
        c = fresh(); before = copy.deepcopy(c)
        r = result(c); self.assertEqual(c,before)
        # Separate serialization and hashing path checks canonical protocol binding.
        wire = json.dumps(before, sort_keys=True, ensure_ascii=False, separators=(',', ':')).encode()
        self.assertEqual(r['corpus_sha256'], hashlib.sha256(wire).hexdigest())
        wire = json.dumps(dict(corpus_sha256=r['corpus_sha256'], query=before['queries'][0], semantics=g.SEMANTICS), sort_keys=True, ensure_ascii=False, separators=(',', ':')).encode()
        self.assertEqual(r['query_sha256'], hashlib.sha256(wire).hexdigest())
        c["deliveries"][0]["event"]["amount"] = "99.00"
        self.assertEqual(r["metrics"]["net_cents"],"4000")
        self.assertNotEqual(result(c)["corpus_sha256"],r["corpus_sha256"])
        self.assertNotEqual(result(c)["query_sha256"],r["query_sha256"])
        self.assertEqual(result(dict(reversed(list(before.items())))),r)
        c=generated([event("a"),event("a")]); self.assertEqual(result(c)["metrics"]["edges"],1)
        c["deliveries"][1]["event"]["amount"]="11.00"
        with self.assertRaises(g.Invalid): result(c)
        c=generated([event("a"),dict(event("a"),revision_number=2,amount="99.00")])
        c["queries"][0]["source_prefix"]=1
        self.assertEqual(result(c)["metrics"]["net_cents"],"1000")
        c["queries"][0]["source_prefix"]=2
        self.assertEqual(result(c)["availability"]["reason"],"target_unavailable")
        c["queries"][0]["target"]["revision_number"]=2
        self.assertEqual(result(c)["metrics"]["net_cents"],"9900")
        # A later revision replaces eligibility before the event window is applied.
        c['deliveries'][1]['event']['occurred_at']='2026-01-01T10:59:00.000Z'
        self.assertEqual(result(c)['metrics']['edges'],0)

    def test_empty_ties_exact_money(self):
        c=generated([event("z"),event("a"),event("m")])
        self.assertEqual(ids(result(c)["metrics"]["paths"]),[["a"],["m"],["z"]])
        for status in ("pending","failed","succeeded"):
            c=generated([dict(event("a"),status=status,amount="0.00")])
            m=result(c)["metrics"]
            self.assertEqual((m["edges"],m["net_cents"],m["paths"]),(0,"0",[]))
        self.assertEqual(g.cents("9999999999999999999999.99"),999999999999999999999999)
        c=generated([dict(event("a"),amount="9999999999999999999999.99")])
        self.assertEqual(result(c)["metrics"]["net_cents"],"999999999999999999999999")

    def test_hard_bounds(self):
        c=generated([event("a") for _ in range(2000)])
        self.assertEqual(result(c)["metrics"]["edges"],1)
        c["deliveries"].append(dict(source_position=2001,event=event("a")))
        with self.assertRaises(g.Invalid): result(c)
        c=fresh(); q=c["queries"][0]
        c["queries"]=[dict(copy.deepcopy(q),id=f"q{i}") for i in range(8)]
        self.assertEqual(len(g.observe(c)),8)
        c["queries"].append(dict(q,id="over"))
        with self.assertRaises(g.Invalid): result(c)
        c=fresh(); result(c); c["queries"][0]["max_hops"]=5
        with self.assertRaises(g.Invalid): result(c)
        raw=json.dumps(fresh()).encode(); exact=raw+b" "*(g.MAX_BYTES-len(raw))
        g.parse(exact)
        with self.assertRaises(g.Invalid): g.parse(exact+b" ")

    def test_traversal_bounds(self):
        for count in (255,256):
            c=generated([event(f"n{i}","synthetic_H",f"synthetic_n{i}") for i in range(count)])
            r=result(c)
            self.assertEqual(r["availability"]["status"],"available" if count==255 else "unavailable")
        for count in (1024,1025):
            r=result(generated([event(f"e{i}") for i in range(count)]))
            self.assertEqual(r["availability"]["status"],"available" if count==1024 else "unavailable")
        edges=[event(f"i{i}",f"synthetic_i{i}","synthetic_H") for i in range(50)]
        edges += [event(f"o{i}","synthetic_H",f"synthetic_o{i}",True) for i in range(97)]
        edges += [event(f"x{i}",f"synthetic_x{i}",f"synthetic_y{i}") for i in range(3)]
        self.assertEqual(result(generated(edges))["metrics"]["emitted_path_states"],5000)
        edges.append(event("extra","synthetic_extra","synthetic_last"))
        r=result(generated(edges))
        self.assertEqual(r["availability"],dict(status="unavailable",reason="budget_exceeded"))
        self.assertTrue(r["truncated"]); self.assertIsNone(r["metrics"])
        chain=[event(f"e{i}",f"synthetic_n{i}",f"synthetic_n{i+1}") for i in range(4)]
        for i,e in enumerate(chain): e["occurred_at"]=f"2026-01-01T11:0{i+1}:00.000Z"
        self.assertIn(["e0","e1","e2","e3"],ids(result(generated(chain))["metrics"]["paths"]))

    def test_forgery_and_malformed(self):
        for field in ("expected","observed","corpus_sha256","query_sha256","status","accepted"):
            for location in ("corpus","query","event"):
                c=fresh(); obj=c if location=="corpus" else c["queries"][0] if location=="query" else c["deliveries"][0]["event"]
                obj[field]="forged"
                with self.assertRaises(g.Invalid): result(c)
        for value in ("1.0","01.00","-1.00","1e2",1,True):
            c=fresh(); c["deliveries"][0]["event"]["amount"]=value
            with self.assertRaises(g.Invalid): result(c)
        for raw in (b"{}{}",b"{\"x\":1,\"x\":2}",b"NaN",b"\xff"):
            with self.assertRaises(g.Invalid): g.parse(raw)
        c=fresh(); c["queries"][0]["as_of"]="2026-02-30T12:00:00.000Z"
        with self.assertRaises(g.Invalid): result(c)
        c=fresh(); c["queries"][0]["coverage"]["complete"]=1
        with self.assertRaises(g.Invalid): result(c)
        class Exotic(dict): pass
        with self.assertRaises(g.Invalid): result(Exotic(fresh()))
        c=fresh(); c["cycle"]=c
        with self.assertRaises(g.Invalid): result(c)

    def test_cli_and_import(self):
        def run(raw,args=()):
            return subprocess.run([sys.executable,"-B",str(Path(g.__file__)),*args],input=raw,capture_output=True,timeout=10)
        p=run(json.dumps(fresh()).encode())
        self.assertEqual(p.returncode,0); self.assertEqual(p.stderr,b"")
        self.assertEqual(json.loads(p.stdout)["observations"],g.observe(fresh()))
        for raw,args in ((b"private credential",()),(b"{}{}",()),(b" "*(g.MAX_BYTES+1),()),(b"{}",("--expected",))):
            p=run(raw,args)
            self.assertEqual(p.returncode,2); self.assertEqual(p.stderr,b"")
            self.assertEqual(p.stdout,b"{\"error\":\"GRAPH_CONTRACT_INVALID\"}\n")
        p=subprocess.run([sys.executable,"-B","-c","import sys; sys.path.insert(0, sys.argv[1]); import lmps_ml.graph_benchmark",str(ROOT/"services/ml-inference")],capture_output=True,timeout=10)
        self.assertEqual((p.returncode,p.stdout,p.stderr),(0,b"",b""))

if __name__ == "__main__":
    unittest.main()
