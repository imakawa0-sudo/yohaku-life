import test from "node:test";
import assert from "node:assert/strict";
import {
  advance, command, createGame, deserialize, getCraftDisplayTitle,
  getCraftSubjectChoices, getEventKnowledge, getResidentLife, getWishProgress, serialize,
} from "../src/game/engine.ts";
import { ensureInventory } from "../src/game/inventory.ts";
import { makeMorningReflections, validLifeState } from "../src/game/life.ts";
import { applyRegionInteraction } from "../src/game/region.ts";
import { recruitCompanion } from "../src/game/recruitment.ts";
import { assignSelection, assignSubjectCraftSelection } from "../src/game/selection.ts";
import type { ActionKind, Command, GameState, LocationId } from "../src/game/types.ts";

// Controlled core-API fixtures isolate household history and author identity.
// Invitation uses the real helper with real talk/delivery receipts; later work
// uses public timed commands. Relocation, abundant stock and morning callbacks
// below are boundary setups, not a claim of normal browser play.
const GUIDE = "village-guide";
const FOUNDERS = ["aki", "mio", "ren"];
const ALL = [...FOUNDERS, GUIDE];
const person = (s: GameState, id = "aki") => s.residents.find((r) => r.id === id)!;

function act(s: GameState, instruction: Command): GameState {
  const result = command(s, instruction);
  assert.equal(result.error, undefined, result.error);
  return result.state;
}
function group(s: GameState, ids: string[], kind: ActionKind, target?: string): GameState {
  const result = assignSelection(s, ids, kind, target);
  assert.equal(result.error, undefined, result.error);
  return result.state;
}
function assign(s: GameState, id: string, kind: ActionKind, target?: string): GameState {
  return act(s, { type: "assign", residentIds: [id], kind, target });
}
function finish(s: GameState, ids: string[]): GameState {
  const jobs = ids.map((id) => ({ id, action: person(s, id).action?.id }));
  assert.ok(jobs.every((job) => job.action !== undefined));
  for (let step = 0; step < 1500; step++) {
    if (jobs.every(({ id, action }) => person(s, id).action?.id !== action)) return s;
    s = advance(s, 1);
  }
  assert.fail("The reserved action did not complete");
}
function quiet(seed = 7100): GameState {
  let s = createGame(seed);
  s.resources = { food: 30, ingredients: 30, medicine: 5, scrap: 30 };
  for (const r of s.residents) r.hp = r.hunger = r.energy = 100;
  for (const id of FOUNDERS) s = act(s, { type: "policy", residentId: id, policy: "rest" });
  return s;
}
function join(s = quiet()): GameState {
  s.version = 3;
  person(s).location = "village";
  ensureInventory(s).packs.aki.food = 3;
  for (const choice of ["talk", "deliver"] as const)
    assert.equal(applyRegionInteraction(s, "aki", GUIDE, choice).error, undefined);
  const result = recruitCompanion(s, "aki", GUIDE);
  assert.equal(result.error, undefined, result.error);
  assert.ok(result.resident);
  // Controlled shared-room setup after joining. It changes no history or clock.
  person(s).location = person(s, GUIDE).location = "home";
  return act(s, { type: "policy", residentId: GUIDE, policy: "rest" });
}
function move(s: GameState, ids: string[], destination: LocationId): GameState {
  return finish(group(s, ids, "move", destination), ids);
}

test("Controlled fourth housemate completes the household meal and settling wishes only after a real four-person meal", () => {
  let s = join();
  const before = serialize(s);
  assert.match(getWishProgress(s, GUIDE).progress, /仲間.*食事/);
  assert.deepEqual(getWishProgress(s, GUIDE).nextAction?.residentIds, [GUIDE, "aki"]);
  assert.equal(getWishProgress(s, "mio").nextAction?.residentIds.length, 4);
  assert.equal(serialize(s), before, "Reading four-person wishes remains pure");
  s = group(s, ALL, "eat");
  assert.equal(getWishProgress(s, "mio").completed, false);
  assert.equal(getWishProgress(s, GUIDE).completed, false);
  s = advance(s, 4);
  assert.equal(getWishProgress(s, GUIDE).completed, false);
  s = finish(s, ALL);
  const event = s.life!.events.find((e) => e.kind === "meal")!;
  assert.deepEqual(new Set(event.actors), new Set(ALL));
  assert.equal(getWishProgress(s, "mio").completed, true);
  assert.equal(getWishProgress(s, GUIDE).completed, true);
  assert.equal(getWishProgress(s, "aki").completed, false);
  assert.equal(getWishProgress(s, "ren").completed, false);
  assert.deepEqual(deserialize(serialize(s)), s);
});

test("Controlled meal by three of four does not include the fourth witness or complete either unearned wish", () => {
  let s = join();
  s = finish(group(s, FOUNDERS, "eat"), FOUNDERS);
  const event = s.life!.events.find((e) => e.kind === "meal")!;
  assert.deepEqual(new Set(event.actors), new Set(FOUNDERS));
  assert.ok(event.witnesses.includes(GUIDE));
  assert.equal(getEventKnowledge(s, GUIDE, event.id).status, "direct");
  assert.equal(getWishProgress(s, "mio").completed, false);
  assert.equal(getWishProgress(s, GUIDE).completed, false);
  assert.deepEqual(deserialize(serialize(s)), s);
  for (const id of ["mio", GUIDE]) {
    const forged = structuredClone(s);
    forged.life!.wishes[id] = { eventId: event.id, completedAt: event.time };
    assert.equal(validLifeState(forged), false, `${id}'s wish needs actual qualifying diners`);
    assert.throws(() => deserialize(serialize(forged)));
  }
});

test("Controlled settling wish accepts a real pair at home without requiring a full household dinner", () => {
  let s = join();
  s = finish(group(s, [GUIDE, "ren"], "eat"), [GUIDE, "ren"]);
  assert.equal(getWishProgress(s, GUIDE).completed, true);
  assert.equal(getWishProgress(s, "mio").completed, false);
  const completed = s.life!.wishes[GUIDE];
  assert.deepEqual(new Set(s.life!.events.find((e) => e.id === completed.eventId)!.actors), new Set([GUIDE, "ren"]));
  assert.deepEqual(deserialize(serialize(s)), s);
});

test("Controlled settling wish is not completed by a travelling meal or a sleeping bystander", () => {
  let outside = join();
  for (const id of [GUIDE, "ren"]) {
    person(outside, id).location = "meadow";
    ensureInventory(outside).packs[id].food = 1;
  }
  outside = finish(group(outside, [GUIDE, "ren"], "eat"), [GUIDE, "ren"]);
  assert.equal(getWishProgress(outside, GUIDE).completed, false);
  const meal = outside.life!.events.find((e) => e.kind === "meal")!;
  outside.life!.wishes[GUIDE] = { eventId: meal.id, completedAt: meal.time };
  assert.equal(validLifeState(outside), false);

  let sleeping = join();
  sleeping = assign(sleeping, GUIDE, "sleep");
  sleeping = finish(group(sleeping, FOUNDERS, "eat"), FOUNDERS);
  assert.equal(getWishProgress(sleeping, GUIDE).completed, false);
  assert.ok(sleeping.life!.events.every((e) => !e.actors.includes(GUIDE) && !e.witnesses.includes(GUIDE)));
});

test("Controlled same-minute invitation preserves the earlier three-person wish without inventing the recruit's past", () => {
  let s = quiet();
  s = finish(group(s, FOUNDERS, "eat"), FOUNDERS);
  const completed = structuredClone(s.life!.wishes.mio);
  const meal = s.life!.events.find((e) => e.id === completed.eventId)!;
  const witnesses = [...meal.witnesses];
  s = join(s);
  assert.equal(person(s, GUIDE).joinedAt, meal.time);
  assert.ok(meal.id < person(s, GUIDE).joinedLogId!);
  assert.deepEqual(s.life!.wishes.mio, completed);
  assert.deepEqual(meal.witnesses, witnesses);
  assert.equal(getEventKnowledge(s, GUIDE, meal.id).status, "unknown");
  assert.deepEqual(getResidentLife(s, GUIDE).recentExperiences, []);
  assert.deepEqual(person(s, GUIDE).memories, []);
  assert.equal(getWishProgress(s, GUIDE).completed, false);
  s = deserialize(serialize(s));
  assert.deepEqual(s.life!.wishes.mio, completed);
  s.minutes = 1440 + 480;
  makeMorningReflections(s);
  assert.equal(getResidentLife(s, GUIDE).reflection, undefined);
  assert.equal(getResidentLife(s, "mio").reflection?.eventId, meal.id);
  assert.deepEqual(deserialize(serialize(s)), s);

  const invented = structuredClone(s);
  invented.life!.events.find((e) => e.id === meal.id)!.witnesses.push(GUIDE);
  assert.equal(validLifeState(invented), false, "A joining minute is ordered by actual event IDs");
});

test("Controlled four-person morning treats all current diners as the household without describing three people", () => {
  let s = join();
  s.minutes = 1300;
  for (const r of s.residents) r.hunger = r.energy = 100;
  s = finish(group(s, ALL, "eat"), ALL);
  const meal = s.life!.events.find((e) => e.kind === "meal")!;
  s = finish(assign(s, "ren", "hobby"), ["ren"]);
  s.minutes = 1440 + 480;
  makeMorningReflections(s);
  const reflection = getResidentLife(s, "ren").reflection!;
  assert.equal(reflection.eventId, meal.id, "The full household meal retains its group weight with four diners");
  assert.match(reflection.text, /皆で/);
  assert.doesNotMatch(reflection.text, /三人/);
  assert.deepEqual(deserialize(serialize(s)), s);
});

test("Controlled recruit cannot inherit an old scenery subject but can author, save and display a newly experienced scene", () => {
  let s = quiet();
  s = move(s, ["aki"], "shelter");
  s = finish(assign(s, "aki", "observe"), ["aki"]);
  const oldScene = s.life!.events.find((e) => e.kind === "quiet")!;
  s = move(s, ["aki"], "home");
  s = join(s);
  assert.equal(getEventKnowledge(s, GUIDE, oldScene.id).status, "unknown");
  assert.deepEqual(getCraftSubjectChoices(s, GUIDE), []);
  const beforeRejected = serialize(s);
  const inherited = assignSubjectCraftSelection(s, [GUIDE], "bird", oldScene.id);
  assert.ok(inherited.error);
  assert.equal(serialize(s), beforeRejected);

  s = move(s, [GUIDE], "shelter");
  s = finish(assign(s, GUIDE, "observe"), [GUIDE]);
  const ownScene = s.life!.events.findLast((e) => e.kind === "quiet")!;
  s = move(s, [GUIDE], "home");
  const craft = assignSubjectCraftSelection(s, [GUIDE], "bird", ownScene.id);
  assert.equal(craft.error, undefined, craft.error);
  s = advance(craft.state, 3);
  s = deserialize(serialize(s));
  s = finish(s, [GUIDE]);
  const made = getResidentLife(s, GUIDE).crafts[0];
  assert.equal(made.authorId, GUIDE);
  assert.equal(made.subjectEventId, ownScene.id);
  assert.match(getCraftDisplayTitle(s, made), /木陰の迂回路/);
  assert.equal(getResidentLife(s, "aki").crafts.length, 0);
  s = finish(assign(s, GUIDE, "decorate"), [GUIDE]);
  s = finish(assign(s, GUIDE, "place-craft", String(made.id)), [GUIDE]);
  assert.equal(getWishProgress(s, GUIDE).completed, false, "Displaying is not the recruit's settling wish");
  assert.equal(getWishProgress(s, "aki").completed, false, "The original maker does not own someone else's work");
  assert.ok(getResidentLife(s, GUIDE).crafts[0].displayedAt);
  assert.deepEqual(deserialize(serialize(s)), s);
});

test("Controlled recruit can help another person's exact job across a save without taking authorship", () => {
  let s = join();
  s = assign(s, "mio", "project", "kitchen-tools");
  const workerAction = person(s, "mio").action!.id;
  s = assign(s, GUIDE, "help", "mio");
  const helperAction = person(s, GUIDE).action!.id;
  s = advance(s, 3);
  s = act(s, { type: "pause", residentId: GUIDE });
  s = act(s, { type: "pause", residentId: "mio" });
  s = deserialize(serialize(s));
  assert.equal(person(s, GUIDE).suspended?.targetActionId, workerAction);
  s = act(s, { type: "resume", residentId: "mio" });
  s = act(s, { type: "resume", residentId: GUIDE });
  assert.equal(person(s, GUIDE).action!.id, helperAction);
  s = finish(s, [GUIDE]);
  const help = s.life!.events.find((e) => e.kind === "help")!;
  assert.deepEqual(help.actors, [GUIDE]);
  assert.equal(help.subjectId, "mio");
  s = finish(s, ["mio"]);
  assert.equal(s.life!.upgrades?.find((upgrade) => upgrade.recipeId === "kitchen-tools")?.creatorId, "mio");
  assert.equal(getWishProgress(s, GUIDE).completed, false);
  assert.deepEqual(deserialize(serialize(s)), s);
});
