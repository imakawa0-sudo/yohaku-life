import test from "node:test";
import assert from "node:assert/strict";
import { advance, availableResources, command, createGame, deserialize, serialize, tradeSelection } from "../src/game/engine.ts";
import { deriveAttention } from "../src/game/presentation.ts";
import type { ActionKind, Command, GameState } from "../src/game/types.ts";

const person = (state: GameState, id = "aki") => state.residents.find((resident) => resident.id === id)!;
function act(state: GameState, instruction: Command): GameState {
  const result = command(state, instruction);
  assert.equal(result.error, undefined, result.error);
  return result.state;
}
function assign(state: GameState, kind: ActionKind, id = "mio", target?: string): GameState {
  return act(state, { type: "assign", residentIds: [id], kind, target });
}
function finish(state: GameState, id = "mio"): GameState {
  const actionId = person(state, id).action?.id;
  assert.notEqual(actionId, undefined);
  for (let step = 0; step < 200; step++) {
    if (person(state, id).action?.id !== actionId) return state;
    state = advance(state, 1);
  }
  assert.fail("The real action did not finish");
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
function reject(state: GameState, instruction: Command) {
  const before = serialize(state);
  const result = command(state, instruction);
  assert.ok(result.error, "An obsolete or impossible rescue must be rejected");
  assert.equal(result.state, state);
  assert.equal(serialize(state), before);
  return result.error;
}
function pausedRescue(progress = 1, origin: "road" | "ruins" = "road"): GameState {
  let state = advance(assign(still(110), "cook", "aki"), 5);
  state = act(state, { type: "pause", residentId: "aki" });
  state.enemy.defeated = true; // Controlled safe route; all jobs and travel are real commands.
  state = act(state, { type: "assign", residentIds: ["aki", "mio"], kind: "move", target: origin });
  state = finish(state, "aki");
  person(state).hp = 20; // Controlled initial casualty, not a fabricated action.
  state = advance(assign(state, "rescue", "mio", "aki"), progress);
  return act(state, { type: "pause", residentId: "mio" });
}
function staleAtHome(): GameState {
  const state = pausedRescue();
  // An old accepted save can hold a historical rescue after the patient returned.
  person(state).location = "home";
  person(state, "mio").location = "home";
  return deserialize(serialize(state));
}

test("A genuine outside rescue resumes the same job after its route reaches the road, preserving patient work and consuming nothing twice", () => {
  let state = pausedRescue(3, "ruins");
  assert.equal(person(state).location, "ruins", "Three minutes cannot teleport a patient across a longer edge");
  assert.equal(person(state, "mio").location, "ruins");
  const firstLeg = person(state, "mio").suspended!.segmentDuration!;
  assert.ok(firstLeg > 3);
  const beforeLeg = state.minutes;
  state = act(state, { type: "resume", residentId: "mio" });
  state = advance(state, firstLeg - 3);
  assert.equal(state.minutes, beforeLeg + firstLeg - 3);
  assert.equal(person(state).location, "road");
  assert.equal(person(state, "mio").location, "road");
  state = act(state, { type: "pause", residentId: "mio" });
  const rescue = structuredClone(person(state, "mio").suspended);
  const patientWork = structuredClone(person(state).suspended);
  assert.equal(rescue?.origin, "ruins");
  assert.equal(rescue?.progress, firstLeg);
  assert.equal(rescue?.segment, 1);
  const before = serialize(state);
  state = act(state, { type: "resume", residentId: "mio" });
  assert.deepEqual(person(state, "mio").action, rescue);
  assert.equal(person(state, "mio").suspended, null);
  const restored = deserialize(before);
  assert.equal(state.minutes, restored.minutes);
  assert.equal(state.seed, restored.seed);
  assert.equal(state.nextId, restored.nextId);
  assert.deepEqual(person(state), person(restored));
  assert.deepEqual(availableResources(state), availableResources(restored));
  const replay = finish(act(deserialize(before), { type: "resume", residentId: "mio" }));
  state = finish(state);
  assert.deepEqual(state, replay);
  assert.equal(person(state).location, "home");
  assert.equal(person(state, "mio").location, "home");
  assert.deepEqual(person(state).suspended, patientWork);
  assert.equal(state.life!.events.filter((event) => event.kind === "rescue").length, 1);
  assert.deepEqual(advance(deserialize(serialize(state)), 1).resources, state.resources);
});

test("A version-1 pathless rescue keeps its recorded legacy timing while new rescues use actual routes", () => {
  const legacy = pausedRescue(1, "ruins");
  legacy.version = 1;
  delete legacy.inventory;
  delete legacy.region;
  const oldJob = person(legacy, "mio").suspended!;
  delete oldJob.path;
  delete oldJob.segment;
  delete oldJob.segmentProgress;
  delete oldJob.segmentDuration;
  oldJob.duration = 25;
  const input = serialize(legacy);
  let state = deserialize(input);
  assert.equal(state.version, 3);
  assert.equal(person(state, "mio").suspended?.progress, 1);
  assert.equal(person(state, "mio").suspended?.duration, 25);
  assert.equal(person(state, "mio").suspended?.path, undefined);
  state = advance(act(state, { type: "resume", residentId: "mio" }), 2);
  assert.equal(person(state).location, "road");
  assert.equal(person(state, "mio").location, "road");
  assert.equal(person(state, "mio").action?.progress, 3);
  state = finish(state);
  assert.equal(person(state).location, "home");
  assert.equal(person(state, "mio").location, "home");
  assert.equal(state.life!.events.filter((event) => event.kind === "rescue").length, 1);
  assert.equal(serialize(legacy), input, "Migration and continuation never edit the imported source object");
});

test("The audited long command route cannot resume an old rescue after both patient and original carrier have returned home", () => {
  let state = still(111);
  for (const resident of state.residents) resident.location = "road";
  person(state).hp = 0;
  person(state).hunger = 0;
  person(state, "mio").hp = 30.05;
  person(state, "mio").hunger = 0;
  state = advance(assign(state, "rescue", "mio", "aki"), 1);
  const oldId = person(state, "mio").action!.id;
  state = act(state, { type: "pause", residentId: "mio" });
  state = advance(state, 610);
  assert.equal(person(state, "mio").hp, 0);
  state = finish(assign(state, "rescue", "ren", "aki"), "ren");
  state = finish(assign(state, "move", "ren", "road"), "ren");
  state = finish(assign(state, "rescue", "ren", "mio"), "ren");
  state = advance(state, 1);
  state = finish(assign(state, "heal", "ren", "mio"), "ren");
  assert.equal(person(state).location, "home");
  assert.equal(person(state, "mio").location, "home");
  assert.equal(person(state, "mio").suspended?.id, oldId);
  assert.ok(person(state, "mio").hp > 30);
  reject(state, { type: "assign", residentIds: ["mio"], kind: "rescue", target: "aki" });
  reject(state, { type: "resume", residentId: "mio" });
  const rescueCount = state.life!.events.filter((event) => event.kind === "rescue").length;
  const returnCount = state.life!.events.filter((event) => event.kind === "return").length;
  state = advance(deserialize(serialize(state)), 3);
  assert.equal(person(state).location, "home");
  assert.equal(person(state, "mio").location, "home");
  assert.equal(state.life!.events.filter((event) => event.kind === "rescue").length, rescueCount);
  assert.equal(state.life!.events.filter((event) => event.kind === "return").length, returnCount);
  assert.equal(person(state, "mio").suspended?.id, oldId);
});

test("Resuming reads the patient's current health and permits the exact heavy-casualty boundary only", () => {
  const state = pausedRescue();
  person(state).hp = 35.0001;
  reject(state, { type: "resume", residentId: "mio" });
  person(state).hp = 35;
  const rescue = structuredClone(person(state, "mio").suspended);
  const resumed = act(deserialize(serialize(state)), { type: "resume", residentId: "mio" });
  assert.deepEqual(person(resumed, "mio").action, rescue);
  assert.equal(person(resumed).hp, 35);
});

test("A self target, missing target, moved patient, or already-home patient is rejected without changing either job slot", () => {
  for (const change of ["self", "missing", "moved", "base"] as const) {
    const state = pausedRescue();
    if (change === "self") person(state, "mio").suspended!.target = "mio";
    if (change === "missing") person(state, "mio").suspended!.target = "missing";
    if (change === "moved") person(state).location = "shelter";
    if (change === "base") { person(state).location = "home"; person(state, "mio").location = "home"; }
    // Missing references are a defensive command boundary, not a valid imported save.
    reject(state, { type: "resume", residentId: "mio" });
  }
});

test("An awake second carrier's active or paused rescue blocks the old job, while an unconscious old carrier does not prevent actual rescue", () => {
  for (const pauseSecond of [false, true]) {
    let state = pausedRescue();
    person(state, "mio").hp = 0;
    person(state, "ren").location = "road";
    state = assign(state, "rescue", "ren", "aki");
    if (pauseSecond) state = act(state, { type: "pause", residentId: "ren" });
    person(state, "mio").hp = 50;
    reject(state, { type: "resume", residentId: "mio" });
    reject(state, { type: "assign", residentIds: ["aki"], kind: "move", target: "home" });
  }
});

test("Rescue resume rechecks the carrier's present strength without replanning or issuing a new world ID", () => {
  for (const change of ["weak", "arm"] as const) {
    const state = pausedRescue();
    if (change === "weak") person(state, "mio").hp = 29.99;
    else person(state, "mio").wounds.arm = 3;
    reject(state, { type: "resume", residentId: "mio" });
  }
  const state = pausedRescue();
  person(state, "mio").hp = 30;
  person(state, "mio").wounds.arm = 2;
  const action = structuredClone(person(state, "mio").suspended);
  const resumed = act(state, { type: "resume", residentId: "mio" });
  assert.deepEqual(person(resumed, "mio").action, action);
  assert.equal(resumed.nextId, state.nextId);
});

test("An obsolete rescue remains cancellable and cancelling it releases only the claim, permitting a valid replacement rescue", () => {
  let state = pausedRescue();
  const old = person(state, "mio").suspended!;
  person(state).hp = 80;
  reject(state, { type: "resume", residentId: "mio" });
  state = act(state, { type: "cancel", residentId: "mio", actionId: old.id });
  assert.equal(person(state, "mio").suspended, null);
  person(state).hp = 20;
  person(state, "ren").location = "road";
  state = finish(assign(deserialize(serialize(state)), "rescue", "ren", "aki"), "ren");
  assert.equal(state.life!.events.filter((event) => event.kind === "rescue").length, 1);
  assert.equal(person(state).location, "home");
  assert.equal(availableResources(state).ingredients, state.resources.ingredients - 2);
});

test("A patient's current home location frees their own meal, move and trade from another person's stale rescue claim", () => {
  for (const active of [false, true]) {
    let state = staleAtHome();
    if (active) { person(state, "mio").action = person(state, "mio").suspended; person(state, "mio").suspended = null; }
    const claim = structuredClone(person(state, "mio"));
    const eating = assign(state, "eat", "aki");
    assert.equal(person(eating).action?.kind, "eat");
    assert.deepEqual(person(eating, "mio"), claim);
    assert.equal(person(assign(state, "move", "aki", "kitchen")).action?.kind, "move");
    state.minutes = 2159; // Controlled pre-arrival clock; the new game's schedule is still valid.
    state = advance(state, 1);
    if (active) {
      // Import an old active claim at the open visit, before a new tick can clean it up.
      person(state, "mio").action = structuredClone(claim.action);
      state = deserialize(serialize(state));
      assert.equal(person(state, "mio").action?.kind, "rescue");
    }
    const traded = tradeSelection(state, ["aki"], state.trade!.visit!.id, "meal-for-scrap");
    assert.equal(traded.error, undefined, traded.error);
    assert.equal(traded.state.resources.food, state.resources.food - 2);
    assert.equal(traded.state.resources.scrap, state.resources.scrap + 1);
    assert.deepEqual(traded.state.residents, state.residents);
    const carrierTrade = tradeSelection(state, ["mio"], state.trade!.visit!.id, "meal-for-scrap");
    assert.ok(carrierTrade.error, "The carrier's own saved rescue still limits their trading");
  }
});

test("An imported old active rescue with a patient already home stops before its route stage without fake rescue, return, or relationship effects", () => {
  let state = staleAtHome();
  person(state, "mio").action = person(state, "mio").suspended;
  person(state, "mio").suspended = null;
  const relations = structuredClone(state.residents.map((resident) => resident.relations));
  const patientWork = structuredClone(person(state).suspended);
  const resources = { ...state.resources };
  state = advance(deserialize(serialize(state)), 3);
  assert.equal(person(state, "mio").action, null);
  assert.equal(person(state).location, "home");
  assert.equal(person(state, "mio").location, "home");
  assert.deepEqual(person(state).suspended, patientWork);
  assert.deepEqual(state.resources, resources);
  assert.deepEqual(state.residents.map((resident) => resident.relations), relations);
  assert.equal(state.life?.events.filter((event) => ["rescue", "return"].includes(event.kind)).length ?? 0, 0);
  assert.deepEqual(deserialize(serialize(state)), state);
});

test("Attention ignores obsolete home rescue claims while preserving actual body warnings and valid outside transport", () => {
  const state = staleAtHome();
  person(state).hp = 100;
  assert.ok(!deriveAttention(state).some((item) => item.residentId === "aki"));
  person(state).hp = 20;
  person(state).wounds.arm = 1;
  const injured = deriveAttention(state).filter((item) => item.residentId === "aki");
  assert.deepEqual(injured.map((item) => item.kind), ["treatment"]);
  person(state).hp = 0;
  assert.equal(deriveAttention(state).find((item) => item.residentId === "aki")?.kind, "recovery");
  const outside = pausedRescue();
  const attention = deriveAttention(outside).find((item) => item.residentId === "aki")!;
  assert.equal(attention.kind, "rescue");
  assert.match(attention.detail, /中断中/);
});
