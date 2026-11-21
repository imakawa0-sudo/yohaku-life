// Play the distributed, offline game and compare actual raster output as its appearance changes.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { chromium, expect } from "@playwright/test";

const html = await readFile(
  process.env.REFORM_HTML || "dist/yohaku.html",
  "utf8",
);
const output = resolve(process.env.PLAYTEST_OUTPUT || "/tmp/yohaku-pixel-art");
const storageKey = "yohaku-reform-library-v1";
const url = "http://pixel-art.offline.test/";
const report = {
  sha256: createHash("sha256").update(html).digest("hex"),
  checks: [],
  pictures: [],
  variantCounts: {},
  scene: [],
  errors: [],
  network: [],
};
const browser = await chromium.launch({
  headless: true,
  executablePath: process.env.CHROMIUM_PATH || "/usr/bin/chromium",
  args: ["--no-sandbox"],
});
await mkdir(output, { recursive: true });
function check(text) {
  report.checks.push(text);
  console.log("✓ " + text);
}
function btn(page, name) {
  return page.getByRole("button", { name, exact: true });
}
async function fresh(width, library) {
  const context = await browser.newContext({
    offline: true,
    viewport: { width, height: width < 600 ? 844 : 900 },
  });
  await context.route("**/*", (route) => {
    if (route.request().url() === url)
      return route.fulfill({
        contentType: "text/html; charset=utf-8",
        body: html,
      });
    report.network.push(route.request().url());
    return route.abort();
  });
  if (library)
    await context.addInitScript(
      ({ k, data }) => {
        if (!sessionStorage.getItem("legacy-session")) {
          localStorage.setItem(k, data);
          sessionStorage.setItem("legacy-session", "1");
        }
      },
      { k: storageKey, data: library },
    );
  const page = await context.newPage();
  page.setDefaultTimeout(7500);
  page.on("pageerror", (err) => report.errors.push(err.message));
  page.on("console", (msg) => {
    if (msg.type() === "error") report.errors.push(msg.text());
  });
  await page.goto(url);
  return page;
}
async function settle(page) {
  await page.evaluate(async () => {
    await Promise.all(
      [...document.images]
        .filter((img) => img.currentSrc)
        .map((img) => img.decode()),
    );
    await new Promise((done) =>
      requestAnimationFrame(() => requestAnimationFrame(done)),
    );
  });
}
async function picture(page, name, element) {
  await settle(page);
  assert.ok(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth + 1,
    ),
    "Horizontal overflow in " + name,
  );
  await (element || page).screenshot({
    path: resolve(output, name + ".png"),
    animations: "disabled",
  });
  report.pictures.push(name);
}
async function raster(canvas) {
  await expect(canvas).toHaveCount(1);
  const sample = await canvas.evaluate((el) => {
    const c = el.getContext("2d"),
      bytes = c.getImageData(0, 0, el.width, el.height).data;
    let pixels = 0;
    const colors = new Set();
    for (let i = 0; i < bytes.length; i += 4)
      if (bytes[i + 3] > 0) {
        pixels++;
        colors.add(bytes.slice(i, i + 3).join());
      }
    return {
      pixels,
      colors: colors.size,
      url: el.toDataURL(),
      width: el.width,
      height: el.height,
    };
  });
  assert.ok(
    sample.pixels >= 25 && sample.colors >= 4,
    "Figure is rendered with visible color clusters",
  );
  return createHash("sha256").update(sample.url).digest("hex");
}
async function game(page) {
  return page.evaluate((key) => {
    const d = JSON.parse(localStorage.getItem(key));
    return d.slots.find((s) => s.id === d.activeId).game;
  }, storageKey);
}
const labels = [
  "顔の輪郭",
  "肌の色",
  "髪形",
  "髪色",
  "年代",
  "体格",
  "目元",
  "顔の特徴",
  "服装",
  "服の色",
];
const selected = [
  "angular",
  "bronze",
  "braid",
  "silver",
  "elder",
  "broad",
  "straight",
  "glasses",
  "coat",
  "brick",
];
async function editor(page) {
  const details = page.locator(".yp-customize");
  if (!(await details.evaluate((e) => e.open)))
    await details.locator("summary").click();
}
async function compose(page, full, dye) {
  await editor(page);
  const portrait = page.locator(".yp-cover .yp-portrait");
  const standing = page.locator(".yp-full-length");
  for (const [i, label] of labels.entries()) {
    const select = page.getByLabel(label, { exact: true });
    if (full) {
      const values = await select
        .locator("option")
        .evaluateAll((items) => items.map((o) => o.value));
      const signatures = new Set();
      const standingSignatures = new Set();
      for (const value of values) {
        await select.selectOption(value);
        await settle(page);
        signatures.add(await raster(portrait));
        standingSignatures.add(await raster(standing));
      }
      assert.equal(
        signatures.size,
        values.length,
        label + " has indistinguishable portrait choices",
      );
      assert.equal(
        standingSignatures.size,
        values.length,
        label + " has indistinguishable full-body choices",
      );
      report.variantCounts[label] = signatures.size;
    }
    await select.selectOption(i === 9 ? dye : selected[i]);
  }
  await settle(page);
  const hash = await raster(portrait);
  assert.equal(
    hash,
    await raster(
      page.locator(".yp-roster button[aria-pressed=true] .yp-portrait"),
    ),
    "Roster and full portrait show the same person",
  );
  return hash;
}
async function transfer(page, id, label, expected) {
  await btn(page, "地域").click();
  await btn(page, label).click();
  await page
    .getByRole("button", { name: new RegExp(label + "へ移動する") })
    .click();
  for (let tries = 0; tries < 18; tries++) {
    const actor = (await game(page)).actors.find((p) => p.person.id === id);
    if (actor.location === expected) return;
    await btn(page, "次の行動完了まで進める").click();
  }
  throw new Error("Travel did not reach " + expected);
}
const scenery = new Map();
async function scene(page, id) {
  await settle(page);
  const artwork = page.locator(".yp-scene");
  await expect(artwork).toBeVisible();
  await expect(artwork).toHaveAttribute("data-person", id);
  const setting = await artwork.getAttribute("data-setting");
  const source = await artwork.locator(".yp-landscape").getAttribute("src");
  assert.ok(source);
  const figuresFit = await artwork.evaluate((scene) => {
    const frame = scene.getBoundingClientRect();
    return [...scene.querySelectorAll(".yp-walker")].every((canvas) => {
      const figure = canvas.getBoundingClientRect();
      return (
        figure.height > 0 &&
        Math.abs(
          figure.width - (figure.height * canvas.width) / canvas.height,
        ) < 1 &&
        figure.left >= frame.left - 1 &&
        figure.top >= frame.top - 1 &&
        figure.right <= frame.right + 1 &&
        figure.bottom <= frame.bottom + 1
      );
    });
  });
  assert.ok(
    figuresFit,
    setting + " shows entire figures at their native proportions",
  );
  scenery.set(setting, createHash("sha256").update(source).digest("hex"));
  return {
    artwork,
    setting: await artwork.getAttribute("data-setting"),
    light: await artwork.getAttribute("data-light"),
    sprite: await raster(
      artwork.locator('.yp-walker[data-person="' + id + '"]'),
    ),
  };
}
async function desktop() {
  const page = await fresh(1280);
  const covers = [];
  for (const name of ["川辺の一人旅", "市場の商人", "木工の二人"]) {
    await btn(page, name).click();
    await settle(page);
    const cover = page.locator("img.rf-cover-art");
    assert.ok(await cover.evaluate((i) => i.complete && i.naturalWidth > 0));
    covers.push(await cover.getAttribute("src"));
  }
  assert.equal(
    new Set(covers).size,
    3,
    "Starting places have different landscape covers",
  );
  await picture(page, "desktop-cover");
  await page.getByRole("textbox", { name: "名前", exact: true }).fill("紅藍");
  const portraitOne = await compose(page, true, "brick");
  const standingOne = await raster(page.locator(".yp-full-length"));
  await picture(page, "portrait", page.locator(".yp-cover"));
  await page
    .locator(".yp-roster")
    .getByRole("button", { name: "スイ" })
    .click();
  await page.getByRole("textbox", { name: "名前", exact: true }).fill("藍青");
  const portraitTwo = await compose(page, false, "indigo");
  const standingTwo = await raster(page.locator(".yp-full-length"));
  assert.notEqual(portraitOne, portraitTwo);
  check(
    "外見10項目の各選択肢が顔絵と全身の両方に反映され、世帯一覧の顔絵も人物作成画面と一致した。",
  );
  await btn(page, "この朝を始める").click();
  const g = await game(page);
  const [a, b] = g.actors.map((actor) => actor.person);
  assert.deepEqual(a.appearance, { ...b.appearance, dye: "brick" });
  const red = await scene(page, a.id);
  assert.equal(
    red.sprite,
    standingOne,
    "First resident matches the full-length preview",
  );
  await expect(red.artwork.locator(".yp-walker")).toHaveCount(2);
  await picture(page, "desktop-home", red.artwork);
  await btn(page, b.name).click();
  const blue = await scene(page, b.id);
  assert.equal(
    blue.sprite,
    standingTwo,
    "Second resident matches the full-length preview",
  );
  assert.notEqual(
    red.sprite,
    blue.sprite,
    "Clothes selected during creation change the walking sprite",
  );
  check(
    "同じ外見で服の色だけが異なる二人を作り、暮らしの風景でも衣装の描画差を確認。",
  );
  await btn(page, a.name).click();
  await transfer(page, a.id, "柳の渡し", "landing");
  const river = await scene(page, a.id);
  await expect(river.artwork.locator(".yp-walker")).toHaveCount(1);
  assert.notEqual(river.setting, red.setting);
  assert.equal(
    river.sprite,
    red.sprite,
    "The same person's sprite accompanies travel",
  );
  await picture(page, "desktop-river", river.artwork);
  const morning = await river.artwork.screenshot();
  const lightPhases = new Set([river.light]);
  for (
    let i = 0;
    i < 24 && (await river.artwork.getAttribute("data-light")) !== "night";
    i++
  ) {
    await btn(page, "1時間進める").click();
    lightPhases.add(await river.artwork.getAttribute("data-light"));
  }
  assert.deepEqual([...lightPhases], ["morning", "day", "dusk", "night"]);
  const night = await scene(page, a.id);
  assert.equal(night.setting, river.setting);
  assert.equal(night.light, "night");
  assert.ok(!morning.equals(await night.artwork.screenshot()));
  await picture(page, "desktop-night", night.artwork);
  await transfer(page, a.id, "風見の峠", "pass");
  const ridge = await scene(page, a.id);
  assert.ok(red.setting !== ridge.setting && river.setting !== ridge.setting);
  await picture(page, "desktop-ridge", ridge.artwork);
  report.scene = [red, river, night, ridge].map(({ setting, light }) => ({
    setting,
    light,
  }));
  const old = await game(page);
  await page.reload();
  assert.deepEqual(await game(page), old);
  assert.equal((await scene(page, a.id)).sprite, red.sprite);
  check(
    "家から渡し場と峠へ移動し、服装、土地ごとの絵、同じ場所の夜景と再読込を確認。",
  );
  await page.context().close();
}
async function remainingViews() {
  const page = await fresh(390);
  await btn(page, "川辺の一人旅").click();
  await btn(page, "この朝を始める").click();
  const id = (await game(page)).actors[0].person.id;
  const orders = page.getByRole("region", { name: "行動の指示" });
  await btn(orders, "生活").click();
  await orders
    .locator('button[data-kind="need"][data-target="energy"]')
    .click();
  await btn(page, "次の行動完了まで進める").click();
  for (const [label, destination, setting] of [
    ["", "", "interior"],
    ["雑木の森", "forest", "forest"],
    ["白露の町", "village", "village"],
    ["水車の里", "mill", "mill"],
    ["対岸の果樹園", "orchard", "orchard"],
  ]) {
    if (destination) await transfer(page, id, label, destination);
    const view = await scene(page, id);
    assert.equal(view.setting, setting);
    report.scene.push({ setting: view.setting, light: view.light });
    await picture(page, "mobile-" + setting, view.artwork);
  }
  check(
    "一人旅で寝室から森・市場・水車の里・果樹園を訪れ、それぞれの土地に専用の挿絵が出る。",
  );
  await page.context().close();
}
async function mobile(width) {
  let prior;
  if (process.env.PIXEL_PRIOR_LIBRARY)
    prior = await readFile(process.env.PIXEL_PRIOR_LIBRARY, "utf8");
  const page = await fresh(width, prior);
  if (prior) {
    const d = JSON.parse(prior);
    assert.deepEqual(
      await game(page),
      d.slots.find((s) => s.id === d.activeId).game,
    );
  } else {
    await btn(page, "保存を開く").click();
    await page
      .locator("input[type=file]")
      .setInputFiles("public/woodworkers-morning.json");
  }
  await expect(btn(page, "15分進める")).toBeVisible();
  const first = await game(page);
  await scene(page, first.actors[0].person.id);
  await picture(page, "mobile-" + width);
  await btn(page, "15分進める").click();
  const now = await game(page);
  assert.ok(now.time > first.time);
  await page.reload();
  assert.deepEqual(await game(page), now);
  check(
    width + "pxで既存のセーブを引き継ぎ、時計と人物の表示を再開できた。",
  );
  await page.context().close();
}
try {
  await desktop();
  await remainingViews();
  assert.equal(scenery.size, 8);
  assert.equal(
    new Set(scenery.values()).size,
    8,
    "Each setting presents distinct landscape art",
  );
  await mobile(390);
  await mobile(320);
  assert.deepEqual(report.errors, []);
  assert.deepEqual(report.network, []);
  check("オフラインの単体HTMLで外部通信・未処理例外・横方向のはみ出しは0件。");
} finally {
  await writeFile(
    resolve(output, "result.json"),
    JSON.stringify(report, null, 2) + "\n",
  );
  await browser.close();
}
