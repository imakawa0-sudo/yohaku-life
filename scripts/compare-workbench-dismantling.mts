// node --import tsx scripts/compare-workbench-dismantling.mts
// Compare three existing alternatives and physical recovery from identical
// mornings. Keep the earlier 15-minute research estimate separate.
import assert from "node:assert/strict";
import { initialHouse, editHouse } from "../src/reform/house.ts";
import { applyHousingHouseEdit } from "../src/reform/housing/runtime.ts";
import {
  housingSlotId,
  housingPoint,
  housingRoomId,
} from "../src/reform/housing/topology.ts";
import {
  startBenchRecovery,
  returnBenchBoard,
  inspectBenchRecovery,
  inspectBenchReturn,
} from "../src/reform/housing/benchRecovery.ts";
import { constructionFloor } from "../src/reform/housing/constructionTopology.ts";
import {
  createRoomConstruction,
  reserveConstructionMaterial,
  assignConstructionHaul,
  assignConstructionBuild,
} from "../src/reform/housing/construction.ts";
import {
  createGame,
  enableHousing,
  advance,
  order,
  inspectOrder,
  isGame,
  type Game,
} from "../src/reform/sim.ts";
import { makePersona } from "../src/reform/peopleModel.ts";
import { defaultWorldConfig, generateWorld } from "../src/reform/world.ts";
import { exportSlot, importSlot } from "../src/reform/library.ts";
import type { ConstructionResult } from "../src/reform/housing/constructionTypes.ts";

const id = "person-1",
  cell = 6,
  bench = "fixture-1";
function ok(r: ConstructionResult) {
  assert.equal(r.error, undefined);
  assert.ok(isGame(r.game));
  return r.game;
}
type Edit = Parameters<typeof editHouse>[1];
const edit = (g: Game, e: Edit) =>
  ok(applyHousingHouseEdit(g, editHouse(g.house, e)));
const serialize = (g: Game, origin: Game) =>
  exportSlot({
    id: "bench-investment",
    name: "検証専用・工房と増築",
    game: g,
    origin,
  });
function fixture(wood: number, location: string, room: string, skill: number) {
  const person = makePersona(0, 4);
  person.skills.wood = skill;
  const g = enableHousing(
    createGame(
      [person],
      generateWorld(defaultWorldConfig()),
      location,
      initialHouse(),
    ),
    "new",
  );
  g.wood = wood + 3;
  const paid = edit(g, { type: "build", room, cell, kind: "workbench" });
  assert.equal(paid.wood, wood);
  return paid;
}
function work(g: Game, onBench: boolean) {
  const selected = onBench ? { fixtureId: bench } : undefined;
  const p = inspectOrder(g, id, "work", "wood", selected);
  assert.equal(p.disabled, undefined);
  const done = advance(order(g, id, "work", "wood", selected), p.minutes!);
  assert.equal(done.actors[0].task, null);
  return done;
}
function walkTo(g: Game, room: string, cell: number) {
  const before = g.housing!.state.actors[id].position;
  if (
    before.kind === "at" &&
    housingRoomId(before.point.domainId) === room &&
    before.point.cell === cell
  )
    return g;
  const target = JSON.stringify({ roomId: room, cell });
  const p = inspectOrder(g, id, "home-move", target);
  assert.equal(p.disabled, undefined);
  const done = advance(order(g, id, "home-move", target), p.minutes!);
  assert.equal(done.actors[0].task, null);
  return done;
}
function until(g: Game, done: (g: Game) => boolean) {
  const limit = g.time + 200;
  while (!done(g)) {
    assert.ok(g.time < limit);
    g = advance(g, 1);
  }
  return g;
}
function complete(g: Game, p: string) {
  const r = ok(reserveConstructionMaterial(g, p));
  const hauled = ok(assignConstructionHaul(r, p, id, "deliver"));
  const delivered = until(
    hauled,
    (g) => !g.housing!.construction!.plans[p].assignment,
  );
  const building = ok(assignConstructionBuild(delivered, p, id));
  return until(
    building,
    (g) => g.housing!.construction!.plans[p].status === "completed",
  );
}
function recover(planned: Game, origin: Game, p: string) {
  const wood = planned.wood;
  const load = (g: Game) => importSlot(serialize(g, origin)).game;
  const remainingBench = (g: Game) =>
    g.house.rooms.some((room) => room.fixtures.some((f) => f.id === bench));
  const first = inspectBenchRecovery(planned, bench, id);
  assert.ok(first.ok, first.disabled);
  const started = ok(startBenchRecovery(planned, bench, id));
  assert.equal(started.time, planned.time);
  let g = started;
  let midWork: Game | undefined;
  while (remainingBench(g)) {
    assert.ok(g.time - started.time < 120);
    assert.equal(g.wood, wood);
    g = advance(g, 1);
    if (
      !midWork &&
      g.actors[0].metrics.work - started.actors[0].metrics.work === 5
    )
      midWork = g;
  }
  const board = g;
  const items = Object.values(g.housing!.state.items);
  assert.equal(items.length, 1);
  const itemId = items[0].id,
    boardPosition = items[0].position;
  assert.equal(boardPosition.kind, "at");
  assert.equal(boardPosition.point.cell, cell);
  assert.equal(board.actors[0].task, null);
  assert.equal(g.wood, wood);
  assert.ok(reserveConstructionMaterial(board, p).error);
  assert.ok(midWork);
  assert.equal(board.time - started.time, first.minutes);
  const second = inspectBenchReturn(board, bench, id);
  assert.ok(second.ok, second.disabled);
  const returning = ok(returnBenchBoard(board, bench, id));
  assert.equal(returning.time, board.time);
  let carried: Game | undefined;
  g = returning;
  // The single recoverable board stays outside shared stock throughout its
  // trip. The first minute wood can be reserved must be its regulated delivery.
  while (g.wood === wood) {
    assert.ok(g.time - returning.time < 120);
    assert.equal(g.actors[0].cargo.wood, 0);
    assert.ok(reserveConstructionMaterial(g, p).error);
    g = advance(g, 1);
    if (!carried && g.housing!.state.items[itemId]?.position.kind === "carried")
      carried = g;
  }
  assert.ok(carried);
  const ready = g;
  assert.deepEqual(ready.housing!.state.actors[id].position, {
    kind: "at",
    point: housingPoint("living", 0),
  });
  assert.equal(
    board.actors[0].metrics.work - started.actors[0].metrics.work,
    15,
  );
  assert.equal(ready.wood, wood + 1);
  assert.equal(ready.housing!.state.items[itemId], undefined);
  assert.equal(ready.actors[0].task, null);
  assert.equal(ready.time - returning.time, second.minutes);
  assert.equal(ok(reserveConstructionMaterial(ready, p)).wood, 0);

  // Repeat only the remaining game commands and actual ticks from each saved
  // checkpoint; compare the complete game, including RNG and active orders.
  const workReplay = advance(load(midWork), board.time - midWork.time);
  assert.equal(serialize(workReplay, origin), serialize(board, origin));
  for (const checkpoint of [returning, carried]) {
    const replay = advance(load(checkpoint), ready.time - checkpoint.time);
    assert.equal(serialize(replay, origin), serialize(ready, origin));
  }
  const boardReplay = ok(returnBenchBoard(load(board), bench, id));
  assert.equal(
    serialize(advance(boardReplay, ready.time - board.time), origin),
    serialize(ready, origin),
  );
  assert.equal(
    serialize(complete(load(ready), p), origin),
    serialize(complete(ready, p), origin),
  );
  return {
    ready,
    results: {
      walkToBench:
        board.actors[0].metrics.travel - started.actors[0].metrics.travel,
      workAtBench:
        board.actors[0].metrics.work - started.actors[0].metrics.work,
      boardAt: board.time - origin.time,
      boardPosition: boardPosition.point,
      beforePickup: carried.time - returning.time,
      carryingToSource: ready.time - carried.time,
      returnDuration: ready.time - returning.time,
      woodAtBoardCreation: board.wood,
      woodOnPickup: carried.wood,
      woodAtSupply: ready.wood,
      physicalWoodReclaimed: ready.wood - wood,
      saveContinuations: 5,
    },
  };
}

function run(cost: 6 | 10, room: string, home: string, skill: number) {
  const origin = fixture(cost - 1, home, room, skill);
  const project = createRoomConstruction(origin, {
    name: "新しい一室",
    neighborId: "bedroom",
    stagingCell: 2,
    ...(cost === 10 && { height: 4 as const }),
  });
  const planned = ok(project),
    p = project.planId!;
  assert.ok(reserveConstructionMaterial(planned, p).error);
  const originSave = serialize(planned, origin);
  const start = () => importSlot(originSave).game;
  const dropped: Edit = { type: "remove", id: bench };
  const benchPoint =
    planned.housing!.state.slots[housingSlotId(room, bench, 0)].point;
  function measure(choice: string, g: Game) {
    assert.ok(isGame(g));
    const finished = complete(g, p);
    assert.equal(finished.wood, g.wood - cost);
    assert.equal(finished.actors[0].cargo.wood, 0);
    assert.ok(isGame(finished));
    const hasBench = finished.house.rooms.some((r) =>
      r.fixtures.some((f) => f.id === bench),
    );
    return {
      choice,
      materialReady: g.time - origin.time,
      extensionDone: finished.time - origin.time,
      woodLeft: finished.wood,
      retainsPaidBench: hasBench,
      oldFloorFree: constructionFloor(finished.housing!, {
        domainId: benchPoint.domainId,
        cell,
      }),
    };
  }
  const onsite = measure("normal work at existing bench", work(start(), true));
  const discarded = measure(
    "instant discard; work in place",
    work(edit(start(), dropped), false),
  );
  const preserved = measure(
    "free intact relocation; work in place",
    work(
      edit(start(), { type: "move", id: bench, room: "bedroom", cell: 7 }),
      false,
    ),
  );
  const moved = walkTo(start(), room, benchPoint.cell);
  const walkIn = moved.time - planned.time;
  // The earlier design estimate used the real walking path to the use floor
  // and back, plus assumed handling and dismantling time. No stock is credited
  // by this calculation. The matched in-place control supplies the duration
  // of funded construction from the living-room source.
  const labor = 15,
    pickup = 1,
    drop = 1;
  const returned = walkTo(edit(moved, dropped), "living", 0);
  const walkBack = returned.time - moved.time;
  const projectedReady = walkIn + labor + pickup + walkBack + drop;
  const hypothetical = {
    approach: walkIn,
    labor,
    pickup,
    returnWalk: walkBack,
    drop,
    materialReady: projectedReady,
    extensionDone:
      projectedReady + discarded.extensionDone - discarded.materialReady,
    reclaimed: 1,
  };
  const actual = recover(start(), origin, p);
  const recovery = {
    ...measure(
      "actual workbench dismantling and physical board return",
      actual.ready,
    ),
    ...actual.results,
  };
  return {
    cost,
    stock: cost - 1,
    room,
    home,
    skill,
    benchPoint,
    walkIn,
    walkBack,
    breakEvenLaborVsInPlace:
      discarded.materialReady - walkIn - walkBack - pickup - drop,
    normal: [onsite, discarded, preserved],
    hypothetical,
    recovery,
    actualMinusProjectedMinutes: {
      materialReady: recovery.materialReady - hypothetical.materialReady,
      extensionDone: recovery.extensionDone - hypothetical.extensionDone,
    },
  };
}
const runs = ([6, 10] as const).flatMap((cost) =>
  ["living", "yard"].flatMap((room) =>
    ["village", "forest"].flatMap((home) =>
      [1, 4].map((skill) => run(cost, room, home, skill)),
    ),
  ),
);
const awayStart = fixture(5, "forest", "living", 4);
const travel = inspectOrder(awayStart, id, "travel", "mill");
assert.equal(travel.disabled, undefined);
const away = advance(order(awayStart, id, "travel", "mill"), travel.minutes!);
assert.equal(away.actors[0].location, "mill");
const awayWork = work(away, false);
assert.equal(awayWork.wood, away.wood);
assert.ok(awayWork.actors[0].cargo.wood > away.actors[0].cargo.wood);
console.log(
  JSON.stringify(
    {
      hypothesis:
        "Prior research estimate: 15 minutes at the workbench, recover one of three wood, 1 minute pickup and drop each. Projected arrival and extension completion are distinct from the measured recovery.",
      runs,
      awayWorker: {
        jobMinutes: awayWork.time - away.time,
        homeWood: awayWork.wood,
        cargoWood: awayWork.actors[0].cargo.wood,
      },
    },
    null,
    2,
  ),
);
