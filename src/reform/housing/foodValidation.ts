import type { Game, Task } from "../sim";
import { sameSpatialPoint } from "../spatial/route";
import { constructionFloor } from "./constructionTopology";
import { foodHandling } from "./food";
import {
  foodBundleQuantity,
  type FoodLogistics,
  type PresentFood,
} from "./foodTypes";
import { fields, integer, point, record } from "./saveFields";
import { housingPoint } from "./topology";
import type { HousingRuntime, HousingTopology } from "./types";

export function isFoodLedger(
  value: unknown,
  now: number,
): value is FoodLogistics {
  if (
    !fields(value, ["version", "nextId", "bundle"]) ||
    value.version !== 1 ||
    !integer(value.nextId, 2)
  )
    return false;
  const b = value.bundle;
  const common = ["id", "material", "quantity", "createdAt", "state"];
  if (
    !record(b) ||
    b.id !== "food-bundle-" + (value.nextId - 1) ||
    b.material !== "vegetables" ||
    b.quantity !== foodBundleQuantity ||
    !integer(b.createdAt, 480, now)
  )
    return false;
  if (b.state !== "present")
    return (
      (b.state === "consumed" || b.state === "returned") &&
      fields(b, [...common, "settledAt"]) &&
      integer(b.settledAt, b.createdAt, now)
    );
  if (
    !fields(b, [...common, "itemId", "source", "storage"], ["assignment"]) ||
    b.itemId !== "food-material-" + (value.nextId - 1) ||
    !point(b.source) ||
    !sameSpatialPoint(b.source, housingPoint("living", 0)) ||
    !point(b.storage) ||
    sameSpatialPoint(b.source, b.storage)
  )
    return false;
  if (!Object.hasOwn(b, "assignment")) return true;
  const a = b.assignment;
  return (
    fields(a, ["kind", "actorId", "orderId"]) &&
    typeof a.actorId === "string" &&
    typeof a.orderId === "string" &&
    (a.kind === "store" || a.kind === "return" || a.kind === "cook")
  );
}

function validAssignment(
  h: HousingRuntime,
  b: PresentFood,
  t: Task,
  topology: HousingTopology,
) {
  const a = b.assignment!;
  const binding = t.spatial;
  if (
    !fields(binding, ["kind", "orderId", "foodBundleId"]) ||
    binding.foodBundleId !== b.id ||
    binding.orderId !== a.orderId ||
    !Object.hasOwn(h.state.actors, a.actorId) ||
    !fields(t.reserved, []) ||
    (t.mode !== "direct" &&
      !(t.mode === "auto" && a.kind === "store" && t.kind === "home-haul"))
  )
    return false;
  const order = h.state.actors[a.actorId].order;
  if (!order || order.id !== a.orderId || binding.kind !== order.intent.kind)
    return false;
  const taskFields = [
    "kind",
    "label",
    "total",
    "remaining",
    "from",
    "metric",
    "mode",
    "reserved",
    "spatial",
  ];
  const pos = h.state.items[b.itemId].position;
  let destination = a.kind === "store" ? b.storage : b.source;
  if (a.kind === "cook") {
    if (
      !fields(t, [...taskFields, "target", "room", "station"]) ||
      t.kind !== "work" ||
      t.metric !== "work" ||
      (t.target !== "cook" && t.target !== "cook:easy") ||
      typeof t.station !== "string" ||
      !Object.hasOwn(topology.slots, t.station)
    )
      return false;
    const slot = topology.slots[t.station];
    if (
      slot.roomId !== t.room ||
      slot.seat !== 0 ||
      (slot.kind !== "hearth" && slot.kind !== "kitchen")
    )
      return false;
    destination = slot.point;
    if (order.intent.kind === "use")
      return (
        order.intent.slotId === slot.id &&
        order.intent.useMinutes === t.total &&
        order.useRemaining === t.remaining &&
        pos.kind === "at" &&
        sameSpatialPoint(pos.point, destination)
      );
  } else if (
    !fields(t, taskFields) ||
    t.kind !== "home-haul" ||
    t.metric !== "travel" ||
    t.total !== 1
  )
    return false;
  return (
    order.intent.kind === "carry" &&
    t.total === t.remaining &&
    order.intent.payload.kind === "item" &&
    order.intent.payload.id === b.itemId &&
    sameSpatialPoint(order.intent.destination, destination) &&
    !!order.pickupPoint &&
    !sameSpatialPoint(order.pickupPoint, destination) &&
    (pos.kind === "at"
      ? sameSpatialPoint(pos.point, order.pickupPoint)
      : pos.kind === "carried" && pos.carrierId === a.actorId)
  );
}

export function validFoodRelations(
  h: HousingRuntime,
  g: Game,
  topology: HousingTopology,
) {
  const b = h.foodLogistics?.bundle;
  const expectedItems = new Set<string>();
  for (const plan of Object.values(h.construction?.plans ?? {})) {
    if (plan.material?.state === "present")
      expectedItems.add(plan.material.itemId);
  }
  if (b?.state === "present") {
    if (expectedItems.has(b.itemId)) return false;
    expectedItems.add(b.itemId);
  }
  const actual = Object.keys(h.state.items);
  if (
    actual.length !== expectedItems.size ||
    !actual.every((id) => expectedItems.has(id))
  )
    return false;

  const workers = g.actors.filter(
    (a) => a.task?.spatial && Object.hasOwn(a.task.spatial, "foodBundleId"),
  );
  if (b?.state !== "present") return workers.length === 0;
  if (!constructionFloor(h, b.storage) || !constructionFloor(h, b.source))
    return false;
  const item = h.state.items[b.itemId],
    pos = item.position;
  if (
    pos.kind === "at"
      ? !constructionFloor(h, pos.point)
      : pos.kind !== "carried" || !b.assignment
  )
    return false;
  if (b.assignment) {
    if (
      workers.length !== 1 ||
      workers[0].person.id !== b.assignment.actorId ||
      !validAssignment(h, b, workers[0].task!, topology)
    )
      return false;
  } else if (workers.length) return false;
  const expected = foodHandling(h, b),
    allowed = item.carryAllowedActorIds;
  return expected === null
    ? allowed === null
    : !!allowed &&
        expected.length === allowed.length &&
        expected.every((id, i) => id === allowed[i]);
}
