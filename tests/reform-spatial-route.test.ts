import assert from "node:assert/strict";
import test from "node:test";
import {
  canEnterSpatialStep,
  inspectSpatialRoute,
  spatialWalkId,
} from "../src/reform/spatial/route";
import type {
  SpatialPoint,
  SpatialState,
  SpatialStep,
} from "../src/reform/spatial/types";
import {
  createSpatialFixture,
  homePoint,
  otherPoint,
} from "./fixtures/reform-spatial";

function inspectUnchanged(
  state: SpatialState,
  from: SpatialPoint,
  to: SpatialPoint,
) {
  const before = structuredClone({ state, from, to });
  const result = inspectSpatialRoute(state, "P", from, to);
  assert.deepEqual({ state, from, to }, before);
  return result;
}

function checkEntryUnchanged(state: SpatialState, step: SpatialStep) {
  const before = structuredClone({ state, step });
  const result = canEnterSpatialStep(state, "P", step);
  assert.deepEqual({ state, step }, before);
  return result;
}

test("shortest_route_is_two_minutes", () => {
  const route = inspectUnchanged(
    createSpatialFixture(),
    homePoint(0),
    homePoint(2),
  );
  assert.ok(route.ok);
  assert.equal(route.physical, true);
  assert.equal(route.minutes, 2);
  assert.deepEqual(
    route.steps.map((step) => step.to),
    [homePoint(1), homePoint(2)],
  );
});

test("closed_gate_uses_four_minute_detour", () => {
  const state = createSpatialFixture();
  state.gates["private-door"].open = false;
  const route = inspectUnchanged(state, homePoint(0), homePoint(2));
  assert.ok(route.ok);
  assert.equal(route.physical, true);
  assert.equal(route.minutes, 4);
  assert.equal(route.steps.length, 4);
  assert.deepEqual(route.steps.at(-1)?.from, homePoint(5));
  assert.deepEqual(route.steps.at(-1)?.to, homePoint(2));
});

test("permission_is_not_a_wall", () => {
  const state = createSpatialFixture();
  state.entryRules.push({ point: homePoint(2), allowedActorIds: [] });
  assert.deepEqual(inspectUnchanged(state, homePoint(0), homePoint(2)), {
    physical: true,
    ok: false,
    reason: "entry-denied",
  });
});

test("same_inputs_same_route", () => {
  const state = createSpatialFixture();
  for (const id of ["Á-shortcut", "z-shortcut"]) {
    state.connections[id] = {
      id,
      a: homePoint(0),
      b: homePoint(2),
      minutes: 2,
      open: true,
    };
  }
  const reordered = {
    ...state,
    domains: Object.fromEntries(Object.entries(state.domains).reverse()),
    connections: Object.fromEntries(
      Object.entries(state.connections).reverse(),
    ),
  };

  const route = inspectUnchanged(state, homePoint(0), homePoint(2));
  assert.deepEqual(
    inspectUnchanged(reordered, homePoint(0), homePoint(2)),
    route,
  );
  assert.ok(route.ok);
  // Walking ties in time with the links. Close the door to expose the link ID tie.
  assert.deepEqual(
    route.steps.map((step) => step.kind),
    ["walk", "walk"],
  );
  state.gates["private-door"].open = false;
  const shortcut = inspectUnchanged(state, homePoint(0), homePoint(2));
  assert.deepEqual(
    inspectUnchanged(reordered, homePoint(0), homePoint(2)),
    shortcut,
  );
  assert.ok(shortcut.ok);
  assert.deepEqual(
    shortcut.steps.map((step) => step.id),
    ["z-shortcut"],
  );
});

test("same_id_different_step_kind", () => {
  const state = createSpatialFixture();
  const a = homePoint(1);
  const b = homePoint(2);
  const id = spatialWalkId(a, b);
  const walk: SpatialStep = { kind: "walk", id, from: a, to: b, minutes: 1 };
  const connection: SpatialStep = { ...walk, kind: "connection" };
  state.connections[id] = { id, a, b, minutes: 1, open: true };

  state.gates["private-door"].open = false;
  assert.deepEqual(checkEntryUnchanged(state, walk), {
    ok: false,
    reason: "physical-block",
  });
  assert.deepEqual(checkEntryUnchanged(state, connection), { ok: true });
  const withConnection = inspectUnchanged(state, a, b);
  assert.ok(withConnection.ok);
  assert.deepEqual(withConnection.steps, [connection]);

  state.gates["private-door"].open = true;
  state.connections[id].open = false;
  assert.deepEqual(checkEntryUnchanged(state, connection), {
    ok: false,
    reason: "physical-block",
  });
  assert.deepEqual(checkEntryUnchanged(state, walk), { ok: true });
  const withWalk = inspectUnchanged(state, a, b);
  assert.ok(withWalk.ok);
  assert.deepEqual(withWalk.steps, [walk]);
});

test("a_restricted_cell_can_be_left_and_avoided", () => {
  const state = createSpatialFixture();
  state.entryRules.push({ point: homePoint(1), allowedActorIds: ["Q"] });
  const detour = inspectUnchanged(state, homePoint(0), homePoint(2));
  assert.ok(detour.ok);
  assert.equal(detour.minutes, 4);
  assert.deepEqual(
    detour.steps.map((step) => step.to),
    [3, 4, 5, 2].map(homePoint),
  );

  const escape = inspectUnchanged(state, homePoint(1), homePoint(0));
  assert.ok(escape.ok);
  assert.equal(escape.minutes, 1);
  const stay = inspectUnchanged(state, homePoint(1), homePoint(1));
  assert.deepEqual(stay, { physical: true, ok: true, steps: [], minutes: 0 });
});

test("domains_are_joined_by_an_open_bidirectional_connection", () => {
  const state = createSpatialFixture();
  const there = inspectUnchanged(state, homePoint(0), otherPoint(1));
  const back = inspectUnchanged(state, otherPoint(1), homePoint(0));
  assert.ok(there.ok && back.ok);
  assert.equal(there.minutes, 4);
  assert.equal(back.minutes, 4);
  assert.equal(there.steps[0].id, "road");
  assert.equal(back.steps[1].id, "road");

  state.connections.road.open = false;
  state.entryRules.push({ point: otherPoint(0), allowedActorIds: [] });
  assert.deepEqual(inspectUnchanged(state, homePoint(0), otherPoint(1)), {
    physical: false,
    ok: false,
    reason: "physical-block",
  });
});

test("route_total_accepts_the_safe_integer_boundary", () => {
  const state = createSpatialFixture();
  state.connections.road.minutes = Number.MAX_SAFE_INTEGER - 2;
  state.domains.other.stepMinutes = 2;

  const route = inspectUnchanged(state, homePoint(0), otherPoint(1));
  assert.ok(route.ok);
  assert.equal(route.minutes, Number.MAX_SAFE_INTEGER);
  assert.equal(route.steps.length, 2);
});

test("route_total_above_the_safe_integer_boundary_is_invalid", () => {
  const state = createSpatialFixture();
  state.connections.road.minutes = Number.MAX_SAFE_INTEGER;
  state.domains.other.stepMinutes = 2;

  assert.deepEqual(inspectUnchanged(state, homePoint(0), otherPoint(1)), {
    physical: true,
    ok: false,
    reason: "invalid-input",
  });
});

test("step_entry_rechecks_live_terrain_and_permissions", () => {
  const state = createSpatialFixture();
  const result = inspectUnchanged(state, homePoint(0), homePoint(2));
  assert.ok(result.ok);
  const step = result.steps[0];
  assert.deepEqual(checkEntryUnchanged(state, step), { ok: true });

  state.entryRules.push({ point: step.to, allowedActorIds: [] });
  assert.deepEqual(checkEntryUnchanged(state, step), {
    ok: false,
    reason: "entry-denied",
  });
  state.domains.home.blockedCells.push(step.to.cell);
  assert.deepEqual(checkEntryUnchanged(state, step), {
    ok: false,
    reason: "physical-block",
  });
});

test("dictionary_entries_do_not_inherit_ids", () => {
  const state = createSpatialFixture();
  const a = { domainId: "__proto__", cell: 0 };
  const b = { domainId: "__proto__", cell: 1 };
  assert.deepEqual(inspectUnchanged(state, a, b), {
    physical: false,
    ok: false,
    reason: "physical-block",
  });

  state.domains = {
    ...state.domains,
    [a.domainId]: { ...state.domains.other, id: a.domainId },
  };
  const ownDomain = inspectUnchanged(state, a, b);
  assert.ok(ownDomain.ok);
  assert.equal(ownDomain.minutes, 1);
  assert.deepEqual(checkEntryUnchanged(state, ownDomain.steps[0]), {
    ok: true,
  });
});

test("route and step require a real actor while reporting physical reachability", () => {
  const state = createSpatialFixture();
  const from = homePoint(0);
  const to = otherPoint(0);
  const road: SpatialStep = {
    kind: "connection",
    id: "road",
    from,
    to,
    minutes: 3,
  };
  for (const [actor, reason] of [
    ["absent", "missing"],
    ["constructor", "missing"],
    ["", "invalid-input"],
    [["P"], "invalid-input"],
  ] as const) {
    const actorId = actor as string;
    for (const open of [true, false]) {
      state.connections.road.open = open;
      assert.deepEqual(inspectSpatialRoute(state, actorId, from, to), {
        physical: open,
        ok: false,
        reason,
      });
      assert.deepEqual(canEnterSpatialStep(state, actorId, road), {
        ok: false,
        reason,
      });
    }
    assert.deepEqual(inspectSpatialRoute(state, actorId, from, from), {
      physical: true,
      ok: false,
      reason,
    });
  }
});

test("step admission rejects an unknown kind and malformed identity", () => {
  const state = createSpatialFixture();
  const route = inspectUnchanged(state, homePoint(0), otherPoint(0));
  assert.ok(route.ok);
  const road = route.steps[0];
  for (const bad of [
    { ...road, kind: "stair" },
    { ...road, id: ["road"] },
    { ...road, id: "" },
    { ...road, minutes: 0 },
    null,
  ])
    assert.deepEqual(canEnterSpatialStep(state, "P", bad as SpatialStep), {
      ok: false,
      reason: "invalid-input",
    });
});

test("route and step reject malformed points at either end", () => {
  const state = createSpatialFixture();
  const route = inspectUnchanged(state, homePoint(0), otherPoint(0));
  assert.ok(route.ok);
  for (const invalid of [
    null,
    { domainId: ["home"], cell: 0 },
    { domainId: "", cell: 0 },
    homePoint(0.5),
    homePoint(-1),
  ]) {
    for (const endpoint of ["from", "to"] as const) {
      const step: SpatialStep = {
        ...route.steps[0],
        [endpoint]: invalid as SpatialPoint,
      };
      assert.deepEqual(inspectSpatialRoute(state, "P", step.from, step.to), {
        physical: false,
        ok: false,
        reason: "invalid-input",
      });
      assert.deepEqual(canEnterSpatialStep(state, "P", step), {
        ok: false,
        reason: "invalid-input",
      });
    }
  }
});

test("route returns independent canonical walk and connection endpoints", () => {
  const state = createSpatialFixture();
  const selection = { label: "original" };
  const from = { ...homePoint(1), selection };
  state.connections.road.b = Object.assign(otherPoint(0), { selection });
  const route = inspectUnchanged(state, from, otherPoint(0));
  assert.ok(route.ok);
  const [walk, road] = route.steps;
  assert.deepEqual(
    [walk.from, walk.to, road.from, road.to],
    [homePoint(1), homePoint(0), homePoint(0), otherPoint(0)],
  );
  walk.from.cell = 4;
  road.to.cell = 1;
  assert.equal(from.cell, 1);
  assert.deepEqual(state.connections.road.b, { ...otherPoint(0), selection });
});
