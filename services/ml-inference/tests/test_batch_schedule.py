"""Invented fixtures only; no network, daemon, training or service listener."""
import fcntl
import os
import subprocess
import sys

import pytest

from lmps_ml import batch_schedule as batch
from lmps_ml.private import digest, encoded, read_json, write
from ml_fixtures import synthetic_input


def plan():
    return {'version': 1, 'namespace': 'synthetic_batch', 'input': synthetic_input(90),
            'policy': {'version': 1, 'max_attempts': 2},
            'tasks': [{'id': 'summary', 'action': 'summary', 'dependencies': ['dataset']},
                      {'id': 'dataset', 'action': 'dataset', 'dependencies': []}]}


def test_dependency_order_exact_ack_and_verified_resume(tmp_path, monkeypatch):
    request = plan()
    root = tmp_path / 'run'
    assert [t['id'] for t in batch.validate_plan(request)['tasks']] == ['dataset', 'summary']
    assert batch.run_plan(request, root, stop_after=1)['status'] == 'interrupted'
    first = read_json(root / 'checkpoint.json')['tasks']['dataset']
    monkeypatch.setitem(batch._ACTIONS, 'dataset', lambda *_: pytest.fail('finished task reran'))
    assert batch.run_plan(request, root)['status'] == 'complete'
    assert read_json(root / 'checkpoint.json')['tasks']['dataset'] == first
    before = (root / 'checkpoint.json').read_bytes()
    result = batch.run_plan(request, root)
    assert result['status'] == 'complete'
    assert before == (root / 'checkpoint.json').read_bytes()
    assert batch.run_plan(request, root, retry_ack=result['checkpoint_sha256']) == result
    with pytest.raises(ValueError):
        batch.run_plan(request, root, retry_ack='0' * 64)
    artifact = read_json(root / 'dataset/artifact.json')
    assert first['artifact_sha256'] == digest(artifact)
    (root / 'dataset/artifact.json').write_bytes(encoded({'version': 1}))
    with pytest.raises(ValueError):
        batch.run_plan(request, root)


@pytest.mark.parametrize('change', ['cycle', 'unknown', 'duplicate', 'command', 'extra', 'coerce', 'real', 'too_many', 'budget'])
def test_strict_plan_rejections(change):
    request = plan()
    if change == 'cycle': request['tasks'][1]['dependencies'] = ['summary']
    if change == 'unknown': request['tasks'][1]['dependencies'] = ['absent']
    if change == 'duplicate': request['tasks'][1]['id'] = 'summary'
    if change == 'command': request['tasks'][0]['action'] = 'sh'
    if change == 'extra': request['command'] = 'echo unsafe'
    if change == 'coerce': request['policy']['max_attempts'] = True
    if change == 'real': request['input']['provenance'] = 'user_supplied_file'
    if change == 'too_many': request['tasks'] *= 9
    if change == 'budget': request['policy']['max_attempts'] = 4
    with pytest.raises(ValueError): batch.validate_plan(request)


@pytest.mark.parametrize('field', ['input', 'policy', 'task', 'namespace'])
def test_changed_bindings_conflict(tmp_path, field):
    request = plan()
    root = tmp_path / 'run'
    batch.run_plan(request, root, stop_after=1)
    before = (root / 'checkpoint.json').read_bytes()
    if field == 'input': request['input']['version'] += '_changed'
    if field == 'policy': request['policy']['max_attempts'] = 3
    if field == 'task': request['tasks'][0]['dependencies'] = []
    if field == 'namespace': request['namespace'] = 'synthetic_other'
    with pytest.raises(ValueError): batch.run_plan(request, root)
    assert (root / 'checkpoint.json').read_bytes() == before


@pytest.mark.parametrize('status', ['failed', 'blocked'])
def test_stop_exact_retry_and_finite_budget(tmp_path, monkeypatch, status):
    root = tmp_path / 'run'
    calls = []
    def action(*_):
        calls.append(1)
        if status == 'failed': raise RuntimeError('private diagnostics')
        return {'status': 'blocked'}
    monkeypatch.setitem(batch._ACTIONS, 'dataset', action)
    first = batch.run_plan(plan(), root)
    assert first['status'] == status and len(calls) == 1
    assert not (root / 'summary').exists()
    for ack in (None, '0' * 64):
        with pytest.raises(ValueError): batch.run_plan(plan(), root, retry_ack=ack)
    second = batch.run_plan(plan(), root, retry_ack=first['checkpoint_sha256'])
    assert second['status'] == status and len(calls) == 2
    with pytest.raises(ValueError): batch.run_plan(plan(), root, retry_ack=first['checkpoint_sha256'])
    with pytest.raises(ValueError): batch.run_plan(plan(), root, retry_ack=second['checkpoint_sha256'])
    assert len(calls) == 2


def test_concurrent_process_writer_rejected(tmp_path):
    root = tmp_path / 'run'
    root.mkdir(mode=0o700)
    write(root / 'writer.lock', b'local-batch-v1')
    request = tmp_path / 'plan.json'
    write(request, encoded(plan()))
    fd = os.open(root / 'writer.lock', os.O_RDWR)
    try:
        fcntl.flock(fd, fcntl.LOCK_EX | fcntl.LOCK_NB)
        result = subprocess.run([sys.executable, '-m', 'lmps_ml.pipeline', 'batch-plan',
                                 '--plan', str(request), '--output', str(root)], capture_output=True, text=True, timeout=120)
        assert result.returncode == 1
        assert 'private diagnostics withheld' in result.stderr
        assert not (root / 'checkpoint.json').exists()
    finally:
        os.close(fd)
    result = subprocess.run([sys.executable, '-m', 'lmps_ml.pipeline', 'batch-plan',
                             '--plan', str(request), '--output', str(root)], capture_output=True, text=True, timeout=120)
    assert result.returncode == 0, result.stderr
    assert 'complete' in result.stdout


def test_crash_after_publication_and_before_checkpoint(tmp_path, monkeypatch):
    root = tmp_path / 'run'
    request = plan()
    request['policy']['max_attempts'] = 1
    original = batch._checkpoint
    def interrupt(path, state):
        if state['tasks']['dataset']['status'] == 'complete': raise KeyboardInterrupt()
        original(path, state)
    with monkeypatch.context() as patch:
        patch.setattr(batch, '_checkpoint', interrupt)
        with pytest.raises(KeyboardInterrupt): batch.run_plan(request, root)
    assert read_json(root / 'checkpoint.json')['tasks']['dataset']['status'] == 'publishing'
    assert (root / 'dataset/artifact.json').exists()
    monkeypatch.setitem(batch._ACTIONS, 'dataset', lambda *_: pytest.fail('published task reran'))
    assert batch.run_plan(request, root)['status'] == 'complete'
    assert read_json(root / 'checkpoint.json')['tasks']['dataset']['attempts'] == 1


def test_interrupted_publication_rejects_changed_artifact(tmp_path, monkeypatch):
    root = tmp_path / 'run'
    original = batch._checkpoint
    def interrupt(path, state):
        if state['tasks']['dataset']['status'] == 'complete': raise KeyboardInterrupt()
        original(path, state)
    with monkeypatch.context() as patch:
        patch.setattr(batch, '_checkpoint', interrupt)
        with pytest.raises(KeyboardInterrupt): batch.run_plan(plan(), root)
    (root / 'dataset/artifact.json').write_bytes(encoded({'version': 1, 'status': 'complete'}))
    monkeypatch.setitem(batch._ACTIONS, 'dataset', lambda *_: pytest.fail('changed output reran'))
    with pytest.raises(ValueError): batch.run_plan(plan(), root)
    assert not (root / 'summary').exists()


def test_interrupted_action_consumes_finite_attempt(tmp_path, monkeypatch):
    root = tmp_path / 'run'
    def interrupt(*_): raise KeyboardInterrupt()
    with monkeypatch.context() as patch:
        patch.setitem(batch._ACTIONS, 'dataset', interrupt)
        with pytest.raises(KeyboardInterrupt): batch.run_plan(plan(), root)
    assert read_json(root / 'checkpoint.json')['tasks']['dataset']['status'] == 'running'
    assert batch.run_plan(plan(), root)['status'] == 'complete'
    assert read_json(root / 'checkpoint.json')['tasks']['dataset']['attempts'] == 2


def test_partial_publication_stops_without_downstream(tmp_path):
    root = tmp_path / 'run'
    root.mkdir(mode=0o700)
    (root / 'dataset').mkdir(mode=0o700)
    assert batch.run_plan(plan(), root)['status'] == 'failed'
    state = read_json(root / 'checkpoint.json')
    assert state['tasks']['dataset']['status'] == 'failed'
    assert set(state['tasks']) == {'dataset'}


def test_limits_detachment_and_local_mode(tmp_path, monkeypatch):
    request = plan()
    validated = batch.validate_plan(request)
    request['tasks'][0]['action'] = 'unsafe'
    assert validated['tasks'][1]['action'] == 'summary'
    oversized = plan(); oversized['padding'] = 'x' * batch.MAX_BYTES
    with pytest.raises(ValueError): batch.validate_plan(oversized)
    request = plan()
    request['tasks'] = [{'id': f't{i}', 'action': 'summary', 'dependencies': []} for i in range(16)]
    assert len(batch.validate_plan(request)['tasks']) == 16
    request['tasks'].append({'id': 'overflow', 'action': 'summary', 'dependencies': []})
    with pytest.raises(ValueError): batch.validate_plan(request)
    monkeypatch.setenv('NODE_ENV', 'production')
    with pytest.raises(ValueError): batch.run_plan(plan(), tmp_path / 'run')


def test_exact_byte_boundary(monkeypatch):
    request = plan()
    size = len(encoded(request))
    monkeypatch.setattr(batch, 'MAX_BYTES', size)
    batch.validate_plan(request)
    monkeypatch.setattr(batch, 'MAX_BYTES', size - 1)
    with pytest.raises(ValueError): batch.validate_plan(request)


def test_real_blocked_dataset_stops_downstream(tmp_path):
    request = plan()
    request['input']['source_semantics'] = 'unverified'
    result = batch.run_plan(request, tmp_path / 'run')
    assert result['status'] == 'blocked'
    assert set(read_json(tmp_path / 'run/checkpoint.json')['tasks']) == {'dataset'}


def test_failed_stage_can_resume_only_with_current_ack(tmp_path, monkeypatch):
    root = tmp_path / 'run'
    def fail(*_): raise RuntimeError('private')
    with monkeypatch.context() as patch:
        patch.setitem(batch._ACTIONS, 'dataset', fail)
        result = batch.run_plan(plan(), root)
    assert batch.run_plan(plan(), root, retry_ack=result['checkpoint_sha256'])['status'] == 'complete'


def test_malformed_checkpoint_stops_without_execution(tmp_path):
    root = tmp_path / 'run'
    batch.run_plan(plan(), root, stop_after=1)
    state = read_json(root / 'checkpoint.json')
    state['tasks']['dataset']['attempts'] = True
    (root / 'checkpoint.json').write_bytes(encoded(state))
    with pytest.raises(ValueError): batch.run_plan(plan(), root)
    assert not (root / 'summary').exists()
