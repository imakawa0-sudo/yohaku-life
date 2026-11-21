import assert from "node:assert/strict";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import App from "../src/App";
import { Landscape, describeLandscape } from "../src/components/Landscape";
import { RidgeApproachAction } from "../src/components/RidgeApproachAction";
import { advance, command, createGame, serialize } from "../src/game/engine";
import type { Command, GameState, LocationId } from "../src/game/types";

const resident = (s: GameState, id: string) => s.residents.find(r => r.id === id)!;
function apply(s: GameState, instruction: Command) {
  const result = command(s, instruction);
  assert.equal(result.error, undefined, result.error);
  return result.state;
}
function travel(s: GameState, id: string, target: LocationId, via?: LocationId[]) {
  s = apply(s, { type: "assign", residentIds: [id], kind: "move", target, ...(via ? { via } : {}) });
  for (let i = 0; i < 300 && resident(s, id).action?.kind === "move"; i++) s = advance(s, 1);
  assert.equal(resident(s, id).location, target);
  assert.equal(resident(s, id).action, null);
  return s;
}
function atRidge() {
  let s = createGame(562);
  for (const id of ["mio", "ren"])
    s = apply(s, { type: "policy", residentId: id, policy: "rest" });
  s = apply(s, { type: "transfer", residentId: "mio", from: "base", to: "mio", resource: "food", amount: 3 });
  return travel(s, "ren", "ridge", ["road", "meadow", "village"]);
}
function approachCard(s: GameState, selectedIds: string[]) {
  const before = serialize(s);
  const html = renderToStaticMarkup(createElement(RidgeApproachAction, {
    game: s, selectedIds, onCommand: () => assert.fail("Rendering must not approach a person"),
  }));
  assert.equal(serialize(s), before);
  return html;
}

test("The ridge approach requires the actual local actor and rendering cannot introduce an encounter", () => {
  const s = atRidge();
  assert.doesNotMatch(approachCard(s, ["ren"]), /disabled/);
  assert.match(approachCard(s, ["ren"]), /20分/);
  assert.match(approachCard(s, ["mio"]), /disabled/);
  assert.match(approachCard(s, ["mio", "ren"]), /disabled/);
  assert.equal(s.secondaryEncounter, undefined);
  const begun = apply(s, { type: "assign", residentIds: ["ren"], kind: "approach-ridge" });
  const met = advance(begun, 20);
  assert.equal(met.secondaryEncounter?.hp, 60);
  assert.equal(approachCard(met, ["ren"]), "", "An introduced encounter cannot be repeatedly added from the card");
});

test("A negotiated first departure never removes the second opponent from its own landscape", () => {
  let s = atRidge();
  s = advance(apply(s, { type: "assign", residentIds: ["ren"], kind: "approach-ridge" }), 20);
  s = travel(s, "ren", "village");
  s = travel(s, "mio", "ruins");
  s = apply(s, { type: "guard-agreement", residentIds: ["mio"] });
  s = travel(s, "ren", "ridge");
  const before = serialize(s);
  const ridge = describeLandscape(s, resident(s, "ren"));
  const ruins = describeLandscape(s, resident(s, "mio"));
  assert.match(ridge.description, /尾根の見張りが行く手にいる/);
  assert.doesNotMatch(ridge.description, /食事を受け取り立ち去った/);
  assert.match(ruins.description, /守り手は食事を受け取り立ち去った/);
  const picture = (id: string) => renderToStaticMarkup(createElement(Landscape, { game: s, resident: resident(s, id) }));
  assert.match(picture("ren"), /data-detail="guard-present"/);
  assert.doesNotMatch(picture("mio"), /data-detail="guard-present"/);
  assert.equal(serialize(s), before);
});

test("Two distant battles each expose a direct scene button without changing the selected household or world", () => {
  let s = atRidge();
  s = advance(apply(s, { type: "assign", residentIds: ["ren"], kind: "approach-ridge" }), 20);
  s = travel(s, "ren", "village");
  s = travel(s, "mio", "ruins");
  s = apply(s, { type: "assign", residentIds: ["mio"], kind: "defend" });
  s = travel(s, "ren", "ridge");
  const before = serialize(s);
  const previous = Object.getOwnPropertyDescriptor(globalThis, "localStorage");
  Object.defineProperty(globalThis, "localStorage", { configurable: true, value: {
    getItem: (key: string) => key === "yohaku-autosave-v1" ? before : null,
    setItem: () => assert.fail("Rendering must not save or advance"),
  } });
  try {
    const html = renderToStaticMarkup(createElement(App));
    const primary = html.split('<section class="attention-board"')[1]?.split("<details>")[0];
    assert(primary, "The loaded two-front world must render its attention board");
    assert.equal((primary.match(/<button /g) ?? []).length, 2);
    assert.match(primary, /ミオが流れ者と対峙していますの現場を見る/);
    assert.match(primary, /レンが尾根の見張りと対峙していますの現場を見る/);
    assert.match(html, /2地点/);
    assert.equal(serialize(s), before);
  } finally {
    if (previous) Object.defineProperty(globalThis, "localStorage", previous);
    else Reflect.deleteProperty(globalThis, "localStorage");
  }
});
