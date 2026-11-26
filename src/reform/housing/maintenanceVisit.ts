import type { SpatialPoint } from "../spatial/types";
import { constructionPlan } from "./constructionTopology";
import { record } from "./saveFields";
import { effectiveRoomAccess, housingPoint } from "./topology";
import type { HousingRuntime } from "./types";

/** Only an actual delegated crossing into a normally private room starts a work visit. */
export function recordMaintenanceEntry(h: HousingRuntime) {
  const stay = h.lodging;
  if (!stay?.maintenance) return;
  const plan = constructionPlan(h, stay.maintenance.planId);
  if (!plan?.assignment?.lodgingMaintenance) return;
  const id = plan.assignment.actorId;
  const pos = h.state.actors[id]?.position;
  const domain = housingPoint(plan.neighborId, 0).domainId;
  if (
    pos?.kind !== "transit" ||
    pos.step.from.domainId === domain ||
    pos.step.to.domainId !== domain
  )
    return;
  const allowed = effectiveRoomAccess(plan.neighborId, h.controls, stay);
  if (allowed === null || allowed.includes(id)) return;
  if (
    h.maintenanceVisits &&
    Object.hasOwn(h.maintenanceVisits, id) &&
    h.maintenanceVisits[id] === plan.id
  )
    return;
  h.maintenanceVisits = { ...h.maintenanceVisits, [id]: plan.id };
}

function visitStillApplies(h: HousingRuntime, actorId: string, planId: string) {
  const plan = constructionPlan(h, planId);
  if (
    plan?.kind !== "insulation" ||
    !Object.hasOwn(h.controls.roomAccess, plan.neighborId)
  )
    return false;
  const allowed = effectiveRoomAccess(plan.neighborId, h.controls, h.lodging);
  if (allowed === null || allowed.includes(actorId)) return false;
  const domain = housingPoint(plan.neighborId, 0).domainId;
  const pos = h.state.actors[actorId]?.position;
  if (pos?.kind === "at") return pos.point.domainId === domain;
  if (pos?.kind === "transit")
    return pos.step.from.domainId === domain || pos.step.to.domainId === domain;
  // Cancelling a regional departure returns the resident to its saved departure floor.
  const away = h.unlocated[actorId];
  return (
    away?.reason === "regional-travel" &&
    away.departurePoint?.domainId === domain
  );
}

export function releaseFinishedMaintenanceVisits(h: HousingRuntime) {
  const visits = h.maintenanceVisits;
  if (!visits) return;
  for (const [id, planId] of Object.entries(visits))
    if (!visitStillApplies(h, id, planId)) delete visits[id];
  if (!Object.keys(visits).length) delete h.maintenanceVisits;
}

export function privateWorkFloor(
  h: HousingRuntime,
  id: string,
  dest: SpatialPoint,
) {
  if (
    dest.cell === 0 ||
    !h.maintenanceVisits ||
    !Object.hasOwn(h.maintenanceVisits, id)
  )
    return false;
  const plan = constructionPlan(h, h.maintenanceVisits[id]);
  return !!plan && dest.domainId === housingPoint(plan.neighborId, 0).domainId;
}

export function validMaintenanceVisits(h: HousingRuntime, people: Set<string>) {
  if (!Object.hasOwn(h, "maintenanceVisits")) return true;
  if (!record(h.maintenanceVisits)) return false;
  const visits = Object.entries(h.maintenanceVisits);
  return (
    visits.length > 0 &&
    visits.every(([id, planId]) => {
      if (
        !people.has(id) ||
        typeof planId !== "string" ||
        !visitStillApplies(h, id, planId)
      )
        return false;
      const intent = h.state.actors[id]?.order?.intent;
      return (
        intent?.kind !== "move" || !privateWorkFloor(h, id, intent.destination)
      );
    })
  );
}
