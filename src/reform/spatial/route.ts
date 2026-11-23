import type {
  SpatialDomain,
  SpatialEntryResult,
  SpatialEntryRule,
  SpatialPoint,
  SpatialRouteResult,
  SpatialState,
  SpatialStep,
} from "./types";

export function validId(id: unknown): id is string {
  return typeof id === "string" && id.length > 0;
}

export function validPoint(point: SpatialPoint): boolean {
  return (
    !!point &&
    typeof point === "object" &&
    !Array.isArray(point) &&
    validId(point.domainId) &&
    Number.isSafeInteger(point.cell) &&
    point.cell >= 0
  );
}

export function copyPoint({ domainId, cell }: SpatialPoint): SpatialPoint {
  return { domainId, cell };
}

export function sameSpatialPoint(a: SpatialPoint, b: SpatialPoint): boolean {
  return a.domainId === b.domainId && a.cell === b.cell;
}

function pointKey(point: SpatialPoint): string {
  return JSON.stringify([point.domainId, point.cell]);
}

// A walking edge is shared by both directions in the same domain.
export function spatialWalkId(from: SpatialPoint, to: SpatialPoint): string {
  return JSON.stringify([
    from.domainId,
    Math.min(from.cell, to.cell),
    Math.max(from.cell, to.cell),
  ]);
}

export function isSpatialCell(domain: SpatialDomain, cell: number): boolean {
  return (
    Number.isSafeInteger(cell) &&
    cell >= 0 &&
    cell < domain.width * domain.height
  );
}

export function areSpatialNeighbors(
  domain: SpatialDomain,
  a: SpatialPoint,
  b: SpatialPoint,
): boolean {
  if (
    a.domainId !== domain.id ||
    b.domainId !== domain.id ||
    !isSpatialCell(domain, a.cell) ||
    !isSpatialCell(domain, b.cell)
  )
    return false;
  const delta = Math.abs(a.cell - b.cell);
  return (
    delta === domain.width ||
    (delta === 1 &&
      Math.floor(a.cell / domain.width) === Math.floor(b.cell / domain.width))
  );
}

function domainAt(
  state: SpatialState,
  point: SpatialPoint,
): SpatialDomain | undefined {
  return Object.hasOwn(state.domains, point.domainId)
    ? state.domains[point.domainId]
    : undefined;
}

function passableDomain(
  state: SpatialState,
  point: SpatialPoint,
): SpatialDomain | undefined {
  const domain = domainAt(state, point);
  return domain &&
    isSpatialCell(domain, point.cell) &&
    !domain.blockedCells.includes(point.cell)
    ? domain
    : undefined;
}

function permitsEntry(
  rule: SpatialEntryRule | undefined,
  actorId: string,
): boolean {
  return rule === undefined || rule.allowedActorIds.includes(actorId);
}

function actorFailure(state: SpatialState, actorId: string) {
  if (!validId(actorId)) return "invalid-input";
  return Object.hasOwn(state.actors, actorId) ? null : "missing";
}

export function canEnterSpatialStep(
  state: SpatialState,
  actorId: string,
  step: SpatialStep,
): SpatialEntryResult {
  if (
    !step ||
    typeof step !== "object" ||
    Array.isArray(step) ||
    (step.kind !== "walk" && step.kind !== "connection") ||
    !validId(step.id) ||
    !validPoint(step.from) ||
    !validPoint(step.to) ||
    !Number.isSafeInteger(step.minutes) ||
    step.minutes <= 0
  )
    return { ok: false, reason: "invalid-input" };
  const reason = actorFailure(state, actorId);
  if (reason) return { ok: false, reason };

  const source = passableDomain(state, step.from);
  if (!source || !passableDomain(state, step.to))
    return { ok: false, reason: "physical-block" };

  if (step.kind === "walk") {
    if (
      !areSpatialNeighbors(source, step.from, step.to) ||
      step.minutes !== source.stepMinutes ||
      step.id !== spatialWalkId(step.from, step.to) ||
      Object.values(state.gates).some(
        (gate) => !gate.open && spatialWalkId(gate.a, gate.b) === step.id,
      )
    ) {
      return { ok: false, reason: "physical-block" };
    }
  } else {
    const link = Object.hasOwn(state.connections, step.id)
      ? state.connections[step.id]
      : undefined;
    if (
      !link?.open ||
      step.minutes !== link.minutes ||
      !(
        (sameSpatialPoint(link.a, step.from) &&
          sameSpatialPoint(link.b, step.to)) ||
        (sameSpatialPoint(link.b, step.from) &&
          sameSpatialPoint(link.a, step.to))
      )
    ) {
      return { ok: false, reason: "physical-block" };
    }
  }

  const rule = state.entryRules.find(({ point }) =>
    sameSpatialPoint(point, step.to),
  );
  return permitsEntry(rule, actorId)
    ? { ok: true }
    : { ok: false, reason: "entry-denied" };
}

function adjacentCells(domain: SpatialDomain, cell: number): number[] {
  const column = cell % domain.width;
  const cells = [cell - domain.width, cell + domain.width];
  if (column > 0) cells.push(cell - 1);
  if (column + 1 < domain.width) cells.push(cell + 1);
  return cells;
}

function routeGraph(state: SpatialState) {
  const blocked = new Map<string, Set<number>>();
  function isPassable(point: SpatialPoint): boolean {
    const domain = domainAt(state, point);
    if (!domain || !isSpatialCell(domain, point.cell)) return false;
    let cells = blocked.get(point.domainId);
    if (!cells) {
      cells = new Set(domain.blockedCells);
      blocked.set(point.domainId, cells);
    }
    return !cells.has(point.cell);
  }

  const closedWalks = new Set(
    Object.values(state.gates)
      .filter((gate) => !gate.open)
      .map((gate) => spatialWalkId(gate.a, gate.b)),
  );
  const rules = new Map(
    state.entryRules.map((rule) => [pointKey(rule.point), rule]),
  );
  const connections = new Map<string, SpatialStep[]>();
  function addConnection(step: SpatialStep) {
    const key = pointKey(step.from);
    const steps = connections.get(key);
    if (steps) steps.push(step);
    else connections.set(key, [step]);
  }
  for (const link of Object.values(state.connections)) {
    if (link.open && isPassable(link.a) && isPassable(link.b)) {
      addConnection({
        kind: "connection",
        id: link.id,
        from: link.a,
        to: link.b,
        minutes: link.minutes,
      });
      addConnection({
        kind: "connection",
        id: link.id,
        from: link.b,
        to: link.a,
        minutes: link.minutes,
      });
    }
  }

  return {
    isPassable,
    permits(point: SpatialPoint, actorId: string): boolean {
      return permitsEntry(rules.get(pointKey(point)), actorId);
    },
    stepsFrom(from: SpatialPoint): SpatialStep[] {
      const steps = [...(connections.get(pointKey(from)) ?? [])];
      const domain = domainAt(state, from)!;
      for (const cell of adjacentCells(domain, from.cell)) {
        const to = { domainId: from.domainId, cell };
        const id = spatialWalkId(from, to);
        if (isPassable(to) && !closedWalks.has(id)) {
          steps.push({
            kind: "walk",
            id,
            from,
            to,
            minutes: domain.stepMinutes,
          });
        }
      }
      return steps;
    },
  };
}

type FrontierPoint = { point: SpatialPoint; minutes: bigint };

class RouteFrontier {
  private points: FrontierPoint[] = [];

  push(entry: FrontierPoint): void {
    let index = this.points.length;
    this.points.push(entry);
    while (index > 0) {
      const parent = Math.floor((index - 1) / 2);
      if (this.points[parent].minutes <= entry.minutes) break;
      this.points[index] = this.points[parent];
      index = parent;
    }
    this.points[index] = entry;
  }

  pop(): FrontierPoint | undefined {
    const first = this.points[0];
    const last = this.points.pop();
    if (!last || this.points.length === 0) return first;

    let index = 0;
    while (index * 2 + 1 < this.points.length) {
      let child = index * 2 + 1;
      const right = child + 1;
      if (
        right < this.points.length &&
        this.points[right].minutes < this.points[child].minutes
      )
        child = right;
      if (this.points[child].minutes >= last.minutes) break;
      this.points[index] = this.points[child];
      index = child;
    }
    this.points[index] = last;
    return first;
  }
}

function distancesTo(
  graph: ReturnType<typeof routeGraph>,
  from: SpatialPoint,
  to: SpatialPoint,
  actorId?: string,
): Map<string, bigint> | null {
  const fromKey = pointKey(from);
  const distances = new Map([[pointKey(to), 0n]]);
  const frontier = new RouteFrontier();
  frontier.push({ point: to, minutes: 0n });
  for (let current = frontier.pop(); current; current = frontier.pop()) {
    const key = pointKey(current.point);
    if (current.minutes !== distances.get(key)) continue;
    if (key === fromKey) return distances;

    // Traversal runs backwards, so the current point is what a forward step enters.
    if (actorId !== undefined && !graph.permits(current.point, actorId))
      continue;
    for (const step of graph.stepsFrom(current.point)) {
      const nextKey = pointKey(step.to);
      const minutes = current.minutes + BigInt(step.minutes);
      const previous = distances.get(nextKey);
      if (previous === undefined || minutes < previous) {
        distances.set(nextKey, minutes);
        frontier.push({ point: step.to, minutes });
      }
    }
  }
  return null;
}

function comesBefore(a: SpatialStep, b: SpatialStep): boolean {
  return a.id === b.id ? a.kind < b.kind : a.id < b.id;
}

export function inspectSpatialRoute(
  state: SpatialState,
  actorId: string,
  from: SpatialPoint,
  to: SpatialPoint,
): SpatialRouteResult {
  if (!validPoint(from) || !validPoint(to))
    return { physical: false, ok: false, reason: "invalid-input" };
  const graph = routeGraph(state);
  const reason = actorFailure(state, actorId);
  if (!graph.isPassable(from) || !graph.isPassable(to))
    return { physical: false, ok: false, reason: reason ?? "physical-block" };
  if (reason)
    return {
      physical: distancesTo(graph, from, to) !== null,
      ok: false,
      reason,
    };

  const distances = distancesTo(graph, from, to, actorId);
  if (!distances) {
    return distancesTo(graph, from, to)
      ? { physical: true, ok: false, reason: "entry-denied" }
      : { physical: false, ok: false, reason: "physical-block" };
  }
  const minutes = Number(distances.get(pointKey(from)));
  if (!Number.isSafeInteger(minutes)) {
    return { physical: true, ok: false, reason: "invalid-input" };
  }

  const steps: SpatialStep[] = [];
  let point = from;
  while (!sameSpatialPoint(point, to)) {
    const remaining = distances.get(pointKey(point));
    let next: SpatialStep | undefined;
    // The smallest ID among shortest continuations decides the first differing step.
    for (const step of graph.stepsFrom(point)) {
      const after = distances.get(pointKey(step.to));
      if (
        after !== undefined &&
        after + BigInt(step.minutes) === remaining &&
        graph.permits(step.to, actorId) &&
        (!next || comesBefore(step, next))
      )
        next = step;
    }
    if (!next) throw new Error("Missing next step on a measured spatial route");
    steps.push({ ...next, from: copyPoint(next.from), to: copyPoint(next.to) });
    point = next.to;
  }
  return { physical: true, ok: true, steps, minutes };
}
