import { spatialReservationId } from "./actions";
import {
  areSpatialNeighbors,
  isSpatialCell,
  sameSpatialPoint,
  spatialWalkId,
} from "./route";
import type {
  SpatialActor,
  SpatialOrder,
  SpatialPoint,
  SpatialRef,
  SpatialState,
  SpatialStep,
} from "./types";

type Reader<T> = (value: unknown, path: string) => T;

function fail(path: string, reason: string): never {
  throw new Error(`Invalid spatial state at ${path}: ${reason}`);
}

function record(value: unknown, path: string): Record<string, unknown> {
  if (
    value === null ||
    typeof value !== "object" ||
    Array.isArray(value) ||
    (Object.getPrototypeOf(value) !== Object.prototype &&
      Object.getPrototypeOf(value) !== null)
  )
    fail(path, "expected a plain object");
  // JSON cannot preserve symbols, accessors or hidden data.
  for (const key of Reflect.ownKeys(value)) {
    const desc = Object.getOwnPropertyDescriptor(value, key)!;
    if (typeof key !== "string" || !desc.enumerable || !("value" in desc))
      fail(path, "expected enumerable JSON fields");
  }
  return value as Record<string, unknown>;
}

type Fields = Record<string, Reader<unknown>>;
function fields<S extends Fields>(
  schema: S,
): Reader<{ [K in keyof S]: ReturnType<S[K]> }> {
  return (value, path) => {
    const obj = record(value, path);
    for (const key of Object.keys(obj)) {
      if (!Object.hasOwn(schema, key)) fail(path, "unexpected field " + key);
    }
    // Every field in S is present and decoded by its own reader before returning.
    return Object.fromEntries(
      Object.entries(schema).map(([key, read]) => {
        if (!Object.hasOwn(obj, key)) fail(path, "missing field " + key);
        return [key, read(obj[key], path + "." + key)];
      }),
    ) as { [K in keyof S]: ReturnType<S[K]> };
  };
}

function dictionary<T extends { id: string }>(
  read: Reader<T>,
): Reader<Record<string, T>> {
  return (value, path) =>
    Object.fromEntries(
      Object.entries(record(value, path)).map(([key, entry]) => {
        const where = path + "[" + JSON.stringify(key) + "]";
        const candidate = read(entry, where);
        if (key !== candidate.id) fail(where, "key must equal id");
        return [key, candidate];
      }),
    );
}

function list<T>(read: Reader<T>): Reader<T[]> {
  return (value, path) => {
    if (
      !Array.isArray(value) ||
      Object.getPrototypeOf(value) !== Array.prototype ||
      Reflect.ownKeys(value).length !== value.length + 1
    )
      fail(path, "expected a dense JSON array");
    const result: T[] = [];
    for (let i = 0; i < value.length; i++) {
      const desc = Object.getOwnPropertyDescriptor(value, i);
      if (!desc?.enumerable || !("value" in desc))
        fail(path, "invalid array element");
      result.push(read(desc.value, `${path}[${i}]`));
    }
    return result;
  };
}

function nullable<T>(read: Reader<T>): Reader<T | null> {
  return (value, path) => (value === null ? null : read(value, path));
}

function oneOf<const T extends string | number>(...options: T[]): Reader<T> {
  return (value, path) => {
    for (const option of options) if (option === value) return option;
    return fail(path, "expected " + options.join(" or "));
  };
}

function variant<T extends Fields>(cases: T): Reader<ReturnType<T[keyof T]>> {
  return (value, path) => {
    const obj = record(value, path);
    if (
      !Object.hasOwn(obj, "kind") ||
      typeof obj.kind !== "string" ||
      !Object.hasOwn(cases, obj.kind)
    )
      fail(path, "unrecognized kind");
    return cases[obj.kind](obj, path) as ReturnType<T[keyof T]>;
  };
}

const id: Reader<string> = (v, p) =>
  typeof v === "string" && v.length > 0 ? v : fail(p, "expected a nonempty ID");
const boolean: Reader<boolean> = (v, p) =>
  typeof v === "boolean" ? v : fail(p, "expected a boolean");
const natural: Reader<number> = (v, p) =>
  typeof v === "number" && Number.isSafeInteger(v) && v >= 0
    ? v
    : fail(p, "expected a nonnegative safe integer");
const positive: Reader<number> = (v, p) =>
  natural(v, p) || fail(p, "expected a positive safe integer");
const ids = list(id);
const allowed = nullable(ids);
const point = fields({ domainId: id, cell: natural });
const ref = fields({ kind: oneOf("actor", "item"), id });
const edge = { id, a: point, b: point, open: boolean };
const step = fields({
  kind: oneOf("walk", "connection"),
  id,
  from: point,
  to: point,
  minutes: positive,
});
const position = variant({
  at: fields({ kind: oneOf("at"), point }),
  transit: fields({ kind: oneOf("transit"), step, remaining: positive }),
  carried: fields({ kind: oneOf("carried"), carrierId: id }),
});
const intent = variant({
  move: fields({ kind: oneOf("move"), actorId: id, destination: point }),
  use: fields({
    kind: oneOf("use"),
    actorId: id,
    slotId: id,
    useMinutes: positive,
  }),
  carry: fields({
    kind: oneOf("carry"),
    actorId: id,
    payload: ref,
    destination: point,
  }),
});
const active = ["approach", "move", "use", "carry"] as const;
const order = fields({
  id,
  intent,
  phase: oneOf(...active, "waiting", "exiting-after-cancel"),
  useRemaining: natural,
  resumePhase: nullable(oneOf(...active)),
  waitReason: nullable(
    oneOf(
      "missing",
      "physical-block",
      "entry-denied",
      "use-denied",
      "handling-denied",
      "reserved",
      "actor-busy",
      "payload-unavailable",
      "occupied",
      "invalid-input",
    ),
  ),
  pickupPoint: nullable(point),
});
const entity = { id, position, carryAllowedActorIds: allowed };
const booking = { id, targetId: id, orderId: id, actorId: id };
const readShape: Reader<SpatialState> = fields({
  type: oneOf("housing-spatial-state"),
  version: oneOf(1),
  time: natural,
  nextOrderId: positive,
  domains: dictionary(
    fields({
      id,
      width: positive,
      height: positive,
      stepMinutes: positive,
      blockedCells: list(natural),
    }),
  ),
  connections: dictionary(fields({ ...edge, minutes: positive })),
  gates: dictionary(fields(edge)),
  entryRules: list(fields({ point, allowedActorIds: ids })),
  slots: dictionary(fields({ id, point, allowedActorIds: allowed })),
  items: dictionary(fields(entity)),
  actors: dictionary(fields({ ...entity, order: nullable(order) })),
  reservations: dictionary(
    variant({
      slot: fields({ ...booking, kind: oneOf("slot") }),
      payload: fields({
        ...booking,
        kind: oneOf("payload"),
        payloadKind: oneOf("actor", "item"),
      }),
    }),
  ),
});

function lookup<T>(records: Record<string, T>, id: string, path: string): T {
  if (!Object.hasOwn(records, id))
    fail(path, "missing reference " + JSON.stringify(id));
  return records[id];
}

function validPoint(
  state: SpatialState,
  pt: SpatialPoint,
  path: string,
  requireStandable = false,
) {
  const domain = lookup(state.domains, pt.domainId, path);
  if (!isSpatialCell(domain, pt.cell)) fail(path, "cell outside domain");
  if (requireStandable && domain.blockedCells.includes(pt.cell))
    fail(path, "actor position or landing cell is blocked");
  return domain;
}

function checkActors(
  state: SpatialState,
  actors: string[] | null,
  path: string,
) {
  for (const actor of actors ?? []) lookup(state.actors, actor, path);
}

function checkWorld(state: SpatialState) {
  for (const domain of Object.values(state.domains)) {
    if (
      !Number.isSafeInteger(domain.width * domain.height) ||
      !domain.blockedCells.every((cell) => isSpatialCell(domain, cell))
    )
      fail(domain.id, "invalid domain dimensions or blocked cell");
  }
  for (const link of Object.values(state.connections)) {
    validPoint(state, link.a, link.id);
    validPoint(state, link.b, link.id);
  }
  const edges = new Set<string>();
  for (const gate of Object.values(state.gates)) {
    const domain = validPoint(state, gate.a, gate.id);
    validPoint(state, gate.b, gate.id);
    const edgeId = spatialWalkId(gate.a, gate.b);
    if (!areSpatialNeighbors(domain, gate.a, gate.b) || edges.has(edgeId))
      fail(gate.id, "gate requires a unique adjacent edge");
    edges.add(edgeId);
  }
  const points = new Set<string>();
  for (const rule of state.entryRules) {
    validPoint(state, rule.point, "entryRules");
    checkActors(state, rule.allowedActorIds, "entryRules");
    const key = JSON.stringify([rule.point.domainId, rule.point.cell]);
    if (
      points.has(key) ||
      new Set(rule.allowedActorIds).size !== rule.allowedActorIds.length
    )
      fail("entryRules", "duplicate entry point or actor");
    points.add(key);
  }
  for (const slot of Object.values(state.slots)) {
    validPoint(state, slot.point, slot.id);
    checkActors(state, slot.allowedActorIds, slot.id);
  }
}

function checkStep(state: SpatialState, segment: SpatialStep, path: string) {
  const domain = validPoint(state, segment.from, path);
  validPoint(state, segment.to, path, true);
  // Open flags, the departure cell and entry permission may change after admission.
  if (segment.kind === "walk") {
    if (
      segment.id !== spatialWalkId(segment.from, segment.to) ||
      segment.minutes !== domain.stepMinutes ||
      !areSpatialNeighbors(domain, segment.from, segment.to)
    )
      fail(path, "walk does not match its edge");
  } else {
    const link = lookup(state.connections, segment.id, path);
    const forward =
      sameSpatialPoint(link.a, segment.from) &&
      sameSpatialPoint(link.b, segment.to);
    const reverse =
      sameSpatialPoint(link.b, segment.from) &&
      sameSpatialPoint(link.a, segment.to);
    if (!(forward || reverse) || segment.minutes !== link.minutes)
      fail(path, "transit does not match its connection");
  }
}

function targetEntity(state: SpatialState, target: SpatialRef, path: string) {
  return target.kind === "actor"
    ? lookup(state.actors, target.id, path)
    : lookup(state.items, target.id, path);
}

function checkPositions(state: SpatialState) {
  function check(ref: SpatialRef) {
    const subject = targetEntity(state, ref, ref.id);
    checkActors(state, subject.carryAllowedActorIds, ref.id);
    const pos = subject.position;
    if (pos.kind === "at")
      validPoint(state, pos.point, ref.id, ref.kind === "actor");
    else if (pos.kind === "transit") {
      if (
        ref.kind !== "actor" ||
        !state.actors[ref.id].order ||
        pos.remaining > pos.step.minutes
      )
        fail(ref.id, "transit requires active work and valid remaining time");
      checkStep(state, pos.step, ref.id);
    } else {
      const carrier = lookup(state.actors, pos.carrierId, ref.id);
      const job = carrier.order;
      // A carrier must itself be mobile. This also rules out every length of cycle.
      if (
        carrier.position.kind === "carried" ||
        (ref.kind === "actor" && state.actors[ref.id].order) ||
        job?.intent.kind !== "carry" ||
        job.intent.payload.kind !== ref.kind ||
        job.intent.payload.id !== ref.id
      )
        fail(ref.id, "carried target and carrier work disagree");
    }
  }
  for (const id of Object.keys(state.actors)) check({ kind: "actor", id });
  for (const id of Object.keys(state.items)) check({ kind: "item", id });
}

function checkReservation(
  state: SpatialState,
  job: SpatialOrder,
  target: SpatialRef | { kind: "slot"; id: string },
  bookings: Set<string>,
) {
  const key = spatialReservationId(target);
  const reservation = lookup(state.reservations, key, job.id);
  if (
    bookings.has(key) ||
    reservation.actorId !== job.intent.actorId ||
    reservation.orderId !== job.id ||
    reservation.targetId !== target.id ||
    (target.kind === "slot"
      ? reservation.kind !== "slot"
      : reservation.kind !== "payload" ||
        reservation.payloadKind !== target.kind)
  )
    fail(job.id, "reservation does not match order and target");
  bookings.add(key);
}

function checkOrder(
  state: SpatialState,
  actor: SpatialActor,
  job: SpatialOrder,
  bookings: Set<string>,
) {
  const { intent, phase, useRemaining, resumePhase, waitReason, pickupPoint } =
    job;
  const where = job.id;
  const serial = Number(where.slice("order-".length));
  if (
    where !== `order-${serial}` ||
    !Number.isSafeInteger(serial) ||
    serial < 1 ||
    serial >= state.nextOrderId ||
    intent.actorId !== actor.id
  )
    fail(where, "invalid order serial or owner");
  const pos = actor.position;
  const waiting = phase === "waiting";
  const exiting = phase === "exiting-after-cancel";
  if (
    pos.kind === "carried" ||
    (waiting && (pos.kind !== "at" || !resumePhase || !waitReason)) ||
    (!waiting && (resumePhase !== null || waitReason !== null)) ||
    (exiting && pos.kind !== "transit")
  )
    fail(where, "inconsistent phase, position or wait data");
  const stage = waiting ? resumePhase : phase;
  const at = (pt: SpatialPoint) =>
    pos.kind === "at" && sameSpatialPoint(pos.point, pt);
  let goal: SpatialPoint;
  if (intent.kind !== "use" && useRemaining !== 0)
    fail(where, "unexpected use progress");
  if (intent.kind !== "carry" && pickupPoint !== null)
    fail(where, "unexpected pickup point");

  if (intent.kind === "move") {
    if (!exiting && stage !== "move") fail(where, "invalid movement phase");
    goal = intent.destination;
    validPoint(state, goal, where);
  } else if (intent.kind === "use") {
    checkReservation(state, job, { kind: "slot", id: intent.slotId }, bookings);
    goal = lookup(state.slots, intent.slotId, where).point;
    if (stage === "use") {
      if (!at(goal) || useRemaining < 1 || useRemaining > intent.useMinutes)
        fail(where, "invalid use position or progress");
    } else if (
      (!exiting && stage !== "approach") ||
      at(goal) ||
      useRemaining !== intent.useMinutes
    ) {
      fail(where, "invalid slot approach or progress");
    }
  } else {
    checkReservation(state, job, intent.payload, bookings);
    validPoint(state, intent.destination, where);
    if (!pickupPoint) fail(where, "missing pickup point");
    validPoint(state, pickupPoint, where);
    if (intent.payload.kind === "actor" && intent.payload.id === actor.id)
      fail(where, "cannot carry self");
    const payload = targetEntity(state, intent.payload, where);
    const held =
      payload.position.kind === "carried" &&
      payload.position.carrierId === actor.id;
    if (!exiting && (held ? stage !== "carry" : stage !== "approach"))
      fail(where, "pickup and carry phase disagree");
    goal = held ? intent.destination : pickupPoint;
    if (held && (at(goal) || sameSpatialPoint(pickupPoint, intent.destination)))
      fail(where, "delivery already reached its endpoint");
  }
  if (pos.kind === "transit" && sameSpatialPoint(pos.step.from, goal))
    fail(where, "segment departs from its stage target");
  if (waiting) {
    // Permission may already be restored; validate the saved stage and reason.
    if (stage === "use") {
      if (waitReason !== "use-denied")
        fail(where, "invalid reason for paused use");
    } else if (at(goal)) {
      if (
        intent.kind !== "carry" ||
        stage !== "approach" ||
        (waitReason !== "handling-denied" &&
          waitReason !== "payload-unavailable")
      )
        fail(where, "invalid reason for waiting at an endpoint");
    } else if (
      waitReason !== "entry-denied" &&
      waitReason !== "physical-block" &&
      waitReason !== "invalid-input"
    ) {
      fail(where, "invalid reason for a blocked route");
    }
  }
}

function readState(value: unknown): SpatialState {
  const state = readShape(value, "state");
  checkWorld(state);
  checkPositions(state);
  const orders = new Set<string>();
  const bookings = new Set<string>();
  for (const actor of Object.values(state.actors)) {
    if (!actor.order) continue;
    if (orders.has(actor.order.id)) fail(actor.order.id, "duplicate order ID");
    orders.add(actor.order.id);
    checkOrder(state, actor, actor.order, bookings);
  }
  if (bookings.size !== Object.keys(state.reservations).length)
    fail("reservations", "unclaimed reservation");
  return state;
}

export function isSpatialState(value: unknown): value is SpatialState {
  try {
    readState(value);
    return true;
  } catch {
    return false;
  }
}

export function parseSpatialState(json: string): SpatialState {
  const value: unknown = JSON.parse(json);
  return readState(value);
}

export function serializeSpatialState(state: SpatialState): string {
  return JSON.stringify(readState(state));
}
