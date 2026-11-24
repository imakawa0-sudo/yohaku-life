import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { presetPeople } from "@reform/Setup";
import { defaultWorldConfig, generateWorld } from "@reform/world";
import { initialHouse, editHouse } from "@reform/house";
import {
  createGame,
  setBond,
  enableHousing,
  advance,
  order,
  inspectOrder,
  isGame,
  type Game,
} from "@reform/sim";
import { exportSlot, importSlot, branchSlot } from "@reform/library";
import { applyHousingHouseEdit } from "@reform/housing/runtime";
import {
  createRoomConstruction,
  reserveConstructionMaterial,
  assignConstructionHaul,
  assignConstructionBuild,
} from "@reform/housing/construction";
import { housingSlotId } from "@reform/housing/topology";

const fixtureDir = process.argv[2];
assert.ok(fixtureDir);
const origin = importSlot(
  readFileSync(join(fixtureDir, "room-use-shelves.json"), "utf8"),
).origin;
const [kaya, sui] = origin.actors.map((a) => a.person.id);
const ok = (r: { game: Game; error?: string }) => {
  assert.equal(r.error, undefined);
  assert.ok(isGame(r.game));
  return r.game;
};
let g = structuredClone(origin);
g = ok(
  createRoomConstruction(g, {
    name: "居間",
    neighborId: "bedroom",
    stagingCell: 2,
  }),
);
g = ok(reserveConstructionMaterial(g, "construction-1"));
g = ok(assignConstructionHaul(g, "construction-1", sui, "deliver"));
g = order(g, kaya, "work", "wood:hard");
g = advance(g, 6);
g = ok(assignConstructionBuild(g, "construction-1", sui));
g = advance(g, 30);
for (const [room, cell] of [
  ["room-1", 4],
  ["living", 4],
  ["living", 7],
] as const) {
  g = ok(
    applyHousingHouseEdit(
      g,
      editHouse(g.house, { type: "build", room, cell, kind: "shelf" }),
    ),
  );
}
const bytes = exportSlot({
  id: "qa-duplicate-labels",
  name: "検証・同名の部屋と本棚",
  game: g,
  origin,
});
writeFileSync(join(fixtureDir, "room-use-duplicate-labels.json"), bytes);
console.log(
  JSON.stringify(
    {
      bytes: Buffer.byteLength(bytes),
      sha256: createHash("sha256").update(bytes).digest("hex"),
      valid: isGame(importSlot(bytes).game),
      time: g.time,
      wood: g.wood,
      rooms: g.house.rooms.map((r) => ({
        id: r.id,
        name: r.name,
        shelves: r.fixtures.filter((f) => f.kind === "shelf"),
      })),
      auto: inspectOrder(g, kaya, "need", "fun"),
    },
    null,
    2,
  ),
);
