import test from "node:test";
import assert from "node:assert/strict";
import { createGame } from "../src/game/engine.ts";
import type { GameState } from "../src/game/types.ts";
import { ensureInventory } from "../src/game/inventory.ts";
import {
  REGION_LOCATIONS,
  REGION_NPCS,
  applyRegionInteraction,
  createRegionState,
  inspectRegionInteraction,
  regionEdgeMinutes,
  regionHarvest,
  regionHarvestAvailable,
  regionNPCsAt,
  validRegion,
} from "../src/game/region.ts";

const person = (s: GameState, id = "aki") => s.residents.find((r) => r.id === id)!;
function village(): GameState {
  const s = createGame(421);
  s.minutes = 600;
  for (const r of s.residents) { r.action = null; r.suspended = null; }
  person(s).location = "village";
  ensureInventory(s);
  return s;
}
const snapshot = (s: GameState) => JSON.stringify(s);
const stock = (s: GameState, id = "aki") => ensureInventory(s).packs[id];

test("The small region has symmetric explicit journey costs and separate safe/short connections", () => {
  assert.deepEqual(REGION_LOCATIONS.village.connections, ["meadow", "ridge", "reedbank"]);
  assert.deepEqual(REGION_LOCATIONS.meadow.connections, ["road", "village"]);
  assert.deepEqual(REGION_LOCATIONS.ridge.connections, ["ruins", "village"]);
  assert.equal(regionEdgeMinutes("road", "meadow"), 18);
  assert.equal(regionEdgeMinutes("meadow", "road"), 18);
  assert.equal(regionEdgeMinutes("meadow", "village"), 18);
  assert.equal(regionEdgeMinutes("ruins", "ridge"), 8);
  assert.equal(regionEdgeMinutes("ridge", "village"), 10);
  assert.equal(regionEdgeMinutes("home", "road"), undefined);
});

test("NPC hours, previews and harvest availability are pure even on a legacy save", () => {
  const s = village();
  delete s.region;
  delete s.inventory;
  const before = snapshot(s);
  assert.equal(regionNPCsAt(s, "village").length, 2);
  assert.equal(regionNPCsAt(s, "meadow").length, 0);
  assert.equal(regionHarvestAvailable(s), true);
  assert.equal(inspectRegionInteraction(s, "aki", "village-guide", "talk").error, undefined);
  assert.ok(inspectRegionInteraction(s, "aki", "village-trader", "trade-food").error);
  assert.equal(snapshot(s), before);
  assert.equal(s.inventory, undefined);
  assert.equal(s.region, undefined);
  s.minutes = 479;
  assert.equal(regionNPCsAt(s, "village").length, 0);
  s.minutes = 480;
  assert.equal(regionNPCsAt(s, "village").length, 2);
  s.minutes = 1080;
  assert.equal(regionNPCsAt(s, "village").length, 0);
});

test("An absent, sleeping, travelling or carried actor cannot interact or initialize the region", () => {
  for (const change of [
    (s: GameState) => { person(s).location = "home"; },
    (s: GameState) => { person(s).hp = 0; },
    (s: GameState) => { person(s).action = { id: s.nextId++, kind: "sleep", label: "眠る", duration: 30, progress: 0 }; },
    (s: GameState) => { person(s).action = { id: s.nextId++, kind: "move", label: "移動", duration: 30, progress: 0 }; },
    (s: GameState) => { person(s).hp = 20; person(s, "mio").location = "village"; person(s, "mio").action = { id: s.nextId++, kind: "rescue", target: "aki", label: "救助", duration: 30, progress: 0 }; },
    (s: GameState) => { s.minutes = 1080; },
  ]) {
    const s = village();
    change(s);
    const before = snapshot(s);
    assert.ok(applyRegionInteraction(s, "aki", "village-guide", "talk").error);
    assert.equal(snapshot(s), before);
  }
});

test("A real guide conversation records just its listener and grants trust once without advancing time", () => {
  const s = village();
  const clock = s.minutes, seed = s.seed, nextId = s.nextId, oldLogs = snapshot(s.logs as unknown as GameState);
  assert.equal(applyRegionInteraction(s, "aki", "village-guide", "talk").error, undefined);
  assert.equal(s.region!.knownRoute, true);
  assert.deepEqual(s.region!.routeKnownBy, ["aki"]);
  assert.equal(s.region!.trust["village-guide"].aki, 1);
  assert.equal(s.region!.trust["village-guide"].mio, undefined);
  assert.deepEqual(s.region!.receipts[0].paid, {});
  assert.equal(s.minutes, clock);
  assert.equal(s.seed, seed);
  assert.equal(s.nextId, nextId);
  assert.equal(snapshot(s.logs as unknown as GameState), oldLogs);
  assert.equal(validRegion(s), true);
  const before = snapshot(s);
  assert.ok(applyRegionInteraction(s, "aki", "village-guide", "talk").error);
  assert.equal(snapshot(s), before);
});

test("Village trade spends the actor's actual free pack and never the remote warehouse or another pack", () => {
  const s = village();
  s.resources.scrap = 100;
  person(s, "mio").location = "village";
  stock(s, "mio").scrap = 5;
  let before = snapshot(s);
  assert.ok(applyRegionInteraction(s, "aki", "village-trader", "trade-food").error);
  assert.equal(snapshot(s), before);
  stock(s).scrap = 2;
  before = snapshot(s);
  const preview = inspectRegionInteraction(s, "aki", "village-trader", "trade-food");
  assert.equal(preview.error, undefined);
  assert.equal(snapshot(s), before);
  assert.equal(applyRegionInteraction(s, "aki", "village-trader", "trade-food").error, undefined);
  assert.equal(stock(s).scrap, 0);
  assert.equal(stock(s).food, 3);
  assert.equal(stock(s, "mio").scrap, 5);
  assert.equal(s.resources.scrap, 100);
  assert.deepEqual(s.region!.stock, { food: 3, medicine: 3 });
  assert.equal(validRegion(s), true);
});

test("Reserved carried supplies cannot be sold or delivered", () => {
  const s = village();
  stock(s).food = 4;
  person(s).action = { id: s.nextId++, kind: "eat", label: "食事", duration: 15, progress: 0,
    reserved: { food: 2 }, reservationSource: "pack" };
  const before = snapshot(s);
  assert.ok(applyRegionInteraction(s, "aki", "village-guide", "deliver").error);
  assert.equal(snapshot(s), before);
});

test("Merchant stock is finite per day and a new day's read-only preview does not replenish state", () => {
  const s = village();
  stock(s).scrap = 10;
  for (let n = 0; n < 2; n++) assert.equal(applyRegionInteraction(s, "aki", "village-trader", "trade-food").error, undefined);
  const before = snapshot(s);
  assert.ok(applyRegionInteraction(s, "aki", "village-trader", "trade-food").error);
  assert.equal(snapshot(s), before);
  s.minutes += 1440;
  const oldRegion = JSON.stringify(s.region);
  assert.deepEqual(inspectRegionInteraction(s, "aki", "village-trader", "trade-food").stock, { food: 6, medicine: 3 });
  assert.equal(JSON.stringify(s.region), oldRegion);
  assert.equal(applyRegionInteraction(s, "aki", "village-trader", "trade-food").error, undefined);
  assert.equal(s.region!.stockDay, 2);
  assert.deepEqual(s.region!.stock, { food: 3, medicine: 3 });
  assert.equal(validRegion(s), true);
});

test("Any actual visitor may fulfil the one-off request; the result belongs to that actor", () => {
  const s = village();
  person(s, "ren").location = "village";
  stock(s, "ren").food = 3;
  assert.equal(applyRegionInteraction(s, "ren", "village-guide", "deliver").error, undefined);
  assert.equal(stock(s, "ren").food, 0);
  assert.equal(stock(s, "ren").medicine, 2);
  assert.deepEqual(s.region!.request, { deliveredBy: "ren", time: s.minutes });
  assert.equal(s.region!.trust["village-guide"].ren, 2);
  assert.equal(s.region!.knownRoute, false, "Delivering food does not invent a conversation about the route");
  stock(s).food = 3;
  const before = snapshot(s);
  assert.ok(applyRegionInteraction(s, "aki", "village-guide", "deliver").error);
  assert.equal(snapshot(s), before);
  assert.equal(validRegion(s), true);
});

test("The meadow yields once per day and marks completion without independently adding inventory", () => {
  const s = village();
  let before = snapshot(s);
  assert.ok(regionHarvest(s, "aki").error);
  assert.equal(snapshot(s), before);
  person(s).location = "meadow";
  const ownBefore = { ...stock(s) }, baseBefore = { ...s.resources }, seed = s.seed, clock = s.minutes;
  assert.deepEqual(regionHarvest(s, "aki"), { received: { ingredients: 3, scrap: 1 } });
  assert.deepEqual(stock(s), ownBefore);
  assert.deepEqual(s.resources, baseBefore);
  assert.equal(s.seed, seed);
  assert.equal(s.minutes, clock);
  assert.equal(regionHarvestAvailable(s), false);
  person(s, "mio").location = "meadow";
  before = snapshot(s);
  assert.ok(regionHarvest(s, "mio").error);
  assert.equal(snapshot(s), before);
  s.minutes += 1440;
  assert.equal(regionHarvestAvailable(s), true);
  assert.equal(regionHarvest(s, "mio").error, undefined);
  assert.deepEqual(s.region!.harvests.map((entry) => entry.actorId), ["aki", "mio"]);
  assert.equal(validRegion(s), true);
});

test("Saved-region validation checks receipts, trust, request attribution and historical stock accounting", () => {
  const s = village();
  stock(s).scrap = 8;
  assert.equal(applyRegionInteraction(s, "aki", "village-trader", "trade-food").error, undefined);
  assert.equal(applyRegionInteraction(s, "aki", "village-guide", "talk").error, undefined);
  assert.equal(applyRegionInteraction(s, "aki", "village-guide", "deliver").error, undefined);
  assert.equal(validRegion(s), true);
  stock(s).food = 0;
  stock(s).medicine = 0;
  assert.equal(validRegion(s), true, "Past receipts do not require the goods to remain in the pack");
  for (const change of [
    (x: GameState) => { x.region!.receipts[0].received.food = 300; },
    (x: GameState) => { x.region!.stock.food = 6; },
    (x: GameState) => { x.region!.trust["village-guide"].aki = 99; },
    (x: GameState) => { x.region!.request!.deliveredBy = "mio"; },
    (x: GameState) => { x.region!.routeKnownBy.push("mio"); },
    (x: GameState) => { x.region!.receipts.push({ ...x.region!.receipts[1] }); },
    (x: GameState) => { x.region!.receipts[0].actorId = "unknown"; },
  ]) {
    const bad = structuredClone(s);
    change(bad);
    assert.equal(validRegion(bad), false);
  }
  const legacy = village();
  delete legacy.region;
  assert.equal(validRegion(legacy), true);
  legacy.region = createRegionState(legacy);
  assert.equal(validRegion(legacy), true);
  assert.equal(REGION_NPCS.filter(npc => npc.location === "village").length, 2);
});
