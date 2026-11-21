import { useState } from "react";
import { ChevronDown, Utensils } from "lucide-react";
import { command, LOCATIONS } from "../game/engine";
import { getFoodProductionTarget, MAX_FOOD_PRODUCTION_TARGET } from "../game/food-production";
import { accessibleResources, isBaseLocation } from "../game/inventory";
import type { Command, GameState } from "../game/types";

const quantity = (value: number) => Number(value.toFixed(1)).toString();

/** A replenishment preference; saving it never starts or cancels a job. */
export function FoodProductionPanel({ game, onCommand }: {
  game: GameState;
  onCommand: (cmd: Command) => boolean;
}) {
  const savedTarget = getFoodProductionTarget(game);
  const [draft, setDraft] = useState(() => String(savedTarget));
  const [open, setOpen] = useState(false);
  const [feedback, setFeedback] = useState("");
  const hasValue = draft.trim() !== "";
  const target = hasValue ? Number(draft) : NaN;
  const cmd: Command = { type: "food-production-target", target };
  const preview = open && hasValue ? command(game, cmd) : undefined;
  const error = !hasValue
    ? `0〜${MAX_FOOD_PRODUCTION_TARGET}の整数で補充目安を入力してください。`
    : preview?.error;
  return <details className="food-production-panel" onToggle={event => setOpen(event.currentTarget.open)}>
    <summary><Utensils size={16} /><strong>自主調理の補充目安</strong><span>{savedTarget === 0 ? "休止" : `${savedTarget}食`}</span><ChevronDown size={14} /></summary>
    <div className="food-production-body">
      <p>拠点で仲間が料理を始める目安です。その人が今いる場所で使える未予約の食事が、この数より少ないときに補充を考えます。</p>
      <form className="food-production-form" onSubmit={event => {
        event.preventDefault();
        if (!preview || error || !hasValue) return;
        if (onCommand(cmd)) {
          setDraft(String(target));
          setFeedback(target === 0
            ? "新しい自主調理を休止する設定です。途中の仕事・予約と時計はそのままです。"
            : `補充目安は${target}食です。途中の仕事・予約と時計は変わっていません。`);
        }
      }}>
        <label>補充の目安（食）
          <input type="number" name="food-production-target" min={0} max={MAX_FOOD_PRODUCTION_TARGET} step={1} inputMode="numeric"
            value={draft} aria-describedby={`food-production-range${error ? " food-production-error" : ""}`}
            onChange={event => { setDraft(event.target.value); setFeedback(""); }} />
          <small id="food-production-range">0〜{MAX_FOOD_PRODUCTION_TARGET}の整数 · 保存で反映</small>
        </label>
        <button type="submit" className="food-production-save" disabled={!preview || !!error}>補充目安を保存</button>
        {error && <p className="food-production-error" id="food-production-error">{error}</p>}
      </form>
      <p className="food-production-note">0は新しい自主調理だけを休止します。途中の仕事・予約は残り、直接の調理指示は使えます。</p>
      <p className="food-production-note">3食ずつ作るため、目安を超えることがあります。保存後も時間はボタンで進めます。</p>
      {feedback && <p className="food-production-feedback" role="status">{feedback}</p>}
      <details className="food-production-counts">
        <summary>数える食事と、今の状態<ChevronDown size={13} /></summary>
        <p>倉庫の表だけでなく、本人の携行食と、同じ場所で融通できる仲間の携行食も数えます。別の場所や移動・運搬中の仲間の荷物は含めません。</p>
        <p>下の数は本人別の判断材料で、合計ではありません。同じ倉庫の食事を複数人が見ています。</p>
        <ul>{game.residents.filter(person => person.id !== "aki").map(person => <li key={person.id} data-resident-id={person.id}>
          <div><strong>{person.name}</strong><span>{LOCATIONS[person.location].name}</span></div>
          <span>{isBaseLocation(person.location)
            ? `今使える食事 ${quantity(accessibleResources(game, person.id).food)}食`
            : "外出中：ここでは自主調理しません"}</span>
          <small>{person.action ? `今の指示：${person.action.label}` : "今の指示：なし"}</small>
          {person.suspended && <small>中断中：{person.suspended.label}</small>}
        </li>)}</ul>
        <p>担当・体調・今の仕事・食材によって、すぐには料理を始めないことがあります。アキは直接の指示で行動します。</p>
      </details>
    </div>
  </details>;
}
