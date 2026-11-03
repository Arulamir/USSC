const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const load=name=>fs.readFileSync(path.join(__dirname,name),'utf8');
const ug=load('UG65_status_relay.txt'),cache=load('MiniPC_cache_status.txt'),api=load('MiniPC_API_status.txt');
let now=Date.parse('2026-11-03T03:00:00Z');
const FakeDate=class extends Date{constructor(...args){super(...(args.length?args:[now]));}static now(){return now;}};
const values=new Map();const flow={get:(k,s)=>values.get((s||'default')+':'+k),set:(k,v,s)=>values.set((s||'default')+':'+k,v)};
const key='test-only-key-123456789012345678901234';
const run=(code,msg)=>new Function('msg','flow','node','Date','Buffer','env',code)(msg,flow,{status(){}},FakeDate,Buffer,{get:k=>k==='OFFICE_CONTROL_KEY'?key:null});
const meters=['24E1247710630110','24E124771063F466','24E1247710633F88','24E1247710638799'];
function publish(msg){const packet=run(ug,msg);assert.equal(packet.topic,'office1/monitoring/relays');run(cache,packet);return packet;}
function read(){return run(api,{req:{socket:{remoteAddress:'100.86.6.76'},headers:{authorization:'Bearer '+key}},res:{}});}
assert.equal(read().statusCode,200);assert.equal(read().payload.data.ac,null);
for(const eui of meters)publish({deveui:eui,payload:{switch_1:'on',switch_2:'on',active_power:0}});
let result=read();assert.equal(result.payload.data.relays.records.length,4);
assert.equal(result.payload.data.relays.records[0].switch_1,'on');
const stamp=result.payload.data.relays.records[0].switch_1_at_utc;
now+=10*60000;publish({topic:'relay_status_tick'});
assert.equal(read().payload.data.relays.records[0].switch_1_at_utc,stamp,'Heartbeat never refreshes measurement time');
publish({deveui:meters[0],payload:{active_power:1642}});
assert.equal(read().payload.data.relays.records[0].switch_1_at_utc,stamp,'Power readings are not switch reports');
publish({deveui:meters[0],payload:{switch_1:'off'}});
assert.equal(read().payload.data.relays.records[0].switch_1,'off');
assert.equal(read().payload.data.relays.records[0].switch_2,'on','Unreported channel is retained');

function tasmota(topic,payload,retain=false){return run(cache,{topic,payload:JSON.stringify(payload),retain});}
tasmota('stat/ussc/RESULT',{IRHVAC:{Vendor:'DAIKIN',Power:'On'}});
assert.equal(read().payload.data.ac.state,'on');assert.equal(read().payload.data.ac.source,'tasmota_ir_sent');
const acAt=read().payload.data.ac.observed_at_utc;
now+=5000;tasmota('stat/ussc/RESULT',{POWER:'OFF'});
assert.equal(read().payload.data.ac.state,'on','A Tasmota relay is not the IR AC');
tasmota('cmnd/ussc/IRHVAC',{IRHVAC:{Vendor:'DAIKIN',Power:'Off'}});
assert.equal(read().payload.data.ac.state,'on','An outgoing command is not a device report');
tasmota('tele/ussc/RESULT',{IrReceived:{IRHVAC:{Vendor:'OTHER',Power:'Off'}}});
assert.equal(read().payload.data.ac.state,'on');
tasmota('stat/ussc/RESULT',{IRHVAC:{Vendor:'DAIKIN',Power:'Off'}},true);
assert.equal(read().payload.data.ac.observed_at_utc,acAt,'Retained IR reports cannot invent freshness');
tasmota('tele/ussc/RESULT',{IrReceived:{IRHVAC:{Vendor:'DAIKIN',Power:'Off'}}});
assert.equal(read().payload.data.ac.state,'off');assert.equal(read().payload.data.ac.source,'tasmota_ir_received');
const offAt=read().payload.data.ac.observed_at_utc;
run(cache,{topic:'tele/ussc/LWT',payload:'Offline'});
assert.equal(read().payload.data.ac.online,false);assert.equal(read().payload.data.ac.observed_at_utc,offAt);

// Malformed, duplicate, future and out-of-order packets cannot replace valid cache.
const retained=JSON.stringify(read().payload.data.relays);
let message=run(ug,{topic:'relay_status_tick'});let packet=JSON.parse(message.payload);
packet.records[1]=packet.records[0];tasmota('office1/monitoring/relays',packet);
assert.equal(JSON.stringify(read().payload.data.relays),retained);
for(const payload of ['null','[]','invalid',JSON.stringify({a:'x'.repeat(32768)})])run(cache,{topic:'stat/ussc/RESULT',payload});
packet=JSON.parse(message.payload);packet.sampled_at_utc=new Date(now+180001).toISOString();tasmota('office1/monitoring/relays',packet);
assert.equal(JSON.stringify(read().payload.data.relays),retained);
packet.sampled_at_utc=new Date(now-20000).toISOString();tasmota('office1/monitoring/relays',packet);
assert.equal(JSON.stringify(read().payload.data.relays),retained);

// Read-only monitoring tolerates the existing three-minute clock difference.
for(const offset of [17000,180000]){
 packet=JSON.parse(message.payload);packet.sampled_at_utc=new Date(now+offset).toISOString();
 tasmota('office1/monitoring/relays',packet);
 assert.equal(read().payload.data.relays.sampled_at_utc,packet.sampled_at_utc);
}
for(const [ip,token,code] of [['192.0.2.3',key,403],['100.86.6.76','wrong',401]]){
 result=run(api,{req:{socket:{remoteAddress:ip},headers:{authorization:'Bearer '+token}},res:{}});
 assert.equal(result.statusCode,code);assert.ok(!JSON.stringify(result.payload).includes(key));
}
result=read();assert.equal(result.headers['Cache-Control'],'no-store');
if(process.argv[2])fs.writeFileSync(process.argv[2],JSON.stringify(result.payload.data));
const fragments=['UG65_tambahan_status_relay.json','MiniPC_tambahan_status_perangkat.json'].flatMap(f=>JSON.parse(load(f)));
assert.equal(fragments.find(n=>n.type==='function'&&n.func.includes('JSON.parse')).func.replace(/\r\n/g,'\n'),cache.replace(/\r\n/g,'\n'),'Imported Function matches tested source');
assert.equal(fragments.length,10);assert.equal(new Set(fragments.map(n=>n.id)).size,10);
assert.ok(fragments.filter(n=>n.type==='mqtt out').every(n=>n.topic==='office1/monitoring/relays'));
assert.ok(fragments.filter(n=>n.type==='http in').every(n=>n.method==='get'));
console.log('PASS: genuine WS502 channel reports, original timestamps, partial updates, no power inference, Tasmota sent/received IR with no physical claim, retained/invalid/future/duplicate rejection, read-only authenticated HTTP; ten monitoring nodes, no control/door writes.');
