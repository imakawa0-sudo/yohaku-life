/** Actual, offline standalone UI checks for optional household recruitment.
 * Setup uses a genuine earlier playthrough's v2 JSON through the import control;
 * state reads below are assertions only. No app API or storage writes are used.
 */
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { chromium, expect } from "@playwright/test";

const htmlPath = resolve(process.env.RECRUITMENT_HTML || "dist/yohaku-v53.html");
const html = await readFile(htmlPath, "utf8");
const sha256 = createHash("sha256").update(html).digest("hex");
if (process.env.EXPECTED_HTML_SHA) assert.equal(sha256, process.env.EXPECTED_HTML_SHA);
const fixturePath = resolve(process.env.RECRUITMENT_BASELINE || "tests/fixtures/mio-village-v2.json");
const fixtureRaw = await readFile(fixturePath, "utf8");
const fixture = JSON.parse(fixtureRaw);
assert.equal(fixture.version, 2, "the migration fixture is a genuine version 2 UI export");
const output = process.env.PLAYTEST_OUTPUT || `/workspace/research/stage2-cooperation/playtest/${sha256.slice(0, 12)}`;
await mkdir(output, { recursive: true });
await writeFile(join(output, "tested-yohaku.html"), html);
const URL = "http://yohaku-recruitment.local/";
const sizes = [[320, 740], [390, 844], [430, 932], [1280, 800]];
const checks = [], operations = [], captures = [], audits = [], errors = [], requests = [];
const contexts = [];
let activePage;
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || "/usr/bin/chromium", headless: true, args: ["--no-sandbox"] });
const person = (s, id) => s.residents.find(r => r.id === id);
const zero = () => ({ food: 0, ingredients: 0, medicine: 0, scrap: 0 });
function check(label) { checks.push(label); console.log(`✓ ${label}`); }
async function state(page) {
  return page.evaluate(() => JSON.parse(localStorage.getItem("yohaku-autosave-v1") || localStorage.getItem("yohaku-save-v1")));
}
function card(page, name) {
  return page.locator(".residents-list .resident-card").filter({ has: page.locator(".resident-name").filter({ hasText: name }) });
}
async function fresh(scenario) {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, offline: true, acceptDownloads: true });
  contexts.push(context);
  await context.route("**/*", async route => {
    const url = route.request().url(); requests.push({ scenario, url });
    if (url === URL) await route.fulfill({ contentType: "text/html", body: html }); else await route.abort();
  });
  const page = await context.newPage(); activePage = page;
  page.on("pageerror", e => errors.push({ scenario, type: "pageerror", text: e.message }));
  page.on("console", m => { if (m.type() === "error") errors.push({ scenario, type: "console", text: m.text() }); });
  await page.goto(URL);
  await expect(page.locator(".header .time")).toHaveText("08:00");
  await expect(page.locator(".residents-list .resident-card")).toHaveCount(3);
  await page.locator(".save-button").click();
  await page.getByRole("button", { name: "いまの暮らしを保存する", exact: true }).click();
  await page.keyboard.press("Escape");
  assert.equal((await state(page)).minutes, 480);
  return page;
}
async function select(page, names) {
  const before = await state(page);
  for (const r of before.residents) {
    const c = card(page, r.name);
    if ((await c.getAttribute("aria-pressed") === "true") !== names.includes(r.name)) await c.click();
    await expect(c).toHaveAttribute("aria-pressed", String(names.includes(r.name)));
  }
  if (names.length) {
    const c = card(page, names.at(-1));
    if (!(await c.getAttribute("class")).split(/\s+/).includes("viewing")) { await c.click(); await c.click(); }
    await expect(c).toHaveClass(/viewing/);
  }
  assert.deepEqual(await state(page), before, "roster selection does not change the world");
}
async function nav(page, label) {
  const before = await state(page);
  await page.getByRole("navigation").getByRole("button", { name: label, exact: false }).click();
  assert.deepEqual(await state(page), before, "navigation does not change the world");
}
async function op(page, scenario, label, fn) {
  const before = await state(page); await fn(); const after = await state(page);
  operations.push({ scenario, label, before: before.minutes, after: after.minutes,
    residents: after.residents.map(r => ({ id: r.id, location: r.location, action: r.action?.kind || null, actionId: r.action?.id || null })), resources: after.resources });
  return after;
}
async function until(page, scenario, label, predicate, maximum = 60) {
  for (let i = 0; i < maximum; i++) {
    const s = await state(page); if (predicate(s)) return s;
    const next = await op(page, scenario, label, () => page.locator(".next-button").click());
    assert.ok(next.minutes > s.minutes, "the real next-boundary control advances the clock");
  }
  assert.fail(`did not finish ${label}`);
}
async function dismiss(page) {
  const button = page.getByRole("button", { name: "通知を閉じる", exact: true });
  if (await button.isVisible()) await button.click();
}
async function capture(page, name, target) {
  await dismiss(page);
  if (target) await page.locator(target).first().evaluate(el => el.scrollIntoView({ block: "center" }));
  else await page.evaluate(() => window.scrollTo(0, 0));
  const path = join(output, `${name}.png`);
  await page.screenshot({ path, fullPage: !target }); captures.push(path);
}
async function responsive(page, name, target, four = false) {
  const before = await state(page);
  for (const [width, height] of sizes) {
    await page.setViewportSize({ width, height });
    const metrics = await page.evaluate(() => {
      const nav = document.querySelector(".navigation");
      const boxes = [...document.querySelectorAll(".residents-list .resident-card")].map(el => {
        const r = el.getBoundingClientRect(); return { x: r.x, y: r.y, width: r.width, height: r.height };
      });
      return { client: document.documentElement.clientWidth, scroll: document.documentElement.scrollWidth,
        nav: nav ? { client: nav.clientHeight, scroll: nav.scrollHeight, overflow: getComputedStyle(nav).overflowY } : null, boxes };
    });
    assert.ok(metrics.scroll <= metrics.client + 1, `${name} ${width}: horizontal overflow`);
    assert.ok(!metrics.nav || metrics.nav.scroll <= metrics.nav.client + 1, `${name} ${width}: tab navigation scrolls vertically`);
    if (four && width <= 430) {
      assert.equal(metrics.boxes.length, 4);
      const b = metrics.boxes;
      assert.ok(Math.abs(b[0].y - b[1].y) < 2 && Math.abs(b[2].y - b[3].y) < 2 && b[2].y > b[0].y + 5,
        `${name} ${width}: four residents should form two rows of two`);
    }
    audits.push({ name, width, height, ...metrics });
    await capture(page, `${name}-${width}`);
    if (target) await capture(page, `${name}-${width}-detail`, target);
    assert.deepEqual(await state(page), before, "viewport and inspection do not change the world");
  }
  await page.setViewportSize({ width: 390, height: 844 });
}
async function saveReload(page, name) {
  const before = await state(page);
  await page.locator(".save-button").click();
  await page.getByRole("button", { name: "いまの暮らしを保存する", exact: true }).click();
  const pending = page.waitForEvent("download");
  await page.getByRole("button", { name: "ファイルに書き出す", exact: true }).click();
  const download = await pending;
  const raw = await readFile(await download.path(), "utf8");
  assert.deepEqual(JSON.parse(raw), before);
  await writeFile(join(output, `${name}.json`), raw);
  await page.keyboard.press("Escape"); await page.reload();
  assert.deepEqual(await state(page), before, "save/download/reload must preserve the entire state");
  return before;
}
const lifeMeal = page => page.locator(".action-grid").getByRole("button", { name: /^(食事をとる|一緒に食事|それぞれ食事)/ });
function guide(page) { return page.locator(".region-person").filter({ has: page.getByRole("heading", { name: "道を知る住民", exact: true }) }); }
const invite = page => guide(page).getByRole("button", { name: "仲間に誘う（任意）", exact: true });

try {
  const gate = await fresh("normal-unavailable");
  await select(gate, ["ミオ"]); await nav(gate, "周辺を探索");
  let s = await op(gate, "normal-unavailable", "ミオが物資を持たず川沿いから集落へ", () => gate.getByRole("region", { name: "日帰りの道順を選ぶ" }).getByRole("button", { name: "川沿いの道で集落へ", exact: false }).click());
  const travelId = person(s, "mio").action.id;
  s = await until(gate, "normal-unavailable", "ミオの初訪問を進める", x => person(x, "mio").location === "village" && person(x, "mio").action?.id !== travelId);
  await nav(gate, "いまの暮らし");
  await expect(invite(gate)).toBeDisabled(); await expect(invite(gate)).toHaveAttribute("title", /本人.*話.*食事3食/);
  assert.equal(s.residents.length, 3);
  s = await op(gate, "normal-unavailable", "道の話だけでは加入条件を満たさない", () => guide(gate).getByRole("button", { name: "話を聞く", exact: true }).click());
  assert.equal(s.region.trust["village-guide"].mio, 1);
  await expect(invite(gate)).toBeDisabled();
  await expect(guide(gate).getByRole("button", { name: "食事3を届ける（任意）", exact: true })).toBeDisabled();
  await capture(gate, "normal-trust-one-invite-disabled-390", ".region-recruitment");
  await select(gate, ["アキ", "ミオ"]);
  await expect(invite(gate)).toBeDisabled(); await expect(invite(gate)).toHaveAttribute("title", /一人だけ/);
  check("新規開始の実移動で、未交流・話だけ・荷物不足・複数選択の加入不可を確認");
  await gate.context().close();

  const page = await fresh("v2-mio-invitation");
  await page.locator(".save-button").click();
  await page.locator("input[type=file]").setInputFiles({ name: "genuine-mio-village-v2.json", mimeType: "application/json", buffer: Buffer.from(fixtureRaw) });
  await expect(page.getByRole("dialog")).not.toBeVisible();
  s = await state(page);
  assert.equal(s.version, 3); assert.equal(s.minutes, fixture.minutes); assert.equal(s.seed, fixture.seed);
  assert.deepEqual(s.inventory, fixture.inventory); assert.deepEqual(s.logs, fixture.logs); assert.deepEqual(s.region.receipts, fixture.region.receipts);
  assert.equal(person(s, "mio").location, "village"); assert.equal(person(s, "aki").location, "home");
  check("実際の旧版 UI 保存を取り込み、時計・乱数・携行品・過去ログ・集落の履歴を保持して v3 へ移行");

  // Make a real private household experience before Haru joins. This is useful
  // evidence that earlier events and their witnesses are not expanded at joining.
  await select(page, ["アキ"]);
  s = await op(page, "v2-mio-invitation", "加入前に拠点のアキ一人で実食を予約", () => lifeMeal(page).click());
  const privateMealJob = person(s, "aki").action.id;
  s = await until(page, "v2-mio-invitation", "加入前の単独食事を完了", x => person(x, "aki").action?.id !== privateMealJob);
  const privateMeal = s.life.events.find(e => e.kind === "meal" && e.actors.length === 1 && e.actors[0] === "aki");
  assert.ok(privateMeal); assert.ok(!privateMeal.witnesses.includes("village-guide"));
  await select(page, ["ミオ"]);
  await expect(invite(page)).toBeEnabled();
  await responsive(page, "eligible-invitation", ".region-recruitment");
  const beforeJoin = await state(page);
  s = await op(page, "v2-mio-invitation", "主人公が拠点にいるままミオ本人がハルを誘う", () => invite(page).click());
  assert.equal(s.residents.length, 4); assert.equal(s.minutes, beforeJoin.minutes); assert.equal(s.seed, beforeJoin.seed);
  assert.deepEqual(s.resources, beforeJoin.resources); assert.deepEqual(s.inventory.baseGear, beforeJoin.inventory.baseGear);
  assert.deepEqual(s.life, beforeJoin.life, "joining must not teach or rewrite any earlier household experience");
  assert.equal(person(s, "aki").location, "home");
  const haru = person(s, "village-guide");
  assert.equal(haru.name, "ハル"); assert.equal(haru.location, "village");
  assert.deepEqual(s.inventory.packs[haru.id], zero()); assert.deepEqual(haru.memories, []);
  assert.deepEqual(haru.relations.aki, { closeness: 0, trust: 0 });
  assert.deepEqual(haru.relations.mio, { closeness: 20, trust: 25 });
  assert.equal(s.region.recruitments.length, 1); assert.equal(s.region.recruitments[0].invitedBy, "mio");
  const joining = s.logs.find(l => l.id === haru.joinedLogId);
  assert.deepEqual(joining.actors, ["mio", "village-guide"]); assert.ok(!joining.witnesses.includes("aki"));
  await expect(card(page, "ミオ")).toHaveAttribute("aria-pressed", "true"); await expect(card(page, "ミオ")).toHaveClass(/viewing/);
  await expect(card(page, "ハル")).toHaveAttribute("aria-pressed", "false");
  await expect(guide(page)).toHaveCount(0); await expect(page.locator(".region-person")).toHaveCount(1);
  await responsive(page, "four-roster-after-invitation", ".region-panel", true);
  check("ミオの交流でハルが同地点へ一度加入し、時計・乱数・倉庫・選択・視点を保ち、NPC 重複と過去体験の継承を防ぐ");
  await nav(page, "住民たち");
  const haruDetail = page.locator(".detail-card").filter({ has: page.getByRole("heading", { name: "ハル", exact: true }) });
  await expect(haruDetail.locator(".memory")).toHaveCount(0);
  await capture(page, "haru-no-inherited-memory-390", ".detail-card:last-child");

  await select(page, ["ミオ", "ハル"]); await nav(page, "周辺を探索");
  s = await op(page, "v2-mio-invitation", "ミオとハルの二人に安全な帰路を予約", () => page.getByRole("region", { name: "日帰りの道順を選ぶ" }).getByRole("button", { name: "川沿いの道で拠点へ帰る", exact: false }).click());
  const returnIds = ["mio", "village-guide"].map(id => person(s, id).action.id);
  assert.ok(["mio", "village-guide"].every(id => person(s, id).action.path.join(",") === "meadow,road,home"));
  s = await until(page, "v2-mio-invitation", "二人それぞれの帰還を進める", x => ["mio", "village-guide"].every(id => person(x, id).location === "home" && !returnIds.includes(person(x, id).action?.id)));
  assert.equal(person(s, "aki").location, "home");
  await select(page, ["アキ", "ミオ", "レン", "ハル"]); await nav(page, "拠点");
  if (!(await state(page)).residents.every(r => r.location === "home")) {
    s = await op(page, "v2-mio-invitation", "四人を共同の居間の食卓へ集める", () => page.locator(".room-card").filter({ has: page.getByRole("heading", { name: "共同の居間", exact: true }) }).click());
    s = await until(page, "v2-mio-invitation", "食卓への移動を進める", x => x.residents.every(r => r.location === "home"));
  }
  await nav(page, "いまの暮らし");
  const foodBefore = (await state(page)).resources.food;
  assert.ok(foodBefore >= 4, "the ordinary playthrough has enough food for four");
  s = await op(page, "v2-mio-invitation", "四人の同じ食卓を予約", () => lifeMeal(page).click());
  const eatingIds = s.residents.map(r => r.action.id);
  assert.ok(s.residents.every(r => r.action.kind === "eat" && r.action.reserved.food === 1));
  await saveReload(page, "four-meal-reserved-save");
  await select(page, ["アキ", "ミオ", "レン", "ハル"]);
  s = await until(page, "v2-mio-invitation", "予約した四人の食事を一度だけ実行", x => x.residents.every(r => !eatingIds.includes(r.action?.id)));
  const fourMeal = s.life.events.find(e => e.kind === "meal" && e.actors.length === 4);
  assert.ok(fourMeal); assert.deepEqual([...fourMeal.actors].sort(), s.residents.map(r => r.id).sort());
  assert.equal(s.life.events.filter(e => e.id === fourMeal.id).length, 1);
  assert.ok(s.life.wishes.mio && s.life.wishes["village-guide"]);
  assert.ok(!s.life.events.find(e => e.id === privateMeal.id).witnesses.includes("village-guide"));
  await responsive(page, "four-meal-completed", ".action-grid", true);
  check("帰還後に四人で同じ食卓を囲み、途中保存から一度だけ完了し、ミオとハル本人の望みを満たす");

  await nav(page, "住民たち");
  await haruDetail.locator(".resident-routine summary").click();
  const profileBefore = await state(page);
  for (const [label, value] of [["ハルの仕事の担当", "gather"], ["ハルの落ち着く場所", "garden"], ["ハルの余暇の過ごし方", "social"]]) {
    s = await op(page, "v2-mio-invitation", `${label}を変更`, () => page.getByLabel(label, { exact: true }).selectOption(value));
    assert.equal(s.minutes, profileBefore.minutes); assert.equal(s.seed, profileBefore.seed);
    assert.deepEqual(person(s, "village-guide").action, person(profileBefore, "village-guide").action);
  }
  assert.deepEqual(person(s, "village-guide").routine, { workRole: "gather", home: "garden", leisure: "social" });
  await responsive(page, "haru-routine-controls", ".detail-card:last-child .resident-routine", true);
  await saveReload(page, "four-household-profile-save");
  assert.deepEqual(person(await state(page), "village-guide").routine, { workRole: "gather", home: "garden", leisure: "social" });
  check("ハルの担当・落ち着く場所・余暇を UI で変更し、時計や途中行動を進めず保存・再読込で維持");

  await nav(page, "いまの暮らし"); await select(page, ["アキ"]);
  await expect(page.locator(".night-button")).toContainText("夕方まで");
  s = await op(page, "v2-mio-invitation", "共有時計を夕方まで進める", () => page.locator(".night-button").click());
  assert.equal(s.minutes, 1080); assert.ok(s.residents.every(r => r.hp > 0));
  await select(page, ["アキ", "ミオ", "レン", "ハル"]);
  await expect(page.locator(".night-button")).toContainText("翌朝まで");
  s = await op(page, "v2-mio-invitation", "四人の睡眠を指示し翌朝へ進める", () => page.locator(".night-button").click());
  assert.equal(s.minutes, 1920); assert.equal(s.residents.length, 4);
  assert.ok(s.residents.every(r => r.hp > 0 && r.action?.kind !== "sleep"));
  assert.ok(s.life.reflections.some(r => r.residentId === "village-guide" && r.day === 2));
  const reflection = s.life.reflections.find(r => r.residentId === "village-guide" && r.day === 2);
  assert.notEqual(reflection.eventId, privateMeal.id, "Haru's next morning cannot recall the pre-joining private meal");
  await responsive(page, "four-next-morning", ".residents-list", true);
  await saveReload(page, "four-next-morning-save");
  await writeFile(join(output, "final-state.json"), JSON.stringify(s, null, 2));
  check("四人が翌朝まで暮らし、ハルの実体験に基づく振り返りと担当設定を維持する");
  assert.deepEqual(errors, []); assert.ok(requests.every(r => r.url === URL));
  const report = { status: "passed", sha256, bytes: Buffer.byteLength(html), fixturePath,
    fixtureSha256: createHash("sha256").update(fixtureRaw).digest("hex"),
    method: "isolated offline Chromium; actual controls; genuine v2 save imported through file input; read-only state assertions; no controlled value edits",
    checks, operations, audits, captures, errors, requests, finalMinutes: s.minutes, finalRoster: s.residents.map(r => r.id) };
  await writeFile(join(output, "report.json"), JSON.stringify(report, null, 2));
  console.log(JSON.stringify({ status: "passed", sha256, checks: checks.length, output, errors: errors.length, externalRequests: requests.filter(r => r.url !== URL).length }));
} catch (error) {
  if (activePage && !activePage.isClosed()) await activePage.screenshot({ path: join(output, "failure.png"), fullPage: true }).catch(() => {});
  await writeFile(join(output, "failure.json"), JSON.stringify({ status: "failed", sha256, error: String(error), stack: error.stack, checks, operations, audits, captures, errors, requests }, null, 2));
  throw error;
} finally { await browser.close(); }
