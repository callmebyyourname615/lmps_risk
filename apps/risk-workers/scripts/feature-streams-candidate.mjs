/** Host-only finite Streams experiment. Importing this module performs no I/O.
 * The public default runs the pinned native topology; no runner/result injection.
 * This is candidate evidence, never a final acceptance or production decision. */
import { spawn } from 'node:child_process';
import { createHash, randomBytes } from 'node:crypto';
import { constants } from 'node:fs';
import { lstat, open, readdir, mkdir, mkdtemp, chmod, readFile, writeFile, rm, statfs } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { verifyRuntime, createRuntime, auditState, childEnvironment } from './cdc-runtime.mjs';
import { parseArguments as parseOutput, ownedFeatureProcessHandles } from './feature-stream-spike.mjs';
import { validateFeatureEnginePlan, featureEnginePlanHash, FEATURE_ENGINE_RUNTIME, FEATURE_ENGINE_SEMANTICS } from '../../../packages/contracts/dist/feature-engine-comparison.js';
import { detachFeatureJSON, validateFeatureVector } from '../../../packages/contracts/dist/feature-catalog.js';

const ROOT=fileURLToPath(new URL('../../../',import.meta.url)),MAX=2097152,LIMIT=2*1024**3;
const fail=()=>Object.assign(new Error('FEATURE_STREAMS_FAILED'),{code:'FEATURE_STREAMS_FAILED'});
const check=value=>{if(!value)throw fail();};
export const canonical=value=>JSON.stringify(value,(_k,v)=>v&&typeof v==='object'&&!Array.isArray(v)?Object.fromEntries(Object.keys(v).sort().map(k=>[k,v[k]])):v);
const hash=value=>createHash('sha256').update(value).digest('hex');
let active=false;
const helpers=new Set();
export const ownedStreamsProcessHandles=()=>Object.freeze([...ownedFeatureProcessHandles(),...[...helpers].map(h=>h.child)]);
export function parseArguments(args){try{return parseOutput(args);}catch{throw fail();}}
const exact=(v,fields)=>v&&Object.getPrototypeOf(v)===Object.prototype&&Object.keys(v).length===fields.length&&fields.every(k=>Object.hasOwn(v,k));

/** Supplement only: verifyRuntime establishes the full immutable jar inventory. */
export async function verifyStreamsArtifacts(runtime){
 try{
  check(runtime&&typeof runtime.kafka==='string');const directory=join(runtime.kafka,'libs'),s=await lstat(directory);
  check(s.isDirectory()&&!s.isSymbolicLink()&&!(s.mode&0o022));const names=await readdir(directory);
  for(const name of ['kafka-streams-4.1.2.jar','rocksdbjni-9.7.3.jar','jackson-databind-2.19.4.jar']){
   check(names.includes(name));const f=await open(join(directory,name),constants.O_RDONLY|constants.O_NOFOLLOW);
   try{const stat=await f.stat();check(stat.isFile()&&stat.uid===process.getuid()&&!(stat.mode&0o022)&&stat.nlink===1&&stat.size>0&&stat.size<=200*1024**2);}finally{await f.close();}
  }return {streams:'4.1.2',rocksdb_jni:'9.7.3'};
 }catch{throw fail();}
}
async function readOwned(path,max=MAX){
 const f=await open(path,constants.O_RDONLY|constants.O_NOFOLLOW);
 try{const s=await f.stat();check(s.isFile()&&s.nlink===1&&s.uid===process.getuid()&&!(s.mode&0o077)&&s.size<=max);return await f.readFile();}finally{await f.close();}
}
async function newDestination(path){
 parseArguments(['--output',path]);for(let p=dirname(path);;p=dirname(p)){const s=await lstat(p);check(s.isDirectory()&&!s.isSymbolicLink()&&!(s.mode&0o022));if(p===dirname(p))break;}
 try{await lstat(path);throw fail();}catch(e){if(e.code!=='ENOENT')throw e;}
}
const expectedVectors=[
 ['12','2312','12','2312','2','901','11','1411'],['12','2215','12','2215','2','901','11','1314'],
 ['12','2215','12','2215','2','901','11','1314'],['1','700','1','700','0','0','1','700'],
 ['2','2000','1','800','1','800','0','0'],['1','200','1','200','0','0','1','200'],null,['0','0','0','0','0','0','0','0'],
];
const fields=['attempt_count','attempt_amount','gross_count','gross_amount','reversed_count','reversed_amount','net_active_count','net_amount'];

/** Exact frozen cohort. Original attempts are an explicitly synthetic one-per-ID
 * projection; only its net fields have the legacy reference's established meaning.
 * Original missing-input/history queries are unsupported and are not selected. */
export async function loadFeatureEngineInput(){
 const names=['golden.json','p04-extended-golden.json'];
 const hashes=['0aeff11f 9d726b4b e9c5197c e2e15816 6b3c72a3 07c88a91 d9a7c0d3 18254f64','bed15443 c8d90219 f800b225 424570de 15f7e100 73a55bbd 28f71198 a678d20c'].map(v=>v.replaceAll(' ',''));
 const raw=await Promise.all(names.map(name=>readFile(join(ROOT,'packages/risk/test/fixtures/feature-streams',name))));
 raw.forEach((v,i)=>check(v.length<=65536&&hash(v)===hashes[i]));const [original,extended]=raw.map(v=>JSON.parse(v));
 check(original.events.length===18&&extended.deliveries.length===8);
 const selected=[0,1,4,5];const queries=selected.map((index,i)=>{
  const q=original.snapshots[index],target=original.events.find(e=>e.transaction_id===q.target);
  check(q.evidence==='available'&&q.coverage_complete===true&&target);
  return {id:`synthetic_original_${i}`,corpus:'original',key:target.sender,currency:q.currency,as_of:q.as_of,anchor_at:target.occurred_at,eligible:true};
 }).concat(extended.queries.map((q,i)=>({id:`synthetic_extended_${i}`,corpus:'extended',key:q.account_id,currency:q.currency,as_of:q.as_of,anchor_at:q.as_of,eligible:true})));
 const records=original.events.map((event,position)=>({position,corpus:'original',event})).concat(extended.deliveries.map((d,i)=>({position:18+i,corpus:'extended',event:d.revision})));
 const plan=validateFeatureEnginePlan({version:'local-synthetic-engine-comparison-1',mode:'local_synthetic',run_id:'synthetic_engine_'+randomBytes(8).toString('hex'),
  corpora:[{id:'original',version:'synthetic_golden_v1',sha256:hashes[0],records:18},{id:'extended',version:'synthetic_extended_v1',sha256:hashes[1],records:8}],
  semantics:FEATURE_ENGINE_SEMANTICS,runtime:FEATURE_ENGINE_RUNTIME,candidates:['bounded_consumer','kafka_streams'],currencies:['SYN','ALT','USD'],queries,
  policy:{identity:'synthetic_declared',availability:'available_at_lte_as_of',anchor:'explicit_occurred_at',window_seconds:3600,coverage:'explicit_fixture_only',lifecycle:'latest_available_revision',money:'integer_minor_units_no_fx',completeness:'never_arrival_derived'},
  recovery:{fault:'clean_stop_after_prefix',prefix_records:13,replay_records:13,suffix_records:13,unsupported_fault:'unclean_crash'},
  budgets:{records:2000,queries:8,partitions:1,scratch_bytes:LIMIT,evidence_bytes:16777216,invocation_ms:180000,teardown_reserve_ms:30000,process_output_bytes:MAX,state_bytes:MAX}});
 return {plan,records};
}

// Native Java computes its results from raw frozen records in a real persistent
// Kafka Streams processor store. No expected vector or TS answer enters the JVM.
export const STREAMS_JAVA_SOURCE=String.raw`import java.util.*;
import java.util.concurrent.atomic.*;
import java.nio.file.*;
import java.time.*;
import java.math.BigInteger;
import com.fasterxml.jackson.databind.*;
import org.apache.kafka.clients.producer.*;
import org.apache.kafka.common.serialization.Serdes;
import org.apache.kafka.streams.*;
import org.apache.kafka.streams.kstream.*;
import org.apache.kafka.streams.state.*;
import org.apache.kafka.streams.processor.api.*;
import org.apache.kafka.streams.errors.StreamsUncaughtExceptionHandler;
import org.rocksdb.*;
class FeatureStreamsWire {
 static final ObjectMapper JSON=new ObjectMapper();
 static final AtomicLong POSITION=new AtomicLong(-1);
 static final AtomicBoolean BAD=new AtomicBoolean(false);
 public static class BoundedRocks implements RocksDBConfigSetter {
  final Map<String,Cache> caches=new HashMap<>();
  public void setConfig(String name,Options options,Map<String,Object> config){
   Cache cache=new LRUCache(8L*1024*1024);caches.put(name,cache);
   // Keep Kafka's cache-accessible table configuration for its metrics recorder.
   BlockBasedTableConfig table=(BlockBasedTableConfig)options.tableFormatConfig();table.setBlockCache(cache);table.setBlockSize(4096);
   options.setTableFormatConfig(table);options.setWriteBufferSize(4L*1024*1024);options.setMaxWriteBufferNumber(2);
  }
  public void close(String name,Options options){Cache cache=caches.remove(name);if(cache!=null)cache.close();}
 }
 static void need(boolean b){if(!b)throw new IllegalStateException("FEATURE_STREAMS_WIRE_FAILED");}
 static void diagnose(Throwable error){for(int i=0;error!=null&&i<4;i++,error=error.getCause()){System.err.println("STREAMS_FAILURE_CLASS:"+error.getClass().getName());for(StackTraceElement f:error.getStackTrace())if(f.getClassName().startsWith("FeatureStreamsWire")||f.getClassName().startsWith("org.apache.kafka")||f.getClassName().startsWith("org.rocksdb"))System.err.println("STREAMS_FAILURE_FRAME:"+f.getClassName()+"."+f.getMethodName()+":"+f.getLineNumber());}}
 static String text(JsonNode n,String k){need(n.has(k)&&n.get(k).isTextual());return n.get(k).asText();}
 static BigInteger money(JsonNode n,String k){String s=text(n,k);need(s.matches("(0|[1-9][0-9]{0,21})\\.[0-9]{2}"));return new BigInteger(s.replace(".",""));}
 static boolean within(JsonNode e,JsonNode q,boolean original){
  String key=original?"sender":"account_id";if(!text(e,key).equals(text(q,"key"))||!text(e,"currency").equals(text(q,"currency")))return false;
  Instant t=Instant.parse(text(e,"occurred_at")),anchor=Instant.parse(text(q,"anchor_at"));
  return !Instant.parse(text(e,"available_at")).isAfter(Instant.parse(text(q,"as_of")))&&t.isAfter(anchor.minusSeconds(3600))&&!t.isAfter(anchor);
 }
 static void latest(Map<String,JsonNode> map,String key,JsonNode e){
  JsonNode old=map.get(key);if(old!=null&&old.get("revision_number").asLong()==e.get("revision_number").asLong())need(old.equals(e));
  if(old==null||old.get("revision_number").asLong()<e.get("revision_number").asLong())map.put(key,e);
 }
 static Object query(List<Map<String,Object>> stored,JsonNode q)throws Exception{
  boolean original=text(q,"corpus").equals("original");Map<String,JsonNode> payments=new TreeMap<>(),attempts=new TreeMap<>();
  for(Map<String,Object> row:stored){JsonNode wire=JSON.readTree((String)row.get("value"));if(!text(wire,"corpus").equals(text(q,"corpus")))continue;JsonNode e=wire.get("event");if(!within(e,q,original))continue;
   String payment=text(e,"namespace")+"/"+text(e,original?"transaction_id":"payment_id");latest(payments,payment,e);latest(attempts,original?payment:text(e,"namespace")+"/"+text(e,"attempt_id"),e);
  }
  List<JsonNode> selected=new ArrayList<>(attempts.values());selected.addAll(payments.values());
  if(!original)for(JsonNode e:selected){String reason=null;if(!text(e,"identity").equals("synthetic_declared"))reason="IDENTITY_UNAVAILABLE";else if(!text(e,"coverage").equals("complete"))reason="COVERAGE_INCOMPLETE";else if(text(e,"lifecycle").equals("unknown"))reason="UNKNOWN_LIFECYCLE";else if(e.get("reversed_amount").isNull())reason="UNKNOWN_REVERSAL";if(reason!=null)return Map.of("status","unavailable","reason",reason);}
  BigInteger[] v=new BigInteger[8];Arrays.fill(v,BigInteger.ZERO);
  for(JsonNode e:attempts.values()){v[0]=v[0].add(BigInteger.ONE);v[1]=v[1].add(money(e,original?"amount":"attempt_amount"));}
  for(JsonNode e:payments.values()){String status=text(e,original?"status":"lifecycle");if(status.equals("pending")||status.equals("failed"))continue;
   BigInteger gross=money(e,original?"amount":"gross_amount"),reversed=money(e,"reversed_amount"),net=gross.subtract(reversed);need(net.signum()>=0);
   v[2]=v[2].add(BigInteger.ONE);v[3]=v[3].add(gross);if(reversed.signum()>0)v[4]=v[4].add(BigInteger.ONE);v[5]=v[5].add(reversed);if(net.signum()>0)v[6]=v[6].add(BigInteger.ONE);v[7]=v[7].add(net);
  }
  String[] names={"attempt_count","attempt_amount","gross_count","gross_amount","reversed_count","reversed_amount","net_active_count","net_amount"};Map<String,String> vector=new TreeMap<>();for(int i=0;i<8;i++)vector.put(names[i],v[i].toString());return Map.of("status","available","vector",vector);
 }
 static List<Map<String,Object>> rows(ReadOnlyKeyValueStore<String,String> store){
  List<Map<String,Object>> rows=new ArrayList<>();try(KeyValueIterator<String,String> it=store.all()){while(it.hasNext()){KeyValue<String,String> kv=it.next();need(kv.key.matches("0|[1-9][0-9]{0,3}")&&Integer.parseInt(kv.key)<2000);rows.add(Map.of("position",Integer.parseInt(kv.key),"value",kv.value));need(rows.size()<=2000);}}rows.sort(Comparator.comparingInt(v->(Integer)v.get("position")));return rows;
 }
 static ReadOnlyKeyValueStore<String,String> store(KafkaStreams streams){return streams.store(StoreQueryParameters.fromNameAndType("exact-revisions",QueryableStoreTypes.keyValueStore()));}
 static void run(String[] a)throws Exception{
  need(a.length==7&&a[0].matches("127\\.0\\.0\\.1:[1-9][0-9]{3,4}")&&a[1].matches("synthetic_[a-zA-Z0-9_]+")&&a[2].matches("synthetic_[a-zA-Z0-9_]+"));
  Path inputPath=Path.of(a[4]),resultPath=Path.of(a[6]);need(Files.size(inputPath)<=2097152&&!Files.exists(resultPath));JsonNode input=JSON.readTree(Files.readString(inputPath)),records=input.get("records"),plan=input.get("plan");
  need(records.isArray()&&records.size()<=2000&&records.size()>1&&plan.get("queries").size()<=8);int prefix=plan.get("recovery").get("prefix_records").asInt(),replay=plan.get("recovery").get("replay_records").asInt();boolean first=a[5].equals("prefix");need(first||a[5].equals("final"));
  Properties p=new Properties();p.put("application.id",a[2]);p.put("bootstrap.servers",a[0]);p.put("state.dir",a[3]);p.put("num.stream.threads",1);p.put("num.standby.replicas",0);p.put("replication.factor",1);p.put("processing.guarantee","at_least_once");p.put("commit.interval.ms",100);p.put("statestore.cache.max.bytes",0);p.put("buffered.records.per.partition",2000);p.put("consumer.auto.offset.reset","earliest");p.put("consumer.session.timeout.ms",6000);p.put("consumer.heartbeat.interval.ms",1000);p.put("consumer.max.poll.interval.ms",15000);p.put("consumer.max.poll.records",2000);p.put("consumer.fetch.max.bytes",2097152);p.put("consumer.max.partition.fetch.bytes",2097152);p.put("rocksdb.config.setter",BoundedRocks.class);
  StreamsBuilder builder=new StreamsBuilder();builder.addStateStore(Stores.keyValueStoreBuilder(Stores.persistentKeyValueStore("exact-revisions"),Serdes.String(),Serdes.String()).withCachingDisabled());
  builder.stream(a[1],Consumed.with(Serdes.String(),Serdes.String())).process(()->new Processor<String,String,Void,Void>(){
   ProcessorContext<Void,Void> context;KeyValueStore<String,String> state;
   public void init(ProcessorContext<Void,Void> c){context=c;state=c.getStateStore("exact-revisions");}
   public void process(org.apache.kafka.streams.processor.api.Record<String,String> record){
    try{need(record.key()!=null&&record.value()!=null&&record.value().length()<=65536);JsonNode wire=JSON.readTree(record.value());need(wire.get("position").canConvertToInt()&&Integer.toString(wire.get("position").asInt()).equals(record.key()));need(wire.get("position").asInt()>=0&&wire.get("position").asInt()<records.size());String prior=state.get(record.key());need(prior==null||prior.equals(record.value()));state.put(record.key(),record.value());POSITION.set(context.recordMetadata().orElseThrow().offset());}
    catch(Exception e){BAD.set(true);throw new IllegalStateException("FEATURE_STREAMS_WIRE_FAILED");}
   }
  },Named.as("exact-position-revisions"),"exact-revisions");
  Topology topology=builder.build();KafkaStreams streams=new KafkaStreams(topology,p);streams.setUncaughtExceptionHandler(e->{diagnose(e);BAD.set(true);return StreamsUncaughtExceptionHandler.StreamThreadExceptionResponse.SHUTDOWN_CLIENT;});
  Map<String,Object> result=new TreeMap<>();boolean closed=false;
  try{
   streams.start();long deadline=System.nanoTime()+Duration.ofSeconds(20).toNanos();ReadOnlyKeyValueStore<String,String> state=null;
   while(System.nanoTime()<deadline&&!BAD.get()){try{if(streams.state()==KafkaStreams.State.RUNNING){state=store(streams);state.approximateNumEntries();break;}}catch(Exception ignored){}Thread.sleep(25);}if(state==null||BAD.get())System.err.println("STREAMS_FAILURE_STATE:"+streams.state().name());need(state!=null&&!BAD.get());
   List<Map<String,Object>> initial=rows(state);need(initial.size()==(first?0:prefix));
   for(int i=0;i<initial.size();i++)need(initial.get(i).get("position").equals(i)&&initial.get(i).get("value").equals(records.get(i).toString()));
   Properties producer=new Properties();producer.put("bootstrap.servers",a[0]);producer.put("key.serializer","org.apache.kafka.common.serialization.StringSerializer");producer.put("value.serializer","org.apache.kafka.common.serialization.StringSerializer");producer.put("max.block.ms",5000);producer.put("request.timeout.ms",3000);producer.put("delivery.timeout.ms",5000);producer.put("retries",0);producer.put("enable.idempotence",false);producer.put("acks","all");
   List<Integer> sent=new ArrayList<>();if(first)for(int i=0;i<prefix;i++)sent.add(i);else{for(int i=0;i<replay;i++)sent.add(i);for(int i=prefix;i<records.size();i++)sent.add(i);}
   long last=-1;try(KafkaProducer<String,String> client=new KafkaProducer<>(producer)){for(int index:sent){org.apache.kafka.clients.producer.RecordMetadata metadata=client.send(new ProducerRecord<String,String>(a[1],0,Integer.toString(index),records.get(index).toString())).get();need(metadata.partition()==0);last=metadata.offset();}}
   deadline=System.nanoTime()+Duration.ofSeconds(5).toNanos();while(POSITION.get()<last&&System.nanoTime()<deadline&&!BAD.get())Thread.sleep(10);need(POSITION.get()==last&&!BAD.get());
   List<Map<String,Object>> stored=rows(state);need(stored.size()==(first?prefix:records.size()));for(int i=0;i<stored.size();i++)need(stored.get(i).get("position").equals(i)&&stored.get(i).get("value").equals(records.get(i).toString()));
   List<Map<String,Object>> snapshots=new ArrayList<>();if(!first)for(JsonNode q:plan.get("queries"))snapshots.add(Map.of("query_id",text(q,"id"),"result",query(stored,q)));
   result.put("phase",a[5]);result.put("prefix_before",initial);result.put("rows",stored);result.put("physical_end_offset",last+1);result.put("last_processed_offset",POSITION.get());result.put("sent_records",sent.size());result.put("snapshots",snapshots);result.put("topology",topology.describe().toString());
  }finally{closed=streams.close(Duration.ofSeconds(3));}need(closed&&!BAD.get()&&streams.state()==KafkaStreams.State.NOT_RUNNING);result.put("clean_close",true);
  byte[] out=JSON.writeValueAsBytes(result);need(out.length<=2097152);Files.write(resultPath,out,StandardOpenOption.CREATE_NEW);System.out.println("STREAMS_PHASE_RECORDED");
 }
 public static void main(String[] a){try{run(a);}catch(Throwable e){diagnose(e);System.exit(1);}}
}
`;

/** Evidence validation is independent of the JVM's success marker and hash fields. */
export function validatePhaseEvidence(value,input,phase){
 try{
  const v=detachFeatureJSON(value),p=validateFeatureEnginePlan(input.plan);check(phase==='prefix'||phase==='final');
  check(Array.isArray(input.records)&&input.records.length===p.corpora.reduce((sum,c)=>sum+c.records,0)&&input.records.length<=p.budgets.records);
  input.records.forEach((row,i)=>check(row.position===i&&row.corpus===(i<p.corpora[0].records?'original':'extended')));
  check(exact(v,['phase','prefix_before','rows','physical_end_offset','last_processed_offset','sent_records','snapshots','topology','clean_close'])&&v.phase===phase&&v.clean_close===true);
  const n=phase==='prefix'?p.recovery.prefix_records:input.records.length;
  const end=phase==='prefix'?n:input.records.length+p.recovery.replay_records;
  check(v.physical_end_offset===end&&v.last_processed_offset===end-1&&v.sent_records===(phase==='prefix'?n:p.recovery.replay_records+p.recovery.suffix_records));
  check(typeof v.topology==='string'&&v.topology.length<=16384&&v.topology.includes('exact-revisions')&&v.topology.includes('exact-position-revisions'));
  function rows(actual,count){check(Array.isArray(actual)&&actual.length===count);actual.forEach((row,i)=>{check(exact(row,['position','value'])&&row.position===i&&row.value===canonical(input.records[i]));});}
  rows(v.prefix_before,phase==='prefix'?0:p.recovery.prefix_records);rows(v.rows,n);
  check(Array.isArray(v.snapshots)&&v.snapshots.length===(phase==='prefix'?0:p.queries.length));
  if(phase==='final')v.snapshots.forEach((snapshot,i)=>{
   check(exact(snapshot,['query_id','result'])&&snapshot.query_id===p.queries[i].id);
   const vector=expectedVectors[i],expected=vector===null?{status:'unavailable',reason:'UNKNOWN_REVERSAL'}:{status:'available',vector:Object.fromEntries(fields.map((f,k)=>[f,vector[k]]))};
   if(vector!==null)validateFeatureVector(snapshot.result.vector);check(canonical(snapshot.result)===canonical(expected));
  });return v;
 }catch{throw fail();}
}
async function inventory(path,relative='',out=[]){
 let s;try{s=await lstat(path);}catch(error){if(relative&&error.code==='ENOENT')return out;throw error;}check(!s.isSymbolicLink()&&s.uid===process.getuid());
 if(s.isFile()){check(s.nlink===1&&s.size<=LIMIT);out.push({name:relative,bytes:s.size});}
 else{check(s.isDirectory());let names;try{names=await readdir(path);}catch(error){if(relative&&error.code==='ENOENT')return out;throw error;}for(const name of names){check(name!=='.'&&name!=='..');await inventory(join(path,name),relative?relative+'/'+name:name,out);check(out.length<=20000);}}
 check(out.reduce((sum,row)=>sum+row.bytes,0)<=LIMIT);return out;
}
const bindingFiles=['apps/risk-workers/scripts/feature-streams-candidate.mjs','apps/risk-workers/scripts/feature-stream-spike.mjs','apps/risk-workers/scripts/cdc-runtime.mjs','apps/risk-workers/scripts/cdc-runtime-pins.json','packages/contracts/src/feature-engine-comparison.ts','packages/contracts/src/feature-catalog.ts','packages/contracts/dist/feature-engine-comparison.js','packages/contracts/dist/feature-catalog.js','packages/risk/test/fixtures/feature-streams/golden.json','packages/risk/test/fixtures/feature-streams/p04-extended-golden.json'];
async function bindings(){return Object.fromEntries(await Promise.all(bindingFiles.map(async name=>[name,hash(await readFile(join(ROOT,name)))])));}

async function bounded(promise,ms){let timer;try{return await Promise.race([promise,new Promise((_,reject)=>{timer=setTimeout(()=>reject(fail()),ms);})]);}finally{clearTimeout(timer);}}
async function stopHelper(handle){
 if(handle.closed)return;handle.child.kill('SIGTERM');
 try{await bounded(handle.done,1500);}catch{handle.child.kill('SIGKILL');await bounded(handle.done,1500);}
 check(handle.closed);
}
/** Low-level trusted process seam for unit tests, never a public CLI/runner option.
 * Streams restoration has its own finite 45s phase budget; global trial is 180s. */
export async function executeStreamsHelper(runtime,args,cwd,timeout=45000,maxBytes=MAX,spawner=spawn){
 check(Number.isSafeInteger(timeout)&&timeout>0&&timeout<=45000&&Number.isSafeInteger(maxBytes)&&maxBytes>0&&maxBytes<=MAX);
 let child;const mask=process.umask(0o077);
 try{child=spawner(runtime.java,['-Xms32m','-Xmx128m','-XX:+ExitOnOutOfMemoryError','--class-path',join(runtime.kafka,'libs','*'),...args],{cwd,env:childEnvironment(runtime),shell:false,stdio:['ignore','pipe','pipe']});}catch{throw fail();}finally{process.umask(mask);}
 const h={child,closed:false,bad:false,bytes:0,stdout:'',tail:'',diagnostics:new Set()};helpers.add(h);
 h.done=new Promise(done=>{child.once('error',()=>{h.bad=true;});child.once('close',code=>{h.closed=true;h.code=code;helpers.delete(h);done();});});
 for(const stream of [child.stdout,child.stderr])stream?.on('data',chunk=>{
  h.bytes+=chunk.length;if(h.bytes>maxBytes){h.bad=true;void stopHelper(h).catch(()=>{});return;}
  if(stream===child.stdout)h.stdout+=chunk.toString('utf8');
  else{h.tail=(h.tail+chunk.toString('utf8')).slice(-4096);for(const match of h.tail.matchAll(/STREAMS_FAILURE_(?:CLASS|FRAME|STATE):[A-Za-z0-9_$.]+(?::[0-9]{1,4})?/g))if(h.diagnostics.size<32)h.diagnostics.add(match[0]);}
 });
 try{await bounded(h.done,timeout);check(!h.bad&&h.code===0);return {stdout:h.stdout,output_bytes:h.bytes,diagnostics:[...h.diagnostics]};}
 catch{throw Object.assign(fail(),{diagnostics:[...h.diagnostics]});}finally{await stopHelper(h);}
}

export async function runFeatureStreamsCandidate(options){
 let runtime,scratch,output,created=false,timer,monitor,pending=Promise.resolve(),aborted=false,claimed=false,result,stage='input';
 const diagnostics=new Set();
 const started=Date.now(),deadline=started+150000;let peak=0,processBytes=0;
 const budget=()=>check(!aborted&&Date.now()<deadline);
 const interrupt=()=>{aborted=true;for(const h of ownedStreamsProcessHandles())h.kill('SIGTERM');};
 const resources=async()=>{let bytes=0;for(const path of [runtime?.base,scratch,created?output:null].filter(Boolean)){await auditState(path);bytes+=(await inventory(path)).reduce((sum,row)=>sum+row.bytes,0);}check(bytes<=LIMIT);peak=Math.max(peak,bytes);};
 try{
  const o=detachFeatureJSON(options);check(exact(o,['output']));({output}=parseArguments(['--output',o.output]));
  check(!active&&ownedStreamsProcessHandles().length===0);active=true;claimed=true;
  await newDestination(output);const disk=await statfs(ROOT);check(Number(disk.bavail)*Number(disk.bsize)>=6*1024**3);
  const before=await bindings(),input=await loadFeatureEngineInput();budget();stage='runtime';const verified=await verifyRuntime();await verifyStreamsArtifacts(verified);
  await mkdir(output,{mode:0o700});created=true;scratch=await mkdtemp(join(ROOT,'.local/streams-scratch-'));await chmod(scratch,0o700);
  await writeFile(join(scratch,'FeatureStreamsWire.java'),STREAMS_JAVA_SOURCE,{flag:'wx',mode:0o600});await writeFile(join(scratch,'input.json'),canonical(input),{flag:'wx',mode:0o600});await mkdir(join(scratch,'state'),{mode:0o700});
  process.on('SIGINT',interrupt);process.on('SIGTERM',interrupt);timer=setTimeout(interrupt,Math.max(1,deadline-Date.now()));timer.unref();
  monitor=setInterval(()=>{pending=pending.then(async()=>{try{budget();await resources();}catch{interrupt();}});},250);monitor.unref();
  stage='broker';runtime=await createRuntime();await runtime.startKafka();budget();const topic=input.plan.run_id;stage='topic';await runtime.cli('createTopic',{topic});const setup=Date.now()-started;
  const phases=[];
  for(const phase of ['prefix','final']){
   stage='java-'+phase;budget();
   const path=join(output,'phase-'+phase+'.json'),phaseStart=Date.now();
   const executed=await executeStreamsHelper(verified,[join(scratch,'FeatureStreamsWire.java'),`127.0.0.1:${runtime.brokerPort}`,topic,topic+'_app',join(scratch,'state'),join(scratch,'input.json'),phase,path],scratch,Math.min(45000,deadline-Date.now()),MAX-processBytes);
   processBytes+=executed.output_bytes;check(executed.stdout==='STREAMS_PHASE_RECORDED\n'&&processBytes<=MAX);budget();
   stage='evidence-'+phase;const raw=await readOwned(path),data=validatePhaseEvidence(JSON.parse(raw),input,phase);phases.push({phase,sha256:hash(raw),bytes:raw.length,elapsed_ms:Date.now()-phaseStart,data});
   await resources();
  }
  check(canonical(phases[0].data.rows)===canonical(phases[1].data.prefix_before));
  stage='native-state';const stateFiles=await inventory(join(scratch,'state'));check(stateFiles.some(row=>row.name.endsWith('/CURRENT'))&&stateFiles.some(row=>row.name.endsWith('.sst'))&&stateFiles.reduce((sum,row)=>sum+row.bytes,0)<=input.plan.budgets.state_bytes);
  const nativeState=[];for(const row of stateFiles){check(row.bytes<=MAX);nativeState.push({...row,sha256:hash(await readOwned(join(scratch,'state',row.name)))});}
  const processing=Date.now()-started-setup;await verifyRuntime();await verifyStreamsArtifacts(verified);const after=await bindings();check(canonical(before)===canonical(after));budget();
  result={version:1,candidate:'kafka_streams',scope:'local_synthetic',production_ready:false,acceptance:'pending_parent_comparison',plan:input.plan,plan_sha256:featureEnginePlanHash(input.plan),source_hashes:before,java_source_sha256:hash(STREAMS_JAVA_SOURCE),
   phases:phases.map(({data,...rest})=>rest),logical_records:input.records.length,physical_records:input.records.length+input.plan.recovery.replay_records,input_partitions:1,source_state_sha256:hash(canonical(phases[1].data.rows)),native_state_files:nativeState,
   observations:{setup_ms:setup,phase_ms:processing,process_output_bytes:processBytes,peak_scratch_bytes:peak},
   limitations:['clean_stop_restart_only','no_unclean_crash_or_ttl_admission_proof','original_attempt_gross_projection_is_synthetic_only','original_missing_input_and_incomplete_history_queries_not_selected','no_real_identity_capacity_slo_or_engine_adoption']};
 }catch(error){for(const code of error.diagnostics??[])if(diagnostics.size<32)diagnostics.add(code);result=null;throw fail();}
 finally{
  if(claimed){clearTimeout(timer);clearInterval(monitor);await pending;let bad=false;try{await runtime?.dispose();}catch{bad=true;}
   if(ownedStreamsProcessHandles().length)bad=true;
   if(!bad&&scratch)try{await auditState(scratch);await rm(scratch,{recursive:true});}catch{bad=true;}
   process.off('SIGINT',interrupt);process.off('SIGTERM',interrupt);active=false;
   if(!result||bad){if(created)try{await writeFile(join(output,'failure.json'),canonical({version:1,code:'FEATURE_STREAMS_FAILED',stage,diagnostics:[...diagnostics],cleanup_verified:!bad,production_ready:false}),{flag:'wx',mode:0o600});}catch{}if(bad)throw fail();}
  }
 }
 check(result&&ownedStreamsProcessHandles().length===0&&Date.now()-started<=180000);
 check(canonical(await bindings())===canonical(result.source_hashes));
 result.observations.elapsed_ms=Date.now()-started;result.owned_processes=0;const text=canonical(result);check(Buffer.byteLength(text)+result.phases.reduce((sum,row)=>sum+row.bytes,0)<=16777216);
 await writeFile(join(output,'candidate-receipt.json'),text,{flag:'wx',mode:0o600});return result;
}

if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 try{await runFeatureStreamsCandidate(parseArguments(process.argv.slice(2)));process.stdout.write('FEATURE_STREAMS_CANDIDATE_RECORDED\n');}
 catch{process.stderr.write('FEATURE_STREAMS_FAILED\n');process.exitCode=1;}
}
