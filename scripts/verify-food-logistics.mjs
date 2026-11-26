// Latest standalone HTML only, in disposable offline browser contexts.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { chromium, expect } from "@playwright/test";
import { tsImport } from "tsx/esm/api";

const load = (module) =>
  tsImport(`../src/reform/${module}.ts`, import.meta.url);
const [sim, food, library, presentation, topology, people, world, house] =
  await Promise.all(
    [
      "sim",
      "housing/food",
      "library",
      "housing/presentation",
      "housing/topology",
      "peopleModel",
      "world",
      "house",
    ].map(load),
  );
const output = resolve(
  process.env.PLAYTEST_OUTPUT || "/tmp/yohaku-food-logistics-playtest",
);
const prepareOnly = process.argv.includes("--prepare-only");
const result = {
  status: "preparing",
  normal: [],
  controlled: [],
  errors: [],
  screenshots: [],
};
const writeJson = (name, value) =>
  writeFile(resolve(output, name), JSON.stringify(value, null, 2) + "\n");
const plain = (value) => JSON.parse(JSON.stringify(value));
const entry = "https://food-logistics.offline.test/";
const button = (scope, name) =>
  scope.getByRole("button", { name, exact: true });
const panel = (page) => page.getByRole("region", { name: "食材の保管と運搬" });
const cook = (page) =>
  page.locator('button[data-kind="work"][data-target="cook"]');
const recipe = (page) => cook(page).locator("..");
const material = (page, id) =>
  recipe(page).locator(`input[type="radio"][value="${id}"]`);
const equipment = (page) => recipe(page).getByRole("combobox");
const bundle = (g) => g.housing.foodLogistics.bundle;
const resident = (g) => g.actors[0].person.id;
const item = (g) => g.housing.state.items[bundle(g).itemId];
const settled = (page) =>
  expect(page.locator(".rf-app")).toHaveAttribute("aria-busy", "false");
async function click(page, name, scope = page) {
  await button(scope, name).click();
  await settled(page);
}
async function activeSlot(page) {
  await settled(page);
  // This reads only the fresh context created in this script, never the user's save.
  const book = JSON.parse(
    await page.evaluate(
      (key) => localStorage.getItem(key),
      library.LIBRARY_KEY,
    ),
  );
  const slot = book.slots.find((s) => s.id === book.activeId);
  assert.ok(sim.isGame(slot.game) && sim.isGame(slot.origin));
  return slot;
}
async function game(page) {
  return (await activeSlot(page)).game;
}
async function compare(page, expected) {
  const actual = await game(page);
  assert.deepEqual(actual, plain(expected));
  return actual;
}
async function next(page, g) {
  const minutes = presentation.nextCompletionMinutes(g);
  assert.ok(minutes > 0);
  await click(page, "次の行動完了まで進める");
  return compare(page, sim.advance(g, minutes));
}
async function work(page) {
  await click(page, "仕事", page.getByRole("region", { name: "行動の指示" }));
  await expect(cook(page)).toBeVisible();
}
function ok(r) {
  assert.equal(r.error, undefined);
  return r.game;
}
async function prepare() {
  const create = (count = 1) =>
    sim.enableHousing(
      sim.createGame(
        Array.from({ length: count }, (_, i) => ({
          ...people.makePersona(i, i + 123),
          name: i ? "検証のスイ" : "検証のカヤ",
        })),
        world.generateWorld(world.defaultWorldConfig()),
        "village",
        house.initialHouse(),
      ),
      "new",
    );
  const empty = create();
  empty.ingredients = 0;
  const start = create();
  start.ingredients = 2;
  const zero = ok(
    food.createFoodBundle(start, { roomId: "bedroom", storageCell: 2 }),
  );
  const selection = { fixtureId: "hearth-1", bundleId: bundle(zero).id };
  const id = resident(zero);
  let floor = sim.order(zero, id, "work", "cook", selection);
  for (let i = 0; i < 20 && floor.actors[0].task?.spatial?.kind !== "use"; i++)
    floor = sim.advance(floor, 1);
  assert.equal(floor.actors[0].task.spatial.kind, "use");
  floor = sim.order(floor, id, "cancel");
  floor = sim.order(
    floor,
    id,
    "home-move",
    JSON.stringify({ roomId: "bedroom", cell: 0 }),
  );
  floor = sim.advance(floor, presentation.nextCompletionMinutes(floor));
  const floorPreview = sim.inspectOrder(floor, id, "work", "cook", selection);
  assert.equal(floorPreview.foodBundle.transportMinutes, 0);
  assert.ok(floorPreview.facility.moveMinutes > 0);
  const occupiedStart = create(2);
  const occupied = ok(
    food.createFoodBundle(occupiedStart, { roomId: "bedroom", storageCell: 2 }),
  );
  const second = occupied.actors[1].person.id;
  const busy = sim.order(occupied, second, "work", "cook", {
    fixtureId: "hearth-1",
  });
  const cases = {
    "zero-no-bundle": empty,
    "zero-stock": zero,
    "equipment-floor": floor,
    "equipment-occupied": busy,
  };
  const manifest = {};
  for (const [name, g] of Object.entries(cases)) {
    assert.ok(sim.isGame(g), name);
    const file = `controlled-${name}.json`;
    const raw = library.exportSlot({
      id: "food-" + name,
      name,
      game: g,
      origin: structuredClone(g),
    });
    await writeFile(resolve(output, file), raw);
    library.importSlot(raw);
    const choice = g.housing.foodLogistics
      ? { fixtureId: "hearth-1", bundleId: bundle(g).id }
      : undefined;
    manifest[name] = {
      file,
      ingredients: g.ingredients,
      preview: sim.inspectOrder(g, resident(g), "work", "cook", choice),
    };
  }
  await writeJson("food-logistics-manifest.json", manifest);
  return manifest;
}
async function capture(page, prefix, controls) {
  for (const width of [1280, 390, 320]) {
    await page.setViewportSize({ width, height: width === 1280 ? 900 : 844 });
    for (const control of controls) {
      await control.scrollIntoViewIfNeeded();
      const rect = await control.boundingBox();
      assert.ok(
        rect &&
          rect.x >= 0 &&
          rect.x + rect.width <= width + 1 &&
          rect.height >= 44,
        JSON.stringify(rect),
      );
    }
    assert.ok(
      await page.evaluate(
        () =>
          document.documentElement.scrollWidth <=
          document.documentElement.clientWidth + 1,
      ),
      `${prefix}: ${width}px overflow`,
    );
    const path = resolve(output, `${prefix}-${width}.png`);
    await page.screenshot({ path });
    result.screenshots.push({ width, path });
  }
  await page.setViewportSize({ width: 1280, height: 900 });
}
async function separate(page, g, roomId, storageCell) {
  await click(page, "住まい");
  await panel(page).getByLabel("保管する部屋").selectOption(roomId);
  await panel(page).getByLabel("保管する床").selectOption(String(storageCell));
  await compare(page, g);
  await click(page, "野菜の一束を取り分ける", panel(page));
  return compare(page, ok(food.createFoodBundle(g, { roomId, storageCell })));
}
async function assign(page, g, direction) {
  await panel(page).getByLabel("運搬担当").selectOption(resident(g));
  await compare(page, g);
  await click(
    page,
    direction === "store" ? "保管先へ運ぶ" : "供給口へ戻す",
    panel(page),
  );
  return compare(
    page,
    ok(food.assignFoodHaul(g, bundle(g).id, resident(g), direction)),
  );
}
async function normal(page) {
  await click(page, "川辺の一人旅");
  await click(page, "この朝を始める");
  let g = await game(page);
  const first = resident(g);
  const origin = (await activeSlot(page)).origin;
  const initial = g;
  g = await separate(page, g, "bedroom", 2);
  assert.equal(g.ingredients, initial.ingredients - 2);
  assert.equal(g.time, initial.time);
  await capture(page, "normal-storage", [
    panel(page).getByLabel("運搬担当"),
    button(panel(page), "保管先へ運ぶ"),
    button(panel(page), "備蓄に戻す"),
  ]);
  g = await assign(page, g, "store");
  await page.reload();
  await compare(page, g);
  g = await next(page, g);
  assert.deepEqual(item(g).position, {
    kind: "at",
    point: topology.housingPoint("bedroom", 2),
  });
  await work(page);
  const id = bundle(g).id;
  await material(page, id).check();
  await expect(cook(page)).toBeDisabled();
  await expect(
    recipe(page).getByText("料理に使う設備を指定してください。"),
  ).toBeVisible();
  await equipment(page).selectOption("hearth-1");
  await compare(page, g);
  await click(page, "住まい");
  await click(page, "暮らし");
  await work(page);
  await expect(material(page, id)).toBeChecked();
  await expect(equipment(page)).toHaveValue("hearth-1");
  await capture(page, "normal-cooking", [equipment(page), cook(page)]);
  await cook(page).click();
  g = await compare(
    page,
    sim.order(g, first, "work", "cook", {
      fixtureId: "hearth-1",
      bundleId: id,
    }),
  );
  assert.equal(g.ingredients, initial.ingredients - 2);
  await click(page, "5分進める");
  g = await compare(page, sim.advance(g, 5));
  await page.reload();
  await compare(page, g);
  await work(page);
  await expect(material(page, "")).toBeChecked();
  await material(page, id).check();
  await equipment(page).selectOption("hearth-1");
  g = await next(page, g);
  assert.equal(bundle(g).state, "consumed");
  assert.equal(Object.keys(g.housing.state.items).length, 0);
  await expect(cook(page)).toBeDisabled();
  await expect(
    recipe(page).getByText("選んだ食材の一束がありません。", { exact: true }),
  ).toBeVisible();
  await click(page, "生活", page.getByRole("region", { name: "行動の指示" }));
  await page.getByLabel("食事に使う設備").selectOption("hearth-1");
  await click(page, "食事をとる");
  g = await compare(page, sim.order(g, first, "home-use", "hearth-1"));
  g = await next(page, g);
  await click(page, "居間の入口へ移動");
  g = await compare(
    page,
    sim.order(
      g,
      first,
      "home-move",
      JSON.stringify({ roomId: "living", cell: 0 }),
    ),
  );
  g = await next(page, g);
  // A second bundle, carried across two passages: five minutes reaches the second passage.
  const beforeSecond = g;
  g = await separate(page, g, "yard", 10);
  g = await assign(page, g, "store");
  await click(page, "暮らし");
  await click(page, "5分進める");
  g = await compare(page, sim.advance(g, 5));
  assert.equal(item(g).position.kind, "carried");
  assert.equal(g.housing.state.actors[first].position.kind, "transit");
  await click(page, "住まい");
  await click(page, "担当を外す", panel(page));
  g = await compare(page, sim.order(g, first, "cancel"));
  assert.equal(g.ingredients, beforeSecond.ingredients - 2);
  assert.equal(
    g.housing.state.actors[first].order.phase,
    "exiting-after-cancel",
  );
  await expect(button(panel(page), "担当を外す")).toBeDisabled();
  await page.reload();
  g = await compare(page, g);
  g = await next(page, g);
  assert.equal(item(g).position.kind, "at");
  await click(page, "住まい");
  await expect(button(panel(page), "備蓄に戻す")).toBeDisabled();
  g = await assign(page, g, "return");
  await click(page, "暮らし");
  g = await next(page, g);
  assert.equal(bundle(g).state, "returned");
  assert.equal(g.ingredients, beforeSecond.ingredients);
  assert.equal(Object.keys(g.housing.state.items).length, 0);
  assert.deepEqual((await activeSlot(page)).origin, origin);
  await click(page, "住まい");
  await expect(panel(page).getByText(/前回の一束：返却済み/)).toBeVisible();
  result.normal.push(
    "通常開始・無時間選択と取り分け・保管・材料と設備指定・再読込・料理・古い選択拒否・食事・2束目の区間途中取消と再読込・実運搬による返却",
  );
}
async function controlled(page, name, manifest) {
  await click(page, "手帳");
  await page
    .getByLabel("新版の保存ファイル")
    .setInputFiles(resolve(output, manifest[name].file));
  await expect(page.getByRole("region", { name: "行動の指示" })).toBeVisible();
  await settled(page);
  const g = library.importSlot(
    await readFile(resolve(output, manifest[name].file), "utf8"),
  ).game;
  await compare(page, g);
  await click(page, "住まい");
  if (name === "zero-no-bundle") {
    await expect(button(panel(page), "野菜の一束を取り分ける")).toBeDisabled();
    await expect(
      panel(page).getByText("共同備蓄に食材2が必要です。"),
    ).toBeVisible();
  } else {
    await click(page, "暮らし");
    await work(page);
    await material(page, bundle(g).id).check();
    await equipment(page).selectOption("hearth-1");
    const expected = manifest[name].preview;
    if (expected.disabled) {
      await expect(cook(page)).toBeDisabled();
      await expect(
        recipe(page).getByText(expected.disabled, { exact: true }),
      ).toBeVisible();
    } else {
      await expect(cook(page)).toBeEnabled();
      if (name === "equipment-floor")
        await expect(recipe(page)).toContainText("運搬不要");
      else await expect(recipe(page)).toContainText("食材を拾い、運ぶ見込み");
      await cook(page).click();
      const booked = await compare(
        page,
        sim.order(g, resident(g), "work", "cook", {
          fixtureId: "hearth-1",
          bundleId: bundle(g).id,
        }),
      );
      assert.equal(booked.ingredients, g.ingredients);
      assert.deepEqual(booked.actors[0].task.reserved, {});
    }
  }
  result.controlled.push(name);
}

let browser;
async function fresh(html, run) {
  const context = await browser.newContext({
    offline: true,
    viewport: { width: 1280, height: 900 },
  });
  try {
    await context.route("**/*", async (route) => {
      if (route.request().url() === entry)
        await route.fulfill({
          contentType: "text/html; charset=utf-8",
          body: html,
        });
      else {
        result.errors.push("unexpected request: " + route.request().url());
        await route.abort();
      }
    });
    const page = await context.newPage();
    page.on("pageerror", (e) => result.errors.push(e.message));
    page.on("console", (m) => {
      if (m.type() === "error") result.errors.push(m.text());
    });
    await page.goto(entry);
    await run(page);
  } finally {
    await context.close();
  }
}
await mkdir(output, { recursive: true });
try {
  const manifest = await prepare();
  result.manifest = resolve(output, "food-logistics-manifest.json");
  if (prepareOnly) result.status = "inputs-prepared";
  else {
    const html = await readFile("dist/yohaku.html");
    result.sha256 = createHash("sha256").update(html).digest("hex");
    result.htmlBytes = html.length;
    result.status = "launching-browser";
    browser = await chromium.launch({
      headless: true,
      executablePath: process.env.CHROMIUM_PATH || "/usr/bin/chromium",
      args: ["--no-sandbox"],
    });
    result.status = "running-ui";
    await fresh(html, normal);
    for (const name of Object.keys(manifest))
      await fresh(html, (page) => controlled(page, name, manifest));
    assert.deepEqual(result.errors, []);
    result.status = "passed";
  }
} catch (error) {
  result.status =
    result.status === "launching-browser"
      ? "browser-infrastructure-failure-before-page-load"
      : result.status + "-failed";
  result.errors.push(String(error));
  throw error;
} finally {
  await writeJson("food-logistics-result.json", result);
  console.log(JSON.stringify(result, null, 2));
  await browser?.close();
}
