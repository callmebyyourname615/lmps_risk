"""No.51: process-scoped aggregate monitoring; no raw inputs or detection-quality claims."""
from bisect import bisect_right
from collections import Counter
from datetime import datetime,timezone
import math
from threading import Lock


class ShadowMetrics:
    def __init__(self,reference=None):
        self.lock=Lock();self.started=datetime.now(timezone.utc).isoformat();self.reasons=Counter();self.http=Counter()
        self.count=0;self.total_ms=0.;self.max_ms=0.;self.latency=[0]*4;self.feature=[0]*10
        self.probabilities={task:[0]*10 for task in ('fraud','mule_network','aml')};self.reference=reference

    def response(self,code):
        with self.lock:self.http[code]+=1

    def completion(self,result,value,elapsed):
        with self.lock:
            self.count+=1;self.total_ms+=elapsed;self.max_ms=max(self.max_ms,elapsed);self.latency[bisect_right([5,25,100],elapsed)]+=1
            self.reasons[result['reason_code']]+=1
            if result['status']=='available':
                if self.reference:self.feature[bisect_right(self.reference['cuts'],float(value['snapshot']['values'][0]))]+=1
                for task,p in result['probabilities'].items():self.probabilities[task][min(9,int(float(p)*10))]+=1

    def snapshot(self):
        with self.lock:
            observed=sum(self.feature);drift={'status':'unavailable','reason_code':'REFERENCE_NOT_CONFIGURED' if self.reference is None else 'INSUFFICIENT_OBSERVATIONS','value':None,'rows':observed}
            if self.reference and observed>=50:
                expected=self.reference['counts'];total=sum(expected);epsilon=1e-6
                psi=sum((max(n/observed,epsilon)-max(e/total,epsilon))*math.log(max(n/observed,epsilon)/max(e/total,epsilon)) for n,e in zip(self.feature,expected))
                drift={'status':'available','meaning':'population_stability_index_not_detection_accuracy','value':psi,'rows':observed}
            return {'format':'lmps-shadow-metrics-1','scope':'synthetic_shadow_only','process_started_at':self.started,'scoring_completions':self.count,
                    'reason_counts':dict(self.reasons),'http_response_counts':dict(self.http),'latency_ms':{'mean':None if not self.count else self.total_ms/self.count,'max':None if not self.count else self.max_ms,'buckets_le_5_le_25_le_100_over_100':list(self.latency)},
                    'probability_histograms':{k:list(v) for k,v in self.probabilities.items()},'feature_drift':drift,'performance_labels_available':False,'enforcement':False}
