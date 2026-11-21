import assert from "node:assert/strict";
import test from "node:test";
import {
  cookingStation,
  editHouse,
  houseValue,
  initialHouse,
  isHouse,
  needs,
  service,
} from "../src/reform/house";

test("新居ですべての欲求を扱い、予約した家具は空くまで再使用できない", () => {
  const home = initialHouse();
  for (const need of needs) assert.ok(service(home, need, "living", []), need);
  const bath = service(home, "hygiene", "living", [])!;
  assert.equal(bath.room, "yard");
  assert.equal(service(home, "hygiene", "living", [bath.station]), null);
  const seat1 = service(home, "social", "living", [])!;
  const seat2 = service(home, "social", "living", [seat1.station])!;
  assert.notEqual(seat1.station, seat2.station);
  assert.equal(
    service(home, "social", "living", [seat1.station, seat2.station]),
    null,
  );
});
test("間取り・家具の格と空き状況から、歩行込みの最短時間を選ぶ", () => {
  const home = initialHouse();
  const baseline = service(home, "hygiene", "living", [])!;
  assert.equal(baseline.minutes, 43);
  const link = editHouse(home, { type: "link", a: "living", b: "yard" });
  assert.equal(service(link, "hygiene", "living", [])!.minutes, 40);
  const upgrade = editHouse(home, {
    type: "build",
    room: "living",
    kind: "bath",
    cell: 4,
  });
  const faster = service(upgrade, "hygiene", "living", [])!;
  assert.equal(faster.minutes, 14);
  assert.equal(
    service(upgrade, "hygiene", "living", [faster.station])!.station,
    baseline.station,
  );
  assert.equal(houseValue(upgrade) - houseValue(home), 8);
  assert.equal(home.rooms[0].fixtures.length, 3);
  const move = editHouse(home, {
    type: "move",
    id: "basin-1",
    room: "living",
    cell: 4,
  });
  assert.equal(houseValue(move), houseValue(home));
  assert.equal(service(move, "hygiene", "living", [])!.minutes, 33);
});
test("壁で迂回し、扉を開ければ通れ、入口と設備への通路は確保する", () => {
  let h = editHouse(initialHouse(), {
    type: "room",
    name: "浴室",
    neighbor: "living",
  });
  const room = h.rooms.at(-1)!.id;
  assert.equal(houseValue(h) - houseValue(initialHouse()), 6);
  h = editHouse(h, { type: "build", room, kind: "bath", cell: 2 });
  assert.equal(service(h, "hygiene", room, [])!.minutes, 15);
  h = editHouse(h, { type: "tile", room, cell: 1, tile: "wall" });
  assert.equal(service(h, "hygiene", room, [])!.minutes, 17);
  assert.throws(() =>
    editHouse(h, { type: "tile", room, cell: 4, tile: "wall" }),
  );
  h = editHouse(h, { type: "tile", room, cell: 1, tile: "door" });
  assert.equal(service(h, "hygiene", room, [])!.minutes, 16);
  assert.throws(() =>
    editHouse(h, { type: "tile", room, cell: 0, tile: "wall" }),
  );
  assert.throws(() => editHouse(h, { type: "link", a: "living", b: room }));
  assert.equal(editHouse(h, { type: "expand", room }).rooms.at(-1)!.height, 4);
});
test("保存情報を照合し、別の台所があれば予約中でも調理できる", () => {
  const start = initialHouse();
  const home = editHouse(start, {
    type: "build",
    room: "bedroom",
    kind: "kitchen",
    cell: 1,
  });
  assert.equal(isHouse(JSON.parse(JSON.stringify(home))), true);
  const cook = cookingStation(home, "bedroom", [])!;
  assert.equal(cook.minutes, 1);
  assert.equal(cook.room, "bedroom");
  assert.equal(cookingStation(home, "bedroom", [cook.station])!.room, "living");
  assert.equal(isHouse({ ...home, nextId: 1 }), false);
  assert.equal(isHouse({ ...home, links: [] }), false);
  assert.equal(
    isHouse({
      ...home,
      rooms: [{ ...home.rooms[0], fixtures: [{ kind: "toString" }] }],
    }),
    false,
  );
});
test("水桶は水場への往復を含めて比較し、給水付き浴槽なら往復を省ける", () => {
  const house = initialHouse();
  assert.equal(service(house, "hygiene", "living", [], 4)!.minutes, 51);
  const nearby = editHouse(house, {
    type: "build",
    room: "living",
    kind: "bath",
    cell: 10,
  });
  assert.equal(service(nearby, "hygiene", "living", [], 4)!.minutes, 17);

  let distant = editHouse(house, {
    type: "move",
    id: "basin-1",
    room: "living",
    cell: 4,
  });
  let neighbor = "living";
  for (let i = 0; i < 7; i++) {
    distant = editHouse(distant, { type: "room", name: "渡り廊下", neighbor });
    neighbor = distant.rooms.at(-1)!.id;
  }
  distant = editHouse(distant, {
    type: "build",
    room: neighbor,
    kind: "bath",
    cell: 1,
  });
  assert.equal(service(distant, "hygiene", "living", [])!.station, "basin-1");
  assert.equal(service(distant, "hygiene", "living", [], 4)!.room, neighbor);
  assert.equal(service(distant, "hygiene", "living", [], 4)!.minutes, 35);
});
