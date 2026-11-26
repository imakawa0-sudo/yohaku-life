// node --import tsx scripts/compare-blueprint-revision.mts
// H2: current alternatives after an unfunded wide plan. No player saves.
import assert from "node:assert/strict";
import { applyHousingHouseEdit } from "../src/reform/housing/runtime.ts";
import { initialHouse, editHouse } from "../src/reform/house.ts";
import {
  createRoomConstruction,
  reviseRoomConstruction,
  reserveConstructionMaterial,
  assignConstructionHaul,
  assignConstructionBuild,
  cancelRoomConstruction,
} from "../src/reform/housing/construction.ts";
import type {
  ConstructionRequest,
  ConstructionResult,
} from "../src/reform/housing/constructionTypes.ts";
import { makePersona } from "../src/reform/peopleModel.ts";
import { defaultWorldConfig, generateWorld } from "../src/reform/world.ts";
import {
  advance,
  enableHousing,
  createGame,
  isGame,
  order,
  inspectOrder,
  type Game,
} from "../src/reform/sim.ts";
import { exportSlot, importSlot } from "../src/reform/library.ts";
const standard = { name: "作業室", neighborId: "bedroom", stagingCell: 2 },
  wide = { ...standard, height: 4 as const };
const start = enableHousing(
  createGame(
    [makePersona(0, 4)],
    generateWorld(defaultWorldConfig()),
    "forest",
    initialHouse(),
  ),
  "new",
);
start.wood = 9; // controlled morning stock; same amount and worker in every branch
const worker = start.actors[0].person.id;
const save = (game: Game) =>
  exportSlot({
    id: "blueprint-study",
    name: "検証専用・増築計画",
    origin: start,
    game,
  });
const load = (g: Game) => importSlot(save(g)).game;
function ok(r: ConstructionResult) {
  assert.equal(r.error, undefined);
  assert.ok(isGame(r.game));
  return r.game;
}
function until(g: Game, done: (g: Game) => boolean) {
  const deadline = g.time + 180;
  while (!done(g)) {
    assert.ok(g.time < deadline);
    g = advance(g, 1);
  }
  return g;
}
const project = createRoomConstruction(start, wide);
const original = ok(project),
  id = project.planId!;
const plan = (g: Game, p = id) => g.housing!.construction!.plans[p];
const noFunds = reserveConstructionMaterial(original, id);
assert.ok(noFunds.error);
assert.equal(noFunds.game, original);
function construct(g: Game, p: string) {
  const reserved = ok(reserveConstructionMaterial(g, p));
  const assigned = ok(assignConstructionHaul(reserved, p, worker, "deliver"));
  const staged = until(assigned, (g) => !plan(g, p).assignment);
  const working = ok(assignConstructionBuild(staged, p, worker));
  const built = until(working, (g) => plan(g, p).status === "completed");
  assert.ok(isGame(built));
  return {
    reserved,
    assigned,
    staged,
    working,
    built,
    haul: staged.time - assigned.time,
    labor: built.time - staged.time,
  };
}
const earning = order(original, worker, "work", "wood");
const woodTime = inspectOrder(original, worker, "work", "wood").minutes!;
const funded = advance(earning, woodTime);
assert.ok(funded.wood >= 10);
const retained = construct(funded, id);
const dropped = ok(cancelRoomConstruction(original, id));
assert.equal(dropped.time, original.time);
assert.equal(dropped.wood, 9);
const next = createRoomConstruction(dropped, standard),
  nextId = next.planId!;
const smaller = construct(ok(next), nextId);
const movedRequest = {
  name: "居間側の作業室",
  neighborId: "living",
  stagingCell: 2,
};
const changed = createRoomConstruction(dropped, movedRequest);
const relocated = construct(ok(changed), changed.planId!);
// Compare all four successful game actions following the unfunded original
// plan: revise, reserve, haul, build. The initial plan is common to every path.
function revise(
  request: ConstructionRequest,
  replacement: ReturnType<typeof construct>,
) {
  const result = reviseRoomConstruction(original, id, request);
  const revised = ok(result);
  assert.equal(result.planId, id);
  assert.equal(plan(revised).createdAt, plan(original).createdAt);
  assert.equal(
    revised.housing!.construction!.nextId,
    original.housing!.construction!.nextId,
  );
  assert.equal(Object.keys(revised.housing!.construction!.plans).length, 1);
  assert.equal(plan(revised).material, undefined);
  for (const k of [
    "time",
    "wood",
    "food",
    "ingredients",
    "coins",
    "rng",
  ] as const)
    assert.equal(revised[k], original[k]);
  assert.deepEqual(revised.actors, original.actors);
  assert.deepEqual(revised.house, original.house);
  assert.deepEqual(revised.housing!.state.items, original.housing!.state.items);
  const construction = construct(revised, id);
  assert.equal(construction.reserved.wood, original.wood - 6);
  assert.equal(
    save(construct(load(revised), id).built),
    save(construction.built),
  );
  assert.deepEqual(construction.built.house, replacement.built.house);
  assert.deepEqual(construction.built.actors, replacement.built.actors);
  for (const k of ["time", "wood", "food", "ingredients", "coins"] as const)
    assert.equal(construction.built[k], replacement.built[k]);
  return { revised, ...construction };
}
const resizePlan = revise(standard, smaller);
const movePlan = revise(movedRequest, relocated);
const later = advance(order(original, worker, "wait"), 5);
assert.equal(
  plan(ok(reviseRoomConstruction(later, id, movedRequest))).createdAt,
  original.time,
);
const furnishStage = (g: Game, room: string) =>
  applyHousingHouseEdit(
    g,
    editHouse(g.house, { type: "build", kind: "workbench", room, cell: 2 }),
  );
const beforeChange = furnishStage(original, "bedroom");
assert.ok(beforeChange.error);
assert.equal(beforeChange.game, original);
const afterChange = ok(furnishStage(movePlan.revised, "bedroom"));
assert.equal(afterChange.time, original.time);
assert.equal(afterChange.wood, 6);
const blockedAgain = furnishStage(movePlan.revised, "living");
assert.ok(blockedAgain.error);
assert.equal(blockedAgain.game, movePlan.revised);
function report(g: Game, sequence: string[], haul: number, labor: number) {
  return {
    sequence,
    commandCount: sequence.length,
    haul,
    labor,
    minutes: g.time - original.time,
    wood: g.wood,
    history: Object.values(g.housing!.construction!.plans).map((p) => ({
      id: p.id,
      status: p.status,
      height: p.height ?? 3,
      name: p.name,
      neighbor: p.neighborId,
      staging: p.staging.cell,
      createdAt: p.createdAt,
    })),
    nextId: g.housing!.construction!.nextId,
    room: g.house.rooms.at(-1)!.id,
    height: g.house.rooms.at(-1)!.height,
  };
}
assert.equal(save(construct(load(funded), id).built), save(retained.built));
assert.equal(
  save(construct(load(ok(next)), nextId).built),
  save(smaller.built),
);
const partial = advance(retained.working, 12);
const samples = [
  ["empty", original],
  ["reserved at source", retained.reserved],
  ["in transit", advance(retained.assigned, 2)],
  ["delivered", retained.staged],
  ["partial work", partial],
] as const;
function cancelSample(stage: string, g: Game) {
  const before = plan(g);
  const ongoing =
    before.material && g.housing!.state.items[before.material.itemId]?.position;
  // The existing cancel/return choice remains available after allocation.
  const revision = reviseRoomConstruction(g, id, movedRequest);
  if (before.material) {
    assert.ok(revision.error);
    assert.equal(revision.game, g);
  } else {
    assert.equal(revision.error, undefined);
  }
  // A separate plan cannot overlap the current job.
  const conflict = createRoomConstruction(g, movedRequest);
  assert.ok(conflict.error);
  assert.equal(conflict.game, g);
  const cancelled = ok(cancelRoomConstruction(g, id));
  const afterCancel = plan(cancelled);
  const retry = createRoomConstruction(cancelled, movedRequest);
  let returned = cancelled;
  let manualReturn = false;
  if (retry.error) {
    returned = until(returned, (g) => !plan(g).assignment);
    if (plan(returned).material?.state === "present") {
      returned = ok(assignConstructionHaul(returned, id, worker, "return"));
      manualReturn = true;
      returned = until(returned, (g) => plan(g).material?.state === "returned");
    }
  }
  const replacement = createRoomConstruction(returned, movedRequest);
  assert.equal(replacement.error, undefined);
  const result = ok(replacement);
  assert.equal(plan(result, replacement.planId!).workedMinutes, 0);
  return {
    stage,
    revisionAllowed: !revision.error,
    material: before.material?.state ?? null,
    position: ongoing?.kind ?? null,
    worked: before.workedMinutes,
    woodBefore: g.wood,
    woodImmediately: cancelled.wood,
    woodAfterReturn: returned.wood,
    materialAfterCancel: afterCancel.material?.state ?? null,
    newPlanImmediately: !retry.error,
    manualReturn,
    returnDelay: returned.time - g.time,
    nextPlan: replacement.planId,
  };
}
console.log(
  JSON.stringify(
    {
      woodAtStart: start.wood,
      morning: start.time,
      unfunded: noFunds.error,
      woodJobMinutes: woodTime,
      woodProduced: funded.wood - original.wood,
      oldStageFurniture: {
        before: beforeChange.error,
        afterCost: original.wood - afterChange.wood,
        afterTime: afterChange.time,
        newStageProtected: blockedAgain.error,
      },
      countBasis:
        "Successful commands after the common unfunded plan. Clock controls and the identical rejected reserve attempt are excluded.",
      paths: [
        report(
          retained.built,
          ["wood", "reserve", "haul", "build"],
          retained.haul,
          retained.labor,
        ),
        report(
          smaller.built,
          ["cancel", "create small", "reserve", "haul", "build"],
          smaller.haul,
          smaller.labor,
        ),
        report(
          relocated.built,
          ["cancel", "create small in living", "reserve", "haul", "build"],
          relocated.haul,
          relocated.labor,
        ),
        report(
          resizePlan.built,
          ["revise small", "reserve", "haul", "build"],
          resizePlan.haul,
          resizePlan.labor,
        ),
        report(
          movePlan.built,
          ["revise small in living", "reserve", "haul", "build"],
          movePlan.haul,
          movePlan.labor,
        ),
      ],
      stageChecks: samples.map(([name, g]) => cancelSample(name, g)),
    },
    null,
    2,
  ),
);
