import { LOCATION_IDS } from "./types";
import type { Action, GameState, LocationId, Resident, Resources } from "./types";
import { COIN_WEIGHT, getWalletCoins } from "./currency";

export type GearStock = { knife: number; spear: number; staff: number; armor: number };
export type InventoryState = {
  version: 1;
  packs: Record<string, Resources>;
  ground: Partial<Record<LocationId, Resources>>;
  baseGear: GearStock;
};
export type CarryLoad = {
  weight: number;
  capacity: number;
  ratio: number;
  multiplier: number;
  label: "余裕あり" | "重い荷物" | "過積載";
};

export const INVENTORY_RESOURCE_KEYS = ["food", "ingredients", "medicine", "scrap"] as const;
export const RESOURCE_WEIGHTS: Resources = { food: 0.5, ingredients: 0.25, medicine: 0.1, scrap: 1 };
const GEAR_KEYS = ["knife", "spear", "staff", "armor"] as const;
const GEAR_WEIGHTS: GearStock = { knife: 0.5, spear: 1.5, staff: 1, armor: 3 };
const BASE_LOCATIONS = new Set<string>(["home", "kitchen", "bedroom", "garden"]);

const zero = (): Resources => ({ food: 0, ingredients: 0, medicine: 0, scrap: 0 });
const initialGear = (): GearStock => ({ knife: 1, spear: 1, staff: 1, armor: 3 });
const person = (s: GameState, id: string) => s.residents.find((r) => r.id === id);
export const isBaseLocation = (location: LocationId): boolean => BASE_LOCATIONS.has(location);

/** This is the sole initializer. Read-only projections never create save data. */
export function ensureInventory(s: GameState): InventoryState {
  return s.inventory ??= {
    version: 1,
    packs: Object.fromEntries(s.residents.map((r) => [r.id, zero()])),
    ground: {},
    baseGear: initialGear(),
  };
}

function reservations(s: GameState, source: "base" | "pack", ownerId?: string, skipId?: number): Resources {
  const result = zero();
  for (const resident of s.residents) {
    if (source === "pack" && resident.id !== ownerId) continue;
    for (const action of [resident.action, resident.suspended]) {
      if (!action || action.id === skipId || (action.reservationSource ?? "base") !== source) continue;
      for (const key of INVENTORY_RESOURCE_KEYS) result[key] += action.reserved?.[key] ?? 0;
    }
  }
  return result;
}
function freeBase(s: GameState, skipId?: number): Resources {
  const reserved = reservations(s, "base", undefined, skipId);
  return Object.fromEntries(INVENTORY_RESOURCE_KEYS.map((key) => [key, s.resources[key] - reserved[key]])) as Resources;
}
function freePack(s: GameState, id: string, skipId?: number): Resources {
  const stock = s.inventory?.packs[id] ?? zero();
  const reserved = reservations(s, "pack", id, skipId);
  return Object.fromEntries(INVENTORY_RESOURCE_KEYS.map((key) => [key, stock[key] - reserved[key]])) as Resources;
}
export function freeBaseResources(s: GameState): Resources { return freeBase(s); }
export function ownFreeResources(s: GameState, id: string): Resources { return freePack(s, id); }

function rescuePatient(s: GameState, carrier: Resident, action: Action | null): Resident | undefined {
  const patient = action?.kind === "rescue" ? person(s, action.target ?? "") : undefined;
  return patient && carrier.hp > 0 && patient.id !== carrier.id && !isBaseLocation(patient.location)
    && patient.location === carrier.location && patient.hp <= 35 ? patient : undefined;
}
function moving(s: GameState, r: Resident): boolean {
  return r.action?.kind === "move" || !!rescuePatient(s, r, r.action);
}
function carried(s: GameState, id: string): boolean {
  return s.residents.some((r) => r.id !== id
    && [r.action, r.suspended].some((action) => rescuePatient(s, r, action)?.id === id));
}
/** Sharing uses the same physical boundary as actual local input reservation. */
export function canShareAtCurrentLocation(s: GameState, id: string): boolean {
  const r = person(s, id);
  return !!r && !moving(s, r) && !carried(s, id);
}
function peers(s: GameState, r: Resident): Resident[] {
  return s.residents.filter((p) => p.id !== r.id && p.location === r.location && !moving(s, p) && !carried(s, p.id))
    .sort((a, b) => a.id.localeCompare(b.id));
}
/** Locally available input, never a total that can be consumed remotely. */
export function accessibleResources(s: GameState, id: string): Resources {
  const r = person(s, id);
  if (!r) return zero();
  const result = freePack(s, id);
  if (moving(s, r) || carried(s, id)) return result;
  if (isBaseLocation(r.location)) {
    const base = freeBase(s);
    for (const key of INVENTORY_RESOURCE_KEYS) result[key] += base[key];
  }
  for (const peer of peers(s, r)) {
    const stock = freePack(s, peer.id);
    result.food += stock.food;
    result.medicine += stock.medicine;
  }
  return result;
}

/** Validate every source before moving anything. The owner keeps the lock. */
export function reserveActionResources(s: GameState, r: Resident, a: Action): string | undefined {
  if (!a.reserved) return;
  if (Object.keys(a.reserved).some((key) => !INVENTORY_RESOURCE_KEYS.includes(key as keyof Resources))
    || Object.values(a.reserved).some((n) => typeof n !== "number" || !Number.isFinite(n) || n < 0))
    return "確保する物資の数量が不正です。";
  if (!INVENTORY_RESOURCE_KEYS.some((key) => (a.reserved?.[key] ?? 0) > 0)) return;
  const own = freePack(s, r.id, a.id);
  const base = freeBase(s, a.id);
  const needed = INVENTORY_RESOURCE_KEYS.filter((key) => (a.reserved?.[key] ?? 0) > 0);
  if (isBaseLocation(r.location) && needed.every((key) => own[key] === 0 && base[key] >= a.reserved![key]!)) {
    a.reservationSource = "base";
    delete a.materialTransfers;
    return;
  }
  const transfers: { from: string; resource: keyof Resources; amount: number }[] = [];
  for (const key of needed) {
    let left = a.reserved[key]! - Math.max(0, own[key]);
    if (left <= 0) continue;
    if (isBaseLocation(r.location)) {
      const amount = Math.min(left, Math.max(0, base[key]));
      if (amount > 0) transfers.push({ from: "base", resource: key, amount });
      left -= amount;
    }
    if (key === "food" || key === "medicine") {
      for (const peer of peers(s, r)) {
        const amount = Math.min(left, Math.max(0, freePack(s, peer.id, a.id)[key]));
        if (amount > 0) transfers.push({ from: peer.id, resource: key, amount });
        left -= amount;
        if (left <= 0) break;
      }
    }
    if (left > 0) return "今いる場所で使える未予約の物資が足りません。持ち物と近くの仲間を確認してください。";
  }
  const inventory = ensureInventory(s);
  for (const transfer of transfers) {
    const source = transfer.from === "base" ? s.resources : inventory.packs[transfer.from];
    source[transfer.resource] -= transfer.amount;
    inventory.packs[r.id][transfer.resource] += transfer.amount;
  }
  a.reservationSource = "pack";
  if (transfers.length) a.materialTransfers = transfers;
  else delete a.materialTransfers;
}

/** The job must still be attached when this is called; only its actual source is spent. */
export function consumeActionResources(s: GameState, r: Resident, a: Action): void {
  if (!a.reserved) return;
  const source = a.reservationSource === "pack" ? ensureInventory(s).packs[r.id] : s.resources;
  for (const key of INVENTORY_RESOURCE_KEYS) source[key] -= a.reserved[key] ?? 0;
}

export function addResourcesAt(s: GameState, r: Resident, delta: Partial<Resources>): void {
  const target = isBaseLocation(r.location) ? s.resources : ensureInventory(s).packs[r.id];
  for (const key of INVENTORY_RESOURCE_KEYS) target[key] += delta[key] ?? 0;
}

export function totalResources(s: GameState): Resources {
  const total = { ...s.resources };
  for (const stock of [...Object.values(s.inventory?.packs ?? {}), ...Object.values(s.inventory?.ground ?? {})]) {
    if (stock) for (const key of INVENTORY_RESOURCE_KEYS) total[key] += stock[key];
  }
  return total;
}

function personalWeight(s: GameState, r: Resident): number {
  const stock = s.inventory?.packs[r.id] ?? zero();
  const resources = INVENTORY_RESOURCE_KEYS.reduce((sum, key) => sum + stock[key] * RESOURCE_WEIGHTS[key], 0);
  const art = (s.life?.crafts ?? []).filter((c) => c.authorId === r.id && c.displayedAt === undefined).length * 0.2;
  return resources + GEAR_WEIGHTS[r.weapon] + (r.armor ? GEAR_WEIGHTS.armor : 0) + art + getWalletCoins(s, r.id) * COIN_WEIGHT;
}
export function getCarryLoad(s: GameState, id: string): CarryLoad {
  const r = person(s, id);
  if (!r) return { weight: 0, capacity: 0, ratio: 0, multiplier: 1, label: "余裕あり" };
  let weight = personalWeight(s, r);
  const patient = rescuePatient(s, r, r.action);
  if (patient) weight += 55 + personalWeight(s, patient);
  const capacity = Math.max(8, 24 * (1 - 0.15 * r.wounds.arm - 0.1 * r.wounds.body));
  const ratio = weight / capacity;
  return { weight, capacity, ratio, multiplier: ratio <= 0.5 ? 1 : ratio <= 1 ? 1.25 : 1.75,
    label: ratio <= 0.5 ? "余裕あり" : ratio <= 1 ? "重い荷物" : "過積載" };
}

function accessProblem(s: GameState, actor: Resident, endpoint: string): string | undefined {
  if (endpoint === "base") return isBaseLocation(actor.location) ? undefined : "拠点の保管分は、拠点へ戻ってから扱えます。";
  if (endpoint === "ground") return;
  const owner = person(s, endpoint);
  if (!owner) return "持ち主が見つかりません。";
  if (owner.location !== actor.location) return "物資を渡す相手と同じ場所へ移動してください。";
  if (moving(s, owner) || carried(s, owner.id)) return "移動や救助が終わってから、荷物を受け渡せます。";
}

function transferActorProblem(s: GameState, actorId: string): string | undefined {
  const actor = person(s, actorId);
  if (!actor || actor.hp <= 0 || actor.action?.kind === "sleep") return "起きて動ける住民を選んでください。";
  if (moving(s, actor) || carried(s, actorId)) return "移動や救助が終わってから、荷物を受け渡せます。";
}

export type CoinTransferPreview = {
  actorId?: string; location?: LocationId; from: string; to: string; amount: number;
  fromBefore: number; fromAfter: number; toBefore: number; toAfter: number; error?: string;
};
/** Shares the exact actor/endpoint physical guards with ordinary resource transfers. */
export function inspectCoinTransfer(s: GameState, actorId: string, from: string, to: string, amount: number): CoinTransferPreview {
  const fromBefore = getWalletCoins(s, from), toBefore = getWalletCoins(s, to);
  const validAmount = Number.isSafeInteger(amount) && amount > 0;
  const actor = person(s, actorId);
  const result: CoinTransferPreview = { from, to, amount, fromBefore, toBefore,
    fromAfter: validAmount ? fromBefore - amount : fromBefore, toAfter: validAmount ? toBefore + amount : toBefore,
    ...(actor ? { actorId: actor.id, location: actor.location } : {}) };
  const fail = (error: string): CoinTransferPreview => ({ ...result, error });
  if (s.ended) return fail("この試行は終了しています。");
  const actorProblem = transferActorProblem(s, actorId);
  if (actorProblem) return fail(actorProblem);
  if (!validAmount) return fail("受け渡す銀貨を正の整数で選んでください。");
  if (from === to || (from !== actorId && to !== actorId)) return fail("選んだ住民と同所の仲間の間で銀貨を受け渡してください。");
  if (!person(s, from) || !person(s, to)) return fail("銀貨の受渡し先は、同所の住民を選んでください。");
  const problem = accessProblem(s, actor!, from) ?? accessProblem(s, actor!, to);
  if (problem) return fail(problem);
  if (result.fromAfter < 0) return fail("渡す本人の所持銀貨が足りません。");
  if (!Number.isSafeInteger(result.fromAfter) || !Number.isSafeInteger(result.toAfter)) return fail("受渡し後の銀貨の枚数が不正です。");
  return result;
}

export function transferResources(s: GameState, actorId: string, from: string, to: string, key: keyof Resources, amount: number): string | undefined {
  const actorProblem = transferActorProblem(s, actorId);
  if (actorProblem) return actorProblem;
  const actor = person(s, actorId)!;
  if (!INVENTORY_RESOURCE_KEYS.includes(key) || !Number.isSafeInteger(amount) || amount <= 0) return "受け渡す物資と正の整数の数量を選んでください。";
  if (from === to || (from !== actorId && to !== actorId)) return "選んだ住民の持ち物と、保管場所または同所の仲間との間で受け渡してください。";
  const problem = accessProblem(s, actor, from) ?? accessProblem(s, actor, to);
  if (problem) return problem;
  const available = from === "base" ? freeBase(s) : from === "ground" ? s.inventory?.ground[actor.location] ?? zero() : freePack(s, from);
  if (available[key] < amount) return "受け渡せる未予約の物資が足りません。";
  const inventory = ensureInventory(s);
  const stockAt = (endpoint: string): Resources => endpoint === "base" ? s.resources
    : endpoint === "ground" ? inventory.ground[actor.location] ??= zero() : inventory.packs[endpoint];
  stockAt(from)[key] -= amount;
  stockAt(to)[key] += amount;
}

export function changeEquipment(s: GameState, r: Resident, weapon?: Resident["weapon"], armor?: boolean): string | undefined {
  if (!isBaseLocation(r.location)) return "装備の交換は、保管場所のある拠点で行えます。";
  if (r.hp <= 0 || r.action?.kind === "sleep" || moving(s, r) || carried(s, r.id)) return "起きて移動を終えてから、装備を交換できます。";
  if ((weapon !== undefined && !["knife", "spear", "staff"].includes(weapon)) || (armor !== undefined && typeof armor !== "boolean")) return "交換する装備が不正です。";
  const stock = s.inventory?.baseGear ?? initialGear();
  if (weapon !== undefined && weapon !== r.weapon && stock[weapon] < 1) return "その武器は拠点の保管場所にありません。";
  if (armor === true && !r.armor && stock.armor < 1) return "防具はすべて使用中です。";
  if ((weapon === undefined || weapon === r.weapon) && (armor === undefined || armor === r.armor)) return;
  const gear = ensureInventory(s).baseGear;
  if (weapon !== undefined && weapon !== r.weapon) {
    gear[r.weapon] += 1;
    gear[weapon] -= 1;
    r.weapon = weapon;
  }
  if (armor !== undefined && armor !== r.armor) {
    gear.armor += r.armor ? 1 : -1;
    r.armor = armor;
  }
}

export function validInventory(s: GameState, knownLocations: readonly string[] = LOCATION_IDS): boolean {
  const inventory = s.inventory;
  if (inventory === undefined) return s.version === 1 && s.residents.every((r) =>
    [r.action, r.suspended].every((action) => !action
      || (action.reservationSource !== "pack" && action.materialTransfers === undefined)));
  const record = (value: unknown): value is Record<string, unknown> => !!value && typeof value === "object" && !Array.isArray(value);
  const quantity = (value: unknown): value is number => typeof value === "number" && Number.isFinite(value) && value >= 0;
  const validStock = (value: unknown): value is Resources => record(value)
    && Object.keys(value).length === INVENTORY_RESOURCE_KEYS.length
    && INVENTORY_RESOURCE_KEYS.every((key) => quantity(value[key]));
  if (!record(inventory) || inventory.version !== 1 || !record(inventory.packs) || !record(inventory.ground) || !record(inventory.baseGear)) return false;
  const ids = new Set(s.residents.map((r) => r.id));
  if (Object.keys(inventory.packs).length !== ids.size || Object.keys(inventory.packs).some((id) => !ids.has(id))
    || !Object.values(inventory.packs).every(validStock)) return false;
  if (Object.keys(inventory.ground).some((id) => !knownLocations.includes(id)) || !Object.values(inventory.ground).every(validStock)) return false;
  if (Object.keys(inventory.baseGear).length !== GEAR_KEYS.length
    || !GEAR_KEYS.every((key) => Number.isSafeInteger(inventory.baseGear[key]) && inventory.baseGear[key] >= 0)) return false;
  for (const r of s.residents) {
    for (const action of [r.action, r.suspended]) {
      if (!action) continue;
      if (action.reservationSource !== undefined && !["base", "pack"].includes(action.reservationSource)) return false;
      if (action.reservationSource === "pack" && !action.reserved) return false;
      if (action.reserved && (Object.keys(action.reserved).some((key) => !INVENTORY_RESOURCE_KEYS.includes(key as keyof Resources))
        || Object.values(action.reserved).some((value) => !quantity(value)))) return false;
      if (action.materialTransfers !== undefined) {
        if (!Array.isArray(action.materialTransfers) || action.reservationSource !== "pack") return false;
        const totals = zero();
        const seen = new Set<string>();
        for (const transfer of action.materialTransfers) {
          if (!record(transfer) || typeof transfer.from !== "string"
            || (transfer.from !== "base" && (!ids.has(transfer.from) || transfer.from === r.id))
            || !INVENTORY_RESOURCE_KEYS.includes(transfer.resource)
            || !quantity(transfer.amount) || transfer.amount <= 0) return false;
          const key = `${transfer.from}:${transfer.resource}`;
          if (seen.has(key)) return false;
          seen.add(key);
          totals[transfer.resource] += transfer.amount;
        }
        if (INVENTORY_RESOURCE_KEYS.some((key) => totals[key] > (action.reserved?.[key] ?? 0))) return false;
      }
    }
    if (INVENTORY_RESOURCE_KEYS.some((key) => freePack(s, r.id)[key] < 0)) return false;
  }
  return INVENTORY_RESOURCE_KEYS.every((key) => freeBase(s)[key] >= 0);
}
