import { useEffect, useRef, useState } from "react";
import { MapPin, Route, Users } from "lucide-react";
import { getEncounters, inspectTogetherMove, LOCATIONS } from "../game/engine";
import type { Command, GameState, LocationId } from "../game/types";
import { getTogetherMoveInfo, getTogetherTravelSelection, type TogetherRouteRequest } from "./together-travel";

export function TogetherMoveStatus({ game, residentId, compact = false }: {
  game: GameState; residentId: string; compact?: boolean;
}) {
  const status = getTogetherMoveInfo(game, residentId);
  if (!status) return null;
  return <span className="together-move-status" data-together-status>
    {status.peerName}と同行中 · 残り{status.remaining}分
    {!compact && <small>個別の指示や中断で、同行を解除します。</small>}
  </span>;
}

export function TogetherTravelPanel({ game, selectedIds, scope, openRequest, onOpenHandled, onCommand }: {
  game: GameState;
  selectedIds: string[];
  scope: string;
  openRequest?: TogetherRouteRequest | null;
  onOpenHandled?: () => void;
  onCommand: (command: Command) => boolean;
}) {
  const section = useRef<HTMLElement>(null);
  const matchingRequest = openRequest?.scope === scope ? openRequest : undefined;
  const [draft, setDraft] = useState<{ target: LocationId | ""; via?: LocationId[] }>(() => matchingRequest
    ? { target: matchingRequest.target, ...(matchingRequest.via ? { via: [...matchingRequest.via] } : {}) }
    : { target: "" });
  useEffect(() => {
    if (!openRequest) return;
    if (openRequest.scope === scope) {
      setDraft({ target: openRequest.target, ...(openRequest.via ? { via: [...openRequest.via] } : {}) });
      section.current?.scrollIntoView({ block: "start", behavior: "instant" });
      section.current?.focus({ preventScroll: true });
    }
    onOpenHandled?.();
  }, [openRequest, scope, onOpenHandled]);
  const pair = getTogetherTravelSelection(game, selectedIds);
  if (!pair) return <p className="together-travel-hint">同じ場所の住民2人を選ぶと、一緒に移動できます。</p>;
  const current = getTogetherMoveInfo(game, pair[0].id);
  if (current?.peerId === pair[1].id) return <section ref={section} className="panel together-travel-panel" data-together-travel-panel aria-label="二人で一緒に移動" tabIndex={-1}>
    <div className="section-header"><h3><Users size={17} /> 一緒に移動中</h3></div>
    <p className="together-travel-people" data-together-status>{pair.map(person => person.name).join("・")} · {LOCATIONS[current.target]?.name}まで残り{current.remaining}分</p>
    <p className="travel-note">個別の指示や中断で、同行を解除します。進捗は各人の仕事欄で確認できます。</p>
  </section>;
  const preview = draft.target ? inspectTogetherMove(game, selectedIds, draft.target, draft.via) : undefined;
  const error = !draft.target ? "行き先を選んでください。" : preview?.error;
  const points = preview?.origin && preview.path ? [preview.origin, ...preview.path] : [];
  const hazards = getEncounters(game).filter(encounter => encounter.present && points.includes(encounter.location));
  return <section ref={section} className="panel together-travel-panel" data-together-travel-panel aria-label="二人で一緒に移動" tabIndex={-1}>
    <div className="section-header"><h3><Users size={17} /> 一緒に移動</h3></div>
    <p className="together-travel-people">指示対象：{pair.map(person => person.name).join("・")} · {LOCATIONS[pair[0].location].name}から</p>
    <label className="together-travel-destination"><span>行き先</span><select aria-label="同行する二人の行き先" value={draft.target}
      onChange={event => setDraft({ target: event.target.value as LocationId | "" })}>
      <option value="">行き先を選択</option>
      {(Object.keys(LOCATIONS) as LocationId[]).map(id => <option key={id} value={id} disabled={id === pair[0].location}>{LOCATIONS[id].name}</option>)}
    </select></label>
    {draft.via && <p className="together-route-draft" data-together-route-draft>日帰りの道順を指定しています。</p>}
    {preview && !preview.error && <div className="together-travel-preview" aria-live="polite">
      <p>各自なら：{preview.residents.map(person => `${person.name}${person.individualMinutes}分`).join("／")}</p>
      <p><strong>同行は{preview.minutes}分</strong> · 各区間を遅い人に合わせ、途中も一緒。</p>
      <details><summary><Route size={14} /> 道順を見る</summary><p>{points.map(id => LOCATIONS[id].name).join(" · ")}</p></details>
      {hazards.length > 0 && <p className="together-travel-warning" data-together-danger><MapPin size={14} />
        {hazards.map(encounter => `${LOCATIONS[encounter.location].name}に${encounter.name}`).join("・")}。遭遇に注意。到着後の攻防は別に指示します。
      </p>}
    </div>}
    {error && <p className="together-travel-error" data-together-error>{error}</p>}
    <button type="button" className="primary-button together-travel-start" data-move-together disabled={!!error || !preview}
      onClick={() => {
        if (draft.target && !error && onCommand({ type: "move-together", residentIds: [...selectedIds], target: draft.target,
          ...(draft.via ? { via: [...draft.via] } : {}) })) setDraft({ target: "" });
      }}>2人で{draft.target ? LOCATIONS[draft.target].name : "移動先"}へ出発</button>
    <p className="together-travel-note">地図と通常の行き先は、各自の速さで移動します。</p>
  </section>;
}
