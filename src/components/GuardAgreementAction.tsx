import { HeartHandshake } from "lucide-react";
import { GUARD_AGREEMENT_RULE, inspectGuardAgreement, isGuardPresentAt } from "../game/engine";
import type { Command, GameState } from "../game/types";

/** One immediate local exchange, using only the actual roster selection. */
export function GuardAgreementAction({ game, selectedIds, onCommand }: {
  game: GameState;
  selectedIds: string[];
  onCommand: (command: Command) => boolean;
}) {
  const rule = GUARD_AGREEMENT_RULE;
  if (!isGuardPresentAt(game, rule.location)) return null;
  const preview = inspectGuardAgreement(game, selectedIds);
  return <button
    className="action-card guard-agreement-action"
    data-guard-agreement-action
    disabled={!!preview.error}
    title={preview.error ?? "本人の食事を渡し、守り手に置き場を譲ってもらいます。"}
    onClick={() => onCommand({ type: "guard-agreement", residentIds: selectedIds })}
  >
    <span className="action-icon"><HeartHandshake size={18} strokeWidth={1.6} aria-hidden="true" /></span>
    <span>
      <strong>食事{rule.cost.food}を渡して立ち去ってもらう</strong>
      <small>{preview.error ?? "守り手が置き場を譲り、立ち去ります。"}</small>
      <span className="action-time">
        {preview.actorName ? `${preview.actorName} · ` : ""}本人の未予約の食事 {rule.cost.food} · 時間は進みません
      </span>
      <span className="guard-agreement-effect">物資の回収は別に20分かかります。</span>
    </span>
  </button>;
}
