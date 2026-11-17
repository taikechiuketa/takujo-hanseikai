import assert from 'node:assert/strict';
import {readFileSync,readdirSync} from 'node:fs';
const {PGlite}=await import(process.env.HANSEI_PGLITE||'@electric-sql/pglite');
const db=new PGlite();
await db.exec(`create role anon;create role authenticated;create schema auth;
create table auth.users(id uuid primary key,email text,created_at timestamptz default now(),email_confirmed_at timestamptz default now());
create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
grant usage on schema auth,public to authenticated,anon;grant execute on function auth.uid() to authenticated,anon;`);
for(const file of readdirSync('supabase/migrations').filter(f=>f.endsWith('.sql')).sort())await db.exec(readFileSync('supabase/migrations/'+file,'utf8'));
const A='11111111-1111-4111-8111-111111111111',B='22222222-2222-4222-8222-222222222222',C='33333333-3333-4333-8333-333333333333',G='44444444-4444-4444-8444-444444444444';
await db.query(`insert into auth.users(id,email) values($1,'owner@test'),($2,'editor@test'),($3,'other@test')`,[A,B,C]);
await db.query(`insert into public.groups(id,owner_id,name) values($1,$2,'privacy test')`,[G,A]);
async function as(user){await db.exec('reset role');await db.query("select set_config('request.jwt.claim.sub',$1,false)",[user||'']);await db.exec('set role '+(user?'authenticated':'anon'));}
async function rpc(name,args=[]){return(await db.query('select public.'+name+'('+args.map((_,i)=>'$'+(i+1)).join(',')+') as value',args)).rows[0].value;}
async function revision(){return(await db.query('select sheet_revision from public.groups where id=$1',[G])).rows[0].sheet_revision;}
async function master(players){return rpc('save_sheet_players',[G,await revision(),crypto.randomUUID(),players]);}
async function save(players,sets){return rpc('save_sheet_workspace',[G,await revision(),crypto.randomUUID(),{},players,sets]);}
async function denied(fn){await assert.rejects(fn,e=>e.code==='42501');}
const privateMaster={id:'secret',name:'Private Player',rankingVisible:false},publicMaster={id:'public',name:'Public Player',rankingVisible:true};
const masters=[privateMaster,publicMaster];
const original={archiveId:'private-set',date:'2026/11/17',sequence:1,players:[{id:'seat-s',masterId:'secret',name:'Private Player'},{id:'seat-p',masterId:'public',name:'Public Player'}],rounds:[{mode:'normal',scores:{'seat-s':10,'seat-p':-10}}]};
await as(A);const invitation=await rpc('create_group_editor_invite',[G]);await save(masters,[original]);
const share=(await db.query('insert into public.group_ranking_shares(group_id) values($1) returning token',[G])).rows[0].token;
async function visibleNames(){await as(null);const data=await rpc('get_shared_group_stats',[share,null,'all']);return data.totals.map(p=>p.name);}
assert.deepEqual(await visibleNames(),['Public Player']);await as(B);await rpc('accept_group_editor_invite',[invitation.token]);
await denied(()=>master([{...privateMaster,rankingVisible:true},publicMaster]));
await denied(()=>master([{id:'secret',name:'Private Player'},publicMaster]));
await denied(()=>master([publicMaster]));
await denied(()=>master([{...privateMaster,id:'new-secret',rankingVisible:true},publicMaster]));
await denied(()=>master([{...privateMaster,name:'Renamed Private'},publicMaster]));
await denied(()=>master([privateMaster,{...publicMaster,rankingVisible:false}]));
await denied(()=>save([{...privateMaster,rankingVisible:true},publicMaster],[original]));
for(const key of ['id','masterId','name','rankingVisible']){const changed=structuredClone(original);changed.players[0][key]=key==='rankingVisible'?true:'replacement';await denied(()=>save(masters,[changed]));}
const missing=structuredClone(original);missing.players.shift();await denied(()=>save(masters,[missing]));
await denied(()=>save(masters,[]));await denied(()=>save(masters,[{...original,archiveId:'new-private-set'}]));
const publicFlag=structuredClone(original);publicFlag.players[1].rankingVisible=false;await denied(()=>save(masters,[publicFlag]));
const correction=structuredClone(original);correction.rounds[0].scores={'seat-s':20,'seat-p':-20};await save(masters,[correction]);
const nextMaster={id:'new-public',name:'New Player'};const newSet={archiveId:'new-set',date:'2026/11/18',sequence:1,players:[{id:'new-seat',masterId:'new-public',name:'New Player'}],rounds:[{mode:'normal',scores:{'new-seat':0}}]};
await save([...masters,nextMaster],[correction,newSet]);assert.deepEqual((await visibleNames()).sort(),['New Player','Public Player']);
// Tombstones survive owner deletion, member reintroduction and both RPC paths.
await as(A);await master([publicMaster,nextMaster]);await as(B);
await denied(()=>master([{...privateMaster,rankingVisible:true},publicMaster,nextMaster]));
await denied(()=>master([{...privateMaster,id:'different-id',rankingVisible:true},publicMaster,nextMaster]));
await denied(()=>master([{...privateMaster,name:'Renamed Private'},publicMaster,nextMaster]));
await master([privateMaster,publicMaster,nextMaster]);
assert.deepEqual((await visibleNames()).sort(),['New Player','Public Player']);
await as(A);await master([publicMaster,nextMaster]);await as(B);
const bypass=structuredClone(newSet);bypass.archiveId='fake-id-private';bypass.sequence=2;bypass.players=[{id:'fake-seat',masterId:'fake-master',name:'Private Player'}];bypass.rounds=[{mode:'normal',scores:{'fake-seat':0}}];
await denied(()=>save([publicMaster,nextMaster],[correction,newSet,bypass]));
// New owner-created set-local privacy must remain private even without a master entry.
const standalone={archiveId:'local-private',date:'2026/11/19',sequence:1,players:[{id:'local-private-seat',name:'Standalone Private',rankingVisible:false}],rounds:[{mode:'normal',scores:{'local-private-seat':0}}]};
await as(A);await save([publicMaster,nextMaster],[correction,newSet,standalone]);await as(B);
await denied(()=>master([publicMaster,nextMaster,{id:'standalone-new-master',name:'Standalone Private'}]));
const localBypass=structuredClone(standalone);localBypass.players[0].rankingVisible=true;await denied(()=>save([publicMaster,nextMaster],[correction,newSet,localBypass]));
// Legacy duplicate display names remain saveable while identity order cannot be changed to alter visibility.
const dup1={id:'dup-one',name:'Same Name',rankingVisible:false},dup2={id:'dup-two',name:'Same Name',rankingVisible:true};
const duplicates=[publicMaster,nextMaster,dup1,dup2];
await as(A);await master(duplicates);await as(B);await master(duplicates);await save(duplicates,[correction,newSet,standalone]);
await denied(()=>master([publicMaster,nextMaster,dup2,dup1]));
// Owner still controls publication and marker removal. Reapplying the migration is non-destructive.
await as(A);await master([{...privateMaster,rankingVisible:true},...duplicates]);assert((await visibleNames()).includes('Private Player'));
await as(A);await db.exec('reset role');await db.exec(readFileSync('supabase/migrations/20261117130000_release_privacy.sql','utf8'));
assert((await visibleNames()).includes('Private Player'));assert(!(await visibleNames()).includes('Standalone Private'));
await db.exec('reset role');await db.exec(readFileSync('supabase/setup-group-editors.sql','utf8'));assert.equal(await rpc('release_schema_version'),'2026-11-17.1');
assert((await visibleNames()).includes('Private Player'));assert(!(await visibleNames()).includes('Standalone Private'));
// A valid legacy backup can contain whitespace around a private display name.
// Saving it unchanged must work, while trimmed/whitespace aliases must not publish it.
const GW='55555555-5555-4555-8555-555555555555';
await as(A);await db.query("insert into public.groups(id,owner_id,name) values($1,$2,'whitespace private')",[GW,A]);
async function wsRevision(){return(await db.query('select sheet_revision from public.groups where id=$1',[GW])).rows[0].sheet_revision;}
async function wsMaster(players){return rpc('save_sheet_players',[GW,await wsRevision(),crypto.randomUUID(),players]);}
async function wsSave(players,sets){return rpc('save_sheet_workspace',[GW,await wsRevision(),crypto.randomUUID(),{},players,sets]);}
const wsPrivate={id:'ws-private',name:' Private Legacy ',rankingVisible:false};
const wsSet={archiveId:'ws-set',date:'2026/11/17',sequence:1,players:[{id:'ws-seat',masterId:'ws-private',name:' Private Legacy '}],rounds:[{mode:'normal',scores:{'ws-seat':0}}]};
const wsInvitation=await rpc('create_group_editor_invite',[GW]);await wsSave([wsPrivate],[wsSet]);
const wsShare=(await db.query('insert into public.group_ranking_shares(group_id) values($1) returning token',[GW])).rows[0].token;
await as(B);await rpc('accept_group_editor_invite',[wsInvitation.token]);await wsMaster([wsPrivate]);
const wsCorrection=structuredClone(wsSet);wsCorrection.rounds[0].scores['ws-seat']=20;await wsSave([wsPrivate],[wsCorrection]);
await as(null);assert.deepEqual((await rpc('get_shared_group_stats',[wsShare,null,'all'])).totals,[]);
await as(A);await wsMaster([]);await as(B);await wsMaster([wsPrivate]);
await denied(()=>wsMaster([{...wsPrivate,name:'Private Legacy'}]));
await denied(()=>wsMaster([wsPrivate,{id:'new-alias',name:'Private Legacy'}]));
const wsAlias={...structuredClone(wsSet),archiveId:'ws-alias',sequence:2,players:[{id:'ws-new',masterId:'other',name:'Private Legacy'}],rounds:[{mode:'normal',scores:{'ws-new':30}}]};
await denied(()=>wsSave([wsPrivate],[wsCorrection,wsAlias]));
// Canonical tombstone names must not authorize whitespace aliases whose exact names are public.
await as(A);await wsMaster([{id:'canonical-private',name:'Canonical Private',rankingVisible:false}]);
const canonical={archiveId:'canonical-set',date:'2026/11/17',sequence:3,players:[{id:'canonical-seat',masterId:'canonical-private',name:'Canonical Private'}],rounds:[{mode:'normal',scores:{'canonical-seat':0}}]};
await wsSave([{id:'canonical-private',name:'Canonical Private',rankingVisible:false}],[wsCorrection,canonical]);await wsMaster([]);await as(B);
for(const alias of [{id:'alias-no-master',name:' Canonical Private '},{id:'alias-fake-master',masterId:'fake-public-id',name:' Canonical Private '}]){
 const attempted={archiveId:'canonical-alias',date:'2026/11/17',sequence:4,players:[alias],rounds:[{mode:'normal',scores:{[alias.id]:30}}]};
 await denied(()=>wsSave([],[wsCorrection,canonical,attempted]));
}
await as(null);assert.deepEqual((await rpc('get_shared_group_stats',[wsShare,null,'all'])).totals,[]);

// Erasing an accepted account clears its FK but never makes the consumed token available again.
await as(A);await rpc('remove_group_editor',[G,B]);await db.exec('reset role');await db.query('delete from auth.users where id=$1',[B]);
const used=(await db.query('select accepted_by,accepted_at from public.group_editor_invites')).rows[0];assert.equal(used.accepted_by,null);assert(used.accepted_at);
await as(C);await assert.rejects(()=>rpc('accept_group_editor_invite',[invitation.token]),e=>e.code==='22023');await assert.rejects(()=>rpc('preview_group_editor_invite',[invitation.token]),e=>e.code==='22023');
await denied(()=>rpc('assert_editor_ranking_privacy',[G,[],[]]));
console.log('PASS Privacy PostgreSQL: owner-only visibility, both save RPCs, deleted private identities, set-local flags, duplicate-name compatibility, migration replay and used-invitation account erasure');
await db.close();
