import { Footprints } from "lucide-react";
import { SECOND_ENCOUNTER_RULE, inspectRidgeApproach } from "../game/engine";
import type { Command, GameState } from "../game/types";

export function RidgeApproachAction({ game, selectedIds, onCommand }: {
  game: GameState;
  selectedIds: string[];
  onCommand: (command: Command) => boolean;
}) {
  if (game.secondaryEncounter) return null;
  const preview = inspectRidgeApproach(game, selectedIds);
  return <button
    className="action-card ridge-approach-action"
    data-ridge-approach-action
    disabled={!!preview.error}
    title={preview.error ?? "尾根の奥の人影へ近づき、相手と対峙します。"}
    onClick={() => onCommand({ type: "assign", residentIds: selectedIds, kind: "approach-ridge" })}
  >
    <span className="action-icon"><Footprints size={18} strokeWidth={1.6} aria-hidden="true" /></span>
    <span>
      <strong>尾根の人影へ近づく</strong>
      <small>{preview.error ?? "尾根の奥で相手と対峙します。退避や戦闘に備えてから。"}</small>
      <span className="action-time">
        {preview.actorName ? `${preview.actorName} · ` : ""}{SECOND_ENCOUNTER_RULE.approachMinutes}分
      </span>
      <span className="work-reservation">出会ったところで時間が止まります。予約だけでは進みません。</span>
    </span>
  </button>;
}
