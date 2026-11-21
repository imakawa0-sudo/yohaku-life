/** Plan memos and food budgets exercised through the built, offline UI.
 * All inputs are genuine prior UI exports; no engine API, field edits or
 * browser-storage writes prepare these three ordinary play branches.
 */
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { chromium, expect } from "@playwright/test";

const html = await readFile(resolve(process.env.PLANS_HTML || "dist/yohaku-v53.html"), "utf8");
const sha256 = createHash("sha256").update(html).digest("hex");
if (process.env.EXPECTED_HTML_SHA) assert.equal(sha256, process.env.EXPECTED_HTML_SHA);
const output = process.env.PLAYTEST_OUTPUT || `/workspace/research/stage3b-plans/playtest/${sha256.slice(0, 12)}`;
await mkdir(output, { recursive: true });
await writeFile(join(output, "tested-yohaku.html"), html);
const URL = "http://yohaku-plans.local/";
const sizes = [[320, 740], [390, 844], [430, 932], [1280, 800]];
const checks = [], operations = [], checkpoints = [], audits = [], captures = [], errors = [], requests = [];
const fixtures = [];
let activePage;
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || "/usr/bin/chromium", headless: true, args: ["--no-sandbox"] });
const state = page => page.evaluate(() => JSON.parse(localStorage.getItem("yohaku-autosave-v1") || localStorage.getItem("yohaku-save-v1")));
const person = (s, id) => s.residents.find(r => r.id === id);
const plan = (s, id) => s.travelPlans.entries.find(p => p.id === id);
const reminderCount = s => s.logs.filter(log => log.title === "旅の予定の時刻").length;
const card = (page, name) => page.locator(".residents-list .resident-card").filter({ has: page.locator(".resident-name").filter({ hasText: name }) });
const editor = page => page.locator(".trip-plan-editor");
const panel = page => page.locator(".trip-plan-panel");
const purposeInput = page => editor(page).getByLabel("旅の目的", { exact: true });
const planCard = (page, purpose) => panel(page).locator(".trip-plan-card").filter({ has: page.getByRole("heading", { name: purpose, exact: true }) });
const meal = page => page.locator(".action-grid").getByRole("button", { name: /^(食事をとる|一緒に食事|それぞれ食事)/ });
const sleep = page => page.locator(".action-grid").getByRole("button", { name: "旅先で眠る", exact: false });
function check(label) { checks.push(label); console.log(`✓ ${label}`); }
function withoutPlanAllocation(s) {
  const { travelPlans: _plans, nextId: _id, ...world } = s;
  return world;
}
async function dismiss(page) {
  const close = page.getByRole("button", { name: "通知を閉じる", exact: true });
  if (await close.isVisible()) await close.click();
}
async function selected(page) {
  return page.locator(".residents-list .resident-card[aria-pressed=true] .resident-name").allTextContents();
}
async function focused(page) {
  return page.locator(".residents-list .resident-card.viewing .resident-name").textContent();
}
async function select(page, ids) {
  await dismiss(page); const before = await state(page);
  assert.ok(ids.every(id => person(before, id)));
  for (const resident of before.residents) {
    const row = card(page, resident.name);
    if ((await row.getAttribute("aria-pressed") === "true") !== ids.includes(resident.id)) await row.click();
    await expect(row).toHaveAttribute("aria-pressed", String(ids.includes(resident.id)));
  }
  if (ids.length) {
    const row = card(page, person(before, ids.at(-1)).name);
    if (!(await row.getAttribute("class")).split(/\s+/).includes("viewing")) { await row.click(); await row.click(); }
    await expect(row).toHaveClass(/viewing/);
  }
  assert.deepEqual(await state(page), before, "Roster and focus changes are world-read-only");
}
async function nav(page, label) {
  await dismiss(page); const before = await state(page);
  await page.getByRole("navigation").getByRole("button", { name: label, exact: false }).click();
  assert.deepEqual(await state(page), before, "View navigation must not advance or change the world");
}
async function op(page, scenario, label, fn) {
  await dismiss(page); const before = await state(page); await fn(); const after = await state(page);
  assert.equal(after.ended, false, label);
  operations.push({ scenario, label, beforeMinutes: before.minutes, afterMinutes: after.minutes,
    seed: after.seed, base: after.resources, packs: after.inventory.packs,
    travelPlans: after.travelPlans,
    residents: after.residents.map(r => ({ id: r.id, location: r.location, hp: r.hp, hunger: r.hunger, energy: r.energy,
      action: r.action && { id: r.action.id, kind: r.action.kind, progress: r.action.progress, duration: r.action.duration, reserved: r.action.reserved },
      suspended: r.suspended && { id: r.suspended.id, kind: r.suspended.kind, progress: r.suspended.progress, reserved: r.suspended.reserved } })) });
  return after;
}
async function until(page, scenario, label, predicate) {
  for (let n = 0; n < 70; n++) {
    const before = await state(page); if (predicate(before)) return before;
    const next = await op(page, scenario, label, () => page.locator(".next-button").click());
    assert.ok(next.minutes > before.minutes);
  }
  assert.fail(`Action did not complete: ${label}`);
}
async function imported(scenario, fixturePath) {
  const raw = await readFile(resolve(fixturePath), "utf8"), expected = JSON.parse(raw);
  fixtures.push({ scenario, path: fixturePath, sha256: createHash("sha256").update(raw).digest("hex"), version: expected.version, minutes: expected.minutes });
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, offline: true, acceptDownloads: true });
  await context.route("**/*", async route => {
    const url = route.request().url(); requests.push({ scenario, url });
    if (url === URL) await route.fulfill({ contentType: "text/html", body: html }); else await route.abort();
  });
  const page = await context.newPage(); activePage = page;
  page.on("pageerror", error => errors.push({ scenario, type: "pageerror", text: error.message }));
  page.on("console", message => { if (message.type() === "error") errors.push({ scenario, type: "console", text: message.text() }); });
  await page.goto(URL); await expect(page.locator(".header .time")).toHaveText("08:00");
  await page.locator(".save-button").click();
  await page.locator("input[type=file]").setInputFiles({ name: fixturePath.split("/").at(-1), mimeType: "application/json", buffer: Buffer.from(raw) });
  await expect(page.getByRole("dialog")).not.toBeVisible();
  const loaded = await state(page);
  if (expected.version === 3) assert.deepEqual(loaded, expected);
  else {
    assert.equal(loaded.version, 3); assert.equal(loaded.minutes, expected.minutes); assert.equal(loaded.seed, expected.seed);
    for (const key of ["resources", "inventory", "region", "logs", "life"]) assert.deepEqual(loaded[key], expected[key]);
  }
  return { page, context };
}
async function openPanel(page) {
  await nav(page, "周辺を探索"); await expect(panel(page)).toHaveCount(1);
  if (!await panel(page).evaluate(el => el.open)) await panel(page).locator(":scope > summary").click();
}
async function fillPlan(page, purpose, day, time) {
  const before = await state(page);
  await purposeInput(page).fill(purpose);
  await editor(page).locator(".trip-plan-date input[type=number]").fill(String(day));
  await editor(page).getByLabel("帰還目安の時刻", { exact: true }).fill(time);
  assert.deepEqual(await state(page), before, "Editing a memo draft never changes the world");
}
async function savePlan(page, scenario, label) {
  const before = await state(page), members = await selected(page), focus = await focused(page);
  const s = await op(page, scenario, label, () => editor(page).locator(".trip-plan-save").click());
  assert.equal(s.minutes, before.minutes); assert.equal(s.seed, before.seed);
  assert.deepEqual(withoutPlanAllocation(s), withoutPlanAllocation(before), "A memo cannot change jobs, physical goods, memories or facts");
  assert.deepEqual(await selected(page), members); assert.equal(await focused(page), focus);
  return s;
}
async function saveReload(page, scenario, label) {
  await dismiss(page); const before = await state(page);
  await page.locator(".save-button").click();
  await page.getByRole("button", { name: "いまの暮らしを保存する", exact: true }).click();
  const pending = page.waitForEvent("download");
  await page.getByRole("button", { name: "ファイルに書き出す", exact: true }).click();
  const raw = await readFile(await (await pending).path(), "utf8"); assert.deepEqual(JSON.parse(raw), before);
  const path = join(output, `${label}.json`); await writeFile(path, raw);
  await page.keyboard.press("Escape"); await page.reload(); assert.deepEqual(await state(page), before);
  checkpoints.push({ scenario, label, path, minutes: before.minutes, sha256: createHash("sha256").update(raw).digest("hex") });
  operations.push({ scenario, label: `save-export-reload:${label}`, beforeMinutes: before.minutes, afterMinutes: before.minutes });
  return before;
}
async function capture(page, label, target, viewport) {
  if (viewport) await page.setViewportSize({ width: viewport[0], height: viewport[1] });
  await dismiss(page);
  if (target) await page.locator(target).first().evaluate(el => el.scrollIntoView({ block: "start" }));
  else await page.evaluate(() => window.scrollTo(0, 0));
  const file = join(output, `${label}.png`); await page.screenshot({ path: file, fullPage: !target }); captures.push(file);
}
async function audit(page, label, target, viewports = sizes) {
  const before = await state(page);
  for (const size of viewports) {
    await page.setViewportSize({ width: size[0], height: size[1] });
    const metrics = await page.evaluate(() => {
      const nav = document.querySelector(".navigation");
      return { width: document.documentElement.clientWidth, scroll: document.documentElement.scrollWidth,
        nav: nav ? { client: nav.clientHeight, scroll: nav.scrollHeight } : null };
    });
    assert.ok(metrics.scroll <= metrics.width + 1, `${label} ${size[0]} has no horizontal overflow`);
    assert.ok(!metrics.nav || metrics.nav.scroll <= metrics.nav.client + 1, `${label} ${size[0]} tabs cannot scroll vertically`);
    audits.push({ label, viewport: { width: size[0], height: size[1] }, ...metrics });
    await capture(page, `${label}-${size[0]}`, target);
    assert.deepEqual(await state(page), before);
  }
  await page.setViewportSize({ width: 390, height: 844 });
}
async function editPlan(page, purpose) {
  await openPanel(page);
  await planCard(page, purpose).getByRole("button", { name: "予定と補給を見る・編集", exact: true }).click();
  await expect(purposeInput(page)).toHaveValue(purpose);
}
async function move(page, scenario, ids, location, name) {
  await select(page, ids); await nav(page, "周辺を探索");
  const s = await op(page, scenario, `${name}へ実際に移動を予約`, () => page.locator(".destinations").getByRole("button", { name, exact: false }).click());
  const jobs = ids.map(id => person(s, id).action.id);
  return until(page, scenario, `${name}へ実際の道を移動`, x => ids.every(id => person(x, id).location === location && !jobs.includes(person(x, id).action?.id)));
}

try {
  const first = await imported("deadline-care-and-return", "tests/fixtures/two-night-evening-v3.json"), page = first.page;
  await select(page, ["aki", "ren"]); await openPanel(page);
  const originalPurpose = "二泊の補給と帰還";
  await fillPlan(page, originalPurpose, 3, "02:01");
  await expect(editor(page).locator(".trip-supply-total")).toContainText("携行・未予約 6食");
  await editor(page).locator(".trip-supply-details > summary").click();
  await expect(editor(page)).toContainText("現在の帰路目安 約51分");
  const beforePlan = await state(page); assert.equal(beforePlan.resources.food, 8);
  let s = await savePlan(page, "deadline-care-and-return", "二人の帰還目安をDay3 02:01に無時間で保存");
  const planId = s.travelPlans.entries[0].id;
  assert.deepEqual(plan(s, planId).residentIds, ["aki", "ren"]); assert.equal(plan(s, planId).returnAt, 3001);
  const unchanged = await state(page);
  await savePlan(page, "deadline-care-and-return", "同じ予定の重ね保存では世界全体が変わらない");
  assert.deepEqual(await state(page), unchanged);
  await audit(page, "created-plan-carried-food-budget", ".trip-plan-editor");
  await saveReload(page, "deadline-care-and-return", "plan-created-at-second-evening");
  check("真正の二泊目保存から、共通選択の二人・携行食だけの見通し・実際の帰路を持つ予定を無時間で保存し、同じ内容の再保存と再読込を維持");

  await select(page, ["aki", "ren"]); await nav(page, "いまの暮らし");
  const bodyBeforeSleep = await state(page);
  s = await op(page, "deadline-care-and-return", "予定とは別に二人の実際の睡眠を予約", () => sleep(page).click());
  assert.equal(s.minutes, bodyBeforeSleep.minutes);
  const sleepIds = ["aki", "ren"].map(id => person(s, id).action.id);
  s = await op(page, "deadline-care-and-return", "共通の5分で睡眠を実際に進める", () => page.locator(".advance-controls").getByRole("button", { name: "5分", exact: true }).click());
  assert.equal(s.minutes, 2525); assert.ok(["aki", "ren"].every(id => person(s, id).action.progress === 5));
  await saveReload(page, "deadline-care-and-return", "planned-sleep-after-five-minutes");
  await select(page, ["aki", "ren"]); await nav(page, "いまの暮らし");
  s = await op(page, "deadline-care-and-return", "夜を進め、帰還目安と自然な空腹の同時刻へ", () => page.locator(".night-button").click());
  assert.equal(s.minutes, 3001); assert.match(s.pauseReason, /アキ.*空腹/);
  assert.equal(plan(s, planId).remindedAt, 3001); assert.equal(reminderCount(s), 1);
  assert.ok(["aki", "ren"].every(id => person(s, id).location === "village" && !sleepIds.includes(person(s, id).action?.id)));
  const reminderLog = s.logs.find(log => log.title === "旅の予定の時刻");
  assert.deepEqual(reminderLog.actors, []); assert.deepEqual(reminderLog.witnesses, []);
  const attention = page.locator(".attention-board");
  const detail = attention.locator("details"); if (!await detail.evaluate(el => el.open)) await detail.locator("summary").click();
  await expect(attention).toContainText("利用できる食事は5食");
  await expect(attention).not.toContainText("利用できる食事は8食");
  await capture(page, "care-and-plan-reminder-local-food-390", undefined, [390, 844]);
  await saveReload(page, "deadline-care-and-return", "simultaneous-care-and-plan-reminder");
  for (const label of ["いまの暮らし", "住民たち", "拠点", "周辺を探索", "日誌"]) {
    await nav(page, label);
    await expect(page.getByRole("region", { name: "帰還目安の予定を確認", exact: true })).toContainText(originalPurpose);
  }
  await select(page, ["mio"]); const beforeJump = await state(page), selectionBeforeJump = await selected(page), focusBeforeJump = await focused(page);
  await page.getByRole("button", { name: `${originalPurpose}の予定を確認`, exact: true }).click();
  await expect(panel(page)).toHaveAttribute("open", ""); await expect(editor(page)).toBeFocused();
  await expect(editor(page).locator(".trip-plan-members strong")).toHaveText("アキ・レン");
  assert.deepEqual(await selected(page), selectionBeforeJump); assert.equal(await focused(page), focusBeforeJump); assert.deepEqual(await state(page), beforeJump);
  await audit(page, "reminder-opens-original-party-with-mio-selected", ".trip-plan-editor");
  await purposeInput(page).fill("保存しない下書き");
  await nav(page, "いまの暮らし"); await nav(page, "周辺を探索");
  assert.equal(await panel(page).evaluate(el => el.open), false, "Consumed openRequest cannot reopen or scroll an unrelated later visit");
  await expect(purposeInput(page)).toHaveValue("");
  const revisedPurpose = "二泊の補給を見直す";
  await editPlan(page, originalPurpose); await purposeInput(page).fill(revisedPurpose);
  s = await savePlan(page, "deadline-care-and-return", "過ぎた同じ時刻のまま目的だけを改める");
  assert.equal(plan(s, planId).returnAt, 3001); assert.equal(plan(s, planId).remindedAt, 3001); assert.equal(reminderCount(s), 1);
  await fillPlan(page, revisedPurpose, 3, "08:00");
  s = await savePlan(page, "deadline-care-and-return", "滞在を続けるため帰還目安をDay3 08:00へ変更");
  assert.equal(plan(s, planId).returnAt, 3360); assert.equal(plan(s, planId).remindedAt, undefined);
  await expect(page.getByRole("region", { name: "帰還目安の予定を確認", exact: true })).toHaveCount(0);
  await saveReload(page, "deadline-care-and-return", "plan-revised-to-next-morning");
  check("空腹と帰還目安が重なってもcareを優先し、予定通知を全画面へ残す。通知から元の参加者を開いても選択は変わらず、目的変更と期限延長を区別する");

  await select(page, ["aki"]); await nav(page, "いまの暮らし");
  const beforeMeal = await state(page), baseFood = beforeMeal.resources.food, packFood = beforeMeal.inventory.packs.aki.food;
  s = await op(page, "deadline-care-and-return", "アキへ実際の携行食を予約", () => meal(page).click());
  const mealId = person(s, "aki").action.id;
  s = await until(page, "deadline-care-and-return", "実際の15分の食事と仲間の食事を共通時計で完了", x => person(x, "aki").action?.id !== mealId);
  assert.equal(s.inventory.packs.aki.food, packFood - 1); assert.equal(s.resources.food, baseFood); assert.equal(reminderCount(s), 1);
  s = await op(page, "deadline-care-and-return", "食事後は実際の朝までの睡眠を別に予約", () => sleep(page).click());
  for (let n = 0; n < 8 && (await state(page)).minutes < 3360; n++) {
    const before = await state(page); s = await op(page, "deadline-care-and-return", "変更した目安へ共通時計を進める", () => page.locator(".night-button").click()); assert.ok(s.minutes > before.minutes);
  }
  assert.equal(s.minutes, 3360); assert.equal(plan(s, planId).remindedAt, 3360); assert.equal(reminderCount(s), 2);
  assert.match(s.pauseReason, /朝になりました/); assert.equal(plan(s, planId).closedAt, undefined);
  await select(page, ["aki", "ren"]); await nav(page, "周辺を探索");
  s = await op(page, "deadline-care-and-return", "予定とは別に二人へ安全な帰路を実行指示", () => page.getByRole("region", { name: "日帰りの道順を選ぶ", exact: true }).getByRole("button", { name: "川沿いの道で拠点へ帰る", exact: false }).click());
  const returnJobs = ["aki", "ren"].map(id => person(s, id).action.id);
  assert.ok(["aki", "ren"].every(id => person(s, id).action.path.join(",") === "meadow,road,home"));
  s = await until(page, "deadline-care-and-return", "現実の51分の帰路で帰還", x => ["aki", "ren"].every(id => person(x, id).location === "home" && !returnJobs.includes(person(x, id).action?.id)));
  assert.equal(s.minutes, 3411); assert.equal(plan(s, planId).closedAt, undefined); assert.equal(reminderCount(s), 2);
  await saveReload(page, "deadline-care-and-return", "actually-returned-plan-still-open");
  await openPanel(page);
  const beforeClose = await state(page);
  s = await op(page, "deadline-care-and-return", "実際に帰った後で予定だけを手動で閉じる", () => planCard(page, revisedPurpose).getByRole("button", { name: "予定を閉じる", exact: true }).click());
  assert.deepEqual(withoutPlanAllocation(s), withoutPlanAllocation(beforeClose));
  assert.equal(plan(s, planId).closedAt, 3411); await expect(page.locator(".trip-plan-reminders")).toHaveCount(0);
  await saveReload(page, "deadline-care-and-return", "closed-plan-after-real-homecoming");
  check("予定の延長後も食事・睡眠・帰還は実指示で進み、朝の停止を優先する。現実の帰還でもメモを自動完了せず、手動終了と保存を確認");
  await first.context.close();

  const second = await imported("separate-food-budgets", "tests/fixtures/two-night-evening-v3.json"), split = second.page;
  await select(split, ["ren"]); await nav(split, "いまの暮らし");
  const travel = split.locator(".travel-panel"); if (!await travel.evaluate(el => el.open)) await travel.locator(":scope > summary").click();
  await travel.locator(".travel-inputs select").selectOption("food"); await travel.locator("input[type=number]").fill("3"); await travel.locator(".travel-peer select").selectOption("aki");
  s = await op(split, "separate-food-budgets", "同所のレンからアキへ実際の食事3を受渡し", () => travel.getByRole("button", { name: "アキへ渡す", exact: true }).click());
  assert.equal(s.inventory.packs.aki.food, 6); assert.equal(s.inventory.packs.ren.food, 0);
  await move(split, "separate-food-budgets", ["ren"], "meadow", "川沿いの採集地");
  await move(split, "separate-food-budgets", ["ren"], "shelter", "木陰の迂回路");
  await select(split, ["aki", "ren"]); await openPanel(split); await fillPlan(split, "離れた二人の補給", 3, "08:00");
  await expect(editor(split).locator(".trip-supply-total")).toContainText("携行・未予約 6食");
  await expect(editor(split).locator(".trip-supply-total")).toContainText("不足目安 1食");
  const groups = editor(split).locator(".trip-supply-groups li");
  await expect(groups).toHaveCount(2);
  await expect(groups.filter({ hasText: "木陰の迂回路" })).toContainText("携行 0食 / 不足 1食");
  await expect(groups.filter({ hasText: "近隣の集落" })).toContainText("携行 6食 / 不足 0食");
  s = await savePlan(split, "separate-food-budgets", "離れた余剰と不足を相殺しない予定の見通しを保存");
  assert.equal(person(s, "aki").location, "village"); assert.equal(person(s, "ren").location, "shelter"); assert.equal(person(s, "mio").location, "home");
  await audit(split, "separated-food-surplus-and-shortfall", ".trip-supply-budget");
  await saveReload(split, "separate-food-budgets", "three-places-with-separate-food-budget");
  check("実受渡しと安全な実移動で二人が離れると、アキの携行6食でレンの0食の不足を相殺せず、三地点の保存を保つ");
  await second.context.close();

  const third = await imported("recruit-and-explicit-plan-members", "tests/fixtures/mio-village-v2.json"), joined = third.page;
  await select(joined, ["mio"]); await openPanel(joined); await fillPlan(joined, "ミオの集落訪問", 1, "12:00");
  s = await savePlan(joined, "recruit-and-explicit-plan-members", "加入前のミオ一人の予定を保存"); const membershipPlanId = s.travelPlans.entries[0].id;
  const originalRevision = plan(s, membershipPlanId).revisionId;
  await nav(joined, "いまの暮らし");
  const guide = joined.locator(".region-person").filter({ has: joined.getByRole("heading", { name: "道を知る住民", exact: true }) });
  const beforeJoin = await state(joined), chosenBeforeJoin = await selected(joined), focusBeforeJoin = await focused(joined);
  s = await op(joined, "recruit-and-explicit-plan-members", "信用を持つミオ本人が同じ分にハルを誘う", () => guide.getByRole("button", { name: "仲間に誘う（任意）", exact: true }).click());
  assert.equal(s.minutes, beforeJoin.minutes); assert.equal(s.residents.length, 4);
  assert.deepEqual(await selected(joined), chosenBeforeJoin); assert.equal(await focused(joined), focusBeforeJoin);
  assert.deepEqual(plan(s, membershipPlanId).residentIds, ["mio"]); assert.equal(plan(s, membershipPlanId).revisionId, originalRevision);
  await select(joined, ["mio", "village-guide"]); await editPlan(joined, "ミオの集落訪問");
  await expect(editor(joined).locator(".trip-plan-members strong")).toHaveText("ミオ");
  await expect(editor(joined).locator(".trip-plan-members-change")).toContainText("ミオ・ハル");
  const beforeAdopt = await state(joined);
  await editor(joined).getByRole("button", { name: "選択中の住民に変更", exact: true }).click();
  await expect(editor(joined).locator(".trip-plan-members strong")).toHaveText("ミオ・ハル");
  assert.deepEqual(await state(joined), beforeAdopt, "Adopting a selected roster edits only the draft until saved");
  s = await savePlan(joined, "recruit-and-explicit-plan-members", "明示した二人への予定変更を同じ分に保存");
  assert.deepEqual(plan(s, membershipPlanId).residentIds, ["mio", "village-guide"]);
  assert.equal(plan(s, membershipPlanId).updatedAt, person(s, "village-guide").joinedAt);
  assert.ok(plan(s, membershipPlanId).revisionId > person(s, "village-guide").joinedLogId);
  await audit(joined, "recruit-plan-explicit-membership-revision", ".trip-plan-editor", [[390, 844], [1280, 800]]);
  await saveReload(joined, "recruit-and-explicit-plan-members", "same-minute-recruit-and-explicit-plan-members");
  check("真正の信用済み旧保存から、加入前の予定を勝手に増員せず、共通選択を明示取込して加入より後の同一分改訂として保存する");
  await third.context.close();

  assert.deepEqual(errors, []); assert.ok(requests.every(item => item.url === URL));
  const report = { status: "passed", sha256, bytes: Buffer.byteLength(html),
    method: "Three normal UI branches in independent offline Chromium contexts. Genuine prior exports are imported through file input. No engine API, state editing or browser-storage writes prepare gameplay; state reads only assert results.",
    fixtures, checks, operations, checkpoints, audits, captures, errors, requests };
  await writeFile(join(output, "report.json"), JSON.stringify(report, null, 2));
  console.log(JSON.stringify({ status: "passed", sha256, checks: checks.length, operations: operations.length, checkpoints: checkpoints.length, audits: audits.length, captures: captures.length, output }));
} catch (error) {
  if (activePage && !activePage.isClosed()) await activePage.screenshot({ path: join(output, "failure.png"), fullPage: true }).catch(() => {});
  await writeFile(join(output, "failure.json"), JSON.stringify({ status: "failed", sha256, error: String(error), stack: error.stack, fixtures, checks, operations, checkpoints, audits, captures, errors, requests }, null, 2));
  throw error;
} finally { await browser.close(); }
