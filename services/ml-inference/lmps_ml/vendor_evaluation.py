"""Synthetic vendor/graph evidence only; no IO, activation or adoption authority.

Local limits, not business thresholds: 16 KiB JSON, 64-character invented IDs,
three dimensions, 32 evaluations, three attempts and 60,000 ms timeout.
Accuracy/coverage remain unknown; cost is supplied, never estimated.
Actual adoption, DPA, data authority and label gates remain blocked.
"""
from copy import deepcopy
from datetime import datetime
from hashlib import sha256
import json
import re
from typing import Protocol

MAX_BYTES = 16384
MAX_EVALUATIONS = 32
DIMENSIONS = ('fraud', 'mule_network', 'aml')


class EvaluationError(ValueError):
    """Fixed redacted diagnostic code only."""


def require(condition, code='VENDOR_INVALID'):
    if not condition:
        raise EvaluationError(code)


def fields(value, expected):
    require(type(value) is dict and set(value) == set(expected.split()))


def identifier(value):
    require(type(value) is str and re.fullmatch(r'synthetic_[a-z0-9_]{1,54}', value) is not None)


def hash_value(value):
    require(type(value) is str and re.fullmatch(r'[a-f0-9]{64}', value) is not None)


def timestamp(value):
    require(type(value) is str and re.fullmatch(r'\d{4}-\d\d-\d\dT\d\d:\d\d:\d\dZ', value) is not None)
    try:
        datetime.strptime(value, '%Y-%m-%dT%H:%M:%SZ')
    except ValueError:
        raise EvaluationError('VENDOR_INVALID') from None


def detached(value):
    # Bound depth/width before serialization; reject non-JSON and nonfinite data.
    def walk(node, depth=0):
        require(depth <= 6)
        if type(node) is dict:
            require(len(node) <= 24)
            for key, child in node.items():
                require(type(key) is str and len(key) <= 64)
                walk(child, depth + 1)
        elif type(node) is list:
            require(len(node) <= 3)
            for child in node:
                walk(child, depth + 1)
        else:
            require(node is None or type(node) in (str, int, bool))
            if type(node) is str:
                require(len(node) <= MAX_BYTES)
                try:
                    node.encode('utf-8')
                except UnicodeEncodeError:
                    raise EvaluationError('VENDOR_INVALID') from None
            if type(node) is int:
                require(abs(node) <= 10**12)
    walk(value)
    raw = json.dumps(value, sort_keys=True, separators=(',', ':'), allow_nan=False)
    require(len(raw.encode()) <= MAX_BYTES)
    return json.loads(raw)


def validate_request(value):
    value = detached(value)
    fields(value, 'version provenance evaluation_id cohort_sha256 split as_of provider provider_version kind lineage_sha256 dimensions timeout_ms max_attempts')
    require(type(value['version']) is int and value['version'] == 1)
    require(value['provenance'] == 'local_synthetic' and value['split'] == 'test')
    for key in ('evaluation_id', 'provider', 'provider_version'):
        identifier(value[key])
    for key in ('cohort_sha256', 'lineage_sha256'):
        hash_value(value[key])
    timestamp(value['as_of'])
    require(value['kind'] in ('vendor', 'graph'))
    dims = value['dimensions']
    require(type(dims) is list and 1 <= len(dims) <= 3 and all(type(d) is str and d in DIMENSIONS for d in dims))
    require(len(set(dims)) == len(dims))
    for key, maximum in (('timeout_ms', 60000), ('max_attempts', 3)):
        require(type(value[key]) is int and 1 <= value[key] <= maximum)
    return value


def fingerprint(request):
    return sha256(json.dumps(request, sort_keys=True, separators=(',', ':')).encode()).hexdigest()


def validate_cost(cost):
    """None means unknown; supplied minor units are never a cost estimate."""
    if cost is None:
        return
    fields(cost, 'source amount_minor currency evidence_sha256')
    require(cost['source'] == 'supplied_synthetic')
    require(type(cost['amount_minor']) is int and 0 <= cost['amount_minor'] <= 10**12)
    require(type(cost['currency']) is str and re.fullmatch('[A-Z]{3}', cost['currency']) is not None)
    hash_value(cost['evidence_sha256'])


def validate_result(request, value):
    """The request digest binds every cohort/provider/version/split field.

    Unavailable or stale evidence fails closed and is never cached as success.
    Each dimension carries its own supplied cost and unknown quality evidence.
    """
    request = validate_request(request)
    value = detached(value)
    fields(value, 'request_sha256 as_of lineage_sha256 availability dimensions')
    require(value['request_sha256'] == fingerprint(request), 'VENDOR_BINDING_CONFLICT')
    require(value['as_of'] == request['as_of'], 'VENDOR_AS_OF_MISMATCH')
    require(value['lineage_sha256'] == request['lineage_sha256'], 'VENDOR_LINEAGE_CONFLICT')
    require(value['availability'] in ('available', 'unavailable', 'stale'))
    require(type(value['dimensions']) is dict and set(value['dimensions']) == set(request['dimensions']))
    for evidence in value['dimensions'].values():
        fields(evidence, 'accuracy coverage cost')
        require(evidence['accuracy'] is None and evidence['coverage'] is None)
        validate_cost(evidence['cost'])
    require(value['availability'] != 'stale', 'VENDOR_STALE')
    require(value['availability'] != 'unavailable', 'VENDOR_UNAVAILABLE')
    return value


class EvaluationPort(Protocol):
    def evaluate(self, request: dict) -> dict: ...


class InMemoryEvaluationFake:
    """Scripted logical timeouts: no sleeping, IO or data acquisition.

    Identical retries return detached cached evidence. Changed ID reuse conflicts
    even after failure. Retry budgets never reset; timeout_ms is a local bound,
    not a claim about real provider latency or cancellation.
    """
    def __init__(self, outcomes=('available',), costs=None):
        require(type(outcomes) in (tuple, list) and 1 <= len(outcomes) <= 3)
        require(all(type(o) is str and o in ('available', 'timeout', 'unavailable', 'stale', 'as_of_mismatch', 'lineage_conflict') for o in outcomes))
        self._outcomes = tuple(outcomes)
        self._costs = detached({} if costs is None else costs)
        require(type(self._costs) is dict and set(self._costs) <= set(DIMENSIONS))
        for cost in self._costs.values():
            validate_cost(cost)
        self._entries = {}

    def evaluate(self, request):
        request = validate_request(request)
        key, binding = request['evaluation_id'], fingerprint(request)
        prior = self._entries.get(key)
        if prior is None:
            require(len(self._entries) < MAX_EVALUATIONS, 'VENDOR_CAPACITY')
            prior = {'binding': binding, 'attempts': 0, 'result': None}
            self._entries[key] = prior
        require(prior['binding'] == binding, 'VENDOR_BINDING_CONFLICT')
        if prior['result'] is not None:
            return deepcopy(prior['result'])
        require(prior['attempts'] < request['max_attempts'], 'VENDOR_RETRY_EXHAUSTED')
        outcome = self._outcomes[min(prior['attempts'], len(self._outcomes) - 1)]
        prior['attempts'] += 1
        require(outcome != 'timeout', 'VENDOR_TIMEOUT')
        result = {'request_sha256': binding, 'as_of': request['as_of'],
                  'lineage_sha256': request['lineage_sha256'],
                  'availability': outcome if outcome in ('stale', 'unavailable') else 'available',
                  'dimensions': {d: {'accuracy': None, 'coverage': None, 'cost': self._costs.get(d)} for d in request['dimensions']}}
        if outcome == 'as_of_mismatch':
            result['as_of'] = '2000-01-01T00:00:00Z' if request['as_of'] != '2000-01-01T00:00:00Z' else '2001-01-01T00:00:00Z'
        if outcome == 'lineage_conflict':
            result['lineage_sha256'] = '0' * 64 if request['lineage_sha256'] != '0' * 64 else '1' * 64
        prior['result'] = validate_result(request, result)
        return deepcopy(prior['result'])
