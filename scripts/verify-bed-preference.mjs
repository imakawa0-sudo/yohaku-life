// Exercise the built standalone HTML through normal controls and controlled imports.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { chromium, expect } from "@playwright/test";
import { tsImport } from "tsx/esm/api";

const load = (module) =>
  tsImport(`../src/reform/${module}.ts`, import.meta.url);
const [house, labels, library, preference, topology, people, sim, world] =
  await Promise.all([
    load("house"),
    load("facilityLabel"),
    load("library"),
    load("housing/bedPreference"),
    load("housing/topology"),
    load("peopleModel"),
    load("sim"),
    load("world"),
  ]);

const output = resolve(
  process.env.PLAYTEST_OUTPUT || "/tmp/yohaku-bed-preference-playtest",
);
const entry = "https://bed-preference.offline.test/";
const prepareOnly = process.env.BED_PREFERENCE_PREPARE_ONLY === "1";
const configured = "自動（優先する寝床を考慮）";
const unconfigured = "自動（移動と利用が短い設備）";
const preferredCopy = "優先する寝床を使う見込みです。";
const fallbackCopy = "別の寝床を使う見込みです。";
const blank = "未設定（使える寝床から選ぶ）";
const reservationReason = "使える設備はほかの住人が予約しています。";
const passageReason =
  "目的地への通路が通れません。戸・通路の開閉と間取りを確認してください。";
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
const restChoice = (page) =>
  page.getByRole("combobox", { name: "休息に使う設備", exact: true });
const restAction = (page) => button(page, "ひと眠りする");
const restHint = (page) => restAction(page).locator("..").locator("small");
const bedChoice = (page, name) =>
  page.getByRole("combobox", { name: name + "が優先する寝床", exact: true });
const clock = (page, time) =>
  expect(page.getByLabel("現在時刻 " + time, { exact: true })).toBeVisible();

function bedInfo(game, fixtureId) {
  const { rooms } = game.house;
  const room = rooms.find((item) =>
    item.fixtures.some((fixture) => fixture.id === fixtureId),
  );
  const fixture = room?.fixtures.find((item) => item.id === fixtureId);
  assert.ok(room && fixture, fixtureId);
  return {
    fixtureId,
    roomId: room.id,
    kind: fixture.kind,
    cell: fixture.cell,
    label: labels.facilityLabel(rooms, room, fixture.kind, fixture.cell),
    station: topology.housingSlotId(room.id, fixture.id, 0),
  };
}

function restPreview(game, residentId) {
  const { facility, minutes } = sim.inspectOrder(
    game,
    residentId,
    "need",
    "energy",
  );
  assert.ok(facility);
  return {
    ...bedInfo(game, facility.fixtureId),
    time: `移動${facility.moveMinutes}分 ＋ 利用${facility.useMinutes}分（合計${minutes}分）`,
    bedPreference: facility.bedPreference,
  };
}

async function prepareCases() {
  // Both mats have the same long room name and cell. The living-room bed is faster.
  const names = ["検証のカヤ", "検証のスイ"];
  const residents = names.map((name, i) => ({
    ...people.makePersona(i, 23 + i),
    name,
  }));
  const [first, second] = residents.map(({ id }) => id);
  const layout = house.initialHouse();
  const longName = "東の窓辺から朝の光が差し込む静かな寝室";
  layout.rooms.find((room) => room.id === "bedroom").name = longName;
  const withRoom = house.editHouse(layout, {
    type: "room",
    name: longName,
    neighbor: "living",
  });
  const withMat = house.editHouse(withRoom, {
    type: "build",
    room: "room-1",
    kind: "mat",
    cell: 10,
  });
  const furnished = house.editHouse(withMat, {
    type: "build",
    room: "living",
    kind: "bed",
    cell: 7,
  });
  const origin = sim.enableHousing(
    sim.createGame(
      residents,
      world.generateWorld(world.defaultWorldConfig()),
      "village",
      furnished,
    ),
    "new",
  );
  const beds = {
    preferred: bedInfo(origin, "mat-1"),
    sameName: bedInfo(origin, "fixture-2"),
    nearby: bedInfo(origin, "fixture-3"),
  };
  assert.ok(beds.preferred.label.endsWith("、同名の1室目）"));
  assert.ok(beds.sameName.label.endsWith("、同名の2室目）"));
  const mat = beds.preferred.fixtureId;
  const nearby = beds.nearby.fixtureId;
  const firstPreference = preference.setPreferredBed(origin, first, mat);
  const shared = preference.setPreferredBed(firstPreference, second, mat);
  const afterFirst = sim.order(shared, first, "need", "energy");
  const preferred = restPreview(shared, first);
  const competition = restPreview(afterFirst, second);
  assert.equal(preferred.fixtureId, mat);
  assert.equal(preferred.bedPreference?.outcome, "preferred");
  assert.equal(competition.fixtureId, nearby);
  assert.deepEqual(competition.bedPreference, {
    fixtureId: mat,
    outcome: "fallback",
    reason: reservationReason,
  });

  const passage = topology.housingLinkId("living", "bedroom");
  const inaccessible = sim.setHousingPassage(
    firstPreference,
    "link",
    passage,
    false,
  );
  const blocked = restPreview(inaccessible, first);
  assert.equal(blocked.fixtureId, nearby);
  assert.deepEqual(blocked.bedPreference, {
    fixtureId: mat,
    outcome: "fallback",
    reason: passageReason,
  });
  const reopened = restPreview(firstPreference, first);
  assert.equal(reopened.fixtureId, mat);

  const moving = sim.order(firstPreference, first, "need", "energy");
  assert.equal(moving.actors[0].task?.station, beds.preferred.station);
  const active = sim.advance(moving, 5);
  assert.equal(active.actors[0].task?.station, beds.preferred.station);
  const replacement = beds.nearby.fixtureId;

  const cases = {};
  for (const [key, name, game, expected] of [
    [
      "competition",
      "検証・同じ寝床を優先",
      shared,
      { preferred, fallback: competition },
    ],
    [
      "inaccessible",
      "検証・通れない寝床",
      inaccessible,
      {
        fallback: blocked,
        reopened,
        openPassageButton: `居間と${longName}の通路を開ける`,
      },
    ],
    [
      "active",
      "検証・休息中の設定変更",
      active,
      { station: beds.preferred.station, replacement, clock: "08:05" },
    ],
  ]) {
    const file = `bed-preference-input-${key}.json`;
    const raw = library.exportSlot({ id: key, name, game, origin });
    const imported = library.importSlot(raw);
    assert.deepEqual(imported.game, json(game));
    assert.deepEqual(imported.origin, json(origin));
    await writeFile(resolve(output, file), raw);
    cases[key] = { file, name, expected };
  }
  const manifest = {
    residents: residents.map(({ id, name }) => ({ id, name })),
    beds,
    cases,
    copy: {
      blank,
      configured,
      unconfigured,
      preferred: preferredCopy,
      fallback: fallbackCopy,
    },
  };
  await writeJson("bed-preference-manifest.json", manifest);
  return manifest;
}

async function inContext(browser, html, run) {
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

async function openPolicy(page, name) {
  const summary = page
    .locator("summary")
    .filter({ hasText: "暮らしと備蓄の方針" });
  if ((await summary.locator("..").getAttribute("open")) === null) {
    await summary.click();
  }
  const choice = bedChoice(page, name);
  await expect(choice).toBeVisible();
  await expect(choice).toBeEnabled();
  return choice;
}

async function setBed(page, name, fixtureId) {
  const choice = await openPolicy(page, name);
  await choice.selectOption(fixtureId);
  await settled(page);
  await expect(choice).toHaveValue(fixtureId);
}

async function assertSavedBed(page, name, fixtureId) {
  await expect(await openPolicy(page, name)).toHaveValue(fixtureId);
}

async function checkpoint(page, name) {
  await click(page, "手帳");
  const download = page.waitForEvent("download");
  await button(page, "保存を書き出す").click();
  const raw = await readFile(await (await download).path(), "utf8");
  const slot = library.importSlot(raw); // Validates both Game and origin.
  assert.equal(JSON.parse(raw).version, 2);
  slot.id = JSON.parse(raw).slot.id;
  await writeFile(resolve(output, `${name}.json`), raw);
  await click(page, "暮らし");
  return slot;
}

function assertSlot(slot, game, origin) {
  assert.deepEqual(slot.game, json(game));
  assert.deepEqual(slot.origin, json(origin));
}

function assertPreferenceChange(before, after, expectedPreferences) {
  assert.equal(
    Object.hasOwn(after.game.housing, "preferredBeds"),
    expectedPreferences !== undefined,
  );
  assert.deepEqual(after.game.housing.preferredBeds, expectedPreferences);
  const beforeGame = structuredClone(before.game);
  const afterGame = structuredClone(after.game);
  delete beforeGame.housing.preferredBeds;
  delete afterGame.housing.preferredBeds;
  assert.deepEqual(afterGame, beforeGame);
  assert.deepEqual(after.origin, before.origin);
}

async function loadSave(page, file) {
  await click(page, "手帳");
  await page
    .getByLabel("新版の保存ファイル")
    .setInputFiles(resolve(output, file));
  await expect(restAction(page)).toBeVisible();
  await settled(page);
}

async function assertPreview(page, preview) {
  await expect(restAction(page)).toBeEnabled();
  await expect(restHint(page)).toContainText(preview.label);
  await expect(restHint(page)).toContainText(preview.time);
}

async function assertFallback(page, expected, preferredBed) {
  await expect(restChoice(page).locator("option:checked")).toHaveText(
    configured,
  );
  await assertPreview(page, expected);
  await expect(restHint(page)).toContainText(preferredBed.label);
  await expect(restHint(page)).toContainText(expected.bedPreference.reason);
  await expect(restHint(page)).toContainText(fallbackCopy);
  await expect(restHint(page)).not.toContainText(preferredCopy);
}

async function captureLayouts(page, name, beds) {
  for (const width of [1280, 390, 320]) {
    const height = width === 1280 ? 900 : 844;
    await page.setViewportSize({ width, height });
    const policy = await openPolicy(page, name);
    const current = await policy.inputValue();
    for (const choice of [policy, restChoice(page)]) {
      for (const bed of [beds.preferred, beds.sameName]) {
        await expect(
          choice.locator(`option[value="${bed.fixtureId}"]`),
        ).toHaveText(bed.label);
      }
      await expect(choice).toBeEnabled();
      const box = await choice.boundingBox();
      assert.ok(
        box && box.x >= 0 && box.x + box.width <= width + 1 && box.height >= 44,
        `${width}px select: ${JSON.stringify(box)}`,
      );
    }
    // Exercise resident policy changes and one-off selection at every width.
    await setBed(page, name, beds.sameName.fixtureId);
    await setBed(page, name, current);
    await restChoice(page).selectOption(beds.sameName.fixtureId);
    await expect(restChoice(page)).toHaveValue(beds.sameName.fixtureId);
    await restChoice(page).selectOption("");
    const { client, scroll } = await page.evaluate(() => ({
      client: document.documentElement.clientWidth,
      scroll: document.documentElement.scrollWidth,
    }));
    assert.ok(
      scroll <= client + 1,
      `${width}px document width: ${scroll}/${client}`,
    );
    for (const [label, locator] of [
      ["policy", policy],
      ["rest", restChoice(page)],
    ]) {
      await locator.scrollIntoViewIfNeeded();
      const path = resolve(output, `${label}-${width}.png`);
      await page.screenshot({ path });
      report.screenshots.push({ width, height, path });
    }
  }
  await page.setViewportSize({ width: 1280, height: 900 });
}

async function normal(page) {
  await click(page, "木工の二人");
  await click(page, "この朝を始める");
  if (!(await restChoice(page).count())) {
    await click(page, "手帳");
    await click(page, "住居の移動を使う暮らしに分岐");
  }
  await clock(page, "08:00");
  const start = await checkpoint(page, "normal-start");
  assert.ok(start.game.housing);
  const [first, second] = start.game.actors.map(({ person }) => person);
  await expect(restChoice(page).locator("option:checked")).toHaveText(
    unconfigured,
  );
  await click(page, "住まい");
  const editor = page.getByRole("region", { name: "住まいの間取り" });
  await button(editor, "居間").click();
  await editor
    .getByLabel("新しく置く設備", { exact: true })
    .selectOption("mat");
  await button(editor, "この部屋に置く").click();
  await settled(page);
  const furnished = await checkpoint(page, "normal-furnished");
  const nearby = furnished.game.house.rooms
    .find(({ id }) => id === "living")
    .fixtures.find(({ kind }) => kind === "mat");
  assert.ok(nearby);
  assert.equal(furnished.game.time, start.game.time);
  assert.equal(
    furnished.game.wood,
    start.game.wood - house.furnishings.mat.cost,
  );
  assert.deepEqual(furnished.origin, start.origin);

  await setBed(page, first.name, "mat-1");
  const firstChoice = await checkpoint(page, "normal-first-preference");
  assertPreferenceChange(furnished, firstChoice, { [first.id]: "mat-1" });
  await click(page, second.name);
  await setBed(page, second.name, nearby.id);
  await click(page, first.name);
  await assertSavedBed(page, first.name, "mat-1");
  await clock(page, "08:00");
  const chosen = await checkpoint(page, "normal-preferences");
  assertPreferenceChange(firstChoice, chosen, {
    [first.id]: "mat-1",
    [second.id]: nearby.id,
  });
  await expect(restChoice(page).locator("option:checked")).toHaveText(
    configured,
  );
  await assertPreview(page, restPreview(chosen.game, first.id));
  await expect(restHint(page)).toContainText(preferredCopy);
  await click(page, "ひと眠りする");
  const booked = await checkpoint(page, "normal-booked");
  assertSlot(
    booked,
    sim.order(chosen.game, first.id, "need", "energy"),
    start.origin,
  );
  assert.equal(
    booked.game.actors[0].task?.station,
    bedInfo(chosen.game, "mat-1").station,
  );
  await click(page, "5分進める");
  await clock(page, "08:05");
  const progressed = await checkpoint(page, "normal-progressed");
  assertSlot(progressed, sim.advance(booked.game, 5), start.origin);
  await page.reload();
  await assertSavedBed(page, first.name, "mat-1");
  await click(page, second.name);
  await assertSavedBed(page, second.name, nearby.id);
  await assertSlot(
    await checkpoint(page, "normal-reloaded"),
    progressed.game,
    start.origin,
  );

  await click(page, "手帳");
  await click(page, "今の時点から分岐");
  await assertSavedBed(page, second.name, nearby.id);
  const current = await checkpoint(page, "normal-current-branch");
  assert.notEqual(current.id, progressed.id);
  assertSlot(current, progressed.game, start.origin);
  await click(page, "手帳");
  await click(page, "同じ朝から分岐");
  const morning = await checkpoint(page, "normal-origin-branch");
  assert.notEqual(morning.id, current.id);
  assertSlot(morning, start.origin, start.origin);
  await expect(
    (await openPolicy(page, second.name)).locator("option:checked"),
  ).toHaveText(blank);
  await click(page, first.name);
  await assertSavedBed(page, first.name, "");
  await click(page, "手帳");
  await page
    .locator(".rf-slots button")
    .filter({ has: page.getByText(progressed.name, { exact: true }) })
    .click();
  await settled(page);
  await assertSavedBed(page, first.name, "mat-1");
  await assertSlot(
    await checkpoint(page, "normal-original-slot"),
    progressed.game,
    start.origin,
  );
  await loadSave(page, "normal-progressed.json");
  const imported = await checkpoint(page, "normal-imported");
  assert.notEqual(imported.id, progressed.id);
  assertSlot(imported, progressed.game, start.origin);
  await assertSavedBed(page, first.name, "mat-1");
  await click(page, second.name);
  await assertSavedBed(page, second.name, nearby.id);
  report.normal.push(
    "木工の二人を開始し、居間に寝床を設置。二人の設定、予約、時間進行、再読込、書出し・読込、現在と最初の朝からの分岐を確認。",
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
  return start;
}

async function competition(page, manifest) {
  const start = await controlledStart(page, "competition", manifest);
  const [first, second] = manifest.residents;
  const { beds, cases } = manifest;
  const mat = beds.preferred.fixtureId;
  const { preferred, fallback } = cases.competition.expected;
  await assertSavedBed(page, first.name, mat);
  await assertPreview(page, preferred);
  await expect(restHint(page)).toContainText(preferredCopy);
  await click(page, "ひと眠りする");
  const booked = await checkpoint(page, "controlled-competition-first-booked");
  assertSlot(
    booked,
    sim.order(start.game, first.id, "need", "energy"),
    start.origin,
  );
  assert.equal(booked.game.actors[0].task?.station, beds.preferred.station);
  await click(page, second.name);
  await assertSavedBed(page, second.name, mat);
  await assertFallback(page, fallback, beds.preferred);
  await captureLayouts(page, second.name, beds);
  await assertFallback(page, fallback, beds.preferred);
  await restChoice(page).selectOption(mat);
  await expect(restAction(page)).toBeDisabled();
  await expect(restHint(page)).toHaveText(reservationReason);
  await restChoice(page).selectOption(fallback.fixtureId);
  await assertPreview(page, fallback);
  await expect(restHint(page)).not.toContainText(preferredCopy);
  await expect(restHint(page)).not.toContainText(fallbackCopy);
  await expect(restHint(page)).not.toContainText(beds.preferred.label);
  assertSlot(
    await checkpoint(page, "controlled-competition-preview-only"),
    booked.game,
    start.origin,
  );
  await restChoice(page).selectOption("");
  await click(page, "ひと眠りする");
  const both = await checkpoint(page, "controlled-competition-both-booked");
  assertSlot(
    both,
    sim.order(booked.game, second.id, "need", "energy"),
    start.origin,
  );
  assert.equal(both.game.actors[1].task?.station, beds.nearby.station);
  assert.deepEqual(both.game.actors[0].task, booked.game.actors[0].task);
  await clock(page, "08:00");
  report.controlled.push(
    "同じ寝床を優先する二人で、先の予約を保ち後の住人が別の寝床へ。明示指定の無効理由と予告の非保存、およびPC・390・320pxで同名ラベルと操作を確認。",
  );
}

async function inaccessible(page, manifest) {
  const start = await controlledStart(page, "inaccessible", manifest);
  const { name, id } = manifest.residents[0];
  const preferred = manifest.beds.preferred;
  const { fallback, reopened, openPassageButton } =
    manifest.cases.inaccessible.expected;
  await assertSavedBed(page, name, preferred.fixtureId);
  await assertFallback(page, fallback, preferred);
  const housing = page.getByRole("region", { name: "家の中の移動と設定" });
  await housing.getByText("通路と扉", { exact: true }).click();
  await click(page, openPassageButton);
  await assertPreview(page, reopened);
  await expect(restHint(page)).toContainText(preferredCopy);
  await assertSavedBed(page, name, preferred.fixtureId);
  const open = await checkpoint(page, "controlled-inaccessible-reopened");
  assertSlot(
    open,
    sim.setHousingPassage(
      start.game,
      "link",
      topology.housingLinkId("living", "bedroom"),
      true,
    ),
    start.origin,
  );
  assert.equal(restPreview(open.game, id).fixtureId, preferred.fixtureId);
  report.controlled.push(
    "通れない優先寝床の理由と代替先を確認。通路を開くと設定を保ったまま優先寝床に戻る。",
  );
}

async function active(page, manifest) {
  const start = await controlledStart(page, "active", manifest);
  const { name, id } = manifest.residents[0];
  const {
    station,
    replacement,
    clock: startClock,
  } = manifest.cases.active.expected;
  await clock(page, startClock);
  await assertSavedBed(page, name, manifest.beds.preferred.fixtureId);
  await setBed(page, name, replacement);
  const changed = await checkpoint(page, "controlled-active-changed");
  assertPreferenceChange(start, changed, { [id]: replacement });
  assert.equal(changed.game.actors[0].task?.station, station);
  await click(page, "5分進める");
  await clock(page, "08:10");
  const using = await checkpoint(page, "controlled-active-using");
  assertSlot(using, sim.advance(changed.game, 5), start.origin);
  assert.equal(using.game.actors[0].task?.station, station);
  assert.ok(
    using.game.actors[0].task.remaining < changed.game.actors[0].task.remaining,
  );
  await setBed(page, name, "");
  const cleared = await checkpoint(page, "controlled-active-cleared");
  assertPreferenceChange(using, cleared, undefined);
  report.controlled.push(
    "寝床へ移動中の設定変更と利用中の解除について、進行中の行き先、時計、予約、originを保ち、設定だけが保存に反映されることを全状態で照合。",
  );
}

let browser;
await mkdir(output, { recursive: true });
try {
  const manifest = await prepareCases();
  report.manifest = resolve(output, "bed-preference-manifest.json");
  if (prepareOnly) {
    report.status = "inputs-prepared";
  } else {
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
    for (const run of [competition, inaccessible, active]) {
      await inContext(browser, html, (page) => run(page, manifest));
    }
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
  } else {
    report.status += "-failed";
  }
  report.errors.push(String(error));
  throw error;
} finally {
  await writeJson("bed-preference-result.json", report);
  await browser?.close();
}
