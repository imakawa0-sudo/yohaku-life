import { isGame, type Game } from "./sim";

export const LIBRARY_KEY = "yohaku-reform-library-v1";

export type Slot = { id: string; name: string; game: Game; origin: Game };
export type Library = { format: 1; activeId: string | null; slots: Slot[] };
export const emptyLibrary = (): Library => ({
  format: 1,
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

export function parseLibrary(json: string): Library {
  const value: unknown = JSON.parse(json);
  if (
    !record(value) ||
    value.format !== 1 ||
    !Array.isArray(value.slots) ||
    !value.slots.every(isSlot) ||
    new Set(value.slots.map((s) => s.id)).size !== value.slots.length ||
    !(
      value.activeId === null ||
      value.slots.some((s) => s.id === value.activeId)
    )
  ) {
    throw new Error("手帳の形式を確認できませんでした。");
  }
  return value as Library;
}

export function exportSlot(slot: Slot): string {
  return JSON.stringify(
    { type: "yohaku-reform-save", version: 1, slot },
    null,
    2,
  );
}

export function importSlot(json: string): Slot {
  const value: unknown = JSON.parse(json);
  if (
    !record(value) ||
    value.type !== "yohaku-reform-save" ||
    value.version !== 1 ||
    !isSlot(value.slot)
  ) {
    throw new Error("改革版の手帳から書き出した保存を選んでください。");
  }
  return { ...value.slot, id: newId(), name: value.slot.name.slice(0, 80) };
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

export function readLocal(): {
  library: Library;
  raw: string | null;
  warning: string;
  blocked: boolean;
} {
  let raw = null;
  try {
    raw = localStorage.getItem(LIBRARY_KEY);
    return {
      library: raw ? parseLibrary(raw) : emptyLibrary(),
      raw,
      warning: "",
      blocked: false,
    };
  } catch {
    return {
      library: emptyLibrary(),
      raw,
      blocked: raw !== null,
      warning: raw
        ? "保存を読み取れませんでした。元の保存を保護しています。手帳から別の保存を読み込めます。"
        : "ブラウザ保存を利用できません。遊び終えたら手帳から保存を書き出してください。",
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
