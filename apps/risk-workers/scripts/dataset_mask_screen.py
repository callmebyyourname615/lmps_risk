"""Observed bank+mask window proxies. No resolved accounts or point-in-time claims."""

from collections import Counter, deque
from contextlib import ExitStack
from datetime import datetime, timedelta, timezone
from functools import lru_cache
from hashlib import sha256
from itertools import groupby
from pathlib import Path
import base64
import bisect
import heapq
import hmac
import io
import json
import os
import shutil
import sys
import tempfile
import time

import dataset_readiness as month
import dataset_month_stream as sorting
from dataset_amount_backtest import JS_TRIM

VERSION = 'lmps-observed-mask-screen-1'
WINDOWS = [300, 900, 3600]
TZ = timezone(timedelta(hours=7))
WIDTH = 84
MAX_ROWS = 30_000_000
MAX_BYTES = 16 * 1024**3
MAX_SCRATCH = 3 * 1024**3
RESERVE = 1024**3
MAX_SECONDS = 7200
MAX_ACTIVE = 500_000
MAX_BATCH = 100_000
MAX_TRACE_PEERS = 2_000_000
TOP = 3
PATTERNS = ['FRAUD_COUNT_VELOCITY', 'FRAUD_AMOUNT_VELOCITY', 'MULE_FAN_OUT', 'MULE_FAN_IN']
SURROGATE = month.re.compile('[\ud800-\udfff]')


def encoded(v):
    return json.dumps(v, sort_keys=True, ensure_ascii=False, separators=(',', ':')).encode()


def stamp(v):
    month.check(isinstance(v, str) and month.re.fullmatch(r'[1-9][0-9]{3}-[0-9]{2}-[0-9]{2} [0-9]{2}:[0-9]{2}:[0-9]{2}', v))
    return int(datetime.fromisoformat(v).replace(tzinfo=TZ).timestamp())


def printable(v, width):
    return (isinstance(v, str) and 0 < len(v) <= width and bool(v.strip(JS_TRIM))
            and not month.profile.CONTROL_CHARACTERS.search(v)
            and not SURROGATE.search(v))


def endpoint(key, bank, representation):
    month.check(len(key) == 32 and printable(bank, 200) and printable(representation, 5000))
    message = json.dumps(['observed-mask-1', bank, representation], ensure_ascii=False, separators=(',', ':')).encode()
    return hmac.digest(key, message, 'sha256')


def cohort(row, plan_month):
    if not row['requesttime'].startswith(plan_month + '-'):
        return 'outside_request_month'
    if row['ccy'] != 'LAK':
        return 'other_currency'
    amount = month.cents(row['amount'])
    if amount <= 0:
        return 'nonpositive'
    if amount > 20_000_000_000:
        return 'above_cap'
    if row['result'] != 'OK':
        return 'not_literal_OK'
    if row['shouldrevert'] != '0':
        return 'refund_required_or_unknown'
    if row['originalreference']:
        return 'DRS_marker_withheld'
    if not printable(row['frommember'], 200) or not printable(row['tomember'], 200):
        return 'bank_namespace_unusable'
    if not printable(row['fromaccount'], 200) or not printable(row['toaccount'], 5000):
        return 'endpoint_representation_unusable'
    return 'included'


def reference(case):
    r = case
    target = next(e for e in r['events'] if e['ordinal'] == r['anchor'])
    if target['occurred_unix'] < r['scope_start'] + r['window_seconds']:
        return dict(status='warmup_withheld', metrics=None, identity_status='unverified')
    events = [e for e in r['events'] if target['occurred_unix']-r['window_seconds'] < e['occurred_unix'] <= target['occurred_unix']]
    outgoing = [e for e in events if e['sender'] == target['sender']]
    incoming = [e for e in events if e['receiver'] == target['receiver']]
    return dict(status='snapshot_proxy', identity_status='unverified', metrics={
        'FRAUD_COUNT_VELOCITY': str(len(outgoing)),
        'FRAUD_AMOUNT_VELOCITY': month.money(sum(month.cents(e['amount']) for e in outgoing)),
        'MULE_FAN_OUT': str(len({e['receiver'] for e in outgoing})),
        'MULE_FAN_IN': str(len({e['sender'] for e in incoming}))})


def parity(request, key):
    p = request['profile']
    month.check(p['version'] == 'bank_mask_snapshot_candidate_v1' and p['currency'] == 'LAK'
                and p['amount_unit'] == 'major' and p['product_cap'] == '200000000.00'
                and p['time_zone'] == 'Asia/Vientiane' and p['declared_offset_minutes'] == 420
                and p['windows_seconds'] == WINDOWS and p['histogram_significant_bits'] == 8
                and p['identity_status'] == 'unverified' and p['enforcement'] is False and p['canonical_assessment'] is False)
    for collection in ['key_cases', 'time_cases', 'window_cases']:
        month.check(isinstance(request[collection], list) and len(request[collection]) <= 100)
    for c in request['key_cases']:
        month.check(endpoint(key, c['input']['bank'], c['input']['representation']).hex() == c['output']['observed_key'])
        month.check(c['output']['identity_status'] == 'unverified' and c['output']['real_account_claim'] is False)
    for c in request['time_cases']:
        month.check(stamp(c['input']) == c['output'])
    for c in request['window_cases']:
        month.check(reference(c['input']) == c['output'])


class Budget(sorting.Budget):
    def check(self, additional=0):
        month.check(time.monotonic()-self.started <= MAX_SECONDS and self.disk_bytes+additional <= MAX_SCRATCH)
        month.check(shutil.disk_usage(self.root).free >= RESERVE+additional)


class Runs(sorting.SortedRuns):
    def preview(self):
        self.flush()
        month.check(len(self.paths) <= 128)
        with ExitStack() as stack:
            def records(source):
                while value := source.read(self.width):
                    month.check(len(value) == self.width)
                    yield value
            sources = [records(stack.enter_context(p.open('rb', buffering=131072))) for p in self.paths]
            for i, value in enumerate(heapq.merge(*sources)):
                if i % 16384 == 0:
                    self.budget.check()
                yield value


def bounds(value):
    shift = max(0, value.bit_length()-8)
    low = (value >> shift) << shift
    return low, low + (1 << shift)-1


class Histogram:
    def __init__(self):
        self.anchors, self.windows = Counter(), Counter()
        self.minimum, self.maximum = None, None

    def add(self, value, anchors):
        low, _ = bounds(value)
        self.anchors[low] += anchors
        self.windows[low] += 1
        self.minimum = value if self.minimum is None else min(self.minimum, value)
        self.maximum = value if self.maximum is None else max(self.maximum, value)

    def summary(self):
        total, cursor, qs = sum(self.anchors.values()), 0, {}
        for low, n in sorted(self.anchors.items()):
            cursor += n
            for percent in [50, 90, 95, 99]:
                name = 'p' + str(percent)
                if name not in qs and cursor >= (percent*total+99)//100:
                    qs[name] = dict(lower=low, upper=bounds(low)[1])
        cutoff = qs['p99']['upper']+1 if total else None
        return dict(anchors=total, observed_endpoint_windows=sum(self.windows.values()), minimum=self.minimum, maximum=self.maximum,
            quantile_intervals=qs, experimental_cutoff=cutoff,
            candidate_anchors=sum(n for low,n in self.anchors.items() if cutoff is not None and low >= cutoff),
            candidate_endpoint_windows=sum(n for low,n in self.windows.items() if cutoff is not None and low >= cutoff),
            quantile_method='nearest_rank_bounded_integer_bins_8_significant_bits_not_exact_quantiles',
            cutoff_method='one_integer_unit_above_p99_bin_upper_same_cohort_exploration_not_calibrated_policy')


class Window:
    def __init__(self):
        self.events, self.peers, self.amount = deque(), Counter(), 0

    def advance(self, timestamp, seconds, batch):
        while self.events and self.events[0][0] <= timestamp-seconds:
            _, peer, amount = self.events.popleft()
            self.amount -= amount
            self.peers[peer] -= 1
            if not self.peers[peer]:
                del self.peers[peer]
        for peer, amount, ordinal in batch:
            self.events.append((timestamp, peer, amount))
            self.peers[peer] += 1
            self.amount += amount
        month.check(len(self.events) <= MAX_ACTIVE)


def windows(records, role, scope_start, callback, budget):
    grouped = processed = next_progress = 0
    counts = Counter()
    for group_key, group in groupby(records, key=lambda b: b[:32]):
        grouped += 1
        state = {w: Window() for w in WINDOWS}
        for rawtime, entries in groupby(group, key=lambda b: b[32:40]):
            timestamp = int.from_bytes(rawtime, 'big')
            batch = []
            for value in entries:
                batch.append((value[44:76], int.from_bytes(value[76:84], 'big'), int.from_bytes(value[40:44], 'big')))
                month.check(len(batch) <= MAX_BATCH)
            for w, current in state.items():
                current.advance(timestamp, w, batch)
                if timestamp < scope_start+w:
                    counts[str(w)] += len(batch)
                    continue
                metrics = {'MULE_FAN_IN':len(current.peers)} if role == 'receiver' else {
                    'FRAUD_COUNT_VELOCITY':len(current.events), 'FRAUD_AMOUNT_VELOCITY':current.amount, 'MULE_FAN_OUT':len(current.peers)}
                callback(group_key, timestamp, w, metrics, batch)
            processed += len(batch)
            if processed >= next_progress:
                budget.progress(callback.__name__+'_'+role,0,processed)
                next_progress=processed+250000
    return dict(observed_endpoint_groups=grouped, warmup_anchors_withheld=dict(counts))


def validate_prior(plan, prior):
    month.validate_plan(plan, max_files=4096, max_rows=MAX_ROWS)
    month.check({f['table'] for f in plan['files']} == {'transfer'} and prior['format'] == 'lmps-month-readiness-1')
    month.check(prior['requested_month'] == plan['month'] and len(prior['tables']) == 1 and len(prior['input_files']) == len(plan['files']))
    table = prior['tables'][0]
    month.check(table['source_table'] == 'transfer' and prior['observed_rows'] == sum(f['expected_rows'] for f in plan['files']))
    for name in ['duplicate_key_rows','conflicting_source_keys_withheld','invalid_key_rows','malformed_rows']:
        month.check(table[name] == 0)
    month.check({'id','requesttime','txtime','amount','ccy','result','shouldrevert','originalreference','fromaccount','toaccount','frommember','tomember'} <= set(table['columns']))
    return table


def fill_runs(plan, prior, key, role, runs, budget):
    table = validate_prior(plan, prior)
    invalid_fields = [k for k,v in table['fields'].items() if v['invalid_rows']]
    reasons, observed, compressed, decoded = Counter(), 0, 0, 0
    event_digest = sha256()
    @lru_cache(maxsize=10000)
    def observed_key(bank, value):
        return endpoint(key, bank, value)
    for i,f in enumerate(plan['files']):
        ev = {}
        for row_no,row in enumerate(month.source_rows(f,ev),1):
            ordinal = observed
            observed += 1
            month.check(observed <= MAX_ROWS and row is not None)
            if observed % 100000 == 0:
                budget.check()
            if not all(month.valid_value(k,row[k]) for k in invalid_fields):
                reasons['invalid_row'] += 1
                continue
            reason = cohort(row, plan['month'])
            if reason == 'included' and not row['txtime'].startswith(plan['month']+'-'):
                reason = 'event_outside_declared_month'
            reasons[reason] += 1
            if reason != 'included':
                continue
            sender, receiver = observed_key(row['frommember'],row['fromaccount']), observed_key(row['tomember'],row['toaccount'])
            when, amount = stamp(row['txtime']), month.cents(row['amount'])
            month.check(when >= 0)
            canonical = sender+receiver+when.to_bytes(8,'big')+amount.to_bytes(8,'big')+ordinal.to_bytes(4,'big')
            event_digest.update(canonical)
            group, peer = (sender,receiver) if role == 'sender' else (receiver,sender)
            runs.add(group+when.to_bytes(8,'big')+ordinal.to_bytes(4,'big')+peer+amount.to_bytes(8,'big'))
        expected = prior['input_files'][i]
        month.check(ev['sha256']==expected['sha256'] and ev['rows']==expected['rows'] and ev['columns']==expected['columns'])
        month.check(ev['input_bytes']==expected['input_bytes'] and ev['decoded_bytes']==expected['decoded_bytes'])
        compressed += ev['input_bytes']; decoded += ev['decoded_bytes']
        month.check(max(compressed,decoded) <= MAX_BYTES)
        budget.progress('source_'+role,i+1,observed)
    month.check(observed==prior['observed_rows'] and sum(reasons.values())==observed)
    month.check(reasons['invalid_row']==table['invalid_rows'] and compressed==prior['input_bytes'] and decoded==prior['decoded_bytes'])
    return dict(reasons=reasons, included= reasons['included'], cohort_sha256=event_digest.hexdigest())


def metric_id(pattern, seconds):
    return pattern+':'+str(seconds)


def replay_windows(runs, traces, budget):
    selected = {}
    for trace in traces:
        selected.setdefault(bytes.fromhex(trace['observed_group']),[]).append(trace)
    values = {t['trace_id']:dict(count=0,amount=0,peers=set(),anchor=False) for t in traces}
    peers = 0
    for i,record in enumerate(runs.records()):
        if i%250000==0:budget.progress('trace_window_replay',0,i)
        for trace in selected.get(record[:32],[]):
            timestamp = int.from_bytes(record[32:40],'big')
            if trace['anchor_unix']-trace['window_seconds'] < timestamp <= trace['anchor_unix']:
                value = values[trace['trace_id']]
                value['count'] += 1; value['amount'] += int.from_bytes(record[76:84],'big')
                peer = record[44:76]
                if peer not in value['peers']:
                    value['peers'].add(peer);peers += 1
                    month.check(peers <= MAX_TRACE_PEERS)
                value['anchor'] |= int.from_bytes(record[40:44],'big') == trace['source_ordinal_zero_based']
    for trace in traces:
        v=values[trace['trace_id']]
        actual = v['count'] if trace['pattern']=='FRAUD_COUNT_VELOCITY' else v['amount'] if trace['pattern']=='FRAUD_AMOUNT_VELOCITY' else len(v['peers'])
        month.check(v['anchor'] and actual==trace['metric_integer'] and actual>=trace['cutoff_integer'])
    return dict(status='passed', windows=len(traces))


def verify_anchors(plan, key, traces):
    prefixes, cursor = [], 0
    for f in plan['files']:
        cursor += f['expected_rows'];prefixes.append(cursor)
    selected = {}
    for trace in traces:
        ordinal = trace['source_ordinal_zero_based']
        i=bisect.bisect_right(prefixes,ordinal)
        month.check(i < len(plan['files']))
        row_no=ordinal-(prefixes[i-1] if i else 0)+1
        selected.setdefault(i,{}).setdefault(row_no,[]).append(trace)
    n=0
    for i, rows in selected.items():
        ev={};f=plan['files'][i]
        for row_no,row in enumerate(month.source_rows(f,ev),1):
            for trace in rows.get(row_no,[]):
                month.check(row is not None and cohort(row,plan['month'])=='included')
                field,bank=('fromaccount','frommember') if trace['role']=='sender' else ('toaccount','tomember')
                month.check(endpoint(key,row[bank],row[field]).hex()==trace['observed_group'])
                month.check(stamp(row['txtime'])==trace['anchor_unix'])
                month.check(trace['source_file_sha256']==f['sha256'])
                month.check(trace['source_data_row_ordinal_one_based']==row_no)
                month.check(trace['source_key_sha256']==sha256(month.encoded(['transfer',row['id'],row['requesttime']])).hexdigest())
                n+=1
        month.check(ev['sha256']==f['sha256'])
    month.check(n==len(traces))
    return dict(status='passed',anchors=n,source_files=len(selected))


def run(request):
    month.pilot.mode()
    common='profile key_b64 key_cases time_cases window_cases '
    month.check(month.exact(request,common+'check_only') or month.exact(request,common+'plan traces')
                or month.exact(request,common+'plan prior scratch'))
    key=base64.b64decode(request['key_b64'],validate=True)
    month.check(len(key)==32)
    parity(request,key)
    if request.get('check_only'):
        return dict(parity='passed')
    if 'traces' in request:
        return verify_anchors(request['plan'],key,request['traces'])
    plan,prior=request['plan'],request['prior']
    validate_prior(plan,prior)
    scratch=month.canonical_private(request['scratch']);os.close(month.profile.private_directory(scratch))
    expected=prior['observed_rows']
    month.check(expected*WIDTH<=MAX_SCRATCH and shutil.disk_usage(scratch).free>=expected*WIDTH+RESERVE+64*1024**2)
    scope_start=stamp(plan['month']+'-01 00:00:00')
    bits={metric_id(p,w):bytearray((expected+7)//8) for p in PATTERNS for w in WINDOWS}
    union=bytearray((expected+7)//8)
    summaries,role_summary,traces,cohort_receipt={}, {}, [], None
    prefixes=[];cursor=0
    for f in plan['files']:
        cursor+=f['expected_rows'];prefixes.append(cursor)
    with tempfile.TemporaryDirectory(prefix='.mask-screen-',dir=scratch) as tmp:
        budget=Budget(Path(tmp))
        for role in ['sender','receiver']:
            runs=Runs(budget,role,WIDTH)
            receipt=fill_runs(plan,prior,key,role,runs,budget)
            if cohort_receipt is None:cohort_receipt=receipt
            else:month.check(receipt==cohort_receipt)
            histograms={}
            def profile(group,t,w,metrics,batch):
                for p,value in metrics.items():histograms.setdefault(metric_id(p,w),Histogram()).add(value,len(batch))
            budget.progress('profile_'+role,0,0)
            role_summary[role]=windows(runs.preview(),role,scope_start,profile,budget)
            local={name:h.summary() for name,h in histograms.items()}
            for p in (PATTERNS[:3] if role=='sender' else PATTERNS[3:]):
                for w in WINDOWS:local.setdefault(metric_id(p,w),Histogram().summary())
            matched=Counter();matched_windows=Counter();heaps={}
            def backtest(group,t,w,metrics,batch):
                ordinal=min(item[2] for item in batch)
                for p,value in metrics.items():
                    name=metric_id(p,w);cutoff=local[name]['experimental_cutoff']
                    if cutoff is None or value<cutoff:continue
                    matched[name]+=len(batch);matched_windows[name]+=1
                    for _,_,anchor in batch:
                        bits[name][anchor>>3] |= 1<<(anchor&7);union[anchor>>3] |= 1<<(anchor&7)
                    heap=heaps.setdefault(name,[])
                    if len(heap)<TOP or value>=heap[0][0]:
                        i=bisect.bisect_right(prefixes,ordinal);row_no=ordinal-(prefixes[i-1] if i else 0)+1
                        token=sha256(encoded([name,group.hex(),t,ordinal])).hexdigest()
                        trace=dict(trace_id=token,pattern=p,window_seconds=w,role=role,observed_group=group.hex(),
                            anchor_unix=t,source_ordinal_zero_based=ordinal,source_file_ordinal_zero_based=i,
                            source_data_row_ordinal_one_based=row_no,source_file_sha256=plan['files'][i]['sha256'],
                            metric_integer=value,cutoff_integer=cutoff,metric_unit='recorded_LAK_cents' if p=='FRAUD_AMOUNT_VELOCITY' else 'observed_count',
                            identity_status='unverified',product_scope='user_declared_not_independently_verified',
                            known_at='unverified',real_account_claim=False)
                        item=(value,token,trace)
                        if len(heap)<TOP:heapq.heappush(heap,item)
                        elif item[:2]>heap[0][:2]:heapq.heapreplace(heap,item)
            budget.progress('backtest_'+role,0,0)
            month.check(windows(runs.preview(),role,scope_start,backtest,budget)==role_summary[role])
            for name,data in local.items():
                data['pattern'],data['window_seconds']=name.split(':')[0],int(name.split(':')[1])
                data['metric_unit']='recorded_LAK_cents' if data['pattern']=='FRAUD_AMOUNT_VELOCITY' else 'observed_count'
                month.check(matched[name]==data['candidate_anchors'] and matched_windows[name]==data['candidate_endpoint_windows'])
                month.check(int.from_bytes(bits[name],'little').bit_count()==matched[name])
                summaries[name]=data
            selected=[item[2] for name in sorted(heaps) for item in sorted(heaps[name],reverse=True)]
            budget.progress('trace_window_replay_'+role,0,0)
            role_summary[role]['trace_verification']=replay_windows(runs,selected,budget)
            traces.extend(selected)
        # Add key commitments from original anchors without disclosing accounts/references.
        anchors={t['source_ordinal_zero_based'] for t in traces}
        by_file={}
        for ordinal in anchors:
            i=bisect.bisect_right(prefixes,ordinal);by_file.setdefault(i,set()).add(ordinal-(prefixes[i-1] if i else 0)+1)
        commitments={}
        for i,rows in by_file.items():
            ev={}
            for row_no,row in enumerate(month.source_rows(plan['files'][i],ev),1):
                if row_no in rows:
                    ordinal=(prefixes[i-1] if i else 0)+row_no-1
                    commitments[ordinal]=sha256(month.encoded(['transfer',row['id'],row['requesttime']])).hexdigest()
            month.check(ev['sha256']==plan['files'][i]['sha256'])
        for trace in traces:trace['source_key_sha256']=commitments[trace['source_ordinal_zero_based']]
        # Money can exceed JS safe integer precision in a cumulative window.
        for item in summaries.values():
            if item['pattern']=='FRAUD_AMOUNT_VELOCITY':
                for name in ['minimum','maximum','experimental_cutoff']:
                    if item[name] is not None:item[name]=str(item[name])
                for interval in item['quantile_intervals'].values():
                    for name in ['lower','upper']:interval[name]=str(interval[name])
        for trace in traces:
            trace['metric_integer']=str(trace['metric_integer']);trace['cutoff_integer']=str(trace['cutoff_integer'])
        budget.check()
        report=dict(format=VERSION,profile=request['profile'],requested_request_month=plan['month'],
            scope='current_snapshot_observed_mask_groups_not_real_account_detection',observed_rows=expected,
            cohort=cohort_receipt,source_verification_passes=2,role_summary=role_summary,
            metrics=[summaries[k] for k in sorted(summaries)],unique_candidate_source_row_anchors=int.from_bytes(union,'little').bit_count(),
            overlap_policy='union_deduplicated_by_source_ordinal_not_business_payment',
            mask_uniqueness='unverified',cross_role_consistency='mostly_same_not_guaranteed',identity_status='unverified',
            net_execution='unverified',known_at='unverified',correction_history='unverified',source_completeness='unverified',
            accuracy=None,canonical_assessment=False,production_ready=False,enforcement=False,
            scratch_peak_bytes=budget.peak_bytes,key_commitment_sha256=sha256(key).hexdigest(),
            threshold_evaluation='same_cohort_exploration_not_held_out_accuracy',
            limits=dict(rows=MAX_ROWS,scratch_bytes=MAX_SCRATCH,reserve_bytes=RESERVE,seconds=MAX_SECONDS,
                        active_events_per_observed_group=MAX_ACTIVE,same_second_events=MAX_BATCH,trace_peer_entries=MAX_TRACE_PEERS))
        month.check(len(encoded(report))<=2*1024**2 and len(encoded(traces))<=2*1024**2)
        return dict(report=report,traces=traces)


if __name__=='__main__':
    try:
        raw=sys.stdin.buffer.read(4*1024**2+1)
        month.check(len(raw)<=4*1024**2 and len(sys.argv)==1)
        request=json.loads(raw,object_pairs_hook=month.export.unique_object)
        print(month.encoded(run(request)).decode())
    except Exception:
        print('MASK_SCREEN_FAILED; private diagnostics withheld.',file=sys.stderr)
        raise SystemExit(1)
