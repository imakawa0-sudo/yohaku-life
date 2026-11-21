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
import type { ActionKind, Command, GameState } from "../src/game/types.ts";

const person = (state: GameState, id = "aki") => state.residents.find((resident) => resident.id === id)!;
function act(state: GameState, instruction: Command): GameState {
  const result = command(state, instruction);
  assert.equal(result.error, undefined, result.error);
  return result.state;
}
function assign(state: GameState, kind: ActionKind, id = "aki", target?: string): GameState {
  return act(state, { type: "assign", residentIds: [id], kind, target });
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
function finish(state: GameState, id = "aki"): GameState {
  const actionId = person(state, id).action?.id;
  assert.notEqual(actionId, undefined);
  for (let step = 0; step < 100; step++) {
    if (person(state, id).action?.id !== actionId) return state;
    state = advance(state, 120, { stopAtActionEnd: true });
  }
  assert.fail("The retained action never completed");
}
function starveOnNextMinute(state: GameState, id = "aki") {
  person(state, id).hunger = 0;
  person(state, id).hp = 0.05;
}
function close(actual: number, expected: number) {
  assert.ok(Math.abs(actual - expected) < 1e-8, `${actual} differs from ${expected}`);
}

test("A revival minute preserves real cooking progress and reserved ingredients while other people and the clock advance", () => {
  let state = assign(still(80), "cook");
  state = assign(state, "rest", "ren");
  state = advance(state, 5);
  starveOnNextMinute(state);
  const work = structuredClone(person(state).action);
  const resources = { ...state.resources };
  assert.equal(work?.progress, 5);
  assert.equal(work?.duration, 34);
  assert.deepEqual(work?.reserved, { ingredients: 2 });
  const original = serialize(state);
  state = advance(state, 120, { stopAtActionEnd: true });
  assert.equal(state.minutes, 486);
  assert.equal(person(state).hp, 0.5);
  assert.deepEqual(person(state).action, work);
  assert.equal(person(state, "ren").action?.progress, 6);
  assert.deepEqual(state.resources, resources);
  assert.equal(availableResources(state).ingredients, resources.ingredients - 2);
  assert.match(state.pauseReason ?? "", /意識が戻/);
  assert.equal(deserialize(original).minutes, 485);
  const saved = serialize(state);
  getResidentLife(state, "aki");
  assert.deepEqual(advance(state, 0), state);
  assert.equal(serialize(state), saved);
  state = advance(deserialize(saved), 1);
  assert.equal(person(state).action?.progress, 6);
  state = finish(state);
  assert.equal(state.resources.ingredients, resources.ingredients - 2);
  assert.equal(state.resources.food, resources.food + 3);
  assert.equal(state.logs.filter((entry) => entry.title === "温かい食事ができた").length, 1);
  assert.deepEqual(advance(state, 5).resources, state.resources);
});

test("Revival keeps both current cooking and suspended decorating, and cancelling either releases only its own reservation", () => {
  let state = advance(assign(still(81), "decorate"), 5);
  state = advance(assign(state, "cook"), 3);
  starveOnNextMinute(state);
  const current = structuredClone(person(state).action);
  const suspended = structuredClone(person(state).suspended);
  state = advance(deserialize(serialize(state)), 1);
  assert.deepEqual(person(state).action, current);
  assert.deepEqual(person(state).suspended, suspended);
  assert.equal(availableResources(state).ingredients, state.resources.ingredients - 2);
  assert.equal(availableResources(state).scrap, state.resources.scrap - 2);
  const cancelCurrent = act(state, { type: "cancel", residentId: "aki", actionId: current!.id });
  assert.deepEqual(person(cancelCurrent).suspended, suspended);
  assert.equal(availableResources(cancelCurrent).ingredients, state.resources.ingredients);
  assert.equal(availableResources(cancelCurrent).scrap, state.resources.scrap - 2);
  const cancelSuspended = act(state, { type: "cancel", residentId: "aki", actionId: suspended!.id });
  assert.deepEqual(person(cancelSuspended).action, current);
  assert.equal(availableResources(cancelSuspended).scrap, state.resources.scrap);
  assert.equal(availableResources(cancelSuspended).ingredients, state.resources.ingredients - 2);
  assert.deepEqual(deserialize(serialize(state)), state);
});

test("Due sleep, rest, movement, crafting, and treatment do not run their personal tick or finish during revival", () => {
  const cases: { kind: ActionKind; target?: string }[] = [
    { kind: "sleep" }, { kind: "rest" }, { kind: "move", target: "garden" },
    { kind: "hobby" }, { kind: "heal", target: "aki" },
  ];
  for (const entry of cases) {
    let state = still(82);
    if (entry.kind === "heal") person(state).hp = 50;
    state = assign(state, entry.kind, "aki", entry.target);
    const duration = person(state).action!.duration;
    state = advance(state, duration - 1);
    assert.equal(person(state).action?.progress, duration - 1, entry.kind);
    person(state).energy = 40;
    starveOnNextMinute(state);
    const work = structuredClone(person(state).action);
    const resources = { ...state.resources };
    const location = person(state).location;
    state = advance(state, 10, { stopAtActionEnd: true });
    assert.deepEqual(person(state).action, work, entry.kind);
    assert.equal(person(state).hp, 0.5, entry.kind);
    close(person(state).energy, 40 - (["rest", "sleep"].includes(entry.kind) ? 0.012 : 0.045));
    assert.equal(person(state).location, location);
    assert.deepEqual(state.resources, resources);
    assert.equal(state.flags.hobbyFinished, false);
    state = advance(state, 1);
    assert.equal(person(state).action, null, entry.kind);
    if (entry.kind === "sleep") close(person(state).hp, 0.49);
    if (entry.kind === "rest") close(person(state).hp, 2.45);
    if (entry.kind === "move") assert.equal(person(state).location, "garden");
    if (entry.kind === "hobby") assert.equal(state.life!.crafts.length, 1);
    if (entry.kind === "heal") {
      close(person(state).hp, 45.45);
      assert.equal(state.resources.medicine, resources.medicine - 1);
    }
    assert.deepEqual(deserialize(serialize(state)), state);
  }
});

test("A revived idle companion receives no autonomous order until the next explicit advance", () => {
  const initial = still(83);
  starveOnNextMinute(initial, "mio");
  let state = advance(initial, 60);
  assert.equal(state.minutes, initial.minutes + 1);
  assert.equal(person(state, "mio").action, null);
  assert.equal(person(state, "mio").hp, 0.5);
  state = advance(state, 1);
  assert.equal(person(state, "mio").action?.kind, "eat");
  assert.equal(person(state, "mio").action?.progress, 1);
});

test("Garden gathering at its real location survives revival and only completes on a later minute", () => {
  let state = finish(assign(still(84), "move", "aki", "garden"));
  state = advance(assign(state, "gather"), 24);
  starveOnNextMinute(state);
  const ingredients = state.resources.ingredients;
  const action = structuredClone(person(state).action);
  state = advance(state, 10);
  assert.deepEqual(person(state).action, action);
  assert.equal(state.resources.ingredients, ingredients);
  assert.equal(state.life?.events.filter((event) => event.kind === "supply").length ?? 0, 0);
  const revival = state.logs.findLast((entry) => entry.title === "意識が戻った")!;
  assert.match(revival.text, /裏庭/);
  assert.doesNotMatch(revival.text, /寝床|傷は深/);
  assert.deepEqual(person(state).wounds, { arm: 0, leg: 0, body: 0 });
  state = advance(state, 1);
  assert.equal(state.resources.ingredients, ingredients + 3);
  assert.equal(state.life!.events.filter((event) => event.kind === "supply").length, 1);
});

test("The all-starving household recovers by ordinary treatment, gathering, cooking, and meals without preemptive pause tricks", () => {
  let state = createGame(85);
  for (const resident of state.residents) { resident.hp = 0.5; resident.hunger = 0; }
  state.resources.food = 0;
  state.resources.ingredients = 0;
  state = finish(assign(state, "heal", "aki", "aki"));
  assert.ok(person(state).hp >= 45);
  state = finish(assign(state, "move", "aki", "garden"));
  state = finish(assign(state, "gather"));
  state = finish(assign(state, "move", "aki", "home"));
  state = finish(assign(state, "cook"));
  assert.ok(state.resources.food >= 3);
  const eating = assignSelection(state, ["aki", "mio", "ren"], "eat");
  assert.equal(eating.error, undefined, eating.error);
  state = finish(eating.state);
  assert.ok(state.residents.every((resident) => resident.hunger > 50));
  assert.equal(state.ended, false);
  assert.equal(state.logs.filter((entry) => entry.title === "傷の手当" && entry.actors.includes("aki")).length, 1);
  assert.deepEqual(deserialize(serialize(state)), state);
});

function unobservedTreatment(): { state: GameState; eventId: number } {
  let state = still(86);
  person(state).hp = 20;
  person(state, "ren").location = "bedroom";
  state = assign(state, "sleep");
  state = finish(assign(state, "heal", "mio", "aki"), "mio");
  const eventId = state.life!.events.find((entry) => entry.kind === "heal")!.id;
  state = act(state, { type: "cancel", residentId: "aki" });
  assert.equal(getEventKnowledge(state, "aki", eventId).status, "unknown");
  return { state, eventId };
}

test("A newly revived conversation target is not made a participant or taught a report that minute", () => {
  const fixture = unobservedTreatment();
  let state = advance(assign(fixture.state, "socialize", "mio", "aki"), 19);
  const relations = structuredClone(state.residents.map((resident) => resident.relations));
  starveOnNextMinute(state);
  state = advance(state, 20);
  assert.equal(person(state, "mio").action, null);
  assert.equal(state.life!.events.filter((entry) => entry.kind === "conversation").length, 0);
  assert.equal(getEventKnowledge(state, "aki", fixture.eventId).status, "unknown");
  assert.deepEqual(state.residents.map((resident) => resident.relations), relations);
  assert.ok(state.logs.some((entry) => entry.title === "会話はおあずけ"));
});

test("A revived actor's own due conversation stays pending when its partner's simultaneous conversation ends", () => {
  const fixture = unobservedTreatment();
  const together = assignSelection(fixture.state, ["aki", "mio"], "socialize");
  assert.equal(together.error, undefined);
  let state = advance(together.state, 19);
  const action = structuredClone(person(state).action);
  starveOnNextMinute(state);
  state = advance(state, 1);
  assert.deepEqual(person(state).action, action);
  assert.equal(person(state, "mio").action, null);
  assert.equal(state.life!.events.filter((entry) => entry.report).length, 0);
  assert.equal(getEventKnowledge(state, "aki", fixture.eventId).status, "unknown");
  state = advance(deserialize(serialize(state)), 1);
  assert.equal(person(state).action, null);
  assert.equal(state.life!.events.filter((entry) => entry.report).length, 1);
  assert.equal(getEventKnowledge(state, "aki", fixture.eventId).status, "reported");
});

test("A recent diner who revives now is not added to another person's new meal, while their earlier meal stays recorded", () => {
  let state = advance(assign(still(87), "eat"), 4);
  state = assign(state, "eat", "mio");
  state = advance(state, 14);
  const earlier = structuredClone(state.life!.events.find((entry) => entry.kind === "meal")!);
  assert.deepEqual(earlier.actors, ["aki"]);
  starveOnNextMinute(state);
  state = advance(state, 1);
  assert.deepEqual(state.life!.events.find((entry) => entry.id === earlier.id), earlier);
  const meal = state.life!.events.findLast((entry) => entry.kind === "meal")!;
  assert.deepEqual(meal.actors, ["mio"]);
  assert.equal(state.resources.food, 4);
  assert.equal(person(state).hp, 0.5);
});

test("A helper due during the worker's revival waits with the same job and finishes only on a later minute", () => {
  let state = advance(assign(still(88), "hobby"), 5);
  state = advance(assign(state, "help", "mio", "aki"), 9);
  const action = structuredClone(person(state).action);
  const help = structuredClone(person(state, "mio").action);
  const relations = structuredClone(state.residents.map((resident) => resident.relations));
  starveOnNextMinute(state);
  state = advance(state, 1);
  assert.deepEqual(person(state).action, action);
  assert.deepEqual(person(state, "mio").action, help);
  assert.equal(state.life?.events.filter((entry) => entry.kind === "help").length ?? 0, 0);
  assert.deepEqual(state.residents.map((resident) => resident.relations), relations);
  state = advance(deserialize(serialize(state)), 1);
  assert.equal(person(state, "mio").action, null);
  assert.equal(person(state).action?.id, action!.id);
  assert.equal(person(state).action?.progress, action!.progress + 13);
  assert.equal(state.life!.events.filter((entry) => entry.kind === "help").length, 1);
});

test("Reserved eating still protects a conscious weak person, and a rescued person's later revival preserves their interrupted work", () => {
  let state = still(89);
  person(state).hp = 0.05;
  person(state).hunger = 0;
  state = advance(assign(state, "eat"), 15);
  assert.equal(person(state).hp, 0.05);
  assert.equal(person(state).hunger, 55);
  assert.equal(state.resources.food, 5);
  assert.equal(state.logs.filter((entry) => entry.title === "意識が戻った").length, 0);

  let rescue = advance(assign(still(90), "cook"), 5);
  rescue = act(rescue, { type: "pause", residentId: "aki" });
  person(rescue).location = "road";
  person(rescue).hp = 0;
  person(rescue, "mio").location = "road";
  const work = structuredClone(person(rescue).suspended);
  rescue = finish(assign(rescue, "rescue", "mio", "aki"), "mio");
  const event = rescue.life!.events.find((entry) => entry.kind === "rescue")!;
  assert.equal(person(rescue).hp, 0);
  assert.equal(person(rescue).location, "home");
  rescue = advance(deserialize(serialize(rescue)), 1);
  assert.equal(person(rescue).hp, 0.5);
  assert.deepEqual(person(rescue).suspended, work);
  assert.equal(person(rescue).action, null);
  assert.equal(getEventKnowledge(rescue, "aki", event.id).status, "unknown");
  assert.equal(availableResources(rescue).ingredients, rescue.resources.ingredients - 2);
});

test("Preserved jobs replay identically through saving, repeated revival stops, and split advances", () => {
  let state = advance(assign(still(91), "cook"), 5);
  starveOnNextMinute(state);
  const snapshot = serialize(state);
  const whole = advance(deserialize(snapshot), 120);
  const split = advance(deserialize(snapshot), 1);
  assert.deepEqual(whole, split);
  const done = finish(whole);
  const doneAfterLoading = finish(deserialize(serialize(split)));
  assert.deepEqual(doneAfterLoading, done);
  assert.deepEqual(deserialize(serialize(done)), done);
});

test("Another person's completed treatment still has physical effects and the existing awake-at-completion knowledge rule", () => {
  let state = advance(assign(still(92), "cook"), 5);
  person(state).hp = 50;
  state = advance(assign(state, "heal", "mio", "aki"), 19);
  const work = structuredClone(person(state).action);
  const medicine = state.resources.medicine;
  starveOnNextMinute(state);
  state = advance(state, 1);
  assert.deepEqual(person(state).action, work);
  close(person(state).hp, 45.5);
  assert.equal(person(state, "mio").action, null);
  assert.equal(state.resources.medicine, medicine - 1);
  const treatment = state.life!.events.find((entry) => entry.kind === "heal")!;
  assert.ok(treatment.witnesses.includes("aki"));
  assert.equal(getEventKnowledge(state, "aki", treatment.id).status, "direct");
  assert.deepEqual(deserialize(serialize(state)), state);
});

test("A revived body remains exposed but cannot attack, provide defence, or receive a new automatic battle order that minute", () => {
  for (const order of ["attack", "defend", "automatic"] as const) {
    let state = still(93);
    state.enemy.location = "home";
    person(state, "mio").location = "road";
    if (order === "defend") person(state, "ren").location = "road";
    else state = assign(state, "defend", "ren");
    if (order === "automatic") state = act(state, { type: "auto-combat", enabled: true });
    else state = assign(state, order);
    person(state).hp = 0;
    const action = structuredClone(person(state).action);
    state = advance(deserialize(serialize(state)), 1);
    assert.equal(state.enemy.hp, 80, order);
    const hit = state.logs.findLast((entry) => entry.type === "combat" && /ダメージ/.test(entry.text))!;
    assert.ok(hit);
    if (order === "defend") {
      assert.deepEqual(hit.actors, ["aki"]);
      assert.doesNotMatch(hit.text, /援護/);
      const damage = Number(hit.text.match(/(\d+)のダメージ/)?.[1]);
      assert.ok(damage >= 13, "A revived defence order must not reduce incoming damage");
      assert.equal(person(state).hp, 0, "Revival does not make the body immune to the real enemy");
    } else {
      assert.deepEqual(hit.actors, ["ren"]);
      if (order === "attack") assert.deepEqual(person(state).action, action);
      else assert.equal(person(state).action, null);
      state = advance(state, 1);
      assert.ok(state.enemy.hp < 80, "The next explicitly advanced minute can attack normally");
      assert.equal(person(state).action?.kind, "attack");
    }
    assert.deepEqual(deserialize(serialize(state)), state);
  }
});

test("A second knockout at the base preserves both reserved jobs through saving and subsequent revival", () => {
  let state = still(94);
  person(state, "mio").location = "road";
  person(state, "ren").location = "road";
  state = advance(assign(state, "decorate"), 5);
  state = advance(assign(state, "cook"), 3);
  const current = structuredClone(person(state).action);
  const suspended = structuredClone(person(state).suspended);
  const resources = { ...state.resources };
  starveOnNextMinute(state);
  state.enemy.location = "home";
  for (let knockouts = 0; knockouts < 2; knockouts++) {
    state = advance(deserialize(serialize(state)), 10);
    assert.equal(person(state).hp, 0);
    assert.deepEqual(person(state).action, current);
    assert.deepEqual(person(state).suspended, suspended);
    assert.deepEqual(state.resources, resources);
    assert.equal(availableResources(state).ingredients, resources.ingredients - 2);
    assert.equal(availableResources(state).scrap, resources.scrap - 2);
    assert.deepEqual(deserialize(serialize(state)), state);
  }
  state.enemy.location = "ruins";
  state = advance(state, 10);
  assert.equal(person(state).hp, 0.5);
  assert.deepEqual(person(state).action, current);
  assert.deepEqual(person(state).suspended, suspended);
  state = advance(state, 1);
  assert.equal(person(state).action?.progress, current!.progress + 1);
  state = finish(state);
  assert.equal(state.resources.ingredients, resources.ingredients - 2);
  assert.equal(state.resources.food, resources.food + 3);
  assert.deepEqual(person(state).suspended, suspended);
  assert.equal(state.logs.filter((entry) => entry.title === "温かい食事ができた").length, 1);
});

test("Real combat logs retain the victim first, include only snapshot attackers, and preserve the established seed and damage", () => {
  let state = createGame(20261120);
  state = act(state, { type: "assign", residentIds: ["aki", "mio", "ren"], kind: "move", target: "ruins" });
  state = advance(state, 60);
  assert.equal(state.minutes, 503);
  state = assign(state, "defend");
  state = assign(state, "attack", "ren");
  const original = serialize(state);
  state = advance(state, 1);
  const hit = state.logs.findLast((entry) => entry.title === "援護が仲間を守った")!;
  assert.deepEqual(hit.actors, ["aki", "ren"]);
  assert.deepEqual(hit.witnesses, ["aki", "mio", "ren"]);
  assert.match(hit.text, /レンが相手に19の打撃。アキは6のダメージ/);
  assert.doesNotMatch(hit.text, /6の傷/);
  assert.equal(state.seed, 639908402);
  close(state.enemy.hp, 60.6); // The log rounds the real 19.4 damage to 19.
  assert.equal(person(state).hp, 94);
  assert.equal(person(state, "mio").hp, 100);
  assert.equal(person(state, "ren").hp, 100);
  assert.deepEqual(person(state).wounds, { arm: 0, leg: 0, body: 0 });
  assert.deepEqual(advance(deserialize(original), 1), state);
  assert.deepEqual(deserialize(serialize(state)), state);
});
