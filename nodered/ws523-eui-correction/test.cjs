const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const patch=JSON.parse(fs.readFileSync(path.join(__dirname,'UG65_patch_4_node_EUI_WS523.json'),'utf8'));
const nodes=process.argv[2]?JSON.parse(fs.readFileSync(process.argv[2],'utf8')):patch;
const by=id=>nodes.find(n=>n.id===id);
const memory=new Map(), flow={get:k=>memory.get(k),set:(k,v)=>memory.set(k,v)};
const globals=new Map(),global={get:k=>globals.get(k),set:(k,v)=>globals.set(k,v)};
const run=(id,msg)=>new Function('msg','flow','global','context','node','env','Buffer',by(id).func)(msg,flow,global,flow,{warn(){},error(e){throw Error(e)}},{get(){return 'test-flow'}},Buffer);
const meters=['24E124148060C6A0','24E12414806031FC','24E124148060D73E','24E1241480609B86','24E1241480608D1A'];
for(const [i,eui] of meters.entries()){
 let msg={deveui:eui,payload:{active_power:100+i,power_consumption:10000+i}};
 if(process.argv[2]){
  msg=run('21c3d9e47e2c13c2',msg);assert.equal(msg.deviceMeta.eui,eui);
  msg=run('564dbeb4f22fff0a',msg);msg=run('40a9b7ae85665d0d',msg);
  const debug=run('c4791dc390d404d4',msg);assert.equal(debug.payload.daya_sum,100+i);
  assert.equal(by('b26117d3f44019d1').rules[i].v,eui);
 }
 run('8f2bfa79f87cfd92',msg);
 assert.equal(memory.get('telemetry_latest_v1')[eui].power_w.value,100+i);
}
const packet=JSON.parse(run('93dde0bc8c83e852',{}).payload);
assert.equal(packet.records.length,8);
for(const eui of meters.slice(0,4))assert.ok(packet.records.some(r=>r.device_eui===eui&&r.power_w!==null));
assert.ok(!packet.records.some(r=>r.device_eui===meters[4]),'Above-door meter is excluded from AC power');
const snapshot=run('60ba0b3c8cfac7c6',{topic:'sample_now'}).payload;
assert.equal(snapshot.records.find(r=>r.device_eui===meters[3]).device_name,'WS523_RUANG_MAGANG');
assert.equal(snapshot.records.find(r=>r.device_eui===meters[4]).device_name,'WS523_ATAS_PINTU');
for(const eui of ['24E1241480609886','24E124148060801A']){
 run('8f2bfa79f87cfd92',{deveui:eui,payload:{active_power:9999}});
 assert.ok(!memory.get('telemetry_latest_v1')[eui]);
 assert.ok(!snapshot.records.some(r=>r.device_eui===eui));
}
console.log('PASS: five meters route to correct identities; four AC meters published; above-door excluded; obsolete EUIs rejected; snapshot uses corrected IDs.');
