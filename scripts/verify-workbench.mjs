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

async function exercise(context, width) {
  const page = await context.newPage();
  page.on("pageerror", (error) => report.errors.push(error.message));
  page.on("console", (message) => {
    if (message.type() === "error") report.errors.push(message.text());
  });
  await page.goto(entry);
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
