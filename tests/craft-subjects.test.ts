import test from "node:test";
import assert from "node:assert/strict";
import {
  advance,
  availableResources,
  command,
  createGame,
  deserialize,
  getCraftDisplayTitle,
  getCraftSubject,
  getCraftSubjectChoices,
  getCraftSubjectText,
  getCraftTitle,
  getEventKnowledge,
  serialize,
} from "../src/game/engine.ts";
import { assignSelection, assignSubjectCraftSelection } from "../src/game/selection.ts";
import type { ActionKind, Command, CraftPiece, GameState, LifeExperience, LocationId } from "../src/game/types.ts";

// Controlled core-API fixtures. Safe trips, observation and work use public
// commands; these cases are not a claim of ordinary browser play or enjoyment.
const person = (state: GameState, id = "aki") =>
  state.residents.find((resident) => resident.id === id)!;
const scene = (state: GameState, id: number) =>
  state.life!.events.find((event) => event.id === id)!;
const piece = (state: GameState, id: number) =>
  state.life!.crafts.find((craft) => craft.id === id)!;
type Design = "bird" | "flower";

function act(state: GameState, instruction: Command): GameState {
  const result = command(state, instruction);
  assert.equal(result.error, undefined, result.error);
  return result.state;
}

function assign(state: GameState, kind: ActionKind, id = "aki", target?: string): GameState {
  return act(state, { type: "assign", residentIds: [id], kind, target });
}

function group(state: GameState, ids: string[], kind: ActionKind, target?: string): GameState {
  const result = assignSelection(state, ids, kind, target);
  assert.equal(result.error, undefined, result.error);
  return result.state;
}

function finish(state: GameState, ids = ["aki"]): GameState {
  const actions = ids.map((id) => ({ id, actionId: person(state, id).action?.id }));
  assert.ok(actions.every(({ actionId }) => actionId !== undefined));
  for (let step = 0; step < 1200; step++) {
    if (actions.every(({ id, actionId }) => person(state, id).action?.id !== actionId)) return state;
    state = advance(state, 1);
  }
  assert.fail("The public command did not reach its action boundary");
}

function settled(seed: number): GameState {
  let state = createGame(seed);
  state.resources = { food: 20, ingredients: 20, medicine: 4, scrap: 20 };
  for (const resident of state.residents) {
    resident.hp = resident.hunger = resident.energy = 100;
    resident.mood = 45;
  }
  for (const id of ["aki", "mio", "ren"])
    state = act(state, { type: "policy", residentId: id, policy: "rest" });
  return state;
}

function outing(
  state: GameState,
  actors = ["aki", "ren"],
  location: LocationId = "shelter",
  bystanders: string[] = [],
): { state: GameState; eventId: number } {
  const travelers = [...new Set([...actors, ...bystanders])];
  state = finish(group(state, travelers, "move", location), travelers);
  const before = new Set(state.life?.events.map((event) => event.id));
  state = finish(group(state, actors, "observe"), actors);
  const event = state.life!.events.find((event) => event.kind === "quiet" && !before.has(event.id))!;
  assert.ok(event);
  state = finish(group(state, travelers, "move", "home"), travelers);
  assert.ok(travelers.every((id) => person(state, id).location === "home"));
  return { state, eventId: event.id };
}

function withScene(seed = 2000): { state: GameState; eventId: number } {
  return outing(settled(seed));
}

function subject(state: GameState, eventId: number, design: Design = "bird", author = "aki"): GameState {
  const result = assignSubjectCraftSelection(state, [author], design, eventId);
  assert.equal(result.error, undefined, result.error);
  return result.state;
}

function ordinary(state: GameState, design: Design): GameState {
  return design === "bird" ? assign(state, "hobby") : assign(state, "project", "aki", "wood-flower");
}

function mechanics(state: GameState) {
  return {
    minutes: state.minutes,
    seed: state.seed,
    nextId: state.nextId,
    resources: state.resources,
    available: availableResources(state),
    flags: state.flags,
    residents: state.residents.map((resident) => ({
      id: resident.id,
      location: resident.location,
      hp: resident.hp,
      hunger: resident.hunger,
      energy: resident.energy,
      mood: resident.mood,
      skills: resident.skills,
      relations: resident.relations,
      wounds: resident.wounds,
    })),
  };
}

function reject(state: GameState, operation: () => { state: GameState; error?: string }) {
  const before = serialize(state);
  const result = operation();
  assert.ok(result.error);
  assert.strictEqual(result.state, state, "Failure must return the original world, without partial cancellation");
  assert.equal(serialize(state), before);
}

function corruptSave(state: GameState, corrupt: (saved: any) => void) {
  // JSON is intentionally untyped at this trust boundary: malformed input must
  // reach the public reader instead of being hidden behind a valid TS union.
  const saved = JSON.parse(serialize(state));
  corrupt(saved);
  assert.throws(() => deserialize(JSON.stringify(saved)));
}

test("Subject choices retain all personally completed outdoor scenes newest first, without making nearby witnesses into participants", () => {
  const first = outing(settled(2001), ["aki", "ren"], "shelter", ["mio"]);
  const second = outing(first.state, ["aki"], "road");
  const state = second.state;
  const before = serialize(state);
  const choices = getCraftSubjectChoices(state, "aki");
  assert.deepEqual(choices.map((choice) => choice.eventId), [second.eventId, first.eventId]);
  assert.deepEqual(choices.map((choice) => choice.location), ["road", "shelter"]);
  assert.ok(choices.every((choice) => choice.time === scene(state, choice.eventId).time && choice.label.length > 0));
  assert.deepEqual(getCraftSubjectChoices(state, "ren").map((choice) => choice.eventId), [first.eventId]);
  assert.ok(scene(state, first.eventId).witnesses.includes("mio"));
  assert.equal(getEventKnowledge(state, "mio", first.eventId).status, "direct");
  assert.deepEqual(getCraftSubjectChoices(state, "mio"), [], "Seeing other people observe is insufficient");
  assert.deepEqual(getCraftSubjectChoices(state, "missing-person"), []);
  assert.equal(serialize(state), before);
});

test("Explicitly choosing an older scene survives completion, rather than being replaced by the newest outing", () => {
  const first = withScene(2002);
  const second = outing(first.state, ["aki"], "road");
  const sourceBefore = structuredClone(scene(second.state, first.eventId));
  let state = subject(second.state, first.eventId);
  const workId = person(state).action!.id;
  assert.equal(person(state).action!.subjectEventId, first.eventId);
  state = finish(state);
  const craft = piece(state, workId);
  assert.equal(craft.subjectEventId, first.eventId);
  assert.equal(getCraftSubject(state, craft)?.eventId, first.eventId);
  assert.equal(getCraftSubject(state, craft)?.location, "shelter");
  assert.deepEqual(scene(state, first.eventId), sourceBefore);
  const before = serialize(state);
  assert.match(getCraftSubjectText(state, craft) ?? "", /木陰|迂回路/);
  assert.match(getCraftDisplayTitle(state, craft), /木陰|迂回路/);
  assert.equal(getCraftTitle(craft), getCraftTitle({ ...craft, subjectEventId: undefined }));
  assert.equal(serialize(state), before, "Rendering a title or a subject cannot teach facts or alter work");
});

for (const design of ["bird", "flower"] as const) {
  test(`A ${design} subject changes attribution only; time, reservations, body, skills, relationships and RNG match ordinary work`, () => {
    const { state: initial, eventId } = withScene(design === "bird" ? 2003 : 2004);
    const before = serialize(initial);
    let plain = ordinary(initial, design);
    let themed = subject(initial, eventId, design);
    assert.equal(serialize(initial), before);
    assert.deepEqual(mechanics(themed), mechanics(plain));
    assert.equal(themed.minutes, initial.minutes);
    assert.equal(person(themed).action?.duration, person(plain).action?.duration);
    assert.equal(person(themed).action?.kind, design === "bird" ? "hobby" : "project");
    assert.equal(person(themed).action?.target, design === "bird" ? undefined : "wood-flower");
    const workId = person(themed).action!.id;
    assert.ok(eventId < workId);
    plain = finish(plain);
    themed = finish(themed);
    assert.deepEqual(mechanics(themed), mechanics(plain));
    assert.equal(piece(themed, workId).design, design);
    assert.equal(piece(themed, workId).subjectEventId, eventId);
    assert.equal(piece(plain, workId).subjectEventId, undefined);
    assert.equal(themed.life!.crafts.length, 1);
    assert.equal(themed.life!.events.filter((event) => event.kind === "craft" && event.craftId === workId).length, 1);
    const after = advance(deserialize(serialize(themed)), 5);
    assert.equal(after.life!.crafts.length, 1);
    assert.equal(after.resources.scrap, themed.resources.scrap);
  });
}

test("Subject previews and assignments are time-free and atomic for empty, multiple, unknown or invalid selections", () => {
  const source = withScene(2005);
  const state = assign(source.state, "cook", "aki");
  const before = serialize(state);
  for (const ids of [[], ["aki", "ren"], ["missing-person"], ["aki", "missing-person"]]) {
    reject(state, () => assignSubjectCraftSelection(state, ids, "bird", source.eventId));
  }
  for (const invalidId of [0, -1, 1.5, NaN, Infinity, state.nextId + 100])
    reject(state, () => assignSubjectCraftSelection(state, ["aki"], "bird", invalidId));
  const preview = assignSubjectCraftSelection(state, ["aki"], "bird", source.eventId);
  assert.equal(preview.error, undefined);
  assert.equal(preview.state.minutes, state.minutes);
  assert.equal(preview.state.seed, state.seed);
  assert.equal(serialize(state), before);
  assert.equal(person(state).action?.kind, "cook");
  assert.equal(person(state).suspended, null);
});

test("Another person's scene, indoor quiet and future-dated scenes cannot become a subject", () => {
  const { state, eventId } = withScene(2006);
  reject(state, () => assignSubjectCraftSelection(state, ["mio"], "flower", eventId));
  const base = structuredClone(state);
  scene(base, eventId).location = "home";
  reject(base, () => assignSubjectCraftSelection(base, ["aki"], "bird", eventId));
  const future = structuredClone(state);
  scene(future, eventId).time = future.minutes + 1;
  reject(future, () => assignSubjectCraftSelection(future, ["aki"], "bird", eventId));
  const witnessOnly = structuredClone(state);
  scene(witnessOnly, eventId).actors = ["ren"];
  reject(witnessOnly, () => assignSubjectCraftSelection(witnessOnly, ["aki"], "bird", eventId));
  const absentWitness = structuredClone(state);
  scene(absentWitness, eventId).witnesses = ["ren"];
  reject(absentWitness, () => assignSubjectCraftSelection(absentWitness, ["aki"], "bird", eventId));
});

test("The direct command rejects subjects on equipment and other work, or more than one artist, without suspending existing orders", () => {
  const { state: source, eventId } = withScene(2007);
  const state = assign(source, "cook");
  for (const [kind, target] of [
    ["project", "kitchen-tools"], ["project", "rest-corner"], ["rest", undefined], ["hobby", "wood-flower"], ["hobby", ""],
  ] as const) {
    reject(state, () => command(state, { type: "assign", residentIds: ["aki"], kind, target, subjectEventId: eventId }));
  }
  reject(state, () => command(state, { type: "assign", residentIds: ["aki", "ren"], kind: "hobby", subjectEventId: eventId }));
  assert.equal(person(state).action?.kind, "cook");
  assert.equal(person(state).suspended, null);
});

test("Both designs keep their exact source, job id, progress and reservation through pause, save and resume", () => {
  for (const design of ["bird", "flower"] as const) {
    const { state: initial, eventId } = withScene(2008);
    let state = advance(subject(initial, eventId, design), 7);
    const action = structuredClone(person(state).action)!;
    const free = availableResources(state).scrap;
    state = act(state, { type: "pause", residentId: "aki" });
    const saved = serialize(state);
    state = deserialize(saved);
    assert.equal(serialize(state), saved);
    assert.deepEqual(person(state).suspended, action);
    assert.equal(availableResources(state).scrap, free);
    state = act(state, { type: "resume", residentId: "aki" });
    assert.deepEqual(person(state).action, action);
    const direct = finish(state);
    const restored = finish(deserialize(serialize(state)));
    assert.deepEqual(restored, direct);
    assert.equal(piece(restored, action.id).subjectEventId, eventId);
    assert.equal(restored.resources.scrap, initial.resources.scrap - (design === "flower" ? 1 : 0));
  }
});

test("Cancelling either an active or suspended subject releases material once and leaves no object or completed craft event", () => {
  for (const design of ["bird", "flower"] as const) {
    for (const paused of [false, true]) {
      const { state: initial, eventId } = withScene(2009);
      let state = advance(subject(initial, eventId, design), 7);
      const workId = person(state).action!.id;
      if (paused) state = act(state, { type: "pause", residentId: "aki" });
      state = act(deserialize(serialize(state)), { type: "cancel", residentId: "aki", actionId: workId });
      assert.equal(availableResources(state).scrap, initial.resources.scrap);
      assert.equal(state.resources.scrap, initial.resources.scrap);
      state = advance(state, 60);
      assert.equal(state.life!.crafts.some((craft) => craft.id === workId), false);
      assert.equal(state.life!.events.some((event) => event.kind === "craft" && event.craftId === workId), false);
      reject(state, () => command(state, { type: "cancel", residentId: "aki", actionId: workId }));
    }
  }
});

test("Returning to a paused subject's original workshop is required, without confusing that workshop with the outdoor subject", () => {
  const { state: initial, eventId } = withScene(2010);
  let state = advance(subject(initial, eventId, "flower"), 6);
  const action = structuredClone(person(state).action)!;
  assert.equal(action.origin, "home");
  assert.equal(scene(state, eventId).location, "shelter");
  state = act(state, { type: "pause", residentId: "aki" });
  state = finish(assign(state, "move", "aki", "kitchen"));
  reject(state, () => command(state, { type: "resume", residentId: "aki" }));
  assert.deepEqual(person(state).suspended, action);
  state = finish(assign(state, "move", "aki", "home"));
  state = finish(act(deserialize(serialize(state)), { type: "resume", residentId: "aki" }));
  assert.equal(piece(state, action.id).subjectEventId, eventId);
  assert.equal(piece(state, action.id).createdLocation, "home");
});

test("Old ordinary active work and completed objects round-trip unchanged and do not acquire a subject from nearby events", () => {
  const { state: initial } = withScene(2011);
  for (const design of ["bird", "flower"] as const) {
    let state = advance(ordinary(initial, design), 4);
    for (const paused of [false, true]) {
      const candidate = paused ? act(state, { type: "pause", residentId: "aki" }) : state;
      assert.equal(serialize(deserialize(serialize(candidate))), serialize(candidate));
      assert.equal(Object.hasOwn((person(candidate).action ?? person(candidate).suspended)!, "subjectEventId"), false);
    }
    state = finish(state);
    const craft = state.life!.crafts[0];
    assert.equal(Object.hasOwn(craft, "subjectEventId"), false);
    assert.equal(getCraftSubject(state, craft), undefined);
    assert.equal(getCraftSubjectText(state, craft), undefined);
    assert.equal(getCraftDisplayTitle(state, craft), getCraftTitle(craft));
    assert.equal(serialize(deserialize(serialize(state))), serialize(state));
  }
  const legacy = createGame(2012);
  delete legacy.life;
  const raw = serialize(legacy);
  assert.equal(serialize(deserialize(raw)), raw, "A genuinely absent optional life extension stays absent");
});

test("Saved active and suspended subjects reject malformed identifiers, invalid participation, wrong kinds and automatic work", () => {
  const { state: initial, eventId } = withScene(2013);
  const active = advance(subject(initial, eventId, "flower"), 3);
  const paused = act(active, { type: "pause", residentId: "aki" });
  for (const state of [active, paused]) {
    const slot = person(state).action ? "action" : "suspended";
    const corruptions: Array<(saved: any) => void> = [
      ...[null, "1", 0, -1, 1.5, state.nextId + 10].map((id) => (saved: any) => { saved.residents[0][slot].subjectEventId = id; }),
      (saved) => { saved.residents[0][slot].automatic = true; },
      (saved) => { saved.residents[0][slot].target = "kitchen-tools"; saved.residents[0][slot].reserved = { scrap: 3 }; },
      (saved) => { saved.residents[0][slot].kind = "rest"; saved.residents[0][slot].target = undefined; saved.residents[0][slot].reserved = undefined; },
      (saved) => { saved.life.events.find((event: LifeExperience) => event.id === eventId).actors = ["ren"]; },
      (saved) => { saved.life.events.find((event: LifeExperience) => event.id === eventId).witnesses = ["ren"]; },
      (saved) => { saved.life.events.find((event: LifeExperience) => event.id === eventId).location = "home"; },
      (saved) => { saved.life.events.find((event: LifeExperience) => event.id === eventId).kind = "meal"; },
    ];
    const before = serialize(state);
    for (const corrupt of corruptions) corruptSave(state, corrupt);
    assert.equal(serialize(state), before);
    assert.deepEqual(deserialize(before), state);
  }
  const bird = subject(initial, eventId);
  for (const target of ["wood-flower", ""])
    corruptSave(bird, (saved) => { saved.residents[0].action.target = target; });
});

test("A later real scene cannot be attached retroactively to already-started or already-finished work", () => {
  const first = withScene(2014);
  let state = advance(subject(first.state, first.eventId), 5);
  const workId = person(state).action!.id;
  state = act(state, { type: "pause", residentId: "aki" });
  const later = outing(state, ["aki"], "road");
  assert.ok(later.eventId > workId);
  assert.deepEqual(deserialize(serialize(later.state)), later.state);
  corruptSave(later.state, (saved) => { saved.residents[0].suspended.subjectEventId = later.eventId; });
  state = finish(act(later.state, { type: "resume", residentId: "aki" }));
  corruptSave(state, (saved) => { saved.life.crafts.find((craft: CraftPiece) => craft.id === workId).subjectEventId = later.eventId; });
  const timeAfterCreation = structuredClone(state);
  timeAfterCreation.minutes += 5;
  scene(timeAfterCreation, first.eventId).time = piece(timeAfterCreation, workId).createdAt + 1;
  assert.throws(() => deserialize(serialize(timeAfterCreation)), "Even an older id cannot describe a scene after the object was created");
});

test("Completed subjects reject malformed, missing or non-participated sources without rewriting a valid save", () => {
  const { state: initial, eventId } = withScene(2015);
  const state = finish(subject(initial, eventId));
  const workId = state.life!.crafts[0].id;
  const corruptions: Array<(saved: any) => void> = [
    ...[null, "1", 0, -1, 1.5, state.nextId + 10].map((id) => (saved: any) => { saved.life.crafts[0].subjectEventId = id; }),
    (saved) => { saved.life.events = saved.life.events.filter((event: LifeExperience) => event.id !== eventId); },
    (saved) => { saved.life.events.find((event: LifeExperience) => event.id === eventId).actors = ["ren"]; },
    (saved) => { saved.life.events.find((event: LifeExperience) => event.id === eventId).witnesses = ["ren"]; },
    (saved) => { saved.life.events.find((event: LifeExperience) => event.id === eventId).location = "home"; },
    (saved) => { saved.life.events.find((event: LifeExperience) => event.id === eventId).kind = "meal"; },
  ];
  const before = serialize(state);
  for (const corrupt of corruptions) corruptSave(state, corrupt);
  assert.equal(serialize(state), before);
  assert.equal(piece(deserialize(before), workId).subjectEventId, eventId);
});

test("Making, displaying and discussing a subject creates knowledge of the object without turning an absent companion into an eyewitness of the original outing", () => {
  const { state: initial, eventId } = withScene(2016);
  const original = structuredClone(scene(initial, eventId));
  const knowledge = getEventKnowledge(initial, "mio", eventId);
  assert.equal(knowledge.status, "unknown");
  let state = subject(initial, eventId, "flower");
  const workId = person(state).action!.id;
  state = finish(state);
  state = finish(assign(state, "decorate"));
  state = finish(assign(state, "place-craft", "aki", String(workId)));
  const displayed = state.life!.events.find((event) => event.kind === "display" && event.craftId === workId)!;
  assert.ok(displayed.witnesses.includes("mio"));
  assert.match(displayed.text, /木陰|迂回路/);
  assert.equal(getEventKnowledge(state, "mio", displayed.id).status, "direct");
  state = finish(group(state, ["aki", "mio"], "socialize"), ["aki", "mio"]);
  const conversation = state.life!.events.filter((event) => event.kind === "conversation" && event.actors.includes("mio")).at(-1)!;
  assert.ok(conversation);
  assert.match(conversation.text, /花/);
  assert.match(conversation.text, /木陰|迂回路/);
  assert.deepEqual(scene(state, eventId), original);
  assert.deepEqual(getEventKnowledge(state, "mio", eventId), knowledge);
  assert.equal(state.life!.events.some((event) => event.report?.sourceEventId === eventId), false);
  assert.deepEqual(getCraftSubjectChoices(state, "mio"), []);
  assert.equal(piece(state, workId).subjectEventId, eventId);
  assert.match(getCraftDisplayTitle(state, piece(state, workId)), /花/);
  assert.deepEqual(deserialize(serialize(state)), state);
});
