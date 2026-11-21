import test from "node:test";
import assert from "node:assert/strict";
import {
  advance,
  availableResources,
  command,
  createGame,
  deserialize,
  getCraftConversationStatus,
  getEventKnowledge,
  getResidentLife,
  knowsCraft,
  serialize,
} from "../src/game/engine.ts";
import { assignCraftConversationSelection, assignSelection, assignSubjectCraftSelection } from "../src/game/selection.ts";
import { advanceToNextBoundaryFromControls, getTimeControls } from "../src/game/time-controls.ts";
import type { ActionKind, Command, GameState, LifeExperience, LocationId } from "../src/game/types.ts";

// Controlled core-API fixtures, independent of external play saves. Real work,
// travel and introductions use public commands. This is not browser play.
const person = (state: GameState, id = "aki") => state.residents.find((resident) => resident.id === id)!;
const introductions = (state: GameState) => state.life!.events.filter((event) => event.kind === "conversation" && event.topic?.kind === "craft");
const conversations = (state: GameState) => state.life!.events.filter((event) => event.kind === "conversation");
const work = (state: GameState, id: number) => state.life!.crafts.find((piece) => piece.id === id)!;

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
  const jobs = ids.map((id) => ({ id, actionId: person(state, id).action?.id }));
  assert.ok(jobs.every(({ actionId }) => actionId !== undefined));
  for (let step = 0; step < 1200; step++) {
    if (jobs.every(({ id, actionId }) => person(state, id).action?.id !== actionId)) return state;
    state = advance(state, 1);
  }
  assert.fail("The public action did not reach its boundary");
}
function move(state: GameState, ids: string[], target: LocationId): GameState {
  return finish(group(state, ids, "move", target), ids);
}
function introduce(state: GameState, craftId: number, ids = ["aki", "mio"]): GameState {
  const result = assignCraftConversationSelection(state, ids, craftId);
  assert.equal(result.error, undefined, result.error);
  return result.state;
}
function settled(seed: number): GameState {
  let state = createGame(seed);
  state.resources = { food: 20, ingredients: 20, medicine: 8, scrap: 20 };
  for (const resident of state.residents) {
    resident.hp = resident.hunger = resident.energy = 100;
    resident.mood = 40;
  }
  for (const id of ["aki", "mio", "ren"])
    state = act(state, { type: "policy", residentId: id, policy: "rest" });
  return state;
}
function artifact(seed = 2100, author = "aki", subject = false, display = false) {
  let state = settled(seed);
  const others = state.residents.filter((resident) => resident.id !== author).map((resident) => resident.id);
  state = move(state, others, "bedroom");
  if (subject) {
    state = move(state, [author], "shelter");
    state = finish(assign(state, "observe", author), [author]);
    state = move(state, [author], "home");
    const source = state.life!.events.find((event) => event.kind === "quiet" && event.location === "shelter")!;
    const result = assignSubjectCraftSelection(state, [author], "bird", source.id);
    assert.equal(result.error, undefined, result.error);
    state = result.state;
  } else state = assign(state, "hobby", author);
  const craftId = person(state, author).action!.id;
  state = finish(state, [author]);
  if (display) {
    state = finish(assign(state, "decorate", author), [author]);
    state = finish(assign(state, "place-craft", author, String(craftId)), [author]);
  }
  const viewer = author === "mio" ? "aki" : "mio";
  state = move(state, [viewer], "home");
  assert.equal(knowsCraft(state, viewer, craftId), false);
  return { state, craftId, author, viewer };
}
function reject(state: GameState, operation: () => { state: GameState; error?: string }) {
  const before = serialize(state);
  const result = operation();
  assert.ok(result.error);
  assert.strictEqual(result.state, state);
  assert.equal(serialize(state), before, "Failure must not partially suspend work, allocate ids or change reservations");
}
function corruptSave(state: GameState, corrupt: (saved: any) => void) {
  // Deliberately untyped JSON at the public save boundary, not a typed-valid
  // fixture disguised with a cast. Each corrupted save must be rejected.
  const saved = JSON.parse(serialize(state));
  corrupt(saved);
  assert.throws(() => deserialize(JSON.stringify(saved)));
}
function mechanics(state: GameState) {
  return {
    minutes: state.minutes, seed: state.seed, resources: state.resources,
    available: availableResources(state),
    residents: state.residents.map((resident) => ({
      id: resident.id, location: resident.location, hp: resident.hp,
      hunger: resident.hunger, energy: resident.energy, mood: resident.mood,
      skills: resident.skills, wounds: resident.wounds, relations: resident.relations,
    })),
  };
}
function pendingAid() {
  const fixture = artifact(2118);
  let state = fixture.state;
  person(state, "mio").hp = 35;
  state = assign(state, "sleep", "mio");
  const sleepId = person(state, "mio").action!.id;
  state = finish(assign(state, "heal", "aki", "mio"));
  const source = state.life!.events.find((event) => event.kind === "heal")!;
  assert.equal(getEventKnowledge(state, "mio", source.id).status, "unknown");
  state = act(state, { type: "cancel", residentId: "mio", actionId: sleepId });
  return { ...fixture, state, source };
}

test("An author can introduce a real carried work to an unknown returning viewer only after both spend twenty minutes", () => {
  const { state: initial, craftId } = artifact(2101, "aki", true);
  const facts = structuredClone(initial.life!.events);
  const object = structuredClone(work(initial, craftId));
  const before = serialize(initial);
  let state = introduce(initial, craftId);
  assert.equal(serialize(initial), before);
  assert.equal(state.minutes, initial.minutes);
  assert.equal(state.seed, initial.seed);
  assert.deepEqual(state.resources, initial.resources);
  for (const id of ["aki", "mio"]) {
    assert.equal(person(state, id).action?.duration, 20);
    assert.equal(person(state, id).action?.progress, 0);
    assert.equal(person(state, id).action?.reserved, undefined);
  }
  state = advance(state, 19);
  assert.equal(knowsCraft(state, "mio", craftId), false);
  assert.equal(introductions(state).length, 0);
  state = advance(state, 1);
  assert.equal(state.minutes, initial.minutes + 20);
  assert.equal(knowsCraft(state, "mio", craftId), true);
  assert.equal(introductions(state).length, 1);
  assert.deepEqual(introductions(state)[0].topic, { kind: "craft", craftId });
  assert.deepEqual(new Set(introductions(state)[0].actors), new Set(["aki", "mio"]));
  assert.equal(person(state).action, null);
  assert.equal(person(state, "mio").action, null);
  assert.deepEqual(work(state, craftId), object);
  assert.deepEqual(state.life!.events.filter((event) => facts.some((old) => old.id === event.id)), facts);
});

test("Selection order allocates the same reciprocal jobs for every possible author, independent of which person was last selected", () => {
  for (const author of ["aki", "mio", "ren"]) {
    const { state, craftId, viewer } = artifact(2102, author);
    const forward = introduce(state, craftId, [author, viewer]);
    const reverse = introduce(state, craftId, [viewer, author]);
    assert.deepEqual(reverse, forward);
    const authorJob = person(forward, author).action!;
    const viewerJob = person(forward, viewer).action!;
    assert.ok(authorJob.id < viewerJob.id);
    assert.equal(authorJob.target, viewer);
    assert.equal(viewerJob.target, author);
    assert.equal(authorJob.topic?.peerActionId, viewerJob.id);
    assert.equal(viewerJob.topic?.peerActionId, authorJob.id);
    const completed = advance(reverse, 20);
    assert.equal(introductions(completed).length, 1);
    assert.equal(introductions(completed)[0].actors[0], author);
    assert.equal(knowsCraft(completed, viewer, craftId), true);
  }
});

test("Explicit introductions and ordinary twenty-minute conversations share all bodily costs, relationship effects and daily caps", () => {
  const { state: initial, craftId } = artifact(2103);
  let plain = initial, explicit = initial;
  for (let repeat = 0; repeat < 4; repeat++) {
    plain = finish(group(plain, ["aki", "mio"], "socialize"), ["aki", "mio"]);
    explicit = finish(introduce(explicit, craftId), ["aki", "mio"]);
    assert.deepEqual(mechanics(explicit), mechanics(plain));
    assert.equal(explicit.autonomy!.conversations["aki:mio"].count, repeat + 1);
  }
  assert.equal(introductions(explicit).length, 4);
  assert.equal(person(explicit).relations.mio.closeness - person(initial).relations.mio.closeness, 5);
});

test("A carried work can be introduced in another base room, and the historical scene remains valid after the work is later displayed elsewhere", () => {
  const { state: initial, craftId } = artifact(2104);
  let state = move(initial, ["aki", "mio"], "kitchen");
  state = finish(introduce(state, craftId), ["aki", "mio"]);
  const shared = structuredClone(introductions(state)[0]);
  assert.equal(shared.location, "kitchen");
  assert.equal(work(state, craftId).createdLocation, "home");
  state = move(state, ["aki"], "home");
  state = finish(assign(state, "decorate"));
  state = finish(assign(state, "place-craft", "aki", String(craftId)));
  assert.equal(work(state, craftId).displayLocation, "home");
  assert.deepEqual(introductions(deserialize(serialize(state)))[0], shared);
});

test("A displayed work must be physically in the shared room; its author cannot introduce it remotely", () => {
  const { state: initial, craftId } = artifact(2105, "aki", false, true);
  const accepted = introduce(initial, craftId);
  assert.equal(person(accepted).action?.origin, "home");
  const away = move(initial, ["aki", "mio"], "kitchen");
  reject(away, () => assignCraftConversationSelection(away, ["aki", "mio"], craftId));
  assert.equal(work(away, craftId).displayLocation, "home");
});

test("Empty, single, three-person, author-free, missing-person and missing-work selections fail atomically", () => {
  const { state, craftId } = artifact(2106);
  for (const ids of [[], ["aki"], ["aki", "mio", "ren"], ["mio", "ren"], ["aki", "missing-person"]])
    reject(state, () => assignCraftConversationSelection(state, ids, craftId));
  for (const id of [0, -1, 1.5, NaN, Infinity, state.nextId + 100])
    reject(state, () => assignCraftConversationSelection(state, ["aki", "mio"], id));
});

test("Sleeping, unconscious, exhausted, separated or outdoor participants cannot start an introduction", () => {
  const fixture = artifact(2107);
  const asleep = assign(fixture.state, "sleep", "mio");
  reject(asleep, () => assignCraftConversationSelection(asleep, ["aki", "mio"], fixture.craftId));
  for (const condition of ["unconscious", "exhausted", "separated", "outdoor"] as const) {
    const state = structuredClone(fixture.state);
    if (condition === "unconscious") person(state, "mio").hp = 0;
    if (condition === "exhausted") person(state, "mio").energy = 2;
    if (condition === "separated") person(state, "mio").location = "kitchen";
    if (condition === "outdoor") for (const id of ["aki", "mio"]) person(state, id).location = "shelter";
    reject(state, () => assignCraftConversationSelection(state, ["aki", "mio"], fixture.craftId));
  }
});

test("A full job slot on the second participant cannot partly interrupt the author or steal materials", () => {
  const { state: initial, craftId } = artifact(2108);
  let state = assign(initial, "cook");
  state = assign(state, "project", "mio", "wood-flower");
  state = assign(state, "rest", "mio");
  assert.ok(person(state, "mio").action && person(state, "mio").suspended);
  const reserved = availableResources(state);
  reject(state, () => assignCraftConversationSelection(state, ["aki", "mio"], craftId));
  assert.equal(person(state).action?.kind, "cook");
  assert.equal(person(state).suspended, null);
  assert.deepEqual(availableResources(state), reserved);
});

test("Five saved minutes resume as fifteen remaining minutes and produce exactly one introduction and one relationship change", () => {
  const { state: initial, craftId } = artifact(2109);
  const partial = advance(introduce(initial, craftId), 5);
  const saved = serialize(partial);
  const restored = deserialize(saved);
  assert.equal(serialize(restored), saved);
  for (const id of ["aki", "mio"]) assert.equal(person(restored, id).action?.progress, 5);
  const direct = advance(partial, 15);
  const resumed = advance(restored, 15);
  assert.deepEqual(resumed, direct);
  assert.equal(introductions(resumed).length, 1);
  const after = advance(deserialize(serialize(resumed)), 5);
  assert.equal(introductions(after).length, 1);
  assert.deepEqual(person(after).relations, person(resumed).relations);
});

test("One paused participant stops the peer's progress while the common clock and a third resident's work continue", () => {
  const { state: initial, craftId } = artifact(2110);
  let state = advance(introduce(initial, craftId), 5);
  state = act(state, { type: "pause", residentId: "aki" });
  state = assign(state, "cook", "ren");
  const hunger = person(state, "mio").hunger;
  state = advance(state, 10);
  assert.equal(state.minutes, initial.minutes + 15);
  assert.equal(person(state, "mio").action?.progress, 5);
  assert.equal(person(state).suspended?.progress, 5);
  assert.equal(person(state, "ren").action?.progress, 10);
  assert.ok(person(state, "mio").hunger < hunger);
  assert.equal(getCraftConversationStatus(state, "mio")?.waiting, true);
  assert.ok(getCraftConversationStatus(state, "mio")?.reason);
  assert.equal(getTimeControls(state).nextMinutes, person(state, "ren").action!.duration - 10);
  state = advanceToNextBoundaryFromControls(state);
  assert.equal(person(state, "ren").action, null);
  assert.equal(person(state, "mio").action?.progress, 5);
  assert.equal(introductions(state).length, 0);
});

test("Paused partners can move, eat, return and resume one at a time without deadlock or losing the exact shared progress", () => {
  const { state: initial, craftId } = artifact(2111);
  let state = advance(introduce(initial, craftId), 5);
  state = act(state, { type: "pause", residentId: "aki" });
  state = act(state, { type: "pause", residentId: "mio" });
  const ids = [person(state).suspended!.id, person(state, "mio").suspended!.id];
  state = move(state, ["aki"], "kitchen");
  assert.deepEqual(deserialize(serialize(state)), state, "Load must allow a legitimate interrupted scene whose participants are currently apart");
  reject(state, () => command(state, { type: "resume", residentId: "aki" }));
  state = finish(assign(state, "eat"));
  state = move(state, ["aki"], "home");
  state = act(state, { type: "resume", residentId: "mio" });
  assert.equal(getCraftConversationStatus(state, "mio")?.waiting, true);
  state = advance(state, 3);
  assert.equal(person(state, "mio").action?.progress, 5);
  state = act(state, { type: "resume", residentId: "aki" });
  assert.equal(getCraftConversationStatus(state, "mio")?.waiting, false);
  assert.deepEqual([person(state).action!.id, person(state, "mio").action!.id], ids);
  state = advance(deserialize(serialize(state)), 15);
  assert.equal(introductions(state).length, 1);
});

test("Cancelling a paired scene keeps both previous suspended material reservations intact", () => {
  const { state: initial, craftId } = artifact(2112);
  let state = assign(initial, "cook");
  state = assign(state, "project", "mio", "wood-flower");
  const old = [structuredClone(person(state).action), structuredClone(person(state, "mio").action)];
  const free = availableResources(state);
  state = introduce(state, craftId);
  state = act(state, { type: "cancel", residentId: "mio", actionId: person(state, "mio").action!.id });
  assert.equal(person(state).action, null);
  assert.equal(person(state, "mio").action, null);
  assert.deepEqual([person(state).suspended, person(state, "mio").suspended], old);
  assert.deepEqual(availableResources(state), free);
  assert.deepEqual(state.resources, initial.resources);
});

test("Cancelling either side removes just the two scene jobs and preserves a new active meal and the other person's older project", () => {
  for (const cancelId of ["aki", "mio"]) {
    const { state: initial, craftId } = artifact(2113);
    let state = assign(initial, "project", "mio", "wood-flower");
    state = advance(introduce(state, craftId), 5);
    const pairIds = [person(state).action!.id, person(state, "mio").action!.id];
    state = act(state, { type: "pause", residentId: "aki" });
    state = assign(state, "eat");
    const meal = structuredClone(person(state).action);
    const project = structuredClone(person(state, "mio").suspended);
    const free = availableResources(state);
    state = act(state, { type: "cancel", residentId: cancelId, actionId: pairIds[cancelId === "aki" ? 0 : 1] });
    assert.deepEqual(person(state).action, meal);
    assert.equal(person(state).suspended, null);
    assert.equal(person(state, "mio").action, null);
    assert.deepEqual(person(state, "mio").suspended, project);
    assert.deepEqual(availableResources(state), free);
    assert.equal(introductions(state).length, 0);
    assert.deepEqual(deserialize(serialize(state)), state);
  }
});

test("A new ordinary two-person conversation preserves both interrupted topic jobs and can finish independently", () => {
  for (const order of [["aki", "mio"], ["mio", "aki"]]) {
    const { state: initial, craftId } = artifact(2114);
    let state = advance(introduce(initial, craftId), 5);
    const old = [structuredClone(person(state).action), structuredClone(person(state, "mio").action)];
    state = group(state, order, "socialize");
    assert.deepEqual([person(state).suspended, person(state, "mio").suspended], old);
    assert.equal(person(state).action?.topic, undefined);
    assert.equal(person(state, "mio").action?.topic, undefined);
    state = advance(deserialize(serialize(state)), 20);
    assert.equal(introductions(state).length, 0);
    assert.equal(conversations(state).length, 1);
    assert.deepEqual([person(state).suspended, person(state, "mio").suspended], old);
  }
});

test("A same-minute third-party generic order cannot merge into the explicit pair or create a phantom second conversation", () => {
  for (const automatic of [false, true]) {
    const { state: initial, craftId } = artifact(2115);
    let state = move(initial, ["ren"], "home");
    state = introduce(state, craftId);
    state = assign(state, "socialize", "ren", "aki");
    // The automatic variant is a controlled scheduling boundary, not an
    // assertion that the normal Ren policy autonomously chooses socializing.
    person(state, "ren").action!.automatic = automatic;
    state = advance(state, 20);
    assert.equal(conversations(state).length, 1);
    assert.deepEqual(new Set(introductions(state)[0].actors), new Set(["aki", "mio"]));
    assert.equal(person(state, "ren").action, null);
    assert.equal(knowsCraft(state, "ren", craftId), false);
    assert.deepEqual(person(state, "ren").relations, person(initial, "ren").relations);
  }
});

test("An introduction teaches only its actual pair about the object; bystanders learn neither the artifact nor its past craft, display or scenery", () => {
  const { state: initial, craftId } = artifact(2116, "aki", true, true);
  const old = structuredClone(initial.life!.events);
  let state = move(initial, ["ren"], "home");
  const input = serialize(state);
  assert.equal(knowsCraft(state, "ren", craftId), false);
  assert.equal(serialize(state), input, "Reading object knowledge is pure");
  state = advance(introduce(state, craftId), 20);
  const event = introductions(state)[0];
  assert.ok(event.witnesses.includes("ren"));
  assert.equal(getEventKnowledge(state, "ren", event.id).status, "direct");
  assert.equal(knowsCraft(state, "mio", craftId), true);
  assert.equal(knowsCraft(state, "ren", craftId), false);
  for (const source of old.filter((event) => ["craft", "display", "quiet"].includes(event.kind))) {
    assert.deepEqual(state.life!.events.find((event) => event.id === source.id), source);
    for (const id of ["mio", "ren"]) assert.equal(getEventKnowledge(state, id, source.id).status, "unknown");
  }
  const viewerText = getResidentLife(state, "mio").recentExperiences.find((entry) => entry.id === event.id)!.text;
  const bystanderText = getResidentLife(state, "ren").recentExperiences.find((entry) => entry.id === event.id)!.text;
  assert.match(viewerText, /題材|景色/);
  assert.doesNotMatch(bystanderText, /小鳥|木陰|題材/);
});

test("People who recognise one work through different evidence can later discuss that same object in an ordinary conversation", () => {
  const { state: initial, craftId } = artifact(2117);
  let state = move(initial, ["mio"], "bedroom");
  state = move(state, ["ren"], "home");
  state = finish(assign(state, "decorate"));
  state = finish(assign(state, "place-craft", "aki", String(craftId)));
  const display = state.life!.events.find((event) => event.kind === "display" && event.craftId === craftId)!;
  assert.equal(knowsCraft(state, "ren", craftId), true);
  state = move(state, ["mio"], "home");
  state = advance(introduce(state, craftId), 20);
  assert.equal(getEventKnowledge(state, "mio", display.id).status, "unknown");
  assert.equal(getEventKnowledge(state, "ren", display.id).status, "direct");
  state = move(state, ["aki"], "kitchen");
  state = finish(group(state, ["mio", "ren"], "socialize"), ["mio", "ren"]);
  const latest = conversations(state).at(-1)!;
  assert.equal(latest.topic, undefined);
  assert.match(latest.text, /小鳥/);
  assert.deepEqual(new Set(latest.actors), new Set(["mio", "ren"]));
});

test("Explicit artwork talk leaves a pending aid report untouched, and the next ordinary conversation still gives that report priority", () => {
  const { state: initial, craftId, source } = pendingAid();
  let state = advance(introduce(initial, craftId), 20);
  assert.equal(introductions(state)[0].report, undefined);
  assert.equal(getEventKnowledge(state, "mio", source.id).status, "unknown");
  state = finish(group(state, ["aki", "mio"], "socialize"), ["aki", "mio"]);
  assert.equal(conversations(state).at(-1)!.report?.sourceEventId, source.id);
  assert.equal(getEventKnowledge(state, "mio", source.id).status, "reported");
});

test("Saved topic actions reject malformed keys, types, unsupported work, reservations and automatic execution", () => {
  const { state: initial, craftId } = artifact(2119);
  const state = advance(introduce(initial, craftId), 5);
  const corruptions: Array<(saved: any) => void> = [
    (saved) => { saved.residents[0].action.topic = null; },
    (saved) => { saved.residents[0].action.topic.kind = "other"; },
    (saved) => { saved.residents[0].action.topic.extra = true; },
    (saved) => { saved.residents[0].action.topic.craftId = String(craftId); },
    (saved) => { saved.residents[0].action.topic.peerActionId = "2"; },
    (saved) => { saved.residents[0].action.automatic = true; },
    (saved) => { saved.residents[0].action.kind = "hobby"; },
    (saved) => { saved.residents[0].action.reserved = { food: 1 }; },
    (saved) => { saved.residents[0].action.duration = 19; saved.residents[1].action.duration = 19; },
    (saved) => { saved.residents[0].action.progress = 5.5; saved.residents[1].action.progress = 5.5; },
  ];
  const before = serialize(state);
  for (const corrupt of corruptions) corruptSave(state, corrupt);
  assert.equal(serialize(state), before);
});

test("Saved paired actions reject missing halves, wrong reciprocal identities, different works, unequal progress and a missing author", () => {
  const { state: initial, craftId } = artifact(2120);
  const state = advance(introduce(initial, craftId), 5);
  const corruptions: Array<(saved: any) => void> = [
    (saved) => { delete saved.residents[1].action.topic; },
    (saved) => { saved.residents[1].action = null; },
    (saved) => { saved.residents[0].action.topic.peerActionId = saved.residents[0].action.id; },
    (saved) => { saved.residents[1].action.target = "ren"; },
    (saved) => { saved.residents[1].action.topic.craftId = saved.nextId + 10; },
    (saved) => { saved.residents[1].action.progress = 4; },
    (saved) => { saved.residents[1].action.origin = "kitchen"; },
    (saved) => {
      const authorJob = saved.residents[0].action;
      saved.residents[0].action = null;
      saved.residents[2].action = authorJob;
      saved.residents[1].action.target = "ren";
    },
  ];
  for (const corrupt of corruptions) corruptSave(state, corrupt);
  const paused = act(state, { type: "pause", residentId: "aki" });
  assert.deepEqual(deserialize(serialize(paused)), paused);
  corruptSave(paused, (saved) => { saved.residents[0].suspended.topic.peerActionId = saved.nextId + 1; });
});

test("Completed explicit scenes validate exact topics, actual participants, chronology and exclusion of even an otherwise valid report", () => {
  const { state: initial, craftId, source } = pendingAid();
  const state = advance(introduce(initial, craftId), 20);
  const eventId = introductions(state)[0].id;
  const event = (saved: any) => saved.life.events.find((entry: LifeExperience) => entry.id === eventId);
  const corruptions: Array<(saved: any) => void> = [
    (saved) => { event(saved).topic.extra = true; },
    (saved) => { event(saved).topic.craftId = "1"; },
    (saved) => { event(saved).topic.craftId = saved.nextId + 10; },
    (saved) => { event(saved).kind = "quiet"; },
    (saved) => { event(saved).actors = ["aki"]; },
    (saved) => { event(saved).actors = ["mio", "ren"]; },
    (saved) => { event(saved).witnesses = ["aki"]; },
    (saved) => { event(saved).craftId = craftId; },
    (saved) => { event(saved).report = { sourceEventId: source.id, speakerId: "aki", listenerId: "mio" }; },
    (saved) => { event(saved).time = work(state, craftId).createdAt - 1; },
  ];
  const before = serialize(state);
  for (const corrupt of corruptions) corruptSave(state, corrupt);
  assert.equal(serialize(state), before);
  assert.deepEqual(deserialize(before), state);
});

test("Old ordinary conversation saves keep their absent metadata and readers never infer object recognition from prose", () => {
  const { state: initial, craftId } = artifact(2122);
  const active = group(initial, ["aki", "mio"], "socialize");
  const saved = serialize(active);
  assert.equal(serialize(deserialize(saved)), saved);
  assert.equal(person(active).action?.topic, undefined);
  assert.equal(getCraftConversationStatus(active, "aki"), undefined);
  assert.equal(knowsCraft(active, "missing-person", craftId), false);
  assert.equal(knowsCraft(active, "mio", active.nextId + 10), false);
  const state = advance(active, 20);
  const event = conversations(state)[0];
  event.text = "小鳥の木彫りを見ながら話した。";
  const before = serialize(state);
  const restored = deserialize(before);
  assert.equal(serialize(restored), before);
  assert.equal(Object.hasOwn(conversations(restored)[0], "topic"), false);
  assert.equal(knowsCraft(restored, "mio", craftId), false);
  assert.equal(knowsCraft(restored, "aki", craftId), true);
});

test("A genuinely finished introduction still records recognition inside the ordinary conversation cooldown, without another reward", () => {
  const { state: initial, craftId } = artifact(2123);
  let state = advance(introduce(initial, craftId), 5);
  state = act(state, { type: "pause", residentId: "aki" });
  state = act(state, { type: "pause", residentId: "mio" });
  state = finish(group(state, ["aki", "mio"], "socialize"), ["aki", "mio"]);
  assert.equal(knowsCraft(state, "mio", craftId), false);
  const lastReward = structuredClone(state.autonomy!.conversations["aki:mio"]);
  const bodies = ["aki", "mio"].map((id) => ({ relations: structuredClone(person(state, id).relations), mood: person(state, id).mood }));
  state = act(state, { type: "resume", residentId: "aki" });
  state = act(state, { type: "resume", residentId: "mio" });
  state = advance(deserialize(serialize(state)), 15);
  assert.equal(state.minutes - lastReward.time, 15);
  assert.equal(introductions(state).length, 1);
  assert.equal(knowsCraft(state, "mio", craftId), true);
  assert.deepEqual(state.autonomy!.conversations["aki:mio"], lastReward);
  assert.deepEqual(["aki", "mio"].map((id) => ({ relations: person(state, id).relations, mood: person(state, id).mood })), bodies);
  const after = advance(deserialize(serialize(state)), 5);
  assert.equal(introductions(after).length, 1);
});

test("A scene about an already displayed object must have its real display location, while earlier carried scenes remain valid after later display", () => {
  const displayed = artifact(2124, "aki", false, true);
  const state = advance(introduce(displayed.state, displayed.craftId), 20);
  const eventId = introductions(state)[0].id;
  assert.equal(introductions(state)[0].location, "home");
  assert.ok(work(state, displayed.craftId).displayedAt! <= introductions(state)[0].time);
  corruptSave(state, (saved) => {
    saved.life.events.find((event: LifeExperience) => event.id === eventId).location = "bedroom";
  });

  const carried = artifact(2125);
  let natural = move(carried.state, ["aki", "mio"], "bedroom");
  natural = advance(introduce(natural, carried.craftId), 20);
  const carriedScene = structuredClone(introductions(natural)[0]);
  natural = move(natural, ["aki"], "home");
  natural = finish(assign(natural, "decorate"));
  natural = finish(assign(natural, "place-craft", "aki", String(carried.craftId)));
  assert.ok(carriedScene.time < work(natural, carried.craftId).displayedAt!);
  assert.deepEqual(introductions(deserialize(serialize(natural)))[0], carriedScene);
});
