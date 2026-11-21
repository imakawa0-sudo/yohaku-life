import test from "node:test";
import assert from "node:assert/strict";
import { advance, command, createGame, deserialize, serialize } from "../src/game/engine.ts";
import type { GameState, TravelPlan } from "../src/game/types.ts";
import { ensureInventory } from "../src/game/inventory.ts";
import { applyRegionInteraction } from "../src/game/region.ts";
import { recruitCompanion } from "../src/game/recruitment.ts";
import {
  MAX_TRAVEL_PLAN_MINUTES, closeTravelPlan, getOpenTravelPlans, saveTravelPlan,
  tickTravelPlanReminders, validTravelPlans,
} from "../src/game/travel-plans.ts";

const snapshot = (s: GameState) => JSON.stringify(s);
const person = (s: GameState, id = "aki") => s.residents.find((resident) => resident.id === id)!;
const input = (s: GameState, residentIds = ["aki"]) => ({ residentIds, purpose: "集落で話を聞き、川辺へ寄る", returnAt: s.minutes + 1440 });
function planned(s = createGame(701), ids = ["aki"]): { state: GameState; plan: TravelPlan } {
  const result = saveTravelPlan(s, input(s, ids));
  assert.equal(result.error, undefined);
  assert.equal(result.changed, true);
  return { state: s, plan: result.plan! };
}
function freeze(value: unknown) {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    for (const entry of Object.values(value)) freeze(entry);
    Object.freeze(value);
  }
}

test("Plan projections are pure on legacy saves and return independent sorted member copies", () => {
  const old = createGame(); old.version = 1;
  delete old.inventory; delete old.region;
  const beforeOld = snapshot(old);
  freeze(old);
  assert.equal(validTravelPlans(old), true);
  assert.deepEqual(getOpenTravelPlans(old), []);
  assert.deepEqual(tickTravelPlanReminders(old), []);
  assert.equal(snapshot(old), beforeOld);

  const { state: s } = planned(createGame(), ["ren", "aki", "ren"]);
  const before = snapshot(s);
  const result = getOpenTravelPlans(s);
  assert.deepEqual(result[0].residentIds, ["aki", "ren"]);
  result[0].purpose = "変更できるのは返り値だけ";
  result[0].residentIds.pop();
  assert.equal(snapshot(s), before);
  freeze(s);
  assert.equal(getOpenTravelPlans(s).length, 1);
  assert.equal(snapshot(s), before);
});

test("Planning includes unconscious or remote residents without changing physical state or held reservations", () => {
  let s = createGame(702);
  s = command(s, { type: "assign", residentIds: ["mio"], kind: "cook" }).state;
  s = advance(s, 5);
  s = command(s, { type: "pause", residentId: "mio" }).state;
  person(s).hp = 0;
  person(s).location = "village";
  person(s, "ren").location = "shelter";
  const before = structuredClone(s);
  const result = saveTravelPlan(s, { residentIds: ["ren", "aki", "ren"], purpose: "  迎えに行く予定  ", returnAt: s.minutes + 1440 });
  assert.equal(result.error, undefined);
  assert.equal(result.plan!.id, before.nextId);
  assert.equal(result.plan!.revisionId, before.nextId);
  assert.equal(result.plan!.purpose, "迎えに行く予定");
  assert.deepEqual(result.plan!.residentIds, ["aki", "ren"]);
  const { travelPlans: _plans, nextId: _next, ...afterWorld } = s;
  const { nextId: _beforeNext, ...beforeWorld } = before;
  assert.deepEqual(afterWorld, beforeWorld);
  assert.equal(s.nextId, before.nextId + 1);
  assert.equal(validTravelPlans(s), true);
  assert.equal(person(s, "mio").suspended?.reserved?.ingredients, 2);
  result.plan!.residentIds.length = 0;
  assert.equal(s.travelPlans!.entries[0].residentIds.length, 2);
});

test("Canonical repeated input is a no-op and overdue purpose edits preserve the existing deadline notice", () => {
  const { state: s, plan } = planned(createGame(703), ["aki", "ren"]);
  const before = snapshot(s);
  const repeated = saveTravelPlan(s, { planId: plan.id, residentIds: ["ren", "aki", "ren"], purpose: ` ${plan.purpose} `, returnAt: plan.returnAt });
  assert.equal(repeated.changed, false);
  assert.equal(snapshot(s), before);
  s.minutes = plan.returnAt;
  assert.equal(tickTravelPlanReminders(s).length, 1);
  s.minutes += 100;
  const nextId = s.nextId;
  const edited = saveTravelPlan(s, { planId: plan.id, residentIds: ["aki", "ren"], purpose: "帰還の前に持ち物を整理する", returnAt: plan.returnAt });
  assert.equal(edited.error, undefined);
  assert.equal(edited.plan!.revisionId, nextId);
  assert.equal(edited.plan!.updatedAt, s.minutes);
  assert.equal(edited.plan!.remindedAt, plan.returnAt);
  assert.equal(validTravelPlans(s), true);
  assert.deepEqual(tickTravelPlanReminders(s), []);
  const changed = saveTravelPlan(s, { planId: plan.id, residentIds: ["aki", "ren"], purpose: edited.plan!.purpose, returnAt: s.minutes + 30 });
  assert.equal(changed.error, undefined);
  assert.equal(changed.plan!.remindedAt, undefined);
  s.minutes += 30;
  assert.equal(tickTravelPlanReminders(s).length, 1);
  assert.equal(tickTravelPlanReminders(s).length, 0);
});

test("Conflicting participants, malformed inputs, changed past deadlines and ended edits fail atomically", () => {
  const s = createGame(704);
  const invalid = [
    { ...input(s), residentIds: [] },
    { ...input(s), residentIds: ["unknown"] },
    { ...input(s), residentIds: [null] },
    { ...input(s), purpose: "  " },
    { ...input(s), purpose: "あ".repeat(81) },
    { ...input(s), purpose: null },
    { ...input(s), returnAt: s.minutes },
    { ...input(s), returnAt: s.minutes + 0.5 },
    { ...input(s), returnAt: s.minutes + MAX_TRAVEL_PLAN_MINUTES + 1 },
    { ...input(s), returnAt: Number.NaN },
    { ...input(s), planId: 0 },
    { ...input(s), planId: 999 },
    null,
  ];
  for (const value of invalid) {
    const before = snapshot(s);
    assert.ok(saveTravelPlan(s, value as never).error);
    assert.equal(snapshot(s), before);
    assert.equal(s.travelPlans, undefined);
  }
  const first = saveTravelPlan(s, { ...input(s, ["aki", "ren"]), returnAt: s.minutes + MAX_TRAVEL_PLAN_MINUTES });
  assert.equal(first.error, undefined);
  const beforeConflict = snapshot(s);
  assert.ok(saveTravelPlan(s, input(s, ["ren", "mio"])).error);
  assert.equal(snapshot(s), beforeConflict);
  const second = saveTravelPlan(s, input(s, ["mio"]));
  assert.equal(second.error, undefined);
  const beforeEditConflict = snapshot(s);
  assert.ok(saveTravelPlan(s, { ...input(s, ["mio"]), planId: first.plan!.id }).error);
  assert.equal(snapshot(s), beforeEditConflict);
  s.ended = true;
  const ended = snapshot(s);
  assert.ok(saveTravelPlan(s, { ...input(s), planId: first.plan!.id }).error);
  assert.ok(closeTravelPlan(s, first.plan!.id).error);
  assert.equal(snapshot(s), ended);
});

test("Closing is explicit, idempotent and keeps history while releasing participants for another memo", () => {
  const { state: s, plan } = planned(createGame(705));
  assert.equal(person(s).location, "home");
  assert.equal(getOpenTravelPlans(s).length, 1, "Being home before departure cannot auto-complete a journey");
  const before = structuredClone(s), nextId = s.nextId;
  const closed = closeTravelPlan(s, plan.id);
  assert.equal(closed.error, undefined);
  assert.equal(closed.changed, true);
  assert.equal(closed.plan!.closedAt, s.minutes);
  assert.equal(closed.plan!.revisionId, nextId);
  assert.equal(s.travelPlans!.entries.length, 1);
  assert.deepEqual(getOpenTravelPlans(s), []);
  assert.deepEqual(s.residents, before.residents);
  assert.deepEqual(s.logs, before.logs);
  const closedSnapshot = snapshot(s);
  assert.equal(closeTravelPlan(s, plan.id).changed, false);
  assert.equal(snapshot(s), closedSnapshot);
  assert.ok(saveTravelPlan(s, { ...input(s), planId: plan.id }).error);
  assert.equal(snapshot(s), closedSnapshot);
  assert.equal(saveTravelPlan(s, input(s)).error, undefined);
  assert.equal(s.travelPlans!.entries.length, 2);
  assert.equal(validTravelPlans(s), true);
});

test("Due reminders handle exact and overdue clocks once, allocate nothing and ignore closed memos", () => {
  const s = createGame(706);
  const a = saveTravelPlan(s, { ...input(s, ["aki"]), returnAt: s.minutes + 10 }).plan!;
  const m = saveTravelPlan(s, { ...input(s, ["mio"]), returnAt: s.minutes + 15 }).plan!;
  const r = saveTravelPlan(s, { ...input(s, ["ren"]), returnAt: s.minutes + 10 }).plan!;
  closeTravelPlan(s, r.id);
  const { seed, nextId } = s, beforeWorld = structuredClone(s);
  s.minutes += 14;
  const due = tickTravelPlanReminders(s);
  assert.deepEqual(due.map((plan) => plan.id), [a.id]);
  assert.equal(due[0].remindedAt, s.minutes);
  assert.equal(s.travelPlans!.entries.find((plan) => plan.id === m.id)!.remindedAt, undefined);
  assert.equal(s.travelPlans!.entries.find((plan) => plan.id === r.id)!.remindedAt, undefined);
  assert.deepEqual([s.seed, s.nextId, s.residents, s.resources, s.logs], [seed, nextId, beforeWorld.residents, beforeWorld.resources, beforeWorld.logs]);
  due[0].purpose = "返り値だけを変える";
  assert.notEqual(s.travelPlans!.entries[0].purpose, due[0].purpose);
  assert.deepEqual(tickTravelPlanReminders(s), []);
  s.minutes++;
  assert.deepEqual(tickTravelPlanReminders(s).map((plan) => plan.id), [m.id]);
  const saved = snapshot(s);
  assert.equal(validTravelPlans(s), true);
  assert.deepEqual(tickTravelPlanReminders(s), []);
  assert.equal(snapshot(s), saved);
});

test("Strict validation rejects malformed extensions, temporal claims, overlapping open members and identity collisions", () => {
  for (const value of [null, [], {}, { version: 2, entries: [] }, { version: 1, entries: null }, { version: 1, entries: [null] }, { version: 1, entries: [], extra: true }]) {
    const s = createGame();
    (s as unknown as Record<string, unknown>).travelPlans = value;
    assert.equal(validTravelPlans(s), false);
    assert.deepEqual(getOpenTravelPlans(s), []);
    assert.deepEqual(tickTravelPlanReminders(s), []);
  }
  assert.equal(validTravelPlans(null as never), false);
  assert.equal(validTravelPlans("unknown" as never), false);
  const changes: ((s: GameState) => void)[] = [
    (s) => { s.travelPlans!.entries[0].id = 1; },
    (s) => { s.travelPlans!.entries[0].revisionId = s.nextId; },
    (s) => { s.travelPlans!.entries[0].revisionId = 0; },
    (s) => { s.travelPlans!.entries[0].createdAt = s.minutes + 1; },
    (s) => { s.travelPlans!.entries[0].updatedAt = s.minutes + 1; },
    (s) => { s.travelPlans!.entries[0].updatedAt = 0; },
    (s) => { s.travelPlans!.entries[0].returnAt = s.travelPlans!.entries[0].createdAt; },
    (s) => { s.travelPlans!.entries[0].returnAt = Number.POSITIVE_INFINITY; },
    (s) => { s.travelPlans!.entries[0].residentIds = []; },
    (s) => { s.travelPlans!.entries[0].residentIds = ["unknown"]; },
    (s) => { s.travelPlans!.entries[0].residentIds = ["aki", "aki"]; },
    (s) => { s.travelPlans!.entries[0].residentIds = ["ren", "aki"]; },
    (s) => { s.travelPlans!.entries[0].purpose = " 余白 "; },
    (s) => { s.travelPlans!.entries[0].purpose = ""; },
    (s) => { s.travelPlans!.entries[0].remindedAt = s.minutes; },
    (s) => { s.travelPlans!.entries[0].closedAt = s.minutes; },
    (s) => { (s.travelPlans!.entries[0] as unknown as Record<string, unknown>).extra = true; },
    (s) => { s.travelPlans!.entries.push({ ...s.travelPlans!.entries[0], id: s.nextId++, revisionId: s.nextId++ }); },
  ];
  for (const change of changes) {
    const { state: s } = planned(); change(s);
    const before = snapshot(s);
    assert.equal(validTravelPlans(s), false);
    assert.deepEqual(getOpenTravelPlans(s), []);
    assert.deepEqual(tickTravelPlanReminders(s), []);
    assert.equal(snapshot(s), before);
  }
});

test("Plan identities cannot reuse active, held, life, trade or historical action identities, while merchant visit clocks are separate", () => {
  const targets = ["active", "held", "craft", "event", "upgrade", "trade", "leisure"] as const;
  for (const target of targets) {
    const { state: s, plan } = planned();
    const collision = s.nextId++;
    switch (target) {
      case "active": person(s).action = { id: collision } as never; break;
      case "held": person(s).suspended = { id: collision } as never; break;
      case "craft": s.life!.crafts.push({ id: collision } as never); break;
      case "event": s.life!.events.push({ id: collision } as never); break;
      case "upgrade": s.life!.upgrades = [{ id: collision } as never]; break;
      case "trade": s.trade!.receipts.push({ id: collision } as never); break;
      case "leisure": s.autonomy = { version: 1, leisure: { aki: { actionId: collision } as never }, manualStays: {}, conversations: {}, mealPairs: {} }; break;
    }
    assert.equal(validTravelPlans(s), true, `Only identity collection is tested for ${target}, not the other module's body schema`);
    s.travelPlans!.entries[0] = { ...plan, revisionId: collision };
    assert.equal(validTravelPlans(s), false, target);
  }
  let s = createGame(707);
  s.minutes = 2159;
  for (const r of s.residents) { r.policy = "rest"; r.hunger = 100; }
  s = advance(s, 1);
  assert.equal(s.trade!.visit!.id, 2160);
  s.nextId = 2160;
  const result = saveTravelPlan(s, input(s));
  assert.equal(result.error, undefined);
  assert.equal(result.plan!.id, 2160);
  assert.equal(validTravelPlans(s), true);
});

test("Adding Haru after joining validates the current revision, without inventing initial membership", () => {
  const { state: s, plan } = planned(createGame(708));
  const earlierUnusedRevision = s.nextId++;
  s.minutes = 600;
  person(s, "mio").location = "village";
  ensureInventory(s).packs.mio.food = 3;
  assert.equal(applyRegionInteraction(s, "mio", "village-guide", "talk").error, undefined);
  assert.equal(applyRegionInteraction(s, "mio", "village-guide", "deliver").error, undefined);
  assert.equal(recruitCompanion(s, "mio", "village-guide").error, undefined);
  const joined = person(s, "village-guide"), logs = structuredClone(s.logs);
  assert.equal(validTravelPlans(s), true);
  const result = saveTravelPlan(s, { planId: plan.id, residentIds: ["aki", "village-guide"], purpose: plan.purpose, returnAt: plan.returnAt });
  assert.equal(result.error, undefined);
  assert.equal(result.plan!.createdAt, 480);
  assert.equal(result.plan!.updatedAt, joined.joinedAt);
  assert.ok(result.plan!.revisionId > joined.joinedLogId!);
  assert.deepEqual(s.logs, logs);
  assert.deepEqual(joined.memories, []);
  assert.equal(validTravelPlans(s), true);
  const wrongMinute = structuredClone(s);
  wrongMinute.travelPlans!.entries[0].updatedAt = 599;
  assert.equal(validTravelPlans(wrongMinute), false);
  const wrongOrder = structuredClone(s);
  wrongOrder.travelPlans!.entries[0].revisionId = earlierUnusedRevision;
  assert.equal(validTravelPlans(wrongOrder), false);
  const missingJoinOrder = structuredClone(s);
  delete person(missingJoinOrder, "village-guide").joinedLogId;
  assert.equal(validTravelPlans(missingJoinOrder), false);
});

test("Optional plans leave old formats unchanged and valid plans retain exact data through a save roundtrip", () => {
  for (const version of [1, 2, 3] as const) {
    const old = createGame(709); old.version = version;
    const before = snapshot(old);
    assert.equal(validTravelPlans(old), true);
    assert.deepEqual(getOpenTravelPlans(old), []);
    assert.equal(snapshot(old), before);
  }
  const { state: s } = planned(createGame(710));
  assert.equal(validTravelPlans(s), true);
  assert.deepEqual(deserialize(serialize(s)), s);
  const badContext = createGame(711);
  badContext.nextId = 1;
  const before = snapshot(badContext);
  assert.ok(saveTravelPlan(badContext, input(badContext)).error);
  assert.equal(snapshot(badContext), before);
});
