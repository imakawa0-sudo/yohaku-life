import { isIndoorHousingRoom } from "./coldProtection";
import { fields, integer, point, record } from "./saveFields";
import type { Game } from "../sim";
import { sameSpatialPoint } from "../spatial/route";
import {
  constructionFloor,
  constructionHandling,
  unresolvedConstruction,
} from "./constructionTopology";
import {
  constructionWood,
  constructionWorkMinutes,
  type HousingConstruction,
  type RoomConstruction,
} from "./constructionTypes";
import { constructionSlotId, housingPoint } from "./topology";
import type { HousingRuntime } from "./types";

function issued(value: unknown, prefix: string, next: number) {
  if (typeof value !== "string") return false;
  const serial = Number(value.slice(prefix.length));
  return integer(serial, 1, next - 1) && value === prefix + serial;
}
function planShape(
  value: unknown,
  id: string,
  next: number,
  now: number,
): value is RoomConstruction {
  if (
    !fields(
      value,
      [
        "id",
        "name",
        "neighborId",
        "source",
        "staging",
        "createdAt",
        "requiredWood",
        "workMinutes",
        "workedMinutes",
        "status",
      ],
      [
        "kind",
        "cancelledAt",
        "completedAt",
        "roomId",
        "material",
        "assignment",
      ],
    ) ||
    value.id !== id ||
    !issued(id, "construction-", next) ||
    typeof value.name !== "string" ||
    !value.name.length ||
    value.name.length > 24 ||
    value.name.trim() !== value.name ||
    typeof value.neighborId !== "string" ||
    !value.neighborId ||
    !point(value.source) ||
    !point(value.staging) ||
    !sameSpatialPoint(value.source, housingPoint("living", 0)) ||
    value.staging.domainId !== housingPoint(value.neighborId, 0).domainId ||
    sameSpatialPoint(value.source, value.staging) ||
    !integer(value.createdAt, 480, now) ||
    (Object.hasOwn(value, "kind") && value.kind !== "insulation") ||
    value.requiredWood !==
      (value.kind === "insulation" ? 1 : constructionWood) ||
    value.workMinutes !== constructionWorkMinutes ||
    !integer(value.workedMinutes, 0, constructionWorkMinutes) ||
    (value.workedMinutes > 0 &&
      (!Object.hasOwn(value, "material") ||
        value.workedMinutes > now - value.createdAt)) ||
    (value.status !== "planned" &&
      value.status !== "cancelled" &&
      value.status !== "completed") ||
    (value.status === "completed"
      ? !integer(value.completedAt, value.createdAt + value.workMinutes, now) ||
        typeof value.roomId !== "string" ||
        (value.kind === "insulation"
          ? value.roomId !== value.neighborId
          : !/^room-[1-9]\d*$/.test(value.roomId) ||
            value.roomId === value.neighborId) ||
        value.workedMinutes !== value.workMinutes ||
        !fields(value.material, ["itemId", "quantity", "state"]) ||
        value.material.state !== "consumed"
      : Object.hasOwn(value, "completedAt") ||
        Object.hasOwn(value, "roomId")) ||
    (value.status === "cancelled"
      ? !integer(value.cancelledAt, value.createdAt + value.workedMinutes, now)
      : Object.hasOwn(value, "cancelledAt"))
  )
    return false;
  if (Object.hasOwn(value, "material")) {
    const m = value.material;
    if (
      !fields(m, ["itemId", "quantity", "state"]) ||
      m.itemId !==
        "construction-material-" + id.slice("construction-".length) ||
      m.quantity !== value.requiredWood ||
      (m.state !== "present" &&
        !(m.state === "returned" && value.status === "cancelled") &&
        !(m.state === "consumed" && value.status === "completed"))
    )
      return false;
  }
  if (Object.hasOwn(value, "assignment")) {
    const a = value.assignment;
    if (
      !record(a) ||
      !fields(a, [
        "actorId",
        "orderId",
        "kind",
        ...(a.kind === "build" ? ["startedWorkMinutes"] : []),
      ]) ||
      typeof a.actorId !== "string" ||
      typeof a.orderId !== "string" ||
      (a.kind === "build"
        ? !integer(a.startedWorkMinutes, 0, value.workedMinutes)
        : a.kind !== "deliver" && a.kind !== "return")
    )
      return false;
  }
  return true;
}
export function isConstructionLedger(
  value: unknown,
  now: number,
): value is HousingConstruction {
  return (
    fields(value, ["version", "nextId", "plans"]) &&
    value.version === 1 &&
    integer(value.nextId, 2) &&
    record(value.plans) &&
    Object.keys(value.plans).length === value.nextId - 1 &&
    Object.entries(value.plans).every(([id, p]) =>
      planShape(p, id, value.nextId as number, now),
    )
  );
}

function validAssignment(h: HousingRuntime, g: Game, plan: RoomConstruction) {
  const a = plan.assignment!;
  const task = g.actors.find((person) => person.person.id === a.actorId)?.task;
  if (a.kind === "build") {
    if (
      !task ||
      !fields(task, [
        "kind",
        "label",
        "total",
        "remaining",
        "from",
        "mode",
        "metric",
        "reserved",
        "room",
        "station",
        "spatial",
      ]) ||
      !Object.hasOwn(h.state.actors, a.actorId) ||
      plan.material?.state !== "present"
    )
      return false;
    const order = h.state.actors[a.actorId].order;
    const pos = h.state.items[plan.material.itemId].position;
    return (
      !!order &&
      order.id === a.orderId &&
      order.intent.kind === "use" &&
      order.intent.slotId === constructionSlotId(plan.id) &&
      (plan.status === "planned" ||
        (plan.status === "cancelled" &&
          order.phase === "exiting-after-cancel")) &&
      pos.kind === "at" &&
      sameSpatialPoint(pos.point, plan.staging) &&
      task.kind === "home-build" &&
      task.mode === "direct" &&
      task.metric === "work" &&
      task.room === plan.neighborId &&
      task.station === order.intent.slotId &&
      fields(task.reserved, []) &&
      fields(task.spatial, ["kind", "orderId", "constructionId"]) &&
      task.spatial.kind === "use" &&
      task.spatial.orderId === a.orderId &&
      task.spatial.constructionId === plan.id &&
      order.intent.useMinutes === plan.workMinutes - a.startedWorkMinutes &&
      task.total === order.intent.useMinutes &&
      order.useRemaining === plan.workMinutes - plan.workedMinutes &&
      task.remaining === order.useRemaining
    );
  }
  if (
    !task ||
    !fields(task, [
      "kind",
      "label",
      "total",
      "remaining",
      "from",
      "mode",
      "metric",
      "reserved",
      "spatial",
    ]) ||
    task.kind !== "home-haul" ||
    task.mode !== "direct" ||
    task.metric !== "travel" ||
    task.total !== 1 ||
    task.remaining !== 1 ||
    !fields(task.reserved, []) ||
    !fields(task.spatial, ["kind", "orderId", "constructionId", "direction"]) ||
    task.spatial.constructionId !== plan.id ||
    task.spatial.kind !== "carry" ||
    task.spatial.direction !== a.kind ||
    task.spatial.orderId !== a.orderId ||
    !Object.hasOwn(h.state.actors, a.actorId) ||
    plan.material?.state !== "present"
  )
    return false;
  const order = h.state.actors[a.actorId].order;
  if (
    order?.id !== a.orderId ||
    order.intent.kind !== "carry" ||
    !order.pickupPoint ||
    order.intent.payload.kind !== "item" ||
    order.intent.payload.id !== plan.material.itemId ||
    (a.kind === "return"
      ? plan.status !== "cancelled"
      : plan.status === "cancelled" &&
        order.phase !== "exiting-after-cancel") ||
    !sameSpatialPoint(
      order.intent.destination,
      a.kind === "return" ? plan.source : plan.staging,
    ) ||
    sameSpatialPoint(order.pickupPoint, order.intent.destination)
  )
    return false;
  const pos = h.state.items[plan.material.itemId].position;
  // The spatial codec already checks the bidirectional payload reservation and carrier.
  return pos.kind === "at"
    ? sameSpatialPoint(pos.point, order.pickupPoint)
    : pos.kind === "carried" && pos.carrierId === a.actorId;
}
function validPlanRelations(
  h: HousingRuntime,
  g: Game,
  plan: RoomConstruction,
) {
  const mat = plan.material;
  if (
    unresolvedConstruction(plan) &&
    (!constructionFloor(h, plan.staging) || !constructionFloor(h, plan.source))
  )
    return false;
  if (mat?.state !== "present") return !plan.assignment;
  if (!Object.hasOwn(h.state.items, mat.itemId)) return false;
  const item = h.state.items[mat.itemId],
    pos = item.position;
  if (
    pos.kind === "at"
      ? !constructionFloor(h, pos.point)
      : pos.kind !== "carried" || !plan.assignment
  )
    return false;
  if (
    plan.status === "planned" &&
    plan.workedMinutes > 0 &&
    (pos.kind !== "at" || !sameSpatialPoint(pos.point, plan.staging))
  )
    return false;
  if (plan.assignment && !validAssignment(h, g, plan)) return false;
  const expected = constructionHandling(h, plan),
    actual = item.carryAllowedActorIds;
  return expected === null
    ? actual === null
    : actual !== null &&
        expected.length === actual.length &&
        expected.every((id, i) => id === actual[i]);
}
export function validConstructionRelations(
  h: HousingRuntime,
  g: Game,
): boolean {
  const workers = g.actors.filter(
    (a) =>
      (a.task?.kind === "home-haul" && !a.task.spatial?.foodBundleId) ||
      a.task?.kind === "home-build" ||
      (a.task?.spatial && Object.hasOwn(a.task.spatial, "constructionId")),
  );
  if (!h.construction) return !workers.length;
  const ledger = h.construction;
  const completedRoomIds: string[] = [];
  const insulated = new Set<string>();
  const futureRooms = new Set(
    Object.values(ledger.plans)
      .filter((p) => !p.kind && p.status === "completed")
      .map((p) => p.roomId!),
  );
  let lastEnd = 480,
    assigned = 0;
  // Records are retained and issued once. Only the latest can still hold the work site.
  for (let serial = 1; serial < ledger.nextId; serial++) {
    const p = ledger.plans["construction-" + serial];
    if (p.kind === "insulation") {
      if (
        !isIndoorHousingRoom(g, p.neighborId) ||
        futureRooms.has(p.neighborId) ||
        insulated.has(p.neighborId)
      )
        return false;
      if (p.status === "completed") insulated.add(p.neighborId);
    } else {
      if (!g.house.rooms.some((room) => room.id === p.neighborId)) return false;
      if (p.status === "completed") {
        completedRoomIds.push(p.roomId!);
        futureRooms.delete(p.roomId!);
      }
    }
    if (
      p.createdAt < lastEnd ||
      (unresolvedConstruction(p) && serial !== ledger.nextId - 1) ||
      !validPlanRelations(h, g, p)
    )
      return false;
    lastEnd = p.completedAt ?? p.cancelledAt ?? p.createdAt;
    if (p.assignment) assigned++;
  }
  if (assigned !== workers.length) return false;
  if (!completedRoomIds.length) return true;
  // Setup and older rooms predate construction. Furniture can leave gaps in the shared sequence.
  const issuedRooms = g.house.rooms
    .map((room) => room.id)
    .filter((id) => issued(id, "room-", g.house.nextId))
    .sort(
      (a, b) =>
        Number(a.slice("room-".length)) - Number(b.slice("room-".length)),
    );
  const start = issuedRooms.length - completedRoomIds.length;
  return completedRoomIds.every((id, i) => id === issuedRooms[start + i]);
}
