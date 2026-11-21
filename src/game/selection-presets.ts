import type { GameState, SelectionPreset } from "./types";

export const MAX_SELECTION_PRESET_NAME = 24;

type PresetInput = { presetId?: number; name: string; residentIds: string[] };
type PresetResult = { changed: boolean; error?: string; preset?: SelectionPreset };
const record = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === "object" && !Array.isArray(value);
const whole = (value: unknown): value is number =>
  typeof value === "number" && Number.isSafeInteger(value) && value >= 1;
const copy = (preset: SelectionPreset): SelectionPreset => ({ ...preset, residentIds: [...preset.residentIds] });
const failure = (error: string): PresetResult => ({ changed: false, error });

function validContext(s: GameState): boolean {
  return record(s) && Array.isArray(s.residents)
    && s.residents.every(person => record(person) && typeof person.id === "string" && !!person.id)
    && new Set(s.residents.map(person => person.id)).size === s.residents.length;
}

/** These are current UI shortcuts, with no historical membership or world IDs. */
export function validSelectionPresets(s: GameState): boolean {
  if (!record(s)) return false;
  if (s.selectionPresets === undefined) return true;
  const presets = s.selectionPresets;
  if (!validContext(s) || !record(presets)
    || Object.keys(presets).some(key => !["version", "nextPresetId", "entries"].includes(key))
    || presets.version !== 1 || !whole(presets.nextPresetId) || !Array.isArray(presets.entries)) return false;
  const known = new Set(s.residents.map(person => person.id));
  const ids = new Set<number>();
  const names = new Set<string>();
  for (const preset of presets.entries) {
    if (!record(preset) || Object.keys(preset).some(key => !["id", "name", "residentIds"].includes(key))
      || !whole(preset.id) || preset.id >= presets.nextPresetId || ids.has(preset.id)
      || typeof preset.name !== "string" || !preset.name.length || preset.name.length > MAX_SELECTION_PRESET_NAME
      || preset.name !== preset.name.trim() || names.has(preset.name)
      || !Array.isArray(preset.residentIds) || !preset.residentIds.length
      || preset.residentIds.some(id => typeof id !== "string" || !known.has(id))
      || new Set(preset.residentIds).size !== preset.residentIds.length) return false;
    ids.add(preset.id);
    names.add(preset.name);
  }
  return true;
}

/** Reading old saves neither creates defaults nor exposes writable stored arrays. */
export function getSelectionPresets(s: GameState): readonly SelectionPreset[] {
  if (!validSelectionPresets(s) || !s.selectionPresets) return [];
  return s.selectionPresets.entries.map(copy);
}

/** The engine owns the outer clone; failures and identical updates never mutate it. */
export function saveSelectionPreset(s: GameState, input: PresetInput): PresetResult {
  if (!validContext(s) || !validSelectionPresets(s)) return failure("隊の保存内容を確認してください。");
  if (s.ended) return failure("この試行は終了しています。保存から再開してください。");
  if (!record(input) || !Array.isArray(input.residentIds) || !input.residentIds.length
    || input.residentIds.some(id => typeof id !== "string" || !s.residents.some(person => person.id === id)))
    return failure("隊に登録する住民を、共通の一覧から選んでください。");
  if (typeof input.name !== "string") return failure("隊の名前を24文字以内で入力してください。");
  const name = input.name.trim();
  if (!name.length || name.length > MAX_SELECTION_PRESET_NAME)
    return failure("隊の名前を24文字以内で入力してください。");
  if (input.presetId !== undefined && !whole(input.presetId)) return failure("変更する隊が見つかりません。");
  const entries = s.selectionPresets?.entries ?? [];
  const existing = input.presetId === undefined ? undefined : entries.find(preset => preset.id === input.presetId);
  if (input.presetId !== undefined && !existing) return failure("変更する隊が見つかりません。");
  if (entries.some(preset => preset.id !== existing?.id && preset.name === name))
    return failure("同じ名前の隊があります。別の名前を入力してください。");
  // Selection order also determines partners in a conversation of three or more.
  const residentIds = [...new Set(input.residentIds)];
  if (existing && existing.name === name && residentIds.length === existing.residentIds.length
    && residentIds.every((id, index) => id === existing.residentIds[index]))
    return { changed: false, preset: copy(existing) };
  const nextPresetId = s.selectionPresets?.nextPresetId ?? 1;
  if (!existing && nextPresetId >= Number.MAX_SAFE_INTEGER) return failure("新しい隊を記録できる番号がありません。");
  const preset: SelectionPreset = { id: existing?.id ?? nextPresetId, name, residentIds };
  const presets = s.selectionPresets ??= { version: 1, nextPresetId: 1, entries: [] };
  if (existing) presets.entries[presets.entries.indexOf(existing)] = preset;
  else {
    presets.entries.push(preset);
    presets.nextPresetId++;
  }
  return { changed: true, preset: copy(preset) };
}

/** Deletion does not recycle IDs, alter selection or touch any resident's work. */
export function deleteSelectionPreset(s: GameState, presetId: number): PresetResult {
  if (!validContext(s) || !validSelectionPresets(s)) return failure("隊の保存内容を確認してください。");
  if (s.ended) return failure("この試行は終了しています。保存から再開してください。");
  const existing = whole(presetId) ? s.selectionPresets?.entries.find(preset => preset.id === presetId) : undefined;
  if (!existing) return failure("削除する隊が見つかりません。");
  s.selectionPresets!.entries.splice(s.selectionPresets!.entries.indexOf(existing), 1);
  return { changed: true, preset: copy(existing) };
}
