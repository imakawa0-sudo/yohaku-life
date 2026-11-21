import test from "node:test";
import assert from "node:assert/strict";
import {
  advance,
  availableResources,
  command,
  createGame,
  deserialize,
  estimateTravelMinutes,
  getAutonomyDecision,
  getAutonomyReason,
  serialize,
} from "../src/game/engine.ts";
import { assignSelection } from "../src/game/selection.ts";
import type { ActionKind, Command, GameState } from "../src/game/types.ts";

const person = (state: GameState, id = "aki") =>
  state.residents.find((resident) => resident.id === id)!;

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
  assert.fail("The reserved action did not finish");
}

function settled(seed = 20261120): GameState {
  const state = createGame(seed);
  state.resources.food = 12;
  state.resources.ingredients = 12;
  for (const resident of state.residents) {
    resident.hunger = 100;
    resident.energy = 100;
  }
  return state;
}

function toolsAtKitchen(seed: number): GameState {
  let state = settled(seed);
  person(state).location = "kitchen";
  person(state, "mio").location = "road";
  person(state, "ren").location = "road";
  state = finish(assign(state, "project", "aki", "kitchen-tools"));
  state = finish(assign(state, "move", "aki", "home"));
  person(state, "mio").location = "home";
  state.resources.food = 0;
  state.resources.ingredients = 10;
  return state;
}

const gathering = (state: GameState) => state.residents.filter((resident) =>
  resident.action?.kind === "gather" || resident.action?.autonomyReason?.code === "gathering",
);

function conversation(state: GameState, ids = ["aki", "mio", "ren"]): GameState {
  const result = assignSelection(state, ids, "socialize");
  assert.equal(result.error, undefined, result.error);
  return advance(result.state, 20);
}

test("Autonomy decisions, stored reasons, and travel estimates are pure and never assign the protagonist", () => {
  const state = settled(10);
  const before = serialize(state);
  assert.equal(getAutonomyDecision(state, "aki"), undefined);
  getAutonomyDecision(state, "mio");
  getAutonomyDecision(state, "ren");
  getAutonomyReason(null);
  assert.equal(estimateTravelMinutes(state, "mio", "kitchen"), 3);
  assert.equal(serialize(state), before);
  const progressed = advance(state, 1);
  assert.equal(person(progressed).action, null);
  const action = person(progressed, "mio").action;
  assert.ok(action?.automatic);
  assert.ok(action.autonomyReason);
  assert.equal(action.autonomyReason.decidedAt, progressed.minutes);
  const stored = serialize(progressed);
  assert.ok(getAutonomyReason(action));
  getAutonomyDecision(progressed, "mio");
  assert.equal(serialize(progressed), stored);
});

test("Direct work, suspended reservations, and an outside companion are not replaced by autonomy", () => {
  let state = settled(11);
  state = assign(state, "hobby");
  const heroWork = person(state).action!.id;
  assert.equal(person(state).action!.duration, 45);
  state = assign(state, "cook", "mio");
  state = advance(state, 3);
  state = act(state, { type: "pause", residentId: "mio" });
  const paused = structuredClone(person(state, "mio").suspended);
  person(state, "ren").location = "road";
  assert.equal(getAutonomyDecision(state, "mio"), undefined);
  assert.equal(getAutonomyDecision(state, "ren"), undefined);
  state = advance(state, 10);
  assert.equal(person(state).action?.id, heroWork);
  assert.equal(person(state).action?.progress, 13);
  assert.deepEqual(person(state, "mio").suspended, paused);
  assert.equal(person(state, "mio").action, null);
  assert.equal(availableResources(state).ingredients, state.resources.ingredients - 2);
  assert.equal(person(state, "ren").location, "road");
  assert.equal(person(state, "ren").action, null);
});

test("The regular gatherer handles one shortage without sending a second healthy resident for the same supply", () => {
  let state = settled(12);
  state.resources.food = 0;
  state.resources.ingredients = 0;
  state = advance(state, 1);
  assert.equal(gathering(state).length, 1);
  assert.equal(gathering(state)[0].id, "ren");
  assert.equal(person(state, "ren").action?.kind, "move");
  assert.equal(person(state, "ren").action?.target, "garden");
  state = advance(state, 5);
  assert.equal(person(state, "ren").location, "garden");
  assert.equal(person(state, "ren").action?.kind, "gather");
  assert.equal(gathering(state).length, 1);
  assert.equal(state.resources.ingredients, 0, "Future harvest is not free inventory");
});

test("An unavailable or paused main gatherer allows a real substitute without stealing the main person's orders", () => {
  for (const unavailable of ["outside", "direct-work", "paused-gather", "rest-policy", "cook-policy"] as const) {
    let state = settled(13);
    state.resources.food = 0;
    state.resources.ingredients = 0;
    if (unavailable === "outside") person(state, "ren").location = "road";
    if (unavailable === "direct-work") state = assign(state, "hobby", "ren");
    if (unavailable === "rest-policy") state = act(state, { type: "policy", residentId: "ren", policy: "rest" });
    if (unavailable === "cook-policy") state = act(state, { type: "policy", residentId: "ren", policy: "cook" });
    if (unavailable === "paused-gather") {
      person(state, "ren").location = "garden";
      state = assign(state, "gather", "ren");
      state = act(state, { type: "pause", residentId: "ren" });
    }
    const oldActionId = person(state, "ren").action?.id;
    const oldPaused = structuredClone(person(state, "ren").suspended);
    state = advance(state, 1);
    assert.equal(person(state, "mio").action?.kind, "move", unavailable);
    assert.equal(person(state, "mio").action?.target, "garden", unavailable);
    assert.equal(person(state, "mio").action?.autonomyReason?.code, "gathering", unavailable);
    assert.equal(person(state, "ren").action?.id, oldActionId, unavailable);
    assert.deepEqual(person(state, "ren").suspended, oldPaused, unavailable);
  }
});

test("A healthy cook assigned to rest or gather does not block the available companion's cooking substitute", () => {
  for (const policy of ["rest", "gather"] as const) {
    let state = settled(28);
    state.resources.food = 0;
    state = act(state, { type: "policy", residentId: "mio", policy });
    state = advance(state, 1);
    assert.equal(person(state, "mio").action, null);
    assert.equal(person(state, "ren").action?.kind, "cook");
    assert.equal(person(state, "ren").action?.autonomyReason?.code, "cooking");
    assert.equal(availableResources(state).ingredients, state.resources.ingredients - 2);
  }
});

test("A cook actually travels to the tool room before reserving ingredients and receiving its local benefit", () => {
  let state = toolsAtKitchen(14);
  const ingredients = state.resources.ingredients;
  const decision = getAutonomyDecision(state, "mio");
  assert.equal(decision?.kind, "move");
  assert.equal(decision?.target, "kitchen");
  state = advance(state, 1);
  assert.equal(person(state, "mio").location, "home");
  assert.equal(person(state, "mio").action?.kind, "move");
  assert.equal(availableResources(state).ingredients, ingredients);
  state = advance(state, 2);
  assert.equal(person(state, "mio").location, "kitchen");
  state = advance(state, 1);
  assert.equal(person(state, "mio").action?.kind, "cook");
  assert.equal(person(state, "mio").action?.duration, 17);
  assert.equal(state.resources.ingredients, ingredients);
  assert.equal(availableResources(state).ingredients, ingredients - 2);
  assert.deepEqual(deserialize(serialize(state)), state);
});

test("Changing policy during autonomous work travel prevents an obsolete arrival reservation", () => {
  for (const kind of ["gather", "cook"] as const) {
    let state = kind === "cook" ? toolsAtKitchen(29) : settled(29);
    const id = kind === "cook" ? "mio" : "ren";
    if (kind === "gather") {
      state.resources.food = 0;
      state.resources.ingredients = 0;
    }
    state = advance(state, 1);
    assert.equal(person(state, id).action?.kind, "move");
    assert.equal(person(state, id).action?.autonomyNext, kind);
    state = act(state, { type: "policy", residentId: id, policy: "rest" });
    const ingredients = state.resources.ingredients;
    state = advance(deserialize(serialize(state)), 2);
    assert.equal(person(state, id).location, kind === "cook" ? "kitchen" : "garden");
    assert.notEqual(person(state, id).action?.kind, kind);
    assert.equal(availableResources(state).ingredients, ingredients);
    state = advance(state, 1);
    assert.notEqual(person(state, id).action?.kind, kind);
  }
});

test("Leisure help uses real time and a fixed target, and cancellation or loading cannot farm another daily attempt", () => {
  let state = assign(settled(15), "project", "aki", "wood-flower");
  const projectId = person(state).action!.id;
  state = advance(state, 1);
  const helper = person(state, "mio").action;
  assert.equal(helper?.kind, "help");
  assert.ok(helper.automatic);
  assert.equal(helper.targetActionId, projectId);
  const used = structuredClone(state.autonomy!.leisure.mio);
  assert.equal(used.actionId, helper.id);
  assert.equal(used.kind, "help");
  state = act(state, { type: "cancel", residentId: "mio", actionId: helper.id });
  state = advance(deserialize(serialize(state)), 15);
  assert.deepEqual(state.autonomy!.leisure.mio, used);
  assert.ok(!["help", "socialize"].includes(person(state, "mio").action?.kind ?? ""));
  assert.equal(state.life!.events.filter((event) => event.kind === "help").length, 0);
  const nextDay = structuredClone(state);
  nextDay.minutes += 1440;
  const beforeRead = serialize(nextDay);
  getAutonomyDecision(nextDay, "mio");
  assert.equal(serialize(nextDay), beforeRead);
  const retried = advance(nextDay, 1);
  assert.equal(person(retried, "mio").action?.kind, "help");
  assert.notEqual(retried.autonomy!.leisure.mio.actionId, used.actionId);
  assert.equal(retried.autonomy!.leisure.mio.day, used.day + 1);
});

test("A sociable companion chooses an available close person and never creates a protagonist response order", () => {
  let state = settled(16);
  person(state, "mio").relations.ren = { closeness: 90, trust: 90 };
  person(state, "mio").relations.aki = { closeness: 0, trust: 0 };
  state = advance(state, 1);
  assert.equal(person(state, "mio").action?.kind, "socialize");
  assert.equal(person(state, "mio").action?.target, "ren");
  assert.equal(person(state, "ren").action, null, "The addressed person should not walk away for ordinary leisure");
  state = advance(state, 19);
  assert.equal(state.life!.events.filter((event) => event.kind === "conversation").length, 1);

  let busy = settled(17);
  person(busy, "mio").relations.ren = { closeness: 90, trust: 90 };
  busy = assign(busy, "rest", "ren");
  const explicitRest = person(busy, "ren").action!.id;
  busy = advance(busy, 1);
  assert.equal(person(busy, "mio").action?.kind, "socialize");
  assert.equal(person(busy, "mio").action?.target, "aki");
  assert.equal(person(busy).action, null);
  assert.equal(person(busy, "ren").action?.id, explicitRest);
});

test("Rest policy stops when recovery is sufficient, while balanced quiet leisure is recorded only once", () => {
  let resting = settled(18);
  for (const id of ["mio", "ren"])
    resting = act(resting, { type: "policy", residentId: id, policy: "rest" });
  resting = advance(resting, 60);
  assert.equal(person(resting, "mio").action, null);
  assert.equal(person(resting, "ren").action, null);
  assert.equal(resting.life!.events.filter((event) => event.kind === "quiet").length, 0);

  let balanced = settled(19);
  balanced = advance(balanced, 45);
  assert.equal(person(balanced, "ren").location, "bedroom");
  assert.equal(balanced.life!.events.filter((event) => event.kind === "quiet" && event.actors.includes("ren")).length, 1);
  const used = structuredClone(balanced.autonomy!.leisure.ren);
  balanced = advance(deserialize(serialize(balanced)), 45);
  assert.deepEqual(balanced.autonomy!.leisure.ren, used);
  assert.equal(balanced.life!.events.filter((event) => event.kind === "quiet" && event.actors.includes("ren")).length, 1);
});

test("Cancelling a discretionary return respects the present place without blocking urgent food", () => {
  let state = settled(20);
  person(state, "ren").location = "garden";
  state = advance(state, 1);
  const returning = person(state, "ren").action;
  assert.equal(returning?.kind, "move");
  assert.equal(returning.autonomyReason?.code, "return");
  state = act(state, { type: "cancel", residentId: "ren", actionId: returning.id });
  assert.equal(state.autonomy!.manualStays.ren.source, "cancel");
  state = advance(deserialize(serialize(state)), 30);
  assert.equal(person(state, "ren").location, "garden");
  assert.notEqual(person(state, "ren").action?.kind, "move");
  person(state, "ren").hunger = 30;
  state = advance(state, 1);
  assert.equal(person(state, "ren").action?.kind, "eat");
  assert.equal(person(state, "ren").location, "garden");
});

test("A three-person conversation is one event and each pair's daily gains diminish rather than multiply by participants", () => {
  let state = settled(21);
  const before = structuredClone(state.residents.map((resident) => ({ id: resident.id, relations: resident.relations })));
  state = conversation(state);
  assert.equal(state.life!.events.filter((event) => event.kind === "conversation").length, 1);
  for (const entry of before) for (const [id, relation] of Object.entries(entry.relations)) {
    assert.equal(person(state, entry.id).relations[id].closeness, relation.closeness + 4);
    assert.equal(person(state, entry.id).relations[id].trust, relation.trust + 1);
  }
  const first = structuredClone(state.residents.map((resident) => ({ id: resident.id, relations: resident.relations })));
  state = conversation(deserialize(serialize(state)));
  for (const entry of first) for (const [id, relation] of Object.entries(entry.relations)) {
    assert.equal(person(state, entry.id).relations[id].closeness, relation.closeness + 1);
    assert.equal(person(state, entry.id).relations[id].trust, relation.trust);
  }
  const second = structuredClone(state.residents.map((resident) => ({ id: resident.id, relations: resident.relations })));
  state = conversation(deserialize(serialize(state)));
  for (const entry of second) assert.deepEqual(person(state, entry.id).relations, entry.relations);
  assert.equal(state.life!.events.filter((event) => event.kind === "conversation").length, 3);
});

test("A group conversation never rewards or records the participant who went to sleep or left midway", () => {
  for (const interruption of ["sleep", "move"] as const) {
    let state = settled(27);
    const group = assignSelection(state, ["aki", "mio", "ren"], "socialize");
    assert.equal(group.error, undefined);
    state = advance(group.state, 5);
    const renRelations = structuredClone(person(state, "ren").relations);
    const towardRen = {
      aki: structuredClone(person(state).relations.ren),
      mio: structuredClone(person(state, "mio").relations.ren),
    };
    const renMood = person(state, "ren").mood;
    const renMemories = [...person(state, "ren").memories];
    state = assign(state, interruption, "ren", interruption === "move" ? "bedroom" : undefined);
    state = advance(deserialize(serialize(state)), 15);
    assert.equal(person(state, "ren").suspended?.kind, "socialize");
    assert.deepEqual(person(state, "ren").relations, renRelations);
    assert.deepEqual(person(state).relations.ren, towardRen.aki);
    assert.deepEqual(person(state, "mio").relations.ren, towardRen.mio);
    assert.equal(person(state, "ren").mood, renMood);
    assert.deepEqual(person(state, "ren").memories, renMemories);
    const conversations = state.life!.events.filter((event) => event.kind === "conversation");
    assert.ok(conversations.length <= 1);
    for (const event of conversations) {
      assert.equal(event.actors.includes("ren"), false);
      assert.equal(event.witnesses.includes("ren"), false);
    }
    assert.deepEqual(deserialize(serialize(state)), state);
  }
});

test("A simultaneous shared meal consumes three real portions but records one table and one gain per pair", () => {
  let state = settled(22);
  const before = structuredClone(state.residents.map((resident) => ({ id: resident.id, relations: resident.relations })));
  const food = state.resources.food;
  const eating = assignSelection(state, ["aki", "mio", "ren"], "eat");
  assert.equal(eating.error, undefined);
  state = advance(eating.state, 15);
  assert.equal(state.resources.food, food - 3);
  const meals = state.life!.events.filter((event) => event.kind === "meal");
  assert.equal(meals.length, 1);
  assert.deepEqual([...meals[0].actors].sort(), ["aki", "mio", "ren"]);
  assert.equal(state.logs.filter((entry) => entry.time === state.minutes && entry.title === "同じ食卓で").length, 1);
  for (const entry of before) for (const [id, relation] of Object.entries(entry.relations)) {
    assert.equal(person(state, entry.id).relations[id].closeness, relation.closeness + 3);
    assert.equal(person(state, entry.id).relations[id].trust, relation.trust + 1);
  }
  assert.deepEqual(deserialize(serialize(state)), state);
});

test("A third diner within the meal window adds new pairs without rewarding the earlier pair again", () => {
  let state = settled(23);
  // Keep the late diner in the chosen room while waiting for this controlled
  // meal-window check. Balanced Ren otherwise legitimately returns to bedroom.
  state = act(state, { type: "policy", residentId: "ren", policy: "rest" });
  const initial = structuredClone(state.residents.map((resident) => ({ id: resident.id, relations: resident.relations })));
  const pair = assignSelection(state, ["aki", "mio"], "eat");
  assert.equal(pair.error, undefined);
  state = advance(pair.state, 5);
  assert.equal(person(state, "ren").location, "home");
  state = assign(state, "eat", "ren");
  state = advance(state, 15);
  assert.equal(state.resources.food, 9);
  for (const entry of initial) for (const [id, relation] of Object.entries(entry.relations)) {
    assert.equal(person(state, entry.id).relations[id].closeness, relation.closeness + 3);
    assert.equal(person(state, entry.id).relations[id].trust, relation.trust + 1);
  }
  const beforeNewMeal = structuredClone(state.residents.map((resident) => ({ id: resident.id, relations: resident.relations })));
  const secondMeal = assignSelection(deserialize(serialize(state)), ["aki", "mio", "ren"], "eat");
  assert.equal(secondMeal.error, undefined);
  state = advance(secondMeal.state, 15);
  assert.equal(state.resources.food, 6);
  for (const entry of beforeNewMeal) for (const [id, relation] of Object.entries(entry.relations)) {
    assert.equal(person(state, entry.id).relations[id].closeness, relation.closeness + 3);
    assert.equal(person(state, entry.id).relations[id].trust, relation.trust + 1);
  }
});

test("Autonomous choices and their finite daily histories replay identically across split saved time", () => {
  let state = assign(settled(24), "project", "aki", "wood-flower");
  state = advance(state, 7);
  const whole = advance(state, 30);
  let split = deserialize(serialize(state));
  for (let minute = 0; minute < 30; minute++) split = advance(split, 1);
  assert.deepEqual(split, whole);
  assert.deepEqual(deserialize(serialize(whole)), whole);
});

test("Older automatic work without autonomy history remains readable and keeps its actual reservation", () => {
  let state = assign(settled(25), "cook", "mio");
  const actionId = person(state, "mio").action!.id;
  person(state, "mio").action!.automatic = true;
  delete person(state, "mio").action!.autonomyReason;
  delete state.autonomy;
  const restored = deserialize(serialize(state));
  assert.equal(restored.autonomy, undefined);
  state = advance(restored, 1);
  assert.equal(person(state, "mio").action?.id, actionId);
  assert.equal(person(state, "mio").action?.progress, 1);
  assert.equal(availableResources(state).ingredients, state.resources.ingredients - 2);
});

test("Malformed autonomy history or invented reasons are rejected without changing a valid saved world", () => {
  const state = advance(assign(settled(26), "hobby"), 1);
  const before = serialize(state);
  const corruptions: Array<(broken: GameState) => void> = [
    (broken) => { broken.autonomy!.version = 2 as 1; },
    (broken) => { broken.autonomy!.leisure.mio.actionId = broken.nextId + 1; },
    (broken) => { broken.autonomy!.leisure.mio.day = 999; },
    (broken) => { person(broken, "mio").action!.autonomyReason!.code = "invented" as "help"; },
    (broken) => { person(broken, "mio").action!.autonomyReason!.decidedAt = broken.minutes + 1; },
  ];
  for (const corrupt of corruptions) {
    const broken = structuredClone(state);
    corrupt(broken);
    assert.throws(() => deserialize(serialize(broken)));
  }
  assert.equal(serialize(state), before);
});

test("A paused cook occupies the pot without promising food or trapping other residents in failed cooking attempts", () => {
  let state = settled(30);
  state.resources.food = 0;
  state.resources.ingredients = 8;
  state = assign(state, "cook");
  state = act(state, { type: "pause", residentId: "aki" });
  const paused = structuredClone(person(state).suspended);
  assert.equal(availableResources(state).ingredients, 6);
  assert.equal(state.resources.food, 0);
  const beforeRead = serialize(state);
  const alternative = getAutonomyDecision(state, "mio");
  assert.equal(alternative?.kind, "socialize");
  assert.equal(alternative?.target, "ren");
  assert.equal(serialize(state), beforeRead);
  state = advance(deserialize(serialize(state)), 60);
  assert.deepEqual(person(state).suspended, paused);
  assert.equal(state.resources.food, 0, "The interrupted cook has not produced future food");
  assert.equal(state.resources.ingredients, 8);
  assert.equal(availableResources(state).ingredients, 6);
  assert.ok(state.life!.events.some((event) => event.kind === "conversation" && event.actors.includes("mio")));
  const nextId = state.nextId;
  const logCount = state.logs.length;
  state = advance(deserialize(serialize(state)), 30);
  assert.equal(state.nextId, nextId, "An occupied pot must not allocate a failed action ID every minute");
  assert.equal(state.logs.length, logCount);
  assert.deepEqual(person(state).suspended, paused);
});

test("Active or suspended C4 leisure cannot be imported without its matching daily start record", () => {
  const active = advance(assign(settled(31), "hobby"), 1);
  assert.equal(person(active, "mio").action?.kind, "help");
  assert.equal(person(active, "mio").action?.autonomyReason?.code, "help");
  const suspended = act(active, { type: "pause", residentId: "mio" });
  const corruptions: Array<(state: GameState) => void> = [
    (state) => { delete state.autonomy; },
    (state) => { delete state.autonomy!.leisure.mio; },
    (state) => { state.autonomy!.leisure.mio.actionId = person(state).action!.id; },
    (state) => { state.autonomy!.leisure.mio.kind = "social"; },
    (state) => { state.autonomy!.leisure.mio.startedAt -= 1; },
  ];
  for (const valid of [active, suspended]) {
    const before = serialize(valid);
    assert.deepEqual(deserialize(before), valid);
    for (const corrupt of corruptions) {
      const broken = structuredClone(valid);
      corrupt(broken);
      assert.throws(() => deserialize(serialize(broken)));
    }
    assert.equal(serialize(valid), before);
  }
});

test("C4 reasons must agree with action kind, continuation, and eligible resident while legacy unmarked work still loads", () => {
  const helper = advance(assign(settled(32), "hobby"), 1);
  person(helper, "mio").action!.autonomyReason!.code = "food";
  assert.throws(() => deserialize(serialize(helper)));

  const hero = assign(settled(33), "rest");
  person(hero).action!.automatic = true;
  person(hero).action!.autonomyReason = {
    code: "recovery", text: "Invalid autonomous protagonist order", decidedAt: hero.minutes,
  };
  assert.throws(() => deserialize(serialize(hero)));

  const mismatchedTravel = assign(settled(34), "move", "mio", "garden");
  person(mismatchedTravel, "mio").action!.automatic = true;
  person(mismatchedTravel, "mio").action!.autonomyReason = {
    code: "cooking", text: "Cooking trip with a conflicting arrival task", decidedAt: mismatchedTravel.minutes,
  };
  person(mismatchedTravel, "mio").action!.autonomyNext = "gather";
  assert.throws(() => deserialize(serialize(mismatchedTravel)));

  const legacy = assign(settled(35), "cook", "mio");
  person(legacy, "mio").action!.automatic = true;
  delete person(legacy, "mio").action!.autonomyReason;
  delete legacy.autonomy;
  assert.deepEqual(deserialize(serialize(legacy)), legacy);
});
