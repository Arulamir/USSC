const fs=require('node:fs');
const path=require('node:path');
const assert=require('node:assert/strict');
const nodes=JSON.parse(fs.readFileSync(path.join(__dirname,'UG65_patch_timer_AC_tanpa_key.json'),'utf8'));
const timer=nodes.find(n=>n.id==='c26b6e8123f41b6d');
const hvac=nodes.find(n=>n.id==='8ce39f78a70667df');
const mqtt=nodes.find(n=>n.id==='0873000df6b86304');
let now=1800000000000;
const FakeDate=class extends Date{static now(){return now;}};
function store(){const map=new Map();return {get:k=>map.get(k),set:(k,v)=>map.set(k,v)};}
const flow=store();
function execute(code,msg,context){return new Function('msg','node','flow','context','Date',code)(msg,{status(){}},flow,context,FakeDate);}
function cycle(){const state=store();state.set('session','test-session');return {state,tick:msg=>execute(timer.func,msg,state)};}
function region(value){flow.set('vs321_lights_region1',{eui:'24E124443F431957',source:'region_1',value,updatedAt:now});}
function due(active){return active.tick({topic:'lights_due',cycle:active.state.get('runtime').token});}
function hvacCommand(message){return execute(hvac.func,structuredClone(message),store());}
const tap={topic:'accepted_tap',payload:{state:'on'}};
assert.equal(hvacCommand(tap).payload.Power,'On');
let active=cycle(),output=active.tick(tap);
assert.equal(output[0].payload.state,'on');assert.equal(output[3][1].delay,10*3600000);assert.equal(output[7],null);
const firstDeadline=active.state.get('runtime').deadline;
now+=3600000;active.tick(tap);assert.equal(active.state.get('runtime').deadline,firstDeadline);
now=firstDeadline;region('occupied');output=due(active);
assert.equal(output[7],null);assert.equal(output[2],null);assert.equal(output[3][1].delay,35*60000);
now+=35*60000;region('occupied');output=due(active);
assert.equal(output[7],null);assert.equal(output[3][1].delay,35*60000);
now+=35*60000;region('vacant');output=due(active);
assert.equal(output[2].payload.state,'off');assert.equal(output[7].payload.state,'off');
assert.equal(hvacCommand(output[7]).payload.Power,'Off');
assert.equal(hvacCommand(output[7]).payload.Vendor,'DAIKIN');
assert.equal(hvacCommand(output[7]).payload.Temp,24);
active=cycle();active.tick(tap);region('vacant');now+=10*3600000;
output=due(active);assert.equal(output[7],null);assert.equal(output[2],null);assert.equal(active.state.get('runtime').waiting,true);
region('vacant');output=active.tick({topic:'occupancy_update'});assert.equal(output[7].payload.state,'off');
for(const topic of ['manual_off','main_off']){active=cycle();active.tick(tap);assert.equal(active.tick({topic})[7],null);}
active=cycle();active.tick(tap);const deadline=active.state.get('runtime').deadline;now+=3600000;
output=active.tick({topic:'web_override',control:{id:'ac-website-override-test',device:'WS502_RUANG_UTAMA',state:'off',expires_at:now+10000}});
assert.equal(output[7],null);assert.equal(output[6].control.state,'off');
assert.equal(active.state.get('runtime').pause.remaining,9*3600000);
now+=3600000;output=due(active);assert.equal(output[0].payload.state,'on');assert.equal(active.state.get('runtime').deadline,deadline+3600000);
assert.deepEqual(timer.wires[7],[hvac.id]);assert.deepEqual(hvac.wires,[[mqtt.id]]);
assert.equal(mqtt.type,'mqtt out');assert.equal(mqtt.topic,'cmnd/ussc/IRHVAC');
assert.ok(!timer.wires[7].some(id=>nodes.find(n=>n.id===id)?.type==='LoRa Output'));
assert.equal(timer.outputs,8);assert.equal(timer.wires.length,8);
console.log('PASS: shared 10h/35m decision, DAIKIN MQTT ON/OFF, stale wait, web pause, manual route preservation, and no WS523 control path.');
