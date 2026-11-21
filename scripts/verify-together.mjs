/** CONTROL UI only: genuine622 plus public-command-prepared v5 inputs.
 * No browser game API, storage writes, or valid-save field edits. */
import assert from "node:assert/strict";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { createHash } from "node:crypto";
import { resolve, basename } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium, expect } from "@playwright/test";

const project = fileURLToPath(new URL("../", import.meta.url));
const definitions = JSON.parse(await readFile(resolve(project, "tests/fixtures/together-inputs.json"), "utf8"));
assert.equal(definitions.status, "prepared", "Wait for core freeze and the public-command fixture preparation");
assert(process.env.EXPECTED_HTML_SHA, "A root-announced formal EXPECTED_HTML_SHA is required before browser execution");
const hash = value => createHash("sha256").update(value).digest("hex");
const htmlPath = resolve(project, process.env.TOGETHER_HTML || "dist/yohaku-v53.html");
const html = await readFile(htmlPath), runner = await readFile(new URL(import.meta.url));
assert.equal(hash(html), process.env.EXPECTED_HTML_SHA);
const output = resolve(process.env.PLAYTEST_OUTPUT || `/workspace/research/stage5f-together-scoping/control/playtest/${hash(html).slice(0, 12)}`);
await mkdir(output, { recursive: true });
await writeFile(`${output}/RUN-START.json`, JSON.stringify({ startedAtUTC: new Date().toISOString(), htmlSha256: hash(html) }, null, 2), { flag: "wx" });
await mkdir(`${output}/inputfiles`, { recursive: true });
const inputs = [];
for (const d of definitions.inputs) {
  const path = resolve(project, d.path), raw = await readFile(path);
  assert.equal(hash(raw), d.sha256); assert.equal(raw.length, d.bytes);
  await writeFile(`${output}/inputfiles/${basename(path)}`, raw);
  inputs.push({ ...d, resolvedPath: path });
}
const source = { htmlPath, htmlSha256: hash(html), htmlBytes: html.length, runnerSha256: hash(runner), inputs,
  preparation: definitions.preparation, validFieldEdits: false, browserGameAPICommands: 0, directStorageWrites: 0 };
await writeFile(`${output}/tested-yohaku.html`, html);
await writeFile(`${output}/tested-runner.mjs`, runner);
await writeFile(`${output}/source.json`, JSON.stringify(source, null, 2));

const ENTRY = "http://yohaku-together-control.local/", names = { aki: "アキ", mio: "ミオ", ren: "レン" };
const contexts = [], operations = [], checkpoints = [], captures = [], audits = [], invalidInputs = [], checks = [], errors = [], requests = [];
let page, scenario, browser, downloads = 0, passed = false;
const person = (s, id) => s.residents.find(r => r.id === id);
const state = () => page.evaluate(() => JSON.parse(localStorage.getItem("yohaku-autosave-v1") || localStorage.getItem("yohaku-save-v1")));
const card = id => page.locator(`.residents-list .resident-card[aria-label^="${names[id]}を"]`);
const selected = async () => Promise.all(Object.keys(names).map(async id => ({ id, pressed: await card(id).getAttribute("aria-pressed"), viewing: (await card(id).getAttribute("class"))?.includes("viewing") })));
const panel = () => page.locator("[data-together-travel-panel]");
async function op(label, fn, effect = "ui") {
  const before = await state(), value = await fn();
  await page.waitForTimeout(80);
  const world = await state();
  if (effect === "ui") assert.deepEqual(world, before, `${label}: complete world must remain unchanged`);
  operations.push({ scenario, classification: "control", label, effect, beforeMinutes: before?.minutes, afterMinutes: world?.minutes, before, world });
  console.log(`${scenario}: ${label} ${before?.minutes}->${world?.minutes}`);
  return { world, value };
}
async function dismiss() {
  const b = page.getByRole("button", { name: "通知を閉じる", exact: true });
  if (await b.isVisible()) await op("通知を閉じる", () => b.click());
}
async function select(ids, focus) {
  await dismiss();
  for (const id of Object.keys(names)) if ((await card(id).getAttribute("aria-pressed") === "true") !== ids.includes(id))
    await op(`${names[id]}の実選択を変更`, () => card(id).click());
  if (focus && !(await card(focus).getAttribute("class"))?.includes("viewing")) {
    await op(`${names[focus]}への注目を変更1`, () => card(focus).click());
    await op(`${names[focus]}への注目を変更2`, () => card(focus).click());
  }
  const actual = (await selected()).filter(r => r.pressed === "true").map(r => r.id);
  assert.deepEqual(actual.sort(), [...ids].sort());
}
async function nav(name) {
  await dismiss();
  await op(`${name}へ`, () => page.getByRole("navigation").getByRole("button", { name, exact: true }).click());
}
async function importFile(path, expected, label) {
  await op(`${label}:保存画面`, () => page.locator(".save-button").click());
  await op(`${label}:実ファイル読込`, () => page.locator('input[type="file"]').setInputFiles(path), "input");
  await expect(page.getByRole("dialog")).not.toBeVisible();
  assert.deepEqual(await state(), expected);
}
async function opened(name, role) {
  scenario = name;
  const d = inputs.find(x => x.role === role); assert(d, `Missing fixture ${role}`);
  const initial = JSON.parse(await readFile(d.resolvedPath, "utf8"));
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, offline: true, acceptDownloads: true, hasTouch: true });
  contexts.push({ scenario, classification: "control", inputClassification: d.classification, input: d.path, inputSha256: d.sha256, version: initial.version });
  await context.route("**/*", route => {
    const url = route.request().url(); requests.push({ scenario, url });
    return url === ENTRY ? route.fulfill({ contentType: "text/html", body: html }) : route.abort();
  });
  page = await context.newPage(); page.setDefaultTimeout(12000);
  page.on("pageerror", error => errors.push({ scenario, type: "pageerror", message: error.message }));
  page.on("console", message => { if (message.type() === "error") errors.push({ scenario, type: "console", message: message.text() }); });
  await page.goto(ENTRY); await importFile(d.resolvedPath, initial, role);
  return context;
}
async function saveReload(name) {
  await dismiss(); const before = await state();
  await op(`${name}:保存画面`, () => page.locator(".save-button").click());
  await op(`${name}:手動保存`, () => page.getByRole("button", { name: "いまの暮らしを保存する", exact: true }).click());
  async function download(suffix) {
    const { value: raw } = await op(`${name}:${suffix}実書出し`, async () => {
      const event = page.waitForEvent("download");
      await page.getByRole("button", { name: "ファイルに書き出す", exact: true }).click();
      return readFile(await (await event).path(), "utf8");
    });
    downloads++; const path = `${output}/${scenario}-${name}${suffix === "first" ? "" : "-reload-export"}.json`;
    await writeFile(path, raw); return { raw, path };
  }
  const first = await download("first"); assert.deepEqual(JSON.parse(first.raw), before);
  await op(`${name}:保存を閉じる`, () => page.keyboard.press("Escape"));
  await op(`${name}:実再読込`, () => page.reload()); assert.deepEqual(await state(), before);
  await op(`${name}:再読込後の保存画面`, () => page.locator(".save-button").click());
  const again = await download("again"); assert.equal(again.raw, first.raw);
  await op(`${name}:保存を閉じる`, () => page.keyboard.press("Escape"));
  checkpoints.push({ scenario, name, minutes: before.minutes, version: before.version, path: first.path, reloadPath: again.path, sha256: hash(first.raw), wholeWorldExact: true, reExportBytesExact: true });
  return first;
}
async function capture(name, target, widths) {
  await dismiss(); const before = await state();
  for (const width of widths) {
    const height = width === 1280 ? 900 : 844;
    await page.setViewportSize({ width, height });
    await page.locator(target).evaluate(el => el.scrollIntoView({ block: "start" }));
    await page.evaluate(async () => { await document.fonts.ready; await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r))); });
    await page.waitForTimeout(150);
    const g = await page.evaluate(() => {
      const n = document.querySelector(".navigation nav") || document.querySelector("nav");
      return { client: document.documentElement.clientWidth, scroll: document.documentElement.scrollWidth, navClient: n?.clientHeight, navScroll: n?.scrollHeight };
    });
    assert(g.scroll <= g.client + 1); if (g.navClient) assert(g.navScroll <= g.navClient + 1);
    const path = `${output}/${scenario}-${name}-${width}.png`; await page.screenshot({ path });
    captures.push({ scenario, name, width, height, path, visuallyReviewed: false }); audits.push({ scenario, name, width, height, ...g });
  }
  await page.setViewportSize({ width: 390, height: 844 }); assert.deepEqual(await state(), before);
}
function pair(s) {
  const m = person(s, "mio").action, r = person(s, "ren").action;
  assert.equal(s.version, 5); assert.equal(m.kind, "move"); assert.equal(r.kind, "move");
  assert.deepEqual(m.together, { peerResidentId: "ren", peerActionId: r.id });
  assert.deepEqual(r.together, { peerResidentId: "mio", peerActionId: m.id });
  return { m: structuredClone(m), r: structuredClone(r) };
}
function peerKept(before, after, started) {
  const a = person(before, "mio").action, b = person(after, "mio").action;
  const strip = job => { const copy = structuredClone(job); delete copy.together; delete copy.duration; delete copy.segmentDuration; return copy; };
  assert.deepEqual(strip(b), strip(a)); assert.equal(b.together, undefined);
  assert.equal(person(after, "mio").location, person(before, "mio").location);
  assert.equal(b.segment, 0); assert.equal(b.segmentProgress, started ? 1 : 0);
  const ordinary = definitions.expectedIndividualSafeActions.mio;
  assert.equal(b.segmentDuration, started ? a.segmentDuration : ordinary.segmentDuration);
  assert.equal(b.duration, ordinary.duration + (started ? a.segmentDuration - ordinary.segmentDuration : 0));
  assert.equal(after.minutes, before.minutes); assert.equal(after.seed, before.seed);
  assert.equal(after.version, 5);
  assert.deepEqual(after.resources, before.resources); assert.deepEqual(after.inventory, before.inventory);
  const body = resident => { const copy = structuredClone(resident); delete copy.action; delete copy.suspended; return copy; };
  assert.deepEqual(after.residents.map(body), before.residents.map(body));
  assert.deepEqual(person(after, "aki"), person(before, "aki"));
}
async function rejectInvalid(name, mutate, fields) {
  await dismiss(); const original = await state(), group = await selected(), invalid = structuredClone(original);
  mutate(invalid);
  const path = `${output}/invalid-${name}.json`; await writeFile(path, JSON.stringify(invalid, null, 2));
  await op(`${name}:不正保存の画面を開く`, () => page.locator(".save-button").click());
  await op(`${name}:意図的不正JSONを実読込`, () => page.locator('input[type="file"]').setInputFiles(path), "invalid-input");
  await expect(page.getByRole("dialog")).toBeVisible();
  await expect(page.getByText("保存データの内容が不正、または必要な情報が不足しています。現在のゲームは変更していません。", { exact: true })).toBeVisible();
  assert.deepEqual(await state(), original); assert.deepEqual(await selected(), group);
  invalidInputs.push({ scenario, name, path, sha256: hash(await readFile(path)), directInvalidEdits: fields, wholeWorldAndSelectionPreserved: true });
  await op(`${name}:保存画面を閉じる`, () => page.keyboard.press("Escape")); await dismiss();
}

try {
  browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || "/usr/bin/chromium", headless: true, args: ["--no-sandbox"] });
  let c = await opened("zero-pair-preview-and-pause", "genuine-village");
  await select(["mio", "ren"], "aki"); await nav("周辺を探索");
  await expect(panel()).toBeVisible(); await expect(panel()).toContainText("ミオ"); await expect(panel()).toContainText("レン");
  assert.doesNotMatch(await panel().innerText(), /アキ/);
  const sourceWorld = await state(); assert.equal(sourceWorld.version, 4);
  await op("safe経由を選ぶだけ", () => page.locator('[data-together-route="home-safe"]').click());
  await expect(page.locator("[data-together-route-draft]")).toBeVisible();
  await op("short経由を選ぶだけ", () => page.locator('[data-together-route="home-short"]').click());
  await op("safe経由を再選択するだけ", () => page.locator('[data-together-route="home-safe"]').click());
  await capture("common-group-focus-and-safe-preview", "[data-together-travel-panel]", [320, 390, 1280]);
  const { world: zero } = await op("safe案を二人で明示出発", () => page.locator("[data-move-together]").click(), "game");
  const zeroJobs = pair(zero); assert.equal(zero.minutes, 622);
  assert.deepEqual(zero, JSON.parse(await readFile(inputs.find(x => x.role === "paired-zero").resolvedPath, "utf8")));
  await saveReload("paired-zero-both-jobs");
  await select(["ren"]); await nav("いまの暮らし");
  let before = await state();
  let { world: after } = await op("重荷レンだけ中断し連携を解く", () => page.locator(".running-work").getByRole("button", { name: "中断", exact: true }).click(), "game");
  peerKept(before, after, false);
  const held = structuredClone(zeroJobs.r); delete held.together;
  assert.deepEqual(person(after, "ren").suspended, held); assert.equal(person(after, "ren").action, null);
  await saveReload("zero-detached-peer-individual-cost");
  await select(["ren"]); await nav("いまの暮らし");
  ({ world: after } = await op("保持移動を個人で明示再開", () => page.locator(".suspended-work").getByRole("button", { name: "再開する", exact: true }).click(), "game"));
  assert.equal(person(after, "ren").action.id, held.id); assert.equal(person(after, "ren").action.together, undefined); assert.equal(person(after, "mio").action.together, undefined);
  checks.push({ scenario, kind: "draft-only-safe-short-focus-group-clock-zero-v4-to-v5-save-pause-resume-no-relink", individualMioFirstSegment: person(after, "mio").action.segmentDuration });
  await c.close();

  c = await opened("started-pair-cancel-and-other-order", "paired-one");
  pair(await state()); const saved = await saveReload("paired-started-one-minute");
  await select(["ren"]); await nav("いまの暮らし"); before = await state();
  ({ world: after } = await op("開始済のレンだけ取消", () => page.locator(".running-work").getByRole("button", { name: "取消", exact: true }).click(), "game"));
  peerKept(before, after, true); assert.equal(person(after, "ren").action, null);
  await saveReload("started-peer-segment-duration-retained");
  await importFile(saved.path, JSON.parse(saved.raw), "同じ有効な開始済保存から別指示の枝");
  await select(["ren"]); await nav("いまの暮らし"); before = await state();
  ({ world: after } = await op("村のレンへ景色を見る別指示", () => page.locator(".action-grid").getByRole("button", { name: /景色を眺める/ }).click(), "game"));
  peerKept(before, after, true); assert.equal(person(after, "ren").action.kind, "observe");
  assert.equal(person(after, "ren").suspended.id, person(before, "ren").action.id); assert.equal(person(after, "ren").suspended.together, undefined);
  await capture("started-detach-peer-job-kept", ".workboard", [390]);
  await importFile(saved.path, JSON.parse(saved.raw), "孤児metadata拒否の有効な原本"); await select(["mio", "ren"]);
  await rejectInvalid("orphan-one-sided-link", s => { delete person(s, "mio").action.together; }, ["mio.action.together deleted; reciprocal peer remains"]);
  checks.push({ scenario, kind: "started-segment-cost-kept-cancel-other-order-peer-id-progress-preserved-invalid-orphan-refused" });
  await c.close();

  c = await opened("paired-current-with-old-held", "paired-with-held");
  pair(await state()); await select(["ren"]); await nav("いまの暮らし"); before = await state();
  const pause = page.locator(".running-work").getByRole("button", { name: "中断", exact: true });
  const disabled = await pause.isDisabled();
  if (disabled) {
    assert.match(await pause.getAttribute("title"), /中断|先に/);
    await op("満枠の中断buttonが実disabled", async () => assert.equal(await pause.isDisabled(), true));
  } else {
    await op("満枠で中断を実要求し拒否", () => pause.click());
    await expect(page.getByText(/すでに中断中|先に.*取り消/).last()).toBeVisible();
  }
  assert.deepEqual(await state(), before); assert.equal(person(before, "ren").suspended.reserved.food, 1);
  await capture("full-held-pause-refused-reservation-kept", ".workboard", [390]);
  await saveReload("full-held-pair-both-slots-kept"); await select(["ren"]);
  await rejectInvalid("held-metadata", s => { person(s, "ren").suspended.together = structuredClone(person(s, "ren").action.together); }, ["ren.suspended.together added to old eat job"]);
  await nav("いまの暮らし"); before = await state();
  ({ world: after } = await op("同行currentだけ取消し旧食事予約を保持", () => page.locator(".running-work").getByRole("button", { name: "取消", exact: true }).click(), "game"));
  peerKept(before, after, false); assert.deepEqual(person(after, "ren").suspended, person(before, "ren").suspended); assert.deepEqual(after.inventory, before.inventory);
  await saveReload("old-held-food-kept-current-pair-cancelled");
  checks.push({ scenario, kind: "full-held-pause-refused-no-clock-world-change-old-food-reservation-survives-current-cancel", actualDisabled: disabled });
  await c.close();
  assert.deepEqual(errors, []); assert(requests.every(x => x.url === ENTRY));
  assert.equal(hash(await readFile(htmlPath)), source.htmlSha256);
  passed = true;
} catch (error) {
  if (page && !page.isClosed()) await page.screenshot({ path: `${output}/failure.png`, fullPage: true }).catch(() => {});
  await writeFile(`${output}/failure.json`, JSON.stringify({ error: String(error), stack: error.stack, scenario, source }, null, 2));
  throw error;
} finally {
  await writeFile(`${output}/report.json`, JSON.stringify({ status: passed ? "passed" : "failed", source,
    method: "Three independent CONTROL contexts only. Genuine old50 v4 source and public-command/positive-advance v5 controls are labeled separately. Actual UI selection/draft/departure/pause/cancel/other order/file save/reload/import; invalid direct edits only in two rejected files. No normal arrival comparison, KO/rescue, browser game API or storage writes.",
    contexts, operations, checkpoints, downloads, captures, audits, invalidInputs, checks, errors, requests }, null, 2));
  await browser?.close();
}
console.log(JSON.stringify({ status: "passed", contexts: contexts.length, operations: operations.length, checkpoints: checkpoints.length, downloads, images: captures.length, invalidInputs: invalidInputs.length, output }));
