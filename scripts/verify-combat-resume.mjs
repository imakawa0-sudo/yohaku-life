/** Actual standalone UI regression. Two unedited public-command old47 controls;
 * no browser game API, direct storage writes, or generated valid-state edits. */
import assert from "node:assert/strict";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { createHash } from "node:crypto";
import { resolve, basename } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium, expect } from "@playwright/test";

const project = fileURLToPath(new URL("../", import.meta.url));
const definitions = JSON.parse(await readFile(resolve(project, "tests/fixtures/combat-resume-inputs.json"), "utf8"));
const sha = value => createHash("sha256").update(value).digest("hex");
const htmlPath = resolve(project, process.env.COMBAT_RESUME_HTML || "dist/yohaku-v53.html");
const html = await readFile(htmlPath), runner = await readFile(new URL(import.meta.url));
if (process.env.EXPECTED_HTML_SHA) assert.equal(sha(html), process.env.EXPECTED_HTML_SHA);
const output = resolve(process.env.PLAYTEST_OUTPUT || `/tmp/yohaku-combat-resume-${sha(html).slice(0, 12)}`);
await mkdir(output, { recursive: true });
try {
  await writeFile(`${output}/RUN-START.json`, JSON.stringify({ startedAtUTC: new Date().toISOString(), htmlSha256: sha(html) }, null, 2), { flag: "wx" });
} catch (error) {
  throw new Error("A run already exists here. Use a new PLAYTEST_OUTPUT to preserve the previous evidence.", { cause: error });
}
await mkdir(`${output}/inputfiles`, { recursive: true });
const inputs = [];
for (const definition of definitions) {
  const path = resolve(project, definition.path), raw = await readFile(path);
  assert.equal(sha(raw), definition.sha256);
  assert.equal(raw.length, definition.bytes);
  await writeFile(`${output}/inputfiles/${basename(path)}`, raw);
  inputs.push({ ...definition, resolvedPath: path });
}
const source = { htmlPath, htmlSha256: sha(html), htmlBytes: html.length, runnerSha256: sha(runner), inputs };
await writeFile(`${output}/tested-yohaku.html`, html);
await writeFile(`${output}/tested-runner.mjs`, runner);
await writeFile(`${output}/source.json`, JSON.stringify(source, null, 2));

const ENTRY = "http://yohaku-combat-resume.local/";
const NAMES = { aki: "アキ", mio: "ミオ", ren: "レン" };
const contexts = [], operations = [], observations = [], checkpoints = [], captures = [], audits = [], checks = [], requests = [], errors = [], worlds = {};
let page, scenario, passed = false, downloads = 0;
const person = (world, id = "mio") => world.residents.find(resident => resident.id === id);
const state = () => page.evaluate(() => {
  const raw = localStorage.getItem("yohaku-autosave-v1") || localStorage.getItem("yohaku-save-v1");
  return raw ? JSON.parse(raw) : null;
});
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || "/usr/bin/chromium", headless: true, args: ["--no-sandbox"] });

async function op(label, fn, effect = "ui-only") {
  const before = await state(), value = await fn();
  await page.waitForTimeout(80);
  const world = await state();
  if (effect === "ui-only") assert.deepEqual(world, before, `${label} must leave the complete world unchanged`);
  if (world) assert.equal(world.ended, false);
  operations.push({ scenario, classification: "public-command-control", label, effect, beforeMinutes: before?.minutes ?? null, afterMinutes: world?.minutes ?? null, before, world });
  console.log(`${scenario}: ${label} ${before?.minutes ?? "fresh"}->${world?.minutes ?? "fresh"}`);
  return { world, value };
}
async function dismiss() {
  const close = page.getByRole("button", { name: "通知を閉じる", exact: true });
  if (await close.isVisible()) await op("通知だけを閉じる", () => close.click());
}
async function selectMio() {
  await dismiss();
  for (const [id, name] of Object.entries(NAMES)) {
    const card = page.locator(`.residents-list .resident-card[aria-label^="${name}を"]`);
    if ((await card.getAttribute("aria-pressed") === "true") !== (id === "mio"))
      await op(`${name}の実選択を${id === "mio" ? "追加" : "解除"}`, () => card.click());
  }
  const selected = page.locator('.residents-list .resident-card[aria-pressed="true"]');
  await expect(selected).toHaveCount(1);
  await expect(selected).toContainText("ミオ");
}
async function nav(label) {
  await dismiss();
  await op(`${label}の画面へ移動`, () => page.getByRole("navigation").getByRole("button", { name: label, exact: true }).click());
}
async function opened(role) {
  scenario = role;
  const definition = inputs.find(input => input.role === role);
  assert(definition, `Missing fixture ${role}`);
  const raw = await readFile(definition.resolvedPath, "utf8"), expected = JSON.parse(raw);
  assert.equal(sha(raw), definition.sha256);
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, acceptDownloads: true, offline: true, hasTouch: true });
  contexts.push({ scenario, classification: definition.classification, input: definition.path, inputSHA256: definition.sha256 });
  await context.route("**/*", route => {
    const url = route.request().url(); requests.push({ scenario, url });
    return url === ENTRY ? route.fulfill({ contentType: "text/html", body: html }) : route.abort();
  });
  page = await context.newPage(); page.setDefaultTimeout(12000);
  page.on("pageerror", error => errors.push({ scenario, type: "pageerror", message: error.message }));
  page.on("console", message => { if (message.type() === "error") errors.push({ scenario, type: "console", message: message.text() }); });
  await page.goto(ENTRY);
  await op("実ファイル読込の保存画面を開く", () => page.locator(".save-button").click());
  await op("無改変の旧47controlを実ファイル読込", () => page.locator('input[type="file"]').setInputFiles(definition.resolvedPath), "input");
  await expect(page.getByRole("dialog")).not.toBeVisible();
  assert.deepEqual(await state(), expected);
  assert.equal(expected.enemy.defeated, true);
  worlds[`${scenario}:imported`] = await state();
  await selectMio();
  return context;
}
async function exported(name) {
  const { value: raw } = await op(`${name}を実ファイル書出し`, async () => {
    const pending = page.waitForEvent("download");
    await page.getByRole("button", { name: "ファイルに書き出す", exact: true }).click();
    return readFile(await (await pending).path(), "utf8");
  });
  downloads++;
  const path = `${output}/${scenario}-${name}.json`;
  await writeFile(path, raw);
  return { raw, path };
}
async function saveReload(name) {
  await dismiss();
  const before = await state();
  await op(`${name}:保存を開く`, () => page.locator(".save-button").click());
  await op(`${name}:手動保存`, () => page.getByRole("button", { name: "いまの暮らしを保存する", exact: true }).click());
  const first = await exported(name);
  assert.deepEqual(JSON.parse(first.raw), before);
  assert.equal(first.raw, JSON.stringify(before, null, 2));
  await op(`${name}:保存を閉じる`, () => page.keyboard.press("Escape"));
  await op(`${name}:実再読込`, () => page.reload());
  assert.deepEqual(await state(), before);
  await op(`${name}:再読込後に保存を開く`, () => page.locator(".save-button").click());
  const second = await exported(`${name}-reload-export`);
  assert.equal(second.raw, first.raw);
  await op(`${name}:保存を閉じる`, () => page.keyboard.press("Escape"));
  checkpoints.push({ scenario, name, minutes: before.minutes, path: first.path, reloadPath: second.path, sha256: sha(first.raw), wholeWorldExact: true, reloadWorldExact: true, reExportBytesExact: true });
  await selectMio();
  return first.raw;
}
async function capture(name, target, widths) {
  await dismiss();
  const before = await state();
  for (const width of widths) {
    const height = width === 1280 ? 900 : 844;
    await page.setViewportSize({ width, height });
    await page.locator(target).evaluate(element => element.scrollIntoView({ block: "start" }));
    await page.evaluate(async () => { await document.fonts.ready; await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))); });
    const geometry = await page.evaluate(() => ({ client: document.documentElement.clientWidth, scroll: document.documentElement.scrollWidth }));
    assert.equal(geometry.client, geometry.scroll);
    const path = `${output}/${scenario}-${name}-${width}.png`;
    await page.screenshot({ path });
    captures.push({ scenario, name, width, height, path, visuallyReviewed: false });
    audits.push({ scenario, name, width, height, ...geometry });
  }
  await page.setViewportSize({ width: 390, height: 844 });
  assert.deepEqual(await state(), before);
}
async function cancelOnly(slot) {
  await dismiss();
  const before = await state(), old = structuredClone(person(before)[slot]);
  assert.equal(old.kind, "attack"); assert.equal(old.id, 98);
  const work = page.locator(slot === "suspended" ? ".suspended-work" : ".running-work");
  const { world: after } = await op(`${slot === "suspended" ? "中断中" : "旧進行中"}の攻撃98だけを明示取消`, () => work.getByRole("button", { name: "取消", exact: true }).click(), "game");
  // This is an assertion projection only. It is never imported or written as a fixture.
  assert.deepEqual(after, { ...before, residents: before.residents.map(resident => resident.id === "mio" ? { ...resident, [slot]: null } : resident) });
  assert.equal(person(after).action, null); assert.equal(person(after).suspended, null);
  worlds[`${scenario}:cancelled`] = after;
  return after;
}
async function returnHome() {
  await selectMio(); await nav("周辺を探索");
  const before = await state();
  const { world: reserved } = await op("ミオの通常帰宅を時間0で予約", () => page.locator(".destinations").getByRole("button", { name: "共同の居間", exact: false }).click(), "game");
  const job = structuredClone(person(reserved).action);
  assert.equal(job.kind, "move"); assert.equal(job.target, "home"); assert.notEqual(job.id, 98);
  assert.equal(reserved.minutes, before.minutes);
  assert.deepEqual(reserved.resources, before.resources);
  assert.deepEqual(reserved.inventory, before.inventory);
  await nav("いまの暮らし");
  for (let i = 0; i < 40 && person(await state()).action?.id === job.id; i++)
    await op(`通常の帰宅の区切りを実進行${i + 1}`, () => page.locator(".next-button").click(), "game");
  const arrived = await state();
  assert.equal(person(arrived).location, "home");
  assert.equal(person(arrived).action, null); assert.equal(person(arrived).suspended, null);
  assert.equal(arrived.minutes - before.minutes, job.duration);
  assert.deepEqual(arrived.resources, before.resources);
  assert.deepEqual(arrived.inventory, before.inventory);
  assert.equal(arrived.enemy.defeated, true);
  observations.push({ scenario, kind: "real-normal-home-return", started: before.minutes, arrived: arrived.minutes, duration: job.duration, job, cancelledAttackNeverResumed: true, resourceAndPackTotalsUnchanged: true });
  worlds[`${scenario}:returned`] = arrived;
  await saveReload("normal-return-after-explicit-cancel");
  await capture("home-normal-action-restored", ".scene-focus", [390]);
}

try {
  let context = await opened("held-after-defeat");
  const before = await state(), held = structuredClone(person(before).suspended);
  assert.equal(held.id, 98); assert.equal(held.kind, "attack"); assert.equal(person(before).action, null);
  const suspended = page.locator(".suspended-work"), resume = suspended.getByRole("button", { name: "再開する", exact: true });
  await expect(resume).toBeDisabled();
  await expect(suspended).toContainText("相手はもう退いています");
  await expect(suspended).toContainText("取り消し");
  assert.match(await resume.getAttribute("title"), /相手.*取り消/);
  assert.deepEqual(await state(), before);
  assert.deepEqual(person(await state()).suspended, held);
  observations.push({ scenario, kind: "resume-rejected-before-click", disabled: true, explanation: await suspended.innerText(), buttonTitle: await resume.getAttribute("title"), wholeWorldUnchanged: true, forceClickAttempted: false, toastRequired: false });
  const raw = await saveReload("held-resume-disabled-world-kept");
  assert.equal(sha(raw), inputs.find(input => input.role === scenario).sha256);
  await expect(page.locator(".suspended-work").getByRole("button", { name: "再開する", exact: true })).toBeDisabled();
  await capture("held-resume-disabled-cancel-explanation", ".workboard", [390, 1280]);
  await cancelOnly("suspended"); await returnHome();
  checks.push({ scenario, kind: "absent-opponent-held-resume-disabled-original-world-kept-explicit-cancel-normal-return", heldActionId: held.id });
  await context.close();

  context = await opened("legacy-current-after-defeat");
  const legacy = await state(), ghost = structuredClone(person(legacy).action);
  assert.equal(ghost.kind, "attack"); assert.equal(ghost.id, 98); assert.equal(person(legacy).suspended, null);
  await expect(page.locator(".running-work")).toContainText("攻撃を続ける");
  const legacyRaw = await saveReload("legacy-current-kept-on-load");
  assert.equal(sha(legacyRaw), inputs.find(input => input.role === scenario).sha256);
  assert.deepEqual(person(await state()).action, ghost);
  await capture("legacy-current-compatible-no-automatic-repair", ".workboard", [1280]);
  await cancelOnly("action"); await returnHome();
  checks.push({ scenario, kind: "legitimate-old47-current-save-loads-unchanged-explicit-cancel-normal-return", currentActionId: ghost.id, automaticRepairExpected: false });
  await context.close();

  assert.deepEqual(errors, []); assert(requests.every(request => request.url === ENTRY));
  for (const input of inputs) assert.equal(sha(await readFile(input.resolvedPath)), input.sha256);
  assert.equal(sha(await readFile(htmlPath)), source.htmlSha256);
  passed = true;
} catch (error) {
  if (page && !page.isClosed()) await page.screenshot({ path: `${output}/failure.png` }).catch(() => {});
  await writeFile(`${output}/failure.json`, JSON.stringify({ scenario, message: String(error), stack: error.stack, world: page && !page.isClosed() ? await state().catch(() => null) : null }, null, 2));
  throw error;
} finally {
  await writeFile(`${output}/report.json`, JSON.stringify({ status: passed ? "passed" : "failed", source, method: "One offline Chromium browser, two independent public-command control contexts. Actual file imports, shared roster selection, disabled resume reason, explicit cancel, normal move, positive time, manual saves, downloads and reloads only. No browser game API/direct storage writes/valid-state edits; not normal baseline play.", contexts, operations, observations, checkpoints, downloads, captures, audits, checks, errors, requests, worlds }, null, 2));
  await browser.close();
}
console.log(JSON.stringify({ status: "passed", contexts: contexts.length, operations: operations.length, checkpoints: checkpoints.length, rawDownloads: downloads, captures: captures.length, htmlSha256: source.htmlSha256, output }));
