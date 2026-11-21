/** Seven-day comparison driven only by real controls in the built standalone HTML. */
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { chromium, expect } from "@playwright/test";

const artifactRoot = process.env.WEEK_ARTIFACT_DIR || "/workspace/research/p2-region-development/week";
const days = Number(process.env.WEEK_DAYS || 7);
const only = process.env.WEEK_BRANCH;
const URL = "http://yohaku.local/";
const AUTO = "yohaku-autosave-v1";
const html = await readFile("dist/yohaku-v53.html", "utf8");
const sha = createHash("sha256").update(html).digest("hex");
if (process.env.EXPECT_HTML_SHA) assert.equal(sha, process.env.EXPECT_HTML_SHA, "Use the agreed latest standalone artifact");
await mkdir(artifactRoot, { recursive: true });
await writeFile(join(artifactRoot, "yohaku.html"), html);
await writeFile(join(artifactRoot, "artifact.json"), JSON.stringify({ sha, bytes: Buffer.byteLength(html), days, route: "offline single HTML; real UI only" }, null, 2));
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || "/usr/bin/chromium", headless: true, args: ["--no-sandbox"] });
const names = { aki: "アキ", mio: "ミオ", ren: "レン" };
const ALL = Object.keys(names);
const BASE = new Set(["home", "kitchen", "bedroom", "garden"]);
const hash = value => createHash("sha256").update(JSON.stringify(value)).digest("hex");
const observedInitial = new WeakMap();
const state = async page => (await page.evaluate(key => JSON.parse(localStorage.getItem(key)), AUTO)) ?? observedInitial.get(page);
const resident = (s, id = "aki") => s.residents.find(r => r.id === id);
const count = (s, key) => s.resources[key] + Object.values(s.inventory.packs).reduce((n, p) => n + p[key], 0)
  + Object.values(s.inventory.ground).reduce((n, p) => n + p[key], 0);
function summary(s) {
  return {
    minutes: s.minutes, day: Math.floor(s.minutes / 1440) + 1, time: `${String(Math.floor(s.minutes % 1440 / 60)).padStart(2, "0")}:${String(s.minutes % 60).padStart(2, "0")}`,
    base: s.resources, total: Object.fromEntries(["food", "ingredients", "medicine", "scrap"].map(k => [k, count(s, k)])),
    residents: s.residents.map(r => ({ id: r.id, location: r.location, hp: r.hp, hunger: r.hunger, energy: r.energy, mood: r.mood,
      pack: s.inventory.packs[r.id], action: r.action && { id: r.action.id, kind: r.action.kind, progress: r.action.progress, duration: r.action.duration, reserved: r.action.reserved, source: r.action.reservationSource },
      suspended: r.suspended && { id: r.suspended.id, kind: r.suspended.kind, reserved: r.suspended.reserved } })),
    works: s.life?.crafts.length ?? 0, displayed: s.life?.crafts.filter(c => c.displayedAt !== undefined).length ?? 0,
    region: s.region, logCount: s.logs.length, experienceCount: s.life?.events.length ?? 0, seed: s.seed, ended: s.ended,
  };
}

const results = [];
let firstInitial;
try {
  for (const branch of ["home", "travel"].filter(id => !only || only === id)) {
    const directory = join(artifactRoot, branch);
    await mkdir(directory, { recursive: true });
    const context = await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true, offline: true, acceptDownloads: true });
    const errors = [], requests = [], operations = [], checkpoints = [], exports = [];
    await context.route("**/*", async route => {
      requests.push(route.request().url());
      if (route.request().url() === URL) await route.fulfill({ contentType: "text/html", body: html });
      else await route.abort();
    });
    const page = await context.newPage();
    page.on("pageerror", e => errors.push(e.message));
    page.setDefaultTimeout(10000);
    await page.goto(URL);
    await expect(page.locator(".header .time")).toHaveText("08:00");
    // A brand-new world has no autosave until its first real command. Obtain
    // its initial state through the visible export control, never an API call
    // or storage injection, so both branches can still be compared exactly.
    await page.locator(".save-button").click();
    const initialDownloadEvent = page.waitForEvent("download");
    await page.getByRole("button", { name: "ファイルに書き出す", exact: true }).click();
    const initialDownload = await initialDownloadEvent;
    const initialExportPath = join(directory, "initial-export.json");
    await initialDownload.saveAs(initialExportPath);
    const initial = JSON.parse(await readFile(initialExportPath, "utf8"));
    observedInitial.set(page, initial);
    await page.keyboard.press("Escape");
    assert.equal(initial.minutes, 480);
    operations.push({ action: "initial-ui-export", minutes: initial.minutes, hash: hash(initial) });
    exports.push({ label: "initial", path: initialExportPath, minutes: initial.minutes, hash: hash(initial) });
    if (firstInitial) assert.deepEqual(initial, firstInitial, "Both branches start from the identical new-game state");
    else firstInitial = initial;
    await writeFile(join(directory, "initial.json"), JSON.stringify(initial, null, 2));

    async function click(locator, label, expectation = "any") {
      const close = page.getByRole("button", { name: "通知を閉じる", exact: true });
      const dialogOpen = await page.getByRole("dialog").isVisible().catch(() => false);
      if (!dialogOpen && await close.isVisible().catch(() => false)) {
        const before = await state(page);
        await close.click();
        assert.deepEqual(await state(page), before);
        operations.push({ action: "close-notice", minutes: before.minutes });
      }
      const before = await state(page);
      const title = await locator.getAttribute("title");
      assert.equal(await locator.isEnabled(), true, `${label}: ${title ?? "disabled"}`);
      await locator.click();
      if (expectation === "advance") await expect.poll(async () => (await state(page)).minutes).toBeGreaterThan(before.minutes);
      const after = await state(page);
      if (expectation === "read") assert.deepEqual(after, before, `${label} must not alter the world`);
      if (expectation === "command") {
        assert.equal(after.minutes, before.minutes, `${label} must not advance time`);
        assert.notEqual(hash(after), hash(before), `${label} must issue a real accepted command`);
      }
      operations.push({ action: label, beforeMinutes: before.minutes, afterMinutes: after.minutes, beforeHash: hash(before), afterHash: hash(after) });
      assert.equal(after.ended, false, `${label} must retain the playable world`);
      return after;
    }
    async function nav(label) {
      await click(page.getByRole("navigation").getByRole("button", { name: label, exact: true }), `view:${label}`, "read");
    }
    async function select(ids) {
      for (const id of ALL) {
        const card = page.locator(`.residents-list .resident-card[aria-label^="${names[id]}を"]`);
        const picked = await card.getAttribute("aria-pressed") === "true";
        if (picked !== ids.includes(id)) await click(card, `select:${id}`, "read");
      }
    }
    async function action(name) {
      await nav("いまの暮らし");
      const target = page.locator(".action-grid").getByRole("button", { name, exact: false });
      return click(target, `action:${String(name)}`, "command");
    }
    async function next() { return click(page.locator(".next-button"), "next-boundary", "advance"); }
    async function finishJobs(ids) {
      const s = await state(page);
      const jobs = new Map(ids.map(id => [id, resident(s, id).action?.id]).filter(([, id]) => id !== undefined));
      for (let n = 0; n < 90; n++) {
        const current = await state(page);
        if ([...jobs].every(([id, job]) => resident(current, id).action?.id !== job)) return current;
        await next();
      }
      throw new Error(`Jobs did not finish: ${JSON.stringify(ids)}`);
    }
    async function transfer(id, key, amount, direction) {
      if (amount < 1) return;
      await select([id]);
      await nav("いまの暮らし");
      const panel = page.locator(".travel-panel");
      if (!(await panel.getAttribute("open") !== null)) await click(panel.locator("summary"), "open-travel-panel", "read");
      const before = await state(page);
      await panel.locator("select").first().selectOption(key);
      await panel.getByRole("spinbutton").fill(String(amount));
      assert.deepEqual(await state(page), before, "Changing a transfer draft cannot alter inventory");
      operations.push({ action: `draft-transfer:${key}:${amount}`, minutes: before.minutes });
      const label = direction === "out" ? "倉庫から持ち出す" : "倉庫へしまう";
      return click(panel.getByRole("button", { name: label, exact: true }), `${label}:${id}:${key}:${amount}`, "command");
    }
    async function maybeTransferOut(id, key, maximum) {
      const s = await state(page);
      const reserved = s.residents.flatMap(r => [r.action, r.suspended]).reduce((n, a) => n + (a && (a.reservationSource ?? "base") === "base" ? a.reserved?.[key] ?? 0 : 0), 0);
      await transfer(id, key, Math.max(0, Math.min(maximum, Math.floor(s.resources[key] - reserved))), "out");
    }
    async function storePack(id = "aki") {
      for (const key of ["food", "ingredients", "medicine", "scrap"]) {
        const s = await state(page);
        await transfer(id, key, s.inventory.packs[id][key], "in");
      }
    }
    async function route(target, ids = ["aki"], ordinaryReturn = false) {
      await select(ids);
      if (ordinaryReturn) {
        await nav("いまの暮らし");
        const button = page.locator(".action-grid").getByRole("button", { name: "拠点へ帰る", exact: false });
        await expect(button).toContainText("51分");
        const ordered = await click(button, "ordinary-safe-return", "command");
        for (const id of ids) {
          assert.ok(resident(ordered, id).action.path.includes("meadow"));
          assert.equal(resident(ordered, id).action.path.includes("ruins"), false, "Ordinary return avoids the occupied cache");
        }
        return finishJobs(ids);
      }
      await nav("周辺を探索");
      const label = target === "village" ? "川沿いの道で集落へ" : "川沿いの道で拠点へ帰る";
      await click(page.locator(".daytrip-routes").getByRole("button", { name: label, exact: true }), `route:${target}`, "command");
      return finishJobs(ids);
    }
    async function meadow(ids = ["aki"]) {
      await select(ids);
      await nav("周辺を探索");
      await click(page.getByRole("button", { name: "川沿いの採集地へ移動を予約", exact: true }), "map:meadow", "command");
      return finishJobs(ids);
    }
    async function optionalNPC(npcName, label) {
      await nav("いまの暮らし");
      const card = page.locator(".region-person").filter({ has: page.getByRole("heading", { name: npcName, exact: true }) });
      const button = card.getByRole("button", { name: label, exact: true });
      if (await button.isEnabled()) return click(button, `npc:${npcName}:${label}`, "command");
      const s = await state(page);
      operations.push({ action: `optional-unavailable:${npcName}:${label}`, reason: await button.getAttribute("title"), minutes: s.minutes });
    }
    async function screenshot(label) {
      const size = await page.evaluate(() => ({ width: document.documentElement.clientWidth, scroll: document.documentElement.scrollWidth }));
      assert.ok(size.scroll <= size.width + 1, `No horizontal overflow: ${JSON.stringify(size)}`);
      await page.screenshot({ path: join(directory, `${label}.png`), fullPage: true });
      return size;
    }
    async function saveCheckpoint(label, capture = false) {
      await nav("いまの暮らし");
      const before = await state(page);
      await click(page.locator(".save-button"), `save-dialog:${label}`, "read");
      const downloadEvent = page.waitForEvent("download");
      await click(page.getByRole("button", { name: "ファイルに書き出す", exact: true }), `export:${label}`, "read");
      const download = await downloadEvent;
      const path = join(directory, `${label}.json`);
      await download.saveAs(path);
      assert.deepEqual(JSON.parse(await readFile(path, "utf8")), before, "Actual downloaded JSON matches the played world");
      exports.push({ label, path, minutes: before.minutes, hash: hash(before) });
      await click(page.getByRole("button", { name: "いまの暮らしを保存する", exact: true }), `manual-save:${label}`, "read");
      await page.keyboard.press("Escape");
      assert.deepEqual(await state(page), before);
      await page.reload();
      await expect(page.locator(".header .time")).toBeVisible();
      assert.deepEqual(await state(page), before, "Reload uses the actual player's saved state without an injected fixture");
      operations.push({ action: `reload:${label}`, minutes: before.minutes, hash: hash(before) });
      checkpoints.push({ label, ...summary(before) });
      if (capture) await screenshot(label);
    }
    async function dinnerAndMorning(day) {
      const dayStart = (day - 1) * 1440;
      const bedtime = dayStart + 1320;
      await nav("いまの暮らし");
      for (let n = 0; n < 35; n++) {
        const s = await state(page);
        if (s.minutes >= bedtime) break;
        const aki = resident(s);
        if (aki.hunger < 40 && aki.action?.kind !== "eat") {
          await select(["aki"]);
          await action(/^(食事をとる|一緒に食事|それぞれ食事)/);
          await finishJobs(["aki"]);
          continue;
        }
        if (aki.energy < 20 && !aki.action) {
          await select(["aki"]); await action("ゆっくり休む"); await finishJobs(["aki"]); continue;
        }
        if (s.minutes % 1440 < 1080) await click(page.locator(".night-button"), "until-evening", "advance");
        else await click(page.locator(".advance-controls").getByRole("button", { name: "1時間", exact: true }), "evening-hour", "advance");
      }
      let s = await state(page);
      assert.ok(s.residents.every(r => BASE.has(r.location)), "All residents returned before sleeping");
      // A regular evening meal gives everyone enough food for the night; this
      // is a player choice, not an injected hunger or calorie update.
      await select(ALL);
      await action(/^(食事をとる|一緒に食事|それぞれ食事)/);
      await finishJobs(ALL);
      const target = dayStart + 1440 + 480;
      for (let n = 0; n < 25; n++) {
        s = await state(page);
        if (s.minutes >= target) break;
        await select(ALL);
        await click(page.locator(".night-button"), "sleep-until-morning", "advance");
      }
      s = await state(page);
      assert.equal(s.minutes, target, "The full played day reaches exactly the next 08:00");
    }

    try {
      for (let day = 1; day <= days; day++) {
        await select(["aki"]);
        await nav("いまの暮らし");
        const morning = await state(page);
        assert.equal(morning.minutes, (day - 1) * 1440 + 480);
        if (branch === "home") {
          if (day === 2 && !morning.flags.decorated && morning.resources.scrap >= 2) {
            await action("自分の場所を整える"); await finishJobs(["aki"]);
          } else if (day === 3 && morning.flags.decorated) {
            await action("作品を飾る"); await finishJobs(["aki"]);
          } else if (day === 4 && resident(morning, "mio").location === resident(morning).location && !resident(morning, "mio").suspended) {
            await select(["aki", "mio"]); await action("仲間と話す"); await finishJobs(["aki", "mio"]); await select(["aki"]);
          } else {
            await action(day === 6 ? "ゆっくり休む" : "木彫りをする"); await finishJobs(["aki"]);
          }
        } else {
          const companions = day === 4 ? ["aki", "ren"] : ["aki"];
          const notDelivered = !morning.region?.request;
          await maybeTransferOut("aki", "food", day === 1 && notDelivered ? 4 : 1);
          await maybeTransferOut("aki", "medicine", 1);
          await maybeTransferOut("aki", "scrap", day === 1 ? 3 : 2);
          if (companions.includes("ren")) await maybeTransferOut("ren", "food", 1);
          if ([1, 3, 5].includes(day)) {
            await route("village", companions);
            await select(["aki"]);
            await optionalNPC("道を知る住民", "話を聞く");
            if (day === 1) await optionalNPC("道を知る住民", "食事3を届ける（任意）");
            await optionalNPC("集落の商い手", "話を聞く");
            await optionalNPC("集落の商い手", "資材2を食事3と交換");
            if (day === 1) await optionalNPC("集落の商い手", "資材1を手当用品1と交換");
            if (day === 1) await saveCheckpoint("day-1-village", true);
          } else {
            await meadow(companions);
            await action("川辺で採集する"); await finishJobs(companions);
            if (companions.length > 1) {
              const gathered = await state(page);
              const harvest = gathered.region.harvests.at(-1);
              const entries = gathered.logs.filter(entry => entry.time === harvest.time && entry.title === "川沿いの収穫");
              assert.equal(entries.length, 1, "The collective gathering has one success record");
              assert.deepEqual([...entries[0].actors].sort(), [...companions].sort());
              const experiences = gathered.life.events.filter(entry => entry.time === harvest.time && entry.kind === "supply" && entry.location === "meadow");
              assert.equal(experiences.length, 1);
              assert.deepEqual([...experiences[0].actors].sort(), [...companions].sort());
              assert.equal(gathered.logs.some(entry => entry.time === harvest.time && entry.title === "今日の収穫は済んでいる"), false);
            }
            if ([2, 4, 6].includes(day)) { await action("景色を眺める"); await finishJobs(companions); }
            if (day === 4) await saveCheckpoint("day-4-shared-landscape", true);
          }
          await route("home", companions, day === 1);
          for (const id of companions) await storePack(id);
          await select(["aki"]);
          if ([2, 7].includes(day)) { await action("木彫りをする"); await finishJobs(["aki"]); }
        }
        await dinnerAndMorning(day);
        await saveCheckpoint(`day-${day + 1}-morning`, day === days);
        console.log(`${branch}: day ${day} played through next morning`);
      }
      const final = await state(page);
      assert.equal(final.minutes, days * 1440 + 480);
      assert.deepEqual(errors, []);
      assert.ok(requests.every(url => url === URL), "Only the single offline HTML was requested");
      const report = { branch, sha, success: true, operationCount: operations.length, operations, checkpoints, exports, final: summary(final), errors, requests,
        limits: "AI-directed UI play; not a human fun/learnability study. These branches differ in food, rest, companion and travel choices; outcomes cannot be attributed to travel alone." };
      await writeFile(join(directory, "report.json"), JSON.stringify(report, null, 2));
      results.push({ branch, success: true, operationCount: operations.length, exports: exports.length, final: report.final });
    } catch (error) {
      const current = await state(page).catch(() => null);
      await page.screenshot({ path: join(directory, "failure.png"), fullPage: true }).catch(() => {});
      await writeFile(join(directory, "failure.json"), JSON.stringify({ branch, sha, error: error.stack, current: current && summary(current), operations, checkpoints, exports, errors, requests }, null, 2));
      throw error;
    } finally { await context.close(); }
  }
  // A corrected driver may rerun only the failed branch. Reuse the other
  // successful branch only when its artifact and actual initial export match.
  if (only) for (const branch of ["home", "travel"].filter(id => id !== only)) {
    try {
      const prior = JSON.parse(await readFile(join(artifactRoot, branch, "report.json"), "utf8"));
      assert.equal(prior.sha, sha);
      assert.equal(prior.success, true);
      const priorInitial = JSON.parse(await readFile(join(artifactRoot, branch, "initial-export.json"), "utf8"));
      assert.deepEqual(priorInitial, firstInitial);
      results.push({ branch, success: true, operationCount: prior.operationCount, exports: prior.exports.length, final: prior.final });
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
    }
  }
  await writeFile(join(artifactRoot, "comparison.json"), JSON.stringify({ sha, days, results }, null, 2));
  console.log(JSON.stringify(results.map(r => ({ branch: r.branch, operations: r.operationCount, exports: r.exports, finalMinutes: r.final.minutes, total: r.final.total })), null, 2));
} finally { await browser.close(); }
