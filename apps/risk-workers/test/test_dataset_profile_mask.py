"""Invented masked representations, exact rolling windows and private source replay."""

from pathlib import Path
from collections import Counter
import base64
import json
import socket
import unittest
from unittest.mock import patch

import test_dataset_profile_month as fixtures
import dataset_mask_screen as tool
import dataset_readiness as month
import export_transfer as export


class MaskScreenTests(unittest.TestCase):
    def setUp(self):
        self.fixture=fixtures.MonthProfileTests();self.fixture.setUp();self.addCleanup(self.fixture.doCleanups)
        self.root=self.fixture.root;self.key=bytes([7])*32
        self.profile=dict(version='bank_mask_snapshot_candidate_v1',currency='LAK',amount_unit='major',product_cap='200000000.00',
            time_zone='Asia/Vientiane',declared_offset_minutes=420,windows_seconds=[300,900,3600],histogram_significant_bits=8,
            identity_status='unverified',enforcement=False,canonical_assessment=False)

    def row(self,id,stamp='2026-10-01 01:00:00',amount='1.00',**changes):
        row={k:None for k in export.PILOT_COLUMNS}
        row.update(self.fixture.row(str(id),amount=amount,stamp=stamp),reference='PRIVATE_REF',originalreference=None,
                   frommember='SYN_A',tomember='SYN_B',fromaccount='PRIVATE_MASK_FROM',toaccount='PRIVATE_MASK_TO',
                   totype='SYN_TYPE',shouldrevert='0',isreconciled='0',issettled='0')
        row.update(changes);return row

    def request(self,rows):
        f=self.fixture.file(rows,columns=list(export.PILOT_COLUMNS),tsv=True)
        plan=self.fixture.plan([f]);prior=month.profile_plan(plan,str(self.root));prior['format']='lmps-month-readiness-1'
        return dict(profile=self.profile,key_b64=base64.b64encode(self.key).decode(),key_cases=[],time_cases=[],window_cases=[],
                    plan=plan,prior=prior,scratch=str(self.root))

    def test_grouping_preserves_namespace_exact_masks_and_no_real_identity(self):
        a=tool.endpoint(self.key,'SYN_A','MASK***1')
        self.assertEqual(a,tool.endpoint(self.key,'SYN_A','MASK***1'))
        self.assertNotEqual(a,tool.endpoint(self.key,'SYN_B','MASK***1'))
        self.assertNotEqual(a,tool.endpoint(self.key,'SYN_A','MASK***2'))
        self.assertFalse(tool.printable('\ufeff',200));self.assertTrue(tool.printable('\u0085',200))
        with self.assertRaises(ValueError):tool.endpoint(self.key,'SYN_A','MASK\nBAD')

    def test_bounded_histogram_intervals_and_exact_tail_counts(self):
        values=list(range(1,1001))+[2**60+37]*20
        h=tool.Histogram()
        for v in values:h.add(v,1)
        result=h.summary();cutoff=result['experimental_cutoff']
        self.assertEqual(result['candidate_anchors'],sum(v>=cutoff for v in values))
        self.assertEqual(result['candidate_endpoint_windows'],sum(v>=cutoff for v in values))
        for p,interval in result['quantile_intervals'].items():
            rank=(int(p[1:])*len(values)+99)//100
            self.assertLessEqual(interval['lower'],sorted(values)[rank-1]);self.assertGreaterEqual(interval['upper'],sorted(values)[rank-1])
        for v in [0,1,255,256,511,512,2**53+7,2**60+37]:
            low,high=tool.bounds(v);self.assertLessEqual(low,v);self.assertGreaterEqual(high,v)

    def test_window_boundary_ties_fan_in_out_match_naive_reference(self):
        base=tool.stamp('2026-10-01 00:00:00');a,b,c=[bytes([i])*32 for i in [1,2,3]]
        raw=[(300,a,b,5000),(301,a,c,200),(600,a,b,300),(600,c,b,400),(600,a,c,500),(601,a,b,2000)]
        events=[dict(ordinal=i,occurred_unix=base+t,sender=s.hex(),receiver=r.hex(),amount=month.money(v)) for i,(t,s,r,v) in enumerate(raw)]
        for role in ['sender','receiver']:
            records=sorted((s if role=='sender' else r)+(base+t).to_bytes(8,'big')+i.to_bytes(4,'big')+(r if role=='sender' else s)+v.to_bytes(8,'big') for i,(t,s,r,v) in enumerate(raw))
            actual={}
            def collect(group,t,w,metrics,batch):
                for _,_,ordinal in batch:actual[(ordinal,w)]=metrics
            budget=tool.Budget(self.root)
            tool.windows(iter(records),role,base,collect,budget)
            for ordinal,w in actual:
                expected=tool.reference(dict(events=events,anchor=ordinal,window_seconds=w,scope_start=base))['metrics']
                for name,value in actual[(ordinal,w)].items():
                    self.assertEqual(month.money(value) if name=='FRAUD_AMOUNT_VELOCITY' else str(value),expected[name])

    def test_full_stream_reconciles_candidates_union_withholding_and_trace(self):
        rows=[]
        # Low-count groups establish an exact p99=1; the exceptional group has 5 tied anchors.
        for i in range(1000):rows.append(self.row(i,fromaccount=f'PRIVATE_FROM_{i}',toaccount=f'PRIVATE_TO_{i}'))
        for i in range(5):rows.append(self.row(1000+i,fromaccount='PRIVATE_HIGH',toaccount=f'PRIVATE_PEER_{i}',amount='1000000.00'))
        rows += [self.row(2001,result='SYN_FAILED'),self.row(2002,shouldrevert='1'),self.row(2003,fromaccount=''),
                 self.row(2004,originalreference='PRIVATE_ORIGINAL'),self.row(2005,ccy='THB'),self.row(2006,amount='200000000.01'),
                 self.row(2007,result='PRIVATE\nBAD'),self.row(2008,stamp='2026-10-01 00:00:01')]
        request=self.request(rows)
        with patch.object(socket,'socket',side_effect=AssertionError('No network')),patch.object(tool.sorting,'RUN_ROWS',20):
            result=tool.run(request)
        report=result['report'];self.assertEqual(report['observed_rows'],len(rows))
        self.assertEqual(sum(report['cohort']['reasons'].values()),len(rows))
        self.assertEqual(report['cohort']['reasons']['included'],1006)
        self.assertEqual(report['cohort']['reasons']['invalid_row'],1)
        self.assertEqual(report['unique_candidate_source_row_anchors'],5)
        self.assertTrue(all(m['candidate_anchors']<=m['anchors'] for m in report['metrics']))
        self.assertEqual(len(report['metrics']),12)
        money_metrics=[m for m in report['metrics'] if m['pattern']=='FRAUD_AMOUNT_VELOCITY']
        self.assertTrue(all(m['maximum'] is None or isinstance(m['maximum'],str) for m in money_metrics))
        receipt=tool.verify_anchors(request['plan'],self.key,result['traces'])
        self.assertEqual(receipt['anchors'],len(result['traces']))
        for marker in ['PRIVATE_MASK','PRIVATE_FROM','PRIVATE_TO','PRIVATE_REF','PRIVATE_ORIGINAL',str(self.root)]:self.assertNotIn(marker,json.dumps(result))
        self.assertFalse(list(self.root.glob('.mask-screen-*')))
        self.assertTrue(all(t['identity_status']=='unverified' and t['real_account_claim'] is False for t in result['traces']))
        trace={**result['traces'][0],'observed_group':'0'*64}
        with self.assertRaises(ValueError):tool.verify_anchors(request['plan'],self.key,[trace])

    def test_resource_production_duplicate_and_source_mutation_refused(self):
        req=self.request([self.row(1)])
        for name,value in [('MAX_ROWS',0),('MAX_SCRATCH',1),('RESERVE',2**63),('MAX_SECONDS',-1),('MAX_ACTIVE',0),('MAX_BATCH',0),('MAX_BYTES',1)]:
            with patch.object(tool,name,value),self.subTest(name=name),self.assertRaises(Exception):tool.run(req)
        with patch.dict('os.environ',{'NODE_ENV':'production'}),self.assertRaises(Exception):tool.run(req)
        dup=self.request([self.row(2),self.row(2)])
        with self.assertRaises(ValueError):tool.run(dup)
        with Path(req['plan']['files'][0]['path']).open('ab') as out:out.write(b'CHANGED')
        with self.assertRaises(Exception):tool.run(req)
        self.assertFalse(list(self.root.glob('.mask-screen-*')))

    def test_empty_cohort_and_declared_month_warmup_are_not_safe_verdicts(self):
        empty=self.request([self.row(3000,ccy='THB'),self.row(3001,shouldrevert='1')])
        result=tool.run(empty)
        self.assertEqual(result['report']['cohort']['included'],0)
        self.assertTrue(all(m['anchors']==0 and m['experimental_cutoff'] is None for m in result['report']['metrics']))
        self.assertEqual(result['traces'],[])
        self.assertIsNone(result['report']['accuracy'])
        request=self.request([self.row(4000,stamp='2026-10-01 00:00:01'),self.row(4001,stamp='2026-10-01 00:05:00'),
                              self.row(4002,txtime='2026-09-30 23:59:59')])
        r=tool.run(request)['report']
        self.assertEqual(r['cohort']['reasons']['event_outside_declared_month'],1)
        self.assertEqual(r['role_summary']['sender']['warmup_anchors_withheld']['300'],1)
        self.assertEqual(r['role_summary']['sender']['warmup_anchors_withheld']['900'],2)
        self.assertEqual(next(m for m in r['metrics'] if m['pattern']=='FRAUD_COUNT_VELOCITY' and m['window_seconds']==300)['anchors'],1)


if __name__=='__main__':unittest.main()
