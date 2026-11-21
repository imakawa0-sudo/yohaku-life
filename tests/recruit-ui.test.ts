import assert from "node:assert/strict";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import App, { ResidentRoutineControls } from "../src/App";
import { RegionPanel } from "../src/components/RegionPanel";
import { command, createGame, serialize } from "../src/game/engine";
import { ensureInventory } from "../src/game/inventory";
import { applyRegionInteraction } from "../src/game/region";
import { recruitCompanion } from "../src/game/recruitment";
import type { GameState } from "../src/game/types";

function villageGame(credited = false): GameState {
  const game = createGame(617);
  game.version = 3;
  game.minutes = 600;
  for (const person of game.residents) {
    person.action = null;
    person.suspended = null;
  }
  game.residents.find(person => person.id === "mio")!.location = "village";
  if (credited) {
    ensureInventory(game).packs.mio.food = 3;
    for (const choice of ["talk", "deliver"] as const)
      assert.equal(applyRegionInteraction(game, "mio", "village-guide", choice).error, undefined);
  }
  return game;
}

function renderRegion(game: GameState, selectedIds = ["mio"]) {
  const before = serialize(game);
  let calls = 0;
  const html = renderToStaticMarkup(createElement(RegionPanel, {
    game, focusedId: "mio", selectedIds, onCommand: () => { calls++; return true; },
  }));
  assert.equal(calls, 0, "previewing a regional action must not issue a command");
  assert.equal(serialize(game), before);
  return html;
}

function renderApp(game: GameState) {
  const raw = serialize(game);
  const previous = Object.getOwnPropertyDescriptor(globalThis, "localStorage");
  let writes = 0;
  Object.defineProperty(globalThis, "localStorage", {
    configurable: true,
    value: {
      getItem: (key: string) => key === "yohaku-autosave-v1" ? raw : null,
      setItem: () => { writes++; },
    },
  });
  try {
    const html = renderToStaticMarkup(createElement(App));
    assert.equal(writes, 0);
    assert.equal(serialize(game), raw);
    return html;
  } finally {
    if (previous) Object.defineProperty(globalThis, "localStorage", previous);
    else Reflect.deleteProperty(globalThis, "localStorage");
  }
}

test("Village conversations preview a question, then record only the conversation the resident chose", () => {
  const game = villageGame();
  const preview = renderRegion(game);
  assert.match(preview, /道を知る住民に、尾根と川沿いの道の違いを尋ねます/);
  assert.match(preview, /集落の商い手に、交換できる品と店の在庫を尋ねます/);
  assert.doesNotMatch(preview, /と聞いた|道順を覚えた/);
  const heard = command(game, { type: "region", residentId: "mio", npcId: "village-guide", choice: "talk" });
  assert.equal(heard.error, undefined);
  assert.match(heard.state.logs.at(-1)!.text, /ミオは.*道順を覚えた/);
  assert.match(renderRegion(heard.state), /この話はすでに聞いています/);
  assert.equal(heard.state.region?.talked["village-trader"].length, 0);
});

test("The optional invitation shows the selected resident's personal credit and missing requirement", () => {
  const html = renderRegion(villageGame());
  assert.match(html, /ミオへの信用 0 \/ 3/);
  assert.match(html, /disabled=""[^>]*>仲間に誘う（任意）/);
  assert.match(html, /誘う本人が道の話を聞き、食事3食を届けて信用3を得る必要があります/);
  assert.doesNotMatch(html, /<select/);
});

test("Credit belongs to the inviter and the shared selector must contain exactly one resident", () => {
  const game = villageGame(true);
  const ready = renderRegion(game);
  assert.match(ready, /ミオへの信用 3 \/ 3/);
  assert.match(ready, /<button>仲間に誘う（任意）/);
  const several = renderRegion(game, ["mio", "aki"]);
  assert.match(several, /disabled=""[^>]*>仲間に誘う（任意）/);
  assert.match(several, /誘う人を住民一覧で一人だけ選んでください/);
  const absent = renderRegion(game, ["aki"]);
  assert.match(absent, /アキへの信用 0 \/ 3/);
  assert.match(absent, /アキが近隣の集落にいる時に誘えます/);
});

test("A joined guide leaves the NPC window and appears in the same roster without being selected or focused", () => {
  const game = villageGame(true);
  assert.equal(recruitCompanion(game, "mio", "village-guide").error, undefined);
  const region = renderRegion(game);
  assert.match(region, /集落の商い手/);
  assert.doesNotMatch(region, /道を知る住民|仲間に誘う（任意）/);
  const html = renderApp(game);
  assert.match(html, /class="nav-count">4<\/span>/);
  assert.match(html, /residents-list residents-list-expanded/);
  assert.match(html, /aria-describedby="resident-vitals-village-guide resident-activity-village-guide"/);
  assert.match(html, /data-viewing="false" aria-pressed="false"[^>]*aria-label="ハルを選択する"/);
  assert.match(html, /data-viewing="true" aria-pressed="true"[^>]*aria-label="アキを選択から外す"/);
  assert.equal((html.match(/aria-label="行動する住民を選ぶ"/g) ?? []).length, 1);
  assert.doesNotMatch(html, /undefined/);
});

test("Routine settings use structured profiles, remain collapsed, and leave the protagonist manual", () => {
  const game = villageGame(true);
  assert.equal(recruitCompanion(game, "mio", "village-guide").error, undefined);
  const haru = game.residents.find(person => person.id === "village-guide")!;
  haru.routine = { workRole: "gather", home: "garden", leisure: "social" };
  const before = serialize(game);
  let calls = 0;
  const html = renderToStaticMarkup(createElement(ResidentRoutineControls, {
    resident: haru, onCommand: () => { calls++; return true; },
  }));
  assert.match(html, /<details class="resident-routine">/);
  assert.match(html, /暮らしの担当/);
  assert.match(html, /value="gather" selected=""/);
  assert.match(html, /value="garden" selected=""/);
  assert.match(html, /value="social" selected=""/);
  assert.match(html, /ハルの仕事の担当/);
  assert.match(html, /変更だけでは時計や途中の仕事は動きません/);
  const manual = renderToStaticMarkup(createElement(ResidentRoutineControls, {
    resident: game.residents[0], onCommand: () => { calls++; return true; },
  }));
  assert.match(manual, /あなたが直接操作する人/);
  assert.doesNotMatch(manual, /<select/);
  assert.equal(calls, 0);
  assert.equal(serialize(game), before);
});
