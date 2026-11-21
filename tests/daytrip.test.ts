import test from "node:test";
import assert from "node:assert/strict";
import {
  advance, command, createGame, deserialize, getCombatants, serialize,
} from "../src/game/engine.ts";
import { getCarryLoad, ownFreeResources, totalResources } from "../src/game/inventory.ts";
import { regionHarvestAvailable } from "../src/game/region.ts";
import type { ActionKind, Command, GameState, LocationId, Resources } from "../src/game/types.ts";

const person = (s: GameState, id = "aki") => s.residents.find((r) => r.id === id)!;
function act(s: GameState, cmd: Command): GameState {
  const result = command(s, cmd);
  assert.equal(result.error, undefined, result.error);
  return result.state;
}
function fresh(seed = 20261120): GameState {
  let s = createGame(seed);
  // These are player policy commands, not edits to the residents' body or clock.
  for (const r of s.residents) s = act(s, { type: "policy", residentId: r.id, policy: "rest" });
  return s;
}
function assign(s: GameState, kind: ActionKind, id = "aki", target?: string): GameState {
  return act(s, { type: "assign", residentIds: [id], kind, target });
}
function pack(s: GameState, id: string, resource: keyof Resources, amount: number): GameState {
  return act(s, { type: "transfer", residentId: id, from: "base", to: id, resource, amount });
}
function tick(s: GameState, minutes: number): GameState {
  for (let n = 0; n < minutes; n++) {
    const before = s.minutes;
    s = advance(s, 1);
    assert.equal(s.minutes, before + 1, "The real common clock must advance one minute");
  }
  return s;
}
function finish(s: GameState, id = "aki"): GameState {
  const actionId = person(s, id).action?.id;
  assert.notEqual(actionId, undefined, "The actual command must have started a job");
  for (let n = 0; n < 1200; n++) {
    if (person(s, id).action?.id !== actionId) return s;
    s = tick(s, 1);
  }
  assert.fail("The real action did not finish within the comparison budget");
}
function travel(s: GameState, ids: string[], target: LocationId, via?: LocationId[]): GameState {
  s = act(s, { type: "assign", residentIds: ids, kind: "move", target, via });
  const actions = new Map(ids.map((id) => [id, person(s, id).action!.id]));
  for (let n = 0; n < 1200; n++) {
    if (ids.every((id) => person(s, id).action?.id !== actions.get(id))) {
      for (const id of ids) assert.equal(person(s, id).location, target);
      return s;
    }
    s = tick(s, 1);
  }
  assert.fail("The actual journey did not finish");
}
function rejected(s: GameState, cmd: Command): string {
  const before = serialize(s), result = command(s, cmd);
  assert.ok(result.error);
  assert.strictEqual(result.state, s);
  assert.equal(serialize(s), before);
  return result.error;
}

test("A genuine prepared daytrip shares its clock with the cook and returns real village goods", () => {
  let s = fresh();
  s = assign(s, "cook", "mio");
  s = pack(s, "aki", "food", 4);
  s = pack(s, "aki", "medicine", 1);
  s = pack(s, "aki", "scrap", 3);
  assert.equal(s.minutes, 480, "Preparation and assignment do not run the clock");
  assert.equal(s.resources.food, 2);
  assert.equal(s.inventory!.packs.aki.food, 4);
  assert.equal(getCarryLoad(s, "aki").multiplier, 1);
  s = travel(s, ["aki"], "village", ["meadow"]);
  assert.equal(s.minutes, 531, "The safe route uses the real three edges, 15+18+18");
  assert.equal(getCombatants(s).length, 0);
  const cooking = s.logs.find((entry) => entry.title === "温かい食事ができた" && entry.actors.includes("mio"));
  assert.ok(cooking);
  assert.ok(cooking.time < s.minutes, "The person left behind finishes during the same journey");
  assert.equal(s.resources.food, 5);
  const baseAtVillage = { ...s.resources };
  for (const [npcId, choice] of [
    ["village-guide", "talk"], ["village-guide", "deliver"],
    ["village-trader", "talk"], ["village-trader", "trade-food"], ["village-trader", "trade-medicine"],
  ] as const) s = act(s, { type: "region", residentId: "aki", npcId, choice });
  assert.equal(s.minutes, 531);
  assert.deepEqual(s.resources, baseAtVillage, "The village does not remotely exchange the base stock");
  assert.deepEqual(s.inventory!.packs.aki, { food: 4, ingredients: 0, medicine: 4, scrap: 0 });
  assert.deepEqual(s.region!.routeKnownBy, ["aki"]);
  assert.equal(s.region!.trust["village-guide"].aki, 3);
  assert.equal(s.region!.trust["village-guide"].mio, undefined);
  assert.ok(s.logs.some((entry) => entry.actors.includes("village-guide") && entry.actors.includes("aki")));
  s = deserialize(serialize(s));
  const returnInput = structuredClone(s);
  s = travel(s, ["aki"], "home", ["meadow"]);
  let replay = deserialize(serialize(returnInput));
  replay = travel(replay, ["aki"], "home", ["meadow"]);
  assert.deepEqual(s, replay, "The same saved world and commands produce the same homecoming");
  const carriedMedicine = s.inventory!.packs.aki.medicine;
  const totalBefore = totalResources(s);
  s = act(s, { type: "transfer", residentId: "aki", from: "aki", to: "base", resource: "medicine", amount: carriedMedicine });
  assert.deepEqual(totalResources(s), totalBefore);
  assert.equal(s.inventory!.packs.aki.medicine, 0);
  assert.equal(s.resources.medicine, baseAtVillage.medicine + carriedMedicine);
  assert.deepEqual(deserialize(serialize(s)), s);
});

test("A moving donor cannot remotely supply a field meal; a reserved shared meal travels with its eater", () => {
  let s = fresh();
  s = pack(s, "mio", "food", 1);
  s = travel(s, ["aki", "mio"], "meadow");
  assert.equal(s.inventory!.packs.aki.food, 0);
  s = assign(s, "move", "mio", "road");
  assert.match(rejected(s, { type: "assign", residentIds: ["aki"], kind: "eat" }), /食事|物資/);
  s = act(s, { type: "cancel", residentId: "mio" });
  const totalBefore = totalResources(s);
  s = assign(s, "eat");
  assert.equal(person(s).action!.reservationSource, "pack");
  assert.deepEqual(person(s).action!.materialTransfers, [{ from: "mio", resource: "food", amount: 1 }]);
  assert.equal(s.inventory!.packs.mio.food, 0);
  assert.equal(s.inventory!.packs.aki.food, 1);
  assert.equal(ownFreeResources(s, "aki").food, 0);
  assert.deepEqual(totalResources(s), totalBefore, "Reservation transfers ownership, not quantity");
  s = assign(s, "move", "mio", "road");
  s = tick(s, 5);
  const saved = deserialize(serialize(s));
  s = tick(s, 15);
  const replay = tick(saved, 15);
  assert.deepEqual(s, replay);
  assert.equal(person(s, "mio").location, "road");
  assert.equal(person(s).location, "meadow");
  assert.equal(s.inventory!.packs.aki.food, 0);
  assert.equal(totalResources(s).food, totalBefore.food - 1);
  assert.ok(s.logs.some((entry) => entry.title === "ひとりの食事" && entry.actors.includes("aki")));
});

test("Actual simultaneous meadow gathering has one collective daily yield and reload does not duplicate it", () => {
  let s = travel(fresh(), ["aki", "ren"], "meadow");
  const before = totalResources(s), base = { ...s.resources };
  s = act(s, { type: "assign", residentIds: ["aki", "ren"], kind: "gather" });
  s = tick(s, 10);
  const middle = deserialize(serialize(s));
  s = tick(s, 20);
  assert.deepEqual(s, tick(middle, 20));
  assert.equal(totalResources(s).ingredients, before.ingredients + 3);
  assert.equal(totalResources(s).scrap, before.scrap + 1);
  assert.deepEqual(s.resources, base);
  assert.equal(s.region!.harvests.length, 1);
  assert.deepEqual(s.logs.filter(e => e.title === "川沿いの収穫").at(-1)!.actors, ["aki", "ren"]);
  assert.deepEqual(s.life!.events.filter(e => e.kind === "supply" && e.location === "meadow").at(-1)!.actors, ["aki", "ren"]);
  assert.equal(s.logs.filter(e => e.title === "今日の収穫は済んでいる").length, 0);
  assert.equal(regionHarvestAvailable(s), false);
  assert.equal(person(s).action, null);
  assert.equal(person(s, "ren").action, null);
  rejected(s, { type: "assign", residentIds: ["aki"], kind: "gather" });
  const loaded = deserialize(serialize(s));
  assert.deepEqual(totalResources(loaded), totalResources(s));
});

test("A genuine safe route and the shorter route differ in time and actual enemy contact", () => {
  const initial = fresh(2026);
  let safe = act(initial, { type: "assign", residentIds: ["aki"], kind: "move", target: "village", via: ["meadow"] });
  let shortcut = act(initial, { type: "assign", residentIds: ["aki"], kind: "move", target: "village", via: ["ridge"] });
  assert.ok(person(shortcut).action!.duration < person(safe).action!.duration);
  assert.deepEqual(person(shortcut).action!.path, ["road", "ruins", "ridge", "village"]);
  assert.deepEqual(person(safe).action!.path, ["road", "meadow", "village"]);
  shortcut = tick(shortcut, 23);
  assert.equal(person(shortcut).location, "ruins");
  assert.equal(getCombatants(shortcut).some((r) => r.id === "aki"), true);
  assert.match(shortcut.pauseReason ?? "", /遭遇/);
  safe = finish(safe);
  assert.equal(person(safe).location, "village");
  assert.equal(person(safe).hp, 100);
  assert.equal(getCombatants(safe).length, 0);
});

test("Controlled casualty boundary: rescue from the new village follows real safe edges and survives midway reload", () => {
  let s = fresh();
  s = pack(s, "aki", "food", 1);
  s = pack(s, "ren", "medicine", 1);
  s = travel(s, ["aki", "ren"], "village", ["meadow"]);
  // The journey above is genuine; only this injury is a controlled boundary.
  person(s).hp = 25;
  person(s).wounds.leg = 2;
  s = deserialize(serialize(s));
  const patientPack = structuredClone(s.inventory!.packs.aki);
  const total = totalResources(s), before = s.minutes;
  s = assign(s, "rescue", "ren", "aki");
  const rescue = person(s, "ren").action!;
  assert.deepEqual(rescue.path, ["meadow", "road", "home"]);
  assert.equal(getCarryLoad(s, "ren").label, "過積載");
  assert.ok(rescue.duration > 51, "Carrying a body and its belongings slows the trip but does not forbid it");
  const firstEdge = rescue.segmentDuration!;
  s = tick(s, firstEdge);
  assert.equal(person(s).location, "meadow");
  assert.equal(person(s, "ren").location, "meadow");
  const loaded = deserialize(serialize(s));
  const next = finish(s, "ren"), replay = finish(loaded, "ren");
  assert.deepEqual(next, replay);
  assert.equal(person(next).location, "home");
  assert.equal(person(next, "ren").location, "home");
  assert.ok(next.minutes - before > 51);
  assert.deepEqual(next.inventory!.packs.aki, patientPack, "Carrying does not change ownership of the patient's items");
  assert.deepEqual(totalResources(next), total);
  assert.equal(next.logs.filter((entry) => entry.title === "仲間を連れて帰った").length, 1);
  assert.deepEqual(deserialize(serialize(next)), next);
});

test("Controlled casualty boundary: safe field treatment uses reserved local medicine once", () => {
  let s = fresh();
  s = pack(s, "mio", "medicine", 1);
  s = travel(s, ["aki", "mio"], "meadow");
  person(s).hp = 50;
  person(s).wounds.arm = 1;
  s = deserialize(serialize(s));
  const total = totalResources(s), baseMedicine = s.resources.medicine;
  s = assign(s, "heal", "mio", "aki");
  assert.equal(person(s, "mio").action!.reservationSource, "pack");
  s = tick(s, 5);
  const middle = deserialize(serialize(s));
  const next = finish(s, "mio"), replay = finish(middle, "mio");
  assert.deepEqual(next, replay);
  assert.equal(person(next).hp, 95);
  assert.equal(person(next).wounds.arm, 0);
  assert.equal(totalResources(next).medicine, total.medicine - 1);
  assert.equal(next.resources.medicine, baseMedicine);
  assert.equal(next.logs.filter((entry) => entry.title === "傷の手当").length, 1);
});

test("Legacy version-1 reserved work migrates once and invalid version-2 inventory is rejected", () => {
  let s = assign(fresh(), "cook", "mio");
  s = tick(s, 5);
  s = act(s, { type: "pause", residentId: "mio" });
  const beforeQuantity = { ...s.resources }, work = structuredClone(person(s, "mio").suspended);
  const old = JSON.parse(serialize(s)) as GameState;
  old.version = 1;
  delete old.inventory;
  delete old.region;
  delete person(old, "mio").suspended!.reservationSource;
  delete person(old, "mio").suspended!.materialTransfers;
  const migrated = deserialize(serialize(old));
  assert.equal(migrated.version, 3);
  assert.deepEqual(migrated.resources, beforeQuantity);
  assert.deepEqual(totalResources(migrated), beforeQuantity);
  assert.equal(person(migrated, "mio").suspended!.id, work!.id);
  assert.equal(person(migrated, "mio").suspended!.progress, work!.progress);
  const resumed = act(migrated, { type: "resume", residentId: "mio" });
  const next = finish(resumed, "mio");
  assert.equal(next.resources.ingredients, beforeQuantity.ingredients - 2);
  assert.equal(next.resources.food, beforeQuantity.food + 3);
  assert.deepEqual(deserialize(serialize(next)), next);
  for (const corrupt of [
    (x: GameState) => { delete x.inventory; },
    (x: GameState) => { x.inventory!.packs.aki.food = -1; },
    (x: GameState) => { x.inventory!.packs.unknown = { food: 1, ingredients: 0, medicine: 0, scrap: 0 }; },
    (x: GameState) => { person(x, "mio").suspended!.reservationSource = "pack"; },
  ]) {
    const bad = structuredClone(migrated);
    corrupt(bad);
    assert.throws(() => deserialize(serialize(bad)), /保存データ/);
  }
});
