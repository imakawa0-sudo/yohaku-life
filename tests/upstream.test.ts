import test from "node:test";
import assert from "node:assert/strict";
import { advance, command, createGame, deserialize, estimateTravelMinutes, getProjectSummary, serialize } from "../src/game/engine.ts";
import { accessibleResources, ensureInventory, ownFreeResources, totalResources } from "../src/game/inventory.ts";
import { inspectSleep } from "../src/game/overnight.ts";
import { regionHarvestAvailable } from "../src/game/region.ts";
import type { ActionKind, Command, GameState, LocationId } from "../src/game/types.ts";

function act(s: GameState, input: Command): GameState {
  const result = command(s, input);
  assert.equal(result.error, undefined, result.error);
  return result.state;
}
const assign = (s: GameState, id: string, kind: ActionKind, target?: string) =>
  act(s, { type: "assign", residentIds: [id], kind, target });
const person = (s: GameState, id: string) => s.residents.find(r => r.id === id)!;
const pack = (s: GameState, id: string) => ensureInventory(s).packs[id];
const roundTrip = (s: GameState) => deserialize(serialize(s));

function start(): GameState {
  const s = createGame(678);
  s.resources.food = 35;
  for (const r of s.residents) {
    r.energy = r.hunger = 100;
    r.policy = "rest";
  }
  return s;
}
function finish(s: GameState, id: string): GameState {
  const current = person(s, id).action?.id;
  assert.ok(current);
  for (let minute = 0; minute <= 1440; minute++) {
    if (person(s, id).action?.id !== current) return s;
    s = advance(s, 1);
  }
  assert.fail("Action did not complete in one day");
}

test("The upstream branch can be reached safely from the old map, and its warehouse has no remote access", () => {
  let s = start();
  person(s, "aki").location = "village";
  assert.equal(estimateTravelMinutes(s, "aki", "lodge"), 44);
  s = assign(s, "aki", "move", "lodge");
  assert.deepEqual(person(s, "aki").action!.path, ["reedbank", "lodge"]);
  s = finish(roundTrip(advance(s, 5)), "aki");
  assert.equal(person(s, "aki").location, "lodge");
  const group = roundTrip(s);
  person(group, "mio").location = "village";
  const blocked = command(group, { type: "assign", residentIds: ["aki", "mio"], kind: "hobby" });
  assert.match(blocked.error ?? "", /ミオ.*近隣の集落.*丘のふもとの拠点か舟宿の工房/);
  assert.equal(blocked.state, group);
  const baseline = { ...s.resources };
  assert.equal(accessibleResources(s, "aki").ingredients, 0);
  assert.ok(command(s, { type: "assign", residentIds: ["aki"], kind: "cook" }).error);
  pack(s, "aki").ingredients = 3;
  const give = (from: string, to: string): Command => ({ type: "transfer", residentId: "aki", from, to, resource: "ingredients", amount: 3 });
  s = act(s, give("aki", "ground"));
  assert.equal(accessibleResources(s, "aki").ingredients, 0, "Stored stock is withdrawn at the lodge");
  assert.ok(command(s, give("base", "aki")).error);
  s = finish(assign(s, "aki", "move", "reedbank"), "aki");
  assert.ok(command(s, give("ground", "aki")).error);
  assert.match(inspectSleep(s, "aki").error ?? "", /舟宿の工房の寝床/);
  s = finish(assign(roundTrip(s), "aki", "move", "lodge"), "aki");
  s = act(s, give("ground", "aki"));
  assert.equal(pack(s, "aki").ingredients, 3);
  assert.deepEqual(s.resources, baseline);
});

test("One harvest per site and day, including paired harvesters and legacy history with no location", () => {
  let s = start();
  person(s, "aki").location = "meadow";
  person(s, "ren").location = person(s, "mio").location = "reedbank";
  for (const id of ["aki", "mio", "ren"]) s = assign(s, id, "gather");
  s = finish(s, "mio");
  assert.equal(s.region!.harvests.length, 2);
  assert.equal(regionHarvestAvailable(s), false);
  assert.equal(regionHarvestAvailable(s, "reedbank"), false);
  assert.deepEqual(s.region!.harvests.map(entry => entry.location), [undefined, "reedbank"]);
  assert.equal(pack(s, "aki").scrap, 1);
  assert.equal(pack(s, "ren").scrap + pack(s, "mio").scrap, 2);
  const copies = roundTrip(s);
  assert.equal(serialize(copies), serialize(s));
  copies.region!.harvests[1].location = "meadow";
  assert.throws(() => roundTrip(copies));
  s.minutes += 1440;
  assert.equal(regionHarvestAvailable(s), true);
  assert.equal(regionHarvestAvailable(s, "reedbank"), true);
});

test("The two pots are independent, including suspended reservations, reloading and completed food", () => {
  let s = start();
  person(s, "aki").location = person(s, "ren").location = "lodge";
  pack(s, "aki").ingredients = pack(s, "ren").ingredients = 2;
  const total = totalResources(s);
  s = assign(assign(s, "aki", "cook"), "mio", "cook");
  s = act(advance(s, 5), { type: "pause", residentId: "aki" });
  assert.ok(command(s, { type: "assign", residentIds: ["ren"], kind: "cook" }).error);
  assert.equal(ownFreeResources(s, "aki").ingredients, 0);
  s = act(roundTrip(s), { type: "resume", residentId: "aki" });
  const bad = structuredClone(s);
  person(bad, "aki").action!.reservationSource = "base";
  assert.throws(() => roundTrip(bad));
  s = finish(s, "aki");
  if (person(s, "mio").action?.kind === "cook") s = finish(s, "mio");
  assert.equal(totalResources(s).food, total.food + 6);
  assert.equal(totalResources(s).ingredients, total.ingredients - 4);
  assert.equal(pack(s, "aki").food, 3);
  assert.equal(s.resources.food, 38);
  assert.deepEqual(roundTrip(s), s);
});

test("Each household builds one workbench from its own stock and only uses its own finished equipment", () => {
  let s = start();
  person(s, "aki").location = person(s, "ren").location = "lodge";
  pack(s, "aki").scrap = 4;
  const build: Command = { type: "assign", residentIds: ["aki"], kind: "project", target: "crafting-tools" };
  s = act(assign(s, "mio", "project", "crafting-tools"), build);
  assert.ok(command(s, { ...build, residentIds: ["ren"] }).error);
  s = act(advance(s, 4), { type: "pause", residentId: "aki" });
  s = act(roundTrip(s), { type: "resume", residentId: "aki" });
  s = finish(s, "aki");
  if (person(s, "mio").action?.kind === "project") s = finish(s, "mio");
  assert.equal(s.life!.upgrades!.length, 2);
  assert.equal(pack(s, "aki").scrap, 1);
  assert.equal(s.resources.scrap, 1);
  const bench = (site: LocationId) => getProjectSummary(s, site).find(p => p.recipe.id === "crafting-tools")!.completed!;
  assert.equal(bench("lodge").location, "lodge");
  assert.equal(bench("home").location, "home");
  assert.ok(command(s, build).error);
  s = assign(s, "aki", "project", "wood-flower");
  assert.equal(person(s, "aki").action!.craftingToolsId, bench("lodge").id);
  const bad = structuredClone(s);
  person(bad, "aki").action!.craftingToolsId = bench("home").id;
  assert.throws(() => roundTrip(bad));
  s = finish(roundTrip(s), "aki");
  assert.equal(s.life!.crafts.at(-1)!.createdLocation, "lodge");
  assert.equal(pack(s, "aki").scrap, 0);
  assert.deepEqual(roundTrip(s), s);
});

test("A lodge cook uses her own ingredients and the local pot, eats, and rests without abandoning an interrupted order", () => {
  let s = start();
  const cook = person(s, "mio");
  cook.location = "lodge";
  cook.policy = "cook";
  pack(s, "mio").ingredients = 2;
  s = assign(s, "aki", "cook");
  s = advance(s, 1);
  assert.equal(person(s, "mio").action?.kind, "cook");
  assert.equal(person(s, "mio").action?.reservationSource, "pack");
  const totals = { ...s.resources };
  s = finish(roundTrip(s), "mio");
  assert.equal(pack(s, "mio").food, 3);
  assert.equal(pack(s, "mio").ingredients, 0);
  assert.deepEqual(s.resources, totals, "home's own cooking action has not completed yet");
  person(s, "mio").hunger = 35;
  s = advance(s, 1);
  assert.equal(person(s, "mio").action?.kind, "eat");
  s = finish(s, "mio");
  assert.equal(pack(s, "mio").food, 2);
  s = act(assign(s, "mio", "hobby"), { type: "pause", residentId: "mio" });
  person(s, "mio").energy = 15;
  s = advance(roundTrip(s), 1);
  assert.equal(person(s, "mio").suspended?.kind, "hobby");
  assert.equal(person(s, "mio").action, null);
  s = act(s, { type: "cancel", residentId: "mio", actionId: person(s, "mio").suspended!.id });
  s = advance(s, 1);
  assert.equal(person(s, "mio").action?.kind, "rest");
  assert.equal(person(s, "mio").action?.origin, "lodge");
  assert.deepEqual(roundTrip(s), s);
});
