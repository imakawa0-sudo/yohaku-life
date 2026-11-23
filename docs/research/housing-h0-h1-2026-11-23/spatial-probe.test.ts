import assert from "node:assert/strict";
import test from "node:test";
import {
  advance,
  createState,
  describe,
  inspectRoute,
  issue,
  locate,
  modes,
  plan,
  setConstruction,
  setDoor,
  setHandlingPermission,
  setPermission,
  type Intent,
} from "./spatial-probe.ts";

// Design experiment only. These are equivalent semantic checkpoints, not scores
// for the three representations and not tests of the playable game.
const person = { kind: "actor", id: "porter" } as const;
const patient = { kind: "actor", id: "patient" } as const;
const furniture = { kind: "furniture", id: "bench" } as const;
const destination = "home:private";
const move: Intent = { kind: "move", actor: "porter", destination };

for (const mode of modes) {
  test(`${mode}: planning, display and issuing an order do not advance time or move resources`, () => {
    const state = createState(mode);
    const before = structuredClone(state);
    assert.equal(plan(state, move).ok, true);
    describe(state, "porter");
    assert.deepEqual(state, before);
    const ordered = issue(state, move);
    assert.equal(ordered.time, state.time);
    assert.equal(ordered.wood, state.wood);
    assert.deepEqual(locate(ordered, person), locate(state, person));
    assert.equal(ordered.actors.porter.task?.destination, destination);
  });

  test(`${mode}: a destination is distinct from arrival`, () => {
    const state = issue(createState(mode), move);
    const moving = advance(state, 1);
    assert.equal(moving.actors.porter.position.kind, "transit");
    assert.notDeepEqual(locate(moving, person), { kind: "node", node: destination });
    assert.equal(moving.actors.porter.task?.destination, destination);
    const arrived = advance(moving, 3);
    assert.deepEqual(locate(arrived, person), { kind: "node", node: destination });
    assert.equal(arrived.actors.porter.task, null);
    assert.equal(arrived.time, 4);
  });

  test(`${mode}: closing a door after ordering causes a detour from the reached node`, () => {
    const reachedHall = advance(issue(createState(mode), move), 2);
    assert.deepEqual(locate(reachedHall, person), { kind: "node", node: "home:hall" });
    const closed = setDoor(reachedHall, false);
    assert.equal(closed.time, reachedHall.time);
    const detouring = advance(closed, 2);
    assert.deepEqual(locate(detouring, person), { kind: "node", node: "home:south" });
    const arrived = advance(detouring, 4);
    assert.deepEqual(locate(arrived, person), { kind: "node", node: destination });
    assert.equal(arrived.time, 8);
  });

  test(`${mode}: construction plus a closed door causes waiting and reopening resumes movement`, () => {
    const ordered = issue(createState(mode), move);
    const blocked = setConstruction(setDoor(ordered, false), true);
    const waiting = advance(blocked, 5);
    assert.equal(waiting.actors.porter.task?.status, "waiting");
    assert.equal(waiting.actors.porter.task?.reason, "blocked");
    assert.deepEqual(locate(waiting, person), { kind: "node", node: "home:store" });
    const resumed = advance(setDoor(waiting, true), 4);
    assert.deepEqual(locate(resumed, person), { kind: "node", node: destination });
  });

  test(`${mode}: a closure request lets the entered segment finish and affects the next entry`, () => {
    const inDoor = advance(issue(createState(mode), move), 3);
    assert.equal(inDoor.actors.porter.position.kind, "transit");
    const requested = setDoor(inDoor, false);
    assert.equal(requested.time, inDoor.time);
    assert.deepEqual(requested.actors.porter.position, inDoor.actors.porter.position);
    const arrived = advance(requested, 1);
    assert.deepEqual(locate(arrived, person), { kind: "node", node: destination });
    assert.equal(arrived.time, 4);
    const nextJourney = issue(arrived, {
      kind: "move", actor: "porter", destination: "home:hall",
    });
    const detouring = advance(nextJourney, 2);
    assert.deepEqual(locate(detouring, person), { kind: "node", node: "home:southeast" });
  });

  test(`${mode}: physical reachability and permission are separate and revocation before entry causes waiting`, () => {
    const denied = setPermission(createState(mode), "porter", false);
    const route = inspectRoute(denied, "porter", "home:store", destination);
    assert.equal(route.physical, true);
    assert.equal(route.allowed, false);
    assert.equal(route.reason, "denied");
    const before = structuredClone(denied);
    assert.equal(plan(denied, move).ok, false);
    assert.throws(() => issue(denied, move), /denied/);
    assert.deepEqual(denied, before);
    const atThreshold = advance(issue(createState(mode), move), 2);
    assert.deepEqual(locate(atThreshold, person), { kind: "node", node: "home:hall" });
    const revoked = advance(setPermission(atThreshold, "porter", false), 2);
    assert.equal(revoked.actors.porter.task?.reason, "denied");
    assert.deepEqual(revoked.actors.porter.position, atThreshold.actors.porter.position);
    const arrived = advance(setPermission(revoked, "porter", true), 2);
    assert.deepEqual(locate(arrived, person), { kind: "node", node: destination });
  });

  test(`${mode}: revocation after entry completes only the current segment and is checked before the next one`, () => {
    const inDoor = advance(issue(createState(mode), move), 3);
    const requested = setPermission(inDoor, "porter", false);
    assert.equal(requested.time, inDoor.time);
    assert.deepEqual(requested.actors.porter.position, inDoor.actors.porter.position);
    const arrived = advance(requested, 1);
    assert.deepEqual(locate(arrived, person), { kind: "node", node: destination });
    assert.equal(arrived.time, 4);

    const inPreviousSegment = advance(issue(createState(mode), move), 1);
    const revoked = setPermission(inPreviousSegment, "porter", false);
    const reachedThreshold = advance(revoked, 1);
    assert.deepEqual(locate(reachedThreshold, person), { kind: "node", node: "home:hall" });
    assert.equal(reachedThreshold.time, 2);
    const waiting = advance(reachedThreshold, 1);
    assert.equal(waiting.actors.porter.task?.reason, "denied");
    assert.deepEqual(locate(waiting, person), { kind: "node", node: "home:hall" });
  });

  test(`${mode}: furniture is picked up only at its real location and has one location throughout transport`, () => {
    const state = createState(mode);
    state.furniture.bench.position = { kind: "node", node: destination };
    const ordered = issue(state, {
      kind: "carry", actor: "porter", payload: furniture, destination: "home:exit",
    });
    assert.deepEqual(locate(ordered, furniture), { kind: "node", node: destination });
    const approaching = advance(ordered, 1);
    assert.deepEqual(locate(approaching, furniture), { kind: "node", node: destination });
    const pickedUp = advance(approaching, 3);
    assert.deepEqual(locate(pickedUp, person), { kind: "node", node: destination });
    assert.deepEqual(pickedUp.furniture.bench.position, { kind: "carried", by: "porter" });
    const carried = advance(pickedUp, 1);
    assert.deepEqual(locate(carried, furniture), locate(carried, person));
    const delivered = advance(carried, 5);
    assert.deepEqual(locate(delivered, furniture), { kind: "node", node: "home:exit" });
    assert.deepEqual(Object.keys(delivered.furniture), ["bench"]);
    assert.deepEqual(delivered.reservations, {});
    assert.equal(delivered.time, 10);
  });

  test(`${mode}: a payload reservation does not override handling permission at pickup`, () => {
    const state = createState(mode);
    state.furniture.bench.position = { kind: "node", node: destination };
    const carry: Intent = {
      kind: "carry", actor: "porter", payload: furniture, destination: "home:exit",
    };
    const denied = setHandlingPermission(state, "porter", furniture, false);
    assert.equal(inspectRoute(denied, "porter", "home:store", destination).physical, true);
    assert.equal(inspectRoute(denied, "porter", "home:store", destination).allowed, true);
    assert.equal(plan(denied, carry).reason, "denied");
    const approaching = advance(issue(state, carry), 3);
    const revoked = advance(setHandlingPermission(approaching, "porter", furniture, false), 1);
    assert.equal(revoked.reservations["furniture:bench"], "porter");
    assert.equal(revoked.actors.porter.task?.reason, "denied");
    assert.deepEqual(locate(revoked, furniture), { kind: "node", node: destination });
    const resumed = advance(setHandlingPermission(revoked, "porter", furniture, true), 1);
    assert.deepEqual(resumed.furniture.bench.position, { kind: "carried", by: "porter" });
    assert.deepEqual(locate(resumed, furniture), locate(resumed, person));
  });

  test(`${mode}: the patient starts being carried only when co-located and shares the porter's intermediate location`, () => {
    const ordered = issue(createState(mode), {
      kind: "carry", actor: "porter", payload: patient, destination: "home:exit",
    });
    const approaching = advance(ordered, 1);
    assert.deepEqual(locate(approaching, patient), { kind: "node", node: destination });
    assert.notDeepEqual(locate(approaching, person), locate(approaching, patient));
    const pickedUp = advance(approaching, 3);
    assert.deepEqual(locate(pickedUp, person), { kind: "node", node: destination });
    assert.deepEqual(pickedUp.actors.patient.position, { kind: "carried", by: "porter" });
    const carrying = advance(pickedUp, 1);
    assert.deepEqual(locate(carrying, patient), locate(carrying, person));
    const delivered = advance(carrying, 5);
    assert.deepEqual(locate(delivered, patient), { kind: "node", node: "home:exit" });
    assert.equal(delivered.actors.patient.injured, true);
  });

  test(`${mode}: JSON round trips preserve remaining movement, the reserved payload and continuation`, () => {
    for (const payload of [furniture, patient]) {
      const ordered = issue(createState(mode), {
        kind: "carry", actor: "porter", payload, destination: "other:store",
      });
      const moving = advance(ordered, payload.kind === "actor" ? 5 : 1);
      const saved = JSON.parse(JSON.stringify(moving));
      assert.deepEqual(saved, moving);
      assert.ok(saved.actors.porter.task);
      assert.deepEqual(saved.actors.porter.task.payload, payload);
      assert.equal(saved.actors.porter.position.kind, "transit");
      assert.equal(saved.actors.porter.position.remaining, 1);
      assert.equal(saved.reservations[`${payload.kind}:${payload.id}`], "porter");
      assert.deepEqual(locate(saved, payload), locate(saved, person));
      assert.deepEqual(advance(saved, 30), advance(moving, 30));
    }
  });

  test(`${mode}: another base is reached only after the full journey, never on order or departure`, () => {
    const state = createState(mode);
    const carry: Intent = {
      kind: "carry", actor: "porter", payload: furniture, destination: "other:store",
    };
    assert.equal(plan(state, carry).minutes, 10);
    const ordered = issue(state, carry);
    assert.deepEqual(locate(ordered, furniture), { kind: "node", node: "home:store" });
    const onRoad = advance(ordered, 3);
    assert.notDeepEqual(locate(onRoad, furniture), { kind: "node", node: "other:store" });
    assert.deepEqual(locate(onRoad, furniture), locate(onRoad, person));
    const almost = advance(onRoad, 6);
    assert.notDeepEqual(locate(almost, furniture), { kind: "node", node: "other:store" });
    const arrived = advance(almost, 1);
    assert.deepEqual(locate(arrived, furniture), { kind: "node", node: "other:store" });
    assert.equal(arrived.actors.porter.task, null);
    assert.equal(arrived.time, 10);
  });
}
