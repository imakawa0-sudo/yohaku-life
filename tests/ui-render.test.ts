import assert from "node:assert/strict";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import App from "../src/App";
import { advance, command, createGame, serialize } from "../src/game/engine";
import type { GameState } from "../src/game/types";

function renderSavedGame(game: GameState) {
  const raw = serialize(game);
  const previous = Object.getOwnPropertyDescriptor(globalThis, "localStorage");
  const reads: string[] = [];
  let writes = 0;
  Object.defineProperty(globalThis, "localStorage", {
    configurable: true,
    value: {
      getItem(key: string) {
        reads.push(key);
        return key === "yohaku-autosave-v1" ? raw : null;
      },
      setItem() {
        writes++;
      },
    },
  });
  try {
    const html = renderToStaticMarkup(createElement(App));
    assert.equal(
      writes,
      0,
      "reading and rendering the game must not autosave or advance it",
    );
    assert.equal(serialize(game), raw);
    assert.ok(reads.includes("yohaku-autosave-v1"));
    return html;
  } finally {
    if (previous) Object.defineProperty(globalThis, "localStorage", previous);
    else Reflect.deleteProperty(globalThis, "localStorage");
  }
}

test("The game renders one shared resident selector, all vital labels, and usable scene/action context", () => {
  const html = renderSavedGame(createGame());
  assert.equal(
    (html.match(/aria-label="行動する住民を選ぶ"/g) ?? []).length,
    1,
  );
  for (const id of ["aki", "mio", "ren"]) {
    assert.match(html, new RegExp(`aria-describedby="resident-vitals-${id} resident-activity-${id}"`));
    assert.match(html, new RegExp(`id="resident-vitals-${id}"`));
    assert.match(html, new RegExp(`id="resident-activity-${id}"`));
  }
  assert.match(html, /表示中の場面/);
  assert.match(html, /アキ · 共同の居間/);
  assert.match(html, /指示対象/);
  assert.match(html, /ホームの物資の概要/);
  assert.doesNotMatch(html, /一時停止中/);
});

test("Saved active and suspended work both render with their own progress, reservations, and cancel controls", () => {
  let game = command(createGame(), {
    type: "assign",
    residentIds: ["aki"],
    kind: "cook",
  }).state;
  game = advance(game, 5);
  game = command(game, {
    type: "assign",
    residentIds: ["aki"],
    kind: "rest",
  }).state;
  const actor = game.residents.find((person) => person.id === "aki")!;
  assert.ok(actor.action && actor.suspended);
  assert.equal(actor.suspended.progress, 5);
  const html = renderSavedGame(game);
  assert.match(html, /running-work/);
  assert.match(html, /suspended-work/);
  assert.match(html, /料理をする（中断中）/);
  assert.match(html, /材料予約/);
  assert.match(html, /食材 2個/);
  assert.equal((html.match(/>取消<\/button>/g) ?? []).length, 2);
});

test("Current combat renders persistent scene access even without a transient pause message", () => {
  const game = createGame();
  game.residents.find((person) => person.id === "ren")!.location =
    game.enemy.location;
  delete game.pauseReason;
  const html = renderSavedGame(game);
  assert.match(html, /対応が必要な出来事/);
  assert.match(html, /レンが流れ者と対峙しています/);
  assert.match(html, /time-scene-jump/);
  assert.match(html, /現場を見る/);
  assert.match(html, /戦闘中の時間操作/);
});
