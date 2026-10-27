"""Invented streaming export bundles, never production rows."""
from datetime import datetime, timedelta
import gzip
from hashlib import sha256
import json
import os
from pathlib import Path
import tempfile
import unittest

from test_dataset_pilot import write_bundle, pilot, export
import dataset_bulk as bulk


def write_source(path, rows=12, per_window=6, mutate=None):
    path.mkdir(mode=0o700)
    start = datetime(2026, 10, 1)
    count = (rows + per_window - 1) // per_window
    windows = []
    for window in range(count):
        begin, end = start + timedelta(hours=window), start + timedelta(hours=window+1)
        name = f"transfer_{begin:%Y%m%d_%H%M}_{end:%Y%m%d_%H%M}.tsv.gz"
        digest, size = sha256(), 0
        total = min(per_window, rows - window * per_window)
        with gzip.open(path / name, "xb", compresslevel=1) as stream:
            stream.write(export.HEADER); digest.update(export.HEADER); size += len(export.HEADER)
            for i in range(total):
                row = {key: None for key in export.COLUMNS}
                row.update(id=i+1,requesttime=str(begin),txtime=str(begin),reference="INVENTED_REFERENCE",
                           frommember="INVENTED_BANK_A",tomember="INVENTED_BANK_B",totype="INVENTED_TYPE",
                           amount=f"{1000+i//100}.{i%100:02d}",ccy="SYN",result="INVENTED_STATUS",isreconciled=0,issettled=0)
                if mutate: mutate(row,i,window)
                line=export.row_bytes(json.dumps(row),str(begin),str(end))
                stream.write(line);digest.update(line);size+=len(line)
        (path/name).chmod(0o600)
        windows.append({"record":"window","file":name,"status":"complete","start_inclusive":str(begin),"end_exclusive":str(end),
                        "rows":total,"tsv_bytes":size,"gzip_bytes":(path/name).stat().st_size,"tsv_sha256":digest.hexdigest(),"gzip_sha256":export.file_sha256(path/name)})
    size=sum(w['tsv_bytes'] for w in windows)
    metadata={"record":"dataset","format":"lmps-transfer-escaped-tsv-gzip-1","source_table":"transfer","columns":list(export.COLUMNS),
              "target_tsv_bytes":size,"requested_start_inclusive":str(start),"requested_end_exclusive":str(start+timedelta(hours=count))}
    summary={"record":"summary","status":"target_reached","completed_windows":count,"rows":rows,"tsv_bytes":size,
             "gzip_bytes":sum(w['gzip_bytes'] for w in windows),"completed_end_exclusive":metadata['requested_end_exclusive']}
    pilot.write_private(path/'manifest.jsonl',b''.join(pilot.encoded(x) for x in [metadata,*windows,summary]))
    return summary


class BulkPreparationTests(unittest.TestCase):
    def setUp(self):
        self.temp=tempfile.TemporaryDirectory(prefix='lmps-bulk-files-');self.addCleanup(self.temp.cleanup)
        self.root=Path(self.temp.name);self.source=self.root/'source';self.output=self.root/'prepared'

    def test_multiwindow_keys_use_id_and_requesttime_and_exact_retry(self):
        write_source(self.source)
        first=bulk.prepare(self.source,self.output,10)
        plan=bulk.verify_prepared(self.output)
        self.assertEqual(first['rows'],10)
        self.assertEqual(plan['source_rows'],12)
        self.assertEqual(plan['source_windows'],2)
        self.assertEqual(plan['duplicate_rows'],0)
        self.assertEqual(bulk.prepare(self.source,self.output,10)['publication'],'duplicate')
        with self.assertRaises(Exception):bulk.prepare(self.source,self.output,9)
        self.assertFalse((self.output/'index.sqlite').exists())

    def test_identical_duplicate_and_full_source_conflict_even_outside_projection(self):
        def duplicate(row,i,window):
            if i==1:row.update(id=1,amount='1000.00')
        write_source(self.source,rows=3,per_window=3,mutate=duplicate)
        bulk.prepare(self.source,self.output,3)
        self.assertEqual(bulk.verify_prepared(self.output)['duplicate_rows'],1)
        other=self.root/'conflict'
        def conflict(row,i,window):
            duplicate(row,i,window)
            if i==1:row['reference']='CHANGED_PRIVATE_REFERENCE'
        write_source(other,rows=3,per_window=3,mutate=conflict)
        with self.assertRaisesRegex(ValueError,'BULK_SOURCE_KEY_CONFLICT'):bulk.prepare(other,self.root/'rejected',3)
        self.assertFalse((self.root/'rejected').exists())

    def test_disk_index_deduplicates_after_a_staging_chunk_boundary(self):
        def duplicate(row,i,window):
            if i==25000:row.update(id=1,amount='1000.00')
        write_source(self.source,rows=25002,per_window=25002,mutate=duplicate)
        bulk.prepare(self.source,self.output,25002)
        plan=bulk.verify_prepared(self.output)
        self.assertEqual(plan['unique_rows'],25001)
        self.assertEqual([x['input']['expected_rows'] for x in plan['chunks']],[25000,1])

    def test_v2_keeps_accounts_out_of_prepared_projection_and_console_metrics(self):
        write_bundle(self.source)
        result=bulk.prepare(self.source,self.output,1000)
        plan=bulk.verify_prepared(self.output)
        self.assertEqual(plan['source_format'],export.PILOT_FORMAT)
        self.assertEqual(plan['unique_rows'],3)
        data=b''.join(p.read_bytes() for p in self.output.iterdir())
        for marker in (b'SYNTHETIC_PRIVATE_ACCOUNT',b'SYNTHETIC_PRIVATE_QR',b'fromaccount',b'toaccount'):
            # Source manifest contains column declarations; source account VALUES never appear.
            if marker in (b'fromaccount',b'toaccount'):continue
            self.assertNotIn(marker,data)
            self.assertNotIn(marker.decode(),json.dumps(result))

    def test_tampered_prepared_and_later_unselected_source_file_are_rejected(self):
        write_source(self.source)
        bulk.prepare(self.source,self.output,2)
        csv=self.output/'chunk-00000.csv';csv.write_bytes(csv.read_bytes()+b'changed')
        with self.assertRaises(Exception):bulk.verify_prepared(self.output)
        last=sorted(self.source.glob('*.gz'))[-1];last.write_bytes(last.read_bytes()+b'corrupt')
        with self.assertRaises(Exception):bulk.prepare(self.source,self.root/'other',2)

    def test_limits_permissions_links_and_partial_outputs_never_overwrite(self):
        write_source(self.source)
        for maximum in (0,1000001):
            with self.assertRaises(Exception):bulk.prepare(self.source,self.output,maximum)
        first=next(self.source.glob('*.gz'));first.chmod(0o644)
        with self.assertRaises(Exception):bulk.prepare(self.source,self.output,1)
        first.chmod(0o600)
        self.output.mkdir(mode=0o700)
        with self.assertRaises(Exception):bulk.prepare(self.source,self.output,1)
        self.assertEqual(list(self.output.iterdir()),[])
        with self.assertRaises(Exception):bulk.prepare(self.source,self.source/'child',1)


if __name__=='__main__':unittest.main()
