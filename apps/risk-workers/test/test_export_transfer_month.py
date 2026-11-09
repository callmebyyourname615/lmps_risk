"""Real gzip/client subprocesses and a mocked SSH transport, using invented rows only."""

import contextlib
from datetime import datetime, timedelta
import gzip
from hashlib import sha256
import importlib.util
import io
import json
import os
from pathlib import Path
import shutil
import sys
import tempfile
from types import SimpleNamespace
import unittest
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "scripts"))
import export_month as month
import export_transfer as export

START = datetime(2026, 10, 1)


class MonthExportTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(prefix="lmps-month-export-test-")
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name).resolve()
        self.root.chmod(0o700)
        self.config = self.root / "fixture.json"
        self.client = self.root / "mariadb"
        self.credentials = self.root / "client.cnf"
        self.credentials.write_text("[client]\npassword=INVENTED_ONLY\n")
        self.credentials.chmod(0o600)
        self.client.write_text("#!" + sys.executable + "\n" + '''
import json,pathlib,re,sys,time
root=pathlib.Path(__file__).parent
c=json.loads((root/'fixture.json').read_text())
args=sys.argv[1:]
sql=next(a.split('=',1)[1] for a in args if a.startswith('--execute='))
with (root/'calls.jsonl').open('a') as log:log.write(json.dumps({'sql':sql,'headers':'--column-names' in args,'database':[a for a in args if a.startswith('--database=')]})+'\\n')
columns=c['columns']
if sql.startswith('SHOW COLUMNS'):
 print('Field\\tType\\tNull')
 for name in columns:print(name+'\\tvarchar(5000)\\tYES')
elif sql.startswith('SHOW INDEX'):
 print('Key_name\\tColumn_name\\tSeq_in_index');print('time_idx\\trequesttime\\t1')
elif sql.startswith('EXPLAIN PARTITIONS'):
 print('type\\tkey');print(c.get('plan','range')+'\\ttime_idx')
else:
 if c.get('mode')=='hang':time.sleep(60)
 if c.get('mode')=='oversize':print('x'*70000);time.sleep(60)
 stamp=re.search(r">= '([^']+)'",sql).group(1)
 for i in range(c.get('count',3)):
  row={n:None for n in columns}
  row.update(id=i+1,requesttime=stamp,txtime=stamp,reference='INVENTED_REFERENCE',frommember='0001',tomember='0002',totype='INVENTED_TYPE',amount='100.00',ccy='SYN',result='OK',isreconciled=0,issettled=0)
  if 'fromaccount' in row:row['fromaccount']='INVENTED_PRIVATE_ACCOUNT'
  if 'toaccount' in row:row['toaccount']='0000000123'
  print(json.dumps(row),flush=True)
 if c.get('mode')=='failed':sys.exit(7)
''')
        self.client.chmod(0o700)
        self.configure()

    def configure(self, **changes):
        self.config.write_text(json.dumps({"columns": list(export.PILOT_COLUMNS), **changes}))

    def window(self, **changes):
        self.configure(**changes)
        directory = self.root / "bundle"
        directory.mkdir(mode=0o700)
        month.preflight(str(self.client), [], self.credentials, "transfer", START, START + export.HOUR)
        return directory, month.export_window(str(self.client), [], self.credentials, "transfer", directory, START, START + export.HOUR, 0)

    def complete_bundle(self):
        directory = self.root / "complete"
        directory.mkdir(mode=0o700)
        start, end = month.month_bounds("2026-10")
        columns = list(export.PILOT_COLUMNS)
        header = ("\t".join(columns) + "\n").encode()
        records = [{"record": "dataset", "format": month.VERSION, "month": "2026-10", "source_table": "transfer",
            "columns": columns, "requested_start_inclusive": str(start), "requested_end_exclusive": str(end),
            "window_seconds": 3600, "chunk_bytes": month.CHUNK_BYTES}]
        cursor, parts, size, compressed = start, 0, 0, 0
        while cursor < end:
            name = f"part-{parts:05d}.tsv.gz"
            data = gzip.compress(header, mtime=0)
            path = directory / name
            path.write_bytes(data)
            path.chmod(0o600)
            records.append({"record": "window", "start_inclusive": str(cursor), "end_exclusive": str(cursor+export.HOUR),
                "files": [{"file": name, "rows": 0, "tsv_bytes": len(header), "gzip_bytes": len(data),
                           "tsv_sha256": sha256(header).hexdigest(), "gzip_sha256": sha256(data).hexdigest()}]})
            parts += 1; size += len(header); compressed += len(data); cursor += export.HOUR
        records.append({"record": "summary", "status": "range_complete", "completed_windows": parts,
            "completed_end_exclusive": str(end), "files": parts, "rows": 0, "tsv_bytes": size, "gzip_bytes": compressed})
        manifest = directory / "manifest.jsonl"
        manifest.write_bytes(b"".join((json.dumps(r)+'\n').encode() for r in records))
        manifest.chmod(0o600)
        return directory

    def test_real_subprocess_split_gzip_preserves_all_22_fields_and_exact_window(self):
        with patch.object(month, "CHUNK_BYTES", 1024):
            directory, window = self.window(count=20)
            self.assertGreater(len(window["files"]), 1)
            self.assertEqual(sum(p["rows"] for p in window["files"]), 20)
            for part in window["files"]:
                month.verify_chunk(directory/part["file"], part, month.columns_for("transfer"), str(START), str(START+export.HOUR))
                self.assertEqual((directory/part["file"]).stat().st_mode & 0o077, 0)
            calls = [json.loads(line) for line in (self.root/"calls.jsonl").read_text().splitlines()]
            sql = calls[-1]["sql"]
            self.assertTrue(sql.startswith('SET STATEMENT max_statement_time=60 FOR SELECT'))
            self.assertNotIn('LIMIT',sql)
            self.assertNotIn('OFFSET',sql)
            self.assertNotIn('UNION',sql)
            self.assertIn("<  '2026-10-01 01:00:00'", sql)
            self.assertTrue(all(c["headers"] for c in calls[:-1]))
        self.assertFalse(list(directory.glob('.pending-window-*')))

    def test_failed_timed_out_oversize_or_unsafe_reads_do_not_publish_chunks(self):
        self.configure(plan="ALL")
        with self.assertRaises(Exception):
            month.preflight(str(self.client), [], self.credentials, "transfer", START, START+export.HOUR)
        for i, mode in enumerate(("failed", "oversize", "hang")):
            self.configure(mode=mode)
            directory=self.root/str(i);directory.mkdir(mode=0o700)
            with patch.object(month,"CLIENT_SECONDS",0.2), self.assertRaises(Exception):
                month.export_window(str(self.client), [], self.credentials, "transfer", directory, START, START+export.HOUR,0)
            self.assertEqual(list(directory.iterdir()), [])

    def test_month_calendar_full_744_hour_manifest_and_offline_tamper_refusal(self):
        self.assertEqual(month.month_bounds("2026-10"), (START,datetime(2026,11,1)))
        for value in ("2026-13", "2026-10-01", "0000-01", "9999-12"):
            with self.assertRaises(Exception):month.month_bounds(value)
        directory=self.complete_bundle()
        metadata,windows,summary=month.verify_month(directory)
        self.assertEqual(len(windows),744)
        self.assertEqual(summary['status'],'range_complete')
        self.assertEqual(summary['rows'],0)
        self.assertEqual(month.readiness_plan(directory)['files'][0]['expected_rows'],0)
        path=directory/'part-00000.tsv.gz';path.write_bytes(path.read_bytes()+b'changed')
        with self.assertRaises(Exception):month.verify_month(directory)

    def test_month_orchestration_and_partial_failure_never_claim_complete(self):
        with patch.object(month,'month_bounds',return_value=(START,START+2*export.HOUR)), contextlib.redirect_stdout(io.StringIO()):
            directory,summary=month.export_month(str(self.client),[],self.credentials,self.root,'2026-10',pause=0)
            self.assertEqual(summary['completed_windows'],2)
            self.assertEqual(summary['rows'],6)
            self.assertEqual(month.verify_month(directory)[2],summary)
        self.configure(mode='failed')
        with patch.object(month,'month_bounds',return_value=(START,START+2*export.HOUR)), contextlib.redirect_stdout(io.StringIO()), self.assertRaises(Exception):
            month.export_month(str(self.client),[],self.credentials,self.root,'2026-10',pause=0)
        rejected=[p for p in self.root.glob('lmps-month-*') if p!=directory][0]
        records=[json.loads(line) for line in (rejected/'manifest.jsonl').read_text().splitlines()]
        self.assertEqual(records[-1]['status'],'interrupted_or_failed')

    def test_history_projection_database_selection_and_injection_refusal(self):
        self.assertEqual(len(month.columns_for('transfer_hist')),21)
        self.assertNotIn('fromchannel',month.columns_for('transfer_old'))
        self.assertIn('FROM `transfer_hist`',month.query('transfer_hist',START,START+export.HOUR))
        command=month.client_command(str(self.client),['--database=review_copy'],self.credentials,'SELECT 1;')
        self.assertEqual([a for a in command if a.startswith('--database=')],['--database=review_copy'])
        with self.assertRaises(Exception):month.query('transfer;DROP TABLE',START,START+export.HOUR)
        with self.assertRaises(Exception):month.client_command(str(self.client),['--database=bad;sql'],self.credentials,'SELECT 1;')

    def test_cli_uses_supplied_connection_and_one_hidden_password_without_printing_it(self):
        output=io.StringIO()
        with patch.object(month.shutil,'which',return_value=str(self.client)), \
             patch.object(month.sys.stdin,'isatty',return_value=True), \
             patch.object(month,'month_bounds',return_value=(START,START+export.HOUR)), \
             patch.object(month.getpass,'getpass',return_value='INVENTED_HIDDEN_VALUE') as hidden, \
             patch('builtins.input',side_effect=AssertionError('Connection already supplied')), \
             contextlib.redirect_stdout(output):
            code=month.main(['--month','2026-10','--table','transfer','--db-host','synthetic.invalid',
                '--db-port','43307','--db-user','synthetic_reader','--database','review_copy',
                '--output-root',str(self.root),'--pause-seconds','0'])
        self.assertEqual(code,0)
        hidden.assert_called_once()
        self.assertNotIn('INVENTED_HIDDEN_VALUE',output.getvalue())
        calls=[json.loads(line) for line in (self.root/'calls.jsonl').read_text().splitlines()]
        self.assertTrue(all(c['database']==['--database=review_copy'] for c in calls))

    def test_mac_fetch_argument_vector_verifies_before_creating_plan_and_never_deletes_source(self):
        directory=self.complete_bundle()
        spec=importlib.util.spec_from_file_location('fetch_month',Path(__file__).resolve().parents[3]/'tools/fetch-lmps-month.py')
        fetch=importlib.util.module_from_spec(spec);spec.loader.exec_module(fetch)
        source_hash=export.file_sha256(directory/'manifest.jsonl')
        calls=[]
        def transport(args,**kwargs):
            calls.append(args)
            shutil.copytree(directory,args[-1],dirs_exist_ok=True)
            return SimpleNamespace(returncode=0)
        with patch.object(fetch.subprocess,'run',transport):
            destination=fetch.fetch('synthetic-export','/home/synthetic/bundle',self.root/'downloads')
        self.assertEqual(calls[0][:5],['scp','-p','-r','--','synthetic-export:/home/synthetic/bundle/.'])
        plan=json.loads((destination/'readiness-plan.json').read_text())
        self.assertEqual(plan['month'],'2026-10')
        self.assertEqual(len(plan['files']),744)
        self.assertEqual((destination/'readiness-plan.json').stat().st_mode & 0o077,0)
        self.assertEqual(export.file_sha256(directory/'manifest.jsonl'),source_hash)
        for host,remote in [('bad;host','/tmp/export'),('good','/tmp/../private'),('-bad','/tmp/export')]:
            with patch.object(fetch.subprocess,'run',side_effect=AssertionError('No transport')),self.assertRaises(Exception):
                fetch.fetch(host,remote,self.root/'unused')


if __name__=='__main__':unittest.main()
