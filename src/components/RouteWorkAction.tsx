import { CheckCheck, Hammer, Plus } from "lucide-react";
import { RIVER_PATH_RULE, getRouteWorkSummary } from "../game/engine";
import { assignSelection } from "../game/selection";
import type { Command, GameState } from "../game/types";

/** A single local action, using the same real roster selection as every order. */
export function RouteWorkAction({ game, selectedIds, onCommand }: {
  game: GameState;
  selectedIds: string[];
  onCommand: (command: Command) => boolean;
}) {
  const summary = getRouteWorkSummary(game);
  const rule = RIVER_PATH_RULE;
  if (summary.completed) return <p className="route-work-complete" data-route-work-complete>
    <CheckCheck size={18} aria-hidden="true" />
    <span><strong>川辺–集落の道は整備済み</strong>
      <small>この区間の基準 {rule.beforeMinutes}分 → {rule.afterMinutes}分</small>
    </span>
  </p>;

  const instruction: Command = {
    type: "assign", residentIds: selectedIds, kind: "repair-route", target: rule.id,
  };
  const preview = assignSelection(game, selectedIds, "repair-route", rule.id);
  const error = game.ended ? "この試行は終了しています。" : preview.error;
  const actor = selectedIds.length === 1
    ? game.residents.find(person => person.id === selectedIds[0]) : undefined;
  const planned = !error && actor
    ? preview.state.residents.find(person => person.id === actor.id)?.action : undefined;
  const job = planned?.kind === "repair-route" && planned.target === rule.id ? planned : undefined;
  const interrupted = job && actor?.action && !actor.action.automatic ? actor.action : undefined;
  const working = summary.working
    ? game.residents.find(person => person.id === summary.working!.residentId) : undefined;
  return <button
    className="action-card route-work-action"
    data-route-work-action
    title={error ?? "本人の資材を確保し、時間を進めて現地で整えます。"}
    disabled={!!error || !job}
    onClick={() => onCommand(instruction)}
  >
    <span className="action-icon"><Hammer size={18} strokeWidth={1.6} aria-hidden="true" /></span>
    <span>
      <strong>{rule.title}</strong>
      <small>{error ?? "川辺–集落の一辺を、歩きやすく。任意。"}</small>
      {job && actor && <span className="action-time">
        {Math.ceil(job.duration)}分 · {actor.name} · 本人の資材 {job.reserved?.scrap ?? 0}個を予約
      </span>}
      <span className="route-work-effect">完了後の区間基準{rule.afterMinutes}分（現在{rule.beforeMinutes}分）</span>
      {interrupted && <span className="route-work-context">「{interrupted.label}」は中断して保持</span>}
      {working && <span className="route-work-context">
        {summary.working!.blockedReason
          ? `待機中：${summary.working!.blockedReason}`
          : `${working.name}が${summary.working!.paused ? "整備を中断中" : "整備中"} · 進捗は「いまの仕事」で確認`}
      </span>}
    </span>
    <Plus size={16} strokeWidth={1.6} aria-hidden="true" />
  </button>;
}
