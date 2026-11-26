import assert from "node:assert/strict";
import test from "node:test";
import { isGame } from "../src/reform/sim";
import { base, plan, planned } from "./helpers/construction";

import { advance, order } from "../src/reform/sim";
import { applyHousingHouseEdit } from "../src/reform/housing/runtime";
import { editHouse } from "../src/reform/house";
import {
  building,
  staged,
  ok,
  hauling,
  two,
  planId,
} from "./helpers/construction";
import {
  createRoomInsulation,
  isRoomInsulated,
} from "../src/reform/housing/insulation";
import {
  cancelRoomConstruction,
  reserveConstructionMaterial,
} from "../src/reform/housing/construction";
import { housingPoint } from "../src/reform/housing/topology";

test("an existing bedroom can be the target of a one-wood insulation plan", () => {
  const g = planned(base());
  Object.assign(plan(g), { kind: "insulation", requiredWood: 1 });
  assert.equal(isGame(g), true);
  for (const patch of [
    { kind: undefined },
    { kind: "unknown" },
    { requiredWood: 6 },
  ]) {
    const broken = structuredClone(g);
    Object.assign(plan(broken), patch);
    assert.equal(isGame(broken), false);
  }
});

function finishedInsulation() {
  const p = ok(
    createRoomInsulation(base(), { roomId: "bedroom", stagingCell: 2 }),
  );
  const stock = ok(reserveConstructionMaterial(p, planId));
  return advance(
    building(advance(order(hauling(stock), two, "work", "care"), 6)),
    30,
  );
}

test("completed insulation accepts later edits but rejects mismatched receipts, targets and repeated insulation", () => {
  const finished = finishedInsulation();
  finished.wood = 10;
  let edited = ok(
    applyHousingHouseEdit(
      finished,
      editHouse(finished.house, { type: "expand", room: "bedroom" }),
    ),
  );
  const furniture = editHouse(edited.house, {
    type: "build",
    room: "bedroom",
    kind: "basin",
    cell: 2,
  });
  furniture.rooms.find((room) => room.id === "bedroom")!.name = "書斎";
  // Move the installer off the old staging floor before furnishing it.
  edited = order(
    edited,
    edited.actors[0].person.id,
    "home-move",
    JSON.stringify({ roomId: "living", cell: 0 }),
  );
  edited = advance(edited, 5);
  const after = ok(applyHousingHouseEdit(edited, furniture));
  assert.ok(isGame(after));
  assert.ok(isRoomInsulated(after, "bedroom"));

  for (const target of ["yard", "missing"]) {
    const bad = structuredClone(finished);
    Object.assign(plan(bad), {
      neighborId: target,
      roomId: target,
      staging: housingPoint(target, 2),
    });
    assert.equal(isGame(bad), false);
  }
  for (const patch of [
    { roomId: "living" },
    { workedMinutes: 29 },
    { requiredWood: 6 },
    { kind: undefined },
  ]) {
    const bad = structuredClone(finished);
    Object.assign(plan(bad), patch);
    assert.equal(isGame(bad), false);
  }
  const badReceipt = structuredClone(finished);
  Object.assign(plan(badReceipt).material!, { quantity: 6 });
  assert.equal(isGame(badReceipt), false);
  const repeat = structuredClone(finished);
  const ledger = repeat.housing!.construction!;
  ledger.nextId = 3;
  ledger.plans["construction-2"] = {
    ...plan(planned()),
    id: "construction-2",
    kind: "insulation",
    requiredWood: 1,
    createdAt: repeat.time,
  };
  assert.equal(isGame(repeat), false);
});

test("room insulation can follow an extension but cannot precede that room's construction", () => {
  const extended = advance(building(staged()), 30);
  const roomId = plan(extended).roomId!;
  const valid = ok(createRoomInsulation(extended, { roomId, stagingCell: 2 }));
  assert.ok(isGame(valid));
  const bad = structuredClone(valid);
  const ledger = bad.housing!.construction!;
  const extension = ledger.plans["construction-1"];
  const earlier = ledger.plans["construction-2"];
  Object.assign(earlier, {
    id: "construction-1",
    createdAt: 480,
    cancelledAt: 480,
    status: "cancelled",
  });
  extension.id = "construction-2";
  extension.material!.itemId = "construction-material-2";
  ledger.plans = { "construction-1": earlier, "construction-2": extension };
  assert.equal(isGame(bad), false);
});

test("completed extensions retain a real neighboring room even after the work site is released", () => {
  const completed = advance(building(staged()), 30);
  assert.equal(plan(completed).status, "completed");
  plan(completed).neighborId = "missing";
  plan(completed).staging = housingPoint("missing", 2);
  assert.equal(isGame(completed), false);
});

test("completed and recovered receipts permit later furnishings but require a possible staging cell", () => {
  const project = ok(
    createRoomInsulation(base(), { roomId: "bedroom", stagingCell: 2 }),
  );
  const recovered = ok(
    cancelRoomConstruction(
      ok(reserveConstructionMaterial(project, planId)),
      planId,
    ),
  );
  assert.equal(plan(recovered).material?.state, "returned");
  const edited = ok(
    applyHousingHouseEdit(
      recovered,
      editHouse(recovered.house, {
        type: "build",
        room: "bedroom",
        kind: "basin",
        cell: 2,
      }),
    ),
  );
  assert.ok(isGame(edited));
  for (const game of [edited, advance(building(staged()), 30)]) {
    for (const cell of [28, 999]) {
      const broken = structuredClone(game);
      plan(broken).staging.cell = cell;
      assert.equal(isGame(broken), false);
    }
  }
});
