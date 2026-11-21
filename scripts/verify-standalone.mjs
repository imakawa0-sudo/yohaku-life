import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { chromium, expect } from "@playwright/test";

const ENTRY_URL = "http://yohaku.local/";
const AUTO_KEY = "yohaku-autosave-v1";
const SAVE_KEY = "yohaku-save-v1";
const html = await readFile("dist/yohaku-v53.html", "utf8");
const browser = await chromium.launch({
  headless: true,
  executablePath: process.env.CHROMIUM_PATH || "/usr/bin/chromium",
  args: ["--no-sandbox"],
});
const checks = [];
function check(message) {
  checks.push(message);
  console.log(`✓ ${message}`);
}
function clockText(minutes) {
  const time = minutes % 1440;
  return `${String(Math.floor(time / 60)).padStart(2, "0")}:${String(time % 60).padStart(2, "0")}`;
}
async function storedState(page, key = AUTO_KEY) {
  return page.evaluate((storageKey) => {
    const raw = localStorage.getItem(storageKey);
    return raw === null ? null : JSON.parse(raw);
  }, key);
}
try {
  const context = await browser.newContext({ offline: true });
  const page = await context.newPage();
  const pageErrors = [];
  const consoleErrors = [];
  const requests = [];
  page.on("pageerror", (error) => pageErrors.push(error.message));
  page.on("console", (message) => {
    if (message.type() === "error") consoleErrors.push(message.text());
  });
  page.on("request", (request) => requests.push(request.url()));
  // Only this single HTML document is fulfilled from memory. The browser stays
  // offline, with no server and no external font, script, or asset fallback.
  await page.route("**/*", async (route) => {
    if (route.request().url() === ENTRY_URL) {
      await route.fulfill({ contentType: "text/html", body: html });
    } else {
      await route.abort();
    }
  });
  await page.goto(ENTRY_URL);
  await expect(page.locator(".scene-focus h1")).toContainText("アキ");
  await expect(page.locator(".scene-focus h1")).toContainText("共同の居間");
  await expect(page.locator(".header .time")).toHaveText("08:00");
  const roster = page.locator(".residents-list .resident-card");
  await expect(roster).toHaveCount(3);
  for (const name of ["アキ", "ミオ", "レン"]) {
    await expect(roster.filter({ hasText: name })).toBeVisible();
  }
  await expect(roster.filter({ hasText: "アキ" })).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  check("単体HTMLがオフラインで起動し、三人の住民と現在の場面を表示する");

  await page
    .locator(".action-grid")
    .getByRole("button", { name: "木彫りをする", exact: false })
    .click();
  let state = await storedState(page);
  assert.equal(state.minutes, 480, "行動の予約では時間を進めない");
  const hobby = state.residents.find(
    (resident) => resident.id === "aki",
  ).action;
  assert.equal(hobby.kind, "hobby");
  assert.equal(hobby.duration, 45);
  assert.equal(hobby.progress, 0);
  // Follow actual world boundaries, including the NPC's movement and help.
  let boundaries = 0;
  while (!state.flags.hobbyFinished && boundaries < 8) {
    const previousMinutes = state.minutes;
    await page.locator(".next-button").click();
    state = await storedState(page);
    assert.ok(state.minutes > previousMinutes, "区切り操作で共通時計が進む");
    assert.ok(state.minutes <= 525, "木彫り完了までの45分を飛び越さない");
    boundaries++;
  }
  assert.equal(state.flags.hobbyFinished, true, "木彫りが実際に完成する");
  assert.ok(
    state.minutes < 525,
    "実際に時間を使った援助で、基準45分より早く完成する",
  );
  assert.equal(
    state.residents.find((resident) => resident.id === "aki").action,
    null,
  );
  const completedLog = state.logs.find(
    (entry) => entry.title === "小さな木彫り",
  );
  assert.ok(completedLog);
  assert.equal(
    completedLog.time,
    state.minutes,
    "作品完成の区切りを通り越さない",
  );
  assert.ok(
    state.life.events.some(
      (event) =>
        event.kind === "help" &&
        event.actors.includes("mio") &&
        event.subjectId === "aki",
    ),
  );
  assert.ok(
    state.life.crafts.some(
      (piece) => piece.authorId === "aki" && piece.createdAt === state.minutes,
    ),
  );
  const completionMinutes = state.minutes;
  const completionClock = clockText(completionMinutes);
  await expect(page.locator(".header .time")).toHaveText(completionClock);
  check(
    `実際の区切り操作${boundaries}回で、援助を受けた本人の木彫りが完成する`,
  );

  await page.locator(".save-button").click();
  await expect(page.getByRole("dialog")).toBeVisible();
  await page
    .getByRole("button", { name: "いまの暮らしを保存する", exact: true })
    .click();
  const manualSave = await storedState(page, SAVE_KEY);
  assert.deepEqual(
    manualSave,
    state,
    "手動保存に作品・人物・途中仕事・乱数を残す",
  );
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog")).not.toBeVisible();
  await page.reload();
  await expect(page.locator(".header .time")).toHaveText(completionClock);
  await expect(page.locator(".scene-focus h1")).toContainText("アキ");
  await expect(roster).toHaveCount(3);
  assert.deepEqual(await storedState(page), state);
  assert.deepEqual(await storedState(page, SAVE_KEY), manualSave);
  check("手動保存した作品と三人の状態が、オフラインの再読込後も残る");

  // Prove that the manual slot is usable independently of the newer autosave.
  await page.getByRole("button", { name: "5分", exact: true }).click();
  await expect(page.locator(".header .time")).toHaveText(
    clockText(completionMinutes + 5),
  );
  assert.equal((await storedState(page)).minutes, completionMinutes + 5);
  await page.locator(".save-button").click();
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "読み込む", exact: true })
    .click();
  await expect(page.getByRole("dialog")).not.toBeVisible();
  await expect(page.locator(".header .time")).toHaveText(completionClock);
  assert.deepEqual(await storedState(page), manualSave);
  check("更新された自動保存とは別の手動保存から、同じ状態へ戻れる");

  assert.deepEqual(pageErrors, [], "未処理JavaScript例外がない");
  assert.deepEqual(consoleErrors, [], "ブラウザのconsole.errorがない");
  assert.deepEqual(
    requests,
    [ENTRY_URL, ENTRY_URL],
    "初回と再読込のHTML以外を要求しない",
  );
  check("外部通信・追加アセット要求・ブラウザエラーがない");
  console.log(`\n${checks.length} standalone browser checks passed.`);
} finally {
  await browser.close();
}
