// Exercise the shipped file in fresh offline contexts. Only the controlled
// cases seed a slot, and they start in contexts separate from ordinary play.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { chromium, expect } from "@playwright/test";
import { tsImport } from "tsx/esm/api";

const [sim, construction, library, people, world, topology] = await Promise.all(
  [
    "sim",
    "housing/construction",
    "library",
    "peopleModel",
    "world",
    "housing/topology",
  ].map((module) =>
    tsImport("../src/reform/" + module + ".ts", import.meta.url),
  ),
);
const html = await readFile(process.env.REFORM_HTML || "dist/yohaku.html");
const output = resolve(
  process.env.PLAYTEST_OUTPUT || "/tmp/yohaku-construction-playtest",
);
await mkdir(output, { recursive: true });

const report = {
  sha256: createHash("sha256").update(html).digest("hex"),
  launched: false,
  normal: [],
  controlled: [],
  screenshots: [],
  exports: [],
  pageErrors: [],
  unexpectedRequests: [],
  failure: null,
};

const { LIBRARY_KEY, importSlot } = library;
const { housingPoint } = topology;
const url = "https://construction.offline.test/";
const nextName = "次の行動完了まで進める";
const cancelName = "現在の予定を取り消す";
const button = (scope, name) =>
  scope.getByRole("button", { name, exact: true });
const select = (scope, name) =>
  scope.getByRole("combobox", { name, exact: true });
const panel = (page) => page.getByRole("region", { name: "一室を増築する" });
const card = (page, name) =>
  panel(page).getByRole("article", { name, exact: true });
const readBook = async (page) =>
  JSON.parse(
    await page.evaluate((key) => localStorage.getItem(key), LIBRARY_KEY),
  );
const readSlot = async (page) => {
  const book = await readBook(page);
  assert.equal(book.format, 2);
  const slot = book.slots.find((entry) => entry.id === book.activeId);
  assert.ok(sim.isGame(slot.game));
  assert.ok(sim.isGame(slot.origin));
  return slot;
};
const readGame = async (page) => (await readSlot(page)).game;
const plan = (game) => game.housing.construction.plans["construction-1"];
const bundle = (game) => game.housing.state.items[plan(game).material.itemId];
const floor = (roomId, cell) => ({
  kind: "at",
  point: housingPoint(roomId, cell),
});

let browser;
async function inFreshContext(journey) {
  const context = await browser.newContext({
    offline: true,
    viewport: { width: 1280, height: 900 },
    acceptDownloads: true,
  });
  try {
    await context.route("**/*", async (route) => {
      if (route.request().url() === url) {
        await route.fulfill({
          contentType: "text/html; charset=utf-8",
          body: html,
        });
      } else {
        report.unexpectedRequests.push(route.request().url());
        await route.abort();
      }
    });
    context.on("page", (page) => {
      page.on("pageerror", (error) => report.pageErrors.push(error.message));
      page.on("console", (message) => {
        if (message.type() === "error") report.pageErrors.push(message.text());
      });
    });
    const page = await context.newPage();
    await page.goto(url);
    await journey(page);
  } finally {
    await context.close();
  }
}
async function click(page, name, scope = page) {
  await button(scope, name).click();
  await expect(page.locator(".rf-app")).toHaveAttribute("aria-busy", "false");
}
async function screenshot(page, file, control) {
  await control.focus();
  await expect(control).toBeFocused();
  const bounds = await control.evaluate((el) => {
    el.scrollIntoView({ block: "center" });
    const rect = el.getBoundingClientRect();
    const clock = document.querySelector(".lf-clock");
    return {
      width: innerWidth,
      content: document.documentElement.scrollWidth,
      left: rect.left,
      right: rect.right,
      top: rect.top,
      bottom: rect.bottom,
      usableHeight: clock?.getBoundingClientRect().top ?? innerHeight,
    };
  });
  assert.ok(
    bounds.content <= bounds.width + 1 &&
      bounds.left >= 0 &&
      bounds.right <= bounds.width + 1 &&
      bounds.top >= 0 &&
      bounds.bottom <= bounds.usableHeight,
    file + " " + JSON.stringify(bounds),
  );
  await page.screenshot({
    path: resolve(output, file),
    animations: "disabled",
  });
  report.screenshots.push({ file, ...bounds });
}
async function useClock(page, name) {
  const fromHouse = await panel(page).isVisible();
  if (fromHouse) await click(page, "暮らし");
  await click(page, name);
  if (fromHouse) await click(page, "住まい");
}
async function next(page) {
  const before = await readGame(page);
  const minutes = sim.nextCompletionMinutes(before);
  assert.ok(minutes > 0);
  await useClock(page, nextName);
  const after = await readGame(page);
  assert.equal(after.time, before.time + minutes);
  return after;
}
async function runUntil(page, done) {
  for (let attempt = 0; attempt < 8; attempt++) {
    const game = await readGame(page);
    if (done(game)) return game;
    await next(page);
  }
  assert.fail("the action did not reach its recorded endpoint");
}
async function reload(page, expected) {
  await page.reload();
  await expect(button(page, "暮らし")).toBeVisible();
  assert.deepEqual(await readSlot(page), expected);
}
async function saveExport(page, label) {
  const before = await readSlot(page);
  await click(page, "手帳");
  const waiting = page.waitForEvent("download");
  await click(page, "保存を書き出す");
  const download = await waiting;
  const file = label + ".json";
  await download.saveAs(resolve(output, file));
  const json = await readFile(resolve(output, file), "utf8");
  const envelope = JSON.parse(json);
  assert.equal(envelope.type, "yohaku-reform-save");
  assert.ok([1, 2].includes(envelope.version));
  assert.deepEqual(envelope.slot, before);
  const imported = importSlot(json);
  assert.notEqual(imported.id, before.id);
  assert.deepEqual(imported, { ...before, id: imported.id });
  assert.deepEqual(await readSlot(page), before);
  report.exports.push(file);
  return before;
}
async function startWoodworkers(page) {
  assert.equal(await readBook(page), null);
  await click(page, "木工の二人");
  await click(page, "この朝を始める");
  const slot = await readSlot(page);
  assert.deepEqual(slot.game, slot.origin);
  assert.deepEqual(
    slot.game.actors.map((a) => a.person.name),
    ["カヤ", "スイ"],
  );
  assert.equal(slot.game.housing.construction, undefined);
  return slot;
}
async function enterPlanning(page, room) {
  const section = panel(page);
  await section.getByRole("textbox", { name: "増築する部屋の名前" }).fill(room);
  const destination = select(section, "接続先");
  const site = select(section, "仮置き床");
  await destination.selectOption("living");
  await expect(site.locator('option[value="0"]')).toHaveCount(0);
  await expect(site.locator('option[value="3"]')).toHaveCount(0);
  return { section, destination, site };
}
async function prepareDelivery(page, room, neighborId, initial) {
  await click(page, "住まい");
  const editor = page.getByRole("region", { name: "住まいの間取り" });
  await expect(button(editor, "部屋を増やす（木材6）")).toHaveCount(0);
  const { section, destination, site } = await enterPlanning(page, room);
  await destination.selectOption(neighborId);
  await site.selectOption("2");
  await click(page, "計画する", section);
  const planned = await readGame(page);
  assert.equal(planned.time, initial.time);
  assert.equal(planned.wood, initial.wood);
  assert.deepEqual(planned.house, initial.house);
  assert.equal(plan(planned).name, room);
  await expect(card(page, room)).toContainText("未調達");
  await expect(button(editor, room)).toHaveCount(0);

  await click(page, "木材6を取り置く", card(page, room));
  const reserved = await readGame(page);
  assert.equal(reserved.time, initial.time);
  assert.equal(reserved.wood, initial.wood - 6);
  assert.deepEqual(bundle(reserved).position, floor("living", 0));
  const carrier = reserved.actors[0].person.id;
  await select(card(page, room), "搬入担当").selectOption(carrier);
  await click(page, "仮置き場へ運ぶ", card(page, room));
  const ordered = await readGame(page);
  assert.equal(ordered.time, initial.time);
  assert.deepEqual(bundle(ordered).position, floor("living", 0));
  assert.equal(plan(ordered).assignment.actorId, carrier);
  assert.deepEqual(ordered.actors[0].task.reserved, {});
  return ordered;
}
async function ordinaryBuild(page) {
  const room = "工房の小部屋";
  const origin = await startWoodworkers(page);
  const delivery = await prepareDelivery(page, room, "bedroom", origin.game);
  assert.equal(sim.nextCompletionMinutes(delivery), 6);
  const staged = await next(page);
  assert.deepEqual(bundle(staged).position, floor("bedroom", 2));
  assert.equal(plan(staged).assignment, undefined);
  assert.equal(staged.wood, origin.game.wood - 6);

  const builder = staged.actors[1].person.id;
  assert.ok(staged.actors[1].task);
  await expect(
    select(card(page, room), "施工担当")
      .locator("option")
      .filter({ hasText: "スイ" }),
  ).toContainText("進行中の予定");
  await click(page, "暮らし");
  await click(page, "スイ");
  await click(page, cancelName);
  assert.equal((await readGame(page)).actors[1].task, null);
  await click(page, "住まい");
  await select(card(page, room), "施工担当").selectOption(builder);
  for (const width of [1280, 390, 320]) {
    await page.setViewportSize({ width, height: width < 600 ? 844 : 900 });
    await screenshot(
      page,
      "construction-assignment-" + width + ".png",
      button(card(page, room), "施工する"),
    );
  }
  await page.setViewportSize({ width: 1280, height: 900 });
  await click(page, "施工する", card(page, room));
  const assigned = await readGame(page);
  assert.equal(assigned.time, staged.time);
  assert.equal(plan(assigned).assignment.actorId, builder);
  assert.equal(plan(assigned).workedMinutes, 0);
  await useClock(page, "15分進める");
  const working = await readGame(page);
  assert.equal(working.time, assigned.time + 15);
  assert.ok(
    plan(working).workedMinutes > 0 && plan(working).workedMinutes < 15,
  );
  await expect(card(page, room)).toContainText("施工中");
  const partialSave = await saveExport(page, "construction-partial");
  await reload(page, partialSave);
  const built = await runUntil(page, (g) => plan(g).status === "completed");
  const id = plan(built).roomId;
  const completedRoom = built.house.rooms.find((r) => r.id === id);
  assert.equal(completedRoom.name, room);
  assert.deepEqual([completedRoom.width, completedRoom.height], [4, 3]);
  assert.ok(
    built.house.links.some(
      (link) => link.includes(id) && link.includes("bedroom"),
    ),
  );
  assert.equal(plan(built).workedMinutes, 30);
  assert.equal(plan(built).material.state, "consumed");
  assert.equal(bundle(built), undefined);
  assert.equal(built.wood, origin.game.wood - 6);

  await click(page, "住まい");
  await expect(
    panel(page).getByText(room + "・完成", { exact: true }),
  ).toBeVisible();
  const editor = page.getByRole("region", { name: "住まいの間取り" });
  await click(page, room, editor);
  await select(editor, "新しく置く設備").selectOption("bath");
  await click(page, "この部屋に置く", editor);
  const furnished = await readGame(page);
  assert.equal(furnished.time, built.time);
  assert.equal(
    furnished.house.rooms.find((r) => r.id === id).fixtures[0].kind,
    "bath",
  );

  await click(page, "暮らし");
  await click(page, "スイ");
  await click(page, room + "の入口へ移動");
  const arrived = await runUntil(
    page,
    (g) =>
      JSON.stringify(g.housing.state.actors[builder].position) ===
      JSON.stringify(floor(id, 0)),
  );
  assert.equal(arrived.actors[1].room, id);
  await click(
    page,
    "体を洗う",
    page.getByRole("region", { name: "行動の指示" }),
  );
  const using = await readGame(page);
  const orderId = using.actors[1].task.spatial.orderId;
  assert.equal(using.actors[1].task.room, id);
  assert.equal(using.actors[1].task.spatial.kind, "use");
  const used = await runUntil(
    page,
    (g) => g.actors[1].task?.spatial?.orderId !== orderId,
  );
  assert.ok(used.actors[1].needs.hygiene > using.actors[1].needs.hygiene);
  const saved = await saveExport(page, "construction-completed");
  assert.deepEqual(saved.origin, origin.origin);
  await reload(page, saved);
  await verifySlotIsolation(page, saved, room);
  report.normal.push(
    "木工の二人の新規作成、計画・取り置き、カヤの実搬入、スイの実施工、4×3の完成室への移動と浴槽の使用、施工途中と完成後の書出し・再読込",
  );
}
async function planLargeWorkshop(page, width, capturePlan) {
  await page.setViewportSize({ width, height: width === 320 ? 844 : 900 });
  const room = "広い木工室";
  const origin = (await startWoodworkers(page)).game;
  await click(page, "住まい");
  const editor = page.getByRole("region", { name: "住まいの間取り" });
  // Invest nine wood in existing furnishings so the first large-room reservation is short by one.
  await click(page, "裏庭", editor);
  for (const kind of ["bath", "mat"]) {
    await select(editor, "新しく置く設備").selectOption(kind);
    await click(page, "この部屋に置く", editor);
  }
  const before = await readGame(page);
  assert.equal(before.wood, 9);
  const { section, destination, site } = await enterPlanning(page, room);
  const size = select(section, "増築する部屋の広さ");
  await expect(size).toHaveValue("3");
  await expect(section).toContainText("4 × 3マス（12マス）・木材6・施工30分");
  await size.selectOption("4");
  const quote = "4 × 4マス（16マス）・木材10・施工30分";
  await expect(section).toContainText(quote);
  await destination.selectOption("bedroom");
  await site.selectOption("2");
  if (capturePlan) {
    await screenshot(
      page,
      "large-plan-" + width + ".png",
      button(section, "計画する"),
    );
  }
  assert.deepEqual(await readGame(page), before);
  await click(page, "計画する", section);
  const project = card(page, room);
  const planned = await readGame(page);
  assert.equal(planned.time, origin.time);
  assert.equal(planned.wood, before.wood);
  assert.deepEqual(planned.house, before.house);
  assert.equal(plan(planned).height, 4);
  assert.equal(plan(planned).requiredWood, 10);
  const reserve = button(project, "木材10を取り置く");
  await expect(reserve).toBeDisabled();
  await expect(project).toContainText("共同備蓄に木材10が必要です。");
  await expect(project).toContainText(quote);
  return { before, editor, planned, project, quote, room };
}

async function wideWorkshop(page, width) {
  const { before, editor, planned, project, quote, room } =
    await planLargeWorkshop(page, width, true);
  const worker = before.actors[0].person;
  await click(page, "暮らし");
  const workPanel = page.getByRole("region", { name: "行動の指示" });
  await click(page, "仕事", workPanel);
  await workPanel
    .locator('button[data-kind="work"][data-target="wood"]')
    .click();
  await expect(page.locator(".rf-app")).toHaveAttribute("aria-busy", "false");
  assert.equal((await readGame(page)).actors[0].task.target, "wood");
  await runUntil(page, (g) => !g.actors[0].task);
  const restocked = await readGame(page);
  assert.ok(restocked.wood >= 13);
  await click(page, "住まい");
  await click(page, "木材10を取り置く", project);
  const reserved = await readGame(page);
  assert.equal(reserved.wood, restocked.wood - 10);
  assert.equal(reserved.time, restocked.time);
  assert.equal(plan(reserved).material.quantity, 10);
  assert.deepEqual(bundle(reserved).position, floor("living", 0));
  await select(project, "搬入担当").selectOption(worker.id);
  await click(page, "仮置き場へ運ぶ", project);
  const staged = await runUntil(page, (g) => !plan(g).assignment);
  assert.deepEqual(bundle(staged).position, floor("bedroom", 2));
  await select(project, "施工担当").selectOption(worker.id);
  await click(page, "施工する", project);
  await useClock(page, "15分進める");
  const working = await readSlot(page);
  assert.equal(plan(working.game).workedMinutes, 15);
  assert.deepEqual(working.game.house, planned.house);
  await reload(page, working);
  await click(page, "住まい");
  await expect(project).toContainText(quote);
  const built = await runUntil(page, (g) => plan(g).status === "completed");
  const completed = plan(built);
  assert.equal(completed.workedMinutes, 30);
  assert.equal(completed.material.state, "consumed");
  assert.equal(completed.material.quantity, 10);
  assert.equal(bundle(built), undefined);
  const id = completed.roomId;
  const added = built.house.rooms.find((r) => r.id === id);
  assert.deepEqual([added.width, added.height], [4, 4]);
  assert.equal(built.house.rooms.length, before.house.rooms.length + 1);
  await click(page, room, editor);
  await select(editor, "新しく置く設備").selectOption("workbench");
  const tiles = editor
    .locator("summary")
    .filter({ hasText: "室内のマスを編集" });
  await tiles.click();
  await expect(editor.locator(".yh-house-blueprint button")).toHaveCount(16);
  await click(page, "4列4行　床", editor);
  await select(editor, "4列4行の編集").selectOption("furniture");
  await click(page, "選んだマスに適用", editor);
  await expect(button(editor, "4列4行　木工台")).toBeVisible();
  await screenshot(
    page,
    "large-placed-" + width + ".png",
    button(editor, "4列4行　木工台"),
  );
  const furnished = await readSlot(page);
  const bench = furnished.game.house.rooms.find((r) => r.id === id).fixtures[0];
  assert.deepEqual([bench.kind, bench.cell], ["workbench", 15]);
  assert.equal(furnished.game.wood, built.wood - 3);
  assert.equal(furnished.game.time, built.time);
  await reload(page, furnished);
  await click(page, "暮らし");
  await click(
    page,
    worker.name,
    page.getByRole("group", { name: "住民を選ぶ" }),
  );
  await click(page, "仕事", workPanel);
  const wood = workPanel.locator(
    'button[data-kind="work"][data-target="wood"]',
  );
  await wood.locator("..").getByRole("combobox").selectOption(bench.id);
  await expect(wood.locator("..")).toContainText(
    "広い木工室・木工台（4列4行）",
  );
  await wood.click();
  await expect(page.locator(".rf-app")).toHaveAttribute("aria-busy", "false");
  const atWork = await readGame(page);
  assert.equal(
    atWork.actors[0].task.station,
    JSON.stringify(["slot", id, bench.id, 0]),
  );
  const finished = await runUntil(page, (g) => !g.actors[0].task);
  assert.equal(finished.actors[0].room, id);
  assert.ok(finished.wood > atWork.wood);
  report.normal.push({
    width,
    room,
    cost: 10,
    woodBeforeReservation: restocked.wood,
    builtAt: built.time,
    midConstructionMinutes: 15,
    lastCell: bench.cell,
    lastCellWorkFinished: finished.time,
  });
}

async function reviseLargeWorkshop(page, width) {
  const { before, editor, planned, project, room } = await planLargeWorkshop(
    page,
    width,
    false,
  );
  const editedName = "居間に続く読書室";
  const form = page.getByRole("form", {
    name: "増築計画を見直す",
    exact: true,
  });
  const name = form.getByRole("textbox", {
    name: "増築する部屋の名前",
    exact: true,
  });
  const size = select(form, "増築する部屋の広さ");
  const destination = select(form, "接続先");
  const floorChoice = select(form, "仮置き床");
  for (const shouldSave of [false, true]) {
    await click(page, "計画を見直す", project);
    await expect(name).toHaveValue(room);
    await expect(size).toHaveValue("4");
    await expect(destination).toHaveValue("bedroom");
    await expect(floorChoice).toHaveValue("2");
    await expect(button(form, "変更を保存")).toBeDisabled();
    await name.fill(editedName);
    await size.selectOption("3");
    await destination.selectOption("living");
    await expect(floorChoice).toHaveValue("");
    await expect(button(form, "変更を保存")).toBeDisabled();
    await floorChoice.selectOption("1");
    await expect(form).toContainText("4 × 3マス（12マス）・木材6・施工30分");
    assert.deepEqual(await readGame(page), planned);
    if (shouldSave) {
      await screenshot(
        page,
        "revised-plan-" + width + ".png",
        button(form, "変更を保存"),
      );
      await click(page, "変更を保存", form);
    } else {
      await click(page, "変更せず戻る", form);
      assert.deepEqual(await readGame(page), planned);
      await expect(button(project, "木材10を取り置く")).toBeDisabled();
    }
  }
  const changed = await readSlot(page);
  const revision = plan(changed.game);
  assert.deepEqual(Object.keys(changed.game.housing.construction.plans), [
    plan(planned).id,
  ]);
  assert.equal(revision.id, plan(planned).id);
  assert.equal(revision.createdAt, plan(planned).createdAt);
  assert.equal(revision.name, editedName);
  assert.equal(revision.neighborId, "living");
  assert.equal(revision.requiredWood, 6);
  assert.equal(revision.height ?? 3, 3);
  assert.deepEqual(revision.staging, housingPoint("living", 1));
  assert.equal(changed.game.wood, 9);
  assert.equal(changed.game.time, before.time);
  assert.deepEqual(changed.game.house, before.house);
  await reload(page, changed);
  await click(page, "住まい");
  const revisedCard = card(page, editedName);
  await click(page, "木材6を取り置く", revisedCard);
  const reserved = await readGame(page);
  assert.equal(reserved.wood, 3);
  assert.equal(plan(reserved).material.quantity, 6);
  assert.equal(reserved.time, before.time);
  await expect(button(revisedCard, "計画を見直す")).toHaveCount(0);
  const worker = before.actors[0].person.id;
  await select(revisedCard, "搬入担当").selectOption(worker);
  await click(page, "仮置き場へ運ぶ", revisedCard);
  const staged = await runUntil(page, (g) => !plan(g).assignment);
  assert.deepEqual(bundle(staged).position, floor("living", 1));
  await select(revisedCard, "施工担当").selectOption(worker);
  await click(page, "施工する", revisedCard);
  const built = await runUntil(page, (g) => plan(g).status === "completed");
  const final = plan(built);
  assert.equal(final.workedMinutes, 30);
  assert.equal(final.material.quantity, 6);
  assert.equal(final.material.state, "consumed");
  const actualRoom = built.house.rooms.find((r) => r.id === final.roomId);
  assert.deepEqual(
    [actualRoom.name, actualRoom.width, actualRoom.height],
    [editedName, 4, 3],
  );
  const links = built.house.links.filter((pair) => pair.includes(final.roomId));
  assert.equal(links.length, 1);
  assert.ok(links[0].includes("living"));
  await click(page, editedName, editor);
  await editor
    .locator("summary")
    .filter({ hasText: "室内のマスを編集" })
    .click();
  await expect(editor.locator(".yh-house-blueprint button")).toHaveCount(12);
  await expect(button(editor, "4列3行　床")).toBeVisible();
  await expect(button(editor, "4列4行　床")).toHaveCount(0);
  report.normal.push({
    width,
    revision: revision.id,
    initial: room,
    revised: editedName,
    stockAfterReservation: reserved.wood,
    roomWidth: actualRoom.width,
    roomHeight: actualRoom.height,
    staging: revision.staging,
    completedAt: built.time,
  });
}
async function verifySlotIsolation(page, saved, room) {
  await click(page, "住まい");
  const { section, destination, site } = await enterPlanning(
    page,
    "未保存の増築案",
  );
  await site.selectOption("2");
  const name = section.getByRole("textbox", { name: "増築する部屋の名前" });
  const editor = page.getByRole("region", { name: "住まいの間取り" });
  await click(page, "寝室", editor);
  await expect(button(editor, "寝室")).toHaveAttribute("aria-pressed", "true");
  await expect(button(section, "計画する")).toBeEnabled();
  const companion = await page.context().newPage();
  try {
    await companion.goto(url);
    await click(companion, "手帳");
    await click(companion, "同じ朝から分岐");
    await expect(page.getByRole("alert")).toContainText("別のタブ");
    await expect(panel(page)).toHaveCount(1);
    await expect(name).toHaveValue("");
    await expect(destination).toHaveValue("");
    await expect(site).toHaveValue("");
    await expect(button(section, "計画する")).toBeDisabled();
    await expect(editor).toHaveCount(1);
    await expect(button(editor, room)).toHaveCount(0);
    await expect(button(editor, "寝室")).toHaveAttribute(
      "aria-pressed",
      "false",
    );
    await expect(button(editor, "居間")).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    const book = await readBook(page);
    assert.notEqual(book.activeId, saved.id);
    assert.deepEqual(
      book.slots.find((slot) => slot.id === saved.id),
      saved,
    );
  } finally {
    await companion.close();
  }
  report.normal.push(
    "別タブで同じ朝から分岐。開いたままの住まい画面で、増築案と編集する部屋の選択が新しい保存枠に引き継がれないことを確認",
  );
}
async function ordinaryCancel(page) {
  const room = "取り消す小部屋";
  const origin = await startWoodworkers(page);
  await prepareDelivery(page, room, "yard", origin.game);
  await useClock(page, "5分進める");
  const carrying = await readGame(page);
  assert.equal(bundle(carrying).position.kind, "carried");
  await click(page, "この工事を取り消す", card(page, room));
  const exiting = await readGame(page);
  assert.equal(exiting.time, carrying.time);
  assert.equal(exiting.wood, carrying.wood);
  assert.equal(plan(exiting).status, "cancelled");
  assert.equal(bundle(exiting).position.kind, "carried");
  await expect(card(page, room)).toContainText("床に下ろします");
  const dropped = await next(page);
  assert.equal(plan(dropped).assignment, undefined);
  assert.deepEqual(bundle(dropped).position, floor("yard", 0));
  assert.equal(dropped.wood, carrying.wood);
  const partial = await saveExport(page, "construction-cancelled");
  await reload(page, partial);

  await click(page, "住まい");
  const carrier = dropped.actors[0].person.id;
  await select(card(page, room), "回収担当").selectOption(carrier);
  await click(page, "備蓄へ運び戻す", card(page, room));
  assert.equal((await readGame(page)).time, dropped.time);
  const returned = await runUntil(
    page,
    (g) => plan(g).material.state === "returned",
  );
  assert.equal(returned.wood, origin.game.wood);
  assert.equal(bundle(returned), undefined);
  assert.deepEqual(returned.house, origin.game.house);
  const saved = await saveExport(page, "construction-returned");
  assert.deepEqual(saved.origin, origin.origin);
  await reload(page, saved);
  report.normal.push(
    "別の新規暮らしで運搬中の工事を取消し、区間終点への荷下ろし、改めて指示した供給口への回収と返却、各保存の書出しと再読込",
  );
}

async function seed(page, game, origin, label) {
  const slot = { id: "qa-" + label, name: label, game, origin };
  const data = { format: 2, activeId: slot.id, slots: [slot] };
  assert.ok(sim.isGame(game) && sim.isGame(origin));
  await page.evaluate(
    ([key, data]) => {
      localStorage.setItem(key, JSON.stringify(data));
    },
    [LIBRARY_KEY, data],
  );
  // Compare the JSON representation written to storage. Fixture maps in memory
  // can have a null prototype, which the save format does not encode.
  await reload(page, JSON.parse(JSON.stringify(slot)));
}
function makeControlled() {
  return sim.enableHousing(
    sim.createGame(
      [people.makePersona(0, 25)],
      world.generateWorld(world.defaultWorldConfig()),
      "village",
    ),
    "new",
  );
}
function accepted(result) {
  assert.equal(result.error, undefined);
  return result.game;
}
function createReserved(origin, name) {
  const first = accepted(
    construction.createRoomConstruction(origin, {
      name,
      neighborId: "bedroom",
      stagingCell: 2,
    }),
  );
  return accepted(
    construction.reserveConstructionMaterial(first, "construction-1"),
  );
}
async function stockBoundary(page) {
  const name = "供給口の返却待ち";
  const origin = makeControlled();
  const reserved = createReserved(origin, name);
  const full = { ...reserved, wood: 1_000_000_000 };
  const waiting = accepted(
    construction.cancelRoomConstruction(full, "construction-1"),
  );
  await seed(page, waiting, origin, "stock-boundary");
  await click(page, "住まい");
  const action = "供給口の木材を備蓄に戻す";
  await expect(button(card(page, name), action)).toBeDisabled();
  await expect(card(page, name)).toContainText("自由備蓄の木材を使って");
  await expect(select(card(page, name), "回収担当")).toHaveCount(0);

  const editor = page.getByRole("region", { name: "住まいの間取り" });
  await select(editor, "新しく置く設備").selectOption("bath");
  await click(page, "この部屋に置く", editor);
  await click(page, action, card(page, name));
  const returned = await readGame(page);
  assert.equal(returned.time, waiting.time);
  assert.equal(returned.wood, 999_999_998);
  assert.equal(plan(returned).material.state, "returned");
  assert.equal(bundle(returned), undefined);
  await saveExport(page, "construction-capacity-returned");
  report.controlled.push(
    "備蓄上限まで木材がある有効な制御保存。供給口の返却不可と理由、家具への消費による余地の回復、運搬指示を追加せず返却",
  );
}
async function completionBoundary(page) {
  const name = "完成反映の境界";
  const origin = makeControlled();
  origin.wood = 6;
  const id = origin.actors[0].person.id;
  const reserved = createReserved(origin, name);
  const ordered = accepted(
    construction.assignConstructionHaul(
      reserved,
      "construction-1",
      id,
      "deliver",
    ),
  );
  const staged = sim.advance(ordered, 6);
  const building = accepted(
    construction.assignConstructionBuild(staged, "construction-1", id),
  );
  building.house.nextId = Number.MAX_SAFE_INTEGER;
  const blocked = sim.advance(building, 30);
  assert.equal(plan(blocked).workedMinutes, 30);
  await seed(page, blocked, origin, "completion-blocked");
  await click(page, "住まい");
  await expect(card(page, name)).toContainText("完成反映待ち");
  await expect(card(page, name)).toContainText("部屋の番号を発行できない");
  await expect(button(card(page, name), "完成を反映する")).toBeDisabled();
  await saveExport(page, "construction-completion-blocked");

  // Another valid control save has issuance capacity; regular UI never rewrites it.
  const ready = { ...blocked, house: { ...blocked.house, nextId: 61 } };
  await seed(page, ready, origin, "completion-ready");
  await click(page, "住まい");
  await click(page, "完成を反映する", card(page, name));
  const completed = await readGame(page);
  assert.equal(completed.time, blocked.time);
  assert.equal(completed.wood, 0);
  assert.equal(plan(completed).roomId, "room-61");
  assert.equal(plan(completed).material.state, "consumed");
  assert.equal(bundle(completed), undefined);
  await saveExport(page, "construction-completion-retried");
  report.controlled.push(
    "部屋番号の上限に達した有効な制御保存で完成反映の理由と待機を確認。番号に余裕を用意した別の制御保存で、追加時間や備蓄なしの完成を確認",
  );
}

try {
  browser = await chromium.launch({
    headless: true,
    executablePath: process.env.CHROMIUM_PATH || "/usr/bin/chromium",
    args: ["--no-sandbox"],
  });
  report.launched = true;
  for (const width of [1280, 320]) {
    await inFreshContext((page) => wideWorkshop(page, width));
    await inFreshContext((page) => reviseLargeWorkshop(page, width));
  }
  await inFreshContext(ordinaryBuild);
  await inFreshContext(ordinaryCancel);
  await inFreshContext(stockBoundary);
  await inFreshContext(completionBoundary);
  assert.deepEqual(report.pageErrors, []);
  assert.deepEqual(report.unexpectedRequests, []);
} catch (error) {
  report.failure = String(error);
  throw error;
} finally {
  await writeFile(
    resolve(output, "construction-result.json"),
    JSON.stringify(report, null, 2) + "\n",
  );
  await browser?.close();
}
console.log(JSON.stringify(report, null, 2));
