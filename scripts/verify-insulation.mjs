// Actual standalone controls; all contexts are disposable and only frost boundary cases use imports.
import assert from "node:assert/strict";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { chromium, expect } from "@playwright/test";
import { tsImport } from "tsx/esm/api";
const load = (module) =>
  tsImport(`../src/reform/${module}.ts`, import.meta.url);
const [sim, library, insulation, construction, helpers] = await Promise.all([
  load("sim"),
  load("library"),
  load("housing/insulation"),
  load("housing/construction"),
  tsImport("../tests/helpers/construction.ts", import.meta.url),
]);
const output = resolve(
  process.env.PLAYTEST_OUTPUT || "/tmp/yohaku-insulation-playtest",
);
await mkdir(output, { recursive: true });
const { base, one, two, ok, planId, building, hauling } = helpers;
const origin = base();
origin.time = 60 * 1440 + 480;
origin.housing.state.time = origin.time;
origin.actors[0].person.name = "検証カヤ";
origin.actors[1].person.name = "検証スイ";
const planned = ok(
  insulation.createRoomInsulation(origin, {
    roomId: "bedroom",
    stagingCell: 2,
  }),
);
const reserved = ok(construction.reserveConstructionMaterial(planned, planId));
const staged = sim.advance(
  sim.order(hauling(reserved), two, "work", "care"),
  6,
);
const complete = sim.advance(building(staged), 30);
const noWood = { ...origin, wood: 0 };
const cases = {
  frost: complete,
  "no-wood": noWood,
  "whole-home": { ...planned, insulated: true },
};
// An ordinary wood job can finish during construction. Verify this in a
// separate synthetic scenario, without changing the browser journey's actors.
const overlapping = structuredClone(reserved);
overlapping.actors[1].person.skills.wood = 1;
const parallelStaged = sim.advance(
  sim.order(hauling(overlapping), two, "work", "wood"),
  6,
);
const parallelBuilt = sim.advance(building(parallelStaged), 30);
assert.equal(parallelBuilt.wood, 6); // 6 stock - 1 reservation + 1 village woodwork
assert.equal(
  parallelBuilt.housing.construction.plans[planId].material.state,
  "consumed",
);
assert.ok(sim.isGame(parallelBuilt));
const report = {
  fixtures: {},
  parallelWoodwork: {
    reserved: overlapping.wood,
    finished: parallelBuilt.wood,
  },
  browser: [],
  errors: [],
};
for (const [name, game] of Object.entries(cases)) {
  assert.ok(sim.isGame(game), name);
  const file = `insulation-input-${name}.json`;
  const raw = library.exportSlot({
    id: name,
    name: `検証 ${name}`,
    game,
    origin,
  });
  assert.deepEqual(
    library.importSlot(raw).game,
    JSON.parse(JSON.stringify(game)),
  );
  await writeFile(resolve(output, file), raw);
  report.fixtures[name] = {
    file,
    time: game.time,
    wood: game.wood,
    protection: game.actors.map((a) => insulation.homeColdProtection(game, a)),
  };
}
assert.deepEqual(report.fixtures.frost.protection, ["room", null]);
assert.deepEqual(report.fixtures["whole-home"].protection, [
  "whole-home",
  "whole-home",
]);
await writeFile(
  resolve(output, "manifest.json"),
  JSON.stringify(report, null, 2),
);
if (process.argv.includes("--prepare-only")) process.exit(0);
const html = await readFile(process.env.REFORM_HTML || "dist/yohaku.html");
const url = "https://insulation.offline.test/";
const button = (scope, name) =>
  scope.getByRole("button", { name, exact: true });
const select = (scope, name) =>
  scope.getByRole("combobox", { name, exact: true });
const panel = (page) => page.getByRole("region", { name: "一室の寒さ対策" });
const card = (page) => panel(page).getByRole("article");
const getGame = async (page) => {
  const book = JSON.parse(
    await page.evaluate(
      (key) => localStorage.getItem(key),
      library.LIBRARY_KEY,
    ),
  );
  const game = book.slots.find((slot) => slot.id === book.activeId).game;
  assert.ok(sim.isGame(game));
  return game;
};
const click = async (page, name, scope = page) => {
  await button(scope, name).click();
  await expect(page.locator(".rf-app")).toHaveAttribute("aria-busy", "false");
};
const start = async (page) => {
  await click(page, "木工の二人");
  await click(page, "この朝を始める");
};
const clock = async (page, name = "次の行動完了まで進める") => {
  // Use the real engine starting at the saved browser state: other residents
  // may finish autonomous woodwork before, during, or after this construction.
  // A fixed total wood count across elapsed time would mistake that income for
  // duplicate material handling. The UI must apply exactly one time advance.
  const before = await getGame(page);
  const minutes =
    name === "15分進める" ? 15 : sim.nextCompletionMinutes(before);
  assert.ok(minutes > 0);
  const expected = sim.advance(before, minutes);
  await click(page, "暮らし");
  await click(page, name);
  await click(page, "住まい");
  const after = await getGame(page);
  assert.equal(after.time, expected.time);
  assert.equal(after.wood, expected.wood);
  assert.deepEqual(
    after.housing.construction,
    JSON.parse(JSON.stringify(expected.housing.construction)),
  );
};
const prepare = async (page, room = "bedroom", cell = "2") => {
  await select(panel(page), "対策する部屋").selectOption(room);
  await select(panel(page), "仮置き床").selectOption(cell);
  await click(page, "寒さ対策を計画する", panel(page));
};
const assign = async (page, kind, id) => {
  const labels = {
    deliver: ["搬入担当", "仮置き場へ運ぶ"],
    build: ["施工担当", "施工する"],
    return: ["回収担当", "備蓄へ運び戻す"],
  };
  await select(card(page), labels[kind][0]).selectOption(id);
  await click(page, labels[kind][1], card(page));
};
const until = async (page, id, done) => {
  for (let attempt = 0; attempt < 12; attempt++) {
    const g = await getGame(page);
    if (done(g.housing.construction.plans[id], g)) return g;
    await clock(page);
  }
  assert.fail("工事が完了しません");
};
async function testFrostBedPreview(page) {
  const startTime = (await getGame(page)).time;
  await click(page, "住まい");
  const house = page.getByRole("region", { name: "住まいの間取り" });
  await click(page, "居間", house);
  await house
    .getByRole("combobox", { name: "新しく置く設備", exact: true })
    .selectOption("mat");
  await click(page, "この部屋に置く", house);
  const installed = await getGame(page);
  const bed = installed.house.rooms
    .find((room) => room.id === "living")
    .fixtures.find((f) => f.kind === "mat");
  assert.ok(bed);
  await click(page, "暮らし");
  const commands = page.getByRole("region", { name: "行動の指示" });
  const roster = page.getByRole("group", { name: "住民を選ぶ" });
  const action = button(commands, "ひと眠りする");
  const row = action.locator("..");
  const preview = row.locator("small");
  const picker = row.getByRole("combobox", { name: "休息に使う設備" });
  await click(page, "検証カヤ", roster);
  await click(page, "生活", commands);
  await expect(picker.locator('option[value="mat-1"]')).toHaveText(
    /寝室.*一室対策済み/,
  );
  await expect(picker.locator('option[value="' + bed.id + '"]')).toHaveText(
    /居間.*未対策/,
  );
  await picker.selectOption("mat-1");
  await expect(preview).toContainText(/休息先の寒さ対策.*一室対策済み/);
  await action.click();
  await expect(page.locator(".rf-app")).toHaveAttribute("aria-busy", "false");
  await click(page, "検証スイ", roster);
  const policy = page
    .locator("summary")
    .filter({ hasText: "暮らしと備蓄の方針" });
  if (!(await policy.locator("..").evaluate((el) => el.open)))
    await policy.click();
  const preferred = page.getByRole("combobox", {
    name: "検証スイが優先する寝床",
    exact: true,
  });
  await expect(preferred.locator('option[value="mat-1"]')).toHaveText(
    /寝室.*一室対策済み/,
  );
  await expect(preferred.locator('option[value="' + bed.id + '"]')).toHaveText(
    /居間.*未対策/,
  );
  await preferred.selectOption("mat-1");
  await click(page, "生活", commands);
  await expect(picker).toHaveValue("");
  await expect(preview).toContainText("別の寝床を使う見込み");
  await expect(preview).toContainText("居間");
  await expect(preview).toContainText(/休息先の寒さ対策.*未対策/);
  assert.equal((await getGame(page)).time, startTime);
  for (const width of [1280, 320]) {
    await page.setViewportSize({ width, height: width === 320 ? 844 : 900 });
    await row.evaluate((el) => el.scrollIntoView({ block: "center" }));
    assert.ok(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth + 1,
      ),
    );
    await page.screenshot({
      path: resolve(output, "bed-fallback-" + width + ".png"),
    });
  }
  await page.setViewportSize({ width: 1280, height: 900 });
  report.browser.push(
    "frost: explicit protected bedroom, protected preference, occupied bed falls back to unprotected living-room mat",
  );
}

let browser;
try {
  browser = await chromium.launch(
    process.env.CHROMIUM_EXECUTABLE
      ? { executablePath: process.env.CHROMIUM_EXECUTABLE }
      : {},
  );
  async function fresh(run) {
    const context = await browser.newContext({
      offline: true,
      viewport: { width: 1280, height: 900 },
    });
    try {
      await context.route("**/*", (r) =>
        r.request().url() === url
          ? r.fulfill({ contentType: "text/html; charset=utf-8", body: html })
          : r.abort(),
      );
      const page = await context.newPage();
      page.on("pageerror", (e) => report.errors.push(e.message));
      await page.goto(url);
      await run(page);
    } finally {
      await context.close();
    }
  }
  await fresh(async (page) => {
    await start(page);
    const before = await getGame(page);
    const resident = before.actors[0].person.id;
    await click(page, "住まい");
    await prepare(page);
    const planAfter = await getGame(page);
    assert.equal(planAfter.time, before.time);
    assert.equal(planAfter.wood, before.wood);
    await click(page, "木材1を取り置く", card(page));
    const firstReserved = await getGame(page);
    assert.equal(firstReserved.time, before.time);
    assert.equal(firstReserved.wood, before.wood - 1);
    assert.equal(
      firstReserved.housing.construction.plans[planId].material.quantity,
      1,
    );
    await assign(page, "deliver", resident);
    await until(page, planId, (p) => !p.assignment);
    await assign(page, "build", resident);
    await clock(page, "15分進める");
    const partial = await getGame(page);
    assert.equal(partial.housing.construction.plans[planId].workedMinutes, 15);
    await page.reload();
    await expect(button(page, "暮らし")).toBeVisible();
    assert.deepEqual(await getGame(page), partial);
    await click(page, "住まい");
    const done = await until(page, planId, (p) => p.status === "completed");
    assert.equal(done.housing.construction.plans[planId].workedMinutes, 30);
    const completedPlan = done.housing.construction.plans[planId];
    assert.equal(completedPlan.material.quantity, 1);
    assert.equal(completedPlan.material.state, "consumed");
    assert.equal(
      done.housing.state.items[completedPlan.material.itemId],
      undefined,
    );
    assert.deepEqual(done.house, before.house);
    await expect(
      panel(page).getByText("「寝室」の寒さ対策・完成", { exact: true }),
    ).toBeVisible();
    await prepare(page, "living", "2");
    const secondPlan = await getGame(page);
    assert.equal(secondPlan.time, done.time);
    assert.equal(secondPlan.wood, done.wood);
    await click(page, "木材1を取り置く", card(page));
    const secondReserved = await getGame(page);
    assert.equal(secondReserved.time, secondPlan.time);
    assert.equal(secondReserved.wood, secondPlan.wood - 1);
    await assign(page, "deliver", resident);
    const secondStaged = await until(
      page,
      "construction-2",
      (p) => !p.assignment,
    );
    await click(page, "この工事を取り消す", card(page));
    const cancelled = await getGame(page);
    assert.equal(cancelled.time, secondStaged.time);
    assert.equal(cancelled.wood, secondStaged.wood);
    assert.equal(
      cancelled.housing.construction.plans["construction-2"].material.state,
      "present",
    );
    await assign(page, "return", resident);
    const returned = await until(
      page,
      "construction-2",
      (p) => p.material.state === "returned",
    );
    const returnedPlan = returned.housing.construction.plans["construction-2"];
    assert.equal(returnedPlan.material.quantity, 1);
    assert.equal(returnedPlan.status, "cancelled");
    assert.equal(returnedPlan.material.state, "returned");
    assert.equal(
      returned.housing.state.items[returnedPlan.material.itemId],
      undefined,
    );
    report.browser.push(
      "new-start planning, delivery, mid-work reload, completion, cancellation and recovery",
    );
  });
  for (const name of Object.keys(cases))
    await fresh(async (page) => {
      await start(page);
      await click(page, "手帳");
      await page
        .getByLabel("新版の保存ファイル")
        .setInputFiles(resolve(output, report.fixtures[name].file));
      await expect(
        page.getByRole("region", { name: "行動の指示" }),
      ).toBeVisible();
      if (name === "frost") {
        await click(page, "検証カヤ");
        await expect(
          page.getByText(/寒さ対策：この部屋で対策済み/),
        ).toBeVisible();
        await click(page, "検証スイ");
        await expect(page.getByText(/寒さ対策：未対策/)).toBeVisible();
        await testFrostBedPreview(page);
      }
      await click(page, "住まい");
      if (name === "no-wood") {
        await prepare(page);
        await expect(button(card(page), "木材1を取り置く")).toBeDisabled();
      }
      if (name === "whole-home") {
        await expect(button(card(page), "木材1を取り置く")).toBeEnabled();
        await expect(button(panel(page), "寒さ対策を計画する")).toBeDisabled();
      }
      for (const width of [1280, 390, 320]) {
        await page.setViewportSize({ width, height: 900 });
        await panel(page).scrollIntoViewIfNeeded();
        assert.ok(
          await page.evaluate(
            () => document.documentElement.scrollWidth <= innerWidth + 1,
          ),
        );
        await page.screenshot({
          path: resolve(output, `${name}-${width}.png`),
          animations: "disabled",
        });
      }
      report.browser.push(name);
    });
  assert.deepEqual(report.errors, []);
} finally {
  await browser?.close();
  await writeFile(
    resolve(output, "report.json"),
    JSON.stringify(report, null, 2),
  );
}
