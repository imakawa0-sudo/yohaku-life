import test from "node:test";
import assert from "node:assert/strict";
import {
  advance,
  command,
  createGame,
  deserialize,
  getEventKnowledge,
  getIncomingConversation,
  getResidentLife,
  knowsLifeEvent,
  serialize,
} from "../src/game/engine.ts";
import { assignSelection } from "../src/game/selection.ts";
import type { ActionKind, Command, GameState, LifeExperience } from "../src/game/types.ts";

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
  assert.fail("The reserved action did not finish");
}

function quietNight(seed = 20261120): GameState {
  let state = createGame(seed);
  state.minutes = 1320;
  for (const resident of state.residents) {
    resident.hunger = 100;
    resident.energy = 100;
    state = act(state, { type: "policy", residentId: resident.id, policy: "rest" });
  }
  return state;
}

function healWhileAsleep(): { state: GameState; source: LifeExperience } {
  let state = quietNight(40);
  person(state).hp = 20;
  person(state).wounds.arm = 1;
  person(state, "ren").location = "bedroom";
  state = assign(state, "sleep");
  const sleepId = person(state).action!.id;
  state = finish(assign(state, "heal", "mio", "aki"), "mio");
  const source = state.life!.events.find((event) => event.kind === "heal")!;
  assert.ok(source);
  state = act(state, { type: "cancel", residentId: "aki", actionId: sleepId });
  state = finish(assign(state, "move", "ren", "home"), "ren");
  return { state, source };
}

function rescued(withSleepingTreatment = false): { state: GameState; rescue: LifeExperience; heal: LifeExperience } {
  let state = quietNight(41);
  person(state).location = "road";
  person(state).hp = 0;
  person(state).wounds.body = 2;
  person(state, "mio").location = "road";
  state = finish(assign(state, "rescue", "mio", "aki"), "mio");
  const rescue = state.life!.events.find((event) => event.kind === "rescue")!;
  state = advance(state, 1);
  assert.ok(person(state).hp > 0);
  if (withSleepingTreatment) state = assign(state, "sleep");
  state = finish(assign(state, "heal", "mio", "aki"), "mio");
  const heal = state.life!.events.find((event) => event.kind === "heal")!;
  if (withSleepingTreatment) state = act(state, { type: "cancel", residentId: "aki" });
  return { state, rescue, heal };
}

function talk(state: GameState, ids = ["aki", "mio"]): GameState {
  const result = assignSelection(state, ids, "socialize");
  assert.equal(result.error, undefined, result.error);
  return advance(result.state, 20);
}

function reports(state: GameState) { return state.life!.events.filter((event) => event.report !== undefined); }

function toMorning(state: GameState, ids = ["aki"]): GameState {
  let target = Math.floor(state.minutes / 1440) * 1440 + 480;
  if (target <= state.minutes) target += 1440;
  const sleeping = assignSelection(state, ids, "sleep");
  assert.equal(sleeping.error, undefined, sleeping.error);
  state = finish(sleeping.state, ids[0]);
  while (state.minutes < target) {
    state = advance(state, Math.min(30, target - state.minutes));
    assert.doesNotMatch(state.pauseReason ?? "", /空腹|活力/);
  }
  return state;
}

test("Knowledge queries, waking, a queued conversation, and the next morning do not teach an unobserved treatment", () => {
  const fixture = healWhileAsleep();
  let state = fixture.state;
  const id = fixture.source.id;
  const before = serialize(state);
  assert.deepEqual(getEventKnowledge(state, "aki", id), { status: "unknown" });
  assert.deepEqual(getEventKnowledge(state, "mio", id), { status: "direct", knownAt: fixture.source.time });
  assert.deepEqual(getEventKnowledge(state, "ren", id), { status: "unknown" });
  assert.deepEqual(getEventKnowledge(state, "unknown", id), { status: "unknown" });
  assert.deepEqual(getEventKnowledge(state, "aki", 999999), { status: "unknown" });
  assert.equal(knowsLifeEvent(state, "aki", id), false);
  getResidentLife(state, "aki");
  assert.equal(serialize(state), before);
  const queued = assign(state, "socialize", "aki", "mio");
  assert.equal(getEventKnowledge(queued, "aki", id).status, "unknown");
  assert.equal(queued.minutes, state.minutes);
  state = toMorning(state);
  assert.equal(getEventKnowledge(state, "aki", id).status, "unknown");
  assert.equal(reports(state).length, 0);
});

test("A direct rescue witness can tell the recovered subject without rewriting history or granting gratitude rewards", () => {
  const fixture = rescued();
  let state = fixture.state;
  const source = structuredClone(fixture.rescue);
  const rescuerRelation = structuredClone(person(state).relations.mio);
  const listenerRelation = structuredClone(person(state).relations.ren);
  const speakerRelation = structuredClone(person(state, "ren").relations.aki);
  assert.equal(getEventKnowledge(state, "aki", source.id).status, "unknown");
  assert.equal(getEventKnowledge(state, "ren", source.id).status, "direct");
  state = talk(state, ["aki", "ren"]);
  const conversation = reports(state)[0];
  assert.ok(conversation);
  assert.deepEqual(conversation.report, { sourceEventId: source.id, speakerId: "ren", listenerId: "aki" });
  assert.deepEqual(getEventKnowledge(state, "aki", source.id), {
    status: "reported", knownAt: conversation.time, speakerId: "ren", conversationEventId: conversation.id,
  });
  assert.deepEqual(state.life!.events.find((event) => event.id === source.id), source);
  assert.deepEqual(person(state).relations.mio, rescuerRelation);
  assert.equal(person(state).relations.ren.closeness, listenerRelation.closeness + 4);
  assert.equal(person(state).relations.ren.trust, listenerRelation.trust + 1);
  assert.equal(person(state, "ren").relations.aki.closeness, speakerRelation.closeness + 4);
  assert.equal(person(state, "ren").relations.aki.trust, speakerRelation.trust + 1);
  assert.equal(getResidentLife(state, "aki").recentExperiences.some((event) => event.id === source.id), false);
  assert.deepEqual(deserialize(serialize(state)), state);
});

test("Nonwitnesses and conversation bystanders do not receive or relay the private treatment report", () => {
  const fixture = healWhileAsleep();
  let state = talk(fixture.state, ["aki", "ren"]);
  assert.equal(reports(state).length, 0);
  assert.equal(getEventKnowledge(state, "aki", fixture.source.id).status, "unknown");
  const renMemoryCount = person(state, "ren").memories.length;
  state = talk(state, ["aki", "mio"]);
  assert.equal(reports(state).length, 1);
  assert.equal(getEventKnowledge(state, "aki", fixture.source.id).status, "reported");
  assert.equal(getEventKnowledge(state, "ren", fixture.source.id).status, "unknown");
  const renMemories = person(state, "ren").memories.slice(renMemoryCount);
  assert.equal(renMemories.length, 1);
  assert.match(renMemories[0], /言葉|会話/);
  assert.doesNotMatch(renMemories[0], /手当|救助|運ん|傷/);
  const reportEvent = reports(state)[0];
  assert.doesNotMatch(reportEvent.text, /手当|救助|運ん|傷/);
  const managerLog = state.logs.find((entry) => entry.time === reportEvent.time && entry.type === "social");
  assert.ok(managerLog);
  assert.match(managerLog.text, /アキ.*ミオ.*聞いた/);
  assert.match(managerLog.text, /手当/);
  const projected = getResidentLife(state, "ren").recentExperiences.find((event) => event.id === reportEvent.id);
  assert.ok(projected);
  assert.doesNotMatch(projected.text, /手当|救助|運ん|傷/);
  assert.match(getResidentLife(state, "aki").recentExperiences.find((event) => event.id === reportEvent.id)!.text, /聞いた/);
  state = talk(state, ["aki", "ren"]);
  assert.equal(getEventKnowledge(state, "ren", fixture.source.id).status, "unknown");
  assert.equal(reports(state).length, 1);
  state = toMorning(state, ["aki", "mio", "ren"]);
  assert.equal(getEventKnowledge(state, "ren", fixture.source.id).status, "unknown");
  const bystanderReflection = getResidentLife(state, "ren").reflection;
  assert.ok(bystanderReflection);
  assert.doesNotMatch(bystanderReflection.text, /手当|救助|運ん|傷/);
});

test("Cancelled or impossible conversations never report, while a normally paused conversation can resume once", () => {
  for (const interruption of ["cancel", "sleep", "move", "unconscious"] as const) {
    const fixture = healWhileAsleep();
    let state = advance(assign(fixture.state, "socialize", "aki", "mio"), 5);
    if (interruption === "cancel") state = act(state, { type: "cancel", residentId: "aki" });
    if (interruption === "sleep") state = assign(state, "sleep", "mio");
    if (interruption === "move") state = assign(state, "move", "mio", "bedroom");
    if (interruption === "unconscious") person(state).hp = 0;
    const target = state.minutes + 15;
    while (state.minutes < target) state = advance(state, target - state.minutes);
    assert.equal(reports(state).length, 0, interruption);
    assert.equal(getEventKnowledge(state, "aki", fixture.source.id).status, "unknown", interruption);
  }
  const fixture = healWhileAsleep();
  let resumed = advance(assign(fixture.state, "socialize", "aki", "mio"), 5);
  resumed = act(resumed, { type: "pause", residentId: "aki" });
  resumed = advance(deserialize(serialize(resumed)), 10);
  assert.equal(reports(resumed).length, 0);
  resumed = act(resumed, { type: "resume", residentId: "aki" });
  resumed = advance(resumed, 15);
  assert.equal(reports(resumed).length, 1);
});

test("One group conversation chooses one deterministic report, preferring rescue and its actual rescuer, without relearning it", () => {
  const fixture = rescued(true);
  const beforeFacts = structuredClone(fixture.state.life!.events);
  assert.equal(getEventKnowledge(fixture.state, "aki", fixture.rescue.id).status, "unknown");
  assert.equal(getEventKnowledge(fixture.state, "aki", fixture.heal.id).status, "unknown");
  let state = talk(fixture.state, ["aki", "mio", "ren"]);
  assert.equal(reports(state).length, 1);
  assert.deepEqual(reports(state)[0].report, { sourceEventId: fixture.rescue.id, speakerId: "mio", listenerId: "aki" });
  assert.equal(state.life!.events.filter((event) => event.kind === "conversation").length, 1);
  const reordered = structuredClone(fixture.state);
  reordered.life!.events.reverse();
  const otherOrder = talk(deserialize(serialize(reordered)), ["aki", "mio", "ren"]);
  assert.deepEqual(reports(otherOrder)[0].report, reports(state)[0].report);
  state = talk(deserialize(serialize(state)), ["aki", "mio", "ren"]);
  assert.equal(reports(state).length, 2);
  assert.equal(reports(state)[1].report?.sourceEventId, fixture.heal.id);
  state = talk(state, ["aki", "mio", "ren"]);
  assert.equal(reports(state).length, 2);
  for (const source of beforeFacts)
    assert.deepEqual(state.life!.events.find((event) => event.id === source.id), source);
});

test("Learning an old treatment today produces a heard conversation reflection tomorrow, not a rewritten eyewitness memory", () => {
  const fixture = healWhileAsleep();
  let state = fixture.state;
  state.minutes += 1440;
  // This controlled age fixture jumps the clock rather than simulating the day;
  // use legacy scheduling so a known merchant appointment is not left in the past.
  delete state.trade;
  state = talk(state);
  const conversation = reports(state)[0];
  assert.ok(conversation.time - fixture.source.time > 1440);
  assert.equal(getEventKnowledge(state, "aki", fixture.source.id).status, "reported");
  state = toMorning(state);
  const reflection = getResidentLife(state, "aki").reflection;
  assert.ok(reflection);
  assert.equal(reflection.eventId, conversation.id);
  assert.match(reflection.text, /ミオ.*聞いた/);
  assert.doesNotMatch(reflection.text, /見た|ありがとう/);
  assert.deepEqual(deserialize(serialize(state)), state);
});

test("Reporting reproduces across a saved partial conversation and does not consume random numbers", () => {
  const fixture = healWhileAsleep();
  let state = assign(fixture.state, "socialize", "aki", "mio");
  state = advance(state, 5);
  const seed = state.seed;
  const whole = advance(state, 15);
  let split = deserialize(serialize(state));
  for (let minute = 0; minute < 15; minute++) split = advance(split, 1);
  assert.deepEqual(split, whole);
  assert.equal(whole.seed, seed);
  assert.equal(reports(whole).length, 1);
  const beforeRead = serialize(whole);
  getEventKnowledge(whole, "aki", fixture.source.id);
  getResidentLife(whole, "aki");
  getResidentLife(whole, "ren");
  assert.equal(serialize(whole), beforeRead);
});

test("Malformed report references, qualifications, timing, and duplicate learning are rejected", () => {
  const fixture = healWhileAsleep();
  const valid = talk(fixture.state, ["aki", "mio", "ren"]);
  const conversationId = reports(valid)[0].id;
  const before = serialize(valid);
  const event = (state: GameState) => state.life!.events.find((entry) => entry.id === conversationId)!;
  const source = (state: GameState) => state.life!.events.find((entry) => entry.id === fixture.source.id)!;
  const corruptions: Array<(state: GameState) => void> = [
    (state) => { event(state).report!.sourceEventId = 999999; },
    (state) => { event(state).report!.sourceEventId = conversationId; },
    (state) => { event(state).report!.speakerId = "aki"; },
    (state) => { event(state).report!.speakerId = "ren"; },
    (state) => { event(state).report!.listenerId = "ren"; },
    (state) => { source(state).time = event(state).time; },
    (state) => { source(state).witnesses = []; },
    (state) => { event(state).witnesses = ["mio", "ren"]; },
    (state) => { (event(state).report as unknown as Record<string, unknown>).extra = true; },
    (state) => { source(state).report = { ...event(state).report! }; delete event(state).report; },
  ];
  for (const corrupt of corruptions) {
    const broken = structuredClone(valid);
    corrupt(broken);
    assert.throws(() => deserialize(serialize(broken)));
  }
  const duplicated = talk(deserialize(before), ["aki", "mio", "ren"]);
  const conversations = duplicated.life!.events.filter((entry) => entry.kind === "conversation");
  conversations.at(-1)!.report = { ...conversations[0].report! };
  assert.throws(() => deserialize(serialize(duplicated)));
  assert.equal(serialize(valid), before);
  assert.deepEqual(deserialize(before), valid);
});

test("Old conversations without report metadata do not infer knowledge from their text or remembered prose", () => {
  const fixture = healWhileAsleep();
  const legacy = talk(fixture.state);
  delete reports(legacy)[0].report;
  const restored = deserialize(serialize(legacy));
  assert.equal(person(restored).memories.some((memory) => memory.includes("聞いた")), true);
  assert.equal(getEventKnowledge(restored, "aki", fixture.source.id).status, "unknown");
  assert.equal(reports(restored).length, 0);
});

test("The three actual diners receive distinct factual morning words and stored older wording is preserved", () => {
  const initial = quietNight(42);
  const eating = assignSelection(initial, ["aki", "mio", "ren"], "eat");
  assert.equal(eating.error, undefined);
  let state = advance(eating.state, 15);
  const meal = state.life!.events.find((event) => event.kind === "meal")!;
  state = toMorning(state, ["aki", "mio", "ren"]);
  const reflections = state.residents.map((resident) => getResidentLife(state, resident.id).reflection!);
  assert.equal(new Set(reflections.map((reflection) => reflection.text)).size, 3);
  for (const reflection of reflections) {
    assert.equal(reflection.eventId, meal.id);
    assert.match(reflection.text, /三人/);
    assert.match(reflection.text, /食卓|食事/);
  }
  const committed = "昨日は三人で食卓を囲んだ。今日も、顔を合わせる時間を作れたらいい。";
  state.life!.reflections.find((reflection) => reflection.residentId === "aki")!.text = committed;
  state = advance(deserialize(serialize(state)), 1);
  assert.equal(getResidentLife(state, "aki").reflection?.text, committed);
});

test("The incoming-conversation hint is pure, identifies only autonomous speakers, and never reserves a hero response", () => {
  let state = advance(createGame(43), 1);
  assert.equal(person(state, "mio").action?.kind, "socialize");
  assert.equal(person(state, "mio").action?.target, "aki");
  assert.equal(person(state).action, null);
  const before = serialize(state);
  assert.deepEqual(getIncomingConversation(state, "aki"), { speakerIds: ["mio"], listenerId: "aki" });
  assert.equal(getIncomingConversation(state, "unknown"), undefined);
  assert.equal(serialize(state), before);
  let briefMeal = assign(state, "eat");
  briefMeal = advance(briefMeal, 15);
  assert.deepEqual(getIncomingConversation(briefMeal, "aki"), { speakerIds: ["mio"], listenerId: "aki" });
  briefMeal = advance(briefMeal, 4);
  assert.equal(briefMeal.life!.events.filter((event) => event.kind === "conversation").length, 1,
    "A short direct order can finish before the speaker's conversation, so it is not a guaranteed cancellation");
  state = assign(state, "hobby");
  assert.equal(getIncomingConversation(state, "aki"), undefined);
  assert.equal(person(state).action?.automatic, false);
  const manual = assign(quietNight(44), "socialize", "mio", "aki");
  assert.equal(getIncomingConversation(manual, "aki"), undefined);
});
