const fs=require('node:fs');
const path=require('node:path');
const assert=require('node:assert/strict');
const load=name=>fs.readFileSync(path.join(__dirname,name),'utf8');
const collector=load('UG65_Telemetry_counter_1menit.txt');
const publisher=load('UG65_Publish_counter_1menit.txt');
const receiver=load('MiniPC_Cache_counter_1menit.txt');
let now=Date.parse('2026-10-17T06:00:00Z');
const FakeDate=class extends Date {static now(){return now;}};
const data=new Map();
const flow={get:(key,store)=>data.get((store||'default')+':'+key),set:(key,value,store)=>data.set((store||'default')+':'+key,value)};
const run=(code,msg)=>new Function('msg','flow','node','Date','Buffer',code)(msg,flow,{status(){}},FakeDate,Buffer);
const ac=['24E124148060C6A0','24E12414806031FC','24E124148060D73E','24E1241480609886'];
const read=()=>flow.get('office_power_latest_v1','telemetryRuntime').data;
function uplink(wh){for(const eui of ac)run(collector,{deveui:eui,payload:{active_power:2,power_consumption:wh}});}
uplink(1000);now+=60000;uplink(1015);
const original=JSON.stringify(flow.get('telemetry_latest_v1'));
let message=run(publisher,{});
assert.equal(message.topic,'office1/monitoring/power');assert.equal(message.retain,true);
run(receiver,message);
assert.deepEqual(read().records[0].energy_points.map(p=>p.wh),[1000,1015]);
assert.equal(read().records[0].power_w,2);
assert.equal(JSON.stringify(flow.get('telemetry_latest_v1')),original);
// Re-publishing does not invent a counter observation, even when unchanged.
now+=60000;run(receiver,run(publisher,{}));
assert.equal(read().records[0].energy_points.length,2);
assert.equal(Date.parse(read().records[0].energy_points[1].at),now-60000);
// Genuine zero counters and unchanged readings are retained.
uplink(0);now+=60000;uplink(0);run(receiver,run(publisher,{}));
assert.deepEqual(read().records[0].energy_points.slice(-2).map(p=>p.wh),[0,0]);
const saved=flow.get('telemetry_latest_v1')[ac[0]].energy_minute_points.length;
run(collector,{deveui:ac[0],payload:{temperature:25}});
run(collector,{deveui:ac[0],payload:{power_consumption:true}});
assert.equal(flow.get('telemetry_latest_v1')[ac[0]].energy_minute_points.length,saved);
// Region 1 monitoring remains independent of people counts.
run(collector,{deveui:'24E124443F431957',payload:{region_1:'occupied',people_total_counts:0,illuminance_status:'dim'}});
assert.equal(flow.get('telemetry_latest_v1')['24E124443F431957'].occupancy.value,'occupied');
// Bad series is dropped atomically; never turn an invalid point into zero.
let packet=JSON.parse(run(publisher,{}).payload);
packet.records[0].energy_points[0].wh=true;
run(receiver,{payload:JSON.stringify(packet)});
assert.deepEqual(read().records[0].energy_points,[]);
// Bounds keep the existing 32 KB packet limit effective.
for(let i=0;i<30;i++){now+=60000;uplink(i);}
message=run(publisher,{});assert.ok(Buffer.byteLength(message.payload)<32768);
run(receiver,message);assert.ok(read().records[0].energy_points.length<=16);
now+=601000;run(receiver,run(publisher,{}));
assert.deepEqual(read().records[0].energy_points,[]);
console.log('PASS: real Function collector -> MQTT payload -> mini-PC cache; counter values/ages preserved, reset/zero/no-sample semantics, bounded packet, region_1 unchanged. No network or physical commands.');
