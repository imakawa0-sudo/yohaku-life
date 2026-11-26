// Exercise placement and direct woodworking orders in a clean standalone game.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { chromium, expect } from "@playwright/test";

const html = await readFile(process.env.REFORM_HTML || "dist/yohaku.html");
const output = resolve(
  process.env.PLAYTEST_OUTPUT || "/tmp/yohaku-workbench-playtest",
);
const entry = "https://workbench.offline.test/";
const report = {
  sha256: createHash("sha256").update(html).digest("hex"),
  runs: [],
  errors: [],
};
const button = (scope, name) =>
  scope.getByRole("button", { name, exact: true });
await mkdir(output, { recursive: true });

async function savedGame(page) {
  await expect(page.locator(".rf-app")).toHaveAttribute("aria-busy", "false");
  return page.evaluate(() => {
    const library = JSON.parse(
      localStorage.getItem("yohaku-reform-library-v2"),
    );
    return library.slots.find((slot) => slot.id === library.activeId).game;
  });
}

async function capture(page, area, label) {
  await area.evaluate((el) => el.scrollIntoView({ block: "center" }));
  const width = page.viewportSize().width;
  const bounds = await area.boundingBox();
  assert.ok(bounds && bounds.x >= 0 && bounds.x + bounds.width <= width + 1);
  assert.ok(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth + 1,
    ),
  );
  await page.screenshot({
    path: resolve(output, label + "-" + width + ".png"),
  });
}

async function openPage(context) {
  const page = await context.newPage();
  page.setDefaultTimeout(8000);
  page.on("pageerror", (error) => report.errors.push(error.message));
  page.on("console", (message) => {
    if (message.type() === "error") report.errors.push(message.text());
  });
  await page.goto(entry);
  return page;
}

async function exercise(context, width) {
  const page = await openPage(context);
  await button(page, "木工の二人").click();
  await button(page, "この朝を始める").click();
  const initial = await savedGame(page);
  const [first, second] = initial.actors.map((actor) => actor.person);
  const panel = page.getByRole("region", { name: "行動の指示" });
  const basicWood = panel.locator(
    'button[data-kind="work"][data-target="wood"]',
  );
  const row = basicWood.locator("..");
  const choice = row.getByRole("combobox", {
    name: "木材を整える場所",
    exact: true,
  });
  const workers = page.getByRole("group", { name: "住民を選ぶ" });
  await button(panel, "仕事").click();
  await expect(basicWood).toBeEnabled();
  await expect(choice).toHaveCount(0);

  await button(page, "住まい").click();
  const editor = page.getByRole("region", { name: "住まいの間取り" });
  await button(editor, "裏庭").click();
  const newFixture = editor.getByLabel("新しく置く設備", { exact: true });
  await newFixture.selectOption({ label: "木工台（木材3）" });
  await button(editor, "この部屋に置く").click();
  await expect(button(editor, "木工台")).toBeVisible();
  const installed = await savedGame(page);
  assert.equal(installed.time, initial.time);
  assert.equal(installed.wood, initial.wood - 3);
  const bench = installed.house.rooms
    .find((room) => room.id === "yard")
    .fixtures.find((fixture) => fixture.kind === "workbench");
  assert.ok(bench);
  await button(page, "暮らし").click();
  await button(panel, "仕事").click();
  await expect(choice).toHaveValue("");
  await expect(row).toContainText("移動なし");
  await choice.selectOption(bench.id);
  const preview = await row.locator("small").innerText();
  assert.match(preview, /裏庭・木工台/);
  const times = preview.match(/移動(\d+)分 ＋ 木工(\d+)分（合計(\d+)分）/);
  assert.ok(times, preview);
  const [, move, work, total] = times.map(Number);
  assert.ok(move > 0 && work > 0 && move + work === total);
  await capture(page, row, "workbench");
  await basicWood.click();
  const reserved = await savedGame(page);
  assert.equal(reserved.time, initial.time);
  assert.equal(reserved.wood, installed.wood);
  const task = reserved.actors[0].task;
  assert.deepEqual(
    [task.kind, task.target, task.total],
    ["work", "wood", work],
  );
  assert.equal(task.station, JSON.stringify(["slot", "yard", bench.id, 0]));

  await button(workers, second.name).click();
  await button(panel, "仕事").click();
  await choice.selectOption(bench.id);
  await expect(basicWood).toBeDisabled();
  await expect(row.locator("small")).toContainText("予約");
  await capture(page, row, "occupied");
  await choice.selectOption("");
  await expect(basicWood).toBeEnabled();

  await button(workers, first.name).click();
  await button(page, "5分進める").click();
  const midway = await savedGame(page);
  assert.equal(midway.time, reserved.time + 5);
  assert.equal(midway.actors[0].task.station, task.station);
  await page.reload();
  assert.deepEqual(await savedGame(page), midway);
  let finished = midway;
  while (finished.actors[0].task?.station === task.station) {
    await button(page, "次の行動完了まで進める").click();
    const next = await savedGame(page);
    assert.ok(next.time > finished.time && next.time <= reserved.time + total);
    finished = next;
  }
  assert.equal(finished.time - reserved.time, total);
  assert.ok(finished.wood > reserved.wood);
  assert.ok(
    finished.actors[0].xp.wood > reserved.actors[0].xp.wood ||
      finished.actors[0].person.skills.wood >
        reserved.actors[0].person.skills.wood,
  );
  assert.equal(finished.actors[0].room, "yard");
  await page.reload();
  assert.deepEqual(await savedGame(page), finished);
  report.runs.push({
    width,
    move,
    work,
    total,
    buildingCost: initial.wood - installed.wood,
    initialWood: initial.wood,
    completedWood: finished.wood,
    first: first.name,
  });
}

async function recoveryPanel(page) {
  await button(page, "住まい").click();
  const summary = page
    .locator("summary")
    .filter({ hasText: "木工台の解体と回収" });
  const details = summary.locator("..");
  if (!(await details.evaluate((el) => el.open))) await summary.click();
  return details;
}

async function recoveryTick(page, label) {
  await button(page, "暮らし").click();
  await button(page, label).click();
  return savedGame(page);
}

async function recoverBench(context, width) {
  const page = await openPage(context);
  await button(page, "川辺の一人旅").click();
  await button(page, "この朝を始める").click();
  const initial = await savedGame(page);
  const { id } = initial.actors[0].person;
  await button(page, "住まい").click();
  const editor = page.getByRole("region", { name: "住まいの間取り" });
  await button(editor, "裏庭").click();
  await editor
    .getByLabel("新しく置く設備", { exact: true })
    .selectOption("workbench");
  await button(editor, "この部屋に置く").click();
  const installed = await savedGame(page);
  const findBench = (g) =>
    g.house.rooms
      .find((r) => r.id === "yard")
      .fixtures.find((f) => f.kind === "workbench");
  const fixture = findBench(installed);
  assert.ok(fixture);
  const boardId = JSON.stringify(["bench-board", fixture.id]);
  const board = (g) => g.housing.state.items[boardId];
  const baseWood = installed.wood;
  assert.equal(baseWood, initial.wood - 3);
  const startDismantle = async () => {
    const panel = await recoveryPanel(page);
    await panel
      .getByRole("combobox", { name: "解体する木工台", exact: true })
      .selectOption(fixture.id);
    await panel
      .getByRole("combobox", { name: "解体担当", exact: true })
      .selectOption(id);
    await expect(panel).toContainText(/移動\d+分 ＋ 解体15分（合計\d+分）/);
    await button(panel, "この木工台の解体を始める").click();
    const game = await savedGame(page);
    assert.equal(game.housing.benchRecovery.phase, "dismantling");
    assert.equal(game.actors[0].task.total, 15);
    assert.equal(game.wood, baseWood);
    return game;
  };
  const startDelivery = async () => {
    const panel = await recoveryPanel(page);
    await panel
      .getByRole("combobox", { name: "回収担当", exact: true })
      .selectOption(id);
    await button(panel, "回収材を供給口へ運ぶ").click();
    return savedGame(page);
  };
  const started = await startDismantle();
  assert.equal(started.time, initial.time);
  await capture(
    page,
    button(await recoveryPanel(page), "解体を中止する"),
    "dismantling",
  );
  const interrupted = await recoveryTick(page, "15分進める");
  assert.ok(
    interrupted.actors[0].task.remaining > 0 &&
      interrupted.actors[0].task.remaining < 15,
  );
  assert.ok(findBench(interrupted));
  assert.equal(board(interrupted), undefined);
  await button(await recoveryPanel(page), "解体を中止する").click();
  const cancelled = await savedGame(page);
  assert.equal(cancelled.time, interrupted.time);
  assert.equal(cancelled.wood, baseWood);
  assert.equal(cancelled.housing.benchRecovery, undefined);
  assert.equal(board(cancelled), undefined);
  assert.deepEqual(findBench(cancelled), fixture);
  const restarted = await startDismantle();
  const midWork = await recoveryTick(page, "5分進める");
  assert.ok(midWork.actors[0].task && midWork.actors[0].task.remaining < 15);
  await page.reload();
  assert.deepEqual(await savedGame(page), midWork);
  const demolished = await recoveryTick(page, "次の行動完了まで進める");
  assert.equal(demolished.time - restarted.time, 15);
  assert.equal(findBench(demolished), undefined);
  assert.equal(demolished.wood, baseWood);
  assert.equal(demolished.housing.benchRecovery.phase, "board");
  assert.deepEqual(board(demolished).position, {
    kind: "at",
    point: { domainId: JSON.stringify(["room", "yard"]), cell: fixture.cell },
  });
  await page.reload();
  assert.deepEqual(await savedGame(page), demolished);
  // The recovered board is still on its former square. Ordinary room editing must preserve it.
  await button(page, "住まい").click();
  await button(editor, "裏庭").click();
  await editor
    .locator("summary")
    .filter({ hasText: "室内のマスを編集" })
    .click();
  const yard = demolished.house.rooms.find((room) => room.id === "yard");
  const cellName =
    (fixture.cell % yard.width) +
    1 +
    "列" +
    (Math.floor(fixture.cell / yard.width) + 1) +
    "行";
  await button(editor, cellName + "　床").click();
  await editor
    .getByRole("combobox", { name: cellName + "の編集", exact: true })
    .selectOption("wall");
  await button(editor, "選んだマスに適用").click();
  await expect(editor.getByRole("alert")).toHaveText(
    "解体した板が置かれた床は変更できません。",
  );
  assert.deepEqual(await savedGame(page), demolished);
  const ordered = await startDelivery();
  assert.equal(ordered.time, demolished.time);
  const inTransit = await recoveryTick(page, "5分進める");
  assert.equal(inTransit.wood, baseWood);
  assert.equal(board(inTransit).position.kind, "carried");
  await page.reload();
  assert.deepEqual(await savedGame(page), inTransit);
  const haulPanel = await recoveryPanel(page);
  await capture(page, button(haulPanel, "運搬を中止する"), "carrying-board");
  await button(haulPanel, "運搬を中止する").click();
  let dropped = await savedGame(page);
  if (dropped.housing.benchRecovery.assignment)
    dropped = await recoveryTick(page, "次の行動完了まで進める");
  assert.equal(dropped.housing.benchRecovery.assignment, undefined);
  assert.equal(board(dropped).position.kind, "at");
  assert.equal(dropped.wood, baseWood);
  await startDelivery();
  const delivered = await recoveryTick(page, "次の行動完了まで進める");
  assert.equal(delivered.wood, baseWood + 1);
  assert.equal(delivered.housing.benchRecovery, undefined);
  assert.equal(board(delivered), undefined);
  await page.reload();
  assert.deepEqual(await savedGame(page), delivered);
  report.runs.push({
    width,
    fixture: fixture.id,
    initialWood: initial.wood,
    afterInstallation: baseWood,
    workStarted: restarted.time,
    boardOnFloor: demolished.time,
    droppedAt: dropped.time,
    deliveredAt: delivered.time,
    finalWood: delivered.wood,
  });

  if (width === 1280) {
    // Only the capacity case imports synthetic state, derived from the live carrying checkpoint.
    await button(page, "手帳").click();
    const watching = page.waitForEvent("download");
    await button(page, "保存を書き出す").click();
    const download = await watching;
    const envelope = JSON.parse(await readFile(await download.path(), "utf8"));
    const full = structuredClone(inTransit);
    full.wood = 1_000_000_000;
    envelope.slot.game = full;
    await page.getByLabel("新版の保存ファイル").setInputFiles({
      name: "回収材の備蓄上限.json",
      mimeType: "application/json",
      buffer: Buffer.from(JSON.stringify(envelope)),
    });
    await expect.poll(async () => (await savedGame(page)).wood).toBe(full.wood);
    const waiting = await recoveryTick(page, "次の行動完了まで進める");
    assert.equal(waiting.wood, full.wood);
    assert.deepEqual(board(waiting).position, {
      kind: "at",
      point: { domainId: JSON.stringify(["room", "living"]), cell: 0 },
    });
    let panel = await recoveryPanel(page);
    await expect(button(panel, "供給口の回収材を備蓄へ戻す")).toBeDisabled();
    await page.reload();
    assert.deepEqual(await savedGame(page), waiting);
    panel = await recoveryPanel(page);
    await button(editor, "居間").click();
    await editor
      .getByLabel("新しく置く設備", { exact: true })
      .selectOption("mat");
    await button(editor, "この部屋に置く").click();
    assert.equal((await savedGame(page)).wood, full.wood - 1);
    await button(panel, "供給口の回収材を備蓄へ戻す").click();
    const reclaimed = await savedGame(page);
    assert.equal(reclaimed.wood, full.wood);
    assert.equal(reclaimed.time, waiting.time);
    assert.equal(reclaimed.housing.benchRecovery, undefined);
    assert.equal(board(reclaimed), undefined);
    await page.reload();
    assert.deepEqual(await savedGame(page), reclaimed);
    report.capacity = { waitingAt: waiting.time, stock: reclaimed.wood };
  }
}

const browser = await chromium.launch({
  headless: true,
  executablePath: process.env.CHROMIUM_PATH || "/usr/bin/chromium",
  args: ["--no-sandbox"],
});
try {
  for (const width of [1280, 320]) {
    for (const journey of [exercise, recoverBench]) {
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
        await journey(context, width);
      } finally {
        await context.close();
      }
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
