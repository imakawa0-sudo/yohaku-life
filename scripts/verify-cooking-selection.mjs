// Exercise the built standalone HTML through normal controls and controlled imports.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { chromium, expect } from "@playwright/test";
import { tsImport } from "tsx/esm/api";

const load = (module) =>
  tsImport(`../src/reform/${module}.ts`, import.meta.url);
const [house, labels, library, topology, people, sim, world, presentation] =
  await Promise.all([
    load("house"),
    load("facilityLabel"),
    load("library"),
    load("housing/topology"),
    load("peopleModel"),
    load("sim"),
    load("world"),
    load("housing/presentation"),
  ]);
const output = resolve(
  process.env.PLAYTEST_OUTPUT || "/tmp/yohaku-cooking-selection-playtest",
);
const prepareOnly =
  process.env.COOKING_SELECTION_PREPARE_ONLY === "1" ||
  process.argv.includes("--prepare-only");
const entry = "https://cooking-selection.offline.test/";
const recipes = ["cook", "cook:hard", "cook:master"];
const automatic = "自動（移動と利用が短い設備）";
const missing = "選んだ設備がありません";
const near = "hearth-1";
const far = "yard-cooker";
const report = {
  status: "preparing",
  normal: [],
  controlled: [],
  screenshots: [],
  errors: [],
};
const json = (value) => JSON.parse(JSON.stringify(value));
const writeJson = (name, value) =>
  writeFile(resolve(output, name), JSON.stringify(value, null, 2) + "\n");
const button = (scope, name) =>
  scope.getByRole("button", { name, exact: true });
const action = (page, recipe = "cook") =>
  page.locator(`button[data-kind="work"][data-target="${recipe}"]`);
const row = (page, recipe = "cook") => action(page, recipe).locator("..");
const choice = (page, recipe = "cook") =>
  row(page, recipe).getByRole("combobox");
const hint = (page, recipe = "cook") => row(page, recipe).locator("small");
const clock = (page, time) =>
  expect(page.getByLabel("現在時刻 " + time, { exact: true })).toBeVisible();

function fixtureInfo(game, id) {
  const { rooms } = game.house;
  const room = rooms.find((room) =>
    room.fixtures.some((fixture) => fixture.id === id),
  );
  const fixture = room?.fixtures.find((fixture) => fixture.id === id);
  assert.ok(room && fixture);
  return {
    fixtureId: id,
    roomId: room.id,
    kind: fixture.kind,
    cell: fixture.cell,
    label: labels.facilityLabel(rooms, room, fixture.kind, fixture.cell),
    station: topology.housingSlotId(room.id, id, 0),
  };
}
function preview(game, id, recipe, selected = "") {
  const result = sim.inspectOrder(
    game,
    id,
    "work",
    recipe,
    selected ? { fixtureId: selected } : undefined,
  );
  if (result.disabled) return { disabled: result.disabled };
  const { facility, minutes, reserved } = result;
  assert.ok(facility);
  return {
    ...fixtureInfo(game, facility.fixtureId),
    time: `移動${facility.moveMinutes}分 ＋ 利用${facility.useMinutes}分（合計${minutes}分）`,
    ingredients: reserved.ingredients,
    moveMinutes: facility.moveMinutes,
    useMinutes: facility.useMinutes,
    minutes,
  };
}
function makeGame(kind = "hearth", sameName = false, skill = 5) {
  const residents = ["検証のカヤ", "検証のスイ"].map((name, i) => ({
    ...people.makePersona(i, 23 + i),
    name,
  }));
  const layout = house.initialHouse();
  layout.rooms[2].fixtures.push({ id: far, kind, cell: 6 });
  if (sameName) {
    const name = "東の窓辺から朝の光が差し込む静かな料理部屋";
    layout.rooms[0].name = name;
    layout.rooms[2].name = name;
  }
  const game = sim.createGame(
    residents,
    world.generateWorld(world.defaultWorldConfig()),
    "village",
    layout,
  );
  game.actors[0].person.skills.cook = skill;
  game.ingredients = 9;
  return sim.enableHousing(game, "new");
}
async function prepareCases() {
  const origin = makeGame();
  const kitchen = makeGame("kitchen");
  const layout = makeGame("kitchen", true);
  const locked = makeGame("hearth", false, 1);
  const [first, second] = origin.actors.map(({ person }) => person.id);
  const cases = {};
  for (const [key, game, start, reason] of [
    ["two-stoves", origin, origin, undefined],
    ["missing", origin, origin, missing],
    [
      "permission",
      sim.setHousingRoomAccess(origin, "yard", [second]),
      origin,
      /許可/,
    ],
    [
      "closed",
      sim.setHousingPassage(
        origin,
        "link",
        topology.housingLinkId("bedroom", "yard"),
        false,
      ),
      origin,
      /通路/,
    ],
    ["occupied", sim.order(origin, second, "home-use", far), origin, /予約/],
    [
      "kitchen-seat0",
      sim.order(kitchen, second, "home-use", far),
      kitchen,
      /予約/,
    ],
    ["layout", layout, layout, undefined],
    ["locked", locked, locked, undefined],
  ]) {
    const expected = Object.fromEntries(
      recipes.map((recipe) => [
        recipe,
        {
          auto: preview(game, first, recipe),
          explicit: preview(game, first, recipe, far),
        },
      ]),
    );
    if (reason instanceof RegExp)
      assert.match(expected.cook.explicit.disabled, reason);
    assert.equal(expected.cook.auto.fixtureId, key === "layout" ? far : near);
    const file = `cooking-selection-input-${key}.json`;
    const raw = library.exportSlot({
      id: key,
      name: `検証・調理先 ${key}`,
      game,
      origin: start,
    });
    const imported = library.importSlot(raw);
    assert.deepEqual(imported.game, json(game));
    assert.deepEqual(imported.origin, json(start));
    await writeFile(resolve(output, file), raw);
    cases[key] = {
      file,
      expected,
      near: fixtureInfo(game, near),
      far: fixtureInfo(game, far),
    };
  }
  const manifest = {
    residents: origin.actors.map(({ person: { id, name } }) => ({ id, name })),
    recipes,
    automatic,
    missing,
    cases,
  };
  await writeJson("cooking-selection-manifest.json", manifest);
  return manifest;
}

async function inContext(browser, html, run) {
  const context = await browser.newContext({
    offline: true,
    viewport: { width: 1280, height: 900 },
    acceptDownloads: true,
  });
  await context.route("**/*", async (route) => {
    if (route.request().url() === entry)
      await route.fulfill({
        contentType: "text/html; charset=utf-8",
        body: html,
      });
    else {
      report.errors.push("意図しない通信: " + route.request().url());
      await route.abort();
    }
  });
  try {
    const page = await context.newPage();
    page.on("pageerror", (error) => report.errors.push(error.message));
    page.on("console", (message) => {
      if (message.type() === "error") report.errors.push(message.text());
    });
    await page.goto(entry);
    await run(page);
  } finally {
    await context.close();
  }
}
async function settled(page) {
  await expect(page.locator(".rf-app")).toHaveAttribute("aria-busy", "false");
}
async function click(page, name) {
  await button(page, name).click();
  await settled(page);
}
async function work(page) {
  const tab = page
    .getByRole("region", { name: "行動の指示" })
    .getByRole("button", { name: "仕事", exact: true });
  await tab.click();
  await expect(action(page)).toBeVisible();
}
async function checkpoint(page, name) {
  await click(page, "手帳");
  const download = page.waitForEvent("download");
  await button(page, "保存を書き出す").click();
  const raw = await readFile(await (await download).path(), "utf8");
  assert.equal(JSON.parse(raw).version, 2);
  const slot = library.importSlot(raw);
  slot.id = JSON.parse(raw).slot.id;
  await writeFile(resolve(output, `${name}.json`), raw);
  await click(page, "暮らし");
  return slot;
}
function assertSlot(slot, game, origin) {
  assert.deepEqual(slot.game, json(game));
  assert.deepEqual(slot.origin, json(origin));
}
async function loadSave(page, name) {
  if (await button(page, "手帳").count()) await click(page, "手帳");
  else {
    // A fresh standalone starts at setup; create a disposable local slot so the handbook is reachable.
    await click(page, "木工の二人");
    await click(page, "この朝を始める");
    await click(page, "手帳");
  }
  await page
    .getByLabel("新版の保存ファイル")
    .setInputFiles(resolve(output, name));
  await expect(page.getByRole("region", { name: "行動の指示" })).toBeVisible();
  await settled(page);
}
async function assertPreview(page, recipe, expected) {
  if (expected.disabled) {
    await expect(action(page, recipe)).toBeDisabled();
    await expect(hint(page, recipe)).toHaveText(expected.disabled);
  } else {
    await expect(action(page, recipe)).toBeEnabled();
    await expect(hint(page, recipe)).toContainText(expected.label);
    await expect(hint(page, recipe)).toContainText(expected.time);
    await expect(hint(page, recipe)).toContainText(
      "取り置き 食材" + expected.ingredients,
    );
  }
}
async function assertChoices(page, values) {
  await work(page);
  for (let i = 0; i < recipes.length; i++)
    await expect(choice(page, recipes[i])).toHaveValue(values[i]);
}
async function setChoices(page, values) {
  await work(page);
  for (let i = 0; i < recipes.length; i++)
    await choice(page, recipes[i]).selectOption(values[i]);
  await assertChoices(page, values);
}

async function captureLayouts(page, info) {
  for (const width of [1280, 390, 320]) {
    const height = width === 1280 ? 900 : 844;
    await page.setViewportSize({ width, height });
    await setChoices(page, [far, near, ""]);
    for (const recipe of recipes) {
      const loc = choice(page, recipe);
      await expect(loc.locator(`option[value="${near}"]`)).toHaveText(
        info.near.label,
      );
      await expect(loc.locator(`option[value="${far}"]`)).toHaveText(
        info.far.label,
      );
      for (const element of [loc, action(page, recipe)]) {
        const box = await element.boundingBox();
        assert.ok(
          box &&
            box.x >= 0 &&
            box.x + box.width <= width + 1 &&
            box.height >= 44,
          `${width}px: ${JSON.stringify(box)}`,
        );
      }
    }
    const { client, scroll } = await page.evaluate(() => ({
      client: document.documentElement.clientWidth,
      scroll: document.documentElement.scrollWidth,
    }));
    assert.ok(
      scroll <= client + 1,
      `${width}px document width: ${scroll}/${client}`,
    );
    await choice(page).scrollIntoViewIfNeeded();
    const path = resolve(output, `layout-${width}.png`);
    await page.screenshot({ path });
    report.screenshots.push({ width, height, path });
  }
  await page.setViewportSize({ width: 1280, height: 900 });
}

async function normal(page) {
  await click(page, "木工の二人");
  await click(page, "この朝を始める");
  await work(page);
  if (!(await choice(page).count())) {
    await click(page, "手帳");
    await click(page, "住居の移動を使う暮らしに分岐");
  }
  await clock(page, "08:00");
  const start = await checkpoint(page, "normal-start");
  assert.ok(start.game.housing);
  const [first, second] = start.game.actors.map(({ person }) => person);
  await click(page, "住まい");
  const editor = page.getByRole("region", { name: "住まいの間取り" });
  await button(editor, "寝室").click();
  await editor
    .getByLabel("新しく置く設備", { exact: true })
    .selectOption("hearth");
  await button(editor, "この部屋に置く").click();
  await settled(page);
  const furnished = await checkpoint(page, "normal-two-stoves");
  const fixture = furnished.game.house.rooms
    .find(({ id }) => id === "bedroom")
    .fixtures.find(({ kind }) => kind === "hearth");
  assert.ok(fixture);
  const id = fixture.id;
  assert.equal(furnished.game.time, start.game.time);
  assert.equal(
    furnished.game.wood,
    start.game.wood - house.furnishings.hearth.cost,
  );
  assert.deepEqual(furnished.origin, start.origin);

  await assertChoices(page, ["", "", ""]);
  await assertPreview(page, "cook", preview(furnished.game, first.id, "cook"));
  await setChoices(page, [id, near, id]);
  for (const [recipe, selected] of recipes.map((recipe, i) => [
    recipe,
    [id, near, id][i],
  ]))
    await assertPreview(
      page,
      recipe,
      preview(furnished.game, first.id, recipe, selected),
    );
  // Leaving work tab, and leaving the Life view, must not write to the game.
  await click(page, "生活");
  await page
    .getByRole("combobox", { name: "食事に使う設備" })
    .selectOption(near);
  await assertChoices(page, [id, near, id]);
  const selectedOnly = await checkpoint(page, "normal-selection-only");
  assertSlot(selectedOnly, furnished.game, furnished.origin);
  await assertChoices(page, [id, near, id]);
  await click(page, second.name);
  await assertChoices(page, ["", "", ""]);
  await click(page, first.name);
  await assertChoices(page, ["", "", ""]);
  await setChoices(page, [id, near, id]);
  await click(page, "手帳");
  await click(page, "今の時点から分岐");
  await assertChoices(page, ["", "", ""]);
  const branch = await checkpoint(page, "normal-branch");
  assert.notEqual(branch.id, furnished.id);
  assertSlot(branch, furnished.game, furnished.origin);
  await click(page, "手帳");
  await page
    .locator(".rf-slots button")
    .filter({ has: page.getByText(furnished.name, { exact: true }) })
    .click();
  await settled(page);
  await assertChoices(page, ["", "", ""]);
  assertSlot(
    await checkpoint(page, "normal-original-slot"),
    furnished.game,
    furnished.origin,
  );

  // Direct cooking and a second resident's independent meal, both still at 08:00.
  await setChoices(page, [id, near, ""]);
  const expected = preview(furnished.game, first.id, "cook", id);
  assert.ok(expected.moveMinutes > 0);
  await assertPreview(page, "cook", expected);
  await action(page).click();
  await settled(page);
  const booked = await checkpoint(page, "normal-cooking-booked");
  assertSlot(
    booked,
    sim.order(furnished.game, first.id, "work", "cook", { fixtureId: id }),
    furnished.origin,
  );
  assert.equal(booked.game.actors[0].task.station, expected.station);
  assert.equal(booked.game.ingredients, furnished.game.ingredients - 2);
  assert.equal(booked.game.time, furnished.game.time);
  await assertChoices(page, [id, near, ""]);
  await page.reload(); // Choice resets while the already-started movement survives.
  await assertChoices(page, ["", "", ""]);
  assertSlot(
    await checkpoint(page, "normal-movement-reloaded"),
    booked.game,
    furnished.origin,
  );
  await click(page, second.name);
  await page
    .getByRole("combobox", { name: "食事に使う設備" })
    .selectOption(near);
  await click(page, "食事をとる");
  const both = await checkpoint(page, "normal-both-booked");
  assertSlot(
    both,
    sim.order(booked.game, second.id, "home-use", near),
    furnished.origin,
  );
  assert.deepEqual(both.game.actors[0].task, booked.game.actors[0].task);
  assert.equal(
    both.game.actors[1].task.station,
    fixtureInfo(both.game, near).station,
  );
  await clock(page, "08:00");

  await click(page, first.name);
  await setChoices(page, [id, near, id]);
  let progressed = both;
  for (
    let i = 0;
    i < 6 &&
    presentation.housingStatus(progressed.game, first.id).phase !== "use";
    i++
  ) {
    await click(page, "5分進める");
    await assertChoices(page, [id, near, id]);
    const next = await checkpoint(page, `normal-progress-${i}`);
    assertSlot(next, sim.advance(progressed.game, 5), furnished.origin);
    progressed = next;
  }
  assert.equal(
    presentation.housingStatus(progressed.game, first.id).phase,
    "use",
  );
  assert.equal(progressed.game.actors[0].task.station, expected.station);
  await page.reload();
  await assertChoices(page, ["", "", ""]);
  assertSlot(
    await checkpoint(page, "normal-use-reloaded"),
    progressed.game,
    furnished.origin,
  );
  await loadSave(page, "normal-use-reloaded.json");
  await assertChoices(page, ["", "", ""]);
  let done = await checkpoint(page, "normal-use-imported");
  assertSlot(done, progressed.game, furnished.origin);
  const completionTime = booked.game.time + expected.minutes;
  for (let i = 0; i < 10 && done.game.actors[0].task?.target === "cook"; i++) {
    const minutes = presentation.nextCompletionMinutes(done.game);
    assert.ok(minutes > 0 && done.game.time + minutes <= completionTime);
    await click(page, "次の行動完了まで進める");
    const next = await checkpoint(page, `normal-completion-${i}`);
    assertSlot(next, sim.advance(done.game, minutes), furnished.origin);
    done = next;
  }
  assert.equal(done.game.time, completionTime);
  assert.equal(done.game.actors[0].task, null);
  assert.ok(
    !Object.values(done.game.housing.state.reservations).some(
      (r) => r.targetId === expected.station,
    ),
  );
  report.normal.push(
    "通常開始、寝室にかまどを追加、選択だけの書き出し不変、レシピ・生活の独立指定、住民と保存枠の切替、08:00の二人の独立予約、移動・利用中の再読込とファイル読込、予告の完了時刻で調理の予約解除。",
  );
}

async function controlledStart(page, key, manifest) {
  const fixture = manifest.cases[key];
  const imported = library.importSlot(
    await readFile(resolve(output, fixture.file), "utf8"),
  );
  await loadSave(page, fixture.file);
  const start = await checkpoint(page, `controlled-${key}-start`);
  assertSlot(start, imported.game, imported.origin);
  await assertChoices(page, ["", "", ""]);
  return start;
}

async function unavailable(page, key, manifest) {
  const start = await controlledStart(page, key, manifest);
  const expected = manifest.cases[key].expected.cook;
  await assertPreview(page, "cook", expected.auto);
  await choice(page).selectOption(far);
  await assertPreview(page, "cook", expected.explicit);
  await expect(choice(page)).toHaveValue(far);
  const selected = await checkpoint(page, `controlled-${key}-selected`);
  assertSlot(selected, start.game, start.origin);
  await assertChoices(page, [far, "", ""]);
  await choice(page).selectOption("");
  await assertPreview(page, "cook", expected.auto);
  report.controlled.push(
    `${key}: 明示先を他の設備に読み替えず無効理由を表示、選択だけでGame・originは不変。`,
  );
}

async function missingCase(page, manifest) {
  const start = await controlledStart(page, "missing", manifest);
  const [first] = manifest.residents;
  await setChoices(page, [far, near, far]);
  await click(page, "住まい");
  const editor = page.getByRole("region", { name: "住まいの間取り" });
  await button(editor, "裏庭").click();
  await button(editor, "小さなかまど").click();
  await editor.getByLabel("移設先の部屋").selectOption("bedroom");
  await button(editor, "この部屋へ移す").click();
  await settled(page);
  const moved = await checkpoint(page, "controlled-missing-moved");
  assert.deepEqual(moved.origin, start.origin);
  assert.equal(moved.game.time, start.game.time);
  assert.equal(fixtureInfo(moved.game, far).roomId, "bedroom");
  await assertChoices(page, [far, near, far]);
  await assertPreview(page, "cook", preview(moved.game, first.id, "cook", far));
  await click(page, "住まい");
  await button(editor, "寝室").click();
  await button(editor, "小さなかまど").click();
  await editor.getByText("室内のマスを編集", { exact: true }).click();
  await button(editor, "小さなかまどを取り外す").click();
  await settled(page);
  const removed = await checkpoint(page, "controlled-missing-removed");
  assert.equal(removed.game.time, start.game.time);
  assert.deepEqual(removed.origin, start.origin);
  assert.ok(
    !removed.game.house.rooms.some((room) =>
      room.fixtures.some((fixture) => fixture.id === far),
    ),
  );
  await assertChoices(page, [far, near, far]);
  for (const recipe of ["cook", "cook:master"]) {
    await expect(choice(page, recipe).locator("option:checked")).toHaveText(
      missing,
    );
    await assertPreview(page, recipe, { disabled: missing });
  }
  await assertPreview(
    page,
    "cook:hard",
    preview(removed.game, first.id, "cook:hard", near),
  );
  await choice(page).selectOption("");
  await assertPreview(page, "cook", preview(removed.game, first.id, "cook"));
  assertSlot(
    await checkpoint(page, "controlled-missing-selected"),
    removed.game,
    start.origin,
  );
  report.controlled.push(
    "家具の移設後も選択IDを維持し予告を更新、撤去時の明示先は残し実行だけを拒否、自動に戻すと別の設備を利用可能。",
  );
}

async function journeyCase(page, manifest) {
  let state = await controlledStart(page, "two-stoves", manifest);
  const [first] = manifest.residents;
  const values = [far, near, far];
  await setChoices(page, values);
  async function booked(kind, target, actionName) {
    if (kind === "home-move") await click(page, actionName);
    else {
      await click(page, "地域");
      const place = state.game.world.sites.find(
        (site) => site.id === target,
      ).name;
      await click(page, place);
      await page
        .getByRole("button", { name: new RegExp(place + "へ移動する") })
        .click();
      await settled(page);
    }
    const ordered = await checkpoint(
      page,
      `controlled-journey-${kind}-${state.game.time}-booked`,
    );
    assertSlot(
      ordered,
      sim.order(state.game, first.id, kind, target),
      state.origin,
    );
    state = ordered;
    for (let i = 0; i < 10 && state.game.actors[0].task?.kind === kind; i++) {
      const minutes = presentation.nextCompletionMinutes(state.game);
      assert.ok(minutes > 0);
      await click(page, "次の行動完了まで進める");
      const advanced = await checkpoint(
        page,
        `controlled-journey-${kind}-${state.game.time}-advance`,
      );
      assertSlot(advanced, sim.advance(state.game, minutes), state.origin);
      state = advanced;
    }
    assert.notEqual(state.game.actors[0].task?.kind, kind);
  }
  await booked(
    "home-move",
    JSON.stringify({ roomId: "bedroom", cell: 0 }),
    "寝室の入口へ移動",
  );
  await assertChoices(page, values);
  await assertPreview(page, "cook", preview(state.game, first.id, "cook", far));
  await booked("travel", "landing");
  assert.equal(state.game.actors[0].location, "landing");
  await work(page);
  for (const recipe of recipes)
    await expect(choice(page, recipe)).toHaveCount(0);
  await booked("travel", state.game.home);
  assert.equal(state.game.actors[0].location, state.game.home);
  await assertChoices(page, values);
  await assertPreview(page, "cook", preview(state.game, first.id, "cook", far));
  report.controlled.push(
    "室内移動、外出、帰宅と画面切替を通じ選択を保持。外出中は従来の料理ボタンだけを表示。",
  );
}

async function layoutCase(page, manifest) {
  const start = await controlledStart(page, "layout", manifest);
  const info = manifest.cases.layout;
  await captureLayouts(page, info);
  await assertPreview(page, "cook", info.expected.cook.explicit);
  assertSlot(
    await checkpoint(page, "controlled-layout-selected"),
    start.game,
    start.origin,
  );
  report.controlled.push(
    "同名部屋、長いラベル、1280/390/320pxの選択・ボタン寸法、横スクロール、スクリーンショット確認用画像を保存。",
  );
}

async function lockedCase(page, manifest) {
  const start = await controlledStart(page, "locked", manifest);
  const { auto, explicit } = manifest.cases.locked.expected["cook:master"];
  assert.match(auto.disabled, /技能5/);
  await assertPreview(page, "cook:master", auto);
  await choice(page, "cook:master").selectOption(far);
  await assertPreview(page, "cook:master", explicit);
  assertSlot(
    await checkpoint(page, "controlled-locked-selected"),
    start.game,
    start.origin,
  );
  report.controlled.push("上級料理の技能条件は明示先を変えても維持。");
}

let browser;
await mkdir(output, { recursive: true });
try {
  const manifest = await prepareCases();
  report.manifest = resolve(output, "cooking-selection-manifest.json");
  if (prepareOnly) report.status = "inputs-prepared";
  else {
    report.status = "reading-html";
    const html = await readFile(process.env.REFORM_HTML || "dist/yohaku.html");
    report.sha256 = createHash("sha256").update(html).digest("hex");
    report.htmlBytes = html.length;
    report.status = "launching-browser";
    browser = await chromium.launch({
      headless: true,
      executablePath: process.env.CHROMIUM_PATH || "/usr/bin/chromium",
      args: ["--no-sandbox"],
    });
    report.status = "running-ui";
    await inContext(browser, html, normal);
    for (const key of ["permission", "closed", "occupied", "kitchen-seat0"])
      await inContext(browser, html, (page) =>
        unavailable(page, key, manifest),
      );
    for (const run of [missingCase, journeyCase, layoutCase, lockedCase])
      await inContext(browser, html, (page) => run(page, manifest));
    assert.deepEqual(report.errors, []);
    report.status = "passed";
  }
  console.log(JSON.stringify(report, null, 2));
} catch (error) {
  if (report.status === "launching-browser") {
    report.status = "browser-infrastructure-failure-before-page-load";
    console.error(
      "Chromium launcher failed before page load. No UI checks ran.",
    );
  } else report.status += "-failed";
  report.errors.push(String(error));
  throw error;
} finally {
  await writeJson("cooking-selection-result.json", report);
  await browser?.close();
}
