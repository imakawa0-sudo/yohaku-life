import assert from "node:assert/strict";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import App from "../src/App";
import { describeLandscape } from "../src/components/Landscape";
import { createGame, serialize } from "../src/game/engine";
import { deriveAttention } from "../src/game/presentation";
import type { GameState } from "../src/game/types";

function renderState(state: GameState): string {
  const previous = Object.getOwnPropertyDescriptor(globalThis, "localStorage");
  const raw = serialize(state);
  Object.defineProperty(globalThis, "localStorage", {
    configurable: true,
    value: {
      getItem: (key: string) => (key === "yohaku-autosave-v1" ? raw : null),
      setItem: () => assert.fail("Rendering must not change the saved world"),
    },
  });
  try {
    const html = renderToStaticMarkup(createElement(App));
    assert.equal(serialize(state), raw);
    return html;
  } finally {
    if (previous) Object.defineProperty(globalThis, "localStorage", previous);
    else Reflect.deleteProperty(globalThis, "localStorage");
  }
}

test("Positive fractional vitals stay distinct from unconscious zero in meters, roster, attention and landscape", () => {
  const state = createGame();
  const actor = state.residents[0];
  actor.hp = actor.hunger = actor.energy = actor.mood = 0.05;
  const before = serialize(state);
  const html = renderState(state);
  const accessible = html
    .match(/id="resident-vitals-aki">([\s\S]*?)<\/span>/)![1]
    .replace(/<!--.*?-->/g, "")
    .replace(/&lt;/g, "<")
    .replace(/\s+/g, " ");
  assert.match(accessible, /体力 <1 \/ 100、満腹度 <1 \/ 100/);
  assert.ok(
    (html.match(/class="resident-vital-value">&lt;1<\/span>/g) ?? []).length >=
      2,
  );
  assert.ok((html.match(/&lt;1<small> \/ 100<\/small>/g) ?? []).length >= 4);
  assert.match(html, /style="width:0\.05%"/);
  assert.ok(!html.includes("意識なし · 手当が必要"));
  assert.match(
    deriveAttention(state).find((item) => item.id === "treatment:aki")!.detail,
    /身体 <1 \/ 100/,
  );
  const scene = describeLandscape(state, actor);
  assert.match(scene.description, /アキの体力<1、待機中/);
  assert.match(scene.caption, /アキは体力低下/);
  assert.doesNotMatch(scene.caption, /負傷中/);
  assert.equal(serialize(state), before);

  actor.hp = actor.hunger = actor.energy = actor.mood = 0;
  const zeroHtml = renderState(state);
  assert.match(zeroHtml, /id="resident-vitals-aki">体力 0 \/ 100、満腹度 0/);
  assert.ok(zeroHtml.includes("意識なし · 手当が必要"));
  assert.match(
    describeLandscape(state, actor).description,
    /アキの体力0、意識なし/,
  );
  assert.match(
    describeLandscape(state, actor).caption,
    /アキは意識を失っている/,
  );
  assert.equal(actor.hp, 0);
});

test("The landscape distinguishes actual wounds from low health without changing either", () => {
  const state = createGame();
  const actor = state.residents[0];
  actor.hp = 65;
  assert.match(describeLandscape(state, actor).caption, /体力低下/);
  actor.wounds.arm = 1;
  const before = serialize(state);
  assert.match(describeLandscape(state, actor).caption, /負傷中/);
  assert.match(describeLandscape(state, actor).description, /傷が残っている/);
  assert.equal(serialize(state), before);
});
