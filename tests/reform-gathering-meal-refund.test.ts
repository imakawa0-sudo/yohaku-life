import assert from "node:assert/strict";
import { register } from "node:module";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { editHouse, initialHouse } from "../src/reform/house";
import { startHousingGathering } from "../src/reform/housing/gathering";
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

const limit = 1_000_000_000;
const [host, guest] = [makePersona(0, 23), makePersona(1, 75)];
function overcommittedMeal(invite = false) {
  const house = editHouse(initialHouse(), {
    type: "build",
    room: "bedroom",
    kind: "table",
    cell: 5,
  });
  const origin = createGame(
    [host, guest],
    generateWorld(defaultWorldConfig()),
    "village",
    house,
  );
  origin.food = limit;
  let base = enableHousing(origin, "new");
  if (invite) base = setHousingRoomAccess(base, "bedroom", [host.id]);
  const booked = startHousingGathering(base, {
    kind: "meal",
    roomId: "bedroom",
    fixtureId: "fixture-1",
    actorIds: [host.id, guest.id],
    ...(invite && { invitation: { hostId: host.id, guestId: guest.id } }),
  });
  assert.equal(booked.food, limit - 2);
  // Previous saves could fill the two empty shelves while both meals were still refundable.
  booked.food = limit;
  assert.ok(booked.actors.every((a) => a.task?.reserved.food === 1));
  assert.ok(!Object.hasOwn(booked, "pendingMealReturns"));
  return { origin, booked };
}
function read(game: Game, origin: Game) {
  assert.ok(isGame(game));
  const recovered = importSlot(
    exportSlot({ id: "legacy-meal", name: "食事の返却", game, origin }),
  );
  assert.deepEqual(recovered.game, JSON.parse(JSON.stringify(game)));
  return recovered.game;
}
function cancelBoth(game: Game) {
  return order(order(game, host.id, "cancel"), guest.id, "cancel");
}

test("an older full pantry and two refundable portions survive import, cancellation, partial settlement and a second reload without loss or duplicate credit", () => {
  const { origin, booked } = overcommittedMeal();
  const legacy = read(booked, origin);
  assert.equal(legacy.food, limit);
  const one = order(legacy, host.id, "cancel");
  assert.equal(one.food, limit);
  assert.equal(one.pendingMealReturns, 1);
  assert.equal(one.actors[1].task?.reserved.food, 1);
  const pending = order(read(one, origin), guest.id, "cancel");
  assert.equal(pending.food, limit);
  assert.equal(pending.pendingMealReturns, 2);
  assert.equal(order(pending, host.id, "cancel").pendingMealReturns, 2);
  const hold = order(read(pending, origin), guest.id, "recover");
  assert.equal(hold.actors[1].task?.kind, "recover");
  const meal = (g: Game) => order(g, host.id, "home-use", "hearth-1");
  const serving = meal(hold);
  assert.equal(serving.food, limit - 1);
  assert.equal(serving.pendingMealReturns, 2);
  assert.equal(serving.actors[0].task?.reserved.food, 1);
  const undo = order(read(serving, origin), host.id, "cancel");
  assert.equal(undo.food, limit);
  assert.equal(undo.pendingMealReturns, 2);
  const minutes = inspectOrder(undo, host.id, "home-use", "hearth-1").minutes!;
  const last = advance(meal(undo), minutes - 1);
  assert.equal(last.pendingMealReturns, 2);
  const consumed = advance(read(last, origin), 1);
  assert.equal(consumed.actors[0].task, null);
  assert.equal(consumed.food, limit);
  assert.equal(consumed.pendingMealReturns, 1);
  const reloaded = read(consumed, origin);
  const duration = inspectOrder(
    reloaded,
    host.id,
    "home-use",
    "hearth-1",
  ).minutes!;
  const settled = advance(meal(reloaded), duration);
  assert.equal(settled.food, limit);
  assert.ok(!Object.hasOwn(settled, "pendingMealReturns"));
  assert.deepEqual(settled, advance(meal(consumed), duration));
  const paid = read(settled, origin);
  const next = advance(meal(paid), duration);
  assert.equal(next.food, limit - 1);
  assert.ok(!Object.hasOwn(next, "pendingMealReturns"));
});

test("a cancelled invitation in the doorway credits each deferred portion only after its real reservation is released", () => {
  const { origin, booked } = overcommittedMeal(true);
  const crossing = advance(read(booked, origin), 1);
  const cancelled = order(crossing, host.id, "cancel");
  assert.ok(cancelled.actors.every((a) => a.task?.reserved.food === 1));
  assert.ok(!Object.hasOwn(cancelled, "pendingMealReturns"));
  const mid = advance(read(cancelled, origin), 1);
  assert.ok(!Object.hasOwn(mid, "pendingMealReturns"));
  const released = advance(read(mid, origin), 1);
  assert.equal(released.food, limit);
  assert.equal(released.pendingMealReturns, 2);
  assert.ok(released.actors.every((a) => a.task === null));
  assert.equal(cancelBoth(read(released, origin)).pendingMealReturns, 2);
  assert.deepEqual(released, advance(cancelled, 2));
});

test("an invalid meal return amount or a receipt left alongside unused capacity is rejected in both save positions", () => {
  const { origin, booked } = overcommittedMeal();
  const pending = cancelBoth(booked);
  assert.equal(read(pending, origin).pendingMealReturns, 2);
  for (const wrong of [0, -1, 0.5, 3_000_000_001, null, "2", {}, [2]]) {
    const corrupt = Object.assign(structuredClone(pending), {
      pendingMealReturns: wrong,
    });
    assert.equal(isGame(corrupt), false, JSON.stringify(wrong));
    for (const slot of [
      { game: corrupt, origin },
      { game: origin, origin: corrupt },
    ]) {
      assert.throws(() =>
        importSlot(exportSlot({ ...slot, id: "bad", name: "破損" })),
      );
    }
  }
  const surplus = structuredClone(pending);
  surplus.food--;
  assert.equal(isGame(surplus), false);
  for (const slot of [
    { game: surplus, origin },
    { game: origin, origin: surplus },
  ]) {
    assert.throws(() =>
      importSlot(exportSlot({ ...slot, id: "bad", name: "未精算" })),
    );
  }
});

test("household supplies show the imported return count separately until two meals actually join the resident's cargo", async () => {
  register(
    "data:text/javascript," +
      encodeURIComponent(
        'export async function load(url, context, next) { if (url.endsWith(".css") || new URL(url).pathname.endsWith(".png")) return { format: "module", source: "export default " + JSON.stringify(url), shortCircuit: true }; return next(url, context); }',
      ),
  );
  const { Life } = await import("../src/reform/Life");
  const { origin, booked } = overcommittedMeal();
  const pending = read(cancelBoth(booked), origin);
  const supplies = (game: Game) => {
    const unexpected = () =>
      assert.fail("displaying supplies issued a command");
    const html = renderToStaticMarkup(
      createElement(Life, {
        game,
        selected: host.id,
        onSelect: unexpected,
        onGame: unexpected,
      }),
    );
    return (
      html.match(
        /<section\b[^>]*aria-label="世帯の備蓄"[^>]*>[\s\S]*?<\/section>/,
      )?.[0] ?? ""
    );
  };
  assert.match(supplies(pending), /返却待ちの食事 2食/);
  const holding = order(pending, host.id, "pack", "food");
  assert.equal(holding.actors[0].task?.reserved.food, 2);
  assert.equal(holding.actors[0].cargo.food, 0);
  assert.match(supplies(read(holding, origin)), /返却待ちの食事 2食/);
  const packed = advance(holding, 3);
  assert.equal(packed.actors[0].cargo.food, 2);
  assert.equal(packed.food, limit);
  assert.ok(!Object.hasOwn(packed, "pendingMealReturns"));
  const settledDisplay = supplies(read(packed, origin));
  assert.match(settledDisplay, /世帯の備蓄/);
  assert.doesNotMatch(settledDisplay, /返却待ちの食事/);
  for (const [key, label] of [
    ["wood", "木材 4本"],
    ["ingredients", "食材 3個"],
    ["coins", "銀貨 4枚"],
  ] as const) {
    const pack = order(origin, host.id, "pack", key);
    pack[key] = limit;
    pack.actors[0].cargo[key] = limit;
    const excess = read(advance(pack, 3), origin);
    assert.ok(
      supplies(excess).includes("積み込みから共同備蓄への返却待ち · " + label),
    );
    const retried = advance(
      order(order(excess, host.id, "recover"), guest.id, "pack", key),
      3,
    );
    assert.doesNotMatch(
      supplies(read(retried, origin)),
      /積み込みから共同備蓄への返却待ち/,
    );
  }
});
