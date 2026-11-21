/** Actual standalone currency play and controlled-boundary verification.
 * Genuine UI exports and public-command setup fixtures stay separate from the
 * explicitly forged invalid imports. No browser command/API or storage writes.
 */
import assert from "node:assert/strict";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { resolve } from "node:path";
import { createHash } from "node:crypto";
import { chromium, expect } from "@playwright/test";

const digest = (x) => createHash("sha256").update(x).digest("hex");
const sorted = (x) =>
  Array.isArray(x)
    ? x.map(sorted)
    : x && typeof x === "object"
      ? Object.fromEntries(
          Object.keys(x)
            .sort()
            .map((k) => [k, sorted(x[k])]),
        )
      : x;
const worldHash = (s) => digest(JSON.stringify(sorted(s)));
const choices = ["sell-scrap", "buy-food", "buy-medicine"];
const coinRows = (s) =>
  (s.region?.receipts ?? []).filter((r) => choices.includes(r.choice));
const wallet = (s, id = "aki") =>
  coinRows(s)
    .filter((r) => r.actorId === id)
    .reduce((n, r) => n + r.coinsReceived - r.coinsPaid, 0);
const cash = (s) =>
  6 +
  coinRows(s)
    .filter((r) => Math.floor(r.time / 1440) === Math.floor(s.minutes / 1440))
    .reduce((n, r) => n + r.coinsPaid - r.coinsReceived, 0);
const shopStock = (s) =>
  s.region?.stockDay === Math.floor(s.minutes / 1440) + 1
    ? { ...s.region.stock }
    : { food: 6, medicine: 3 };
const physical = (s) => {
  const x = structuredClone(s);
  delete x.nextId;
  delete x.logs;
  delete x.region.receipts;
  return x;
};
const person = (s, id = "aki") => s.residents.find((r) => r.id === id);
const same = (a, b, label) => assert.deepEqual(a, b, label);
const definitions = {
  medicine: {
    file: "currency-genuine-day-one-medicine-ready-v3.json",
    sha: "e5762bb33991ab7c282e0aa81c73e9d73b1325bb65a441ddb41dc670904d9ab4",
    method: "Genuine old43 actual UI export, copied byte-for-byte.",
  },
  food: {
    file: "currency-genuine-day-two-food-ready-v3.json",
    sha: "2e4f8affe3a1a46b2b19e31acff4edb6dc4176e53fb6eb791b9c1eae154c8015",
    method: "Genuine old43 actual UI export, copied byte-for-byte.",
  },
  dayTwo: {
    file: "currency-genuine-day-two-one-scrap-v3.json",
    sha: "c1efc1168de4ef59d2025f47d7b1831d391f5cf14525e1c2c5e7412e31ae4c0c",
    method: "Genuine old43 actual UI export, copied byte-for-byte.",
  },
  budget: {
    file: "currency-controlled-village-budget-stock-v3.json",
    sha: "7891adb80614fc881cc0743849c43690710adcfe7827b636769e04da6eb0a1f4",
    method:
      "Controlled setup from createGame through valid public commands and positive advance only. Aki owns5 scrap after safe meadow harvest; same-place Mio owns0.",
  },
  peer: {
    file: "currency-controlled-village-peer-source-v3.json",
    sha: "a85cb49926c5339a11d808944358ac0162b9acf48cf9599cf9123607d3585f35",
    method:
      "Controlled setup through valid public commands and positive advance only. Aki0/Mio1/remote warehouse3 scrap.",
  },
};
const legacy = JSON.parse(
  await readFile(
    resolve("tests/fixtures/currency-legacy-comparisons.json"),
    "utf8",
  ),
);
const htmlPath = resolve(process.env.CURRENCY_HTML || "dist/yohaku-v53.html");
const html = await readFile(htmlPath, "utf8"),
  sha256 = digest(html);
if (process.env.EXPECTED_HTML_SHA)
  assert.equal(sha256, process.env.EXPECTED_HTML_SHA);
const output =
  process.env.PLAYTEST_OUTPUT ||
  `/workspace/research/stage4e-currency/playtest/${sha256.slice(0, 12)}`;
await mkdir(output, { recursive: true });
await writeFile(`${output}/tested-yohaku.html`, html);
await writeFile(
  `${output}/tested-runner.mjs`,
  await readFile(new URL(import.meta.url), "utf8"),
);
const browser = await chromium.launch({
  executablePath: process.env.CHROMIUM_PATH || "/usr/bin/chromium",
  headless: true,
  args: ["--no-sandbox"],
});
const ENTRY = "http://yohaku-currency.local/",
  names = { aki: "アキ", mio: "ミオ", ren: "レン" };
const operations = [],
  selections = [],
  navigations = [],
  inputs = [],
  checkpoints = [],
  captures = [],
  audits = [],
  errors = [],
  requests = [],
  checks = [],
  comparisons = [],
  invalidInputs = [];
let page, scenario;
const state = () =>
  page.evaluate(() =>
    JSON.parse(
      localStorage.getItem("yohaku-autosave-v1") ||
        localStorage.getItem("yohaku-save-v1"),
    ),
  );
const card = (id) =>
  page.locator(`.residents-list .resident-card[aria-label^="${names[id]}を"]`);
const coinButton = (choice) =>
  page.locator(`.region-currency [data-coin-choice="${choice}"] button`);
const region = () => page.locator(".region-panel");
async function settle() {
  await page.waitForTimeout(70);
}
async function dismiss() {
  const b = page.getByRole("button", { name: "通知を閉じる", exact: true });
  if (await b.isVisible()) await b.click();
}
async function select(ids, focus = ids.at(-1)) {
  await dismiss();
  const before = await state();
  for (const id of Object.keys(names))
    if (
      ((await card(id).getAttribute("aria-pressed")) === "true") !==
      ids.includes(id)
    )
      await card(id).click();
  if (focus && !(await card(focus).getAttribute("class")).includes("viewing")) {
    await card(focus).click();
    await card(focus).click();
  }
  for (const id of Object.keys(names))
    assert.equal(
      await card(id).getAttribute("aria-pressed"),
      String(ids.includes(id)),
    );
  same(await state(), before, "Selection/focus must not change the world");
  selections.push({ scenario, ids, focus, minutes: before.minutes });
}
async function nav(name) {
  await dismiss();
  const before = await state();
  await page
    .getByRole("navigation")
    .getByRole("button", { name, exact: true })
    .click();
  same(await state(), before);
  navigations.push({ scenario, name, minutes: before.minutes });
}
async function op(label, fn) {
  await dismiss();
  const before = await state();
  await fn();
  await settle();
  const after = await state();
  assert(!after.ended);
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
async function importIntoPage(path, expected) {
  await page.locator(".save-button").click();
  await page.locator("input[type=file]").setInputFiles(path);
  await expect(page.getByRole("dialog")).not.toBeVisible();
  await expect
    .poll(async () => JSON.stringify(await state()))
    .toBe(JSON.stringify(expected));
}
async function opened(label, key) {
  scenario = label;
  const def = definitions[key],
    path = resolve("tests/fixtures", def.file),
    raw = await readFile(path, "utf8");
  assert.equal(digest(raw), def.sha);
  const initial = JSON.parse(raw);
  const context = await browser.newContext({
    viewport: { width: 390, height: 844 },
    offline: true,
    acceptDownloads: true,
  });
  await context.route("**/*", (route) => {
    const url = route.request().url();
    requests.push({ scenario: label, url });
    return url === ENTRY
      ? route.fulfill({ contentType: "text/html", body: html })
      : route.abort();
  });
  page = await context.newPage();
  page.setDefaultTimeout(15000);
  page.on("pageerror", (e) =>
    errors.push({ scenario: label, type: "pageerror", message: e.message }),
  );
  page.on("console", (m) => {
    if (m.type() === "error")
      errors.push({ scenario: label, type: "console", message: m.text() });
  });
  await page.goto(ENTRY);
  await importIntoPage(path, initial);
  inputs.push({
    scenario: label,
    key,
    path,
    sha256: def.sha,
    minutes: initial.minutes,
    method: def.method,
    directFieldEdits: [],
  });
  await select(["aki"]);
  await nav("周辺を探索");
  return { context, initial };
}
async function currency() {
  const d = page.locator("details.region-currency");
  await expect(d).toHaveCount(1);
  const before = await state();
  if (!(await d.evaluate((e) => e.open)))
    await d.locator(":scope>summary").click();
  same(await state(), before);
  return d;
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
  const raw = await readFile(await (await pending).path(), "utf8");
  same(JSON.parse(raw), before);
  const path = `${output}/${name}.json`;
  await writeFile(path, raw);
  await page.keyboard.press("Escape");
  await page.reload();
  await settle();
  same(await state(), before);
  checkpoints.push({
    scenario,
    name,
    path,
    sha256: digest(raw),
    minutes: before.minutes,
    wallets: Object.fromEntries(
      before.residents.map((r) => [r.id, wallet(before, r.id)]),
    ),
    cash: cash(before),
  });
  return before;
}
async function capture(
  name,
  selector,
  widths = [390, 1280],
  preserveToast = false,
) {
  const before = await state();
  for (const width of widths) {
    const height = { 320: 740, 390: 844, 430: 932, 1280: 800 }[width];
    await page.setViewportSize({ width, height });
    if (!preserveToast) await dismiss();
    await page
      .locator(selector)
      .evaluate((e) => e.scrollIntoView({ block: "start" }));
    const geometry = await page.evaluate(() => {
      const n = document.querySelector(".navigation nav"),
        m = document.querySelector("[role=dialog]");
      return {
        client: document.documentElement.clientWidth,
        scroll: document.documentElement.scrollWidth,
        navClient: n.clientHeight,
        navScroll: n.scrollHeight,
        modalClient: m?.clientWidth,
        modalScroll: m?.scrollWidth,
      };
    });
    assert(geometry.scroll <= geometry.client + 1);
    assert(geometry.navScroll <= geometry.navClient + 1);
    if (geometry.modalClient)
      assert(geometry.modalScroll <= geometry.modalClient + 1);
    const path = `${output}/${name}-${width}.png`;
    await page.screenshot({ path, fullPage: false });
    captures.push({ scenario, name, width, height, path });
    audits.push({ scenario, name, width, height, ...geometry });
  }
  await page.setViewportSize({ width: 390, height: 844 });
  same(await state(), before, "Resize/inspection must not change the world");
}
async function finish(id, job, label) {
  for (let i = 0; i < 60; i++) {
    const before = await state();
    if (person(before, id).action?.id !== job.id) return before;
    const after = await op(`${label}-${i + 1}`, () =>
      page.locator(".next-button").click(),
    );
    assert(after.minutes > before.minutes);
  }
  assert.fail("Job did not finish");
}
async function route(target) {
  await select(["aki"]);
  await nav("周辺を探索");
  const before = await state(),
    label = target === "home" ? "川沿いの道で拠点へ帰る" : "川沿いの道で集落へ";
  let s = await op(`ordinary-${target}-order`, () =>
    page
      .locator(".daytrip-routes")
      .getByRole("button", { name: label, exact: false })
      .click(),
  );
  assert.equal(s.minutes, before.minutes);
  const job = structuredClone(person(s).action);
  assert.equal(job.kind, "move");
  assert(!job.cargo);
  s = await finish("aki", job, `ordinary-${target}-progress`);
  assert.equal(person(s).location, target);
  return s;
}
async function travel(resource, amount) {
  const p = page.locator(".travel-panel");
  if (!(await p.evaluate((e) => e.open)))
    await p.locator(":scope>summary").click();
  await p.locator(".travel-inputs select").selectOption(resource);
  await p.locator(".travel-inputs input[type=number]").fill(String(amount));
  return p;
}
async function transfer(resource, amount, direction) {
  await nav("いまの暮らし");
  const before = await state(),
    p = await travel(resource, amount),
    name =
      direction === "out"
        ? "倉庫から持ち出す"
        : direction === "ground"
          ? "地面に置く"
          : direction === "pickup"
            ? "地面から拾う"
            : "倉庫へしまう";
  const after = await op(`${name}-${resource}-${amount}`, () =>
    p.getByRole("button", { name, exact: true }).click(),
  );
  assert.equal(after.minutes, before.minutes);
  return after;
}
async function coin(choice, id = "aki") {
  await currency();
  await expect(coinButton(choice)).toBeEnabled();
  const before = await state(),
    oldWallet = wallet(before, id),
    oldCash = cash(before),
    oldStock = shopStock(before);
  const after = await op(`coin-${choice}`, () => coinButton(choice).click());
  const receipt = after.region.receipts.at(-1),
    entry = after.logs.at(-1),
    paid = choice === "buy-food" ? 4 : choice === "buy-medicine" ? 2 : 0,
    received = choice === "sell-scrap" ? 2 : 0;
  assert.equal(after.minutes, before.minutes);
  assert.equal(after.seed, before.seed);
  same(
    after.residents,
    before.residents,
    "Cash trade cannot complete care, move people, or alter their jobs",
  );
  same(after.life, before.life);
  same(after.resources, before.resources);
  same(after.logs.slice(0, -1), before.logs);
  same(after.region.receipts.slice(0, -1), before.region.receipts);
  assert.equal(after.nextId, before.nextId + 1);
  assert.equal(after.logs.length, before.logs.length + 1);
  assert.equal(receipt.logId, before.nextId);
  assert.equal(entry.id, receipt.logId);
  assert.equal(entry.type, "social");
  assert.equal(entry.time, after.minutes);
  assert(entry.actors.includes(id) && entry.actors.includes("village-trader"));
  assert(
    entry.witnesses.includes(id) && entry.witnesses.includes("village-trader"),
  );
  same(entry.coinTrade, { choice, termsId: "village-coins-v1" });
  assert.equal(receipt.actorId, id);
  assert.equal(receipt.npcId, "village-trader");
  assert.equal(receipt.termsId, "village-coins-v1");
  assert.equal(receipt.coinsPaid, paid);
  assert.equal(receipt.coinsReceived, received);
  assert.equal(wallet(after, id), oldWallet + received - paid);
  assert.equal(cash(after), oldCash + paid - received);
  const expectedStock = { ...oldStock };
  if (choice === "buy-food") expectedStock.food -= 3;
  if (choice === "buy-medicine") expectedStock.medicine -= 1;
  same(shopStock(after), expectedStock);
  for (const other of before.residents.filter((r) => r.id !== id))
    assert.equal(wallet(after, other.id), wallet(before, other.id));
  const expectedPack = { ...before.inventory.packs[id] };
  if (choice === "sell-scrap") expectedPack.scrap -= 1;
  if (choice === "buy-food") expectedPack.food += 3;
  if (choice === "buy-medicine") expectedPack.medicine += 1;
  same(after.inventory.packs[id], expectedPack);
  for (const key of Object.keys(before.inventory.packs).filter((k) => k !== id))
    same(after.inventory.packs[key], before.inventory.packs[key]);
  same(after.inventory.ground, before.inventory.ground);
  return after;
}
async function disabled(choice, reason) {
  const before = await state();
  await currency();
  await expect(coinButton(choice)).toBeDisabled();
  const row = page.locator(`[data-coin-choice="${choice}"]`);
  if (reason) await expect(row).toContainText(reason);
  same(await state(), before);
  checks.push({
    scenario,
    kind: "disabled-read-only",
    choice,
    text: await row.innerText(),
    minutes: before.minutes,
    worldSha256: worldHash(before),
  });
}
async function history(scope) {
  const h = page.locator(
      `details.trade-history[data-trade-history="${scope}"]`,
    ),
    before = await state();
  if (!(await h.evaluate((e) => e.open)))
    await h.locator(":scope>summary").click();
  same(await state(), before);
  return h;
}
function compareBarter(key, initial, after) {
  const o = legacy.oracles[key],
    count = key === "medicine" ? 2 : 3,
    delta = count - 1;
  assert.equal(
    worldHash(physical(after)),
    o.physicalWorldSha256,
    `Physical world differs from genuine old ${key} barter`,
  );
  same(after.logs.slice(0, initial.logs.length), initial.logs);
  same(
    after.region.receipts.slice(0, initial.region.receipts.length),
    initial.region.receipts,
  );
  assert.equal(after.nextId, o.nextId + delta);
  assert.equal(after.logs.length, o.logCount + delta);
  assert.equal(after.region.receipts.length, o.regionReceiptCount + delta);
  assert.equal(wallet(after), 0);
  comparisons.push({
    kind: "immediate-equivalent-to-genuine-barter",
    key,
    physicalWorldSha256: o.physicalWorldSha256,
    oldOperations: 1,
    newOperations: count,
    extraLogs: delta,
    extraNextId: delta,
    extraReceipts: delta,
    minutes: after.minutes,
    oldSource: o.source,
    oldSourceSha256: o.sourceSha256,
  });
}
async function invalidImport(
  name,
  mutate,
  { base, captureImage = false } = {},
) {
  const before = await state(),
    bad = structuredClone(base || before),
    description = mutate(bad);
  const path = `${output}/invalid-${name}.json`;
  await writeFile(path, JSON.stringify(bad, null, 2));
  await page.locator(".save-button").click();
  await page.locator("input[type=file]").setInputFiles(path);
  await expect(page.getByRole("dialog")).toBeVisible();
  await expect(page.locator(".toast")).toContainText("保存データの内容が不正");
  same(
    await state(),
    before,
    "Invalid import must preserve the entire original world",
  );
  const toast = await page.locator(".toast").innerText();
  if (captureImage)
    await capture(`rejected-${name}`, "[role=dialog]", [390], true);
  invalidInputs.push({
    scenario,
    name,
    path,
    sha256: digest(await readFile(path)),
    directInvalidEdits: description,
    toast,
    originalWorldSha256: worldHash(before),
    wholeWorldPreserved: true,
  });
  await page.keyboard.press("Escape");
  await dismiss();
}
let passed = false;
const final = {};
try {
  // Immediate exchange is economically equivalent, with explicitly more actions.
  let { context, initial } = await opened("immediate-medicine", "medicine");
  await currency();
  let s = await coin("sell-scrap");
  await disabled("buy-food", /銀貨が足りません/);
  s = await coin("buy-medicine");
  compareBarter("medicine", initial, s);
  assert.equal(
    digest(await readFile(resolve("tests/fixtures", definitions.dayTwo.file))),
    definitions.dayTwo.sha,
  );
  const successText = await region().locator(".travel-feedback").innerText();
  assert(successText.length > 0);
  const resetPath = resolve("tests/fixtures", definitions.dayTwo.file),
    reset = JSON.parse(await readFile(resetPath, "utf8"));
  await importIntoPage(resetPath, reset);
  await expect(region().locator(".travel-feedback")).toHaveCount(0);
  assert.equal(
    await page.locator(".region-currency").evaluate((e) => e.open),
    false,
  );
  await currency();
  await expect(page.locator(".region-wallet")).toContainText(/0枚/);
  await disabled("buy-food", /銀貨が足りません/);
  checks.push({
    scenario,
    kind: "same-resident-different-save-clears-feedback-and-refreshes-wallet",
    oldFeedback: successText,
    newMinutes: reset.minutes,
    worldPreservedOnLoad: true,
  });
  inputs.push({
    scenario,
    key: "dayTwo-replacement",
    path: resetPath,
    sha256: definitions.dayTwo.sha,
    minutes: reset.minutes,
    method: definitions.dayTwo.method,
    directFieldEdits: [],
  });

  await context.close();
  ({ context, initial } = await opened("immediate-food", "food"));
  await coin("sell-scrap");
  await coin("sell-scrap");
  s = await coin("buy-food");
  compareBarter("food", initial, s);
  await history("village");
  await capture(
    "immediate-food-saved-currency-history",
    '[data-trade-history="village"]',
    [390, 1280],
  );
  await saveReload("genuine-currency-immediate-food");
  await context.close();

  // A real player retains money through travel, dinner, sleep, and a later shop.
  ({ context, initial } = await opened(
    "ordinary-money-carry-and-later-food",
    "medicine",
  ));
  await currency();
  await nav("いまの暮らし");
  let p = await travel("scrap", 1);
  s = await op("reserve-own-scrap-cargo", () =>
    p.locator("[data-cargo-return]").click(),
  );
  assert.equal(person(s).action.reserved.scrap, 1);
  await nav("周辺を探索");
  await disabled("sell-scrap", /移動・救助・交戦/);
  await nav("いまの暮らし");
  s = await op("pause-cargo-hold-lock", () =>
    page
      .locator(".running-work")
      .getByRole("button", { name: "中断", exact: true })
      .click(),
  );
  assert.equal(person(s).suspended.reserved.scrap, 1);
  await nav("周辺を探索");
  await disabled("sell-scrap", /移動・救助・交戦/);
  await capture(
    "held-cargo-reservation-cannot-be-sold",
    ".region-currency",
    [390],
  );
  await nav("いまの暮らし");
  s = await op("cancel-only-cargo-unlocks-pack", () =>
    page
      .locator(".suspended-work")
      .getByRole("button", { name: "取消", exact: true })
      .click(),
  );
  assert.equal(s.inventory.packs.aki.scrap, 1);
  await nav("周辺を探索");
  s = await coin("sell-scrap");
  assert.equal(wallet(s), 2);
  assert.equal(cash(s), 4);
  await capture(
    "first-sale-personal-wallet-and-shop-cash",
    ".region-currency",
    [320, 390, 430, 1280],
  );
  s = await route("home");
  assert.equal(wallet(s), 2);
  await nav("いまの暮らし");
  p = await travel("scrap", 1);
  await expect(p.locator(".pack-coins")).toContainText(/2枚/);
  await expect(p.locator(".pack-coins")).toContainText(/0\.02/);
  same(
    await p
      .locator(".travel-inputs select option")
      .evaluateAll((es) => es.map((e) => e.value)),
    ["food", "ingredients", "medicine", "scrap"],
  );
  await capture(
    "money-carried-home-personal-weight",
    ".travel-panel",
    [390, 1280],
  );
  await saveReload("genuine-coins-two-carried-home");
  await select(["aki"]);
  await nav("拠点");
  await history("all");
  await expect(page.locator('[data-trade-history="all"]')).toContainText(
    "銀貨2枚",
  );
  await nav("いまの暮らし");
  await page.locator(".home-overview .trade-link").click();
  await history("merchant");
  await expect(
    page.locator(
      '[data-trade-history="merchant"] .trade-history-content>ul>li',
    ),
  ).toHaveCount(0);
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "閉じる", exact: true })
    .click();
  s = await op("ordinary-evening-shortcut", () =>
    page.locator(".night-button").click(),
  );
  assert.equal(s.minutes, 1080);
  s = await op("ordinary-dinner-order", () =>
    page
      .locator(".action-grid")
      .getByRole("button", { name: "食事をとる", exact: false })
      .click(),
  );
  const dinner = structuredClone(person(s).action);
  s = await finish("aki", dinner, "ordinary-dinner-progress");
  assert.equal(s.minutes, 1095);
  s = await op("ordinary-sleep-next-morning", () =>
    page.locator(".night-button").click(),
  );
  assert.equal(s.minutes, 1920);
  assert.equal(wallet(s), 2);
  assert.equal(cash(s), 6);
  await saveReload("genuine-coins-two-next-morning");
  await select(["aki"]);
  s = await transfer("scrap", 1, "out");
  assert.equal(s.inventory.packs.aki.scrap, 1);
  s = await route("village");
  assert.equal(wallet(s), 2);
  assert.equal(cash(s), 6);
  s = await coin("sell-scrap");
  assert.equal(wallet(s), 4);
  s = await coin("buy-food");
  assert.equal(wallet(s), 0);
  assert.equal(cash(s), 8);
  assert.equal(shopStock(s).food, 3);
  await history("village");
  await capture(
    "next-day-later-food-purchase-from-own-money",
    ".region-currency",
    [390, 1280],
  );
  await saveReload("genuine-carried-money-next-day-food-purchased");
  final.ordinary = s;
  checks.push({
    scenario,
    kind: "sell-carry-home-save-dinner-sleep-next-day-return-and-buy",
    walletDayOne: 2,
    walletMorning: 2,
    walletBeforePurchase: 4,
    walletAfterPurchase: 0,
    shopCashNextDay: 8,
    minutes: s.minutes,
  });
  await context.close();

  // Controlled but public-command prepared: cash budget, shared stock, peer wallet.
  ({ context, initial } = await opened(
    "controlled-budget-and-shared-stock",
    "budget",
  ));
  await currency();
  const trader = page.locator(".region-person").filter({
    has: page.getByRole("heading", { name: "集落の商い手", exact: true }),
  });
  s = await op("actual-trader-talk-before-coin-logs", () =>
    trader.getByRole("button", { name: "話を聞く", exact: true }).click(),
  );
  const talkLog = structuredClone(s.logs.at(-1));
  for (let i = 0; i < 3; i++) s = await coin("sell-scrap");
  assert.equal(wallet(s), 6);
  assert.equal(cash(s), 0);
  assert.equal(s.inventory.packs.aki.scrap, 2);
  await disabled("sell-scrap", /買取資金が足りません/);
  await capture(
    "shop-cash-empty-with-real-goods-and-personal-money",
    ".region-currency",
    [390, 1280],
  );
  const emptyCash = await saveReload(
    "controlled-three-legitimate-same-minute-sales",
  );
  await select(["mio"], "aki");
  await nav("周辺を探索");
  await currency();
  assert.equal(wallet(await state(), "mio"), 0);
  await disabled("buy-food", /銀貨が足りません/);
  await select([]);
  for (const c of choices) await disabled(c, /一人だけ/);
  await select(["aki", "mio"], "aki");
  for (const c of choices) await disabled(c, /一人だけ/);
  await select(["aki"]);
  s = await coin("buy-medicine");
  assert.equal(cash(s), 2);
  s = await coin("sell-scrap");
  assert.equal(cash(s), 0);
  assert.equal(s.inventory.packs.aki.scrap, 1);
  assert.equal(wallet(s), 6);
  const beforeBarter = await state();
  s = await op("barter-shares-medicine-stock-after-coin-purchase", () =>
    region()
      .getByRole("button", { name: "資材1を手当用品1と交換", exact: true })
      .click(),
  );
  assert.equal(shopStock(s).medicine, 1);
  assert.equal(wallet(s), 6);
  assert.equal(cash(s), 0);
  assert.equal(
    s.inventory.packs.aki.medicine,
    beforeBarter.inventory.packs.aki.medicine + 1,
  );
  s = await coin("buy-medicine");
  assert.equal(shopStock(s).medicine, 0);
  assert.equal(wallet(s), 4);
  await disabled("buy-medicine", /売り切れ/);
  s = await coin("buy-food");
  assert.equal(wallet(s), 0);
  assert.equal(cash(s), 6);
  await disabled("buy-food", /銀貨が足りません/);
  await history("village");
  await capture(
    "shared-stock-cash-and-wallet-have-separate-limits",
    ".region-currency",
    [390, 1280],
  );
  await saveReload("controlled-shop-budget-restored-and-shared-stock-spent");
  final.budget = s;
  await invalidImport(
    "duplicate-coin-receipt",
    (x) => {
      const row = structuredClone(coinRows(x).at(-1));
      x.region.receipts.push(row);
      return {
        field: "region.receipts append",
        change:
          "duplicate an already existing accepted coin receipt including logId",
      };
    },
    { captureImage: true },
  );
  await invalidImport("duplicate-coin-log-id", (x) => {
    const rows = coinRows(x);
    rows[1].logId = rows[0].logId;
    return {
      field: "second coin receipt logId",
      change: "reuse first accepted logId",
    };
  });
  await invalidImport("coin-wrong-amount", (x) => {
    coinRows(x)[0].coinsReceived = 3;
    return { field: "first coin receipt coinsReceived", before: 2, after: 3 };
  });
  await invalidImport("coin-wrong-terms", (x) => {
    coinRows(x)[0].termsId = "village-barter-v1";
    return {
      field: "first coin receipt termsId",
      before: "village-coins-v1",
      after: "village-barter-v1",
    };
  });
  await invalidImport(
    "coin-linked-to-talk-log",
    (x) => {
      coinRows(x)[0].logId = talkLog.id;
      return {
        field: "first coin receipt logId",
        after: talkLog.id,
        reason:
          "Same minute/actor/NPC/social talk log has no coinTrade marker; quantities and cash prefixes remain unchanged",
      };
    },
    { captureImage: true },
  );
  await invalidImport(
    "wallet-prefix-debt",
    (x) => {
      const first = coinRows(x)[0];
      Object.assign(first, {
        choice: "buy-medicine",
        paid: {},
        received: { medicine: 1 },
        coinsPaid: 2,
        coinsReceived: 0,
      });
      x.logs.find((l) => l.id === first.logId).coinTrade.choice =
        "buy-medicine";
      x.region.stock.medicine = 2;
      x.inventory.packs.aki.scrap += 1;
      x.inventory.packs.aki.medicine += 1;
      assert.equal(wallet(x), 2);
      return {
        fields: [
          "first coin receipt choice/paid/received/coin amounts",
          "matching log coinTrade.choice",
          "region.stock.medicine",
          "Aki pack scrap/medicine",
        ],
        reason:
          "Fixed-price rows and markers agree; final wallet2/cash4 are nonnegative but first wallet prefix is -2",
      };
    },
    { base: emptyCash },
  );
  await invalidImport(
    "shop-cash-prefix-debt",
    (x) => {
      const rows = coinRows(x),
        firstPurchase = rows.find((r) => r.choice === "buy-medicine"),
        fourthSale = rows.filter((r) => r.choice === "sell-scrap")[3],
        keys = ["choice", "paid", "received", "coinsPaid", "coinsReceived"],
        a = Object.fromEntries(
          keys.map((k) => [k, structuredClone(firstPurchase[k])]),
        ),
        b = Object.fromEntries(
          keys.map((k) => [k, structuredClone(fourthSale[k])]),
        );
      Object.assign(firstPurchase, b);
      Object.assign(fourthSale, a);
      x.logs.find((l) => l.id === firstPurchase.logId).coinTrade.choice =
        firstPurchase.choice;
      x.logs.find((l) => l.id === fourthSale.logId).coinTrade.choice =
        fourthSale.choice;
      assert.equal(wallet(x), 0);
      assert.equal(cash(x), 6);
      return {
        fields: [
          "first medicine purchase and fourth sale operation payloads only, retaining increasing logIds",
          "their two matching log coinTrade.choice markers",
        ],
        reason:
          "All times are the same, net resources/wallet/cash unchanged, but the fourth sale now occurs before the purchase returns funds, creating shop cash prefix -2",
      };
    },
    { captureImage: true },
  );
  await context.close();

  // Aki cannot sell the co-located peer's scrap, remote warehouse, or ground.
  ({ context, initial } = await opened(
    "controlled-only-own-unreserved-goods",
    "peer",
  ));
  await disabled("sell-scrap", /未予約の携行品が足りません/);
  await select(["mio"]);
  await transfer("scrap", 1, "ground");
  await select(["aki"]);
  await nav("周辺を探索");
  await disabled("sell-scrap", /未予約の携行品が足りません/);
  await capture(
    "peer-warehouse-and-ground-are-not-sale-sources",
    ".region-currency",
    [390],
  );
  await transfer("scrap", 1, "pickup");
  await nav("周辺を探索");
  s = await coin("sell-scrap");
  assert.equal(wallet(s, "aki"), 2);
  assert.equal(wallet(s, "mio"), 0);
  assert.equal(s.resources.scrap, 3);
  await saveReload("controlled-picked-up-own-goods-sold-for-personal-coins");
  final.peer = s;
  checks.push({
    scenario,
    kind: "only-own-stock-and-wallet-no-peer-warehouse-ground-use",
    akiCoins: 2,
    mioCoins: 0,
    remoteWarehouseScrap: 3,
  });
  await context.close();
  assert.deepEqual(errors, []);
  assert(requests.every((x) => x.url === ENTRY));
  assert.equal(digest(await readFile(htmlPath)), sha256);
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
        world:
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
        method:
          "Actual offline Chromium UI controls/import/save/export/reload. Genuine-input continuations and public-command-prepared controlled setups are labeled per input; valid direct state edits0, engine API commands in browser0, storage writes0. Explicit invalid import forgeries are separate.",
        inputs,
        operations,
        selections,
        navigations,
        checkpoints,
        captures,
        audits,
        errors,
        requests,
        checks,
        comparisons,
        invalidInputs,
        final,
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
    operations: operations.length,
    saves: checkpoints.length,
    captures: captures.length,
    checks: checks.length,
    invalidImports: invalidInputs.length,
  }),
);
