"""No.47: evidence-bound source observations, never verified payments or accounts."""
from datetime import datetime,timedelta,timezone
from decimal import Decimal
from hashlib import sha256
import os
from pathlib import Path
import re
import stat
import sys
from zoneinfo import ZoneInfo
from .private import digest,encoded,mode,publish,read_json
from .dataset import stamp

ROOT=Path(__file__).resolve().parents[3]


def schema_evidence(path):
    sys.path.insert(0,str(ROOT/'tools/schema-metadata'))
    from lmps_schema.analyze import analyze
    fd=os.open(path,os.O_RDONLY|os.O_NOFOLLOW|os.O_NONBLOCK)
    with os.fdopen(fd,'rb') as stream:
        before=os.fstat(stream.fileno())
        if not stat.S_ISREG(before.st_mode) or before.st_size>8*1024*1024:raise ValueError('SOURCE_DDL_REJECTED')
        raw=stream.read(8*1024*1024+1);after=os.fstat(stream.fileno())
        if len(raw)!=before.st_size or before.st_mtime_ns!=after.st_mtime_ns:raise ValueError('SOURCE_DDL_CHANGED')
    inventory=analyze(raw);tables={t['name']:t for t in inventory['tables']}
    table=tables.get('transfer',{});columns={c['name']:c for c in table.get('columns',[])}
    sys.path.insert(0,str(ROOT/'apps/risk-workers/scripts'))
    from export_transfer import PILOT_COLUMNS
    missing=sorted(set(PILOT_COLUMNS)-set(columns));amount=columns.get('amount',{})
    compatible=not missing and amount.get('data_type')=='decimal' and amount.get('numeric_parameters')==[24,2]
    return {'ddl_sha256':sha256(raw).hexdigest(),'table':'transfer','columns':len(columns),'required_fields':len(PILOT_COLUMNS),
            'missing_fields':missing,'structurally_compatible':bool(compatible),'keys':table.get('indexes',[]),
            'source_semantics':'unverified','identity_status':'unverified'}


def utc_time(value,zone):
    if not isinstance(value,str) or not re.fullmatch(r'\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}',value):raise ValueError('TIME_INVALID')
    naive=datetime.strptime(value,'%Y-%m-%d %H:%M:%S')
    if re.fullmatch(r'[+-](?:(?:0\d|1[0-3]):[0-5]\d|14:00)',zone):
        sign=1 if zone[0]=='+' else -1;tz=timezone(sign*timedelta(hours=int(zone[1:3]),minutes=int(zone[4:])))
    else:tz=ZoneInfo(zone)
    first=naive.replace(tzinfo=tz,fold=0);second=naive.replace(tzinfo=tz,fold=1)
    if first.utcoffset()!=second.utcoffset() or first.astimezone(timezone.utc).astimezone(tz).replace(tzinfo=None)!=naive:
        raise ValueError('TIME_AMBIGUOUS_OR_NONEXISTENT')
    return first.astimezone(timezone.utc).isoformat(timespec='milliseconds').replace('+00:00','Z')


def major(value,unit,exponent):
    if value is None:return None
    if not isinstance(value,str) or not re.fullmatch(r'-?(0|[1-9][0-9]{0,21})\.[0-9]{2}',value):raise ValueError('MONEY_INVALID')
    # Integer arithmetic preserves24-digit source decimals; no implicit currency exponent or rounding.
    scaled=int(value.replace('.',''))
    if scaled<0:raise ValueError('NEGATIVE_MONEY_UNRESOLVED')
    if unit=='minor':
        if type(exponent) is not int or not 0<=exponent<=6:raise ValueError('MINOR_EXPONENT_UNAVAILABLE')
        factor=10**exponent
        if scaled%factor:raise ValueError('FRACTIONAL_CENT_UNSUPPORTED')
        scaled//=factor
    elif unit!='major':raise ValueError('MONEY_UNIT_UNAVAILABLE')
    return f'{scaled//100}.{scaled%100:02d}'


def normalize(evidence,mapping,review,document_sha,schema):
    mode()
    if mapping['source_manifest_sha256']!=evidence['source_manifest_sha256']:raise ValueError('SOURCE_BINDING_CONFLICT')
    bound=False
    if review is not None:
        if (set(review)!={'format','mapping_sha256','ddl_sha256','document_sha256','reviewer_ref','reviewed_at','snapshot_observed_at','currency_exponents'}
                or review['format']!=1 or not re.fullmatch(r'[A-Za-z0-9_-]{1,80}',review['reviewer_ref'])
                or review['mapping_sha256']!=digest(mapping) or review['ddl_sha256']!=schema['ddl_sha256']
                or review['document_sha256']!=document_sha or mapping['status']!='owner_declared'
                or not document_sha or mapping['evidence']['sha256']!=document_sha
                or not isinstance(review['currency_exponents'],dict)
                or any(not re.fullmatch(r'[A-Z]{3}',k) or type(v) is not int or not 0<=v<=6 for k,v in review['currency_exponents'].items())):
            raise ValueError('SOURCE_EVIDENCE_BINDING_INVALID')
        stamp(review['reviewed_at']);stamp(review['snapshot_observed_at'])
        if stamp(review['reviewed_at'])<stamp(review['snapshot_observed_at']):raise ValueError('SOURCE_REVIEW_TIMELINE_INVALID')
        bound=True
    if not schema['structurally_compatible']:bound=False
    selectors=['result','txtype','totype','shouldrevert','isreconciled','issettled']
    lifecycle={tuple(item['source'][k] for k in selectors):item for item in mapping['lifecycle']}
    currencies={item['source_ccy']:item for item in mapping['currencies']};rows=[]
    for source in evidence['records']:
        item=lifecycle.get(tuple(source[k] for k in selectors));currency=currencies.get(source['ccy'])
        result={'row_number':source['row_number'],'source_row_sha256':source['source_row_sha256'],
                'status':'unavailable','reason_code':None,'operation':None,'transaction_status':None,'amount':None,'fee':None,'currency':None,
                'source_time_utc':None,'source_time_meaning':None,'available_at':None,'availability_kind':None,
                'net_executed_amount':None,'target':None,'sender':None,'receiver':None,'identity_status':'unverified'}
        reason=None
        if not bound:reason='SOURCE_EVIDENCE_UNCONFIRMED'
        elif not item or item['operation']=='unknown' or item['state']=='unknown':reason='LIFECYCLE_UNAVAILABLE'
        elif item['operation']!='payment':reason='REVERSAL_LINKAGE_UNVERIFIED' if item['operation']=='reversal' else 'NOT_A_PAYMENT'
        elif source['originalreference_presence']=='present':reason='BUSINESS_LINKAGE_UNVERIFIED'
        elif not currency or not currency['currency']:reason='CURRENCY_UNAVAILABLE'
        elif mapping['time'] is None:reason='TIME_SEMANTICS_UNAVAILABLE'
        else:
            try:
                code=currency['currency'];exponent=review['currency_exponents'].get(code)
                amount=major(source['amount'],currency['amount_unit'],exponent);fee=major(source['fee'],currency['fee_unit'],exponent)
                time=utc_time(source[mapping['time']['field']],mapping['time']['timezone'])
                if stamp(time)>stamp(review['snapshot_observed_at']):raise ValueError('SNAPSHOT_PRECEDES_SOURCE_TIME')
                result.update(status='owner_declared_evidence_bound',operation=item['operation'],transaction_status=item['state'],amount=amount,fee=fee,currency=code,
                    source_time_utc=time,source_time_meaning=mapping['time']['meaning'],available_at=review['snapshot_observed_at'],availability_kind='operator_declared_snapshot')
            except (ValueError,KeyError):reason='MONEY_OR_TIME_UNAVAILABLE'
        result['reason_code']=reason or 'DECLARED_OBSERVATION_NORMALIZED';rows.append(result)
    report={'format':'lmps-real-normalization-1','execution_mode':'offline_analysis','source_manifest_sha256':evidence['source_manifest_sha256'],
            'mapping_sha256':digest(mapping),'review_sha256':digest(review),'schema':schema,'document_sha256':document_sha,
            'rows':rows,'counts':{'rows':len(rows),'normalized_declared':sum(r['status']!='unavailable' for r in rows),'unavailable':sum(r['status']=='unavailable' for r in rows)},
            'source_semantics':'unverified','owner_authenticated':False,'independently_verified':False,'historical_status_availability':'unverified',
            'account_identity':'unverified','canonical_emission':False,'enforcement':False}
    report['sha256']=digest(report);return report


def main():
    try:
        envelope=read_json(Path(sys.argv[1]),4*1024*1024)
        schema=schema_evidence(envelope['schema_path'])
        report=normalize(envelope['evidence'],envelope['mapping'],envelope['review'],envelope['document_sha256'],schema)
        created=publish(Path(envelope['output']),{'normalized.json':encoded(report),'mapping.json':encoded(envelope['mapping'])})
        print(__import__('json').dumps({'status':'created' if created else 'duplicate','counts':report['counts'],'structurally_compatible':schema['structurally_compatible'],'source_semantics':'unverified'}));return 0
    except Exception:
        print('SOURCE_NORMALIZATION_FAILED; private diagnostics withheld.',file=sys.stderr);return 1


if __name__=='__main__':sys.exit(main())
