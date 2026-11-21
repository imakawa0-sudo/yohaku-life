import { useId } from "react";
import {
  availableResources,
  getCraftTitle,
  getMerchantStatus,
  LOCATIONS,
  isGuardPresentAt,
  getPresentEncounterAt,
  getLocalEncounter,
  SECOND_ENCOUNTER_RULE,
} from "../game/engine";
import type {
  CraftPiece,
  GameState,
  LocationId,
  Resident,
} from "../game/types";
import { formatVitalValue } from "../game/presentation";
import { getCraftDisplayTitle } from "../game/art-subject";
import { regionHarvestAvailable, regionNPCsAt } from "../game/region";

type Period = "morning" | "day" | "evening" | "night";
export type LandscapeProps = {
  game: GameState;
  resident: Resident;
  compact?: boolean;
  /** A fixed view of the base can show home while the selected resident is away. */
  location?: LocationId;
};
export type LandscapeDescription = {
  period: Period;
  periodLabel: string;
  locationLabel: string;
  caption: string;
  description: string;
};

/** Placed work stays in its room; unfinished display work travels with its author. */
function furnishingAt(game: GameState, location: LocationId) {
  const shelf = game.life?.shelf;
  const crafts = game.life?.crafts ?? [];
  const displayed = crafts.filter(
    (piece) => piece.displayLocation === location,
  );
  const carried = crafts.filter(
    (piece) =>
      piece.displayedAt === undefined &&
      game.residents.some(
        (person) =>
          person.id === piece.authorId && person.location === location,
      ),
  );
  return {
    shelfHere: shelf?.location === location,
    displayed,
    carried,
    legacyShelf: !shelf && game.flags.decorated,
    legacyCraft: !crafts.length && game.flags.hobbyFinished,
    upgrades: (game.life?.upgrades ?? []).filter(
      (item) => item.location === location,
    ),
  };
}

/** Every visible change is derived from saved facts, without advancing the world. */
export function describeLandscape(
  game: GameState,
  resident: Resident,
  location: LocationId = resident.location,
): LandscapeDescription {
  const hour = Math.floor((game.minutes % 1440) / 60);
  const period: Period =
    hour < 5 || hour >= 19
      ? "night"
      : hour < 10
        ? "morning"
        : hour < 16
          ? "day"
          : "evening";
  const periodLabel = {
    morning: "朝の光",
    day: "昼の光",
    evening: "夕暮れ",
    night: "夜の灯り",
  }[period];
  const base = LOCATIONS[location].kind === "base";
  const colocated = game.residents.filter(
    (person) => person.location === location,
  );
  const cooking = game.residents.filter(
    (person) => person.hp > 0 && person.action?.kind === "cook" && LOCATIONS[person.location].kind === "base",
  );
  const facts: { description: string; caption: string }[] = [];
  const addFact = (description: string, caption: string = description) => {
    facts.push({ description, caption });
  };
  if (base) {
    const furnishing = furnishingAt(game, location);
    if (location === "home" && getMerchantStatus(game).status === "open")
      addFact("行商の荷車が居間の入口に停まっている（16:00まで）");
    if (cooking.length)
      addFact(
        cooking
          .map((person) =>
            person.location === location
              ? `${person.name}が料理中`
              : `${person.name}が${LOCATIONS[person.location].name}で料理中`,
          )
          .join("・"),
      );
    if (furnishing.shelfHere) addFact("窓辺に手作りの棚");
    if (furnishing.legacyShelf) addFact("以前の棚あり（置き場所は未記録）");
    if (furnishing.displayed.length) {
      const works = [
        ...new Set(
          furnishing.displayed.map(
            (piece) =>
              `${game.residents.find((person) => person.id === piece.authorId)?.name ?? "住民"}の${getCraftTitle(piece)}`,
          ),
        ),
      ];
      addFact(`${works.join("・")}を棚に展示`);
    }
    if (furnishing.carried.length) {
      const works = [
        ...new Set(
          furnishing.carried.map(
            (piece) =>
              `${game.residents.find((person) => person.id === piece.authorId)?.name ?? "住民"}の${getCraftTitle(piece)}`,
          ),
        ),
      ];
      addFact(`${works.join("・")}が完成（まだ手元にある）`);
    }
    for (const item of furnishing.upgrades) {
      const author =
        game.residents.find((person) => person.id === item.creatorId)?.name ??
        "住民";
      if (item.recipeId === "kitchen-tools")
        addFact(`${author}が整えた料理道具で、この部屋の調理が早くなる`);
      else if (item.recipeId === "rest-corner")
        addFact(`${author}が整えた静かな休憩場所で、この部屋の休息が充実する`);
      else if (item.recipeId === "crafting-tools")
        addFact(
          `${author}が整えた手仕事台があり、この場所で新しく始める小鳥・花・設備制作が早くなる`,
          "手仕事台あり",
        );
    }
    if (furnishing.legacyCraft)
      addFact("以前の木彫りあり（作者と置き場所は未記録）");
    const free = availableResources(game);
    addFact(`倉庫の未予約：食事${free.food}食・食材${free.ingredients}個`);
    addFact(`倉庫の未予約：手当用品${free.medicine}個・回収材${free.scrap}個`);
  } else if (location === "ruins") {
    addFact(
      game.guardAgreement
        ? "守り手は食事を受け取り立ち去った"
        : game.enemy.defeated
        ? "流れ者は退いた"
        : game.enemy.location === location
          ? "流れ者が物資を守っている"
          : "この場所に流れ者の姿はない",
    );
    addFact(
      game.flags.suppliesRecovered ? "物資は回収済み" : "回収できる物資が残る",
    );
  } else if (location === "shelter") {
    addFact(
      game.flags.safeSuppliesRecovered
        ? "脇道の物資は回収済み"
        : "争わず回収できる物資が残る",
    );
  } else if (location === "village") {
    const works = furnishingAt(game, location).displayed;
    if (works.length) {
      const titles = works.map((piece) => getCraftDisplayTitle(game, piece));
      addFact(`商い手の店先に「${titles.join("」「")}」が飾られている`, `店先に木彫りが${works.length}点`);
    }
    const neighbours = regionNPCsAt(game, location);
    addFact(neighbours.length
      ? `窓口にいる人：${neighbours.map((person) => person.name).join("・")}`
      : "取引と道の話の窓口は08:00〜18:00");
    addFact("川沿いと尾根の道が合流し、上流の葦原へ続く");
  } else if (location === "meadow") {
    addFact(regionHarvestAvailable(game)
      ? "今日の採集分が残る川沿いの草地"
      : "今日の採集はひと区切り");
    addFact("川沿いの道は集落と草の道へ続く");
  } else if (location === "reedbank") {
    addFact(regionHarvestAvailable(game, "reedbank") ? "浅瀬に食べられる草と流木が残る" : "今日の採集はひと区切り");
    addFact("岸の小道は舟宿の桟橋へ続く");
  } else if (location === "lodge") {
    const workbench = game.life?.upgrades?.find(item => item.location === "lodge" && item.recipeId === "crafting-tools");
    if (workbench) {
      const maker = game.residents.find(person => person.id === workbench.creatorId)?.name ?? "住民";
      addFact(`${maker}が整えた手仕事台で、舟宿で新しく始める木彫りが早くなる`, "手仕事台あり");
    }
    addFact("桟橋の上の工房に、鍋と作業台と寝床");
    const stores = game.inventory?.ground.lodge;
    if (stores && Object.values(stores).some(amount => amount > 0))
      addFact(`舟宿の物置：食事${stores.food}食・食材${stores.ingredients}個・手当用品${stores.medicine}個・資材${stores.scrap}個`);
    else addFact("舟宿の物置は空");
  } else if (location === "ridge") {
    addFact("集落と資材置き場をつなぐ尾根の近道");
    const local = getLocalEncounter(game, location);
    if (local?.id === SECOND_ENCOUNTER_RULE.id)
      addFact(local.present ? "尾根の見張りが行く手にいる" : "尾根の見張りは退いた");
    if (isGuardPresentAt(game, "ruins"))
      addFact("経路の資材置き場には流れ者がいる");
  } else {
    addFact("資材置き場と木陰の迂回路へ続く道");
  }
  if (
    !base &&
    location !== "ruins" &&
    isGuardPresentAt(game, location)
  )
    addFact("この場所に流れ者がいる");
  const selectedHere = resident.location === location;
  const injured =
    selectedHere && Object.values(resident.wounds).some((value) => value > 0);
  const status = selectedHere
    ? resident.hp <= 0
      ? `${resident.name}は意識を失っている`
      : resident.action
        ? `${resident.name}：${resident.action.label}`
        : injured
          ? `${resident.name}は負傷中`
          : resident.hp < 100
            ? `${resident.name}は体力低下`
            : ""
    : "";
  const priorities = [status, ...facts.map((fact) => fact.caption)].filter(Boolean);
  return {
    period,
    periodLabel,
    locationLabel: LOCATIONS[location].name,
    caption: [periodLabel, ...priorities.slice(0, 1)].join(" · "),
    description: [
      `${periodLabel}の${LOCATIONS[location].name}。`,
      ...facts.map((fact) => `${fact.description}。`),
      colocated.length
        ? `ここにいる住民：${colocated.map((person) => person.name).join("・")}。`
        : "現在、この場所に住民はいない。",
      ...colocated.map(
        (person) =>
          `${person.name}の体力${formatVitalValue(person.hp)}、${person.hp <= 0 ? "意識なし" : (person.action?.label ?? "待機中")}${Object.values(person.wounds).some((value) => value > 0) ? "、傷が残っている" : ""}。`,
      ),
    ].join(""),
  };
}

type InkProps = {
  ink: string;
  paper: string;
  foliage: string;
  accent: string;
  hatch: string;
  glow: string;
};
function Bird({ x, y, ink }: { x: number; y: number; ink: string }) {
  return (
    <g
      transform={`translate(${x} ${y})`}
      stroke={ink}
      strokeWidth="1.1"
      fill="#d4bc91"
    >
      <path d="M0 0Q-3-5 2-7Q7-9 10-4L15-3L10 0Q8 5 1 3L-5 0Z" />
      <path d="M4-2L7 0M3 4V7M7 4V7" />
      <circle cx="9" cy="-5" r=".6" fill={ink} />
    </g>
  );
}
function Carving({
  design,
  x,
  y,
  ink,
}: {
  design?: CraftPiece["design"];
  x: number;
  y: number;
  ink: string;
}) {
  if (design !== "flower") return <Bird x={x} y={y} ink={ink} />;
  return (
    <g
      transform={`translate(${x} ${y})`}
      stroke={ink}
      strokeWidth="1"
      fill="#d4bc91"
      data-detail="flower-carving"
    >
      <path d="M3 3V-7M3 0Q-5-5-6 0L3 3M3 1Q11-4 12 0L3 4" />
      <path d="M3-8Q-5-7-3-13Q-1-17 3-12Q4-20 8-17Q12-15 8-11Q16-11 13-6Q11-3 6-7Q5 0 1-3Q-2-4 3-8Z" />
      <circle cx="5" cy="-9" r="2" fill="#ede1bb" />
      <path d="M-3 5H11L13 8H-5Z" />
    </g>
  );
}
function Shelf({
  decorated,
  displayed = [],
  carried = [],
  ink,
}: {
  decorated: boolean;
  displayed?: CraftPiece[];
  carried?: CraftPiece[];
  ink: string;
}) {
  return (
    <g stroke={ink} strokeWidth="1" strokeLinejoin="round">
      {decorated && (
        <>
          <path d="M0 0H48V4H0ZM6 4V10M41 4V10" fill="#b8b99d" />
          <path d="M6-1L5-10H15L14-1Z" fill="#c5bea4" />
          <path
            d="M10-11V-20M10-15Q0-22 2-13L10-11M10-17Q20-24 18-15L10-13"
            fill="#a3b38b"
          />
        </>
      )}
      {displayed.slice(0, 2).map((piece, index) => (
        <Carving
          key={piece.id}
          design={piece.design}
          x={23 + index * 17}
          y={-6}
          ink={ink}
        />
      ))}
      {carried.slice(0, 2).map((piece, index) => (
        <Carving
          key={piece.id}
          design={piece.design}
          x={(decorated ? 65 : 20) + index * 20}
          y={9}
          ink={ink}
        />
      ))}
    </g>
  );
}
function Store({
  food,
  ingredients,
  ink,
  paper,
}: {
  food: number;
  ingredients: number;
  ink: string;
  paper: string;
}) {
  return (
    <g stroke={ink} strokeWidth="1" strokeLinejoin="round">
      <path d="M0 0H62V4H0ZM5 4V33M57 4V33M4 22H58" fill={paper} />
      {Array.from({ length: Math.min(5, Math.ceil(food / 2)) }, (_, i) => (
        <g key={`food${i}`} transform={`translate(${7 + i * 10} -2)`}>
          <path d="M0 0L-2-7H8L6 0Z" fill="#d8c6a4" />
          <path d="M0-5H6" />
        </g>
      ))}
      {Array.from(
        { length: Math.min(4, Math.ceil(ingredients / 3)) },
        (_, i) => (
          <g key={`ingredient${i}`} transform={`translate(${9 + i * 13} 21)`}>
            <path d="M-4 0L-5-10Q0-14 5-10L4 0Z" fill="#bdc6a8" />
            <path d="M0-12V-17M-1-12L-5-16M1-12L5-17" />
          </g>
        ),
      )}
    </g>
  );
}
function Stove({
  cooking,
  ink,
  paper,
  glow,
}: {
  cooking: boolean;
  ink: string;
  paper: string;
  glow: string;
}) {
  return (
    <g
      stroke={ink}
      strokeWidth="1.2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M0 0H51V37H0ZM-3-3H54V0H-3Z" fill={paper} />
      <path d="M8 13H42V31H8Z" fill={cooking ? glow : "#c0c3ae"} />
      {cooking && (
        <>
          <path
            d="M17 28Q10 20 19 16Q17 23 25 21Q29 13 31 18Q38 24 31 28Z"
            fill="#c79d68"
            strokeWidth=".8"
          />
          <path
            d="M16-21Q11-27 17-34M27-22Q20-30 28-40M37-21Q32-28 38-35"
            stroke="#9ba18c"
            strokeWidth="1.1"
          />
        </>
      )}
      <path
        d="M8-15H43L39-3H12ZM8-12H4M43-12H47M13-17Q25-23 39-17"
        fill="#aab099"
      />
    </g>
  );
}
function MerchantCart({
  ink,
  paper,
  foliage,
}: Pick<InkProps, "ink" | "paper" | "foliage">) {
  return (
    <g
      data-detail="merchant-cart"
      transform="translate(615 154)"
      stroke={ink}
      strokeWidth="1.1"
      strokeLinejoin="round"
    >
      <title>行商の荷車：16:00まで</title>
      <path d="M0-7H52V9H0ZM2-7V-23H49V-7M-4-23L24-32L56-23Z" fill={paper} />
      <path d="M-4-23L24-32L56-23L52-18L25-26L0-18Z" fill={foliage} />
      <path d="M7-7V9M44-7V9M0 4H52M52 6L66 11" />
      <path d="M8-8L9-19H20L21-8ZM29-8V-18H42V-8Z" fill="#c9bba1" />
      <path d="M14-18V-14M31-14H40" />
      <circle cx="10" cy="12" r="6" fill={paper} />
      <circle cx="42" cy="12" r="6" fill={paper} />
      <path d="M10 6V18M4 12H16M42 6V18M36 12H48" strokeWidth=".7" />
      <circle cx="-18" cy="-14" r="3.5" fill={paper} />
      <path
        d="M-22-9Q-18-12-14-9L-11 4H-25ZM-21 4L-23 14M-15 4L-13 14M-13-7L-5-2"
        fill="#b9ad94"
      />
    </g>
  );
}
function Guard({ hp, paper }: { hp: number; paper: string }) {
  return (
    <g data-detail="guard-present" transform="translate(487 159)">
      <circle cy="-17" r="4" fill={paper} />
      <path
        d="M-4-11L-7 2H7L4-11ZM-4 2L-6 16M4 2L6 16M-5-8L-13 1M5-8L13-2M13-8V20"
        fill={hp < 40 ? "#bdac8d" : "#a6ad94"}
      />
    </g>
  );
}
function Person({
  resident,
  x,
  y,
  selected,
  ink,
  paper,
}: {
  resident: Resident;
  x: number;
  y: number;
  selected: boolean;
  ink: string;
  paper: string;
}) {
  const resting =
    resident.action?.kind === "rest" ||
    resident.action?.kind === "eat" ||
    resident.action?.kind === "hobby";
  const asleep = resident.hp <= 0 || resident.action?.kind === "sleep";
  const injured = Object.values(resident.wounds).some((value) => value > 0);
  const coat =
    resident.id === "mio"
      ? "#c9ad90"
      : resident.id === "ren"
        ? "#9fae91"
        : "#b8b59a";
  return (
    <g
      transform={`translate(${x} ${y})`}
      stroke={ink}
      strokeWidth={selected ? 1.6 : 1.15}
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <title>{`${resident.name}：${resident.hp <= 0 ? "意識なし" : (resident.action?.label ?? "待機中")}${injured ? "、負傷あり" : ""}`}</title>
      {asleep ? (
        <>
          <path d="M-10 1H18" stroke="#abb39b" strokeWidth="2" />
          <circle cx="-9" cy="-4" r="3.8" fill={paper} />
          <path d="M-4-7H11L16-1H-5Z" fill={coat} />
          <path d="M10-1H20" />
          {resident.hp <= 0 && (
            <path d="M-12-13L-8-9M-8-13L-12-9" stroke="#a77660" />
          )}
        </>
      ) : (
        <>
          <circle cx="0" cy="-20" r="4" fill={paper} />
          <path d="M-4-14Q0-17 4-14L6-2H-6Z" fill={coat} />
          {resting ? (
            <>
              <path d="M-4-2L6 0L10 7M3-2L13 0L15 7M-8 2H8M-7 2V10M7 2V10" />
              <path d="M-5-12L-9-5L-3-4M4-12L10-5L4-4" />
            </>
          ) : (
            <>
              <path d="M-3-2L-4 10M3-2L5 10M-4-12L-8-4M4-12L8-5" />
              {resident.wounds.leg > 0 && (
                <path d="M9-9L12 11" strokeWidth="1.7" />
              )}
            </>
          )}
          {resident.wounds.arm > 0 && (
            <path d="M5-10L8-7M4-8L7-5" stroke={paper} strokeWidth="2.8" />
          )}
          {resident.wounds.body > 0 && (
            <path d="M-4-9H4M0-12V-6" stroke={paper} strokeWidth="1.5" />
          )}
          {resident.action?.kind === "attack" && (
            <g data-detail="resident-attacking">
              <path d="M4-12L13-11M12-20L15 0" />
              {resident.weapon === "spear" && (
                <path d="M12-20L10-25L14-23Z" fill={ink} />
              )}
              {resident.weapon === "knife" && (
                <path d="M12-11L19-17L17-9Z" fill={paper} />
              )}
            </g>
          )}
          {resident.action?.kind === "defend" && (
            <path
              data-detail="resident-defending"
              d="M5-14L16-12L15-4L10 0L5-4Z"
              fill="#c0c8ac"
            />
          )}
        </>
      )}
      {selected && (
        <path d="M-3-32L0-29L3-32" stroke="#ac8d59" strokeWidth="1.5" />
      )}
    </g>
  );
}

export function Landscape({
  game,
  resident,
  compact = false,
  location = resident.location,
}: LandscapeProps) {
  const uid = useId().replace(/:/g, "");
  const scene = describeLandscape(game, resident, location);
  const night = scene.period === "night";
  const dusk = scene.period === "evening";
  const morning = scene.period === "morning";
  const palette: InkProps = {
    ink: night ? "#707f71" : "#778369",
    paper: night ? "#d6d9c7" : "#f1efe3",
    foliage: night ? "#a7b4a0" : "#bdc7ac",
    accent: dusk ? "#dcc29d" : morning ? "#e6d9b6" : "#d8d9bb",
    hatch: `url(#${uid}-hatch)`,
    glow: night ? "#ebd29a" : "#ded2a6",
  };
  const { ink, paper, foliage, accent, hatch, glow } = palette;
  const base = LOCATIONS[location].kind === "base";
  const activeCooking = game.residents.some(
    (person) =>
      person.hp > 0 &&
      person.action?.kind === "cook" &&
      person.location === location,
  );
  const houseCooking = game.residents.some(
    (person) =>
      person.hp > 0 &&
      person.action?.kind === "cook" &&
      ["home", "kitchen", "bedroom"].includes(person.location),
  );
  const merchantHere =
    location === "home" && getMerchantStatus(game).status === "open";
  const people = game.residents.filter(
    (person) => person.location === location,
  );
  const free = availableResources(game);
  const roomFurnishing = furnishingAt(game, location);
  const furnishing = (
    <Shelf
      decorated={roomFurnishing.shelfHere || roomFurnishing.legacyShelf}
      displayed={roomFurnishing.displayed}
      carried={roomFurnishing.carried}
      ink={ink}
    />
  );
  return (
    <svg
      className={`landscape landscape-state${compact ? " landscape-compact" : ""}`}
      viewBox="0 0 800 210"
      fill="none"
      role="img"
      aria-labelledby={`${uid}-title`}
      aria-describedby={`${uid}-desc`}
      data-location={location}
      data-period={scene.period}
    >
      <title
        id={`${uid}-title`}
      >{`${scene.periodLabel}の${scene.locationLabel}`}</title>
      <desc id={`${uid}-desc`}>{scene.description}</desc>
      <defs>
        <linearGradient
          id={`${uid}-sky`}
          x1="400"
          y1="0"
          x2="400"
          y2="210"
          gradientUnits="userSpaceOnUse"
        >
          <stop stopColor={night ? "#c9d2c4" : dusk ? "#f1e3cd" : "#f2f2e7"} />
          <stop offset="1" stopColor={night ? "#dde0ce" : "#eeefe4"} />
        </linearGradient>
        <linearGradient
          id={`${uid}-hill`}
          x1="400"
          y1="70"
          x2="400"
          y2="210"
          gradientUnits="userSpaceOnUse"
        >
          <stop stopColor={night ? "#b6c2ad" : "#dce1cf"} />
          <stop offset="1" stopColor={night ? "#c8cfba" : "#eaecdf"} />
        </linearGradient>
        <pattern
          id={`${uid}-hatch`}
          width="5"
          height="5"
          patternUnits="userSpaceOnUse"
          patternTransform="rotate(30)"
        >
          <path d="M0 0V5" stroke={ink} strokeWidth=".5" opacity=".35" />
        </pattern>
      </defs>
      <path d="M0 0H800V210H0Z" fill={`url(#${uid}-sky)`} />
      {night ? (
        <g fill="#f1edcd">
          <path d="M644 23A22 22 0 1 0 666 56A23 23 0 0 1 644 23Z" />
          <circle cx="568" cy="30" r="1.6" />
          <circle cx="696" cy="72" r="1.3" />
          <circle cx="179" cy="39" r="1.4" />
          <circle cx="102" cy="77" r="1.1" />
          <path d="M711 22V29M708 25H715" stroke="#f1edcd" strokeWidth="1" />
        </g>
      ) : (
        <circle
          cx={dusk ? 658 : morning ? 614 : 625}
          cy={dusk ? 91 : morning ? 70 : 43}
          r={dusk ? 25 : 22}
          fill={accent}
          opacity=".85"
        />
      )}
      <path
        d="M0 134Q90 53 204 100T403 106Q520 23 656 104T800 112V210H0Z"
        fill={night ? "#bdc9b6" : dusk ? "#dddcc9" : "#e3e7d9"}
      />
      <path
        d="M0 165Q164 77 333 147Q474 82 600 126T800 150V210H0Z"
        fill={`url(#${uid}-hill)`}
      />
      <path
        d="M0 175Q160 139 326 179T800 167"
        stroke={night ? "#a0af98" : "#afb7a1"}
        strokeWidth="1"
      />
      <path d="M449 162Q398 188 460 210H526Q454 183 469 166" fill={paper} />
      <path
        d="M463 166Q447 185 499 210"
        stroke="#bcb69c"
        strokeWidth=".8"
        strokeDasharray="3 5"
      />
      <g
        stroke={ink}
        strokeWidth="1.2"
        strokeLinejoin="round"
        strokeLinecap="round"
      >
        {location === "home" && (
          <g data-detail="home">
            <path d="M306 120L369 80L439 121V171L306 168Z" fill={paper} />
            <path
              d="M296 123L369 75L449 119L434 126L369 89L310 131Z"
              fill={foliage}
            />
            <path
              d="M296 123L369 75L449 119L434 126L369 89L310 131Z"
              fill={hatch}
            />
            <path d="M388 87V62H402V96M385 62H405" fill={paper} />
            {houseCooking && (
              <path
                data-detail="cooking-smoke"
                d="M396 51Q387 42 396 33Q404 25 397 17M403 49Q399 42 405 36"
                stroke="#98a38c"
              />
            )}
            <path d="M337 169V134H360V170" fill="#abae96" />
            <path d="M382 126H425V153H382Z" fill={night ? glow : "#d9ddc7"} />
            <path d="M403 126V153M382 138H425" />
            <g transform="translate(380 155)" data-detail="window-furnishings">
              {furnishing}
            </g>
            <path d="M438 139L477 128L499 145V174L438 171Z" fill={paper} />
            <path
              d="M434 140L477 124L504 144L497 148L477 132L438 146Z"
              fill={foliage}
            />
            <path d="M467 150H481V171H467Z" fill="#b2b5a2" />
            <g transform="translate(323 188)" data-detail="food-store">
              <Store
                food={free.food}
                ingredients={free.ingredients}
                ink={ink}
                paper={paper}
              />
            </g>
            {merchantHere && (
              <MerchantCart ink={ink} paper={paper} foliage={foliage} />
            )}
          </g>
        )}
        {location === "kitchen" && (
          <g data-detail="kitchen">
            <path d="M279 173V77H517V173Z" fill={paper} />
            <path d="M268 77L397 47L527 77" fill={foliage} />
            <path d="M279 77H517M279 173H517" />
            <path
              d="M400 91H444V124H400ZM422 91V124M400 108H444"
              fill={night ? glow : "#d8dec6"}
            />
            <path d="M306 128V82H321V128" fill="#d2d5bf" />
            <g
              transform="translate(296 136)"
              data-detail={activeCooking ? "stove-cooking" : "stove-idle"}
            >
              <Stove
                cooking={activeCooking}
                ink={ink}
                paper={paper}
                glow={glow}
              />
            </g>
            <path
              d="M365 146H453V151H365ZM374 151V177M445 151V177"
              fill="#c9c5ad"
            />
            <path
              d="M385 144L382 136H397L394 144M415 144L412 136H427L424 144"
              fill={paper}
            />
            <g transform="translate(452 143)" data-detail="food-store">
              <Store
                food={free.food}
                ingredients={free.ingredients}
                ink={ink}
                paper={paper}
              />
            </g>
            <g transform="translate(457 105)">{furnishing}</g>
          </g>
        )}
        {location === "bedroom" && (
          <g data-detail="bedroom">
            <path d="M279 176V76H519V176Z" fill={paper} />
            <path d="M268 76L396 47L529 76" fill={foliage} />
            <path
              d="M373 88H423V130H373ZM398 88V130M373 109H423"
              fill={night ? glow : "#d8dec6"}
            />
            <path d="M368 85V130M428 85V130" stroke="#b7bda5" strokeWidth="4" />
            <path
              d="M297 154V132H306V157M297 144H390L409 158H297ZM302 158V178M402 158V178"
              fill="#c0bca1"
            />
            <path d="M309 140H386L400 153H309Z" fill="#d3d9c1" />
            <path d="M310 140H331L337 149H311Z" fill="#eeebdb" />
            <path d="M347 140L360 153M367 140L380 153" stroke="#afb899" />
            <path
              d="M447 149H500V154H447ZM453 154V178M494 154V178"
              fill="#c5c3aa"
            />
            <g transform="translate(450 148)">{furnishing}</g>
            <path d="M288 183Q402 170 513 184" stroke="#b8bba2" />
          </g>
        )}
        {location === "garden" && (
          <g data-detail="garden">
            <path d="M287 161L339 141L465 151L418 177Z" fill="#d0c9ac" />
            <path d="M287 161V169L418 185L465 159V151M418 177V185M300 160L421 173M316 155L438 164" />
            {[0, 1, 2, 3, 4].map((i) => (
              <g
                key={i}
                transform={`translate(${321 + i * 25} ${155 + i * 1.5})`}
              >
                <path
                  d="M0 0V-17M0-8Q-17-23-9-7L0-4M0-11Q14-27 12-11L0-7"
                  fill={foliage}
                />
              </g>
            ))}
            <path
              d="M489 155L484 172H503L499 155ZM498 158L514 150L519 153L503 165M488 154Q482 141 493 139Q506 138 506 150"
              fill="#bcc5ab"
            />
            <path d="M289 140V119M289 126H325M322 136V115M276 181L300 177M455 183H477" />
            <path
              d="M350 120Q355 113 361 120Q367 113 373 120"
              stroke="#a3ae91"
            />
          </g>
        )}
        {location === "road" && (
          <g data-detail="road">
            <path
              d="M343 173Q367 143 421 126Q454 109 482 116M412 153Q472 137 512 142"
              stroke="#c0b99f"
              strokeWidth="12"
            />
            <path
              d="M343 173Q367 143 421 126Q454 109 482 116M412 153Q472 137 512 142"
              stroke={paper}
              strokeWidth="9"
            />
            <path
              d="M395 171V105M393 110H448L459 117L447 124H393ZM394 130H356L346 137L357 143H394Z"
              fill={paper}
            />
            <path d="M404 116H444M359 137H384" strokeWidth=".8" />
            <path
              d="M509 112V83L533 70L549 83V112M506 84L532 66L554 82M519 113V96H527V113"
              fill="#d9ddc9"
              stroke="#9da88d"
              strokeWidth=".9"
            />
          </g>
        )}
        {location === "ruins" && (
          <g data-detail="ruins">
            <path
              d="M297 175V99L322 85V104H344V74L372 91V117H393V149H434V176"
              fill="#d8ddc8"
            />
            <path d="M297 101L321 86M310 110V174M344 76L372 92M355 96V120H366M331 149V175M393 150H434M409 152V176" />
            <path
              d="M301 126H335M302 151H325M348 131H374M346 160H383"
              strokeWidth=".6"
            />
            {!game.flags.suppliesRecovered ? (
              <g data-detail="supplies-remaining">
                <path
                  d="M383 151L410 142L439 153V178L410 186L383 174Z"
                  fill="#c8c5a6"
                />
                <path d="M410 154V186M383 151L410 162L439 153M390 157L402 174M418 162L431 174" />
                <path
                  d="M446 157L465 151L479 159V178L460 183L446 176Z"
                  fill="#d8c9a8"
                />
              </g>
            ) : (
              <g data-detail="supplies-recovered">
                <path
                  d="M387 174L407 166L432 176M390 178L410 170L431 180M447 178H462"
                  stroke="#aeb29a"
                />
              </g>
            )}
            {game.enemy.defeated && game.enemy.location === location && (
              <g
                data-detail="guard-retreated"
                stroke="#aeb29a"
                strokeWidth=".9"
              >
                <path d="M502 166L508 164M512 159L518 157M522 152L528 150" />
              </g>
            )}
          </g>
        )}
        {location === "shelter" && (
          <g data-detail="shelter">
            <path
              d="M299 174Q348 159 408 164T503 169V182H299Z"
              fill="#c9d0b9"
            />
            <path
              d="M310 169L318 180M336 164L344 181M362 164L370 181M388 165L396 181M420 168L428 182M453 170L461 182M481 170L489 181"
              stroke="#a0ad90"
            />
            <path
              d="M378 165V88M378 92Q342 100 346 125Q346 143 370 139Q398 154 416 130Q431 105 404 95Q391 73 378 92Z"
              fill={foliage}
            />
            <path d="M378 135L363 117M378 146L397 122" />
            <path
              d="M321 191Q368 179 404 186T493 184"
              stroke={paper}
              strokeWidth="7"
            />
            {!game.flags.safeSuppliesRecovered ? (
              <g data-detail="safe-supplies-remaining">
                <path
                  d="M423 157L444 151L461 159V176L441 181L423 173Z"
                  fill="#c8c5a6"
                />
                <path
                  d="M441 161V181M423 157L441 166L461 159M465 169L468 156Q478 150 482 161L481 177H466Z"
                  fill="#d6c5a5"
                />
              </g>
            ) : (
              <path
                data-detail="safe-supplies-recovered"
                d="M429 176L441 172L453 176M464 177H479"
                stroke="#a6af95"
              />
            )}
          </g>
        )}
        {location === "village" && (
          <g data-detail="village-houses">
            <path d="M286 165V119L326 93L367 120V166Z" fill={paper} />
            <path d="M278 121L326 88L374 119L366 127L326 101L288 129Z" fill={foliage} />
            <path d="M278 121L326 88L374 119L366 127L326 101L288 129Z" fill={hatch} />
            <path d="M312 166V135H331V166" fill="#b5b8a0" />
            <path d="M342 130H357V146H342Z" fill={night ? glow : "#d6dfc6"} />
            <path d="M382 160V103L426 77L472 104V164Z" fill={paper} />
            <path d="M374 106L426 72L480 103L472 111L426 85L384 114Z" fill={foliage} />
            <path d="M393 124H416V146H393ZM438 120H458V142H438Z" fill={night ? glow : "#d6dfc6"} />
            <path d="M404 124V146M393 135H416M448 120V142M438 131H458" strokeWidth=".8" />
            <path d="M422 164V132H435V164M448 87V61H460V95" fill={paper} />
            <path d="M367 174H463V178H367ZM375 178V191M455 178V191" fill="#c8bea2" />
            <path d="M373 171L375 158H389L391 171ZM402 171L400 162H416L414 171" fill="#c6cdaF" />
            {roomFurnishing.displayed.slice(0, 2).map((piece, index) => (
              <g key={piece.id} data-detail="village-window-carving">
                <title>{getCraftDisplayTitle(game, piece)}</title>
                <Carving design={piece.design} x={425 + index * 21} y={166} ink={ink} />
              </g>
            ))}
            <path d="M474 178V126M468 135H501L508 140L500 146H468Z" fill={paper} />
            <path d="M479 140H499M285 183Q345 170 373 184M463 194Q489 183 512 185" stroke="#afb7a1" />
          </g>
        )}
        {location === "meadow" && (
          <g data-detail="riverside-meadow">
            <path d="M341 129Q384 137 409 151T391 181Q370 197 405 210H490Q428 186 455 171T420 144Q385 127 373 125Z"
              fill={night ? "#b4c6bd" : "#cbdcd1"} stroke="#99af9f" />
            <path d="M377 139L391 142M414 161L433 164M395 188L411 191M437 200L456 204" stroke={paper} strokeWidth="1.4" />
            <path d="M302 172Q325 156 359 166L379 187L333 195L299 184Z" fill="#d0d5b8" />
            <g data-detail={regionHarvestAvailable(game) ? "meadow-harvest-available" : "meadow-harvest-finished"}>
              {(regionHarvestAvailable(game) ? [0, 1, 2, 3, 4] : [0, 3]).map((index) => (
                <g key={index} transform={`translate(${312 + index * 11} ${177 + index % 2 * 5})`}>
                  <path d="M0 3V-12M0-3Q-11-14-6-2L0 0M0-7Q10-18 7-6L0-3" fill={foliage} />
                </g>
              ))}
            </g>
            <path d="M468 175V149M474 179V143M482 177V153M468 157L462 150M474 154L481 146M482 163L489 154"
              stroke="#98aa8b" />
            <path d="M293 193L315 189M489 186L505 183M323 150Q329 143 335 150Q341 143 347 150" stroke="#a5b191" />
          </g>
        )}
        {location === "reedbank" && (
          <g data-detail="upstream-reedbank">
            <path d="M277 164Q342 146 402 155T521 149Q496 165 441 171Q388 173 343 191L322 210H257Q295 177 352 168Q310 176 277 172Z"
              fill={night ? "#afc2b9" : "#c1d5c9"} stroke="#91a79a" />
            <path d="M300 165q24-6 44-5m36-2q19-1 38 2m-121 32 22-8m110-20 25-3" stroke={paper} />
            {[0, 1, 2, 3, 4, 5, 6, 7, 8].map(i => (
              <g key={i} transform={`translate(${320 + i * 18} ${156 + (i % 3) * 4})`}>
                <path d="M0 0Q2-20 12-32M3-14q-12-16-10-20M2-10q9-11 14-12" stroke={ink} />
                <path d="M9-27q-1-11 10-15q2 9-10 15Z" fill={accent} />
              </g>
            ))}
            {regionHarvestAvailable(game, "reedbank") && <path data-detail="reedbank-driftwood"
              d="M364 185l35-12 9 1-16 8-27 7Zm24-6 3-8 3-2-1 9" fill="#bca989" />}
          </g>
        )}
        {location === "lodge" && (
          <g data-detail="boathouse-workshop">
            <path d="M277 175q73-22 146-9t97-2v37q-49-9-94 4H277Z" stroke="#9aafa2" fill={night ? "#afc2b9" : "#c8dace"} />
            <path d="M290 187l38-4m21 11 31-4m72 7 30-1" stroke={paper} />
            <path d="M335 111l41-25 75 15v62l-116-2Z" fill={paper} />
            <path d="M322 116l51-37 79 10 19 25-89-10-47 22Z" fill={foliage} />
            <path d="M386 104l4 56m18-43 26 3v18l-26-3Z" fill={night ? glow : "#d8dfcb"} />
            <path d="M346 159v-27l18-9v36m56-40v17" fill="#b4b6a0" />
            <path d="M314 162l134-1 25 8-142 2Zm12 9v13m111-15v12m21-12v9" fill="#c7b895" />
            <path d="M457 181q27 6 47-4l-10 11q-26 6-37-7Z" fill="#b6a990" />
            <path d="M477 179l15-22m-13 20-6 7" strokeWidth="2" />
            {activeCooking && <path data-detail="lodge-cooking" d="M414 85q-8-10-1-16t-3-13m11 29q7-8 1-14"
              stroke={paper} strokeWidth="2.2" />}
          </g>
        )}
        {location === "ridge" && (
          <g data-detail="ridge-path">
            <path d="M277 178L335 118L363 137L413 80L478 143L507 173Z" fill={night ? "#c2cbb7" : "#d3d8c0"} />
            <path d="M277 178L335 118L363 137L413 80L478 143L507 173M335 118L342 146M413 80L402 122L431 139"
              stroke="#97a388" />
            <path d="M310 182Q335 165 360 169T392 147Q393 134 419 121Q430 115 434 103"
              stroke="#b8b298" strokeWidth="10" />
            <path d="M310 182Q335 165 360 169T392 147Q393 134 419 121Q430 115 434 103"
              stroke={paper} strokeWidth="7" />
            <path d="M361 168V142H371V166M358 142H375M436 149V129H444V151M433 129H448" fill="#c0c5ac" />
            <path d="M299 188L314 184M462 169L478 162M475 176L488 172M333 147L341 144" stroke="#99a68e" />
            <path d="M388 110Q394 105 399 110Q404 105 410 110" strokeWidth=".8" />
            {game.secondaryEncounter?.defeated && (
              <g data-detail="ridge-watch-retreated" stroke="#aeb29a" strokeWidth=".9">
                <path d="M488 177L494 175M498 170L504 168M508 163L514 161" />
              </g>
            )}
          </g>
        )}
        {!base && getPresentEncounterAt(game, location) && (
          <Guard hp={getPresentEncounterAt(game, location)!.hp} paper={paper} />
        )}
      </g>
      <g stroke={ink} strokeWidth="1.1" strokeLinejoin="round">
        <path
          d="M223 166V83M223 83L205 115H218L196 142H251L229 115H243L223 83"
          fill={foliage}
        />
        <path
          d="M258 169V105M258 104L241 132H251L232 154H283L266 131H277L258 104"
          fill={night ? "#b0bda6" : "#c7cfb7"}
        />
        <path
          d="M557 167V106M558 102Q530 110 539 133Q545 142 557 138Q573 147 583 131Q591 111 574 105Q568 89 558 102Z"
          fill={foliage}
        />
        <path d="M557 138L547 126M557 147L570 132" />
      </g>
      {base &&
        roomFurnishing.upgrades.some(
          (item) => item.recipeId === "kitchen-tools",
        ) && (
          <g
            transform="translate(276 190)"
            data-detail="local-kitchen-tools"
            stroke={ink}
            strokeWidth="1"
            strokeLinejoin="round"
          >
            <path d="M0 0H37V4H0ZM4 4V17M32 4V17" fill="#c6bea1" />
            <path d="M7-3H29V0H7ZM10-3V-10M16-3V-12M22-3V-9" />
            <path d="M8-10H13M14-12H18M20-9H25" strokeWidth="2" />
            <path d="M1-4L0-10H6L5-4" fill="#ded3b4" />
          </g>
        )}
      {base &&
        roomFurnishing.upgrades.some(
          (item) => item.recipeId === "rest-corner",
        ) && (
          <g
            transform="translate(602 185)"
            data-detail="local-rest-corner"
            stroke={ink}
            strokeWidth="1"
            strokeLinejoin="round"
          >
            <path d="M0 0V-22H26V0M0-3H32V2H0ZM4 2V14M28 2V14" fill="#c4cbb1" />
            <path d="M4-18Q13-21 22-17V-5Q13-8 4-5Z" fill="#e2d7b9" />
            <path d="M-7 6Q9 2 37 5L42 12Q13 17-10 12Z" fill="#d8dbc5" />
          </g>
        )}
      {(base || location === "lodge") &&
        roomFurnishing.upgrades.some(
          (item) => item.recipeId === "crafting-tools",
        ) && (
          <g
            transform="translate(400 185)"
            data-detail="local-crafting-tools"
            stroke={ink}
            strokeWidth="1"
            strokeLinejoin="round"
          >
            <path d="M-2-5H43V0H-2ZM2 0V14M38 0V14M2 9H38" fill="#c6bea1" />
            <path d="M7-5V-14M2-15H14V-11H2Z" fill="#ded3b4" />
            <path d="M25-5L33-15M29-17L36-12" strokeWidth="1.8" />
            <path d="M16-5L18-10H25L28-5Z" fill={paper} />
          </g>
        )}
      <g data-detail="present-residents">
        {people.map((person, i) => (
          <Person
            key={person.id}
            resident={person}
            x={base && location !== "garden" ? 536 + i * 21 : 511 + i * 22}
            y={186 + (i % 2) * 3}
            selected={person.id === resident.id}
            ink={ink}
            paper={paper}
          />
        ))}
      </g>
      {regionNPCsAt(game, location).length > 0 && (
        <g data-detail="present-region-neighbours" stroke={ink} strokeWidth="1.1" strokeLinecap="round" strokeLinejoin="round">
          {regionNPCsAt(game, location).map((person, index) => (
            <g key={person.id} transform={`translate(${609 + index * 27} 183)`} data-person-id={person.id}>
              <title>{person.name}</title>
              <circle cy="-20" r="3.8" fill={paper} />
              <path d="M-4-14Q0-17 4-14L6-2H-6ZM-3-2L-4 9M3-2L5 9M-4-12L-8-4M4-12L8-5" fill={index ? "#b6bea3" : "#c5b698"} />
            </g>
          ))}
        </g>
      )}
      {!compact && (
        <g stroke={ink} strokeWidth=".9" opacity=".7">
          <path d="M122 180V171M118 175L122 178L127 173M620 184V176M616 178L620 182L624 177M181 195V187M176 189L181 193L186 187M688 170V163M684 165L688 168L692 163M67 153Q80 146 93 153M530 198L534 192M534 199L538 193" />
          {!night && (
            <path d="M704 72Q710 66 716 72Q722 66 728 72M158 62Q163 57 168 62Q173 57 178 62" />
          )}
        </g>
      )}
    </svg>
  );
}
