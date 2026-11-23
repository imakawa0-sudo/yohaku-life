// Exercise the distributed local HTML in isolated browser contexts. Only the
// explicitly controlled journeys below seed or change browser storage.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { chromium, expect } from "@playwright/test";
import { tsImport } from "tsx/esm/api";

const sim = await tsImport("../src/reform/sim.ts", import.meta.url);
const { initialHouse } = await tsImport(
  "../src/reform/house.ts",
  import.meta.url,
);
const { makePersona } = await tsImport(
  "../src/reform/peopleModel.ts",
  import.meta.url,
);
const { generateWorld, defaultWorldConfig } = await tsImport(
  "../src/reform/world.ts",
  import.meta.url,
);
const html = await readFile(process.env.REFORM_HTML || "dist/yohaku.html");
const output = resolve(
  process.env.PLAYTEST_OUTPUT || "/tmp/yohaku-housing-playtest",
);
const report = {
  sha256: createHash("sha256").update(html).digest("hex"),
  normal: [],
  controlled: [],
  screenshots: [],
  errors: [],
};
await mkdir(output, { recursive: true });
const startUrl = "https://housing.offline.test/";
const key = "yohaku-reform-library-v2",
  legacyKey = "yohaku-reform-library-v1",
  lock = key + ":write";
const name = "川辺で朝食を作る旅人" + "朝凪".repeat(10);
const finishName = "次の行動完了まで進める";
const button = (page, label) =>
  page.getByRole("button", { name: label, exact: true });
let browser;
async function context() {
  const ctx = await browser.newContext({
    offline: true,
    viewport: { width: 1280, height: 900 },
    acceptDownloads: true,
  });
  await ctx.route("**/*", async (route) => {
    if (route.request().url() === startUrl)
      await route.fulfill({
        contentType: "text/html; charset=utf-8",
        body: html,
      });
    else {
      report.errors.push("unexpected request: " + route.request().url());
      await route.abort();
    }
  });
  ctx.on("page", (p) => {
    p.on("pageerror", (e) => report.errors.push(e.message));
    p.on("console", (m) => {
      if (m.type() === "error") report.errors.push(m.text());
    });
  });
  return ctx;
}
async function open(ctx) {
  const page = await ctx.newPage();
  await page.goto(startUrl);
  return page;
}
async function settled(page) {
  await expect(page.locator(".rf-app")).toHaveAttribute("aria-busy", "false");
}
async function click(page, label) {
  await button(page, label).click();
  await settled(page);
}
const raw = (p, k = key) => p.evaluate((key) => localStorage.getItem(key), k);
const library = async (p) => JSON.parse(await raw(p));
const active = (lib) => lib.slots.find((s) => s.id === lib.activeId);
const game = async (p) => active(await library(p)).game;
const spatial = (g) => g.housing.state.actors[g.actors[0].person.id];
const cloneJSON = (value) => JSON.parse(JSON.stringify(value));
async function fold(page, label) {
  const summary = page.locator("summary").filter({ hasText: label }).first();
  if (!(await summary.locator("..").evaluate((el) => el.open)))
    await summary.click();
}
async function cook(p) {
  const panel = p.getByRole("region", { name: "行動の指示" });
  await button(panel, "仕事").click();
  await panel.locator('button[data-kind="work"][data-target="cook"]').click();
  await settled(p);
}
async function forkMorning(p) {
  await click(p, "手帳");
  await click(p, "同じ朝から分岐");
  await expect(button(p, "5分進める")).toBeVisible();
}
async function snapshot(p, width) {
  await p.setViewportSize({ width, height: width < 600 ? 844 : 900 });
  const panel = p.getByRole("region", { name: "家の中の移動と設定" });
  await fold(p, "部屋を利用できる住民");
  await fold(p, "通路と扉");
  const control = button(panel, "寝室と裏庭の通路を開ける");
  await control.focus();
  await control.evaluate((el) => el.scrollIntoView({ block: "center" }));
  const fit = await p.evaluate(() => {
    const b = document.activeElement.getBoundingClientRect();
    return {
      width: innerWidth,
      content: document.documentElement.scrollWidth,
      bottom: b.bottom,
      clock: document.querySelector(".lf-clock").getBoundingClientRect().top,
    };
  });
  assert.ok(fit.content <= width + 1, JSON.stringify(fit));
  assert.ok(fit.bottom <= fit.clock, JSON.stringify(fit));
  assert.ok(await control.evaluate((el) => el === document.activeElement));
  const file = "housing-wait-" + width + ".png";
  await p.screenshot({ path: resolve(output, file), animations: "disabled" });
  report.screenshots.push(file);
}
async function normal() {
  const ctx = await context();
  try {
    const p = await open(ctx);
    await click(p, "川辺の一人旅");
    await click(p, "人物");
    await p.getByRole("textbox", { name: "名前", exact: true }).fill(name);
    await fold(p, "住人を詳しくつくる");
    await p.getByLabel("髪色", { exact: true }).selectOption("silver");
    await click(p, "住まい");
    await click(p, "居間");
    await click(p, "小さなかまど");
    await p.getByLabel("移設先の部屋", { exact: true }).selectOption("yard");
    await click(p, "この部屋へ移す");
    await click(p, "この朝を始める");
    const start = active(await library(p));
    assert.deepEqual(start.game, start.origin);
    assert.equal(start.game.actors[0].person.appearance.hairColor, "silver");
    assert.equal(start.game.actors[0].person.name, name);
    assert.equal(spatial(start.game).position.kind, "at");
    await cook(p);
    const ordered = await game(p);
    assert.equal(ordered.time, start.game.time);
    assert.equal(ordered.ingredients, start.game.ingredients - 2);
    await click(p, "5分進める");
    const partial = await game(p);
    assert.equal(spatial(partial).position.kind, "transit");
    assert.equal(
      spatial(partial).order.useRemaining,
      spatial(ordered).order.useRemaining,
    );
    await click(p, "手帳");
    const download = p.waitForEvent("download");
    await click(p, "保存を書き出す");
    const file = await download;
    const exported = JSON.parse(await readFile(await file.path(), "utf8"));
    assert.equal(exported.version, 2);
    assert.deepEqual(exported.slot.game, partial);
    await p.reload();
    await expect(button(p, finishName)).toBeVisible();
    assert.deepEqual(await game(p), partial);
    await click(p, finishName);
    const done = await game(p);
    assert.deepEqual(
      done,
      cloneJSON(sim.advance(partial, sim.nextCompletionMinutes(partial))),
    );
    assert.equal(done.actors[0].task, null);
    assert.equal(done.ingredients, ordered.ingredients);
    assert.equal(done.food, ordered.food + 3);
    await p.reload();
    assert.deepEqual(await game(p), done);
    report.normal.push(
      "新規作成・髪色と名前の設定・かまど移設・通路内の途中書出し・再読込み・料理1回の完成",
    );
    await forkMorning(p);
    await cook(p);
    const reserved = await game(p);
    await fold(p, "通路と扉");
    await click(p, "寝室と裏庭の通路を閉める");
    assert.equal((await game(p)).time, reserved.time);
    await click(p, "5分進める");
    const waiting = await game(p);
    assert.equal(spatial(waiting).order.waitReason, "physical-block");
    assert.equal(spatial(waiting).order.id, spatial(reserved).order.id);
    await expect(button(p, finishName)).toBeDisabled();
    await expect(
      p.getByRole("region", { name: "家の中の移動と設定" }),
    ).toContainText("目的地への通路が通れません");
    for (const width of [1280, 390, 320]) await snapshot(p, width);
    await click(p, "寝室と裏庭の通路を開ける");
    assert.equal((await game(p)).time, waiting.time);
    await click(p, finishName);
    assert.equal((await game(p)).food, reserved.food + 3);
    report.normal.push(
      "閉鎖による待機・同じ予約での再開、PC/390/320pxの横幅・フォーカス・画面写真",
    );
    await forkMorning(p);
    await cook(p);
    await click(p, "5分進める");
    const travelling = await game(p);
    await click(p, "現在の予定を取り消す");
    const cancelling = await game(p);
    assert.equal(spatial(cancelling).order.phase, "exiting-after-cancel");
    assert.equal(cancelling.ingredients, travelling.ingredients);
    await expect(button(p, "寝室の入口へ移動")).toBeDisabled();
    await p.reload();
    await click(p, finishName);
    const exited = await game(p);
    assert.equal(exited.actors[0].task, null);
    assert.equal(exited.food, travelling.food);
    assert.equal(exited.ingredients, start.game.ingredients);
    assert.equal(
      exited.time,
      cancelling.time + spatial(cancelling).position.remaining,
    );
    await p.reload();
    assert.deepEqual(await game(p), exited);
    report.normal.push("区間途中の取消・途中再読込み・退出時の予約返却が1回");
  } finally {
    await ctx.close();
  }
}
async function twoResidents() {
  const ctx = await context();
  try {
    const p = await open(ctx);
    await click(p, "木工の二人");
    await click(p, "住まい");
    await fold(p, "室内のマスを編集");
    await click(p, "2列1行　床");
    await p.getByLabel("2列1行の編集").selectOption("door");
    await click(p, "選んだマスに適用");
    await click(p, "この朝を始める");
    const initial = await game(p);
    await fold(p, "通路と扉");
    await click(p, "居間の扉（2列1行）を閉める");
    await click(p, "居間の扉（2列1行）を開ける");
    await fold(p, "部屋を利用できる住民");
    const bedroom = p.getByRole("group", { name: "寝室", exact: true });
    const permit = bedroom.getByRole("checkbox", { name: "カヤ", exact: true });
    await expect(permit).toBeChecked();
    await permit.click();
    await settled(p);
    await expect(permit).not.toBeChecked();
    await expect(button(p, "寝室の入口へ移動")).toBeDisabled();
    await expect(button(p, "寝室の入口へ移動").locator("..")).toContainText(
      "許可",
    );
    await permit.click();
    await settled(p);
    await expect(permit).toBeChecked();
    assert.equal((await game(p)).time, initial.time);
    // Give the other resident a real independent task at the living entrance.
    await click(p, "スイ");
    await p.locator('button[data-kind="leisure"]').click();
    await settled(p);
    await click(p, "カヤ");
    await click(p, "寝室の入口へ移動");
    await click(p, finishName);
    const apart = await game(p);
    assert.equal(apart.actors[0].room, "bedroom");
    await fold(p, "住民の近くへ移動");
    await click(p, "スイの近くへ移動");
    await click(p, finishName);
    const together = await game(p);
    const at = together.housing.state.actors;
    assert.deepEqual(
      at[together.actors[0].person.id].position,
      at[together.actors[1].person.id].position,
    );
    report.normal.push(
      "二人の住民で室内扉・個別許可を時計を進めず変更し、部屋の入口と相手の現在地点まで移動",
    );
  } finally {
    await ctx.close();
  }
}
function legacyFixture() {
  const origin = sim.createGame(
    [makePersona(0, 23)],
    generateWorld(defaultWorldConfig()),
    "village",
    initialHouse(),
  );
  const game = sim.advance(
    sim.order(origin, origin.actors[0].person.id, "work", "cook"),
    5,
  );
  return { id: "qa-old", name: "検証用・途中の料理", origin, game };
}
async function legacy() {
  const ctx = await context();
  try {
    const p = await open(ctx);
    const slot = legacyFixture();
    const source = JSON.stringify({
      format: 1,
      activeId: slot.id,
      slots: [slot],
    });
    await p.evaluate(
      ([k, v]) => localStorage.setItem(k, v),
      [legacyKey, source],
    );
    await p.reload();
    await expect(p.getByRole("alert")).toContainText("複写");
    await click(p, "手帳");
    await click(p, "住居の移動を使う暮らしに分岐");
    await expect(button(p, finishName)).toBeVisible();
    const book = await library(p),
      upgraded = active(book);
    assert.equal(await raw(p, legacyKey), source);
    assert.deepEqual(
      book.slots.find((s) => s.id === slot.id),
      cloneJSON(slot),
    );
    assert.deepEqual(upgraded.game.actors[0].task, slot.game.actors[0].task);
    assert.deepEqual(upgraded.game.actors[0].task.reserved, { ingredients: 2 });
    assert.ok(upgraded.origin.housing);
    const panel = p.getByRole("region", { name: "家の中の移動と設定" });
    await expect(panel).toContainText("室内位置は未確定");
    await click(p, finishName);
    const done = await game(p);
    assert.equal(
      done.food,
      sim.advance(slot.game, slot.game.actors[0].task.remaining).food,
    );
    assert.equal(done.ingredients, slot.game.ingredients);
    await expect(panel).toContainText("室内位置は未確定");
    await click(p, "寝室の入口へ移動");
    assert.equal(spatial(await game(p)).position.point.cell, 0);
    assert.equal(await raw(p, legacyKey), source);
    report.controlled.push(
      "隔離した旧キーの途中料理を分岐。原本・予約・旧残り時間、完了後に初めて受理した移動の出発点を確認",
    );
  } finally {
    await ctx.close();
  }
}
async function firstCopyConflict() {
  const ctx = await context();
  try {
    const p = await open(ctx);
    const slot = legacyFixture();
    const makeRaw = (s) =>
      JSON.stringify({ format: 1, activeId: s.id, slots: [s] });
    const source = makeRaw(slot);
    await p.evaluate(
      ([k, v]) => localStorage.setItem(k, v),
      [legacyKey, source],
    );
    await p.reload();
    await click(p, "手帳");
    const changed = makeRaw({ ...slot, game: sim.advance(slot.game, 1) });
    // A legacy writer does not cooperate with Web Locks. This tests the
    // last-moment comparison without an advance storage-event notification.
    await p.evaluate(
      ([k, v]) => localStorage.setItem(k, v),
      [legacyKey, changed],
    );
    await click(p, "住居の移動を使う暮らしに分岐");
    await expect(p.getByRole("alert")).toContainText("別のタブ");
    assert.equal(await raw(p), null);
    assert.equal(await raw(p, legacyKey), changed);
    await click(p, "住居の移動を使う暮らしに分岐");
    assert.equal((await game(p)).time, slot.game.time + 1);
    assert.equal(await raw(p, legacyKey), changed);
    report.controlled.push(
      "初回複写前に旧キーが変わった場合に中断し、再操作で変更後の旧手帳から分岐",
    );
  } finally {
    await ctx.close();
  }
}
async function renderBoundary() {
  const ctx = await context();
  try {
    const p = await open(ctx);
    await click(p, "川辺の一人旅");
    await click(p, "この朝を始める");
    const book = await library(p),
      slot = active(book);
    const latest = sim.advance(slot.game, 15);
    slot.game = latest;
    // A storage notification and a user click delivered in the same JS task
    // can hit a callback from the previous render. Only the new state may win.
    await p.evaluate(
      ([key, data]) => {
        const next = JSON.stringify(data);
        const old = localStorage.getItem(key);
        localStorage.setItem(key, next);
        window.dispatchEvent(
          new StorageEvent("storage", {
            key,
            oldValue: old,
            newValue: next,
            storageArea: localStorage,
          }),
        );
        document.querySelector('button[aria-label="5分進める"]').click();
      },
      [key, book],
    );
    await settled(p);
    const actual = await game(p);
    assert.ok(actual.time === latest.time || actual.time === latest.time + 5);
    assert.deepEqual(
      actual,
      cloneJSON(actual.time === latest.time ? latest : sim.advance(latest, 5)),
    );
    report.controlled.push(
      "変更通知と同じ処理内の時間送りで、更新前の画面から最新の暮らしを巻き戻さない",
    );
  } finally {
    await ctx.close();
  }
}
async function coldRecovery() {
  const ctx = await context();
  try {
    const p = await open(ctx);
    await p.evaluate((k) => {
      localStorage.setItem(k, "{");
    }, key);
    await p.reload();
    const alert = p.getByRole("alert");
    await expect(alert).toContainText("別のブラウザ");
    await expect(alert).not.toContainText("保存を書き出す");
    await click(p, "手帳");
    await expect(button(p, "保存を書き出す")).toHaveCount(0);
    assert.equal(await raw(p), "{");
  } finally {
    await ctx.close();
  }
  const fresh = await context();
  try {
    const p = await open(fresh);
    await p.evaluate((k) => {
      const original = Storage.prototype.setItem;
      Storage.prototype.setItem = function (key, value) {
        if (key === k)
          throw new DOMException("Test quota", "QuotaExceededError");
        return original.call(this, key, value);
      };
      window.allowWriting = () => {
        Storage.prototype.setItem = original;
      };
    }, key);
    await click(p, "川辺の一人旅");
    await click(p, "この朝を始める");
    await expect(button(p, "この朝を始める")).toBeVisible();
    await expect(p.getByRole("alert")).toContainText("もう一度");
    await expect(p.getByRole("alert")).not.toContainText("保存を書き出す");
    assert.equal(await raw(p), null);
    await p.evaluate(() => window.allowWriting());
    await click(p, "この朝を始める");
    await expect(button(p, "5分進める")).toBeVisible();
    assert.equal((await library(p)).slots.length, 1);
    report.controlled.push(
      "破損した手帳の別環境での復旧案内と、空の初回保存失敗で作成画面に留まり、復旧後に同じ設定で再試行",
    );
  } finally {
    await fresh.close();
  }
}

async function acknowledgementBeforeNotification() {
  const ctx = await context();
  try {
    const a = await open(ctx);
    if (!(await a.evaluate(() => !!navigator.locks))) {
      report.controlled.push(
        "Web Locks非対応のため通知前の成功応答配送の検証は未実施",
      );
      return;
    }
    await click(a, "川辺の一人旅");
    await click(a, "この朝を始める");
    await click(a, "手帳");
    const original = active(await library(a));
    const b = await open(ctx);
    await click(b, "手帳");
    await a.evaluate(() => {
      const queued = [];
      let holding = true;
      window.addEventListener(
        "storage",
        (event) => {
          if (holding) {
            event.stopImmediatePropagation();
            queued.push(event);
          }
        },
        true,
      );
      window.deliverStorage = () => {
        holding = false;
        for (const event of queued) window.dispatchEvent(event);
      };
      window.notificationQueued = () => queued.length > 0;
      const manager = navigator.locks;
      const request = manager.request.bind(manager);
      manager.request = async (...args) => {
        const result = await request(...args);
        return new Promise((resolve) => {
          window.deliverSave = () => resolve(result);
        });
      };
    });
    await button(a, "今の時点から分岐").click();
    await a.waitForFunction(() => typeof window.deliverSave === "function");
    await expect(
      b.locator('.rf-slots button[aria-current="true"]'),
    ).toContainText("分岐");
    // B reopens the original slot. A cannot observe its storage notification yet.
    await b
      .locator(".rf-slots button")
      .filter({ has: b.getByText(original.name, { exact: true }) })
      .click();
    await settled(b);
    await a.waitForFunction(() => window.notificationQueued());
    const finalRaw = await raw(b);
    assert.equal(JSON.parse(finalRaw).activeId, original.id);
    await a.evaluate(() => window.deliverSave());
    await settled(a);
    await expect(
      a.getByRole("heading", { name: "暮らしの手帳", exact: true }),
    ).toBeVisible();
    await expect(a.locator(".rf-slots button")).toHaveCount(2);
    await expect(
      a.locator('.rf-slots button[aria-current="true"] span'),
    ).toHaveText(original.name);
    await expect(a.getByRole("alert")).toContainText("別のタブ");
    await expect(
      a.getByText("元の暮らしを手帳に残し、別の暮らしを開きました。", {
        exact: true,
      }),
    ).toHaveCount(0);
    await a.evaluate(() => window.deliverStorage());
    await expect(
      a.getByRole("heading", { name: "暮らしの手帳", exact: true }),
    ).toBeVisible();
    assert.equal(await raw(a), finalRaw);
    report.controlled.push(
      "別タブの変更通知を保留したまま分岐の成功応答を先に届けても、最新の元枠を表示し、分岐成功の画面へ移らない",
    );
  } finally {
    await ctx.close();
  }
}
async function competition() {
  const ctx = await context();
  try {
    const a = await open(ctx);
    await click(a, "川辺の一人旅");
    await click(a, "この朝を始める");
    const b = await open(ctx);
    const start = await game(a);
    if (!(await a.evaluate(() => !!navigator.locks))) {
      await click(a, "5分進める");
      await expect(a.getByRole("alert")).toContainText(
        "複数のタブで同時に操作しない",
      );
      report.controlled.push(
        "Web Locks非対応。直前照合環境の案内を確認。ロック競合の試遊は未実施",
      );
      return;
    }
    // Hold the actual origin lock so both app tabs submit the same witness.
    await a.evaluate(
      (name) =>
        new Promise((resolve) => {
          void navigator.locks.request(
            name,
            () =>
              new Promise((release) => {
                window.releaseGate = release;
                resolve();
              }),
          );
        }),
      lock,
    );
    await Promise.all([
      button(a, "5分進める").click(),
      button(b, "15分進める").click(),
    ]);
    for (const p of [a, b]) {
      await expect(p.locator(".rf-app")).toHaveAttribute("aria-busy", "true");
      await expect(button(p, "5分進める")).toBeDisabled();
    }
    await a.evaluate(() => window.releaseGate());
    await Promise.all([settled(a), settled(b)]);
    const winner = await game(a);
    assert.ok([5, 15].includes(winner.time - start.time));
    const loser = winner.time - start.time === 5 ? b : a;
    await expect(loser.getByRole("alert")).toContainText("別のタブ");
    report.controlled.push(
      "実ブラウザのWeb Locksを2タブで競合させ、一方だけが進み、もう一方は最新の手帳を表示",
    );
    // Delay delivery of the first tab's successful result after the real lock
    // has been released. Another tab can now save before that result returns.
    await a.evaluate(() => {
      const manager = navigator.locks;
      const request = manager.request.bind(manager);
      manager.request = async (...args) => {
        window.deliverSave = null;
        const result = await request(...args);
        return new Promise((resolve) => {
          window.deliverSave = () => resolve(result);
        });
      };
    });
    await button(a, "5分進める").click();
    await a.waitForFunction(() => typeof window.deliverSave === "function");
    const stamp = (t) =>
      String(Math.floor(t / 60) % 24).padStart(2, "0") +
      ":" +
      String(t % 60).padStart(2, "0");
    const shows = (p, t) =>
      expect(
        p.getByLabel("現在時刻 " + stamp(t), { exact: true }),
      ).toBeVisible();
    await shows(b, winner.time + 5);
    await click(b, "15分進める");
    const newest = await game(b);
    await shows(a, newest.time);
    await a.evaluate(() => window.deliverSave());
    await settled(a);
    await shows(a, newest.time);
    assert.equal((await game(a)).time, winner.time + 20);
    const latestRaw = await raw(b);
    await button(a, "5分進める").click();
    await a.waitForFunction(() => typeof window.deliverSave === "function");
    await shows(b, newest.time + 5);
    await b.evaluate((k) => localStorage.setItem(k, "{"), key);
    await expect(a.getByRole("alert")).toContainText("元の保存を保護");
    await a.evaluate(() => window.deliverSave());
    await settled(a);
    await expect(a.getByRole("alert")).toContainText("元の保存を保護");
    assert.equal(await raw(a), "{");
    await click(a, "手帳");
    await expect(a.getByRole("alert")).toContainText("表示中の暮らし");
    const download = a.waitForEvent("download");
    await click(a, "保存を書き出す");
    const copy = JSON.parse(
      await readFile(await (await download).path(), "utf8"),
    );
    assert.deepEqual(copy.slot.game, newest);
    assert.equal(await raw(a), "{");
    await b.evaluate(([k, v]) => localStorage.setItem(k, v), [key, latestRaw]);
    await expect(a.getByRole("alert")).toContainText("別のタブ");
    await b.evaluate((k) => localStorage.removeItem(k), key);
    await expect(
      a.getByText("初めて迎えた朝はここに保存されます。"),
    ).toBeVisible();
    assert.equal(await raw(a), null);
    report.controlled.push(
      "成功応答の配送を一時保留し、別タブが後から保存／破損したときに古い成功を表示しないこと、原本保護と削除の反映を確認",
    );
  } finally {
    await ctx.close();
  }
}
try {
  browser = await chromium.launch({
    headless: true,
    executablePath: process.env.CHROMIUM_PATH || "/usr/bin/chromium",
    args: ["--no-sandbox"],
  });
  await normal();
  await twoResidents();
  await legacy();
  await firstCopyConflict();
  await renderBoundary();
  await coldRecovery();
  await competition();
  await acknowledgementBeforeNotification();
  assert.deepEqual(report.errors, []);
  console.log(JSON.stringify(report, null, 2));
} catch (error) {
  report.errors.push(String(error));
  throw error;
} finally {
  await writeFile(
    resolve(output, "housing-result.json"),
    JSON.stringify(report, null, 2) + "\n",
  );
  await browser?.close();
}
