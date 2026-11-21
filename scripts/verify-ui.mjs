/**
 * Browser interaction checks for either an explicitly supplied preview or the
 * self-contained distribution (--standalone). The standalone route runs offline
 * from memory and never starts a server or accesses the hosted player's save.
 */
import assert from "node:assert/strict";
import { readFile, mkdir } from "node:fs/promises";
import { join } from "node:path";
import { chromium, expect } from "@playwright/test";

const standalone = process.argv.includes("--standalone");
const html = standalone ? await readFile("dist/yohaku-v53.html", "utf8") : null;
const APP_URL = standalone
  ? "http://yohaku.local/"
  : process.env.APP_URL || "http://127.0.0.1:5173/yohaku-v53.html";
const artifactDir =
  process.env.PLAYTEST_OUTPUT || "/tmp/yohaku-browser-playtest";
await mkdir(artifactDir, { recursive: true });
const requests = [];

const browser = await chromium.launch({
  executablePath: process.env.CHROMIUM_PATH || "/usr/bin/chromium",
  headless: true,
  args: ["--no-sandbox"],
});
const errors = [];
const checks = [];
const AUTO_KEY = "yohaku-autosave-v1";
const ACTORS = ["アキ", "ミオ", "レン"];
const MEAL_ACTION = /^(食事をとる|一緒に食事|それぞれ食事)/;
const RESOURCE_ITEMS = [
  ["food", "食事"],
  ["ingredients", "食材"],
  ["medicine", "手当用品"],
  ["scrap", "資材"],
];
function check(name) {
  checks.push(name);
  console.log(`✓ ${name}`);
}
async function freshPage(viewport = { width: 1440, height: 1100 }) {
  const context = await browser.newContext({
    viewport,
    acceptDownloads: true,
    offline: standalone,
  });
  if (standalone)
    await context.route("**/*", async (route) => {
      const url = route.request().url();
      requests.push(url);
      if (url === APP_URL)
        await route.fulfill({ contentType: "text/html", body: html });
      else await route.abort();
    });
  const page = await context.newPage();
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto(APP_URL);
  await expect(page.locator(".header .time")).toHaveText("08:00");
  await expect(page.locator(".residents-list")).toHaveCount(1);
  await expect(page.locator(".residents-list .resident-card")).toHaveCount(3);
  await expect(actorCard(page, "アキ")).toHaveAttribute("aria-pressed", "true");
  await expect(actorCard(page, "ミオ")).toHaveAttribute(
    "aria-pressed",
    "false",
  );
  await expect(actorCard(page, "レン")).toHaveAttribute(
    "aria-pressed",
    "false",
  );
  return page;
}
function actorCard(page, name) {
  return page.locator(".residents-list .resident-card").filter({
    has: page.locator(".resident-name").filter({ hasText: name }),
  });
}
async function state(page) {
  return page.evaluate(
    (key) => JSON.parse(localStorage.getItem(key)),
    AUTO_KEY,
  );
}
async function setSelection(page, names) {
  // Toggle the one shared desktop/mobile selector, including an empty selection.
  // Selection must not issue a game command or advance the common clock.
  const before = await state(page);
  const time = await page.locator(".header .time").innerText();
  for (const name of ACTORS) {
    const card = actorCard(page, name);
    const chosen = (await card.getAttribute("aria-pressed")) === "true";
    if (chosen !== names.includes(name)) await card.click();
    await expect(card).toHaveAttribute(
      "aria-pressed",
      String(names.includes(name)),
    );
    await expect(card).toHaveAttribute(
      "aria-label",
      `${name}を${names.includes(name) ? "選択から外す" : "選択する"}`,
    );
  }
  assert.equal(await page.locator(".header .time").innerText(), time);
  assert.deepEqual(await state(page), before);
}
async function navigate(page, label) {
  await page
    .getByRole("navigation")
    .getByRole("button", { name: label, exact: false })
    .click();
}
function lifeAction(page, title) {
  return page.locator(".action-grid").getByRole("button", {
    name: title,
    exact: false,
  });
}
function currentAction(page, actorName) {
  return page.locator(".current-action").filter({ hasText: `${actorName}：` });
}
async function openSave(page) {
  await page.locator(".save-button").click();
  await expect(page.getByRole("dialog")).toBeVisible();
}
async function importState(page, value) {
  await openSave(page);
  await page.locator("input[type=file]").setInputFiles({
    name: "yohaku-fixture.json",
    mimeType: "application/json",
    buffer: Buffer.from(JSON.stringify(value)),
  });
  await expect(page.getByRole("dialog")).not.toBeVisible();
  assert.deepEqual(await state(page), value);
}
async function noOverflow(page) {
  const size = await page.evaluate(() => ({
    width: document.documentElement.clientWidth,
    scroll: document.documentElement.scrollWidth,
  }));
  assert.ok(
    size.scroll <= size.width + 1,
    `horizontal overflow ${JSON.stringify(size)}`,
  );
}
async function expectNavigationDoesNotScroll(page) {
  const navigation = page.locator(".navigation");
  const metrics = await navigation.evaluate((element) => {
    const containers = [element, element.querySelector("nav")].filter(Boolean);
    return containers.map((container) => {
      const style = getComputedStyle(container);
      container.scrollTop = 20;
      const result = {
        tag: container.tagName,
        clientHeight: container.clientHeight,
        scrollHeight: container.scrollHeight,
        scrollTop: container.scrollTop,
        overflowY: style.overflowY,
      };
      container.scrollTop = 0;
      return result;
    });
  });
  for (const metric of metrics) {
    assert.ok(
      metric.scrollHeight <= metric.clientHeight,
      `navigation content must fit vertically: ${JSON.stringify(metric)}`,
    );
    assert.equal(
      metric.scrollTop,
      0,
      `navigation must not have an independent vertical scroll position: ${JSON.stringify(metric)}`,
    );
    assert.ok(
      !["auto", "scroll"].includes(metric.overflowY),
      `navigation must not be a vertical scroll container: ${JSON.stringify(metric)}`,
    );
  }
  const container = await navigation.boundingBox();
  const buttons = navigation.getByRole("navigation").getByRole("button");
  assert.equal(await buttons.count(), 5);
  for (const button of await buttons.all()) {
    const box = await button.boundingBox();
    assert.ok(
      container &&
        box &&
        box.x >= container.x - 1 &&
        box.x + box.width <= container.x + container.width + 1 &&
        box.y >= container.y - 1 &&
        box.y + box.height <= container.y + container.height + 1,
      `every navigation tab must fit without internal scrolling: ${JSON.stringify({ box, container })}`,
    );
  }
}
async function expectPrimaryActionsReachable(
  page,
  { allowPageScroll = false } = {},
) {
  await page.evaluate(() => window.scrollTo(0, 0));
  const primaryAction = page.locator(".action-grid .action-card").first();
  // Mobile gives text breathing room; the page may scroll, while the tabs do not.
  if (allowPageScroll)
    await primaryAction.evaluate((element) =>
      element.scrollIntoView({ block: "center" }),
    );
  const action = await primaryAction.boundingBox();
  const footer = await page.locator(".time-bar").boundingBox();
  assert.ok(action && footer, "primary actions and time controls are rendered");
  assert.ok(
    action.y >= 0 && action.y + action.height <= footer.y + 1,
    `primary action must be readable above fixed time controls: ${JSON.stringify({ action, footer })}`,
  );
  await page.evaluate(() => window.scrollTo(0, 0));
}
async function expectMobileOverviewOrder(page) {
  const parts = [
    ".header .time",
    ".home-overview .scene-illustration",
    ".home-resource-summary",
    ".residents-list",
  ];
  const boxes = await Promise.all(
    parts.map((selector) => page.locator(selector).boundingBox()),
  );
  assert.ok(
    boxes.every(Boolean),
    "time, landscape, resources and the sole roster are rendered",
  );
  for (let index = 1; index < boxes.length; index++) {
    assert.ok(
      boxes[index].y >= boxes[index - 1].y + boxes[index - 1].height - 1,
      `mobile order ${parts.join(" → ")}: ${JSON.stringify(boxes)}`,
    );
  }
}
function availableResources(data) {
  const free = { ...data.resources };
  for (const resident of data.residents) {
    for (const action of [resident.action, resident.suspended]) {
      for (const [key, amount] of Object.entries(action?.reserved || {})) {
        free[key] -= amount;
      }
    }
  }
  return free;
}
async function expectHomeResources(page, data) {
  const summary = page.getByRole("region", { name: "ホームの物資の概要" });
  await expect(summary).toBeVisible();
  const rows = summary.locator(".summary-resources > div");
  await expect(rows).toHaveCount(4);
  const free = availableResources(data);
  for (const [key, label] of RESOURCE_ITEMS) {
    const row = rows.filter({ has: page.getByText(label, { exact: true }) });
    await expect(row).toHaveCount(1);
    assert.equal(
      Number.parseInt(await row.locator("strong").innerText(), 10),
      free[key],
      `${label}のホーム表示は利用可能な在庫`,
    );
  }
  assert.doesNotMatch(await summary.innerText(), /予約|合計/);
  await expect(summary.locator("table, .stock-table")).toHaveCount(0);
}
async function expectBaseResources(page, data) {
  await navigate(page, "拠点");
  const rows = page.locator(".stock-table > div");
  await expect(rows).toHaveCount(5);
  await expect(rows.first()).toContainText("利用可能");
  await expect(rows.first()).toContainText("予約中");
  await expect(rows.first()).toContainText("合計");
  const free = availableResources(data);
  for (const [index, [key, label]] of RESOURCE_ITEMS.entries()) {
    const cells = rows.nth(index + 1).locator(":scope > *");
    assert.deepEqual(
      (await cells.allInnerTexts()).map((value) => value.trim()),
      [
        label,
        String(free[key]),
        String(data.resources[key] - free[key]),
        String(data.resources[key]),
      ],
    );
  }
  await navigate(page, "いまの暮らし");
}
try {
  const page = await freshPage();
  for (const [label, title] of [
    ["住民たち", "一緒に、暮らす人たち。"],
    ["拠点", "小さな家を、居場所に。"],
    ["周辺を探索", "見慣れた道の、もう少し先。"],
    ["日誌", "暮らしの足あと。"],
    ["いまの暮らし", "アキ · 共同の居間"],
  ]) {
    await navigate(page, label);
    await expect(
      page.getByRole("heading", { name: title, exact: true }),
    ).toBeVisible();
    await expect(page.locator(".header .time")).toHaveText("08:00");
  }
  check("全5画面を切り替えても共通時計が進まない");

  // The initial Aki selection is explicitly removed; Mio is the only actor.
  await setSelection(page, ["ミオ"]);
  await expect(
    page.getByRole("heading", { name: "ミオは、何をしよう？", exact: true }),
  ).toBeVisible();
  await lifeAction(page, "食事をつくる").click();
  let data = await state(page);
  assert.equal(data.minutes, 480);
  assert.equal(data.residents.find((r) => r.id === "mio").action.kind, "cook");
  assert.equal(data.residents.find((r) => r.id === "aki").action, null);
  assert.deepEqual(data.residents.find((r) => r.id === "mio").action.reserved, {
    ingredients: 2,
  });
  await expectHomeResources(page, data);
  await expectBaseResources(page, data);
  check("ミオだけの調理を予約し、ホーム4資源と拠点の予約内訳を一致させる");

  await page.getByRole("button", { name: "5分", exact: true }).click();
  await expect(page.locator(".header .time")).toHaveText("08:05");
  await currentAction(page, "ミオ")
    .getByRole("button", { name: "中断", exact: true })
    .click();
  data = await state(page);
  const cooking = data.residents.find((r) => r.id === "mio").suspended;
  assert.equal(cooking.kind, "cook");
  assert.equal(cooking.progress, 5);
  assert.equal(data.resources.ingredients, 8);
  await expectHomeResources(page, data);
  await expectBaseResources(page, data);
  await openSave(page);
  await page
    .getByRole("button", { name: "いまの暮らしを保存する", exact: true })
    .click();
  const downloadPromise = page.waitForEvent("download");
  await page
    .getByRole("button", { name: "ファイルに書き出す", exact: true })
    .click();
  const downloaded = await downloadPromise;
  const raw = await readFile(await downloaded.path(), "utf8");
  assert.deepEqual(JSON.parse(raw), data);
  check("調理の進捗5分・材料予約を手動保存とJSON書出しに保持する");

  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog")).not.toBeVisible();
  await page.reload();
  await expect(page.locator(".header .time")).toHaveText("08:05");
  await setSelection(page, ["ミオ"]);
  await expect(currentAction(page, "ミオ")).toContainText("料理をする（中断中）");
  assert.equal(
    (await state(page)).residents.find((r) => r.id === "mio").suspended
      .progress,
    5,
  );
  check("ブラウザ再読込後にも中断した仕事を維持する");

  await openSave(page);
  await page
    .getByRole("button", { name: "同じ朝から、はじめなおす", exact: true })
    .click();
  await page
    .getByRole("button", { name: "同じ開始条件で、はじめる", exact: true })
    .click();
  await expect(page.locator(".header .time")).toHaveText("08:00");
  await importState(page, JSON.parse(raw));
  await setSelection(page, ["ミオ"]);
  await currentAction(page, "ミオ")
    .getByRole("button", { name: "再開する", exact: true })
    .click();
  await page.locator(".next-button").click();
  data = await state(page);
  assert.equal(data.resources.ingredients, 6);
  assert.equal(data.resources.food, 9);
  assert.equal(data.residents.find((r) => r.id === "mio").suspended, null);
  check("書出したJSONから同じ状態へ戻り、再開した調理を一度だけ完了する");

  await openSave(page);
  const beforeInvalid = await state(page);
  await page.locator("input[type=file]").setInputFiles({
    name: "invalid.json",
    mimeType: "application/json",
    buffer: Buffer.from("{ broken json"),
  });
  await expect(page.locator(".toast")).toContainText("JSON形式ではありません");
  assert.deepEqual(await state(page), beforeInvalid);
  await expect(page.getByRole("dialog")).toBeVisible();
  await page.keyboard.press("Escape");
  check("不正なJSONを拒否し、進行中の状態を変更しない");

  await expect(page.locator(".night-button")).toContainText("夕方まで");
  await page.locator(".night-button").click();
  await expect(page.locator(".header .time")).toHaveText("18:00");
  data = await state(page);
  assert.ok(data.residents.every((r) => r.action?.kind !== "sleep"));
  // Feed the actual household before the night. This is a player choice, not
  // an invisible meal consumed by the time shortcut.
  await setSelection(page, ACTORS);
  await lifeAction(page, MEAL_ACTION).click();
  await page.locator(".next-button").click();
  await setSelection(page, ["ミオ"]);
  await expect(page.locator(".night-button")).toContainText("翌朝まで");
  await page.locator(".night-button").click();
  await expect(page.locator(".header .time")).toHaveText("08:00");
  data = await state(page);
  assert.equal(data.minutes, 1920);
  assert.ok(data.residents.every((r) => r.action?.kind !== "sleep"));
  assert.ok(data.logs.some((l) => l.time === 1920 && l.title === "第2日の朝"));
  check("昼は睡眠せず夕方へ進み、実際に食事してから夜の有限睡眠で翌朝へ進む");

  await page.locator(".help-button").click();
  await expect(page.getByRole("dialog")).toBeVisible();
  assert.equal(
    await page.evaluate(() =>
      document.activeElement?.getAttribute("aria-label"),
    ),
    "閉じる",
  );
  await page.keyboard.press("Shift+Tab");
  assert.equal(
    await page.evaluate(() => document.activeElement?.textContent),
    "わたしの一日を、はじめる",
  );
  await page.keyboard.press("Tab");
  assert.equal(
    await page.evaluate(() =>
      document.activeElement?.getAttribute("aria-label"),
    ),
    "閉じる",
  );
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog")).not.toBeVisible();
  check("ガイドのフォーカス循環とEscapeによる閉じる操作");
  await page.context().close();

  // Multi-actor commands must act on the entire selected set atomically.
  const groupPage = await freshPage();
  await setSelection(groupPage, ["アキ", "レン"]);
  await expect(lifeAction(groupPage, "食事をつくる")).toBeDisabled();
  await expect(lifeAction(groupPage, "自分の場所を整える")).toBeDisabled();
  await lifeAction(groupPage, "ゆっくり休む").click();
  let grouped = await state(groupPage);
  assert.equal(grouped.minutes, 480);
  assert.equal(
    grouped.residents.find((r) => r.id === "aki").action.kind,
    "rest",
  );
  assert.equal(
    grouped.residents.find((r) => r.id === "ren").action.kind,
    "rest",
  );
  assert.equal(grouped.residents.find((r) => r.id === "mio").action, null);
  await expect(groupPage.locator(".current-action")).toHaveCount(2);
  for (const name of ["アキ", "レン"]) {
    await currentAction(groupPage, name)
      .getByRole("button", { name: "取消", exact: true })
      .click();
  }
  check("複数選択の休息は両者へ予約し、単独作業は無効にする");

  await lifeAction(groupPage, MEAL_ACTION).click();
  grouped = await state(groupPage);
  assert.equal(grouped.minutes, 480);
  assert.equal(grouped.resources.food, 6);
  assert.equal(availableResources(grouped).food, 4);
  for (const id of ["aki", "ren"]) {
    assert.equal(grouped.residents.find((r) => r.id === id).action.kind, "eat");
    assert.deepEqual(
      grouped.residents.find((r) => r.id === id).action.reserved,
      { food: 1 },
    );
  }
  assert.equal(grouped.residents.find((r) => r.id === "mio").action, null);
  await expectHomeResources(groupPage, grouped);
  await expectBaseResources(groupPage, grouped);
  for (const name of ["アキ", "レン"]) {
    await currentAction(groupPage, name)
      .getByRole("button", { name: "取消", exact: true })
      .click();
  }
  const insufficientFood = await state(groupPage);
  insufficientFood.resources.food = 1;
  await importState(groupPage, insufficientFood);
  await expect(lifeAction(groupPage, MEAL_ACTION)).toBeDisabled();
  assert.deepEqual(await state(groupPage), insufficientFood);
  assert.ok(insufficientFood.residents.every((r) => r.action === null));
  check("2人の食事は同時に2食を予約し、不足時は一部だけ予約しない");

  const socialFixture = structuredClone(insufficientFood);
  socialFixture.resources.food = 6;
  await importState(groupPage, socialFixture);
  const mioRelations = structuredClone(
    socialFixture.residents.find((r) => r.id === "mio").relations,
  );
  await lifeAction(groupPage, "仲間と話す").click();
  grouped = await state(groupPage);
  assert.equal(grouped.minutes, 480);
  assert.equal(
    grouped.residents.find((r) => r.id === "aki").action.target,
    "ren",
  );
  assert.equal(
    grouped.residents.find((r) => r.id === "ren").action.target,
    "aki",
  );
  assert.equal(grouped.residents.find((r) => r.id === "mio").action, null);
  await groupPage.locator(".next-button").click();
  grouped = await state(groupPage);
  assert.deepEqual(
    grouped.residents.find((r) => r.id === "mio").relations,
    mioRelations,
  );
  const conversations = grouped.logs.filter(
    (entry) => entry.title === "少しだけ、近くに",
  );
  assert.equal(conversations.length, 1);
  assert.deepEqual([...conversations[0].actors].sort(), ["aki", "ren"]);
  assert.equal(
    grouped.life.events.filter((event) => event.kind === "conversation").length,
    1,
  );
  for (const [first, second] of [["aki", "ren"], ["ren", "aki"]]) {
    const before = socialFixture.residents.find((r) => r.id === first).relations[second];
    const after = grouped.residents.find((r) => r.id === first).relations[second];
    assert.equal(after.closeness, before.closeness + 4);
    assert.equal(after.trust, before.trust + 1);
  }
  check("選択した2人の会話を一件・関係一回で記録し、未選択者の関係を変更しない");
  await groupPage.context().close();

  const desktop = await freshPage({ width: 1280, height: 800 });
  await desktop.evaluate(() => document.fonts.ready);
  await expectPrimaryActionsReachable(desktop);
  await expectNavigationDoesNotScroll(desktop);
  await desktop.screenshot({
    path: join(artifactDir, "desktop-1280.png"),
    fullPage: true,
  });
  await noOverflow(desktop);
  check("1280×800の初期画面で主要行動が時間操作の上に収まり、横はみ出しがない");
  await desktop.context().close();

  const mobile = await freshPage({ width: 390, height: 844 });
  await mobile.evaluate(() => document.fonts.ready);
  await expectMobileOverviewOrder(mobile);
  await expectPrimaryActionsReachable(mobile, { allowPageScroll: true });
  await expectNavigationDoesNotScroll(mobile);
  await mobile.setViewportSize({ width: 320, height: 740 });
  await expectNavigationDoesNotScroll(mobile);
  await noOverflow(mobile);
  await mobile.setViewportSize({ width: 390, height: 844 });
  await mobile.screenshot({
    path: join(artifactDir, "mobile-390.png"),
    fullPage: true,
  });
  // Mobile uses the same one selector; no secondary control or implicit actor.
  for (const name of ACTORS)
    await expect(actorCard(mobile, name)).toBeVisible();
  await expect(
    mobile.locator(
      ".mobile-resident-switcher, .group-toolbar, .partner-picker",
    ),
  ).toHaveCount(0);
  for (const label of [
    "いまの暮らし",
    "住民たち",
    "拠点",
    "周辺を探索",
    "日誌",
  ]) {
    await navigate(mobile, label);
    await expectNavigationDoesNotScroll(mobile);
    await noOverflow(mobile);
  }
  await navigate(mobile, "いまの暮らし");
  await setSelection(mobile, []);
  await expect(
    mobile.getByRole("heading", {
      name: "行動する住民を選んでください",
      exact: true,
    }),
  ).toBeVisible();
  for (const action of await mobile
    .locator(".action-grid .action-card")
    .all()) {
    await expect(action).toBeDisabled();
  }
  assert.equal(await state(mobile), null);
  await setSelection(mobile, ["ミオ"]);
  await expect(
    mobile.getByRole("heading", { name: "ミオは、何をしよう？", exact: true }),
  ).toBeVisible();
  await lifeAction(mobile, "食事をつくる").click();
  let mobileState = await state(mobile);
  assert.equal(mobileState.minutes, 480);
  assert.equal(
    mobileState.residents.find((r) => r.id === "mio").action.kind,
    "cook",
  );
  assert.equal(mobileState.residents.find((r) => r.id === "aki").action, null);
  assert.equal(mobileState.residents.find((r) => r.id === "ren").action, null);
  await expectHomeResources(mobile, mobileState);
  await expectBaseResources(mobile, mobileState);
  await mobile.getByRole("button", { name: "5分", exact: true }).click();
  mobileState = await state(mobile);
  assert.equal(
    mobileState.residents.find((r) => r.id === "mio").action.progress,
    5,
  );
  await openSave(mobile);
  await noOverflow(mobile);
  await mobile.keyboard.press("Escape");
  check("390×844でも同じ住民一覧で全員解除でき、隠れた実行者を補わない");
  // A scene jump changes the viewed person, never the command group or simulation.
  const encounterFixture = structuredClone(mobileState);
  const encounteredResident = encounterFixture.residents.find(
    (r) => r.id === "ren",
  );
  encounteredResident.location = encounterFixture.enemy.location;
  encounteredResident.action = null;
  encounteredResident.suspended = null;
  encounterFixture.enemy.alerted = true;
  encounterFixture.logs.push({
    id: encounterFixture.nextId++,
    time: encounterFixture.minutes,
    type: "explore",
    title: "入口の人影",
    text: "レンが資材置き場で流れ者に遭遇した。",
    actors: ["ren"],
    witnesses: ["ren"],
  });
  await importState(mobile, encounterFixture);
  await setSelection(mobile, ["ミオ"]);
  const beforeJump = await state(mobile);
  await mobile.locator(".time-scene-jump").click();
  await expect(mobile.locator(".scene-focus h1")).toContainText(
    "レン · 旧い資材置き場",
  );
  await expect(actorCard(mobile, "ミオ")).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  await expect(actorCard(mobile, "レン")).toHaveAttribute(
    "aria-pressed",
    "false",
  );
  assert.deepEqual(await state(mobile), beforeJump);
  await actorCard(mobile, "レン").click();
  await actorCard(mobile, "レン").click();
  await expect(actorCard(mobile, "レン")).toHaveAttribute(
    "aria-pressed",
    "false",
  );
  await expect(mobile.locator(".scene-focus h1")).toContainText(
    "レン · 旧い資材置き場",
  );
  assert.deepEqual(await state(mobile), beforeJump);
  await navigate(mobile, "日誌");
  const encounterLog = mobile
    .locator(".log-item")
    .filter({ hasText: "入口の人影" });
  await encounterLog.getByRole("button", { name: /現場を見る/ }).click();
  await expect(mobile.locator(".scene-focus h1")).toContainText(
    "レン · 旧い資材置き場",
  );
  await expect(actorCard(mobile, "ミオ")).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  await expect(actorCard(mobile, "レン")).toHaveAttribute(
    "aria-pressed",
    "false",
  );
  assert.deepEqual(await state(mobile), beforeJump);
  check(
    "遭遇の現場移動と最後に触れた住民の表示が、指示対象・時計・進捗を変えない",
  );
  await mobile.context().close();
  assert.deepEqual(errors, []);
  check("ブラウザの未処理JavaScriptエラーがない");
  if (standalone)
    assert.ok(
      requests.every((url) => url === APP_URL),
      `standalone should not request external assets: ${JSON.stringify(requests)}`,
    );
  console.log(
    `\n${checks.length} browser checks passed${standalone ? " from the offline standalone HTML" : ""}.`,
  );
} catch (error) {
  for (const [index, page] of browser
    .contexts()
    .flatMap((context) => context.pages())
    .entries()) {
    if (!page.isClosed())
      await page
        .screenshot({
          path: join(artifactDir, `failure-${index}.png`),
          fullPage: true,
        })
        .catch(() => {});
  }
  throw error;
} finally {
  await browser.close();
}
