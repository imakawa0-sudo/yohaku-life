/** Actual standalone UI replay of dispersed life, combat, rescue and care.
 * Presets are created through controls; full-world hashes must equal the
 * pre-feature normal-play baseline with selectionPresets alone excluded.
 */
import assert from "node:assert/strict";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { createHash } from "node:crypto";
import { chromium, expect } from "@playwright/test";

const html = await readFile(
  resolve(process.env.SQUADS_HTML || "dist/yohaku-v53.html"),
  "utf8",
);
const sha256 = createHash("sha256").update(html).digest("hex");
if (process.env.EXPECTED_HTML_SHA)
  assert.equal(sha256, process.env.EXPECTED_HTML_SHA);
const root =
  process.env.PLAYTEST_OUTPUT ||
  `/workspace/research/stage3c-squads/playtest/${sha256.slice(0, 12)}`;
await mkdir(root, { recursive: true });
await writeFile(`${root}/tested-yohaku.html`, html);
const runner = await readFile(new globalThis.URL(import.meta.url), "utf8");
const runnerSha256 = createHash("sha256").update(runner).digest("hex");
await writeFile(`${root}/tested-runner.mjs`, runner);
const baseline = JSON.parse(
  await readFile(
    resolve("tests/fixtures/squad-baseline-expectations.json"),
    "utf8",
  ),
);
const sort = (value) =>
  Array.isArray(value)
    ? value.map(sort)
    : value && typeof value === "object"
      ? Object.fromEntries(
          Object.keys(value)
            .sort()
            .map((key) => [key, sort(value[key])]),
        )
      : value;
const withoutPresets = (world) => {
  const { selectionPresets: _presets, ...rest } = world;
  return rest;
};
const worldHash = (world) =>
  createHash("sha256")
    .update(JSON.stringify(sort(withoutPresets(world))))
    .digest("hex");
const URL = "http://yohaku-squads.local/";
const presetSetup = [],
  presetCalls = [],
  focusVisits = [],
  presetPanelOpens = [];
const operations = [],
  selections = [],
  navigations = [],
  checkpoints = [],
  audits = [],
  captures = [],
  errors = [],
  requests = [],
  fixtures = [];
const browser = await chromium.launch({
  executablePath: process.env.CHROMIUM_PATH || "/usr/bin/chromium",
  headless: true,
  args: ["--no-sandbox"],
});
let page, scenario;
const person = (s, id) => s.residents.find((r) => r.id === id);
const state = () =>
  page.evaluate(() =>
    JSON.parse(
      localStorage.getItem("yohaku-autosave-v1") ||
        localStorage.getItem("yohaku-save-v1"),
    ),
  );
const card = (name) =>
  page
    .locator(".residents-list .resident-card")
    .filter({ has: page.locator(".resident-name").filter({ hasText: name }) });
const cleanName = (name) => name.replace(/あなた$/, "").trim();
const selected = async () =>
  (
    await page
      .locator(
        ".residents-list .resident-card[aria-pressed=true] .resident-name",
      )
      .allTextContents()
  ).map(cleanName);
const focused = async () =>
  cleanName(
    await page
      .locator(".residents-list .resident-card.viewing .resident-name")
      .textContent(),
  );
const names = { aki: "アキ", mio: "ミオ", ren: "レン" };
async function dismiss() {
  const n = page.getByRole("button", { name: "通知を閉じる", exact: true });
  if (await n.isVisible()) await n.click();
}
async function openSquads() {
  const before = await state();
  if (!(await page.locator(".squad-tools").isVisible())) {
    await page.locator(".squad-toggle").click();
    presetPanelOpens.push({ scenario, minutes: before.minutes, clicks: 1 });
  }
  assert.deepEqual(await state(), before);
  await expect(page.locator(".squad-tools")).toBeVisible();
}
async function manualSelect(ids) {
  const before = await state();
  let clicks = 0;
  for (const id of Object.keys(names).filter((id) => !ids.includes(id))) {
    const c = card(names[id]);
    if ((await c.getAttribute("aria-pressed")) === "true") {
      await c.click();
      clicks++;
    }
  }
  for (const id of ids) {
    const c = card(names[id]);
    if ((await c.getAttribute("aria-pressed")) !== "true") {
      await c.click();
      clicks++;
    }
  }
  if (ids.length && (await focused()) !== names[ids.at(-1)]) {
    await card(names[ids.at(-1)]).click();
    await card(names[ids.at(-1)]).click();
    clicks += 2;
  }
  assert.deepEqual(await state(), before);
  return clicks;
}
const presetDefs = [
  { name: "外出組", ids: ["aki", "ren"] },
  { name: "留守番", ids: ["mio"] },
  { name: "アキ単独", ids: ["aki"] },
  { name: "レン単独", ids: ["ren"] },
];
async function setupPresets() {
  const initial = await state();
  assert.equal(initial.selectionPresets, undefined);
  for (const def of presetDefs) {
    const rosterClicks = await manualSelect(def.ids);
    await openSquads();
    const fresh = page
      .locator(".squad-editor")
      .getByRole("button", { name: "新しい隊へ", exact: true });
    if (await fresh.isVisible()) await fresh.click();
    const before = await state(),
      chosen = await selected(),
      focus = await focused();
    await page
      .locator(".squad-editor")
      .getByLabel("隊の名前", { exact: true })
      .fill(def.name);
    assert.deepEqual(await state(), before);
    await page.locator(".squad-save").click();
    const after = await state();
    assert.deepEqual(
      withoutPresets(after),
      withoutPresets(before),
      "隊の保存は拡張以外の世界を変更しない",
    );
    assert.deepEqual(await selected(), chosen);
    assert.equal(await focused(), focus);
    const saved = after.selectionPresets.entries.find(
      (entry) => entry.name === def.name,
    );
    assert.deepEqual(saved.residentIds, def.ids);
    await page.locator(".squad-save").click();
    assert.deepEqual(await state(), after, "同じ隊の再保存は全状態不変");
    presetSetup.push({
      scenario,
      name: def.name,
      residentIds: def.ids,
      minutes: after.minutes,
      rosterClicks,
      worldSha256: worldHash(after),
    });
  }
  await manualSelect(["aki"]);
  await page.locator(".squad-toggle").click();
  assert.deepEqual(withoutPresets(await state()), withoutPresets(initial));
  assert.deepEqual(await selected(), ["アキ"]);
  assert.equal(await focused(), "アキ");
}
async function select(ids, focus = ids.at(-1)) {
  await dismiss();
  const before = await state(),
    from = await selected(),
    fromFocus = await focused(),
    viewBefore = await page
      .getByRole("navigation")
      .locator("button.active")
      .textContent();
  const expected = baseline.selections[selections.length];
  assert.equal(expected.scenario, scenario);
  assert.deepEqual(
    expected.to,
    Object.keys(names)
      .filter((id) => ids.includes(id))
      .map((id) => names[id]),
  );
  assert.equal(expected.toFocus, names[focus]);
  const def = presetDefs.find(
    (item) =>
      item.ids.length === ids.length &&
      item.ids.every((id) => ids.includes(id)),
  );
  assert.ok(def);
  const changing = JSON.stringify(from) !== JSON.stringify(expected.to);
  let clicks = 0;
  if (changing) {
    await openSquads();
    await page
      .locator(".squad-list")
      .getByRole("button", { name: `${def.name}を選択`, exact: true })
      .click();
    clicks = 1;
    assert.deepEqual(await state(), before, "隊呼出は世界を変更しない");
    assert.equal(await focused(), fromFocus, "隊呼出は注目人物を変更しない");
    assert.equal(
      await page.getByRole("navigation").locator("button.active").textContent(),
      viewBefore,
      "隊呼出は画面を変更しない",
    );
    await expect(
      page
        .locator(".squad-list")
        .getByRole("button", { name: `${def.name}を選択`, exact: true }),
    ).toHaveAttribute("aria-pressed", "true");
    presetCalls.push({
      scenario,
      name: def.name,
      minutes: before.minutes,
      from,
      to: await selected(),
      focus: fromFocus,
      clicks: 1,
    });
  }
  assert.deepEqual(await selected(), expected.to);
  if ((await focused()) !== names[focus]) {
    // Scene viewing is explicit and separate from recalling command targets.
    const focusState = await state(),
      chosen = await selected();
    const scene = page
      .locator(".squad-list")
      .getByRole("button", {
        name: `${names[focus]}の場面を見る（${def.name}）`,
        exact: true,
      });
    const box = await scene.boundingBox();
    assert.ok(box && box.height >= 44, "隊員の場面操作は高さ44px以上");
    await scene.click();
    const sceneClicks = 1;
    assert.deepEqual(await state(), focusState);
    assert.deepEqual(await selected(), chosen);
    assert.equal(await focused(), names[focus]);
    focusVisits.push({
      scenario,
      minutes: before.minutes,
      residentId: focus,
      clicks: sceneClicks,
      route: "隊欄の隊員の場面を見る",
      buttonSize: box,
    });
  }
  assert.deepEqual(await state(), before);
  selections.push({
    scenario,
    minutes: before.minutes,
    from,
    fromFocus,
    to: await selected(),
    toFocus: await focused(),
    clicks,
    focusOnlyClicks: 0,
    baselineRosterClicks: expected.clicks,
  });
}
async function nav(label) {
  await dismiss();
  const before = await state();
  await page
    .getByRole("navigation")
    .getByRole("button", { name: label, exact: false })
    .click();
  assert.deepEqual(await state(), before);
  assert.ok(await page.locator(".travel-panel").count() <= 1,
    "Switching views must remove the previous travel panel");
  navigations.push({ scenario, label, minutes: before.minutes, clicks: 1 });
}
async function op(label, fn) {
  await dismiss();
  const before = await state();
  await fn();
  const after = await state();
  const expected = baseline.operations[operations.length];
  assert.equal(expected.scenario, scenario);
  assert.equal(expected.label, label);
  assert.equal(
    worldHash(after),
    expected.worldSha256,
    `Baseline world differs after ${label}`,
  );
  operations.push({
    scenario,
    label,
    beforeMinutes: before.minutes,
    afterMinutes: after.minutes,
    selected: await selected(),
    focused: await focused(),
    seed: after.seed,
    base: after.resources,
    packs: after.inventory.packs,
    enemy: after.enemy,
    residents: after.residents.map((r) => ({
      id: r.id,
      location: r.location,
      hp: r.hp,
      hunger: r.hunger,
      energy: r.energy,
      wounds: r.wounds,
      action: r.action,
      suspended: r.suspended,
    })),
    world: after,
    worldSha256: worldHash(after),
    baselineWorldSha256: expected.worldSha256,
  });
  console.log(`${label} ${before.minutes} -> ${after.minutes}`);
  assert.equal(after.ended, false);
  return after;
}
async function imported(label, fixturePath) {
  scenario = label;
  const raw = await readFile(resolve(fixturePath), "utf8"),
    expected = JSON.parse(raw);
  const input = baseline.inputs.find((item) => item.scenario === label);
  assert.equal(createHash("sha256").update(raw).digest("hex"), input.sha256);
  fixtures.push({
    scenario,
    path: fixturePath,
    sha256: createHash("sha256").update(raw).digest("hex"),
    minutes: expected.minutes,
  });
  const context = await browser.newContext({
    viewport: { width: 390, height: 844 },
    offline: true,
    acceptDownloads: true,
  });
  await context.route("**/*", async (route) => {
    const url = route.request().url();
    requests.push({ scenario: label, url });
    if (url === URL)
      await route.fulfill({ contentType: "text/html", body: html });
    else await route.abort();
  });
  page = await context.newPage();
  page.on("pageerror", (e) =>
    errors.push({ scenario: label, type: "pageerror", message: e.message }),
  );
  page.on("console", (m) => {
    if (m.type() === "error")
      errors.push({ scenario: label, type: "console", message: m.text() });
  });
  await page.goto(URL);
  await expect(page.locator(".header .time")).toHaveText("08:00");
  await page.locator(".save-button").click();
  await page
    .locator("input[type=file]")
    .setInputFiles({
      name: fixturePath.split("/").at(-1),
      mimeType: "application/json",
      buffer: Buffer.from(raw),
    });
  await expect(page.getByRole("dialog")).not.toBeVisible();
  assert.deepEqual(await state(), expected);
  await setupPresets();
  return context;
}
async function saveReload(name) {
  const before = await state(),
    expected = baseline.checkpoints[checkpoints.length];
  assert.equal(expected.name, name);
  assert.equal(worldHash(before), expected.worldSha256);
  await page.locator(".save-button").click();
  await page
    .getByRole("button", { name: "いまの暮らしを保存する", exact: true })
    .click();
  const pending = page.waitForEvent("download");
  await page
    .getByRole("button", { name: "ファイルに書き出す", exact: true })
    .click();
  const download = await pending,
    raw = await readFile(await download.path(), "utf8");
  assert.deepEqual(JSON.parse(raw), before);
  await writeFile(`${root}/${name}.json`, raw);
  await page.keyboard.press("Escape");
  await page.reload();
  assert.deepEqual(await state(), before);
  checkpoints.push({
    scenario,
    name,
    minutes: before.minutes,
    path: `${root}/${name}.json`,
    sha256: createHash("sha256").update(raw).digest("hex"),
    worldSha256: worldHash(before),
    baselineWorldSha256: expected.worldSha256,
  });
  return before;
}
async function capture(name, target) {
  const before = await state();
  for (const [width, height] of [
    [390, 844],
    [1280, 800],
  ]) {
    await page.setViewportSize({ width, height });
    await dismiss();
    if (target)
      await page
        .locator(target)
        .evaluate((el) => el.scrollIntoView({ block: "start" }));
    else await page.evaluate(() => scrollTo(0, 0));
    const size = await page.evaluate(() => {
      const nav =
        document.querySelector(".nav-tabs") || document.querySelector("nav");
      return {
        client: document.documentElement.clientWidth,
        scroll: document.documentElement.scrollWidth,
        navHeight: nav?.clientHeight,
        navScroll: nav?.scrollHeight,
        travelPanels: document.querySelectorAll(".travel-panel").length,
      };
    });
    assert.ok(size.scroll <= size.client + 1);
    assert.ok(size.travelPanels <= 1,
      "A single view must not retain duplicate travel panels");
    if (size.navHeight) assert.ok(size.navScroll <= size.navHeight + 1);
    audits.push({ scenario, name, width, height, ...size });
    const path = `${root}/${name}-${width}.png`;
    await page.screenshot({ path, fullPage: !target });
    captures.push(path);
  }
  await page.setViewportSize({ width: 390, height: 844 });
  assert.deepEqual(await state(), before);
}
async function until(label, predicate, max = 70) {
  for (let i = 0; i < max; i++) {
    const s = await state();
    if (predicate(s)) return s;
    const control = (await page.locator(".next-button").isVisible())
      ? page.locator(".next-button")
      : page.getByRole("button", { name: "5分", exact: true });
    const after = await op(label, () => control.click());
    assert.ok(after.minutes > s.minutes);
  }
  assert.fail(label + " did not complete");
}
async function move(ids, target, label) {
  await select(ids);
  await nav("周辺を探索");
  const s = await op(`${ids.join("+")}が${label}へ移動予約`, () =>
    page
      .locator(".destinations")
      .getByRole("button", { name: label, exact: false })
      .click(),
  );
  const jobs = ids.map((id) => person(s, id).action?.id);
  assert.ok(jobs.every(Boolean));
  return until(`${label}へ実移動`, (x) =>
    ids.every(
      (id) =>
        person(x, id).location === target &&
        !jobs.includes(person(x, id).action?.id),
    ),
  );
}
const actions = () => page.locator(".action-grid");
const personDetails = (id) =>
  page
    .locator(".detail-card")
    .filter({
      has: page.getByRole("heading", { name: new RegExp("^" + names[id]) }),
    });
let summary = {};
try {
  const dispersed = await imported(
    "dispersed-life",
    "tests/fixtures/two-night-evening-v3.json",
  );
  await select(["aki", "ren"]);
  await select(["mio"]);
  await nav("いまの暮らし");
  let s = await op("留守番ミオが拠点食材2の料理を予約", () =>
    actions()
      .getByRole("button", { name: "食事をつくる", exact: false })
      .click(),
  );
  assert.equal(person(s, "mio").action.reserved.ingredients, 2);
  await select(["aki"]);
  await nav("いまの暮らし");
  s = await op("集落アキが携行食1の食事を予約", () =>
    actions()
      .getByRole("button", { name: /^食事をとる/ })
      .click(),
  );
  const eatId = person(s, "aki").action.id;
  s = await op("三人の共通時計を5分進める", () =>
    page.getByRole("button", { name: "5分", exact: true }).click(),
  );
  assert.equal(person(s, "aki").action.progress, 5);
  assert.equal(person(s, "mio").action.progress, 5);
  s = await op("アキの途中食事を材料予約ごと保持して中断", () =>
    page
      .locator(".running-work")
      .getByRole("button", { name: "中断", exact: true })
      .click(),
  );
  assert.equal(person(s, "aki").suspended.id, eatId);
  assert.equal(person(s, "aki").suspended.reserved.food, 1);
  await select(["mio"]);
  await select(["aki", "ren"]);
  await select(["mio"]);
  await select(["aki"]);
  await capture("squad-list-during-held-reservation", ".squad-list");
  await capture("current-and-held-reservations", ".workboard");
  await saveReload("genuine-current-and-held-reservations");
  await move(["ren"], "meadow", "川沿いの採集地");
  await move(["ren"], "shelter", "木陰の迂回路");
  await nav("いまの暮らし");
  s = await op("迂回路レンが単独で睡眠を予約", () =>
    actions().getByRole("button", { name: "旅先で眠る", exact: false }).click(),
  );
  const sleepId = person(s, "ren").action.id;
  await select(["mio"]);
  await nav("いまの暮らし");
  s = await op("拠点ミオが食事を予約", () =>
    actions()
      .getByRole("button", { name: /^食事をとる/ })
      .click(),
  );
  const mioMealId = person(s, "mio").action.id;
  await select(["aki"]);
  await nav("いまの暮らし");
  s = await op("集落アキの途中食事を同じIDで再開", () =>
    page
      .locator(".suspended-work")
      .getByRole("button", { name: "再開する", exact: true })
      .click(),
  );
  assert.equal(person(s, "aki").action.id, eatId);
  s = await op("三地点の異なる仕事を5分だけ進める", () =>
    page.getByRole("button", { name: "5分", exact: true }).click(),
  );
  assert.equal(person(s, "aki").action.progress, 10);
  assert.equal(person(s, "ren").action.id, sleepId);
  assert.equal(person(s, "mio").action.id, mioMealId);
  await select(["mio"]);
  await select(["ren"]);
  await select(["aki", "ren"]);
  await nav("周辺を探索");
  const away = page.locator(".away-panel");
  if (!(await away.evaluate((el) => el.open)))
    await away.locator(":scope > summary").click();
  await capture("three-places-away-overview", ".away-panel");
  await saveReload("genuine-three-places-current-jobs");
  summary.dispersed = await state();
  await dispersed.close();

  const battle = await imported(
    "actual-encounter-and-rescue",
    "tests/fixtures/two-night-morning-v3.json",
  );
  s = await move(["aki"], "ruins", "旧い資材置き場");
  assert.equal(s.enemy.defeated, false);
  assert.equal(person(s, "aki").hp, 100);
  await saveReload("genuine-natural-encounter");
  await select(["mio"]);
  await nav("いまの暮らし");
  await expect(
    page.getByLabel("戦闘中の時間操作", { exact: true }),
  ).toBeVisible();
  assert.deepEqual(
    await page
      .getByLabel("戦闘中の時間操作", { exact: true })
      .getByRole("button")
      .allTextContents(),
    ["1分", "5分", "10分"],
  );
  s = await op("アキ交戦中でもミオの拠点料理を無時間で予約", () =>
    actions()
      .getByRole("button", { name: "食事をつくる", exact: false })
      .click(),
  );
  const cookId = person(s, "mio").action.id;
  s = await op("ミオの画面から戦闘刻み1分を進める", () =>
    page.getByRole("button", { name: "1分", exact: true }).click(),
  );
  assert.ok(person(s, "aki").hp < 100);
  assert.equal(person(s, "mio").action.progress, 1);
  await capture("mio-home-while-aki-in-combat");
  const beforeJump = await state(),
    selectionBeforeJump = await selected();
  await page.locator(".time-scene-jump").click();
  assert.deepEqual(await state(), beforeJump);
  assert.deepEqual(await selected(), selectionBeforeJump);
  assert.equal(await focused(), "アキ");
  navigations.push({
    scenario,
    label: "戦闘の現場を見る（選択ミオのままアキを表示）",
    minutes: beforeJump.minutes,
    clicks: 1,
  });
  await capture("combat-jump-keeps-command-selection");
  // This deliberate failure branch issues neither an attack nor a retreat for
  // Aki, producing a real casualty rather than editing a save's body values.
  for (let i = 0; i < 12 && person(await state(), "aki").hp > 0; i++)
    s = await op("退避指示を出さない実戦闘で負傷境界まで1分進める", () =>
      page.getByRole("button", { name: "1分", exact: true }).click(),
    );
  assert.equal(person(s, "aki").hp, 0);
  assert.equal(s.enemy.hp, 80);
  assert.equal(person(s, "mio").action.id, cookId);
  await saveReload("genuine-natural-casualty");
  await move(["ren"], "ruins", "旧い資材置き場");
  await nav("いまの暮らし");
  s = await op("到着したレンが救援のため攻撃を予約", () =>
    actions().getByRole("button", { name: "攻撃する", exact: false }).click(),
  );
  for (let i = 0; i < 10 && !s.enemy.defeated; i++)
    s = await op("レンの実攻撃を1分ずつ進める", () =>
      page.getByRole("button", { name: "1分", exact: true }).click(),
    );
  assert.equal(s.enemy.defeated, true);
  assert.ok(person(s, "ren").hp >= 30);
  await nav("住民たち");
  s = await op("レンが同所の倒れたアキの救助を予約", () =>
    personDetails("aki")
      .getByRole("button", { name: "救助する", exact: true })
      .click(),
  );
  const rescueId = person(s, "ren").action.id;
  assert.equal(person(s, "ren").action.kind, "rescue");
  await select(["mio"]);
  await nav("いまの暮らし");
  await expect(
    page.getByLabel("通常の時間操作", { exact: true }),
  ).toBeVisible();
  s = await op("ミオ操作中に実際の救助を5分進める", () =>
    page.getByRole("button", { name: "5分", exact: true }).click(),
  );
  assert.equal(person(s, "ren").action.id, rescueId);
  assert.equal(person(s, "ren").action.progress, 5);
  assert.equal(person(s, "aki").location, person(s, "ren").location);
  await capture("mio-home-during-rescue");
  await saveReload("genuine-rescue-in-progress");
  await select(["ren"]);
  s = await until(
    "実経路でアキを運んで帰還",
    (x) => person(x, "ren").action?.id !== rescueId,
  );
  assert.equal(person(s, "aki").location, "home");
  assert.equal(person(s, "ren").location, "home");
  await select(["mio"]);
  if (!["home"].includes(person(s, "mio").location))
    s = await move(["mio"], "home", "共同の居間");
  await nav("住民たち");
  s = await op("留守番ミオが帰還したアキの手当を予約", () =>
    personDetails("aki")
      .getByRole("button", { name: "手当を頼む", exact: true })
      .click(),
  );
  const healId = person(s, "mio").action.id;
  s = await until(
    "ミオが実際の時間と薬でアキを手当",
    (x) => person(x, "mio").action?.id !== healId,
  );
  assert.ok(person(s, "aki").hp > 0);
  await nav("いまの暮らし");
  await capture("rescued-and-treated-home");
  await saveReload("genuine-rescue-and-care-complete");
  summary.battle = s;
  await battle.close();
  assert.deepEqual(errors, []);
  assert.ok(requests.every((r) => r.url === URL));
  assert.equal(operations.length, 42);
  assert.equal(checkpoints.length, 6);
  assert.equal(selections.length, baseline.selections.length);
  await writeFile(
    `${root}/report.json`,
    JSON.stringify(
      {
        status: "passed",
        sha256,
        runnerSha256,
        bytes: Buffer.byteLength(html),
        method:
          "Two genuine normal UI branches replay the same 42 baseline operations through saved selection presets. Only actual controls prepare presets and play; state reads assert. selectionPresets is the sole excluded extension in canonical full-world hashes. The casualty is produced by deliberately not attacking or retreating.",
        fixtures,
        presetSetup,
        presetCalls,
        presetPanelOpens,
        focusVisits,
        operations,
        selections,
        navigations,
        checkpoints,
        audits,
        captures,
        errors,
        requests,
        summary,
        baselineMetrics: baseline.baselineMetrics,
      },
      null,
      2,
    ),
  );
  console.log(
    JSON.stringify({
      status: "passed",
      operations: operations.length,
      selections: selections.length,
      presetCalls: presetCalls.length,
      sceneClicks: focusVisits.reduce((n, s) => n + s.clicks, 0),
      checkpoints: checkpoints.length,
      captures: captures.length,
      output: root,
    }),
  );
} catch (error) {
  if (page && !page.isClosed())
    await page
      .screenshot({ path: `${root}/failure.png`, fullPage: true })
      .catch(() => {});
  await writeFile(
    `${root}/failure.json`,
    JSON.stringify(
      {
        status: "failed",
        sha256,
        runnerSha256,
        error: String(error),
        stack: error.stack,
        scenario,
        operations,
        selections,
        navigations,
        checkpoints,
        audits,
        captures,
        errors,
        requests,
        state: page && !page.isClosed() ? await state() : undefined,
      },
      null,
      2,
    ),
  );
  throw error;
} finally {
  await browser.close();
}
