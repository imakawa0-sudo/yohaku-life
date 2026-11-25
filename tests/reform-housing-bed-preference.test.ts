import assert from "node:assert/strict";
import test from "node:test";
import { editHouse, initialHouse } from "../src/reform/house";
import {
  getPreferredBed,
  setPreferredBed,
} from "../src/reform/housing/bedPreference";
import { applyHousingHouseEdit } from "../src/reform/housing/runtime";
import { housingLinkId, housingSlotId } from "../src/reform/housing/topology";
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
const [one, two] = people.map((person) => person.id);
const mat = "mat-1";
const bed = "fixture-1";

function origin() {
  const house = editHouse(initialHouse(), {
    type: "build",
    room: "living",
    kind: "bed",
    cell: 7,
  });
  const game = createGame(
    people,
    generateWorld(defaultWorldConfig()),
    "village",
    house,
  );
  assert.ok(isGame(game));
  return game;
}

function home() {
  const game = enableHousing(origin(), "new");
  assert.ok(isGame(game));
  return game;
}

function withoutPreferences(game: Game) {
  const clone = structuredClone(game);
  delete clone.housing!.preferredBeds;
  return clone;
}

test("ordinary rest without a preference previews the fastest bed without changing the game", () => {
  const game = home();
  const original = structuredClone(game);
  assert.deepEqual(inspectOrder(game, one, "need", "energy"), {
    minutes: 58,
    reserved: {},
    facility: {
      fixtureId: bed,
      roomId: "living",
      fixtureKind: "bed",
      fixtureCell: 7,
      moveMinutes: 3,
      useMinutes: 55,
    },
  });
  assert.equal(Object.hasOwn(game.housing!, "preferredBeds"), false);
  assert.deepEqual(structuredClone(game), original);
});

test("ordinary rest previews and books the preferred mat even when it is farther and slower", () => {
  const game = home();
  game.housing!.preferredBeds = { [one]: mat };
  const original = structuredClone(game);
  const preview = inspectOrder(game, one, "need", "energy");
  assert.deepEqual(preview, {
    minutes: 91,
    reserved: {},
    facility: {
      fixtureId: mat,
      roomId: "bedroom",
      fixtureKind: "mat",
      fixtureCell: 10,
      moveMinutes: 6,
      useMinutes: 85,
      bedPreference: { fixtureId: mat, outcome: "preferred" },
    },
  });
  assert.deepEqual(structuredClone(game), original);

  const resting = order(game, one, "need", "energy");
  const task = resting.actors[0].task;
  assert.ok(task);
  assert.equal(task.station, housingSlotId("bedroom", mat, 0));
  assert.equal(task.total, 85);
  assert.equal(Object.hasOwn(task, "bedPreference"), false);
  assert.deepEqual(structuredClone(game), original);
});

test("one-time fixture use, other needs, and injury recovery ignore the ordinary rest preference", () => {
  const game = home();
  const preferred = structuredClone(game);
  preferred.housing!.preferredBeds = { [one]: mat };
  for (const [kind, target] of [
    ["home-use", bed],
    ["home-use", mat],
    ["need", "hunger"],
    ["recover", undefined],
  ] as const) {
    const baseline = inspectOrder(game, one, kind, target);
    assert.ok(baseline.minutes, kind);
    assert.deepEqual(inspectOrder(preferred, one, kind, target), baseline);
    const result = order(preferred, one, kind, target);
    assert.deepEqual(
      withoutPreferences(result),
      order(game, one, kind, target),
    );
    assert.deepEqual(result.housing!.preferredBeds, { [one]: mat });
  }
});

test("setting and clearing a bed only changes the preference during movement, use, and meals", () => {
  const game = home();
  const moving = advance(
    order(
      game,
      one,
      "home-move",
      JSON.stringify({ roomId: "bedroom", cell: 0 }),
    ),
    1,
  );
  const sleeping = advance(order(game, one, "home-use", bed), 4);
  const eating = advance(order(game, one, "need", "hunger"), 3);
  assert.equal(moving.housing!.state.actors[one].position.kind, "transit");
  assert.equal(sleeping.actors[0].task?.remaining, 54);
  assert.deepEqual(eating.actors[0].task?.reserved, { food: 1 });
  assert.equal(eating.food, game.food - 1);
  for (const active of [moving, sleeping, eating]) {
    const original = structuredClone(active);
    const changed = setPreferredBed(active, one, mat);
    assert.notEqual(changed, active);
    assert.equal(getPreferredBed(changed, one), mat);
    assert.deepEqual(withoutPreferences(changed), original);
    assert.deepEqual(active, original);

    const cleared = setPreferredBed(changed, one, null);
    assert.equal(getPreferredBed(cleared, one), undefined);
    assert.equal(Object.hasOwn(cleared.housing!, "preferredBeds"), false);
    assert.deepEqual(cleared, original);
    assert.equal(getPreferredBed(changed, one), mat);
  }
});

test("a resident can change their preference outdoors while outdoor rest remains the same", () => {
  const trip = order(home(), one, "travel", "landing");
  const outside = advance(trip, 20);
  assert.equal(outside.actors[0].location, "landing");
  assert.equal(outside.actors[0].task, null);

  const changed = setPreferredBed(outside, one, mat);
  assert.equal(getPreferredBed(changed, one), mat);
  assert.deepEqual(withoutPreferences(changed), outside);
  assert.deepEqual(inspectOrder(changed, one, "need", "energy"), {
    minutes: 90,
    reserved: {},
  });
  assert.deepEqual(
    withoutPreferences(order(changed, one, "need", "energy")),
    order(outside, one, "need", "energy"),
  );
});

test("invalid or redundant preferences return the original game", () => {
  const game = home();
  assert.equal(getPreferredBed(game, one), undefined);
  assert.equal(setPreferredBed(game, "unknown", mat), game);
  assert.equal(setPreferredBed(game, "constructor", mat), game);
  assert.equal(setPreferredBed(game, one, "hearth-1"), game);
  assert.equal(setPreferredBed(game, one, "removed"), game);
  assert.equal(setPreferredBed(game, one, null), game);
  const selected = setPreferredBed(game, one, mat);
  assert.equal(setPreferredBed(selected, one, mat), selected);
  const replacement = setPreferredBed(selected, one, bed);
  assert.deepEqual(replacement.housing!.preferredBeds, { [one]: bed });
  assert.equal(getPreferredBed(selected, one), mat);
  assert.equal(getPreferredBed(replacement, "constructor"), undefined);

  const legacy = origin();
  const original = structuredClone(legacy);
  assert.equal(getPreferredBed(legacy, one), undefined);
  assert.equal(setPreferredBed(legacy, one, mat), legacy);
  assert.deepEqual(legacy, original);
});

test("a shared preference preserves the first reservation and previews a fallback for the other resident", () => {
  const game = setPreferredBed(setPreferredBed(home(), one, mat), two, mat);
  const first = order(game, one, "need", "energy");
  const busy = order(first, two, "need", "hunger");
  const original = structuredClone(busy);
  assert.equal(first.actors[0].task?.station, housingSlotId("bedroom", mat, 0));
  assert.deepEqual(busy.housing!.preferredBeds, { [one]: mat, [two]: mat });
  assert.deepEqual(busy.actors[1].task?.reserved, { food: 1 });

  const preview = inspectOrder(busy, two, "need", "energy");
  assert.equal(preview.facility?.fixtureId, bed);
  assert.deepEqual(preview.facility?.bedPreference, {
    fixtureId: mat,
    outcome: "fallback",
    reason: "使える設備はほかの住人が予約しています。",
  });
  assert.deepEqual(busy, original);

  const second = order(busy, two, "need", "energy");
  assert.equal(second.actors[1].task?.station, housingSlotId("living", bed, 0));
  assert.deepEqual(second.actors[0].task, first.actors[0].task);
  for (const [id, reservation] of Object.entries(
    first.housing!.state.reservations,
  )) {
    assert.deepEqual(second.housing!.state.reservations[id], reservation);
  }
  assert.equal(second.food, game.food);
});

test("explicitly naming the reserved bed refuses the order and retains the old meal reservation", () => {
  const game = setPreferredBed(setPreferredBed(home(), one, mat), two, mat);
  const first = order(game, one, "need", "energy");
  const busy = order(first, two, "need", "hunger");
  const original = structuredClone(busy);
  assert.deepEqual(inspectOrder(busy, two, "home-use", mat), {
    disabled: "使える設備はほかの住人が予約しています。",
  });
  const rejected = order(busy, two, "home-use", mat);
  assert.deepEqual({ ...rejected, log: original.log }, original);
  assert.deepEqual(busy, original);
});

test("after a safe exit from a cancelled rest trip the next ordinary rest can book the preferred bed", () => {
  const game = setPreferredBed(home(), one, mat);
  const moving = advance(order(game, one, "need", "energy"), 1);
  const cancelling = order(moving, one, "cancel");
  assert.equal(cancelling.housing!.state.actors[one].position.kind, "transit");
  assert.equal(
    cancelling.actors[0].task?.station,
    housingSlotId("bedroom", mat, 0),
  );
  assert.match(
    inspectOrder(cancelling, one, "need", "energy").disabled ?? "",
    /区間/,
  );

  const arrived = advance(cancelling, 2);
  assert.equal(arrived.housing!.state.actors[one].position.kind, "at");
  assert.equal(arrived.actors[0].task, null);
  assert.deepEqual(
    inspectOrder(arrived, one, "need", "energy").facility?.bedPreference,
    {
      fixtureId: mat,
      outcome: "preferred",
    },
  );
  assert.equal(
    order(arrived, one, "need", "energy").actors[0].task?.station,
    housingSlotId("bedroom", mat, 0),
  );
});

test("completion frees the preferred bed for the other resident's next ordinary rest", () => {
  const game = setPreferredBed(setPreferredBed(home(), one, mat), two, mat);
  const first = order(game, one, "need", "energy");
  const second = order(first, two, "need", "energy");
  const completed = advance(second, 91);
  assert.equal(completed.actors[0].task, null);
  assert.equal(
    Object.values(completed.housing!.state.reservations).some(
      (reservation) =>
        reservation.targetId === housingSlotId("bedroom", mat, 0),
    ),
    false,
  );
  assert.equal(
    order(completed, two, "need", "energy").actors[1].task?.station,
    housingSlotId("bedroom", mat, 0),
  );
});

test("a closed route temporarily sends rest to the available bed", () => {
  const game = setPreferredBed(home(), one, mat);
  const link = housingLinkId("living", "bedroom");
  const closed = setHousingPassage(game, "link", link, false);
  const preview = inspectOrder(closed, one, "need", "energy");
  assert.equal(preview.facility?.fixtureId, bed);
  assert.deepEqual(preview.facility?.bedPreference, {
    fixtureId: mat,
    outcome: "fallback",
    reason:
      "目的地への通路が通れません。戸・通路の開閉と間取りを確認してください。",
  });
  assert.equal(getPreferredBed(closed, one), mat);
  const reopened = setHousingPassage(closed, "link", link, true);
  assert.equal(
    inspectOrder(reopened, one, "need", "energy").facility?.fixtureId,
    mat,
  );
});

test("a room restriction temporarily redirects residents outside and inside that room", () => {
  const game = setPreferredBed(home(), one, mat);
  const inside = advance(
    order(
      game,
      one,
      "home-move",
      JSON.stringify({ roomId: "bedroom", cell: 0 }),
    ),
    3,
  );
  assert.equal(inside.actors[0].room, "bedroom");
  for (const [positioned, reason] of [
    [game, "入室の許可がありません。通る部屋の利用許可を確認してください。"],
    [inside, "設備を使う許可がありません。部屋の利用許可を確認してください。"],
  ] as const) {
    const restricted = setHousingRoomAccess(positioned, "bedroom", [two]);
    const preview = inspectOrder(restricted, one, "need", "energy");
    assert.equal(preview.facility?.fixtureId, bed);
    assert.deepEqual(preview.facility?.bedPreference, {
      fixtureId: mat,
      outcome: "fallback",
      reason,
    });
    assert.equal(getPreferredBed(restricted, one), mat);
    const restored = setHousingRoomAccess(restricted, "bedroom", null);
    assert.equal(
      inspectOrder(restored, one, "need", "energy").facility?.fixtureId,
      mat,
    );
  }
});

test("if the alternate is reserved and the preferred room is forbidden, ordinary rest returns the existing failure", () => {
  const game = setPreferredBed(home(), one, mat);
  const busy = order(game, two, "home-use", bed);
  const restricted = setHousingRoomAccess(busy, "bedroom", [two]);
  const original = structuredClone(restricted);
  assert.deepEqual(inspectOrder(restricted, one, "need", "energy"), {
    disabled: "入室の許可がありません。通る部屋の利用許可を確認してください。",
  });
  const rejected = order(restricted, one, "need", "energy");
  assert.deepEqual({ ...rejected, log: original.log }, original);
});

for (const { time, energy, label } of [
  { time: 480, energy: 25, label: "low daytime energy" },
  { time: 1200, energy: 65, label: "nighttime sleep" },
]) {
  test(`autonomous rest for ${label} books the preferred bed`, () => {
    const game = setPreferredBed(home(), one, mat);
    game.time = game.housing!.state.time = time;
    game.actors[0].needs.energy = energy;
    const acted = advance(game, 1);
    assert.equal(acted.actors[0].task?.mode, "auto");
    assert.equal(acted.actors[0].task?.target, "energy");
    assert.equal(
      acted.actors[0].task?.station,
      housingSlotId("bedroom", mat, 0),
    );
  });
}

test("moving a bed to another room preserves its preference by fixture ID", () => {
  const game = setPreferredBed(home(), one, mat);
  const moved = applyHousingHouseEdit(
    game,
    editHouse(game.house, {
      type: "move",
      id: mat,
      room: "yard",
      cell: 6,
    }),
  );
  assert.equal(moved.error, undefined);
  assert.ok(isGame(moved.game));
  assert.equal(getPreferredBed(moved.game, one), mat);
  assert.equal(
    inspectOrder(moved.game, one, "need", "energy").facility?.roomId,
    "yard",
  );
});

test("an accepted idle removal clears only residents who preferred the removed bed", () => {
  const game = setPreferredBed(setPreferredBed(home(), one, mat), two, bed);
  const original = structuredClone(game);
  const removedMat = applyHousingHouseEdit(
    game,
    editHouse(game.house, { type: "remove", id: mat }),
  );
  assert.equal(removedMat.error, undefined);
  assert.deepEqual(removedMat.game.housing!.preferredBeds, { [two]: bed });
  assert.equal(
    inspectOrder(removedMat.game, one, "need", "energy").facility?.fixtureId,
    bed,
  );
  assert.equal(
    inspectOrder(removedMat.game, one, "need", "energy").facility
      ?.bedPreference,
    undefined,
  );
  assert.deepEqual(structuredClone(game), original);

  const removedBed = applyHousingHouseEdit(
    removedMat.game,
    editHouse(removedMat.game.house, { type: "remove", id: bed }),
  );
  assert.equal(removedBed.error, undefined);
  assert.equal(Object.hasOwn(removedBed.game.housing!, "preferredBeds"), false);
  assert.ok(isGame(removedBed.game));
});

test("a rejected removal while the preferred bed is reserved leaves the full game intact", () => {
  const game = setPreferredBed(home(), one, mat);
  const resting = order(game, one, "need", "energy");
  const original = structuredClone(resting);
  const rejected = applyHousingHouseEdit(
    resting,
    editHouse(resting.house, { type: "remove", id: mat }),
  );
  assert.match(rejected.error ?? "", /予約した設備/);
  assert.equal(rejected.game, resting);
  assert.deepEqual(resting, original);
});
