/** Actual offline UI regression for landscape captions beneath the picture.
 * Saves are copied byte-for-byte: one ordinary-play export, one explicitly
 * controlled public-command input, and one actual UI export from that setup.
 * This runner never calls the engine or writes browser storage directly.
 */
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { chromium, expect } from "@playwright/test";

const digest = (value) => createHash("sha256").update(value).digest("hex");
const html = await readFile(
  resolve(process.env.CAPTIONS_HTML || "dist/yohaku-v53.html"),
  "utf8",
);
const sha256 = digest(html);
if (process.env.EXPECTED_HTML_SHA)
  assert.equal(sha256, process.env.EXPECTED_HTML_SHA);
const output =
  process.env.PLAYTEST_OUTPUT ||
  `/workspace/research/stage4c-workflow/captions/${sha256.slice(0, 12)}`;
await mkdir(output, { recursive: true });
const runner = await readFile(new URL(import.meta.url), "utf8");
await writeFile(`${output}/tested-yohaku.html`, html);
await writeFile(`${output}/tested-runner.mjs`, runner);

const ENTRY_URL = "http://yohaku-captions.local/";
const names = { aki: "アキ", mio: "ミオ", ren: "レン" };
const fixtureCases = [
  {
    name: "lived-home-long-craft-facts",
    fixture: "tests/fixtures/scene-caption-lived-home-v3.json",
    sha256: "427caa249f05f8e44834381371aaa7f6840e70b9eee6e9c7deadabf22269abb5",
    provenance:
      "Ordinary UI play: three daily safe harvests, actual return/storage and equipment completion; genuine manual export at minute3498.",
    controlled: false,
    focus: "mio",
    fragments: ["小鳥の木彫り", "木彫りの花", "まだ手元にある"],
  },
  {
    name: "controlled-idle-local-workbench",
    fixture: "tests/fixtures/scene-caption-idle-table-v3.json",
    sha256: "cbb1e2398d2f3c6613b6ad2951b93ae3a9154c0fa16992b5033101dfb9606205",
    provenance:
      "Controlled valid input: createGame, companion rest policies, Aki project crafting-tools and positive advance only; no field edits. Stage4B boundaries/prepare.ts completed-workbench-home.",
    controlled: true,
    focus: "aki",
    fragments: ["手仕事台あり"],
  },
  {
    name: "subject-action-long-status",
    fixture: "tests/fixtures/scene-caption-subject-held-v3.json",
    sha256: "1d347496ca1f6d85d907ab3201113c9235a44924f35f2ece9a39cba3c6c08f0a",
    provenance:
      "Actual UI manual export at minute601, after a public-command controlled setup with real observation and completed workbench. Stage4B boundary subject-and-tools-held-five; no save-field edits.",
    controlled: true,
    focus: "aki",
    fragments: ["アキ：木陰の迂回路を題材に小鳥を彫る"],
  },
];
const inputs = [],
  checks = [],
  operations = [],
  selections = [],
  persistence = [],
  audits = [],
  captures = [],
  navigationReachability = [],
  errors = [],
  requests = [];
const browser = await chromium.launch({
  executablePath: process.env.CHROMIUM_PATH || "/usr/bin/chromium",
  headless: true,
  args: ["--no-sandbox"],
});
let page, scenario;
const state = () =>
  page.evaluate(() =>
    JSON.parse(
      localStorage.getItem("yohaku-autosave-v1") ||
        localStorage.getItem("yohaku-save-v1"),
    ),
  );
const person = (s, id = "aki") =>
  s.residents.find((resident) => resident.id === id);
const withoutSlots = (s) => ({
  ...s,
  residents: s.residents.map(({ action, suspended, ...resident }) => resident),
});
const card = (id) =>
  page.locator(`.residents-list .resident-card[aria-label^="${names[id]}を"]`);
async function dismiss() {
  const close = page.getByRole("button", { name: "通知を閉じる", exact: true });
  if (await close.isVisible()) await close.click();
}
async function selectOne(id) {
  await dismiss();
  const before = await state();
  let clicks = 0;
  for (const candidate of Object.keys(names)) {
    if (
      ((await card(candidate).getAttribute("aria-pressed")) === "true") !==
      (candidate === id)
    ) {
      await card(candidate).click();
      clicks++;
    }
  }
  if (!(await card(id).getAttribute("class")).includes("viewing")) {
    await card(id).click();
    await card(id).click();
    clicks += 2;
  }
  for (const candidate of Object.keys(names))
    assert.equal(
      await card(candidate).getAttribute("aria-pressed"),
      String(candidate === id),
    );
  assert.deepEqual(
    await state(),
    before,
    "Roster and focus changes must preserve the whole world",
  );
  selections.push({
    scenario,
    selected: id,
    clicks,
    minutes: before.minutes,
    wholeWorldUnchanged: true,
  });
}
async function openWorld(name, fixtureCase) {
  scenario = name;
  const context = await browser.newContext({
    viewport: { width: 390, height: 844 },
    offline: true,
    acceptDownloads: true,
  });
  await context.route("**/*", (route) => {
    const url = route.request().url();
    requests.push({ scenario: name, url });
    return url === ENTRY_URL
      ? route.fulfill({ contentType: "text/html", body: html })
      : route.abort();
  });
  page = await context.newPage();
  page.on("pageerror", (error) =>
    errors.push({ scenario: name, type: "pageerror", message: error.message }),
  );
  page.on("console", (message) => {
    if (message.type() === "error")
      errors.push({ scenario: name, type: "console", message: message.text() });
  });
  await page.goto(ENTRY_URL);
  await expect(page.locator(".header .time")).toHaveText("08:00");
  if (fixtureCase) {
    const raw = await readFile(resolve(fixtureCase.fixture), "utf8");
    assert.equal(
      digest(raw),
      fixtureCase.sha256,
      "Portable fixture must remain the exact original export",
    );
    const expected = JSON.parse(raw);
    await page.locator(".save-button").click();
    await page.locator("input[type=file]").setInputFiles({
      name: fixtureCase.fixture.split("/").at(-1),
      mimeType: "application/json",
      buffer: Buffer.from(raw),
    });
    await expect(page.getByRole("dialog")).not.toBeVisible();
    assert.deepEqual(await state(), expected);
    inputs.push({
      ...fixtureCase,
      minutes: expected.minutes,
      inputWorldSha256: digest(JSON.stringify(expected)),
    });
  } else {
    // A fresh tab has no autosave. Persist through the real save UI so every
    // later layout/focus assertion can read the same complete initial world.
    await page.locator(".save-button").click();
    await page
      .getByRole("button", { name: "いまの暮らしを保存する", exact: true })
      .click();
    await page.keyboard.press("Escape");
    const saved = await state();
    assert.equal(saved.minutes, 480);
    assert.deepEqual(saved.resources, {
      food: 6,
      ingredients: 8,
      medicine: 3,
      scrap: 4,
    });
    persistence.push({
      scenario,
      kind: "fresh-initial-baseline-manual-save",
      minutes: saved.minutes,
      worldSha256: digest(JSON.stringify(saved)),
      world: saved,
    });
    inputs.push({
      name,
      controlled: false,
      provenance:
        "Unmodified fresh initial morning, persisted only through the actual save UI.",
      minutes: saved.minutes,
    });
  }
  await dismiss();
  return context;
}
async function operation(label, fn) {
  await dismiss();
  const before = await state();
  await fn();
  const after = await state();
  operations.push({
    scenario,
    label,
    beforeMinutes: before.minutes,
    afterMinutes: after.minutes,
    world: after,
  });
  return { before, after };
}
async function captureCase(fragments, hasTable) {
  const before = await state();
  for (const width of [320, 390, 430, 1280]) {
    const height = width < 768 ? 844 : 800;
    await page.setViewportSize({ width, height });
    await dismiss();
    await page.evaluate(() => scrollTo(0, 0));
    const caption = page.locator(".home-overview .scene-weather");
    for (const fragment of fragments)
      await expect(caption).toContainText(fragment);
    await expect(
      page.locator('.home-overview [data-detail="local-crafting-tools"]'),
    ).toHaveCount(hasTable ? 1 : 0);
    const geometry = await page.evaluate(() => {
      const rect = (element) => {
        const r = element.getBoundingClientRect();
        return {
          left: r.left,
          right: r.right,
          top: r.top,
          bottom: r.bottom,
          width: r.width,
          height: r.height,
        };
      };
      const svg = document.querySelector(".home-overview .landscape"),
        caption = document.querySelector(".home-overview .scene-weather"),
        resources = document.querySelector(".home-resource-summary"),
        nav =
          document.querySelector(".nav-tabs") || document.querySelector("nav"),
        first = document.querySelector(".action-grid .action-card"),
        timebar = document.querySelector(".time-bar"),
        bench = svg.querySelector('[data-detail="local-crafting-tools"]');
      const range = document.createRange();
      range.selectNodeContents(caption);
      const style = getComputedStyle(caption),
        captionRect = rect(caption);
      return {
        client: document.documentElement.clientWidth,
        scroll: document.documentElement.scrollWidth,
        navClient: nav.clientHeight,
        navScroll: nav.scrollHeight,
        nav: rect(nav),
        scrollY,
        svg: rect(svg),
        caption: captionRect,
        resource: rect(resources),
        firstAction: rect(first),
        timebar: rect(timebar),
        captionText: caption.textContent,
        fullDescription: svg.querySelector("desc").textContent,
        captionClientWidth: caption.clientWidth,
        captionScrollWidth: caption.scrollWidth,
        captionClientHeight: caption.clientHeight,
        captionScrollHeight: caption.scrollHeight,
        captionLineClamp: style.webkitLineClamp,
        textLines: [...range.getClientRects()].map((r) => ({
          left: r.left,
          right: r.right,
          top: r.top,
          bottom: r.bottom,
        })),
        bench: bench ? rect(bench) : null,
        overlapArea: bench
          ? (() => {
              const b = rect(bench);
              return (
                Math.max(
                  0,
                  Math.min(b.right, captionRect.right) -
                    Math.max(b.left, captionRect.left),
                ) *
                Math.max(
                  0,
                  Math.min(b.bottom, captionRect.bottom) -
                    Math.max(b.top, captionRect.top),
                )
              );
            })()
          : 0,
      };
    });
    assert.equal(geometry.scrollY, 0);
    assert(
      geometry.scroll <= geometry.client + 1,
      "No horizontal page overflow",
    );
    assert(
      geometry.navScroll <= geometry.navClient + 1,
      "Tabs must not scroll vertically",
    );
    assert(
      geometry.svg.bottom <= geometry.caption.top + 0.5,
      "The complete picture must precede the caption",
    );
    assert(
      geometry.caption.bottom <= geometry.resource.top + 0.5,
      "The caption must precede the resource summary",
    );
    assert.equal(
      geometry.overlapArea,
      0,
      "The local table must not be hidden behind the caption",
    );
    assert(geometry.captionScrollWidth <= geometry.captionClientWidth + 1);
    assert(geometry.captionScrollHeight <= geometry.captionClientHeight + 1);
    assert(geometry.textLines.length > 0);
    for (const line of geometry.textLines) {
      assert(
        line.left >= geometry.caption.left - 1 &&
          line.right <= geometry.caption.right + 1,
        "All caption text must fit horizontally",
      );
      assert(
        line.top >= geometry.caption.top - 1 &&
          line.bottom <= geometry.caption.bottom + 1,
        "All caption text must fit vertically",
      );
    }
    assert(
      geometry.caption.top >= 0 &&
        geometry.caption.bottom <= geometry.timebar.top + 0.5,
      "The full caption must be visible above the time controls",
    );
    if (scenario === "fresh-initial-morning" && width === 1280)
      assert(
        geometry.firstAction.bottom <= geometry.timebar.top + 0.5,
        "The initial PC primary action must fit above the time controls",
      );
    if (hasTable) assert.match(geometry.fullDescription, /が整えた手仕事台/);
    assert.deepEqual(
      await state(),
      before,
      "All viewport and caption inspection must preserve the whole world",
    );
    audits.push({
      scenario,
      width,
      height,
      minutes: before.minutes,
      ...geometry,
      wholeWorldUnchanged: true,
    });
    const path = `${output}/${scenario}-${width}.png`;
    await page.screenshot({ path, fullPage: false });
    captures.push({ scenario, width, height, path });
    if (scenario === "subject-action-long-status" && width === 320) {
      const beforeWheel = await state();
      const wheelPixels = Math.max(
        0,
        geometry.nav.bottom - geometry.timebar.top + 16,
      );
      if (wheelPixels > 0) {
        await page.mouse.move(width / 2, height / 2);
        await page.mouse.wheel(0, wheelPixels);
        await expect
          .poll(async () =>
            page.evaluate(() => {
              const nav =
                document.querySelector(".nav-tabs") ||
                document.querySelector("nav");
              return (
                nav.getBoundingClientRect().bottom <=
                document.querySelector(".time-bar").getBoundingClientRect()
                  .top +
                  0.5
              );
            }),
          )
          .toBe(true);
      }
      const reached = await page.evaluate(() => {
        const nav =
            document.querySelector(".nav-tabs") ||
            document.querySelector("nav"),
          n = nav.getBoundingClientRect(),
          t = document.querySelector(".time-bar").getBoundingClientRect();
        return {
          navTop: n.top,
          navBottom: n.bottom,
          footerTop: t.top,
          navClient: nav.clientHeight,
          navScroll: nav.scrollHeight,
          pageScrollY: scrollY,
        };
      });
      assert(
        reached.navTop >= 0 && reached.navBottom <= reached.footerTop + 0.5,
        "A real page wheel must make every navigation tab reachable above the footer",
      );
      assert(reached.navScroll <= reached.navClient + 1);
      assert.deepEqual(await state(), beforeWheel);
      assert.deepEqual(await state(), before);
      navigationReachability.push({
        scenario,
        width,
        height,
        wheelPixels,
        ...reached,
        wholeWorldUnchanged: true,
      });
      const reachedPath = `${output}/${scenario}-${width}-navigation-reached.png`;
      await page.screenshot({ path: reachedPath, fullPage: false });
      captures.push({
        scenario,
        width,
        height,
        kind: "navigation-reachability-supplement",
        path: reachedPath,
      });
    }
  }
  checks.push({
    scenario,
    kind: "four-width-complete-picture-caption-resources",
    viewports: [320, 390, 430, 1280],
    wholeWorldUnchanged: true,
  });
}
async function saveExportReload(name) {
  await dismiss();
  const before = await state();
  await page.locator(".save-button").click();
  await page
    .getByRole("button", { name: "いまの暮らしを保存する", exact: true })
    .click();
  const pending = page.waitForEvent("download");
  await page
    .getByRole("button", { name: "ファイルに書き出す", exact: true })
    .click();
  const download = await pending,
    raw = await readFile(await download.path(), "utf8");
  assert.deepEqual(JSON.parse(raw), before);
  await writeFile(`${output}/${name}.json`, raw);
  await page.keyboard.press("Escape");
  await page.reload();
  await expect(page.locator(".suspended-work")).toBeVisible();
  assert.deepEqual(await state(), before);
  persistence.push({
    scenario,
    kind: "actual-manual-save-export-reload",
    name,
    minutes: before.minutes,
    sha256: digest(raw),
    path: `${output}/${name}.json`,
    wholeWorldUnchanged: true,
  });
}

try {
  let context = await openWorld("fresh-initial-morning");
  await captureCase(["朝の光"], false);
  await context.close();
  for (const fixtureCase of fixtureCases) {
    context = await openWorld(fixtureCase.name, fixtureCase);
    await selectOne(fixtureCase.focus);
    if (fixtureCase.name === "subject-action-long-status") {
      const before = await state(),
        held = person(before).suspended;
      assert.equal(held.id, 14);
      assert.equal(held.progress, 5);
      assert.equal(held.duration, 34);
      assert.equal(held.subjectEventId, 6);
      assert.equal(held.craftingToolsId, 11);
      const { after } = await operation(
        "題材付きの保持仕事を時計0で実再開",
        () =>
          page
            .locator(".suspended-work")
            .getByRole("button", { name: "再開する", exact: true })
            .click(),
      );
      assert.deepEqual(withoutSlots(after), withoutSlots(before));
      assert.deepEqual(person(after).action, held);
      assert.equal(person(after).suspended, null);
      for (const id of ["mio", "ren"])
        assert.deepEqual(person(after, id), person(before, id));
      await expect(
        page.locator(".running-work .crafting-tools-note"),
      ).toHaveText("開始時の手仕事台を反映");
    }
    await captureCase(fixtureCase.fragments, true);
    if (fixtureCase.name === "subject-action-long-status") {
      let result = await operation("再開した題材付き仕事を実5分進める", () =>
        page.getByRole("button", { name: "5分", exact: true }).click(),
      );
      assert.equal(result.after.minutes, result.before.minutes + 5);
      assert.equal(person(result.after).action.progress, 10);
      assert.equal(person(result.after).action.id, 14);
      assert.equal(person(result.after).action.subjectEventId, 6);
      assert.equal(person(result.after).action.craftingToolsId, 11);
      assert.deepEqual(
        person(result.after).action,
        { ...person(result.before).action, progress: 10 },
        "Five real minutes must preserve the complete action duration, label, subject, tool and reservation fields",
      );
      result = await operation("同じ仕事を実中断して出所を保持", () =>
        page
          .locator(".running-work")
          .getByRole("button", { name: "中断", exact: true })
          .click(),
      );
      assert.deepEqual(withoutSlots(result.after), withoutSlots(result.before));
      assert.deepEqual(
        person(result.after).suspended,
        person(result.before).action,
      );
      assert.equal(person(result.after).action, null);
      for (const id of ["mio", "ren"])
        assert.deepEqual(person(result.after, id), person(result.before, id));
      await saveExportReload("actual-subject-held-ten-minutes");
      await expect(
        page.locator(".suspended-work .crafting-tools-note"),
      ).toHaveText("開始時の手仕事台を反映");
      checks.push({
        scenario,
        kind: "actual-resume-five-minutes-pause-save-export-reload",
        jobId: 14,
        duration: person(await state()).suspended.duration,
        progress: person(await state()).suspended.progress,
        subjectEventId: person(await state()).suspended.subjectEventId,
        craftingToolsId: person(await state()).suspended.craftingToolsId,
      });
    }
    await context.close();
  }
  assert.deepEqual(errors, []);
  assert(requests.every((request) => request.url === ENTRY_URL));
  await writeFile(
    `${output}/report.json`,
    JSON.stringify(
      {
        status: "passed",
        sha256,
        bytes: Buffer.byteLength(html),
        runnerSha256: digest(runner),
        method:
          "Four actual offline UI cases and sixteen viewports. Fresh initial state and genuine lived save are distinguished from explicitly controlled-origin inputs. No engine API, save-field edits or direct browser-storage writes.",
        inputs,
        checks,
        operations,
        selections,
        persistence,
        audits,
        captures,
        navigationReachability,
        errors,
        requests,
      },
      null,
      2,
    ),
  );
  console.log(
    JSON.stringify({
      status: "passed",
      checks: checks.length,
      operations: operations.length,
      exportsAndReloads: persistence.filter(
        (entry) => entry.kind === "actual-manual-save-export-reload",
      ).length,
      audits: audits.length,
      screenshots: captures.length,
      sha256,
      output,
    }),
  );
} catch (error) {
  if (page && !page.isClosed())
    await page
      .screenshot({ path: `${output}/failure.png`, fullPage: true })
      .catch(() => {});
  await writeFile(
    `${output}/failure.json`,
    JSON.stringify(
      {
        error: String(error),
        stack: error.stack,
        scenario,
        sha256,
        inputs,
        checks,
        operations,
        selections,
        persistence,
        audits,
        captures,
        navigationReachability,
        errors,
        state: page && !page.isClosed() ? await state() : undefined,
      },
      null,
      2,
    ),
  );
  throw error;
} finally {
  await browser.close();
}
