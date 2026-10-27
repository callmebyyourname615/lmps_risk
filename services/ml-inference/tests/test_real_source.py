from copy import deepcopy
from hashlib import sha256
import pytest
from lmps_ml.real_source import normalize,major,utc_time
from lmps_ml.private import digest


def fixture():
    selector=dict(result='SYN_OK',txtype=None,totype='SYN',shouldrevert=None,isreconciled='0',issettled='0')
    row={**selector,'ccy':'SYN','amount':'9007199254740993.00','fee':None,'txtime':'2026-01-01 07:00:00','requesttime':'2026-01-01 07:00:01',
         'source_row_sha256':'c'*64,'row_number':1,'originalreference_presence':'null'}
    evidence={'source_manifest_sha256':'a'*64,'records':[row]};doc=sha256(b'Invented fixture codebook').hexdigest()
    mapping={'source_manifest_sha256':'a'*64,'status':'owner_declared','evidence':{'sha256':doc},'lifecycle':[{'source':selector,'operation':'payment','state':'succeeded'}],
             'currencies':[{'source_ccy':'SYN','currency':'SYN','amount_unit':'major','fee_unit':'major'}],'time':{'field':'txtime','meaning':'business_occurrence','timezone':'+07:00'}}
    schema={'ddl_sha256':'b'*64,'structurally_compatible':True}
    review={'format':1,'mapping_sha256':digest(mapping),'ddl_sha256':'b'*64,'document_sha256':doc,'reviewer_ref':'synthetic_reviewer',
            'reviewed_at':'2026-02-01T00:00:00Z','snapshot_observed_at':'2026-01-02T00:00:00Z','currency_exponents':{'SYN':2}}
    return evidence,mapping,review,doc,schema


def test_declaration_bound_normalization_preserves_precision_availability_and_unknown_identity():
    args=fixture();result=normalize(*args);row=result['rows'][0]
    assert row['amount']=='9007199254740993.00' and row['fee'] is None
    assert row['source_time_utc']=='2026-01-01T00:00:00.000Z' and row['availability_kind']=='operator_declared_snapshot'
    assert row['target'] is None and row['net_executed_amount'] is None
    assert result['independently_verified'] is False and result['canonical_emission'] is False
    assert normalize(args[0],args[1],None,None,args[4])['counts']['unavailable']==1


def test_wrong_evidence_reversal_reference_and_unmapped_codes_never_produce_verified_execution():
    evidence,mapping,review,doc,schema=fixture()
    with pytest.raises(ValueError):normalize(evidence,mapping,review,'d'*64,schema)
    evidence['records'][0]['result']='syn_ok';assert normalize(evidence,mapping,review,doc,schema)['rows'][0]['amount'] is None
    args=list(fixture());args[1]['lifecycle'][0]['operation']='reversal';args[2]['mapping_sha256']=digest(args[1]);assert normalize(*args)['rows'][0]['reason_code']=='REVERSAL_LINKAGE_UNVERIFIED'
    args=list(fixture());args[0]['records'][0]['originalreference_presence']='present';assert normalize(*args)['rows'][0]['reason_code']=='BUSINESS_LINKAGE_UNVERIFIED'


def test_minor_units_and_dst_are_explicit_and_never_rounded_or_guessed():
    assert major('12300.00','minor',2)=='123.00'
    with pytest.raises(ValueError):major('123.01','minor',2)
    with pytest.raises(ValueError):major('123.00','minor',None)
    with pytest.raises(ValueError):utc_time('2026-11-01 01:30:00','America/New_York')
    with pytest.raises(ValueError):utc_time('2026-03-08 02:30:00','America/New_York')
