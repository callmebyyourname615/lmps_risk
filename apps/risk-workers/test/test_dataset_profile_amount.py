"""Synthetic source snapshots only; bounded full-file trace replay and exact cents."""

import json
from pathlib import Path
import socket
import unittest
from unittest.mock import patch

import test_dataset_profile_month as fixtures
import dataset_amount_backtest as tool
import dataset_readiness as month
import export_transfer as export


class AmountBacktestTests(unittest.TestCase):
    def setUp(self):
        self.fixture = fixtures.MonthProfileTests()
        self.fixture.setUp()
        self.addCleanup(self.fixture.doCleanups)
        self.root = self.fixture.root

    def row(self, id='1', amount='20000000.00', **changes):
        row = {k: None for k in export.PILOT_COLUMNS}
        row.update(self.fixture.row(id=id, amount=amount), reference='PRIVATE_NEW', originalreference='PRIVATE_OLD',
                   frommember='PRIVATE_MEMBER', tomember='PRIVATE_OTHER', fromaccount='MASK_PRIVATE', toaccount='MASK_OTHER',
                   totype='PRIVATE_TYPE', isreconciled='0', issettled='0', shouldrevert='1')
        row.update(changes)
        return row

    def request(self, rows):
        f = self.fixture.file(rows, columns=list(export.PILOT_COLUMNS), tsv=True)
        plan = self.fixture.plan([f])
        prior = month.profile_plan(plan, str(self.root))
        prior['format'] = 'lmps-month-readiness-1'
        return dict(profile=tool.PROFILE, cases=[], plan=plan, prior=prior, scratch=str(self.root))

    def run_tool(self, request):
        with patch.object(socket, 'socket', side_effect=AssertionError('No network')):
            return tool.run(request)

    def test_bands_status_refunds_drs_cap_and_overlap_reconcile(self):
        rows = [self.row('1', '19999999.99', shouldrevert='0', originalreference=None),
                self.row('2', '20000000.00'), self.row('3', '50000000.00', result='ERROR'),
                self.row('4', '100000000.00', result=None), self.row('5', '180000000.00'),
                self.row('6', '200000000.00'), self.row('7', '200000000.01'),
                self.row('8', '9999999999999999999999.99'), self.row('9', '300000000.00', ccy='THB'),
                self.row('10', '0.00'), self.row('11', '-0.01'), self.row('12', result='PRIVATE\nBAD')]
        request = self.request(rows)
        result = self.run_tool(request);r = result['report']
        self.assertEqual(r['observed_rows'], 12)
        self.assertEqual(r['valid_month_rows'], 11)
        self.assertEqual(r['invalid_rows_withheld'], 1)
        self.assertEqual({k:v['rows'] for k,v in r['bands'].items()}, dict(below_review=1, review=2, high=1, near_cap=2, above_cap=2, currency_out_of_scope=1, nonpositive_withheld=2))
        self.assertEqual(r['bands']['near_cap']['success_refund_joint']['succeeded:required'], 2)
        for limit, expected in [('20000000.00', 5), ('50000000.00', 4), ('100000000.00', 3), ('180000000.00', 2)]:
            self.assertEqual(r['thresholds'][limit]['within_cap_gte'], expected)
            self.assertEqual(r['thresholds'][limit]['all_recorded_gte'], expected + 2)
        self.assertIsNone(r['bands']['currency_out_of_scope']['recorded_amount_total'])
        self.assertEqual(r['reported_success']['unknown'], 1)
        replay = tool.verify_traces(request['plan'], result['traces'])
        self.assertEqual(replay['rows'], len(result['traces']))
        for text in ['PRIVATE_NEW', 'PRIVATE_OLD', 'MASK_PRIVATE', 'MASK_OTHER', str(self.root), 'PRIVATE_MEMBER', 'PRIVATE_TYPE']:
            self.assertNotIn(text, json.dumps(result))
        self.assertTrue(all(t['net_executed_amount'] is None for t in result['traces']))
        self.assertFalse(list(self.root.glob('.amount-backtest-*')))
        self.assertEqual(result, self.run_tool(request))

    def test_duplicate_conflicting_mixed_table_and_missing_projection_are_refused(self):
        for rows in [[self.row(), self.row()], [self.row(), self.row(amount='1.00')]]:
            with self.assertRaises(ValueError): self.run_tool(self.request(rows))
        request = self.request([self.row()])
        request['prior']['tables'][0]['columns'].remove('fromaccount')
        with self.assertRaises(ValueError): self.run_tool(request)

    def test_mutation_limits_production_and_trace_tamper_fail_closed(self):
        request = self.request([self.row()])
        result = self.run_tool(request)
        trace = result['traces'][0]
        for key, value in [('recorded_amount','1.00'),('reported_success','unknown'),('source_data_row_ordinal_one_based',2),('source_file_sha256','a'*64)]:
            changed = {**trace, key:value}
            with self.subTest(key=key), self.assertRaises(ValueError): tool.verify_traces(request['plan'], [changed])
        for name, value in [('MAX_ROWS',0),('MAX_FILES',0),('MAX_SECONDS',-1),('MAX_BYTES',1),('RESERVE',2**63)]:
            with patch.object(tool,name,value), self.subTest(name=name), self.assertRaises(ValueError): self.run_tool(request)
        with patch.dict('os.environ',{'NODE_ENV':'production'}), self.assertRaises(Exception):self.run_tool(request)
        f = Path(request['plan']['files'][0]['path'])
        with f.open('ab') as out: out.write(b'CHANGED')
        with self.assertRaises(Exception): self.run_tool(request)
        self.assertFalse(list(self.root.glob('.amount-backtest-*')))

    def test_declarations_keep_unknowns_and_validate_profile_parity(self):
        row = dict(result='OK',shouldrevert='1',reference='NEW',originalreference='OLD')
        facts = tool.declared(row)
        self.assertEqual(facts['reported_success'],'succeeded')
        self.assertEqual(facts['refund_instruction'],'required')
        self.assertIsNone(facts['net_executed_amount'])
        self.assertEqual(tool.axes(None,'1','X','X'),('unknown','required','same_reference_requires_review'))
        self.assertEqual(tool.axes('\ufeffOK','0','X',None)[0],'unknown')
        self.assertEqual(tool.axes('\u0085X','0','X',None)[0],'not_successful')
        for change in [dict(shouldrevert=1),dict(shouldrevert='01'),dict(result='PRIVATE\nBAD'),dict(extra='X')]:
            with self.assertRaises(ValueError):tool.declared({**row,**change})
        request=self.request([self.row()]);request['profile']={**tool.PROFILE,'cap':'1.00'}
        with self.assertRaises(ValueError):self.run_tool(request)


if __name__ == '__main__':unittest.main()
