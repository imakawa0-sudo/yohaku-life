import assert from "node:assert/strict";
import test from "node:test";
import {
  advanceSpatial,
  advanceSpatialMinute,
  cancelSpatialOrder,
  issueSpatialOrder,
  locateSpatial,
  setSpatialConnection,
  setSpatialEntryRule,
  setSpatialGate,
  spatialReservationId,
} from "../src/reform/spatial/actions";
import { inspectSpatialRoute } from "../src/reform/spatial/route";
import type {
  SpatialIntent,
  SpatialPoint,
  SpatialRef,
  SpatialState,
} from "../src/reform/spatial/types";
import {
  createSpatialFixture,
  homePoint,
  otherPoint,
} from "./fixtures/reform-spatial";

const f: SpatialRef = { kind: "item", id: "F" };
const q: SpatialRef = { kind: "actor", id: "Q" };
const at = (point: SpatialPoint) => ({ kind: "at" as const, point });
const use = (actorId = "P", useMinutes = 2): SpatialIntent => ({
  kind: "use",
  actorId,
  slotId: "desk-seat",
  useMinutes,
});
const move = (destination: SpatialPoint, actorId = "P"): SpatialIntent => ({
  kind: "move",
  actorId,
  destination,
});
const carry = (payload = f, destination = homePoint(2)): SpatialIntent => ({
  kind: "carry",
  actorId: "P",
  payload,
  destination,
});
function issue(state: SpatialState, intent: SpatialIntent) {
  const before = structuredClone({ state, intent });
  const result = issueSpatialOrder(state, intent);
  assert.deepEqual({ state, intent }, before);
  assert.ok(result.ok);
  return result.state;
}
function advance(state: SpatialState, minutes: number) {
  const before = structuredClone(state);
  const result = advanceSpatial(state, minutes);
  assert.deepEqual(state, before);
  return result;
}

test("order_does_not_advance_or_arrive", () => {
  const source = createSpatialFixture();
  const intent = move(otherPoint(1));
  const state = issue(source, intent);
  assert.equal(state.time, 0);
  assert.deepEqual(state.actors.P.position, at(homePoint(0)));
  assert.deepEqual(advance(state, 0), { state, events: [] });
  const order = state.actors.P.order!;
  assert.ok(order.intent.kind === "move");
  order.intent.destination.cell = 0;
  state.domains.home.blockedCells.push(1);
  assert.deepEqual(intent, move(otherPoint(1)));
  assert.deepEqual(source, createSpatialFixture());
  const samePoint = issue(source, move(homePoint(0)));
  const done = advance(samePoint, 1);
  assert.deepEqual(
    done.events.map((e) => [e.kind, e.atTime]),
    [["arrived", 1]],
  );
  assert.deepEqual(done.state.actors.P.position, at(homePoint(0)));
});

test("use_starts_after_arrival", () => {
  const state = issue(createSpatialFixture(), use());
  const id = state.actors.P.order!.id;
  const arrival = advance(state, 2);
  assert.deepEqual(arrival.events, [
    { actorId: "P", orderId: id, kind: "arrived", atTime: 2 },
  ]);
  assert.equal(arrival.state.actors.P.order?.useRemaining, 2);
  const progress = advance(arrival.state, 1);
  assert.equal(progress.state.actors.P.order?.useRemaining, 1);
  assert.deepEqual(progress.events, []);
  assert.equal(Object.keys(progress.state.reservations).length, 1);
  const done = advance(progress.state, 4);
  assert.deepEqual(done.events, [
    { actorId: "P", orderId: id, kind: "use-completed", atTime: 4 },
  ]);
  assert.equal(done.state.actors.P.order, null);
  assert.deepEqual(done.state.reservations, {});
});

test("one minute holds a selected ready use order while another order completes", () => {
  const source = createSpatialFixture();
  source.actors.P.position = at(homePoint(2));
  source.slots["other-seat"] = {
    id: "other-seat",
    point: homePoint(0),
    allowedActorIds: null,
  };
  const state = issue(issue(source, use("P", 1)), {
    kind: "use",
    actorId: "Q",
    slotId: "other-seat",
    useMinutes: 1,
  });
  const p = state.actors.P.order!.id;
  const q = state.actors.Q.order!.id;
  const before = structuredClone(state);
  const next = advanceSpatialMinute(state, new Set([p]));
  assert.equal(next.state.time, 1);
  assert.equal(next.state.actors.P.order?.useRemaining, 1);
  assert.equal(next.state.actors.Q.order, null);
  assert.deepEqual(next.events, [
    { actorId: "Q", orderId: q, kind: "use-completed", atTime: 1 },
  ]);
  assert.deepEqual(next.state.reservations, {
    [spatialReservationId({ kind: "slot", id: "desk-seat" })]:
      state.reservations[spatialReservationId({ kind: "slot", id: "desk-seat" })],
  });
  assert.deepEqual(state, before);
  assert.deepEqual(advanceSpatialMinute(next.state).events, [
    { actorId: "P", orderId: p, kind: "use-completed", atTime: 2 },
  ]);
});

test("a held use order still approaches its slot and arrival spends no use time", () => {
  const state = issue(createSpatialFixture(), use());
  const id = state.actors.P.order!.id;
  const approach = advanceSpatialMinute(state, new Set([id]));
  assert.deepEqual(approach.state.actors.P.position, at(homePoint(1)));
  assert.deepEqual(approach.events, []);
  const arrival = advanceSpatialMinute(approach.state);
  assert.deepEqual(arrival.state.actors.P.position, at(homePoint(2)));
  assert.equal(arrival.state.actors.P.order?.phase, "use");
  assert.equal(arrival.state.actors.P.order?.useRemaining, 2);
  assert.deepEqual(arrival.events, [
    { actorId: "P", orderId: id, kind: "arrived", atTime: 2 },
  ]);
});

test("a held order still checks permission and leaves permission wait after access returns", () => {
  const state = advance(issue(createSpatialFixture(), use()), 2).state;
  state.slots["desk-seat"].allowedActorIds = [];
  const held = new Set([state.actors.P.order!.id]);
  const denied = advanceSpatialMinute(state, held);
  assert.equal(denied.state.actors.P.order?.phase, "waiting");
  assert.equal(denied.state.actors.P.order?.waitReason, "use-denied");
  assert.equal(denied.state.actors.P.order?.useRemaining, 2);
  denied.state.slots["desk-seat"].allowedActorIds = ["P"];
  const resumed = advanceSpatialMinute(denied.state, held);
  assert.equal(resumed.state.actors.P.order?.phase, "use");
  assert.equal(resumed.state.actors.P.order?.waitReason, null);
  assert.equal(resumed.state.actors.P.order?.useRemaining, 2);
});

test("cancelling a held use order still finishes its admitted transit and releases the slot", () => {
  const source = createSpatialFixture();
  source.slots["desk-seat"].point = otherPoint(1);
  const state = issue(source, use());
  const id = state.actors.P.order!.id;
  const held = new Set([id]);
  const transit = advanceSpatialMinute(state, held).state;
  assert.equal(transit.actors.P.position.kind, "transit");
  const cancelled = cancelSpatialOrder(transit, "P");
  const closed = setSpatialConnection(cancelled.state, "road", false);
  const leaving = advanceSpatialMinute(closed, held);
  assert.deepEqual(leaving.events, []);
  const done = advanceSpatialMinute(leaving.state, held);
  assert.deepEqual(done.events, [
    { actorId: "P", orderId: id, kind: "cancelled", atTime: 3 },
  ]);
  assert.deepEqual(done.state.actors.P.position, at(otherPoint(0)));
  assert.equal(done.state.actors.P.order, null);
  assert.deepEqual(done.state.reservations, {});
});

test("successive unheld one-minute transitions match bulk advance and event order", () => {
  const state = issue(issue(createSpatialFixture(), carry()), use("Q", 2));
  const events = [];
  let cursor = state;
  for (let minute = 0; minute < 10; minute++) {
    const step = advanceSpatialMinute(cursor);
    cursor = step.state;
    events.push(...step.events);
  }
  assert.deepEqual({ state: cursor, events }, advance(state, 10));
});

test("slot_is_exclusive", () => {
  const source = createSpatialFixture();
  source.actors.Q.position = at(homePoint(2));
  const state = issue(source, use());
  assert.deepEqual(issueSpatialOrder(state, use("Q")), {
    ok: false,
    reason: "reserved",
  });
  const active = structuredClone(state);
  assert.deepEqual(issueSpatialOrder(state, move(homePoint(1))), {
    ok: false,
    reason: "actor-busy",
  });
  assert.deepEqual(state, active);
  const cancel = cancelSpatialOrder(state, "P");
  assert.equal(cancel.state.time, state.time);
  assert.equal(cancel.events[0]?.kind, "cancelled");
  const done = advance(issue(cancel.state, use("Q", 1)), 1);
  assert.equal(done.events.at(-1)?.kind, "use-completed");
});

test("permission_revoked_before_entry", () => {
  const middle = advance(
    issue(createSpatialFixture(), move(homePoint(2))),
    1,
  ).state;
  const point = homePoint(2);
  const allowed: string[] = [];
  const closed = setSpatialEntryRule(middle, point, allowed);
  point.cell = 1;
  allowed.push("P");
  assert.deepEqual(middle.entryRules, []);
  const waiting = advance(closed, 2);
  assert.deepEqual(waiting.events, []);
  assert.deepEqual(waiting.state.actors.P.position, at(homePoint(1)));
  assert.equal(waiting.state.actors.P.order?.waitReason, "entry-denied");
  const open = setSpatialEntryRule(waiting.state, homePoint(2), null);
  const done = advance(open, 1);
  assert.equal(done.events[0]?.kind, "arrived");
  assert.deepEqual(done.state.actors.P.position, at(homePoint(2)));
});

test("admitted_segment_finishes", () => {
  const state = advance(
    issue(createSpatialFixture(), move(otherPoint(1))),
    1,
  ).state;
  const closed = setSpatialConnection(state, "road", false);
  assert.equal(state.connections.road.open, true);
  assert.deepEqual(issueSpatialOrder(closed, move(otherPoint(1), "Q")), {
    ok: false,
    reason: "physical-block",
  });
  const exit = advance(closed, 2);
  assert.deepEqual(exit.events, []);
  assert.deepEqual(exit.state.actors.P.position, at(otherPoint(0)));
  assert.equal(advance(exit.state, 1).events[0]?.kind, "arrived");
});

test("slot_permission_can_pause_and_resume_remaining_use", () => {
  const state = advance(issue(createSpatialFixture(), use()), 3).state;
  state.slots["desk-seat"].allowedActorIds = [];
  const paused = advance(state, 3);
  assert.deepEqual(paused.events, []);
  assert.equal(paused.state.actors.P.order?.waitReason, "use-denied");
  assert.equal(paused.state.actors.P.order?.useRemaining, 1);
  paused.state.slots["desk-seat"].allowedActorIds = ["P"];
  assert.equal(advance(paused.state, 1).events[0]?.kind, "use-completed");
});

test("pickup_requires_actual_colocation", () => {
  const ordered = issue(createSpatialFixture(), carry(f, homePoint(0)));
  const roadExit = advance(ordered, 3);
  assert.deepEqual(roadExit.events, []);
  assert.deepEqual(roadExit.state.items.F.position, at(otherPoint(1)));
  const pickup = advance(roadExit.state, 1);
  assert.deepEqual(
    pickup.events.map((e) => [e.kind, e.atTime]),
    [["picked-up", 4]],
  );
  assert.deepEqual(pickup.state.items.F.position, {
    kind: "carried",
    carrierId: "P",
  });
  assert.deepEqual(
    issueSpatialOrder(pickup.state, {
      kind: "carry",
      actorId: "Q",
      payload: f,
      destination: otherPoint(0),
    }),
    { ok: false, reason: "payload-unavailable" },
  );
  const transport = advance(pickup.state, 2);
  const location = locateSpatial(transport.state, f);
  assert.equal(location.kind, "transit");
  assert.deepEqual(location, transport.state.actors.P.position);
  if (location.kind === "transit") location.step.to.cell = 5;
  assert.notDeepEqual(location, transport.state.actors.P.position);
  const done = advance(transport.state, 4);
  assert.deepEqual(
    done.events.map((e) => [e.kind, e.atTime]),
    [["delivered", 8]],
  );
  assert.deepEqual(done.state.items.F.position, at(homePoint(0)));
  assert.deepEqual(done.state.reservations, {});
});

test("handling_revoked_before_pickup", () => {
  const state = advance(issue(createSpatialFixture(), carry()), 3).state;
  state.items.F.carryAllowedActorIds = [];
  const blocked = advance(state, 1);
  assert.deepEqual(blocked.events, []);
  assert.equal(blocked.state.actors.P.order?.waitReason, "handling-denied");
  assert.deepEqual(blocked.state.items.F.position, at(otherPoint(1)));
  assert.equal(Object.keys(blocked.state.reservations).length, 1);
  blocked.state.items.F.carryAllowedActorIds = ["P"];
  assert.equal(advance(blocked.state, 1).events[0]?.kind, "picked-up");
});

test("busy_patient_is_not_picked_up", () => {
  const state = advance(issue(createSpatialFixture(), use("Q", 3)), 3).state;
  const before = structuredClone(state);
  assert.deepEqual(issueSpatialOrder(state, carry(q)), {
    ok: false,
    reason: "payload-unavailable",
  });
  assert.deepEqual(state, before);
  assert.equal(state.actors.Q.order?.useRemaining, 2);
  assert.equal(Object.keys(state.reservations).length, 1);
});

test("patient_starts_work_during_approach", () => {
  const source = createSpatialFixture();
  source.actors.Q.position = at(homePoint(2));
  const state = issue(issue(source, carry(q, homePoint(0))), use("Q", 5));
  const waiting = advance(state, 2);
  assert.deepEqual(waiting.events, []);
  assert.deepEqual(waiting.state.actors.Q.position, at(homePoint(2)));
  assert.equal(waiting.state.actors.P.order?.waitReason, "payload-unavailable");
  assert.equal(waiting.state.actors.Q.order?.useRemaining, 3);
  assert.equal(Object.keys(waiting.state.reservations).length, 2);
  const done = advance(waiting.state, 4);
  const release = advance(waiting.state, 3);
  const retry = advance(release.state, 1);
  assert.deepEqual(done, {
    state: retry.state,
    events: [...release.events, ...retry.events],
  });
  assert.deepEqual(
    done.events.map((e) => [e.actorId, e.kind, e.atTime]),
    [
      ["Q", "use-completed", 5],
      ["P", "picked-up", 6],
    ],
  );
});

test("carried_actor_cannot_start_order", () => {
  const source = createSpatialFixture();
  assert.deepEqual(
    issueSpatialOrder(source, carry({ kind: "actor", id: "P" })),
    { ok: false, reason: "payload-unavailable" },
  );
  const state = advance(issue(source, carry(q)), 1).state;
  assert.deepEqual(issueSpatialOrder(state, use("Q")), {
    ok: false,
    reason: "actor-busy",
  });
  assert.deepEqual(state.actors.Q.position, {
    kind: "carried",
    carrierId: "P",
  });
  const dropped = cancelSpatialOrder(state, "P");
  assert.deepEqual(dropped.state.actors.Q.position, at(homePoint(0)));
  assert.deepEqual(dropped.state.reservations, {});
  source.actors.P.position = { kind: "carried", carrierId: "Q" };
  source.actors.Q.position = { kind: "carried", carrierId: "P" };
  assert.throws(() => locateSpatial(source, q), /cycl/i);
});

test("moved_payload_waits_at_saved_pickup", () => {
  const source = createSpatialFixture();
  source.actors.Q.position = at(homePoint(2));
  const state = issue(issue(source, carry(q)), move(homePoint(5), "Q"));
  const waiting = advance(state, 5);
  assert.deepEqual(
    waiting.events.map((e) => [e.actorId, e.kind]),
    [["Q", "arrived"]],
  );
  assert.deepEqual(waiting.state.actors.P.position, at(homePoint(2)));
  assert.deepEqual(waiting.state.actors.Q.position, at(homePoint(5)));
  assert.deepEqual(waiting.state.actors.P.order?.pickupPoint, homePoint(2));
  assert.equal(waiting.state.actors.P.order?.waitReason, "payload-unavailable");
  const cancelled = cancelSpatialOrder(waiting.state, "P");
  assert.deepEqual(cancelled.state.actors.P.position, at(homePoint(2)));
  assert.deepEqual(cancelled.state.actors.Q.position, at(homePoint(5)));
  assert.deepEqual(cancelled.state.reservations, {});
});

test("cancel_mid_segment_finishes_only_that_segment", () => {
  const state = advance(
    issue(createSpatialFixture(), carry(f, homePoint(2))),
    6,
  ).state;
  const id = state.actors.P.order!.id;
  const before = structuredClone(state);
  const exiting = cancelSpatialOrder(state, "P");
  assert.deepEqual(state, before);
  assert.deepEqual(exiting.events, []);
  assert.equal(exiting.state.time, 6);
  assert.equal(exiting.state.actors.P.order?.phase, "exiting-after-cancel");
  assert.deepEqual(exiting.state.reservations, state.reservations);
  assert.deepEqual(cancelSpatialOrder(exiting.state, "P"), exiting);
  const almost = advance(setSpatialConnection(exiting.state, "road", false), 1);
  assert.deepEqual(almost.events, []);
  const done = advance(almost.state, 5);
  assert.deepEqual(done.events, [
    { actorId: "P", orderId: id, kind: "cancelled", atTime: 8 },
  ]);
  assert.deepEqual(done.state.actors.P.position, at(homePoint(0)));
  assert.deepEqual(done.state.items.F.position, at(homePoint(0)));
  assert.deepEqual(done.state.reservations, {});
  assert.deepEqual(cancelSpatialOrder(done.state, "P"), {
    state: done.state,
    events: [],
  });
});

test("advance_partition_is_equivalent", () => {
  const state = issue(issue(createSpatialFixture(), carry()), use("Q", 2));
  state.actors = Object.fromEntries(Object.entries(state.actors).reverse());
  const whole = advance(state, 10);
  const first = advance(state, 3);
  inspectSpatialRoute(first.state, "Q", homePoint(2), homePoint(0));
  locateSpatial(first.state, f);
  const second = advance(first.state, 7);
  assert.deepEqual(whole, {
    state: second.state,
    events: [...first.events, ...second.events],
  });
  assert.deepEqual(
    whole.events.filter((e) => e.atTime === 4).map((e) => e.actorId),
    ["P", "Q"],
  );
});

test("invalid_time_and_order_allocation_fail_before_changes", () => {
  const state = issue(createSpatialFixture(), use());
  for (const delta of [-1, 1.5, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1]) {
    assert.throws(() => advanceSpatial(state, delta));
  }
  state.time = Number.MAX_SAFE_INTEGER;
  assert.throws(() => advanceSpatial(state, 1));
  assert.deepEqual(advance(state, 0).events, []);
  state.nextOrderId = 1;
  assert.deepEqual(issueSpatialOrder(state, use("Q", 0)), {
    ok: false,
    reason: "invalid-input",
  });
  assert.deepEqual(issueSpatialOrder(state, move(homePoint(1), "Q")), {
    ok: false,
    reason: "invalid-input",
  });
  state.nextOrderId = Number.MAX_SAFE_INTEGER;
  assert.deepEqual(issueSpatialOrder(state, move(homePoint(1), "Q")), {
    ok: false,
    reason: "invalid-input",
  });
});

test("long_uninterrupted_intervals_stop_at_the_exact_boundary", () => {
  const source = createSpatialFixture();
  source.connections.road.minutes = Number.MAX_SAFE_INTEGER;
  source.slots["desk-seat"].point = homePoint(0);
  const state = issue(
    issue(source, move(otherPoint(0))),
    use("Q", Number.MAX_SAFE_INTEGER - 1),
  );
  const before = advance(state, Number.MAX_SAFE_INTEGER - 2);
  assert.deepEqual(before.events, []);
  const position = before.state.actors.P.position;
  assert.ok(position.kind === "transit");
  assert.equal(position.remaining, 2);
  assert.equal(before.state.actors.Q.order?.useRemaining, 1);
  const done = advance(before.state, 2);
  assert.deepEqual(
    done.events.map((e) => [e.kind, e.atTime]),
    [
      ["use-completed", Number.MAX_SAFE_INTEGER - 1],
      ["arrived", Number.MAX_SAFE_INTEGER],
    ],
  );
});

test("carry_requires_a_current_route_for_both_legs", () => {
  const state = setSpatialConnection(createSpatialFixture(), "road", false);
  assert.deepEqual(issueSpatialOrder(state, carry()), {
    ok: false,
    reason: "physical-block",
  });
  state.items.F.position = at(homePoint(1));
  assert.deepEqual(issueSpatialOrder(state, carry(f, otherPoint(0))), {
    ok: false,
    reason: "physical-block",
  });
  state.items.F.carryAllowedActorIds = [];
  assert.deepEqual(issueSpatialOrder(state, carry()), {
    ok: false,
    reason: "handling-denied",
  });
  state.slots["desk-seat"].allowedActorIds = [];
  assert.deepEqual(issueSpatialOrder(state, use()), {
    ok: false,
    reason: "use-denied",
  });
});

test("only_own_ids_resolve_even_when_names_resemble_prototype_keys", () => {
  const source = createSpatialFixture();
  assert.deepEqual(
    issueSpatialOrder(source, move(homePoint(1), "constructor")),
    { ok: false, reason: "missing" },
  );
  assert.deepEqual(
    issueSpatialOrder(source, {
      kind: "use",
      actorId: "P",
      slotId: "constructor",
      useMinutes: 1,
    }),
    { ok: false, reason: "missing" },
  );
  assert.deepEqual(
    issueSpatialOrder(source, carry({ kind: "item", id: "__proto__" })),
    { ok: false, reason: "missing" },
  );
  source.actors = {
    ...source.actors,
    ["__proto__"]: { ...source.actors.P, id: "__proto__" },
  };
  source.items = {
    ...source.items,
    ["constructor"]: {
      ...source.items.F,
      id: "constructor",
      position: at(homePoint(0)),
    },
  };
  source.slots = {
    ...source.slots,
    ["__proto__"]: {
      ...source.slots["desk-seat"],
      id: "__proto__",
      point: homePoint(0),
    },
  };
  const target: SpatialRef = { kind: "item", id: "constructor" };
  const state = issue(
    issue(source, {
      kind: "use",
      actorId: "__proto__",
      slotId: "__proto__",
      useMinutes: 1,
    }),
    carry(target, homePoint(0)),
  );
  const done = advance(state, 1);
  assert.deepEqual(
    done.events.map((e) => e.kind),
    ["picked-up", "delivered", "use-completed"],
  );
  assert.deepEqual(done.state.reservations, {});
  assert.throws(() => setSpatialGate(source, "constructor", false));
  const closed = setSpatialGate(source, "private-door", false);
  assert.equal(closed.gates["private-door"].open, false);
  assert.equal(source.gates["private-door"].open, true);
});

test("malformed_ids_cannot_select_real_actors_or_links", () => {
  const state = issue(createSpatialFixture(), use());
  const before = structuredClone(state);
  // Values arriving from JavaScript callers can violate the TypeScript signature.
  assert.throws(() => cancelSpatialOrder(state, ["P"] as unknown as string));
  assert.throws(() => cancelSpatialOrder(state, ""));
  assert.throws(() =>
    setSpatialConnection(state, ["road"] as unknown as string, false),
  );
  assert.throws(() =>
    setSpatialGate(state, ["private-door"] as unknown as string, false),
  );
  assert.deepEqual(state, before);
});

test("malformed_refs_cannot_fall_through_to_items", () => {
  const state = createSpatialFixture();
  const slot = { kind: "slot", id: "F" } as unknown as SpatialRef;
  assert.throws(() => locateSpatial(state, slot));
  assert.throws(() =>
    locateSpatial(state, { kind: "item", id: ["F"] as unknown as string }),
  );
  assert.throws(() => spatialReservationId({ kind: "item", id: "" }));
  assert.throws(() =>
    spatialReservationId({
      kind: "equipment",
      id: "F",
    } as unknown as SpatialRef),
  );
});

test("entry_rule_rejects_coercible_domain_ids", () => {
  const state = createSpatialFixture();
  const point = { domainId: ["home"], cell: 1 } as unknown as SpatialPoint;
  assert.throws(() => setSpatialEntryRule(state, point, []));
  assert.throws(() =>
    setSpatialEntryRule(state, { ...homePoint(0), cell: 0.5 }, []),
  );
  assert.deepEqual(state.entryRules, []);
});

test("external_points_are_stored_as_canonical_coordinates", () => {
  const state = createSpatialFixture();
  const extra = { source: "original" };
  const point = { ...homePoint(1), extra };
  const rules = setSpatialEntryRule(state, point, ["P"]);
  state.items.F.position = at(point);
  const carrying = issue(state, carry(f, point)).actors.P.order!;
  const moving = issue(state, move(point)).actors.P.order!;
  assert.ok(carrying.intent.kind === "carry" && moving.intent.kind === "move");
  extra.source = "changed";
  assert.deepEqual(rules.entryRules[0].point, homePoint(1));
  assert.deepEqual(carrying.pickupPoint, homePoint(1));
  assert.deepEqual(carrying.intent.destination, homePoint(1));
  assert.deepEqual(moving.intent.destination, homePoint(1));
});

test("lost slot reservation waits immediately on arrival", () => {
  const approach = advance(issue(createSpatialFixture(), use()), 1).state;
  approach.reservations = {};
  const arrival = advance(approach, 1);
  assert.deepEqual(
    arrival.events.map((e) => [e.kind, e.atTime]),
    [["arrived", 2]],
  );
  const order = arrival.state.actors.P.order!;
  assert.deepEqual(
    [order.phase, order.resumePhase, order.waitReason, order.useRemaining],
    ["waiting", "use", "reserved", 2],
  );
});
