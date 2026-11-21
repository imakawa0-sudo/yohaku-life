import test from "node:test";
import assert from "node:assert/strict";
import { advance, command, createGame, deserialize, serialize } from "../src/game/engine.ts";
import { getCarryLoad, ownFreeResources, totalResources } from "../src/game/inventory.ts";
import type { Action, Command, GameState, LocationId, MoveCargo, Resources } from "../src/game/types.ts";

const person = (s: GameState, id = "aki") => s.residents.find(r => r.id === id)!;
function act(s: GameState, cmd: Command): GameState {
  const result = command(s, cmd);
  assert.equal(result.error, undefined, result.error);
  return result.state;
}
function quiet(seed = 6401): GameState {
  const s = createGame(seed);
  for (const r of s.residents) { r.policy = "rest"; r.hunger = r.energy = 100; }
  return s;
}
function finish(s: GameState, id = "aki") {
  const job = person(s, id).action?.id;
  assert.ok(job);
  for (let n = 0; n < 2000; n++) {
    if (person(s, id).action?.id !== job) return s;
    s = advance(s, 1);
  }
  assert.fail("The actual job did not finish");
}
const move = (s: GameState, place: LocationId, id = "aki") =>
  finish(act(s, { type: "assign", residentIds: [id], kind: "move", target: place }), id);
const take = (s: GameState, resource: keyof Resources, amount: number, id = "aki") =>
  act(s, { type: "transfer", residentId: id, from: "base", to: id, resource, amount });
const cargo = (s: GameState, resource: keyof Resources = "scrap", amount = 1, id = "aki") =>
  act(s, { type: "assign", residentIds: [id], kind: "move", target: "home", cargo: { resource, amount } });
function field(resource: keyof Resources = "scrap", amount = 1, location: LocationId = "meadow", id = "aki") {
  return move(take(quiet(), resource, amount, id), location, id);
}
function rejected(s: GameState, cmd: unknown) {
  const before = serialize(s), result = command(s, cmd as Command);
  assert.ok(result.error, JSON.stringify(cmd));
  assert.strictEqual(result.state, s);
  assert.equal(serialize(s), before);
}
const deposits = (s: GameState) => s.logs.filter(log => log.title === "荷物を倉庫へ届けた");
const stops = (s: GameState) => s.logs.filter(log => log.title === "運搬を中止した");

// Valid ordinary setup uses only commands and actual progress. Controlled stock,
// casualty and malformed-save cases below are explicitly labelled separately.
test("One actor reserves existing cargo at clock zero and actually walks home before a single conserved deposit", () => {
  let s = take(quiet(), "ingredients", 2, "ren");
  s = move(s, "meadow", "ren");
  s = finish(act(s, { type: "assign", residentIds: ["ren"], kind: "gather" }), "ren");
  assert.equal(s.inventory!.packs.ren.ingredients, 5);
  const initial = structuredClone(s), stock = totalResources(s), load = getCarryLoad(s, "ren");
  s = cargo(s, "scrap", 1, "ren");
  const job = structuredClone(person(s, "ren").action)!;
  assert.equal(s.minutes, initial.minutes);
  assert.equal(s.seed, initial.seed);
  assert.equal(person(s, "ren").location, "meadow");
  assert.deepEqual(s.resources, initial.resources);
  assert.deepEqual(s.inventory, initial.inventory);
  assert.deepEqual(getCarryLoad(s, "ren"), load);
  assert.equal(job.duration, 33);
  assert.deepEqual(job.cargo, { resource: "scrap", amount: 1 });
  assert.deepEqual(job.reserved, { scrap: 1 });
  assert.equal(job.reservationSource, "pack");
  assert.equal(ownFreeResources(s, "ren").scrap, 0);
  assert.deepEqual(person(s, "aki"), person(initial, "aki"));
  s = advance(s, 32);
  assert.equal(deposits(s).length, 0);
  assert.equal(s.resources.scrap, initial.resources.scrap);
  s = advance(s, 1);
  assert.equal(person(s, "ren").location, "home");
  assert.equal(person(s, "ren").action, null);
  assert.equal(s.resources.scrap, initial.resources.scrap + 1);
  assert.equal(s.inventory!.packs.ren.scrap, 0);
  assert.equal(s.inventory!.packs.ren.ingredients, 5);
  assert.deepEqual(totalResources(s), stock);
  assert.deepEqual(deposits(s)[0].actors, ["ren"]);
  assert.equal(deposits(s).length, 1);
  const after = deserialize(serialize(s));
  s = advance(after, 5);
  assert.equal(deposits(s).length, 1);
  assert.equal(s.resources.scrap, initial.resources.scrap + 1);
});

test("Cargo follows ordinary load and wound timing, while explicit route contact stops without depositing", () => {
  let s = quiet(6402);
  s.resources.scrap = 30; // Controlled heavy-load boundary, then real transfers/movement.
  person(s).wounds.leg = 1;
  s = move(take(s, "scrap", 20), "village");
  const ordinary = act(s, { type: "assign", residentIds: ["aki"], kind: "move", target: "home" });
  let delivery = cargo(s, "scrap", 20);
  assert.equal(person(delivery).action!.duration, person(ordinary).action!.duration);
  assert.deepEqual(person(delivery).action!.path, ["meadow", "road", "home"]);
  assert.deepEqual(getCarryLoad(delivery, "aki"), getCarryLoad(s, "aki"));
  delivery = act(s, { type: "assign", residentIds: ["aki"], kind: "move", target: "home", via: ["ridge", "ruins"], cargo: { resource: "scrap", amount: 20 } });
  for (let n = 0; n < 200 && person(delivery).location !== "ruins"; n++) delivery = advance(delivery, 1);
  assert.equal(person(delivery).location, "ruins");
  assert.match(delivery.pauseReason!, /遭遇/);
  assert.equal(deposits(delivery).length, 0);
  assert.equal(delivery.inventory!.packs.aki.scrap, 20);
  assert.equal(ownFreeResources(delivery, "aki").scrap, 0);
  assert.deepEqual(deserialize(serialize(delivery)), delivery);
});

test("Invalid quantities, shapes, selections, targets and kinds atomically retain the original state", () => {
  const s = field();
  const base = { type: "assign", residentIds: ["aki"], kind: "move", target: "home", cargo: { resource: "scrap", amount: 1 } };
  for (const bad of [null, {}, [], { resource: "wood", amount: 1 }, { resource: "scrap", amount: 0 },
    { resource: "scrap", amount: -1 }, { resource: "scrap", amount: 0.5 }, { resource: "scrap", amount: NaN },
    { resource: "scrap", amount: Infinity }, { resource: "scrap", amount: Number.MAX_SAFE_INTEGER + 1 },
    { resource: "scrap", amount: "1" }, { resource: "scrap", amount: 1, extra: true }]) rejected(s, { ...base, cargo: bad });
  for (const patch of [{ residentIds: [] }, { residentIds: ["aki", "mio"] }, { residentIds: ["nobody"] },
    { kind: "gather" }, { target: "village" }, { target: undefined }, { subjectEventId: 1 }, { via: ["invalid"] }]) rejected(s, { ...base, ...patch });
  rejected(quiet(), base);
  const ended = structuredClone(s); ended.ended = true;
  rejected(ended, base);
  assert.ok(person(act(s, { ...base, residentIds: ["aki", "aki"] } as Command)).action?.cargo);
});

test("Remote base, local peers and ground never supply cargo until the actor actually receives the item", () => {
  let s = take(quiet(), "food", 3, "mio");
  s = move(move(s, "meadow"), "meadow", "mio");
  s = act(s, { type: "transfer", residentId: "mio", from: "mio", to: "ground", resource: "food", amount: 2 });
  assert.equal(s.resources.food, 3);
  assert.equal(s.inventory!.packs.mio.food, 1);
  assert.equal(s.inventory!.ground.meadow!.food, 2);
  const cmd = { type: "assign", residentIds: ["aki"], kind: "move", target: "home", cargo: { resource: "food", amount: 1 } };
  rejected(s, cmd);
  s = act(s, { type: "transfer", residentId: "mio", from: "mio", to: "aki", resource: "food", amount: 1 });
  const before = structuredClone(s);
  s = cargo(s, "food", 1);
  assert.deepEqual(s.inventory, before.inventory);
  assert.equal(s.resources.food, before.resources.food);
});

test("Direct cargo orders retain manual reservations, replace automatic ones, and do not overbook two slots", () => {
  let s = field("food", 2);
  s = act(s, { type: "assign", residentIds: ["aki"], kind: "eat" });
  s = advance(s, 3);
  const eat = structuredClone(person(s).action)!;
  rejected(s, { type: "assign", residentIds: ["aki"], kind: "move", target: "home", cargo: { resource: "food", amount: 2 } });
  s = cargo(s, "food", 1);
  assert.deepEqual(person(s).suspended, eat);
  assert.equal(ownFreeResources(s, "aki").food, 0);
  rejected(s, { type: "assign", residentIds: ["aki"], kind: "move", target: "home", cargo: { resource: "food", amount: 1 } });
  const arrived = finish(s);
  assert.equal(arrived.inventory!.packs.aki.food, 1);
  assert.deepEqual(person(arrived).suspended, eat);
  assert.equal(ownFreeResources(arrived, "aki").food, 0);

  let automatic = field("food", 2);
  automatic = act(automatic, { type: "assign", residentIds: ["aki"], kind: "eat" });
  automatic = act(automatic, { type: "pause", residentId: "aki" });
  const oldHeld = structuredClone(person(automatic).suspended);
  automatic = act(automatic, { type: "assign", residentIds: ["aki"], kind: "eat" });
  person(automatic).action!.automatic = true; // Controlled legacy automatic reservation.
  automatic = deserialize(serialize(automatic));
  rejected(automatic, { type: "assign", residentIds: ["aki"], kind: "move", target: "home", cargo: { resource: "food", amount: 2 } });
  const replacement = cargo(automatic, "food", 1);
  assert.deepEqual(person(replacement).suspended, oldHeld);
  assert.equal(ownFreeResources(replacement, "aki").food, 0);
  assert.equal(replacement.inventory!.packs.aki.food, 2);
});

test("Mid-leg pause/save/resume and cancellation retain or unlock only the saved cargo", () => {
  let s = cargo(field("scrap", 2), "scrap", 1);
  s = advance(s, 5);
  s = act(s, { type: "pause", residentId: "aki" });
  const held = structuredClone(person(s).suspended)!;
  assert.equal(held.progress, 5);
  assert.equal(s.inventory!.packs.aki.scrap, 2);
  s = deserialize(serialize(s));
  assert.deepEqual(person(s).suspended, held);
  const resumed = act(s, { type: "resume", residentId: "aki" });
  assert.deepEqual(person(resumed).action, held);
  const first = finish(resumed), second = finish(act(deserialize(serialize(s)), { type: "resume", residentId: "aki" }));
  assert.deepEqual(first, second, "Saved partial state and the same next commands reproduce the complete world");
  assert.equal(deposits(first).length, 1);
  const cancelled = act(s, { type: "cancel", residentId: "aki", actionId: held.id });
  assert.equal(person(cancelled).suspended, null);
  assert.equal(cancelled.inventory!.packs.aki.scrap, 2);
  assert.equal(ownFreeResources(cancelled, "aki").scrap, 2);
  assert.equal(deposits(cancelled).length, 0);
  assert.equal(cancelled.minutes, s.minutes);
  assert.equal(cancelled.seed, s.seed);
});

test("Reserved travelling meals and medicine cannot be eaten, treated with or handed away until cargo is cancelled", () => {
  for (const resource of ["food", "medicine"] as const) {
    let s = cargo(field(resource, 1), resource, 1);
    if (resource === "medicine") person(s).hp = 80; // Controlled need for treatment, so availability is the actual barrier.
    const care: Command = resource === "food"
      ? { type: "assign", residentIds: ["aki"], kind: "eat" }
      : { type: "assign", residentIds: ["aki"], kind: "heal", target: "aki" };
    rejected(s, care);
    s = act(s, { type: "pause", residentId: "aki" });
    rejected(s, care);
    rejected(s, { type: "transfer", residentId: "aki", from: "aki", to: "ground", resource, amount: 1 });
    const before = totalResources(s), id = person(s).suspended!.id;
    s = act(s, { type: "cancel", residentId: "aki", actionId: id });
    assert.deepEqual(totalResources(s), before);
    assert.equal(ownFreeResources(s, "aki")[resource], 1);
    s = act(s, care);
    assert.deepEqual(person(s).action!.reserved, { [resource]: 1 });
  }
});

test("An off-route held delivery replans like ordinary movement with one replacement lock", () => {
  let s = act(cargo(field()), { type: "pause", residentId: "aki" });
  const old = structuredClone(person(s).suspended)!;
  s = move(s, "shelter");
  assert.deepEqual(person(s).suspended, old);
  const stock = totalResources(s), pack = structuredClone(s.inventory!.packs.aki);
  s = act(s, { type: "resume", residentId: "aki" });
  const job = person(s).action!;
  assert.notEqual(job.id, old.id);
  assert.equal(job.origin, "shelter");
  assert.deepEqual(job.cargo, old.cargo);
  assert.deepEqual(job.reserved, { scrap: 1 });
  assert.equal(person(s).suspended, null);
  assert.equal(ownFreeResources(s, "aki").scrap, 0);
  assert.deepEqual(s.inventory!.packs.aki, pack);
  s = finish(deserialize(serialize(s)));
  assert.equal(deposits(s).length, 1);
  assert.deepEqual(totalResources(s), stock);
});

test("A delivery can pass through base without depositing until final arrival, or explicitly hand off a held load there", () => {
  let s = field();
  s = act(s, { type: "assign", residentIds: ["aki"], kind: "move", target: "home", via: ["home", "road"], cargo: { resource: "scrap", amount: 1 } });
  for (let n = 0; n < 100 && person(s).location !== "home"; n++) s = advance(s, 1);
  assert.equal(person(s).location, "home");
  assert.ok(person(s).action?.cargo);
  assert.equal(deposits(s).length, 0);
  assert.deepEqual(deserialize(serialize(s)), s, "An actual intermediate base waypoint is a valid current move");
  s = act(s, { type: "pause", residentId: "aki" });
  const before = structuredClone(s);
  s = act(s, { type: "resume", residentId: "aki" });
  assert.equal(s.minutes, before.minutes);
  assert.equal(s.seed, before.seed);
  assert.equal(person(s).action, null);
  assert.equal(person(s).suspended, null);
  assert.equal(deposits(s).length, 1);
  assert.deepEqual(s.life, before.life);
  assert.deepEqual(person(s).relations, person(before).relations);
  assert.equal(s.logs.filter(log => log.title === "移動を終えて").length, before.logs.filter(log => log.title === "移動を終えて").length);
});

test("Already-base handoff replaces an automatic current job, but never a different manual current job", () => {
  let s = act(cargo(field("food", 2), "food", 1), { type: "pause", residentId: "aki" });
  s = move(s, "home");
  assert.equal(deposits(s).length, 0, "Ordinary return does not silently finish the held delivery");
  s = act(s, { type: "assign", residentIds: ["aki"], kind: "eat" });
  rejected(s, { type: "resume", residentId: "aki" });
  person(s).action!.automatic = true; // Controlled valid legacy automatic current.
  s = deserialize(serialize(s));
  const before = structuredClone(s);
  s = act(s, { type: "resume", residentId: "aki" });
  assert.equal(s.minutes, before.minutes);
  assert.equal(s.seed, before.seed);
  assert.deepEqual(s.life, before.life);
  assert.equal(person(s).action, null);
  assert.equal(person(s).suspended, null);
  assert.equal(s.inventory!.packs.aki.food, 1);
  assert.equal(ownFreeResources(s, "aki").food, 1);
  assert.equal(s.resources.food, before.resources.food + 1);
  assert.deepEqual(deserialize(serialize(s)), s);
});

function casualty(held: boolean) {
  let s = take(quiet(6410), "food", 2);
  if (held) {
    s = act(s, { type: "assign", residentIds: ["aki"], kind: "eat" });
    s = act(s, { type: "pause", residentId: "aki" });
  }
  s = move(s, "road");
  s = cargo(s, "food", 1);
  // Controlled combat boundary; movement, reservation, damage and rescue are real.
  person(s).hp = 1;
  s.enemy.location = "road";
  return s;
}

test("Outdoor knockout keeps cargo in an empty held slot and rescue never deposits on the patient's behalf", () => {
  let s = casualty(false), cargoJob = structuredClone(person(s).action)!;
  s = advance(s, 1);
  assert.equal(person(s).hp, 0);
  assert.equal(person(s).action, null);
  assert.equal(person(s).suspended!.id, cargoJob.id);
  assert.equal(ownFreeResources(s, "aki").food, 1);
  assert.equal(stops(s).length, 0);
  s.enemy.defeated = true; // Controlled removal of the guard to isolate actual rescue.
  s = move(s, "road", "mio");
  s = finish(act(s, { type: "assign", residentIds: ["mio"], kind: "rescue", target: "aki" }), "mio");
  assert.equal(person(s).location, "home");
  assert.equal(deposits(s).length, 0);
  assert.equal(s.inventory!.packs.aki.food, 2);
  assert.equal(person(s).suspended!.id, cargoJob.id);
  s = finish(act(s, { type: "assign", residentIds: ["mio"], kind: "heal", target: "aki" }), "mio");
  const before = structuredClone(s);
  s = act(deserialize(serialize(s)), { type: "resume", residentId: "aki" });
  assert.equal(s.minutes, before.minutes);
  assert.deepEqual(s.life, before.life);
  assert.deepEqual(person(s).relations, person(before).relations);
  assert.equal(deposits(s).length, 1);
  assert.equal(s.inventory!.packs.aki.food, 1);
});

test("Outdoor knockout with two occupied slots stops cargo once, preserving the old reservation and actual goods", () => {
  let s = casualty(true), old = structuredClone(person(s).suspended)!;
  s = advance(s, 1);
  assert.equal(person(s).hp, 0);
  assert.equal(person(s).action, null);
  assert.deepEqual(person(s).suspended, old);
  assert.equal(s.inventory!.packs.aki.food, 2);
  assert.equal(ownFreeResources(s, "aki").food, 1);
  assert.equal(stops(s).length, 1);
  assert.deepEqual(stops(s)[0].actors, ["aki"]);
  s.enemy.defeated = true;
  s = move(s, "road", "mio");
  s = finish(act(s, { type: "assign", residentIds: ["mio"], kind: "rescue", target: "aki" }), "mio");
  assert.equal(stops(s).length, 1);
  assert.equal(deposits(s).length, 0);
  assert.deepEqual(person(s).suspended, old);
  assert.equal(s.inventory!.packs.aki.food, 2);
});

test("Rescue start either holds cargo or stops it once; a patient cannot resume or forge an active delivery", () => {
  for (const held of [false, true]) {
    let s = take(quiet(6411), "food", 2);
    if (held) {
      s = act(s, { type: "assign", residentIds: ["aki"], kind: "eat" });
      s = act(s, { type: "pause", residentId: "aki" });
    }
    s = move(s, "road", "mio");
    s = cargo(move(s, "road"), "food", 1);
    person(s).hp = 20; // Conscious controlled casualty; both people really walked here first.
    const old = structuredClone(person(s).suspended), job = structuredClone(person(s).action)!;
    s = act(s, { type: "assign", residentIds: ["mio"], kind: "rescue", target: "aki" });
    assert.equal(person(s).action, null);
    assert.equal(stops(s).length, held ? 1 : 0);
    assert.equal(s.inventory!.packs.aki.food, 2);
    if (held) assert.deepEqual(person(s).suspended, old);
    else {
      assert.equal(person(s).suspended!.id, job.id);
      rejected(s, { type: "resume", residentId: "aki" });
      const forged = structuredClone(s);
      person(forged).action = person(forged).suspended;
      person(forged).suspended = null;
      assert.throws(() => deserialize(serialize(forged)), /保存データ/);
    }
    s = finish(s, "mio");
    assert.equal(deposits(s).length, 0);
    assert.equal(stops(s).length, held ? 1 : 0);
    assert.deepEqual(deserialize(serialize(s)), s);
  }
});

test("Cargo save contracts reject forged stock, reservations, hidden purposes and disconnected or misplaced current paths", () => {
  const s = cargo(field());
  const corruptions: ((s: GameState, a: Action) => void)[] = [
    (_s, a) => { a.cargo!.amount = 2; },
    (_s, a) => { a.cargo = { resource: "scrap", amount: 1, extra: true } as MoveCargo; },
    (_s, a) => { a.cargo!.amount = 0.5; },
    (_s, a) => { a.cargo!.resource = "invalid" as keyof Resources; },
    (_s, a) => { a.cargo = null as unknown as MoveCargo; },
    (_s, a) => { a.reserved = { scrap: 1, food: 0 }; },
    (_s, a) => { a.reservationSource = "base"; },
    (_s, a) => { a.materialTransfers = []; },
    (_s, a) => { a.automatic = true; },
    (_s, a) => { a.autonomyNext = "rest"; },
    (_s, a) => { a.subjectEventId = 1; },
    (_s, a) => { a.craftingToolsId = 1; },
    (_s, a) => { a.targetActionId = 1; },
    (_s, a) => { a.restoringShelf = false; },
    (_s, a) => { a.origin = undefined; },
    (_s, a) => { a.origin = "home"; },
    (_s, a) => { a.path![0] = "kitchen"; },
    (_s, a) => { a.target = "village"; },
    (state, _a) => { person(state).location = "road"; },
    (state, _a) => { state.inventory!.packs.aki.scrap = 0; },
    (_s, a) => { delete a.cargo; },
  ];
  for (const corrupt of corruptions) {
    const bad = structuredClone(s); corrupt(bad, person(bad).action!);
    assert.throws(() => deserialize(serialize(bad)), /保存データ/);
  }
  const pair = cargo(act(field("food", 2), { type: "assign", residentIds: ["aki"], kind: "eat" }), "food", 1);
  pair.inventory!.packs.aki.food = 1; // Both genuine locks need two physical meals.
  assert.throws(() => deserialize(serialize(pair)), /保存データ/);
});

test("Cargo-free movement and formats1–3 retain their existing contents and never acquire cargo", () => {
  const initial = field("scrap", 1);
  let ordinary = act(initial, { type: "assign", residentIds: ["aki"], kind: "move", target: "home" });
  const expected = structuredClone(person(ordinary).action)!;
  for (const version of [1, 2, 3] as const) {
    const old = structuredClone(ordinary); old.version = version;
    const loaded = deserialize(serialize(old));
    assert.deepEqual(person(loaded).action, expected);
    assert.equal(person(loaded).action!.cargo, undefined);
  }
  ordinary = finish(ordinary);
  assert.equal(ordinary.inventory!.packs.aki.scrap, 1);
  assert.equal(ordinary.resources.scrap, initial.resources.scrap);
  assert.equal(deposits(ordinary).length, 0);
});
