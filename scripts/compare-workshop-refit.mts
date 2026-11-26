// node --import tsx scripts/compare-workshop-refit.mts
// Relocate, retire, or replace the same paid-for woodbench. No player saves.
import assert from "node:assert/strict";
import { editHouse, initialHouse } from "../src/reform/house.ts";
import { applyHousingHouseEdit } from "../src/reform/housing/runtime.ts";
import {
  getBedSleeper,
  setBedSleeper,
  getPreferredBed,
  setPreferredBed,
} from "../src/reform/housing/bedPreference.ts";
import { setFoodSupply } from "../src/reform/housing/foodSupply.ts";
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
import { generateWorld, defaultWorldConfig } from "../src/reform/world.ts";
import { exportSlot, importSlot } from "../src/reform/library.ts";
const base = enableHousing(
  createGame(
    [makePersona(0, 4)],
    generateWorld(defaultWorldConfig()),
    "forest",
    initialHouse(),
  ),
  "new",
);
base.wood = 6;
const id = base.actors[0].person.id,
  from = "living",
  to = "bedroom",
  startCell = 6,
  targetCell = 7;
type Edit = Parameters<typeof editHouse>[1];
const apply = (g: Game, e: Edit) =>
  applyHousingHouseEdit(g, editHouse(g.house, e));
function edit(g: Game, e: Edit) {
  const r = apply(g, e);
  assert.equal(r.error, undefined);
  assert.ok(isGame(r.game));
  return r.game;
}
const morning = edit(base, {
  type: "build",
  room: from,
  cell: startCell,
  kind: "workbench",
});
const bench = morning.house.rooms
  .find((r) => r.id === from)!
  .fixtures.find((f) => f.kind === "workbench")!.id;
const save = (game: Game) =>
  exportSlot({ id: "refit", name: "検証専用・工房", game, origin: base });
const load = (g: Game) => importSlot(save(g)).game;
function locate(g: Game) {
  for (const room of g.house.rooms)
    for (const f of room.fixtures)
      if (f.kind === "workbench")
        return { room: room.id, cell: f.cell, fixture: f.id };
  return null;
}
const pickup: Edit = { type: "remove", id: bench },
  auto: Edit = { type: "move", id: bench, room: to },
  exact: Edit = { ...auto, cell: targetCell };
const local = edit(morning, { type: "move", id: bench, room: from, cell: 9 });
const autoPlaced = edit(morning, auto),
  afterAdjust = edit(autoPlaced, exact);
const direct = edit(morning, exact);
assert.equal(base.wood - morning.wood, 3);
assert.deepEqual(locate(direct), {
  room: to,
  cell: targetCell,
  fixture: bench,
});
assert.deepEqual(locate(afterAdjust), locate(direct));
for (const moved of [local, autoPlaced, afterAdjust, direct]) {
  assert.equal(moved.house.nextId, morning.house.nextId);
  assert.equal(moved.time, morning.time);
  assert.equal(moved.wood, morning.wood);
  assert.equal(locate(moved)?.fixture, bench);
}
assert.deepEqual(afterAdjust.house, direct.house);
assert.equal(afterAdjust.wood, direct.wood);
const removed = edit(morning, pickup);
const rebuilt = edit(removed, {
  type: "build",
  kind: "workbench",
  room: to,
  cell: targetCell,
});
assert.equal(removed.wood, morning.wood);
assert.equal(locate(removed), null);
assert.notEqual(locate(rebuilt)?.fixture, bench);
assert.equal(locate(rebuilt)?.cell, targetCell);
assert.equal(rebuilt.wood, morning.wood - 3);
const repurposed = edit(removed, {
  type: "build",
  kind: "mat",
  room: from,
  cell: startCell,
});
assert.ok(
  repurposed.house.rooms
    .find((r) => r.id === from)!
    .fixtures.some((f) => f.kind === "mat" && f.cell === startCell),
);
const summarize = (g: Game) => ({
  location: locate(g),
  wood: g.wood,
  minutes: g.time - morning.time,
  nextId: g.house.nextId,
  stockItems: Object.keys(g.housing!.state.items).length,
});
const requested = order(morning, id, "work", "wood", { fixtureId: bench });
const halfway = advance(requested, 10);
const guarded = [requested, halfway].map((g) =>
  [pickup, auto, exact].map((e) => {
    const r = apply(g, e);
    assert.ok(r.error);
    assert.equal(r.game, g);
    return r.error!;
  }),
);
const duration = inspectOrder(morning, id, "work", "wood", {
  fixtureId: bench,
}).minutes!;
const afterWork = advance(halfway, duration - 10);
assert.equal(afterWork.actors[0].task, null);
assert.equal(save(afterWork), save(advance(load(halfway), duration - 10)));
const released = edit(afterWork, auto);
assert.equal(released.wood, afterWork.wood);
const storageCell = locate(autoPlaced)!.cell;
const policy = setFoodSupply(morning, { actorId: id, roomId: to, storageCell });
assert.equal(policy.error, undefined);
const rejected = apply(policy.game, auto);
assert.ok(rejected.error);
assert.equal(rejected.game, policy.game);
const compatible = edit(policy.game, exact);
assert.deepEqual(
  compatible.housing!.foodSupply,
  policy.game.housing!.foodSupply,
);
assert.equal(compatible.wood, policy.game.wood);
assert.equal(compatible.time, policy.game.time);
assert.deepEqual(locate(compatible), {
  room: to,
  cell: targetCell,
  fixture: bench,
});
assert.notEqual(storageCell, targetCell);
assert.deepEqual(locate(load(compatible)), locate(compatible));

const matId = "mat-1";
const assigned = setPreferredBed(setBedSleeper(morning, matId, id), id, matId);
const movedMat = load(
  edit(assigned, { type: "move", id: matId, room: "yard", cell: 6 }),
);
assert.equal(getBedSleeper(movedMat, matId), id);
assert.equal(getPreferredBed(movedMat, id), matId);
const rest = inspectOrder(movedMat, id, "need", "energy").facility!;
assert.equal(rest.fixtureId, matId);
assert.equal(rest.roomId, "yard");
assert.equal(rest.fixtureCell, 6);
assert.equal(rest.bedPreference?.outcome, "preferred");
assert.equal(movedMat.time, assigned.time);
assert.equal(movedMat.wood, assigned.wood);
function scarcity(skill: number) {
  const g = load(morning);
  g.wood = 0;
  g.actors[0].person.skills.wood = skill;
  const cleared = edit(g, pickup);
  assert.equal(cleared.wood, 0);
  assert.equal(Object.keys(cleared.housing!.state.items).length, 0);
  const mat: Edit = { type: "build", room: from, cell: startCell, kind: "mat" };
  const shortage = apply(cleared, mat);
  assert.ok(shortage.error);
  assert.equal(shortage.game, cleared);
  const plan = inspectOrder(cleared, id, "work", "wood");
  const earn = advance(order(cleared, id, "work", "wood"), plan.minutes!);
  const result = edit(earn, mat);
  return {
    skill,
    shortage: shortage.error,
    workMinutes: plan.minutes,
    newWood: earn.wood,
    woodAfterMat: result.wood,
  };
}
console.log(
  JSON.stringify(
    {
      morning: summarize(morning),
      sameRoom: summarize(local),
      autoCrossRoom: summarize(autoPlaced),
      autoThenCell: summarize(afterAdjust),
      specificCrossRoom: summarize(direct),
      assignedMat: {
        id: matId,
        sleeper: getBedSleeper(movedMat, matId),
        preferred: getPreferredBed(movedMat, id),
        room: rest.roomId,
        cell: rest.fixtureCell,
      },
      removed: summarize(removed),
      rebuilt: summarize(rebuilt),
      repurposed: summarize(repurposed),
      work: {
        guarded,
        duration,
        yield: afterWork.wood - morning.wood,
        released: summarize(released),
      },
      protectedDefault: {
        storageCell,
        automaticError: rejected.error,
        specificCell: summarize(compatible),
      },
      noSpareStock: [scarcity(1), scarcity(4)],
    },
    null,
    2,
  ),
);
