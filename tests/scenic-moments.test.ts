import test from "node:test";
import assert from "node:assert/strict";
import {
  advance,
  availableResources,
  command,
  createGame,
  deserialize,
  getEventKnowledge,
  getResidentLife,
  serialize,
} from "../src/game/engine.ts";
import { assignSelection } from "../src/game/selection.ts";
import { advanceFromControls, getTimeControls } from "../src/game/time-controls.ts";
import type { ActionKind, Command, GameState, LocationId } from "../src/game/types.ts";

// Controlled core-API fixtures, not a claim of normal browser play. The UI
// continuation and screenshots are verified separately against built HTML.
const person = (state: GameState, id = "aki") =>
  state.residents.find((resident) => resident.id === id)!;
const moments = (state: GameState) =>
  state.life?.events.filter((event) => event.kind === "quiet"
    && ["road", "shelter", "ruins"].includes(event.location)) ?? [];

function settled(seed = 1700): GameState {
  const state = createGame(seed);
  state.enemy.defeated = true;
  state.resources = { food: 12, ingredients: 12, medicine: 4, scrap: 8 };
  for (const resident of state.residents) {
    resident.hp = 100;
    resident.hunger = 100;
    resident.energy = 100;
    resident.mood = 45;
    resident.policy = "rest";
  }
  return state;
}

function act(state: GameState, instruction: Command): GameState {
  const result = command(state, instruction);
  assert.equal(result.error, undefined, result.error);
  return result.state;
}

function assign(state: GameState, kind: ActionKind, id = "aki", target?: string): GameState {
  return act(state, { type: "assign", residentIds: [id], kind, target });
}

function group(state: GameState, ids: string[], kind: ActionKind): GameState {
  const result = assignSelection(state, ids, kind);
  assert.equal(result.error, undefined, result.error);
  return result.state;
}

function finish(state: GameState, id = "aki"): GameState {
  const idBefore = person(state, id).action?.id;
  assert.notEqual(idBefore, undefined);
  for (let step = 0; step < 1200; step++) {
    if (person(state, id).action?.id !== idBefore) return state;
    state = advance(state, 1);
  }
  assert.fail("The scheduled action did not reach its own boundary");
}

function pairAtShelter(seed: number): GameState {
  const state = settled(seed);
  person(state).location = "shelter";
  person(state, "ren").location = "shelter";
  return state;
}

function sharedMoment(seed: number): GameState {
  return advance(group(pairAtShelter(seed), ["aki", "ren"], "observe"), 20);
}

function bothHome(state: GameState): GameState {
  const moved = assignSelection(state, ["aki", "ren"], "move", "home");
  assert.equal(moved.error, undefined, moved.error);
  return finish(moved.state);
}

function reachMorning(state: GameState): GameState {
  let morning = Math.floor(state.minutes / 1440) * 1440 + 480;
  if (morning <= state.minutes) morning += 1440;
  while (state.minutes < morning) {
    const next = advance(state, Math.min(60, morning - state.minutes));
    assert.ok(next.minutes > state.minutes);
    state = next;
  }
  return state;
}

test("Scenic observation is a pure atomic reservation only for conscious, sufficiently rested people at a safe outdoor location", () => {
  for (const location of ["road", "shelter", "ruins"] satisfies LocationId[]) {
    const state = settled(1701);
    person(state).location = location;
    const before = serialize(state);
    const reserved = assign(state, "observe");
    assert.equal(serialize(state), before, "The command must not mutate its input");
    assert.equal(reserved.minutes, state.minutes);
    assert.equal(reserved.seed, state.seed);
    assert.deepEqual(reserved.resources, state.resources);
    assert.equal(person(reserved).action?.kind, "observe");
    assert.equal(person(reserved).action?.duration, 20);
    assert.equal(person(reserved).action?.origin, location);
    assert.equal(person(reserved).action?.progress, 0);
    assert.equal(person(reserved).action?.reserved, undefined);
    assert.equal(person(reserved).action?.target, undefined);
  }

  for (const condition of ["base", "fainted", "sleeping", "exhausted", "enemy"] as const) {
    let state = pairAtShelter(1702);
    if (condition === "base") person(state, "ren").location = "home";
    if (condition === "fainted") person(state, "ren").hp = 0;
    if (condition === "sleeping") {
      person(state, "ren").location = "home";
      state = assign(state, "sleep", "ren");
      person(state, "ren").location = "shelter";
    }
    if (condition === "exhausted") person(state, "ren").energy = 2;
    if (condition === "enemy") {
      state.enemy.defeated = false;
      state.enemy.location = "shelter";
    }
    const before = serialize(state);
    const failed = assignSelection(state, ["aki", "ren"], "observe");
    assert.ok(failed.error, condition);
    assert.strictEqual(failed.state, state, "A mixed selection must not partially reserve work");
    assert.equal(serialize(state), before);
    assert.equal(moments(state).length, 0);
  }
});

test("Twenty real minutes create one outdoor experience and log without healing, skills, resources, relationship or mood rewards", () => {
  const initial = settled(1703);
  person(initial).location = "shelter";
  person(initial).hp = 68;
  person(initial).wounds.arm = 1;
  const body = structuredClone(person(initial));
  const resources = { ...initial.resources };
  const logCount = initial.logs.length;
  let state = assign(initial, "observe");
  assert.deepEqual(availableResources(state), availableResources(initial));
  state = advance(state, 19);
  assert.equal(person(state).action?.progress, 19);
  assert.equal(moments(state).length, 0);
  state = advance(state, 1);
  assert.equal(state.minutes, initial.minutes + 20);
  assert.equal(person(state).action, null);
  assert.equal(moments(state).length, 1);
  assert.equal(state.logs.length, logCount + 1);
  assert.equal(moments(state)[0].time, state.minutes);
  assert.deepEqual(moments(state)[0].actors, ["aki"]);
  assert.deepEqual(state.resources, resources);
  assert.equal(person(state).hp, body.hp);
  assert.equal(person(state).mood, body.mood);
  assert.deepEqual(person(state).wounds, body.wounds);
  assert.deepEqual(person(state).skills, body.skills);
  assert.deepEqual(person(state).relations, body.relations);
  assert.ok(person(state).hunger < body.hunger);
  assert.ok(person(state).energy < body.energy);
  const event = structuredClone(moments(state)[0]);
  state = advance(deserialize(serialize(state)), 5);
  assert.deepEqual(moments(state), [event], "Reloading or another tick cannot repeat the completed scene");
});

test("Only actual same-minute observers share the one local result; an awake bystander is not an actor", () => {
  const initial = pairAtShelter(1704);
  person(initial, "mio").location = "shelter";
  const input = serialize(initial);
  const reserved = group(initial, ["aki", "ren"], "observe");
  assert.equal(serialize(initial), input);
  assert.equal(reserved.minutes, initial.minutes);
  const state = advance(reserved, 20);
  assert.equal(moments(state).length, 1);
  assert.deepEqual(new Set(moments(state)[0].actors), new Set(["aki", "ren"]));
  assert.equal(moments(state)[0].location, "shelter");
  assert.equal(moments(state)[0].actors.includes("mio"), false);
  assert.ok(moments(state)[0].witnesses.includes("mio"));
  assert.deepEqual(deserialize(serialize(state)), state);
});

test("Starting five minutes later produces a later individual result rather than retroactive participation", () => {
  let state = assign(pairAtShelter(1705), "observe");
  state = advance(state, 5);
  state = assign(state, "observe", "ren");
  state = advance(state, 15);
  assert.equal(moments(state).length, 1);
  assert.deepEqual(moments(state)[0].actors, ["aki"]);
  assert.equal(person(state, "ren").action?.progress, 15);
  const first = structuredClone(moments(state)[0]);
  state = advance(state, 5);
  assert.equal(moments(state).length, 2);
  assert.deepEqual(moments(state)[0], first);
  assert.deepEqual(moments(state)[1].actors, ["ren"]);
  assert.equal(moments(state)[1].time - first.time, 5);
});

test("A multi-selection at different safe places completes as separate physical scenes", () => {
  const initial = pairAtShelter(1706);
  person(initial, "ren").location = "road";
  const state = advance(group(initial, ["aki", "ren"], "observe"), 20);
  assert.equal(moments(state).length, 2);
  const shelter = moments(state).find((event) => event.location === "shelter")!;
  const road = moments(state).find((event) => event.location === "road")!;
  assert.deepEqual(shelter.actors, ["aki"]);
  assert.deepEqual(road.actors, ["ren"]);
  assert.equal(shelter.time, road.time);
  assert.doesNotMatch(shelter.text, /レン/);
  assert.doesNotMatch(road.text, /アキ/);
  assert.equal(getEventKnowledge(state, "ren", shelter.id).status, "unknown");
  assert.equal(getEventKnowledge(state, "aki", road.id).status, "unknown");
});

test("Sleeping or unconscious bystanders do not learn the observation", () => {
  let state = settled(1707);
  // Controlled positions, then a real sleep order at the sheltered scene.
  // An already sleeping body cannot be teleported away from its sleep origin.
  for (const resident of state.residents) resident.location = "shelter";
  state = assign(state, "sleep", "ren");
  person(state, "mio").hp = 0;
  state = advance(assign(state, "observe"), 20);
  assert.equal(moments(state).length, 1);
  const scene = moments(state)[0];
  assert.deepEqual(scene.actors, ["aki"]);
  assert.deepEqual(scene.witnesses, ["aki"]);
  assert.equal(getEventKnowledge(state, "ren", scene.id).status, "unknown");
  assert.equal(getEventKnowledge(state, "mio", scene.id).status, "unknown");
});

test("Paused observation keeps its exact saved progress and origin, and cancellation creates no scenic result", () => {
  let state = advance(assign(pairAtShelter(1708), "observe"), 7);
  const action = structuredClone(person(state).action)!;
  state = act(state, { type: "pause", residentId: "aki" });
  const saved = serialize(state);
  const restored = deserialize(saved);
  assert.deepEqual(person(restored).suspended, action);
  assert.equal(serialize(restored), saved);
  const cancelled = act(restored, { type: "cancel", residentId: "aki", actionId: action.id });
  assert.equal(moments(advance(cancelled, 20)).length, 0);

  state = finish(assign(restored, "move", "aki", "home"));
  const away = serialize(state);
  const rejected = command(state, { type: "resume", residentId: "aki" });
  assert.match(rejected.error ?? "", /場所|戻/);
  assert.strictEqual(rejected.state, state);
  assert.equal(serialize(state), away);
  assert.deepEqual(person(state).suspended, action);
  state = finish(assign(state, "move", "aki", "shelter"));
  state = act(deserialize(serialize(state)), { type: "resume", residentId: "aki" });
  assert.equal(person(state).action?.id, action.id);
  assert.equal(person(state).action?.progress, 7);
  const direct = advance(state, 13);
  const reloaded = advance(deserialize(serialize(state)), 13);
  assert.deepEqual(reloaded, direct);
  assert.equal(moments(reloaded).length, 1);
  assert.equal(person(reloaded).action, null);
});

test("A new local threat cuts a scene short, while a remote battle only changes the shared time controls", () => {
  let threatened = advance(assign(pairAtShelter(1709), "observe"), 5);
  threatened.enemy.location = "shelter";
  threatened.enemy.defeated = false;
  threatened = advance(threatened, 1);
  assert.equal(person(threatened).action, null);
  assert.equal(moments(threatened).length, 0);

  const remote = pairAtShelter(1710);
  remote.enemy.defeated = false;
  remote.enemy.location = "ruins";
  person(remote, "ren").location = "ruins";
  const reserved = assign(remote, "observe");
  assert.deepEqual(getTimeControls(reserved).minuteSteps, [1, 5, 10]);
  const capped = advanceFromControls(reserved, 60);
  assert.equal(capped.minutes - reserved.minutes, 10);
  assert.equal(person(capped).action?.kind, "observe");
  assert.equal(person(capped).action?.progress, 10);
  assert.equal(moments(capped).length, 0);
});

test("Morning retains an actual scenic participant above a shared meal but still favors their own displayed work or critical rescue", () => {
  let meal = pairAtShelter(1711);
  meal.minutes = 1440 + 350;
  meal = advance(group(meal, ["aki", "ren"], "observe"), 20);
  const sceneId = moments(meal)[0].id;
  meal = bothHome(meal);
  meal = advance(group(meal, ["aki", "mio", "ren"], "eat"), 15);
  const mealEvent = meal.life!.events.find((event) => event.kind === "meal")!;
  meal = reachMorning(meal);
  assert.equal(getResidentLife(meal, "aki").reflection?.eventId, sceneId);
  assert.equal(getResidentLife(meal, "ren").reflection?.eventId, sceneId);
  assert.equal(getResidentLife(meal, "mio").reflection?.eventId, mealEvent.id);
  assert.match(getResidentLife(meal, "aki").reflection?.text ?? "", /木陰|迂回路/);
  assert.match(getResidentLife(meal, "aki").reflection?.text ?? "", /レン/);

  let display = pairAtShelter(1712);
  display.minutes = 1440 + 320;
  display = advance(group(display, ["aki", "ren"], "observe"), 20);
  const shared = moments(display)[0].id;
  display = bothHome(display);
  display = finish(assign(display, "hobby"));
  const craftId = display.life!.crafts.find((craft) => craft.authorId === "aki")!.id;
  display = finish(assign(display, "decorate"));
  display = finish(assign(display, "place-craft", "aki", String(craftId)));
  const displayed = display.life!.events.find((event) => event.kind === "display")!;
  display = reachMorning(display);
  assert.equal(getResidentLife(display, "aki").reflection?.eventId, displayed.id);
  assert.equal(getResidentLife(display, "ren").reflection?.eventId, shared);

  let rescue = pairAtShelter(1713);
  rescue.minutes = 1440 + 300;
  person(rescue, "mio").location = "shelter";
  person(rescue, "mio").hp = 20;
  rescue = advance(group(rescue, ["aki", "ren"], "observe"), 20);
  rescue = finish(assign(rescue, "rescue", "ren", "mio"), "ren");
  const rescued = rescue.life!.events.find((event) => event.kind === "rescue")!;
  rescue = reachMorning(rescue);
  assert.equal(getResidentLife(rescue, "ren").reflection?.eventId, rescued.id);
});

test("Existing base quiet and old saves retain their meaning without acquiring the new outdoor bonus or topic", () => {
  let legacy = settled(1714);
  for (const resident of legacy.residents) resident.location = "bedroom";
  person(legacy, "ren").policy = "balanced";
  legacy = advance(legacy, 1);
  assert.equal(person(legacy, "ren").action?.autonomyReason?.code, "quiet");
  legacy = finish(legacy, "ren");
  const quiet = legacy.life!.events.find((event) => event.kind === "quiet")!;
  assert.equal(quiet.location, "bedroom");
  const saved = serialize(legacy);
  assert.equal(serialize(deserialize(saved)), saved);
  const talked = advance(group(legacy, ["aki", "ren"], "socialize"), 20);
  assert.doesNotMatch(talked.life!.events.at(-1)!.text, /景色|寝床/);

  // The controlled clock makes a later three-person meal compete with the old
  // base quiet; it must retain the old ranking, not inherit outdoor's +5.
  legacy.minutes = 1440 + 430;
  const oldQuiet = legacy.life!.events.find((event) => event.id === quiet.id)!;
  oldQuiet.time = legacy.minutes - 20;
  legacy = advance(group(legacy, ["aki", "mio", "ren"], "eat"), 15);
  const meal = legacy.life!.events.find((event) => event.kind === "meal")!;
  legacy = reachMorning(legacy);
  assert.equal(getResidentLife(legacy, "ren").reflection?.eventId, meal.id);

  const old = JSON.parse(serialize(settled(1715)));
  delete old.life;
  delete old.autonomy;
  delete old.trade;
  delete old.autoCombat;
  assert.deepEqual(deserialize(JSON.stringify(old)), old, "Loading an older optional-extension save must not invent past scenes");
});

test("Only people who know the outdoor scene discuss it, and an unreported aid fact still takes precedence", () => {
  const shared = sharedMoment(1716);
  const scene = moments(shared)[0];
  const returned = bothHome(shared);
  const known = advance(group(returned, ["aki", "ren"], "socialize"), 20);
  assert.match(known.life!.events.at(-1)!.text, /木陰|迂回路/);
  assert.match(known.life!.events.at(-1)!.text, /景色/);
  assert.equal(getEventKnowledge(known, "mio", scene.id).status, "unknown");
  const mixed = advance(group(returned, ["aki", "mio", "ren"], "socialize"), 20);
  assert.doesNotMatch(mixed.life!.events.at(-1)!.text, /木陰|迂回路|景色/);
  assert.equal(getEventKnowledge(mixed, "mio", scene.id).status, "unknown");

  let aided = structuredClone(returned);
  person(aided).hp = 70;
  person(aided).wounds.arm = 1;
  aided = assign(aided, "sleep");
  aided = assign(aided, "heal", "ren", "aki");
  aided = advance(aided, 20);
  const source = aided.life!.events.find((event) => event.kind === "heal")!;
  assert.equal(getEventKnowledge(aided, "aki", source.id).status, "unknown");
  aided = act(aided, { type: "cancel", residentId: "aki" });
  aided = advance(group(aided, ["aki", "ren"], "socialize"), 20);
  const conversation = aided.life!.events.at(-1)!;
  assert.equal(conversation.report?.sourceEventId, source.id);
  assert.equal(conversation.report?.listenerId, "aki");
  assert.equal(conversation.report?.speakerId, "ren");
  assert.doesNotMatch(conversation.text, /木陰|迂回路|景色/);
});

test("Saved observe actions reject impossible origins, timing, targets, reservations or borrowed action metadata", () => {
  const valid = assign(pairAtShelter(1717), "observe");
  assert.deepEqual(deserialize(serialize(valid)), valid);
  const mutations: ((saved: ReturnType<typeof JSON.parse>) => void)[] = [
    (saved) => { saved.residents[0].action.duration = 19; },
    (saved) => { saved.residents[0].action.duration = 21; },
    (saved) => { delete saved.residents[0].action.origin; },
    (saved) => { saved.residents[0].action.origin = "home"; },
    (saved) => { saved.residents[0].action.progress = 1.5; },
    (saved) => { saved.residents[0].action.target = "ren"; },
    (saved) => { saved.residents[0].action.target = ""; },
    (saved) => { saved.residents[0].action.reserved = { food: 1 }; },
    (saved) => { saved.residents[0].action.reserved = {}; },
    (saved) => { saved.residents[0].action.automatic = true; },
    (saved) => { saved.residents[0].action.path = ["shelter"]; },
    (saved) => { saved.residents[0].action.segment = 0; },
  ];
  for (const mutate of mutations) {
    const invalid = JSON.parse(serialize(valid));
    mutate(invalid);
    assert.throws(() => deserialize(JSON.stringify(invalid)));
  }
  assert.deepEqual(deserialize(serialize(valid)), valid, "Invalid inputs cannot alter the original valid action");
});
