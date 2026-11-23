import { enableHousing, isGame, type Game } from "./sim";

export const LIBRARY_KEY = "yohaku-reform-library-v2";
export const LEGACY_LIBRARY_KEY = "yohaku-reform-library-v1";
export const LOCAL_LIBRARY_LOCK = "yohaku-reform-library-v2:write";

export type Slot = { id: string; name: string; game: Game; origin: Game };
export type Library = { format: 2; activeId: string | null; slots: Slot[] };
export const emptyLibrary = (): Library => ({
  format: 2,
  activeId: null,
  slots: [],
});

function record(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function isSlot(value: unknown): value is Slot {
  return (
    record(value) &&
    typeof value.id === "string" &&
    value.id.length > 0 &&
    typeof value.name === "string" &&
    value.name.trim().length > 0 &&
    isGame(value.game) &&
    isGame(value.origin)
  );
}

function hasHousing(slot: Slot): boolean {
  return slot.game.housing !== undefined || slot.origin.housing !== undefined;
}

export function parseLibrary(json: string): Library {
  const value: unknown = JSON.parse(json);
  if (
    !record(value) ||
    (value.format !== 1 && value.format !== 2) ||
    !Array.isArray(value.slots) ||
    !value.slots.every(isSlot) ||
    (value.format === 1 && value.slots.some(hasHousing)) ||
    new Set(value.slots.map((s) => s.id)).size !== value.slots.length ||
    !(
      value.activeId === null ||
      value.slots.some((s) => s.id === value.activeId)
    )
  ) {
    throw new Error("手帳の形式を確認できませんでした。");
  }
  return { ...value, format: 2 } as Library;
}

export function exportSlot(slot: Slot): string {
  return JSON.stringify(
    { type: "yohaku-reform-save", version: hasHousing(slot) ? 2 : 1, slot },
    null,
    2,
  );
}

export function importSlot(json: string): Slot {
  const value: unknown = JSON.parse(json);
  if (
    !record(value) ||
    value.type !== "yohaku-reform-save" ||
    (value.version !== 1 && value.version !== 2) ||
    !isSlot(value.slot) ||
    (value.version === 1 && hasHousing(value.slot))
  ) {
    throw new Error("新版の手帳から書き出した保存を選んでください。");
  }
  return {
    ...value.slot,
    id: newId(),
    name: value.slot.name.trim().slice(0, 80),
  };
}

export function newId(): string {
  const random = new Uint32Array(3);
  globalThis.crypto.getRandomValues(random);
  return Array.from(random, (n) => n.toString(36)).join("-");
}

export function appendSlot(library: Library, slot: Slot): Library {
  return { ...library, activeId: slot.id, slots: [...library.slots, slot] };
}

export function branchSlot(
  slot: Slot,
  fromOrigin: boolean,
  name: string,
): Slot {
  return {
    id: newId(),
    name,
    game: structuredClone(fromOrigin ? slot.origin : slot.game),
    origin: structuredClone(slot.origin),
  };
}

export function upgradeHousingSlot(slot: Slot, name: string): Slot {
  const upgrade = (game: Game) =>
    game.housing ? structuredClone(game) : enableHousing(game, "legacy");
  const game = upgrade(slot.game);
  if (!isGame(game))
    throw new Error(
      "現在の記録を新しい住居方式へ引き継げません。元の暮らしは旧方式で続けられます。設備を使う作業の途中なら、終えるか取り消してから分岐してください。",
    );
  const origin = upgrade(slot.origin);
  if (!isGame(origin))
    throw new Error(
      "「最初の朝」の記録を新しい住居方式へ引き継げません。この暮らしは旧方式のまま続けられます。",
    );
  return { id: newId(), name, game, origin };
}

export type LocalRead = {
  library: Library;
  raw: string | null;
  warning: string;
  blocked: boolean;
  legacyRaw?: string | null;
};

export type LocalWriteResult =
  | { status: "saved"; raw: string; warning?: string }
  | { status: "conflict"; latest: LocalRead }
  | { status: "blocked"; latest: LocalRead }
  | { status: "invalid"; latest: LocalRead; warning: string }
  | { status: "unavailable"; warning: string };

function readStoredLibrary(storage: Storage): LocalRead {
  const raw = storage.getItem(LIBRARY_KEY);
  const keys =
    raw === null
      ? { raw, legacyRaw: storage.getItem(LEGACY_LIBRARY_KEY) }
      : { raw };
  const saved = raw ?? keys.legacyRaw ?? null;
  try {
    return {
      ...keys,
      library: saved === null ? emptyLibrary() : parseLibrary(saved),
      warning:
        raw === null && saved !== null
          ? "旧版の手帳を読み込みました。次の保存で新版の手帳に複写し、元の保存はそのまま残します。"
          : "",
      blocked: false,
    };
  } catch {
    return {
      ...keys,
      library: emptyLibrary(),
      blocked: true,
      warning:
        "保存を読み取れませんでした。元の保存を保護しています。手帳から別の保存を読み込めます。",
    };
  }
}

export function readLocal(): LocalRead {
  try {
    return readStoredLibrary(localStorage);
  } catch {
    return {
      library: emptyLibrary(),
      raw: null,
      blocked: false,
      warning:
        "ブラウザ保存を利用できません。遊び終えたら手帳から保存を書き出してください。",
    };
  }
}

export function writeLocal(
  next: Library,
  expectedRaw: string | null,
  legacyRaw: string | null = null,
): LocalWriteResult {
  try {
    const storage = localStorage;
    const latest = readStoredLibrary(storage);
    if (latest.blocked) return { status: "blocked", latest };
    if (
      latest.raw !== expectedRaw ||
      (latest.raw === null && latest.legacyRaw !== legacyRaw)
    ) {
      return { status: "conflict", latest };
    }
    let raw: string;
    try {
      raw = JSON.stringify(next);
      parseLibrary(raw);
    } catch {
      return {
        status: "invalid",
        latest,
        warning:
          "変更後の内容を読み戻せないため、保存を見送りました。いまの画面から別の操作を選んでください。",
      };
    }
    storage.setItem(LIBRARY_KEY, raw);
    return { status: "saved", raw };
  } catch {
    return {
      status: "unavailable",
      warning:
        "端末に保存できませんでした。手帳の「保存を書き出す」からこの暮らしを保管してください。",
    };
  }
}

export async function writeLocalCoordinated(
  next: Library,
  expectedRaw: string | null,
  legacyRaw?: string | null,
): Promise<LocalWriteResult> {
  try {
    const locks = globalThis.navigator?.locks;
    if (locks) {
      return await locks.request(
        LOCAL_LIBRARY_LOCK,
        { mode: "exclusive" },
        () => writeLocal(next, expectedRaw, legacyRaw),
      );
    }
    const result = writeLocal(next, expectedRaw, legacyRaw);
    return result.status === "saved"
      ? {
          ...result,
          warning:
            "この環境では同時保存を防げません。複数のタブで同時に操作しないでください。",
        }
      : result;
  } catch {
    return {
      status: "unavailable",
      warning:
        "保存する順番を確保できませんでした。手帳の「保存を書き出す」からこの暮らしを保管してください。",
    };
  }
}

export function downloadText(text: string, filename: string) {
  const url = URL.createObjectURL(
    new Blob([text], { type: "application/json" }),
  );
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.append(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 2000);
}
