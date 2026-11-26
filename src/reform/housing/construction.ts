import { isIndoorHousingRoom, isRoomInsulated } from "./coldProtection";
import {
  cancelConstructionActor,
  settleConstructionReturn,
  constructionTaskMinutes,
} from "./constructionProgress";
import { isStockQuantity, type Actor, type Game } from "../sim";
import { issueSpatialOrder } from "../spatial/actions";
import { sameSpatialPoint } from "../spatial/route";
import {
  locateHousingActor,
  rebuildHousingGeometry,
  spatialReasonText,
} from "./bridge";
import { constructionSlotId, housingPoint } from "./topology";
import {
  constructionFloor,
  sourceReturnMaterial,
  constructionPlan,
  refreshConstructionHandling,
  unresolvedConstruction,
} from "./constructionTopology";
import {
  constructionWood,
  constructionTitle,
  constructionWorkMinutes,
  type ConstructionRequest,
  type ConstructionResult,
  type ConstructionInspection,
  type HaulDirection,
} from "./constructionTypes";

export {
  completeRoomConstruction,
  inspectConstructionCompletion,
} from "./runtime";

export function createRoomConstruction(
  game: Game,
  request: ConstructionRequest,
): ConstructionResult {
  return createConstructionPlan(game, request);
}

export function createConstructionPlan(
  game: Game,
  request: ConstructionRequest,
  kind?: "insulation",
): ConstructionResult {
  const h = game.housing;
  if (!h) return { game, error: "先に「住居の移動」を有効にしてください。" };
  if (kind === "insulation") {
    if (!isIndoorHousingRoom(game, request.neighborId))
      return { game, error: "寒さ対策をする屋内の部屋を選んでください。" };
    if (game.insulated || isRoomInsulated(game, request.neighborId))
      return { game, error: "この部屋の寒さ対策は済んでいます。" };
  }
  const name = request.name.trim();
  if (!name || name.length > 24)
    return { game, error: "部屋の名前を1〜24文字で入力してください。" };
  const staging = housingPoint(request.neighborId, request.stagingCell),
    source = housingPoint("living", 0);
  if (
    !constructionFloor(h, staging) ||
    !constructionFloor(h, source) ||
    sameSpatialPoint(staging, source)
  )
    return { game, error: "供給口と異なる、歩ける仮置き場を選んでください。" };
  if (Object.values(h.construction?.plans ?? {}).some(unresolvedConstruction))
    return {
      game,
      error: "先の工事を終えるか、取り消した工事の木材を回収してください。",
    };
  const serial = h.construction?.nextId ?? 1;
  if (!Number.isSafeInteger(serial + 1))
    return { game, error: "新しい計画番号を発行できません。" };
  const next = structuredClone(game),
    id = "construction-" + serial;
  const ledger = (next.housing!.construction ??= {
    version: 1,
    nextId: 1,
    plans: {},
  });
  ledger.nextId++;
  ledger.plans[id] = {
    id,
    name,
    neighborId: request.neighborId,
    source,
    staging,
    createdAt: game.time,
    ...(kind && { kind }),
    requiredWood: kind === "insulation" ? 1 : constructionWood,
    workMinutes: constructionWorkMinutes,
    workedMinutes: 0,
    status: "planned",
  };
  rebuildHousingGeometry(next, next.housing!);
  return { game: next, planId: id };
}

export function reserveConstructionMaterial(
  game: Game,
  planId: string,
): ConstructionResult {
  const plan = constructionPlan(game.housing, planId);
  if (plan?.status !== "planned" || plan.material)
    return { game, error: "この工事の木材は取り置けません。" };
  if (game.wood < plan.requiredWood)
    return {
      game,
      error: `取り置くには共同備蓄に木材${plan.requiredWood}が必要です。`,
    };
  const next = structuredClone(game),
    h = next.housing!,
    target = h.construction!.plans[planId];
  const itemId =
    "construction-material-" + planId.slice("construction-".length);
  next.wood -= plan.requiredWood;
  target.material = { itemId, quantity: plan.requiredWood, state: "present" };
  h.state.items[itemId] = {
    id: itemId,
    position: { kind: "at", point: { ...target.source } },
    carryAllowedActorIds: null,
  };
  refreshConstructionHandling(h);
  return { game: next, planId };
}

const workerUnavailable =
  "自宅にいて手が空き、危険や重傷のない住人を選んでください。";

function availableWorker(game: Game, actorId: string) {
  return game.actors.find(
    (actor) =>
      actor.person.id === actorId &&
      actor.location === game.home &&
      !actor.task &&
      actor.injury < 70 &&
      !actor.danger,
  );
}

function workerCandidate(game: Game, actor: Actor) {
  const next = structuredClone(game),
    h = next.housing!,
    id = actor.person.id;
  if (!Object.hasOwn(h.state.actors, id))
    locateHousingActor(next, h, id, housingPoint(actor.room, 0));
  return {
    next,
    h,
    worker: next.actors.find((person) => person.person.id === id)!,
  };
}

export function assignConstructionHaul(
  game: Game,
  planId: string,
  actorId: string,
  direction: HaulDirection,
): ConstructionResult {
  const plan = constructionPlan(game.housing, planId);
  if (
    !plan ||
    plan.material?.state !== "present" ||
    plan.assignment ||
    (direction === "deliver"
      ? plan.status !== "planned"
      : direction !== "return" || plan.status !== "cancelled")
  )
    return { game, error: "この工事では今は木材を運べません。" };
  const actor = availableWorker(game, actorId);
  if (!actor) return { game, error: workerUnavailable };
  const item = game.housing!.state.items[plan.material.itemId];
  const destination = direction === "deliver" ? plan.staging : plan.source;
  if (
    item.position.kind !== "at" ||
    sameSpatialPoint(item.position.point, destination)
  )
    return { game, error: "木材はすでに届け先にあるか、運搬中です。" };
  const { next, h, worker } = workerCandidate(game, actor);
  const result = issueSpatialOrder(h.state, {
    kind: "carry",
    actorId,
    destination,
    payload: { kind: "item", id: item.id },
  });
  if (!result.ok) return { game, error: spatialReasonText(result.reason) };
  h.state = result.state;
  const orderId = result.orderId;
  h.construction!.plans[planId].assignment = {
    actorId,
    orderId,
    kind: direction,
  };
  const label =
    direction === "deliver"
      ? "工事用木材を仮置き場へ運ぶ"
      : "工事用木材を備蓄へ運び戻す";
  worker.task = {
    kind: "home-haul",
    mode: "direct",
    label,
    total: 1,
    remaining: 1,
    reserved: {},
    from: worker.location,
    metric: "travel",
    spatial: { kind: "carry", orderId, constructionId: planId, direction },
  };
  worker.reason = label + "よう指示されています。";
  return { game: next, planId };
}
export function assignConstructionBuild(
  game: Game,
  planId: string,
  actorId: string,
): ConstructionResult {
  const h = game.housing;
  const plan = constructionPlan(h, planId);
  if (
    !h ||
    plan?.status !== "planned" ||
    plan.workedMinutes >= plan.workMinutes ||
    plan.assignment ||
    plan.material?.state !== "present"
  )
    return {
      game,
      error: "未完成の計画に木材を搬入し、担当が空くのを待ってください。",
    };
  const pos = h.state.items[plan.material.itemId].position;
  if (pos.kind !== "at" || !sameSpatialPoint(pos.point, plan.staging))
    return { game, error: "仮置き場に木材を届けてください。" };
  const actor = availableWorker(game, actorId);
  if (!actor) return { game, error: workerUnavailable };
  const { next, h: housing, worker } = workerCandidate(game, actor);
  const slotId = constructionSlotId(planId),
    remaining = plan.workMinutes - plan.workedMinutes;
  const result = issueSpatialOrder(housing.state, {
    kind: "use",
    actorId,
    slotId,
    useMinutes: remaining,
  });
  if (!result.ok) return { game, error: spatialReasonText(result.reason) };
  housing.state = result.state;
  const orderId = result.orderId;
  housing.construction!.plans[planId].assignment = {
    kind: "build",
    actorId,
    orderId,
    startedWorkMinutes: plan.workedMinutes,
  };
  worker.task = {
    kind: "home-build",
    mode: "direct",
    label: constructionTitle(plan) + "を施工する",
    total: remaining,
    remaining,
    reserved: {},
    from: worker.location,
    metric: "work",
    room: plan.neighborId,
    station: slotId,
    spatial: { kind: "use", orderId, constructionId: planId },
  };
  worker.reason = constructionTitle(plan) + "を担当しています。";
  return { game: next, planId };
}
export function inspectConstructionBuild(
  game: Game,
  planId: string,
  actorId: string,
): ConstructionInspection {
  const result = assignConstructionBuild(game, planId, actorId);
  return result.error
    ? { ok: false, disabled: result.error, minutes: null }
    : { ok: true, minutes: constructionTaskMinutes(result.game, actorId) };
}
export function releaseConstructionWorker(
  game: Game,
  planId: string,
): ConstructionResult {
  const assignment = constructionPlan(game.housing, planId)?.assignment;
  if (!assignment) return { game, error: "この工事には担当者がいません。" };
  const next = structuredClone(game);
  cancelConstructionActor(next, assignment.actorId);
  return { game: next, planId };
}
export function cancelRoomConstruction(
  game: Game,
  planId: string,
): ConstructionResult {
  if (constructionPlan(game.housing, planId)?.status !== "planned")
    return { game, error: "この工事はすでに終了しています。" };
  const next = structuredClone(game),
    h = next.housing!,
    plan = h.construction!.plans[planId];
  plan.status = "cancelled";
  plan.cancelledAt = game.time;
  if (plan.assignment) cancelConstructionActor(next, plan.assignment.actorId);
  settleConstructionReturn(next, plan);
  rebuildHousingGeometry(next, h);
  return { game: next, planId };
}
export function inspectConstructionHaul(
  game: Game,
  planId: string,
  actorId: string,
  direction: HaulDirection,
): ConstructionInspection {
  const result = assignConstructionHaul(game, planId, actorId, direction);
  return result.error
    ? { ok: false, disabled: result.error, minutes: null }
    : { ok: true, minutes: constructionTaskMinutes(result.game, actorId) };
}
export function reclaimConstructionMaterial(
  game: Game,
  planId: string,
): ConstructionResult {
  const h = game.housing,
    plan = constructionPlan(h, planId);
  const material = h && plan && sourceReturnMaterial(h, plan);
  if (!material)
    return { game, error: "供給口に戻した工事用木材がありません。" };
  if (!isStockQuantity(game.wood + material.quantity))
    return {
      game,
      error: `備蓄に木材${material.quantity}を戻す空きがありません。木材を使ってからもう一度戻してください。`,
    };
  const next = structuredClone(game);
  settleConstructionReturn(next, next.housing!.construction!.plans[planId]);
  return { game: next, planId };
}
