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

const outDirs = process.argv.slice(2);
assert.ok(outDirs.length >= 1);
const hash = (v: string | Buffer) =>
  createHash("sha256").update(v).digest("hex");
const stable = <T>(x: T): T => JSON.parse(JSON.stringify(x));
const people = presetPeople(0),
  [kaya, sui] = people.map((p) => p.id);
const origin = enableHousing(
  setBond(
    createGame(
      people,
      generateWorld(defaultWorldConfig()),
      "forest",
      initialHouse(),
    ),
    kaya,
    sui,
    "friend",
  ),
  "new",
);
const originHash = hash(JSON.stringify(origin));
assert.equal(
  originHash,
  "6fe6b179c23ad2a78bc1787517614df73e2004f9d0120599097fc7137f21d491",
);
const morning = {
  name: "カヤ・スイの暮らし",
  id: "fixture-origin",
  game: origin,
  origin,
};
const ok = (r: { game: Game; error?: string }) => {
  assert.equal(r.error, undefined);
  assert.ok(isGame(r.game));
  return r.game;
};
const issued = (g: Game, id: string, kind: string, target: string) => {
  assert.equal(inspectOrder(g, id, kind, target).disabled, undefined);
  const next = order(g, id, kind, target);
  assert.ok(isGame(next));
  return next;
};
const build = (
  g: Game,
  kind: "shelf" | "kitchen",
  room: string,
  cell: number,
) =>
  ok(
    applyHousingHouseEdit(
      g,
      editHouse(g.house, { type: "build", kind, room, cell }),
    ),
  );
const findFixture = (g: Game, roomId: string, kind: string) =>
  g.house.rooms
    .find((r) => r.id === roomId)!
    .fixtures.find((f) => f.kind === kind)!;
function write(file: string, bytes: string) {
  for (const dir of outDirs) {
    const dest = join(dir, file);
    writeFileSync(dest, bytes, "utf8");
    assert.equal(hash(readFileSync(dest)), hash(bytes));
  }
}
let reading = branchSlot(morning, true, "検証・家具の指定").game;
const planId = "construction-1";
reading = ok(
  createRoomConstruction(reading, {
    name: "読書室",
    neighborId: "bedroom",
    stagingCell: 2,
  }),
);
reading = ok(reserveConstructionMaterial(reading, planId));
reading = ok(assignConstructionHaul(reading, planId, sui, "deliver"));
reading = issued(reading, kaya, "work", "wood:hard");
reading = advance(reading, 6);
assert.equal(reading.time, 486);
reading = ok(assignConstructionBuild(reading, planId, sui));
reading = advance(reading, 30);
const plan = reading.housing!.construction!.plans[planId];
assert.equal(plan.status, "completed");
reading = build(reading, "shelf", plan.roomId!, 2);
reading = build(reading, "shelf", "living", 2);
assert.equal(reading.wood, 4);
assert.equal(reading.time, 516);
assert.equal(reading.actors[0].task!.target, "wood:hard");
assert.equal(reading.actors[0].task!.remaining, 3);
assert.equal(reading.actors[1].task, null);
let kitchen = branchSlot(morning, true, "検証・食卓の二席").game;
kitchen = build(kitchen, "kitchen", "living", 2);
const table = findFixture(kitchen, "living", "kitchen");
kitchen = issued(kitchen, sui, "need", "hunger");
assert.equal(kitchen.time, 480);
assert.equal(kitchen.wood, 10);
assert.equal(kitchen.food, 6);
assert.equal(kitchen.actors[0].task, null);
assert.equal(
  kitchen.actors[1].task!.station,
  housingSlotId("living", table.id, 0),
);
assert.deepEqual(kitchen.actors[1].task!.reserved, { food: 1 });
const second = issued(kitchen, kaya, "need", "hunger");
assert.equal(
  second.actors[0].task!.station,
  housingSlotId("living", table.id, 1),
);
assert.equal(second.food, 5);
assert.equal(Object.keys(second.housing!.state.reservations).length, 2);
const manifest = {
  originSha256: originHash,
  artifacts: [] as any[],
  notes: [
    "All saves fork the unedited 08:00 木工の二人 morning. Slot IDs are deterministic QA metadata. Import regenerates them as usual.",
    "The table fixture uses the standard new-game housing layout; seat IDs differ, although their use floor is shared in this layout. Its original hearth remains available. Sui has already booked seat 0 using generic hunger. A detached generic hunger probe for Kaya took seat 1 and deducted one more serving; this probe was not saved.",
    "No home-use commands, edits to live save fields, or browser operations.",
  ],
};
const fixture = (file: string, id: string, name: string, g: Game) => {
  const bytes = exportSlot({ id, name, game: g, origin });
  const decoded = importSlot(bytes);
  assert.ok(isGame(decoded.game) && isGame(decoded.origin));
  assert.deepEqual(stable(decoded.game), stable(g));
  assert.deepEqual(stable(decoded.origin), stable(origin));
  assert.equal(decoded.name, name);
  assert.notEqual(decoded.id, id);
  write(file, bytes);
  const actors = g.actors.map((a) => ({
    id: a.person.id,
    name: a.person.name,
    position: g.housing!.state.actors[a.person.id].position,
    task: a.task && {
      kind: a.task.kind,
      target: a.task.target,
      remaining: a.task.remaining,
      station: a.task.station,
      reserved: a.task.reserved,
    },
  }));
  manifest.artifacts.push({
    file,
    name,
    bytes: Buffer.byteLength(bytes),
    sha256: hash(bytes),
    gameSha256: hash(JSON.stringify(g)),
    time: g.time,
    resources: {
      wood: g.wood,
      food: g.food,
      ingredients: g.ingredients,
      coins: g.coins,
    },
    fixtures: g.house.rooms.flatMap((r) =>
      r.fixtures
        .filter((f) => f.kind === "shelf" || f.kind === "kitchen")
        .map((f) => ({
          roomId: r.id,
          roomName: r.name,
          fixtureId: f.id,
          kind: f.kind,
          cell: f.cell,
        })),
    ),
    actors,
    reservations: g.housing!.state.reservations,
  });
};
fixture(
  "room-use-shelves.json",
  "qa-room-use-shelves",
  "検証・家具の指定",
  reading,
);
fixture(
  "room-use-switch.json",
  "qa-room-use-switch",
  "検証・選択の切替",
  reading,
);
fixture(
  "room-use-dining.json",
  "qa-room-use-dining",
  "検証・食卓の二席",
  kitchen,
);
assert.equal(
  manifest.artifacts[0].gameSha256,
  manifest.artifacts[1].gameSha256,
);
assert.equal(hash(JSON.stringify(origin)), originHash);
write(
  "room-use-fixtures-manifest.json",
  JSON.stringify(manifest, null, 2) + "\n",
);
