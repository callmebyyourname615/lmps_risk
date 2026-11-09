"""Private current-snapshot amount screening. No identity linkage or normalization."""

from collections import Counter
from hashlib import sha256
from pathlib import Path
import heapq
import json
import os
import shutil
import sys
import tempfile
import time

import dataset_readiness as month

VERSION = 'lmps-product-amount-backtest-1'
MAPPING = 'operator_intake_independent_status_refund_v3'
MAX_ROWS = 30_000_000
MAX_FILES = 4096
MAX_BYTES = 16 * 1024**3
MAX_SECONDS = 1800
RESERVE = 1024**3
PROFILE = dict(version='lak_product_amount_candidate_v1', currency='LAK', review='20000000.00',
               high='100000000.00', near_cap='180000000.00', cap='200000000.00',
               backtest_thresholds=['20000000.00', '50000000.00', '100000000.00', '180000000.00'],
               authority='user_declared_candidate', product_scope='unverified', amount_units='unverified', enforcement=False)
JS_TRIM = '\t\n\v\f\r \u00a0\u1680\u2000\u2001\u2002\u2003\u2004\u2005\u2006\u2007\u2008\u2009\u200a\u2028\u2029\u202f\u205f\u3000\ufeff'


def axes(result, flag, reference, original):
    success = 'succeeded' if result == 'OK' else 'not_successful' if result and result.strip(JS_TRIM) == result else 'unknown'
    refund = 'required' if flag == '1' else 'not_required' if flag == '0' else 'unknown'
    drs = ('not_indicated' if not original else 'unknown' if not reference else
           'same_reference_requires_review' if original == reference else 'prior_reference_candidate')
    return success, refund, drs


def declared(row):
    month.check(month.exact(row, 'result shouldrevert reference originalreference'))
    for value in row.values():
        month.check(value is None or isinstance(value, str) and len(value) <= 200
                    and not month.profile.CONTROL_CHARACTERS.search(value)
                    and not any(0xD800 <= ord(c) <= 0xDFFF for c in value))
    flag = row['shouldrevert']
    month.check(flag is None or month.valid_value('shouldrevert', flag))
    success, refund, drs = axes(row['result'], flag, row['reference'], row['originalreference'])
    return dict(mapping=MAPPING, reported_success=success, refund_instruction=refund,
                refund_completion='unverified', reversed_amount=None, net_executed_amount=None,
                drs_reference=drs, business_payment_identity='unverified', account_identity='unverified',
                source_semantics='unverified', authority='operator_declared_test_only',
                occurrence_field='txtime', request_received_field='requesttime',
                occurred_at=None, known_at=None, timezone='unverified')


def band(value, currency):
    return ('currency_out_of_scope' if currency != 'LAK' else 'nonpositive_withheld' if value <= 0
            else 'above_cap' if value > 20_000_000_000 else 'near_cap' if value >= 18_000_000_000
            else 'high' if value >= 10_000_000_000 else 'review' if value >= 2_000_000_000 else 'below_review')


def classify(row):
    month.check(month.exact(row, 'amount currency'))
    month.check(isinstance(row['amount'], str) and month.MONEY.fullmatch(row['amount']))
    month.check(isinstance(row['currency'], str) and month.re.fullmatch('[A-Z]{3}', row['currency']))
    return dict(profile_version=PROFILE['version'], band=band(month.cents(row['amount']), row['currency']),
                candidate_only=True, product_scope='unverified', amount_units='unverified',
                net_execution='unverified', enforcement=False)


def parity(request):
    month.check(request['profile'] == PROFILE and len(request['cases']) <= 1000)
    for case in request['cases']:
        month.check(declared(case['source']) == case['facts'])
        month.check(classify(case['amount']) == case['classification'])


def verify_traces(plan, traces):
    month.check(isinstance(traces, list) and len(traces) <= 1000)
    selected = {}
    for trace in traces:
        i, row = trace['source_file_ordinal_zero_based'], trace['source_data_row_ordinal_one_based']
        month.check(type(i) is int and 0 <= i < len(plan['files']) and type(row) is int and 1 <= row <= plan['files'][i]['expected_rows'])
        month.check(row not in selected.setdefault(i, {}))
        selected[i][row] = trace
    checked = 0
    for i, rows in selected.items():
        ev = {}
        f = plan['files'][i]
        for row_no, row in enumerate(month.source_rows(f, ev), 1):
            if row_no not in rows:
                continue
            trace = rows[row_no]
            month.check(row is not None and row['ccy'] == trace['currency_label'] == 'LAK')
            month.check(row['amount'] == trace['recorded_amount'] and row['txtime'] == trace['txtime_literal']
                        and row['requesttime'] == trace['requesttime_literal'])
            month.check(trace['source_file_sha256'] == f['sha256'])
            month.check(trace['trace_id'] == sha256(month.encoded([f['sha256'], row_no])).hexdigest())
            month.check(trace['source_key_sha256'] == sha256(month.encoded(['transfer', row['id'], row['requesttime']])).hexdigest())
            facts = declared({k: row[k] for k in ['result', 'shouldrevert', 'reference', 'originalreference']})
            for key in ['reported_success', 'refund_instruction', 'refund_completion', 'drs_reference', 'account_identity', 'net_executed_amount']:
                month.check(trace[key] == facts[key])
            month.check(band(month.cents(row['amount']), row['ccy']) == trace['band'])
            checked += 1
        month.check(ev['sha256'] == f['sha256'])
    month.check(checked == len(traces))
    return dict(status='passed', rows=checked, source_files=len(selected))


def run(request):
    month.pilot.mode()
    month.check(month.exact(request, 'profile cases check_only') or month.exact(request, 'profile cases plan prior scratch')
                or month.exact(request, 'profile cases plan traces'))
    parity(request)
    if request.get('check_only'):
        return {'parity': 'passed'}
    if 'traces' in request:
        return verify_traces(request['plan'], request['traces'])
    plan, prior = request['plan'], request['prior']
    month.validate_plan(plan, max_files=MAX_FILES, max_rows=MAX_ROWS)
    month.check({f['table'] for f in plan['files']} == {'transfer'})
    month.check(prior['format'] == 'lmps-month-readiness-1' and len(prior['tables']) == 1)
    month.check(prior['requested_month'] == plan['month'] and len(prior['input_files']) == len(plan['files']))
    table = prior['tables'][0]
    month.check(table['source_table'] == 'transfer')
    for key in ['duplicate_key_rows', 'conflicting_source_keys_withheld', 'invalid_key_rows', 'malformed_rows']:
        month.check(table[key] == 0)
    required = {'id', 'requesttime', 'txtime', 'amount', 'ccy', 'result', 'shouldrevert', 'reference', 'originalreference', 'fromaccount', 'toaccount'}
    month.check(required <= set(table['columns']))
    month.check(prior['observed_rows'] == sum(f['expected_rows'] for f in plan['files']))
    scratch = month.canonical_private(request['scratch'])
    os.close(month.profile.private_directory(scratch))
    invalid_fields = [k for k, v in table['fields'].items() if v['invalid_rows']]
    thresholds = {t: dict(all_recorded_gte=0, within_cap_gte=0, reported_success=Counter(),
                          refund_instruction=Counter(), success_refund_joint=Counter()) for t in PROFILE['backtest_thresholds']}
    threshold_cents = [(month.cents(t), data) for t, data in thresholds.items()]
    groups, all_success, all_refund, drs_groups = {}, Counter(), Counter(), Counter()
    observed = invalid = valid = outside = compressed = decoded = txtime_outside = 0
    account_empty = Counter()
    samples = {}
    started = time.monotonic()

    def guard():
        month.check(time.monotonic() - started <= MAX_SECONDS and shutil.disk_usage(scratch).free >= RESERVE)

    with tempfile.TemporaryDirectory(prefix='.amount-backtest-', dir=scratch) as temporary:
        guard()
        for i, f in enumerate(plan['files']):
            ev = {}
            for row_no, row in enumerate(month.source_rows(f, ev), 1):
                observed += 1
                month.check(observed <= MAX_ROWS and row is not None)
                if observed % 100000 == 0:
                    guard()
                if not all(month.valid_value(k, row[k]) for k in invalid_fields):
                    invalid += 1
                    continue
                if not row['requesttime'].startswith(plan['month'] + '-'):
                    outside += 1
                    continue
                valid += 1
                success, refund, drs = axes(row['result'], row['shouldrevert'], row['reference'], row['originalreference'])
                all_success[success] += 1
                all_refund[refund] += 1
                drs_groups[drs] += 1
                txtime_outside += not row['txtime'].startswith(plan['month'] + '-')
                for field in ['fromaccount', 'toaccount']:
                    account_empty[field] += row[field] == '' or row[field] is None
                value = month.cents(row['amount'])
                label = band(value, row['ccy'])
                group = groups.setdefault(label, dict(rows=0, recorded_amount_total_cents=0,
                    reported_success=Counter(), refund_instruction=Counter(), success_refund_joint=Counter(),
                    drs_reference=Counter(), days=Counter()))
                group['rows'] += 1
                # Currency-out-of-scope amounts are deliberately never summed together.
                if row['ccy'] == 'LAK':
                    group['recorded_amount_total_cents'] += value
                group['reported_success'][success] += 1
                group['refund_instruction'][refund] += 1
                group['success_refund_joint'][success + ':' + refund] += 1
                group['drs_reference'][drs] += 1
                group['days'][row['requesttime'][:10]] += 1
                if row['ccy'] != 'LAK' or value <= 0:
                    continue
                for limit, data in threshold_cents:
                    if value >= limit:
                        data['all_recorded_gte'] += 1
                        if label != 'above_cap':
                            data['within_cap_gte'] += 1
                            data['reported_success'][success] += 1
                            data['refund_instruction'][refund] += 1
                            data['success_refund_joint'][success + ':' + refund] += 1
                category = (label, success, refund, drs)
                heap = samples.setdefault(category, [])
                if len(heap) < 3 or value >= heap[0][0]:
                    trace_id = sha256(month.encoded([f['sha256'], row_no])).hexdigest()
                    trace = dict(trace_id=trace_id, source_file_ordinal_zero_based=i,
                        source_data_row_ordinal_one_based=row_no, source_file_sha256=f['sha256'],
                        source_key_sha256=sha256(month.encoded(['transfer', row['id'], row['requesttime']])).hexdigest(),
                        requesttime_literal=row['requesttime'], txtime_literal=row['txtime'], currency_label='LAK',
                        recorded_amount=row['amount'], band=label, reported_success=success,
                        refund_instruction=refund, refund_completion='unverified', drs_reference=drs,
                        account_identity='unverified', net_executed_amount=None, product_scope='unverified')
                    item = (value, trace_id, trace)
                    if len(heap) < 3:
                        heapq.heappush(heap, item)
                    elif item[:2] > heap[0][:2]:
                        heapq.heapreplace(heap, item)
            expected = prior['input_files'][i]
            month.check(ev['sha256'] == expected['sha256'] and ev['rows'] == expected['rows']
                        and ev['columns'] == expected['columns'] and ev['input_bytes'] == expected['input_bytes']
                        and ev['decoded_bytes'] == expected['decoded_bytes'])
            compressed += ev['input_bytes']
            decoded += ev['decoded_bytes']
            month.check(max(compressed, decoded) <= MAX_BYTES)
            progress = Path(temporary) / 'progress.json'
            if not progress.exists():
                month.pilot.write_private(progress, b'')
            progress.write_bytes(month.encoded(dict(files=i + 1, rows=observed, phase='amount_backtest')))
        month.check(observed == prior['observed_rows'] and valid == table['profiled_month_observations'])
        month.check(observed == valid + outside + invalid)
        month.check(invalid == table['invalid_rows'] and outside == table['outside_requested_month'])
        month.check(compressed == prior['input_bytes'] and decoded == prior['decoded_bytes'])
        month.check(sum(g['rows'] for g in groups.values()) == valid)
        for label, g in groups.items():
            month.check(all(sum(g[k].values()) == g['rows'] for k in ['reported_success', 'refund_instruction', 'success_refund_joint', 'drs_reference', 'days']))
            amount = g.pop('recorded_amount_total_cents')
            g['recorded_amount_total'] = None if label == 'currency_out_of_scope' else month.money(amount)
        previous = valid
        for data in thresholds.values():
            month.check(data['within_cap_gte'] <= previous and data['within_cap_gte'] <= data['all_recorded_gte'])
            month.check(sum(data['reported_success'].values()) == sum(data['refund_instruction'].values()) == sum(data['success_refund_joint'].values()) == data['within_cap_gte'])
            previous = data['within_cap_gte']
        guard()
        report = dict(format=VERSION, requested_request_month=plan['month'], source_table='transfer',
            scope='current_snapshot_source_observations_not_point_in_time_business_payments',
            source_profile_reuse='exact_input_uniqueness_and_field_validation_evidence_not_independent_attestation',
            mapping=MAPPING, profile=PROFILE, observed_rows=observed, invalid_rows_withheld=invalid,
            outside_request_month_withheld=outside, valid_month_rows=valid, bands=groups, thresholds=thresholds,
            reported_success=dict(all_success), refund_instruction=dict(all_refund), drs_reference=dict(drs_groups),
            empty_account_fields=dict(account_empty), txtime_outside_request_month=txtime_outside,
            occurrence_field='txtime', request_received_field='requesttime', timezone='unverified',
            known_at='unverified', correction_history='unverified', product_scope='unverified', amount_units='unverified',
            account_identity='unverified', net_execution='unverified', business_payment_identity='unverified',
            production_ready=False, assessment_performed=False, enforcement=False, accuracy=None,
            trace_limit_per_band_success_refund_drs_group=3,
            input_bytes=compressed, decoded_bytes=decoded,
            limits=dict(files=MAX_FILES, rows=MAX_ROWS, total_bytes=MAX_BYTES, seconds=MAX_SECONDS, reserve_bytes=RESERVE))
        traces = [item[2] for key in sorted(samples) for item in sorted(samples[key], reverse=True)]
        month.check(len(month.encoded(report)) <= 2*1024**2 and len(month.encoded(traces)) <= 2*1024**2)
        return dict(report=report, traces=traces)


if __name__ == '__main__':
    try:
        raw = sys.stdin.buffer.read(4*1024**2 + 1)
        month.check(len(raw) <= 4*1024**2 and len(sys.argv) == 1)
        request = json.loads(raw, object_pairs_hook=month.export.unique_object)
        print(month.encoded(run(request)).decode())
    except Exception:
        print('AMOUNT_BACKTEST_FAILED; private diagnostics withheld.', file=sys.stderr)
        raise SystemExit(1)
