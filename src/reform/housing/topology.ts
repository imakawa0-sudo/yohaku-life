import type { HousingConstruction } from "./constructionTypes";
import { furnishings, type House, type Room } from "../house";
import { spatialWalkId } from "../spatial/route";
import type { SpatialActor, SpatialPoint } from "../spatial/types";
import type {
  HousingControls,
  HousingGathering,
  RoomLodging,
  HousingSlot,
  HousingTopology,
} from "./types";

export function housingPoint(roomId: string, cell: number): SpatialPoint {
  return { domainId: JSON.stringify(["room", roomId]), cell };
}
export function housingRoomId(domainId: string): string | null {
  try {
    const parts: unknown = JSON.parse(domainId);
    if (
      Array.isArray(parts) &&
      parts.length === 2 &&
      parts[0] === "room" &&
      typeof parts[1] === "string" &&
      parts[1].length &&
      housingPoint(parts[1], 0).domainId === domainId
    )
      return parts[1];
  } catch {}
  return null;
}
export function housingDoorId(roomId: string, cell: number) {
  return JSON.stringify(["door", roomId, cell]);
}
export function housingLinkId(a: string, b: string) {
  return JSON.stringify(["link", ...[a, b].sort()]);
}
export function constructionSlotId(planId: string) {
  return JSON.stringify(["construction", planId]);
}
export function housingSlotId(roomId: string, fixtureId: string, seat: number) {
  return JSON.stringify(["slot", roomId, fixtureId, seat]);
}
/** Legacy station labels use a one-based suffix; new IDs are never split. */
export function legacyHousingStation(
  slot: Pick<HousingSlot, "fixtureId" | "seat">,
) {
  return slot.seat === 0
    ? slot.fixtureId
    : slot.fixtureId + "#" + (slot.seat + 1);
}
export function housingSourcePoint(actor: SpatialActor): SpatialPoint | null {
  const pos = actor.position;
  return pos.kind === "at"
    ? pos.point
    : pos.kind === "transit"
      ? pos.step.from
      : null;
}

function neighbors(room: Room, cell: number): number[] {
  const result: number[] = [];
  if (cell >= room.width) result.push(cell - room.width);
  if (cell % room.width > 0) result.push(cell - 1);
  if (cell % room.width < room.width - 1) result.push(cell + 1);
  if (cell + room.width < room.height * room.width)
    result.push(cell + room.width);
  return result;
}

/** Geometry alone determines a fixture's use point, including when a door closes mid-use. */
function entranceDistances(room: Room, blocked: number[]) {
  const distances = Array<number>(room.width * room.height).fill(Infinity);
  const occupied = new Set(blocked);
  const queue = [0];
  distances[0] = 0;
  for (const from of queue)
    for (const to of neighbors(room, from)) {
      if (occupied.has(to) || Number.isFinite(distances[to])) continue;
      distances[to] = distances[from] + 1;
      queue.push(to);
    }
  return distances;
}

/** Reconcile valid settings with newly added/removed house geometry. Validation separately checks saved settings. */
function controlsForHouse(
  house: House,
  controls?: HousingControls,
): HousingControls {
  const doors = house.rooms.flatMap((r) =>
    r.doors.map((c) => housingDoorId(r.id, c)),
  );
  const links = house.links.map(([a, b]) => housingLinkId(a, b));
  const roomAccess = Object.fromEntries(
    house.rooms.map((r) => {
      const allowed =
        controls && Object.hasOwn(controls.roomAccess, r.id)
          ? controls.roomAccess[r.id]
          : null;
      return [r.id, allowed === null ? null : [...new Set(allowed)].sort()];
    }),
  );
  return {
    closedDoors: doors
      .filter((id) => controls?.closedDoors.includes(id))
      .sort(),
    closedLinks: links
      .filter((id) => controls?.closedLinks.includes(id))
      .sort(),
    roomAccess,
  };
}

/** Apply to a detached graph: walk into the venue, use only the offered seat(s). */
export function allowGatheringGuest(
  geometry: HousingTopology["geometry"],
  roomId: string,
  guestId: string,
  slotIds: string[],
): void {
  const domain = housingPoint(roomId, 0).domainId;
  for (const rule of geometry.entryRules) {
    if (
      rule.point.domainId === domain &&
      !rule.allowedActorIds.includes(guestId)
    )
      rule.allowedActorIds = [...rule.allowedActorIds, guestId].sort();
  }
  for (const id of slotIds) {
    const slot = geometry.slots[id];
    if (slot?.allowedActorIds && !slot.allowedActorIds.includes(guestId))
      slot.allowedActorIds = [...slot.allowedActorIds, guestId].sort();
  }
}

/** The permanent room users keep management authority. Occupancy grants use of this room. */
export function effectiveRoomAccess(
  roomId: string,
  controls: HousingControls,
  lodging?: RoomLodging,
): string[] | null {
  const allowed = Object.hasOwn(controls.roomAccess, roomId)
    ? controls.roomAccess[roomId]
    : [];
  if (
    allowed === null ||
    lodging?.phase !== "occupied" ||
    lodging.roomId !== roomId ||
    allowed.includes(lodging.residentId)
  )
    return allowed;
  return [...allowed, lodging.residentId].sort();
}

/** actorIds are the currently located spatial actors. Controls may also refer to unlocated residents. */
export function buildHousingTopology(
  house: House,
  actorIds: string[],
  controls?: HousingControls,
  positions?: Record<string, SpatialActor>,
  layoutVersion?: 2,
  construction?: HousingConstruction,
  gatherings?: Record<string, HousingGathering>,
  lodging?: RoomLodging,
): HousingTopology {
  const settings = controlsForHouse(house, controls);
  const geometry: HousingTopology["geometry"] = {
    domains: {},
    connections: {},
    gates: {},
    entryRules: [],
    slots: {},
  };
  const slots: HousingTopology["slots"] = {};
  for (const room of house.rooms) {
    const point = (cell: number) => housingPoint(room.id, cell);
    const domainId = point(0).domainId;
    const blockedCells = [
      ...room.walls,
      ...room.fixtures.map((f) => f.cell),
    ].sort((a, b) => a - b);
    geometry.domains[domainId] = {
      id: domainId,
      width: room.width,
      height: room.height,
      stepMinutes: 1,
      blockedCells,
    };
    const distances = entranceDistances(room, blockedCells);
    const allowed =
      effectiveRoomAccess(room.id, settings, lodging)?.filter((id) =>
        actorIds.includes(id),
      ) ?? null;
    if (allowed !== null) {
      // An occupant can still walk out when permission is revoked. Transit belongs to the departure side.
      const occupants = actorIds.filter(
        (id) =>
          positions &&
          Object.hasOwn(positions, id) &&
          housingSourcePoint(positions[id])?.domainId === domainId,
      );
      // The accepted move-in needs entry, but furniture and handling wait until arrival.
      if (
        lodging?.phase === "arriving" &&
        lodging.roomId === room.id &&
        actorIds.includes(lodging.residentId)
      )
        occupants.push(lodging.residentId);
      const entrants = [...new Set([...allowed, ...occupants])].sort();
      for (let cell = 0; cell < distances.length; cell++) {
        if (!blockedCells.includes(cell))
          geometry.entryRules.push({
            point: point(cell),
            allowedActorIds: [...entrants],
          });
      }
    }
    for (const door of room.doors)
      for (const neighbor of neighbors(room, door)) {
        const a = point(Math.min(door, neighbor)),
          b = point(Math.max(door, neighbor));
        const id = spatialWalkId(a, b);
        // Adjacent doors share one walk edge; either door may close it.
        const open =
          (geometry.gates[id]?.open ?? true) &&
          !settings.closedDoors.includes(housingDoorId(room.id, door));
        geometry.gates[id] = { id, a, b, open };
      }
    for (const fixture of room.fixtures) {
      const adjacentFloors = neighbors(room, fixture.cell)
        .filter((c) => Number.isFinite(distances[c]))
        .sort((a, b) => distances[a] - distances[b] || a - b);
      for (let seat = 0; seat < furnishings[fixture.kind].seats; seat++) {
        const cell = adjacentFloors[layoutVersion === 2 ? seat : 0];
        if (cell === undefined) break;
        const id = housingSlotId(room.id, fixture.id, seat);
        slots[id] = {
          id,
          roomId: room.id,
          fixtureId: fixture.id,
          kind: fixture.kind,
          seat,
          point: point(cell),
        };
        geometry.slots[id] = {
          id,
          point: point(cell),
          allowedActorIds: allowed === null ? null : [...allowed],
        };
      }
    }
  }
  for (const plan of Object.values(construction?.plans ?? {})) {
    if (plan.status !== "planned" && plan.assignment?.kind !== "build")
      continue;
    if (!Object.hasOwn(settings.roomAccess, plan.neighborId)) continue;
    const id = constructionSlotId(plan.id);
    geometry.slots[id] = {
      id,
      point: { ...plan.staging },
      allowedActorIds:
        effectiveRoomAccess(plan.neighborId, settings, lodging)?.filter(
          (actor) => actorIds.includes(actor),
        ) ?? null,
    };
  }
  for (const link of house.links) {
    const [a, b] = [...link].sort();
    const id = housingLinkId(a, b);
    geometry.connections[id] = {
      id,
      a: housingPoint(a, 0),
      b: housingPoint(b, 0),
      minutes: 3,
      open: !settings.closedLinks.includes(id),
    };
  }
  for (const group of Object.values(gatherings ?? {})) {
    const pair = group.invitation;
    if (
      !pair ||
      !effectiveRoomAccess(group.roomId, settings, lodging)?.includes(
        pair.hostId,
      )
    )
      continue;
    const guest = group.members.find(
      (m) => m.actorId === pair.guestId && m.status === "participating",
    );
    if (
      guest &&
      group.members.some(
        (m) => m.actorId === pair.hostId && m.status === "participating",
      )
    )
      allowGatheringGuest(geometry, group.roomId, pair.guestId, [guest.slotId]);
  }
  return { geometry, slots, controls: settings };
}
