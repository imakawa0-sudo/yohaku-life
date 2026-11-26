// Normal game, UI orders and time controls, with isolated offline saves.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { chromium, expect } from "@playwright/test";

const html = await readFile(process.env.REFORM_HTML || "dist/yohaku.html");
const output = resolve(process.env.PLAYTEST_OUTPUT || "/tmp/yohaku-room-stay");
await mkdir(output, { recursive: true });
const entry = "https://room-stay.offline.test/";
const report = {
  sha256: createHash("sha256").update(html).digest("hex"),
  runs: [],
  errors: [],
};
const button = (scope, name) =>
  scope.getByRole("button", { name, exact: true });
const settled = (page) =>
  expect(page.locator(".rf-app")).toHaveAttribute("aria-busy", "false");
async function click(page, name, scope = page) {
  await button(scope, name).click();
  await settled(page);
}
async function savedGame(page) {
  await settled(page);
  return page.evaluate(() => {
    const library = JSON.parse(
      localStorage.getItem("yohaku-reform-library-v2"),
    );
    return library.slots.find((slot) => slot.id === library.activeId).game;
  });
}
async function showHistory(page) {
  await click(page, "住まい");
  const panel = page.getByRole("region", { name: "一室の寒さ対策" });
  const summary = panel
    .locator("summary")
    .filter({ hasText: "部屋ごとの滞在時間" });
  const details = summary.locator("..");
  if (!(await details.evaluate((el) => el.open))) await summary.click();
  return details;
}
async function checkPeriods(history, yesterday, today) {
  const ranges = history.getByLabel("記録した期間").locator("dd");
  await expect(ranges).toHaveText([yesterday, today]);
}
async function times(history, room, residents) {
  await history
    .getByRole("combobox", { name: "履歴を見る部屋", exact: true })
    .selectOption(room);
  const result = {};
  for (const resident of residents) {
    const row = history
      .getByRole("rowheader", { name: resident, exact: true })
      .locator("..");
    const cells = await row.getByRole("cell").allTextContents();
    assert.equal(cells.length, 2, resident + "の昨日・今日");
    result[resident] = cells.map((text) => {
      if (text === "記録なし") return null;
      const number = /^(\d+)分$/.exec(text);
      assert.ok(number, text);
      return Number(number[1]);
    });
  }
  return result;
}
async function capture(page, history, name) {
  await history.evaluate((el) => el.scrollIntoView({ block: "center" }));
  const width = page.viewportSize().width;
  for (const control of [
    history,
    history.getByRole("combobox"),
    history.getByRole("table"),
  ]) {
    const bounds = await control.boundingBox();
    assert.ok(bounds && bounds.x >= 0 && bounds.x + bounds.width <= width + 1);
    assert.ok(
      await control.evaluate((el) => el.scrollWidth <= el.clientWidth + 1),
    );
  }
  assert.ok(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth + 1,
    ),
  );
  await page.screenshot({ path: resolve(output, name + "-" + width + ".png") });
}

async function exercise(context, width) {
  const page = await context.newPage();
  page.setDefaultTimeout(8000);
  page.on("pageerror", (error) => report.errors.push(error.message));
  page.on("console", (message) => {
    if (message.type() === "error") report.errors.push(message.text());
  });
  await page.goto(entry);
  await click(page, "木工の二人");
  await click(page, "この朝を始める");
  const initial = await savedGame(page);
  const names = initial.actors.map((a) => a.person.name);
  const rest = button(page, "ひと眠りする").locator("..");
  await expect(rest.locator("small")).toContainText(/休息先の寒さ対策.*未対策/);
  await expect(rest.locator("small")).toContainText(/初霜（\d+日目）から/);
  await expect(rest.locator('option[value="mat-1"]')).toHaveText(
    /寝室.*未対策/,
  );
  let history = await showHistory(page);
  await checkPeriods(history, "記録なし", "記録なし");
  assert.deepEqual(
    await times(history, "living", names),
    Object.fromEntries(names.map((name) => [name, [null, null]])),
  );
  assert.equal(
    await history.getByRole("combobox").locator('option[value="yard"]').count(),
    0,
  );
  await history.getByRole("combobox").selectOption("bedroom");
  assert.deepEqual(await savedGame(page), initial);

  await click(page, "暮らし");
  const commands = page.getByRole("region", { name: "行動の指示" });
  await click(page, "仕事", commands);
  await commands
    .locator('button[data-kind="work"][data-target="wood"]')
    .click();
  await settled(page);
  const roster = page.getByRole("group", { name: "住民を選ぶ" });
  await click(page, names[1], roster);
  await click(page, "寝室の入口へ移動");
  await click(page, "次の行動完了まで進める");
  const arrived = await savedGame(page);
  assert.equal(arrived.actors[1].room, "bedroom");
  assert.ok(arrived.time > initial.time && arrived.time < initial.time + 10);
  history = await showHistory(page);
  const beforeLiving = await times(history, "living", names);
  const beforeBedroom = await times(history, "bedroom", names);

  await click(page, "暮らし");
  await click(page, names[1], roster);
  await click(page, "仕事", commands);
  await commands
    .locator('button[data-kind="work"][data-target="wood"]')
    .click();
  await settled(page);
  await click(page, "15分進める");
  const afternoon = await savedGame(page);
  assert.equal(afternoon.time, arrived.time + 15);
  history = await showHistory(page);
  const living = await times(history, "living", names);
  const bedroom = await times(history, "bedroom", names);
  for (const [i, name] of names.entries()) {
    assert.equal(living[name][0], null);
    assert.equal(bedroom[name][0], null);
    assert.equal(living[name][1] - beforeLiving[name][1], i === 0 ? 15 : 0);
    assert.equal(bedroom[name][1] - beforeBedroom[name][1], i === 1 ? 15 : 0);
  }
  const clock = new Date(afternoon.time * 60000).toISOString().slice(11, 16);
  await checkPeriods(history, "記録なし", "1日目 08:00〜" + clock);
  await capture(page, history, "first-morning");
  assert.deepEqual(await savedGame(page), afternoon);
  await page.reload();
  assert.deepEqual(await savedGame(page), afternoon);
  history = await showHistory(page);
  assert.deepEqual(await times(history, "bedroom", names), bedroom);

  await click(page, "暮らし");
  await click(page, "翌朝まで進める");
  const morning = await savedGame(page);
  assert.equal(morning.time, 1440 + 480);
  history = await showHistory(page);
  await checkPeriods(history, "1日目 08:00〜24:00", "2日目 00:00〜08:00");
  const yesterdayAndToday = {};
  for (const [id, earlier] of [
    ["living", living],
    ["bedroom", bedroom],
  ]) {
    const values = await times(history, id, names);
    for (const name of names) {
      assert.ok(
        values[name][0] !== null &&
          values[name][0] >= earlier[name][1] &&
          values[name][0] <= 960,
      );
      assert.ok(values[name][1] !== null && values[name][1] <= 480);
    }
    yesterdayAndToday[id] = values;
  }
  await capture(page, history, "second-morning");
  await page.reload();
  assert.deepEqual(await savedGame(page), morning);
  history = await showHistory(page);
  for (const id of ["living", "bedroom"]) {
    assert.deepEqual(await times(history, id, names), yesterdayAndToday[id]);
  }
  // Import our isolated test save with the optional field omitted, as in older saves.
  if (width === 1280) {
    await click(page, "手帳");
    const pending = page.waitForEvent("download");
    await click(page, "保存を書き出す");
    const download = await pending;
    const legacy = JSON.parse(await readFile(await download.path(), "utf8"));
    delete legacy.slot.game.housing.roomStay;
    delete legacy.slot.origin.housing.roomStay;
    await page.locator('input[type="file"]').setInputFiles({
      name: "旧形式の試遊用スロット.json",
      mimeType: "application/json",
      buffer: Buffer.from(JSON.stringify(legacy)),
    });
    await expect
      .poll(async () => (await savedGame(page)).housing.roomStay)
      .toBeUndefined();
    history = await showHistory(page);
    await checkPeriods(history, "記録なし", "記録なし");
    await click(page, "暮らし");
    await click(page, "5分進める");
    history = await showHistory(page);
    await checkPeriods(history, "記録なし", "2日目 08:00〜08:05");
    const values = await times(history, "living", names);
    for (const name of names) {
      assert.equal(values[name][0], null);
      assert.ok(values[name][1] !== null && values[name][1] <= 5);
    }
    report.legacyResume = "2日目 08:00〜08:05";
  }
  report.runs.push({
    width,
    start: initial.time,
    arrived: arrived.time,
    firstWindowEnd: afternoon.time,
    living,
    bedroom,
    yesterdayAndToday,
  });
}

const browser = await chromium.launch({
  headless: true,
  executablePath: process.env.CHROMIUM_PATH || "/usr/bin/chromium",
  args: ["--no-sandbox"],
});
try {
  for (const width of [1280, 320]) {
    const context = await browser.newContext({
      offline: true,
      viewport: { width, height: width === 1280 ? 900 : 844 },
    });
    await context.route("**/*", async (route) => {
      if (route.request().url() === entry) {
        await route.fulfill({
          contentType: "text/html; charset=utf-8",
          body: html,
        });
      } else {
        report.errors.push("意図しない通信 " + route.request().url());
        await route.abort();
      }
    });
    try {
      await exercise(context, width);
    } finally {
      await context.close();
    }
  }
  assert.deepEqual(report.errors, []);
  console.log(JSON.stringify(report, null, 2));
} finally {
  await browser.close();
  await writeFile(
    resolve(output, "result.json"),
    JSON.stringify(report, null, 2) + "\n",
  );
}
