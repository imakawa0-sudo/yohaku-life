/**
 * Actual UI regression and exploratory checks for the day-trip milestone.
 * Runs the built single HTML offline in isolated Chromium contexts.
 * Game state is read only for assertions; setup and actions use visible controls.
 */
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { chromium, expect } from "@playwright/test";

const htmlPath = resolve(process.env.DAYTRIP_HTML || "dist/yohaku-v53.html");
const html = await readFile(htmlPath, "utf8");
const sha256 = createHash("sha256").update(html).digest("hex");
if (process.env.EXPECTED_HTML_SHA)
  assert.equal(sha256, process.env.EXPECTED_HTML_SHA, "the tested build must match the requested artifact");
const output = process.env.PLAYTEST_OUTPUT
  || `/workspace/research/p2-region-development/playtest/${sha256.slice(0, 12)}`;
await mkdir(output, { recursive: true });
await writeFile(join(output, "tested-yohaku.html"), html);
const URL = "http://yohaku-daytrip.local/";
const AUTO_KEY = "yohaku-autosave-v1";
const SAVE_KEY = "yohaku-save-v1";
const NAMES = ["アキ", "ミオ", "レン"];
const KEYS = ["food", "ingredients", "medicine", "scrap"];
const LABELS = { food: "食事", ingredients: "食材", medicine: "手当用品", scrap: "資材" };
const checks = [], steps = [], captures = [], audits = [], errors = [], requests = [];
const browser = await chromium.launch({
  executablePath: process.env.CHROMIUM_PATH || "/usr/bin/chromium",
  headless: true, args: ["--no-sandbox"],
});

function check(name) { checks.push(name); console.log(`✓ ${name}`); }
const person = (s, id) => s.residents.find(r => r.id === id);
const pack = (s, id) => s.inventory.packs[id];
const json = s => JSON.stringify(s);
const zero = () => ({ food: 0, ingredients: 0, medicine: 0, scrap: 0 });
function total(s) {
  const value = { ...s.resources };
  for (const stock of [...Object.values(s.inventory.packs), ...Object.values(s.inventory.ground)])
    for (const key of KEYS) value[key] += stock[key];
  return value;
}
function baseFree(s) {
  const value = { ...s.resources };
  for (const r of s.residents) for (const a of [r.action, r.suspended]) {
    if (!a || a.reservationSource === "pack") continue;
    for (const key of KEYS) value[key] -= a.reserved?.[key] || 0;
  }
  return value;
}
async function state(page) {
  return page.evaluate(([autoKey, saveKey]) => JSON.parse(localStorage.getItem(autoKey) || localStorage.getItem(saveKey)), [AUTO_KEY, SAVE_KEY]);
}
async function fresh(name) {
  const context = await browser.newContext({
    viewport: { width: 390, height: 844 }, offline: true,
    acceptDownloads: true,
  });
  await context.route("**/*", async route => {
    const url = route.request().url();
    requests.push({ scenario: name, url });
    if (url === URL) await route.fulfill({ contentType: "text/html", body: html });
    else await route.abort();
  });
  const page = await context.newPage();
  page.on("pageerror", e => errors.push({ scenario: name, type: "pageerror", text: e.message }));
  page.on("console", message => {
    if (message.type() === "error") errors.push({ scenario: name, type: "console", text: message.text() });
  });
  await page.goto(URL);
  await expect(page.locator(".header .time")).toHaveText("08:00");
  await expect(page.locator(".residents-list .resident-card")).toHaveCount(3);
  // A pristine game has no autosave until its first command. Bootstrap a real
  // manual save through the visible controls instead of fabricating state.
  await page.locator(".save-button").click();
  await page.getByRole("button", { name: "いまの暮らしを保存する", exact: true }).click();
  await page.keyboard.press("Escape");
  assert.equal((await state(page)).minutes, 480);
  return { page, context };
}
async function selection(page, names) {
  const before = await state(page);
  for (const name of NAMES) {
    const card = page.locator(".residents-list .resident-card").filter({
      has: page.locator(".resident-name").filter({ hasText: name }),
    });
    if ((await card.getAttribute("aria-pressed") === "true") !== names.includes(name))
      await card.click();
    await expect(card).toHaveAttribute("aria-pressed", String(names.includes(name)));
  }
  // Removing the last actor intentionally leaves the scene focused on that
  // actor. Explicitly touch the desired viewed actor without changing the
  // final selection; do not confuse the displayed scene with command targets.
  if (names.length) {
    const viewed = page.locator(".residents-list .resident-card").filter({
      has: page.locator(".resident-name").filter({ hasText: names.at(-1) }),
    });
    if (!(await viewed.getAttribute("class")).split(/\s+/).includes("viewing")) {
      await viewed.click();
      await viewed.click();
    }
    await expect(viewed).toHaveClass(/viewing/);
  }
  assert.deepEqual(await state(page), before, "changing the shared roster does not change the world");
}
async function navigate(page, label) {
  const before = await state(page);
  await page.getByRole("navigation").getByRole("button", { name: label, exact: false }).click();
  assert.deepEqual(await state(page), before, "view changes must not advance or mutate the world");
}
async function operation(page, scenario, label, action) {
  const before = await state(page);
  await action();
  const after = await state(page);
  steps.push({ scenario, label, beforeMinutes: before.minutes, afterMinutes: after.minutes,
    base: after.resources, packs: after.inventory.packs,
    residents: after.residents.map(r => ({ id: r.id, location: r.location,
      action: r.action?.kind || null, actionId: r.action?.id || null,
      progress: r.action?.progress ?? null })) });
  return after;
}
async function panel(page) {
  const p = page.locator(".travel-panel");
  await expect(p).toHaveCount(1);
  if (!(await p.getAttribute("open"))) {
    const isOpen = await p.evaluate(el => el.open);
    if (!isOpen) await p.locator("summary").click();
  }
  await expect(p.locator(".travel-panel-body")).toBeVisible();
  return p;
}
async function transfer(page, scenario, key, amount, buttonName) {
  const p = await panel(page);
  await p.locator(".travel-inputs select").selectOption(key);
  await p.locator('.travel-inputs input[type="number"]').fill(String(amount));
  const button = p.getByRole("button", { name: buttonName, exact: true });
  await expect(button).toBeEnabled();
  const before = await state(page);
  const result = await operation(page, scenario, `${buttonName}: ${LABELS[key]}${amount}`, () => button.click());
  assert.equal(result.minutes, before.minutes, "inventory management is an immediate command");
  assert.deepEqual(total(result), total(before), "transfers conserve every resource");
  return result;
}
async function until(page, scenario, label, predicate, maximum = 50) {
  for (let i = 0; i < maximum; i++) {
    const s = await state(page);
    if (predicate(s)) return s;
    const before = s.minutes;
    const next = await operation(page, scenario, label, () => page.locator(".next-button").click());
    assert.ok(next.minutes > before, "a time button must make progress");
  }
  assert.fail(`No completion after ${maximum} boundaries: ${label}`);
}
async function move(page, scenario, location, name) {
  await navigate(page, "周辺を探索");
  const button = page.locator(".destinations").getByRole("button", { name, exact: false });
  await expect(button).toBeEnabled();
  const before = await state(page);
  const assigned = await operation(page, scenario, `${name}へ移動を予約`, () => button.click());
  assert.equal(assigned.minutes, before.minutes);
  const job = person(assigned, "aki").action;
  assert.equal(job.kind, "move");
  return until(page, scenario, `${name}への移動を進める`, s =>
    person(s, "aki").location === location && person(s, "aki").action?.id !== job.id);
}
async function saveReload(page, scenario, name) {
  const before = await state(page);
  await page.locator(".save-button").click();
  await expect(page.getByRole("dialog")).toBeVisible();
  await page.getByRole("button", { name: "いまの暮らしを保存する", exact: true }).click();
  const pending = page.waitForEvent("download");
  await page.getByRole("button", { name: "ファイルに書き出す", exact: true }).click();
  const download = await pending;
  const raw = await readFile(await download.path(), "utf8");
  assert.deepEqual(JSON.parse(raw), before, "the UI export equals the actual world");
  await writeFile(join(output, `${name}.json`), raw);
  await page.keyboard.press("Escape");
  await page.reload();
  assert.deepEqual(await state(page), before, "a full reload restores the same world");
  steps.push({ scenario, label: "実際の保存・JSON書出し・再読込", beforeMinutes: before.minutes,
    afterMinutes: before.minutes, exported: `${name}.json` });
  return before;
}
async function localSummary(page, expected) {
  const rows = page.getByRole("region", { name: "ホームの物資の概要" }).locator(".summary-resources > div");
  await expect(rows).toHaveCount(4);
  for (const key of KEYS) {
    const row = rows.filter({ has: page.getByText(LABELS[key], { exact: true }) });
    await expect(row).toHaveCount(1);
    assert.equal(Number.parseFloat(await row.locator("strong").innerText()), expected[key],
      `local summary for ${key}`);
  }
}
async function warehouseTable(page) {
  const before = await state(page);
  await navigate(page, "拠点");
  const rows = page.locator(".stock-table > div");
  await expect(rows).toHaveCount(5);
  const free = baseFree(before);
  for (const [index, key] of KEYS.entries()) {
    const cells = await rows.nth(index + 1).locator(":scope > *").allInnerTexts();
    assert.deepEqual(cells.map(s => s.trim()), [
      LABELS[key], String(free[key]), String(before.resources[key] - free[key]), String(before.resources[key]),
    ], `warehouse row ${key} must exclude remote carried resources`);
  }
  await navigate(page, "いまの暮らし");
}
async function capture(page, name) {
  const closeNotice = page.getByRole("button", { name: "通知を閉じる", exact: true });
  if (await closeNotice.isVisible()) await closeNotice.click();
  await page.evaluate(() => window.scrollTo(0, 0));
  const path = join(output, `${name}.png`);
  await page.screenshot({ path, fullPage: true });
  captures.push(path);
}
async function sizes(page, scenario, stage, surface) {
  const before = await state(page);
  for (const [width, height] of [[320, 740], [390, 844], [430, 932], [1280, 800]]) {
    await page.setViewportSize({ width, height });
    const dimensions = await page.evaluate(() => ({
      clientWidth: document.documentElement.clientWidth,
      scrollWidth: document.documentElement.scrollWidth,
      nav: [...document.querySelectorAll(".navigation, .navigation nav")].map(el =>
        ({ height: el.clientHeight, scroll: el.scrollHeight, top: el.scrollTop })),
    }));
    assert.ok(dimensions.scrollWidth <= dimensions.clientWidth + 1,
      `no horizontal overflow in ${stage} at ${width}: ${JSON.stringify(dimensions)}`);
    for (const n of dimensions.nav) {
      assert.ok(n.scroll <= n.height + 1, "tabs must not scroll independently");
      assert.equal(n.top, 0);
    }
    const buttons = page.locator(surface).getByRole("button");
    const touch = [];
    for (const button of await buttons.all()) {
      if (!(await button.isVisible())) continue;
      const name = await button.innerText();
      const box = await button.boundingBox();
      assert.ok(box && box.height >= 43, `touch height ${stage}/${width}/${name}`);
      if (await button.isEnabled()) {
        await button.evaluate(el => el.scrollIntoView({ block: "center" }));
        const visible = await button.boundingBox();
        const footer = await page.locator(".time-bar").boundingBox();
        assert.ok(visible && footer && visible.y >= -1 && visible.y + visible.height <= footer.y + 1,
          `reachable above fixed controls: ${stage}/${width}/${name}`);
      }
      touch.push({ name, width: box.width, height: box.height, enabled: await button.isEnabled() });
    }
    const font = await page.locator(surface).evaluate(el => {
      const button = el.querySelector("button");
      const select = el.querySelector("select");
      return { button: button ? getComputedStyle(button).fontSize : null,
        select: select ? getComputedStyle(select).fontSize : null };
    });
    await capture(page, `${stage}-${width}`);
    audits.push({ scenario, stage, viewport: { width, height }, dimensions, touch, font });
  }
  await page.setViewportSize({ width: 390, height: 844 });
  assert.deepEqual(await state(page), before, "layout audit does not mutate the world");
}

let normalPage, sharingPage;
try {
  const normal = await fresh("normal");
  normalPage = normal.page;
  await selection(normalPage, ["ミオ"]);
  await operation(normalPage, "normal", "留守番のミオへ調理を予約", () =>
    normalPage.locator(".action-grid").getByRole("button", { name: "食事をつくる", exact: false }).click());
  assert.equal(person(await state(normalPage), "mio").action.kind, "cook");
  await selection(normalPage, ["アキ"]);
  await transfer(normalPage, "normal", "food", 3, "倉庫から持ち出す");
  await transfer(normalPage, "normal", "medicine", 1, "倉庫から持ち出す");
  let s = await transfer(normalPage, "normal", "scrap", 2, "倉庫から持ち出す");
  assert.equal(s.minutes, 480);
  assert.deepEqual(pack(s, "aki"), { food: 3, ingredients: 0, medicine: 1, scrap: 2 });
  assert.deepEqual(s.resources, { food: 3, ingredients: 8, medicine: 2, scrap: 2 });
  assert.deepEqual(person(s, "mio").action.reserved, { ingredients: 2 });
  await sizes(normalPage, "normal", "travel-preparation", ".travel-panel");
  check("旅支度は時刻0・資源保存で本人の荷物へ移り、四幅で操作できる");

  await navigate(normalPage, "周辺を探索");
  await sizes(normalPage, "normal", "route-preview", ".daytrip-routes");
  const safe = normalPage.getByRole("region", { name: "日帰りの道順を選ぶ" })
    .getByRole("button", { name: "川沿いの道で集落へ", exact: false });
  await expect(safe).toBeEnabled();
  await expect(safe.locator("..")).toContainText("51分");
  const beforeTrip = await state(normalPage);
  s = await operation(normalPage, "normal", "川沿いの安全な道で集落へ", () => safe.click());
  assert.equal(s.minutes, beforeTrip.minutes);
  assert.equal(person(s, "aki").action.duration, 51);
  assert.deepEqual(person(s, "aki").action.path, ["road", "meadow", "village"]);
  const travelId = person(s, "aki").action.id;
  s = await until(normalPage, "normal", "集落まで共通時計を進める", x =>
    person(x, "aki").location === "village" && person(x, "aki").action?.id !== travelId);
  assert.equal(s.minutes, 531);
  assert.equal(s.enemy.defeated, false);
  assert.equal(s.enemy.location, "ruins");
  assert.deepEqual(s.resources, { food: 6, ingredients: 6, medicine: 2, scrap: 2 });
  assert.deepEqual(pack(s, "aki"), { food: 3, ingredients: 0, medicine: 1, scrap: 2 });
  assert.ok(s.logs.some(l => l.title === "温かい食事ができた" && l.actors.includes("mio")));
  check("荷物を持って安全な51分の往路を実行し、留守番の料理も同じ時計で完成する");

  await navigate(normalPage, "いまの暮らし");
  await localSummary(normalPage, pack(s, "aki"));
  await warehouseTable(normalPage);
  const guide = normalPage.locator(".region-person").filter({
    has: normalPage.getByRole("heading", { name: "道を知る住民", exact: true }),
  });
  const trader = normalPage.locator(".region-person").filter({
    has: normalPage.getByRole("heading", { name: "集落の商い手", exact: true }),
  });
  s = await operation(normalPage, "normal", "案内役から道の話を聞く", () =>
    guide.getByRole("button", { name: "話を聞く", exact: true }).click());
  assert.equal(s.minutes, 531);
  assert.equal(s.region.knownRoute, true);
  assert.deepEqual(s.region.routeKnownBy, ["aki"]);
  s = await operation(normalPage, "normal", "持ってきた食事三食を届ける", () =>
    guide.getByRole("button", { name: "食事3を届ける（任意）", exact: true }).click());
  assert.equal(s.minutes, 531);
  assert.equal(s.region.request.deliveredBy, "aki");
  await expect(guide.getByRole("button", { name: "食事3を届ける（任意）", exact: true })).toBeDisabled();
  s = await operation(normalPage, "normal", "本人の資材一個を手当用品へ交換", () =>
    trader.getByRole("button", { name: "資材1を手当用品1と交換", exact: true }).click());
  assert.equal(s.minutes, 531);
  assert.deepEqual(pack(s, "aki"), { food: 0, ingredients: 0, medicine: 4, scrap: 1 });
  assert.deepEqual(s.resources, { food: 6, ingredients: 6, medicine: 2, scrap: 2 });
  assert.equal(s.region.receipts.length, 3);
  await sizes(normalPage, "normal", "village-interactions", ".region-panel");
  check("本人の携行品だけで話・一度の納品・有限交換を行い、倉庫と現地の利用量を分ける");
  await saveReload(normalPage, "normal", "village-save");
  check("集落の実際の途中保存をJSONへ書き出し、再読込して全状態を復元する");

  s = await move(normalPage, "normal", "meadow", "川沿いの採集地");
  assert.equal(s.minutes, 549);
  await navigate(normalPage, "いまの暮らし");
  const gather = normalPage.locator(".action-grid").getByRole("button", { name: "川辺で採集する", exact: false });
  await expect(gather).toBeEnabled();
  s = await operation(normalPage, "normal", "川辺の一日分の採集を予約", () => gather.click());
  const gatheringId = person(s, "aki").action.id;
  s = await until(normalPage, "normal", "採集を実行する", x => person(x, "aki").action?.id !== gatheringId);
  assert.equal(s.minutes, 579);
  assert.deepEqual(pack(s, "aki"), { food: 0, ingredients: 3, medicine: 4, scrap: 2 });
  assert.equal(s.region.harvests.length, 1);
  await expect(gather).toBeDisabled();
  await expect(gather).toHaveAttribute("title", /今日.*(収穫|採集).*済/);
  await localSummary(normalPage, pack(s, "aki"));
  await capture(normalPage, "meadow-after-harvest-390");
  check("川辺の収穫は本人の携行品へ入り、同じ日の二重回収を防ぐ");

  await navigate(normalPage, "周辺を探索");
  const homeRoute = normalPage.getByRole("region", { name: "日帰りの道順を選ぶ" })
    .getByRole("button", { name: "川沿いの道で拠点へ帰る", exact: false });
  await expect(homeRoute).toBeEnabled();
  s = await operation(normalPage, "normal", "川沿いから安全に帰還を予約", () => homeRoute.click());
  assert.equal(person(s, "aki").action.duration, 33);
  const homeId = person(s, "aki").action.id;
  s = await until(normalPage, "normal", "荷物とともに拠点へ帰還する", x =>
    person(x, "aki").location === "home" && person(x, "aki").action?.id !== homeId);
  assert.equal(s.minutes, 612);
  await navigate(normalPage, "いまの暮らし");
  const beforeDeposit = total(s);
  for (const [key, count] of Object.entries(pack(s, "aki")))
    if (count > 0) await transfer(normalPage, "normal", key, count, "倉庫へしまう");
  s = await state(normalPage);
  assert.deepEqual(pack(s, "aki"), zero());
  assert.deepEqual(total(s), beforeDeposit);
  assert.deepEqual(s.resources, { food: 6, ingredients: 9, medicine: 6, scrap: 4 });
  await warehouseTable(normalPage);
  await panel(normalPage);
  await capture(normalPage, "returned-and-stored-390");
  await saveReload(normalPage, "normal", "returned-save");
  check("帰還後に携行品を倉庫へ戻し、物資と予約を失わず一周を終える");

  const sharing = await fresh("sharing");
  sharingPage = sharing.page;
  await transfer(sharingPage, "sharing", "food", 2, "倉庫から持ち出す");
  await selection(sharingPage, ["アキ", "ミオ"]);
  await navigate(sharingPage, "周辺を探索");
  const road = sharingPage.locator(".destinations").getByRole("button", { name: "草の道", exact: false });
  s = await operation(sharingPage, "sharing", "食事を一人だけが持つ二人で草の道へ", () => road.click());
  const roadIds = s.residents.filter(r => ["aki", "mio"].includes(r.id)).map(r => r.action.id);
  s = await until(sharingPage, "sharing", "二人が同所へ到着する", x =>
    x.residents.filter(r => ["aki", "mio"].includes(r.id)).every(r =>
      r.location === "road" && !roadIds.includes(r.action?.id)));
  await navigate(sharingPage, "いまの暮らし");
  const baseBeforeMeal = s.resources.food;
  assert.equal(baseBeforeMeal, 4);
  assert.equal(pack(s, "aki").food, 2);
  assert.equal(pack(s, "mio").food, 0);
  const eat = sharingPage.locator(".action-grid").getByRole("button", { name: /^一緒に食事/ });
  await expect(eat).toBeEnabled();
  s = await operation(sharingPage, "sharing", "同じ場所の二人へ実食を予約", () => eat.click());
  assert.equal(pack(s, "aki").food, 1);
  assert.equal(pack(s, "mio").food, 1);
  for (const id of ["aki", "mio"]) {
    assert.equal(person(s, id).action.kind, "eat");
    assert.equal(person(s, id).action.reservationSource, "pack");
    assert.deepEqual(person(s, id).action.reserved, { food: 1 });
  }
  await localSummary(sharingPage, { food: 0, ingredients: 0, medicine: 0, scrap: 0 });
  await capture(sharingPage, "shared-field-meal-reserved-390");
  await saveReload(sharingPage, "sharing", "shared-field-meal-save");
  await selection(sharingPage, ["アキ", "ミオ"]);
  s = await until(sharingPage, "sharing", "携行食で二人の食事を完了する", x =>
    ["aki", "mio"].every(id => person(x, id).action?.kind !== "eat"));
  assert.equal(s.resources.food, baseBeforeMeal);
  assert.equal(pack(s, "aki").food + pack(s, "mio").food, 0);
  const meals = s.life.events.filter(e => e.kind === "meal" && e.location === "road");
  assert.equal(meals.length, 1);
  assert.deepEqual([...meals[0].actors].sort(), ["aki", "mio"]);
  assert.deepEqual([...meals[0].witnesses].sort(), ["aki", "mio"]);
  assert.doesNotMatch(meals[0].text, /温か|食卓|室内/);
  await saveReload(sharingPage, "sharing", "shared-field-meal-finished-save");
  check("同所仲間から食事を一度だけ融通し、遠方倉庫を使わず途中予約と完了を保存する");

  assert.deepEqual(errors, [], "no unhandled JavaScript or console errors");
  assert.ok(requests.every(r => r.url === URL), "the standalone run must not request any external asset");
  check("独立オフライン環境で、外部アセット要求とブラウザ例外がない");
  const report = { status: "passed", html: { path: htmlPath, sha256, bytes: Buffer.byteLength(html) },
    method: "actual controls only; read-only localStorage assertions; no field edits, injected state or game API calls",
    checks, steps, audits, captures, errors, requests,
    final: { normal: await state(normalPage), sharing: await state(sharingPage) } };
  await writeFile(join(output, "report.json"), JSON.stringify(report, null, 2));
  console.log(`\n${checks.length} day-trip browser checks passed. HTML ${sha256}\nEvidence: ${output}`);
} catch (error) {
  for (const [name, page] of [["normal", normalPage], ["sharing", sharingPage]]) {
    if (page && !page.isClosed()) {
      await capture(page, `failure-${name}`).catch(() => {});
      await writeFile(join(output, `failure-${name}-state.json`), JSON.stringify(await state(page), null, 2)).catch(() => {});
    }
  }
  await writeFile(join(output, "failure-report.json"), JSON.stringify({
    status: "failed", html: { path: htmlPath, sha256, bytes: Buffer.byteLength(html) },
    error: { message: error.message, stack: error.stack }, checks, steps, audits, captures, errors, requests,
  }, null, 2));
  throw error;
} finally {
  await browser.close();
}

