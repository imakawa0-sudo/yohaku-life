import test from "node:test";
import assert from "node:assert/strict";
import { advance, availableResources, command, createGame, deserialize, getCombatants, serialize } from "../src/game/engine.ts";
import { accessibleResources, totalResources } from "../src/game/inventory.ts";
import { previewTimeShortcut, sleepUntilMorningFromControls } from "../src/game/time-controls.ts";
import type { Command, GameState, LocationId } from "../src/game/types.ts";

const person = (s: GameState, id = "aki") => s.residents.find((r) => r.id === id)!;
function act(s: GameState, instruction: Command): GameState {
  const result = command(s, instruction);
  assert.equal(result.error, undefined, result.error);
  return result.state;
}
function night(minutes = 1320): GameState {
  let s = createGame(20261121);
  // Controlled clock/body boundary fixture; journeys below use real commands.
  s.minutes = minutes;
  for (const resident of s.residents) {
    resident.hunger = 100;
    resident.energy = 100;
  }
  for (const id of s.residents.map((resident) => resident.id))
    s = act(s, { type: "policy", residentId: id, policy: "rest" });
  return s;
}
function finish(s: GameState, id: string): GameState {
  const job = person(s, id).action!.id;
  for (let n = 0; n < 1000; n++) {
    if (person(s, id).action?.id !== job) return s;
    s = advance(s, 1);
  }
  assert.fail("The actual journey did not finish");
}
function travel(s: GameState, id: string, target: LocationId): GameState {
  s = act(s, { type: "assign", residentIds: [id], kind: "move", target, ...(target === "village" ? { via: ["meadow" as const] } : {}) });
  s = finish(s, id);
  assert.equal(person(s, id).location, target);
  return s;
}
function freeze(value: unknown): void {
  if (!value || typeof value !== "object" || Object.isFrozen(value)) return;
  for (const child of Object.values(value)) freeze(child);
  Object.freeze(value);
}

test("Real journeys can end with split village, shelter and home sleep without moving physical supplies or a held cook", () => {
  let s = night();
  s = act(s, { type: "transfer", residentId: "aki", from: "base", to: "aki", resource: "food", amount: 2 });
  s = act(s, { type: "transfer", residentId: "ren", from: "base", to: "ren", resource: "food", amount: 1 });
  s = travel(s, "aki", "village");
  s = travel(s, "ren", "shelter");
  s = act(s, { type: "assign", residentIds: ["mio"], kind: "cook" });
  const cooking = structuredClone(person(s, "mio").action);
  const resources = structuredClone(s.resources), inventory = structuredClone(s.inventory), total = totalResources(s);
  const before = serialize(s), seed = s.seed;
  assert.equal(previewTimeShortcut(s, ["aki", "ren", "mio"]).error, undefined);
  assert.equal(serialize(s), before, "Preview does not reserve sleep, move supplies or clear the cook");
  const result = sleepUntilMorningFromControls(s, ["aki", "ren", "mio"]);
  assert.equal(result.error, undefined, result.error);
  const next = result.state;
  assert.equal(next.minutes, 1920);
  assert.deepEqual(next.residents.map((r) => r.location), ["village", "home", "shelter"]);
  assert.deepEqual(next.resources, resources);
  assert.deepEqual(next.inventory, inventory);
  assert.deepEqual(totalResources(next), total);
  assert.deepEqual(person(next, "mio").suspended, cooking);
  assert.equal(availableResources(next).ingredients, next.resources.ingredients - 2);
  assert.equal(accessibleResources(next, "aki").food, 2, "The village has only the traveller's local pack");
  assert.equal(accessibleResources(next, "ren").food, 1, "The shelter cannot borrow from the distant village or base");
  assert.equal(next.seed, seed);
  assert.equal(serialize(s), before);
  assert.deepEqual(deserialize(serialize(next)), next);
});

test("One selected night can recover people in three different safe places on the shared clock", () => {
  const s = night(1560);
  for (const [id, location] of [["aki", "village"], ["ren", "shelter"], ["mio", "kitchen"]] as const) {
    const r = person(s, id);
    r.location = location;
    r.hp = 40;
    r.energy = 20;
    r.wounds = { arm: 2, leg: 1, body: 2 };
  }
  const result = sleepUntilMorningFromControls(s, ["aki", "ren", "mio", "aki"]);
  assert.equal(result.error, undefined, result.error);
  const next = result.state;
  assert.equal(next.minutes, 1920);
  for (const id of ["aki", "ren"]) {
    const r = person(next, id);
    assert.ok(Math.abs(r.hp - 47.2) < 1e-8, "Field sleep recovers health by actual elapsed minutes");
    assert.ok(Math.abs(r.energy - 73.28) < 1e-8);
    assert.deepEqual(r.wounds, { arm: 2, leg: 1, body: 2 }, "Outdoor sleep does not heal wound levels");
    assert.equal(r.action, null);
  }
  assert.ok(Math.abs(person(next, "mio").hp - 54.4) < 1e-8);
  assert.deepEqual(person(next, "mio").wounds, { arm: 1, leg: 0, body: 1 });
  assert.equal(next.logs.filter((entry) => entry.time === 1920 && entry.title === "新しい朝").length, 3);
});

test("Active or paused field sleep continues the same real interrupted phase across save and reload", () => {
  for (const [location, paused] of [["village", false], ["shelter", true]] as const) {
    let s = night(1560);
    person(s).location = location;
    s = act(s, { type: "assign", residentIds: ["aki"], kind: "sleep" });
    assert.equal(person(s).action?.duration, 360);
    s = advance(s, 10);
    const sleepId = person(s).action!.id;
    if (paused) s = act(s, { type: "pause", residentId: "aki" });
    // A controlled, unselected need boundary interrupts actual clock progress.
    person(s, "mio").location = "road";
    person(s, "mio").hunger = 20.01;
    const before = serialize(s);
    freeze(s);
    assert.equal(previewTimeShortcut(s, ["aki"]).error, undefined);
    assert.equal(serialize(s), before);
    const result = sleepUntilMorningFromControls(s, ["aki"]);
    assert.equal(result.error, undefined, result.error);
    assert.equal(result.state.minutes, s.minutes + 1);
    assert.match(result.state.pauseReason ?? "", /ミオ.*空腹/);
    assert.equal(person(result.state).action?.id, sleepId);
    assert.equal(person(result.state).action?.progress, 11);
    assert.equal(person(result.state).suspended, null);
    const restored = deserialize(serialize(result.state));
    assert.deepEqual(restored, result.state);
    const continued = sleepUntilMorningFromControls(restored, ["aki"]);
    assert.equal(continued.error, undefined, continued.error);
    assert.equal(continued.state.minutes, 1920);
    assert.equal(person(continued.state).location, location);
    assert.equal(person(continued.state).action, null);
  }
});

test("A disallowed outdoor site rejects the entire sleep selection without suspending the selected cook", () => {
  for (const location of ["road", "meadow", "ridge", "ruins"] as const) {
    let s = night();
    person(s).location = location;
    s = act(s, { type: "assign", residentIds: ["mio"], kind: "cook" });
    const before = serialize(s);
    const preview = previewTimeShortcut(s, ["mio", "aki"]);
    assert.ok(preview.error);
    const result = sleepUntilMorningFromControls(s, ["mio", "aki"]);
    assert.ok(result.error);
    assert.strictEqual(result.state, s);
    assert.equal(serialize(s), before);
    assert.equal(person(s, "mio").action?.kind, "cook");
    assert.equal(person(s, "mio").suspended, null);
  }
});

test("A current or paused outgoing field journey cannot be discarded by a night preview or shortcut", () => {
  for (const paused of [false, true]) {
    let s = night();
    person(s).location = "village";
    s = act(s, { type: "assign", residentIds: ["aki"], kind: "move", target: "home", via: ["meadow"] });
    if (paused) s = act(s, { type: "pause", residentId: "aki" });
    const before = serialize(s);
    assert.ok(previewTimeShortcut(s, ["aki"]).error);
    const result = sleepUntilMorningFromControls(s, ["aki"]);
    assert.ok(result.error);
    assert.strictEqual(result.state, s);
    assert.equal(serialize(s), before);
    assert.equal((paused ? person(s).suspended : person(s).action)?.kind, "move");
  }
});

test("A current or paused rescue at a field sleep site preserves its actual patient and instruction", () => {
  for (const paused of [false, true]) {
    let s = night();
    person(s).location = "village";
    person(s).hp = 25;
    person(s, "ren").location = "village";
    s = act(s, { type: "assign", residentIds: ["ren"], kind: "rescue", target: "aki" });
    if (paused) s = act(s, { type: "pause", residentId: "ren" });
    const before = serialize(s);
    assert.ok(previewTimeShortcut(s, ["ren"]).error);
    const result = sleepUntilMorningFromControls(s, ["ren"]);
    assert.ok(result.error);
    assert.strictEqual(result.state, s);
    assert.equal(serialize(s), before);
    assert.equal(person(s).location, "village");
    assert.equal((paused ? person(s, "ren").suspended : person(s, "ren").action)?.target, "aki");
  }
});

test("An unselected traveller's new combat interrupts outdoor sleep and preserves its elapsed work", () => {
  let s = night();
  person(s).location = "village";
  s = act(s, { type: "assign", residentIds: ["mio"], kind: "move", target: "ruins" });
  const before = serialize(s);
  const result = sleepUntilMorningFromControls(s, ["aki"]);
  assert.equal(result.error, undefined, result.error);
  const next = result.state;
  assert.equal(next.minutes, s.minutes + 23);
  assert.match(next.pauseReason ?? "", /遭遇/);
  assert.equal(person(next).location, "village");
  assert.equal(person(next).action?.kind, "sleep");
  assert.equal(person(next).action?.progress, 23);
  assert.equal(person(next).action?.duration, 480);
  assert.equal(person(next, "mio").location, "ruins");
  assert.equal(person(next, "mio").hp, 100);
  assert.equal(getCombatants(next).length, 1);
  assert.deepEqual(deserialize(serialize(next)), next);
  const stopped = sleepUntilMorningFromControls(next, ["aki"]);
  assert.match(stopped.error ?? "", /交戦中/);
  assert.strictEqual(stopped.state, next);
  assert.equal(serialize(s), before);
});

test("Outdoor sleep retains meal and hunger35 preconditions before making any selected reservation", () => {
  let s = night(1560);
  person(s).location = "village";
  s = act(s, { type: "transfer", residentId: "ren", from: "base", to: "ren", resource: "food", amount: 1 });
  person(s, "ren").location = "shelter";
  s = act(s, { type: "assign", residentIds: ["ren"], kind: "eat" });
  const eating = serialize(s);
  assert.match(previewTimeShortcut(s, ["aki", "ren"]).error ?? "", /レン.*食事中/);
  assert.ok(sleepUntilMorningFromControls(s, ["aki", "ren"]).error);
  assert.equal(serialize(s), eating);
  s = act(s, { type: "cancel", residentId: "ren" });
  person(s, "ren").hunger = 34.99;
  assert.match(previewTimeShortcut(s, ["aki", "ren"]).error ?? "", /レン.*空腹/);
  person(s, "ren").hunger = 35;
  assert.equal(previewTimeShortcut(s, ["aki", "ren"]).error, undefined);
});
