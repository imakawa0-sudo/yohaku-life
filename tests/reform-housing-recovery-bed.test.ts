import assert from "node:assert/strict";
import test from "node:test";
import { register } from "node:module";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { editHouse, initialHouse } from "../src/reform/house";
import {
  setBedSleeper,
  setPreferredBed,
} from "../src/reform/housing/bedPreference";
import { housingLinkId, housingSlotId } from "../src/reform/housing/topology";
import { exportSlot, importSlot } from "../src/reform/library";
import { makePersona } from "../src/reform/peopleModel";
import {
  advance,
  createGame,
  enableHousing,
  inspectOrder,
  isGame,
  options,
  order,
  setHousingPassage,
  setHousingRoomAccess,
  type Game,
} from "../src/reform/sim";
import { defaultWorldConfig, generateWorld } from "../src/reform/world";

const patient = makePersona(0, 23),
  helper = makePersona(1, 75);
const bed = "fixture-1",
  mat = "mat-1";
const p = patient.id,
  h = helper.id;
function oldHome(injury = 38) {
  const house = editHouse(initialHouse(), {
    type: "build",
    room: "living",
    kind: "bed",
    cell: 7,
  });
  const game = createGame(
    [patient, helper],
    generateWorld(defaultWorldConfig()),
    "village",
    house,
  );
  game.actors[0].injury = injury;
  game.actors[0].needs.energy = 45;
  return game;
}
function home(injury = 38) {
  return enableHousing(oldHome(injury), "new");
}
function preview(game: Game, id: string) {
  return inspectOrder(game, p, "recover", undefined, { fixtureId: id });
}
function recover(game: Game, id: string) {
  return order(game, p, "recover", undefined, { fixtureId: id });
}
function reload(game: Game, origin: Game) {
  assert.ok(isGame(game));
  const loaded = importSlot(
    exportSlot({ id: "test", name: "療養", game, origin }),
  );
  assert.deepEqual(loaded.game, JSON.parse(JSON.stringify(game)));
  return loaded.game;
}
function walkTo(game: Game, id: string, room: string, cell: number) {
  const target = JSON.stringify({ roomId: room, cell });
  const duration = inspectOrder(game, id, "home-move", target).minutes!;
  return advance(order(game, id, "home-move", target), duration);
}

test("choosing a bed or mat for recovery adds only its walk, books the seat for 65 minutes, and pays the existing recovery once", () => {
  for (const [fixtureId, room] of [
    [bed, "living"],
    [mat, "bedroom"],
  ] as const) {
    const start = home();
    const original = JSON.stringify(start);
    const expected = preview(start, fixtureId);
    assert.equal(expected.disabled, undefined);
    assert.equal(expected.facility!.fixtureId, fixtureId);
    const walk = expected.facility!.moveMinutes;
    assert.ok(walk > 0);
    assert.equal(expected.facility!.useMinutes, 65);
    assert.equal(expected.minutes, walk + 65);
    const active = recover(start, fixtureId);
    assert.equal(JSON.stringify(start), original);
    assert.equal(active.time, start.time);
    const task = active.actors[0].task!;
    assert.equal(task.kind, "recover");
    assert.equal(task.mode, "direct");
    assert.equal(task.metric, "care");
    assert.equal(task.total, 65);
    assert.equal(task.station, housingSlotId(room, fixtureId, 0));
    assert.deepEqual(task.reserved, {});
    const atBed = advance(active, walk);
    assert.equal(atBed.actors[0].task!.remaining, 65);
    const last = advance(atBed, 64);
    assert.equal(last.actors[0].injury, 38);
    const done = advance(last, 1);
    assert.equal(done.actors[0].injury, 26);
    assert.equal(done.actors[0].task, null);
    assert.ok(
      Math.abs(
        done.actors[0].needs.energy -
          (last.actors[0].needs.energy - 0.095 + 27),
      ) < 1e-8,
    );
    assert.equal(
      done.actors[0].metrics.care - start.actors[0].metrics.care,
      65,
    );
    assert.equal(
      done.actors[0].metrics.travel - start.actors[0].metrics.travel,
      walk,
    );
    for (const checkpoint of [active, advance(active, 1), atBed, last]) {
      const remaining = done.time - checkpoint.time;
      assert.equal(
        JSON.stringify(advance(reload(checkpoint, start), remaining)),
        JSON.stringify(done),
      );
    }
    assert.ok(
      !Object.values(done.housing!.state.reservations).some(
        (reservation) =>
          reservation.kind === "slot" && reservation.targetId === task.station,
      ),
    );
    assert.equal(
      inspectOrder(done, h, "home-use", fixtureId).disabled,
      undefined,
    );
    const after = advance(order(reload(done, start), p, "wait"), 1);
    assert.equal(after.actors[0].injury, 26);
  }
});

test("field and legacy recovery and unselected autonomous home recovery keep their original in-place path", () => {
  for (const injury of [38, 76]) {
    const old = oldHome(injury);
    const field = oldHome(injury);
    field.actors[0].location = "pass";
    field.actors[0].room = "outdoors";
    for (const game of [
      old,
      enableHousing(field, "legacy"),
      setPreferredBed(home(injury), p, mat),
    ]) {
      const atHome = !!game.housing && game.actors[0].location === game.home;
      assert.equal(inspectOrder(game, p, "recover").minutes, 65);
      const active = order(game, p, "recover");
      assert.equal(active.actors[0].task?.spatial, undefined);
      assert.equal(active.actors[0].task?.station, undefined);
      const mid = advance(active, 21);
      const done = advance(reload(mid, game), 44);
      assert.equal(done.actors[0].injury, injury - 12);
      if (!atHome) assert.ok(preview(game, mat).disabled);
    }
  }
  const danger = home();
  danger.actors[0].danger = true;
  assert.ok(preview(danger, mat).disabled);
  assert.equal(inspectOrder(danger, p, "recover").minutes, 65);
  const outbound = order(home(), p, "travel", "pass");
  assert.equal(outbound.housing!.unlocated[p].reason, "regional-travel");
  assert.ok(preview(outbound, bed).disabled);
  assert.deepEqual(recover(outbound, bed).actors, outbound.actors);
  const unattended = setPreferredBed(home(76), p, bed);
  const automatic = advance(unattended, 1);
  assert.equal(automatic.actors[0].task!.kind, "recover");
  assert.equal(automatic.actors[0].task!.mode, "auto");
  assert.equal(automatic.actors[0].task!.station, undefined);
});

test("severe injury requires an already occupied use floor; an unknown position cannot invent a short walk", () => {
  const urgent = home(70);
  const original = JSON.stringify(urgent);
  assert.ok(preview(urgent, bed).disabled);
  assert.deepEqual(recover(urgent, bed).actors, urgent.actors);
  assert.equal(JSON.stringify(urgent), original);
  assert.ok(preview(enableHousing(oldHome(76), "legacy"), bed).disabled);
  const milder = home(69);
  assert.ok(preview(milder, bed).minutes);
  const slot =
    milder.housing!.state.slots[housingSlotId("living", bed, 0)].point;
  const located = walkTo(milder, p, "living", slot.cell);
  located.actors[0].injury = 76;
  const here = preview(located, bed);
  assert.equal(here.facility!.moveMinutes, 0);
  assert.equal(here.minutes, 65);
  const done = advance(recover(located, bed), 65);
  assert.equal(done.actors[0].injury, 64);
  assert.deepEqual(done.housing!.state.actors[p].position, {
    kind: "at",
    point: slot,
  });
});

test("one-off selection honors exclusive beds, access and existing reservations and never redirects a refused order", () => {
  const origin = home();
  const busy = order(origin, p, "work", "cook");
  const cases: [Game, RegExp][] = [
    [setBedSleeper(busy, mat, h), /専用/],
    [setHousingRoomAccess(busy, "bedroom", [h]), /許可/],
    [
      setHousingPassage(
        busy,
        "link",
        housingLinkId("living", "bedroom"),
        false,
      ),
      /通路/,
    ],
    [order(busy, h, "home-use", mat), /予約/],
  ];
  for (const [state, reason] of cases) {
    assert.match(preview(state, mat).disabled ?? "", reason);
    const denied = recover(state, mat);
    assert.deepEqual(denied.actors, state.actors);
    assert.deepEqual(denied.housing, state.housing);
    assert.equal(denied.ingredients, state.ingredients);
  }
  for (const bad of [
    { fixtureId: "hearth-1" },
    { fixtureId: "gone" },
    { fixtureId: bed, bundleId: "food-1" },
  ])
    assert.ok(inspectOrder(busy, p, "recover", undefined, bad).disabled);
  assert.ok(
    inspectOrder(busy, p, "recover", "unexpected", { fixtureId: mat }).disabled,
  );
  const active = recover(setPreferredBed(origin, p, bed), mat);
  assert.equal(
    active.actors[0].task!.station,
    housingSlotId("bedroom", mat, 0),
  );
  assert.match(inspectOrder(active, h, "home-use", mat).disabled ?? "", /予約/);
  assert.equal(inspectOrder(active, h, "home-use", bed).disabled, undefined);
});

test("blocked routes wait, and cancelling mid-walk or near the end releases the bed without early healing", () => {
  const origin = home();
  const active = recover(origin, mat);
  const lock = housingLinkId("living", "bedroom");
  const blocked = advance(setHousingPassage(active, "link", lock, false), 15);
  assert.equal(blocked.housing!.state.actors[p].order?.phase, "waiting");
  assert.equal(blocked.actors[0].task?.remaining, 65);
  assert.equal(blocked.actors[0].injury, 38);
  const opened = setHousingPassage(reload(blocked, origin), "link", lock, true);
  assert.equal(
    advance(opened, preview(origin, mat).minutes!).actors[0].injury,
    26,
  );
  const mid = advance(active, 1);
  const cancelling = order(mid, p, "cancel");
  assert.equal(
    cancelling.housing!.state.actors[p].order?.phase,
    "exiting-after-cancel",
  );
  const stopped = advance(reload(cancelling, origin), 2);
  const last = advance(active, preview(origin, mat).minutes! - 1);
  for (const g of [stopped, order(last, p, "cancel")]) {
    assert.equal(g.actors[0].task, null);
    assert.equal(g.actors[0].injury, 38);
    assert.ok(g.actors[0].needs.energy < origin.actors[0].needs.energy);
    assert.equal(inspectOrder(g, h, "home-use", mat).disabled, undefined);
    reload(g, origin);
  }
});

test("helpers can reach the bedside, and a separate aid order is available only after the patient's direct job finishes", () => {
  const origin = home();
  const point =
    origin.housing!.state.slots[housingSlotId("bedroom", mat, 0)].point;
  const going = recover(origin, mat);
  const together = walkTo(going, h, "bedroom", point.cell);
  assert.match(
    inspectOrder(together, h, "aid", p).disabled ?? "",
    /別の行動中/,
  );
  assert.equal(together.actors[0].task!.remaining, 65);
  const keepingPlace = order(together, h, "recover"); // Same 65 minutes, without occupying a bed.
  const rested = advance(keepingPlace, 65);
  assert.equal(rested.actors[0].injury, 26);
  assert.equal(inspectOrder(rested, h, "aid", p).disabled, undefined);
  const treatment = order(rested, h, "aid", p);
  assert.equal(treatment.actors[1].task!.partner, p);
});

test("the import validator rejects mismatched recovery seats, moments, stock, participant and reward bindings", () => {
  const origin = home();
  const active = recover(origin, mat);
  for (const patch of [
    { mode: "auto" },
    { metric: "work" },
    { target: "energy" },
    { reserved: { wood: 1 } },
    { total: 66 },
    { remaining: 64 },
    { partner: h },
    { follower: true },
    { spatial: { ...active.actors[0].task!.spatial, foodBundleId: "food-1" } },
    {
      spatial: { ...active.actors[0].task!.spatial, mealPartners: { [h]: 1 } },
    },
  ]) {
    const bad = structuredClone(active);
    Object.assign(bad.actors[0].task!, patch);
    assert.equal(isGame(bad), false, JSON.stringify(patch));
    assert.throws(() =>
      importSlot(exportSlot({ id: "bad", name: "破損", game: bad, origin })),
    );
  }
  const atHearth = order(origin, p, "work", "cook");
  Object.assign(atHearth.actors[0].task!, {
    kind: "recover",
    target: undefined,
    reserved: {},
    metric: "care",
  });
  assert.equal(isGame(atHearth), false);
});

test("the field action offers in-place recovery and named beds at home, and keeps the original recovery button outside", async () => {
  register(
    "data:text/javascript," +
      encodeURIComponent(
        'export async function load(url, context, next) { if (url.endsWith(".css") || new URL(url).pathname.endsWith(".png")) return { format: "module", source: "export default " + JSON.stringify(url), shortCircuit: true }; return next(url, context); }',
      ),
  );
  const { ActionCommands } = await import("../src/reform/Life");
  const unexpected = () => assert.fail("choosing a preview issued an order");
  const html = (game: Game, selected = "") => {
    const before = JSON.stringify(game);
    const commands = options(game, p).filter(
      (c) => c.kind === "recover" && c.group === "field",
    );
    assert.equal(commands.length, 1);
    const result = renderToStaticMarkup(
      createElement(ActionCommands, {
        game,
        actor: game.actors[0],
        commands,
        group: "field",
        cancelling: false,
        facilitySelection: {
          choices: { recover: selected },
          choose: unexpected,
        },
        onGame: unexpected,
      }),
    );
    assert.equal(JSON.stringify(game), before);
    return result;
  };
  const origin = home();
  const ordinary = html(origin);
  assert.match(ordinary, /傷を休める場所/);
  assert.match(
    ordinary,
    /<option value="" selected="">今いる場所で休む<\/option>/,
  );
  assert.match(ordinary, /移動なし · 療養65分/);
  const explicit = html(origin, mat);
  assert.match(explicit, /<option value="mat-1" selected="">寝室・敷きむしろ/);
  assert.match(explicit, /移動6分 ＋ 療養65分（合計71分）/);
  const blocked = html(home(76), mat);
  assert.match(blocked, /<button[^>]*disabled=""/);
  assert.match(blocked, /重い傷/);
  assert.doesNotMatch(blocked, /合計71分/);
  const unsafe = home();
  unsafe.actors[0].danger = true;
  const outdoor = oldHome();
  outdoor.actors[0].location = "pass";
  outdoor.actors[0].room = "outdoors";
  for (const game of [
    oldHome(),
    unsafe,
    order(home(), p, "travel", "pass"),
    enableHousing(outdoor, "legacy"),
  ]) {
    const out = html(game, mat);
    assert.match(out, /data-kind="recover"/);
    assert.doesNotMatch(out, /傷を休める場所/);
  }
});
