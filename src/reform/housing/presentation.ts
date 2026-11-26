import { foodTaskMinutes } from "./foodPresentation";
import { constructionTitle } from "./constructionTypes";
import { constructionExitText } from "./constructionTopology";
import { constructionTaskMinutes } from "./constructionProgress";
import { nextGatheringCompletionMinutes } from "./gatheringForecast";
export { nextGatheringCompletionMinutes } from "./gatheringForecast";
import { roomLabel } from "../displayNames";
import { cellName, furnishings, roomName } from "../house";
import type { Game } from "../sim";
import { locateSpatial } from "../spatial/actions";
import type { SpatialPoint } from "../spatial/types";
import { places } from "../world";
import {
  inspectHousingRouteFrom,
  projectHousingOrderMinutes,
  spatialReasonText,
} from "./bridge";
import { housingRoomId, housingSlotId } from "./topology";
import type { HousingStatus } from "./types";

export function housingPointLabel(g: Game, point: SpatialPoint) {
  const room = g.house.rooms.find(
    (r) => r.id === housingRoomId(point.domainId),
  )!;
  return (
    roomLabel(g.house.rooms, room) +
    (point.cell === 0 ? "の入口" : "・" + cellName(room, point.cell))
  );
}
export function housingStatus(g: Game, actorId: string): HousingStatus {
  const a = g.actors.find((p) => p.person.id === actorId);
  const empty = { destination: null, minutes: null, useRemaining: null };
  if (!a)
    return {
      ...empty,
      location: "不明",
      phase: "unlocated",
      detail: "住人が見つかりません。",
    };
  const t = a.task,
    h = g.housing;
  const site = (id: string) =>
    places(g.world).find((p) => p.id === id)?.name ?? id;
  const fallbackLocation =
    a.location === g.home ? roomName(g.house, a.room) : site(a.location);
  const unknown =
    h && Object.hasOwn(h.unlocated, actorId) ? h.unlocated[actorId] : undefined;
  if (!h || unknown) {
    const regional = unknown?.reason === "regional-travel";
    const legacyHome = unknown?.reason === "legacy-unspecified";
    const location = regional
      ? site(a.location) + "を出発・地域を移動中"
      : fallbackLocation + (legacyHome ? "・室内位置は未確定" : "");
    return {
      ...empty,
      location,
      phase:
        regional || unknown?.reason === "outside"
          ? "outside"
          : t || !h
            ? "legacy"
            : "unlocated",
      destination: regional
        ? t?.kind === "rescue"
          ? site(g.home)
          : site(t!.target!)
        : t?.room
          ? roomName(g.house, t.room)
          : null,
      minutes: t?.remaining ?? null,
      detail: regional
        ? "地域の移動を続けています。"
        : legacyHome
          ? t
            ? "旧方式の予定を残り時間どおりに続けます。"
            : "次に自宅で新しい指示が決まると、この部屋の入口から始めます。"
          : t
            ? t.label
            : unknown
              ? "屋外にいます。"
              : "旧方式の暮らしです。",
    };
  }
  const state = h.state;
  const pos = locateSpatial(state, { kind: "actor", id: actorId });
  const location =
    pos.kind === "at"
      ? housingPointLabel(g, pos.point)
      : pos.kind === "transit"
        ? housingPointLabel(g, pos.step.from) +
          " → " +
          housingPointLabel(g, pos.step.to) +
          "（区間あと" +
          pos.remaining +
          "分）"
        : fallbackLocation;
  const order = state.actors[actorId].order;
  if (!order || !t?.spatial)
    return {
      ...empty,
      location,
      phase: t ? "legacy" : "idle",
      minutes: t?.remaining ?? null,
      detail: t ? t.label : "ここで待機しています。",
    };
  const intent = order.intent;
  const use = intent.kind === "use";
  const destination = use
    ? state.slots[intent.slotId].point
    : intent.destination;
  let destinationName = housingPointLabel(g, destination);
  if (use) {
    const room = g.house.rooms.find((r) => r.id === t.room);
    const slot = room?.fixtures.find((f) => {
      // Match the stable seat ID without interpreting fixture IDs as separators.
      return Array.from({ length: furnishings[f.kind].seats }, (_, seat) =>
        housingSlotId(room.id, f.id, seat),
      ).includes(intent.slotId);
    });
    if (slot) destinationName += "（" + furnishings[slot.kind].name + "）";
  }
  const result = {
    location,
    destination: destinationName,
    useRemaining: use ? order.useRemaining : null,
  };
  if (order.phase === "exiting-after-cancel" && pos.kind === "transit")
    return {
      ...result,
      phase: "cancelling",
      minutes: pos.remaining,
      detail: t.spatial.benchRecoveryId
        ? "現在の移動区間を出てから担当を解除します。"
        : t.spatial.foodBundleId
          ? "この区間を出ると担当を解除します。一束は床に残ります。"
          : t.spatial.constructionId
            ? constructionExitText(
                h,
                h.construction!.plans[t.spatial.constructionId],
              )
            : t.kind === "recover"
              ? "この区間の終点で療養を取り消し、寝床の予約を解除します。"
              : "この区間の終点で予約を解除し、材料を返します。",
    };
  if (intent.kind === "carry") {
    const minutes = t.spatial.benchRecoveryId
      ? a.injury >= 70 || a.danger
        ? null
        : projectHousingOrderMinutes(g, a)
      : t.spatial.foodBundleId
        ? foodTaskMinutes(g, actorId)
        : constructionTaskMinutes(g, actorId);
    const material = t.spatial.benchRecoveryId
      ? "解体した板"
      : t.spatial.foodBundleId
        ? "食材の一束"
        : "工事用木材";
    const waiting = order.phase === "waiting";
    return {
      ...result,
      phase: waiting ? "waiting" : "move",
      minutes,
      ...(waiting && order.waitReason ? { waitReason: order.waitReason } : {}),
      detail:
        waiting && order.waitReason
          ? minutes === null
            ? spatialReasonText(order.waitReason)
            : "次の時間進行で運搬を再開します。"
          : minutes === null
            ? "通路・利用許可と担当者の状態を確認してください。"
            : order.phase === "approach"
              ? material + "を拾いに向かっています。"
              : material + "を運んでいます。",
    };
  }
  const from =
    pos.kind === "transit" ? pos.step.to : pos.kind === "at" ? pos.point : null;
  const route = from
    ? inspectHousingRouteFrom(g, h, actorId, from, destination)
    : null;
  const allowed = use ? state.slots[intent.slotId].allowedActorIds : null;
  const reason =
    route && !route.ok
      ? route.reason
      : allowed !== null && !allowed.includes(actorId)
        ? "use-denied"
        : null;
  const requiresFitWorker =
    t.kind === "home-build" ||
    !!t.spatial.foodBundleId ||
    !!t.spatial.benchRecoveryId;
  const minutes =
    requiresFitWorker && (a.injury >= 70 || a.danger)
      ? null
      : route?.ok && !reason
        ? Math.max(
            1,
            route.minutes +
              (pos.kind === "transit" ? pos.remaining : 0) +
              order.useRemaining,
          )
        : null;
  if (order.phase === "waiting") {
    const waitReason = reason ?? order.waitReason!;
    return {
      ...result,
      phase: "waiting",
      minutes,
      waitReason,
      detail:
        minutes === null
          ? spatialReasonText(waitReason)
          : "通行・利用できる状態に戻りました。次の時間進行で再開します。",
    };
  }
  const phase = order.phase === "use" ? "use" : "move";
  return {
    ...result,
    phase,
    minutes,
    detail:
      requiresFitWorker && minutes === null && !reason
        ? "担当者の状態を確認してください。"
        : reason
          ? spatialReasonText(reason)
          : phase === "use"
            ? t.kind === "home-build"
              ? constructionTitle(
                  h.construction!.plans[t.spatial.constructionId!],
                ) + "を進めています。"
              : t.kind === "home-dismantle"
                ? "木工台を解体しています。"
                : "設備を使っています。"
            : "目的地へ向かっています。",
  };
}
export function nextCompletionMinutes(g: Game): number | null {
  let next = nextGatheringCompletionMinutes(g) ?? Infinity;
  for (const a of g.actors) {
    if (!a.task || a.task.spatial?.gatheringId) continue;
    const minutes = a.task.spatial
      ? housingStatus(g, a.person.id).minutes
      : a.task.remaining;
    if (minutes !== null) next = Math.min(next, minutes);
  }
  return Number.isFinite(next) ? next : null;
}
