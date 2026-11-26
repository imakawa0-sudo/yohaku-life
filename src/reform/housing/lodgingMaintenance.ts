import type { Game } from "../sim";
import { cancelConstructionActor } from "./constructionProgress";
import { constructionPlan } from "./constructionTopology";
import type { ConstructionResult } from "./constructionTypes";
import { isRegionalHousingTask } from "./runtime";

export function requestLodgingMaintenance(
  game: Game,
  residentId: string,
  planId: string,
): ConstructionResult {
  const h = game.housing;
  const stay = h?.lodging;
  if (!h || stay?.phase !== "occupied" || stay.residentId !== residentId)
    return { game, error: "入居中の本人が、自分の居室の寒さ対策を頼めます。" };
  if (stay.maintenance)
    return { game, error: "先の寒さ対策の依頼を終えてください。" };
  const actor = game.actors.find((a) => a.person.id === residentId);
  if (
    !actor ||
    actor.location !== game.home ||
    isRegionalHousingTask(actor.task) ||
    actor.danger ||
    actor.injury >= 70 ||
    !Object.hasOwn(h.state.actors, residentId) ||
    h.state.actors[residentId].position.kind !== "at"
  )
    return {
      game,
      error: "自宅で移動を終え、安全に頼めるときに選んでください。",
    };
  const plan = constructionPlan(h, planId);
  if (
    plan?.kind !== "insulation" ||
    plan.neighborId !== stay.roomId ||
    plan.status !== "planned" ||
    plan.assignment
  )
    return {
      game,
      error:
        "自分の居室にある、担当者が作業中ではない未完の寒さ対策を選んでください。",
    };
  const next = structuredClone(game);
  next.housing!.lodging!.maintenance = { planId, phase: "requested" };
  return { game: next, planId };
}

export function acceptLodgingMaintenance(
  game: Game,
  providerId: string,
): ConstructionResult {
  const h = game.housing;
  const stay = h?.lodging;
  const request = stay?.maintenance;
  if (
    stay?.phase !== "occupied" ||
    stay.providerId !== providerId ||
    request?.phase !== "requested"
  )
    return { game, error: "依頼を受けた居室の提供者が返答できます。" };
  const actor = game.actors.find((a) => a.person.id === providerId);
  if (
    !actor ||
    actor.location !== game.home ||
    actor.task ||
    actor.danger ||
    actor.injury >= 70
  )
    return {
      game,
      error:
        "提供者が自宅で予定を終え、安全に引き受けられるときに選んでください。",
    };
  const plan = constructionPlan(h, request.planId);
  if (
    plan?.kind !== "insulation" ||
    plan.neighborId !== stay.roomId ||
    plan.status !== "planned" ||
    plan.assignment
  )
    return { game, error: "工事の担当者が空いてから引き受けてください。" };
  const next = structuredClone(game);
  next.housing!.lodging!.maintenance!.phase = "accepted";
  return { game: next, planId: plan.id };
}

/** Clear the agreement on a detached candidate, leaving the actual board and work with the plan. */
export function endLodgingMaintenance(game: Game) {
  const stay = game.housing?.lodging;
  const request = stay?.maintenance;
  if (!stay || !request) return;
  const plan = constructionPlan(game.housing, request.planId);
  delete stay.maintenance;
  if (plan?.assignment?.lodgingMaintenance) {
    delete plan.assignment.lodgingMaintenance;
    cancelConstructionActor(game, plan.assignment.actorId);
  }
}

export function withdrawLodgingMaintenance(
  game: Game,
  actorId: string,
): ConstructionResult {
  const stay = game.housing?.lodging;
  if (
    stay?.phase !== "occupied" ||
    !stay.maintenance ||
    (actorId !== stay.residentId && actorId !== stay.providerId)
  )
    return {
      game,
      error: "依頼をした入居者か、依頼を受けた提供者が選べます。",
    };
  const planId = stay.maintenance.planId;
  const next = structuredClone(game);
  endLodgingMaintenance(next);
  return { game: next, planId };
}
