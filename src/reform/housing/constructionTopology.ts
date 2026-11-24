import type { SpatialPoint } from "../spatial/types";
import { isSpatialCell, sameSpatialPoint } from "../spatial/route";
import { housingRoomId } from "./topology";
import type { HousingRuntime } from "./types";
import type { RoomConstruction } from "./constructionTypes";

export function constructionFloor(h: HousingRuntime, point: SpatialPoint) {
  const domain =
    Object.hasOwn(h.state.domains, point.domainId) &&
    h.state.domains[point.domainId];
  return (
    !!domain &&
    isSpatialCell(domain, point.cell) &&
    !domain.blockedCells.includes(point.cell)
  );
}
export function unresolvedConstruction(plan: RoomConstruction) {
  return plan.status === "planned" || plan.material?.state === "present";
}
export function constructionPlan(h: HousingRuntime | undefined, id: string) {
  const plans = h?.construction?.plans;
  return plans && Object.hasOwn(plans, id) ? plans[id] : undefined;
}

/** Only the explicit room permissions grant handling. Transit egress is separate. */
export function constructionHandling(
  h: HousingRuntime,
  plan: RoomConstruction,
): string[] | null {
  const item = h.state.items[plan.material!.itemId];
  const assigned = plan.assignment;
  const order = assigned && h.state.actors[assigned.actorId].order;
  const pickup =
    order?.pickupPoint ??
    (item.position.kind === "at" ? item.position.point : plan.source);
  const destination =
    order?.intent.kind === "carry"
      ? order.intent.destination
      : plan.status === "planned"
        ? plan.staging
        : plan.source;
  const rooms = [pickup, destination].map(
    (p) => h.controls.roomAccess[housingRoomId(p.domainId)!],
  );
  if (rooms.every((list) => list === null)) return null;
  return Object.keys(h.state.actors)
    .filter((id) => rooms.every((list) => list === null || list.includes(id)))
    .sort();
}
export function refreshConstructionHandling(h: HousingRuntime) {
  for (const plan of Object.values(h.construction?.plans ?? {})) {
    if (plan.material?.state === "present")
      h.state.items[plan.material.itemId].carryAllowedActorIds =
        constructionHandling(h, plan);
  }
}

/** A released source-floor bundle is the receipt for a capacity-blocked return.
 * It remains a valid receipt after another action has freed enough stock space. */
export function sourceReturnMaterial(
  h: HousingRuntime,
  plan: RoomConstruction,
) {
  const material = plan.material;
  if (
    plan.status !== "cancelled" ||
    plan.assignment ||
    material?.state !== "present"
  )
    return;
  const position = h.state.items[material.itemId].position;
  if (position.kind === "at" && sameSpatialPoint(position.point, plan.source))
    return material;
}

export function constructionExitText(
  h: HousingRuntime,
  plan: RoomConstruction,
) {
  if (plan.assignment?.kind === "build")
    return "この区間の終点で施工担当を外れます。木材は仮置き場に残ります。";
  const pos = h.state.items[plan.material!.itemId].position;
  return pos.kind === "carried"
    ? "この区間の終点で運搬を終了し、持っている木材を床に下ろします。"
    : plan.status === "cancelled"
      ? "この区間の終点で運搬担当を外れます。木材はまだ拾っていません。"
      : "この区間の終点で運搬を終了します。拾う前の木材は元の床に残ります。";
}
