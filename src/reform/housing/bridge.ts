import { activeLodgingWorkGraph } from "./lodgingMaintenanceAccess";
import {
  privateWorkFloor,
  recordMaintenanceEntry,
  releaseFinishedMaintenanceVisits,
} from "./maintenanceVisit";
import { reconcileRoomInvitations } from "./gatheringProgress";
import { prepareBenchMinute, refreshBenchHandling } from "./benchRecovery";
import { prepareFoodMinute } from "./foodProgress";
import { foodCookingSeat, planFoodCooking } from "./foodCooking";
import { refreshFoodHandling } from "./food";
import { getBedSleeper, getPreferredBed } from "./bedPreference";
import { refreshConstructionHandling } from "./constructionTopology";
import { releaseRevokedConstructionWorkers } from "./constructionProgress";
import { furnishings, type Need } from "../house";
import type { Actor, Game, Task } from "../sim";
import {
  advanceSpatialMinute,
  cancelSpatialOrder,
  issueSpatialOrder,
} from "../spatial/actions";
import { inspectSpatialRoute, sameSpatialPoint } from "../spatial/route";
import type {
  SpatialIntent,
  SpatialPoint,
  SpatialReason,
  SpatialState,
} from "../spatial/types";
import {
  createHousingRuntime,
  isRegionalHousingTask,
  readHousingMoveTarget,
} from "./runtime";
import {
  buildHousingTopology,
  housingDoorId,
  housingPoint,
  housingRoomId,
  housingSourcePoint,
  legacyHousingStation,
} from "./topology";
import type { HousingRuntime, HousingSlot, HousingUsePreview } from "./types";

export function enableHousing(g: Game, mode: "new" | "legacy"): Game {
  if (g.housing) return g;
  const next = structuredClone(g);
  next.housing = createHousingRuntime(next, mode);
  return next;
}
function geometry(g: Game, h: HousingRuntime) {
  return buildHousingTopology(
    g.house,
    Object.keys(h.state.actors),
    h.controls,
    h.state.actors,
    h.layoutVersion,
    h.construction,
    h.gatherings,
    h.lodging,
  );
}
/** Inspect a leg with the entry rights the resident will have at its starting floor. */
export function inspectHousingRouteFrom(
  g: Game,
  h: HousingRuntime,
  actorId: string,
  from: SpatialPoint,
  to: SpatialPoint,
  graph = h.state,
) {
  const actor = graph.actors[actorId];
  const current = housingSourcePoint(actor);
  if (
    current &&
    current.domainId !== from.domainId &&
    (h.controls.roomAccess[housingRoomId(current.domainId)!] !== null ||
      h.controls.roomAccess[housingRoomId(from.domainId)!] !== null)
  ) {
    const actors = {
      ...graph.actors,
      [actorId]: { ...actor, position: { kind: "at" as const, point: from } },
    };
    const { geometry } = buildHousingTopology(
      g.house,
      Object.keys(actors),
      h.controls,
      actors,
      h.layoutVersion,
      h.construction,
      h.gatherings,
      h.lodging,
    );
    // Keep the caller's physical graph (it may be checking permission independently of closures).
    graph = { ...graph, actors, entryRules: geometry.entryRules };
  }
  return inspectSpatialRoute(graph, actorId, from, to);
}
export function rebuildHousingGeometry(g: Game, h: HousingRuntime) {
  const topology = geometry(g, h);
  Object.assign(h.state, topology.geometry);
  h.controls = topology.controls;
  releaseFinishedMaintenanceVisits(h);
  refreshConstructionHandling(h);
  refreshFoodHandling(h);
  refreshBenchHandling(h);
}
export function setHousingPassage(
  g: Game,
  kind: "link" | "door",
  id: string,
  open: boolean,
): Game {
  if (!g.housing) return g;
  const available =
    kind === "link"
      ? Object.hasOwn(g.housing.state.connections, id)
      : g.house.rooms.some((r) =>
          r.doors.some((c) => housingDoorId(r.id, c) === id),
        );
  const key = kind === "link" ? "closedLinks" : "closedDoors";
  if (!available || g.housing.controls[key].includes(id) === !open) return g;
  const next = structuredClone(g),
    h = next.housing!;
  h.controls[key] = open
    ? h.controls[key].filter((v) => v !== id)
    : [...h.controls[key], id];
  rebuildHousingGeometry(next, h);
  return next;
}
export function setHousingRoomAccess(
  g: Game,
  roomId: string,
  allowedActorIds: string[] | null,
): Game {
  if (
    !g.housing ||
    !g.house.rooms.some((r) => r.id === roomId) ||
    allowedActorIds?.some((id) => !g.actors.some((a) => a.person.id === id))
  )
    return g;
  const next = structuredClone(g),
    h = next.housing!;
  h.controls.roomAccess[roomId] =
    allowedActorIds === null ? null : [...allowedActorIds];
  const offer = h.lodging;
  if (
    offer?.phase === "offered" &&
    offer.roomId === roomId &&
    allowedActorIds !== null &&
    !allowedActorIds.includes(offer.providerId)
  )
    delete h.lodging;
  rebuildHousingGeometry(next, h);
  reconcileRoomInvitations(next, roomId);
  releaseRevokedConstructionWorkers(next, g.housing);
  prepareFoodMinute(next);
  prepareBenchMinute(next);
  return next;
}
export function locateHousingActor(
  g: Game,
  h: HousingRuntime,
  id: string,
  point: SpatialPoint,
) {
  delete h.unlocated[id];
  h.state.actors = {
    ...h.state.actors,
    [id]: {
      id,
      position: { kind: "at", point },
      order: null,
      carryAllowedActorIds: null,
    },
  };
  rebuildHousingGeometry(g, h);
}
export function housingTogether(g: Game, a: Actor, b: Actor) {
  const first = g.housing?.state.actors[a.person.id]?.position;
  const second = g.housing?.state.actors[b.person.id]?.position;
  return (
    first?.kind === "at" &&
    second?.kind === "at" &&
    sameSpatialPoint(first.point, second.point)
  );
}
/** A regional task temporarily removes its travellers from the home graph. */
export function housingTaskBoundary(
  g: Game,
  a: Actor,
  t: Task,
  event: "begin" | "finish" | "cancel",
) {
  const h = g.housing;
  if (!h) return;
  const id = a.person.id;
  if (event !== "begin" && t.station && !t.spatial)
    delete h.legacyStationPaths[id];
  const previous = Object.hasOwn(h.unlocated, id) ? h.unlocated[id] : undefined;
  if (isRegionalHousingTask(t)) {
    if (event === "begin") {
      const pos = h.state.actors[id]?.position;
      h.unlocated = {
        ...h.unlocated,
        [id]: {
          location: a.location,
          room: a.room,
          reason: "regional-travel",
          ...(pos?.kind === "at" ? { departurePoint: pos.point } : {}),
        },
      };
      delete h.state.actors[id];
      rebuildHousingGeometry(g, h);
    } else if (
      a.location === g.home &&
      (event === "finish" || previous?.departurePoint)
    ) {
      locateHousingActor(
        g,
        h,
        id,
        event === "finish"
          ? housingPoint("living", 0)
          : previous!.departurePoint!,
      );
    } else {
      h.unlocated = {
        ...h.unlocated,
        [id]: {
          location: a.location,
          room: a.room,
          reason: a.location === g.home ? "legacy-unspecified" : "outside",
        },
      };
      releaseFinishedMaintenanceVisits(h);
    }
  } else if (previous) {
    if (event === "begin" && a.location === g.home) {
      locateHousingActor(g, h, id, housingPoint(a.room, 0));
    } else {
      previous.location = a.location;
      previous.room = a.room;
    }
  }
}

export const safeExitReason =
  "移動区間の途中です。先に予定を取り消し、区間の終点に着いてから指示してください。";
export function housingInTransit(g: Game, id: string) {
  const actors = g.housing?.state.actors;
  return (
    !!actors &&
    Object.hasOwn(actors, id) &&
    actors[id].position.kind === "transit"
  );
}
export function spatialReasonText(reason: SpatialReason): string {
  switch (reason) {
    case "handling-denied":
      return "物資を扱う許可がありません。拾う部屋と届け先の利用許可を確認してください。";
    case "entry-denied":
      return "入室の許可がありません。通る部屋の利用許可を確認してください。";
    case "use-denied":
      return "設備を使う許可がありません。部屋の利用許可を確認してください。";
    case "physical-block":
      return "目的地への通路が通れません。戸・通路の開閉と間取りを確認してください。";
    case "reserved":
      return "使える設備はほかの住人が予約しています。";
    case "actor-busy":
      return "現在の予定が終わるのを待ってください。";
    case "missing":
      return "利用できる設備または行き先が見つかりません。";
    default:
      return "この地点や指示は選べません。";
  }
}

type UseReason = SpatialReason | "assigned-bed";

function unavailableUseReason(reasons: ReadonlySet<UseReason>): string {
  const hasAssignedBed = reasons.has("assigned-bed");
  if (hasAssignedBed && reasons.size === 1) return "ほかの住人専用の寝床です。";
  for (const reason of [
    "use-denied",
    "entry-denied",
    "reserved",
    "physical-block",
  ] as const)
    if (reasons.has(reason)) {
      const detail = spatialReasonText(reason);
      return hasAssignedBed
        ? "ほかの住人専用の寝床があります。" + detail
        : detail;
    }
  return "使える設備の使用位置がありません。家具の隣に入口から届く床が必要です。";
}

export type HousingProposal = {
  task: Task;
  minutes: number;
  state: SpatialState;
  facility?: HousingUsePreview;
  foodBundle?: {
    bundleId: string;
    quantity: 2;
    location: string;
    transportMinutes: number;
  };
};
function accept(
  h: HousingRuntime,
  t: Task,
  intent: Exclude<SpatialIntent, { kind: "carry" }>,
  minutes: number,
  facility?: HousingUsePreview,
): HousingProposal | string {
  const result = issueSpatialOrder(h.state, intent);
  if (!result.ok) return spatialReasonText(result.reason);
  t.spatial = { orderId: result.orderId, kind: intent.kind };
  return {
    task: t,
    minutes,
    state: result.state,
    ...(facility && { facility }),
  };
}
/** Planning an unknown position uses a detached trial. Only begin publishes the result. */
export function planHousing(
  g: Game,
  a: Actor,
  t: Task,
  need?: Need | null,
  water = 0,
  fixtureId?: string,
  bundleId?: string,
): HousingProposal | string {
  const id = a.person.id;
  let h = g.housing!;
  if (!Object.hasOwn(h.state.actors, id)) {
    h = structuredClone(h);
    locateHousingActor(g, h, id, housingPoint(a.room, 0));
  }
  const position = h.state.actors[id].position;
  if (position.kind !== "at") return safeExitReason;
  if (t.kind === "home-move") {
    const dest = readHousingMoveTarget(t.target);
    if (!dest) return spatialReasonText("invalid-input");
    if (privateWorkFloor(h, id, dest))
      return "工事のために入った居室です。入口か室外への移動先を選んでください。";
    const route = inspectSpatialRoute(h.state, id, position.point, dest);
    if (!route.ok) return spatialReasonText(route.reason);
    t.total = t.remaining = Math.max(1, route.minutes);
    t.room = housingRoomId(dest.domainId)!;
    return accept(
      h,
      t,
      { kind: "move", actorId: id, destination: dest },
      t.total,
    );
  }
  const work = t.kind === "work";
  const preferredFixtureId =
    t.kind === "need" && need === "energy" && fixtureId === undefined
      ? getPreferredBed(g, id)
      : undefined;
  const { slots } = geometry(g, h);
  const legacySeats = new Set(
    g.actors
      .filter((b) => b !== a && b.task?.station && !b.task.spatial)
      .map((b) => b.task!.station),
  );
  const claimedSeat = foodCookingSeat(g);
  const reasons = new Set<UseReason>();
  const preferredReasons = new Set<UseReason>();
  const recordUnavailable = (reason: UseReason, preferred: boolean) => {
    reasons.add(reason);
    if (preferred) preferredReasons.add(reason);
  };
  let best:
    | { slot: HousingSlot; minutes: number; use: number; preferred: boolean }
    | undefined;
  for (const slot of Object.values(slots)) {
    if (fixtureId !== undefined && slot.fixtureId !== fixtureId) continue;
    const f = furnishings[slot.kind];
    if (f.need !== need || (work && slot.seat !== 0)) continue;
    const preferred = slot.fixtureId === preferredFixtureId;
    if (need === "energy") {
      const sleeper = getBedSleeper(g, slot.fixtureId);
      if (sleeper !== undefined && sleeper !== id) {
        recordUnavailable("assigned-bed", preferred);
        continue;
      }
    }
    if (
      slot.id === claimedSeat ||
      legacySeats.has(legacyHousingStation(slot)) ||
      Object.values(h.state.reservations).some(
        (r) => r.kind === "slot" && r.targetId === slot.id,
      )
    ) {
      recordUnavailable("reserved", preferred);
      continue;
    }
    const route = inspectSpatialRoute(h.state, id, position.point, slot.point);
    if (!route.ok) {
      recordUnavailable(route.reason, preferred);
      continue;
    }
    const allowed = h.state.slots[slot.id].allowedActorIds;
    if (allowed !== null && !allowed.includes(id)) {
      recordUnavailable("use-denied", preferred);
      continue;
    }
    if (t.kind === "recover" && a.injury >= 70 && route.minutes > 0)
      return "重い傷で寝床まで移動できません。今いる場所で療養できます。";
    const use =
      slot.kind === "workbench" || t.kind === "recover"
        ? t.total
        : f.time +
          (work ? t.total - 10 : slot.kind === "basin" ? 2 * water : 0);
    const minutes = use + route.minutes;
    if (
      !best ||
      (preferred && !best.preferred) ||
      (preferred === best.preferred &&
        (minutes < best.minutes ||
          (minutes === best.minutes && slot.id < best.slot.id)))
    )
      best = { slot, minutes, use, preferred };
  }
  if (!best) return unavailableUseReason(reasons);
  const { slot, minutes, use } = best;
  let bedPreference: HousingUsePreview["bedPreference"];
  if (preferredFixtureId !== undefined) {
    bedPreference = best.preferred
      ? { fixtureId: preferredFixtureId, outcome: "preferred" }
      : {
          fixtureId: preferredFixtureId,
          outcome: "fallback",
          reason: unavailableUseReason(preferredReasons),
        };
  }
  t.station = slot.id;
  t.room = slot.roomId;
  t.total = t.remaining = use;
  if (t.kind === "need")
    t.label =
      need === "social"
        ? furnishings[slot.kind].name + "で過ごす"
        : furnishings[slot.kind].use;
  const room = g.house.rooms.find((r) => r.id === slot.roomId)!;
  const fixture = room.fixtures.find((f) => f.id === slot.fixtureId)!;
  const proposal = accept(
    h,
    t,
    { kind: "use", actorId: id, slotId: slot.id, useMinutes: use },
    minutes,
    {
      fixtureId: slot.fixtureId,
      roomId: slot.roomId,
      fixtureKind: slot.kind,
      fixtureCell: fixture.cell,
      moveMinutes: minutes - use,
      useMinutes: use,
      ...(bedPreference && { bedPreference }),
    },
  );
  return bundleId !== undefined && typeof proposal !== "string"
    ? planFoodCooking(g, h, a, slot, bundleId, proposal)
    : proposal;
}

export function cancelHousingTask(g: Game, a: Actor, t: Task) {
  const h = g.housing!;
  const result = cancelSpatialOrder(h.state, a.person.id);
  h.state = result.state;
  return result.events.some(
    (e) =>
      e.actorId === a.person.id &&
      e.orderId === t.spatial!.orderId &&
      e.kind === "cancelled",
  );
}

export type HousingMinute = {
  metric: Task["metric"];
  used: boolean;
  terminal?: "finish" | "cancel";
};
/** Read all users' actual use before applying any completion effects. */
export function advanceHousingMinute(
  g: Game,
  heldUseOrderIds?: ReadonlySet<string>,
): Map<string, HousingMinute> {
  const h = g.housing!;
  const previous = h.state;
  const workGraph = activeLodgingWorkGraph(h);
  const { state, events } = advanceSpatialMinute(
    workGraph ?? previous,
    heldUseOrderIds,
  );
  h.state = state;
  if (workGraph) recordMaintenanceEntry(h);
  const result = new Map<string, HousingMinute>();
  const diners: { a: Actor; point: SpatialPoint }[] = [];
  let crossed = false;
  for (const a of g.actors) {
    const t = a.task,
      binding = t?.spatial;
    if (!t || !binding) continue;
    const id = a.person.id,
      actor = state.actors[id];
    const point = housingSourcePoint(actor)!;
    const room = housingRoomId(point.domainId)!;
    if (a.room !== room) {
      a.room = room;
      crossed = true;
    }
    const event = events.find(
      (e) =>
        e.actorId === id &&
        e.orderId === binding.orderId &&
        (e.kind === "cancelled" ||
          (binding.kind === "move"
            ? e.kind === "arrived"
            : binding.kind === "carry"
              ? e.kind === "delivered"
              : e.kind === "use-completed")),
    );
    const used =
      event?.kind === "use-completed" ||
      (binding.kind === "use" &&
        !!actor.order &&
        actor.order.useRemaining < t.remaining);
    const prior = previous.actors[id].position;
    const moved =
      prior.kind === "transit" ||
      actor.position.kind === "transit" ||
      (prior.kind === "at" && !sameSpatialPoint(prior.point, point));
    const metric = used ? t.metric : moved ? "travel" : "waiting";
    result.set(id, {
      used,
      metric,
      terminal: event
        ? event.kind === "cancelled"
          ? "cancel"
          : "finish"
        : undefined,
    });
    if (binding.kind === "use" && actor.order)
      t.remaining = actor.order.useRemaining;
    if (
      used &&
      t.kind === "need" &&
      t.target === "social" &&
      !binding.socialCompany
    ) {
      // Arrival/departure at the minute boundary does not establish a whole minute together.
      const company = Object.values(previous.actors).some((peer) => {
        const after = state.actors[peer.id].position;
        return (
          peer.id !== id &&
          peer.position.kind === "at" &&
          sameSpatialPoint(peer.position.point, point) &&
          after.kind === "at" &&
          sameSpatialPoint(after.point, point)
        );
      });
      if (company) binding.socialCompany = true;
    }
    if (used && t.kind === "need" && t.target === "hunger")
      diners.push({ a, point });
  }
  for (const { a, point } of diners) {
    for (const other of diners) {
      if (a === other.a || !sameSpatialPoint(point, other.point)) continue;
      const binding = a.task!.spatial!;
      const peers = binding.mealPartners ?? {};
      const id = other.a.person.id;
      binding.mealPartners = {
        ...peers,
        [id]: (Object.hasOwn(peers, id) ? peers[id] : 0) + 1,
      };
    }
  }
  if (workGraph || crossed) rebuildHousingGeometry(g, h);
  return result;
}

/** Project the active spatial order in isolation, including pickups and room crossings. */
export function projectHousingOrderMinutes(
  g: Game,
  worker: Actor,
): number | null {
  const actorId = worker.person.id;
  const h = g.housing!;
  const trial = {
    ...g,
    housing: structuredClone(h),
    actors: [structuredClone(worker)],
  };
  for (const other of Object.values(trial.housing.state.actors)) {
    if (other.id !== actorId) other.order = null;
  }
  for (
    let elapsed = 1;
    Number.isSafeInteger(trial.housing.state.time + 1);
    elapsed++
  ) {
    const tick = advanceHousingMinute(trial).get(actorId);
    if (tick?.terminal) return elapsed;
    if (trial.housing.state.actors[actorId].order?.phase === "waiting")
      return null;
  }
  return null;
}
