"""Bounded explicit synthetic batch runner, version 1. No daemon or activation."""
import fcntl
import json
import os
import re

from .dataset import build_dataset
from .private import digest, directory, encoded, mode, publish, read_bytes, read_json, write

MAX_BYTES = 1024 * 1024
MAX_TASKS = 16


def require(condition):
    if not condition:
        raise ValueError('ML_BATCH_REJECTED')


def validate_plan(value):
    require(len(encoded(value)) <= MAX_BYTES)
    value = json.loads(encoded(value))  # detach caller data; reject nonfinite JSON
    require(type(value) is dict and set(value) == {'version', 'namespace', 'input', 'policy', 'tasks'})
    require(type(value['version']) is int and value['version'] == 1)
    require(type(value['namespace']) is str and re.fullmatch(r'synthetic_[a-z0-9_]{1,40}', value['namespace']))
    policy = value['policy']
    require(type(policy) is dict and set(policy) == {'version', 'max_attempts'})
    require(type(policy['version']) is int and policy['version'] == 1)
    require(type(policy['max_attempts']) is int and 1 <= policy['max_attempts'] <= 3)
    require(type(value['input']) is dict and value['input'].get('provenance') == 'local_synthetic')
    build_dataset(value['input'])  # reuse strict versioned synthetic dataset boundary
    tasks = value['tasks']
    require(type(tasks) is list and 1 <= len(tasks) <= MAX_TASKS)
    ids = set()
    for task in tasks:
        require(type(task) is dict and set(task) == {'id', 'action', 'dependencies'})
        require(type(task['id']) is str and re.fullmatch(r'[a-z][a-z0-9_]{0,31}', task['id']))
        require(task['id'] not in ids)
        ids.add(task['id'])
        require(type(task['action']) is str and task['action'] in ('dataset', 'summary'))
        deps = task['dependencies']
        require(type(deps) is list and len(deps) <= MAX_TASKS and all(type(d) is str for d in deps))
        require(len(set(deps)) == len(deps))
    ordered = []
    pending = {t['id']: t for t in tasks}
    while pending:
        ready = sorted(k for k, t in pending.items() if set(t['dependencies']) <= {t['id'] for t in ordered})
        require(bool(ready))  # reject cycles and unknown dependencies
        for key in ready:
            ordered.append(pending.pop(key))
    value['tasks'] = ordered
    return value


def _dataset(source, dependencies):
    report = build_dataset(source)
    return {'version': 1, 'status': 'complete' if report['counts']['available'] else 'blocked', 'dataset': report}


def _summary(source, dependencies):
    return {'version': 1, 'status': 'complete', 'input_sha256': digest(source),
            'dependencies': {k: digest(v) for k, v in sorted(dependencies.items())}}


# Fixed trusted functions only; input cannot supply code, commands, paths or imports.
_ACTIONS = {'dataset': _dataset, 'summary': _summary}


def _checkpoint(root, state):
    temporary = root / 'checkpoint.next'
    if temporary.exists():
        read_bytes(temporary, MAX_BYTES)
        temporary.unlink()
    write(temporary, encoded(state))
    os.replace(temporary, root / 'checkpoint.json')
    fd = os.open(root, os.O_RDONLY | os.O_DIRECTORY)
    try:
        os.fsync(fd)
    finally:
        os.close(fd)


def run_plan(plan, root, retry_ack=None, stop_after=None):
    mode()
    plan = validate_plan(plan)
    require(stop_after is None or type(stop_after) is int and 1 <= stop_after <= MAX_TASKS)
    root = directory(root, create=True)
    lock = root / 'writer.lock'
    try:
        write(lock, b'local-batch-v1')
    except FileExistsError:
        pass
    read_bytes(lock, 64)
    fd = os.open(lock, os.O_RDWR | os.O_NOFOLLOW)
    try:
        try:
            fcntl.flock(fd, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BlockingIOError:
            raise ValueError('ML_BATCH_WRITER_CONFLICT') from None
        binding = {'version': 1, 'plan_sha256': digest(plan), 'input_sha256': digest(plan['input']),
                   'policy_sha256': digest(plan['policy'])}
        path = root / 'checkpoint.json'
        state = read_json(path, MAX_BYTES) if path.exists() else {**binding, 'tasks': {}}
        require(type(state) is dict and set(state) == {*binding, 'tasks'})
        require(all(state.get(k) == v for k, v in binding.items()))
        require(type(state['tasks']) is dict and set(state['tasks']) <= {t['id'] for t in plan['tasks']})
        for entry in state['tasks'].values():
            require(type(entry) is dict and entry.get('status') in ('running', 'publishing', 'complete', 'failed', 'blocked'))
            fields = {'task_sha256', 'attempts', 'status'}
            require(set(entry) == (fields | {'artifact_sha256'} if entry['status'] in ('publishing', 'complete') else fields))
            require(type(entry['task_sha256']) is str and re.fullmatch(r'[0-9a-f]{64}', entry['task_sha256']))
            if 'artifact_sha256' in entry:
                require(type(entry['artifact_sha256']) is str and re.fullmatch(r'[0-9a-f]{64}', entry['artifact_sha256']))
            require(type(entry['attempts']) is int and 1 <= entry['attempts'] <= plan['policy']['max_attempts'])
        stopped = any(t['status'] in ('failed', 'blocked') for t in state['tasks'].values())
        if stopped or retry_ack is not None:
            require(retry_ack == digest(state))
        outputs = {}
        executed = 0
        for task in plan['tasks']:
            key = task['id']
            dependencies = {k: outputs[k] for k in task['dependencies']}
            task_hash = digest({'task': task, 'input_sha256': binding['input_sha256'],
                                'policy_sha256': binding['policy_sha256'],
                                'dependencies': {k: digest(v) for k, v in dependencies.items()}})
            prior = state['tasks'].get(key)
            if prior:
                require(prior['task_sha256'] == task_hash)
                if prior['status'] == 'complete' or (prior['status'] == 'publishing' and (root / key).exists()):
                    artifact = read_json(root / key / 'artifact.json')
                    require(digest(artifact) == prior['artifact_sha256'])
                    require(type(artifact) is dict and type(artifact.get('version')) is int and artifact['version'] == 1 and artifact.get('status') == 'complete')
                    if prior['status'] == 'publishing':
                        prior['status'] = 'complete'
                        _checkpoint(root, state)
                    outputs[key] = artifact
                    continue
            attempts = prior['attempts'] if prior else 0
            require(attempts < plan['policy']['max_attempts'])
            entry = {'task_sha256': task_hash, 'attempts': attempts + 1, 'status': 'running'}
            state['tasks'][key] = entry
            _checkpoint(root, state)
            try:
                artifact = _ACTIONS[task['action']](plan['input'], dependencies)
                require(len(encoded(artifact)) <= 16 * MAX_BYTES)
                require(artifact['status'] in ('complete', 'blocked'))
                if artifact['status'] == 'complete':
                    entry['artifact_sha256'] = digest(artifact)
                    entry['status'] = 'publishing'
                    _checkpoint(root, state)
                    publish(root / key, {'artifact.json': encoded(artifact)})
                entry['status'] = artifact['status']
            except Exception:
                entry.pop('artifact_sha256', None)
                entry['status'] = 'failed'
            _checkpoint(root, state)
            if entry['status'] != 'complete':
                return {'status': entry['status'], 'checkpoint_sha256': digest(state)}
            outputs[key] = artifact
            executed += 1
            if stop_after == executed:
                return {'status': 'interrupted', 'checkpoint_sha256': digest(state)}
        return {'status': 'complete', 'checkpoint_sha256': digest(state)}
    finally:
        os.close(fd)
