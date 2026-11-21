import test from "node:test";
import assert from "node:assert/strict";
import { advance, command, createGame, deserialize, getWalletCoins, serialize, totalResources } from "../src/game/engine";
import type { Command, GameState } from "../src/game/types";
import { makeMorningReflections } from "../src/game/life";
import { getLocationScene } from "../src/game/content";

function apply(state: GameState, intent: Command) {
  const result = command(state, intent);
  assert.equal(result.error, undefined);
  return result.state;
}

test("Original worlds retain three founders; solo and trading starts retain their own starting inventory and old save validation", () => {
  const communal = createGame();
  assert.equal(Object.hasOwn(communal, "origin"), false);
  assert.deepEqual(communal.residents.map(r => r.id), ["aki", "mio", "ren"]);
  assert.equal(serialize(createGame(undefined, "household")), serialize(communal));
  for (const origin of ["solo", "trader"] as const) {
    const state = createGame(undefined, origin);
    assert.deepEqual(deserialize(serialize(state)), state);
    assert.deepEqual(state.residents.map(r => r.id), ["aki"]);
    assert.deepEqual(Object.keys(state.inventory!.packs), ["aki"]);
    assert.deepEqual(totalResources(state), totalResources(communal));
    assert.deepEqual(state.residents[0].relations, {});
    assert.deepEqual(state.logs.map(l => l.actors), [["aki"]]);
    assert.doesNotMatch(JSON.stringify(getLocationScene(state, "home")), /三人/);
    const noOrigin = structuredClone(state);
    delete noOrigin.origin;
    assert.throws(() => deserialize(serialize(noOrigin)));
    assert.throws(() => deserialize(serialize({ ...communal, origin })));
    assert.throws(() => deserialize(serialize({ ...state, version: 2 })));
  }
});

test("The lone traveler can carry a real request to the guide and recruit a housemate", () => {
  let state = createGame(undefined, "solo");
  assert.equal(state.residents[0].location, "meadow");
  state = apply(state, { type: "assign", residentIds: ["aki"], kind: "move", target: "village" });
  for (let i = 0; i < 30 && state.residents[0].location !== "village"; i++) state = advance(state, 1);
  assert.equal(state.residents[0].location, "village");
  for (const choice of ["talk", "deliver"] as const)
    state = apply(state, { type: "region", residentId: "aki", npcId: "village-guide", choice });
  state = apply(state, { type: "recruit", residentId: "aki", npcId: "village-guide" });
  assert.deepEqual(state.residents.map(r => r.id), ["aki", "village-guide"]);
  assert.deepEqual(deserialize(serialize(state)), state);
});

test("The trader can sell stock, buy provisions and resume without inventing an initial coin balance", () => {
  let state = createGame(undefined, "trader");
  assert.equal(state.residents[0].location, "village");
  assert.equal(getWalletCoins(state, "aki"), 0);
  for (const choice of ["sell-scrap", "sell-scrap", "buy-food"] as const)
    state = apply(state, { type: "region", residentId: "aki", npcId: "village-trader", choice });
  assert.equal(state.inventory!.packs.aki.food, 5);
  assert.equal(state.inventory!.packs.aki.scrap, 2);
  assert.equal(getWalletCoins(state, "aki"), 0);
  assert.deepEqual(deserialize(serialize(state)), state);
});

test("A morning reflection does not turn yesterday's solitary meal into a group meal", () => {
  const meal = apply(createGame(undefined, "solo"), { type: "assign", residentIds: ["aki"], kind: "eat" });
  const nextMorning = advance(meal, meal.residents[0].action!.duration);
  nextMorning.minutes = 1440 + 480;
  const [reflection] = makeMorningReflections(nextMorning);
  assert.match(reflection.text, /食事をとり/);
  assert.doesNotMatch(reflection.text, /皆|三人|仲間/);
});
