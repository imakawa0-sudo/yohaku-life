import { useEffect, useRef, useState } from "react";
import { ChevronDown, Clock3, Flag, NotebookPen } from "lucide-react";
import { command, estimateTravelMinutes, formatTime, LOCATIONS } from "../game/engine";
import { isBaseLocation } from "../game/inventory";
import { getOpenTravelPlans } from "../game/travel-plans";
import { previewTripSupplies } from "../game/trip-supplies";
import type { Command, GameState, Resident, TravelPlan } from "../game/types";

export type TripPlanOpenRequest = { planId: number; serial: number };
const when = (minutes: number) => `第${Math.floor(minutes / 1440) + 1}日 ${formatTime(minutes)}`;
const quantity = (value: number) => Number(value.toFixed(1)).toString();
const activity = (person: Resident) => person.hp <= 0 ? "意識なし"
  : person.action?.label ?? (person.suspended ? `${person.suspended.label}（中断中）` : "手が空いている");
const names = (game: GameState, ids: string[]) => ids.map(id => game.residents.find(person => person.id === id)?.name ?? "記録に残る人").join("・");
const suppliesFor = (game: GameState, ids: string[], until: number) => previewTripSupplies(game, ids, until, {
  estimateReturnMinutes: id => {
    const person = game.residents.find(resident => resident.id === id);
    return person && isBaseLocation(person.location) ? 0 : estimateTravelMinutes(game, id, "home");
  },
});

export function TripSupplyBudget({ game, residentIds, returnAt }: {
  game: GameState; residentIds: string[]; returnAt: number;
}) {
  const preview = suppliesFor(game, residentIds, returnAt);
  return <section className="trip-supply-budget" aria-label="旅の食事の見通し">
    <h4>帰還時に満腹度35を残す食事の目安（適時食べる想定）</h4>
    {preview.error ? <p className="trip-plan-error">{preview.error}</p> : <>
      <p className="trip-supply-total">必要目安 <strong>{preview.requiredMeals}食</strong> · 携行・未予約 <strong>{quantity(preview.freeFood)}食</strong> · 不足目安 <strong>{preview.shortfall}食</strong></p>
      {preview.overdue && <p className="travel-note">帰還目安は現在より前です。今の状態と食事を確認し、予定を見直してください。</p>}
      <ul className="trip-supply-groups">{preview.groups.map(group => <li key={group.key}>
        <strong>{LOCATIONS[group.location].name} · {names(game, group.residentIds)}</strong>
        <span>必要 {group.requiredMeals}食 / 携行 {quantity(group.freeFood)}食 / 不足 {group.shortfall}食</span>
        {!group.shareable && <small>移動・運搬中のため、この人の携行食を別に数えています。</small>}
      </li>)}</ul>
      <p className="travel-note">数えるのは予定に入れた住民の未予約の携行食だけです。別の場所の余りは不足と相殺しません。荷物の出し入れは「荷物と旅支度」から。</p>
      <details className="trip-supply-details">
        <summary>人物ごとの見通しと、計算の前提</summary>
        <p>食事は15分かけて、その都度指示してください。食事中の回復を含む場合も、途中の中断や実際の自主行動によって結果は変わります。中断中の食事・倉庫・未選択の仲間・今後の生産や交換は、補給の確約に含めません。</p>
        <ul>{preview.people.map(person => <li key={person.residentId}>
          <strong>{names(game, [person.residentId])}</strong>
          <span>食事目安 {person.requiredMeals}食 · 携行 {quantity(person.freeFood)}食{person.reservedFood > 0 && `（ほかに予約中 ${quantity(person.reservedFood)}食）`}</span>
          <span>{person.returnMinutes === undefined ? "帰路の時間は未確認" : `現在の帰路目安 約${person.returnMinutes}分`}{person.activeMealCredit && " · 今の食事が完了する想定"}</span>
          {person.warnings.map((warning, index) => <small key={index}>{warning}</small>)}
        </li>)}</ul>
        <p>帰路の時間は今の荷物・負傷と標準の道順からの目安です。遭遇、寄り道、途中の指示は含まず、到着を保証するものではありません。</p>
      </details>
    </>}
  </section>;
}

export function TravelPlanReminders({ game, onOpen }: {
  game: GameState; onOpen: (planId: number) => void;
}) {
  const plans = getOpenTravelPlans(game).filter(plan => plan.returnAt <= game.minutes);
  if (!plans.length) return null;
  return <section className="trip-plan-reminders" aria-label="帰還目安の予定を確認">
    {plans.map(plan => {
      const atBase = plan.residentIds.every(id => {
        const person = game.residents.find(resident => resident.id === id);
        return person && isBaseLocation(person.location);
      });
      return <div className="trip-plan-reminder" key={plan.id}>
        <Flag size={16} />
        <div><strong>旅の予定を確認する時刻です</strong><p>{plan.purpose} · {when(plan.returnAt)} 帰還目安</p><small>{names(game, plan.residentIds)}{atBase ? "は現在、拠点内にいます。予定を確認して閉じられます。" : "の現在地・食事と、今後の予定を確認できます。"}</small></div>
        <button onClick={() => onOpen(plan.id)} aria-label={`${plan.purpose}の予定を確認`}>予定を確認</button>
      </div>;
    })}
  </section>;
}

export function TripPlanPanel({ game, selectedIds, onCommand, openRequest, onOpenHandled }: {
  game: GameState; selectedIds: string[]; onCommand: (cmd: Command) => boolean; openRequest?: TripPlanOpenRequest | null; onOpenHandled?: () => void;
}) {
  const panel = useRef<HTMLDetailsElement>(null);
  const editor = useRef<HTMLFormElement>(null);
  const [editingId, setEditingId] = useState<number | undefined>();
  const [memberIds, setMemberIds] = useState<string[]>([]);
  const [purpose, setPurpose] = useState("");
  const [day, setDay] = useState(String(Math.floor(game.minutes / 1440) + 2));
  const [time, setTime] = useState("18:00");
  const [feedback, setFeedback] = useState("");
  const plans = getOpenTravelPlans(game);
  const closed = (game.travelPlans?.entries ?? []).filter(plan => plan.closedAt !== undefined).sort((a, b) => b.closedAt! - a.closedAt! || b.revisionId - a.revisionId).slice(0, 5);
  const draftIds = editingId === undefined ? selectedIds : memberIds;
  const dayNumber = Number(day);
  const match = /^(\d{2}):(\d{2})$/.exec(time);
  const validDate = Number.isSafeInteger(dayNumber) && dayNumber >= 1 && !!match && Number(match[1]) < 24 && Number(match[2]) < 60;
  const returnAt = validDate ? (dayNumber - 1) * 1440 + Number(match![1]) * 60 + Number(match![2]) : NaN;
  const cmd: Command = { type: "plan-trip", ...(editingId === undefined ? {} : { planId: editingId }), residentIds: [...draftIds], purpose, returnAt };
  const validation = validDate ? command(game, cmd) : undefined;
  const error = !validDate ? "ゲーム内の帰還日と時刻を指定してください。" : validation?.error;
  function edit(plan: TravelPlan) {
    setEditingId(plan.id);
    setMemberIds([...plan.residentIds]);
    setPurpose(plan.purpose);
    setDay(String(Math.floor(plan.returnAt / 1440) + 1));
    setTime(formatTime(plan.returnAt));
    setFeedback("");
    if (panel.current) panel.current.open = true;
  }
  function fresh() {
    setEditingId(undefined);
    setMemberIds([]);
    setPurpose("");
    setDay(String(Math.floor(game.minutes / 1440) + 2));
    setTime("18:00");
    setFeedback("");
  }
  useEffect(() => {
    if (!openRequest) return;
    const plan = plans.find(entry => entry.id === openRequest.planId);
    onOpenHandled?.();
    if (!plan) return;
    edit(plan);
    requestAnimationFrame(() => {
      editor.current?.scrollIntoView({ block: "start", behavior: "instant" });
      editor.current?.focus({ preventScroll: true });
    });
  }, [openRequest?.serial]);
  return <details className="panel trip-plan-panel" ref={panel} id="trip-plan-panel">
    <summary><NotebookPen size={17} /><strong>旅の予定と補給</strong><span>{plans.length ? `${plans.length}件の予定` : "管理用メモ"}</span><ChevronDown size={15} /></summary>
    <div className="trip-plan-body">
      <p className="travel-note">予定は管理用のメモです。保存・変更・閉じる操作では時計も仕事も変わりません。移動、食事、荷造りはそれぞれ指示します。</p>
      {plans.length > 0 && <div className="trip-plan-cards">{plans.map(plan => {
        const supplies = suppliesFor(game, plan.residentIds, plan.returnAt);
        return <article className={`trip-plan-card${editingId === plan.id ? " editing" : ""}`} key={plan.id}>
          <h4>{plan.purpose}</h4><p className="trip-plan-deadline"><Clock3 size={13} />{when(plan.returnAt)} 帰還目安</p>
          <ul>{plan.residentIds.map(id => {
            const person = game.residents.find(resident => resident.id === id);
            const supply = supplies.people.find(entry => entry.residentId === id);
            return person ? <li key={id}><strong>{person.name}</strong><span>{LOCATIONS[person.location].name} · {activity(person)}</span><small>{supply?.returnMinutes === undefined ? "帰路 未確認" : `現在の帰路 約${supply.returnMinutes}分`}</small></li> : null;
          })}</ul>
          <div className="trip-plan-card-actions"><button onClick={() => { edit(plan); editor.current?.scrollIntoView({ block: "start", behavior: "instant" }); }}>予定と補給を見る・編集</button><button onClick={() => {
            if (onCommand({ type: "close-trip", planId: plan.id })) {
              if (editingId === plan.id) fresh();
              setFeedback("予定を閉じました。移動や帰還の完了を意味するものではありません。時計は進んでいません。");
            }
          }}>予定を閉じる</button></div>
        </article>;
      })}</div>}
      <form className="trip-plan-editor" ref={editor} tabIndex={-1} onSubmit={event => {
        event.preventDefault();
        if (error) return;
        if (onCommand(cmd)) {
          const existingIds = new Set(game.travelPlans?.entries.map(plan => plan.id) ?? []);
          const saved = validation?.state.travelPlans?.entries.find(plan => editingId === undefined ? !existingIds.has(plan.id) : plan.id === editingId);
          const wasNew = editingId === undefined;
          if (saved) edit(saved);
          setFeedback(wasNew ? "予定を保存しました。移動と荷造りは別に指示してください。時計は進んでいません。" : "予定を保存しました。時計と途中の仕事は変わっていません。");
        }
      }}>
        <div className="trip-plan-editor-heading"><h4>{editingId === undefined ? "新しい旅の予定" : "予定を編集"}</h4>{editingId !== undefined && <button type="button" onClick={fresh}>新しい予定へ</button>}</div>
        <p className="trip-plan-members">予定の住民：<strong>{names(game, draftIds) || "住民一覧で選んでください"}</strong></p>
        {editingId !== undefined && <div className="trip-plan-members-change"><button type="button" onClick={() => { setMemberIds([...selectedIds]); setFeedback(""); }}>選択中の住民に変更</button><small>現在の選択：{names(game, selectedIds) || "なし"}。一覧の選択を変えただけでは、この予定の住民は変わりません。</small></div>}
        <label className="trip-plan-purpose">旅の目的<input maxLength={80} value={purpose} onChange={event => { setPurpose(event.target.value); setFeedback(""); }} placeholder="例：集落で食事と道の話を集める" /></label>
        <div className="trip-plan-date"><label>ゲーム内の帰還日<span>第 <input type="number" min="1" step="1" inputMode="numeric" value={day} onChange={event => { setDay(event.target.value); setFeedback(""); }} /> 日</span></label><label>帰還目安の時刻<input type="time" step="60" value={time} onChange={event => { setTime(event.target.value); setFeedback(""); }} /></label></div>
        {validDate && <TripSupplyBudget game={game} residentIds={draftIds} returnAt={returnAt} />}
        {error && <p className="trip-plan-error">{error}</p>}
        <button className="trip-plan-save" type="submit" disabled={!!error}>{editingId === undefined ? "予定を保存" : "変更を保存"}</button>
      </form>
      {feedback && <p className="travel-feedback" role="status">{feedback}</p>}
      {closed.length > 0 && <details className="trip-plan-closed"><summary>閉じた予定（最近{closed.length}件）</summary><ul>{closed.map(plan => <li key={plan.id}><strong>{plan.purpose}</strong><span>{names(game, plan.residentIds)} · {when(plan.returnAt)} 帰還目安</span><small>{when(plan.closedAt!)}に予定を閉じた</small></li>)}</ul></details>}
    </div>
  </details>;
}
