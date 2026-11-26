import assert from "node:assert/strict";
import test from "node:test";
import { register } from "node:module";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { editHouse, initialHouse } from "../src/reform/house";
import {
  getBedSleeper,
  getPreferredBed,
  setBedSleeper,
  setPreferredBed,
} from "../src/reform/housing/bedPreference";
import { applyHousingHouseEdit } from "../src/reform/housing/runtime";
import { housingSlotId } from "../src/reform/housing/topology";
import { exportSlot, importSlot } from "../src/reform/library";
import { makePersona } from "../src/reform/peopleModel";
import {
  advance,
  createGame,
  enableHousing,
  inspectOrder,
  isGame,
  order,
  setHousingRoomAccess,
  type Game,
} from "../src/reform/sim";
import { defaultWorldConfig, generateWorld } from "../src/reform/world";

const people = [makePersona(0, 23), makePersona(1, 75), makePersona(2, 15)];
const [a, b, c] = people.map((p) => p.id);
const mat = "mat-1";
const bed = "fixture-1";
const shelf = "fixture-2";

function base() {
  let house = editHouse(initialHouse(), {
    type: "build",
    kind: "bed",
    room: "living",
    cell: 7,
  });
  house = editHouse(house, {
    type: "build",
    kind: "shelf",
    room: "bedroom",
    cell: 7,
  });
  return createGame(
    people,
    generateWorld(defaultWorldConfig()),
    "village",
    house,
  );
}
function reload(game: Game, origin: Game) {
  const loaded = importSlot(
    exportSlot({ id: "bed", name: "共有する部屋", game, origin }),
  );
  assert.deepEqual(loaded.game, structuredClone(game));
  assert.deepEqual(loaded.origin, structuredClone(origin));
  return loaded.game;
}

test("a designated mat in a shared bedroom still lets the other residents enter, read and rest on an alternative bed", () => {
  const home = enableHousing(base(), "new");
  const assigned = setBedSleeper(home, mat, a);
  assert.deepEqual(assigned.housing!.controls, home.housing!.controls);
  assert.equal(getBedSleeper(home, mat), undefined);
  assert.equal(getBedSleeper(assigned, mat), a);
  assert.equal(
    inspectOrder(assigned, a, "home-use", mat).facility?.fixtureId,
    mat,
  );
  for (const resident of [b, c]) {
    const prepared = setPreferredBed(assigned, resident, mat);
    const breakfast = order(prepared, resident, "need", "hunger");
    const old = structuredClone(breakfast);
    assert.match(
      inspectOrder(breakfast, resident, "home-use", mat).disabled ?? "",
      /専用の寝床/,
    );
    const rejected = order(breakfast, resident, "home-use", mat);
    assert.deepEqual({ ...rejected, log: old.log }, old);
    assert.deepEqual(breakfast, old);
    assert.equal(
      inspectOrder(
        breakfast,
        resident,
        "home-move",
        JSON.stringify({ roomId: "bedroom", cell: 0 }),
      ).disabled,
      undefined,
    );
    const reading = order(breakfast, resident, "home-use", shelf);
    const reader = reading.actors.find((p) => p.person.id === resident)!;
    assert.equal(reader.task?.station, housingSlotId("bedroom", shelf, 0));
    const resting = inspectOrder(breakfast, resident, "need", "energy");
    assert.equal(resting.facility?.fixtureId, bed);
    assert.equal(resting.facility?.bedPreference?.outcome, "fallback");
    assert.match(resting.facility?.bedPreference?.reason ?? "", /専用の寝床/);
    assert.equal(getPreferredBed(breakfast, resident), mat);
    const actual = order(breakfast, resident, "need", "energy");
    assert.equal(
      actual.actors.find((p) => p.person.id === resident)?.task?.station,
      housingSlotId("living", bed, 0),
    );
  }
  // The owner still needs access to the room, and a private mat never implies preference.
  assert.equal(
    inspectOrder(assigned, a, "need", "energy").facility?.fixtureId,
    bed,
  );
  const locked = setHousingRoomAccess(assigned, "bedroom", [b, c]);
  assert.match(inspectOrder(locked, a, "home-use", mat).disabled ?? "", /許可/);
  assert.equal(inspectOrder(locked, b, "home-use", shelf).disabled, undefined);
  const occupiedOtherBed = order(assigned, c, "home-use", bed);
  const unavailable = inspectOrder(
    occupiedOtherBed,
    b,
    "need",
    "energy",
  ).disabled;
  assert.match(unavailable ?? "", /専用の寝床/);
  assert.match(unavailable ?? "", /予約/);
  const both = setBedSleeper(assigned, bed, a);
  assert.ok(isGame(both));
  assert.match(
    inspectOrder(both, b, "need", "energy").disabled ?? "",
    /専用の寝床/,
  );
});

test("autonomous rest skips another resident's empty preferred bed", () => {
  const origin = enableHousing(base(), "new");
  const preferred = setPreferredBed(origin, b, bed);
  const game = setBedSleeper(preferred, bed, a);
  game.actors[1].needs.energy = 10;
  const othersBusy = order(order(game, a, "work", "wood"), c, "work", "wood");
  const firstMinute = advance(othersBusy, 1);
  assert.equal(firstMinute.actors[1].task?.mode, "auto");
  assert.equal(firstMinute.actors[1].task?.target, "energy");
  assert.equal(
    firstMinute.actors[1].task?.station,
    housingSlotId("bedroom", mat, 0),
  );
});

test("reassignment during approach or use preserves the active reservation and applies only to later rests", () => {
  const origin = enableHousing(base(), "new");
  const resting = order(origin, b, "home-use", mat);
  const preview = inspectOrder(origin, b, "home-use", mat);
  for (const elapsed of [1, preview.facility!.moveMinutes + 1]) {
    const checkpoint = advance(resting, elapsed);
    const changed = setBedSleeper(checkpoint, mat, a);
    assert.deepEqual(changed.actors, checkpoint.actors);
    assert.deepEqual(changed.housing!.state, checkpoint.housing!.state);
    assert.equal(changed.time, checkpoint.time);
    const continued = advance(
      reload(changed, origin),
      preview.minutes! - elapsed,
    );
    const unchanged = advance(checkpoint, preview.minutes! - elapsed);
    assert.deepEqual(continued.actors[1], unchanged.actors[1]);
    assert.equal(continued.actors[1].task, null);
    assert.match(
      inspectOrder(continued, b, "home-use", mat).disabled ?? "",
      /専用の寝床/,
    );
    const reassigned = setBedSleeper(continued, mat, b);
    assert.equal(
      inspectOrder(reassigned, b, "home-use", mat).disabled,
      undefined,
    );
    assert.match(
      inspectOrder(reassigned, a, "home-use", mat).disabled ?? "",
      /専用の寝床/,
    );
    const released = setBedSleeper(reassigned, mat, null);
    for (const who of [a, b, c])
      assert.equal(
        inspectOrder(released, who, "home-use", mat).disabled,
        undefined,
      );
    assert.equal(Object.hasOwn(released.housing!, "bedSleepers"), false);
  }
});

test("a rest already in progress from a pre-spatial save can finish after the mat is assigned to someone else", () => {
  const old = base();
  // Legacy ordinary rest chooses the faster bed in the living room.
  const sleeping = order(old, b, "need", "energy");
  assert.equal(sleeping.actors[1].task?.station, bed);
  const upgraded = enableHousing(sleeping, "legacy");
  const assigned = setBedSleeper(upgraded, bed, a);
  const remaining = sleeping.actors[1].task!.remaining;
  const finished = advance(reload(assigned, old), remaining);
  assert.equal(finished.actors[1].task, null);
  assert.match(
    inspectOrder(finished, b, "home-use", bed).disabled ?? "",
    /専用の寝床/,
  );
  assert.ok(isGame(finished));
});

test("the assignment follows a moved bed and is pruned on removal independently of the resident's preference", () => {
  const origin = enableHousing(base(), "new");
  let game = setBedSleeper(origin, mat, a);
  game = setBedSleeper(game, bed, c);
  game = setPreferredBed(game, a, bed);
  const moved = applyHousingHouseEdit(
    game,
    editHouse(game.house, { type: "move", id: mat, room: "yard", cell: 6 }),
  );
  assert.equal(moved.error, undefined);
  assert.equal(getBedSleeper(moved.game, mat), a);
  assert.equal(
    inspectOrder(moved.game, a, "home-use", mat).facility?.roomId,
    "yard",
  );
  assert.match(
    inspectOrder(moved.game, b, "home-use", mat).disabled ?? "",
    /専用の寝床/,
  );
  const removed = applyHousingHouseEdit(
    moved.game,
    editHouse(moved.game.house, { type: "remove", id: mat }),
  );
  assert.equal(removed.error, undefined);
  assert.deepEqual(removed.game.housing!.bedSleepers, { [bed]: c });
  assert.equal(getPreferredBed(removed.game, a), bed);
  assert.equal(getBedSleeper(removed.game, mat), undefined);
  assert.equal(setBedSleeper(removed.game, mat, a), removed.game);
  reload(removed.game, origin);
  const last = applyHousingHouseEdit(
    removed.game,
    editHouse(removed.game.house, { type: "remove", id: bed }),
  );
  assert.equal(last.error, undefined);
  assert.equal(Object.hasOwn(last.game.housing!, "bedSleepers"), false);
  assert.equal(Object.hasOwn(last.game.housing!, "preferredBeds"), false);
});

test("old saves are shared by default; invalid assignments cannot initialize a map or enter an imported save", () => {
  const old = base();
  const home = enableHousing(old, "new");
  assert.equal(setBedSleeper(old, mat, a), old);
  assert.equal(getBedSleeper(reload(home, old), mat), undefined);
  for (const [fixtureId, resident] of [
    [mat, "missing"],
    [shelf, a],
    ["removed", a],
    ["__proto__", a],
    [mat, null],
  ] as const)
    assert.equal(setBedSleeper(home, fixtureId, resident), home);
  const assigned = setBedSleeper(home, mat, a);
  assert.equal(setBedSleeper(assigned, mat, a), assigned);
  for (const invalid of [
    null,
    [],
    {},
    { [mat]: "missing" },
    { [shelf]: b },
    { removed: a },
    { [mat]: false },
    { ["__proto__"]: a },
  ]) {
    const corrupt = structuredClone(assigned);
    Object.assign(corrupt.housing!, { bedSleepers: invalid });
    assert.equal(isGame(corrupt), false, JSON.stringify(invalid));
    assert.throws(() =>
      importSlot(
        exportSlot({ id: "bad", name: "破損", game: corrupt, origin: home }),
      ),
    );
  }
  reload(assigned, home);
});

test("the Life policy identifies same-name beds and residents, and a denied direct rest keeps its reason visible", async () => {
  register(
    "data:text/javascript," +
      encodeURIComponent(
        'export async function load(url, context, next) { if (url.endsWith(".css") || new URL(url).pathname.endsWith(".png")) return { format: "module", source: "export default " + JSON.stringify(url), shortCircuit: true }; return next(url, context); }',
      ),
  );
  const { Life } = await import("../src/reform/Life");
  const original = base();
  for (const p of original.actors) p.person.name = "ユウ";
  original.house.rooms[0].name = original.house.rooms[1].name = "広間";
  const origin = enableHousing(original, "new");
  function screen(game: Game, choice: string) {
    const before = JSON.stringify(game);
    const noop = () =>
      assert.fail("render must not save a setting or issue an order");
    const result = renderToStaticMarkup(
      createElement(Life, {
        game,
        selected: c,
        onSelect: noop,
        onGame: noop,
        facilitySelection: { choices: { energy: choice }, choose: noop },
      }),
    );
    assert.equal(JSON.stringify(game), before);
    return result;
  }
  assert.doesNotMatch(screen(original, ""), /寝床を使える住人/);
  const home = setBedSleeper(origin, bed, b);
  const html = screen(reload(home, origin), bed);
  const controls = html.match(
    /<span>寝床を使える住人<\/span>[\s\S]*?<\/summary>([\s\S]*?)<\/details>/,
  )?.[1];
  assert.ok(controls);
  assert.match(controls, /設定する寝床/);
  assert.match(controls, /利用できる住人/);
  assert.match(controls, /利用設定を保存/);
  assert.match(controls, /全員で共用/);
  assert.match(controls, /同名の1室目/);
  assert.match(controls, /同名の2室目/);
  for (const n of [1, 2, 3])
    assert.match(controls, new RegExp(`ユウ（同名の${n}人目）`));
  assert.match(controls, /現在の設定　ユウ（同名の2人目）専用/);
  const rest = html.match(
    /<div class="lf-command lf-facility-command">(?=<label[^>]*>休息に使う設備<\/label>)([\s\S]*?)<\/div>/,
  )?.[1];
  assert.ok(rest);
  assert.match(
    rest,
    /<option value="fixture-1" selected="">[^<]*ユウ（同名の2人目）専用<\/option>/,
  );
  assert.match(rest, /<button[^>]*disabled=""/);
  assert.match(rest, /role="status">[^<]*専用の寝床/);
  assert.doesNotMatch(rest, /休息先の寒さ対策/);
  assert.match(
    screen(setBedSleeper(home, bed, null), bed),
    /現在の設定　全員で共用/,
  );
});
