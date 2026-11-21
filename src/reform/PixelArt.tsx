import { useLayoutEffect, useRef, type CSSProperties } from "react";
import type { Persona } from "./peopleModel";
import type { Place } from "./world";
import {
  drawPortrait,
  drawWalker,
  walkerWidth,
  walkerHeight,
} from "./pixelFigure";
import home from "./art/pixel/home.png?inline";
import interior from "./art/pixel/interior.png?inline";
import forest from "./art/pixel/forest.png?inline";
import river from "./art/pixel/river.png?inline";
import village from "./art/pixel/village.png?inline";
import ridge from "./art/pixel/ridge.png?inline";
import orchard from "./art/pixel/orchard.png?inline";
import mill from "./art/pixel/mill.png?inline";

export const landscapeArt = {
  home,
  interior,
  forest,
  river,
  village,
  ridge,
  orchard,
  mill,
};
export type Setting = keyof typeof landscapeArt;

const settingNames: Record<Setting, string> = {
  home: "家と庭",
  interior: "家の中",
  forest: "森の道",
  river: "川の渡し場",
  village: "町並み",
  ridge: "丘の尾根",
  orchard: "果樹園",
  mill: "水車の里",
};

export function settingFor(
  place: Place | undefined,
  atHome: boolean,
  room: string,
): Setting {
  if (atHome) return room === "yard" || room === "living" ? "home" : "interior";
  if (place?.id === "mill") return "mill";
  if (place?.id === "orchard") return "orchard";
  if (place?.id === "forest") return "forest";
  if (place?.id === "village" || place?.id.startsWith("hamlet-"))
    return "village";
  if (place?.biome === "shore") return "river";
  if (place?.biome === "ridge") return "ridge";
  return place?.biome === "forest" ? "forest" : "home";
}

export function Portrait({ person }: { person: Persona }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useLayoutEffect(() => {
    const ctx = ref.current?.getContext("2d");
    if (!ctx) return;
    ctx.imageSmoothingEnabled = false;
    ctx.fillStyle = "#f2e9cd";
    ctx.fillRect(0, 0, 48, 56);
    ctx.fillStyle = "#e4ddbc";
    ctx.fillRect(0, 32, 48, 24);
    ctx.fillStyle = "#d4ceac";
    ctx.fillRect(0, 43, 48, 13);
    drawPortrait(ctx, person);
  }, [person]);
  return (
    <canvas
      ref={ref}
      className="yp-portrait"
      width={48}
      height={56}
      role="img"
      data-person={person.id}
      aria-label={(person.name || "住人") + "のプロフィール画"}
    />
  );
}

type StandingSpot = readonly [number, number];
const standingSpots: Record<Setting, readonly StandingSpot[]> = {
  orchard: [
    [210, 91],
    [238, 82],
    [186, 94],
  ],
  mill: [
    [209, 90],
    [236, 81],
    [186, 94],
  ],
  home: [
    [225, 92],
    [244, 86],
    [201, 94],
  ],
  interior: [
    [178, 91],
    [203, 87],
    [152, 92],
  ],
  forest: [
    [228, 92],
    [246, 88],
    [209, 90],
  ],
  river: [
    [121, 80],
    [143, 77],
    [102, 82],
  ],
  village: [
    [190, 88],
    [211, 80],
    [171, 90],
  ],
  ridge: [
    [208, 92],
    [228, 85],
    [186, 94],
  ],
};

export function StandingFigure({
  person,
  spot,
}: {
  person: Persona;
  spot?: StandingSpot;
}) {
  const ref = useRef<HTMLCanvasElement>(null);
  useLayoutEffect(() => {
    const ctx = ref.current?.getContext("2d");
    if (!ctx) return;
    ctx.clearRect(0, 0, walkerWidth, walkerHeight);
    ctx.imageSmoothingEnabled = false;
    ctx.fillStyle = "#282b3440";
    ctx.fillRect(4, walkerHeight - 2, walkerWidth - 8, 1);
    ctx.fillRect(6, walkerHeight - 1, walkerWidth - 12, 1);
    drawWalker(ctx, person);
  }, [person]);
  const style: CSSProperties | undefined = spot && {
    left: (spot[0] / 288) * 100 + "%",
    top: (spot[1] / 96) * 100 + "%",
    zIndex: Math.round(spot[1]),
  };
  return (
    <canvas
      className={spot ? "yp-walker" : "yp-full-length"}
      data-person={person.id}
      width={walkerWidth}
      height={walkerHeight}
      style={style}
      ref={ref}
      role={spot ? undefined : "img"}
      aria-hidden={spot ? true : undefined}
      aria-label={spot ? undefined : (person.name || "住人") + "の全身の立ち姿"}
    />
  );
}

export function PixelScene({
  person,
  company,
  setting,
  minutes,
}: {
  person: Persona;
  company: Persona[];
  setting: Setting;
  minutes: number;
}) {
  const hour = Math.floor((minutes % 1440) / 60);
  const light =
    hour < 5 || hour >= 19
      ? "night"
      : hour < 10
        ? "morning"
        : hour < 16
          ? "day"
          : "dusk";
  const lightName = { morning: "朝", day: "昼", dusk: "夕暮れ", night: "夜" }[
    light
  ];
  const people = [person, ...company.filter((p) => p.id !== person.id)]
    .sort((a, b) => a.id.localeCompare(b.id))
    .slice(0, 3);
  return (
    <div
      className="yp-scene"
      role="img"
      aria-label={
        person.name +
        "の生活の挿絵。" +
        lightName +
        "の" +
        settingNames[setting] +
        "。" +
        people.map((p) => p.name).join("、")
      }
      data-person={person.id}
      data-setting={setting}
      data-light={light}
    >
      <img
        alt=""
        aria-hidden="true"
        className="yp-landscape"
        src={landscapeArt[setting]}
      />
      {people.map((p, i) => (
        <StandingFigure
          key={p.id}
          person={p}
          spot={standingSpots[setting][i]}
        />
      ))}
    </div>
  );
}
