import test from "node:test";
import assert from "node:assert/strict";
import {
  advance,
  command,
  createGame,
  deserialize,
  getWishProgress,
  serialize,
  totalResources,
} from "../src/game/engine.ts";
import { assignSelection } from "../src/game/selection.ts";
import type { ActionKind, Command, GameState, LifeExperience, LocationId } from "../src/game/types.ts";

const person = (state: GameState, id = "aki") => state.residents.find((resident) => resident.id === id)!;
function act(state: GameState, instruction: Command): GameState {
  const result = command(state, instruction);
  assert.equal(result.error, undefined, result.error);
  return result.state;
}
function assign(state: GameState, kind: ActionKind, id = "aki", target?: string): GameState {
  return act(state, { type: "assign", residentIds: [id], kind, target });
}
function finish(state: GameState, id = "aki"): GameState {
  const actionId = person(state, id).action?.id;
  assert.notEqual(actionId, undefined);
  for (let step = 0; step < 1000; step++) {
    if (person(state, id).action?.id !== actionId) return state;
    state = advance(state, 1);
  }
  assert.fail("The action did not finish");
}
function still(seed = 20261120): GameState {
  let state = createGame(seed);
  for (const resident of state.residents) {
    resident.hunger = 100;
    resident.energy = 100;
    state = act(state, { type: "policy", residentId: resident.id, policy: "rest" });
  }
  return state;
}
function atCache(location: "shelter" | "ruins", ids = ["aki", "mio", "ren"]): GameState {
  const state = still();
  for (const id of ids) person(state, id).location = location;
  if (location === "ruins") state.enemy.defeated = true;
  return state;
}
function gatherGroup(state: GameState, ids = ["aki", "mio", "ren"]): GameState {
  const result = assignSelection(state, ids, "gather");
  assert.equal(result.error, undefined, result.error);
  return result.state;
}
function supply(state: GameState, location?: LocationId): LifeExperience {
  const event = state.life!.events.find((entry) => entry.kind === "supply" && (!location || entry.location === location));
  assert.ok(event);
  return event;
}

test("Stopping at real action ends follows autonomous 3/7/23 minute boundaries while fixed time remains fixed", () => {
  const initial = assign(createGame(30), "hobby");
  assert.equal(person(initial).action?.duration, 45);
  let state = advance(initial, 45, { stopAtActionEnd: true });
  assert.equal(state.minutes, 483);
  assert.equal(person(state).action?.progress, 3);
  state = advance(deserialize(serialize(state)), 42, { stopAtActionEnd: true });
  assert.equal(state.minutes, 490);
  assert.equal(person(state).action?.progress, 22);
  state = advance(state, 35, { stopAtActionEnd: true });
  assert.equal(state.minutes, 513);
  assert.equal(state.flags.hobbyFinished, true);
  assert.equal(person(state).action, null);
  assert.equal(person(state, "ren").action, null);
  assert.ok(state.life!.events.some((entry) => entry.kind === "quiet"));
  assert.equal(advance(initial, 45).minutes, 525);
  assert.equal(Object.hasOwn(state, "stopAtActionEnd"), false);
  const idle = still(31);
  idle.pauseReason = "Preserve on zero progress";
  assert.deepEqual(advance(idle, 0, { stopAtActionEnd: true }), idle);
  assert.equal(advance(idle, 30, { stopAtActionEnd: true }).minutes, 510);
});

test("A move replaced immediately by autonomous cooking still ends the old action boundary with new progress zero", () => {
  let state = still(32);
  person(state).location = "kitchen";
  person(state, "mio").location = "road";
  person(state, "ren").location = "road";
  state = finish(assign(state, "project", "aki", "kitchen-tools"));
  state = finish(assign(state, "move", "aki", "home"));
  person(state, "mio").location = "home";
  person(state, "mio").policy = "balanced";
  state.resources.food = 0;
  state.resources.ingredients = 10;
  state = advance(state, 1);
  const moveId = person(state, "mio").action!.id;
  assert.equal(person(state, "mio").action?.kind, "move");
  const before = state.minutes;
  state = advance(state, 30, { stopAtActionEnd: true });
  assert.equal(state.minutes, before + 2);
  assert.equal(person(state, "mio").location, "kitchen");
  assert.equal(person(state, "mio").action?.kind, "cook");
  assert.notEqual(person(state, "mio").action?.id, moveId);
  assert.equal(person(state, "mio").action?.progress, 0);
  assert.deepEqual(deserialize(serialize(state)), state);
});

test("An action boundary commits all same-minute completions and preserves more important care or merchant reasons", () => {
  let state = still(33);
  const eating = assignSelection(state, ["aki", "mio", "ren"], "eat");
  assert.equal(eating.error, undefined);
  state = advance(eating.state, 100, { stopAtActionEnd: true });
  assert.equal(state.minutes, 495);
  assert.equal(state.resources.food, 3);
  assert.ok(state.residents.every((resident) => resident.action === null));
  assert.equal(state.life!.events.filter((event) => event.kind === "meal").length, 1);

  let care = assign(still(34), "rest", "ren");
  person(care, "ren").action!.progress = 29;
  person(care).hunger = 20.05;
  care = advance(care, 30, { stopAtActionEnd: true });
  assert.equal(care.minutes, 481);
  assert.equal(person(care, "ren").action, null);
  assert.match(care.pauseReason ?? "", /空腹/);

  let arrival = still(35);
  arrival.minutes = 2159;
  arrival = assign(arrival, "rest", "ren");
  person(arrival, "ren").action!.progress = 29;
  arrival = advance(arrival, 30, { stopAtActionEnd: true });
  assert.equal(arrival.minutes, 2160);
  assert.equal(arrival.trade?.visit?.status, "open");
  assert.match(arrival.pauseReason ?? "", /行商/);
});

test("An unsuccessful treatment ending is a real boundary rather than a reason to skip to the requested horizon", () => {
  let state = still(36);
  person(state, "ren").hp = 40;
  person(state, "ren").wounds.arm = 1;
  state = advance(assign(state, "heal", "aki", "ren"), 5);
  state = finish(assign(state, "move", "ren", "bedroom"), "ren");
  assert.equal(person(state).action?.progress, 8);
  const medicine = state.resources.medicine;
  state = advance(state, 30, { stopAtActionEnd: true });
  assert.equal(state.minutes, 500);
  assert.equal(person(state).action, null);
  assert.equal(state.resources.medicine, medicine);
  assert.ok(state.logs.some((entry) => entry.title === "手当を見合わせた"));
});

test("Each finite cache gives one joint result with stable real actors and individual health regardless of processing order", () => {
  for (const location of ["shelter", "ruins"] as const) for (const reverse of [false, true]) {
    let state = atCache(location);
    person(state).hp = 100;
    person(state, "mio").hp = 80;
    person(state, "ren").hp = 60;
    if (reverse) state.residents.reverse();
    const before = totalResources(state);
    const warehouse = { ...state.resources };
    state = gatherGroup(state, reverse ? ["ren", "mio", "aki"] : ["aki", "mio", "ren"]);
    state = advance(state, 20);
    assert.ok(state.residents.every((resident) => resident.action === null));
    const physicalTotal = totalResources(state);
    assert.equal(physicalTotal.scrap, before.scrap + (location === "shelter" ? 3 : 8));
    assert.equal(physicalTotal.ingredients, before.ingredients + (location === "shelter" ? 2 : 4));
    assert.equal(physicalTotal.medicine, before.medicine + (location === "shelter" ? 0 : 2));
    assert.deepEqual(state.resources, warehouse, "Remote collection cannot add goods to the base warehouse");
    assert.deepEqual(state.inventory!.packs.aki, {
      food: 0,
      ingredients: location === "shelter" ? 2 : 4,
      medicine: location === "shelter" ? 0 : 2,
      scrap: location === "shelter" ? 3 : 8,
    }, "A stable actual collector carries the one shared cache, regardless of iteration order");
    assert.deepEqual(state.inventory!.packs.mio, { food: 0, ingredients: 0, medicine: 0, scrap: 0 });
    assert.deepEqual(state.inventory!.packs.ren, { food: 0, ingredients: 0, medicine: 0, scrap: 0 });
    const events = state.life!.events.filter((entry) => entry.kind === "supply");
    assert.equal(events.length, 1);
    assert.deepEqual(events[0].actors, ["aki", "mio", "ren"]);
    assert.deepEqual(events[0].healthByActor, { aki: 100, mio: 80, ren: 60 });
    assert.equal(events[0].health, 100);
    assert.equal(state.logs.filter((entry) => entry.type === "explore" && entry.time === state.minutes).length, 1);
    assert.equal(getWishProgress(state, "ren").completed, false);
    assert.deepEqual(deserialize(serialize(state)), state);
  }
});

test("A slower injured collector receives no other person's success and ends later with a recovered-cache explanation", () => {
  let state = atCache("shelter");
  person(state, "ren").wounds.arm = 1;
  state = gatherGroup(state);
  assert.equal(person(state, "ren").action?.duration, 25);
  state = advance(state, 20);
  assert.deepEqual(supply(state).actors, ["aki", "mio"]);
  assert.equal(person(state, "ren").action?.progress, 20);
  assert.equal(getWishProgress(state, "ren").completed, false);
  const resources = totalResources(state);
  const inventory = structuredClone(state.inventory);
  state = advance(deserialize(serialize(state)), 5);
  assert.equal(person(state, "ren").action, null);
  assert.deepEqual(totalResources(state), resources);
  assert.deepEqual(state.inventory, inventory, "A late collector neither duplicates nor redistributes an already collected cache");
  assert.equal(state.life!.events.filter((entry) => entry.kind === "supply").length, 1);
  assert.ok(state.logs.some((entry) => entry.title === "物資は回収済み" && entry.actors.includes("ren")));
});

test("Idle or suspended people are not joint collectors, and a recovered suspended job cannot silently resume", () => {
  let bystander = atCache("shelter");
  bystander = advance(gatherGroup(bystander, ["aki", "mio"]), 20);
  assert.deepEqual(supply(bystander).actors, ["aki", "mio"]);
  assert.equal(supply(bystander).healthByActor?.ren, undefined);
  let paused = advance(gatherGroup(atCache("shelter")), 5);
  paused = act(paused, { type: "pause", residentId: "ren" });
  paused = advance(paused, 15);
  assert.deepEqual(supply(paused).actors, ["aki", "mio"]);
  assert.equal(person(paused, "ren").suspended?.progress, 5);
  const before = serialize(paused);
  const result = command(paused, { type: "resume", residentId: "ren" });
  assert.match(result.error ?? "", /回収|取消|取り消/);
  assert.strictEqual(result.state, paused);
  assert.equal(serialize(paused), before);
  const again = command(paused, { type: "assign", residentIds: ["aki"], kind: "gather" });
  assert.ok(again.error);
  assert.deepEqual(deserialize(before), paused);
});

test("Garden work keeps each person's three ingredients and does not become a one-time shared cache", () => {
  let state = still(37);
  for (const resident of state.residents) resident.location = "garden";
  const ingredients = state.resources.ingredients;
  state = advance(gatherGroup(state), 25);
  assert.equal(state.resources.ingredients, ingredients + 9);
  assert.equal(state.flags.safeSuppliesRecovered, false);
  const events = state.life!.events.filter((entry) => entry.kind === "supply");
  assert.equal(events.length, 3);
  for (const event of events) {
    assert.equal(event.actors.length, 1);
    assert.deepEqual(Object.keys(event.healthByActor!), event.actors);
  }
  assert.equal(getWishProgress(state, "ren").completed, true);
});

test("Ren's safe return compares his own collection health rather than the first participant's value", () => {
  for (const [akiHp, renHp, returnHp, completed] of [[100, 60, 60, true], [60, 100, 90, false]] as const) {
    let state = atCache("shelter");
    person(state).hp = akiHp;
    person(state, "ren").hp = renHp;
    state = advance(gatherGroup(state), 20);
    const source = structuredClone(supply(state));
    assert.equal(getWishProgress(state, "ren").completed, false);
    person(state, "ren").hp = returnHp;
    state = finish(assign(state, "move", "ren", "home"), "ren");
    assert.equal(getWishProgress(state, "ren").completed, completed);
    assert.deepEqual(state.life!.events.find((entry) => entry.id === source.id), source);
  }
});

test("Old health-only collection facts work only for their first actor and unknown health is never invented", () => {
  for (const variant of ["ren-first", "other-first", "unknown"] as const) {
    let state = atCache("shelter", variant === "other-first" ? ["aki", "mio", "ren"] : ["ren"]);
    person(state).hp = 60;
    person(state, "ren").hp = 100;
    state = advance(gatherGroup(state, variant === "other-first" ? ["aki", "mio", "ren"] : ["ren"]), 20);
    const source = supply(state);
    delete source.healthByActor;
    if (variant === "unknown") delete source.health;
    state = deserialize(serialize(state));
    assert.equal(supply(state).healthByActor, undefined);
    state = finish(assign(state, "move", "ren", "home"), "ren");
    assert.equal(getWishProgress(state, "ren").completed, variant === "ren-first");
  }
});

test("Gathering and arrival encounters follow the enemy's actual saved location, including conditions changing before completion", () => {
  let occupied = atCache("ruins", ["aki"]);
  occupied.enemy.defeated = false;
  occupied.enemy.location = "ruins";
  const before = serialize(occupied);
  const blocked = command(occupied, { type: "assign", residentIds: ["aki"], kind: "gather" });
  assert.ok(blocked.error);
  assert.strictEqual(blocked.state, occupied);
  assert.equal(serialize(occupied), before);
  const clear = structuredClone(occupied);
  clear.enemy.location = "road";
  const collected = finish(assign(clear, "gather"));
  assert.equal(collected.flags.suppliesRecovered, true);

  let walking = still(38);
  walking.enemy.location = "shelter";
  const reached = advance(assign(walking, "move", "aki", "shelter"), 100);
  assert.equal(person(reached).location, "shelter");
  assert.equal(person(reached).hp, 100);
  assert.match(reached.pauseReason ?? "", /遭遇/);
  const notThere = advance(assign(walking, "move", "aki", "ruins"), 100);
  assert.equal(person(notThere).location, "ruins");
  assert.equal(notThere.minutes, walking.minutes + 100);
  assert.equal(notThere.pauseReason, undefined);

  let changed = structuredClone(clear);
  person(changed).armor = true;
  // Change the guard at the last completion minute so this specifically tests
  // the finish precondition rather than losing the worker in a long battle.
  changed = advance(assign(changed, "gather"), 19);
  changed.enemy.location = "ruins";
  const resources = { ...changed.resources };
  changed = advance(changed, 1);
  assert.ok(person(changed).hp > 0);
  assert.equal(changed.flags.suppliesRecovered, false);
  assert.deepEqual(changed.resources, resources);
  assert.equal(changed.life!.events.some((event) => event.kind === "supply"), false);
  assert.ok(changed.logs.some((entry) => entry.title === "回収を見合わせた"));
});

test("Individual collection health validates strictly and joint completion replays across a saved near-boundary state", () => {
  const valid = advance(gatherGroup(atCache("shelter")), 20);
  const corruptions: Array<(state: GameState) => void> = [
    (state) => { delete supply(state).healthByActor!.ren; },
    (state) => { supply(state).healthByActor!.unknown = 40; },
    (state) => { supply(state).healthByActor!.ren = 101; },
    (state) => { supply(state).healthByActor!.ren = Number.NaN; },
    (state) => { supply(state).health = 1; },
    (state) => { supply(state).kind = "conversation"; },
  ];
  const before = serialize(valid);
  for (const corrupt of corruptions) {
    const broken = structuredClone(valid);
    corrupt(broken);
    assert.throws(() => deserialize(serialize(broken)));
  }
  assert.equal(serialize(valid), before);
  let partial = advance(gatherGroup(atCache("shelter")), 18);
  const whole = advance(partial, 100, { stopAtActionEnd: true });
  partial = deserialize(serialize(partial));
  const split = advance(advance(partial, 1), 1);
  assert.equal(whole.minutes, 500);
  assert.deepEqual(split, whole);
  assert.deepEqual(deserialize(serialize(whole)), whole);
});
