import { settleMealInputReturns } from "../mealStock";
import { isStockQuantity, type Game } from "../sim";
import { issueSpatialOrder } from "../spatial/actions";
import { sameSpatialPoint } from "../spatial/route";
import type { SpatialPoint } from "../spatial/types";
import {
  inspectHousingRouteFrom,
  locateHousingActor,
  spatialReasonText,
} from "./bridge";
import { constructionFloor } from "./constructionTopology";
import {
  foodBundleQuantity,
  type FoodInspection,
  type FoodResult,
  type PresentFood,
} from "./foodTypes";
import { effectiveRoomAccess, housingPoint, housingRoomId } from "./topology";
import type { HousingRuntime } from "./types";
import { foodTaskMinutes } from "./foodPresentation";

export function presentFood(h?: HousingRuntime) {
  const b = h?.foodLogistics?.bundle;
  return b?.state === "present" ? b : undefined;
}

export function foodRoomAllows(
  h: HousingRuntime,
  point: SpatialPoint,
  id: string,
) {
  const list = effectiveRoomAccess(
    housingRoomId(point.domainId)!,
    h.controls,
    h.lodging,
  );
  return list === null || list?.includes(id);
}

export function foodHandling(h: HousingRuntime, b: PresentFood) {
  const pos = h.state.items[b.itemId].position;
  const order = b.assignment && h.state.actors[b.assignment.actorId]?.order;
  const pickup =
    order?.pickupPoint ?? (pos.kind === "at" ? pos.point : b.source);
  const points =
    order?.intent.kind === "carry"
      ? [pickup, order.intent.destination]
      : [pickup];
  if (
    points.every(
      (p) =>
        effectiveRoomAccess(
          housingRoomId(p.domainId)!,
          h.controls,
          h.lodging,
        ) === null,
    )
  )
    return null;
  return Object.keys(h.state.actors)
    .filter((id) => points.every((p) => foodRoomAllows(h, p, id)))
    .sort();
}

export function refreshFoodHandling(h: HousingRuntime) {
  const b = presentFood(h);
  if (b) h.state.items[b.itemId].carryAllowedActorIds = foodHandling(h, b);
}

export function createFoodBundle(
  game: Game,
  request: { roomId: string; storageCell: number },
): FoodResult {
  const h = game.housing;
  if (!h) return { game, error: "先に住居の移動を有効にしてください。" };
  if (presentFood(h))
    return {
      game,
      error: "先に今ある一束を使うか、共同備蓄へ戻してください。",
    };
  const source = housingPoint("living", 0);
  const storage = housingPoint(request.roomId, request.storageCell);
  if (!constructionFloor(h, storage) || sameSpatialPoint(source, storage))
    return { game, error: "供給口と異なる、歩ける保管床を選んでください。" };
  if (game.ingredients < foodBundleQuantity)
    return { game, error: "共同備蓄に食材2が必要です。" };
  const serial = h.foodLogistics?.nextId ?? 1;
  if (!Number.isSafeInteger(serial + 1))
    return { game, error: "一束の番号を発行できません。" };
  const next = structuredClone(game);
  const housing = next.housing!;
  const id = "food-bundle-" + serial,
    itemId = "food-material-" + serial;
  housing.foodLogistics = {
    version: 1,
    nextId: serial + 1,
    bundle: {
      id,
      material: "vegetables",
      quantity: foodBundleQuantity,
      createdAt: game.time,
      state: "present",
      source,
      storage,
      itemId,
    },
  };
  housing.state.items[itemId] = {
    id: itemId,
    position: { kind: "at", point: { ...source } },
    carryAllowedActorIds: null,
  };
  refreshFoodHandling(housing);
  next.ingredients -= foodBundleQuantity;
  settleMealInputReturns(next);
  return { game: next, bundleId: id };
}

export function settleFood(
  g: Game,
  b: PresentFood,
  state: "returned" | "consumed",
) {
  const h = g.housing!;
  delete h.state.items[b.itemId];
  const { id, material, quantity, createdAt } = b;
  h.foodLogistics!.bundle = {
    id,
    material,
    quantity,
    createdAt,
    state,
    settledAt: g.time,
  };
}

export function inspectFoodReturn(
  game: Game,
  bundleId: string,
): FoodInspection {
  const b = presentFood(game.housing);
  let disabled;
  if (!b || b.id !== bundleId || b.assignment)
    disabled = "担当のない一束を選んでください。";
  else {
    const pos = game.housing!.state.items[b.itemId].position;
    if (pos.kind !== "at" || !sameSpatialPoint(pos.point, b.source))
      disabled = "一束を先に供給口へ運んでください。";
    else if (!isStockQuantity(game.ingredients + b.quantity))
      disabled = "共同備蓄の食材に空きがありません。";
  }
  return disabled
    ? { ok: false, disabled, minutes: null }
    : { ok: true, minutes: 0 };
}

export function returnFoodBundle(game: Game, bundleId: string): FoodResult {
  const inspected = inspectFoodReturn(game, bundleId);
  if (!inspected.ok) return { game, error: inspected.disabled };
  const next = structuredClone(game),
    b = presentFood(next.housing)!;
  next.ingredients += b.quantity;
  settleFood(next, b, "returned");
  if (next.housing!.foodSupply) next.housing!.foodSupply.enabled = false;
  return { game: next, bundleId };
}

export function planFoodCarry(
  game: Game,
  h: HousingRuntime,
  b: PresentFood,
  actorId: string,
  destination: SpatialPoint,
) {
  const item = h.state.items[b.itemId],
    at = h.state.actors[actorId].position;
  if (item.position.kind !== "at" || at.kind !== "at")
    return { ok: false as const, reason: "payload-unavailable" as const };
  const pickup = item.position.point;
  if (
    !foodRoomAllows(h, pickup, actorId) ||
    !foodRoomAllows(h, destination, actorId)
  )
    return { ok: false as const, reason: "handling-denied" as const };
  const approach = inspectHousingRouteFrom(game, h, actorId, at.point, pickup);
  if (!approach.ok) return approach;
  const onward = inspectHousingRouteFrom(game, h, actorId, pickup, destination);
  if (!onward.ok) return onward;
  const issued = issueSpatialOrder(h.state, {
    kind: "carry",
    actorId,
    payload: { kind: "item", id: b.itemId },
    destination,
  });
  return issued.ok
    ? { ...issued, minutes: Math.max(1, approach.minutes) + onward.minutes }
    : issued;
}

export function assignFoodHaul(
  game: Game,
  bundleId: string,
  actorId: string,
  direction: "store" | "return",
): FoodResult {
  const b = presentFood(game.housing);
  if (
    !b ||
    b.id !== bundleId ||
    b.assignment ||
    !["store", "return"].includes(direction)
  )
    return { game, error: "今はこの一束を運べません。" };
  const actor = game.actors.find((a) => a.person.id === actorId);
  if (
    !actor ||
    actor.task ||
    actor.location !== game.home ||
    actor.injury >= 70 ||
    actor.danger
  )
    return {
      game,
      error: "自宅で手が空いていて、安全に運べる住人を選んでください。",
    };
  const next = structuredClone(game),
    h = next.housing!,
    bundle = presentFood(h)!;
  const worker = next.actors.find((a) => a.person.id === actorId)!;
  if (!Object.hasOwn(h.state.actors, actorId))
    locateHousingActor(next, h, actorId, housingPoint(worker.room, 0));
  const destination = direction === "store" ? b.storage : b.source;
  const pos = h.state.items[b.itemId].position;
  if (pos.kind !== "at" || sameSpatialPoint(pos.point, destination))
    return { game, error: "一束はすでに届け先にあるか、運搬中です。" };
  const issued = planFoodCarry(next, h, bundle, actorId, destination);
  if (!issued.ok) return { game, error: spatialReasonText(issued.reason) };
  h.state = issued.state;
  bundle.assignment = { actorId, kind: direction, orderId: issued.orderId };
  const label =
    direction === "store" ? "食材を保管床へ運ぶ" : "食材を供給口へ運び戻す";
  worker.task = {
    kind: "home-haul",
    mode: "direct",
    from: worker.location,
    metric: "travel",
    total: 1,
    remaining: 1,
    label,
    reserved: {},
    spatial: { kind: "carry", orderId: issued.orderId, foodBundleId: bundleId },
  };
  worker.reason = label + "よう指示されています。";
  refreshFoodHandling(h);
  if (direction === "return" && h.foodSupply) h.foodSupply.enabled = false;
  return { game: next, bundleId };
}

export function inspectFoodHaul(
  game: Game,
  bundleId: string,
  actorId: string,
  direction: "store" | "return",
): FoodInspection {
  const result = assignFoodHaul(game, bundleId, actorId, direction);
  return result.error
    ? { ok: false, minutes: null, disabled: result.error }
    : { ok: true, minutes: foodTaskMinutes(result.game, actorId) };
}
