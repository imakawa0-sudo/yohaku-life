/** Actual UI regression for an optional local crafting workbench.
 * Genuine602 is replayed without tools and compared to the exact prior world;
 * a second ordinary branch constructs and uses the table without state edits.
 */
import assert from "node:assert/strict";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { createHash } from "node:crypto";
import { chromium, expect } from "@playwright/test";

const html = await readFile(
  resolve(process.env.CRAFTING_HTML || "dist/yohaku-v53.html"),
  "utf8",
);
const sha256 = createHash("sha256").update(html).digest("hex");
if (process.env.EXPECTED_HTML_SHA)
  assert.equal(sha256, process.env.EXPECTED_HTML_SHA);
const root =
  process.env.PLAYTEST_OUTPUT ||
  `/workspace/research/stage4b-crafting/playtest/${sha256.slice(0, 12)}`;
await mkdir(root, { recursive: true });
await writeFile(`${root}/tested-yohaku.html`, html);
const baseline = JSON.parse(
  await readFile(
    resolve("tests/fixtures/crafting-baseline-expectations.json"),
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
const hash = (value) =>
  createHash("sha256")
    .update(JSON.stringify(sort(value)))
    .digest("hex");
const URL = "http://yohaku-crafting.local/";
const previews = [],
  metrics = [],
  checks = [],
  comparisons = [];
const operations = [],
  selections = [],
  navigations = [],
  checkpoints = [],
  audits = [],
  captures = [],
  errors = [],
  requests = [],
  fixtures = [],
  controls = [];
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
async function select(ids, focus = ids.at(-1)) {
  await dismiss();
  const before = await state(),
    from = await selected(),
    fromFocus = await focused();
  let clicks = 0,
    focusOnlyClicks = 0;
  for (const id of Object.keys(names).filter((id) => !ids.includes(id))) {
    const c = card(names[id]);
    if ((await c.getAttribute("aria-pressed")) === "true") {
      await c.click();
      clicks++;
    }
  }
  for (const id of [
    ...ids.filter((id) => id !== focus),
    ...(focus ? [focus] : []),
  ]) {
    const c = card(names[id]);
    if ((await c.getAttribute("aria-pressed")) !== "true") {
      await c.click();
      clicks++;
    }
  }
  if (focus && (await focused()) !== names[focus]) {
    await card(names[focus]).click();
    await card(names[focus]).click();
    clicks += 2;
    focusOnlyClicks = 2;
  }
  assert.deepEqual(
    await selected(),
    Object.keys(names)
      .filter((id) => ids.includes(id))
      .map((id) => names[id]),
  );
  assert.deepEqual(
    await state(),
    before,
    "選択・注目の切替は世界状態を変えない",
  );
  selections.push({
    scenario,
    minutes: before.minutes,
    from,
    fromFocus,
    to: await selected(),
    toFocus: await focused(),
    clicks,
    focusOnlyClicks,
  });
  console.log(
    `select ${from.join("+")} -> ${(await selected()).join("+")} : ${clicks} clicks`,
  );
}
async function nav(label) {
  await dismiss();
  const before = await state();
  await page
    .getByRole("navigation")
    .getByRole("button", { name: label, exact: false })
    .click();
  assert.deepEqual(await state(), before);
  navigations.push({ scenario, label, minutes: before.minutes, clicks: 1 });
}
async function op(label, fn) {
  await dismiss();
  const before = await state();
  await fn();
  const after = await state();
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
  });
  console.log(`${label} ${before.minutes} -> ${after.minutes}`);
  assert.equal(after.ended, false);
  return after;
}
async function imported(label, fixturePath) {
  scenario = label;
  const raw = await readFile(resolve(fixturePath), "utf8"),
    expected = JSON.parse(raw);
  assert.equal(fixturePath, baseline.input.path);
  assert.equal(
    createHash("sha256").update(raw).digest("hex"),
    baseline.input.sha256,
  );
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
  return context;
}
async function saveReload(name) {
  const before = await state();
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
      };
    });
    assert.ok(size.scroll <= size.client + 1);
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
  const base = ["home", "kitchen", "bedroom", "garden"].includes(target);
  await nav(base ? "拠点" : "周辺を探索");
  const row = base
    ? page
        .locator(".room-grid .room-card")
        .filter({
          has: page.getByRole("heading", { name: label, exact: true }),
        })
    : page
        .locator(".destinations")
        .getByRole("button", { name: label, exact: false });
  const before = await state(),
    s = await op(`${ids.join("+")}が${label}へ実移動を予約`, () => row.click());
  assert.equal(s.minutes, before.minutes);
  const jobs = ids.map((id) => person(s, id).action?.id);
  assert.ok(jobs.every(Boolean));
  for (const id of ids)
    assert.ok(
      !person(s, id).action.path.includes("ruins"),
      "通常の回収は守り手の場所を避ける",
    );
  const after = await until(`${label}へ実際に移動`, (x) =>
    ids.every(
      (id) =>
        person(x, id).location === target &&
        !jobs.includes(person(x, id).action?.id),
    ),
  );
  metrics.push({
    scenario,
    kind: "move",
    ids,
    from: ids.map((id) => person(before, id).location),
    to: target,
    duration: after.minutes - before.minutes,
  });
  return after;
}
const actions = () => page.locator(".action-grid");
const personDetails = (id) =>
  page
    .locator(".detail-card")
    .filter({
      has: page.getByRole("heading", { name: new RegExp("^" + names[id]) }),
    });

const freeBase = (s) => {
  const free = { ...s.resources };
  for (const r of s.residents)
    for (const a of [r.action, r.suspended])
      if (a && (a.reservationSource || "base") === "base")
        for (const [key, n] of Object.entries(a.reserved || {})) free[key] -= n;
  return free;
};
const fixture = "tests/fixtures/crafting-home-ready-v3.json";
const table = (s) =>
  s.life.upgrades?.find((upgrade) => upgrade.recipeId === "crafting-tools");
async function picker() {
  await nav("いまの暮らし");
  const before = await state();
  await page.locator(".craft-picker-link").click();
  await expect(page.getByRole("dialog")).toBeVisible();
  assert.deepEqual(await state(), before);
}
async function project(id, label, captureName) {
  await picker();
  const row = page.locator(`.project-recipe[data-recipe="${id}"]`);
  previews.push({
    scenario,
    label,
    minutes: (await state()).minutes,
    recipe: id,
    facts: await row.innerText(),
  });
  if (captureName)
    await capture(captureName, `.project-recipe[data-recipe="${id}"]`);
  const before = await state(),
    s = await op(label, () => row.locator(".project-reserve-button").click());
  assert.equal(s.minutes, before.minutes);
  await expect(page.getByRole("dialog")).not.toBeVisible();
  return s;
}
async function finish(id, job, label) {
  return until(label, (s) => person(s, id).action?.id !== job);
}
async function bird(label) {
  await nav("いまの暮らし");
  const before = await state(),
    s = await op(label, () =>
      actions()
        .getByRole("button", { name: "木彫りをする", exact: false })
        .click(),
    );
  assert.equal(s.minutes, before.minutes);
  return person(s, "aki").action;
}
async function cancelRunning(id, label) {
  await select([id]);
  await nav("いまの暮らし");
  const before = await state(),
    s = await op(label, () =>
      page
        .locator(".running-work")
        .getByRole("button", { name: "取消", exact: true })
        .click(),
    );
  assert.equal(s.minutes, before.minutes);
  return s;
}
async function storeRenScrap() {
  await select(["ren"]);
  await nav("いまの暮らし");
  const panel = page.locator(".travel-panel");
  if (!(await panel.evaluate((el) => el.open)))
    await panel.locator(":scope > summary").click();
  const before = await state();
  await panel.locator(".travel-inputs select").selectOption("scrap");
  await panel.locator("input[type=number]").fill("3");
  assert.deepEqual(await state(), before);
  const s = await op("レンが回収した資材3を倉庫へ明示収納", () =>
    panel.getByRole("button", { name: "倉庫へしまう", exact: true }).click(),
  );
  assert.equal(s.minutes, before.minutes);
  assert.equal(s.resources.scrap, before.resources.scrap + 3);
  assert.equal(
    s.inventory.packs.ren.scrap,
    before.inventory.packs.ren.scrap - 3,
  );
  return s;
}
function check(label) {
  checks.push(label);
  console.log("✓ " + label);
}
let summary = {};
try {
  const legacy = await imported("without-tools-baseline", fixture);
  await select(["aki"]);
  let s = await project("wood-flower", "工具無しで最初の花を予約");
  const flower = person(s, "aki").action;
  assert.equal(flower.duration, 43);
  assert.equal(flower.craftingToolsId, undefined);
  s = await finish("aki", flower.id, "工具無しの最初の花を実際に43分制作");
  const oldBird = await bird("工具無しで続く小鳥を予約");
  assert.equal(oldBird.duration, 45);
  assert.equal(oldBird.craftingToolsId, undefined);
  s = await finish("aki", oldBird.id, "工具無しの小鳥を実際に45分制作");
  s = await project("wood-flower", "工具無しで二輪目の花を予約");
  const flower2 = person(s, "aki").action;
  assert.equal(flower2.duration, 42);
  assert.equal(flower2.craftingToolsId, undefined);
  s = await finish("aki", flower2.id, "工具無しの二輪目を実際に42分制作");
  assert.equal(
    hash(s),
    baseline.withoutTools.worldSha256,
    "工具無しの旧732分全worldは変えない",
  );
  comparisons.push({
    scenario,
    sameWorld: true,
    worldSha256: hash(s),
    baselineWorldSha256: baseline.withoutTools.worldSha256,
    minutes: s.minutes,
  });
  await picker();
  const beforeInsufficientPreview = await state();
  const insufficient = page.locator(
    '.project-recipe[data-recipe="kitchen-tools"]',
  );
  const insufficientRest = page.locator(
    '.project-recipe[data-recipe="rest-corner"]',
  );
  await expect(insufficient.locator(".project-reserve-button")).toBeDisabled();
  await expect(insufficientRest.locator(".project-reserve-button")).toBeDisabled();
  await expect(insufficient.locator(".project-facts")).toContainText("新規の目安");
  await expect(insufficient.locator(".project-facts")).toContainText("37分");
  await expect(insufficientRest.locator(".project-facts")).toContainText("新規の目安");
  await expect(insufficientRest.locator(".project-facts")).toContainText("36分");
  await expect(insufficient).toContainText("未予約の資材3個が必要");
  await expect(insufficientRest).toContainText("未予約の資材3個が必要");
  previews.push({
    scenario,
    label: "資材不足時の投資計画の時間表示",
    recipe: "kitchen-tools",
    facts: await insufficient.innerText(),
    restFacts: await insufficientRest.innerText(),
    baselineFacts: baseline.withoutTools.equipmentPreviewAtInsufficientStock,
  });
  await capture(
    "insufficient-material-recipe-planning",
    '.project-recipe[data-recipe="kitchen-tools"]',
  );
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "閉じる", exact: true })
    .click();
  assert.deepEqual(await state(), beforeInsufficientPreview);
  await saveReload("genuine-without-tools-baseline-repeated");
  summary.withoutTools = s;
  check("工具無しでは43・45・42分と旧732分の全worldを完全に維持");
  await legacy.close();

  const improved = await imported("new-local-crafting-tools", fixture);
  await select(["aki"]);
  const old = await bird("据付前に45分の旧小鳥を予約");
  assert.equal(old.duration, 45);
  assert.equal(old.craftingToolsId, undefined);
  s = await op("旧小鳥を5分だけ実際に進める", () =>
    page.getByRole("button", { name: "5分", exact: true }).click(),
  );
  assert.equal(person(s, "aki").action.progress, 5);
  s = await op("旧小鳥を45分のまま中断", () =>
    page
      .locator(".running-work")
      .getByRole("button", { name: "中断", exact: true })
      .click(),
  );
  assert.equal(person(s, "aki").suspended.id, old.id);
  await nav("住民たち");
  s = await op("ミオの既存交流を明示取消し制作を頼む準備", () =>
    personDetails("mio")
      .getByRole("button", { name: "取消", exact: true })
      .click(),
  );
  await select(["mio"]);
  s = await project("crafting-tools", "ミオが同じ居間に資材3の手仕事台を予約");
  const construction = person(s, "mio").action;
  assert.equal(construction.duration, 50);
  assert.deepEqual(construction.reserved, { scrap: 3 });
  assert.equal(construction.reservationSource, "base");
  assert.equal(construction.craftingToolsId, undefined);
  assert.equal(s.resources.scrap, 4);
  assert.equal(freeBase(s).scrap, 1);
  await expect(
    page.locator('[data-detail="local-crafting-tools"]'),
  ).toHaveCount(0);
  s = await op("手仕事台の工事を5分進める", () =>
    page.getByRole("button", { name: "5分", exact: true }).click(),
  );
  s = await op("工事を資材3と50分の所要で中断", () =>
    page
      .locator(".running-work")
      .getByRole("button", { name: "中断", exact: true })
      .click(),
  );
  await select(["aki", "mio"], "aki");
  await expect(page.locator(".workboard .crafting-tools-note")).toHaveCount(0);
  await capture("old-bird-and-workbench-construction-held", ".workboard");
  await saveReload("genuine-old-bird-and-table-construction-held");
  await select(["mio"]);
  await nav("いまの暮らし");
  s = await op("工事を同じIDの5分から再開", () =>
    page
      .locator(".suspended-work")
      .getByRole("button", { name: "再開する", exact: true })
      .click(),
  );
  assert.equal(person(s, "mio").action.id, construction.id);
  assert.equal(person(s, "mio").action.duration, 50);
  assert.equal(person(s, "mio").action.craftingToolsId, undefined);
  s = await finish("mio", construction.id, "手仕事台を元の50分で一度だけ完成");
  const upgrade = table(s);
  assert.ok(upgrade);
  assert.equal(upgrade.id, construction.id);
  assert.equal(upgrade.location, "home");
  assert.equal(upgrade.creatorId, "mio");
  assert.equal(s.resources.scrap, 1);
  assert.equal(
    s.life.upgrades.filter((row) => row.recipeId === "crafting-tools").length,
    1,
  );
  assert.equal(person(s, "aki").suspended.id, old.id);
  assert.equal(person(s, "aki").suspended.progress, 5);
  assert.equal(person(s, "aki").suspended.duration, 45);
  assert.equal(person(s, "aki").suspended.craftingToolsId, undefined);
  await nav("いまの暮らし");
  await expect(
    page.locator('[data-detail="local-crafting-tools"]'),
  ).toBeVisible();
  await picker();
  await expect(
    page.locator('.project-recipe[data-recipe="crafting-tools"]'),
  ).toHaveCount(0);
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "閉じる", exact: true })
    .click();
  await saveReload("genuine-installed-table-with-legacy-held-bird");
  summary.installed = s;
  check(
    "手仕事台は資材3と50分で一度だけ完成し、旧45分のheldや工事自身へ効果を後付けしない",
  );
  await select(["aki"]);
  await nav("いまの暮らし");
  s = await op("旧小鳥を明示的に45分のまま再開", () =>
    page
      .locator(".suspended-work")
      .getByRole("button", { name: "再開する", exact: true })
      .click(),
  );
  assert.equal(person(s, "aki").action.id, old.id);
  assert.equal(person(s, "aki").action.duration, 45);
  assert.equal(person(s, "aki").action.craftingToolsId, undefined);
  await expect(page.locator(".workboard .crafting-tools-note")).toHaveCount(0);
  s = await finish("aki", old.id, "旧小鳥の残り40分を一度だけ完成");
  assert.equal(s.life.crafts.length, 2);
  const newBird = await bird("完成した手仕事台で新しい小鳥を予約");
  assert.equal(newBird.duration, 34);
  assert.equal(newBird.craftingToolsId, upgrade.id);
  await expect(
    page.locator(".running-work .crafting-tools-note"),
  ).toContainText("開始時の手仕事台を反映");
  s = await op("手仕事台を使う新小鳥を5分進める", () =>
    page.getByRole("button", { name: "5分", exact: true }).click(),
  );
  assert.equal(person(s, "aki").action.craftingToolsId, upgrade.id);
  await saveReload("genuine-new-bird-current-with-table-marker");
  await select(["aki"]);
  await nav("いまの暮らし");
  s = await op("新小鳥も開始時の手仕事台IDごと中断", () =>
    page
      .locator(".running-work")
      .getByRole("button", { name: "中断", exact: true })
      .click(),
  );
  assert.equal(person(s, "aki").suspended.craftingToolsId, upgrade.id);
  await expect(
    page.locator(".suspended-work .crafting-tools-note"),
  ).toContainText("開始時の手仕事台を反映");
  await capture("new-bird-retains-starting-table-marker", ".workboard");
  await saveReload("genuine-new-bird-held-with-table-marker");
  await select(["aki"]);
  await nav("いまの暮らし");
  s = await op("新小鳥を同じ34分と手仕事台IDで再開", () =>
    page
      .locator(".suspended-work")
      .getByRole("button", { name: "再開する", exact: true })
      .click(),
  );
  assert.equal(person(s, "aki").action.id, newBird.id);
  assert.equal(person(s, "aki").action.duration, 34);
  assert.equal(person(s, "aki").action.craftingToolsId, upgrade.id);
  s = await finish("aki", newBird.id, "手仕事台を使う小鳥を実際に34分完成");
  assert.equal(s.life.crafts.length, 3);
  s = await project(
    "wood-flower",
    "手仕事台の同室で新しい花を予約",
    "flower-preview-uses-installed-workbench",
  );
  const localFlower = person(s, "aki").action;
  assert.equal(localFlower.duration, 32);
  assert.equal(localFlower.craftingToolsId, upgrade.id);
  assert.deepEqual(localFlower.reserved, { scrap: 1 });
  assert.equal(freeBase(s).scrap, 0);
  s = await finish("aki", localFlower.id, "手仕事台の花を実際に32分完成");
  assert.equal(s.resources.scrap, 0);
  assert.equal(s.life.crafts.length, 4);
  const crafted = s.life.crafts.filter((piece) => piece.createdAt > 602);
  assert.equal(crafted.length, 3);
  assert.ok(
    crafted.every(
      (piece) => piece.authorId === "aki" && piece.createdLocation === "home",
    ),
  );
  await saveReload("genuine-bird-and-flower-made-with-table");
  summary.localCrafts = s;
  check(
    "新鳥34分・新花32分は開始時の台IDと作者・場所を持ち、current/held保存後も一度だけ完成",
  );
  await select(["aki"]);
  const sameSkill = person(await state(), "aki").skills.craft;
  const localProbe = await bird("同じ技能で居間の新小鳥34分を比較予約");
  assert.equal(localProbe.duration, 34);
  assert.equal(localProbe.craftingToolsId, upgrade.id);
  await cancelRunning("aki", "比較予約だけの居間小鳥を取消し技能を保つ");
  await move(["aki"], "kitchen", "小さな台所");
  await nav("いまの暮らし");
  await expect(
    page.locator('[data-detail="local-crafting-tools"]'),
  ).toHaveCount(0);
  assert.equal(person(await state(), "aki").skills.craft, sameSkill);
  const remote = await bird("同じ技能で別室の新小鳥45分を比較予約");
  assert.equal(remote.duration, 45);
  assert.equal(remote.craftingToolsId, undefined);
  await expect(page.locator(".running-work .crafting-tools-note")).toHaveCount(
    0,
  );
  await capture("unequipped-room-bird-keeps-forty-five-minutes", ".workboard");
  await cancelRunning("aki", "別室の比較予約を取消し技能を保つ");
  s = await move(["aki"], "home", "共同の居間");
  assert.equal(person(s, "aki").skills.craft, sameSkill);
  metrics.push({
    scenario,
    kind: "same-skill-locality",
    skill: sameSkill,
    local: 34,
    remote: 45,
  });
  check("実移動と開始取消で技能を固定すると、別室は45分・台ID無しへ戻る");
  await move(["ren"], "shelter", "木陰の迂回路");
  await nav("いまの暮らし");
  s = await op("レンが安全な木陰の物資を回収予約", () =>
    actions()
      .getByRole("button", { name: "物資を回収する", exact: false })
      .click(),
  );
  const recovery = person(s, "ren").action.id;
  s = await finish("ren", recovery, "レンが安全な回収を実際に20分進める");
  assert.equal(s.inventory.packs.ren.scrap, 3);
  assert.equal(s.resources.scrap, 0);
  await move(["ren"], "home", "共同の居間");
  s = await storeRenScrap();
  assert.equal(s.resources.scrap, 3);
  await select(["aki"]);
  s = await project(
    "kitchen-tools",
    "回収資材で同室の既存料理道具制作を予約",
    "existing-equipment-project-uses-workbench",
  );
  const kitchen = person(s, "aki").action;
  assert.equal(kitchen.duration, 28);
  assert.equal(kitchen.craftingToolsId, upgrade.id);
  assert.deepEqual(kitchen.reserved, { scrap: 3 });
  await expect(
    page.locator(".running-work .crafting-tools-note"),
  ).toContainText("開始時の手仕事台を反映");
  s = await finish("aki", kitchen.id, "既存の料理道具制作も台を使って28分完成");
  assert.equal(s.resources.scrap, 0);
  assert.equal(
    s.life.upgrades.filter((row) => row.recipeId === "kitchen-tools").length,
    1,
  );
  assert.equal(
    s.life.upgrades.filter((row) => row.recipeId === "crafting-tools").length,
    1,
  );
  await saveReload("genuine-recovered-materials-made-local-equipment");
  summary.final = s;
  check(
    "安全な回収と明示収納で資材を用意し、同室の既存設備projectにも開始時の短縮を適用",
  );
  await improved.close();
  assert.deepEqual(errors, []);
  assert.ok(requests.every((row) => row.url === URL));
  await writeFile(
    `${root}/report.json`,
    JSON.stringify(
      {
        status: "passed",
        sha256,
        bytes: Buffer.byteLength(html),
        method:
          "Two ordinary UI branches from genuine602. The no-tools branch compares the exact legacy whole world; the new-table branch uses actual construction, work preservation, local/remote work and safe recovery/explicit storage. No API, field edits or browser-storage writes.",
        fixtures,
        checks,
        comparisons,
        previews,
        metrics,
        operations,
        selections,
        navigations,
        checkpoints,
        audits,
        captures,
        errors,
        requests,
        summary,
      },
      null,
      2,
    ),
  );
  console.log(
    JSON.stringify({
      status: "passed",
      checks: checks.length,
      operations: operations.length,
      checkpoints: checkpoints.length,
      audits: audits.length,
      captures: captures.length,
      comparisons,
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
        error: String(error),
        stack: error.stack,
        scenario,
        checks,
        comparisons,
        previews,
        metrics,
        operations,
        checkpoints,
        audits,
        captures,
        errors,
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
