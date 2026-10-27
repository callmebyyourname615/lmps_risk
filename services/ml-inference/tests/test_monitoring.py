from lmps_ml.monitoring import ShadowMetrics


def test_monitoring_is_process_scoped_aggregate_and_drift_stays_unavailable_until_supported():
    metrics=ShadowMetrics({'cuts':list(range(1,10)),'counts':[10]*10,'rows':100,'feature':'log1p_net_amount'})
    assert metrics.snapshot()['latency_ms']['mean'] is None
    assert metrics.snapshot()['feature_drift']['value'] is None
    for _ in range(50):metrics.completion({'reason_code':'MODEL_SCORED','status':'available','probabilities':{'fraud':'0.200000000'}},{'snapshot':{'values':['100.000000000']}},3)
    metrics.response('503_timeout');report=metrics.snapshot()
    assert report['scoring_completions']==50 and report['feature_drift']['value']>0.2
    assert report['http_response_counts']=={'503_timeout':1} and report['performance_labels_available'] is False
    assert 'values' not in str(report) and 'target' not in str(report)
