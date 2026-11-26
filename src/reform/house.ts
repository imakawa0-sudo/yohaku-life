export const roomWidth = 4;
export const maxRoomHeight = 7;

export type Need =
  "hunger" | "bladder" | "hygiene" | "energy" | "social" | "fun";
export const needs: Need[] = [
  "hunger",
  "bladder",
  "hygiene",
  "energy",
  "social",
  "fun",
];
export const needLabels: Record<Need, string> = {
  hunger: "食事",
  bladder: "用足し",
  hygiene: "身支度",
  energy: "休息",
  social: "交流",
  fun: "楽しみ",
};

export function isBasicWoodwork(target: string | undefined): boolean {
  return target === "wood" || target === "wood:easy";
}

export const furnishings = {
  hearth: {
    name: "小さなかまど",
    use: "かまどで食事をとる",
    need: "hunger",
    time: 20,
    cost: 3,
    seats: 1,
  },
  kitchen: {
    name: "台所と食卓",
    use: "台所で温かな食事をとる",
    need: "hunger",
    time: 10,
    cost: 8,
    seats: 2,
  },
  latrine: {
    name: "外の厠",
    use: "外の厠を使う",
    need: "bladder",
    time: 15,
    cost: 2,
    seats: 1,
  },
  toilet: {
    name: "室内の便所",
    use: "室内の便所を使う",
    need: "bladder",
    time: 7,
    cost: 6,
    seats: 1,
  },
  basin: {
    name: "水桶",
    use: "水を汲んで身を清める",
    need: "hygiene",
    time: 32,
    cost: 2,
    seats: 1,
  },
  bath: {
    name: "給水付きの浴槽",
    use: "湯で身を清める",
    need: "hygiene",
    time: 13,
    cost: 8,
    seats: 1,
  },
  mat: {
    name: "敷きむしろ",
    use: "むしろに横になる",
    need: "energy",
    time: 85,
    cost: 1,
    seats: 1,
  },
  bed: {
    name: "布張りの寝台",
    use: "寝台で体を休める",
    need: "energy",
    time: 55,
    cost: 6,
    seats: 1,
  },
  bench: {
    name: "長椅子",
    use: "長椅子で語らう",
    need: "social",
    time: 20,
    cost: 2,
    seats: 2,
  },
  table: {
    name: "団らんの丸卓",
    use: "丸卓を囲む",
    need: "social",
    time: 13,
    cost: 5,
    seats: 3,
  },
  window: {
    name: "窓辺の腰掛け",
    use: "窓辺で景色を眺める",
    need: "fun",
    time: 22,
    cost: 1,
    seats: 1,
  },
  shelf: {
    name: "本棚と読書椅子",
    use: "本を開いて過ごす",
    need: "fun",
    time: 14,
    cost: 4,
    seats: 1,
  },
  workbench: {
    name: "木工台",
    use: "枝を削って木材を整える",
    need: null,
    time: 0, // The chosen job supplies its own processing time.
    cost: 3,
    seats: 1,
  },
} as const;
export type FixtureKind = keyof typeof furnishings;
export type Fixture = { id: string; kind: FixtureKind; cell: number };
export type Room = {
  id: string;
  name: string;
  width: number;
  height: number;
  walls: number[];
  doors: number[];
  fixtures: Fixture[];
};
export type House = {
  rooms: Room[];
  links: [string, string][];
  nextId: number;
};
export type Visit = {
  minutes: number;
  station: string;
  room: string;
  title: string;
};
const ROOM_COST = 4;
const PASSAGE_COST = 2;
export const fixtureKinds = Object.keys(furnishings) as FixtureKind[];

function emptyRoom(id: string, name: string): Room {
  return { id, name, width: roomWidth, height: 3, walls: [], doors: [], fixtures: [] };
}

export function initialHouse(): House {
  const living = emptyRoom("living", "居間");
  living.fixtures = [
    { id: "hearth-1", kind: "hearth", cell: 3 },
    { id: "bench-1", kind: "bench", cell: 5 },
    { id: "window-1", kind: "window", cell: 11 },
  ];
  const bed = emptyRoom("bedroom", "寝室");
  bed.fixtures = [{ id: "mat-1", kind: "mat", cell: 10 }];
  const yard = emptyRoom("yard", "裏庭");
  yard.fixtures = [
    { id: "latrine-1", kind: "latrine", cell: 3 },
    { id: "basin-1", kind: "basin", cell: 11 },
  ];
  return {
    rooms: [living, bed, yard],
    links: [
      ["living", "bedroom"],
      ["bedroom", "yard"],
    ],
    nextId: 1,
  };
}

export function roomName(house: House, id: string): string {
  return house.rooms.find((room) => room.id === id)?.name ?? "居間";
}

export function houseValue(house: House): number {
  return (
    house.links.length * PASSAGE_COST +
    house.rooms.reduce(
      (total, room) =>
        total +
        ROOM_COST +
        Math.max(0, room.width * room.height - 12) +
        room.walls.length +
        room.doors.length * 2 +
        room.fixtures.reduce((sum, f) => sum + furnishings[f.kind].cost, 0),
      0,
    )
  );
}

function roomSteps(house: House, start: string): Map<string, number> {
  const steps = new Map([[start, 0]]);
  const queue = [start];
  for (const current of queue) {
    for (const [a, b] of house.links) {
      const next = a === current ? b : b === current ? a : undefined;
      if (next && !steps.has(next)) {
        steps.set(next, steps.get(current)! + 1);
        queue.push(next);
      }
    }
  }
  return steps;
}

export function cellName(room: Room, cell: number): string {
  return `${(cell % room.width) + 1}列${Math.floor(cell / room.width) + 1}行`;
}

// Each room's common threshold is cell zero. A doorway costs an extra minute to pass.
// Furniture occupies its cell: visitors can use it, but cannot pass through to the next one.
function distances(room: Room): number[] {
  const count = room.width * room.height;
  const steps = new Array<number>(count).fill(Infinity);
  const occupied = new Set(room.fixtures.map((f) => f.cell));
  const closed = new Set<number>();
  const pending = [0];
  steps[0] = 0;
  while (pending.length) {
    pending.sort((a, b) => steps[a] - steps[b]);
    const cell = pending.shift()!;
    if (closed.has(cell) || occupied.has(cell)) continue;
    closed.add(cell);
    const x = cell % room.width,
      y = Math.floor(cell / room.width);
    for (const [nx, ny] of [
      [x + 1, y],
      [x - 1, y],
      [x, y + 1],
      [x, y - 1],
    ]) {
      if (nx < 0 || nx >= room.width || ny < 0 || ny >= room.height) continue;
      const next = ny * room.width + nx;
      if (room.walls.includes(next)) continue;
      const cost = steps[cell] + (room.doors.includes(next) ? 2 : 1);
      if (cost < steps[next]) {
        steps[next] = cost;
        pending.push(next);
      }
    }
  }
  return steps;
}

function findVisit(
  house: House,
  kind: Need,
  fromRoom: string,
  busy: string[],
  cooking: boolean,
  waterMinutes = 0,
): Visit | null {
  const steps = roomSteps(house, fromRoom);
  let best: Visit | null = null;
  for (const room of house.rooms) {
    const hops = steps.get(room.id);
    if (
      hops === undefined ||
      !room.fixtures.some((f) => furnishings[f.kind].need === kind)
    )
      continue;
    const walking = distances(room);
    for (const fixture of room.fixtures) {
      const use = furnishings[fixture.kind];
      if (use.need !== kind || !Number.isFinite(walking[fixture.cell]))
        continue;
      for (let seat = 0; seat < (cooking ? 1 : use.seats); seat++) {
        const station = seat === 0 ? fixture.id : `${fixture.id}#${seat + 1}`;
        if (busy.includes(station)) continue;
        const waterTrip = fixture.kind === "basin" ? 2 * waterMinutes : 0;
        const minutes =
          hops * 3 +
          walking[fixture.cell] +
          use.time +
          waterTrip -
          (cooking ? 10 : 0);
        if (!best || minutes < best.minutes)
          best = { minutes, station, room: room.id, title: use.use };
      }
    }
  }
  return best;
}

export function service(
  house: House,
  kind: Need,
  fromRoom: string,
  busy: string[],
  waterMinutes = 0,
): Visit | null {
  return findVisit(house, kind, fromRoom, busy, false, waterMinutes);
}

export function cookingStation(
  house: House,
  fromRoom: string,
  busy: string[],
): Visit | null {
  return findVisit(house, "hunger", fromRoom, busy, true);
}

type Edit =
  | { type: "room"; name: string; neighbor: string }
  | { type: "link"; a: string; b: string }
  | { type: "expand"; room: string }
  | { type: "build"; room: string; kind: FixtureKind; cell?: number }
  | { type: "move"; id: string; room: string; cell?: number }
  | { type: "remove"; id: string }
  | {
      type: "tile";
      room: string;
      cell: number;
      tile: "floor" | "wall" | "door";
    };

function free(room: Room, cell: number) {
  return (
    Number.isInteger(cell) &&
    cell > 0 &&
    cell < room.width * room.height &&
    !room.walls.includes(cell) &&
    !room.doors.includes(cell) &&
    !room.fixtures.some((f) => f.cell === cell)
  );
}
function reachable(room: Room): boolean {
  const d = distances(room);
  return room.fixtures.every((f) => Number.isFinite(d[f.cell]));
}
function place(room: Room, f: Fixture, preferred?: number) {
  const n = room.width * room.height;
  // Place large items near the perimeter first, keeping convenient paths through the middle.
  const candidates =
    preferred === undefined
      ? Array.from({ length: n }, (_, i) => n - 1 - i)
      : [preferred];
  for (const cell of candidates) {
    if (!free(room, cell)) continue;
    room.fixtures.push({ ...f, cell });
    if (reachable(room)) return;
    room.fixtures.pop();
  }
  throw Error("その場所には置けません。家具まで歩ける空き床を選んでください。");
}

export function editHouse(previous: House, edit: Edit): House {
  const house: House = structuredClone(previous);
  function byId(id: string) {
    const room = house.rooms.find((r) => r.id === id);
    if (!room) throw Error("部屋が見つかりません。");
    return room;
  }
  if (edit.type === "room") {
    byId(edit.neighbor);
    const name = edit.name.trim().slice(0, 24);
    if (!name) throw Error("新しい部屋に名前をつけてください。");
    const id = `room-${house.nextId++}`;
    house.rooms.push(emptyRoom(id, name));
    house.links.push([edit.neighbor, id]);
  } else if (edit.type === "link") {
    byId(edit.a);
    byId(edit.b);
    if (edit.a === edit.b) throw Error("別の二部屋を選んでください。");
    const old = house.links.findIndex(
      (pair) => pair.includes(edit.a) && pair.includes(edit.b),
    );
    if (old >= 0) house.links.splice(old, 1);
    else house.links.push([edit.a, edit.b]);
    if (roomSteps(house, "living").size !== house.rooms.length)
      throw Error(
        "通れなくなる部屋があります。先に別の通路をつないでください。",
      );
  } else if (edit.type === "build") {
    place(
      byId(edit.room),
      { id: `fixture-${house.nextId++}`, kind: edit.kind, cell: 0 },
      edit.cell,
    );
  } else if (edit.type === "move" || edit.type === "remove") {
    const oldRoom = house.rooms.find((r) =>
      r.fixtures.some((f) => f.id === edit.id),
    );
    if (!oldRoom) throw Error("設備が見つかりません。");
    const index = oldRoom.fixtures.findIndex((f) => f.id === edit.id);
    const fixture = oldRoom.fixtures.splice(index, 1)[0];
    if (edit.type === "move") place(byId(edit.room), fixture, edit.cell);
  } else if (edit.type === "expand") {
    const room = byId(edit.room);
    if (room.height >= maxRoomHeight) throw Error("この部屋は最大の広さです。");
    room.height++;
  } else {
    const room = byId(edit.room);
    if (
      !Number.isInteger(edit.cell) ||
      edit.cell <= 0 ||
      edit.cell >= room.width * room.height
    )
      throw Error("入口はそのまま使えるようにしてください。");
    if (room.fixtures.some((f) => f.cell === edit.cell))
      throw Error("先に家具を別の場所に移してください。");
    room.walls = room.walls.filter((v) => v !== edit.cell);
    room.doors = room.doors.filter((v) => v !== edit.cell);
    if (edit.tile === "wall") room.walls.push(edit.cell);
    if (edit.tile === "door") room.doors.push(edit.cell);
    if (!reachable(room))
      throw Error(
        "この壁で行けなくなる設備があります。先に扉か通路を確保してください。",
      );
  }
  return house;
}

function record(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
function cellsInBounds(value: unknown, limit: number): value is number[] {
  return (
    Array.isArray(value) &&
    value.every((v) => Number.isInteger(v) && v > 0 && v < limit) &&
    new Set(value).size === value.length
  );
}

/** Validate exported/imported JSON before pathfinding or charging for an edit. */
export function isHouse(value: unknown): value is House {
  if (
    !record(value) ||
    !Array.isArray(value.rooms) ||
    !value.rooms.length ||
    !Array.isArray(value.links) ||
    !Number.isSafeInteger(value.nextId) ||
    (value.nextId as number) < 1
  )
    return false;
  const roomIds = new Set<string>();
  const stationIds = new Set<string>();
  let largestAllocated = 0;
  const rememberSequence = (id: string) => {
    const suffix = /^(?:room|fixture)-(\d+)$/.exec(id)?.[1];
    if (suffix) largestAllocated = Math.max(largestAllocated, Number(suffix));
  };
  for (const room of value.rooms) {
    if (
      !record(room) ||
      typeof room.id !== "string" ||
      !room.id ||
      roomIds.has(room.id) ||
      typeof room.name !== "string" ||
      !room.name.trim() ||
      room.width !== roomWidth ||
      typeof room.height !== "number" ||
      !Number.isInteger(room.height) ||
      room.height < 3 ||
      room.height > maxRoomHeight ||
      !Array.isArray(room.fixtures)
    )
      return false;
    roomIds.add(room.id);
    rememberSequence(room.id);
    const count = roomWidth * room.height;
    if (!cellsInBounds(room.walls, count) || !cellsInBounds(room.doors, count))
      return false;
    const used = new Set([...room.walls, ...room.doors]);
    if (used.size !== room.walls.length + room.doors.length) return false;
    for (const fixture of room.fixtures) {
      if (
        !record(fixture) ||
        typeof fixture.id !== "string" ||
        !fixture.id ||
        stationIds.has(fixture.id) ||
        fixture.id.includes("#") ||
        typeof fixture.kind !== "string" ||
        !Object.hasOwn(furnishings, fixture.kind) ||
        typeof fixture.cell !== "number" ||
        !Number.isInteger(fixture.cell) ||
        fixture.cell < 1 ||
        fixture.cell >= count ||
        used.has(fixture.cell)
      )
        return false;
      used.add(fixture.cell);
      stationIds.add(fixture.id);
      rememberSequence(fixture.id);
    }
    if (!reachable(room as Room)) return false;
  }
  if (!roomIds.has("living") || largestAllocated >= (value.nextId as number))
    return false;
  const links = new Set<string>();
  for (const link of value.links) {
    if (
      !Array.isArray(link) ||
      link.length !== 2 ||
      !roomIds.has(link[0]) ||
      !roomIds.has(link[1]) ||
      link[0] === link[1]
    )
      return false;
    const key = JSON.stringify([...link].sort());
    if (links.has(key)) return false;
    links.add(key);
  }
  return roomSteps(value as House, "living").size === roomIds.size;
}
