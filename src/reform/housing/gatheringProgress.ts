import { furnishings } from "../house";
import type { Actor, Game } from "../sim";
import { cancelSpatialOrder, spatialReservationId } from "../spatial/actions";
import { sameSpatialPoint } from "../spatial/route";
import { spatialReasonText, type HousingMinute } from "./bridge";
import { housingSlotId } from "./topology";
import {
  gatheringWaitMinutes,
  type GatheringKind,
  type GatheringMember,
  type HousingGathering,
} from "./types";

function participating(activity: HousingGathering) {
  return activity.members.filter((m) => m.status === "participating");
}
function required(activity: HousingGathering) {
  return activity.kind === "talk" ? 2 : 1;
}
function atOwnSeat(g: Game, member: GatheringMember) {
  const state = g.housing!.state;
  const pos = state.actors[member.actorId]?.position;
  const slot = state.slots[member.slotId];
  return (
    member.status === "participating" &&
    pos?.kind === "at" &&
    !!slot &&
    sameSpatialPoint(pos.point, slot.point)
  );
}
function ready(g: Game, member: GatheringMember) {
  if (!atOwnSeat(g, member)) return false;
  const state = g.housing!.state;
  const { actorId, orderId, slotId } = member;
  const reservation =
    state.reservations[spatialReservationId({ kind: "slot", id: slotId })];
  const allowed = state.slots[slotId].allowedActorIds;
  return (
    state.actors[actorId].order?.id === orderId &&
    reservation?.orderId === orderId &&
    (allowed === null || allowed.includes(actorId))
  );
}
function activityFor(g: Game, id: string) {
  const binding = g.actors.find((a) => a.person.id === id)?.task?.spatial;
  return binding?.gatheringId
    ? g.housing?.gatherings?.[binding.gatheringId]
    : undefined;
}
export function gatheringPresence(g: Game, actorId: string): string[] {
  const activity = activityFor(g, actorId);
  if (!activity) return [];
  const present = activity.members
    .filter((m) => atOwnSeat(g, m))
    .map((m) => m.actorId);
  return present.includes(actorId) ? present : [];
}
export function inspectStartReadyGathering(g: Game, id: string) {
  const activity = g.housing?.gatherings?.[id];
  const readyActorIds =
    activity?.members?.filter((m) => ready(g, m)).map((m) => m.actorId) ?? [];
  const disabled =
    !activity || activity.startedAt !== null
      ? "集合中の予定がありません。"
      : readyActorIds.length < required(activity)
        ? activity.kind === "talk"
          ? "会話には自席にいる二人が必要です。"
          : "自席に着いた人を待っています。"
        : undefined;
  return { ok: !disabled, ...(disabled ? { disabled } : {}), readyActorIds };
}
export function gatheringStatus(g: Game, actorId: string) {
  const activity = activityFor(g, actorId);
  const member = activity?.members.find((m) => m.actorId === actorId);
  if (!activity || !member) return null;
  const phase =
    member.status === "withdrawing"
      ? ("withdrawing" as const)
      : activity.startedAt === null
        ? ("gathering" as const)
        : ("active" as const);
  const room = g.house.rooms.find((r) => r.id === activity.roomId)!;
  const fixture = room.fixtures.find((f) => f.id === activity.fixtureId)!;
  const venue = furnishings[fixture.kind];
  const seat = Array.from({ length: venue.seats }, (_, i) => i).find(
    (i) => housingSlotId(room.id, fixture.id, i) === member.slotId,
  )!;
  const readyMembers = activity.members.filter((m) => ready(g, m));
  const atSeat = readyMembers.includes(member);
  const canUse = atSeat && readyMembers.length >= required(activity);
  const order = g.housing!.state.actors[actorId].order;
  let detail: string;
  if (phase === "withdrawing") detail = "区間の終点で集まりから離れます。";
  else if (atOwnSeat(g, member) && !atSeat)
    detail = spatialReasonText("use-denied");
  else if (order?.phase === "waiting" && !atSeat)
    detail = spatialReasonText(order.waitReason!);
  else if (phase === "gathering")
    detail = atSeat
      ? "自席でほかの人の到着を待っています。"
      : "予約した席へ向かっています。";
  else if (member.stoppedAt !== null && canUse) {
    const action = activity.kind === "meal" ? "食事" : "会話";
    detail =
      "次の1分から" +
      action +
      (member.usedMinutes ? "を再開できます。" : "を始められます。");
  } else if (activity.kind === "meal") detail = "自席で食事をしています。";
  else
    detail = canUse
      ? "席を囲んで話しています。"
      : "自席で話し相手を待っています。";
  if (phase === "active" && member.stoppedAt !== null && !canUse) {
    const remaining = gatheringWaitMinutes - (g.time - member.stoppedAt);
    detail += "この状態が続くと、あと" + remaining + "分で離れます。";
  }
  return {
    activityId: activity.id,
    kind: activity.kind,
    phase,
    detail,
    usedMinutes: member.usedMinutes,
    togetherMinutes: member.togetherMinutes,
    seatLabel: room.name + "・" + venue.name + "の席" + (seat + 1),
    canStartReady: inspectStartReadyGathering(g, activity.id).ok,
  };
}

function release(g: Game, member: GatheringMember, finished: boolean) {
  const actor = g.actors.find((a) => a.person.id === member.actorId)!;
  const task = actor.task;
  if (task?.spatial?.orderId !== member.orderId) return;
  if (!finished) g.food += task.reserved.food ?? 0;
  actor.task = null;
  actor.reason = finished
    ? "集まりでの予定を終えました。"
    : "集まりから離れ、席の予約を解除しました。";
  member.status = finished ? "completed" : "left";
  member.stoppedAt = null;
}
function withdraw(g: Game, member: GatheringMember) {
  if (member.status !== "participating") return;
  const h = g.housing!;
  if (h.state.actors[member.actorId]?.order?.id !== member.orderId) return;
  const result = cancelSpatialOrder(h.state, member.actorId);
  h.state = result.state;
  if (result.state.actors[member.actorId].order) {
    member.status = "withdrawing";
    member.stoppedAt = null;
  } else release(g, member, false);
}
function settle(g: Game, activity: HousingGathering, early = false) {
  const current = participating(activity);
  if (current.length < required(activity)) {
    for (const m of current) withdraw(g, m);
  } else if (activity.startedAt === null) {
    const present = current.filter((m) => ready(g, m));
    if (present.length === current.length) activity.startedAt = g.time;
    else if (early || g.time >= activity.deadline) {
      if (present.length >= required(activity)) activity.startedAt = g.time;
      for (const m of current)
        if (activity.startedAt === null || !present.includes(m)) withdraw(g, m);
    }
  }
  if (
    activity.members.every(
      (m) => m.status === "left" || m.status === "completed",
    )
  )
    delete g.housing!.gatherings![activity.id];
}
export function startReadyGathering(g: Game, activityId: string): Game {
  if (!inspectStartReadyGathering(g, activityId).ok) return g;
  const next = structuredClone(g);
  settle(next, next.housing!.gatherings![activityId], true);
  return next;
}
export function cancelGatheringMember(g: Game, actorId: string) {
  const activity = activityFor(g, actorId);
  const member = activity?.members.find((m) => m.actorId === actorId);
  if (!activity || !member) return;
  withdraw(g, member);
  settle(g, activity);
}

/** Snapshot all eligibility before moving anyone. A just-arrived member first uses the next minute. */
export function heldGatheringOrders(g: Game): Set<string> {
  const held = new Set<string>();
  for (const activity of Object.values(g.housing?.gatherings ?? {})) {
    const current = participating(activity);
    const present = current.filter((m) => ready(g, m));
    if (
      activity.startedAt === null &&
      present.length === current.length &&
      present.length >= required(activity)
    )
      activity.startedAt = g.housing!.state.time;
    const canUse =
      activity.startedAt !== null && present.length >= required(activity);
    for (const m of current)
      if (!canUse || !present.includes(m)) held.add(m.orderId);
  }
  return held;
}

function rememberGathering(
  now: number,
  self: Actor,
  peer: Actor,
  kind: GatheringKind,
  value: number,
) {
  const peerId = peer.person.id;
  const until = now + (kind === "meal" ? 180 : 150);
  const existing = self.memories.find(
    (m) =>
      m.until > now &&
      m.gathering?.kind === kind &&
      m.gathering.peerId === peerId,
  );
  if (existing) {
    existing.value = value;
    existing.until = until;
    return;
  }
  self.memories.push({
    label:
      peer.person.name +
      (kind === "meal" ? "と席を並べた食事" : "と交わした会話"),
    value,
    until,
    gathering: { kind, peerId },
  });
  if (self.memories.length > 100) self.memories.shift();
}

function accrueExperience(
  g: Game,
  activity: HousingGathering,
  users: GatheringMember[],
) {
  // Pair identity and directional bonds do not depend on simulation iteration order.
  const people = users
    .map((m) => g.actors.find((a) => a.person.id === m.actorId)!)
    .sort((a, b) => (a.person.id < b.person.id ? -1 : 1));
  for (const [i, person] of people.entries()) {
    if (activity.kind === "meal") {
      person.needs.hunger = Math.min(100, person.needs.hunger + 2.8);
      if (people.length > 1)
        person.needs.social = Math.min(100, person.needs.social + 0.5);
    } else person.needs.social = Math.min(100, person.needs.social + 2);
    for (const peer of people.slice(i + 1)) {
      let pair = activity.pairs.find(
        (p) =>
          p.actorIds[0] === person.person.id &&
          p.actorIds[1] === peer.person.id,
      );
      if (!pair) {
        pair = { actorIds: [person.person.id, peer.person.id], minutes: 0 };
        activity.pairs.push(pair);
      }
      pair.minutes++;
      for (const [self, other] of [
        [person, peer],
        [peer, person],
      ]) {
        const bond = self.relations[other.person.id];
        const sign = bond.kind === "rival" ? -1 : 1;
        for (const key of ["trust", "affection"] as const)
          bond[key] = Math.max(
            -100,
            Math.min(100, Math.round(bond[key] * 10 + sign) / 10),
          );
        if (pair.minutes === 5)
          rememberGathering(g.time, self, other, activity.kind, 4 * sign);
      }
    }
  }
}

export function finishGatheringMinute(
  g: Game,
  minutes: ReadonlyMap<string, HousingMinute>,
  applyEffects = true,
) {
  for (const activity of Object.values(g.housing?.gatherings ?? {})) {
    const used = participating(activity).filter(
      (m) => minutes.get(m.actorId)?.used,
    );
    for (const m of used) {
      m.usedMinutes++;
      m.stoppedAt = null;
      if (used.length > 1) m.togetherMinutes++;
      if (activity.kind === "meal" && m.usedMinutes === 1)
        g.actors.find((a) => a.person.id === m.actorId)!.task!.reserved = {};
    }
    if (applyEffects) accrueExperience(g, activity, used);
    // Finalize every original order before checking quorum. One completed talker
    // must not cancel their partner on a minute they both finished.
    for (const m of activity.members) {
      if (m.status !== "participating" && m.status !== "withdrawing") continue;
      const terminal = minutes.get(m.actorId)?.terminal;
      if (terminal) release(g, m, terminal === "finish");
      else if (
        m.status === "participating" &&
        activity.startedAt !== null &&
        !used.includes(m)
      ) {
        m.stoppedAt ??= g.time - 1;
        if (g.time - m.stoppedAt >= gatheringWaitMinutes) withdraw(g, m);
      }
    }
    settle(g, activity);
  }
}
