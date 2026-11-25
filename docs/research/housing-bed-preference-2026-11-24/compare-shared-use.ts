/** Disposable research harness. Product files and personal saves are never edited. */
import assert from 'node:assert/strict';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { presetPeople } from '@reform/Setup';
import { defaultWorldConfig, generateWorld } from '@reform/world';
import { initialHouse, editHouse, furnishings, cellName } from '@reform/house';
import { createGame, setBond, enableHousing, advance, order, inspectOrder, options, isGame } from '@reform/sim';
import { exportSlot, importSlot, branchSlot } from '@reform/library';
import { housingStatus, nextCompletionMinutes } from '@reform/housing/presentation';
import { applyHousingHouseEdit } from '@reform/housing/runtime';
import { buildHousingTopology, housingRoomId } from '@reform/housing/topology';
import { setHousingRoomAccess } from '@reform/housing/bridge';
import { createRoomConstruction, reserveConstructionMaterial, assignConstructionHaul, assignConstructionBuild } from '@reform/housing/construction';

const people = presetPeople(0);
const [kaya, sui] = people.map(p => p.id);
const ids = [kaya, sui];
const initial = enableHousing(setBond(createGame(people, generateWorld(defaultWorldConfig()), 'forest', initialHouse()), kaya, sui, 'friend'), 'new');
const baseSlot = { id: 'research-origin', name: '同じ木工の二人の08:00', game: initial, origin: structuredClone(initial) };
const captureDirectory = process.env.COMPARISON_OUTPUT_DIR;
function captureGenerated(file:string, game:any) { if(captureDirectory) writeFileSync(join(captureDirectory,file), exportSlot({...baseSlot,game}),'utf8'); }
captureGenerated('generated-origin-slot.json', initial);
const stable = (x:any) => JSON.parse(JSON.stringify(x));
const hash = (x:any) => createHash('sha256').update(JSON.stringify(x)).digest('hex');
const originHash = hash(initial);
const actor = (g:any,id:string) => g.actors.find((a:any) => a.person.id === id);
const stock = (g:any) => Object.fromEntries(['wood','food','ingredients','coins'].map(k=>[k,g[k]]));
const delta = (a:any,b:any) => Object.fromEntries(Object.keys(a).map(k=>[k,b[k]-a[k]]));
const clock = (t:number) => `D${Math.floor(t/1440)+1} ${String(Math.floor(t/60)%24).padStart(2,'0')}:${String(t%60).padStart(2,'0')}`;
const task = (a:any) => a.task ? stable(a.task) : null;
const pos = (g:any,id:string) => stable(g.housing.state.actors[id]?.position ?? g.housing.unlocated[id] ?? null);
const snapshot = (g:any) => ({ time:g.time, clock:clock(g.time), stock:stock(g), rng:g.rng, actors:ids.map(id=>{
  const a=actor(g,id); return {id,name:a.person.name,location:a.location,room:a.room,position:pos(g,id),task:task(a),needs:stable(a.needs),mood:a.mood,metrics:stable(a.metrics),memories:stable(a.memories),reason:a.reason,cargo:stable(a.cargo)};
}), reservations:stable(g.housing.state.reservations), construction:stable(g.housing.construction??null), items:stable(g.housing.state.items) });
const succeed = (r:any) => { assert.equal(r.error,undefined); assert.ok(isGame(r.game)); return r.game; };
function topology(g:any){ return buildHousingTopology(g.house,Object.keys(g.housing.state.actors),g.housing.controls,g.housing.state.actors,g.housing.layoutVersion,g.housing.construction); }
function inventory(g:any){const slots=topology(g).slots;return g.house.rooms.flatMap((r:any)=>r.fixtures.map((f:any)=>({roomId:r.id,roomName:r.name,width:r.width,height:r.height,fixtureId:f.id,kind:f.kind,name:furnishings[f.kind].name,fixtureCell:f.cell,fixtureCoordinate:cellName(r,f.cell),usePoints:Object.values(slots).filter((s:any)=>s.fixtureId===f.id).map((s:any)=>({seat:s.seat,cell:s.point.cell,coordinate:cellName(r,s.point.cell)}))})));}
function build(g:any,kind:string,room:string,cell:number){return succeed(applyHousingHouseEdit(g,editHouse(g.house,{type:'build',kind,room,cell} as any)));}
function sameExceptLog(a:any,b:any){const x=structuredClone(a),y=structuredClone(b);delete x.log;delete y.log;assert.deepEqual(stable(x),stable(y));}
function inspect(g:any,id:string,kind:string,target?:string){const prior=hash(g);const v=inspectOrder(g,id,kind,target);assert.equal(hash(g),prior);return v;}
function countedAdvance(g:any,n:number){const r=advance(g,n);assert.equal(r.time,g.time+n);assert.ok(isGame(r));return r;}

class Trace {
  g:any; slot:any; name:string; events:any[]=[]; attempts:any[]=[]; actions:any[]=[]; checkpoints:any[]=[]; minutes:any[]=[]; active=new Map<string,any>();
  constructor(name:string,game?:any){this.name=name;this.slot=branchSlot(baseSlot,true,name);this.g=game??this.slot.game;this.note('start');for(const id of ids)if(actor(this.g,id).task)this.open(id,actor(this.g,id).task,'continuing-at-fork',this.g);}
  note(label:string,extra:any={}){this.events.push({label,...snapshot(this.g),...extra});}
  open(id:string,t:any,source:string,before:any){const entry={number:this.actions.length+1,actorId:id,actorName:actor(before,id).person.name,source,start:before.time,startClock:clock(before.time),task:stable(t),startPosition:pos(before,id),startNeeds:stable(actor(before,id).needs),metrics:{free:0,work:0,care:0,travel:0,waiting:0},end:null,endKind:null};this.actions.push(entry);this.active.set(id,entry);return entry;}
  close(id:string,kind:string,state=this.g){const a=this.active.get(id);if(a){a.end=state.time;a.endClock=clock(state.time);a.endKind=kind;a.elapsed=state.time-a.start;a.endPosition=pos(state,id);a.endNeeds=stable(actor(state,id).needs);a.memories=stable(actor(state,id).memories);a.endTask=task(actor(state,id));this.active.delete(id);}}
  issue(id:string,kind:string,target:string|undefined,label:string,expect:'accept'|'reject'='accept'){
    const before=this.g;const preview=inspect(before,id,kind,target);const accepted=!preview.disabled;
    assert.equal(accepted,expect==='accept',`${label}: ${preview.disabled??'unexpected acceptance'}`);
    const after=order(before,id,kind,target);assert.equal(after.time,before.time);assert.ok(isGame(after));
    if(!accepted)sameExceptLog(before,after);
    this.g=after;
    const item={sequence:this.attempts.length+1,time:before.time,clock:clock(before.time),actorId:id,kind,target:target??null,label,accepted,preview,before: snapshot(before),after:snapshot(after),inspectionReadOnly:true,rejectionPreservedTaskAndState:!accepted};this.attempts.push(item);
    if(accepted){if(this.active.has(id))this.close(id,'replaced-by-direct-order',before);if(actor(after,id).task)this.open(id,actor(after,id).task,'direct',after);}
    return item;
  }
  tick(){
    const before=this.g;this.g=countedAdvance(before,1);
    const record:any={time:this.g.time,clock:clock(this.g.time),stockDelta:delta(stock(before),stock(this.g)),actors:[]};
    for(const id of ids){const a=actor(before,id),b=actor(this.g,id);const d=delta(a.metrics,b.metrics);assert.equal(Object.values(d).reduce((s:number,v:any)=>s+v,0),1);
      if(!a.task&&b.task){const started=this.open(id,b.task,'automatic',before);if(b.task.kind==='need'&&b.task.target==='energy'){
        started.bedCandidatesAtMinuteStart=inventory(before).filter((f:any)=>f.kind==='mat'||f.kind==='bed').map((f:any)=>({fixtureId:f.fixtureId,roomId:f.roomId,preview:inspect(before,id,'home-use',f.fixtureId)}));
        started.reservationsAtMinuteStart=stable(before.housing.state.reservations);
      }}
      const active=this.active.get(id);if(active)for(const k of Object.keys(d))active.metrics[k]+=d[k];
      record.actors.push({id,metric:Object.keys(d).find(k=>d[k]===1),kind:(a.task??b.task)?.kind??null,target:(a.task??b.task)?.target??null,mode:(a.task??b.task)?.mode??null,station:(a.task??b.task)?.station??null,phaseBefore:before.housing.state.actors[id]?.order?.phase??null,phaseAfter:this.g.housing.state.actors[id]?.order?.phase??null,positionBefore:pos(before,id),positionAfter:pos(this.g,id),remaining:b.task?.remaining??null});
      if(a.task&&!b.task){this.close(id,'completed');this.events.push({label:'action-completed',actorId:id,completedTask:stable(a.task),...snapshot(this.g)});}
    }
    if(Object.values(before.housing.construction?.plans??{}).some((p:any)=>p.assignment?.kind==='deliver'))record.constructionItemsAfter=stable(this.g.housing.state.items);
    this.minutes.push(record);return this.g;
  }
  to(t:number){while(this.g.time<t)this.tick();assert.equal(this.g.time,t);}
  until(predicate:()=>boolean,max=3000){let n=0;while(!predicate()){assert.ok(++n<=max,'run exceeded bound');this.tick();}}
  check(label:string,n=7){const beforeHash=hash(this.g);const loaded=importSlot(exportSlot({...this.slot,game:this.g}));assert.deepEqual(stable(loaded.game),stable(this.g));assert.deepEqual(stable(loaded.origin),stable(initial));const batch=countedAdvance(this.g,n),restored=countedAdvance(loaded.game,n);let single=this.g;for(let i=0;i<n;i++)single=countedAdvance(single,1);assert.deepEqual(stable(batch),stable(restored));assert.deepEqual(stable(batch),stable(single));assert.equal(hash(this.g),beforeHash);assert.equal(hash(this.slot.origin),originHash);this.checkpoints.push({label,time:this.g.time,clock:clock(this.g.time),advanceMinutes:n,gameHash:beforeHash,originHash:hash(loaded.origin),reloadGameEqual:true,reloadOriginEqual:true,batchEqualsMinuteSteps:true,restoredContinuationEqual:true,positions:ids.map(id=>({id,position:pos(this.g,id),phase:this.g.housing.state.actors[id]?.order?.phase??null,task:task(actor(this.g,id))})),reservations:stable(this.g.housing.state.reservations)});}
  checkNextCompletion(label:string){const beforeHash=hash(this.g);const n=nextCompletionMinutes(this.g);assert.ok(n!==null&&n>0);assert.equal(hash(this.g),beforeHash);const after=countedAdvance(this.g,n);const finished=ids.filter(id=>actor(this.g,id).task&&!actor(after,id).task);assert.ok(finished.length>0);this.events.push({label,time:this.g.time,clock:clock(this.g.time),nextCompletionMinutes:n,finishedActorIds:finished,afterClock:clock(after.time),readOnly:true});}
  result(extra:any={}){assert.equal(hash(initial),originHash);assert.equal(hash(this.slot.origin),originHash);return {name:this.name,...extra,inventory:inventory(this.g),attempts:this.attempts,actions:this.actions,events:this.events,checkpoints:this.checkpoints,minuteLog:this.minutes,finalState:snapshot(this.g),...(this.g.time===1920?{morning:snapshot(this.g)}:{}),oneMinuteLater:snapshot(countedAdvance(this.g,1)),originPreserved:true};}
}

let rejectedFork:any;
function readingTrial(branch:'A'|'B'|'C'){
  const t=new Trace(branch);t.g=build(t.g,'shelf','living',1);const first=inventory(t.g).find((f:any)=>f.kind==='shelf').fixtureId;let second:string|undefined;
  if(branch==='B'){t.g=build(t.g,'shelf','living',2);second=inventory(t.g).filter((f:any)=>f.kind==='shelf')[1].fixtureId;}
  let planId:string|undefined;
  if(branch==='C'){
    const planned=createRoomConstruction(t.g,{name:'読書室',neighborId:'bedroom',stagingCell:2});t.g=succeed(planned);planId=planned.planId;t.note('construction-planned');
    t.g=succeed(reserveConstructionMaterial(t.g,planId));t.note('construction-wood-reserved');t.check('construction-material-reserved',1);
    t.g=succeed(assignConstructionHaul(t.g,planId,sui,'deliver'));t.open(sui,actor(t.g,sui).task,'construction-deliver',t.g);t.note('construction-haul-assigned');
  }else t.issue(sui,'work','wood','08:00 非増築枝のスイは木工を一回');
  t.issue(kaya,'work','wood:hard','08:00 全枝共通のカヤの木工');
  while(t.g.time<516){
    if(!actor(t.g,kaya).task)t.issue(kaya,'work','wood:hard','共通の木工を再開');
    const previousPlan=planId&&t.g.housing.construction.plans[planId];
    t.tick();
    if(branch==='C'&&t.g.time===482)t.check('construction-haul-in-transit',9);
    if(planId&&previousPlan.assignment?.kind==='deliver'&&!t.g.housing.construction.plans[planId].assignment){t.note('construction-delivered');t.g=succeed(assignConstructionBuild(t.g,planId,sui));t.open(sui,actor(t.g,sui).task,'construction-build',t.g);t.note('construction-build-assigned');}
    if(branch==='C'&&t.g.time===500)t.check('construction-work-in-progress',17);
  }
  if(planId){assert.equal(t.g.housing.construction.plans[planId].status,'completed');const room=t.g.housing.construction.plans[planId].roomId;t.g=build(t.g,'shelf',room,2);second=inventory(t.g).find((f:any)=>f.roomId===room&&f.kind==='shelf').fixtureId;t.note('4x3-room-complete-and-second-shelf-installed');}
  const beforeRead=snapshot(t.g), geometryAtReading=inventory(t.g);
  t.issue(kaya,'home-use',first,'08:36 カヤが共通の本棚を先に指定');const kayaAction=t.active.get(kaya);
  const rejected=t.issue(sui,'home-use',first,'08:36 住人をスイに切り替えて同じ本棚を指定','reject');
  const automaticAlternative=inspect(t.g,sui,'need','fun');
  if(branch==='A')rejectedFork=structuredClone(t.g);
  if(second)t.issue(sui,'home-use',second,'08:36 スイが空いている二台目の本棚を選び直す');
  else t.note('A keeps the rejected request\'s preserved automatic wood task; 28 minutes remain');
  t.check('both-orders-reserved',1);
  t.checkNextCompletion('next-completion-time-forward-from-first-reading');
  let suiReadingAction=second?t.active.get(sui):undefined;
  let usageCheckpoint=false,moveCheckpoint=false;
  while(!suiReadingAction?.end||!kayaAction.end){
    t.tick();
    const spatial=t.g.housing.state.actors[sui]?.order;
    if(second&&!moveCheckpoint&&t.g.housing.state.actors[sui]?.position.kind==='transit'){t.check('sui-reading-movement',20);moveCheckpoint=true;}
    if(!suiReadingAction&&!actor(t.g,sui).task){t.issue(sui,'home-use',first,'スイの木工完了後に本棚を再指定');suiReadingAction=t.active.get(sui);}
    if(suiReadingAction&&!usageCheckpoint&&spatial?.phase==='use'&&actor(t.g,sui).task?.remaining<14){t.check('sui-reading-use',19);usageCheckpoint=true;}
  }
  const bothDone=snapshot(t.g);t.note('both-have-completed-one-directed-reading');t.to(1920);t.check('next-morning',15);
  return t.result({control:'Common origin at 08:00. Primary shelf living cell1. Kaya hard wood until 08:36 in every branch. A/B Sui wood once then autonomous until 08:36. C Sui hauls/builds; secondary shelf placed after completion. At 08:36 Kaya first; Sui same-shelf request rejected. B/C choose second shelf. A preserves the current automatic wood task (4 minutes already used; 28 minutes remain), finishes it, and manually retries the same shelf. All actors otherwise act autonomously until next 08:00.',constructionWood:branch==='C'?6:0,furnitureWood:branch==='A'?4:8,beforeRead,geometryAtReading,automaticAlternativeAfterRejection:automaticAlternative,rejectedSameShelfPreservedPriorTask:rejected.rejectionPreservedTaskAndState,directedReading:{kaya:kayaAction,sui:suiReadingAction,bothDone},selectionPolicyCaveat:'A productive retry is a research control, not an automatic queue. First and second shelves have distinct usable floor cells. Different layouts can change routes to pre-existing furniture. Kaya\'s common 39-minute wood task is interrupted after 36 minutes and produces no wood.'});
}

function readingAlternative(policy:'explicit-wait'|'automatic-other-furniture'|'restart-wood-control'){
  const t=new Trace(`A-${policy}`,structuredClone(rejectedFork));const first=inventory(t.g).find((f:any)=>f.kind==='shelf').fixtureId;
  if(policy==='restart-wood-control'){
    t.issue(sui,'work','wood','初報の統制: 4分進んだ自主木工を新しい直接木工32分に置き換える');const wood=t.active.get(sui);t.until(()=>!!wood.end);t.issue(sui,'home-use',first,'直接木工完了後に本棚を再指定');const a=t.active.get(sui);t.until(()=>!!a.end);return t.result({directedAction:a,woodAction:wood,note:'Original preliminary control. It intentionally discards four elapsed minutes of automatic woodworking; the main A branch instead preserves that work.'});
  }
  if(policy==='automatic-other-furniture'){
    t.issue(sui,'need','fun','予約後、スイは自動選択で別の楽しみ設備へ');const a=t.active.get(sui);t.until(()=>!!a.end);return t.result({directedAction:a,note:'Uses the pre-existing window seat; not a second simultaneous use of the one shelf.'});
  }
  while(inspect(t.g,sui,'home-use',first).disabled){
    if(actor(t.g,sui).task?.kind!=='wait')t.issue(sui,'wait',undefined,'研究制御: 公開本体APIで5分待機（現行UIに待機指示ボタンはない）');
    t.tick();
  }
  t.issue(sui,'home-use',first,'予約解除を確認し、手動で同じ本棚を再指定');const a=t.active.get(sui);t.until(()=>!!a.end);return t.result({directedAction:a,note:'Repeated explicit five-minute wait orders through public core API; no furniture queue exists, and wait is not listed in current UI options. Last wait is interrupted when the shelf becomes available.'});
}

function sleepChoiceChecks(){
  const g=build(initial,'mat','bedroom',2),beds=inventory(g).filter((f:any)=>f.kind==='mat');const newMat=beds.find((f:any)=>f.fixtureId!=='mat-1').fixtureId;
  const automaticAtSamePosition=ids.map(id=>({id,position:pos(g,id),preview:inspect(g,id,'need','energy')}));
  const firstK=order(g,kaya,'need','energy');const directSame=inspect(firstK,sui,'home-use',newMat);assert.ok(directSame.disabled);const nextS=inspect(firstK,sui,'need','energy');
  const firstS=order(g,sui,'need','energy');const nextK=inspect(firstS,kaya,'need','energy');
  const t=new Trace('bed-nearness',g);t.issue(kaya,'home-move',JSON.stringify({roomId:'bedroom',cell:6}),'元のむしろの利用床へ歩く');const move=t.active.get(kaya);t.until(()=>!!move.end);const nearerOriginal={time:t.g.time,position:pos(t.g,kaya),auto:inspect(t.g,kaya,'need','energy'),explicitOther:inspect(t.g,kaya,'home-use',newMat)};
  const restricted=setHousingRoomAccess(g,'bedroom',[kaya]);const sameRoomRestriction={kaya:inspect(restricted,kaya,'need','energy'),sui:inspect(restricted,sui,'need','energy'),suiEach:beds.map((b:any)=>({fixtureId:b.fixtureId,preview:inspect(restricted,sui,'home-use',b.fixtureId)}))};
  const deniedInside=setHousingRoomAccess(t.g,'bedroom',[sui]);const insideRoomRestriction={kayaPosition:pos(deniedInside,kaya),beds:beds.map((b:any)=>({fixtureId:b.fixtureId,preview:inspect(deniedInside,kaya,'home-use',b.fixtureId)}))};
  let split=succeed(applyHousingHouseEdit(g,editHouse(g.house,{type:'move',id:newMat,room:'living',cell:8})));split=setHousingRoomAccess(split,'bedroom',[kaya]);const splitRestrictions=ids.map(id=>({id,automatic:inspect(split,id,'need','energy'),privateBed:inspect(split,id,'home-use','mat-1')}));
  t.check('nearness-after-public-movement',9);
  return {stock:stock(g),beds,automaticAtSamePosition,firstKayaThenSui:{first:inspect(g,kaya,'need','energy'),sameChosenRejected:directSame,secondAuto:nextS},firstSuiThenKaya:{first:inspect(g,sui,'need','energy'),secondAuto:nextK},nearerOriginal,sameRoomRestriction,insideRoomRestriction,splitRoomInventory:inventory(split),splitRestrictions,proof:t.result(),interpretation:'Distance and reservation order explain these choices; different quiet/curious personalities do not change the selected equal-type bed from the same position. Room access applies to both beds in one room; it is not a bed-owner or priority field.'};
}

function dailyTrial(){
  const t=new Trace('daily-two-identical-mats');t.g=build(t.g,'mat','bedroom',2);captureGenerated('generated-daily-start-slot.json',t.g);const mat2=inventory(t.g).find((f:any)=>f.kind==='mat'&&f.fixtureId!=='mat-1').fixtureId;t.note('second-identical-mat-installed');
  const stages=new Map(ids.map(id=>[id,'outward']));
  for(const id of ids)t.issue(id,'travel','landing','08:00 作業に出かける');
  while([...stages.values()].some(s=>s!=='meal-complete')){
    t.tick();
    for(const id of ids){const a=actor(t.g,id),stage=stages.get(id);if(a.task)continue;
      if(stage==='outward'){t.issue(id,'work',id===kaya?'wood:hard':'wood','渡し場で木工');stages.set(id,'work');}
      else if(stage==='work'){t.issue(id,'return',undefined,'仕事を終えて家に戻る');stages.set(id,'return');}
      else if(stage==='return'||stage==='meal-wait'){
        const preview=inspect(t.g,id,'need','hunger');
        if(preview.disabled){t.issue(id,'need','hunger','帰宅後の食事を試みるが、先客が予約中','reject');t.issue(id,'wait',undefined,'研究制御: 公開本体APIで5分待機して再確認（UIの指示ではない）');stages.set(id,'meal-wait');}
        else {t.issue(id,'need','hunger','帰宅後に食事');stages.set(id,'meal');}
      }else if(stage==='meal')stages.set(id,'meal-complete');
    }
    assert.ok(t.g.time<800,'morning loop did not end');
  }
  t.note('both-returned-from-work-and-ate');t.check('morning-return-and-meals',60);
  t.to(1200);t.note('20:00-before-common-rest');
  for(const id of ids)if(actor(t.g,id).task)t.issue(id,'cancel',undefined,'同じ時間帯の寝床競合を確認するため、現在の予定を取り消す');
  while(ids.some(id=>t.g.housing.state.actors[id]?.position.kind==='transit'))t.tick();
  // A cancelled transit may finish while the other resident has already chosen a new task.
  for(const id of ids)if(actor(t.g,id).task)t.issue(id,'cancel',undefined,'全員が移動区間を出た時点で比較の開始条件を整える');
  const beforeRest=snapshot(t.g),autoBefore=ids.map(id=>({id,preview:inspect(t.g,id,'need','energy')}));
  t.issue(kaya,'home-use','mat-1','夜、カヤが元のむしろを明示指定');const kayaRest=t.active.get(kaya);
  t.issue(sui,'home-use','mat-1','住人をスイに切り替え、同じむしろを選ぶ','reject');
  const autoWhileReserved=inspect(t.g,sui,'need','energy');
  t.issue(sui,'home-use',mat2,'スイはもう一台の同じむしろを選ぶ');const suiRest=t.active.get(sui);t.check('night-rest-reserved',3);
  let movementChecked=false,useChecked=false;
  while(!kayaRest.end||!suiRest.end){t.tick();if(!movementChecked&&ids.some(id=>t.g.housing.state.actors[id]?.position.kind==='transit')){t.check('night-rest-moving',17);movementChecked=true;}if(!useChecked&&ids.every(id=>t.g.housing.state.actors[id]?.order?.phase==='use')){t.check('night-rest-using',85);useChecked=true;}}
  t.note('both-directed-night-rests-completed');captureGenerated('generated-daily-after-night-slot.json',t.g);t.to(1920);t.check('daily-next-morning',60);
  return t.result({initialFurnitureWood:1,controlledSchedule:'Both travel from home forest to landing at 08:00, work once, return and eat. A returning diner who encounters the occupied single hearth receives explicit five-minute waits and retries through the core API; the wait command is not exposed by current UI options. Autonomous life follows until 20:00. The currently active tasks are cancelled via public API, with transit safely completed. Kaya requests mat-1, Sui requests the same and is rejected, then takes the other mat. Autonomous life resumes through next 08:00.',beforeRest,automaticBeforeRest:autoBefore,automaticWhileFirstBedReserved:autoWhileReserved,directedNightRest:{kaya:kayaRest,sui:suiRest},bedUses:t.actions.filter(a=>a.task.kind==='need'&&a.task.target==='energy'),caution:'This is an API scenario and UI-source reading, not an actual browser interaction. Changing active resident resets the uncommitted selector in current UI source; no UI re-selection count is claimed as a measured click count. The forced 20:00 rest starts with energy above 80; it is a controlled simultaneous-use probe, not a claim that autonomous residents would choose bed at 20:00.'});
}

const A=readingTrial('A'),B=readingTrial('B'),C=readingTrial('C');
const alternatives=[readingAlternative('explicit-wait'),readingAlternative('automatic-other-furniture'),readingAlternative('restart-wood-control')];
const sleeping=sleepChoiceChecks(),daily=dailyTrial();
const waitInOptions=options(initial,kaya).some(x=>x.kind==='wait');assert.equal(waitInOptions,false);
const out={schema:'housing-shared-use-research-1',runContext:{date:'2026-11-24',timezone:'Asia/Taipei; in-game minute clock',productLocalCommit:process.env.COMPARISON_SOURCE_COMMIT??'unrecorded',productRemoteMain:process.env.COMPARISON_REMOTE_HEAD??null,sourceRoot:process.env.COMPARISON_SOURCE_ROOT??'unrecorded',note:'Commit identity supplied by runner. This harness uses public preset data only and performs no browser, network or external-app save operation.'},originHash,origin:snapshot(initial),people,branches:{A,B,C},alternatives,sleeping,daily,checks:{initialGameValid:isGame(initial),originUnchanged:hash(initial)===originHash,personalSaveUsed:false,productCodeEdited:false,browserOperated:false,explicitWaitExposedInCurrentOptions:waitInOptions}};
console.log(JSON.stringify(out,null,2));
