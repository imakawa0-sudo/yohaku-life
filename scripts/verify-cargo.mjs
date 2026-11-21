/** Actual standalone UI comparison for one actor returning a specified cargo.
 * The field fixture is an unedited ordinary-play file exported from version41.
 * Only visible controls/import/export/reload prepare and change browser worlds.
 */
import assert from "node:assert/strict";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { createHash } from "node:crypto";
import { chromium, expect } from "@playwright/test";

const digest = (value) => createHash("sha256").update(value).digest("hex");
const sorted = (value) =>
  Array.isArray(value)
    ? value.map(sorted)
    : value && typeof value === "object"
      ? Object.fromEntries(
          Object.keys(value)
            .sort()
            .map((key) => [key, sorted(value[key])]),
        )
      : value;
const worldHash = (world) => digest(JSON.stringify(sorted(world)));
const html = await readFile(
  resolve(process.env.CARGO_HTML || "dist/yohaku-v53.html"),
  "utf8",
);
const sha256 = digest(html);
if (process.env.EXPECTED_HTML_SHA)
  assert.equal(sha256, process.env.EXPECTED_HTML_SHA);
const output =
  process.env.PLAYTEST_OUTPUT ||
  `/workspace/research/stage4c-cargo/playtest/${sha256.slice(0, 12)}`;
await mkdir(output, { recursive: true });
const runner = await readFile(new URL(import.meta.url), "utf8");
await writeFile(`${output}/tested-yohaku.html`, html);
await writeFile(`${output}/tested-runner.mjs`, runner);
const fixture = resolve("tests/fixtures/cargo-field-ready-v3.json");
const fixtureRaw = await readFile(fixture, "utf8");
assert.equal(
  digest(fixtureRaw),
  "3d7b7e832432fa222659ba0bea19f61eda96d69e45981b8c37d0a354cc4ce7b8",
);
const fieldWorld = JSON.parse(fixtureRaw);
// Frozen version41 ordinary return33 + explicit scrap1 storage, genuine962 export.
// The expected whole-world hash and raw-export hash keep this runnable from the
// source ZIP without depending on an external research directory.
const legacyFinalWorldSha256 =
  "b9cc5007134189909dcebd044bc8a4d334bb575a4ddc41282508b0ec210477cd";
const legacyFinalExportSha256 =
  "4f2d9a3e61432f3da05ad21ac4c6c7e2619b6aba320faa3a41729f409cb8ee0b";
const ENTRY_URL = "http://yohaku-cargo.local/";
const names = { aki: "アキ", mio: "ミオ", ren: "レン" };
const operations = [],
  selections = [],
  navigations = [],
  controls = [],
  checkpoints = [],
  audits = [],
  captures = [],
  errors = [],
  requests = [],
  fixtures = [],
  checks = [],
  comparisons = [];
const browser = await chromium.launch({
  executablePath: process.env.CHROMIUM_PATH || "/usr/bin/chromium",
  headless: true,
  args: ["--no-sandbox"],
});
let page, scenario;
const person = (s, id = "ren") => s.residents.find((r) => r.id === id);
const state = () =>
  page.evaluate(() =>
    JSON.parse(
      localStorage.getItem("yohaku-autosave-v1") ||
        localStorage.getItem("yohaku-save-v1"),
    ),
  );
const card = (id) =>
  page.locator(`.residents-list .resident-card[aria-label^="${names[id]}を"]`);
const totals = (s) => {
  const total = { ...s.resources };
  for (const stock of [
    ...Object.values(s.inventory.packs),
    ...Object.values(s.inventory.ground),
  ])
    for (const key of Object.keys(total)) total[key] += stock?.[key] || 0;
  return total;
};
async function settle() {
  await page.waitForTimeout(50);
}
async function dismiss() {
  const b = page.getByRole("button", { name: "通知を閉じる", exact: true });
  if (await b.isVisible()) await b.click();
}
async function select(ids, focus = ids.at(-1)) {
  await dismiss();
  const before = await state();
  let clicks = 0;
  for (const id of Object.keys(names))
    if (
      ((await card(id).getAttribute("aria-pressed")) === "true") !==
      ids.includes(id)
    ) {
      await card(id).click();
      clicks++;
    }
  if (focus && !(await card(focus).getAttribute("class")).includes("viewing")) {
    await card(focus).click();
    await card(focus).click();
    clicks += 2;
  }
  await settle();
  for (const id of Object.keys(names))
    assert.equal(
      await card(id).getAttribute("aria-pressed"),
      String(ids.includes(id)),
    );
  assert.deepEqual(
    await state(),
    before,
    "Selecting/focusing residents must not change the world",
  );
  selections.push({ scenario, ids, focus, clicks, minutes: before.minutes });
}
async function nav(label) {
  await dismiss();
  const before = await state();
  await page
    .getByRole("navigation")
    .getByRole("button", { name: label, exact: true })
    .click();
  await settle();
  assert.deepEqual(await state(), before);
  navigations.push({ scenario, label, minutes: before.minutes });
}
async function op(label, fn) {
  await dismiss();
  const before = await state();
  await fn();
  await settle();
  const after = await state();
  assert.equal(after.ended, false);
  operations.push({
    scenario,
    label,
    beforeMinutes: before.minutes,
    afterMinutes: after.minutes,
    world: after,
  });
  console.log(`${scenario}: ${label} ${before.minutes}->${after.minutes}`);
  return after;
}
async function imported(name) {
  scenario = name;
  const context = await browser.newContext({
    viewport: { width: 390, height: 844 },
    offline: true,
    acceptDownloads: true,
  });
  await context.route("**/*", (route) => {
    const url = route.request().url();
    requests.push({ scenario: name, url });
    return url === ENTRY_URL
      ? route.fulfill({ contentType: "text/html", body: html })
      : route.abort();
  });
  page = await context.newPage();
  page.on("pageerror", (e) =>
    errors.push({ scenario: name, type: "pageerror", message: e.message }),
  );
  page.on("console", (m) => {
    if (m.type() === "error")
      errors.push({ scenario: name, type: "console", message: m.text() });
  });
  await page.goto(ENTRY_URL);
  await expect(page.locator(".header .time")).toHaveText("08:00");
  await page.locator(".save-button").click();
  await page.locator("input[type=file]").setInputFiles(fixture);
  await expect(page.getByRole("dialog")).not.toBeVisible();
  await expect
    .poll(async () => JSON.stringify(await state()))
    .toBe(JSON.stringify(fieldWorld));
  fixtures.push({
    scenario,
    path: fixture,
    sha256: digest(fixtureRaw),
    minutes: 929,
    classification: "Ordinary genuine UI export, no field edits",
  });
  return context;
}
async function saveReload(name) {
  await dismiss();
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
  const path = `${output}/${name}.json`;
  await writeFile(path, raw);
  await page.keyboard.press("Escape");
  await page.reload();
  await settle();
  assert.deepEqual(
    await state(),
    before,
    "Manual export and actual reload keep the entire world",
  );
  checkpoints.push({
    scenario,
    name,
    path,
    minutes: before.minutes,
    sha256: digest(raw),
  });
  return { state: before, raw, path };
}
async function capture(name, target, widths = [390, 1280]) {
  const before = await state();
  for (const width of widths) {
    const height = width === 1280 ? 800 : 844;
    await page.setViewportSize({ width, height });
    await dismiss();
    if (target)
      await page
        .locator(target)
        .evaluate((el) => el.scrollIntoView({ block: "start" }));
    else await page.evaluate(() => scrollTo(0, 0));
    const geometry = await page.evaluate(() => {
      const nav = document.querySelector(".navigation nav");
      return {
        client: document.documentElement.clientWidth,
        scroll: document.documentElement.scrollWidth,
        navClient: nav.clientHeight,
        navScroll: nav.scrollHeight,
      };
    });
    assert(geometry.scroll <= geometry.client + 1);
    assert(geometry.navScroll <= geometry.navClient + 1);
    const path = `${output}/${name}-${width}.png`;
    await page.screenshot({ path, fullPage: false });
    captures.push({ scenario, name, width, height, path });
    audits.push({ scenario, name, width, height, ...geometry });
  }
  await page.setViewportSize({ width: 390, height: 844 });
  assert.deepEqual(
    await state(),
    before,
    "Screenshots, responsive changes and page scroll must not mutate the world",
  );
}
async function openTravel() {
  await nav("いまの暮らし");
  const panel = page.locator(".travel-panel");
  if (!(await panel.evaluate((el) => el.open))) {
    const before = await state();
    await panel.locator(":scope>summary").click();
    assert.deepEqual(await state(), before);
  }
  return panel;
}
async function setScrapOne(panel) {
  const before = await state();
  await panel.locator(".travel-inputs select").selectOption("scrap");
  assert.equal(await panel.locator("input[type=number]").inputValue(), "1");
  controls.push({
    scenario,
    kind: "resource-scrap-with-existing-amount-one",
    minutes: before.minutes,
    actualQuantityEdits: 0,
  });
  assert.deepEqual(await state(), before);
}
async function finishRen(jobId, label) {
  for (let step = 0; step < 25; step++) {
    const s = await state();
    if (person(s).action?.id !== jobId) return s;
    const after = await op(label, () => page.locator(".next-button").click());
    assert(after.minutes > s.minutes);
  }
  assert.fail("Return did not finish");
}
async function reserveOrdinary() {
  await select(["ren"]);
  await nav("拠点");
  const before = await state();
  const s = await op("普通の帰還を予約", () =>
    page
      .locator(".room-grid .room-card")
      .filter({
        has: page.getByRole("heading", { name: "共同の居間", exact: true }),
      })
      .click(),
  );
  assert.equal(s.minutes, 929);
  const job = structuredClone(person(s).action);
  assert.equal(job.duration, 33);
  assert.equal(job.cargo, undefined);
  assert.equal(job.id, before.nextId);
  assert.deepEqual(job.path, ["road", "home"]);
  return job;
}
async function reserveCargo({ screen = false } = {}) {
  await select(["ren"]);
  const panel = await openTravel();
  await setScrapOne(panel);
  const before = await state();
  await expect(panel.locator(".cargo-return-preview")).toContainText(
    "帰路 33分",
  );
  await expect(panel.locator(".cargo-return-preview")).toContainText(
    "確保する物：資材1",
  );
  const button = panel.locator("[data-cargo-return]");
  await expect(button).toHaveText("手持ちの資材1を倉庫へ届ける");
  await expect(button).toBeEnabled();
  assert.deepEqual(await state(), before, "A successful preview is read-only");
  if (screen)
    await capture(
      "cargo-input-and-successful-preview",
      ".travel-inputs",
      [320, 390, 430, 1280],
    );
  const s = await op("手持ち資材1の倉庫への運搬を予約", () => button.click());
  assert.equal(s.minutes, 929);
  const job = structuredClone(person(s).action);
  assert.equal(job.kind, "move");
  assert.equal(job.target, "home");
  assert.equal(job.duration, 33);
  assert.equal(job.progress, 0);
  assert.equal(job.id, before.nextId);
  assert.equal(job.automatic, false);
  assert.deepEqual(job.path, ["road", "home"]);
  assert.deepEqual(job.cargo, { resource: "scrap", amount: 1 });
  assert.deepEqual(job.reserved, { scrap: 1 });
  assert.equal(job.reservationSource, "pack");
  assert.equal(job.materialTransfers, undefined);
  assert.deepEqual(
    s.inventory,
    before.inventory,
    "Cargo locks actual hand-held goods without moving or reducing them",
  );
  assert.deepEqual(s.resources, before.resources);
  assert.equal(s.seed, before.seed);
  const expected = structuredClone(before);
  expected.nextId++;
  person(expected).action = job;
  delete expected.pauseReason;
  assert.deepEqual(
    s,
    expected,
    "Only the ordinary action allocation and saved cargo lock change at reservation",
  );
  await expect(
    page
      .locator(".running-work .work-reservation")
      .filter({ hasText: "運搬用に確保" }),
  ).toContainText("資材 1");
  await expect(page.locator(".running-work .cargo-work-note")).toContainText(
    "本人の荷物",
  );
  await expect(panel.locator(".pack-resources")).toContainText("うち予約 1");
  return job;
}
function cargoDifferences(manual, cargo) {
  const differences = [];
  function walk(a, b, path = "") {
    if (Object.is(a, b)) return;
    if (Array.isArray(a) && Array.isArray(b)) {
      if (a.length !== b.length) {
        differences.push({
          path: path + ".length",
          manual: a.length,
          cargo: b.length,
        });
        return;
      }
      for (let i = 0; i < a.length; i++) walk(a[i], b[i], `${path}[${i}]`);
      return;
    }
    if (a && b && typeof a === "object" && typeof b === "object") {
      for (const key of new Set([...Object.keys(a), ...Object.keys(b)]))
        walk(a[key], b[key], `${path}.${key}`);
      return;
    }
    differences.push({ path, manual: a, cargo: b });
  }
  walk(manual, cargo);
  return differences;
}
function compareCargoToManual(manual, cargo) {
  const differences = cargoDifferences(manual, cargo),
    last = manual.logs.length - 1;
  assert(
    differences.length > 0,
    "A completed delivery has a factual delivery log rather than the old manual-transfer wording",
  );
  assert(
    differences.every(
      (d) =>
        d.path === `.logs[${last}].title` || d.path === `.logs[${last}].text`,
    ),
    `Unexpected physical, identity or history differences: ${JSON.stringify(differences)}`,
  );
  assert.equal(cargo.logs[last].title, "荷物を倉庫へ届けた");
  assert.equal(cargo.logs[last].time, 962);
  assert.deepEqual(cargo.logs[last].actors, ["ren"]);
  assert.deepEqual(cargo.logs[last].witnesses, manual.logs[last].witnesses);
  const normalized = structuredClone(cargo);
  normalized.logs[last].title = manual.logs[last].title;
  normalized.logs[last].text = manual.logs[last].text;
  assert.deepEqual(normalized, manual);
  comparisons.push({
    kind: "cargo-versus-manual-final",
    allFieldsExceptTwoExplicitLogStringsExactMatch: true,
    differences,
    seed: cargo.seed,
    minutes: cargo.minutes,
    materialTotals: totals(cargo),
  });
  return differences;
}
function assertCargoDelivered(s) {
  assert.equal(s.minutes, 962);
  assert.equal(person(s).location, "home");
  assert.equal(person(s).action, null);
  assert.equal(person(s).suspended, null);
  assert.deepEqual(s.inventory.packs.ren, {
    food: 0,
    ingredients: 5,
    medicine: 0,
    scrap: 0,
  });
  assert.deepEqual(s.resources, {
    food: 12,
    ingredients: 14,
    medicine: 3,
    scrap: 1,
  });
  assert.deepEqual(totals(s), totals(fieldWorld));
  assert.equal(
    s.logs.filter((log) => log.title === "荷物を倉庫へ届けた").length,
    1,
  );
}
let ordinaryFinal,
  ordinaryRaw,
  heldFinal,
  heldRaw,
  passed = false;
try {
  let context = await imported("ordinary-return-unused-cargo");
  let job = await reserveOrdinary();
  let s = await finishRen(job.id, "普通の帰路33分を実際に進む");
  assert.equal(s.minutes, 962);
  assert.equal(s.resources.scrap, 0);
  assert.equal(s.inventory.packs.ren.scrap, 1);
  await select(["ren"]);
  let panel = await openTravel();
  await setScrapOne(panel);
  s = await op("資材1だけを従来の即時操作で倉庫へしまう", () =>
    panel.getByRole("button", { name: "倉庫へしまう", exact: true }).click(),
  );
  let saved = await saveReload("genuine-ordinary-return-and-storage");
  ordinaryFinal = saved.state;
  ordinaryRaw = saved.raw;
  assert.equal(worldHash(ordinaryFinal), legacyFinalWorldSha256);
  assert.equal(digest(ordinaryRaw), legacyFinalExportSha256);
  comparisons.push({
    kind: "ordinary-legacy-full-world-and-export",
    worldSha256: worldHash(ordinaryFinal),
    rawExportSha256: digest(ordinaryRaw),
    worldExact: true,
    rawBytesExact: true,
  });
  await select(["ren"]);
  await openTravel();
  await capture("ordinary-unused-cargo-still-matches-legacy", ".travel-panel");
  checks.push("Cargo未使用の普通帰還・収納は旧962世界と保存の全バイトを維持");
  await context.close();

  context = await imported("cargo-held-and-other-resident-control");
  job = await reserveCargo({ screen: true });
  await saveReload("genuine-cargo-current-zero");
  await select(["ren"]);
  await nav("いまの暮らし");
  assert.deepEqual(person(await state()).action, job);
  await capture("cargo-current-saved-with-real-reservation", ".workboard");
  await select(["mio"]);
  await nav("いまの暮らし");
  const beforeOther = await state();
  await expect(card("mio")).toHaveAttribute("aria-pressed", "true");
  s = await op("留守のミオを表示したまま運搬も5分進める", () =>
    page.getByRole("button", { name: "5分", exact: true }).click(),
  );
  assert.equal(s.minutes, 934);
  assert.equal(person(s).action.id, job.id);
  assert.equal(person(s).action.progress, 5);
  assert.deepEqual(s.resources, beforeOther.resources);
  assert.deepEqual(s.inventory, beforeOther.inventory);
  assert.deepEqual(person(s).action.cargo, job.cargo);
  await select(["ren"]);
  await nav("いまの暮らし");
  s = await op("5分進んだ運搬を中断", () =>
    page
      .locator(".running-work")
      .getByRole("button", { name: "中断", exact: true })
      .click(),
  );
  const held = structuredClone(person(s).suspended);
  assert.equal(person(s).action, null);
  assert.equal(held.id, job.id);
  assert.equal(held.duration, 33);
  assert.equal(held.progress, 5);
  assert.deepEqual(held.cargo, job.cargo);
  assert.deepEqual(held.reserved, { scrap: 1 });
  await saveReload("genuine-cargo-held-five");
  await select(["ren"]);
  await nav("いまの暮らし");
  assert.deepEqual(person(await state()).suspended, held);
  await expect(page.locator(".suspended-work .cargo-work-note")).toContainText(
    "拠点倉庫",
  );
  await expect(
    page
      .locator(".suspended-work .work-reservation")
      .filter({ hasText: "運搬用に確保" }),
  ).toContainText("資材 1");
  await capture(
    "cargo-held-retains-route-progress-and-lock",
    ".workboard",
    [320, 390, 430, 1280],
  );
  s = await op("同じ運搬を再開", () =>
    page
      .locator(".suspended-work")
      .getByRole("button", { name: "再開する", exact: true })
      .click(),
  );
  assert.equal(s.minutes, 934);
  assert.deepEqual(person(s).action, held);
  s = await finishRen(job.id, "残りの運搬を実際の帰路で進める");
  assertCargoDelivered(s);
  saved = await saveReload("genuine-cargo-held-then-delivered");
  heldFinal = saved.state;
  heldRaw = saved.raw;
  compareCargoToManual(ordinaryFinal, heldFinal);
  await select(["ren"]);
  await openTravel();
  await capture("cargo-delivered-once-ingredients-kept", ".travel-panel");
  checks.push(
    "留守番の表示中も共通時計で運搬し、中断保存・同ID再開後に指定分だけ一度納入",
  );
  await context.close();

  context = await imported("cargo-direct-return");
  job = await reserveCargo();
  s = await finishRen(job.id, "直接の運搬33分を実際に進める");
  assertCargoDelivered(s);
  saved = await saveReload("genuine-cargo-direct-delivered");
  assert.deepEqual(saved.state, heldFinal);
  assert.equal(saved.raw, heldRaw);
  comparisons.push({
    kind: "direct-versus-paused-cargo",
    fullWorldExact: true,
    rawExportBytesExact: true,
    sha256: digest(saved.raw),
  });
  checks.push("同じ33分を直接運ぶ枝は中断再開枝と全世界・保存生バイトが一致");
  await context.close();

  context = await imported("cargo-cancel-releases-real-goods");
  job = await reserveCargo();
  s = await op("取消前に運搬を5分進める", () =>
    page.getByRole("button", { name: "5分", exact: true }).click(),
  );
  assert.equal(s.minutes, 934);
  await nav("いまの暮らし");
  const beforeCancel = await state();
  s = await op("運搬を明示取消し物資は本人へ残す", () =>
    page
      .locator(".running-work")
      .getByRole("button", { name: "取消", exact: true })
      .click(),
  );
  const canceledExpected = structuredClone(beforeCancel);
  person(canceledExpected).action = null;
  delete canceledExpected.pauseReason;
  assert.deepEqual(s, canceledExpected);
  assert.equal(s.resources.scrap, 0);
  assert.equal(s.inventory.packs.ren.scrap, 1);
  assert.equal(person(s).location, "meadow");
  await expect(page.locator(".workboard .cargo-work-note")).toHaveCount(0);
  panel = await openTravel();
  await setScrapOne(panel);
  await expect(panel.locator(".pack-resources")).not.toContainText("うち予約");
  await expect(panel.locator("[data-cargo-return]")).toBeEnabled();
  await capture("cargo-cancel-keeps-goods-and-unlocks", ".travel-inputs");
  await saveReload("genuine-cargo-canceled-pack-preserved");
  await select(["ren"]);
  panel = await openTravel();
  await setScrapOne(panel);
  const conserved = totals(await state());
  s = await op("解放された資材1をその場の地面へ置ける", () =>
    panel.getByRole("button", { name: "地面に置く", exact: true }).click(),
  );
  assert.equal(s.minutes, 934);
  assert.equal(s.inventory.packs.ren.scrap, 0);
  assert.equal(s.inventory.ground.meadow.scrap, 1);
  assert.deepEqual(totals(s), conserved);
  s = await op("同じ資材1を本人が拾い直す", () =>
    panel.getByRole("button", { name: "地面から拾う", exact: true }).click(),
  );
  assert.equal(s.minutes, 934);
  assert.equal(s.inventory.packs.ren.scrap, 1);
  assert.equal(s.inventory.ground.meadow.scrap, 0);
  assert.deepEqual(totals(s), conserved);
  checks.push(
    "途中取消で荷物・身体・位置を保ってロックだけ解き、実際の受渡しで利用可能を確認",
  );
  await context.close();

  assert.deepEqual(errors, []);
  assert(requests.every((request) => request.url === ENTRY_URL));
  assert.equal(
    digest(
      await readFile(
        resolve(process.env.CARGO_HTML || "dist/yohaku-v53.html"),
        "utf8",
      ),
    ),
    sha256,
  );
  assert.equal(digest(await readFile(fixture)), digest(fixtureRaw));
  passed = true;
} catch (error) {
  if (page && !page.isClosed())
    await page
      .screenshot({ path: `${output}/failure.png`, fullPage: true })
      .catch(() => {});
  await writeFile(
    `${output}/failure.json`,
    JSON.stringify(
      {
        scenario,
        error: String(error),
        stack: error.stack,
        state:
          page && !page.isClosed() ? await state().catch(() => null) : null,
      },
      null,
      2,
    ),
  );
  throw error;
} finally {
  await writeFile(
    `${output}/report.json`,
    JSON.stringify(
      {
        status: passed ? "passed" : "failed",
        sha256,
        bytes: Buffer.byteLength(html),
        runnerSha256: digest(runner),
        method:
          "Four ordinary visible-UI branches from the same unedited genuine929 export. No game API, edited state fields or direct browser-storage writes. All manual saves, downloads and reloads use actual controls.",
        fixtures,
        checks,
        operations,
        selections,
        navigations,
        controls,
        checkpoints,
        audits,
        captures,
        errors,
        requests,
        comparisons,
        summary: { ordinaryFinal, heldFinal },
      },
      null,
      2,
    ),
  );
  await browser.close();
}
console.log(
  JSON.stringify({
    status: "passed",
    sha256,
    output,
    checks: checks.length,
    operations: operations.length,
    saves: checkpoints.length,
    audits: audits.length,
    captures: captures.length,
  }),
);
