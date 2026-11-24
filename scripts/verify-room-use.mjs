// Exercise the built HTML through normal controls and an isolated, reproducible import.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { chromium, expect } from "@playwright/test";
import { tsImport } from "tsx/esm/api";

const { editHouse, initialHouse } = await tsImport(
  "../src/reform/house.ts",
  import.meta.url,
);
const { exportSlot } = await tsImport(
  "../src/reform/library.ts",
  import.meta.url,
);
const { makePersona } = await tsImport(
  "../src/reform/peopleModel.ts",
  import.meta.url,
);
const { createGame, enableHousing, isGame } = await tsImport(
  "../src/reform/sim.ts",
  import.meta.url,
);
const { defaultWorldConfig, generateWorld } = await tsImport(
  "../src/reform/world.ts",
  import.meta.url,
);

const html = await readFile(process.env.REFORM_HTML || "dist/yohaku.html");
const output = resolve(
  process.env.PLAYTEST_OUTPUT || "/tmp/yohaku-room-use-playtest",
);
const entry = "https://room-use.offline.test/";
const report = {
  sha256: createHash("sha256").update(html).digest("hex"),
  normal: [],
  controlled: [],
  screenshots: [],
  errors: [],
};
await mkdir(output, { recursive: true });

const button = (scope, name) =>
  scope.getByRole("button", { name, exact: true });
const readingChoice = (page) =>
  page.getByRole("combobox", { name: "楽しみに使う設備", exact: true });
const readingAction = (page) => button(page, "好きなことをして休む");
const readingRow = (page) => readingAction(page).locator("..");
const clock = (page, time) =>
  expect(page.getByLabel("現在時刻 " + time, { exact: true })).toBeVisible();
const firstName = "検証のカヤ";
const secondName = "検証のスイ";
const nearLabel = "居間・本棚と読書椅子（1列2行）";
const farLabel = "寝室・本棚と読書椅子（3列2行）";
const farTime = "移動5分 ＋ 利用14分（合計19分）";
const farStation = JSON.stringify(["slot", "bedroom", "fixture-2", 0]);
const reservationReason = "使える設備はほかの住人が予約しています。";
let browser;

async function inContext(run) {
  const context = await browser.newContext({
    offline: true,
    viewport: { width: 1280, height: 900 },
    acceptDownloads: true,
  });
  await context.route("**/*", async (route) => {
    const url = route.request().url();
    if (url === entry) {
      await route.fulfill({
        contentType: "text/html; charset=utf-8",
        body: html,
      });
    } else {
      report.errors.push("意図しない通信: " + url);
      await route.abort();
    }
  });
  context.on("page", (page) => {
    page.on("pageerror", (error) => report.errors.push(error.message));
    page.on("console", (message) => {
      if (message.type() === "error") report.errors.push(message.text());
    });
  });
  try {
    await run(context);
  } finally {
    await context.close();
  }
}

async function open(context) {
  const page = await context.newPage();
  await page.goto(entry);
  return page;
}

async function settled(page) {
  await expect(page.locator(".rf-app")).toHaveAttribute("aria-busy", "false");
}

async function click(page, name) {
  await button(page, name).click();
  await settled(page);
}

async function readSave(page) {
  await click(page, "手帳");
  const download = page.waitForEvent("download");
  await button(page, "保存を書き出す").click();
  const raw = await readFile(await (await download).path(), "utf8");
  await click(page, "暮らし");
  const { type, version, slot } = JSON.parse(raw);
  assert.equal(type, "yohaku-reform-save");
  assert.equal(version, 2);
  return { raw, slot };
}

async function chooseFar(page) {
  await readingChoice(page).selectOption({ label: farLabel });
  await expect(readingChoice(page)).toHaveValue("fixture-2");
}

async function assertAutomatic(page) {
  await expect(readingChoice(page)).toHaveValue("");
  await expect(
    readingChoice(page).locator("option").filter({ hasText: farLabel }),
  ).toHaveCount(1);
  await expect(readingRow(page).locator("small")).toContainText(
    "居間・本棚と読書椅子",
  );
  await expect(readingRow(page).locator("small")).toContainText(
    "移動0分 ＋ 利用14分（合計14分）",
  );
}

async function capture(page, label, widths) {
  for (const width of widths) {
    const height = width === 1280 ? 900 : 844;
    await page.setViewportSize({ width, height });
    await readingRow(page).scrollIntoViewIfNeeded();
    const bounds = await readingRow(page).boundingBox();
    assert.ok(bounds && bounds.x >= 0 && bounds.x + bounds.width <= width);
    const choiceBounds = await readingChoice(page).boundingBox();
    assert.ok(
      choiceBounds &&
        choiceBounds.x >= bounds.x &&
        choiceBounds.x + choiceBounds.width <= bounds.x + bounds.width + 1,
    );
    const { client, scroll } = await page.evaluate(() => ({
      client: document.documentElement.clientWidth,
      scroll: document.documentElement.scrollWidth,
    }));
    assert.ok(
      scroll <= client + 1,
      `${width}px: document scrollWidth ${scroll} ＞ clientWidth ${client}`,
    );
    const path = resolve(output, `${label}-${width}.png`);
    await page.screenshot({ path });
    report.screenshots.push({ width, height, path });
  }
  await page.setViewportSize({ width: 1280, height: 900 });
}

async function normal(context) {
  const page = await open(context);
  await click(page, "木工の二人");
  await click(page, "この朝を始める");
  await clock(page, "08:00");
  const actions = page.getByRole("region", { name: "行動の指示" });
  await expect(actions.getByRole("combobox")).toHaveCount(6);
  await expect(
    actions.getByRole("combobox", { name: "食事に使う設備" }),
  ).toHaveValue("");
  const meal = button(actions, "食事をとる");
  await expect(meal.locator("..").locator("small")).toContainText(
    "取り置き 食事1",
  );
  await meal.click();
  await settled(page);
  const {
    slot: { game, origin },
  } = await readSave(page);
  assert.equal(game.time, origin.time);
  assert.equal(game.food, origin.food - 1);
  assert.equal(game.actors[0].task.target, "hunger");
  assert.equal(
    game.actors[0].task.station,
    JSON.stringify(["slot", "living", "hearth-1", 0]),
  );
  report.normal.push(
    "木工の二人を通常の作成画面で開始。食事を自動で予約し、時刻を保って食事1を取り置いた保存を書き出した。",
  );
}

function controlledSave() {
  const people = [firstName, secondName].map((name, i) => ({
    ...makePersona(i, 23 + i),
    name,
  }));
  const near = editHouse(initialHouse(), {
    type: "build",
    room: "living",
    kind: "shelf",
    cell: 4,
  });
  const house = editHouse(near, {
    type: "build",
    room: "bedroom",
    kind: "shelf",
    cell: 6,
  });
  const origin = enableHousing(
    createGame(people, generateWorld(defaultWorldConfig()), "village", house),
    "new",
  );
  assert.ok(isGame(origin));
  return {
    id: "room-use-test",
    name: "家具の指定を検証",
    origin,
    game: origin,
  };
}

async function controlled(context) {
  const fixture = controlledSave();
  const fixturePath = resolve(output, "room-use-input.json");
  await writeFile(fixturePath, exportSlot(fixture));
  const page = await open(context);
  await click(page, "手帳");
  await page.getByLabel("新版の保存ファイル").setInputFiles(fixturePath);
  await expect(readingChoice(page)).toBeVisible();
  await settled(page);
  const baseline = await readSave(page);
  assert.deepEqual(
    baseline.slot.game,
    JSON.parse(JSON.stringify(fixture.game)),
  );
  await assertAutomatic(page);
  await expect(
    readingChoice(page).locator("option").filter({ hasText: nearLabel }),
  ).toHaveCount(1);
  await chooseFar(page);
  await expect(readingRow(page).locator("small")).toContainText(
    "寝室・本棚と読書椅子",
  );
  await expect(readingRow(page).locator("small")).toContainText(farTime);
  await clock(page, "08:00");
  await capture(page, "explicit", [320, 390, 1280]);
  assert.equal((await readSave(page)).raw, baseline.raw);
  await expect(readingChoice(page)).toHaveValue("fixture-2");
  await click(page, "地域");
  await click(page, "暮らし");
  await expect(readingChoice(page)).toHaveValue("fixture-2");
  await click(page, firstName);
  await expect(readingChoice(page)).toHaveValue("fixture-2");
  report.controlled.push(
    "公開の間取り編集とゲーム作成から生成した保存を読込。居間の本棚は移動0分＋利用14分、寝室は移動5分＋利用14分。選ぶだけで時刻も書き出し内容も変化しない。",
  );

  await click(page, secondName);
  await assertAutomatic(page);
  await click(page, firstName);
  await assertAutomatic(page);
  await chooseFar(page);
  await click(page, "手帳");
  await click(page, "同じ朝から分岐");
  await assertAutomatic(page);
  const branch = await readSave(page);
  assert.notEqual(branch.slot.id, baseline.slot.id);
  assert.deepEqual(branch.slot.game.house, baseline.slot.game.house);
  await chooseFar(page);
  await click(page, "手帳");
  await page
    .getByRole("button")
    .filter({ has: page.getByText(baseline.slot.name, { exact: true }) })
    .click();
  await settled(page);
  await assertAutomatic(page);
  assert.equal((await readSave(page)).raw, baseline.raw);
  report.controlled.push(
    "住民の切替、自宅の設備IDが共通している分岐への切替と元の保存枠への復帰で、未確定の選択が自動に戻る。",
  );

  const peer = await open(context);
  await click(page, secondName);
  await chooseFar(page);
  // Reserve on the other tab without changing the first tab's resident or view.
  await chooseFar(peer);
  await click(peer, "好きなことをして休む");
  await expect(readingChoice(page)).toHaveValue("fixture-2");
  await expect(readingChoice(page)).toBeEnabled();
  await expect(readingAction(page)).toBeDisabled();
  await expect(readingRow(page).getByRole("status")).toHaveText(
    reservationReason,
  );
  await capture(page, "reserved", [320]);
  const { slot: bookedByFirst } = await readSave(peer);
  assert.equal(bookedByFirst.game.time, baseline.slot.game.time);
  assert.equal(bookedByFirst.game.actors[0].task.station, farStation);
  assert.equal(bookedByFirst.game.actors[1].task, null);
  await click(peer, "現在の予定を取り消す");
  await expect(readingChoice(page)).toHaveValue("fixture-2");
  await expect(readingAction(page)).toBeEnabled();
  await expect(readingRow(page).locator("small")).toContainText(farTime);
  await click(page, "好きなことをして休む");
  await clock(page, "08:00");
  report.controlled.push(
    "別タブで先の住民が単席の本棚を予約すると、待機中の選択を保って実行だけを無効にした。予約を取り消すと選び直さず後の住民が使える。",
  );

  const housing = (p) => p.getByRole("region", { name: "家の中の移動と設定" });
  await housing(peer).getByText("通路と扉", { exact: true }).click();
  await click(peer, "居間と寝室の通路を閉める");
  const task = page.getByRole("article", { name: secondName + "の近況" });
  await expect(housing(page)).toContainText("見積もれません");
  await click(page, "5分進める");
  await clock(page, "08:05");
  await expect(task).toContainText("待機");
  await expect(readingChoice(page)).toHaveValue("fixture-2");
  await click(peer, "居間と寝室の通路を開ける");
  await expect(housing(page)).toContainText("次の時間進行で再開します");
  await click(page, "5分進める");
  await clock(page, "08:10");
  await expect(readingChoice(page)).toHaveValue("fixture-2");
  await expect(housing(page)).toContainText("寝室・3列1行（本棚と読書椅子）");
  await expect(task).toContainText("利用中");
  const arrived = await readSave(page);
  const reader = arrived.slot.game.actors[1];
  assert.equal(reader.room, "bedroom");
  assert.equal(reader.metrics.travel, 5);
  assert.equal(reader.task.station, farStation);
  assert.equal(reader.task.remaining, 14);
  assert.deepEqual(arrived.slot.origin, baseline.slot.origin);
  await page.reload();
  assert.equal((await readSave(page)).raw, arrived.raw);
  await click(page, secondName);
  await click(page, "次の行動完了まで進める");
  await clock(page, "08:24");
  const { slot: finished } = await readSave(page);
  assert.equal(finished.game.actors[1].task, null);
  assert.equal(finished.game.actors[1].room, "bedroom");
  assert.equal(finished.game.actors[1].metrics.free - reader.metrics.free, 14);
  assert.equal(
    Object.values(finished.game.housing.state.reservations).some(
      (r) => r.targetId === farStation,
    ),
    false,
  );
  report.controlled.push(
    "寝室への通路を閉めると待機し、開け直すと選択を保ったまま5分移動して寝室の席へ到着。利用途中の書き出しが再読込後も同一で、14分使うと利用と予約が完了する。",
  );

  await chooseFar(page);
  await click(page, "住まい");
  const house = page.getByRole("region", { name: "住まいの間取り" });
  await button(house, "寝室").click();
  await button(house, "本棚と読書椅子").click();
  await house.getByText("室内のマスを編集", { exact: true }).click();
  await button(house, "本棚と読書椅子を取り外す").click();
  await settled(page);
  await click(page, "暮らし");
  await expect(button(page, secondName)).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  await expect(readingChoice(page)).toHaveValue("fixture-2");
  await expect(readingChoice(page).locator("option:checked")).toHaveText(
    "選んだ設備がありません",
  );
  await expect(readingChoice(page)).toBeEnabled();
  await expect(readingAction(page)).toBeDisabled();
  await expect(readingRow(page).getByRole("status")).toHaveText(
    "選んだ設備がありません",
  );
  await expect(button(page, "食事をとる")).toBeEnabled();
  const { slot: removed } = await readSave(page);
  assert.equal(removed.id, finished.id);
  assert.equal(removed.game.time, finished.game.time);
  const bedroom = removed.game.house.rooms.find(
    (room) => room.id === "bedroom",
  );
  assert.equal(
    bedroom.fixtures.some((f) => f.id === "fixture-2"),
    false,
  );
  await expect(readingChoice(page)).toHaveValue("fixture-2");
  await readingChoice(page).selectOption("");
  await expect(readingAction(page)).toBeEnabled();
  await expect(readingRow(page).locator("small")).toContainText(
    "居間・本棚と読書椅子",
  );
  report.controlled.push(
    "同じタブ・住民・保存枠で選択中の本棚を住まいから取り外すと、暮らしに戻っても消失した選択が表示され、対応する実行だけが無効。自動を選び直すと居間の本棚を利用できる。",
  );
}

try {
  browser = await chromium.launch({
    headless: true,
    executablePath: process.env.CHROMIUM_PATH || "/usr/bin/chromium",
    args: ["--no-sandbox"],
  });
  await inContext(normal);
  await inContext(controlled);
  assert.deepEqual(report.errors, []);
  console.log(JSON.stringify(report, null, 2));
} catch (error) {
  report.errors.push(String(error));
  throw error;
} finally {
  await writeFile(
    resolve(output, "room-use-result.json"),
    JSON.stringify(report, null, 2) + "\n",
  );
  await browser?.close();
}
