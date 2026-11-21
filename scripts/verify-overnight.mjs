/** Real controls on the built offline HTML. The input is an unedited prior UI
 * export; normal preparation never uses the app API or writes browser storage. */
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { chromium, expect } from "@playwright/test";

const html = await readFile(resolve(process.env.OVERNIGHT_HTML || "dist/yohaku-v53.html"), "utf8");
const sha256 = createHash("sha256").update(html).digest("hex");
if (process.env.EXPECTED_HTML_SHA) assert.equal(sha256, process.env.EXPECTED_HTML_SHA);
const fixturePath = resolve(process.env.OVERNIGHT_BASELINE || "tests/fixtures/outside-evening-v3.json");
const fixtureRaw = await readFile(fixturePath, "utf8");
const fixture = JSON.parse(fixtureRaw);
assert.equal(fixture.version, 3);
assert.equal(fixture.minutes, 1080, "The genuine saved UI journey stops at 18:00");
const output = process.env.PLAYTEST_OUTPUT || `/workspace/research/stage3-overnight/playtest/${sha256.slice(0, 12)}`;
await mkdir(output, { recursive: true });
await writeFile(join(output, "tested-yohaku.html"), html);
const URL = "http://yohaku-overnight.local/";
const checks = [], operations = [], audits = [], captures = [], errors = [], requests = [];
const sizes = [[320, 740], [390, 844], [430, 932], [1280, 800]];
const names = { aki: "アキ", mio: "ミオ", ren: "レン" };
const person = (s, id = "aki") => s.residents.find(r => r.id === id);
const pack = (s, id) => s.inventory.packs[id];
const foodAt = (s, location) => s.residents.filter(r => r.location === location).reduce((n, r) => n + pack(s, r.id).food, 0);
const BASE = new Set(["home", "kitchen", "bedroom", "garden"]);
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || "/usr/bin/chromium", headless: true, args: ["--no-sandbox"] });
let activePage;

const state = page => page.evaluate(() => JSON.parse(localStorage.getItem("yohaku-autosave-v1") || localStorage.getItem("yohaku-save-v1")));
const card = (page, name) => page.locator(".residents-list .resident-card").filter({ has: page.locator(".resident-name").filter({ hasText: name }) });
function check(text) { checks.push(text); console.log(`✓ ${text}`); }
async function dismiss(page) {
  const button = page.getByRole("button", { name: "通知を閉じる", exact: true });
  if (await button.isVisible()) await button.click();
}
async function nav(page, label) {
  await dismiss(page); const before = await state(page);
  await page.getByRole("navigation").getByRole("button", { name: label, exact: false }).click();
  assert.deepEqual(await state(page), before, "Navigation must preserve the world");
}
async function select(page, ids) {
  await dismiss(page); const before = await state(page);
  for (const [id, name] of Object.entries(names)) {
    const c = card(page, name);
    if ((await c.getAttribute("aria-pressed") === "true") !== ids.includes(id)) await c.click();
    await expect(c).toHaveAttribute("aria-pressed", String(ids.includes(id)));
  }
  if (ids.length) {
    const c = card(page, names[ids.at(-1)]);
    if (!(await c.getAttribute("class")).split(/\s+/).includes("viewing")) { await c.click(); await c.click(); }
    await expect(c).toHaveClass(/viewing/);
  }
  assert.deepEqual(await state(page), before, "Changing selection or focus must preserve the world");
}
async function op(page, scenario, label, action) {
  await dismiss(page); const before = await state(page); await action(); const after = await state(page);
  operations.push({ scenario, label, beforeMinutes: before.minutes, afterMinutes: after.minutes,
    base: after.resources, packs: after.inventory.packs,
    residents: after.residents.map(r => ({ id: r.id, location: r.location, hp: r.hp, hunger: r.hunger, energy: r.energy,
      action: r.action && { id: r.action.id, kind: r.action.kind, progress: r.action.progress, duration: r.action.duration, origin: r.action.origin, reserved: r.action.reserved, source: r.action.reservationSource },
      suspended: r.suspended && { id: r.suspended.id, kind: r.suspended.kind, progress: r.suspended.progress, reserved: r.suspended.reserved } })) });
  assert.equal(after.ended, false);
  return after;
}
async function until(page, scenario, label, predicate) {
  for (let n = 0; n < 90; n++) {
    const before = await state(page); if (predicate(before)) return before;
    const after = await op(page, scenario, label, () => page.locator(".next-button").click());
    assert.ok(after.minutes > before.minutes);
  }
  assert.fail(`No completion: ${label}`);
}
async function saveReload(page, scenario, label) {
  const before = await state(page);
  await page.locator(".save-button").click();
  await page.getByRole("button", { name: "いまの暮らしを保存する", exact: true }).click();
  const pending = page.waitForEvent("download");
  await page.getByRole("button", { name: "ファイルに書き出す", exact: true }).click();
  const download = await pending;
  const raw = await readFile(await download.path(), "utf8");
  assert.deepEqual(JSON.parse(raw), before, "Actual export must contain the current entire world");
  await writeFile(join(output, `${label}.json`), raw);
  await page.keyboard.press("Escape"); await page.reload();
  assert.deepEqual(await state(page), before, "Actual reload must restore the entire world");
  operations.push({ scenario, label: `save-export-reload:${label}`, beforeMinutes: before.minutes, afterMinutes: before.minutes });
  return before;
}
async function imported(scenario) {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, offline: true, acceptDownloads: true });
  await context.route("**/*", async route => {
    const url = route.request().url(); requests.push({ scenario, url });
    if (url === URL) await route.fulfill({ contentType: "text/html", body: html }); else await route.abort();
  });
  const page = await context.newPage(); activePage = page;
  page.on("pageerror", error => errors.push({ scenario, type: "pageerror", text: error.message }));
  page.on("console", message => { if (message.type() === "error") errors.push({ scenario, type: "console", text: message.text() }); });
  await page.goto(URL);
  await expect(page.locator(".header .time")).toHaveText("08:00");
  await page.locator(".save-button").click();
  await page.locator("input[type=file]").setInputFiles({ name: "genuine-outside-evening-v3.json", mimeType: "application/json", buffer: Buffer.from(fixtureRaw) });
  await expect(page.getByRole("dialog")).not.toBeVisible();
  assert.deepEqual(await state(page), fixture, "Old format-3 normal UI export remains unchanged on import");
  return { page, context };
}
async function audit(page, label, target, selectedSizes = sizes) {
  const before = await state(page);
  for (const [width, height] of selectedSizes) {
    await page.setViewportSize({ width, height }); await dismiss(page);
    if (target) await page.locator(target).first().evaluate(el => el.scrollIntoView({ block: "center" }));
    else await page.evaluate(() => window.scrollTo(0, 0));
    const metrics = await page.evaluate(() => {
      const nav = document.querySelector(".navigation");
      return { width: document.documentElement.clientWidth, scroll: document.documentElement.scrollWidth,
        nav: nav ? { client: nav.clientHeight, scroll: nav.scrollHeight } : null };
    });
    assert.ok(metrics.scroll <= metrics.width + 1, `${label} ${width}: no horizontal overflow`);
    assert.ok(!metrics.nav || metrics.nav.scroll <= metrics.nav.client + 1, `${label} ${width}: no vertical scrolling inside tab navigation`);
    audits.push({ label, viewport: { width, height }, ...metrics });
    const file = join(output, `${label}-${width}.png`);
    await page.screenshot({ path: file, fullPage: !target }); captures.push(file);
    assert.deepEqual(await state(page), before, "Viewport and screenshots never alter the world");
  }
  await page.setViewportSize({ width: 390, height: 844 });
}
async function openAway(page) {
  await nav(page, "周辺を探索");
  const panel = page.locator(".away-panel"); await expect(panel).toHaveCount(1);
  const before = await state(page);
  if (!await panel.evaluate(el => el.open)) await panel.locator("summary").click();
  assert.deepEqual(await state(page), before);
  return panel;
}
async function move(page, scenario, ids, location, name) {
  await select(page, ids); await nav(page, "周辺を探索");
  const s = await op(page, scenario, `実際に${name}へ移動を予約`, () => page.locator(".destinations").getByRole("button", { name, exact: false }).click());
  const jobs = ids.map(id => person(s, id).action.id);
  return until(page, scenario, `${name}へ実際の共通時計で移動`, x => ids.every(id => person(x, id).location === location && !jobs.includes(person(x, id).action?.id)));
}
const sleep = page => page.locator(".action-grid").getByRole("button", { name: "旅先で眠る", exact: false });
const meal = page => page.locator(".action-grid").getByRole("button", { name: /^(食事をとる|一緒に食事|それぞれ食事)/ });

try {
  const first = await imported("overnight-and-return"), page = first.page;
  await select(page, ["aki", "ren"]); await nav(page, "いまの暮らし");
  const beforeSleep = await state(page);
  let s = await op(page, "overnight-and-return", "集落の二人だけに旅先の睡眠を予約", () => sleep(page).click());
  assert.equal(s.minutes, 1080); assert.equal(s.seed, beforeSleep.seed);
  assert.deepEqual(s.resources, beforeSleep.resources); assert.deepEqual(s.inventory, beforeSleep.inventory);
  assert.deepEqual(person(s, "mio"), person(beforeSleep, "mio"));
  const sleepIds = ["aki", "ren"].map(id => person(s, id).action.id);
  for (const id of ["aki", "ren"]) {
    assert.equal(person(s, id).location, "village"); assert.equal(person(s, id).action.kind, "sleep");
    assert.equal(person(s, id).action.duration, 480); assert.equal(person(s, id).action.progress, 0);
    assert.equal(person(s, id).action.origin, "village"); assert.equal(person(s, id).energy, person(beforeSleep, id).energy);
  }
  const beforeRepeat = await state(page);
  await op(page, "overnight-and-return", "睡眠予約を重ね押ししても同じ二つの仕事を維持", () => sleep(page).click());
  assert.deepEqual(await state(page), beforeRepeat, "Repeated sleep reservation must not reset IDs or create suspended duplicate sleep");
  await audit(page, "village-sleep-reserved", ".action-grid");
  check("旧版の実UI保存から、在外の選んだ二人だけが集落で最長8時間の睡眠を予約し、時計・乱数・物資は不変");

  await select(page, ["mio"]); await nav(page, "いまの暮らし");
  s = await op(page, "overnight-and-return", "外出組が眠るままミオに在宅調理を指示", () => page.locator(".action-grid").getByRole("button", { name: "食事をつくる", exact: false }).click());
  const cookId = person(s, "mio").action.id;
  assert.equal(s.minutes, 1080); assert.equal(person(s, "mio").action.reserved.ingredients, 2);
  s = await op(page, "overnight-and-return", "共通の5分で在外睡眠と在宅調理を並行", () => page.locator(".advance-controls").getByRole("button", { name: "5分", exact: true }).click());
  assert.equal(s.minutes, 1085); assert.equal(person(s, "mio").action.progress, 5);
  assert.equal(person(s, "mio").action.id, cookId);
  for (const id of ["aki", "ren"]) { assert.equal(person(s, id).action.progress, 5); assert.equal(person(s, id).location, "village"); assert.ok(person(s, id).energy > person(beforeSleep, id).energy); }
  await saveReload(page, "overnight-and-return", "sleep-and-base-cooking-held-at-five-minutes");
  await select(page, ["aki", "ren"]);
  const away = await openAway(page);
  await expect(away.locator(".away-location")).toHaveCount(2);
  await expect(away.getByRole("region", { name: "近隣の集落にいる住民" })).toContainText("2人");
  const beforeFocus = await state(page);
  await away.getByRole("button", { name: "ミオの場面を見る", exact: true }).click();
  await expect(card(page, "ミオ")).toHaveClass(/viewing/);
  await expect(card(page, "ミオ")).toHaveAttribute("aria-pressed", "false");
  await expect(card(page, "アキ")).toHaveAttribute("aria-pressed", "true");
  await expect(card(page, "レン")).toHaveAttribute("aria-pressed", "true");
  assert.deepEqual(await state(page), beforeFocus);
  await openAway(page);
  await audit(page, "separate-places-sleep-and-cooking", ".away-panel");
  check("主人公の外泊中も在宅のミオへ指示でき、同じ5分で睡眠と材料予約のある調理が進み、途中保存と表示切替でも選択・状態を保持");

  await select(page, ["aki", "ren"]); await nav(page, "いまの暮らし");
  const beforePause = await state(page), heldSleep = structuredClone(person(beforePause, "aki").action);
  s = await op(page, "overnight-and-return", "アキの5分経過した睡眠だけを中断", () => page.locator(".current-action").filter({ hasText: "アキ：" }).getByRole("button", { name: "中断", exact: true }).click());
  assert.equal(person(s, "aki").action, null); assert.deepEqual(person(s, "aki").suspended, heldSleep);
  s = await op(page, "overnight-and-return", "同じ睡眠ボタンで途中睡眠を再開し、眠っているレンも維持", () => sleep(page).click());
  assert.equal(s.minutes, beforePause.minutes); assert.deepEqual(person(s, "aki").action, heldSleep); assert.equal(person(s, "aki").suspended, null);
  assert.deepEqual(person(s, "ren").action, person(beforePause, "ren").action);
  assert.equal(s.nextId, beforePause.nextId);
  for (let n = 0; n < 12 && (await state(page)).minutes < 1920; n++) {
    const before = await state(page);
    s = await op(page, "overnight-and-return", "睡眠と留守番を共通時計で翌朝へ進める", () => page.locator(".night-button").click());
    assert.ok(s.minutes > before.minutes);
  }
  assert.equal(s.minutes, 1920);
  for (const id of ["aki", "ren"]) { assert.equal(person(s, id).location, "village"); assert.ok(!sleepIds.includes(person(s, id).action?.id)); assert.equal(person(s, id).hp, 100); }
  assert.notEqual(person(s, "mio").action?.kind, "sleep", "Unselected home resident was never ordered to sleep");
  assert.ok(s.logs.some(l => l.title === "温かい食事ができた" && l.actors.includes("mio") && l.time > 1080));
  const sleepLogs = s.logs.filter(l => l.time > 1080 && l.time <= 1920 && /集落の休み所で眠りから覚めた/.test(l.text));
  assert.equal(sleepLogs.length, 2); assert.ok(sleepLogs.every(l => l.time === 1560), "The 18:00 sleep ends at 02:00 after eight hours, before the shared morning");
  await audit(page, "travellers-next-morning", undefined, [[390, 844], [1280, 800]]);
  await saveReload(page, "overnight-and-return", "village-next-morning");
  check("集落で8時間後に一度起き、留守番の仕事を続けたまま翌朝08時へ到達し、帰還や倉庫の遠隔使用を起こさない");

  await select(page, ["aki", "ren"]); await nav(page, "いまの暮らし");
  const beforeMeal = await state(page), baseBeforeMeal = { ...beforeMeal.resources }, localBeforeMeal = foodAt(beforeMeal, "village");
  assert.ok(localBeforeMeal >= 2);
  s = await op(page, "overnight-and-return", "翌朝の二人分の携行食を実際に予約", () => meal(page).click());
  for (const id of ["aki", "ren"]) { assert.equal(person(s, id).action.kind, "eat"); assert.equal(person(s, id).action.reserved.food, 1); assert.equal(person(s, id).action.reservationSource, "pack"); }
  assert.deepEqual(s.resources, baseBeforeMeal);
  const breakfastIds = ["aki", "ren"].map(id => person(s, id).action.id);
  await saveReload(page, "overnight-and-return", "travelling-breakfast-reserved");
  await select(page, ["aki", "ren"]);
  s = await until(page, "overnight-and-return", "携行食の朝食を一度だけ完了", x => ["aki", "ren"].every(id => !breakfastIds.includes(person(x, id).action?.id)));
  assert.equal(foodAt(s, "village"), localBeforeMeal - 2);
  assert.equal(s.resources.food, baseBeforeMeal.food);
  assert.ok(["aki", "ren"].every(id => person(s, id).hunger > 35));
  if (foodAt(s, "village") === 0) { await expect(meal(page)).toBeDisabled(); assert.ok(s.resources.food > 0, "A stocked distant warehouse cannot replace empty local packs"); }
  check("翌朝の食事は現地の携行品だけを予約・消費し、途中保存後も二重消費せず遠方の倉庫を減らさない");

  await move(page, "overnight-and-return", ["aki", "ren"], "meadow", "川沿いの採集地");
  await nav(page, "いまの暮らし");
  s = await op(page, "overnight-and-return", "翌日の川辺で二人に共同採集を予約", () => page.locator(".action-grid").getByRole("button", { name: "川辺で採集する", exact: false }).click());
  const gathering = ["aki", "ren"].map(id => person(s, id).action.id);
  s = await until(page, "overnight-and-return", "翌日の採集を実際に完了", x => ["aki", "ren"].every(id => !gathering.includes(person(x, id).action?.id)));
  assert.equal(s.region.harvests.filter(h => h.day === 2).length, 1);
  assert.equal(pack(s, "aki").ingredients + pack(s, "ren").ingredients, 3);
  assert.equal(pack(s, "aki").scrap + pack(s, "ren").scrap, 1);
  await nav(page, "周辺を探索");
  s = await op(page, "overnight-and-return", "荷物と二人を安全な川沿いの道で帰還予約", () => page.getByRole("region", { name: "日帰りの道順を選ぶ" }).getByRole("button", { name: "川沿いの道で拠点へ帰る", exact: false }).click());
  const returning = ["aki", "ren"].map(id => person(s, id).action.id);
  assert.ok(["aki", "ren"].every(id => !person(s, id).action.path.includes("ruins")));
  s = await until(page, "overnight-and-return", "翌日の採集物を携えて二人が帰還", x => ["aki", "ren"].every(id => person(x, id).location === "home" && !returning.includes(person(x, id).action?.id)));
  await select(page, ["aki"]); await nav(page, "いまの暮らし");
  const travel = page.locator(".travel-panel"); if (!await travel.evaluate(el => el.open)) await travel.locator("summary").click();
  for (const resource of ["ingredients", "scrap"]) {
    const amount = pack(await state(page), "aki")[resource];
    if (!amount) continue;
    await travel.locator(".travel-inputs select").selectOption(resource); await travel.locator("input[type=number]").fill(String(amount));
    s = await op(page, "overnight-and-return", `翌日の採集物${resource}${amount}を明示的に収納`, () => travel.getByRole("button", { name: "倉庫へしまう", exact: true }).click());
  }
  await audit(page, "returned-after-overnight", undefined, [[390, 844], [1280, 800]]);
  const final = await saveReload(page, "overnight-and-return", "day-two-returned-home");
  assert.ok(final.residents.every(r => BASE.has(r.location)));
  check("外泊の翌日に共同採集し、実際の安全な道で帰還・収納して暮らしへ戻り、保存を維持する");
  await first.context.close();

  const second = await imported("two-separate-shelters"), split = second.page;
  await move(split, "two-separate-shelters", ["ren"], "meadow", "川沿いの採集地");
  await move(split, "two-separate-shelters", ["ren"], "road", "草の道");
  await nav(split, "いまの暮らし");
  const noSiteState = await state(split);
  await expect(sleep(split)).toBeDisabled(); await expect(sleep(split)).toHaveAttribute("title", /眠れる雨よけ/);
  assert.deepEqual(await state(split), noSiteState);
  await move(split, "two-separate-shelters", ["ren"], "shelter", "木陰の迂回路");
  await select(split, ["aki", "ren"]); await nav(split, "いまの暮らし");
  const beforeSplitSleep = await state(split);
  s = await op(split, "two-separate-shelters", "集落のアキと木陰のレンへ別々の寝場所で一括睡眠指示", () => sleep(split).click());
  assert.equal(s.minutes, beforeSplitSleep.minutes);
  assert.equal(person(s, "aki").action.origin, "village"); assert.equal(person(s, "ren").action.origin, "shelter");
  assert.ok(["aki", "ren"].every(id => person(s, id).action.kind === "sleep"));
  s = await op(split, "two-separate-shelters", "離れた二つの雨よけで共通の5分だけ眠る", () => split.locator(".advance-controls").getByRole("button", { name: "5分", exact: true }).click());
  assert.ok(["aki", "ren"].every(id => person(s, id).action.progress === 5));
  assert.equal(person(s, "aki").location, "village"); assert.equal(person(s, "ren").location, "shelter");
  await saveReload(split, "two-separate-shelters", "two-separate-shelters-held");
  const groups = await openAway(split); await expect(groups.locator(".away-location")).toHaveCount(3);
  await audit(split, "three-separate-places", ".away-panel", [[390, 844], [1280, 800]]);
  check("眠れない草の道を実UIで確認し、集落と木陰に離れた二人を各自の寝場所で同時に眠らせ、三地点の並行と保存を保つ");
  await second.context.close();
  assert.deepEqual(errors, []); assert.ok(requests.every(r => r.url === URL));
  const report = { status: "passed", sha256, bytes: Buffer.byteLength(html), fixturePath,
    fixtureSha256: createHash("sha256").update(fixtureRaw).digest("hex"),
    method: "Isolated offline Chromium; actual UI controls; genuine prior v3 export imported through file picker; read-only state assertions. Both branches have no controlled value edits or app API preparation.",
    checks, operations, audits, captures, errors, requests, finalMinutes: final.minutes };
  await writeFile(join(output, "report.json"), JSON.stringify(report, null, 2));
  console.log(JSON.stringify({ status: "passed", sha256, checks: checks.length, operations: operations.length, audits: audits.length, captures: captures.length, output }));
} catch (error) {
  if (activePage && !activePage.isClosed()) await activePage.screenshot({ path: join(output, "failure.png"), fullPage: true }).catch(() => {});
  await writeFile(join(output, "failure.json"), JSON.stringify({ status: "failed", sha256, error: String(error), stack: error.stack, checks, operations, audits, captures, errors, requests }, null, 2));
  throw error;
} finally { await browser.close(); }
