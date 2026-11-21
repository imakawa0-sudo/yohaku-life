/** Actual UI from unedited public-command controls, plus separately classified
 * intentional invalid-file rejections. No browser game API or direct storage writes. */
import assert from 'node:assert/strict';
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {createRequire} from 'node:module';
import {resolve,basename} from 'node:path';
import {fileURLToPath} from 'node:url';
const project=fileURLToPath(new URL('../',import.meta.url));
const {chromium,expect}=createRequire(resolve(project,'package.json'))('@playwright/test');
const htmlPath=resolve(project,process.env.SECOND_ENCOUNTER_HTML||'dist/yohaku-v53.html'), expected=process.env.EXPECTED_HTML_SHA;
const hash=x=>createHash('sha256').update(x).digest('hex');
const html=await readFile(htmlPath);if(expected)assert.equal(hash(html),expected);
const output=resolve(process.env.PLAYTEST_OUTPUT||`/tmp/yohaku-second-encounter-${hash(html).slice(0,12)}`);
await mkdir(output,{recursive:true});
await writeFile(output+'/RUN-START.json',JSON.stringify({startedAtUTC:new Date().toISOString(),htmlPath,sha256:hash(html),classification:'public-command-controls-and-separate-invalid-file-rejections',browserGameAPI:false,directStorageWrites:false},null,2),{flag:'wx'});
await writeFile(output+'/tested-yohaku.html',html);await writeFile(output+'/tested-runner.mjs',await readFile(new URL(import.meta.url)));
const definitions=JSON.parse(await readFile(resolve(project,'tests/fixtures/second-encounter-inputs.json'),'utf8'));
await mkdir(output+'/inputfiles',{recursive:true});
for(const definition of definitions){const raw=await readFile(resolve(project,definition.path));assert.equal(hash(raw),definition.sha256);assert.equal(raw.length,definition.bytes);await writeFile(output+'/inputfiles/'+basename(definition.path),raw);definition.resolvedPath=resolve(project,definition.path);}
await writeFile(output+'/source.json',JSON.stringify({htmlPath,htmlSHA256:hash(html),htmlBytes:html.length,runnerSHA256:hash(await readFile(new URL(import.meta.url))),inputs:definitions},null,2));
const browser=await chromium.launch({executablePath:process.env.CHROMIUM_PATH||'/usr/bin/chromium',headless:true,args:['--no-sandbox']});
const entry='http://yohaku-second-encounter-control.local/';
const cases=[],errors=[],operationErrors=[],requests=[],captures=[];
const names={aki:'アキ',mio:'ミオ',ren:'レン'};
let context,page,active,blocked=false;
const person=(s,id)=>s.residents.find(r=>r.id===id);
async function state(){return page?await page.evaluate(()=>JSON.parse(localStorage.getItem('yohaku-autosave-v1')||'null')):null;}
function brief(s){return s&&{minutes:s.minutes,seed:s.seed,version:s.version,autoCombat:s.autoCombat,enemy:s.enemy,secondaryEncounter:s.secondaryEncounter,guardAgreement:s.guardAgreement,resources:s.resources,people:s.residents.map(r=>({id:r.id,place:r.location,hp:r.hp,hunger:r.hunger,energy:r.energy,wounds:r.wounds,pack:s.inventory.packs[r.id],action:r.action,held:r.suspended})),pause:s.pauseReason,logs:s.logs.slice(-3)};}
async function persist(status='in-progress'){
 if(active)await writeFile(active.path+'/manual-trail.json',JSON.stringify({classification:active.classification,input:active.input,trail:active.trail,finalState:await state()},null,2));
 await writeFile(output+'/report.json',JSON.stringify({status,htmlPath,htmlSHA256:hash(html),cases:cases.map(c=>({name:c.name,classification:c.classification,input:c.input,steps:c.trail.length})),errors,operationErrors,requests,captures},null,2));
}
async function importFile(file){
 const raw=await readFile(file,'utf8');await page.locator('.save-button').click();await page.locator('input[type=file]').setInputFiles(file);await page.waitForTimeout(100);assert.deepEqual(await state(),JSON.parse(raw));return raw;
}
async function download(name){
 const pending=page.waitForEvent('download');await page.getByRole('button',{name:'ファイルに書き出す',exact:true}).click();const raw=await readFile(await(await pending).path(),'utf8');await writeFile(active.path+'/'+name+'.json',raw,{flag:'wx'});return raw;
}
console.log(JSON.stringify({ready:true,htmlSHA256:hash(html)}));
async function execute(c){try{
 if(blocked&&!['continue','read','state','shot','inspect','close'].includes(c.op))throw Error('Blocked after operation error');
 if(c.op==='context'){
  if(context)await context.close();const path=output+'/'+c.name;await mkdir(path,{recursive:true});const raw=await readFile(c.file,'utf8');
  active={name:c.name,path,input:{path:c.file,sha256:hash(raw)},classification:c.classification||'controlled-public-commands-from-fresh-createGame',trail:[]};cases.push(active);await writeFile(path+'/input.json',raw,{flag:'wx'});
  context=await browser.newContext({offline:true,viewport:{width:390,height:844},hasTouch:true,acceptDownloads:true});
  await context.route('**/*',r=>{const url=r.request().url();requests.push({case:active.name,url});return url===entry?r.fulfill({contentType:'text/html',body:html}):r.abort();});
  page=await context.newPage();page.setDefaultTimeout(8000);page.on('pageerror',e=>errors.push({case:active.name,type:'pageerror',message:e.message}));page.on('console',m=>{if(m.type()==='error')errors.push({case:active.name,type:'console',message:m.text()});});
  await page.goto(entry);await importFile(c.file);active.trail.push({command:c,beforeState:null,afterState:await state()});await persist();console.log(`${active.name}: input exact at ${(await state()).minutes}`);return;
 }
 const before=await state();let result;const immutable=['select','focus','nav','inspect','read','state','shot','checkpoint','export','continue','equals','combat-footer','agreement-check','dual-check','local-retreat-check','jumps-check','disabled-attack-check','reject-file','escape','note'];
 if(c.op==='continue'){blocked=false;result={continued:true};}
 else if(c.op==='read')result={body:(await page.locator('body').innerText()).slice(0,c.limit||15000),state:brief(before)};
 else if(c.op==='state')result=brief(before);
 else if(c.op==='note')result={note:c.text};
 else if(c.op==='click')await(c.selector?page.locator(c.selector):page.getByRole(c.role||'button',{name:c.name,exact:c.exact!==false})).click({timeout:5000});
 else if(c.op==='select'){for(const [id,name]of Object.entries(names)){const card=page.locator(`.residents-list .resident-card[aria-label^="${name}を"]`);if((await card.getAttribute('aria-pressed')==='true')!==c.ids.includes(id))await card.click();}}
 else if(c.op==='focus'){const card=page.locator(`.residents-list .resident-card[aria-label^="${names[c.id]}を"]`);await card.click();await card.click();}
 else if(c.op==='nav')await page.getByRole('navigation').getByRole('button',{name:c.name,exact:true}).click();
 else if(c.op==='inspect')result=await page.locator(c.selector).evaluateAll(ns=>ns.map(n=>({text:n.innerText,title:n.title,disabled:n.disabled,pressed:n.getAttribute('aria-pressed'),encounterId:n.getAttribute('data-encounter-id')})));
 else if(c.op==='import'){await importFile(c.file);result={path:c.file,wholeWorldExact:true};}
 else if(c.op==='escape')await page.keyboard.press('Escape');
 else if(c.op==='reject-file'){
  const definition=definitions.find(item=>item.resolvedPath===c.file);assert.equal(definition?.classification,'intentionally-invalid-field-edited-save');
  const selection=await page.locator('.residents-list .resident-card[aria-pressed="true"]').allTextContents();
  const dismiss=page.getByRole('button',{name:'通知を閉じる',exact:true});if(await dismiss.isVisible())await dismiss.click();
  await expect(page.locator('.toast')).toBeHidden();
  if(!await page.getByRole('dialog').isVisible())await page.locator('.save-button').click();
  await page.locator('input[type=file]').setInputFiles(c.file);
  await expect(page.locator('.toast')).toBeVisible();await expect(page.locator('.toast')).toContainText(/保存.*不正/);
  assert.deepEqual(await state(),before,'invalid file must leave complete world, clock, jobs and reservations unchanged');
  assert.deepEqual(await page.locator('.residents-list .resident-card[aria-pressed="true"]').allTextContents(),selection);
  assert(await page.getByRole('dialog').isVisible(),'a rejected file must not close the save dialog as a successful import');
  result={path:c.file,sha256:definition.sha256,classification:definition.classification,intentionalFieldEdits:true,expectedRejection:true,notification:await page.locator('.toast').innerText(),wholeWorldClockJobsReservationsAndSelectionExact:true};
  if(!c.keepOpen)await page.keyboard.press('Escape');
 }
 else if(c.op==='equals'){assert.deepEqual(before,JSON.parse(await readFile(c.file,'utf8')));result={path:c.file,wholeWorldExact:true};}
 else if(c.op==='combat-footer'){
  assert.deepEqual(await page.locator('.advance-controls button').allTextContents(),['1分','5分','10分']);assert(await page.locator('.night-button').isDisabled());assert(await page.locator('.time-bar').evaluate(n=>n.classList.contains('is-combat')));result={minuteSteps:[1,5,10],shortcutDisabled:true,text:await page.locator('.time-bar').innerText()};
 }else if(c.op==='dual-check'){
  const initial=JSON.parse(await readFile(c.file,'utf8'));assert.equal(before.minutes,initial.minutes+1);assert(before.enemy.hp<initial.enemy.hp);assert(before.secondaryEncounter.hp<initial.secondaryEncounter.hp);for(const id of ['mio','ren'])assert(person(before,id).hp<person(initial,id).hp);assert.equal(person(before,'aki').action.id,person(initial,'aki').action.id);assert.equal(person(before,'aki').action.progress,person(initial,'aki').action.progress+1);assert.deepEqual(person(before,'aki').action.reserved,person(initial,'aki').action.reserved);result={bothEnemiesAndBodiesAdvanced:true,homeJobProgressAndReservation:true};
 }else if(c.op==='agreement-check'){
  const initial=JSON.parse(await readFile(c.file,'utf8'));assert.equal(before.minutes,initial.minutes);assert.equal(before.seed,initial.seed);assert.deepEqual(before.enemy,initial.enemy);assert.deepEqual(before.secondaryEncounter,initial.secondaryEncounter);assert.deepEqual(person(before,'ren'),person(initial,'ren'));assert.deepEqual(person(before,'aki'),person(initial,'aki'));assert.equal(before.autoCombat,true);assert(before.guardAgreement);assert.equal(before.inventory.packs.mio.food,initial.inventory.packs.mio.food-3);assert.equal(person(before,'mio').action,null);assert.equal(person(before,'mio').hp,person(initial,'mio').hp);result={clockSeedFirstEnemySecondEncounterAndSecondResidentExact:true,onlyFirstAICleared:true,payment:3};
 }else if(c.op==='local-retreat-check'){
  assert.equal(before.secondaryEncounter.defeated,true);assert.equal(before.enemy.defeated,false);assert.equal(before.enemy.hp,80);assert.equal(person(before,'mio').action.kind,'defend');assert.equal(person(before,'mio').action.encounterId,undefined);assert.equal(person(before,'ren').action,null);result={firstStillPresent:true,secondRetreated:true,firstManualDefenceKept:true};
 }else if(c.op==='jumps-check'){
  const buttons=page.locator('.attention-board > .attention-item > button');assert.equal(await buttons.count(),2);const chosen=await page.locator('.residents-list .resident-card[aria-pressed="true"]').allTextContents();const seen=[];
  for(const [index,id]of ['mio','ren'].entries()) { const label=await buttons.nth(index).getAttribute('aria-label');await buttons.nth(index).click();await page.waitForTimeout(80);assert((await page.locator('.residents-list .resident-card[data-viewing="true"]').getAttribute('aria-label')).startsWith(names[id]+'を'));assert.deepEqual(await page.locator('.residents-list .resident-card[aria-pressed="true"]').allTextContents(),chosen);assert.deepEqual(await state(),before);seen.push({label,viewed:id,selectionAndWorldUnchanged:true}); }
  result={directVisibleButtonsOutsideClosedDetails:true,jumps:seen};
 }else if(c.op==='disabled-attack-check'){
  const button=page.locator('.action-grid > .action-card').filter({has:page.locator('strong',{hasText:'攻撃する'})});assert.equal(await button.count(),1);assert(await button.isDisabled());const title=await button.getAttribute('title');assert(title);result={disabled:true,title,visibleEncounter:await page.locator('.field-status').getAttribute('data-encounter-id'),selected:await page.locator('.residents-list .resident-card[aria-pressed="true"]').allTextContents()};
 }else if(c.op==='shot'){
  const width=c.width||390,height=width===1280?900:844;await page.setViewportSize({width,height});if(c.selector)await page.locator(c.selector).evaluate(n=>n.scrollIntoView({block:'start'}));await page.evaluate(async()=>{await document.fonts.ready;await new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)));});const path=active.path+'/'+c.name+'.png';await page.screenshot({path});const geometry=await page.evaluate(()=>({client:document.documentElement.clientWidth,scroll:document.documentElement.scrollWidth}));assert.equal(geometry.client,geometry.scroll);result={path,sha256:hash(await readFile(path)),width,height,geometry,visuallyReviewed:false};captures.push(result);await page.setViewportSize({width:390,height:844});
 }else if(c.op==='export'){
  await page.locator('.save-button').click();const raw=await download(c.name);assert.deepEqual(JSON.parse(raw),before);await page.keyboard.press('Escape');result={path:active.path+'/'+c.name+'.json',sha256:hash(raw)};
 }else if(c.op==='checkpoint'){
  await page.locator('.save-button').click();await page.getByRole('button',{name:'いまの暮らしを保存する',exact:true}).click();const raw=await download(c.name);assert.deepEqual(JSON.parse(raw),before);await page.keyboard.press('Escape');await page.reload();assert.deepEqual(await state(),before);await page.locator('.save-button').click();const again=await download(c.name+'-reload-export');assert.equal(again,raw);await page.keyboard.press('Escape');result={path:active.path+'/'+c.name+'.json',sha256:hash(raw),wholeWorldExact:true,reloadExact:true,reExportBytesExact:true};
 }else if(c.op==='close'){
  assert.deepEqual(errors,[]);assert.deepEqual(operationErrors,[]);assert(requests.every(item=>item.url===entry),'unexpected external request');await persist('completed');await browser.close();console.log(JSON.stringify({closed:true,cases:cases.length,errors,operationErrors,captures:captures.length}));return;
 }else throw Error('Unknown operation '+c.op);
 await page.waitForTimeout(80);const after=await state();
 if(c.op==='click'&&c.selector==='.auto-combat-toggle'){assert.equal(after.autoCombat,!before.autoCombat);assert.deepEqual({...after,autoCombat:before.autoCombat},before);}
 if(c.op==='click'&&c.selector?.includes('.advance-controls')){const requested=Number(c.selector.match(/(\d+)分/)[1]);assert(after.minutes>before.minutes&&after.minutes<=before.minutes+requested);}
 if(c.op==='click'&&c.selector?.startsWith('.running-work')){assert.equal(person(after,'ren').action,null);assert.deepEqual(person(after,'ren').suspended,person(before,'ren').suspended);assert.equal(after.minutes,before.minutes);}
 if(c.op==='click'&&c.selector?.startsWith('.suspended-work')){assert.deepEqual(person(after,'ren').action,person(before,'ren').suspended);assert.equal(person(after,'ren').suspended,null);assert.equal(after.minutes,before.minutes);}
 if(immutable.includes(c.op))assert.deepEqual(after,before,c.op+' must not change world');active.trail.push({command:c,beforeState:before,afterState:after,output:result});await persist();console.log(`${active.name}: ${c.op} ${before.minutes}->${after.minutes}`);
 }catch(error){blocked=true;operationErrors.push({command:c,error:String(error),stack:error.stack});await persist('failed');throw error;}}


const file=role=>{const definition=definitions.find(item=>item.role===role);assert(definition);return definition.resolvedPath;};
const tick=minutes=>({op:'click',selector:`.advance-controls button:text-is("${minutes}分")`});
const checkpoint=name=>({op:'checkpoint',name});
const commands=[
 {op:'context',name:'dual-manual',file:file('dual-manual')},
 {op:'select',ids:['aki']},{op:'focus',id:'aki'},{op:'combat-footer'},
 {op:'shot',name:'two-fronts-home-work-global-time-1280',width:1280,selector:'.scene-focus'},
 {op:'jumps-check'},
 {op:'shot',name:'two-fronts-ridge-visible-jumps-390',width:390,selector:'.field-status'},
 {op:'select',ids:['mio']},{op:'focus',id:'ren'},{op:'disabled-attack-check'},
 tick(1),{op:'dual-check',file:file('dual-manual')},{op:'equals',file:file('dual-expected')},
 checkpoint('both-fronts-one-minute'),
 {op:'import',file:file('dual-manual')},tick(1),
 {op:'equals',file:output+'/dual-manual/both-fronts-one-minute.json'},
 {op:'export',name:'replayed-same-one-minute'},
 {op:'context',name:'first-agreement',file:file('agreement')},
 {op:'select',ids:['mio']},{op:'focus',id:'mio'},
 {op:'click',selector:'.guard-agreement-action'},
 {op:'agreement-check',file:file('agreement')},{op:'combat-footer'},
 {op:'shot',name:'first-agreement-second-still-fighting-1280',width:1280,selector:'.field-status'},
 {op:'click',selector:'.auto-combat-toggle'},{op:'click',selector:'.auto-combat-toggle'},
 checkpoint('agreement-clock-zero-second-two-slots'),
 tick(1),tick(5),tick(10),{op:'combat-footer'},
 {op:'select',ids:['ren']},{op:'focus',id:'ren'},
 {op:'shot',name:'second-manual-two-slots-after-1-5-10-390',width:390,selector:'.workboard'},
 checkpoint('second-defence-after-1-5-10'),
 {op:'select',ids:['ren']},{op:'focus',id:'ren'},
 {op:'click',selector:'.running-work .work-controls button:text-is("取消")'},
 {op:'click',selector:'.suspended-work button:text-is("再開する")'},tick(1),
 checkpoint('second-held-attack-explicitly-resumed'),
 {op:'context',name:'local-retreat',file:file('local-retreat')},tick(5),
 {op:'local-retreat-check'},{op:'combat-footer'},
 {op:'select',ids:['ren']},{op:'focus',id:'mio'},{op:'disabled-attack-check'},
 {op:'select',ids:['mio']},{op:'focus',id:'mio'},
 {op:'shot',name:'second-retreated-first-battle-remains-390',width:390,selector:'.field-status'},
 checkpoint('only-second-retreated-first-continues'),
 ...['周辺を探索','拠点','住民たち','日誌'].flatMap(name=>[{op:'nav',name},{op:'combat-footer'}]),
 {op:'context',name:'invalid-current-files',file:file('dual-manual'),classification:'valid-control-with-intentionally-invalid-import-attempts'},
 {op:'reject-file',file:file('invalid-current-away')},
 {op:'reject-file',file:file('invalid-current-after-defeat'),keepOpen:true},
 {op:'shot',name:'invalid-second-current-files-rejected-world-kept-390',width:390,selector:'.toast'},
 {op:'escape'},
 {op:'equals',file:file('dual-manual')},
 {op:'close'},
];
try { for(const item of commands)await execute(item); }
finally { await browser.close(); }
