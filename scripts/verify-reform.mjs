// Exercise the distributed single-file game. Game state changes only through its UI.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { chromium, expect } from "@playwright/test";

const html = await readFile(process.env.REFORM_HTML || "dist/yohaku.html", "utf8");
const output = resolve(process.env.PLAYTEST_OUTPUT || "/tmp/yohaku-reform-playtest");
const url = "http://reform.offline.test/";
const sha256 = createHash("sha256").update(html).digest("hex");
const report = { sha256, checks: [], outcomes: [], screenshots: [] };
await mkdir(output, { recursive: true });
const browser = await chromium.launch({
  headless: true, executablePath: process.env.CHROMIUM_PATH || "/usr/bin/chromium",
  args: ["--no-sandbox"],
});
const pageErrors = [], unexpectedRequests = [];
const button = (page, name) => page.getByRole("button", { name, exact: true });
function record(check) {
  report.checks.push(check);
  console.log("✓ " + check);
}
async function fresh(width) {
  const context = await browser.newContext({
    offline: true, viewport: { width, height: width < 600 ? 844 : 900 },
    acceptDownloads: true,
  });
  await context.route("**/*", async route => {
    if (route.request().url() === url) {
      await route.fulfill({ contentType: "text/html; charset=utf-8", body: html });
    } else {
      unexpectedRequests.push(route.request().url());
      await route.abort();
    }
  });
  await context.addInitScript(() => {
    if (sessionStorage.getItem("reform-check-init")) return;
    localStorage.setItem("yohaku-save-v1", "legacy-manual-sentinel");
    localStorage.setItem("yohaku-autosave-v1", "legacy-auto-sentinel");
    sessionStorage.setItem("reform-check-init", "1");
  });
  const page = await context.newPage();
  page.setDefaultTimeout(6000);
  page.on("pageerror", error => pageErrors.push(error.message));
  page.on("console", message => {
    if (message.type() === "error") pageErrors.push(message.text());
  });
  await page.goto(url);
  return page;
}
async function screenshot(page, name) {
  const overflow = await page.evaluate(() => ({
    width: innerWidth, content: document.documentElement.scrollWidth,
  }));
  assert.ok(overflow.content <= overflow.width + 1, name + " horizontal overflow: " + JSON.stringify(overflow));
  await page.screenshot({ path: resolve(output, name + ".png"), animations: "disabled" });
  report.screenshots.push(name);
}
async function checkLegacy(page) {
  const result = await page.evaluate(() => ["yohaku-save-v1", "yohaku-autosave-v1"].map(k => localStorage.getItem(k)));
  assert.deepEqual(result, ["legacy-manual-sentinel", "legacy-auto-sentinel"]);
}
async function showSection(page, title) {
  const summary = page.locator("summary").filter({ hasText: title }).first();
  await expect(summary).toBeVisible();
  if (!(await summary.locator("..").evaluate(el => el.open))) await summary.click();
}
async function nextMorning(page) {
  await button(page, "翌朝まで進める").click();
}
async function finish(page) {
  await button(page, "次の行動完了まで進める").click();
}
function clockDay(time) {
  return Math.floor(time / 1440) + 1;
}
function extractMetrics(game) {
  return {
    day: clockDay(game.time), time: game.time, wood: game.wood, food: game.food, coins: game.coins,
    bridge: game.world.bridge, tradedGoods: game.world.trade.deliveries,
    residents: game.actors.map(a => ({
      name: a.person.name, location: a.location, level: a.level, skills: a.person.skills,
      needs: a.needs, mood: a.mood, metrics: a.metrics,
    })),
  };
}
const saveKey = "yohaku-reform-library-v2";
async function library(page) {
  await expect(page.locator(".rf-app")).toHaveAttribute("aria-busy","false");
  const saved = await page.evaluate(key => {
    const value = localStorage.getItem(key);
    return value === null ? null : JSON.parse(value);
  }, saveKey);
  assert.ok(saved, "The UI wrote its reform save");
  return saved;
}
async function currentGame(page) {
  const data = await library(page);
  return data.slots.find(slot => slot.id === data.activeId).game;
}
async function tab(page, name) {
  const action = button(page, name).or(page.getByRole("tab", { name, exact: true })).first();
  await action.click();
}
async function makeStart(page, preset) {
  await expect(page.getByRole("heading", { name: "暮らしを始める" })).toBeVisible();
  await button(page, preset).click();
}
async function enter(page) {
  await button(page, "この朝を始める").click();
  await expect(button(page, "15分進める")).toBeVisible();
}
async function branchAndReload(page) {
  const original = await library(page);
  await tab(page, "手帳");
  await button(page, "同じ朝から分岐").click();
  const branched = await library(page);
  assert.notEqual(branched.activeId, original.activeId);
  assert.deepEqual(branched.slots.find(s => s.id === original.activeId).game, original.slots.find(s => s.id === original.activeId).game);
  assert.equal(branched.slots.find(s => s.id === branched.activeId).game.time, 480);
  await page.reload();
  const reloaded = await library(page);
  assert.deepEqual(reloaded, branched);
  await checkLegacy(page);
  record("同じ朝への分岐後も元の暮らしと途中経過が残り、オフライン再読込で一致した。");
}
async function placeBath(page) {
  await tab(page, "住まい");
  await button(page, "居間").click();
  const hygiene = page.locator(".yh-house-metrics dl div").filter({ has: page.getByText("身支度", { exact: true }) }).locator("dd");
  const before = parseInt(await hygiene.innerText(), 10);
  await page.getByLabel("新しく置く設備", { exact: true }).selectOption("bath");
  await button(page, "この部屋に置く").click();
  await expect(hygiene).not.toHaveText(before+"分");
  const after = parseInt(await hygiene.innerText(), 10);
  assert.ok(after < before, "浴槽の設置で身支度時間が短くなる");
  await expect(button(page, "給水付きの浴槽")).toBeVisible();
  return { before, after };
}
async function work(page, skill) {
  await tab(page, "暮らし");
  const panel = page.getByRole("region", { name: "行動の指示" });
  await button(panel, "仕事").click();
  await panel.locator('button[data-kind="work"][data-target="' + skill + '"]').click();
}
async function hygieneRun(page) {
  await tab(page,"暮らし");
  const panel=page.getByRole("region",{name:"行動の指示"});
  await button(panel,"生活").click();
  const command=panel.locator('button[data-kind="need"][data-target="hygiene"]');
  const preview=await command.locator("..").locator("small").innerText();
  const facilityTotal=/（合計(\d+)分）/.exec(preview);
  const duration=/^(?:(\d+)時間)?(?:(\d+)分)?$/.exec(preview);
  assert.ok(facilityTotal || (duration && (duration[1] || duration[2])), "本人の実位置から身支度を終えるまでの見込み");
  const minutes=facilityTotal ? Number(facilityTotal[1]) : Number(duration[1]||0)*60+Number(duration[2]||0);
  await command.click();
  const ordered=await currentGame(page);
  const before=ordered.actors[0];
  assert.equal(before.task.kind,"need");
  await finish(page);
  const completed=await currentGame(page);
  assert.ok(completed.actors[0].needs.hygiene > before.needs.hygiene);
  assert.equal(completed.time-ordered.time,minutes);
  return completed.time-ordered.time;
}
async function doBasicWork(page) {
  const before = await currentGame(page);
  await work(page, "wood");
  const ordered = await currentGame(page);
  assert.equal(before.time, ordered.time);
  assert.equal(ordered.actors[0].task.kind, "work");
  const selectedActorId = ordered.actors[0].person.id;
  await page.reload();
  assert.deepEqual(await currentGame(page), ordered);
  await finish(page);
  const after = await currentGame(page);
  assert.ok(after.time > before.time);
  const actor = after.actors.find(a => a.person.id === selectedActorId);
  assert.ok(after.wood > ordered.wood, "木工で実際の木材が増えた");
  assert.ok(actor.xp.wood > ordered.actors[0].xp.wood || actor.person.skills.wood > ordered.actors[0].person.skills.wood);
  record("手動の木工は時計を進めず予約され、途中状態の再読込を経て木材と経験値に反映された。");
}
async function creator(page) {
  await tab(page, "人物");
  await page.getByRole("textbox", { name: "名前", exact: true }).fill("朝凪");
  await page.getByLabel("名前を固定", { exact: true }).check();
  await showSection(page, "住人を詳しくつくる");
  await page.getByLabel("髪色", {exact:true}).selectOption("silver");
  await page.getByLabel("服装", {exact:true}).selectOption("coat");
  await page.getByLabel("服の色", {exact:true}).selectOption("brick");
  await page.getByLabel("外見を固定", { exact: true }).check();
  await button(page, "固定以外をおまかせ").click();
  await expect(page.getByRole("textbox", { name: "名前", exact: true })).toHaveValue("朝凪");
  await expect(page.getByLabel("髪色", { exact:true })).toHaveValue("silver");
  await expect(page.getByLabel("服の色",{exact:true})).toHaveValue("brick");
  await page.getByLabel("木工の初期レベル", {exact:true}).selectOption("3");
  await page.getByLabel("好きな活動", {exact:true}).selectOption("wood");
  await page.getByLabel("伸びやすい技能", {exact:true}).selectOption("wood");
  record("名前と外見だけを固定して再抽選し、初期技能と成長適性を個別編集できた。");
}
async function worldCreation(page) {
  await tab(page, "土地");
  await showSection(page, "地形と集落を設定");
  await page.getByLabel("市場の町名", { exact:true }).fill("桑の町");
  await page.getByLabel("再生成しても市場の町の位置を固定").check();
  const town = button(page, "桑の町");
  const position = await town.getAttribute("style");
  await showSection(page, "組織・集落・重要人物を設定");
  const group = page.locator("fieldset.rf-landmark").first();
  await group.getByLabel("名称", {exact:true}).fill("朝市薬房");
  await group.getByLabel("重要人物", {exact:true}).fill("マリ");
  await group.getByLabel(/^町からの距離/).selectOption("0");
  for (let i = 0; i < 3; i++) {
    await button(page, "地形を再生成").click();
    await expect(group).toContainText("配置先　桑の町");
    assert.equal(await town.getAttribute("style"), position);
  }
  await town.click();
  record("町の位置、薬房、重要人物を固定し、地形を三回変えても町内配置が成立した。");
}
async function approachIfApart(page, game, actor, peer) {
  if (!game.housing || actor.location !== game.home || peer.location !== game.home) return;
  const positions=game.housing.state.actors;
  if (JSON.stringify(positions[actor.person.id]?.position)===JSON.stringify(positions[peer.person.id]?.position)) return;
  await showSection(page,"住民の近くへ移動");
  await button(page,peer.person.name+"の近くへ移動").click();
  for(let i=0;i<30;i++){
    await finish(page);
    const now=await currentGame(page);
    if(now.actors.find(a=>a.person.id===actor.person.id).task?.kind!=="home-move") return;
  }
  throw new Error("相手の地点に到着できませんでした。");
}
async function compareRelationships(page) {
  const panel = page.getByRole("region", {name:"行動の指示"});
  async function social(kind) {
    await tab(page,"暮らし");
    const g=await currentGame(page);
    await approachIfApart(page,g,g.actors[0],g.actors[1]);
    await button(panel,"交流").click();
    await panel.locator('button[data-kind="'+kind+'"]').first().click();
    await finish(page);
    return currentGame(page);
  }
  const positive = await social("talk");
  await tab(page,"手帳");
  await button(page,"同じ朝から分岐").click();
  const tension = await social("argue");
  const peerId=tension.actors[1].person.id;
  assert.equal(positive.time,tension.time);
  assert.ok(positive.actors[0].relations[peerId].trust > tension.actors[0].relations[peerId].trust);
  assert.ok(positive.actors[1].mood > tension.actors[1].mood);
  report.outcomes.push({ relation:"同じ朝の会話と不満", time:positive.time, positive:positive.actors[1].mood, tension:tension.actors[1].mood });
  record("同じ朝の会話と不満を別の暮らしで比較し、同時刻の相手のムードと信頼が分かれた。");
  await tab(page,"手帳");
  await button(page,"同じ朝から分岐").click();
}
async function bridge(page) {
  await tab(page, "暮らし");
  const panel = page.getByRole("region", { name: "行動の指示" });
  await button(panel, "野外").click();
  await panel.locator('button[data-kind="pack"][data-target="wood"]').click();
  await finish(page);
  assert.ok((await currentGame(page)).actors[0].cargo.wood >= 4);
  await tab(page, "地域");
  await button(page,"柳の渡し").click();
  await page.getByRole("button", { name: /柳の渡しへ移動する/ }).click();
  let game = await currentGame(page);
  assert.equal(game.actors[0].task.target, "landing");
  await tab(page, "暮らし");
  for (let tries=0; tries<10 && game.actors[0].location!=="landing"; tries++) {
    await finish(page);
    game = await currentGame(page);
  }
  assert.equal(game.actors[0].location, "landing");
  await tab(page, "地域");
  await button(page,"柳の渡し").click();
  const project = page.locator(".rf-regional-work").filter({ hasText: "市場と水車の里を橋で結ぶ" });
  await project.getByRole("button").click();
  await tab(page, "暮らし");
  for (let tries=0; tries<20 && !game.world.bridge; tries++) {
    await finish(page);
    game = await currentGame(page);
  }
  assert.equal(game.world.bridge, true);
  const previousTrips = game.world.trade.bridge;
  await nextMorning(page);
  game = await currentGame(page);
  assert.ok(game.world.trade.bridge > previousTrips);
  record("渡しへ移動し木材を使って橋を建設。翌朝の商人が新しい道を利用した。");
}
async function weeklyChoice(page, name, week) {
  const game = await currentGame(page);
  const lead = game.actors[0];
  if (name === "川辺の一人旅") {
    const destination = ["風見の峠","水車の里","柳の渡し"][week-1];
    await tab(page,"地域");
    await button(page,destination).click();
    await page.getByRole("button",{name:new RegExp(destination+"へ移動する")}).click();
    await finish(page);
  } else if (name === "木工の二人") {
    await showSection(page,"暮らしと備蓄の方針");
    await page.getByLabel(/が優先する仕事/).selectOption(week===1?"cook":week===2?"care":"wood");
    if (week === 2 && lead.person.skills.wood >= 5) {
      await work(page,"wood:master");
      await finish(page);
    }
  } else {
    let available=game.wood;
    for (let attempts=0; available<2 && attempts<4; attempts++) {
      await work(page,"wood");
      await finish(page);
      available=(await currentGame(page)).wood;
    }
    assert.ok(available>=2);
    await work(page,week===2 && lead.person.skills.trade>=5 ? "trade:master" : "trade");
    await finish(page);
  }
}
async function longProfile(name) {
  const page = await fresh(1280);
  try {
    await makeStart(page, name);
    await enter(page);
    const start = await currentGame(page);
    if (name === "木工の二人") {
      await tab(page,"手帳");
      const downloading=page.waitForEvent("download");
      await button(page,"保存を書き出す").click();
      await (await downloading).saveAs(resolve(output,"woodworkers-morning.json"));
      await placeBath(page);
      await tab(page,"暮らし");
    }
    if (name === "川辺の一人旅") {
      await tab(page, "地域");
      await button(page, "対岸の果樹園").click();
      await page.getByRole("button", { name: /対岸の果樹園へ移動する/ }).click();
      await tab(page, "暮らし");
      await finish(page);
    } else {
      await showSection(page, "暮らしと備蓄の方針");
      await page.getByLabel(/が優先する仕事/).selectOption(name === "市場の商人" ? "trade" : "wood");
      await work(page, name === "市場の商人" ? "trade" : "wood");
      await finish(page);
    }
    const snapshots = [];
    for (let day = 1; day <= 28; day++) {
      await nextMorning(page);
      const current = await currentGame(page);
      assert.equal(current.time, start.time + day * 1440, name + ": 翌朝は同じ時刻");
      for (const resident of current.actors)
        for (const value of Object.values(resident.needs)) assert.ok(value >= 0 && value <= 100);
      if (day === 7 || day === 28) snapshots.push(extractMetrics(current));
      if (day%7===0 && day<28) await weeklyChoice(page,name,day/7);
    }
    if (name === "木工の二人") {
      await tab(page,"住まい");
      await page.getByLabel("新しく置く設備",{exact:true}).selectOption("shelf");
      await button(page,"この部屋に置く").click();
      const built = await currentGame(page);
      assert.ok(built.house.rooms[0].fixtures.some(f => f.kind==="shelf"));
      await page.reload();
      await expect(button(page,"15分進める")).toBeVisible();
      assert.deepEqual(await currentGame(page),built,"四週間後の増築を再開できる");
    }
    if (name === "木工の二人") {
      const reader=await fresh(390);
      try {
        const sample=JSON.parse(await readFile(resolve(output,"woodworkers-morning.json"),"utf8"));
        await button(reader,"保存を開く").click();
        await reader.locator('input[type="file"]').setInputFiles(resolve(output,"woodworkers-morning.json"));
        await expect(button(reader,"15分進める")).toBeVisible();
        assert.deepEqual(await currentGame(reader),sample.slot.origin);
        assert.deepEqual((await currentGame(reader)).actors.map(a=>a.person.name),["カヤ","スイ"]);
        await checkLegacy(reader);
        record("配布用『木工の二人』初日セーブを隔離した新規スマホ幅に読み込み、朝の二人を再現。");
      } finally { await reader.context().close(); }
    }
    await checkLegacy(page);
    report.outcomes.push({ profile:name, snapshots });
    record(name + "を通常操作で四週間進め、七日・二十八日経過時の技能、状態、資源、時間配分を記録。");
  } finally {
    await page.context().close();
  }
}
async function desktop() {
  const page = await fresh(1280);
  try {
    await makeStart(page, "木工の二人");
    await creator(page);
    await worldCreation(page);
    await enter(page);
    const first = await currentGame(page);
    assert.equal(first.actors.length, 2);
    assert.equal(first.actors[0].person.name, "朝凪");
    assert.equal(first.actors[0].person.appearance.hairColor, "silver");
    assert.equal(first.world.landmarks.find(l => l.name === "朝市薬房").npc, "マリ");
    assert.equal(first.home, "village");
    await expect(page.locator(".yp-scene")).toHaveAttribute("data-person", first.actors[0].person.id);
    await screenshot(page,"desktop-life");
    const oldMinutes=await hygieneRun(page);
    await tab(page,"手帳");
    await button(page,"同じ朝から分岐").click();
    const change = await placeBath(page);
    const house = await currentGame(page);
    assert.equal(house.wood,first.wood-8);
    const newMinutes=await hygieneRun(page);
    assert.ok(newMinutes<oldMinutes);
    assert.ok(change.after < change.before,"入口からの設備利用の目安も短くなる");
    report.outcomes.push({ home: "居間の身支度", ...change, oldMinutes, newMinutes });
    record("木材8で居間に浴槽を設置。身支度の実所要時間が"+oldMinutes+"分から"+newMinutes+"分に短縮。");
    await tab(page,"手帳");
    await button(page,"同じ朝から分岐").click();
    await doBasicWork(page);
    await branchAndReload(page);
    await compareRelationships(page);
    await bridge(page);
    await tab(page, "地域");
    await screenshot(page,"desktop-region");
    await checkLegacy(page);
  } catch(error) {
    await page.screenshot({ path: resolve(output,"desktop-failure.png") });
    console.error((await page.locator("body").innerText()).slice(0,7000));
    throw error;
  } finally {
    await page.context().close();
  }
}
async function mobile() {
  const page = await fresh(390);
  try {
    await makeStart(page, "市場の商人");
    await tab(page, "人物");
    await screenshot(page, "phone-creator");
    await tab(page, "土地");
    await page.locator(".rf-map").scrollIntoViewIfNeeded();
    await screenshot(page, "phone-map");
    await enter(page);
    await screenshot(page, "phone-life");
    const start = await currentGame(page);
    await nextMorning(page);
    assert.equal((await currentGame(page)).time, start.time+1440);
    await tab(page, "住まい");
    await showSection(page, "室内のマスを編集");
    await screenshot(page,"phone-house");
    await tab(page, "手帳");
    const downloading = page.waitForEvent("download");
    await button(page, "保存を書き出す").click();
    const file = await downloading;
    const downloaded = JSON.parse(await readFile(await file.path(),"utf8"));
    assert.equal(downloaded.type,"yohaku-reform-save");
    assert.deepEqual(downloaded.slot.game,await currentGame(page));
    await page.locator('input[type="file"]').setInputFiles({
      name:"検証用の暮らし.json",mimeType:"application/json",buffer:Buffer.from(JSON.stringify(downloaded)),
    });
    await expect.poll(async()=> (await library(page)).slots.length).toBe(2);
    assert.deepEqual(await currentGame(page),downloaded.slot.game);
    await tab(page,"手帳");
    const beforeMalformed=await library(page);
    await page.locator('input[type="file"]').setInputFiles({
      name:"途中で切れた.json",mimeType:"application/json",buffer:Buffer.from('{"type":'),
    });
    await expect(page.getByRole("status")).toContainText("JSON");
    assert.deepEqual(await library(page),beforeMalformed);
    await checkLegacy(page);
    record("390×844で作成、地域選択、翌朝、室内編集、保存書き出し・別枠読み込みを操作。");
  } catch(error) {
    await page.screenshot({ path:resolve(output,"phone-failure.png") });
    console.error((await page.locator("body").innerText()).slice(0,7000));
    throw error;
  } finally {
    await page.context().close();
  }
}
async function recoveryControls(page, name) {
  await tab(page, "暮らし");
  await button(page.getByRole("group", { name: "住民を選ぶ" }), name).click();
  const panel = page.getByRole("region", { name: "行動の指示" });
  await button(panel, "野外").click();
  const command = panel.locator('button[data-kind="recover"]');
  const row = command.locator("..");
  return {
    command,
    row,
    choice: row.getByRole("combobox", { name: "傷を休める場所", exact: true }),
    hint: row.locator("small"),
  };
}

async function completeOwnRecovery(page, index) {
  for (let step = 0; step < 20; step++) {
    await finish(page);
    const state = await currentGame(page);
    if (state.actors[index].task?.kind !== "recover") return state;
  }
  throw new Error("療養が完了しませんでした。");
}

async function useRecoveryBed(page, home, width) {
  const person = home.actors[0].person;
  const { command, choice, hint, row } = await recoveryControls(
    page,
    person.name,
  );
  await expect(choice).toHaveValue("");
  await expect(hint).toContainText("移動なし · 療養65分");
  await choice.selectOption("mat-1");
  await expect(hint).toContainText("寝室");
  const forecast = (await hint.innerText()).match(/移動(\d+)分 ＋ 療養65分（合計(\d+)分）/);
  assert.ok(forecast, "寝床への移動と療養を合わせた所要時間が表示されます。");
  const moveMinutes = Number(forecast[1]);
  assert.ok(moveMinutes > 0);
  assert.equal(Number(forecast[2]), moveMinutes + 65);
  const before = await currentGame(page);
  assert.deepEqual(before, home);
  await row.evaluate((el) => el.scrollIntoView({ block: "center" }));
  await screenshot(page, "recovery-preview-" + width);
  await command.click();
  const ordered = await currentGame(page);
  const station = JSON.stringify(["slot", "bedroom", "mat-1", 0]);
  const bedHeld = (game) =>
    Object.values(game.housing.state.reservations).some(
      (r) => r.kind === "slot" && r.targetId === station,
    );
  assert.equal(ordered.time, home.time);
  assert.equal(ordered.actors[0].task.station, station);
  assert.ok(bedHeld(ordered));
  await button(page, "15分進める").click();
  const partial = await currentGame(page);
  assert.equal(partial.actors[0].task?.kind, "recover");
  assert.equal(partial.actors[0].task.remaining, 65 - (15 - moveMinutes));
  assert.ok(bedHeld(partial));
  await page.reload();
  assert.deepEqual(await currentGame(page), partial);
  await recoveryControls(page, person.name);
  await page.locator('button[data-kind="cancel"]').click();
  const cancelled = await currentGame(page);
  assert.equal(cancelled.time, partial.time);
  assert.equal(cancelled.actors[0].task, null);
  assert.equal(bedHeld(cancelled), false);
  assert.equal(cancelled.actors[0].injury, partial.actors[0].injury);
  await recoveryControls(page, person.name);
  await choice.selectOption("mat-1");
  await expect(hint).toContainText("移動0分 ＋ 療養65分");
  await command.click();
  const restarted = await currentGame(page);
  assert.equal(restarted.actors[0].task.station, station);
  const done = await completeOwnRecovery(page, 0);
  assert.equal(done.actors[0].room, "bedroom");
  assert.equal(bedHeld(done), false);
  assert.equal(done.time - restarted.time, 65);
  assert.ok(done.actors[0].injury < restarted.actors[0].injury);
  await page.reload();
  assert.deepEqual(await currentGame(page), done);

  // The living-room window is four floor steps from the link to the bedroom.
  await recoveryControls(page, person.name);
  const actions = page.getByRole("region", { name: "行動の指示" });
  await button(actions, "生活").click();
  const windowOrder = actions.locator('button[data-kind="need"][data-target="fun"]');
  await windowOrder.locator("..").getByRole("combobox").selectOption("window-1");
  await windowOrder.click();
  await button(page, "15分進める").click();
  const atWindow = await currentGame(page);
  assert.equal(atWindow.actors[0].room, "living");
  await page.locator('button[data-kind="cancel"]').click();
  await recoveryControls(page, person.name);
  await choice.selectOption("mat-1");
  await command.click();
  await button(page, "5分進める").click();
  const crossing = await currentGame(page);
  assert.equal(crossing.housing.state.actors[person.id].position.kind, "transit");
  await page.locator('button[data-kind="cancel"]').click();
  const leaving = await currentGame(page);
  assert.equal(leaving.housing.state.actors[person.id].order.phase, "exiting-after-cancel");
  const notice = page.getByRole("region", { name: "家の中の移動と設定" }).locator(".lf-note").first();
  await expect(notice).toContainText("寝床の予約を解除");
  await expect(notice).not.toContainText("材料");
  await page.reload();
  assert.deepEqual(await currentGame(page), leaving);
  await button(page, "5分進める").click();
  const released = await currentGame(page);
  assert.equal(released.actors[0].injury, crossing.actors[0].injury);
  assert.equal(bedHeld(released), false);
  assert.equal(released.wood, crossing.wood);
  await checkLegacy(page);
  report.outcomes.push({
    width,
    journey: "峠から付き添って帰宅し、寝室で療養",
    injuryOnReturn: home.actors[0].injury,
    restartInjury: restarted.actors[0].injury,
    completedInjury: done.actors[0].injury,
    returned: home.time,
    moveMinutes,
    restarted: restarted.time,
    completed: done.time,
  });
}

async function recoveryLimits() {
  const page = await fresh(1280);
  try {
    await makeStart(page, "木工の二人");
    await enter(page);
    const origin = await currentGame(page);
    const [patient, helper] = origin.actors.map((a) => a.person);
    async function importCase(name, injury, atBed = false) {
      const game = structuredClone(origin);
      game.actors[0].injury = injury;
      if (atBed) {
        const station = JSON.stringify(["slot", "bedroom", "mat-1", 0]);
        game.actors[0].room = "bedroom";
        game.housing.state.actors[patient.id].position = {
          kind: "at",
          point: game.housing.state.slots[station].point,
        };
      }
      await tab(page, "手帳");
      const data = {
        type: "yohaku-reform-save",
        version: 2,
        slot: { id: "qa-" + name, name, game, origin },
      };
      await page.getByLabel("新版の保存ファイル").setInputFiles({
        name: name + ".json",
        mimeType: "application/json",
        buffer: Buffer.from(JSON.stringify(data)),
      });
      await expect(
        page.getByRole("region", { name: "行動の指示" }),
      ).toBeVisible();
      assert.deepEqual(await currentGame(page), game);
    }
    await importCase("重傷の療養", 75);
    let controls = await recoveryControls(page, patient.name);
    await controls.choice.selectOption("mat-1");
    await expect(controls.command).toBeDisabled();
    await expect(controls.hint).toContainText("重い傷");
    await controls.choice.selectOption("");
    await expect(controls.command).toBeEnabled();
    await controls.command.click();
    const inPlace = await currentGame(page);
    assert.equal(inPlace.actors[0].task.kind, "recover");
    assert.equal(inPlace.actors[0].task.spatial, undefined);
    assert.equal(inPlace.actors[0].task.station, undefined);
    await page.reload();
    assert.deepEqual(await currentGame(page), inPlace);
    const finished = await completeOwnRecovery(page, 0);
    assert.equal(finished.time - inPlace.time, 65);
    assert.ok(finished.actors[0].injury < 75);
    await importCase("寝床の足元で重傷", 75, true);
    controls = await recoveryControls(page, patient.name);
    await controls.choice.selectOption("mat-1");
    await expect(controls.hint).toContainText("移動0分 ＋ 療養65分");
    await controls.command.click();
    const severeAtBed = await currentGame(page);
    assert.equal(
      severeAtBed.actors[0].task.station,
      JSON.stringify(["slot", "bedroom", "mat-1", 0]),
    );
    const restedAtBed = await completeOwnRecovery(page, 0);
    assert.equal(restedAtBed.time - severeAtBed.time, 65);
    assert.equal(restedAtBed.actors[0].injury, 63);
    await importCase("共用寝床の予約", 40);
    await button(
      page.getByRole("group", { name: "住民を選ぶ" }),
      helper.name,
    ).click();
    const actions = page.getByRole("region", { name: "行動の指示" });
    await button(actions, "生活").click();
    const rest = actions.locator(
      'button[data-kind="need"][data-target="energy"]',
    );
    await rest.locator("..").getByRole("combobox").selectOption("mat-1");
    await rest.click();
    const held = await currentGame(page);
    controls = await recoveryControls(page, patient.name);
    await controls.choice.selectOption("mat-1");
    await expect(controls.command).toBeDisabled();
    await expect(controls.hint).toContainText("予約");
    assert.deepEqual(await currentGame(page), held);
    await importCase("専用寝床の制限", 40);
    await showSection(page, "暮らしと備蓄の方針");
    await showSection(page, "寝床を使える住人");
    await page
      .getByRole("combobox", { name: "設定する寝床", exact: true })
      .selectOption("mat-1");
    await page
      .getByRole("combobox", { name: "利用できる住人", exact: true })
      .selectOption(helper.id);
    await button(page, "利用設定を保存").click();
    const exclusive = await currentGame(page);
    controls = await recoveryControls(page, patient.name);
    await controls.choice.selectOption("mat-1");
    await expect(controls.command).toBeDisabled();
    await expect(controls.hint).toContainText("専用の寝床");
    assert.deepEqual(await currentGame(page), exclusive);
    record(
      "人工保存4件で、重傷者のその場での療養、寝床の足元での療養、予約済みと他人専用の寝床への指示が実行できないことを確認。",
    );
  } finally {
    await page.context().close();
  }
}

async function fieldTrip(recoveryWidth) {
  const page=await fresh(recoveryWidth ?? 1280);
  try {
    await makeStart(page,"木工の二人");
    await tab(page,"土地");
    await showSection(page,"地形と集落を設定");
    await page.getByLabel("世界の種",{exact:true}).fill("1700");
    await enter(page);
    const initial=await currentGame(page);
    const [first,second]=initial.actors.map(a=>a.person.id);
    async function send(id) {
      await tab(page,"地域");
      await page.getByLabel(/行動する人/).selectOption(id);
      await button(page,"風見の峠").click();
      await page.getByRole("button",{name:/風見の峠へ移動する/}).click();
    }
    const roster=page.getByRole("group",{name:"住民を選ぶ"});
    async function action(id,kind,peer) {
      const actor=(await currentGame(page)).actors.find(a=>a.person.id===id);
      await button(roster,actor.person.name).click();
      if(kind==="aid") {
        const game=await currentGame(page);
        await approachIfApart(page,game,actor,game.actors.find(a=>a.person.id===peer));
      }
      const panel=page.getByRole("region",{name:"行動の指示"});
      await button(panel,"野外").click();
      let cmd=panel.locator('button[data-kind="'+kind+'"]');
      if (peer) cmd=cmd.and(panel.locator('button[data-target="'+peer+'"]'));
      await cmd.click();
      for(let i=0; i<25; i++) {
        await finish(page);
        const g=await currentGame(page);
        if(g.actors.find(a=>a.person.id===id).task?.kind!==kind)return g;
      }
      throw new Error("実行が完了しなかった "+kind);
    }
    await send(first);await send(second);
    for(let i=0;i<6;i++) {
      await finish(page);
      if((await currentGame(page)).actors.every(a=>a.location==="pass"))break;
    }
    let g=await currentGame(page);
    assert.ok(g.actors.every(a=>a.location==="pass"));
    for(let i=0;i<10 && !g.actors[0].injury;i++) {
      g=await action(first,"explore");
      assert.ok(g.actors[0].danger);
      g=await action(first,"defend");
    }
    assert.ok(g.actors[0].injury>0);
    const injury=g.actors[0].injury;
    if (recoveryWidth) {
      const field = await recoveryControls(page,g.actors[0].person.name);
      await expect(field.choice).toHaveCount(0);
      await expect(field.command).toBeEnabled();
    }
    g=await action(second,"rescue",first);
    assert.ok(g.actors.every(a=>a.location===g.home));
    if (recoveryWidth) {
      await useRecoveryBed(page, g, recoveryWidth);
      return;
    }
    g=await action(second,"aid",first);
    assert.ok(g.actors[0].injury<injury);
    await page.reload();
    assert.deepEqual(await currentGame(page),g);
    await checkLegacy(page);
    record("二人で峠へ出かけて遭遇・応戦し、負傷した仲間を家へ連れ帰って手当て。保存再開まで一致。");
  } finally { await page.context().close(); }
}

try {
  const flags=new Set(process.argv.slice(2));
  if (flags.has("--field")) await fieldTrip();
  if (flags.has("--recovery-bed")) {
    for (const width of [1280,320]) await fieldTrip(width);
    await recoveryLimits();
  }
  if (flags.has("--narrow")) {
    const narrow=await fresh(320);
    await makeStart(narrow,"木工の二人");
    await tab(narrow,"人物");
    await narrow.getByRole("textbox",{name:"名前",exact:true}).fill("八重と川辺の暦を読む旅人");
    await screenshot(narrow,"narrow-creator");
    await tab(narrow,"土地");
    await screenshot(narrow,"narrow-world");
    await enter(narrow);
    await screenshot(narrow,"narrow-life");
    await tab(narrow,"住まい");
    await showSection(narrow,"室内のマスを編集");
    await screenshot(narrow,"narrow-edit");
    await checkLegacy(narrow);
    await narrow.context().close();
    record("320pxで長い住人名を入力し、作成・地図・生活・家の編集を確認。");
  }
  if (flags.has("--region")) {
    const page=await fresh(1280);
    await makeStart(page,"市場の商人");
    await enter(page);
    await bridge(page);
    await tab(page,"地域");
    await screenshot(page,"desktop-region");
    await checkLegacy(page);
    await page.context().close();
  }
  if (!flags.size || flags.has("--desktop")) await desktop();
  if (!flags.size || flags.has("--mobile")) await mobile();
  if (!flags.size || flags.has("--weeks")) {
    for (const preset of ["川辺の一人旅","木工の二人","市場の商人"]) await longProfile(preset);
  }
  assert.deepEqual(pageErrors,[], "未処理例外・ブラウザエラー");
  assert.deepEqual(unexpectedRequests,[], "配布HTML以外の通信");
  record("公開53の保存キーを保持し、隔離したオフラインのChromiumで外部通信・ブラウザエラーは0件。");
} finally {
  await writeFile(resolve(output,"result.json"),JSON.stringify({...report,pageErrors,unexpectedRequests},null,2)+"\n");
  await browser.close();
}
