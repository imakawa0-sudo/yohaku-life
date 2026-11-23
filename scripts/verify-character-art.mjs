// Exercise character artwork through the distributed single-file game's UI.
// Game changes use normal controls only; canvas and saved state are read-only.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { chromium, expect } from "@playwright/test";

const htmlPath = resolve(process.env.REFORM_HTML || "dist/yohaku.html");
const html = await readFile(htmlPath, "utf8");
const output = resolve(
  process.env.PLAYTEST_OUTPUT || "/tmp/yohaku-character-art-playtest",
);
const compatibilityPath =
  process.env.CHARACTER_ART_COMPAT_SAVE || "public/woodworkers-morning.json";
const url = "http://character-art.offline.test/";
const saveKey = "yohaku-reform-library-v1";
const legacyKeys = ["yohaku-save-v1", "yohaku-autosave-v1"];
const legacyValues = ["legacy-manual-sentinel", "legacy-auto-sentinel"];
const pageErrors = [];
const unexpectedRequests = [];
const report = {
  htmlPath,
  sha256: createHash("sha256").update(html).digest("hex"),
  browser: "Chromium, isolated offline contexts; desktop viewport emulation",
  checks: [],
  fieldCoverage: [],
  renderCollisions: [],
  appearances: [],
  screenshots: [],
  saveChecks: [],
  priorSaveCompatibility: {
    fixture: resolve(compatibilityPath),
    source: process.env.CHARACTER_ART_COMPAT_SAVE
      ? "explicit fixture"
      : "existing repository public/woodworkers-morning.json",
    status: "pending",
  },
};

// Independent UI contract: all ten controls and their original forty-one values.
const fields = [
  {
    key: "face",
    label: "顔の輪郭",
    choices: { oval: "面長", round: "丸顔", angular: "角張った輪郭" },
  },
  {
    key: "skin",
    label: "肌の色",
    choices: {
      ivory: "淡い杏色",
      peach: "桃色がかった肌",
      wheat: "小麦色",
      bronze: "赤褐色",
      umber: "深い褐色",
    },
  },
  {
    key: "hair",
    label: "髪形",
    choices: {
      crop: "短髪",
      bob: "おかっぱ",
      wave: "長い髪",
      knot: "まとめ髪",
      braid: "三つ編み",
    },
  },
  {
    key: "hairColor",
    label: "髪色",
    choices: {
      ink: "墨黒",
      chestnut: "栗色",
      ash: "灰褐色",
      honey: "亜麻色",
      silver: "白銀",
    },
  },
  {
    key: "age",
    label: "年代",
    choices: { young: "若年", adult: "壮年", elder: "老年" },
  },
  {
    key: "build",
    label: "体格",
    choices: { slight: "細身", medium: "中肉", broad: "がっしり" },
  },
  {
    key: "eyes",
    label: "目元",
    choices: { soft: "柔らかな目", straight: "切れ長の目", open: "丸い目" },
  },
  {
    key: "mark",
    label: "顔の特徴",
    choices: {
      none: "なし",
      freckles: "そばかす",
      scar: "頬の傷",
      glasses: "丸眼鏡",
    },
  },
  {
    key: "clothing",
    label: "服装",
    choices: {
      shirt: "襟つきシャツ",
      apron: "仕事着と前掛け",
      wrap: "巻き襟の上着",
      coat: "旅の外套",
    },
  },
  {
    key: "dye",
    label: "服の色",
    choices: {
      moss: "苔色",
      indigo: "藍色",
      brick: "弁柄色",
      rust: "黄土色",
      plum: "葡萄色",
      flax: "生成り",
    },
  },
];
const baseAppearance = {
  face: "oval",
  skin: "ivory",
  hair: "crop",
  hairColor: "ink",
  age: "young",
  build: "medium",
  eyes: "soft",
  mark: "none",
  clothing: "shirt",
  dye: "moss",
};
const compositeAppearance = {
  face: "angular",
  skin: "umber",
  hair: "braid",
  hairColor: "silver",
  age: "elder",
  build: "broad",
  eyes: "straight",
  mark: "scar",
  clothing: "coat",
  dye: "flax",
};
const recycledAppearance = {
  face: "round",
  skin: "wheat",
  hair: "bob",
  hairColor: "honey",
  age: "adult",
  build: "slight",
  eyes: "open",
  mark: "freckles",
  clothing: "apron",
  dye: "plum",
};
const button = (scope, name) =>
  scope.getByRole("button", { name, exact: true });
const editorPortrait = (page) =>
  page.locator(".yp-sheet .yp-cover canvas.yp-portrait");
const editorStanding = (page) =>
  page.locator(".yp-sheet .yp-standing-preview canvas.yp-full-length");
const editorResidents = (page) =>
  page.locator(".yp-roster > button:not(.yp-add)");

function record(message) {
  report.checks.push(message);
  console.log("✓ " + message);
}

async function paint(page) {
  await page.evaluate(
    () =>
      new Promise((done) =>
        requestAnimationFrame(() => requestAnimationFrame(done)),
      ),
  );
}

async function fresh(width, browser) {
  const context = await browser.newContext({
    offline: true,
    viewport: { width, height: width < 600 ? 844 : 900 },
    acceptDownloads: true,
  });
  await context.route("**/*", async (route) => {
    if (route.request().url() === url) {
      await route.fulfill({
        contentType: "text/html; charset=utf-8",
        body: html,
      });
    } else {
      unexpectedRequests.push(route.request().url());
      await route.abort();
    }
  });
  await context.addInitScript(
    ({ keys, values }) => {
      if (sessionStorage.getItem("character-art-check-init")) return;
      keys.forEach((key, index) => localStorage.setItem(key, values[index]));
      sessionStorage.setItem("character-art-check-init", "1");
    },
    { keys: legacyKeys, values: legacyValues },
  );
  const page = await context.newPage();
  page.setDefaultTimeout(10000);
  page.on("pageerror", (error) => pageErrors.push(error.message));
  page.on("console", (message) => {
    if (message.type() === "error") pageErrors.push(message.text());
  });
  await page.goto(url);
  await expect(
    page.getByRole("heading", { name: "暮らしを始める", exact: true }),
  ).toBeVisible();
  return page;
}

async function withPage(browser, width, label, run) {
  const page = await fresh(width, browser);
  try {
    return await run(page);
  } catch (error) {
    report.failure = {
      stage: label,
      message: error instanceof Error ? error.message : String(error),
    };
    await page
      .screenshot({
        path: resolve(output, label + "-failure.png"),
        animations: "disabled",
      })
      .catch(() => {});
    console.error(
      (
        await page
          .locator("body")
          .innerText()
          .catch(() => "")
      ).slice(0, 7000),
    );
    throw error;
  } finally {
    await page.context().close();
  }
}

async function openDetails(page) {
  const details = page.locator("details.yp-customize");
  await expect(details.locator("summary")).toBeVisible();
  if (!(await details.evaluate((element) => element.open)))
    await details.locator("summary").click();
  await expect(editorStanding(page)).toBeVisible();
}

async function chooseResident(page, index) {
  await editorResidents(page).nth(index).click();
  await openDetails(page);
  await paint(page);
}

async function appearanceValues(page) {
  return page.evaluate(
    (descriptors) => {
      return Object.fromEntries(
        descriptors.map(({ key, label }) => {
          const select = [...document.querySelectorAll("select")].find(
            (element) => element.getAttribute("aria-label") === label,
          );
          if (!select) throw new Error("Missing appearance control: " + label);
          return [key, select.value];
        }),
      );
    },
    fields.map(({ key, label }) => ({ key, label })),
  );
}

async function setAppearance(page, appearance) {
  for (const field of fields)
    await page
      .getByLabel(field.label, { exact: true })
      .selectOption(appearance[field.key]);
  assert.deepEqual(await appearanceValues(page), appearance);
  await paint(page);
}

async function rename(page, name) {
  const input = page.getByRole("textbox", { name: "名前", exact: true });
  await input.fill(name);
  await input.press("Tab");
  await expect(input).toHaveValue(name);
  await paint(page);
}

async function canvasDigest(locator, description) {
  await expect(locator).toBeVisible();
  const data = await locator.evaluate((canvas) => {
    if (!(canvas instanceof HTMLCanvasElement))
      throw new Error("The artwork is not a canvas");
    const context = canvas.getContext("2d");
    if (!context) throw new Error("2D canvas context is unavailable");
    const pixels = context.getImageData(0, 0, canvas.width, canvas.height).data;
    let painted = 0;
    const colors = new Set();
    for (let index = 0; index < pixels.length; index += 4) {
      if (pixels[index + 3] < 16) continue;
      painted++;
      colors.add(
        pixels[index] +
          "," +
          pixels[index + 1] +
          "," +
          pixels[index + 2] +
          "," +
          pixels[index + 3],
      );
    }
    return {
      width: canvas.width,
      height: canvas.height,
      paintedPixels: painted,
      colors: colors.size,
      personId: canvas.getAttribute("data-person"),
      png: canvas.toDataURL("image/png"),
    };
  });
  assert.ok(
    data.width > 0 && data.height > 0,
    description + ": canvas has a size",
  );
  assert.ok(
    typeof data.personId === "string" && data.personId.length > 0,
    description + ": canvas identifies its resident",
  );
  assert.ok(
    data.paintedPixels > 50,
    description + ": visible artwork is present",
  );
  assert.ok(
    data.colors > 8,
    description + ": artwork is not just a blank backdrop",
  );
  const { png, ...metadata } = data;
  return {
    ...metadata,
    hash: createHash("sha256").update(png).digest("hex"),
  };
}

async function editorArt(page) {
  await paint(page);
  const [portrait, standing] = await Promise.all([
    canvasDigest(editorPortrait(page), "editor portrait"),
    canvasDigest(editorStanding(page), "editor full-length"),
  ]);
  assert.equal(portrait.personId, standing.personId);
  return { portrait, standing };
}

function hashes(art) {
  return { portrait: art.portrait.hash, standing: art.standing.hash };
}

function sameArt(actual, expected, message) {
  assert.deepEqual(hashes(actual), hashes(expected), message);
}

function differentArt(actual, expected, message) {
  assert.notEqual(
    actual.portrait.hash,
    expected.portrait.hash,
    message + ": portrait",
  );
  assert.notEqual(
    actual.standing.hash,
    expected.standing.hash,
    message + ": full-length",
  );
}

async function catalogue(page) {
  assert.equal(fields.length, 10);
  assert.equal(
    fields.reduce(
      (count, field) => count + Object.keys(field.choices).length,
      0,
    ),
    41,
  );
  for (const field of fields) {
    const select = page.getByLabel(field.label, { exact: true });
    await expect(select).toBeEnabled();
    const options = await select.locator("option").evaluateAll((elements) =>
      elements.map((element) => ({
        value: element.value,
        label: element.textContent,
        disabled: element.disabled,
      })),
    );
    assert.deepEqual(
      options,
      Object.entries(field.choices).map(([value, label]) => ({
        value,
        label,
        disabled: false,
      })),
      field.label + ": original choices remain available",
    );
  }
}

function uniqueVariants(results, field, kind) {
  const owners = new Map();
  for (const result of results) {
    const previous = owners.get(result[kind].hash);
    if (previous !== undefined)
      report.renderCollisions.push({
        field: field.key,
        label: field.label,
        drawing: kind,
        values: [previous, result.value],
        hash: result[kind].hash,
      });
    owners.set(result[kind].hash, result.value);
  }
  return owners.size;
}

async function allAppearanceChoices(page) {
  await catalogue(page);
  await setAppearance(page, baseAppearance);
  const baseArt = await editorArt(page);
  let checked = 0;
  for (const field of fields) {
    const variants = [];
    for (const value of Object.keys(field.choices)) {
      await page.getByLabel(field.label, { exact: true }).selectOption(value);
      assert.deepEqual(
        await appearanceValues(page),
        { ...baseAppearance, [field.key]: value },
        field.label +
          "=" +
          value +
          ": the other nine appearance values must stay unchanged",
      );
      const art = await editorArt(page);
      variants.push({ value, ...art });
      checked++;
    }
    const portraitDistinct = uniqueVariants(variants, field, "portrait");
    const standingDistinct = uniqueVariants(variants, field, "standing");
    await page
      .getByLabel(field.label, { exact: true })
      .selectOption(baseAppearance[field.key]);
    sameArt(
      await editorArt(page),
      baseArt,
      field.label + ": restoring the value restores the artwork",
    );
    report.fieldCoverage.push({
      field: field.key,
      label: field.label,
      variants,
      portraitDistinct,
      standingDistinct,
    });
    if (
      portraitDistinct === variants.length &&
      standingDistinct === variants.length
    )
      record(
        field.label +
          "の全" +
          variants.length +
          "選択肢を胸像・全身の画素で区別し、他9項目を保持。",
      );
  }
  assert.equal(checked, 41);
  assert.deepEqual(
    report.renderCollisions,
    [],
    "Every choice must produce distinct portrait AND full-length pixels within its field",
  );
  return baseArt;
}

async function identityAndLocks(page, baseArt) {
  await setAppearance(page, compositeAppearance);
  const compositeArt = await editorArt(page);
  differentArt(
    compositeArt,
    baseArt,
    "Unlisted composite appearance must remain drawable",
  );
  await rename(page, "朝凪");
  sameArt(
    await editorArt(page),
    compositeArt,
    "Renaming does not change either drawing",
  );

  await chooseResident(page, 1);
  const secondAppearance = await appearanceValues(page);
  const secondArt = await editorArt(page);
  await rename(page, "朝凪");
  sameArt(
    await editorArt(page),
    secondArt,
    "Giving another person the same name does not replace their appearance",
  );
  differentArt(
    secondArt,
    compositeArt,
    "Equal names with different appearances remain distinct",
  );
  for (let cycle = 0; cycle < 2; cycle++) {
    await chooseResident(page, 0);
    assert.deepEqual(await appearanceValues(page), compositeAppearance);
    sameArt(
      await editorArt(page),
      compositeArt,
      "Switching back preserves the first person's artwork",
    );
    await chooseResident(page, 1);
    assert.deepEqual(await appearanceValues(page), secondAppearance);
    sameArt(
      await editorArt(page),
      secondArt,
      "Switching back preserves the second person's artwork",
    );
  }
  await setAppearance(page, baseAppearance);
  sameArt(
    await editorArt(page),
    baseArt,
    "Equal appearances render alike for a different person ID",
  );
  await setAppearance(page, secondAppearance);
  await rename(page, "スイ");
  sameArt(
    await editorArt(page),
    secondArt,
    "Restoring the second person's appearance restores the drawing",
  );

  await button(page, "住人を追加").click();
  await openDetails(page);
  await setAppearance(page, recycledAppearance);
  await rename(page, "識別用の住人");
  const removedArt = await editorArt(page);
  differentArt(
    removedArt,
    baseArt,
    "The temporary resident has a distinct appearance",
  );
  const removedId = removedArt.portrait.personId;
  await page.locator(".yp-sheet .yp-remove").click();
  await button(page, "住人を追加").click();
  await openDetails(page);
  await setAppearance(page, baseAppearance);
  const replacementArt = await editorArt(page);
  assert.equal(
    replacementArt.portrait.personId,
    removedId,
    "The UI reuses the vacant person ID",
  );
  sameArt(
    replacementArt,
    baseArt,
    "Reusing an ID does not reuse the removed person's cached image",
  );
  await page.locator(".yp-sheet .yp-remove").click();
  await chooseResident(page, 0);
  assert.deepEqual(await appearanceValues(page), compositeAppearance);
  sameArt(
    await editorArt(page),
    compositeArt,
    "Adding and removing another resident leaves the first unchanged",
  );
  record(
    "任意の複合外見、改名・同名、人物切替、同じ外見の別ID、削除後のID再利用で描画の混線なし。",
  );

  await page.getByLabel("名前を固定", { exact: true }).check();
  await page.getByLabel("外見を固定", { exact: true }).check();
  for (let attempt = 0; attempt < 3; attempt++) {
    await button(page, "固定以外をおまかせ").click();
    await expect(
      page.getByRole("textbox", { name: "名前", exact: true }),
    ).toHaveValue("朝凪");
    assert.deepEqual(await appearanceValues(page), compositeAppearance);
    sameArt(
      await editorArt(page),
      compositeArt,
      "Locked appearance survives reroll " + (attempt + 1),
    );
  }
  await chooseResident(page, 1);
  await expect(
    page.getByLabel("外見を固定", { exact: true }),
  ).not.toBeChecked();
  assert.deepEqual(await appearanceValues(page), secondAppearance);
  sameArt(
    await editorArt(page),
    secondArt,
    "Rerolling the first resident leaves the second unchanged",
  );
  await chooseResident(page, 0);
  await expect(page.getByLabel("名前を固定", { exact: true })).toBeChecked();
  await expect(page.getByLabel("外見を固定", { exact: true })).toBeChecked();
  await page.getByLabel("性格・体質・好みを固定", { exact: true }).check();
  await page.getByLabel("経歴・技能を固定", { exact: true }).check();
  await expect(button(page, "固定以外をおまかせ")).toBeDisabled();
  await page.getByLabel("服の色", { exact: true }).selectOption("plum");
  assert.deepEqual(await appearanceValues(page), {
    ...compositeAppearance,
    dye: "plum",
  });
  differentArt(
    await editorArt(page),
    compositeArt,
    "A reroll lock still permits a manual appearance edit",
  );
  await page
    .getByLabel("服の色", { exact: true })
    .selectOption(compositeAppearance.dye);
  sameArt(
    await editorArt(page),
    compositeArt,
    "Restoring a manually edited locked value restores the image",
  );
  record(
    "名前と外見を固定した3回の再抽選、住人別の固定、4群固定時の無効化、固定中の手動編集を確認。",
  );
  report.appearances.push({
    scenario: "custom-household",
    residents: [
      { name: "朝凪", appearance: compositeAppearance, ...compositeArt },
      { name: "スイ", appearance: secondAppearance, ...secondArt },
    ],
  });
  return [
    { appearance: compositeAppearance, art: compositeArt, name: "朝凪" },
    { appearance: secondAppearance, art: secondArt, name: "スイ" },
  ];
}

async function checkLegacy(page) {
  const values = await page.evaluate(
    (keys) => keys.map((key) => localStorage.getItem(key)),
    legacyKeys,
  );
  assert.deepEqual(
    values,
    legacyValues,
    "Legacy public-53 saves remain untouched",
  );
}

async function library(page) {
  const data = await page.evaluate((key) => {
    const raw = localStorage.getItem(key);
    return raw === null ? null : JSON.parse(raw);
  }, saveKey);
  assert.ok(data, "The normal UI wrote a reform library");
  assert.equal(data.format, 1);
  assert.ok(Array.isArray(data.slots));
  assert.equal(
    JSON.stringify(data).includes("data:image/"),
    false,
    "Image data must not enter saved game state",
  );
  return data;
}

function activeSlot(data) {
  const slot = data.slots.find((entry) => entry.id === data.activeId);
  assert.ok(slot, "The active slot is present");
  return slot;
}

function resources(game) {
  return {
    time: game.time,
    wood: game.wood,
    food: game.food,
    ingredients: game.ingredients,
    coins: game.coins,
  };
}

async function tab(page, name) {
  await button(page, name)
    .or(page.getByRole("tab", { name, exact: true }))
    .first()
    .click();
  await paint(page);
}

async function screenshot(page, name, target) {
  if (target) await page.locator(target).scrollIntoViewIfNeeded();
  else await page.evaluate(() => window.scrollTo(0, 0));
  await paint(page);
  const bounds = await page.evaluate(() => ({
    width: innerWidth,
    height: innerHeight,
    content: document.documentElement.scrollWidth,
  }));
  assert.ok(
    bounds.content <= bounds.width + 1,
    name + ": horizontal overflow " + JSON.stringify(bounds),
  );
  await page.screenshot({
    path: resolve(output, name + ".png"),
    animations: "disabled",
  });
  report.screenshots.push({ name, ...bounds });
}

async function enter(page) {
  await button(page, "この朝を始める").click();
  await expect(button(page, "15分進める")).toBeVisible();
  await paint(page);
}

async function artworkInLife(page, expected) {
  await paint(page);
  const roster = page.getByRole("group", { name: "住民を選ぶ" });
  const saved = activeSlot(await library(page)).game;
  if (expected) assert.equal(saved.actors.length, expected.length);
  const observed = [];
  for (let index = 0; index < saved.actors.length; index++) {
    const actor = saved.actors[index];
    const entry = expected?.[index];
    if (entry) {
      assert.equal(actor.person.name, entry.name);
      assert.deepEqual(actor.person.appearance, entry.appearance);
    }
    assert.deepEqual(
      Object.keys(actor.person.appearance).sort(),
      fields.map((field) => field.key).sort(),
    );
    const portrait = await canvasDigest(
      roster.getByRole("button").nth(index).locator("canvas.yp-portrait"),
      "life roster portrait",
    );
    assert.equal(portrait.personId, actor.person.id);
    if (entry)
      assert.equal(
        portrait.hash,
        entry.art.portrait.hash,
        "The life roster preserves the expected appearance",
      );
    await roster.getByRole("button").nth(index).click();
    await paint(page);
    await expect(page.locator(".yp-scene")).toHaveAttribute(
      "data-person",
      actor.person.id,
    );
    const selectedFigure = page.locator(
      '.yp-scene canvas.yp-walker[data-person="' + actor.person.id + '"]',
    );
    const standing = await canvasDigest(
      selectedFigure,
      "life scene selected resident",
    );
    assert.equal(standing.personId, actor.person.id);
    if (entry)
      assert.equal(
        standing.hash,
        entry.art.standing.hash,
        "The scene preserves the expected full-length appearance",
      );
    observed.push({
      name: actor.person.name,
      appearance: actor.person.appearance,
      art: { portrait, standing },
    });
  }
  assert.deepEqual(
    activeSlot(await library(page)).game,
    saved,
    "Inspecting resident artwork does not change the game",
  );
  return observed;
}

async function inspectWithoutAdvancing(page, label) {
  const before = await library(page);
  const beforeGame = activeSlot(before).game;
  await tab(page, "地域");
  await tab(page, "住まい");
  await tab(page, "手帳");
  await tab(page, "暮らし");
  const after = await library(page);
  assert.deepEqual(
    after,
    before,
    "Browsing artwork and tabs must not write or advance the game",
  );
  report.saveChecks.push({ scenario: label, unchanged: resources(beforeGame) });
  record(
    label + "：人物・地域・住まい・手帳の閲覧で時刻・備蓄・保存状態は不変。",
  );
}

async function exportImportReload(page, expected) {
  const before = await library(page);
  const original = activeSlot(before);
  await tab(page, "手帳");
  const pending = page.waitForEvent("download");
  await button(page, "保存を書き出す").click();
  const download = await pending;
  const destination = resolve(output, "character-art-roundtrip-save.json");
  await download.saveAs(destination);
  const serialized = await readFile(destination, "utf8");
  const exported = JSON.parse(serialized);
  assert.equal(exported.type, "yohaku-reform-save");
  assert.equal(exported.version, 1);
  assert.deepEqual(exported.slot, original);
  await page.getByLabel("新版の保存ファイル", { exact: true }).setInputFiles({
    name: "character-art-roundtrip-save.json",
    mimeType: "application/json",
    buffer: Buffer.from(serialized),
  });
  await expect(button(page, "15分進める")).toBeVisible();
  await expect
    .poll(async () => (await library(page)).slots.length)
    .toBe(before.slots.length + 1);
  const imported = await library(page);
  const importedSlot = activeSlot(imported);
  assert.notEqual(
    importedSlot.id,
    original.id,
    "Import creates a separate slot",
  );
  assert.deepEqual(importedSlot.game, original.game);
  assert.deepEqual(importedSlot.origin, original.origin);
  assert.deepEqual(
    imported.slots.find((entry) => entry.id === original.id),
    original,
  );
  await artworkInLife(page, expected);
  await page.reload();
  await expect(button(page, "15分進める")).toBeVisible();
  assert.deepEqual(
    await library(page),
    imported,
    "Offline reload preserves all saved state",
  );
  await artworkInLife(page, expected);
  await tab(page, "手帳");
  await button(page, "同じ朝から分岐").click();
  await expect(button(page, "15分進める")).toBeVisible();
  const branched = await library(page);
  assert.equal(branched.slots.length, imported.slots.length + 1);
  assert.deepEqual(activeSlot(branched).game, original.origin);
  assert.deepEqual(activeSlot(branched).origin, original.origin);
  assert.deepEqual(
    branched.slots.find((entry) => entry.id === original.id),
    original,
  );
  await checkLegacy(page);
  report.saveChecks.push({
    scenario: "version-1 export/import/reload/origin-branch",
    type: exported.type,
    version: exported.version,
    gameAndOriginUnchanged: true,
    appearanceKeys: fields.map((field) => field.key),
    artworkCheckedAfterImportAndReload: true,
    branchScope:
      "Initial morning only; game equals origin. Advancing and origin selection are covered by verify-reform.mjs.",
  });
  record(
    "version1の書出し→別枠取込→オフライン再読込で外見・描画・game/origin・元枠を保持。未進行の開始時点からの分岐も一致。",
  );
}

async function desktop(browser) {
  return withPage(browser, 1280, "desktop", async (page) => {
    await button(page, "木工の二人").click();
    await openDetails(page);
    const baseArt = await allAppearanceChoices(page);
    const expected = await identityAndLocks(page, baseArt);
    await screenshot(page, "desktop-creator");
    await screenshot(page, "desktop-appearance", ".yp-appearance");
    await enter(page);
    const initial = activeSlot(await library(page));
    assert.equal(initial.game.time, 480);
    assert.deepEqual(initial.origin, initial.game);
    await artworkInLife(page, expected);
    await screenshot(page, "desktop-life");
    await inspectWithoutAdvancing(page, "1280px");
    await exportImportReload(page, expected);
    await artworkInLife(page, expected);
  });
}

async function mobile(browser, width) {
  return withPage(browser, width, "width-" + width, async (page) => {
    await button(page, "木工の二人").click();
    await openDetails(page);
    await catalogue(page);
    const expected = [];
    for (let index = 0; index < 2; index++) {
      await chooseResident(page, index);
      expected.push({
        name: await page
          .getByRole("textbox", { name: "名前", exact: true })
          .inputValue(),
        appearance: await appearanceValues(page),
        art: await editorArt(page),
      });
    }
    await chooseResident(page, 0);
    const first = expected[0];
    const changedEyes = first.appearance.eyes === "open" ? "straight" : "open";
    await page.getByLabel("目元", { exact: true }).selectOption(changedEyes);
    assert.deepEqual(await appearanceValues(page), {
      ...first.appearance,
      eyes: changedEyes,
    });
    differentArt(
      await editorArt(page),
      first.art,
      width + "px eye selection changes both drawings",
    );
    await page
      .getByLabel("目元", { exact: true })
      .selectOption(first.appearance.eyes);
    sameArt(
      await editorArt(page),
      first.art,
      width + "px restore original eyes",
    );
    await screenshot(page, "width-" + width + "-creator");
    await screenshot(page, "width-" + width + "-appearance", ".yp-appearance");
    await enter(page);
    await artworkInLife(page, expected);
    await screenshot(page, "width-" + width + "-life");
    await inspectWithoutAdvancing(page, width + "px");
    await checkLegacy(page);
    record(
      width +
        "pxで10項目の選択肢と目元の変更操作、胸像・全身、生活内の人物表示、横はみ出しなしを確認。",
    );
  });
}

async function priorSave(browser) {
  const serialized = await readFile(resolve(compatibilityPath), "utf8");
  const exported = JSON.parse(serialized);
  report.priorSaveCompatibility.sha256 = createHash("sha256")
    .update(serialized)
    .digest("hex");
  assert.equal(exported.type, "yohaku-reform-save");
  assert.equal(exported.version, 1);
  await withPage(browser, 390, "prior-save", async (page) => {
    await button(page, "保存を開く").click();
    await page.getByLabel("新版の保存ファイル", { exact: true }).setInputFiles({
      name: "prior-character-art-save.json",
      mimeType: "application/json",
      buffer: Buffer.from(serialized),
    });
    await expect(button(page, "15分進める")).toBeVisible();
    const saved = await library(page);
    assert.deepEqual(activeSlot(saved).game, exported.slot.game);
    assert.deepEqual(activeSlot(saved).origin, exported.slot.origin);
    const expected = await artworkInLife(page);
    await page.reload();
    await expect(button(page, "15分進める")).toBeVisible();
    assert.deepEqual(await library(page), saved);
    await artworkInLife(page, expected);
    await screenshot(page, "prior-save-life");
    await checkLegacy(page);
    report.priorSaveCompatibility.status = "passed";
    report.priorSaveCompatibility.gameAndOriginUnchanged = true;
    report.priorSaveCompatibility.artwork = expected.map((entry) => ({
      name: entry.name,
      appearance: entry.appearance,
      ...hashes(entry.art),
    }));
    record(
      "組込み前version1セーブを通常UIで読み込み、全住民の胸像・全身とgame/originが再読込後も一致。",
    );
  });
}

await mkdir(output, { recursive: true });
let browser;
try {
  browser = await chromium.launch({
    headless: true,
    executablePath: process.env.CHROMIUM_PATH || "/usr/bin/chromium",
    args: ["--no-sandbox"],
  });
  await desktop(browser);
  await mobile(browser, 390);
  await mobile(browser, 320);
  await priorSave(browser);
  assert.deepEqual(pageErrors, [], "No browser exceptions or console errors");
  assert.deepEqual(
    unexpectedRequests,
    [],
    "No requests outside the single-file HTML",
  );
  record(
    "単体HTMLの隔離オフライン実操作でブラウザエラー・外部通信は0件。旧53の保存キーを保持。",
  );
  report.status = "passed";
} catch (error) {
  report.status = "failed";
  report.error = error instanceof Error ? error.stack : String(error);
  throw error;
} finally {
  await writeFile(
    resolve(output, "result.json"),
    JSON.stringify({ ...report, pageErrors, unexpectedRequests }, null, 2) +
      "\n",
  );
  if (browser) await browser.close();
}
