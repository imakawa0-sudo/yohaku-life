import { isStockQuantity, type Actor, type Game } from "../sim";
import { cancelSpatialOrder, issueSpatialOrder } from "../spatial/actions";
import {
  inspectHousingRouteFrom,
  spatialReasonText,
  type HousingMinute,
} from "./bridge";
import {
  foodRoomAllows,
  presentFood,
  refreshFoodHandling,
  settleFood,
} from "./food";
import { buildHousingTopology } from "./topology";
import type { PresentFood } from "./foodTypes";

function release(g: Game, b: PresentFood, worker: Actor, reason: string) {
  delete b.assignment;
  worker.task = null;
  worker.reason = reason;
  refreshFoodHandling(g.housing!);
}
export function cancelFoodActor(g: Game, worker: Actor) {
  const h = g.housing!,
    b = presentFood(h)!;
  const id = worker.person.id;
  h.state = cancelSpatialOrder(h.state, id).state;
  if (h.state.actors[id].order)
    worker.reason = "この区間を出ると担当を外れます。食材は床に残ります。";
  else release(g, b, worker, "担当を外れました。一束は床に残っています。");
}

export function finishFoodHaul(g: Game, worker: Actor, tick: HousingMinute) {
  const b = presentFood(g.housing)!;
  if (tick.terminal === "cancel") {
    release(g, b, worker, "担当を外れました。一束は床に残っています。");
    return;
  }
  if (tick.terminal !== "finish") return;
  if (b.assignment!.kind === "cook") {
    const h = g.housing!,
      task = worker.task!;
    const issued = issueSpatialOrder(h.state, {
      kind: "use",
      actorId: worker.person.id,
      slotId: task.station!,
      useMinutes: task.total,
    });
    if (!issued.ok) {
      release(g, b, worker, spatialReasonText(issued.reason));
      return;
    }
    h.state = issued.state;
    task.spatial = { kind: "use", orderId: issued.orderId, foodBundleId: b.id };
    b.assignment!.orderId = issued.orderId;
    refreshFoodHandling(h);
    worker.reason = "一束を設備の使用床に下ろし、料理を始めます。";
    return;
  }
  const returning = b.assignment!.kind === "return";
  release(
    g,
    b,
    worker,
    returning ? "一束を供給口に下ろしました。" : "一束を保管床に下ろしました。",
  );
  if (returning)
    return () => {
      if (isStockQuantity(g.ingredients + b.quantity)) {
        g.ingredients += b.quantity;
        settleFood(g, b, "returned");
        worker.reason = "食材を共同備蓄に戻しました。";
      } else
        worker.reason = "共同備蓄に空きがないため、一束を供給口に残しました。";
    };
}

export function prepareFoodMinute(g: Game) {
  const h = g.housing,
    b = presentFood(h),
    assignment = b?.assignment;
  if (!h || !b || !assignment) return;
  const id = assignment.actorId,
    actor = g.actors.find((a) => a.person.id === id)!;
  const { order, position } = h.state.actors[id];
  if (!order || order.phase === "exiting-after-cancel") return;
  const allowed = h.state.items[b.itemId].carryAllowedActorIds;
  const slot = actor.task?.station && h.state.slots[actor.task.station];
  if (
    actor.danger ||
    actor.injury >= 70 ||
    (allowed !== null && !allowed.includes(id)) ||
    (slot &&
      slot.allowedActorIds !== null &&
      !slot.allowedActorIds.includes(id))
  ) {
    cancelFoodActor(g, actor);
    return;
  }
  // A locked door waits. An actual loss of entry permission releases the job safely.
  if (!Object.values(h.controls.roomAccess).some((list) => list !== null))
    return;
  const at =
    position.kind === "transit"
      ? position.step.to
      : position.kind === "at"
        ? position.point
        : null;
  if (!at) return;
  if (
    position.kind === "transit" &&
    position.step.from.domainId !== at.domainId &&
    !foodRoomAllows(h, at, id)
  ) {
    cancelFoodActor(g, actor);
    return;
  }
  // Test entry rights separately from closures so a closed link cannot hide a revocation.
  const graph =
    h.controls.closedLinks.length || h.controls.closedDoors.length
      ? {
          ...h.state,
          ...buildHousingTopology(
            g.house,
            Object.keys(h.state.actors),
            { ...h.controls, closedLinks: [], closedDoors: [] },
            h.state.actors,
            h.layoutVersion,
            h.construction,
            h.gatherings,
          ).geometry,
        }
      : h.state;
  const destination =
    order.intent.kind === "use"
      ? h.state.slots[order.intent.slotId].point
      : order.intent.destination;
  const points = [at];
  if (order.pickupPoint && h.state.items[b.itemId].position.kind === "at")
    points.push(order.pickupPoint);
  points.push(destination);
  for (let i = 1; i < points.length; i++) {
    const route = inspectHousingRouteFrom(
      g,
      h,
      id,
      points[i - 1],
      points[i],
      graph,
    );
    if (!route.ok && route.reason === "entry-denied") {
      cancelFoodActor(g, actor);
      return;
    }
  }
}
