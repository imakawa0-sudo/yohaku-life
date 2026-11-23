import { readLocal, type LocalRead, type LocalWriteResult } from "./library";

export function confirmHandbookWrite(
  result: LocalWriteResult,
): LocalWriteResult {
  if (result.status === "unavailable") return result;
  // The lock has been released. A later writer's storage event may still be queued.
  const latest = readLocal();
  if (latest.raw === null && latest.legacyRaw === undefined)
    return { status: "unavailable", warning: latest.warning };
  if (latest.blocked) return { status: "blocked", latest };
  if (result.status === "saved" && result.raw === latest.raw) return result;
  if (
    result.status === "invalid" &&
    result.latest.raw === latest.raw &&
    result.latest.legacyRaw === latest.legacyRaw
  )
    return result;
  return { status: "conflict", latest };
}

export function handbookWarning(
  state: LocalRead | "unavailable",
  canExport: boolean,
): string {
  const exportHint = canExport
    ? " 表示中の暮らしは、手帳の「保存を書き出す」から保管できます。"
    : "";
  if (state !== "unavailable") {
    if (state.blocked)
      return (
        "手帳を読み取れませんでした。元の保存を保護しています。" +
        exportHint +
        " バックアップがあれば、別のブラウザでこのゲームを開き、空の手帳の「保存を読み込む」から再開できます。"
      );
    if (state.raw !== null || state.legacyRaw !== undefined)
      return state.warning;
  }
  const detail =
    state === "unavailable"
      ? "この操作の保存を確認できませんでした。"
      : "ブラウザの手帳を読み出せませんでした。";
  return (
    detail +
    "ブラウザの保存設定と空き容量を確認し、少し待ってからもう一度操作してください。" +
    exportHint
  );
}
