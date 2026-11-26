import type { Actor, Game } from "../sim";
import { sameSpatialPoint } from "../spatial/route";
import type { HousingProposal } from "./bridge";
import { spatialReasonText } from "./bridge";
import { foodRoomAllows, planFoodCarry, presentFood } from "./food";
import { housingPointLabel } from "./presentation";
import type { HousingRuntime, HousingSlot } from "./types";

export function foodCookingSeat(g: Game): string | undefined {
  const assignment = presentFood(g.housing)?.assignment;
  if (assignment?.kind !== "cook") return;
  const t = g.actors.find((a) => a.person.id === assignment.actorId)?.task;
  return t?.spatial?.kind === "carry" ? t.station : undefined;
}

export function planFoodCooking(
  g: Game,
  h: HousingRuntime,
  a: Actor,
  slot: HousingSlot,
  bundleId: string,
  proposal: HousingProposal,
): HousingProposal | string {
  const b = presentFood(h),
    id = a.person.id;
  if (!b || b.id !== bundleId) return "選んだ食材の一束がありません。";
  if (b.assignment) return "この一束はすでに担当者が確保しています。";
  const item = h.state.items[b.itemId],
    pos = item.position,
    at = h.state.actors[id].position;
  if (pos.kind !== "at" || at.kind !== "at")
    return "一束または住人の現在地を確認してください。";
  if (!foodRoomAllows(h, pos.point, id) || !foodRoomAllows(h, slot.point, id))
    return spatialReasonText("handling-denied");
  let transportMinutes = 0;
  const t = proposal.task;
  if (!sameSpatialPoint(pos.point, slot.point)) {
    const carried = planFoodCarry(g, h, b, id, slot.point);
    if (!carried.ok) return spatialReasonText(carried.reason);
    proposal.state = carried.state;
    t.spatial = { kind: "carry", orderId: carried.orderId };
    transportMinutes = carried.minutes;
    proposal.minutes = transportMinutes + t.total;
  }
  t.spatial!.foodBundleId = bundleId;
  proposal.foodBundle = {
    bundleId,
    quantity: b.quantity,
    location: housingPointLabel(g, pos.point),
    transportMinutes,
  };
  return proposal;
}
