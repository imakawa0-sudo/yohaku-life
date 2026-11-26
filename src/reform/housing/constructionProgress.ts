import { permitsLodgingWork } from "./lodgingMaintenanceAccess";
import { isStockQuantity, type Actor, type Game } from "../sim";
import { cancelSpatialOrder } from "../spatial/actions";
import {
  projectHousingOrderMinutes,
  rebuildHousingGeometry,
  type HousingMinute,
} from "./bridge";
import {
  constructionPlan,
  constructionExitText,
  sourceReturnMaterial,
} from "./constructionTopology";
import { constructionSlotId } from "./topology";
import type { HousingRuntime } from "./types";
import type { RoomConstruction } from "./constructionTypes";

type ReleasedReturn = { plan: RoomConstruction; worker: Actor };

/** Settle only a released bundle lying on the supply floor. */
export function settleConstructionReturn(
  g: Game,
  plan: RoomConstruction,
  worker?: Actor,
) {
  const h = g.housing!;
  const material = sourceReturnMaterial(h, plan);
  if (!material) return;
  if (!isStockQuantity(g.wood + material.quantity)) {
    if (worker)
      worker.reason =
        "木材を供給口に下ろしました。共同備蓄の空きを待っています。";
    return;
  }
  delete h.state.items[material.itemId];
  material.state = "returned";
  g.wood += material.quantity;
  if (worker) worker.reason = "工事用木材を共同備蓄へ戻しました。";
}

function detach(
  g: Game,
  plan: RoomConstruction,
  reason: string,
  releases?: ReleasedReturn[],
) {
  const worker = g.actors.find(
    (a) => a.person.id === plan.assignment!.actorId,
  )!;
  delete plan.assignment;
  worker.task = null;
  worker.reason = reason;
  if (sourceReturnMaterial(g.housing!, plan)) {
    if (releases) releases.push({ plan, worker });
    else settleConstructionReturn(g, plan, worker);
  }
  rebuildHousingGeometry(g, g.housing!);
}
export function cancelConstructionActor(
  g: Game,
  actorId: string,
  releases?: ReleasedReturn[],
) {
  const h = g.housing!;
  const worker = g.actors.find((a) => a.person.id === actorId);
  const id = worker?.task?.spatial?.constructionId;
  const plan = id && constructionPlan(h, id);
  if (!plan || plan.assignment?.actorId !== actorId) return;
  const result = cancelSpatialOrder(h.state, actorId);
  h.state = result.state;
  const build = plan.assignment.kind === "build";
  if (h.state.actors[actorId].order)
    worker!.reason = constructionExitText(h, plan);
  else
    detach(
      g,
      plan,
      build
        ? "施工を中断し、木材と進捗を残しました。"
        : "運搬を中断し、木材を床に残しました。",
      releases,
    );
}
export function finishConstructionMinute(
  g: Game,
  minutes: Map<string, HousingMinute>,
  releases: ReleasedReturn[],
) {
  const h = g.housing!;
  let completedPlanId: string | undefined;
  for (const plan of Object.values(h.construction?.plans ?? {})) {
    const assignment = plan.assignment;
    if (!assignment) continue;
    const tick = minutes.get(assignment.actorId);
    if (assignment.kind === "build" && tick?.used) plan.workedMinutes++;
    const terminal = tick?.terminal;
    if (terminal && assignment.kind === "build") {
      if (terminal === "finish") completedPlanId = plan.id;
      detach(
        g,
        plan,
        terminal === "cancel" ? "施工を中断しました。" : "施工を終えました。",
        releases,
      );
      continue;
    }
    if (terminal)
      detach(
        g,
        plan,
        terminal === "cancel"
          ? "区間の終点で木材の運搬を終了しました。"
          : assignment.kind === "deliver"
            ? "木材を仮置き場に下ろしました。"
            : "工事用木材を共同備蓄へ戻しました。",
        releases,
      );
  }
  return completedPlanId;
}

export function constructionWorkerPermitted(
  h: HousingRuntime,
  plan: RoomConstruction,
) {
  const assignment = plan.assignment!;
  if (assignment.lodgingMaintenance)
    return permitsLodgingWork(h, plan, assignment.actorId, assignment.kind);
  const allowed =
    plan.assignment!.kind === "build"
      ? h.state.slots[constructionSlotId(plan.id)].allowedActorIds
      : h.state.items[plan.material!.itemId].carryAllowedActorIds;
  return allowed === null || allowed.includes(plan.assignment!.actorId);
}

/** A room setting can revoke a job immediately, even when no clock tick follows. */
export function releaseRevokedConstructionWorkers(
  g: Game,
  previous: HousingRuntime,
) {
  const h = g.housing!;
  for (const plan of Object.values(h.construction?.plans ?? {})) {
    const id = plan.assignment?.actorId;
    if (
      id &&
      h.state.actors[id].order?.phase !== "exiting-after-cancel" &&
      constructionWorkerPermitted(previous, plan) &&
      !constructionWorkerPermitted(h, plan)
    )
      cancelConstructionActor(g, id);
  }
}

/** Recheck explicit handling authority and fitness before admitting a new segment. */
export function prepareConstructionMinute(g: Game) {
  const releases: ReleasedReturn[] = [];
  const h = g.housing;
  if (!h?.construction) return releases;
  for (const plan of Object.values(h.construction.plans)) {
    const assignment = plan.assignment;
    if (!assignment || !plan.material) continue;
    const id = assignment.actorId;
    if (h.state.actors[id].order?.phase === "exiting-after-cancel") continue;
    const actor = g.actors.find((a) => a.person.id === id)!;
    if (
      actor.danger ||
      actor.injury >= 70 ||
      !constructionWorkerPermitted(h, plan)
    )
      cancelConstructionActor(g, id, releases);
  }
  return releases;
}

/** Project only the assigned actor's spatial clock. Arrival at a remote pickup
 * lifts the bundle on that tick; starting on its floor takes one pickup tick. */
export function constructionTaskMinutes(
  g: Game,
  actorId: string,
): number | null {
  const worker = g.actors.find((a) => a.person.id === actorId);
  const id = worker?.task?.spatial?.constructionId;
  const h = g.housing,
    plan = id && constructionPlan(h, id);
  if (!h || !worker || !plan || !plan.assignment || !plan.material) return null;
  const actor = h.state.actors[actorId];
  if (
    actor.order?.phase === "exiting-after-cancel" &&
    actor.position.kind === "transit"
  )
    return actor.position.remaining;
  if (
    worker.injury >= 70 ||
    worker.danger ||
    !constructionWorkerPermitted(h, plan)
  )
    return null;
  return projectHousingOrderMinutes(g, worker);
}
