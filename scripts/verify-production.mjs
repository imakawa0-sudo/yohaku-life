/** Autonomous food replenishment through real standalone UI controls.
 * Genuine baseline exports retain unfinished work and reservations. Preference
 * saves must be metadata-only; actual time advances create finished meals.
 */
import assert from "node:assert/strict";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { createHash } from "node:crypto";
import { chromium, expect } from "@playwright/test";

const html = await readFile(
  resolve(process.env.PRODUCTION_HTML || "dist/yohaku-v53.html"),
  "utf8",
);
const sha256 = createHash("sha256").update(html).digest("hex");
if (process.env.EXPECTED_HTML_SHA)
  assert.equal(sha256, process.env.EXPECTED_HTML_SHA);
const root =
  process.env.PLAYTEST_OUTPUT ||
  `/workspace/research/stage4-work-economy/playtest/${sha256.slice(0, 12)}`;
await mkdir(root, { recursive: true });
await writeFile(`${root}/tested-yohaku.html`, html);
const baseline = JSON.parse(
  await readFile(
    resolve("tests/fixtures/production-baseline-expectations.json"),
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
    .update(JSON.stringify(sort(value)) ?? "undefined")
    .digest("hex");
const withoutProduction = (world) => {
  const { foodProduction: _production, ...rest } = world;
  return rest;
};
const URL = "http://yohaku-production.local/";
const settings = [],
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
  const input = baseline.inputs.find((row) => row.path === fixturePath);
  assert.ok(input);
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
  await page.locator("input[type=file]").setInputFiles({
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
  page.locator(".detail-card").filter({
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
const production = () => page.locator(".food-production-panel");
async function openProduction() {
  await nav("拠点");
  const before = await state();
  if (!(await production().evaluate((el) => el.open)))
    await production().locator(":scope > summary").click();
  assert.deepEqual(await state(), before);
}
async function setTarget(target, label) {
  await openProduction();
  const before = await state(),
    chosen = await selected(),
    focus = await focused();
  await production()
    .locator('input[name="food-production-target"]')
    .fill(String(target));
  assert.deepEqual(await state(), before, "補充目安の入力は下書きだけ");
  await production()
    .getByRole("button", { name: "補充目安を保存", exact: true })
    .click();
  const after = await state();
  assert.equal(after.foodProduction?.target ?? 6, target);
  assert.deepEqual(
    withoutProduction(after),
    withoutProduction(before),
    "補充設定は時計・仕事・予約・乱数・ID・記録を変えない",
  );
  assert.deepEqual(await selected(), chosen);
  assert.equal(await focused(), focus);
  if ((before.foodProduction?.target ?? 6) === target)
    assert.deepEqual(after, before, "同じ目安の保存は全状態不変");
  settings.push({
    scenario,
    label,
    target,
    minutes: after.minutes,
    beforeTarget: before.foodProduction?.target ?? 6,
    beforeHash: hash(before),
    afterHash: hash(after),
    sameOutsideMetadata: true,
  });
  return after;
}
async function counts(id, food) {
  await openProduction();
  const details = production().locator(".food-production-counts");
  const before = await state();
  if (!(await details.evaluate((el) => el.open)))
    await details.locator(":scope > summary").click();
  await expect(details.locator(`li[data-resident-id="${id}"]`)).toContainText(
    `今使える食事 ${food}食`,
  );
  assert.deepEqual(await state(), before);
}
async function meal(ids, label) {
  await select(ids);
  await nav("いまの暮らし");
  const before = await state();
  const s = await op(label, () =>
    actions()
      .getByRole("button", { name: /^(食事をとる|一緒に食事|それぞれ食事)/ })
      .click(),
  );
  assert.equal(s.minutes, before.minutes);
  return s;
}
async function directCook(label) {
  await select(["mio"]);
  await nav("いまの暮らし");
  const before = await state();
  const s = await op(label, () =>
    actions()
      .getByRole("button", { name: "食事をつくる", exact: false })
      .click(),
  );
  assert.equal(s.minutes, before.minutes);
  assert.equal(person(s, "mio").action.automatic, false);
  assert.deepEqual(person(s, "mio").action.reserved, { ingredients: 2 });
  assert.equal(person(s, "mio").action.reservationSource, "base");
  return person(s, "mio").action.id;
}
function check(text) {
  checks.push(text);
  console.log("✓ " + text);
}
let summary = {};
try {
  const first = await imported(
    "target-twelve-autonomous",
    "tests/fixtures/production-six-meals-idle-v3.json",
  );
  assert.equal((await state()).minutes, 553);
  assert.equal((await state()).foodProduction, undefined);
  assert.ok((await state()).residents.every((r) => !r.action && !r.suspended));
  let s = await setTarget(12, "待機中に6から12へ補充目安を変更");
  assert.ok(s.residents.every((r) => !r.action));
  await setTarget(12, "同じ12食の設定を再保存");
  await saveReload("genuine-target-twelve-before-production");
  await openProduction();
  const beforeDraft = await state();
  await production().locator('input[name="food-production-target"]').fill("15");
  assert.deepEqual(await state(), beforeDraft);
  s = await op("目安12のまま5分進めて自主調理を始める", () =>
    page.getByRole("button", { name: "5分", exact: true }).click(),
  );
  await expect(
    production().locator('input[name="food-production-target"]'),
  ).toHaveValue("15");
  assert.equal(s.foodProduction.target, 12);
  await expect(production().locator(":scope > summary")).toContainText("12食");
  await production().locator('input[name="food-production-target"]').fill("12");
  assert.deepEqual(await state(), s);
  const firstCook = person(s, "mio").action.id;
  assert.equal(person(s, "mio").action.kind, "cook");
  assert.equal(person(s, "mio").action.automatic, true);
  assert.equal(person(s, "mio").action.progress, 5);
  assert.deepEqual(person(s, "mio").action.reserved, { ingredients: 2 });
  assert.equal(person(s, "mio").action.reservationSource, "base");
  assert.equal(s.resources.food, 6);
  await capture(
    "target-twelve-started-with-reserved-ingredients",
    ".food-production-panel",
  );
  await select(["mio"]);
  await nav("いまの暮らし");
  s = await op("5分の自主調理を食材予約ごと中断", () =>
    page
      .locator(".running-work")
      .getByRole("button", { name: "中断", exact: true })
      .click(),
  );
  assert.equal(person(s, "mio").suspended.id, firstCook);
  assert.equal(person(s, "mio").suspended.automatic, true);
  assert.equal(person(s, "mio").suspended.progress, 5);
  await capture("automatic-cook-held-at-five-minutes", ".workboard");
  await saveReload("genuine-target-twelve-held-cooking");
  await select(["mio"]);
  await nav("いまの暮らし");
  s = await op("同じ自主調理を保存した5分から再開", () =>
    page
      .locator(".suspended-work")
      .getByRole("button", { name: "再開する", exact: true })
      .click(),
  );
  assert.equal(person(s, "mio").action.id, firstCook);
  assert.equal(person(s, "mio").action.automatic, true);
  s = await until(
    "補充目安12へ二回の自主調理を実際に進める",
    (x) => x.resources.food >= 12 && !person(x, "mio").action,
  );
  assert.equal(s.resources.food, 12);
  const cooks = s.logs.filter(
    (log) => log.title === "温かい食事ができた" && log.time > 553,
  );
  assert.equal(cooks.length, 2);
  assert.ok(
    cooks.every(
      (log) => JSON.stringify(log.actors) === JSON.stringify(["mio"]),
    ),
  );
  const compared = withoutProduction(s),
    prior = baseline.manualComparison;
  comparisons.push({
    scenario,
    minutes: s.minutes,
    manualMinutes: prior.minutes,
    manualExtraCookOrders: prior.manualExtraCookOrders,
    autonomousExtraCookOrders: 0,
    sameWorld: hash(compared) === prior.worldSha256,
    differentTopLevelKeys: [
      ...new Set([
        ...Object.keys(prior.topLevelHashes),
        ...Object.keys(compared),
      ]),
    ].filter((key) => hash(compared[key]) !== prior.topLevelHashes[key]),
    currentWorldSha256: hash(compared),
    manualWorldSha256: prior.worldSha256,
  });
  summary.twelveAtCompletion = s;
  await saveReload("genuine-twelve-meals-replenished-autonomously");
  s = await op("12食に達してからさらに5分任せる", () =>
    page.getByRole("button", { name: "5分", exact: true }).click(),
  );
  assert.equal(s.resources.food, 12);
  assert.equal(person(s, "mio").action, null);
  assert.equal(
    s.logs.filter((log) => log.title === "温かい食事ができた" && log.time > 553)
      .length,
    2,
  );
  await counts("mio", 12);
  await capture(
    "target-twelve-stopped-after-completion",
    ".food-production-panel",
  );
  summary.twelveStopped = s;
  check(
    "真正の6食待機から設定1回で自動2調理し、途中5分の予約・同ID・保存を保ち、12食で新規補充を止める",
  );
  await first.close();

  const second = await imported(
    "target-three-reservation",
    "tests/fixtures/production-three-meals-in-progress-v3.json",
  );
  await setTarget(3, "食事途中に補充目安3を保存");
  s = await until(
    "三人の食事を終え3食にする",
    (x) =>
      x.resources.food === 3 &&
      x.residents.every((r) => r.action?.kind !== "eat"),
  );
  s = await op("3食では新規自主調理せず5分待つ", () =>
    page.getByRole("button", { name: "5分", exact: true }).click(),
  );
  assert.equal(person(s, "mio").action, null);
  assert.equal(s.resources.food, 3);
  assert.equal(freeBase(s).food, 3);
  s = await meal(["aki"], "アキが1食だけ予約し未予約分を2食にする");
  const akiMeal = person(s, "aki").action.id;
  assert.equal(s.resources.food, 3);
  assert.equal(freeBase(s).food, 2);
  assert.equal(person(s, "mio").action, null);
  await counts("mio", 2);
  await capture(
    "target-three-counts-food-reservation",
    ".food-production-counts",
  );
  s = await op("予約後の5分でミオが一回の補充を始める", () =>
    page.getByRole("button", { name: "5分", exact: true }).click(),
  );
  const batch = person(s, "mio").action.id;
  assert.equal(person(s, "mio").action.automatic, true);
  assert.equal(person(s, "mio").action.kind, "cook");
  assert.equal(person(s, "mio").action.progress, 5);
  assert.equal(person(s, "aki").action.id, akiMeal);
  s = await until(
    "予約した食事と一回の補充が実際に完了",
    (x) =>
      person(x, "mio").action?.id !== batch &&
      person(x, "aki").action?.id !== akiMeal,
  );
  assert.equal(s.resources.food, 5);
  s = await op("目安を超えた5食でさらに5分待つ", () =>
    page.getByRole("button", { name: "5分", exact: true }).click(),
  );
  assert.equal(person(s, "mio").action, null);
  assert.equal(s.resources.food, 5);
  await counts("mio", 5);
  await capture("one-batch-can-exceed-target-three", ".food-production-panel");
  await saveReload("genuine-target-three-five-meal-result");
  summary.three = s;
  check(
    "目安3では未予約3食で待機し、アキの予約で2食になると一回だけ補充、3食単位のため5食で止まる",
  );
  await second.close();

  const third = await imported(
    "target-zero-and-manual-preservation",
    "tests/fixtures/production-three-meals-in-progress-v3.json",
  );
  await setTarget(0, "三人の食事途中に新規自主調理を休止");
  await saveReload("genuine-target-zero-with-active-meals");
  s = await until(
    "予約済みの三人の食事は休止設定でも完了する",
    (x) =>
      x.resources.food === 3 &&
      x.residents.every((r) => r.action?.kind !== "eat"),
  );
  s = await op("3食でも目安0なら新規自主調理せず5分待つ", () =>
    page.getByRole("button", { name: "5分", exact: true }).click(),
  );
  assert.equal(s.resources.food, 3);
  assert.equal(person(s, "mio").action, null);
  await counts("mio", 3);
  await capture(
    "zero-stops-only-new-automatic-cooking",
    ".food-production-panel",
  );
  const manual = await directCook("目安0でもミオへの直接調理を予約");
  s = await op("直接の調理は5分進む", () =>
    page.getByRole("button", { name: "5分", exact: true }).click(),
  );
  assert.equal(person(s, "mio").action.id, manual);
  assert.equal(person(s, "mio").action.progress, 5);
  await setTarget(12, "実行中の調理を保って目安12へ変更");
  await setTarget(0, "実行中の調理を保って目安0へ戻す");
  await select(["mio"]);
  await nav("いまの暮らし");
  s = await op("直接調理を5分と食材2予約で保持", () =>
    page
      .locator(".running-work")
      .getByRole("button", { name: "中断", exact: true })
      .click(),
  );
  assert.equal(person(s, "mio").suspended.id, manual);
  await setTarget(3, "中断中の調理を保って目安3へ変更");
  await setTarget(0, "中断中の調理を保って目安0へ戻す");
  await select(["mio"]);
  await nav("いまの暮らし");
  await capture("zero-retains-held-manual-cook", ".workboard");
  await saveReload("genuine-target-zero-held-manual-cooking");
  s = await op("中断中は時間を進めても5分の仕事を勝手に再開しない", () =>
    page.getByRole("button", { name: "5分", exact: true }).click(),
  );
  assert.equal(person(s, "mio").suspended.id, manual);
  assert.equal(person(s, "mio").suspended.progress, 5);
  assert.equal(person(s, "mio").action, null);
  await select(["mio"]);
  await nav("いまの暮らし");
  s = await op("目安0のまま直接の中断料理を再開", () =>
    page
      .locator(".suspended-work")
      .getByRole("button", { name: "再開する", exact: true })
      .click(),
  );
  assert.equal(person(s, "mio").action.id, manual);
  s = await until(
    "休止設定でも直接料理は一度だけ完成する",
    (x) => person(x, "mio").action?.id !== manual,
  );
  assert.equal(s.resources.food, 6);
  s = await op("直接調理の完成後も新規自主調理は始まらない", () =>
    page.getByRole("button", { name: "5分", exact: true }).click(),
  );
  assert.equal(s.resources.food, 6);
  assert.equal(person(s, "mio").action, null);
  assert.equal(s.foodProduction.target, 0);
  await saveReload("genuine-target-zero-manual-cooking-complete");
  summary.zero = s;
  check(
    "0は新しい自主調理だけを止め、予約済み食事・直接調理・current/held・材料予約・保存を変えない",
  );
  await third.close();
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
          "Three normal UI branches from genuine baseline exports. Actual controls create preferences and progress jobs; state reads assert. No engine API, field edits or storage writes. Automatic/manual world differences are measured, not forced to match.",
        fixtures,
        checks,
        settings,
        comparisons,
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
      settings: settings.length,
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
        status: "failed",
        sha256,
        error: String(error),
        stack: error.stack,
        scenario,
        fixtures,
        checks,
        settings,
        comparisons,
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
