"""Invented fixtures only; exercise the port without network or export effects."""
from copy import deepcopy
import builtins
import socket
import subprocess
import unittest
from unittest.mock import patch

from lmps_ml.vendor_evaluation import (
    DIMENSIONS, MAX_BYTES, MAX_EVALUATIONS, EvaluationError,
    InMemoryEvaluationFake, detached, validate_request, validate_result,
)


def request():
    return {'version': 1, 'provenance': 'local_synthetic',
            'evaluation_id': 'synthetic_evaluation', 'cohort_sha256': 'a' * 64,
            'split': 'test', 'as_of': '2026-10-25T00:00:00Z',
            'provider': 'synthetic_provider', 'provider_version': 'synthetic_v1',
            'kind': 'graph', 'lineage_sha256': 'b' * 64,
            'dimensions': list(DIMENSIONS), 'timeout_ms': 60000, 'max_attempts': 3}


def cost():
    return {'source': 'supplied_synthetic', 'amount_minor': 123,
            'currency': 'USD', 'evidence_sha256': 'c' * 64}


class VendorEvaluationTests(unittest.TestCase):
    def test_malformed_unicode_is_rejected_with_redacted_diagnostic(self):
        for malformed in ('private-sentinel\ud800', 'private-sentinel\udfff'):
            req = request()
            req['provider'] = malformed
            with self.assertRaises(EvaluationError) as caught:
                validate_request(req)
            self.assertEqual(str(caught.exception), 'VENDOR_INVALID')
            self.assertIsNone(caught.exception.__cause__)

    def test_config_and_result_boundaries(self):
        for outcomes in ((), ['available'] * 4, ['unknown'], ['available', True]):
            with self.assertRaises(EvaluationError):
                InMemoryEvaluationFake(outcomes)
        outcomes = ['timeout', 'available']
        fake = InMemoryEvaluationFake(outcomes)
        outcomes[0] = 'available'
        with self.assertRaisesRegex(EvaluationError, '^VENDOR_TIMEOUT$'):
            fake.evaluate(request())
        result = fake.evaluate(request())
        validated = validate_result(request(), result)
        result['dimensions']['aml']['coverage'] = 1
        self.assertIsNone(validated['dimensions']['aml']['coverage'])

    def test_all_supplied_costs_validated_before_any_evaluation(self):
        for supplied in ({'unknown': cost()}, {'fraud': {}},
                         {'aml': {**cost(), 'credential': 'private-sentinel'}},
                         {'aml': {**cost(), 'amount_minor': '123'}}):
            with self.subTest(supplied=supplied):
                with self.assertRaises(EvaluationError) as caught:
                    InMemoryEvaluationFake(costs=supplied)
                self.assertEqual(str(caught.exception), 'VENDOR_INVALID')
                self.assertNotIn('private-sentinel', repr(caught.exception))

    def test_failures_do_not_publish_or_reset_retry_budget(self):
        for outcome in ('unavailable', 'stale', 'as_of_mismatch', 'lineage_conflict'):
            fake = InMemoryEvaluationFake((outcome, 'available'))
            with self.assertRaises(EvaluationError):
                fake.evaluate(request())
            self.assertEqual(fake.evaluate(request()), fake.evaluate(request()))
            limited = request()
            limited['max_attempts'] = 1
            fake = InMemoryEvaluationFake((outcome, 'available'))
            with self.assertRaises(EvaluationError):
                fake.evaluate(limited)
            with self.assertRaisesRegex(EvaluationError, '^VENDOR_RETRY_EXHAUSTED$'):
                fake.evaluate(limited)

    def test_missing_result_and_nested_fields_rejected(self):
        req = request()
        result = InMemoryEvaluationFake(costs={'fraud': cost()}).evaluate(req)
        for path in ((), ('dimensions', 'fraud'), ('dimensions', 'fraud', 'cost')):
            node = result
            for name in path:
                node = node[name]
            for key in node:
                changed = deepcopy(result)
                target = changed
                for name in path:
                    target = target[name]
                del target[key]
                with self.assertRaises(EvaluationError):
                    validate_result(req, changed)

    def test_binding_and_separate_unknown_evidence(self):
        source = {'fraud': cost()}
        fake = InMemoryEvaluationFake(costs=source)
        source['fraud']['amount_minor'] = 999
        req = request()
        result = fake.evaluate(req)
        self.assertEqual(validate_result(req, result), result)
        self.assertEqual(result['dimensions']['fraud']['cost'], cost())
        for dimension in DIMENSIONS:
            self.assertIsNone(result['dimensions'][dimension]['accuracy'])
            self.assertIsNone(result['dimensions'][dimension]['coverage'])
        self.assertIsNone(result['dimensions']['aml']['cost'])
        result['dimensions']['fraud']['cost']['amount_minor'] = 0
        self.assertEqual(fake.evaluate(req)['dimensions']['fraud']['cost'], cost())
        validated = validate_request(req)
        req['dimensions'].clear()
        self.assertEqual(validated['dimensions'], list(DIMENSIONS))

    def test_failures_and_redaction(self):
        for outcome, code in [('timeout', 'TIMEOUT'), ('unavailable', 'UNAVAILABLE'),
                              ('stale', 'STALE'), ('as_of_mismatch', 'AS_OF_MISMATCH'),
                              ('lineage_conflict', 'LINEAGE_CONFLICT')]:
            with self.subTest(outcome=outcome):
                with self.assertRaisesRegex(EvaluationError, '^VENDOR_' + code + '$'):
                    InMemoryEvaluationFake((outcome,)).evaluate(request())
        for key in request():
            invalid = request()
            invalid[key] = 'private-sentinel-do-not-echo'
            with self.assertRaises(EvaluationError) as caught:
                validate_request(invalid)
            self.assertEqual(str(caught.exception), 'VENDOR_INVALID')

    def test_deterministic_retry_budget_and_binding(self):
        first, second = (InMemoryEvaluationFake(('timeout', 'available')) for _ in range(2))
        for fake in (first, second):
            with self.assertRaisesRegex(EvaluationError, 'VENDOR_TIMEOUT'):
                fake.evaluate(request())
        self.assertEqual(first.evaluate(request()), second.evaluate(request()))
        for key, changed in [('cohort_sha256', 'd' * 64), ('provider', 'synthetic_other'),
                             ('provider_version', 'synthetic_v2'), ('split', 'train'),
                             ('as_of', '2026-10-24T00:00:00Z'), ('kind', 'vendor'),
                             ('lineage_sha256', 'd' * 64), ('dimensions', ['aml']),
                             ('timeout_ms', 1), ('max_attempts', 2)]:
            req = request()
            req[key] = changed
            with self.assertRaises(EvaluationError):
                first.evaluate(req)
        fake = InMemoryEvaluationFake(('timeout',))
        for _ in range(3):
            with self.assertRaisesRegex(EvaluationError, '^VENDOR_TIMEOUT$'):
                fake.evaluate(request())
        with self.assertRaisesRegex(EvaluationError, 'VENDOR_RETRY_EXHAUSTED'):
            fake.evaluate(request())
        req = request()
        req['provider'] = 'synthetic_other'
        with self.assertRaisesRegex(EvaluationError, 'VENDOR_BINDING_CONFLICT'):
            fake.evaluate(req)

    def test_strict_requests(self):
        mutations = [('extra', 'private-sentinel'), ('version', True), ('version', '1'),
                     ('provenance', 'real'), ('split', 'calibration'),
                     ('evaluation_id', 'synthetic_' + 'a' * 55),
                     ('provider', 'https://example.invalid'), ('provider_version', ''),
                     ('cohort_sha256', 'A' * 64), ('lineage_sha256', ''),
                     ('as_of', '2026-02-30T00:00:00Z'), ('as_of', '2026-10-25'),
                     ('dimensions', []), ('dimensions', ['aml', 'aml']),
                     ('dimensions', ['aml'] * 4), ('dimensions', ['unknown']),
                     ('timeout_ms', 60001), ('timeout_ms', 0), ('timeout_ms', True),
                     ('max_attempts', 4), ('max_attempts', 0), ('kind', 'gnn')]
        for key, value in mutations:
            with self.subTest(key=key, value=value):
                req = request()
                req[key] = value
                with self.assertRaises(EvaluationError):
                    validate_request(req)
        for key in request():
            req = request()
            del req[key]
            with self.assertRaises(EvaluationError):
                validate_request(req)
        req = request()
        req.update(evaluation_id='synthetic_' + 'a' * 54, timeout_ms=1, max_attempts=1)
        self.assertEqual(validate_request(req), req)

    def test_strict_results_and_supplied_cost(self):
        req = request()
        result = InMemoryEvaluationFake(costs={'fraud': cost()}).evaluate(req)
        for key, value in [('extra', 'private'), ('request_sha256', 'd' * 64),
                           ('availability', 'unknown'), ('dimensions', {}),
                           ('as_of', '2026-10-24T00:00:00Z'), ('lineage_sha256', 'd' * 64)]:
            changed = deepcopy(result)
            changed[key] = value
            with self.assertRaises(EvaluationError):
                validate_result(req, changed)
        for key, value in [('accuracy', 0.99), ('coverage', 1), ('extra', 'private')]:
            changed = deepcopy(result)
            changed['dimensions']['fraud'][key] = value
            with self.assertRaises(EvaluationError):
                validate_result(req, changed)
        for key, value in [('amount_minor', True), ('amount_minor', -1),
                           ('amount_minor', 10**12 + 1), ('amount_minor', 1.25),
                           ('currency', 'usd'), ('source', 'estimated'),
                           ('evidence_sha256', ''), ('extra', 'private')]:
            changed = deepcopy(result)
            changed['dimensions']['fraud']['cost'][key] = value
            with self.assertRaises(EvaluationError):
                validate_result(req, changed)
        for amount in (0, 10**12):
            supplied = cost()
            supplied['amount_minor'] = amount
            self.assertEqual(InMemoryEvaluationFake(costs={'aml': supplied}).evaluate(req)['dimensions']['aml']['cost'], supplied)

    def test_local_limits_and_no_silent_truncation(self):
        self.assertEqual(detached('a' * (MAX_BYTES - 2)), 'a' * (MAX_BYTES - 2))
        for value in ('a' * (MAX_BYTES - 1), 'a' * (MAX_BYTES + 1), float('nan'),
                      {'x': object()}, ['x'] * 4):
            with self.assertRaises(EvaluationError):
                detached(value)
        fake = InMemoryEvaluationFake()
        for index in range(MAX_EVALUATIONS):
            req = request()
            req['evaluation_id'] = 'synthetic_' + str(index)
            fake.evaluate(req)
        self.assertEqual(fake.evaluate(req), fake.evaluate(req))
        req['evaluation_id'] = 'synthetic_over'
        with self.assertRaisesRegex(EvaluationError, 'VENDOR_CAPACITY'):
            fake.evaluate(req)

    def test_no_network_file_export_subprocess_or_logging(self):
        def forbidden(*args, **kwargs):
            self.fail('unexpected external effect')
        with patch.object(socket, 'socket', forbidden), \
             patch.object(socket, 'create_connection', forbidden), \
             patch.object(builtins, 'open', forbidden), \
             patch.object(builtins, 'print', forbidden), \
             patch.object(subprocess, 'Popen', forbidden):
            for outcome in ('available', 'timeout', 'unavailable', 'stale', 'as_of_mismatch', 'lineage_conflict'):
                fake = InMemoryEvaluationFake((outcome,))
                if outcome == 'available':
                    fake.evaluate(request())
                else:
                    with self.assertRaises(EvaluationError):
                        fake.evaluate(request())


if __name__ == '__main__':
    unittest.main()
