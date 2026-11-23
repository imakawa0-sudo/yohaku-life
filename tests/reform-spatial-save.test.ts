import assert from "node:assert/strict";
import test from "node:test";
import {
  advanceSpatial,
  cancelSpatialOrder,
  issueSpatialOrder,
  setSpatialConnection,
  setSpatialEntryRule,
  spatialReservationId,
} from "../src/reform/spatial/actions";
import {
  isSpatialState,
  parseSpatialState,
  serializeSpatialState,
} from "../src/reform/spatial/codec";
import { spatialWalkId } from "../src/reform/spatial/route";
import type {
  SpatialIntent,
  SpatialRef,
  SpatialState,
} from "../src/reform/spatial/types";
import {
  createSpatialFixture,
  homePoint,
  otherPoint,
} from "./fixtures/reform-spatial";

function issue(state: SpatialState, intent: SpatialIntent) {
  const result = issueSpatialOrder(state, intent);
  assert.ok(result.ok);
  return result.state;
}

function save(state: SpatialState) {
  assert.equal(isSpatialState(state), true);
  const restored = parseSpatialState(serializeSpatialState(state));
  assert.deepEqual(restored, state);
  return restored;
}

function continued(state: SpatialState, minutes: number) {
  const result = advanceSpatial(save(state), minutes);
  assert.deepEqual(result, advanceSpatial(state, minutes));
  return result;
}

function road() {
  return advanceSpatial(
    issue(createSpatialFixture(), {
      kind: "move",
      actorId: "P",
      destination: otherPoint(0),
    }),
    1,
  ).state;
}

function carry(payload: SpatialRef) {
  const state = createSpatialFixture();
  state.items.F.position = { kind: "at", point: homePoint(0) };
  return issue(state, {
    kind: "carry",
    actorId: "P",
    payload,
    destination: otherPoint(1),
  });
}

function use() {
  return issue(createSpatialFixture(), {
    kind: "use",
    actorId: "P",
    slotId: "desk-seat",
    useMinutes: 3,
  });
}

function invalid(value: unknown, label: string) {
  assert.equal(isSpatialState(value), false, label);
  assert.throws(() => parseSpatialState(JSON.stringify(value)), Error, label);
  // Simulate a caller handing untrusted data to a typed writer.
  assert.throws(
    () => serializeSpatialState(value as SpatialState),
    Error,
    label,
  );
}

test("resume_on_road", () => {
  const state = setSpatialConnection(road(), "road", false);
  const position = save(state).actors.P.position;
  assert.equal(position.kind, "transit");
  assert.equal(position.remaining, 2);
  assert.equal(position.step.minutes, 3);
  const result = continued(state, 2);
  assert.deepEqual(result.state.actors.P.position, {
    kind: "at",
    point: otherPoint(0),
  });
  assert.deepEqual(
    result.events.map((e) => [e.kind, e.atTime]),
    [["arrived", 3]],
  );
});

test("resume_carried_payload", () => {
  const payloads: SpatialRef[] = [
    { kind: "actor", id: "Q" },
    { kind: "item", id: "F" },
  ];
  for (const payload of payloads) {
    const transit = advanceSpatial(carry(payload), 2).state;
    const restored = save(transit);
    const target =
      payload.kind === "actor" ? restored.actors.Q : restored.items.F;
    assert.deepEqual(target.position, { kind: "carried", carrierId: "P" });
    assert.equal(
      restored.reservations[spatialReservationId(payload)].orderId,
      restored.actors.P.order!.id,
    );
    const result = continued(transit, 3);
    assert.deepEqual(
      result.events.map((e) => e.kind),
      ["delivered"],
    );
    assert.deepEqual(result.state.reservations, {});
  }
});

test("resume_waiting", () => {
  let waiting = setSpatialEntryRule(use(), homePoint(2), []);
  waiting = advanceSpatial(waiting, 2).state;
  assert.equal(waiting.actors.P.order?.waitReason, "entry-denied");
  assert.deepEqual(continued(waiting, 5).events, []);
  const resume = (s: SpatialState) =>
    advanceSpatial(setSpatialEntryRule(s, homePoint(2), null), 3);
  assert.deepEqual(resume(save(waiting)), resume(waiting));
  assert.deepEqual(
    resume(waiting).events.map((e) => e.kind),
    ["arrived"],
  );

  const interrupted = advanceSpatial(use(), 3).state;
  interrupted.slots["desk-seat"].allowedActorIds = [];
  const paused = advanceSpatial(interrupted, 1).state;
  assert.equal(paused.actors.P.order?.resumePhase, "use");
  assert.equal(paused.actors.P.order?.useRemaining, 2);
  paused.slots["desk-seat"].allowedActorIds = ["P"];
  assert.deepEqual(
    continued(paused, 2).events.map((e) => e.kind),
    ["use-completed"],
  );
});

test("completed_event_is_not_replayed", () => {
  const done = advanceSpatial(use(), 5);
  assert.deepEqual(
    done.events.map((e) => e.kind),
    ["arrived", "use-completed"],
  );
  assert.deepEqual(continued(done.state, 10).events, []);
});

test("resume_after_cancel_mid_segment", () => {
  const transit = advanceSpatial(carry({ kind: "item", id: "F" }), 2).state;
  const cancelled = cancelSpatialOrder(transit, "P");
  assert.deepEqual(cancelled.events, []);
  const restored = save(cancelled.state);
  assert.equal(restored.actors.P.order?.phase, "exiting-after-cancel");
  assert.deepEqual(cancelSpatialOrder(restored, "P"), {
    state: restored,
    events: [],
  });
  const result = continued(restored, 2);
  assert.deepEqual(
    result.events.map((e) => [e.kind, e.atTime]),
    [["cancelled", 4]],
  );
  assert.deepEqual(result.state.actors.P.position, {
    kind: "at",
    point: otherPoint(0),
  });
  assert.deepEqual(
    result.state.items.F.position,
    result.state.actors.P.position,
  );
  assert.deepEqual(result.state.reservations, {});
  assert.equal(result.state.actors.P.order, null);
  assert.deepEqual(
    continued(cancelSpatialOrder(result.state, "P").state, 5).events,
    [],
  );
});

test("step_kind_survives_roundtrip", () => {
  const initial = createSpatialFixture();
  const id = spatialWalkId(homePoint(0), homePoint(1));
  initial.domains.home.stepMinutes = 3;
  initial.connections[id] = { ...initial.connections.road, id };
  delete initial.connections.road;
  let state = issue(initial, {
    kind: "move",
    actorId: "P",
    destination: homePoint(1),
  });
  state = issue(state, {
    kind: "move",
    actorId: "Q",
    destination: otherPoint(0),
  });
  state = advanceSpatial(state, 1).state;
  const restored = save(state);
  for (const [actor, kind] of [
    ["P", "walk"],
    ["Q", "connection"],
  ]) {
    const pos = restored.actors[actor].position;
    assert.equal(pos.kind, "transit");
    assert.deepEqual([pos.step.id, pos.step.kind], [id, kind]);
    const forged = structuredClone(restored);
    const corrupted = forged.actors[actor].position;
    assert.equal(corrupted.kind, "transit");
    corrupted.step.kind = kind === "walk" ? "connection" : "walk";
    invalid(forged, "kind and geometry must agree");
  }
  assert.equal(continued(state, 2).events.length, 2);
});

test("pickup_point_survives_roundtrip", () => {
  const initial = createSpatialFixture();
  initial.actors.Q.position = { kind: "at", point: homePoint(2) };
  let state = issue(initial, {
    kind: "carry",
    actorId: "P",
    payload: { kind: "actor", id: "Q" },
    destination: otherPoint(0),
  });
  state = issue(state, {
    kind: "move",
    actorId: "Q",
    destination: otherPoint(0),
  });
  state = advanceSpatial(state, 2).state;
  assert.equal(state.actors.P.order?.waitReason, "payload-unavailable");
  assert.deepEqual(state.actors.P.order?.pickupPoint, homePoint(2));
  assert.ok(state.actors.Q.order);
  const result = continued(state, 5);
  assert.deepEqual(result.state.actors.P.position, {
    kind: "at",
    point: homePoint(2),
  });
  assert.deepEqual(result.state.actors.Q.position, {
    kind: "at",
    point: otherPoint(0),
  });
  assert.deepEqual(
    result.events.map((e) => [e.actorId, e.kind]),
    [["Q", "arrived"]],
  );
  assert.equal(result.state.actors.P.order?.phase, "waiting");
});

test("reject_bad_version_or_refs", () => {
  const fixture = createSpatialFixture();
  invalid({ ...fixture, version: 2 }, "unknown version");
  invalid({ ...fixture, type: "game" }, "wrong tag");
  invalid({ ...fixture, completedEvents: [] }, "undeclared field");
  assert.throws(() => parseSpatialState("{"), SyntaxError);
  invalid({ ...fixture, actors: [] }, "dictionary represented by an array");
  invalid({ ...fixture, domains: {} }, "missing domain");
  for (const id of ["absent", "__proto__", "constructor"]) {
    const broken = structuredClone(fixture);
    broken.actors.P.carryAllowedActorIds = [id];
    invalid(broken, "missing actor " + id);
  }
  const missingSlot = use();
  delete missingSlot.slots["desk-seat"];
  invalid(missingSlot, "missing slot");
  const missingItem = carry({ kind: "item", id: "F" });
  delete missingItem.items.F;
  invalid(missingItem, "missing item");
  const cell = structuredClone(fixture);
  cell.slots["desk-seat"].point.cell = 6;
  invalid(cell, "out of bounds");
  const dimensions = structuredClone(fixture);
  dimensions.domains.home.width = Number.MAX_SAFE_INTEGER;
  invalid(dimensions, "unsafe product");
  const key = structuredClone(fixture);
  key.actors.P.id = "Q";
  invalid(key, "key and ID disagree");
  const gate = structuredClone(fixture);
  gate.gates.extra = {
    ...gate.gates["private-door"],
    id: "extra",
    a: homePoint(2),
    b: homePoint(1),
  };
  invalid(gate, "duplicate gate on reversed edge");
  gate.gates.extra.b = homePoint(3);
  invalid(gate, "row wrap is not an edge");
  const rule = { point: homePoint(0), allowedActorIds: ["P"] };
  invalid({ ...fixture, entryRules: [rule, rule] }, "duplicate entry rule");
  const detached = save(fixture);
  detached.slots["desk-seat"].point.cell = 1;
  assert.equal(fixture.slots["desk-seat"].point.cell, 2);
});

test("own keys with prototype names and matching actor/item ids survive", () => {
  const state = createSpatialFixture();
  Object.defineProperty(state.actors, "__proto__", {
    value: { ...state.actors.Q, id: "__proto__" },
    enumerable: true,
  });
  state.items.Q = {
    ...state.items.F,
    id: "Q",
    position: { kind: "at", point: homePoint(0) },
  };
  const first = issue(state, {
    kind: "carry",
    actorId: "P",
    payload: { kind: "actor", id: "Q" },
    destination: otherPoint(0),
  });
  const both = issue(first, {
    kind: "carry",
    actorId: "__proto__",
    payload: { kind: "item", id: "Q" },
    destination: otherPoint(0),
  });
  assert.equal(Object.keys(save(both).reservations).length, 2);
  assert.equal(continued(advanceSpatial(both, 1).state, 3).events.length, 2);
});

test("reject_invalid_progress", () => {
  invalid({ ...createSpatialFixture(), time: -1 }, "negative time");
  for (const remaining of [0, -1, 0.5, 4]) {
    const state = road();
    assert.equal(state.actors.P.position.kind, "transit");
    state.actors.P.position.remaining = remaining;
    invalid(state, "remaining " + remaining);
  }
  const admitted = road();
  assert.equal(admitted.actors.P.position.kind, "transit");
  admitted.actors.P.position.remaining =
    admitted.actors.P.position.step.minutes;
  assert.deepEqual(
    continued(admitted, 3).events.map((e) => e.kind),
    ["arrived"],
  );
  const duration = road();
  duration.connections.road.minutes = 0;
  invalid(duration, "zero duration");
  for (const remaining of [0, -1, 1.5, 4]) {
    const state = advanceSpatial(use(), 2).state;
    state.actors.P.order!.useRemaining = remaining;
    invalid(state, "bad use progress " + remaining);
  }
  const unused = use();
  unused.actors.P.order!.useRemaining--;
  invalid(unused, "use spent before arrival");
  const displaced = advanceSpatial(use(), 2).state;
  displaced.actors.P.position = { kind: "at", point: homePoint(0) };
  invalid(displaced, "using slot at another point");
  const noExit = use();
  noExit.actors.P.order!.phase = "exiting-after-cancel";
  invalid(noExit, "cancel exit at a point");
  const stale = road();
  stale.nextOrderId = 1;
  invalid(stale, "reused serial");
});

test("reject_duplicate_reservation", () => {
  const duplicate = use();
  const record = Object.values(duplicate.reservations)[0];
  duplicate.reservations.copy = { ...record, id: "copy" };
  invalid(duplicate, "duplicate target with alias key");
  const missing = use();
  missing.reservations = {};
  invalid(missing, "unreserved task");
  const orphan = use();
  orphan.actors.P.order = null;
  invalid(orphan, "owner already finished");
  const mismatch = use();
  Object.values(mismatch.reservations)[0].actorId = "Q";
  invalid(mismatch, "wrong owner");
});

test("reject_carry_cycle", () => {
  const state = advanceSpatial(carry({ kind: "actor", id: "Q" }), 1).state;
  state.actors.P.position = { kind: "carried", carrierId: "Q" };
  invalid(state, "indirect cycle");
  const self = createSpatialFixture();
  self.actors.P.position = { kind: "carried", carrierId: "P" };
  invalid(self, "self cycle");
  const wrong = advanceSpatial(carry({ kind: "item", id: "F" }), 1).state;
  wrong.items.F.position = { kind: "carried", carrierId: "Q" };
  invalid(wrong, "carried by someone else's order");
  const premature = carry({ kind: "item", id: "F" });
  premature.items.F.position = { kind: "carried", carrierId: "P" };
  invalid(premature, "carried before pickup");
});

test("saved phases retain their own position and progress", () => {
  const inactive = road();
  inactive.items.F.position = structuredClone(inactive.actors.P.position);
  invalid(inactive, "item transit without a carrier");
  inactive.items.F.position = { kind: "at", point: homePoint(0) };
  inactive.actors.P.order = null;
  invalid(inactive, "idle actor in transit");
  const state = use();
  state.actors.P.order!.phase = "waiting";
  state.actors.P.order!.resumePhase = "approach";
  state.actors.P.order!.waitReason = "use-denied";
  invalid(state, "permission to use is checked at the slot");
});

test("cancelled approaches exit without pickup or slot use", () => {
  const fixture = createSpatialFixture();
  fixture.slots["desk-seat"].point = otherPoint(1);
  const intents: SpatialIntent[] = [
    { kind: "use", actorId: "P", slotId: "desk-seat", useMinutes: 3 },
    {
      kind: "carry",
      actorId: "P",
      payload: { kind: "item", id: "F" },
      destination: homePoint(1),
    },
  ];
  for (const intent of intents) {
    const pending = cancelSpatialOrder(
      advanceSpatial(issue(fixture, intent), 1).state,
      "P",
    ).state;
    const result = continued(pending, 4);
    assert.deepEqual(
      result.events.map((e) => e.kind),
      ["cancelled"],
    );
    assert.deepEqual(result.state.actors.P.position, {
      kind: "at",
      point: otherPoint(0),
    });
    assert.deepEqual(result.state.items.F.position, {
      kind: "at",
      point: otherPoint(1),
    });
    assert.deepEqual(result.state.reservations, {});
  }
});

test("reject_departure_from_stage_target", () => {
  const fixture = createSpatialFixture();
  fixture.slots["desk-seat"].point = otherPoint(0);
  const slotApproach = advanceSpatial(
    issue(fixture, {
      kind: "use",
      actorId: "P",
      slotId: "desk-seat",
      useMinutes: 1,
    }),
    1,
  ).state;
  const haul: SpatialIntent = {
    kind: "carry",
    actorId: "P",
    payload: { kind: "item", id: "F" },
    destination: homePoint(0),
  };
  // Approaching a payload can legitimately depart from its eventual delivery point.
  const pickupApproach = advanceSpatial(issue(fixture, haul), 1).state;
  fixture.items.F.position = { kind: "at", point: homePoint(1) };
  const delivery = advanceSpatial(
    issue(fixture, { ...haul, destination: otherPoint(0) }),
    3,
  ).state;
  for (const state of [road(), slotApproach, pickupApproach, delivery]) {
    const job = state.actors.P.order!;
    const pos = state.actors.P.position;
    assert.equal(pos.kind, "transit");
    const cancelled = cancelSpatialOrder(state, "P").state;
    save(state);
    save(cancelled);
    for (const bad of [structuredClone(state), cancelled]) {
      const order = bad.actors.P.order!;
      const intent = order.intent;
      if (intent.kind === "use") bad.slots[intent.slotId].point = pos.step.from;
      else if (intent.kind === "carry" && job.phase === "approach")
        order.pickupPoint = pos.step.from;
      else intent.destination = pos.step.from;
      invalid(bad, intent.kind + " departs from its " + job.phase + " target");
    }
  }
});

test("reject_held_payload_after_same_point_delivery", () => {
  const initial = createSpatialFixture();
  const haul: SpatialIntent = {
    kind: "carry",
    actorId: "P",
    payload: { kind: "item", id: "F" },
    destination: otherPoint(1),
  };
  const beforePickup = advanceSpatial(issue(initial, haul), 1).state;
  const delivered = continued(beforePickup, 3);
  assert.deepEqual(
    delivered.events.map((e) => [e.kind, e.atTime]),
    [
      ["picked-up", 4],
      ["delivered", 4],
    ],
  );
  const held = advanceSpatial(carry(haul.payload), 2).state;
  for (const bad of [held, cancelSpatialOrder(held, "P").state]) {
    const order = bad.actors.P.order!;
    assert.equal(order.intent.kind, "carry");
    order.pickupPoint = order.intent.destination;
    invalid(bad, "same-point delivery already completed during pickup");
  }
});

for (const elapsed of [1, 4]) {
  test(
    "shared transit counts once per actor for advance(" + elapsed + ")",
    () => {
      const fixture = createSpatialFixture();
      fixture.connections.road.minutes = elapsed === 1 ? 3 : 8;
      let both = fixture;
      for (const actorId of ["P", "Q"])
        both = issue(both, {
          kind: "move",
          actorId,
          destination: otherPoint(0),
        });
      const shared = advanceSpatial(both, 1).state;
      shared.actors.Q.position = shared.actors.P.position;
      const expected = fixture.connections.road.minutes - 1 - elapsed;
      const result = continued(shared, elapsed);
      assert.deepEqual(result.events, []);
      for (const actor of Object.values(result.state.actors)) {
        assert.equal(actor.position.kind, "transit");
        assert.equal(actor.position.remaining, expected);
      }
      const done = continued(result.state, expected);
      assert.deepEqual(
        done.events.map((e) => [e.actorId, e.kind, e.atTime]),
        [
          ["P", "arrived", fixture.connections.road.minutes],
          ["Q", "arrived", fixture.connections.road.minutes],
        ],
      );
    },
  );
}

test("save rejects an actor standing in a wall", () => {
  const state = createSpatialFixture();
  state.domains.home.blockedCells.push(0);
  invalid(state, "standing actor in blocked cell");
});

test("save rejects a blocked admitted exit but permits other terrain changes", () => {
  const state = road();
  state.domains.other.blockedCells.push(0);
  invalid(state, "actor would land in a blocked cell");
  state.domains.other.blockedCells = [];
  state.actors.Q.position = { kind: "at", point: homePoint(2) };
  state.domains.home.blockedCells = [0, 1, 5];
  state.gates["private-door"].open = false;
  state.connections.road.open = false;
  state.entryRules = [{ point: otherPoint(0), allowedActorIds: [] }];
  const exit = continued(state, 2);
  assert.deepEqual(save(exit.state).actors.P.position, {
    kind: "at",
    point: otherPoint(0),
  });
});

test("revoked slot permission waits on arrival and resumes once after save", () => {
  const approach = advanceSpatial(use(), 1).state;
  approach.slots["desk-seat"].allowedActorIds = [];
  const arrival = continued(approach, 1);
  assert.deepEqual(
    arrival.events.map((e) => [e.kind, e.atTime]),
    [["arrived", 2]],
  );
  const order = arrival.state.actors.P.order!;
  assert.deepEqual(
    [order.phase, order.resumePhase, order.waitReason, order.useRemaining],
    ["waiting", "use", "use-denied", 3],
  );
  const paused = continued(arrival.state, 5);
  assert.deepEqual(paused.events, []);
  assert.equal(paused.state.actors.P.order!.useRemaining, 3);
  paused.state.slots["desk-seat"].allowedActorIds = ["P"];
  const done = continued(paused.state, 3);
  assert.deepEqual(
    done.events.map((e) => [e.kind, e.atTime]),
    [["use-completed", 10]],
  );
});
