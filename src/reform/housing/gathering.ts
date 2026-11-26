import { fields } from "./saveFields";
import { foodCookingSeat } from "./foodCooking";
import type { Game } from "../sim";
import { issueSpatialOrder } from "../spatial/actions";
import { inspectSpatialRoute } from "../spatial/route";
import {
  locateHousingActor,
  rebuildHousingGeometry,
  safeExitReason,
  spatialReasonText,
} from "./bridge";
import { inspectHousingLayoutUpgrade } from "./layout";
import {
  allowGatheringGuest,
  effectiveRoomAccess,
  buildHousingTopology,
  housingPoint,
  legacyHousingStation,
} from "./topology";
import {
  gatheringUseMinutes,
  gatheringWaitMinutes,
  isGatheringVenue,
  type GatheringKind,
  type GatheringInvitation,
  type HousingGathering,
} from "./types";

export type GatheringRequest = {
  invitation?: GatheringInvitation;
  kind: GatheringKind;
  roomId: string;
  fixtureId: string;
  actorIds: string[];
};
type Assignment = { actorId: string; slotId: string; minutes: number };
export type GatheringInspection = {
  ok: boolean;
  disabled?: string;
  // Seat counts are unavailable when the layout upgrade is rejected.
  capacity: number | null;
  physicalCapacity: number | null;
  food: number;
  useMinutes: number;
  arrivalMinutes: number | null;
  minutes: number | null;
  assignments: Assignment[];
};
export {
  inspectStartReadyGathering,
  startReadyGathering,
  gatheringStatus,
  gatheringPresence,
} from "./gatheringProgress";

// Candidates arrive in lexical seat order. Retaining the first equally good
// complete assignment implements the final actor-by-actor seat tie break.
function matchSeats(choices: Assignment[][]): Assignment[] | null {
  let best: Assignment[] | null = null;
  let latest = Infinity,
    sum = Infinity;
  function visit(path: Assignment[], max: number, total: number) {
    if (path.length === choices.length) {
      if (max < latest || (max === latest && total < sum)) {
        best = [...path];
        latest = max;
        sum = total;
      }
      return;
    }
    for (const candidate of choices[path.length]) {
      if (path.some((p) => p.slotId === candidate.slotId)) continue;
      path.push(candidate);
      visit(path, Math.max(max, candidate.minutes), total + candidate.minutes);
      path.pop();
    }
  }
  visit([], 0, 0);
  return best;
}

function prepare(
  g: Game,
  request: GatheringRequest,
): { inspection: GatheringInspection; game?: Game } {
  const { kind, roomId, fixtureId } = request;
  const ids = [...request.actorIds].sort();
  const food = kind === "meal" ? ids.length : 0;
  let capacity: number | null = null;
  let physicalCapacity: number | null = null;
  function refuse(disabled: string) {
    return {
      inspection: {
        ok: false,
        disabled,
        capacity,
        physicalCapacity,
        food,
        useMinutes: gatheringUseMinutes,
        arrivalMinutes: null,
        minutes: null,
        assignments: [],
      },
    };
  }
  const upgrade = inspectHousingLayoutUpgrade(g);
  if (!upgrade.ok) return refuse(upgrade.reason);
  const h = upgrade.housing;
  const topology = buildHousingTopology(
    g.house,
    Object.keys(h.state.actors),
    h.controls,
    h.state.actors,
    2,
    h.construction,
    h.gatherings,
    h.lodging,
  );
  const booked = new Set(
    Object.values(h.state.reservations)
      .filter((r) => r.kind === "slot")
      .map((r) => r.targetId),
  );
  const cookingSeat = foodCookingSeat(g);
  if (cookingSeat) booked.add(cookingSeat);
  const old = new Set(
    g.actors
      .filter((a) => a.task?.station && !a.task.spatial)
      .map((a) => a.task!.station),
  );
  const seats = Object.values(topology.slots).filter(
    (s) =>
      s.roomId === roomId &&
      s.fixtureId === fixtureId &&
      isGatheringVenue(s.kind),
  );
  const free = seats
    .filter((s) => !booked.has(s.id) && !old.has(legacyHousingStation(s)))
    .sort((a, b) => (a.id < b.id ? -1 : 1));
  physicalCapacity = seats.length;
  capacity = free.length;
  if (!seats.length || (kind !== "talk" && kind !== "meal"))
    return refuse("長椅子・丸卓・台所と食卓から会場を選んでください。");
  if (ids.length < 2 || new Set(ids).size !== ids.length)
    return refuse("異なる住人を二人以上選んでください。");
  if (ids.length > capacity)
    return refuse("この会場の空いている席が足りません。");
  if (g.food < food) return refuse("人数分の完成した食事がありません。");
  if (!Number.isSafeInteger((h.nextGatheringId ?? 1) + 1))
    return refuse("新しい集まりの番号を発行できません。");
  for (const id of ids) {
    const a = g.actors.find((p) => p.person.id === id);
    if (!a) return refuse("選んだ住人が見つかりません。");
    if (a.location !== g.home || a.danger || a.injury >= 70)
      return refuse(a.person.name + "は今、自宅の集まりに参加できません。");
    if (
      Object.hasOwn(h.state.actors, id) &&
      h.state.actors[id].position.kind === "transit"
    )
      return refuse(safeExitReason);
    if (a.task) return refuse(a.person.name + "には進行中の予定があります。");
    if (!Object.hasOwn(h.state.actors, id))
      locateHousingActor(g, h, id, housingPoint(a.room, 0));
  }
  const hasInvitation = Object.hasOwn(request, "invitation");
  const invitation = hasInvitation ? request.invitation : undefined;
  if (hasInvitation) {
    if (
      !fields(invitation, ["hostId", "guestId"]) ||
      invitation.hostId === invitation.guestId ||
      !ids.includes(invitation.hostId) ||
      !ids.includes(invitation.guestId)
    )
      return refuse(
        "集まりに参加する別々の住人を、招く人と招かれる人に選んでください。",
      );
    const allowed = effectiveRoomAccess(roomId, h.controls, h.lodging);
    if (
      !allowed ||
      !allowed.includes(invitation.hostId) ||
      allowed.includes(invitation.guestId)
    )
      return refuse(
        "入室できる住人が、その部屋に入室許可のない住人を招けます。",
      );
    // Seat matching considers all available seats. Only the chosen seat is kept after booking.
    allowGatheringGuest(
      h.state,
      roomId,
      invitation.guestId,
      free.map((s) => s.id),
    );
  }
  const choices: Assignment[][] = [];
  for (const id of ids) {
    const pos = h.state.actors[id].position;
    if (pos.kind !== "at") return refuse(safeExitReason);
    let reason = "この住人が使える席がありません。";
    const options: Assignment[] = [];
    for (const seat of free) {
      const allowed = h.state.slots[seat.id].allowedActorIds;
      if (allowed && !allowed.includes(id)) {
        reason = spatialReasonText("use-denied");
        continue;
      }
      const route = inspectSpatialRoute(h.state, id, pos.point, seat.point);
      if (!route.ok) {
        reason = spatialReasonText(route.reason);
        continue;
      }
      options.push({ actorId: id, slotId: seat.id, minutes: route.minutes });
    }
    if (!options.length) return refuse(reason);
    choices.push(options);
  }
  const assignments = matchSeats(choices);
  if (!assignments) return refuse("全員が使える別々の席を確保できません。");
  const arrivalMinutes = Math.max(...assignments.map((a) => a.minutes));
  const deadline = g.time + arrivalMinutes + gatheringWaitMinutes;
  if (!Number.isSafeInteger(deadline))
    return refuse("集合期限を設定できません。");
  const next = {
    ...g,
    actors: g.actors.map((a) => ({ ...a })),
    housing: h,
    food: g.food - food,
  };
  const serial = h.nextGatheringId ?? 1;
  const group: HousingGathering = {
    id: "gathering-" + serial,
    ...(invitation && { invitation: { ...invitation } }),
    kind,
    roomId,
    fixtureId,
    createdAt: g.time,
    deadline,
    startedAt: arrivalMinutes === 0 ? g.time : null,
    useMinutes: gatheringUseMinutes,
    members: [],
    pairs: [],
  };
  for (const { actorId, slotId } of assignments) {
    const issued = issueSpatialOrder(h.state, {
      kind: "use",
      actorId,
      slotId,
      useMinutes: gatheringUseMinutes,
    });
    if (!issued.ok) return refuse(spatialReasonText(issued.reason));
    h.state = issued.state;
    const actor = next.actors.find((a) => a.person.id === actorId)!;
    const label = kind === "meal" ? "集まって食事をする" : "集まって話す";
    actor.task = {
      kind: "home-gather",
      target: kind,
      label,
      room: roomId,
      station: slotId,
      from: g.home,
      remaining: gatheringUseMinutes,
      total: gatheringUseMinutes,
      mode: "direct",
      metric: kind === "meal" ? "care" : "free",
      reserved: food ? { food: 1 } : {},
      spatial: { kind: "use", orderId: issued.orderId, gatheringId: group.id },
    };
    actor.reason = "直接の指示で、" + label + "予定です。";
    group.members.push({
      actorId,
      slotId,
      orderId: issued.orderId,
      status: "participating",
      usedMinutes: 0,
      togetherMinutes: 0,
      stoppedAt: null,
    });
  }
  (h.gatherings ??= {})[group.id] = group;
  h.nextGatheringId = serial + 1;
  if (invitation) rebuildHousingGeometry(next, h);
  return {
    inspection: {
      ok: true,
      capacity,
      physicalCapacity,
      food,
      useMinutes: gatheringUseMinutes,
      arrivalMinutes,
      minutes: arrivalMinutes + gatheringUseMinutes,
      assignments,
    },
    game: next,
  };
}
export function inspectHousingGathering(
  g: Game,
  request: GatheringRequest,
): GatheringInspection {
  return prepare(g, request).inspection;
}
export function startHousingGathering(
  g: Game,
  request: GatheringRequest,
): Game {
  return prepare(g, request).game ?? g;
}

export { nextGatheringCompletionMinutes } from "./gatheringForecast";
