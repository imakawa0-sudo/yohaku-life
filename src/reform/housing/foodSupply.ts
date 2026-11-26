import { inspectOrder, needKeys, type Actor, type Game } from "../sim";
import { sameSpatialPoint } from "../spatial/route";
import { assignFoodHaul, createFoodBundle, presentFood } from "./food";
import { foodTaskMinutes } from "./foodPresentation";
import type {
  FoodResult,
  FoodSupplyInspection,
  FoodSupplyPolicy,
} from "./foodTypes";
import { isFoodSupply } from "./foodSupplyValidation";
import { housingPoint, housingRoomId } from "./topology";

export function setFoodSupply(
  game: Game,
  request: { actorId: string; roomId: string; storageCell: number },
): FoodResult {
  const h = game.housing;
  if (!h) return { game, error: "先に住居の移動を有効にしてください。" };
  if (!game.actors.some((a) => a.person.id === request.actorId))
    return { game, error: "補充を任せる住人を選んでください。" };
  const policy: FoodSupplyPolicy = {
    version: 1,
    actorId: request.actorId,
    storage: housingPoint(request.roomId, request.storageCell),
    enabled: true,
  };
  if (!isFoodSupply(policy, game, h))
    return {
      game,
      error: "供給口と異なる、歩ける補充先の床を選んでください。",
    };
  const next = structuredClone(game);
  next.housing!.foodSupply = policy;
  return { game: next };
}

export function setFoodSupplyEnabled(game: Game, enabled: boolean): FoodResult {
  if (!game.housing?.foodSupply)
    return { game, error: "先に補充担当を設定してください。" };
  const next = structuredClone(game);
  next.housing!.foodSupply!.enabled = enabled;
  return { game: next };
}

export function clearFoodSupply(game: Game): FoodResult {
  if (!game.housing?.foodSupply) return { game };
  const next = structuredClone(game);
  delete next.housing!.foodSupply;
  return { game: next };
}

function eligibility(game: Game, actor: Actor): string | undefined {
  if (actor.location !== game.home) return "補充担当の帰宅を待ちます。";
  if (actor.task) return "補充担当の手が空くのを待ちます。";
  if (
    actor.danger ||
    actor.injury >= 50 ||
    needKeys.some((n) => actor.needs[n] < 42) ||
    actor.mood < 25
  )
    return "住人の安全と生活の用事を優先します。";
  const minute = game.time % 1440;
  if (minute < 420 || minute >= 1180) return "日中になるのを待ちます。";
}

/** Both of the existing operations work on clones. No candidate state is
 * published unless taking out the bundle AND assigning its haul succeeded. */
function prepareSupply(game: Game, policy: FoodSupplyPolicy): FoodResult {
  const b = presentFood(game.housing);
  if (b) return assignFoodHaul(game, b.id, policy.actorId, "store");
  const created = createFoodBundle(game, {
    roomId: housingRoomId(policy.storage.domainId)!,
    storageCell: policy.storage.cell,
  });
  return created.error
    ? created
    : assignFoodHaul(created.game, created.bundleId!, policy.actorId, "store");
}

function inspection(
  state: FoodSupplyInspection["state"],
  detail: string,
  minutes: number | null = null,
): FoodSupplyInspection {
  return { state, detail, minutes };
}

function bundleStatus(
  game: Game,
  policy: FoodSupplyPolicy,
): FoodSupplyInspection | undefined {
  const h = game.housing!;
  const b = presentFood(h);
  if (!b) return;
  if (!sameSpatialPoint(b.storage, policy.storage))
    return inspection("waiting", "別の保管先の一束を使い終えるのを待ちます。");
  if (b.assignment) {
    if (
      b.assignment.kind === "store" &&
      b.assignment.actorId === policy.actorId
    ) {
      if (h.state.actors[policy.actorId].order?.phase === "exiting-after-cancel")
        return inspection(
          "waiting",
          "運搬は中止しました。担当者が今の区間を出て、一束を床に置くのを待ちます。",
        );
      const minutes = foodTaskMinutes(game, policy.actorId);
      return inspection(
        "hauling",
        minutes === null
          ? "一束の運搬中です。通路や権限を確認してください。"
          : "一束を保管床へ運搬中です。",
        minutes,
      );
    }
    return inspection(
      "waiting",
      "別の一束を使用中です。担当が終わるのを待ちます。",
    );
  }
  const position = h.state.items[b.itemId].position;
  if (position.kind === "at" && sameSpatialPoint(position.point, b.storage))
    return inspection(
      "stocked",
      "保管床に一束あります。料理に使い終えるのを待ちます。",
    );
}

export function inspectFoodSupply(game: Game): FoodSupplyInspection {
  const policy = game.housing?.foodSupply;
  if (!policy) return inspection("unset", "補充担当を設定していません。");
  if (!policy.enabled)
    return inspection("paused", "補充を一時停止しています。");
  const bundled = bundleStatus(game, policy);
  if (bundled) return bundled;
  const actor = game.actors.find((a) => a.person.id === policy.actorId)!;
  const blocked = eligibility(game, actor);
  if (blocked) return inspection("waiting", blocked);
  // Match the existing stock policy before predicting a prospective haul.
  // A failed attempt to cook/forage does not itself prevent supply.
  const stocking =
    game.food < game.foodTarget.high &&
    (game.stocking || game.food <= game.foodTarget.low);
  if (
    stocking &&
    (!inspectOrder(game, policy.actorId, "work", "cook").disabled ||
      (game.ingredients < 2 &&
        !inspectOrder(game, policy.actorId, "forage").disabled))
  )
    return inspection("waiting", "食事の備蓄を優先します。");
  const result = prepareSupply(game, policy);
  if (result.error) return inspection("waiting", result.error);
  return inspection(
    "ready",
    "今の条件なら補充を始められます。",
    foodTaskMinutes(result.game, policy.actorId),
  );
}

/** Invoked after urgent tasks and before ordinary daytime shifts. Preserve the
 * actor objects and the array being traversed by the minute loop. */
export function tryFoodSupply(game: Game, actor: Actor): boolean {
  const h = game.housing;
  const policy = h?.foodSupply;
  if (
    !h ||
    !policy?.enabled ||
    policy.actorId !== actor.person.id ||
    eligibility(game, actor) ||
    bundleStatus(game, policy)
  )
    return false;
  const candidate = prepareSupply(game, policy);
  if (candidate.error) return false;
  const next = candidate.game;
  const worker = next.actors.find((a) => a.person.id === policy.actorId)!;
  game.ingredients = next.ingredients;
  for (const key of ["pendingMealInputReturns", "pendingPackReturns"] as const) {
    if (next[key]) game[key] = next[key];
    else delete game[key];
  }
  h.state = next.housing!.state;
  h.unlocated = next.housing!.unlocated;
  h.foodLogistics = next.housing!.foodLogistics;
  // Locating a legacy actor rebuilds the housing geometry and controls.
  h.controls = next.housing!.controls;
  actor.task = worker.task!;
  actor.task.mode = "auto";
  actor.reason = "補充担当として、一束を保管床へ運びます。";
  return true;
}
