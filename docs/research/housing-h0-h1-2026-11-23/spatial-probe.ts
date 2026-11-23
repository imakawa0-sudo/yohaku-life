/**
 * H0/H1 design probe. Standalone, deterministic, and not imported by the game.
 *
 * A names places and their connections. B derives connections from adjacent
 * regional cells, including the road. C derives two local grids and joins
 * their gates with a timed road. All expose the same small routing contract.
 * Success demonstrates that the contract can express these cases; it does not
 * select an architecture or measure performance, usability, or scalability.
 *
 * Deliberate limits: one porter per payload, point-sized loads, one private
 * space and a pickup permission, no work/material consumption, no traffic collision, no dialogue,
 * no combat, no legacy-save migration, and no untrusted-save validator.
 * Pickup/drop are atomic at a reached node and have no separate duration.
 * Eligibility is checked on entry to each segment. An entered segment finishes
 * its remaining duration; closure requests and permission changes affect later
 * entries. A closure waits for that segment's occupant to exit, rather than
 * placing a closed barrier through the traveller. Structural removal is not
 * exposed by this probe, so waiting for removal is not a verified behavior.
 */

export const modes = ["A", "B", "C"] as const;
export type Mode = (typeof modes)[number];
export type EntityRef = { kind: "actor" | "furniture"; id: string };
type NodePosition = { kind: "node"; node: string };
type TransitPosition = {
  kind: "transit";
  edge: string;
  from: string;
  to: string;
  remaining: number;
};
type Place = NodePosition | TransitPosition;
type Position = Place | { kind: "carried"; by: string };
type Reason = "blocked" | "denied" | "busy" | "missing" | "unavailable" | "not-injured";
export type Intent =
  | { kind: "move"; actor: string; destination: string }
  | { kind: "carry"; actor: string; destination: string; payload: EntityRef };
type Task = {
  destination: string;
  phase: "moving" | "to-pickup" | "carrying";
  status: "reserved" | "moving" | "waiting";
  pickup?: string;
  payload?: EntityRef;
  reason?: Reason;
};
type Actor = { position: Position; injured: boolean; task: Task | null };
type Furniture = { position: Position };
export type State = {
  schema: 1;
  mode: Mode;
  time: number;
  wood: number;
  actors: Record<string, Actor>;
  furniture: Record<string, Furniture>;
  reservations: Record<string, string>;
  doorOpen: boolean; // Admission for new entrants; entered transit has a grant.
  constructionBlocked: boolean;
  permissions: Record<string, boolean>;
  handlingPermissions: Record<string, string[]>;
};

type Node = {
  id: string;
  site?: "home" | "other";
  cell?: { domain: string; x: number; y: number };
  // C's containment metadata is separate from its navigation domains.
  parent?: { region: string; site: string; building?: string; floor?: number };
};
type Edge = { id: string; a: string; b: string; minutes: number; gate?: "door" | "works" };
type Graph = { nodes: Record<string, Node>; edges: Edge[] };
const edgeId = (a: string, b: string) => [a, b].sort().join("|");
const privateNode = "home:private";
const homeCells = [
  ["home:exit", 0, 0],
  ["home:store", 0, 1],
  ["home:hall", 1, 1],
  [privateNode, 2, 1],
  ["home:southwest", 0, 2],
  ["home:south", 1, 2],
  ["home:southeast", 2, 2],
] as const;

function edge(a: string, b: string, minutes = 2): Edge {
  const id = edgeId(a, b);
  const gate = id === edgeId("home:hall", privateNode)
    ? "door"
    : id === edgeId("home:southeast", privateNode) ? "works" : undefined;
  return { id, a, b, minutes, ...(gate ? { gate } : {}) };
}
function gridEdges(nodes: Node[]): Edge[] {
  const result: Edge[] = [];
  for (let i = 0; i < nodes.length; i++) {
    for (let j = i + 1; j < nodes.length; j++) {
      const a = nodes[i], b = nodes[j];
      if (a.cell && b.cell && a.cell.domain === b.cell.domain &&
          Math.abs(a.cell.x - b.cell.x) + Math.abs(a.cell.y - b.cell.y) === 1) {
        result.push(edge(a.id, b.id));
      }
    }
  }
  return result;
}
function graph(nodes: Node[], edges: Edge[]): Graph {
  return { nodes: Object.fromEntries(nodes.map(n => [n.id, n])), edges };
}

function graphA(): Graph {
  const nodes: Node[] = [
    ...homeCells.map(([id]) => ({ id, site: "home" as const })),
    { id: "other:gate", site: "other" }, { id: "other:store", site: "other" },
  ];
  const pairs = [
    ["home:exit", "home:store"], ["home:store", "home:hall"],
    ["home:hall", privateNode], ["home:store", "home:southwest"],
    ["home:hall", "home:south"], [privateNode, "home:southeast"],
    ["home:southwest", "home:south"], ["home:south", "home:southeast"],
    ["other:gate", "other:store"],
  ];
  return graph(nodes, [...pairs.map(([a, b]) => edge(a, b)), edge("home:exit", "other:gate", 6)]);
}
function graphB(): Graph {
  const nodes: Node[] = homeCells.map(([id, x, y]) => ({
    id, site: "home", cell: { domain: "region", x, y },
  }));
  nodes.push(
    { id: "road:one", cell: { domain: "region", x: -1, y: 0 } },
    { id: "road:two", cell: { domain: "region", x: -2, y: 0 } },
    { id: "other:gate", site: "other", cell: { domain: "region", x: -3, y: 0 } },
    { id: "other:store", site: "other", cell: { domain: "region", x: -4, y: 0 } },
  );
  return graph(nodes, gridEdges(nodes));
}
function graphC(): Graph {
  const nodes: Node[] = homeCells.map(([id, x, y]) => ({
    id, site: "home", cell: { domain: "home-ground", x, y },
    parent: {
      region: "region", site: "home",
      ...(["home:store", "home:hall", privateNode].includes(id)
        ? { building: "house", floor: 0 } : {}),
    },
  }));
  nodes.push(
    { id: "other:gate", site: "other", cell: { domain: "other-ground", x: 0, y: 0 },
      parent: { region: "region", site: "other" } },
    { id: "other:store", site: "other", cell: { domain: "other-ground", x: 1, y: 0 },
      parent: { region: "region", site: "other", building: "depot", floor: 0 } },
  );
  return graph(nodes, [...gridEdges(nodes), edge("home:exit", "other:gate", 6)]);
}
const graphs: Record<Mode, Graph> = { A: graphA(), B: graphB(), C: graphC() };

export function createState(mode: Mode): State {
  return {
    schema: 1, mode, time: 0, wood: 8,
    actors: {
      porter: { position: { kind: "node", node: "home:store" }, injured: false, task: null },
      patient: { position: { kind: "node", node: privateNode }, injured: true, task: null },
    },
    furniture: { bench: { position: { kind: "node", node: "home:store" } } },
    reservations: {}, doorOpen: true, constructionBlocked: false,
    permissions: { porter: true, patient: true },
    handlingPermissions: { "furniture:bench": ["porter"], "actor:patient": ["porter"] },
  };
}
const key = (ref: EntityRef) => `${ref.kind}:${ref.id}`;
function entity(state: State, ref: EntityRef): Actor | Furniture | undefined {
  return ref.kind === "actor" ? state.actors[ref.id] : state.furniture[ref.id];
}
function canHandle(state: State, actor: string, ref: EntityRef): boolean {
  return state.handlingPermissions[key(ref)]?.includes(actor) === true;
}
export function locate(state: State, ref: EntityRef): Place {
  const seen = new Set<string>();
  let current = ref;
  while (true) {
    if (seen.has(key(current))) throw Error("cyclic carry reference");
    seen.add(key(current));
    const value = entity(state, current);
    if (!value) throw Error("missing entity");
    if (value.position.kind !== "carried") return structuredClone(value.position);
    current = { kind: "actor", id: value.position.by };
  }
}
function physical(state: State, e: Edge): boolean {
  return (e.gate !== "door" || state.doorOpen) &&
    (e.gate !== "works" || !state.constructionBlocked);
}
function permitted(state: State, actor: string, node: string): boolean {
  return node !== privateNode || state.permissions[actor] === true;
}
function shortest(
  state: State, actor: string, from: string, to: string,
  checkPhysical: boolean, checkPermission: boolean,
): Edge[] | null {
  const layout = graphs[state.mode];
  if (!layout.nodes[from] || !layout.nodes[to]) return null;
  const pending = [{ node: from, minutes: 0, path: [] as Edge[] }];
  const visited = new Set<string>();
  while (pending.length) {
    pending.sort((a, b) => a.minutes - b.minutes || (a.node < b.node ? -1 : a.node > b.node ? 1 : 0));
    const current = pending.shift()!;
    if (visited.has(current.node)) continue;
    if (current.node === to) return current.path;
    visited.add(current.node);
    for (const e of layout.edges) {
      const next = e.a === current.node ? e.b : e.b === current.node ? e.a : undefined;
      if (!next || visited.has(next)) continue;
      if (checkPhysical && !physical(state, e)) continue;
      if (checkPermission && !permitted(state, actor, next)) continue;
      pending.push({ node: next, minutes: current.minutes + e.minutes, path: [...current.path, e] });
    }
  }
  return null;
}
export function inspectRoute(state: State, actor: string, from: string, to: string) {
  const physicalPath = shortest(state, actor, from, to, true, false);
  const permissionPath = shortest(state, actor, from, to, false, true);
  const usable = shortest(state, actor, from, to, true, true);
  return {
    physical: physicalPath !== null,
    allowed: permissionPath !== null,
    path: usable,
    minutes: usable?.reduce((sum, e) => sum + e.minutes, 0),
    reason: physicalPath === null ? "blocked" as const : usable === null ? "denied" as const : undefined,
  };
}
type Plan = { ok: boolean; minutes?: number; pickup?: string; reason?: Reason };
export function plan(state: State, intent: Intent): Plan {
  const a = state.actors[intent.actor];
  if (!a || !graphs[state.mode].nodes[intent.destination]) return { ok: false, reason: "missing" };
  if (a.task || a.position.kind !== "node") return { ok: false, reason: "busy" };
  let from = a.position.node, minutes = 0, pickup: string | undefined;
  if (intent.kind === "carry") {
    const target = entity(state, intent.payload);
    if (!target) return { ok: false, reason: "missing" };
    if (!canHandle(state, intent.actor, intent.payload)) return { ok: false, reason: "denied" };
    if ((intent.payload.kind === "actor" && intent.payload.id === intent.actor) ||
        target.position.kind !== "node" || state.reservations[key(intent.payload)]) {
      return { ok: false, reason: "unavailable" };
    }
    if (intent.payload.kind === "actor") {
      const patient = target as Actor;
      if (!patient.injured) return { ok: false, reason: "not-injured" };
      if (patient.task) return { ok: false, reason: "busy" };
    }
    pickup = target.position.node;
    const approach = inspectRoute(state, intent.actor, from, pickup);
    if (approach.path === null) return { ok: false, reason: approach.reason };
    minutes += approach.minutes!;
    from = pickup;
  }
  const route = inspectRoute(state, intent.actor, from, intent.destination);
  if (route.path === null) return { ok: false, reason: route.reason };
  return { ok: true, minutes: minutes + route.minutes!, ...(pickup ? { pickup } : {}) };
}
export function issue(state: State, intent: Intent): State {
  const preview = plan(state, intent);
  if (!preview.ok) throw Error(preview.reason);
  const next = structuredClone(state);
  next.actors[intent.actor].task = {
    destination: intent.destination,
    phase: intent.kind === "carry" ? "to-pickup" : "moving",
    status: "reserved",
    ...(intent.kind === "carry" ? { payload: structuredClone(intent.payload), pickup: preview.pickup } : {}),
  };
  if (intent.kind === "carry") next.reservations[key(intent.payload)] = intent.actor;
  return next;
}
function wait(task: Task, reason: Reason) {
  task.status = "waiting";
  task.reason = reason;
}
function settle(state: State, id: string): boolean {
  const a = state.actors[id], task = a.task;
  if (!task || a.position.kind !== "node") return false;
  if (task.phase === "to-pickup" && a.position.node === task.pickup) {
    const target = task.payload && entity(state, task.payload);
    if (!target || target.position.kind !== "node" || target.position.node !== a.position.node ||
        state.reservations[key(task.payload!)] !== id) {
      wait(task, "unavailable");
      return false;
    }
    if (!canHandle(state, id, task.payload!)) {
      wait(task, "denied");
      return false;
    }
    if (task.payload!.kind === "actor" && (target as Actor).task) {
      wait(task, "unavailable");
      return false;
    }
    target.position = { kind: "carried", by: id };
    task.phase = "carrying";
  }
  if (task.phase !== "to-pickup" && a.position.node === task.destination) {
    if (task.payload) {
      entity(state, task.payload)!.position = structuredClone(a.position);
      delete state.reservations[key(task.payload)];
    }
    a.task = null;
    return false;
  }
  return true;
}
function tick(state: State, id: string) {
  const a = state.actors[id];
  if (!a.task || a.position.kind === "carried") return;
  if (a.position.kind === "node") {
    if (!settle(state, id)) return;
    const task = a.task!;
    const target = task.phase === "to-pickup" ? task.pickup! : task.destination;
    const route = inspectRoute(state, id, a.position.node, target);
    if (!route.path?.length) {
      wait(task, route.reason ?? "unavailable");
      return;
    }
    const e = route.path[0], from = a.position.node;
    // The route checks this segment's physical/access conditions at admission.
    // A transit position records the grant for this segment only.
    a.position = { kind: "transit", edge: e.id, from, to: e.a === from ? e.b : e.a, remaining: e.minutes };
  }
  if (a.position.kind !== "transit") return;
  const position = a.position, task = a.task!;
  // Finish the admitted segment without teleporting or freezing its clock.
  // Any closure/revocation is checked again before the following entry.
  task.status = "moving";
  delete task.reason;
  position.remaining--;
  if (position.remaining === 0) {
    a.position = { kind: "node", node: position.to };
    settle(state, id);
  }
}
export function advance(state: State, minutes: number): State {
  if (!Number.isSafeInteger(minutes) || minutes < 0) throw Error("invalid minutes");
  const next = structuredClone(state);
  for (let minute = 0; minute < minutes; minute++) {
    next.time++;
    for (const id of Object.keys(next.actors).sort()) tick(next, id);
  }
  return next;
}
export function setDoor(state: State, open: boolean): State {
  return { ...structuredClone(state), doorOpen: open };
}
export function setConstruction(state: State, blocked: boolean): State {
  return { ...structuredClone(state), constructionBlocked: blocked };
}
export function setPermission(state: State, actor: string, allowed: boolean): State {
  const next = structuredClone(state);
  next.permissions[actor] = allowed;
  return next;
}
export function setHandlingPermission(state: State, actor: string, ref: EntityRef, allowed: boolean): State {
  const next = structuredClone(state);
  const others = (next.handlingPermissions[key(ref)] ?? []).filter(id => id !== actor);
  next.handlingPermissions[key(ref)] = allowed ? [...others, actor] : others;
  return next;
}
export function describe(state: State, actor: string): string {
  const position = locate(state, { kind: "actor", id: actor });
  const task = state.actors[actor].task;
  const where = position.kind === "node" ? position.node : `${position.from} -> ${position.to} (${position.remaining})`;
  return `${actor}: ${where}; destination=${task?.destination ?? "none"}; status=${task?.status ?? "idle"}`;
}
