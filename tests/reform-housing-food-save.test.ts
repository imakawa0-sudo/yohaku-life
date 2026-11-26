import { issueSpatialOrder } from "../src/reform/spatial/actions";
import assert from "node:assert/strict";
import test from "node:test";
import {
  advance,
  inspectOrder,
  isGame,
  order,
  setHousingPassage,
  type Game,
} from "../src/reform/sim";
import { exportSlot, importSlot } from "../src/reform/library";
import {
  assignFoodHaul,
  createFoodBundle,
  returnFoodBundle,
} from "../src/reform/housing/food";
import { housingLinkId } from "../src/reform/housing/topology";
import { base, one, two, ok, reserved } from "./helpers/construction";

function cases() {
  const origin = base();
  origin.ingredients = 6;
  const result = createFoodBundle(order(origin, two, "need", "energy"), {
    roomId: "bedroom",
    storageCell: 2,
  });
  const idle = ok(result),
    id = result.bundleId!;
  const haul = ok(assignFoodHaul(idle, id, one, "store"));
  const held = advance(haul, 2),
    exit = order(held, one, "cancel");
  const stored = advance(haul, 6);
  const returning = ok(assignFoodHaul(stored, id, one, "return"));
  const selection = { fixtureId: "hearth-1", bundleId: id };
  const cook = order(stored, one, "work", "cook", selection);
  const use = advance(
    cook,
    inspectOrder(stored, one, "work", "cook", selection).foodBundle!
      .transportMinutes + 1,
  );
  const waiting = advance(
    setHousingPassage(haul, "link", housingLinkId("bedroom", "living"), false),
    3,
  );
  const consumed = advance(
    cook,
    inspectOrder(stored, one, "work", "cook", selection).minutes!,
  );
  return {
    origin,
    idle,
    haul,
    held,
    exit,
    waiting,
    stored,
    returning,
    cook,
    use,
    consumed,
    returned: ok(returnFoodBundle(idle, id)),
  };
}
test("real slot import resumes each bundle phase with identical world, time and stock", () => {
  const examples = cases();
  for (const [phase, g] of Object.entries(examples)) {
    assert.ok(isGame(g), phase);
    const slot = importSlot(
      exportSlot({ id: "food", name: "一束", game: g, origin: g }),
    );
    for (const saved of [slot.game, slot.origin])
      assert.deepEqual(advance(saved, 9), advance(g, 9), phase);
  }
  assert.equal(Object.hasOwn(examples.origin.housing!, "foodLogistics"), false);
  const refunded = advance(examples.returning, 6);
  assert.equal(refunded.housing!.foodLogistics!.bundle.state, "returned");
  assert.equal(refunded.ingredients, 6);
});

test("a construction stack and a food bundle coexist; corrupt relations, orphan items and receipts are rejected", () => {
  const { idle, haul, cook, use, consumed, origin } = cases();
  const mixed = ok(
    createFoodBundle(reserved(origin), { roomId: "bedroom", storageCell: 2 }),
  );
  assert.ok(isGame(mixed));
  assert.equal(Object.keys(mixed.housing!.state.items).length, 2);
  const damage = (source: Game, mutate: (h: any, b: any, g: Game) => void) => {
    const g = structuredClone(source);
    mutate(g.housing!, g.housing!.foodLogistics!.bundle, g);
    assert.equal(isGame(g), false, String(mutate));
  };
  for (const bad of [null, undefined]) {
    damage(idle, (h) => (h.foodLogistics = bad));
    damage(idle, (_, b) => (b.assignment = bad));
    damage(
      haul,
      (_, __, g) => (g.actors[0].task!.spatial!.foodBundleId = bad as never),
    );
  }
  damage(idle, (_, b) => (b.quantity = 1));
  damage(idle, (_, b) => (b.material = "wood"));
  damage(idle, (_, b) => (b.extra = true));
  damage(idle, (h, b) => (b.createdAt = h.state.time + 1));
  damage(idle, (h) => (h.foodLogistics.nextId = Number.MAX_SAFE_INTEGER + 1));
  damage(idle, (h) => (h.foodLogistics.nextId = 8));
  damage(idle, (h, b) => delete h.state.items[b.itemId]);
  damage(
    idle,
    (h, b) =>
      (h.state.items.alien = { ...h.state.items[b.itemId], id: "alien" }),
  );
  damage(
    mixed,
    (h, b) =>
      (b.itemId = Object.keys(h.state.items).find((id) =>
        id.startsWith("construction"),
      )),
  );
  damage(haul, (_, b) => (b.assignment.actorId = "missing"));
  damage(haul, (_, b) => (b.assignment.orderId = "order-789"));
  damage(haul, (_, b) => (b.assignment.kind = "return"));
  damage(haul, (_, b) => delete b.assignment);
  damage(cook, (_, __, g) => (g.actors[0].task!.station = "nonexistent"));
  damage(cook, (_, __, g) => (g.actors[0].task!.reserved = { ingredients: 2 }));
  damage(cook, (_, __, g) => (g.actors[0].task!.target = "cook:hard"));
  damage(
    cook,
    (_, __, g) =>
      (g.actors[0].task!.spatial!.constructionId = "construction-1"),
  );
  damage(
    use,
    (h, b) =>
      (h.state.items[b.itemId].position = { kind: "at", point: b.storage }),
  );
  damage(consumed, (h) =>
    Object.assign(h.state.items, idle.housing!.state.items),
  );
  damage(consumed, (_, b) => (b.settledAt = 0));
});

test("a valid spatial stove reservation cannot overlap the seat claimed by a bundle still in transit", () => {
  const { idle } = cases();
  const fixtureId = "hearth-1",
    bundleId = idle.housing!.foodLogistics!.bundle.id;
  const ordinary = order(idle, two, "work", "cook", { fixtureId });
  const t = ordinary.actors[1].task!;
  const g = order(order(idle, two, "cancel"), one, "work", "cook", {
    fixtureId,
    bundleId,
  });
  assert.ok(isGame(g));
  const use = issueSpatialOrder(g.housing!.state, {
    kind: "use",
    actorId: two,
    slotId: t.station!,
    useMinutes: t.total,
  });
  assert.ok(use.ok);
  g.housing!.state = use.state;
  g.actors[1].task = { ...t, spatial: { kind: "use", orderId: use.orderId } };
  assert.equal(isGame(g), false);
});
