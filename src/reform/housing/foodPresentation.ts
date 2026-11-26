import { residentLabel } from "../displayNames";
import type { Game } from "../sim";
import { sameSpatialPoint } from "../spatial/route";
import { projectHousingOrderMinutes } from "./bridge";
import { housingPointLabel, housingStatus } from "./presentation";
import type { FoodBundle } from "./foodTypes";

export function foodTaskMinutes(g: Game, actorId: string): number | null {
  const actor = g.actors.find((a) => a.person.id === actorId);
  const task = actor?.task;
  if (!task?.spatial?.foodBundleId || !actor) return null;
  const order = g.housing!.state.actors[actorId].order!;
  if (task.spatial.kind === "use") return housingStatus(g, actorId).minutes;
  if (
    order.phase !== "exiting-after-cancel" &&
    (actor.danger || actor.injury >= 70)
  )
    return null;
  const minutes = projectHousingOrderMinutes(g, actor);
  return minutes === null
    ? null
    : minutes +
        (task.kind === "work" && order.phase !== "exiting-after-cancel"
          ? task.remaining
          : 0);
}

export type FoodBundleStatus = {
  bundleId: string;
  state: FoodBundle["state"];
  quantity: 2;
  phase: string;
  location: string;
  storage: string | null;
  assignedActorId?: string;
  minutes: number | null;
};
export function foodBundleStatus(g: Game): FoodBundleStatus | null {
  const h = g.housing,
    b = h?.foodLogistics?.bundle;
  if (!h || !b) return null;
  const common = { bundleId: b.id, state: b.state, quantity: b.quantity };
  if (b.state !== "present")
    return {
      ...common,
      phase: b.state === "consumed" ? "料理に使用済み" : "返却済み",
      location: b.state === "consumed" ? "料理に使用" : "共同備蓄",
      storage: null,
      minutes: null,
    };
  const pos = h.state.items[b.itemId].position;
  const assignment = b.assignment;
  const id = assignment?.actorId;
  const status = id ? housingStatus(g, id) : null;
  const actor = g.actors.find((a) => a.person.id === id);
  const location =
    pos.kind === "at"
      ? housingPointLabel(g, pos.point)
      : actor
        ? residentLabel(g, actor) + "の手元（" + status!.location + "）"
        : "運搬中";
  let phase =
    pos.kind === "at" && sameSpatialPoint(pos.point, b.storage)
      ? "保管中"
      : "床に置いてある";
  if (assignment) {
    const order = h.state.actors[assignment.actorId].order!;
    if (order.phase === "waiting") phase = status!.detail;
    else if (order.phase === "exiting-after-cancel")
      phase = "区間を出て担当を解除";
    else if (order.intent.kind === "use")
      phase = order.phase === "use" ? "料理中" : "料理設備へ移動中";
    else
      phase =
        (assignment.kind === "cook"
          ? "料理用"
          : assignment.kind === "return"
            ? "返却用"
            : "保管用") +
        (order.phase === "approach"
          ? "の一束を拾いに移動中"
          : "の一束を運搬中");
  }
  return {
    ...common,
    phase,
    location,
    storage: housingPointLabel(g, b.storage),
    ...(id && { assignedActorId: id }),
    minutes: status?.minutes ?? null,
  };
}
