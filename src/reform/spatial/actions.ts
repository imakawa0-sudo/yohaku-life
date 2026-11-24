import {
  canEnterSpatialStep,
  copyPoint,
  inspectSpatialRoute,
  isSpatialCell,
  sameSpatialPoint,
  validId,
  validPoint,
} from "./route";
import type {
  SpatialActivePhase,
  SpatialActor,
  SpatialEvent,
  SpatialIntent,
  SpatialItem,
  SpatialOrder,
  SpatialPoint,
  SpatialPosition,
  SpatialReason,
  SpatialRef,
  SpatialState,
  SpatialTransition,
} from "./types";

function own<T>(records: Record<string, T>, id: string): T | undefined {
  return validId(id) && Object.hasOwn(records, id) ? records[id] : undefined;
}

function entity(state: SpatialState, ref: SpatialRef): SpatialItem | undefined {
  return ref.kind === "actor"
    ? own(state.actors, ref.id)
    : own(state.items, ref.id);
}

export function locateSpatial(
  state: SpatialState,
  target: SpatialRef,
): SpatialPosition {
  if (!validRef(target)) throw new Error("Invalid spatial reference");
  const visited = new Set<string>();
  let current = entity(state, target);
  while (current?.position.kind === "carried") {
    const id = current.position.carrierId;
    if (visited.has(id)) throw new Error("Cycle in spatial carriers");
    visited.add(id);
    current = own(state.actors, id);
  }
  if (!current) throw new Error("Missing spatial target or carrier");
  return structuredClone(current.position);
}

type ReservationTarget = SpatialRef | { kind: "slot"; id: string };

export function spatialReservationId(target: ReservationTarget): string {
  if (target?.kind === "slot" && validId(target.id))
    return JSON.stringify(["slot", target.id]);
  if (validRef(target))
    return JSON.stringify(["payload", target.kind, target.id]);
  throw new Error("Invalid spatial reservation target");
}

function reservationTarget(intent: SpatialIntent): ReservationTarget | null {
  if (intent.kind === "use") return { kind: "slot", id: intent.slotId };
  return intent.kind === "carry" ? intent.payload : null;
}

function validRef(ref: ReservationTarget): ref is SpatialRef {
  return (
    !!ref && (ref.kind === "actor" || ref.kind === "item") && validId(ref.id)
  );
}

function copyIntent(intent: SpatialIntent): SpatialIntent {
  const { kind, actorId } = intent;
  switch (kind) {
    case "move":
      return { kind, actorId, destination: copyPoint(intent.destination) };
    case "carry":
      return {
        kind,
        actorId,
        destination: copyPoint(intent.destination),
        payload: { kind: intent.payload.kind, id: intent.payload.id },
      };
    case "use":
      return {
        kind,
        actorId,
        slotId: intent.slotId,
        useMinutes: intent.useMinutes,
      };
  }
}

function validIntent(intent: SpatialIntent): boolean {
  if (!intent || !validId(intent.actorId)) return false;
  switch (intent.kind) {
    case "move":
      return validPoint(intent.destination);
    case "use":
      return (
        validId(intent.slotId) &&
        Number.isSafeInteger(intent.useMinutes) &&
        intent.useMinutes > 0
      );
    case "carry":
      return validRef(intent.payload) && validPoint(intent.destination);
    default:
      return false;
  }
}

function permits(ids: string[] | null, actorId: string): boolean {
  return ids === null || ids.includes(actorId);
}

type Denied = { ok: false; reason: SpatialReason };
const denied = (reason: SpatialReason): Denied => ({ ok: false, reason });

function pickupSite(
  state: SpatialState,
  intent: Extract<SpatialIntent, { kind: "carry" }>,
): { ok: true; point: SpatialPoint; target: SpatialItem } | Denied {
  const { payload, actorId } = intent;
  const target = entity(state, payload);
  if (!target) return denied("missing");
  if (
    target.position.kind !== "at" ||
    (payload.kind === "actor" &&
      (payload.id === actorId || state.actors[payload.id].order !== null))
  )
    return denied("payload-unavailable");
  if (!permits(target.carryAllowedActorIds, actorId))
    return denied("handling-denied");
  return { ok: true, point: target.position.point, target };
}

function allocateReservation(
  state: SpatialState,
  target: ReservationTarget,
  order: SpatialOrder,
) {
  const id = spatialReservationId(target);
  const common = {
    id,
    targetId: target.id,
    actorId: order.intent.actorId,
    orderId: order.id,
  };
  state.reservations[id] =
    target.kind === "slot"
      ? { ...common, kind: "slot" }
      : { ...common, kind: "payload", payloadKind: target.kind };
}

export function issueSpatialOrder(
  state: SpatialState,
  intent: SpatialIntent,
): { ok: true; state: SpatialState; orderId: string } | Denied {
  if (!validIntent(intent)) return denied("invalid-input");
  const actor = own(state.actors, intent.actorId);
  if (!actor) return denied("missing");
  if (actor.order || actor.position.kind !== "at") return denied("actor-busy");

  let pickupPoint: SpatialPoint | null = null;
  let firstDestination: SpatialPoint;
  let phase: SpatialActivePhase;
  if (intent.kind === "use") {
    const slot = own(state.slots, intent.slotId);
    if (!slot) return denied("missing");
    if (!permits(slot.allowedActorIds, intent.actorId))
      return denied("use-denied");
    firstDestination = slot.point;
    phase = sameSpatialPoint(actor.position.point, slot.point)
      ? "use"
      : "approach";
  } else if (intent.kind === "carry") {
    const site = pickupSite(state, intent);
    if (!site.ok) return site;
    pickupPoint = site.point;
    firstDestination = site.point;
    phase = "approach";
  } else {
    firstDestination = intent.destination;
    phase = "move";
  }

  const target = reservationTarget(intent);
  if (target && own(state.reservations, spatialReservationId(target)))
    return denied("reserved");

  const approach = inspectSpatialRoute(
    state,
    intent.actorId,
    actor.position.point,
    firstDestination,
  );
  if (!approach.ok) return denied(approach.reason);
  if (intent.kind === "carry") {
    const onward = inspectSpatialRoute(
      state,
      intent.actorId,
      firstDestination,
      intent.destination,
    );
    if (!onward.ok) return denied(onward.reason);
  }
  const serial = state.nextOrderId;
  const orderId = `order-${serial}`;
  if (
    !Number.isSafeInteger(serial) ||
    serial < 1 ||
    !Number.isSafeInteger(serial + 1) ||
    Object.values(state.actors).some((a) => a.order?.id === orderId)
  )
    return denied("invalid-input");

  const next = structuredClone(state);
  const order: SpatialOrder = {
    id: orderId,
    intent: copyIntent(intent),
    phase,
    useRemaining: intent.kind === "use" ? intent.useMinutes : 0,
    resumePhase: null,
    waitReason: null,
    pickupPoint: pickupPoint && copyPoint(pickupPoint),
  };
  next.nextOrderId++;
  next.actors[actor.id].order = order;
  if (target) allocateReservation(next, target, order);
  return { ok: true, state: next, orderId };
}

function wait(
  order: SpatialOrder,
  phase: SpatialActivePhase,
  reason: SpatialReason,
) {
  order.phase = "waiting";
  order.resumePhase = phase;
  order.waitReason = reason;
}

function emit(
  transition: SpatialTransition,
  order: SpatialOrder,
  kind: SpatialEvent["kind"],
) {
  transition.events.push({
    kind,
    atTime: transition.state.time,
    orderId: order.id,
    actorId: order.intent.actorId,
  });
}

function owns(
  state: SpatialState,
  target: ReservationTarget,
  order: SpatialOrder,
): boolean {
  const reservation = own(state.reservations, spatialReservationId(target));
  return (
    reservation?.orderId === order.id &&
    reservation.actorId === order.intent.actorId
  );
}

function finish(
  transition: SpatialTransition,
  actor: SpatialActor,
  order: SpatialOrder,
  kind: SpatialEvent["kind"],
) {
  const target = reservationTarget(order.intent);
  if (target && owns(transition.state, target, order))
    delete transition.state.reservations[spatialReservationId(target)];
  actor.order = null;
  emit(transition, order, kind);
}

function dropPayload(
  state: SpatialState,
  actor: SpatialActor,
  order: SpatialOrder,
) {
  if (actor.position.kind !== "at" || order.intent.kind !== "carry") return;
  const target = entity(state, order.intent.payload);
  if (
    target?.position.kind === "carried" &&
    target.position.carrierId === actor.id
  ) {
    target.position = { kind: "at", point: copyPoint(actor.position.point) };
  }
}

export function cancelSpatialOrder(
  state: SpatialState,
  actorId: string,
): SpatialTransition {
  if (!validId(actorId)) throw new Error("Invalid spatial actor ID");
  const transition: SpatialTransition = {
    state: structuredClone(state),
    events: [],
  };
  const actor = own(transition.state.actors, actorId);
  const order = actor?.order;
  if (!actor || !order || order.phase === "exiting-after-cancel")
    return transition;
  if (actor.position.kind === "transit") {
    order.phase = "exiting-after-cancel";
    order.resumePhase = null;
    order.waitReason = null;
  } else {
    dropPayload(transition.state, actor, order);
    finish(transition, actor, order, "cancelled");
  }
  return transition;
}

function useFailure(state: SpatialState, order: SpatialOrder, slotId: string) {
  const slot = own(state.slots, slotId);
  if (!slot) return "missing";
  if (!owns(state, { kind: "slot", id: slotId }, order)) return "reserved";
  return permits(slot.allowedActorIds, order.intent.actorId)
    ? null
    : "use-denied";
}

function arrive(
  transition: SpatialTransition,
  actor: SpatialActor,
  order: SpatialOrder,
  point: SpatialPoint,
) {
  const intent = order.intent;
  if (intent.kind === "move") {
    finish(transition, actor, order, "arrived");
  } else if (intent.kind === "use") {
    emit(transition, order, "arrived");
    const reason = useFailure(transition.state, order, intent.slotId);
    if (reason) return wait(order, "use", reason);
    order.phase = "use";
  } else {
    if (order.phase === "approach") {
      if (!owns(transition.state, intent.payload, order))
        return wait(order, "approach", "reserved");
      const site = pickupSite(transition.state, intent);
      if (!site.ok) return wait(order, "approach", site.reason);
      if (!sameSpatialPoint(site.point, point))
        return wait(order, "approach", "payload-unavailable");
      site.target.position = {
        kind: "carried",
        carrierId: actor.id,
      };
      order.phase = "carry";
      emit(transition, order, "picked-up");
    }
    if (sameSpatialPoint(point, intent.destination)) {
      dropPayload(transition.state, actor, order);
      finish(transition, actor, order, "delivered");
    }
  }
}

function destination(state: SpatialState, order: SpatialOrder): SpatialPoint {
  if (order.intent.kind === "use") {
    const slot = own(state.slots, order.intent.slotId);
    if (!slot) throw new Error("Missing slot for an active spatial order");
    return slot.point;
  }
  if (order.intent.kind === "carry" && order.phase === "approach")
    return order.pickupPoint!;
  return order.intent.destination;
}

function tickActor(
  transition: SpatialTransition,
  actor: SpatialActor,
  order: SpatialOrder,
  heldUseOrderIds?: ReadonlySet<string>,
) {
  if (order.phase === "waiting") {
    order.phase = order.resumePhase!;
    order.resumePhase = null;
    order.waitReason = null;
  }
  if (order.phase === "use" && order.intent.kind === "use") {
    const reason = useFailure(transition.state, order, order.intent.slotId);
    if (reason) return wait(order, "use", reason);
    if (heldUseOrderIds?.has(order.id)) return;
    order.useRemaining--;
    if (order.useRemaining === 0)
      finish(transition, actor, order, "use-completed");
    return;
  }
  if (actor.position.kind === "at") {
    const goal = destination(transition.state, order);
    if (sameSpatialPoint(actor.position.point, goal))
      return arrive(transition, actor, order, goal);
    const route = inspectSpatialRoute(
      transition.state,
      actor.id,
      actor.position.point,
      goal,
    );
    const phase = order.phase;
    if (phase === "exiting-after-cancel")
      throw new Error("A cancelled segment must still be in transit");
    if (!route.ok) return wait(order, phase, route.reason);
    const step = route.steps[0];
    const entry = canEnterSpatialStep(transition.state, actor.id, step);
    if (!entry.ok) return wait(order, phase, entry.reason);
    actor.position = { kind: "transit", step, remaining: step.minutes };
  }
  if (actor.position.kind !== "transit") return;
  // An admitted segment runs to its endpoint even after a prohibition or cancellation.
  if (actor.position.remaining > 1) {
    actor.position = {
      ...actor.position,
      remaining: actor.position.remaining - 1,
    };
    return;
  }
  const point = actor.position.step.to;
  actor.position = { kind: "at", point };
  if (order.phase === "exiting-after-cancel") {
    dropPayload(transition.state, actor, order);
    finish(transition, actor, order, "cancelled");
  } else if (sameSpatialPoint(point, destination(transition.state, order))) {
    arrive(transition, actor, order, point);
  }
}

// After an event-free tick, permissions and job ownership stay fixed until the next
// segment exit or use completion. Leave every boundary tick to the normal actor loop.
function skipQuietMinutes(actors: SpatialActor[], available: number): number {
  let minutes = available;
  for (const { position, order } of actors) {
    if (!order || order.phase === "waiting") continue;
    if (position.kind === "transit")
      minutes = Math.min(minutes, position.remaining - 1);
    else if (order.phase === "use")
      minutes = Math.min(minutes, order.useRemaining - 1);
    else return 0;
  }
  if (minutes > 0) {
    for (const actor of actors) {
      if (actor.position.kind === "transit")
        actor.position = {
          ...actor.position,
          remaining: actor.position.remaining - minutes,
        };
      else if (actor.order?.phase === "use")
        actor.order.useRemaining -= minutes;
    }
  }
  return minutes;
}

function advanceSpatialTime(
  state: SpatialState,
  minutes: number,
  heldUseOrderIds?: ReadonlySet<string>,
): SpatialTransition {
  const end = state.time + minutes;
  if (
    !Number.isSafeInteger(minutes) ||
    minutes < 0 ||
    !Number.isSafeInteger(state.time) ||
    state.time < 0 ||
    !Number.isSafeInteger(end)
  )
    throw new Error("Spatial time must remain a nonnegative safe integer");
  const transition: SpatialTransition = {
    state: structuredClone(state),
    events: [],
  };
  const actors = Object.keys(transition.state.actors)
    .sort()
    .map((id) => transition.state.actors[id]);
  while (transition.state.time < end) {
    const previousEvents = transition.events.length;
    transition.state.time++;
    for (const actor of actors) {
      if (actor.order) tickActor(transition, actor, actor.order, heldUseOrderIds);
    }
    // A later actor may have released a payload after an earlier actor waited this tick.
    const remaining = end - transition.state.time;
    if (remaining > 0 && transition.events.length === previousEvents)
      transition.state.time += skipQuietMinutes(actors, remaining);
  }
  return transition;
}

export function advanceSpatial(
  state: SpatialState,
  minutes: number,
): SpatialTransition {
  return advanceSpatialTime(state, minutes);
}

/** Hold only use time. Movement, permission checks, and safe exits still run. */
export function advanceSpatialMinute(
  state: SpatialState,
  heldUseOrderIds?: ReadonlySet<string>,
): SpatialTransition {
  return advanceSpatialTime(state, 1, heldUseOrderIds);
}

export function setSpatialGate(
  state: SpatialState,
  gateId: string,
  open: boolean,
): SpatialState {
  if (typeof open !== "boolean" || !own(state.gates, gateId))
    throw new Error("Invalid spatial gate change");
  const next = structuredClone(state);
  next.gates[gateId].open = open;
  return next;
}

export function setSpatialConnection(
  state: SpatialState,
  connectionId: string,
  open: boolean,
): SpatialState {
  if (typeof open !== "boolean" || !own(state.connections, connectionId))
    throw new Error("Invalid spatial connection change");
  const next = structuredClone(state);
  next.connections[connectionId].open = open;
  return next;
}

export function setSpatialEntryRule(
  state: SpatialState,
  point: SpatialPoint,
  allowedActorIds: string[] | null,
): SpatialState {
  const domain = validPoint(point) && own(state.domains, point.domainId);
  if (!domain || !isSpatialCell(domain, point.cell))
    throw new Error("Invalid spatial entry-rule point");
  if (
    allowedActorIds !== null &&
    (!Array.isArray(allowedActorIds) ||
      new Set(allowedActorIds).size !== allowedActorIds.length ||
      [...allowedActorIds].some((id) => !validId(id) || !own(state.actors, id)))
  )
    throw new Error("Invalid spatial entry-rule actors");
  const next = structuredClone(state);
  next.entryRules = next.entryRules.filter(
    (rule) => !sameSpatialPoint(rule.point, point),
  );
  if (allowedActorIds !== null)
    next.entryRules.push({
      point: copyPoint(point),
      allowedActorIds: [...allowedActorIds],
    });
  return next;
}
