import test from "node:test";
import assert from "node:assert/strict";
import {
  createGame,
  command,
  advance,
  serialize,
  deserialize,
  availableResources,
  totalResources,
} from "../src/game/engine.ts";
import type { Command, GameState, Resident } from "../src/game/types.ts";

const person = (state: GameState, id = "aki") =>
  state.residents.find((r) => r.id === id)!;
function act(state: GameState, cmd: Command) {
  const result = command(state, cmd);
  assert.equal(result.error, undefined, result.error);
  return result.state;
}
function assign(
  state: GameState,
  kind: NonNullable<Resident["action"]>["kind"],
  id = "aki",
  target?: string,
) {
  return act(state, { type: "assign", residentIds: [id], kind, target });
}
function finish(state: GameState, id = "aki", limit = 1200) {
  const actionId = person(state, id).action?.id;
  assert.notEqual(
    actionId,
    undefined,
    "An action should be queued before finishing",
  );
  for (let n = 0; n < limit && person(state, id).action?.id === actionId; n++)
    state = advance(state, 1);
  assert.notEqual(
    person(state, id).action?.id,
    actionId,
    "Action should finish within the expected horizon",
  );
  return state;
}
function restPolicies(state: GameState) {
  for (const resident of state.residents)
    state = act(state, {
      type: "policy",
      residentId: resident.id,
      policy: "rest",
    });
  return state;
}
function move(state: GameState, target: string, id = "aki") {
  return finish(assign(state, "move", id, target), id);
}

test("Commands and save inspection keep the common clock paused and do not mutate their input", () => {
  const original = createGame(13);
  const snapshot = serialize(original);
  const queued = assign(original, "hobby");
  assert.equal(queued.minutes, 480);
  assert.equal(serialize(original), snapshot);
  assert.equal(deserialize(serialize(queued)).minutes, 480);
  assert.equal(advance(queued, 5).minutes, 485);
});

test("Interrupted cooking preserves its progress and reserved ingredients across save/load and consumes once", () => {
  let state = restPolicies(createGame(31));
  const start = { ...state.resources };
  state = assign(state, "cook", "mio");
  assert.equal(
    state.resources.ingredients,
    start.ingredients,
    "Reservation must not consume ingredients early",
  );
  assert.equal(availableResources(state).ingredients, start.ingredients - 2);
  state = advance(state, 5);
  const progress = person(state, "mio").action!.progress;
  assert.ok(progress > 0);
  state = act(state, { type: "pause", residentId: "mio" });
  assert.equal(person(state, "mio").suspended!.progress, progress);
  assert.equal(person(state, "mio").action, null);
  state = deserialize(serialize(state));
  assert.equal(availableResources(state).ingredients, start.ingredients - 2);
  state = act(state, { type: "resume", residentId: "mio" });
  assert.equal(person(state, "mio").action!.progress, progress);
  state = finish(state, "mio");
  assert.equal(state.resources.ingredients, start.ingredients - 2);
  assert.equal(state.resources.food, start.food + 3);
  assert.equal(
    availableResources(state).ingredients,
    state.resources.ingredients,
  );
  const after = deserialize(serialize(state));
  assert.equal(
    after.resources.food,
    state.resources.food,
    "A completed job must not produce twice after loading",
  );
});

test("Cancelling a suspended job releases reservations and a shared stove cannot be double-booked", () => {
  let state = restPolicies(createGame(3));
  const start = state.resources.ingredients;
  state = assign(state, "cook", "mio");
  const contested = command(state, {
    type: "assign",
    residentIds: ["aki"],
    kind: "cook",
  });
  assert.ok(contested.error, "A second cook needs a clear contention reason");
  state = act(state, { type: "pause", residentId: "mio" });
  state = act(state, { type: "cancel", residentId: "mio" });
  assert.equal(availableResources(state).ingredients, start);
  assert.equal(person(state, "mio").suspended, null);
  assert.equal(state.resources.ingredients, start);
  state = assign(state, "cook");
  assert.equal(person(state).action?.kind, "cook");
});

test("A direct job remains the only primary action while other residents use the same elapsed time", () => {
  let state = restPolicies(createGame(8));
  state = assign(state, "cook", "mio");
  state = assign(state, "hobby");
  state = advance(state, 5);
  assert.equal(state.minutes, 485);
  assert.equal(person(state).action?.kind, "hobby");
  assert.equal(person(state, "mio").action?.kind, "cook");
  assert.ok(person(state).action!.progress > 0);
  assert.ok(person(state, "mio").action!.progress > 0);
  assert.notEqual(person(state).action!.id, person(state, "mio").action!.id);
});

test("Seeded simulation reproduces the same state after save/load and safe time batching", () => {
  let state = restPolicies(createGame(190));
  state = assign(state, "hobby");
  const whole = advance(state, 10);
  let split = deserialize(serialize(state));
  for (let i = 0; i < 10; i++) split = advance(split, 1);
  assert.deepEqual(split, whole);
  assert.deepEqual(deserialize(serialize(whole)), whole);
});

test("Movement has a real interval and retains one location along the connected route", () => {
  let state = restPolicies(createGame(14));
  const origin = person(state).location;
  state = assign(state, "move", "aki", "road");
  assert.equal(person(state).location, origin);
  assert.ok(person(state).action!.duration > 0);
  state = finish(state);
  assert.equal(person(state).location, "road");
  assert.ok(state.minutes > 480);
  assert.equal(new Set(state.residents.map((r) => r.id)).size, 3);
});

test("A peaceful day leaves hobby, home and relationship results in the next morning state", () => {
  let state = restPolicies(createGame(2026));
  state = finish(assign(state, "hobby"));
  assert.equal(state.flags.hobbyFinished, true);
  state = finish(assign(state, "decorate"));
  assert.equal(state.flags.decorated, true);
  const before = person(state).relations.mio.closeness;
  state = finish(assign(state, "socialize", "aki", "mio"));
  assert.ok(person(state).relations.mio.closeness > before);
  // Spend the day awake and actually eat before the warning zone. The
  // protagonist does not autonomously feed themself like the companions do.
  let meals = 0;
  while (state.minutes < 1440) {
    if (person(state).hunger < 45) {
      state = finish(assign(state, "eat"));
      meals++;
    } else {
      state = advance(state, Math.min(30, 1440 - state.minutes));
      assert.doesNotMatch(state.pauseReason ?? "", /空腹|活力/);
    }
  }
  assert.ok(meals > 0, "A peaceful whole day includes real meals");
  state = assign(state, "sleep");
  assert.equal(person(state).action?.duration, 480);
  state = finish(state, "aki", 500);
  assert.equal(state.minutes, 1440 + 480);
  assert.equal(state.flags.hobbyFinished, true);
  assert.equal(state.flags.decorated, true);
  assert.ok(person(state).relations.mio.closeness > before);
  assert.ok(state.logs.some((log) => log.type === "social"));
});

test("The safe side route brings supplies home without requiring combat or injuries", () => {
  let state = restPolicies(createGame(2026));
  state = move(state, "shelter");
  const before = totalResources(state);
  const warehouse = { ...state.resources };
  state = finish(assign(state, "gather"));
  assert.equal(totalResources(state).scrap, before.scrap + 3);
  assert.equal(totalResources(state).ingredients, before.ingredients + 2);
  assert.deepEqual(state.resources, warehouse, "Field supplies remain with their collector");
  assert.equal(state.inventory!.packs.aki.scrap, 3);
  assert.equal(state.inventory!.packs.aki.ingredients, 2);
  state = move(state, "home");
  assert.deepEqual(state.resources, warehouse, "Arriving home does not silently deposit personal supplies");
  const beforeDeposit = totalResources(state);
  for (const resource of ["scrap", "ingredients"] as const) {
    state = act(state, { type: "transfer", residentId: "aki", from: "aki", to: "base", resource, amount: state.inventory!.packs.aki[resource] });
  }
  assert.deepEqual(totalResources(state), beforeDeposit, "Depositing transfers physical stock rather than creating it");
  assert.equal(state.resources.scrap, warehouse.scrap + 3);
  assert.equal(state.resources.ingredients, warehouse.ingredients + 2);
  assert.equal(person(state).location, "home");
  assert.equal(person(state).hp, 100);
  assert.equal(state.enemy.defeated, false);
  assert.equal(state.flags.safeSuppliesRecovered, true);
});

test("Danger can be approached and left without a mandatory fight", () => {
  let state = restPolicies(createGame(2026));
  state = move(state, "road");
  const start = person(state).hp;
  state = move(state, "home");
  assert.equal(person(state).hp, start);
  assert.equal(state.enemy.defeated, false);
  assert.equal(state.flags.suppliesRecovered, false);
  assert.equal(person(state).location, "home");
});

test("Save validation rejects incompatible, malformed and corrupt nested states", () => {
  const valid = createGame(2026);
  assert.throws(() => deserialize("not json"));
  assert.throws(() => deserialize(JSON.stringify({ ...valid, version: 99 })));
  assert.throws(() => deserialize(JSON.stringify({ ...valid, residents: [] })));
  const corrupt = structuredClone(valid);
  corrupt.residents[0].hp = Number.NaN;
  assert.throws(() => deserialize(JSON.stringify(corrupt)));
  const badResources = structuredClone(valid);
  badResources.resources.ingredients = -50;
  assert.throws(() => deserialize(JSON.stringify(badResources)));
  assert.deepEqual(deserialize(serialize(valid)), valid);
});

test("Prepared companions drive off the guard, recover supplies and return on the shared clock", () => {
  let state = restPolicies(createGame(2026));
  for (const id of ["aki", "ren"])
    state = act(state, {
      type: "equip",
      residentId: id,
      weapon: "spear",
      armor: true,
    });
  state = act(state, {
    type: "assign",
    residentIds: ["aki", "ren"],
    kind: "move",
    target: "ruins",
  });
  state = finish(state);
  assert.equal(person(state).location, "ruins");
  assert.equal(person(state, "ren").location, "ruins");
  assert.ok(state.pauseReason?.includes("遭遇"));
  assert.equal(
    person(state).hp,
    100,
    "Contact should pause before the first hit",
  );
  state = act(state, {
    type: "assign",
    residentIds: ["aki", "ren"],
    kind: "attack",
  });
  for (let n = 0; n < 30 && !state.enemy.defeated; n++)
    state = advance(state, 1);
  assert.equal(state.enemy.defeated, true);
  assert.ok(person(state).hp > 0 && person(state, "ren").hp > 0);
  state = finish(assign(state, "gather"));
  assert.equal(state.flags.suppliesRecovered, true);
  state = act(state, {
    type: "assign",
    residentIds: ["aki", "ren"],
    kind: "move",
    target: "home",
  });
  state = finish(state);
  assert.equal(person(state).location, "home");
  assert.equal(person(state, "ren").location, "home");
  assert.ok(totalResources(state).scrap >= 12);
  assert.equal(state.inventory!.packs.aki.scrap, 8);
  assert.equal(state.resources.scrap, 4, "Recovered goods stay carried until explicitly deposited");
});

test("An unconscious protagonist can be rescued, treated and assigned lighter work without ending control", () => {
  let state = restPolicies(createGame(2026));
  state = move(state, "ruins");
  for (let n = 0; n < 30 && person(state).hp > 0; n++)
    state = advance(state, 1);
  assert.equal(person(state).hp, 0);
  assert.equal(state.ended, false, "Healthy companions must retain control");
  assert.ok(state.pauseReason?.includes("倒れ"));
  assert.ok(Object.values(person(state).wounds).some((value) => value > 0));
  assert.ok(
    !person(state, "mio").memories.some((memory) =>
      memory.includes("意識を失った"),
    ),
    "A remote resident cannot witness the fall",
  );
  state = move(state, "ruins", "ren");
  state = assign(state, "attack", "ren");
  for (let n = 0; n < 20 && !state.enemy.defeated; n++)
    state = advance(state, 1);
  assert.equal(state.enemy.defeated, true);
  state = finish(assign(state, "rescue", "ren", "aki"), "ren");
  assert.equal(person(state).location, "home");
  assert.equal(person(state, "ren").location, "home");
  assert.ok(person(state).hp < 40, "Returning home must not reset injuries");
  assert.ok(Object.values(person(state).wounds).some((value) => value > 0));
  const woundsBefore = Object.values(person(state).wounds).reduce(
    (a, b) => a + b,
    0,
  );
  const medicineBefore = state.resources.medicine;
  state = finish(assign(state, "heal", "mio", "aki"), "mio");
  assert.ok(person(state).hp >= 45);
  assert.equal(state.resources.medicine, medicineBefore - 1);
  assert.ok(
    Object.values(person(state).wounds).reduce((a, b) => a + b, 0) <
      woundsBefore,
  );
  state = act(state, { type: "policy", residentId: "aki", policy: "rest" });
  state = assign(state, "rest");
  assert.equal(person(state).action?.kind, "rest");
  assert.ok(state.logs.some((log) => log.title.includes("仲間を連れて")));
  assert.ok(
    person(state).relations.mio.trust >
      createGame(2026).residents[0].relations.mio.trust,
  );
});

test("Defence takes the incoming hit and reduces real damage rather than just changing the log", () => {
  let start = restPolicies(createGame(71));
  start = act(start, {
    type: "assign",
    residentIds: ["aki", "ren"],
    kind: "move",
    target: "ruins",
  });
  start = finish(start);
  let defended = assign(start, "defend", "ren");
  defended = advance(defended, 1);
  const defenderLoss = person(start, "ren").hp - person(defended, "ren").hp;
  assert.equal(
    person(defended).hp,
    person(start).hp,
    "A defender should intercept the hit aimed at the party",
  );
  assert.ok(
    defenderLoss > 0 && defenderLoss <= 6,
    "Defensive posture and armor should reduce the intercepted hit",
  );
  assert.ok(defended.logs.at(-1)?.text.includes("援護"));
});

test("Long advancement stops at danger and advances base work only by the elapsed world time", () => {
  let state = restPolicies(createGame(44));
  state = assign(state, "hobby", "mio");
  state = assign(state, "move", "aki", "ruins");
  const before = state.minutes;
  state = advance(state, 200);
  assert.ok(state.pauseReason?.includes("遭遇"));
  assert.ok(state.minutes - before < 200);
  assert.equal(person(state).hp, 100);
  assert.equal(person(state, "mio").action?.progress, state.minutes - before);
});

test("A paused place-bound job cannot be resumed after returning to a different location", () => {
  let state = restPolicies(createGame(2026));
  state = move(state, "shelter");
  state = assign(state, "gather");
  state = advance(state, 5);
  state = act(state, { type: "pause", residentId: "aki" });
  const savedProgress = person(state).suspended!.progress;
  state = move(state, "home");
  const result = command(state, { type: "resume", residentId: "aki" });
  assert.ok(
    result.error,
    "Gathering must resume at the original gathering site",
  );
  assert.equal(person(result.state).suspended!.progress, savedProgress);
  assert.equal(result.state.resources.scrap, createGame(2026).resources.scrap);
});

test("Interrupted travel is replanned from the actual location instead of teleporting to its old route", () => {
  let state = restPolicies(createGame(2026));
  state = assign(state, "move", "aki", "road");
  state = advance(state, 5);
  state = act(state, { type: "pause", residentId: "aki" });
  state = move(state, "garden");
  assert.equal(person(state).location, "garden");
  state = act(state, { type: "resume", residentId: "aki" });
  state = advance(state, 2);
  assert.equal(person(state).location, "garden");
  state = advance(state, 1);
  assert.equal(
    person(state).location,
    "home",
    "The replanned path must cross the connected home node",
  );
  state = finish(state);
  assert.equal(person(state).location, "road");
});

test("A rescue patient has a single carrier even when a rescue is paused or the patient is conscious", () => {
  let state = restPolicies(createGame(2026));
  for (const resident of state.residents) resident.location = "road";
  person(state).hp = 20;
  person(state).wounds.leg = 2;
  state = assign(state, "rescue", "mio", "aki");
  const patientMove = command(state, {
    type: "assign",
    residentIds: ["aki"],
    kind: "move",
    target: "home",
  });
  assert.ok(
    patientMove.error,
    "The patient cannot move independently during transport",
  );
  state = act(state, { type: "pause", residentId: "mio" });
  const otherCarrier = command(state, {
    type: "assign",
    residentIds: ["ren"],
    kind: "rescue",
    target: "aki",
  });
  assert.ok(
    otherCarrier.error,
    "A paused rescue must retain the patient reservation",
  );
  state = act(state, { type: "cancel", residentId: "mio" });
  state = assign(state, "rescue", "ren", "aki");
  assert.equal(person(state, "ren").action?.target, "aki");
});

test("Imported location and reservation corruption is rejected before it can enter the simulation", () => {
  const initial = createGame(2026);
  const inheritedLocation = structuredClone(initial);
  (inheritedLocation.residents[0] as unknown as { location: string }).location =
    "toString";
  assert.throws(() => deserialize(JSON.stringify(inheritedLocation)));
  const cook = assign(initial, "cook", "mio");
  const missingReservation = structuredClone(cook);
  delete person(missingReservation, "mio").action!.reserved;
  assert.throws(() => deserialize(JSON.stringify(missingReservation)));
  const partialReservation = structuredClone(cook);
  person(partialReservation, "mio").action!.reserved = { ingredients: 1 };
  assert.throws(() => deserialize(JSON.stringify(partialReservation)));
});

test("Repeated cooking commands cannot create a state that its own save loader rejects", () => {
  let state = restPolicies(createGame(2026));
  state = assign(state, "cook", "mio");
  const repeated = command(state, {
    type: "assign",
    residentIds: ["mio"],
    kind: "cook",
  });
  assert.deepEqual(deserialize(serialize(repeated.state)), repeated.state);
  const cookingJobs = repeated.state.residents
    .flatMap((r) => [r.action, r.suspended])
    .filter((a) => a?.kind === "cook");
  assert.equal(
    cookingJobs.length,
    1,
    "Only one stove job may reserve ingredients at a time",
  );
});

test("Sleep started after midnight reaches the coming morning instead of skipping an extra day", () => {
  let state = restPolicies(createGame(2026));
  state.minutes = 1440 + 150;
  state = assign(state, "sleep");
  assert.equal(person(state).action?.duration, 330);
  state = advance(state, 330);
  assert.equal(state.minutes, 1440 + 480);
  assert.equal(person(state).action, null);
  assert.match(state.pauseReason ?? "", /朝になりました/);
});

test("Import rejects unknown or self relationship keys before malformed entries can reach the resident screen", () => {
  const current = createGame(2026);
  const before = serialize(current);
  const cases = [
    { key: "unknown", value: null },
    { key: "unknown", value: { closeness: 12, trust: 34 } },
    { key: "aki", value: null },
    { key: "aki", value: { closeness: 12, trust: 34 } },
    { key: "__proto__", value: null },
    { key: "mio", value: null },
  ];
  for (const { key, value } of cases) {
    const imported = JSON.parse(before) as GameState;
    Object.defineProperty(person(imported).relations, key, {
      value,
      enumerable: true,
      configurable: true,
    });
    assert.throws(
      () => deserialize(serialize(imported)),
      /保存データの内容が不正/,
      `Invalid relationship key ${key} must be rejected`,
    );
    assert.equal(
      serialize(current),
      before,
      "Rejected imports leave the current world untouched",
    );
  }
  assert.deepEqual(
    deserialize(before),
    current,
    "Existing version-1 saves remain compatible",
  );
  const cooking = assign(current, "cook", "mio");
  assert.deepEqual(
    deserialize(serialize(cooking)),
    cooking,
    "Current in-progress saves still load",
  );
});
