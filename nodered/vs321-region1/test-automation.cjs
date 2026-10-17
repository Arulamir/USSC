const fs=require('node:fs');
const path=require('node:path');
const assert=require('node:assert/strict');
const helper=fs.readFileSync(path.join(__dirname,'VS321_Automasi_lampu_region1.txt'),'utf8');
const lamp=fs.readFileSync(path.join(__dirname,'Lampu_timer_region1.txt'),'utf8');
const patch=JSON.parse(fs.readFileSync(path.join(__dirname,'UG65_patch_automasi_region1_tanpa_key.json'),'utf8'));
let now=1800000000000;
const FakeDate=class extends Date{static now(){return now;}};
const flowMap=new Map();
const flow={get:k=>flowMap.get(k),set:(k,v)=>flowMap.set(k,v)};
function context(){const map=new Map();return {get:k=>map.get(k),set:(k,v)=>map.set(k,v)};}
function call(code,msg,state){return new Function('msg','flow','context','node','Date',code)(msg,flow,state,{status(){}},FakeDate);}
function region(value,extra={}){return call(helper,{deveui:'24E124443F431957',payload:{region_1:value,...extra}},context());}
function start(){const state=context();state.set('session','test-session');const run=msg=>call(lamp,msg,state);const output=run({topic:'accepted_tap'});assert.equal(output[3][1].delay,10*3600000);return {state,run};}
let active=start();now+=10*3600000;
flow.set('vs321_occupancy',{eui:'24E124443F431957',value:'vacant',updatedAt:now});
active.run(region('occupied',{people_total_counts:0,occupancy:'vacant',region_2:'vacant'}));
let output=active.run({topic:'lights_due',cycle:active.state.get('runtime').token});
assert.equal(output[2],null);assert.equal(output[3][1].delay,35*60000);
assert.equal(flow.get('vs321_occupancy').value,'vacant');
now+=35*60000;
active.run(region('vacant',{people_total_counts:99,occupancy:'occupied',region_2:'occupied'}));
output=active.run({topic:'lights_due',cycle:active.state.get('runtime').token});
assert.equal(output[2].payload.state,'off');assert.equal(active.state.get('runtime').active,false);
active=start();region('occupied');now+=10*3600000;
output=active.run({topic:'lights_due',cycle:active.state.get('runtime').token});
assert.equal(output[2],null);assert.equal(active.state.get('runtime').waiting,true);
output=active.run(region('occupied',{people_total_counts:0}));
assert.equal(output[3][1].delay,35*60000);
const observed=flow.get('vs321_lights_region1').updatedAt;
now+=60000;call(helper,{deveui:'24E124443F431957',payload:{people_total_counts:0}},context());
assert.equal(flow.get('vs321_lights_region1').updatedAt,observed);
region('unknown');assert.equal(flow.get('vs321_lights_region1'),null);
active=start();const deadline=active.state.get('runtime').deadline;now+=3600000;
output=active.run({topic:'web_override',control:{id:'web-pause-region1-test',device:'WS502_RUANG_UTAMA',state:'off',expires_at:now+10000}});
assert.equal(output[6].control.state,'off');assert.equal(active.state.get('runtime').pause.remaining,9*3600000);
now+=3600000;
output=active.run({topic:'lights_due',cycle:active.state.get('runtime').token});
assert.equal(output[0].payload.state,'on');assert.equal(active.state.get('runtime').deadline,deadline+3600000);
const oldNode=patch.find(n=>n.id==='2f61deaedd753337');
assert.deepEqual(oldNode.wires[1],['4ce2e2c55df6f6d3']);
const newNode=patch.find(n=>n.name==='VS321: region_1 untuk timer lampu');
assert.deepEqual(newNode.wires,[['c26b6e8123f41b6d']]);
console.log('PASS: region_1 drives the 10-hour lamp decision; 35-minute extension, OFF, stale wait, web pause/resume and isolated door route verified.');
