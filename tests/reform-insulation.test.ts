import {
  createRoomInsulation,
  homeColdProtection,
} from "../src/reform/housing/insulation";
import assert from "node:assert/strict";
import test from "node:test";
import { advance, isGame, order } from "../src/reform/sim";
import {
  assignConstructionBuild,
  cancelRoomConstruction,
  releaseConstructionWorker,
  reserveConstructionMaterial,
} from "../src/reform/housing/construction";
import {
  base,
  building,
  hauling,
  one,
  two,
  ok,
  plan,
  planId,
  planned,
} from "./helpers/construction";
import { constructionStatus } from "../src/reform/housing/constructionPresentation";

test("one wood pays for a complete retrofit without issuing a room id", () => {
  const g = base(),
    request = { roomId: "bedroom", stagingCell: 2 };
  const project = ok(createRoomInsulation(g, request));
  assert.equal(project.time, g.time);
  assert.equal(project.wood, 6);
  assert.match(constructionStatus(project, planId).detail, /木材1/);
  const reserved = ok(reserveConstructionMaterial(project, planId));
  assert.equal(reserved.wood, 5);
  assert.equal(ok(cancelRoomConstruction(reserved, planId)).wood, 6);
  const delivered = advance(order(hauling(reserved), two, "work", "care"), 6);
  const working = ok(assignConstructionBuild(delivered, planId, one));
  const almost = advance(working, 29);
  assert.equal(homeColdProtection(almost, almost.actors[0]), null);
  const finished = advance(almost, 1);
  assert.equal(plan(finished).roomId, "bedroom");
  assert.deepEqual(finished.house, g.house);
  assert.equal(homeColdProtection(finished, finished.actors[0]), "room");
  assert.equal(homeColdProtection(finished, finished.actors[1]), null);
  assert.equal(isGame(finished), true);
  assert.deepEqual(advance(JSON.parse(JSON.stringify(almost)), 1), finished);
  for (const blocked of [planned(), finished, { ...g, insulated: true }])
    assert.ok(createRoomInsulation(blocked, request).error);
  for (const roomId of ["yard", "missing"])
    assert.ok(createRoomInsulation(g, { ...request, roomId }).error);
});

test("insulation consumes the plan's one reserved wood", () => {
  const game = planned();
  Object.assign(plan(game), { kind: "insulation", requiredWood: 1 });
  game.wood = 1;
  assert.equal(ok(reserveConstructionMaterial(game, planId)).wood, 0);
});

test("legacy unlocated residents with a prototype-named id do not receive room protection", () => {
  const g = JSON.parse(JSON.stringify(base("legacy", "constructor")));
  assert.equal(homeColdProtection(g, g.actors[0]), null);
  g.insulated = true;
  assert.equal(homeColdProtection(g, g.actors[0]), "whole-home");
});

function assertDrain(before: number, after: number, amount: number) {
  assert.ok(
    Math.abs(before - after - amount) < 1e-9,
    `${before - after} expected ${amount}`,
  );
}

test("the final work minute is exposed, then protection follows the source side of each crossing", () => {
  for (const body of ["ordinary", "cold"] as const) {
    const frostRate = body === "cold" ? 0.152 : 0.114;
    const g = base();
    g.actors[0].person.body = body;
    g.time = 1440 * 60 + 480;
    g.housing!.state.time = g.time;
    const project = ok(
      createRoomInsulation(g, { roomId: "bedroom", stagingCell: 2 }),
    );
    const stock = ok(reserveConstructionMaterial(project, planId));
    const delivered = advance(order(hauling(stock), two, "work", "care"), 6);
    const almost = advance(building(delivered), 29);
    let current = advance(almost, 1);
    assertDrain(
      almost.actors[0].needs.energy,
      current.actors[0].needs.energy,
      frostRate,
    );
    assert.equal(plan(current).status, "completed");
    const waited = advance(order(current, one, "wait"), 1);
    assertDrain(
      current.actors[0].needs.energy,
      waited.actors[0].needs.energy,
      0.095,
    );
    for (const roomId of ["living", "bedroom"]) {
      current = order(
        current,
        one,
        "home-move",
        JSON.stringify({ roomId, cell: 0 }),
      );
      assert.equal(current.actors[0].task?.kind, "home-move");
      for (let i = 0; current.actors[0].task && i < 20; i++) {
        const start = current;
        const position = start.housing!.state.actors[one].position;
        const point =
          position.kind === "transit"
            ? position.step.from
            : position.kind === "at"
              ? position.point
              : null;
        assert.ok(point);
        current = advance(start, 1);
        const moving =
          current.actors[0].metrics.travel > start.actors[0].metrics.travel;
        assertDrain(
          start.actors[0].needs.energy,
          current.actors[0].needs.energy,
          (point.domainId === '["room","bedroom"]' ? 0.095 : frostRate) *
            (moving ? 1.45 : 1),
        );
      }
      assert.equal(current.actors[0].task, null);
      assert.equal(
        homeColdProtection(current, current.actors[0]),
        roomId === "bedroom" ? "room" : null,
      );
    }
  }
});

test("whole-home shutters cover the yard, while an active regional departure is exposed", () => {
  const g = base();
  g.insulated = true;
  const atYard = order(
    g,
    one,
    "home-move",
    JSON.stringify({ roomId: "yard", cell: 0 }),
  );
  let arrived = atYard;
  for (
    let minute = 0;
    minute < 20 && arrived.actors[0].task?.kind === "home-move";
    minute++
  )
    arrived = advance(arrived, 1);
  assert.equal(arrived.actors[0].room, "yard");
  assert.equal(homeColdProtection(arrived, arrived.actors[0]), "whole-home");
  const travel = order(arrived, one, "travel", "mill");
  assert.equal(travel.actors[0].location, travel.home);
  assert.equal(homeColdProtection(travel, travel.actors[0]), null);
  travel.time = 1440 * 60 + 480;
  travel.housing!.state.time = travel.time;
  travel.actors[0].person.body = "ordinary";
  const tick = advance(travel, 1);
  assertDrain(
    travel.actors[0].needs.energy,
    tick.actors[0].needs.energy,
    0.114 * 1.45,
  );
});

test("a second installer resumes partial work, even if whole-home shutters finish first", () => {
  const p = ok(
    createRoomInsulation(base(), { roomId: "bedroom", stagingCell: 2 }),
  );
  const stock = ok(reserveConstructionMaterial(p, planId));
  const staged = advance(order(hauling(stock), two, "work", "care"), 6);
  const partial = advance(building(staged), 7);
  const released = ok(releaseConstructionWorker(partial, planId));
  released.insulated = true;
  const resumed = building(order(released, two, "cancel"), two);
  assert.equal(resumed.actors[1].task!.total, 23);
  const done = advance(resumed, 28);
  assert.equal(plan(done).status, "completed");
  assert.equal(homeColdProtection(done, done.actors[1]), "whole-home");
  assert.ok(isGame(done));
  const cancelled = ok(cancelRoomConstruction(released, planId));
  const returned = advance(hauling(cancelled, one, "return"), 8);
  assert.equal(plan(returned).material?.state, "returned");
  assert.equal(returned.wood, 6);
  assert.ok(isGame(returned));
});

test("before frost an exposed resident pays ordinary energy decay, and outside never gains shutters", () => {
  const game = base();
  const fresh = order(game, one, "wait");
  fresh.actors[0].person.body = "cold";
  const next = advance(fresh, 1);
  assertDrain(fresh.actors[0].needs.energy, next.actors[0].needs.energy, 0.095);
  const outside = next.actors[0];
  outside.location = "mill";
  next.insulated = true;
  assert.equal(homeColdProtection(next, outside), null);
});
