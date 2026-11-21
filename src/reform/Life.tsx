import { useState } from "react";
import {
  Backpack,
  BookOpen,
  ChevronDown,
  Clock3,
  Coins,
  Footprints,
  Heart,
  MapPin,
  Moon,
  SlidersHorizontal,
  Sparkles,
  Sprout,
  Sun,
  Sunrise,
  Trees,
  Users,
  Utensils,
  Wheat,
} from "lucide-react";
import type { ReactNode } from "react";
import { PixelScene, Portrait, settingFor } from "./PixelArt";
import {
  backgroundNames,
  bodyNames,
  personalityNames,
  skillKeys,
  skillNames,
} from "./peopleModel";
import type { Skill } from "./peopleModel";
import { roomName } from "./house";
import type { Need } from "./house";
import { places } from "./world";
import {
  advance,
  bondNames,
  options,
  order,
  personThreshold,
  setPriority,
  setStock,
  skillThreshold,
  specialize,
} from "./sim";
import type { Actor, Game } from "./sim";
import "./life.css";

const needNames: Record<Need, string> = {
  hunger: "満腹",
  bladder: "膀胱の余裕",
  hygiene: "清潔",
  energy: "体力",
  social: "社交",
  fun: "楽しさ",
};
const needKeys = Object.keys(needNames) as Need[];
const stockNames = {
  food: "食事",
  ingredients: "食材",
  wood: "木材",
  coins: "銀貨",
};
const groupNames = {
  need: "生活",
  work: "仕事",
  relation: "交流",
  field: "野外",
};
type ActionGroup = keyof typeof groupNames;

function timeOfDay(time: number) {
  const hour = Math.floor((time % 1440) / 60);
  const minute = Math.floor(time % 60);
  return String(hour).padStart(2, "0") + ":" + String(minute).padStart(2, "0");
}
function span(minutes: number) {
  const mins = Math.max(0, Math.ceil(minutes));
  if (mins < 60) return mins + "分";
  return Math.floor(mins / 60) + "時間" + (mins % 60 ? (mins % 60) + "分" : "");
}
function bound(value: number) {
  return Math.min(100, Math.max(0, Math.round(value)));
}
function signed(value: number) {
  return value > 0 ? "+" + value : String(value);
}
function moodLabel(value: number) {
  if (value < 25) return "つらい";
  if (value < 45) return "沈みがち";
  if (value >= 70) return "晴れやか";
  return "落ち着いている";
}

function Fold({
  title,
  icon,
  children,
}: {
  title: string;
  icon: ReactNode;
  children: ReactNode;
}) {
  return (
    <details className="lf-fold">
      <summary>
        {icon}
        <span>{title}</span>
        <ChevronDown size={16} className="lf-fold-arrow" />
      </summary>
      <div className="lf-fold-body">{children}</div>
    </details>
  );
}

function StockForm({
  game,
  onGame,
}: {
  game: Game;
  onGame: (g: Game) => void;
}) {
  const [low, setLow] = useState(String(game.foodTarget.low));
  const [high, setHigh] = useState(String(game.foodTarget.high));
  const lowNumber = Number(low),
    highNumber = Number(high);
  const valid =
    low.trim() !== "" &&
    high.trim() !== "" &&
    Number.isInteger(lowNumber) &&
    Number.isInteger(highNumber) &&
    lowNumber >= 0 &&
    highNumber > lowNumber &&
    highNumber <= 50;
  const changed =
    game.foodTarget.low !== lowNumber || game.foodTarget.high !== highNumber;
  return (
    <form
      className="lf-stock"
      onSubmit={(e) => {
        e.preventDefault();
        if (valid && changed) onGame(setStock(game, lowNumber, highNumber));
      }}
    >
      <div className="lf-stock-fields">
        <label>
          補充を始める食数
          <input
            type="number"
            min="0"
            max="49"
            step="1"
            value={low}
            onChange={(e) => setLow(e.target.value)}
          />
        </label>
        <label>
          目標の食数
          <input
            type="number"
            max="50"
            min={Number.isFinite(lowNumber) ? lowNumber + 1 : 1}
            step="1"
            value={high}
            onChange={(e) => setHigh(e.target.value)}
          />
        </label>
      </div>
      <button
        className="lf-soft-button"
        type="submit"
        disabled={!valid || !changed}
      >
        備蓄目標を更新
      </button>
      {!valid && (
        <p className="lf-feedback" role="status">
          補充を始める食数に0以上の整数、目標にはそれより多い50食までの整数を入力してください。
        </p>
      )}
    </form>
  );
}

function ActionPanel({
  game,
  actor,
  onGame,
}: {
  game: Game;
  actor: Actor;
  onGame: (g: Game) => void;
}) {
  const [group, setGroup] = useState<ActionGroup>("need");
  const commands = options(game, actor.person.id);
  const selected = commands.filter((command) => command.group === group);
  const cancel = commands.find((command) => command.kind === "cancel");
  return (
    <section className="lf-panel lf-orders" aria-label="行動の指示">
      <div className="lf-section-title">
        <Footprints size={20} />
        <h3>行動の指示</h3>
      </div>
      <div className="lf-segment" role="group" aria-label="行動の種類">
        {(Object.keys(groupNames) as ActionGroup[]).map((key) => (
          <button
            key={key}
            type="button"
            aria-pressed={key === group}
            onClick={() => setGroup(key)}
          >
            {groupNames[key]}
          </button>
        ))}
      </div>
      <div className="lf-command-list">
        {selected.map((command) => {
          const hintId =
            "lf-order-" + command.kind + "-" + (command.target ?? "");
          const materials = Object.entries(command.reserved ?? {})
            .filter(([, count]) => count > 0)
            .map(
              ([resource, count]) =>
                stockNames[resource as keyof typeof stockNames] + count,
            );
          const preview =
            command.disabled ||
            [command.minutes ? span(command.minutes) : "", ...materials]
              .filter(Boolean)
              .join(" · ");
          return (
            <div className="lf-command" key={hintId}>
              <button
                type="button"
                data-kind={command.kind}
                data-target={command.target}
                disabled={!!command.disabled}
                aria-describedby={preview ? hintId : undefined}
                onClick={() =>
                  onGame(
                    order(game, actor.person.id, command.kind, command.target),
                  )
                }
              >
                {command.label}
              </button>
              {preview && <small id={hintId}>{preview}</small>}
            </div>
          );
        })}
        {!selected.length && (
          <p className="lf-note">
            {group === "relation"
              ? "同じ場所に交流できる住民がいると、ここで相手を選べます。"
              : group === "field"
                ? "この場所でできる野外行動はありません。地域の画面から行き先を選べます。"
                : "今、選べる行動はありません。"}
          </p>
        )}
      </div>
      {cancel && (
        <button
          className="lf-cancel"
          type="button"
          data-kind="cancel"
          disabled={!!cancel.disabled}
          onClick={() =>
            onGame(order(game, actor.person.id, cancel.kind, cancel.target))
          }
        >
          {cancel.label}
        </button>
      )}
    </section>
  );
}

export function Life({
  game,
  selected,
  onSelect,
  onGame,
}: {
  game: Game;
  selected: string;
  onSelect: (id: string) => void;
  onGame: (g: Game) => void;
}) {
  const actor =
    game.actors.find((a) => a.person.id === selected) ?? game.actors[0];
  if (!actor) return <p>暮らしを始める住民を作成してください。</p>;
  const person = actor.person;
  const day = Math.floor(game.time / 1440) + 1;
  const hour = Math.floor((game.time % 1440) / 60);
  const DayIcon = hour < 5 || hour >= 19 ? Moon : hour < 10 ? Sunrise : Sun;
  const period =
    hour < 5 || hour >= 19
      ? "夜"
      : hour < 10
        ? "朝"
        : hour < 16
          ? "昼"
          : "夕暮れ";
  const untilMorning = (480 - (game.time % 1440) + 1440) % 1440 || 1440;
  const tasks = game.actors.flatMap((a) =>
    a.task && a.task.remaining > 0 ? [a.task.remaining] : [],
  );
  const next = tasks.length ? Math.min(...tasks) : 0;
  const locations = places(game.world);
  const place = locations.find((place) => place.id === actor.location);
  const region = place?.name ?? actor.location;
  const frostNote = place
    ? day < place.frost
      ? `初霜まで${place.frost - day}日`
      : day === place.frost
        ? "初霜の日"
        : `初霜から${day - place.frost}日`
    : null;
  const atHome = actor.location === game.home;
  const setting = settingFor(place, atHome, actor.room);
  const company = game.actors
    .filter(
      (a) =>
        a.person.id !== person.id &&
        a.location === actor.location &&
        (!atHome || a.room === actor.room),
    )
    .map((a) => a.person);
  const localName =
    actor.location === game.home
      ? region + "の家 · " + roomName(game.house, actor.room)
      : region;
  const peers = game.actors.filter((a) => a.person.id !== person.id);
  const memories = actor.memories.filter((memory) => memory.until > game.time);
  const changeTime = (minutes: number) => onGame(advance(game, minutes));

  return (
    <div className="lf-page">
      <div className="lf-columns">
        <aside className="lf-roster-panel" aria-label="世帯の住民">
          <div className="lf-roster-heading">
            <h2>暮らす人</h2>
            <span>{game.actors.length}人</span>
          </div>
          <div className="lf-roster" role="group" aria-label="住民を選ぶ">
            {game.actors.map((a) => {
              const location =
                a.location === game.home
                  ? roomName(game.house, a.room)
                  : (locations.find((item) => item.id === a.location)?.name ??
                    a.location);
              const activity =
                a.task?.label ??
                (a.danger ? "道の人影と対峙している" : "手が空いている");
              return (
                <button
                  key={a.person.id}
                  type="button"
                  aria-label={a.person.name}
                  aria-pressed={person.id === a.person.id}
                  aria-describedby={
                    "lf-roster-place-" +
                    a.person.id +
                    " lf-roster-task-" +
                    a.person.id
                  }
                  onClick={() => onSelect(a.person.id)}
                >
                  <span className="lf-roster-portrait" aria-hidden="true">
                    <Portrait person={a.person} />
                  </span>
                  <span className="lf-roster-info">
                    <strong>{a.person.name}</strong>
                    <span
                      className="lf-roster-place"
                      id={"lf-roster-place-" + a.person.id}
                      title={location}
                    >
                      <MapPin size={12} aria-hidden="true" />
                      <span>{location}</span>
                    </span>
                  </span>
                  <span
                    className={
                      "lf-roster-activity" + (a.danger ? " lf-injury" : "")
                    }
                    id={"lf-roster-task-" + a.person.id}
                    title={activity}
                  >
                    {activity}
                  </span>
                </button>
              );
            })}
          </div>
        </aside>
        <div className="lf-main-column">
          <article
            className={"lf-person" + (actor.danger ? " lf-person-danger" : "")}
            aria-label={person.name + "の近況"}
          >
            <div className="lf-portrait">
              <PixelScene
                person={person}
                company={company}
                setting={setting}
                minutes={game.time}
              />
            </div>
            <div className="lf-person-copy">
              <div className="lf-person-heading">
                <div className="lf-name">
                  <h2>{person.name}</h2>
                  <span>Lv. {actor.level}</span>
                </div>
                <div className="lf-place">
                  <MapPin size={15} aria-hidden="true" />
                  <span>{localName}</span>
                </div>
              </div>
              <div className="lf-mood">
                <Heart size={15} />
                <span>
                  気分 {moodLabel(actor.mood)} · {bound(actor.mood)}
                </span>
                {actor.injury > 0 && (
                  <span className="lf-injury">
                    負傷 {Math.ceil(actor.injury)}
                  </span>
                )}
              </div>
              <div className="lf-task">
                <div className="lf-task-label">
                  <strong>
                    {actor.task?.label ??
                      (actor.danger
                        ? "道の人影と対峙している"
                        : "手が空いている")}
                  </strong>
                  {actor.task && (
                    <small>
                      {actor.task.mode === "direct" ? "直接指示" : "自主行動"}
                    </small>
                  )}
                </div>
                {actor.danger && !actor.task ? (
                  <p className="lf-injury">
                    「野外」で交渉・応戦・撤退を選べます。
                  </p>
                ) : (
                  <p>{actor.reason}</p>
                )}
                {actor.task && (
                  <div className="lf-task-progress">
                    <progress
                      value={Math.max(
                        0,
                        actor.task.total - actor.task.remaining,
                      )}
                      max={Math.max(1, actor.task.total)}
                      aria-label="行動の進み具合"
                    />
                    <span>あと{span(actor.task.remaining)}</span>
                  </div>
                )}
              </div>
            </div>
          </article>

          <section className="lf-panel lf-supplies" aria-label="世帯の備蓄">
            <div className="lf-section-title">
              <Backpack size={19} />
              <h3>世帯の備蓄</h3>
            </div>
            <div className="lf-resources">
              <span>
                <Utensils size={15} />
                食事 <b>{game.food}</b>食
              </span>
              <span>
                <Wheat size={15} />
                食材 <b>{game.ingredients}</b>
              </span>
              <span>
                <Trees size={15} />
                木材 <b>{game.wood}</b>
              </span>
              <span>
                <Coins size={15} />
                銀貨 <b>{game.coins}</b>
              </span>
            </div>
            {(actor.location !== game.home ||
              Object.values(actor.cargo).some((amount) => amount > 0)) && (
              <p className="lf-cargo">
                {person.name}の携行品 · 食事 {actor.cargo.food}／食材{" "}
                {actor.cargo.ingredients}／木材 {actor.cargo.wood}／銀貨{" "}
                {actor.cargo.coins}
              </p>
            )}
            {game.insulated && (
              <p className="lf-cargo">
                断熱雨戸を設置済み。霜が降りた日も家の中では冷えを防げます。
              </p>
            )}
          </section>

          <ActionPanel
            key={person.id}
            game={game}
            actor={actor}
            onGame={onGame}
          />
          {game.time === 480 && !tasks.length && (
            <p className="lf-clock-hint">
              時計を進めると住民が自分で動きます。先に「行動の指示」で予定を決めることもできます。
            </p>
          )}
        </div>
        <aside
          className="lf-side"
          aria-label={person.name + "の状態と詳しい情報"}
        >
          <section className="lf-panel" aria-label="生活の欲求">
            <div className="lf-section-title">
              <Sprout size={20} />
              <h3>生活の欲求</h3>
            </div>
            <div className="lf-needs">
              {needKeys.map((key) => {
                const value = bound(actor.needs[key]);
                return (
                  <div
                    key={key}
                    className={"lf-need" + (value < 30 ? " lf-low" : "")}
                  >
                    <div>
                      <label htmlFor={"lf-need-" + key}>{needNames[key]}</label>
                      <span>{value}</span>
                    </div>
                    <progress id={"lf-need-" + key} value={value} max={100} />
                  </div>
                );
              })}
            </div>
          </section>

          <Fold title="技能と専門" icon={<Sparkles size={18} />}>
            <p className="lf-note">
              {backgroundNames[person.background]}の出身。
              {personalityNames[person.personality]}。体質は
              {bodyNames[person.body]}。
            </p>
            <p className="lf-note">
              好きな仕事は{skillNames[person.likes]}。
              {person.dislikes
                ? "苦手意識があるのは" + skillNames[person.dislikes] + "。"
                : ""}
              伸びやすい技能は{skillNames[person.talent]}。
            </p>
            <p className="lf-note">
              人物レベル {actor.level} · 次のレベルまで経験{" "}
              {Math.max(
                0,
                Math.ceil(personThreshold(actor.level) - actor.experience),
              )}
            </p>
            <div className="lf-skills">
              {skillKeys.map((skill) => {
                const level = person.skills[skill];
                const max = skillThreshold(level);
                return (
                  <div key={skill}>
                    <div className="lf-row">
                      <strong>{skillNames[skill]}</strong>
                      <span>Lv. {level}</span>
                    </div>
                    <progress
                      value={level >= 10 ? 1 : Math.max(0, actor.xp[skill])}
                      max={level >= 10 ? 1 : max}
                      aria-label={skillNames[skill] + "の経験値"}
                    />
                    <small>
                      {level >= 10
                        ? "習熟上限"
                        : "経験 " + Math.floor(actor.xp[skill]) + " / " + max}
                    </small>
                  </div>
                );
              })}
            </div>
            {actor.specialty ? (
              <p className="lf-note">専門 · {skillNames[actor.specialty]}</p>
            ) : actor.level >= 2 ? (
              <div>
                <p className="lf-subtitle">専門を選ぶ</p>
                <div className="lf-pills">
                  {skillKeys.map((s) => (
                    <button
                      type="button"
                      key={s}
                      onClick={() => onGame(specialize(game, person.id, s))}
                    >
                      {skillNames[s]}を専門に
                    </button>
                  ))}
                </div>
              </div>
            ) : (
              <p className="lf-note">人物レベル2で専門を選べます。</p>
            )}
          </Fold>
          <Fold title="人間関係と記憶" icon={<Users size={18} />}>
            {peers.length ? (
              peers.map((peer) => {
                const bond = actor.relations[peer.person.id];
                return (
                  <div className="lf-bond" key={peer.person.id}>
                    <div className="lf-row">
                      <strong>{peer.person.name}</strong>
                      <span>{bondNames[bond?.kind ?? "neutral"]}</span>
                    </div>
                    <small>
                      {person.name}からの信頼 {signed(bond?.trust ?? 0)} · 好意{" "}
                      {signed(bond?.affection ?? 0)}
                    </small>
                  </div>
                );
              })
            ) : (
              <p className="lf-note">
                この世帯で暮らすのは{person.name}ひとりです。
              </p>
            )}
            <h4 className="lf-subtitle">今の気分に残る記憶</h4>
            {memories.length ? (
              memories
                .slice()
                .reverse()
                .map((m, i) => (
                  <p className="lf-memory" key={i}>
                    <span>{m.label}</span>
                    <span>
                      {signed(m.value)} · あと{span(m.until - game.time)}
                    </span>
                  </p>
                ))
            ) : (
              <p className="lf-note">
                今、気分に影響している記憶はありません。
              </p>
            )}
          </Fold>
          <Fold title="仕事と備蓄の方針" icon={<SlidersHorizontal size={18} />}>
            <label className="lf-policy">
              {person.name}が優先する仕事
              <select
                value={actor.priority ?? ""}
                onChange={(e) =>
                  onGame(
                    setPriority(
                      game,
                      person.id,
                      (e.target.value || null) as Skill | null,
                    ),
                  )
                }
              >
                <option value="">本人に任せる</option>
                {skillKeys.map((s) => (
                  <option key={s} value={s}>
                    {skillNames[s]}
                  </option>
                ))}
              </select>
            </label>
            <h4 className="lf-subtitle">世帯の食事</h4>
            <StockForm
              key={game.foodTarget.low + "/" + game.foodTarget.high}
              game={game}
              onGame={onGame}
            />
          </Fold>
          <Fold title="時間の使い方" icon={<Clock3 size={18} />}>
            <p className="lf-note">暮らしを始めてからの累計</p>
            <dl className="lf-metrics">
              {(
                [
                  ["自由時間", actor.metrics.free],
                  ["仕事", actor.metrics.work],
                  ["身の回りのこと", actor.metrics.care],
                  ["移動", actor.metrics.travel],
                  ["待機", actor.metrics.waiting],
                ] as const
              ).map(([label, value]) => (
                <div key={label}>
                  <dt>{label}</dt>
                  <dd>{span(value)}</dd>
                </div>
              ))}
            </dl>
          </Fold>
        </aside>
        <div className="lf-diary">
          <p className="lf-latest" role="status">
            {game.log[0]}
          </p>
          <Fold title="暮らしの日誌" icon={<BookOpen size={19} />}>
            <ol className="lf-journal">
              {game.log.map((line, i) => (
                <li key={i}>{line}</li>
              ))}
            </ol>
          </Fold>
        </div>
      </div>
      <section className="lf-clock" aria-label="時計">
        <div className="lf-clock-inner">
          <div className="lf-clock-face">
            <strong aria-label={"現在時刻 " + timeOfDay(game.time)}>
              {timeOfDay(game.time)}
            </strong>
          </div>
          <div className="lf-clock-details">
            <div className="lf-day">
              <DayIcon size={17} strokeWidth={1.5} aria-hidden="true" />
              <span>
                {day}日目 · {period}
              </span>
            </div>
            {frostNote && (
              <span
                className="lf-day-note"
                aria-label={region + "：" + frostNote}
                title={region + "の初霜は" + place!.frost + "日目"}
              >
                {frostNote}
              </span>
            )}
          </div>
          <div className="lf-clock-actions">
            <button
              type="button"
              aria-label="5分進める"
              onClick={() => changeTime(5)}
            >
              5分
            </button>
            <button
              type="button"
              aria-label="15分進める"
              onClick={() => changeTime(15)}
            >
              15分
            </button>
            <button
              type="button"
              aria-label="1時間進める"
              onClick={() => changeTime(60)}
            >
              1時間
            </button>
            <button
              type="button"
              className="lf-next-time"
              aria-label="次の行動完了まで進める"
              disabled={!next}
              onClick={() => changeTime(next)}
            >
              次の完了
            </button>
            <button
              type="button"
              aria-label="翌朝まで進める"
              onClick={() => changeTime(untilMorning)}
            >
              朝まで
            </button>
          </div>
        </div>
      </section>
    </div>
  );
}
