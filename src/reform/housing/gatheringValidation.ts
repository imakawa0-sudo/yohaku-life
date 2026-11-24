import { furnishings } from "../house";
import type { Game } from "../sim";
import { sameSpatialPoint } from "../spatial/route";
import { housingSlotId } from "./topology";
import {
  gatheringUseMinutes,
  gatheringWaitMinutes,
  isGatheringVenue,
  type GatheringMember,
  type HousingGathering,
  type HousingRuntime,
} from "./types";

const record = (v: unknown): v is Record<string, unknown> =>
  !!v &&
  typeof v === "object" &&
  (Object.getPrototypeOf(v) === Object.prototype ||
    Object.getPrototypeOf(v) === null);
function keys(v: unknown, allowed: string[]) {
  return (
    record(v) &&
    Object.keys(v).length === allowed.length &&
    allowed.every((k) => Object.hasOwn(v, k))
  );
}
function integer(v: unknown, min: number, max = Number.MAX_SAFE_INTEGER) {
  return (
    typeof v === "number" && Number.isSafeInteger(v) && v >= min && v <= max
  );
}
function issued(id: unknown, prefix: string, next: number) {
  if (typeof id !== "string") return false;
  const n = Number(id.slice(prefix.length));
  return integer(n, 1, next - 1) && id === prefix + n;
}
function validMember(
  m: GatheringMember,
  group: HousingGathering,
  g: Game,
  h: HousingRuntime,
  seats: number,
) {
  if (
    !keys(m, [
      "actorId",
      "slotId",
      "orderId",
      "status",
      "usedMinutes",
      "togetherMinutes",
      "stoppedAt",
    ]) ||
    !issued(m.orderId, "order-", h.state.nextOrderId) ||
    !["participating", "withdrawing", "left", "completed"].includes(m.status) ||
    !integer(m.usedMinutes, 0, gatheringUseMinutes) ||
    !integer(m.togetherMinutes, 0, m.usedMinutes) ||
    (m.status === "completed") !== (m.usedMinutes === gatheringUseMinutes)
  )
    return false;
  const actor = g.actors.find((a) => a.person.id === m.actorId);
  if (
    !actor ||
    !Array.from({ length: seats }, (_, i) =>
      housingSlotId(group.roomId, group.fixtureId, i),
    ).includes(m.slotId)
  )
    return false;
  const start = group.startedAt;
  if (start === null ? m.usedMinutes !== 0 : m.usedMinutes > g.time - start)
    return false;
  if (
    m.stoppedAt !== null &&
    (m.status !== "participating" ||
      start === null ||
      !integer(
        m.stoppedAt,
        Math.max(start + m.usedMinutes, g.time - gatheringWaitMinutes + 1),
        g.time - 1,
      ) ||
      (m.usedMinutes === 0 && m.stoppedAt !== start))
  )
    return false;
  const task = actor.task;
  if (m.status === "completed" || m.status === "left")
    return (
      task?.spatial?.gatheringId !== group.id &&
      !Object.values(h.state.actors).some((a) => a.order?.id === m.orderId)
    );
  const order = h.state.actors[m.actorId]?.order;
  if (
    !task ||
    !keys(task, [
      "kind",
      "label",
      "target",
      "room",
      "station",
      "from",
      "remaining",
      "total",
      "mode",
      "metric",
      "reserved",
      "spatial",
    ]) ||
    task.spatial?.gatheringId !== group.id ||
    task.spatial.orderId !== m.orderId ||
    task.kind !== "home-gather" ||
    task.target !== group.kind ||
    task.mode !== "direct" ||
    task.metric !== (group.kind === "meal" ? "care" : "free") ||
    task.total !== gatheringUseMinutes ||
    task.remaining !== gatheringUseMinutes - m.usedMinutes ||
    !order ||
    order.id !== m.orderId ||
    order.intent.kind !== "use" ||
    order.intent.slotId !== m.slotId ||
    order.useRemaining !== task.remaining ||
    (m.status === "withdrawing") !== (order.phase === "exiting-after-cancel")
  )
    return false;
  const escrow = group.kind === "meal" && m.usedMinutes === 0;
  if (
    !keys(task.reserved, escrow ? ["food"] : []) ||
    (escrow && task.reserved.food !== 1)
  )
    return false;
  const pos = h.state.actors[m.actorId].position;
  if (m.status === "withdrawing")
    return pos.kind === "transit" && m.usedMinutes === 0;
  if (start === null) return true;
  // A permission edit alone leaves the previous phase untouched. Once a use
  // tick actually records denial, the same tick must start the non-use clock.
  if (
    g.time > start &&
    order.waitReason === "use-denied" &&
    m.stoppedAt === null
  )
    return false;
  return (
    pos.kind === "at" &&
    sameSpatialPoint(pos.point, h.state.slots[m.slotId].point) &&
    (order.phase === "use" ||
      (order.phase === "waiting" && order.resumePhase === "use")) &&
    (g.time === start || m.usedMinutes > 0 || m.stoppedAt !== null)
  );
}

function validPairs(group: HousingGathering, now: number) {
  const minutesByPair = new Map<string, number>();
  for (const pair of group.pairs) {
    if (
      !keys(pair, ["actorIds", "minutes"]) ||
      !Array.isArray(pair.actorIds) ||
      pair.actorIds.length !== 2
    )
      return false;
    const [a, b] = pair.actorIds.map((id) =>
      group.members.find((m) => m.actorId === id),
    );
    const key = JSON.stringify(pair.actorIds);
    if (
      !a ||
      !b ||
      a.actorId >= b.actorId ||
      minutesByPair.has(key) ||
      !integer(pair.minutes, 1, Math.min(a.togetherMinutes, b.togetherMinutes))
    )
      return false;
    minutesByPair.set(key, pair.minutes);
  }
  for (const [index, first] of group.members.entries()) {
    for (const second of group.members.slice(index + 1)) {
      const key = JSON.stringify([first.actorId, second.actorId].sort());
      // Neither member used the interval after both had stopped. Terminal
      // records release their clocks, so their latest possible endpoint is now.
      const end = Math.max(first.stoppedAt ?? now, second.stoppedAt ?? now);
      const window = end - (group.startedAt ?? end);
      if (
        (minutesByPair.get(key) ?? 0) <
        first.usedMinutes + second.usedMinutes - window
      )
        return false;
    }
  }
  let tripleOverlap: number | undefined;
  const consistentTotals = group.members.every((m) => {
    const sum = group.pairs
      .filter((p) => p.actorIds.includes(m.actorId))
      .reduce((acc, p) => acc + p.minutes, 0);
    // With three seats, a minute together is counted in two pairs only
    // when all three people used them. This count must agree for all three.
    if (group.members.length === 3) {
      tripleOverlap ??= sum - m.togetherMinutes;
      if (sum - m.togetherMinutes !== tripleOverlap) return false;
    }
    return (
      m.togetherMinutes <= sum &&
      (group.kind !== "talk" || m.usedMinutes === m.togetherMinutes)
    );
  });
  if (!consistentTotals) return false;
  if (
    group.kind !== "talk" ||
    group.startedAt === null ||
    group.startedAt === now
  )
    return true;

  // A participating member with no stop clock talked in the last minute.
  // A terminal peer might have left or finished at that exact boundary.
  // Current room permissions can change without a tick.
  const lastTalkers = group.members.filter(
    (m) => m.status === "participating" && m.stoppedAt === null,
  );
  if (lastTalkers.length === 0) return true;
  const possiblePeers = new Set(
    group.members
      .filter((m) => m.stoppedAt === null && m.usedMinutes > 0)
      .map((m) => m.actorId),
  );
  const threeWayMinutes = tripleOverlap ?? 0;
  if (threeWayMinutes > 0 && possiblePeers.size === 3) return true;
  // Without a possible three-way minute, every known talker must fit in
  // one recorded minute spent by just this pair.
  return group.pairs.some(
    (p) =>
      p.minutes > threeWayMinutes &&
      p.actorIds.every((id) => possiblePeers.has(id)) &&
      lastTalkers.every((m) => p.actorIds.includes(m.actorId)),
  );
}

// Called after the spatial codec and per-actor housing binding checks. Together
// those already prove the actual order owns precisely its live seat reservation.
export function validGatherings(h: HousingRuntime, g: Game) {
  const tasks = g.actors.filter((a) => a.task?.kind === "home-gather");
  if (!Object.hasOwn(h, "gatherings") && !Object.hasOwn(h, "nextGatheringId"))
    return tasks.length === 0;
  if (
    h.layoutVersion !== 2 ||
    !integer(h.nextGatheringId, 2) ||
    !record(h.gatherings)
  )
    return false;
  const live = new Set<string>(),
    orders = new Set<string>();
  for (const [id, group] of Object.entries(h.gatherings)) {
    if (
      !keys(group, [
        "id",
        "kind",
        "roomId",
        "fixtureId",
        "createdAt",
        "deadline",
        "startedAt",
        "useMinutes",
        "members",
        "pairs",
      ]) ||
      group.id !== id ||
      !issued(id, "gathering-", h.nextGatheringId!) ||
      !["meal", "talk"].includes(group.kind) ||
      group.useMinutes !== gatheringUseMinutes ||
      !integer(group.createdAt, 480, g.time) ||
      !integer(group.deadline, group.createdAt + gatheringWaitMinutes) ||
      (group.startedAt !== null &&
        !integer(
          group.startedAt,
          group.createdAt,
          Math.min(g.time, group.deadline),
        )) ||
      !Array.isArray(group.members) ||
      !Array.isArray(group.pairs)
    )
      return false;
    const fixture = g.house.rooms
      .find((r) => r.id === group.roomId)
      ?.fixtures.find((f) => f.id === group.fixtureId);
    if (!fixture || !isGatheringVenue(fixture.kind)) return false;
    const seats = furnishings[fixture.kind].seats;
    if (group.members.length < 2 || group.members.length > seats) return false;
    const actors = new Set<string>(),
      slots = new Set<string>();
    let participants = 0,
      withdrawing = 0;
    for (const m of group.members) {
      if (
        !validMember(m, group, g, h, seats) ||
        actors.has(m.actorId) ||
        slots.has(m.slotId) ||
        orders.has(m.orderId)
      )
        return false;
      actors.add(m.actorId);
      slots.add(m.slotId);
      orders.add(m.orderId);
      if (m.status === "participating" || m.status === "withdrawing") {
        if (live.has(m.actorId)) return false;
        live.add(m.actorId);
        if (m.status === "participating") participants++;
        else withdrawing++;
      }
    }
    if (
      !(participants + withdrawing) ||
      (participants === 1 && group.kind === "talk") ||
      (participants && group.startedAt === null && g.time >= group.deadline) ||
      !validPairs(group, g.time)
    )
      return false;
  }
  return tasks.every((a) => live.has(a.person.id));
}
