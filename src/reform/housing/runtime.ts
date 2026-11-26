import { benchBoardId } from "./benchRecovery";
import { validBenchRecovery } from "./benchRecoveryValidation";
import { validRoomStay } from "./roomStay";
import { isFoodSupply } from "./foodSupplyValidation";
import { isFoodLedger, validFoodRelations } from "./foodValidation";
import { constructionTitle } from "./constructionTypes";
import {
  isBedPreferences,
  isBedSleepers,
  pruneBedSleepers,
  prunePreferredBeds,
} from "./bedPreference";
import {
  validConstructionRelations,
  isConstructionLedger,
} from "./constructionValidation";
import {
  constructionPlan,
  unresolvedConstruction,
} from "./constructionTopology";
import { validGatherings } from "./gatheringValidation";
import type {
  ConstructionResult,
  ConstructionInspection,
} from "./constructionTypes";
import {
  editHouse,
  furnishings,
  isBasicWoodwork,
  houseValue,
  isHouse,
  type House,
} from "../house";
import type { Actor, Game, Task } from "../sim";
import { isSpatialState } from "../spatial/codec";
import { isSpatialCell, sameSpatialPoint } from "../spatial/route";
import type {
  SpatialActor,
  SpatialOrder,
  SpatialPoint,
  SpatialState,
} from "../spatial/types";
import {
  buildHousingTopology,
  housingLinkId,
  housingPoint,
  housingRoomId,
  housingSourcePoint,
  legacyHousingStation,
} from "./topology";
import { recoveryUseMinutes } from "./types";
import type { HousingControls, HousingRuntime, HousingTopology } from "./types";

export function isRegionalHousingTask(task: Task | null): boolean {
  return (
    !!task && ["travel", "return", "withdraw", "rescue"].includes(task.kind)
  );
}

function unlocatedReason(game: Game, actor: Actor) {
  if (isRegionalHousingTask(actor.task)) return "regional-travel";
  return actor.location === game.home ? "legacy-unspecified" : "outside";
}

export function createHousingRuntime(
  game: Game,
  mode: "new" | "legacy",
): HousingRuntime {
  const actors: Record<string, SpatialActor> = Object.create(null);
  const legacyStationPaths: HousingRuntime["legacyStationPaths"] =
    Object.create(null);
  const unlocated: HousingRuntime["unlocated"] = Object.create(null);
  for (const actor of game.actors) {
    const id = actor.person.id;
    if (
      mode === "legacy" &&
      actor.task?.station &&
      actor.task.room &&
      !actor.task.spatial
    ) {
      legacyStationPaths[id] = legacyRoomPath(
        game.house,
        actor.room,
        actor.task.room,
      );
    }
    if (
      mode === "new" &&
      actor.location === game.home &&
      !isRegionalHousingTask(actor.task)
    ) {
      actors[id] = {
        id,
        position: { kind: "at", point: housingPoint("living", 0) },
        order: null,
        carryAllowedActorIds: null,
      };
    } else {
      unlocated[id] = {
        location: actor.location,
        room: actor.room,
        reason: unlocatedReason(game, actor),
      };
    }
  }
  const { controls, geometry } = buildHousingTopology(
    game.house,
    Object.keys(actors),
    undefined,
    actors,
  );
  return {
    version: 1,
    controls,
    legacyStationPaths,
    unlocated,
    state: {
      type: "housing-spatial-state",
      version: 1,
      time: game.time,
      nextOrderId: 1,
      ...geometry,
      actors,
      items: {},
      reservations: {},
    },
  };
}

function record(v: unknown): v is Record<string, unknown> {
  return (
    typeof v === "object" &&
    v !== null &&
    !Array.isArray(v) &&
    (Object.getPrototypeOf(v) === Object.prototype ||
      Object.getPrototypeOf(v) === null)
  );
}
function onlyFields(v: Record<string, unknown>, fields: string[]) {
  return Object.keys(v).every((key) => fields.includes(key));
}

/** Compare JSON structure without depending on the order in which dictionary keys were serialized. */
function sameData(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (Array.isArray(a))
    return (
      Array.isArray(b) &&
      a.length === b.length &&
      a.every((v, i) => sameData(v, b[i]))
    );
  return (
    record(a) &&
    record(b) &&
    Object.keys(a).length === Object.keys(b).length &&
    Object.entries(a).every(
      ([k, v]) => Object.hasOwn(b, k) && sameData(v, b[k]),
    )
  );
}

function idList(v: unknown): v is string[] {
  return (
    Array.isArray(v) &&
    v.every((id) => typeof id === "string") &&
    new Set(v).size === v.length
  );
}
function controlShape(v: unknown, ids: Set<string>): v is HousingControls {
  return (
    record(v) &&
    onlyFields(v, ["roomAccess", "closedDoors", "closedLinks"]) &&
    idList(v.closedDoors) &&
    idList(v.closedLinks) &&
    record(v.roomAccess) &&
    Object.values(v.roomAccess).every(
      (list) =>
        list === null || (idList(list) && list.every((id) => ids.has(id))),
    )
  );
}

function isFloor(
  geometry: HousingTopology["geometry"],
  point: SpatialPoint,
): boolean {
  const domain = geometry.domains[point.domainId];
  return (
    !!domain &&
    isSpatialCell(domain, point.cell) &&
    !domain.blockedCells.includes(point.cell)
  );
}
function validUnlocated(
  v: unknown,
  game: Game,
  actor: Actor,
  geometry: HousingTopology["geometry"],
): boolean {
  if (
    !record(v) ||
    !onlyFields(v, ["room", "location", "reason", "departurePoint"]) ||
    v.room !== actor.room ||
    v.location !== actor.location ||
    v.reason !== unlocatedReason(game, actor) ||
    actor.task?.spatial !== undefined ||
    actor.task?.kind === "home-move"
  )
    return false;
  if (
    actor.location === game.home &&
    !game.house.rooms.some((r) => r.id === actor.room)
  )
    return false;
  if (!Object.hasOwn(v, "departurePoint")) return true;
  const point = v.departurePoint;
  return (
    v.reason === "regional-travel" &&
    actor.location === game.home &&
    record(point) &&
    onlyFields(point, ["domainId", "cell"]) &&
    typeof point.domainId === "string" &&
    typeof point.cell === "number" &&
    housingRoomId(point.domainId) === actor.room &&
    isFloor(geometry, { domainId: point.domainId, cell: point.cell })
  );
}

export function readHousingMoveTarget(
  target: string | undefined,
): SpatialPoint | null {
  if (target === undefined) return null;
  try {
    const v: unknown = JSON.parse(target);
    return record(v) &&
      onlyFields(v, ["roomId", "cell"]) &&
      typeof v.roomId === "string" &&
      v.roomId.length > 0 &&
      typeof v.cell === "number" &&
      Number.isSafeInteger(v.cell) &&
      v.cell >= 0
      ? housingPoint(v.roomId, v.cell)
      : null;
  } catch {
    return null;
  }
}

function validBinding(
  task: Task | null,
  order: SpatialOrder | null,
  topology: HousingTopology,
  actorIds: Set<string>,
  id: string,
): boolean {
  const binding = task?.spatial;
  // The complete bidirectional match was checked by validFoodRelations.
  if (binding?.foodBundleId) return !!order && order.id === binding.orderId;
  if (task?.kind === "home-dismantle" || task?.kind === "home-salvage")
    return !!order && order.id === binding?.orderId; // Checked by validBenchRecovery.
  if (task?.kind === "home-build")
    return (
      binding?.kind === "use" &&
      order?.intent.kind === "use" &&
      order.id === binding.orderId
    );
  if (task?.kind === "home-haul")
    return (
      binding?.kind === "carry" &&
      order?.intent.kind === "carry" &&
      order.id === binding.orderId
    );
  if (binding === undefined)
    return order === null && task?.kind !== "home-move";
  if (
    !task ||
    !record(binding) ||
    !onlyFields(binding, [
      "orderId",
      "kind",
      "mealPartners",
      "socialCompany",
      "gatheringId",
    ]) ||
    !order ||
    order.id !== binding.orderId ||
    order.intent.kind !== binding.kind ||
    (binding.socialCompany !== undefined &&
      (binding.socialCompany !== true ||
        binding.kind !== "use" ||
        task.kind !== "need" ||
        task.target !== "social" ||
        actorIds.size < 2 ||
        task.remaining >= task.total))
  )
    return false;
  if (Object.hasOwn(binding, "gatheringId") !== (task.kind === "home-gather"))
    return false;
  const intent = order.intent;
  if (intent.kind === "move") {
    const target = readHousingMoveTarget(task.target);
    return (
      task.kind === "home-move" &&
      task.station === undefined &&
      (task.room === undefined ||
        task.room === housingRoomId(intent.destination.domainId)) &&
      !!target &&
      sameSpatialPoint(target, intent.destination) &&
      sameData(task.reserved, {}) &&
      binding.mealPartners === undefined
    );
  }
  if (intent.kind !== "use") return false;
  const slot = topology.slots[intent.slotId];
  if (
    !slot ||
    task.station !== slot.id ||
    task.room !== slot.roomId ||
    task.total !== intent.useMinutes ||
    task.remaining !== order.useRemaining
  )
    return false;
  if (task.kind === "home-gather")
    return (
      onlyFields(binding, ["orderId", "kind", "gatheringId"]) &&
      typeof binding.gatheringId === "string"
    );
  const need = furnishings[slot.kind].need;
  if (task.kind === "recover")
    return (
      (slot.kind === "mat" || slot.kind === "bed") &&
      task.mode === "direct" &&
      task.metric === "care" &&
      task.total === recoveryUseMinutes &&
      task.target === undefined &&
      task.partner === undefined &&
      task.follower === undefined &&
      onlyFields(binding, ["orderId", "kind"]) &&
      sameData(task.reserved, {})
    );
  if (slot.kind === "workbench")
    return (
      task.kind === "work" &&
      isBasicWoodwork(task.target) &&
      task.mode === "direct" &&
      task.metric === "work" &&
      slot.seat === 0 &&
      onlyFields(binding, ["orderId", "kind"]) &&
      sameData(task.reserved, {})
    );
  if (task.kind === "work") {
    return (
      ["cook", "cook:easy", "cook:hard", "cook:master"].includes(
        task.target ?? "",
      ) &&
      need === "hunger" &&
      slot.seat === 0 &&
      binding.mealPartners === undefined &&
      sameData(task.reserved, {
        ingredients: ["cook", "cook:easy"].includes(task.target!) ? 2 : 3,
      })
    );
  }
  if (
    task.kind !== "need" ||
    task.target !== need ||
    !sameData(task.reserved, need === "hunger" ? { food: 1 } : {})
  )
    return false;
  const meal = binding.mealPartners;
  if (meal === undefined) return true;
  return (
    need === "hunger" &&
    record(meal) &&
    Object.entries(meal).every(
      ([peer, minutes]) =>
        peer !== id &&
        actorIds.has(peer) &&
        Number.isSafeInteger(minutes) &&
        minutes > 0 &&
        minutes <= task.total - order.useRemaining,
    )
  );
}

export function isHousingRuntime(
  value: unknown,
  game: Game,
): value is HousingRuntime {
  const ids = new Set(game.actors.map((a) => a.person.id));
  if (
    !record(value) ||
    !onlyFields(value, [
      "version",
      "layoutVersion",
      "construction",
      "benchRecovery",
      "foodLogistics",
      "foodSupply",
      "gatherings",
      "nextGatheringId",
      "preferredBeds",
      "bedSleepers",
      "roomStay",
      "controls",
      "state",
      "unlocated",
      "legacyStationPaths",
    ]) ||
    value.version !== 1 ||
    (Object.hasOwn(value, "layoutVersion") && value.layoutVersion !== 2) ||
    (Object.hasOwn(value, "roomStay") && !validRoomStay(value.roomStay, game)) ||
    (Object.hasOwn(value, "bedSleepers") &&
      !isBedSleepers(value.bedSleepers, game)) ||
    (Object.hasOwn(value, "preferredBeds") &&
      !isBedPreferences(value.preferredBeds, game)) ||
    !isSpatialState(value.state) ||
    !record(value.unlocated) ||
    !record(value.legacyStationPaths) ||
    !controlShape(value.controls, ids)
  )
    return false;
  const { state, controls, unlocated, legacyStationPaths } = value;
  const located = Object.keys(state.actors);
  if (
    state.time !== game.time ||
    [
      ...located,
      ...Object.keys(unlocated),
      ...Object.keys(legacyStationPaths),
    ].some((id) => !ids.has(id))
  )
    return false;
  if (
    Object.hasOwn(value, "construction") &&
    !isConstructionLedger(value.construction, game.time)
  )
    return false;
  if (
    Object.hasOwn(value, "foodLogistics") &&
    !isFoodLedger(value.foodLogistics, game.time)
  )
    return false;
  if (!validGatherings(value as unknown as HousingRuntime, game)) return false;
  const topology = buildHousingTopology(
    game.house,
    located,
    controls,
    state.actors,
    value.layoutVersion === 2 ? 2 : undefined,
    value.construction as HousingRuntime["construction"],
    value.gatherings as HousingRuntime["gatherings"],
  );
  if (
    !sameData(controls, topology.controls) ||
    !Object.entries(topology.geometry).every(([key, v]) =>
      sameData(state[key as keyof SpatialState], v),
    )
  )
    return false;
  if (!validBenchRecovery(value as unknown as HousingRuntime, game)) return false;
  if (!validConstructionRelations(value as unknown as HousingRuntime, game))
    return false;
  if (
    Object.hasOwn(value, "foodSupply") &&
    !isFoodSupply(value.foodSupply, game, value as unknown as HousingRuntime)
  )
    return false;
  if (!validFoodRelations(value as unknown as HousingRuntime, game, topology))
    return false;
  const occupied = new Set<string>();
  for (const actor of game.actors) {
    const id = actor.person.id;
    const known = Object.hasOwn(state.actors, id);
    if (known === Object.hasOwn(unlocated, id)) return false;
    if (known) {
      const spatial = state.actors[id];
      const source = housingSourcePoint(spatial);
      if (
        spatial.carryAllowedActorIds !== null ||
        !source ||
        actor.location !== game.home ||
        isRegionalHousingTask(actor.task) ||
        housingRoomId(source.domainId) !== actor.room ||
        !validBinding(actor.task, spatial.order, topology, ids, id)
      )
        return false;
    } else if (!validUnlocated(unlocated[id], game, actor, topology.geometry))
      return false;

    const task = actor.task;
    const legacyStation =
      task?.station !== undefined && task.spatial === undefined;
    if (Object.hasOwn(legacyStationPaths, id) !== legacyStation) return false;
    if (
      legacyStation &&
      !validLegacyStationPath(actor, task, legacyStationPaths[id], topology)
    )
      return false;
    if (task?.station !== undefined && task.kind !== "home-build") {
      const physicalSeat = task.spatial
        ? legacyHousingStation(topology.slots[task.station])
        : task.station;
      if (occupied.has(physicalSeat)) return false;
      occupied.add(physicalSeat);
    }
  }
  return true;
}

/** Saved links form a simple path even after a new shortcut becomes the shortest route. */
function validLegacyStationPath(
  actor: Actor,
  task: Task,
  path: unknown,
  topology: HousingTopology,
): boolean {
  if (!Array.isArray(path) || !task.room) return false;
  const slot = Object.values(topology.slots).find(
    (s) => s.roomId === task.room && legacyHousingStation(s) === task.station,
  );
  if (!slot) return false;
  const need = furnishings[slot.kind].need;
  const needMatches = task.kind === "need" && task.target === need;
  const cookingMatches =
    task.kind === "work" &&
    task.target?.split(":")[0] === "cook" &&
    need === "hunger" &&
    slot.seat === 0;
  if (!needMatches && !cookingMatches) return false;
  let domain = housingPoint(actor.room, 0).domainId;
  const visited = new Set([domain]);
  for (const id of path) {
    if (
      typeof id !== "string" ||
      !Object.hasOwn(topology.geometry.connections, id)
    )
      return false;
    const { a, b } = topology.geometry.connections[id];
    if (a.domainId === domain) domain = b.domainId;
    else if (b.domainId === domain) domain = a.domainId;
    else return false;
    if (visited.has(domain)) return false;
    visited.add(domain);
  }
  return domain === housingPoint(task.room, 0).domainId;
}

/** The legacy planner's breadth-first room traversal chooses the first path on a tie. */
function legacyRoomPath(house: House, from: string, to: string): string[] {
  const paths = new Map([[from, [] as string[]]]);
  const queue = [from];
  for (const room of queue) {
    if (room === to) return paths.get(room)!;
    for (const [a, b] of house.links) {
      const next = a === room ? b : b === room ? a : undefined;
      if (next !== undefined && !paths.has(next)) {
        paths.set(next, [...paths.get(room)!, housingLinkId(room, next)]);
        queue.push(next);
      }
    }
  }
  return [];
}
function fixedFixture(
  previous: House,
  next: House,
  roomId: string,
  fixtureId: string,
): boolean {
  const find = (house: House) =>
    house.rooms
      .find((r) => r.id === roomId)
      ?.fixtures.find((f) => f.id === fixtureId);
  const before = find(previous),
    after = find(next);
  return (
    !!before &&
    !!after &&
    before.kind === after.kind &&
    before.cell === after.cell
  );
}

function editConflict(
  game: Game,
  house: House,
  before: HousingTopology,
  after: HousingTopology,
): string | undefined {
  const runtime = game.housing;
  const supply = runtime?.foodSupply;
  if (
    supply &&
    (!isFloor(after.geometry, supply.storage) ||
      !isFloor(after.geometry, housingPoint("living", 0)))
  )
    return "補充担当を設定している間は、供給口と補充先の床を残してください。";
  const bundle = runtime?.foodLogistics?.bundle;
  if (
    bundle?.state === "present" &&
    (!isFloor(after.geometry, bundle.storage) ||
      !isFloor(after.geometry, bundle.source))
  )
    return "食材の一束がある間は、供給口と保管先の床を残してください。";
  for (const plan of Object.values(runtime?.construction?.plans ?? {})) {
    if (
      unresolvedConstruction(plan) &&
      (!isFloor(after.geometry, plan.staging) ||
        !isFloor(after.geometry, plan.source))
    )
      return "工事の供給口と仮置き場の床を残してください。";
  }
  for (const item of Object.values(runtime?.state.items ?? {})) {
    if (
      item.position.kind === "at" &&
      !isFloor(after.geometry, item.position.point)
    ) {
      const recovery = runtime?.benchRecovery;
      if (recovery?.phase === "board" && item.id === benchBoardId(recovery.fixtureId))
        return "解体した板が置かれた床は変更できません。";
      return bundle?.state === "present" && item.id === bundle.itemId
        ? "食材の一束が置かれた床は変更できません。"
        : "工事用木材が置かれた床は変更できません。";
    }
  }
  for (const actor of game.actors) {
    const id = actor.person.id;
    const task = actor.task;
    const pos =
      runtime && Object.hasOwn(runtime.state.actors, id)
        ? runtime.state.actors[id].position
        : undefined;
    if (pos?.kind === "at" && !isFloor(after.geometry, pos.point))
      return actor.person.name + "が立っている床は変更できません。";
    if (pos?.kind === "transit") {
      if (!isFloor(after.geometry, pos.step.to))
        return actor.person.name + "が移動中です。着地する床を空けてください。";
      if (
        pos.step.kind === "connection" &&
        !Object.hasOwn(after.geometry.connections, pos.step.id)
      )
        return actor.person.name + "が移動中の通路は外せません。";
    }
    const departure =
      runtime && Object.hasOwn(runtime.unlocated, id)
        ? runtime.unlocated[id].departurePoint
        : undefined;
    if (departure && !isFloor(after.geometry, departure))
      return (
        actor.person.name +
        "が移動を取り消すときの復帰地点です。出発した床を残してください。"
      );
    if (
      actor.location === game.home &&
      !house.rooms.some((r) => r.id === actor.room)
    )
      return actor.person.name + "がいる部屋は残してください。";
    if (!task?.station || !task.room || task.kind === "home-build") continue;
    if (task.spatial) {
      const oldSlot = before.slots[task.station],
        newSlot = after.slots[task.station];
      if (
        !oldSlot ||
        !newSlot ||
        !fixedFixture(game.house, house, oldSlot.roomId, oldSlot.fixtureId) ||
        !sameSpatialPoint(oldSlot.point, newSlot.point)
      )
        return actor.person.name + "が予約した設備と利用位置は変更できません。";
    } else {
      const oldSlot = Object.values(before.slots).find(
        (s) =>
          s.roomId === task.room && legacyHousingStation(s) === task.station,
      );
      if (
        !oldSlot ||
        !fixedFixture(game.house, house, oldSlot.roomId, oldSlot.fixtureId)
      )
        return (
          actor.person.name + "の作業が終わるまで、この設備は変更できません。"
        );
      if (
        runtime &&
        runtime.legacyStationPaths[id]?.some(
          (link) => !Object.hasOwn(after.geometry.connections, link),
        )
      )
        return actor.person.name + "の作業が終わるまで、使う通路は外せません。";
    }
  }
}

function applyHouseShape(
  game: Game,
  house: House,
  settleConstruction?: (candidate: Game) => void,
): ConstructionResult {
  if (!isHouse(house))
    return { game, error: "入口と設備につながる間取りを確認してください。" };
  if (
    !settleConstruction &&
    house.rooms.some(
      (room) => !game.house.rooms.some((previous) => previous.id === room.id),
    )
  )
    return {
      game,
      error: game.housing
        ? "新しい部屋は「一室を増築する」から計画してください。"
        : "「住居の移動」を有効にしてから、新しい部屋を増築してください。",
    };
  const runtime = game.housing;
  const actors = runtime?.state.actors;
  const located = Object.keys(actors ?? {});
  const before = buildHousingTopology(
    game.house,
    located,
    runtime?.controls,
    actors,
    runtime?.layoutVersion,
    runtime?.construction,
    runtime?.gatherings,
  );
  const next = structuredClone(game);
  settleConstruction?.(next);
  const after = buildHousingTopology(
    house,
    located,
    runtime?.controls,
    actors,
    runtime?.layoutVersion,
    next.housing?.construction,
    next.housing?.gatherings,
  );
  const conflict = editConflict(game, house, before, after);
  if (conflict) return { game, error: conflict };
  next.house = structuredClone(house);
  if (next.housing) {
    next.housing.controls = after.controls;
    Object.assign(next.housing.state, after.geometry);
    prunePreferredBeds(next);
    pruneBedSleepers(next);
    if (!isHousingRuntime(next.housing, next))
      return {
        game,
        error: "進行中の指示が参照する部屋や地点は変更できません。",
      };
  }
  return { game: next };
}

export function completeRoomConstruction(
  game: Game,
  planId: string,
): ConstructionResult {
  const plan = constructionPlan(game.housing, planId);
  if (
    plan?.status !== "planned" ||
    plan.workedMinutes !== plan.workMinutes ||
    plan.assignment ||
    plan.material?.state !== "present"
  )
    return {
      game,
      error: "木材を搬入し、施工を30分終えると完成を反映できます。",
    };
  const position = game.housing!.state.items[plan.material.itemId].position;
  if (position.kind !== "at" || !sameSpatialPoint(position.point, plan.staging))
    return { game, error: "仮置き場に工事用の木材が必要です。" };
  if (!plan.kind && !Number.isSafeInteger(game.house.nextId + 1))
    return {
      game,
      error: "新しい部屋の番号を発行できないため、完成を反映できません。",
    };
  const house =
    plan.kind === "insulation"
      ? game.house
      : editHouse(game.house, {
          type: "room",
          name: plan.name,
          neighbor: plan.neighborId,
          height: plan.height,
        });
  const result = applyHouseShape(game, house, (candidate) => {
    const h = candidate.housing!,
      finished = h.construction!.plans[planId];
    const material = finished.material!;
    delete h.state.items[material.itemId];
    material.state = "consumed";
    finished.status = "completed";
    finished.roomId =
      plan.kind === "insulation" ? plan.neighborId : house.rooms.at(-1)!.id;
    finished.completedAt = candidate.time;
  });
  if (result.error) return result;
  logHouseChange(
    result.game,
    constructionTitle(plan) +
      `が完成した（工事用木材${plan.requiredWood}を使用）`,
  );
  return { game: result.game, planId };
}

export function inspectConstructionCompletion(
  game: Game,
  planId: string,
): ConstructionInspection {
  const result = completeRoomConstruction(game, planId);
  return result.error
    ? { ok: false, minutes: null, disabled: result.error }
    : { ok: true, minutes: 0 };
}

export function applyHousingHouseEdit(
  game: Game,
  house: House,
): ConstructionResult {
  const result = applyHouseShape(game, house);
  if (result.error) return result;
  const next = result.game;
  const cost = Math.max(0, houseValue(house) - houseValue(game.house));
  if (cost > game.wood)
    return {
      game,
      error: `工事には木材${cost}が必要です。共同の備蓄は${game.wood}です。`,
    };
  next.wood -= cost;
  logHouseChange(next, "住まいを整えた" + (cost ? "（木材" + cost + "）" : ""));
  return { game: next };
}

function logHouseChange(game: Game, message: string) {
  const hour = String(Math.floor(game.time / 60) % 24).padStart(2, "0");
  const minute = String(game.time % 60).padStart(2, "0");
  game.log = [
    `${Math.floor(game.time / 1440) + 1}日目 ${hour}:${minute}　${message}`,
    ...game.log,
  ].slice(0, 100);
}
