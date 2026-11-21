import { command } from "./engine";
import type { ActionKind, EncounterId, GameState } from "./types";

/** Translate the single resident selection into atomic, time-free game commands. */
export function assignSelection(
  state: GameState,
  residentIds: string[],
  kind: ActionKind,
  target?: string,
  encounterId?: EncounterId,
): { state: GameState; error?: string } {
  const ids = [...new Set(residentIds)];
  const fail = (error: string) => ({ state, error });
  if (encounterId !== undefined && (!["attack", "defend"].includes(kind) || !["ruins-guard", "ridge-watch"].includes(encounterId)))
    return fail("攻撃・防御の相手を確認してください。");
  if (kind === "approach-ridge" && residentIds.length !== 1)
    return fail("人影へ近づく住民を、住民一覧で一人だけ選んでください。");
  if (!ids.length) return fail("住民一覧から、行動する人を選んでください。");
  if (ids.some((id) => !state.residents.some((r) => r.id === id)))
    return fail("選択した住民が見つかりません。");
  if (
    [
      "cook",
      "decorate",
      "place-craft",
      "project",
      "repair-route",
      "approach-ridge",
      "heal",
      "help",
      "rescue",
    ].includes(kind) &&
    ids.length !== 1
  )
    return fail("この行動は1人で行います。住民一覧で1人を選んでください。");
  if (kind === "socialize") {
    if (ids.length < 2)
      return fail("話す人を、住民一覧で2人以上選んでください。");
    let next = state;
    for (let i = 0; i < ids.length; i++) {
      const result = command(next, {
        type: "assign",
        residentIds: [ids[i]],
        kind,
        target: ids[(i + 1) % ids.length],
      });
      if (result.error) return fail(result.error);
      next = result.state;
    }
    return { state: next };
  }
  const movingIds =
    kind === "move"
      ? ids.filter(
          (id) => state.residents.find((r) => r.id === id)?.location !== target,
        )
      : ids;
  if (!movingIds.length) return fail("選んだ住民は、すでにその場所にいます。");
  return command(state, {
    type: "assign",
    residentIds: movingIds,
    kind,
    target,
    ...(encounterId !== undefined ? { encounterId } : {}),
  });
}

/** A subject is explicit and belongs to one selected maker, not the viewed person. */
export function assignSubjectCraftSelection(
  state: GameState,
  residentIds: string[],
  design: "bird" | "flower",
  subjectEventId: number,
): { state: GameState; error?: string } {
  if (!Number.isSafeInteger(subjectEventId) || subjectEventId < 1)
    return { state, error: "題材にする景色を選んでください。" };
  const ids = [...new Set(residentIds)];
  if (ids.length !== 1)
    return { state, error: "題材を選んで作る住民を、一覧で一人だけ選んでください。" };
  if (design !== "bird" && design !== "flower")
    return { state, error: "題材を選べるのは、小鳥か花の木彫りです。" };
  return command(state, { type: "assign", residentIds: ids,
    kind: design === "bird" ? "hobby" : "project",
    ...(design === "flower" ? { target: "wood-flower" } : {}), subjectEventId });
}

/** The roster supplies both participants; the work supplies its actual author. */
export function assignCraftConversationSelection(
  state: GameState,
  residentIds: string[],
  craftId: number,
): { state: GameState; error?: string } {
  return command(state, { type: "discuss-craft", residentIds, craftId });
}
