// node --import tsx scripts/compare-room-size.mts
// Compare a single 4x4 project with a 4x3 project followed by a row addition
// from the same synthetic morning. Exercise real planning, hauling, and work.
import assert from "node:assert/strict";
import { applyHousingHouseEdit } from "../src/reform/housing/runtime.ts";
import {
  createRoomConstruction,
  reserveConstructionMaterial,
  assignConstructionHaul,
  assignConstructionBuild,
} from "../src/reform/housing/construction.ts";
import type { ConstructionResult } from "../src/reform/housing/constructionTypes.ts";
import { editHouse, initialHouse } from "../src/reform/house.ts";
import { makePersona } from "../src/reform/peopleModel.ts";
import { defaultWorldConfig, generateWorld } from "../src/reform/world.ts";
import { housingPoint } from "../src/reform/housing/topology.ts";
import { constructionFloor } from "../src/reform/housing/constructionTopology.ts";
import { importSlot, exportSlot } from "../src/reform/library.ts";
import {
  createGame,
  enableHousing,
  advance,
  order,
  inspectOrder,
  isGame,
  type Game,
} from "../src/reform/sim.ts";

const origin = enableHousing(
  createGame(
    [makePersona(0, 4)],
    generateWorld(defaultWorldConfig()),
    "forest",
    initialHouse(),
  ),
  "new",
);
const worker = origin.actors[0].person.id;
function ok(r: ConstructionResult) {
  assert.equal(r.error, undefined);
  assert.ok(isGame(r.game));
  return r.game;
}
const planRequest = {
  name: "作業と休息の部屋",
  neighborId: "bedroom",
  stagingCell: 2,
};
const serialize = (game: Game) =>
  exportSlot({
    id: "test-room-size",
    name: "検証専用・一室の規模",
    origin,
    game,
  });
const load = (g: Game) => importSlot(serialize(g)).game;
function buildRoom(height?: 4) {
  const p = createRoomConstruction(origin, {
    ...planRequest,
    ...(height && { height }),
  });
  const planned = ok(p);
  const id = p.planId!;
  const reserved = ok(reserveConstructionMaterial(planned, id));
  const assignHaul = (game: Game) =>
    ok(assignConstructionHaul(game, id, worker, "deliver"));
  const assigned = assignHaul(reserved);
  function deliver(g: Game) {
    const limit = g.time + 90;
    while (g.housing!.construction!.plans[id].assignment) {
      assert.ok(g.time < limit);
      g = advance(g, 1);
    }
    return g;
  }
  const delivered = deliver(assigned);
  const startBuilding = (game: Game) =>
    ok(assignConstructionBuild(game, id, worker));
  const mid = advance(startBuilding(delivered), 12);
  const paidWood = origin.wood - reserved.wood;
  assert.equal(paidWood, height ? 10 : 6);
  const plan = mid.housing!.construction!.plans[id];
  assert.equal(plan.workedMinutes, 12);
  assert.equal(plan.requiredWood, paidWood);
  assert.equal(plan.material?.quantity, paidWood);
  assert.equal(mid.house.rooms.length, origin.house.rooms.length);
  assert.equal(mid.wood, origin.wood - paidWood);
  const built = advance(mid, 18);
  assert.ok(isGame(built));
  const completed = built.housing!.construction!.plans[id];
  assert.equal(completed.status, "completed");
  assert.equal(completed.material?.state, "consumed");
  assert.equal(completed.height, height);
  const room = built.house.rooms.find((r) => r.id === completed.roomId)!;
  assert.equal(room.height, height ?? 3);
  const replays = [
    advance(startBuilding(deliver(assignHaul(load(reserved)))), 30),
    advance(startBuilding(deliver(load(assigned))), 30),
    advance(load(mid), 18),
  ];
  for (const replay of replays)
    assert.equal(serialize(replay), serialize(built));
  return {
    built,
    id,
    mid,
    room: room.id,
    results: {
      commands: ["plan", "reserve", "haul", "build"],
      wood: paidWood,
      haul: delivered.time - assigned.time,
      labor: built.time - delivered.time,
      finish: built.time,
      size: room.width * room.height,
      independentlyReplayed: replays.length,
    },
  };
}
const standard = buildRoom();
const spacious = buildRoom(4);
const { built, room, mid, id } = standard;
const editor = (g: Game, action: Parameters<typeof editHouse>[1]) =>
  ok(applyHousingHouseEdit(g, editHouse(g.house, action)));
const expand = (g: Game) => editor(g, { type: "expand", room });
const larger = expand(built);
assert.equal(larger.wood, built.wood - 4);
assert.equal(larger.time, built.time);
assert.equal(larger.house.nextId, built.house.nextId);
assert.equal(larger.house.rooms.find((r) => r.id === room)!.height, 4);
assert.equal(serialize(expand(load(built))), serialize(larger));
assert.deepEqual(larger.house, spacious.built.house);
assert.deepEqual(larger.housing!.state, spacious.built.housing!.state);
assert.deepEqual(larger.actors, spacious.built.actors);
for (const key of ["wood", "ingredients", "food", "coins", "time"] as const)
  assert.equal(larger[key], spacious.built[key], key);
assert.equal(serialize(load(spacious.built)), serialize(spacious.built));

function furnished(g: Game) {
  for (const [id, cell] of [
    ["hearth-1", 3],
    ["bench-1", 7],
    ["mat-1", 11],
  ] as const)
    g = editor(g, { type: "move", id, room, cell });
  return g;
}
function compare(g: Game, cell: number) {
  const floorCount = Array.from({ length: 16 }, (_, cell) =>
    constructionFloor(g.housing!, housingPoint(room, cell)),
  ).filter(Boolean).length;
  const g0 = furnished(g);
  const candidates = Array.from({ length: 16 }, (_, i) => i).filter((i) => {
    try {
      editHouse(g0.house, { type: "build", kind: "workbench", room, cell: i });
      return true;
    } catch {
      return false;
    }
  });
  if (!candidates.includes(cell))
    return { floorCount, candidates, cell, available: false };
  const placed = editor(g0, { type: "build", kind: "workbench", room, cell });
  const station = placed.house.rooms
    .find((r) => r.id === room)!
    .fixtures.find((f) => f.kind === "workbench")!.id;
  const request = { fixtureId: station };
  const forecast = inspectOrder(placed, worker, "work", "wood", request);
  assert.equal(forecast.disabled, undefined);
  const current = order(placed, worker, "work", "wood", request);
  const end = advance(current, forecast.minutes!);
  assert.equal(end.actors[0].task, null);
  assert.ok(end.wood > placed.wood);
  assert.ok(isGame(end));
  return {
    floorCount,
    candidates,
    cell,
    available: true,
    benchCost: g.wood - placed.wood,
    route: forecast.facility!.moveMinutes,
    work: forecast.facility!.useMinutes,
    woodYield: end.wood - placed.wood,
  };
}
const insufficient = structuredClone(built);
insufficient.wood = 3;
const noWood = applyHousingHouseEdit(
  insufficient,
  editHouse(insufficient.house, { type: "expand", room }),
);
assert.ok(noWood.error);
assert.equal(noWood.game, insufficient);
const tampered = structuredClone(mid);
tampered.housing!.construction!.plans[id].requiredWood = 10;
assert.equal(isGame(tampered), false);
const runs = [9, 10, 15].map((cell) => {
  const standardRoom = compare(built, cell);
  const expandedRoom = compare(larger, cell);
  const plannedRoom = compare(spacious.built, cell);
  assert.deepEqual(expandedRoom, plannedRoom);
  assert.equal(standardRoom.floorCount, 12);
  assert.equal(plannedRoom.floorCount, 16);
  assert.equal(standardRoom.candidates.length, 5);
  assert.equal(plannedRoom.candidates.length, 10);
  return { cell, standardRoom, expandedRoom, plannedRoom };
});
console.log(
  JSON.stringify(
    {
      startWood: origin.wood,
      build: standard.results,
      extraRow: {
        commands: 1,
        wood: built.wood - larger.wood,
        minutes: larger.time - built.time,
        totalWood: origin.wood - larger.wood,
        totalCommands: standard.results.commands.length + 1,
        completedSaveReplay: true,
        shortage: noWood.error,
      },
      singleLargePlan: spacious.results,
      runs,
    },
    null,
    2,
  ),
);
