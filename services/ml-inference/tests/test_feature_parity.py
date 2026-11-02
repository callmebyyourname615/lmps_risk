"""Unit adapter assertions; actual cross-runtime proof is the Node subprocess test."""
import unittest
from unittest.mock import patch
from lmps_ml.feature_parity import compare_selected
from lmps_ml.dataset import build_dataset


class ParityTests(unittest.TestCase):
    def query(self):
        return dict(window_seconds=3600, anchor_at='2026-01-01T12:00:00Z', currency='USD')

    def record(self, name='synthetic_a', amount='1.25', active=True):
        return dict(event_id=name, amount=amount, active=active, occurred_at='2026-01-01T12:00:00Z')

    def test_exact_and_reversal(self):
        r=compare_selected(dict(query=self.query(), records=[self.record(), self.record('synthetic_b','9.00',False)]))
        self.assertEqual((r['count'],r['amount'],r['status']),('1','1.25','available'))

    def test_valid_empty_zero(self):
        r=compare_selected(dict(query=self.query(), records=[]))
        self.assertEqual((r['count'],r['amount']),('0','0.00'))

    def test_unsupported_and_bound(self):
        for records in ([self.record(amount='0.00')], [self.record()]*257):
            with self.assertRaises(ValueError):
                compare_selected(dict(query=self.query(), records=records))
        with self.assertRaises(ValueError):
            compare_selected(dict(query={**self.query(),'window_seconds':60},records=[]))

    def test_exact_selected_bound(self):
        rows=[self.record('synthetic_r'+str(i)) for i in range(256)]
        result=compare_selected(dict(query=self.query(),records=rows))
        self.assertEqual((result['count'],result['amount']),('256','320.00'))

    def test_wrong_module_result_and_provenance_unit_only(self):
        def wrong_count(value):
            result=build_dataset(value)
            next(r for r in result['rows'] if r['row_id']=='probe')['values'][3]='999.000000000'
            return result

        def wrong_provenance(value):
            result=build_dataset(value)
            result['feature_spec_sha256']='0'*64
            return result

        for substitute in (wrong_count,wrong_provenance):
            with patch('lmps_ml.feature_parity.build_dataset',side_effect=substitute):
                with self.assertRaises(ValueError):
                    compare_selected(dict(query=self.query(),records=[self.record()]))


if __name__ == '__main__':
    unittest.main()
