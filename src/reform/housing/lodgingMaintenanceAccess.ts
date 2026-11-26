import type { SpatialState } from "../spatial/types";
import { constructionPlan } from "./constructionTopology";
import type { RoomConstruction } from "./constructionTypes";
import {
  allowRoomVisit,
  constructionSlotId,
  effectiveRoomAccess,
  housingRoomId,
} from "./topology";
import type { HousingRuntime } from "./types";

type WorkPhase = NonNullable<RoomConstruction["assignment"]>["kind"];

/** The agreement covers its own room. A separate pickup room needs normal handling rights. */
export function permitsLodgingWork(
  h: HousingRuntime,
  plan: RoomConstruction,
  actorId: string,
  phase: WorkPhase,
) {
  const stay = h.lodging;
  if (
    stay?.phase !== "occupied" ||
    stay.maintenance?.phase !== "accepted" ||
    stay.maintenance.planId !== plan.id ||
    stay.providerId !== actorId ||
    plan.kind !== "insulation" ||
    plan.status !== "planned" ||
    plan.neighborId !== stay.roomId ||
    plan.material?.state !== "present" ||
    phase === "return"
  )
    return false;
  if (phase === "build") return true;
  const item = h.state.items[plan.material.itemId];
  const pickup =
    item.position.kind === "at"
      ? item.position.point
      : h.state.actors[actorId]?.order?.pickupPoint;
  if (!pickup) return false;
  const room = housingRoomId(pickup.domainId);
  if (!room) return false;
  const allowed = effectiveRoomAccess(room, h.controls, stay);
  return room === stay.roomId || allowed === null || allowed.includes(actorId);
}

/** This detached graph is used only for the provider's carry/build order; published permissions stay ordinary. */
export function lodgingWorkGraph(
  h: HousingRuntime,
  plan: RoomConstruction,
  actorId: string,
  phase: WorkPhase,
): SpatialState | undefined {
  if (!permitsLodgingWork(h, plan, actorId, phase)) return;
  const graph = structuredClone(h.state);
  allowRoomVisit(
    graph,
    plan.neighborId,
    actorId,
    phase === "build" ? [constructionSlotId(plan.id)] : [],
  );
  if (phase === "deliver") {
    const item = graph.items[plan.material!.itemId];
    if (
      item.carryAllowedActorIds &&
      !item.carryAllowedActorIds.includes(actorId)
    )
      item.carryAllowedActorIds = [
        ...item.carryAllowedActorIds,
        actorId,
      ].sort();
  }
  return graph;
}

export function activeLodgingWorkGraph(h: HousingRuntime) {
  const request = h.lodging?.maintenance;
  if (request?.phase !== "accepted") return;
  const plan = constructionPlan(h, request.planId);
  const assignment = plan?.assignment;
  if (!plan || !assignment?.lodgingMaintenance) return;
  const order = h.state.actors[assignment.actorId]?.order;
  if (
    !order ||
    order.id !== assignment.orderId ||
    order.phase === "exiting-after-cancel"
  )
    return;
  return lodgingWorkGraph(h, plan, assignment.actorId, assignment.kind);
}
