import test from "node:test";
import assert from "node:assert/strict";
import { advance, command, createGame, deserialize, serialize } from "../src/game/engine";
import { ensureInventory } from "../src/game/inventory";
import { getEventKnowledge, getWishProgress } from "../src/game/life";
import { getRecruitmentStatus } from "../src/game/recruitment";
import { LODGE_KEEPER, regionNPCsAt } from "../src/game/region";
import type { GameState } from "../src/game/types";

const keeper = LODGE_KEEPER.id;
const person = (s: GameState, id: string) => s.residents.find(resident => resident.id === id)!;
const invite = (s: GameState, id = "aki") => command(s, { type: "recruit", residentId: id, npcId: keeper });
function beginMeal(s: GameState, id: string) {
  const result = command(s, { type: "assign", kind: "eat", residentIds: [id] });
  assert.equal(result.error, undefined);
  return result.state;
}
function endMeal(s: GameState, id: string) {
  for (let i = 0; i < 30 && person(s, id).action?.kind === "eat"; i++) s = advance(s, 1);
  assert.notEqual(person(s, id).action?.kind, "eat");
  return s;
}

test("Only the actual lodge diner earns dates, including a shared table at the opening boundary", () => {
  let s = createGame();
  s.minutes = 1440 + 450;
  for (const id of ["aki", "mio"]) {
    person(s, id).location = "lodge";
    ensureInventory(s).packs[id].food = 4;
  }
  s = beginMeal(s, "aki");
  s.minutes = 1440 + 479 - person(s, "aki").action!.duration;
  s = advance(s, 2);
  s = beginMeal(s, "mio");
  s = endMeal(s, "aki");
  assert.equal(s.minutes % 1440, 479);
  s = endMeal(s, "mio");
  assert.equal(s.minutes % 1440, 481);
  const latest = s.life!.events.filter(event => event.kind === "meal").at(-1)!;
  assert.deepEqual(latest.actors, ["aki", "mio"]);
  assert.deepEqual(latest.lodgeMealFinishers, ["mio"]);
  assert.equal(getRecruitmentStatus(s, "aki", keeper).mealProgress?.days, 0);
  assert.equal(getRecruitmentStatus(s, "mio", keeper).mealProgress?.days, 1);
  s = endMeal(beginMeal(s, "mio"), "mio");
  assert.equal(getRecruitmentStatus(s, "mio", keeper).mealProgress?.days, 1);
  assert.deepEqual(deserialize(serialize(s)), s);
});

test("A solo traveller can invite Nagi after two different daytime meals, keeping the past private", () => {
  let s = createGame(49, "solo");
  person(s, "aki").location = "lodge";
  ensureInventory(s).packs.aki.food = 3;
  s = endMeal(beginMeal(s, "aki"), "aki");
  assert.ok(invite(s).error);
  s.minutes = 1440 + 630;
  s = endMeal(beginMeal(s, "aki"), "aki");
  const previous = s.life!.events.filter(event => event.kind === "meal");
  assert.equal(getRecruitmentStatus(s, "aki", keeper).available, true);
  const before = structuredClone(s);
  s.minutes = 1440 + 1080;
  assert.ok(invite(s).error);
  assert.deepEqual(regionNPCsAt(s, "lodge"), []);
  s = before;
  const joined = invite(s);
  assert.equal(joined.error, undefined);
  const after = deserialize(serialize(joined.state));
  assert.equal(after.minutes, s.minutes);
  assert.deepEqual(after.residents.map(resident => resident.id), ["aki", keeper]);
  assert.equal(person(after, keeper).location, "lodge");
  assert.deepEqual(after.inventory!.packs[keeper], { food: 0, ingredients: 0, medicine: 0, scrap: 0 });
  assert.ok(invite(after).error);
  assert.deepEqual(regionNPCsAt(after, "lodge"), []);
  ensureInventory(after).packs.aki.food = 2;
  const meal = command(after, { type: "assign", residentIds: ["aki", keeper], kind: "eat" });
  assert.equal(meal.error, undefined);
  const settled = endMeal(meal.state, keeper);
  assert.ok(getWishProgress(deserialize(serialize(settled)), keeper).completed);
  for (const event of previous) assert.equal(getEventKnowledge(after, keeper, event.id).status, "unknown");
  for (const mutate of [
    (draft: GameState) => { draft.life!.events.find(event => event.id === previous[1].id)!.time = previous[0].time + 1; },
    (draft: GameState) => { draft.life!.events.find(event => event.id === previous[0].id)!.lodgeMealFinishers = [keeper]; },
    (draft: GameState) => { draft.life!.events.find(event => event.id === previous[0].id)!.lodgeMealFinishers = []; },
  ]) {
    const draft = structuredClone(after);
    mutate(draft);
    assert.throws(() => deserialize(serialize(draft)));
  }
});

test("Five-person household preserves earlier witnesses when its second recruit joins", () => {
  let s = createGame();
  person(s, "aki").location = "village";
  ensureInventory(s).packs.aki.food = 5;
  for (const choice of ["talk", "deliver"] as const) {
    const result = command(s, { type: "region", residentId: "aki", npcId: "village-guide", choice });
    assert.equal(result.error, undefined);
    s = result.state;
  }
  const first = command(s, { type: "recruit", residentId: "aki", npcId: "village-guide" });
  assert.equal(first.error, undefined);
  s = first.state;
  person(s, "aki").location = "lodge";
  s = endMeal(beginMeal(s, "aki"), "aki");
  s.minutes = 1440 + 500;
  s = endMeal(beginMeal(s, "aki"), "aki");
  const second = invite(s);
  assert.equal(second.error, undefined);
  const after = deserialize(serialize(second.state));
  assert.equal(after.residents.length, 5);
  const earlier = after.logs.find(log => log.id === person(after, "village-guide").joinedLogId)!;
  assert.ok(!earlier.witnesses.includes(keeper));
  earlier.witnesses.push(keeper);
  assert.throws(() => deserialize(serialize(after)));
});
