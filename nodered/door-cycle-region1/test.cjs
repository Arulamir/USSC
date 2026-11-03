const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const patch=JSON.parse(fs.readFileSync(path.join(__dirname,'UG65_patch_pintu_lampu_region1_tanpa_key.json'),'utf8'));
const get=id=>patch.find(n=>n.id===id);
const door=get('a2971f6c9ccd8043'),send=get('0389cefc495868e6'),ack=get('eb407415d4abc81b');
const source=get('0f726f15fca00761'),lights=get('d24b9627054d4094');
const eui='24E124443F431957';
let now=Date.parse('2026-10-30T06:00:00Z');
const FakeDate=class extends Date{static now(){return now;}};
function store(){const m=new Map();return {get:k=>m.get(k),set:(k,v)=>m.set(k,v)};}
let flow,globalStore,dc,lc,bc;
function fresh(){flow=store();globalStore=store();dc=store();lc=store();bc=store();
 dc.set('session','door-test');lc.set('session','lights-test');bc.set('session','bridge-test');}
function run(n,msg,context){return new Function('msg','node','context','flow','global','Date','Buffer',n.func)(
 msg,{status(){},warn(){},error(message){throw Error(message);}},context,flow,globalStore,FakeDate,Buffer);}
function event(value,extra={}){return run(source,{deveui:eui,payload:{region_1:value,...extra}},store())[1];}
function region(value){event(value);flow.set('vs321_lights_region1',{source:'region_1',eui,value,updatedAt:now});}
const tick=msg=>run(door,msg,dc),lamp=msg=>run(lights,msg,lc);
const state=()=>dc.get('runtime');
const due=()=>tick({topic:'door_due',cycle:state().token});
function bridge(output,accepted=true,timeout=false){
 const message=output[0]||output[1];assert.ok(message,'An OPEN/CLOSE request is required');
 const command=output[0]?'alwaysOpen':'close';
 const sent=run(send,{...message,payload:'<RemoteControlDoor><cmd>'+command+'</cmd></RemoteControlDoor>'},bc);
 assert.ok(sent[0].payload.endsWith('\n'));assert.ok(!sent[0].payload.endsWith('\\n'));
 const packet=JSON.parse(sent[0].payload);
 assert.equal(packet.command,command);
 assert.deepEqual(Object.keys(packet).sort(),['command','id','type']);
 const response=timeout?{payload:'ack_timeout',bridgeRequestId:packet.id}:
   {payload:{type:'door_result',id:packet.id,command,accepted,httpStatus:accepted?200:500,isapiStatus:accepted?1:4}};
 const reply=run(ack,response,store())[0];
 return {reply,output:tick(reply),packet};
}

// First hour is held even with vacant reports; repeated taps never extend it.
fresh();region('occupied');let out=tick({topic:'tap'});
assert.equal(out[3].topic,'accepted_tap');assert.equal(out[2].reset,true);
assert.equal(state().phase,'open_pending');assert.equal(state().deadline,null);
out=bridge(out).output;assert.equal(out[2][1].delay,60*60000);
const first=state().deadline;now+=10*60000;
out=tick(event('vacant',{people_total_counts:99}));assert.equal(out[1],null);assert.equal(state().deadline,first);
out=tick({topic:'tap'});assert.equal(out[0],null);assert.equal(out[3],null);assert.equal(state().deadline,first);

// A real close ACK is required before the two-minute gap can start.
now=first;region('occupied');out=due();assert.ok(out[1]);assert.equal(state().deadline,null);
const pendingToken=state().token;assert.equal(tick({topic:'door_due',cycle:'obsolete'})[0],null);
now+=15000;let closed=bridge(out);out=closed.output;
assert.equal(state().phase,'closed_gap');assert.equal(state().deadline,now+2*60000);
const gap=state().deadline;
tick(closed.reply);assert.equal(state().deadline,gap,'Duplicate ACK must not restart the gap');
assert.equal(tick({topic:'tap'})[0],null,'Tap must not bypass the close gap');
now=gap-1;assert.equal(due()[0],null);
now=gap;region('occupied');out=due();assert.ok(out[0]);assert.equal(state().phase,'open_pending');
out=bridge(out).output;assert.equal(out[2][1].delay,120*60000);

// On extended periods, new vacant immediately requests close.
now+=1000;out=tick(event('vacant',{people_total_counts:100}));assert.ok(out[1]);
out=bridge(out).output;assert.equal(state().active,false);assert.equal(state().phase,'idle');
assert.equal(tick(event('occupied'))[0],null,'Occupancy alone cannot restart a finished cycle');

// Still occupied at the end of every two hours: close -> 2 min -> reopen.
fresh();region('occupied');bridge(tick({topic:'tap'}));now=state().deadline;region('occupied');bridge(due());
now=state().deadline;region('occupied');bridge(due());
for(let i=0;i<3;i++){
 now=state().deadline;region('occupied');out=due();assert.ok(out[1]);bridge(out);
 assert.equal(state().phase,'closed_gap');now=state().deadline;region('occupied');out=due();assert.ok(out[0]);bridge(out);
 assert.equal(state().phase,'open_extended');assert.equal(state().deadline,now+120*60000);
}

// Unknown/stale occupancy never causes an unlock from the closed gap.
fresh();region('occupied');bridge(tick({topic:'tap'}));now=state().deadline;bridge(due());
now=state().deadline;out=due();assert.equal(out[0],null);assert.equal(state().phase,'waiting_occupancy');
out=tick(event('occupied'));assert.ok(out[0]);bridge(out);
now+=1000;out=tick(event('vacant'));const closeToken=state().token;
tick(event('occupied'));bridge(out);assert.equal(state().phase,'idle','Vacant close is not cancelled by later occupied');
assert.equal(tick({topic:'door_due',cycle:closeToken})[0],null);

// Vacant while a gap-close is still pending ends the cycle even if occupied returns.
fresh();region('occupied');bridge(tick({topic:'tap'}));now=state().deadline;region('occupied');out=due();
tick(event('vacant'));tick(event('occupied'));bridge(out);assert.equal(state().phase,'idle');

// Manual close queues behind an in-flight open, avoiding reordered HTTP commands.
fresh();region('occupied');const opening=tick({topic:'tap'});const manual=tick({topic:'door_close'});
assert.equal(manual[1],null);const lateOpen=bridge(opening);assert.equal(state().phase,'close_pending');
assert.ok(lateOpen.output[1]);tick(lateOpen.reply);assert.equal(state().phase,'close_pending');
bridge(lateOpen.output);assert.equal(state().phase,'idle');

// Vacant at the first-hour boundary locks and ends; no automatic reopen.
fresh();region('occupied');bridge(tick({topic:'tap'}));now=state().deadline;region('vacant');out=due();bridge(out);
assert.equal(state().phase,'idle');assert.equal(state().active,false);

// A failed close / missing ACK leaves an explicit fault, never automatic unlock.
for(const timeout of [false,true]){
 fresh();region('occupied');bridge(tick({topic:'tap'}));now=state().deadline;region('occupied');out=due();bridge(out,false,timeout);
 assert.equal(state().phase,'fault');assert.equal(state().deadline,null);
 assert.equal(tick(event('occupied'))[0],null);
}

// Only fresh region_1 can update door occupancy; no people count fallback.
fresh();event('occupied',{people_total_counts:0});assert.equal(flow.get('vs321_occupancy').value,'occupied');
const at=flow.get('vs321_occupancy').updatedAt;now+=1000;
run(source,{deveui:eui,payload:{temperature:25,people_total_counts:0}},store());
assert.equal(flow.get('vs321_occupancy').updatedAt,at);
event('vacant',{people_total_counts:99});assert.equal(flow.get('vs321_occupancy').value,'vacant');
event('invalid',{people_total_counts:99});assert.equal(flow.get('vs321_occupancy'),null);

// Lighting/AC remains independent: 10h, then occupied adds 120m; vacant is immediate after 10h.
fresh();region('occupied');out=lamp({topic:'accepted_tap'});assert.equal(out[3][1].delay,10*3600000);
const lampDeadline=lc.get('runtime').deadline;
now+=3600000;region('vacant');out=lamp({topic:'occupancy_update'});assert.equal(out[7],null);
assert.equal(lc.get('runtime').deadline,lampDeadline);
now=lampDeadline;region('occupied');out=lamp({topic:'lights_due',cycle:lc.get('runtime').token});
assert.equal(out[3][1].delay,120*60000);assert.equal(out[7],null);
now+=5000;region('vacant');out=lamp({topic:'occupancy_update'});
assert.equal(out[2].payload.state,'off');assert.equal(out[7].payload.state,'off');assert.equal(out[0],null);

// Wiring/timer contract is preserved, with verified ACK feedback added.
assert.equal(door.outputs,5);assert.equal(lights.outputs,8);
assert.ok(ack.wires[0].includes(door.id));assert.ok(ack.wires[0].includes('25491d2454f04a8d'));
assert.equal(get('294e39ca0a98cb66').overrideDelay,true);
assert.deepEqual(lights.wires[7],['9464eed63c09bb41']);
assert.deepEqual(door.wires[3],['d24b9627054d4094','9464eed63c09bb41']);
for(const n of patch.filter(n=>n.type==='function'))new Function('msg','node','flow','context','global','Date','Buffer',n.func);
console.log('PASS: 1h initial, verified-close 2m gap, repeat 2h, immediate extended vacant close, stale/invalid occupancy waits, ACK failure/timeout/duplicates, region_1 only, unchanged tap/manual paths, independent 10h/120m lamps+AC. Offline only; no network or physical commands.');
