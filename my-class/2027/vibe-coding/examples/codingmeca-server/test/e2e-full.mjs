import { startServer } from '../index.js';
import WebSocket from 'ws';
import { PRESETS } from '../data/presets.js';
process.env.DEV_AUTH='1'; process.env.DEV_MEMORY_DB='1';
const app = await startServer({ port: 0, log:{info(){},warn:console.warn,error:console.error} });
const db = app.db;
await db.raw.teams.upsert({id:'t1',name:'가',color:'#f00'}); await db.raw.teams.upsert({id:'t2',name:'나',color:'#00f'});
await db.raw.profiles.upsert({id:'dev-m1',login_id:'m1',nickname:'m1',role:'mechanic',team_id:'t1'});
await db.raw.profiles.upsert({id:'dev-m2',login_id:'m2',nickname:'m2',role:'mechanic',team_id:'t2'});
const p=PRESETS[0];
await db.raw.robots.upsert({id:'r1',owner:'dev-m1',name:p.name,design:p,tactics:p.tactics});
await db.raw.robots.upsert({id:'r2',owner:'dev-m2',name:p.name,design:p,tactics:p.tactics});
const open=(tok)=>new Promise(res=>{const ws=new WebSocket(`ws://localhost:${app.port}/ws`);ws.msgs=[];ws.on('message',d=>ws.msgs.push(JSON.parse(d)));ws.on('open',()=>{ws.send(JSON.stringify({type:'auth',token:tok}));setTimeout(()=>res(ws),100)})});
let id=0; const cmd=(ws,op,a={})=>new Promise(res=>{const i=++id;const h=d=>{const m=JSON.parse(d);if(m.type==='res'&&m.id===i){ws.off('message',h);res(m)}};ws.on('message',h);ws.send(JSON.stringify({type:'cmd',id:i,op,...a}))});
const cm=await open('dev:commander:boss:지휘'); const m1=await open('dev:mechanic:m1:a'); const m2=await open('dev:mechanic:m2:b');
console.log('auth', cm.msgs[0]?.type);
console.log('mech create', (await cmd(m1,'league.create',{config:{name:'x'}})).code);
const cr=await cmd(cm,'league.create',{config:{name:'풀',teamSize:1,matchSeconds:30,format:'single'}}); const L=cr.data.id;
await cmd(m1,'roster.register',{leagueId:L,robotIds:['r1']}); await cmd(m2,'roster.register',{leagueId:L,robotIds:['r2']});
await cmd(cm,'schedule.generate',{leagueId:L});
const v=(await cmd(cm,'league.view',{leagueId:L})).data; const mid=v.matches[0].id;
console.log('start',(await cmd(cm,'match.start',{matchId:mid})).ok);
const t0=Date.now(); let m;
while(Date.now()-t0<85000){ m=await db.getMatch(mid); if(['finished','needs_decision'].includes(m.status)|| (m.status==='scheduled'&&m.draws)) break; await new Promise(r=>setTimeout(r,500)); }
console.log('status',m.status,'draws',m.draws,'winner',m.result?.winner,m.result?.reason,'replay',Boolean(m.replay_id));
if(m.replay_id){ const rp=await cmd(cm,'replay.get',{replayId:m.replay_id}); console.log('replay',rp.ok,rp.data?.frames); }
console.log('view',(await cmd(m1,'league.view',{leagueId:L})).data.status);
await app.stop(); process.exit(0);
