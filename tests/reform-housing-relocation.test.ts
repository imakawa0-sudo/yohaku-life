import assert from "node:assert/strict";
import { register } from "node:module";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import {
  cellName,
  editHouse,
  furniturePlacementCells,
  initialHouse,
} from "../src/reform/house";
import {
  getBedSleeper,
  setBedSleeper,
} from "../src/reform/housing/bedPreference";
import { setFoodSupply } from "../src/reform/housing/foodSupply";
import { applyHousingHouseEdit } from "../src/reform/housing/runtime";
import { housingSlotId } from "../src/reform/housing/topology";
import { exportSlot, importSlot } from "../src/reform/library";
import { makePersona } from "../src/reform/peopleModel";
import {
  advance,
  createGame,
  enableHousing,
  inspectOrder,
  order,
} from "../src/reform/sim";
import { defaultWorldConfig, generateWorld } from "../src/reform/world";

const owner = makePersona(0, 23);
const helper = makePersona(1, 75);
const mat = "mat-1";
const relocation = { type: "move", id: mat, room: "yard" } as const;

function home() {
  const raw = createGame(
    [owner, helper],
    generateWorld(defaultWorldConfig()),
    "village",
  );
  return setBedSleeper(enableHousing(raw, "new"), mat, owner.id);
}

test("the default move remains available; choosing a different floor avoids an H6b supply destination and keeps the assigned sleeper", () => {
  const origin = home();
  const automatic = editHouse(origin.house, relocation);
  const autoCell = automatic.rooms
    .find((r) => r.id === "yard")!
    .fixtures.find((f) => f.id === mat)!.cell;
  assert.equal(autoCell, 10);
  assert.equal(applyHousingHouseEdit(origin, automatic).error, undefined);
  const policy = setFoodSupply(origin, {
    actorId: helper.id,
    roomId: "yard",
    storageCell: autoCell,
  });
  assert.equal(policy.error, undefined);
  const before = JSON.stringify(policy.game);
  for (const target of [
    automatic,
    editHouse(policy.game.house, { ...relocation, cell: autoCell }),
  ]) {
    const denied = applyHousingHouseEdit(policy.game, target);
    assert.equal(denied.game, policy.game);
    assert.match(denied.error ?? "", /補充先の床/);
  }
  const moved = applyHousingHouseEdit(
    policy.game,
    editHouse(policy.game.house, { ...relocation, cell: 6 }),
  );
  assert.equal(moved.error, undefined);
  assert.deepEqual(
    moved.game.housing!.foodSupply,
    policy.game.housing!.foodSupply,
  );
  assert.equal(getBedSleeper(moved.game, mat), owner.id);
  assert.equal(moved.game.time, origin.time);
  assert.equal(moved.game.wood, origin.wood);
  const restored = importSlot(
    exportSlot({ id: "bed", name: "配膳と寝床", origin, game: moved.game }),
  ).game;
  const use = inspectOrder(restored, owner.id, "home-use", mat);
  assert.equal(use.facility?.roomId, "yard");
  assert.equal(use.facility?.fixtureCell, 6);
  assert.match(
    inspectOrder(restored, helper.id, "home-use", mat).disabled ?? "",
    /専用の寝床/,
  );
  assert.equal(JSON.stringify(policy.game), before);
});

test("moving a claimed fixture or placing it on a resident's floor is rejected without changing the resident, order, or fixture", () => {
  const origin = home();
  const ownerUsingBed = order(origin, owner.id, "home-use", mat);
  assert.equal(
    ownerUsingBed.actors[0].task?.station,
    housingSlotId("bedroom", mat, 0),
  );
  const target = JSON.stringify({ roomId: "yard", cell: 6 });
  const minutes = inspectOrder(origin, helper.id, "home-move", target).minutes!;
  const occupying = advance(
    order(
      order(origin, owner.id, "work", "care:hard"),
      helper.id,
      "home-move",
      target,
    ),
    minutes,
  );
  for (const [state, reason] of [
    [ownerUsingBed, /予約/],
    [occupying, /立っている床/],
  ] as const) {
    const before = JSON.stringify(state);
    const attempt = applyHousingHouseEdit(
      state,
      editHouse(state.house, { ...relocation, cell: 6 }),
    );
    assert.match(attempt.error ?? "", reason);
    assert.equal(attempt.game, state);
    assert.equal(JSON.stringify(state), before);
  }
});

test("the editor lists exactly the walkable target placements, including an automatic default, and leaves the house untouched", async () => {
  register(
    "data:text/javascript," +
      encodeURIComponent(
        'export async function load(url, context, next) { if (url.endsWith(".css")) return {format:"module",source:"export default {}",shortCircuit:true};return next(url,context); }',
      ),
  );
  const { HouseEditor } = await import("../src/reform/HouseEditor");
  const withWall = editHouse(initialHouse(), {
    type: "tile",
    tile: "wall",
    room: "bedroom",
    cell: 4,
  });
  const house = editHouse(withWall, {
    type: "tile",
    tile: "door",
    room: "bedroom",
    cell: 7,
  });
  const target = house.rooms.find((r) => r.id === "bedroom")!;
  const moving = house.rooms[0].fixtures[0];
  const before = JSON.stringify(house);
  // Cell 1 is an open floor but placing furniture there severs the only path from the entrance.
  const cells = furniturePlacementCells(target, moving);
  assert.deepEqual(cells, [2, 3, 5, 6, 8, 9, 11]);
  for (let cell = 0; cell < 12; cell++) {
    const tryEdit = () =>
      editHouse(house, { type: "move", id: moving.id, room: target.id, cell });
    if (cells.includes(cell)) assert.doesNotThrow(tryEdit);
    else assert.throws(tryEdit);
  }
  const html = renderToStaticMarkup(
    createElement(HouseEditor, {
      house,
      onChange: () => assert.fail("render moved furniture"),
    }),
  );
  const picker = html.match(
    /<label>移設先のマス<select[^>]*>([\s\S]*?)<\/select>/,
  )?.[1];
  assert.ok(picker);
  const options = [
    ...picker.matchAll(/<option value="([^"]*)"[^>]*>([^<]*)<\/option>/g),
  ].map((match) => [match[1], match[2]]);
  assert.deepEqual(options, [
    ["", "自動で選ぶ"],
    ...cells.map((cell) => [String(cell), cellName(target, cell)]),
  ]);
  assert.equal(JSON.stringify(house), before);
});
