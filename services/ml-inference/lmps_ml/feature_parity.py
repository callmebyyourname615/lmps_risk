"""Selected synthetic cohort only; never attests historical completeness.

Intersection: positive executed count and exact net cents, one currency, 1h,
at most 256 selected records per query (2000 input records / 8 queries).
The unchanged Python dataset window is [decision-1h,decision); the TS stream
window is (target-1h,target]. US1101 selects the cohort first. A synthetic
Python probe at anchor+1 second includes the selected closed upper boundary.
Inactive records map to full reversal. Active zero, other windows, transforms,
novelty, graph and model features are unsupported parity semantics.
Amounts are already the declared net value; partial reversal gross/reversed
breakdowns are absent from US1101 and cannot be reconstructed or attested.
Projection timestamps/identities are diagnostic only, not availability evidence.
"""
import json
import sys
from datetime import timedelta
from .dataset import Event, build_dataset, net, stamp, FEATURE_SHA, VERSION
from .private import encoded

LIMIT = 2097152


def compare_selected(value):
    if set(value) != {'query', 'records'} or len(value['records']) > 256 or len(encoded(value)) > LIMIT:
        raise ValueError('PARITY_LIMIT')
    q, records = value['query'], value['records']
    if q['window_seconds'] != 3600:
        raise ValueError('PARITY_UNSUPPORTED')
    if any(r['active'] and r['amount'] == '0.00' for r in records):
        raise ValueError('PARITY_UNSUPPORTED')
    decision = (stamp(q['anchor_at']) + timedelta(seconds=1)).isoformat().replace('+00:00', 'Z')
    labels = {task: dict(outcome=None, review_status='unreviewed', source_status='synthetic_declared',
        mature_at=None, available_at=None, reviewed_at=None, reviewer_ref=None, evidence_sha256=None)
        for task in ('fraud', 'mule_network', 'aml')}

    def event(r, probe=False):
        return Event.model_validate(dict(row_id='probe' if probe else r['event_id'],
            target=dict(namespace='synthetic_parity', transaction_id='probe' if probe else r['event_id'], revision_number=1),
            revision_sha256='0'*64, as_of=decision, occurred_at=decision if probe else r['occurred_at'],
            available_at=decision, sender='synthetic_sender', receiver='synthetic_receiver', currency=q['currency'],
            amount='1.00' if probe else r['amount'], reversed_amount='0.00' if probe or r['active'] else r['amount'],
            status='succeeded' if probe or r['active'] else 'reversed', labels=labels))

    rows = [event(r) for r in records]
    probe = event({}, True)
    report = build_dataset(dict(format=1, version='ml_dataset_parity', execution_mode='offline_analysis',
        provenance='local_synthetic', source_semantics='synthetic_declared', identity_status='synthetic_declared',
        source_sha256='0'*64, coverage_start=(stamp(decision)-timedelta(hours=1)).isoformat().replace('+00:00','Z'),
        history_complete=True, label_sampling='synthetic_population', train_end='2000-01-01T00:00:00Z',
        calibration_end='2001-01-01T00:00:00Z', test_end='2002-01-01T00:00:00Z', evaluation_at='9998-01-01T00:00:00Z',
        embargo_seconds=3600, rows=[r.model_dump() for r in rows+[probe]]))
    if len(encoded(report)) > LIMIT:
        raise ValueError('PARITY_LIMIT')
    if (report.get('format') != 'lmps-feature-dataset-1' or report.get('feature_version') != VERSION
            or report.get('feature_spec_sha256') != FEATURE_SHA):
        raise ValueError('PARITY_DATASET_PROVENANCE')
    actual = next(r for r in report['rows'] if r['row_id']=='probe')
    if actual['status'] != 'available' or not actual['values'][3].endswith('.000000000'):
        raise ValueError('PARITY_DATASET_UNAVAILABLE')
    total = sum(net(r) for r in rows)
    if actual['values'][3].split('.')[0] != str(sum(net(r)>0 for r in rows)):
        raise ValueError('PARITY_DATASET_COUNT')
    return dict(count=actual['values'][3].split('.')[0], amount=f'{total//100}.{total%100:02d}',
                status='available', module='lmps_ml.dataset.build_dataset+net')


def main():
    if len(sys.argv) != 1:
        raise ValueError('PARITY_ARGS')
    raw = sys.stdin.buffer.read(LIMIT+1)
    if len(raw)>LIMIT:
        raise ValueError('PARITY_LIMIT')
    sys.stdout.write(json.dumps(compare_selected(json.loads(raw)), sort_keys=True, separators=(',', ':')))


if __name__ == '__main__':
    main()
