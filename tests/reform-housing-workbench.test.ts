import assert from "node:assert/strict";
import test from "node:test";
import { editHouse, furnishings } from "../src/reform/house";
import { housingStatus } from "../src/reform/housing/presentation";
import { applyHousingHouseEdit } from "../src/reform/housing/runtime";
import { housingLinkId, housingSlotId } from "../src/reform/housing/topology";
import { exportSlot, importSlot } from "../src/reform/library";
import { makePersona } from "../src/reform/peopleModel";
import {
  advance,
  createGame,
  enableHousing,
  inspectOrder,
  isGame,
  order,
  setHousingPassage,
  setHousingRoomAccess,
  type Game,
} from "../src/reform/sim";
import { defaultWorldConfig, generateWorld } from "../src/reform/world";

const people = [makePersona(0, 23), makePersona(1, 75)];
const [worker, other] = people.map((person) => person.id);
const room = "yard";
const fixtureId = "fixture-1";
const selection = { fixtureId };
const slotId = housingSlotId(room, fixtureId, 0);

function home(residents = 1) {
  return createGame(
    people.slice(0, residents),
    generateWorld(defaultWorldConfig()),
    "village",
  );
}

function withWorkbench(residents = 1) {
  const base = enableHousing(home(residents), "new");
  const house = editHouse(base.house, {
    type: "build",
    room,
    cell: 6,
    kind: "workbench",
  });
  const added = applyHousingHouseEdit(base, house);
  assert.equal(added.error, undefined);
  assert.equal(base.wood - added.game.wood, furnishings.workbench.cost);
  assert.ok(isGame(added.game));
  return added.game;
}

function roundTrip(game: Game, origin: Game) {
  const loaded = importSlot(
    exportSlot({ id: "woodworking", name: "木工", game, origin }),
  ).game;
  assert.deepEqual(loaded, game);
  return loaded;
}

test("basic woodworking still works in place in old and new homes, and explicit use adds only the walk", () => {
  const original = home();
  const installed = withWorkbench();
  for (const target of ["wood", "wood:easy"]) {
    for (const game of [original, enableHousing(original, "new"), installed]) {
      const preview = inspectOrder(game, worker, "work", target);
      assert.equal(preview.disabled, undefined);
      assert.equal(preview.facility, undefined);
      const inPlace = order(game, worker, "work", target);
      assert.equal(inPlace.actors[0].task?.station, undefined);
      assert.equal(inPlace.actors[0].task?.spatial, undefined);
      roundTrip(inPlace, game);
    }
    const before = structuredClone(installed);
    const current = inspectOrder(installed, worker, "work", target);
    const preview = inspectOrder(installed, worker, "work", target, selection);
    assert.equal(preview.disabled, undefined);
    assert.equal(preview.facility?.fixtureId, fixtureId);
    assert.equal(preview.facility?.fixtureKind, "workbench");
    assert.ok(preview.facility!.moveMinutes > 0);
    assert.equal(preview.facility!.useMinutes, current.minutes);
    assert.equal(
      preview.minutes,
      current.minutes! + preview.facility!.moveMinutes,
    );
    assert.deepEqual(installed, before);

    const active = order(installed, worker, "work", target, selection);
    assert.equal(active.time, installed.time);
    assert.deepEqual(active.actors[0].task?.reserved, {});
    assert.equal(active.actors[0].task?.station, slotId);
    assert.equal(active.actors[0].task?.target, target);
    assert.equal(active.wood, installed.wood);
    const done = advance(active, preview.minutes!);
    const inPlace = advance(
      order(installed, worker, "work", target),
      current.minutes!,
    );
    assert.ok(done.wood > installed.wood);
    assert.equal(done.wood, inPlace.wood);
    assert.equal(done.actors[0].xp.wood, inPlace.actors[0].xp.wood);
    assert.equal(done.actors[0].task, null);
    assert.deepEqual(done.housing!.state.reservations, {});
    assert.deepEqual(installed, before);
  }
});

test("ordering the bench once ends on the same floor and yields the same wood as an explicit walk followed by woodworking", () => {
  const origin = withWorkbench();
  const destination = origin.housing!.state.slots[slotId].point;
  const moveTarget = JSON.stringify({ roomId: room, cell: destination.cell });
  const walk = inspectOrder(origin, worker, "home-move", moveTarget);
  const preview = inspectOrder(origin, worker, "work", "wood", selection);
  assert.equal(walk.minutes, preview.facility?.moveMinutes);
  const arrived = advance(
    order(origin, worker, "home-move", moveTarget),
    walk.minutes!,
  );
  const ordinary = inspectOrder(arrived, worker, "work", "wood");
  const manual = advance(
    order(arrived, worker, "work", "wood"),
    ordinary.minutes!,
  );
  const combined = advance(
    order(origin, worker, "work", "wood", selection),
    preview.minutes!,
  );
  assert.equal(manual.actors[0].task, null);
  assert.equal(combined.actors[0].task, null);
  assert.equal(combined.wood, manual.wood);
  assert.equal(combined.actors[0].xp.wood, manual.actors[0].xp.wood);
  const position = { kind: "at", point: destination };
  assert.deepEqual(combined.housing!.state.actors[worker].position, position);
  assert.deepEqual(manual.housing!.state.actors[worker].position, position);
});

test("a chosen workbench obeys access, closed passages, recipe restrictions and single admission", () => {
  const origin = withWorkbench(2);
  const active = order(origin, other, "work", "wood", selection);
  assert.equal(active.actors[1].task?.station, slotId);
  for (const [blocked, reason] of [
    [setHousingRoomAccess(origin, room, []), /許可/],
    [
      setHousingPassage(origin, "link", housingLinkId("bedroom", room), false),
      /通路/,
    ],
    [active, /予約/],
  ] as const) {
    assert.match(
      inspectOrder(blocked, worker, "work", "wood", selection).disabled ?? "",
      reason,
    );
    assert.deepEqual(
      order(blocked, worker, "work", "wood", selection).actors,
      blocked.actors,
    );
    assert.equal(
      inspectOrder(blocked, worker, "work", "wood").disabled,
      undefined,
    );
  }
  for (const [kind, target, choice] of [
    ["work", "wood", { fixtureId: "bench-1" }],
    ["work", "wood", { fixtureId: "hearth-1" }],
    ["work", "wood", { ...selection, bundleId: "food-1" }],
    ["work", "cook", selection],
    ["work", "wood:hard", selection],
    ["work", "wood:master", selection],
    ["home-use", fixtureId, undefined],
  ] as const) {
    assert.ok(inspectOrder(active, other, kind, target, choice).disabled);
    assert.deepEqual(
      order(active, other, kind, target, choice).actors,
      active.actors,
    );
  }
  assert.equal(
    inspectOrder(origin, worker, "home-use", "bench-1").disabled,
    undefined,
  );
  assert.ok(inspectOrder(home(), worker, "work", "wood", selection).disabled);
  const trip = order(origin, worker, "travel", "landing");
  const away = advance(trip, trip.actors[0].task!.remaining);
  assert.equal(away.actors[0].location, "landing");
  assert.ok(inspectOrder(away, worker, "work", "wood", selection).disabled);
  assert.equal(inspectOrder(away, worker, "work", "wood").disabled, undefined);
});

test("construction is paid, and a reserved bench cannot be removed until the worker releases it", () => {
  const base = enableHousing(home(), "new");
  const house = editHouse(base.house, {
    type: "build",
    room,
    kind: "workbench",
    cell: 6,
  });
  const poor = { ...base, wood: furnishings.workbench.cost - 1 };
  const denied = applyHousingHouseEdit(poor, house);
  assert.ok(denied.error);
  assert.equal(denied.game, poor);
  const installed = withWorkbench();
  const active = order(installed, worker, "work", "wood", selection);
  const removed = editHouse(installed.house, { type: "remove", id: fixtureId });
  assert.ok(applyHousingHouseEdit(active, removed).error);
  const idle = order(active, worker, "cancel");
  const removal = applyHousingHouseEdit(idle, removed);
  assert.equal(removal.error, undefined);
  assert.equal(removal.game.wood, installed.wood);
});

test("walking, working and safe cancellation survive a save without duplicate output", () => {
  const origin = withWorkbench();
  const active = order(origin, worker, "work", "wood", selection);
  const preview = inspectOrder(origin, worker, "work", "wood", selection);
  const duration = preview.minutes!;
  const walking = advance(active, 1);
  assert.equal(walking.housing!.state.actors[worker].position.kind, "transit");
  const using = advance(active, preview.facility!.moveMinutes + 1);
  assert.equal(housingStatus(using, worker).phase, "use");
  const last = advance(active, duration - 1);
  assert.equal(last.wood, origin.wood);
  const done = advance(last, 1);
  for (const checkpoint of [walking, using, last]) {
    const remaining = origin.time + duration - checkpoint.time;
    assert.deepEqual(advance(roundTrip(checkpoint, origin), remaining), done);
  }

  const cancelling = order(walking, worker, "cancel");
  assert.equal(housingStatus(cancelling, worker).phase, "cancelling");
  let cancelled = roundTrip(cancelling, origin);
  while (cancelled.actors[0].task && cancelled.time < walking.time + 10)
    cancelled = advance(cancelled, 1);
  assert.equal(cancelled.actors[0].task, null);
  assert.deepEqual(cancelled.housing!.state.reservations, {});
  assert.equal(cancelled.wood, origin.wood);
  const replaced = order(using, worker, "work", "cook", {
    fixtureId: "hearth-1",
  });
  assert.equal(replaced.actors[0].task?.target, "cook");
  assert.equal(replaced.wood, origin.wood);
  assert.equal(replaced.ingredients, origin.ingredients - 2);
  const returned = order(roundTrip(replaced, origin), worker, "cancel");
  assert.equal(returned.ingredients, origin.ingredients);
  assert.equal(returned.wood, origin.wood);
  assert.deepEqual(returned.housing!.state.reservations, {});
});

test("import validation rejects mismatched fixture, recipe, material or social bindings", () => {
  const origin = withWorkbench();
  const active = order(origin, worker, "work", "wood", selection);
  assert.ok(isGame(active));
  for (const patch of [
    { target: "cook" },
    { target: "wood:hard" },
    { kind: "need", target: "wood" },
    { reserved: { wood: 1 } },
    { spatial: { ...active.actors[0].task!.spatial!, foodBundleId: "food-1" } },
    { spatial: { ...active.actors[0].task!.spatial!, mealPartners: {} } },
  ]) {
    const forged = structuredClone(active);
    Object.assign(forged.actors[0].task!, patch);
    assert.equal(isGame(forged), false);
  }
  const atHearth = order(origin, worker, "work", "cook", {
    fixtureId: "hearth-1",
  });
  atHearth.actors[0].task!.target = "wood";
  atHearth.actors[0].task!.reserved = {};
  assert.equal(isGame(atHearth), false);
});

test("a stock filled during woodworking leaves the completed save readable and grants no wood or experience", () => {
  const origin = withWorkbench();
  for (const choice of [undefined, selection]) {
    const duration = inspectOrder(
      origin,
      worker,
      "work",
      "wood",
      choice,
    ).minutes!;
    const active = order(origin, worker, "work", "wood", choice);
    const last = advance(active, duration - 1);
    last.wood = 1_000_000_000;
    const result = advance(roundTrip(last, origin), 1);
    assert.equal(result.actors[0].task, null);
    assert.equal(result.wood, last.wood);
    assert.equal(result.actors[0].xp.wood, last.actors[0].xp.wood);
    assert.equal(result.actors[0].experience, last.actors[0].experience);
    assert.deepEqual(result.housing!.state.reservations, {});
    roundTrip(result, origin);
  }
});
