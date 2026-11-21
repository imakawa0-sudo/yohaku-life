import { useState } from "react";
import {
  Armchair,
  BookOpen,
  Check,
  Footprints,
  House as HomeIcon,
  MapPinned,
  Sprout,
  Store,
  UsersRound,
} from "lucide-react";
import { PeopleEditor } from "./People";
import { Portrait, landscapeArt } from "./PixelArt";
import { isPersona, makePersona, type Persona } from "./peopleModel";
import { WorldEditor } from "./RegionView";
import { defaultWorldConfig, generateWorld, places } from "./world";
import { HouseEditor } from "./HouseEditor";
import { initialHouse, houseValue } from "./house";
import { createGame, setBond, type Bond, type Game } from "./sim";

const presets = [
  {
    name: "木工の二人",
    icon: UsersRound,
    start: "forest",
    art: landscapeArt.home,
    description: "森のそばで、得意も好みも違う二人が工房を開く。",
  },
  {
    name: "川辺の一人旅",
    icon: Footprints,
    start: "landing",
    art: landscapeArt.river,
    description: "渡し場の小さな家から、身ひとつで旅に出る。",
  },
  {
    name: "市場の商人",
    icon: Store,
    start: "village",
    art: landscapeArt.village,
    description: "町に住み、近くの市と遠くの集落を商いで結ぶ。",
  },
];
export function presetPeople(index: number): Persona[] {
  const first = makePersona(0, 822 + index * 107);
  if (index === 0) {
    const other = makePersona(1, 315);
    return [
      {
        ...first,
        name: "カヤ",
        background: "artisan",
        personality: "quiet",
        likes: "cook",
        dislikes: "wood",
        talent: "cook",
        skills: { wood: 7, cook: 1, care: 1, trade: 1 },
      },
      {
        ...other,
        name: "スイ",
        background: "local",
        personality: "curious",
        likes: "wood",
        dislikes: null,
        talent: "wood",
        skills: { wood: 1, cook: 2, care: 1, trade: 1 },
      },
    ];
  }
  return [
    {
      ...first,
      name: index === 1 ? "ハル" : "トワ",
      background: index === 1 ? "local" : "trader",
      likes: index === 1 ? "care" : "trade",
      dislikes: null,
      talent: index === 1 ? "care" : "trade",
      skills:
        index === 1
          ? { wood: 1, cook: 2, trade: 0, care: 3 }
          : { wood: 1, cook: 2, trade: 5, care: 1 },
    },
  ];
}
const bonds: Record<Bond, string> = {
  neutral: "初対面",
  friend: "友人",
  family: "家族",
  lover: "恋人",
  rival: "宿敵",
};
const setupTabs = [
  { text: "人物", Icon: UsersRound },
  { text: "土地", Icon: MapPinned },
  { text: "住まい", Icon: Armchair },
];
export function Setup({
  onBegin,
  onNotebook,
  onCancel,
}: {
  onBegin: (g: Game, name: string) => void;
  onNotebook: () => void;
  onCancel?: () => void;
}) {
  const [preset, setPreset] = useState(0),
    [people, setPeople] = useState(() => presetPeople(0));
  const [config, setConfig] = useState(defaultWorldConfig),
    [start, setStart] = useState(presets[0].start);
  const [house, setHouse] = useState(initialHouse),
    [tab, setTab] = useState(0);
  const [ties, setTies] = useState<Record<string, Bond>>({}),
    [error, setError] = useState("");
  const world = generateWorld(config),
    site = places(world).find((p) => p.id === start) ?? places(world)[0];
  const setupCost = Math.max(0, houseValue(house) - houseValue(initialHouse()));
  function choose(index: number) {
    setPreset(index);
    setPeople(presetPeople(index));
    setStart(presets[index].start);
    setTies({});
    setError("");
  }
  function begin() {
    try {
      if (!people.every(isPersona) || people.some((p) => !p.name.trim()))
        throw new Error("全員に呼び名をつけてください。");
      let game = createGame(people, world, site.id, house);
      if (setupCost > game.wood)
        throw new Error(
          "初期の木材ではこの間取りを建てられません。設備を減らすか、暮らしを始めてから増築してください。",
        );
      game.wood -= setupCost;
      for (let i = 0; i < people.length; i++)
        for (let j = i + 1; j < people.length; j++) {
          const a = people[i].id,
            b = people[j].id;
          game = setBond(game, a, b, ties[a + "|" + b] ?? "friend");
        }
      onBegin(game, people.map((p) => p.name).join("・") + "の暮らし");
    } catch (e) {
      setError(
        e instanceof Error ? e.message : "この朝を始められませんでした。",
      );
    }
  }
  return (
    <main className="rf-setup" id="rf-main">
      <section className="rf-cover">
        <img src={presets[preset].art} alt="" className="rf-cover-art" />
        <div className="rf-cover-caption">
          <span>
            <Sprout size={16} />
            最初の朝
          </span>
          <h1>暮らしを始める</h1>
        </div>
      </section>
      <div className="rf-setup-columns">
        <section className="rf-settings">
          <div className="rf-starts" aria-label="暮らしの出発点">
            {presets.map(({ name, icon: Icon }, i) => (
              <button
                key={name}
                aria-pressed={preset === i}
                onClick={() => choose(i)}
              >
                <Icon size={18} />
                {name}
              </button>
            ))}
          </div>
          <p className="rf-preset-note">{presets[preset].description}</p>
          <div className="rf-setup-tabs" aria-label="開始設定">
            {setupTabs.map(({ text, Icon }, i) => (
              <button
                key={text}
                aria-pressed={tab === i}
                onClick={() => {
                  setTab(i);
                  setError("");
                }}
              >
                <Icon size={16} />
                {text}
              </button>
            ))}
          </div>
          <div className="rf-editor">
            {tab === 0 && (
              <>
                <PeopleEditor people={people} onChange={setPeople} />
                {people.length > 1 && (
                  <details className="rf-ties">
                    <summary>世帯の人間関係</summary>
                    {people.flatMap((a, i) =>
                      people.slice(i + 1).map((b) => (
                        <label key={a.id + "|" + b.id}>
                          {a.name} と {b.name}
                          <select
                            value={ties[a.id + "|" + b.id] ?? "friend"}
                            onChange={(e) =>
                              setTies({
                                ...ties,
                                [a.id + "|" + b.id]: e.target.value as Bond,
                              })
                            }
                          >
                            {Object.entries(bonds).map(([v, n]) => (
                              <option key={v} value={v}>
                                {n}
                              </option>
                            ))}
                          </select>
                        </label>
                      )),
                    )}
                  </details>
                )}
              </>
            )}
            {tab === 1 && (
              <WorldEditor
                config={config}
                onChange={setConfig}
                start={site.id}
                onStart={setStart}
              />
            )}
            {tab === 2 && (
              <>
                <HouseEditor
                  waterMinutes={site.water}
                  house={house}
                  onChange={(h) => {
                    setHouse(h);
                    setError("");
                  }}
                />
                <p className="rf-hint">
                  開始時の追加工事　木材 {setupCost}（使える木材{" "}
                  {createGame(people, world, site.id).wood}）
                </p>
              </>
            )}
          </div>
        </section>
        <aside className="rf-first">
          <div className="rf-portraits">
            {people.map((p) => (
              <Portrait key={p.id} person={p} />
            ))}
          </div>
          <h2>{people.map((p) => p.name || "名付け前").join("・")}の朝</h2>
          <p>
            <HomeIcon size={16} />
            {site.name}から出発
          </p>
          <p>
            <MapPinned size={16} />
            水場まで{site.water}分 · 市場まで{site.market}分
          </p>
          <button className="rf-primary" onClick={begin}>
            <Check size={17} />
            この朝を始める
          </button>
          {onCancel && (
            <button className="rf-text-button" onClick={onCancel}>
              今の暮らしに戻る
            </button>
          )}
          <button className="rf-text-button" onClick={onNotebook}>
            <BookOpen size={16} />
            保存を開く
          </button>
          {error && <p role="alert">{error}</p>}
        </aside>
      </div>
    </main>
  );
}
