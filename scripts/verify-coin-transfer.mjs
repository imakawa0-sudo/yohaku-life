/** Actual standalone UI cash handoff: genuine continuing play, public-command
 * controlled inputs, and deliberately invalid imports are separate evidence. */
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
const coinChoices = ["sell-scrap", "buy-food", "buy-medicine"];
const coinRows = (s) =>
  (s.region?.receipts ?? []).filter((r) => coinChoices.includes(r.choice));
const transfers = (s) => s.currency?.transfers ?? [];
const wallet = (s, id) =>
  coinRows(s)
    .filter((r) => r.actorId === id)
    .reduce((n, r) => n + r.coinsReceived - r.coinsPaid, 0) +
  transfers(s).reduce(
    (n, t) => n + (t.to === id ? t.amount : 0) - (t.from === id ? t.amount : 0),
    0,
  );
const cash = (s) =>
  6 +
  coinRows(s)
    .filter((r) => Math.floor(r.time / 1440) === Math.floor(s.minutes / 1440))
    .reduce((n, r) => n + r.coinsPaid - r.coinsReceived, 0);
const person = (s, id) => s.residents.find((r) => r.id === id);
const same = (a, b, label) => assert.deepEqual(a, b, label);
function assertLedger(s) {
  const events = [
      ...coinRows(s).map((r) => ({ kind: "trade", ...r })),
      ...transfers(s).map((r) => ({ kind: "transfer", ...r })),
    ].sort((a, b) => a.logId - b.logId),
    money = new Map(s.residents.map((r) => [r.id, 0])),
    shop = new Map();
  let lastId = 0,
    lastTime = -1;
  for (const e of events) {
    assert(e.logId > lastId);
    assert(e.time >= lastTime);
    lastId = e.logId;
    lastTime = e.time;
    if (e.kind === "trade") {
      money.set(
        e.actorId,
        money.get(e.actorId) + e.coinsReceived - e.coinsPaid,
      );
      const day = Math.floor(e.time / 1440);
      shop.set(day, (shop.get(day) ?? 6) + e.coinsPaid - e.coinsReceived);
    } else {
      money.set(e.from, money.get(e.from) - e.amount);
      money.set(e.to, money.get(e.to) + e.amount);
    }
    for (const n of [...money.values(), ...shop.values()])
      assert(
        Number.isSafeInteger(n) && n >= 0,
        "All unified currency prefixes remain safe and nonnegative",
      );
  }
  for (const r of s.residents) assert.equal(money.get(r.id), wallet(s, r.id));
}
const definitions = JSON.parse(
  await readFile(resolve("tests/fixtures/coin-transfer-inputs.json"), "utf8"),
);
const old = JSON.parse(
  await readFile(
    resolve("tests/fixtures/coin-transfer-legacy-comparison.json"),
    "utf8",
  ),
);
const htmlPath = resolve(process.env.COIN_TRANSFER_HTML || "dist/yohaku-v53.html"),
  html = await readFile(htmlPath, "utf8"),
  sha256 = digest(html);
if (process.env.EXPECTED_HTML_SHA)
  assert.equal(sha256, process.env.EXPECTED_HTML_SHA);
const output =
  process.env.PLAYTEST_OUTPUT ||
  `/workspace/research/stage4f-handoff/playtest/${sha256.slice(0, 12)}`;
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
const ENTRY = "http://yohaku-coin-transfer.local/",
  names = {};
const operations = [],
  selections = [],
  navigations = [],
  controls = [],
  inputs = [],
  checkpoints = [],
  captures = [],
  audits = [],
  checks = [],
  comparisons = [],
  invalidInputs = [],
  errors = [],
  requests = [],
  final = {};
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
  same(await state(), before);
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
  assertLedger(after);
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
  Object.keys(names).forEach((k) => delete names[k]);
  for (const r of expected.residents) names[r.id] = r.name;
}
async function opened(label, key) {
  scenario = label;
  const d = definitions[key],
    path = resolve("tests/fixtures", d.file),
    raw = await readFile(path, "utf8");
  assert.equal(digest(raw), d.sha256);
  const initial = JSON.parse(raw);
  assertLedger(initial);
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
    sha256: d.sha256,
    minutes: initial.minutes,
    method: d.method,
    directValidFieldEdits: 0,
  });
  return { context, initial };
}
async function panel(actor, peer) {
  await select([actor]);
  await nav("いまの暮らし");
  const p = page.locator(".travel-panel");
  if (!(await p.evaluate((e) => e.open)))
    await p.locator(":scope>summary").click();
  if (peer) await p.locator(".travel-peer select").selectOption(peer);
  return p;
}
const cashInput = () =>
  page.locator(".coin-transfer-controls input[type=number]");
const cashButton = (kind) => page.locator(`[data-coin-transfer="${kind}"]`);
async function amount(value) {
  const before = await state();
  await cashInput().fill(String(value));
  same(await state(), before);
  controls.push({
    scenario,
    type: "coin-amount-draft",
    value: String(value),
    minutes: before.minutes,
  });
}
async function gift(kind, actor, peer, n) {
  await panel(actor, peer);
  await amount(n);
  await expect(cashButton(kind)).toBeEnabled();
  const before = await state(),
    from = kind === "give" ? actor : peer,
    to = kind === "give" ? peer : actor,
    oldRows = structuredClone(transfers(before)),
    total = before.residents.reduce((a, r) => a + wallet(before, r.id), 0);
  const after = await op(`coin-${kind}-${from}-to-${to}-${n}`, () =>
      cashButton(kind).click(),
    ),
    t = transfers(after).at(-1),
    l = after.logs.at(-1),
    location = person(before, actor).location;
  const strip = (x) => {
    const y = structuredClone(x);
    delete y.logs;
    delete y.nextId;
    delete y.currency;
    return y;
  };
  same(
    strip(after),
    strip(before),
    "Cash handoff changes no world field outside one transfer and work log",
  );
  same(after.logs.slice(0, -1), before.logs);
  same(transfers(after).slice(0, -1), oldRows);
  assert.equal(after.currency.version, 1);
  assert.equal(after.nextId, before.nextId + 1);
  assert.equal(l.id, before.nextId);
  same(t, {
    logId: l.id,
    time: before.minutes,
    location,
    actorId: actor,
    from,
    to,
    amount: n,
  });
  same(l.coinTransfer, { from, to, amount: n, location });
  assert.equal(l.type, "work");
  same(l.actors, [actor]);
  assert(!Object.hasOwn(l, "coinTrade"));
  assert.equal(wallet(after, from), wallet(before, from) - n);
  assert.equal(wallet(after, to), wallet(before, to) + n);
  assert.equal(
    after.residents.reduce((a, r) => a + wallet(after, r.id), 0),
    total,
  );
  assert.equal(cash(after), cash(before));
  for (const id of [from, to])
    if (
      person(before, id).hp <= 0 ||
      person(before, id).action?.kind === "sleep"
    )
      assert(!l.witnesses.includes(id));
  checks.push({
    scenario,
    kind: "atomic-transfer-one-work-log",
    actor,
    from,
    to,
    amount: n,
    minutes: after.minutes,
    logId: l.id,
  });
  return after;
}
async function saveReload(name, { expectedRawSha } = {}) {
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
  if (expectedRawSha) assert.equal(digest(raw), expectedRawSha);
  const path = `${output}/${name}.json`;
  await writeFile(path, raw);
  await page.keyboard.press("Escape");
  await page.reload();
  await settle();
  same(await state(), before);
  assertLedger(before);
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
    await page.evaluate(async () => {
      await document.fonts.ready;
      await new Promise((resolve) =>
        requestAnimationFrame(() => requestAnimationFrame(resolve)),
      );
    });
    await page.waitForTimeout(400);
    const g = await page.evaluate(() => {
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
    assert(g.scroll <= g.client + 1);
    assert(g.navScroll <= g.navClient + 1);
    if (g.modalClient) assert(g.modalScroll <= g.modalClient + 1);
    const path = `${output}/${name}-${width}.png`;
    await page.screenshot({ path, fullPage: false });
    captures.push({ scenario, name, width, height, path });
    audits.push({ scenario, name, width, height, ...g });
  }
  await page.setViewportSize({ width: 390, height: 844 });
  same(await state(), before);
}
async function transferHistory(count) {
  const h = page.locator(".coin-transfer-history"),
    before = await state();
  await expect(h).toHaveCount(1);
  await expect(h.locator(":scope>summary")).toContainText(
    `銀貨の受渡し（${count}件）`,
  );
  if (!(await h.evaluate((e) => e.open)))
    await h.locator(":scope>summary").click();
  await expect(h.locator(":scope>ul>li")).toHaveCount(Math.min(count, 10));
  same(await state(), before);
  checks.push({
    scenario,
    kind: "read-independent-transfer-history-no-world-change",
    count,
    text: await h.innerText(),
  });
  return h;
}
async function finish(actor, job, label) {
  for (let i = 0; i < 60; i++) {
    const before = await state();
    if (person(before, actor).action?.id !== job.id) return before;
    const after = await op(`${label}-${i + 1}`, () =>
      page.locator(".next-button").click(),
    );
    assert(after.minutes > before.minutes);
  }
  assert.fail("Job did not complete");
}
async function reserveRoute(actor, target) {
  await select([actor]);
  await nav("周辺を探索");
  const before = await state(),
    label = target === "home" ? "川沿いの道で拠点へ帰る" : "川沿いの道で集落へ";
  const s = await op(`${actor}-ordinary-${target}-order`, () =>
    page
      .locator(".daytrip-routes")
      .getByRole("button", { name: label, exact: false })
      .click(),
  );
  assert.equal(s.minutes, before.minutes);
  return structuredClone(person(s, actor).action);
}
async function route(actor, target) {
  const a = await reserveRoute(actor, target),
    s = await finish(actor, a, `${actor}-${target}-progress`);
  assert.equal(person(s, actor).location, target);
  return s;
}
async function invalidImport(
  name,
  mutate,
  { base, captureImage = false } = {},
) {
  const before = await state(),
    bad = structuredClone(base || before),
    edits = mutate(bad),
    path = `${output}/invalid-${name}.json`;
  await writeFile(path, JSON.stringify(bad, null, 2));
  await page.locator(".save-button").click();
  await page.locator("input[type=file]").setInputFiles(path);
  await expect(page.getByRole("dialog")).toBeVisible();
  await expect(page.locator(".toast")).toContainText("保存データの内容が不正");
  same(await state(), before);
  const toast = await page.locator(".toast").innerText();
  if (captureImage)
    await capture(`rejected-${name}`, "[role=dialog]", [390], true);
  invalidInputs.push({
    scenario,
    name,
    path,
    sha256: digest(await readFile(path)),
    directInvalidEdits: edits,
    toast,
    originalWorldSha256: worldHash(before),
    wholeWorldPreserved: true,
  });
  await page.keyboard.press("Escape");
  await dismiss();
}
let passed = false;
try {
  let { context, initial } = await opened(
    "genuine-recipient-handles-money-and-shopping",
    "common",
  );
  await panel("mio", "aki");
  await saveReload("genuine-unused-extension-read-no-backfill", {
    expectedRawSha: definitions.common.sha256,
  });
  await panel("mio", "aki");
  const initialJob = structuredClone(person(initial, "aki").action);
  for (const ids of [[], ["aki", "mio"]]) {
    await select(ids, "mio");
    const before = await state();
    await expect(cashButton("take")).toBeDisabled();
    await expect(cashButton("take")).toHaveAttribute("title", /一人だけ/);
    same(await state(), before);
    checks.push({ scenario, kind: "zero-multiple-selection-disabled", ids });
  }
  await panel("mio", "aki");
  for (const v of ["", 0, -1, 1.5, 9007199254740992, 3]) {
    await amount(v);
    await expect(cashButton("take")).toBeDisabled();
    checks.push({
      scenario,
      kind: "invalid-or-insufficient-amount-disabled",
      value: String(v),
      reason: await cashButton("take").getAttribute("title"),
    });
  }
  await amount(2);
  await expect(cashButton("take")).toHaveAttribute(
    "aria-label",
    "アキから銀貨2枚を受け取る",
  );
  await capture(
    "recipient-chooses-own-two-coin-receipt",
    ".coin-transfer-controls",
    [320, 390, 430, 1280],
  );
  let s = await gift("take", "mio", "aki", 2);
  same(person(s, "aki").action, initialJob);
  assert.equal(wallet(s, "aki"), 0);
  assert.equal(wallet(s, "mio"), 2);
  await saveReload("genuine-recipient-received-two-author-current-five");
  await panel("mio", "aki");
  await transferHistory(1);
  const move = await reserveRoute("mio", "village");
  same(person(await state(), "aki").action, initialJob);
  await panel("aki", "mio");
  await amount(1);
  await expect(cashButton("take")).toBeDisabled();
  await expect(cashButton("take")).toHaveAttribute("title", /移動や救助/);
  checks.push({ scenario, kind: "active-moving-endpoint-disabled" });
  await select(["mio"]);
  await nav("いまの暮らし");
  s = await op("shopping-and-author-work-common-five-minutes", () =>
    page.getByRole("button", { name: "5分", exact: true }).click(),
  );
  assert.equal(s.minutes, 1015);
  assert.equal(person(s, "aki").action.progress, 10);
  assert.equal(person(s, "mio").action.progress, 5);
  await saveReload("genuine-money-handoff-shopping-current-five");
  await select(["mio"]);
  s = await finish("mio", move, "mio-shopping-and-author-common-clock");
  assert.equal(s.minutes, 1061);
  assert.equal(s.life.crafts.find((c) => c.id === 64).createdAt, 1050);
  await select(["mio"]);
  await nav("周辺を探索");
  const c = page.locator(".region-currency");
  if (!(await c.evaluate((e) => e.open)))
    await c.locator(":scope>summary").click();
  const beforeBuy = await state();
  s = await op("recipient-buys-medicine-with-received-coins", () =>
    page.locator('[data-coin-choice="buy-medicine"] button').click(),
  );
  assert.equal(s.minutes, 1061);
  assert.equal(wallet(s, "mio"), 0);
  assert.equal(wallet(s, "aki"), 0);
  assert.equal(s.inventory.packs.mio.medicine, 1);
  same(s.residents, beforeBuy.residents);
  assert.equal(s.region.receipts.at(-1).actorId, "mio");
  await saveReload("genuine-recipient-valid-unified-ledger-purchase");
  await panel("mio");
  await expect(page.locator(".coin-transfer-controls")).toHaveCount(0);
  const h = await transferHistory(1);
  await expect(h).toContainText("共同の居間");
  await expect(h).toContainText("操作：ミオ");
  await capture(
    "spent-wallet-retains-past-home-handoff-at-village",
    ".coin-transfer-history",
    [390, 1280],
  );
  s = await route("mio", "home");
  assert.equal(s.minutes, 1112);
  let p = await panel("mio", "aki");
  await p.locator(".travel-inputs select").selectOption("medicine");
  await p.locator(".travel-inputs input[type=number]").fill("1");
  s = await op("recipient-stores-bought-medicine", () =>
    p.getByRole("button", { name: "倉庫へしまう", exact: true }).click(),
  );
  assert.equal(s.resources.medicine, 3);
  assert.equal(s.resources.scrap, 2);
  const projection = structuredClone(s);
  delete projection.logs;
  delete projection.currency;
  delete projection.region.receipts;
  projection.resources.scrap -= 1;
  assert.equal(worldHash(projection), old.projectedWorldSha256);
  assert.equal(s.nextId, old.nextId);
  assert.equal(s.logs.length, old.logCount);
  assert.equal(cash(s), old.shopCash + 2);
  comparisons.push({
    kind: "same-shopping-time-and-author-craft-as-old-material-branch",
    oldSource: old.source,
    oldSourceSha256: old.sourceSha256,
    projection: old.projection,
    projectedWorldSha256: old.projectedWorldSha256,
    minutes: s.minutes,
    authorCraftCompletedAt: 1050,
    newBaseScrap: 2,
    oldBaseScrap: 1,
    newAkiCoins: 0,
    oldAkiCoins: old.wallets.aki,
    newShopCash: cash(s),
    oldShopCash: old.shopCash,
    extraLogs: 0,
    extraNextId: 0,
    extraExternalReceipts: 0,
    newInternalTransfers: 1,
  });
  await saveReload("genuine-handoff-shopping-bird-and-stored-medicine");
  await panel("mio", "aki");
  await expect(page.locator(".coin-transfer-controls")).toHaveCount(0);
  await transferHistory(1);
  await capture(
    "zero-wallets-retain-separate-transfer-history",
    ".coin-transfer-history",
    [320, 390, 430, 1280],
  );
  await nav("拠点");
  const external = page.locator('[data-trade-history="all"]');
  await expect(external.locator(":scope>summary")).toContainText("5件");
  final.shopping = structuredClone(s);
  // A later day still reads the original location, even with both wallets zero.
  await select(["mio"]);
  await nav("いまの暮らし");
  s = await op("normal-sleep-to-next-morning-after-shopping", () =>
    page.locator(".night-button").click(),
  );
  assert.equal(s.minutes, 1920);
  assert.equal(wallet(s, "mio"), 0);
  assert.equal(wallet(s, "aki"), 0);
  await saveReload("genuine-next-day-zero-wallet-handoff-history");
  await panel("mio");
  await transferHistory(1);
  await expect(page.locator(".coin-transfer-controls")).toHaveCount(0);
  checks.push({
    scenario,
    kind: "later-day-history-persists-at-zero-wallet",
    minutes: s.minutes,
    storedLocation: transfers(s)[0].location,
  });
  final.laterDay = s;
  await context.close();

  // Direct giver, actor/peer draft reset, and same-ID replacement save.
  ({ context, initial } = await opened(
    "genuine-giver-draft-peer-and-stale",
    "common",
  ));
  p = await panel("mio", "aki");
  await p.locator(".travel-inputs select").selectOption("medicine");
  await p.locator(".travel-inputs input[type=number]").fill("3");
  await amount(2);
  await panel("aki", "mio");
  await expect(cashInput()).toHaveValue("1");
  await expect(p.locator(".travel-inputs select")).toHaveValue("medicine");
  await expect(p.locator(".travel-inputs input[type=number]")).toHaveValue("3");
  await select(["ren"]);
  await nav("拠点");
  s = await op("ren-returns-to-home-for-real-peer-switch", () =>
    page
      .locator(".room-grid .room-card")
      .filter({
        has: page.getByRole("heading", { name: "共同の居間", exact: true }),
      })
      .click(),
  );
  const renMove = structuredClone(person(s, "ren").action);
  s = await finish("ren", renMove, "ren-home-progress");
  assert.equal(s.minutes, 1010 + renMove.duration);
  p = await panel("mio", "aki");
  await p.locator(".travel-inputs select").selectOption("medicine");
  await p.locator(".travel-inputs input[type=number]").fill("3");
  await amount(2);
  const draftWorld = await state();
  await p.locator(".travel-peer select").selectOption("ren");
  await expect(page.locator(".coin-transfer-controls")).toHaveCount(0);
  await expect(p.locator(".travel-peer select")).toHaveValue("ren");
  await expect(
    p.locator('.travel-peer select option[value="aki"]'),
  ).toContainText("銀貨2枚");
  await p.locator(".travel-peer select").selectOption("aki");
  await expect(cashInput()).toHaveValue("1");
  await expect(p.locator(".travel-inputs select")).toHaveValue("medicine");
  await expect(p.locator(".travel-inputs input[type=number]")).toHaveValue("3");
  same(await state(), draftWorld);
  s = await gift("give", "aki", "mio", 2);
  assert.equal(person(s, "aki").action.id, 64);
  assert.equal(person(s, "aki").action.progress, 5 + renMove.duration);
  const feedback = await page.locator(".travel-feedback").innerText();
  assert(feedback.includes("銀貨2枚"));
  const resetPath = resolve("tests/fixtures", definitions.common.file);
  await importIntoPage(resetPath, initial);
  await panel("aki", "mio");
  await expect(cashInput()).toHaveValue("1");
  await expect(page.locator(".coin-transfer-history")).toHaveCount(0);
  await expect(page.locator(".travel-feedback")).toHaveCount(0);
  assert(!Object.hasOwn(await state(), "currency"));
  checks.push({
    scenario,
    kind: "actor-peer-cash-draft-only-reset-and-same-id-import-clears-ledger-ui",
    oldFeedback: feedback,
    resourceDraftPreservedOnPeerChange: true,
  });
  await context.close();

  // Physical boundary inputs are all public-command prepared, not ordinary play.
  for (const key of ["sleep", "ko"]) {
    ({ context, initial } = await opened(`controlled-${key}-peer`, key));
    await panel("aki", "mio");
    await amount(2);
    await expect(cashButton("give")).toBeDisabled();
    await expect(cashButton("give")).toHaveAttribute("title", /起きて/);
    await panel("mio", "aki");
    await amount(2);
    await expect(cashButton("take")).toBeEnabled();
    await expect(
      page
        .locator(".travel-peer")
        .getByRole("button", { name: "アキから受け取る", exact: true }),
    ).toBeEnabled();
    const peerBefore = structuredClone(person(initial, "aki"));
    s = await gift("take", "mio", "aki", 2);
    same(person(s, "aki"), peerBefore);
    assert(!s.logs.at(-1).witnesses.includes("aki"));
    await transferHistory(1);
    await capture(
      `${key}-peer-awake-recipient-actor-fact-only`,
      ".coin-transfer-history",
      [390],
    );
    await saveReload(`controlled-${key}-peer-cash-received`);
    final[key] = s;
    await context.close();
  }
  for (const key of ["heldZero", "heldOne"]) {
    ({ context, initial } = await opened(`controlled-${key}-threshold`, key));
    const held = structuredClone(person(initial, "aki").suspended);
    assert.equal(wallet(initial, "aki"), 2);
    s = await gift("take", "mio", "aki", 2);
    same(person(s, "aki").suspended, held);
    await saveReload(`controlled-${key}-threshold-handoff-held-unchanged`);
    await select(["aki"]);
    await nav("いまの暮らし");
    s = await op("resume-held-route-after-explicit-coin-weight-change", () =>
      page
        .locator(".suspended-work")
        .getByRole("button", { name: "再開する", exact: true })
        .click(),
    );
    const resumed = person(s, "aki").action;
    assert.equal(resumed.id, held.id);
    assert.equal(resumed.progress, held.progress);
    assert.equal(resumed.segmentProgress, held.segmentProgress);
    assert(resumed.duration < held.duration);
    if (key === "heldZero")
      assert(resumed.segmentDuration < held.segmentDuration);
    else assert.equal(resumed.segmentDuration, held.segmentDuration);
    await capture(
      `${key}-resume-keeps-started-segment-and-updates-future-time`,
      ".workboard",
      [390],
    );
    await saveReload(`controlled-${key}-resumed-under-new-wallet-weight`);
    checks.push({
      scenario,
      kind: "held-weight-resume-existing-rule",
      oldDuration: held.duration,
      newDuration: resumed.duration,
      oldSegmentDuration: held.segmentDuration,
      newSegmentDuration: resumed.segmentDuration,
      segmentProgress: resumed.segmentProgress,
    });
    final[key] = s;
    await context.close();
  }
  ({ context, initial } = await opened(
    "controlled-active-carried-peer",
    "carried",
  ));
  await panel("mio", "aki");
  await amount(2);
  await expect(cashButton("take")).toBeDisabled();
  const cashReason = await cashButton("take").getAttribute("title"),
    resourceButton = page
      .locator(".travel-peer")
      .getByRole("button", { name: "アキから受け取る", exact: true });
  await expect(resourceButton).toBeDisabled();
  assert.equal(await resourceButton.getAttribute("title"), cashReason);
  assert.match(cashReason, /移動や救助/);
  same(await state(), initial);
  await capture(
    "active-carried-peer-matches-resource-access-guard",
    ".coin-transfer-controls",
    [390],
  );
  checks.push({
    scenario,
    kind: "active-carried-rejects-cash-and-resources-same-guard",
    reason: cashReason,
  });
  await context.close();

  ({ context, initial } = await opened(
    "controlled-membership-and-invalid-imports",
    "joined",
  ));
  await panel("aki");
  await transferHistory(1);
  await saveReload("controlled-joined-peer-valid-one-coin-gift");
  const joined = initial.residents.find(
    (r) => r.sourceNpcId === "village-guide",
  );
  assert(joined);
  await invalidImport(
    "transfer-before-peer-joined",
    (x) => {
      const t = transfers(x).at(-1);
      t.time = joined.joinedAt - 1;
      x.logs.find((l) => l.id === t.logId).time = t.time;
      return {
        fields: ["transfer.time", "matching log.time"],
        reason:
          "Valid public-recruited peer receives at1061; modified consistent event time1060 is before joinedAt1061",
      };
    },
    { captureImage: true },
  );
  const shopping = final.shopping;
  await invalidImport(
    "duplicate-transfer-log",
    (x) => {
      x.currency.transfers.push(structuredClone(x.currency.transfers[0]));
      return {
        field: "currency.transfers append",
        reason: "Duplicate accepted work logId",
      };
    },
    { base: shopping },
  );
  await invalidImport(
    "transfer-record-without-marker",
    (x) => {
      delete x.logs.find((l) => l.id === transfers(x)[0].logId).coinTransfer;
      return {
        field: "work log.coinTransfer",
        change: "delete while keeping transfer row",
      };
    },
    { base: shopping },
  );
  await invalidImport(
    "marker-without-transfer-row",
    (x) => {
      x.currency.transfers = [];
      return {
        field: "currency.transfers",
        change: "remove row but retain work marker",
      };
    },
    { base: shopping },
  );
  await invalidImport(
    "both-financial-markers-on-one-log",
    (x) => {
      x.logs.find((l) => l.id === transfers(x)[0].logId).coinTrade = {
        choice: "sell-scrap",
        termsId: "village-coins-v1",
      };
      return {
        field: "transfer work log.coinTrade",
        change: "add second mutually exclusive financial marker",
      };
    },
    { base: shopping, captureImage: true },
  );
  await invalidImport(
    "shared-log-id-across-two-ledgers",
    (x) => {
      transfers(x)[0].logId = coinRows(x)[0].logId;
      return {
        field: "transfer.logId",
        change: "reuse the earlier regional coin sale logId",
      };
    },
    { base: shopping },
  );
  await invalidImport(
    "transfer-amount-marker-mismatch",
    (x) => {
      transfers(x)[0].amount = 1;
      return {
        field: "transfer.amount",
        before: 2,
        after: 1,
        reason: "Work marker still records2",
      };
    },
    { base: shopping },
  );
  await invalidImport(
    "non-personal-from-endpoint",
    (x) => {
      const t = transfers(x)[0];
      t.from = "base";
      x.logs.find((l) => l.id === t.logId).coinTransfer.from = "base";
      return {
        fields: ["transfer.from", "matching marker.from"],
        after: "base",
      };
    },
    { base: shopping },
  );
  await invalidImport(
    "self-transfer-endpoints",
    (x) => {
      const t = transfers(x)[0];
      t.from = t.to;
      x.logs.find((l) => l.id === t.logId).coinTransfer.from = t.from;
      return {
        fields: ["transfer.from", "matching marker.from"],
        change: "from equals receiver/actor",
      };
    },
    { base: shopping },
  );
  await invalidImport(
    "purchase-before-later-handoff",
    (x) => {
      const t = transfers(x)[0],
        purchase = coinRows(x).find((c) => c.actorId === "mio"),
        giftLog = x.logs.find((l) => l.id === t.logId),
        buyLog = x.logs.find((l) => l.id === purchase.logId),
        a = t.logId,
        b = purchase.logId;
      t.logId = b;
      purchase.logId = a;
      giftLog.id = b;
      buyLog.id = a;
      t.time = purchase.time;
      giftLog.time = t.time;
      return {
        fields: [
          "transfer.logId/time",
          "purchase.logId",
          "two corresponding log ids and gift time",
        ],
        reason:
          "Each financial array remains internally ordered; exchange global positions so Mio pays before receiving. Final wallets remain0 but unified wallet prefix is negative.",
      };
    },
    { base: shopping, captureImage: true },
  );
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
          "Actual isolated offline Chromium UI controls, imports, save/export/reload. Genuine continuing play and public-command-prepared inputs are individually labeled. No valid direct state edits, browser API commands, or storage writes. Invalid imports explicitly forged and separate.",
        inputs,
        operations,
        selections,
        navigations,
        controls,
        checkpoints,
        captures,
        audits,
        checks,
        comparisons,
        invalidInputs,
        errors,
        requests,
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
    checks: checks.length,
    captures: captures.length,
    invalidImports: invalidInputs.length,
  }),
);
