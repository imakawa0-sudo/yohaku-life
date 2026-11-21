import { useEffect, useMemo, useRef, useState } from "react";
import {
  Anchor,
  Flag,
  Landmark,
  MapPin,
  Mountain,
  Plus,
  Shuffle,
  Sprout,
  Trees,
  Wind,
} from "lucide-react";
import {
  biomeNames,
  climateNames,
  generateWorld,
  places,
  projectInfo,
  riverX,
  travelMinutes,
} from "./world";
import type { Biome, Climate, LandmarkRule, World, WorldConfig } from "./world";
import "./world.css";

const kinds: Record<LandmarkRule["kind"], string> = {
  guild: "組合",
  village: "集落",
  faction: "派閥",
  facility: "施設",
};
const icons = {
  village: Landmark,
  mill: Wind,
  forest: Trees,
  pass: Mountain,
  landing: Anchor,
  orchard: Sprout,
};

function randomSeed(): number {
  return crypto.getRandomValues(new Uint32Array(1))[0] % 10000000;
}

function Landscape({
  world,
  selected,
  onSelect,
}: {
  world: World;
  selected: string;
  onSelect: (id: string) => void;
}) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    const draw = () => {
      const width = canvas.clientWidth,
        height = canvas.clientHeight;
      if (!width || !height) return;
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      canvas.width = Math.round(width * dpr);
      canvas.height = Math.round(height * dpr);
      const ctx = canvas.getContext("2d");
      if (!ctx) return;
      ctx.scale(dpr, dpr);
      const x = (v: number) => (width * v) / 100,
        y = (v: number) => (height * v) / 100;
      const seed = world.config.seed;
      let ink = seed >>> 0;
      const next = () => {
        ink = (Math.imul(1664525, ink) + 1013904223) >>> 0;
        return ink / 4294967296;
      };
      ctx.fillStyle = { cool: "#e6ece5", mild: "#eeefdf", warm: "#f1ead7" }[
        world.config.climate
      ];
      ctx.fillRect(0, 0, width, height);
      // Contours are deliberately quiet so the overlaid settlement names stay legible.
      for (let j = 0; j < 27; j++) {
        ctx.beginPath();
        const ox = j % 2 === 0 ? -9 : 106,
          oy = j % 2 === 0 ? 15 : 86;
        for (let i = 0; i <= 100; i++) {
          const a = (i / 100) * Math.PI * 2;
          const radius =
            7 +
            (j >> 1) * 4.5 +
            2.3 * Math.sin(a * 3 + (seed % 5)) +
            2.9 * Math.cos(a * 4);
          const px = x(ox + radius * Math.cos(a)),
            py = y(oy + radius * 1.35 * Math.sin(a));
          if (!i) ctx.moveTo(px, py);
          else ctx.lineTo(px, py);
        }
        ctx.strokeStyle = "rgba(112,126,88,.17)";
        ctx.lineWidth = 0.8;
        ctx.stroke();
      }
      const woods = world.sites.find((site) => site.id === "forest")!;
      for (let i = 0; i < 60 + world.config.woods * 50; i++) {
        const px = woods.x + (next() + next() - 1) * 42,
          py = woods.y + (next() + next() - 1) * 39;
        if (Math.abs(px - riverX(py, seed)) < 5) continue;
        ctx.strokeStyle = "rgba(80,108,75,.28)";
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(x(px) - 2.1, y(py) + 1.9);
        ctx.lineTo(x(px), y(py) - 2.7);
        ctx.lineTo(x(px) + 2.1, y(py) + 1.9);
        ctx.stroke();
      }
      ctx.lineJoin = "round";
      for (const [color, size] of [
        ["#afc1ae", 9],
        ["#d6e5d9", 6],
      ] as const) {
        ctx.beginPath();
        for (let i = -2; i <= 102; i++) {
          const px = x(riverX(i, seed)),
            py = y(i);
          if (i === -2) ctx.moveTo(px, py);
          else ctx.lineTo(px, py);
        }
        ctx.strokeStyle = color;
        ctx.lineWidth = size * (world.config.river === "river" ? 1 : 0.68);
        ctx.stroke();
      }
      for (const route of world.routes) {
        if (route.kind === "bridge" && !world.bridge) continue;
        const a = world.sites.find((site) => site.id === route.a)!,
          b = world.sites.find((site) => site.id === route.b)!;
        ctx.beginPath();
        ctx.moveTo(x(a.x), y(a.y));
        ctx.quadraticCurveTo(
          x((a.x + b.x) * 0.5 + 2),
          y((a.y + b.y) * 0.5 - 5),
          x(b.x),
          y(b.y),
        );
        ctx.strokeStyle =
          route.kind === "ferry"
            ? "#718d82"
            : route.kind === "bridge"
              ? "#735a3e"
              : "#ac9f81";
        ctx.setLineDash(route.kind === "ferry" ? [3, 3] : []);
        ctx.lineWidth = route.kind === "bridge" ? 2.6 : 1.35;
        ctx.stroke();
      }
      ctx.setLineDash([]);
    };
    draw();
    const observer = new ResizeObserver(draw);
    observer.observe(canvas);
    return () => observer.disconnect();
  }, [world]);
  return (
    <>
      <div className="rf-map" aria-label="地域の地図">
        <canvas ref={ref} aria-hidden="true" />
        <span className="rf-north" aria-hidden="true">
          ↑ 北
        </span>
        {world.sites.map((site) => {
          const Icon = icons[site.id as keyof typeof icons] || MapPin;
          return (
            <button
              type="button"
              key={site.id}
              className="rf-map-pin"
              aria-pressed={selected === site.id}
              style={{ left: site.x + "%", top: site.y + "%" }}
              onClick={() => onSelect(site.id)}
            >
              <Icon size={14} />
              {site.name}
            </button>
          );
        })}
      </div>
      {world.sites.length > 6 && (
        <label className="rf-map-select">
          地図から選択
          <select value={selected} onChange={(e) => onSelect(e.target.value)}>
            {world.sites.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>
        </label>
      )}
    </>
  );
}

interface EditorProps {
  config: WorldConfig;
  onChange: (c: WorldConfig) => void;
  start: string;
  onStart: (id: string) => void;
}
export function WorldEditor({ config, onChange, start, onStart }: EditorProps) {
  const world = useMemo(() => generateWorld(config), [config]);
  const selected =
    world.sites.find((site) => site.id === start) ?? world.sites[0];
  function change<K extends keyof WorldConfig>(key: K, value: WorldConfig[K]) {
    onChange({ ...config, [key]: value });
  }
  function ruleEdit(id: string, patch: Partial<LandmarkRule>) {
    change(
      "rules",
      config.rules.map((rule) =>
        rule.id === id ? { ...rule, ...patch } : rule,
      ),
    );
  }
  const residents = world.landmarks.filter((l) => l.placeId === selected.id);
  return (
    <section className="rf-region-editor">
      <div className="rf-map-head">
        <h3>開始地点</h3>
        <button type="button" onClick={() => change("seed", randomSeed())}>
          <Shuffle size={14} /> 地形を再生成
        </button>
      </div>
      <Landscape world={world} selected={selected.id} onSelect={onStart} />
      <div className="rf-place-strip">
        <strong>
          <MapPin size={15} /> {selected.name}
        </strong>
        <span>{biomeNames[selected.biome]}</span>
      </div>
      <SiteFacts
        water={selected.water}
        market={selected.market}
        frost={selected.frost}
      />
      {residents.length > 0 && (
        <p className="rf-map-note">
          {residents.map((l) => l.name + "（" + l.npc + "）").join("・")}
        </p>
      )}
      <details className="rf-world-fold">
        <summary>地形と集落を設定</summary>
        <div className="rf-world-fields">
          <label>
            世界の種
            <input
              type="number"
              min={0}
              max={4294967295}
              value={config.seed}
              onChange={(e) =>
                change(
                  "seed",
                  Math.min(
                    4294967295,
                    Math.max(0, Math.floor(Number(e.target.value) || 0)),
                  ),
                )
              }
            />
          </label>
          <label>
            気候
            <select
              value={config.climate}
              onChange={(e) => change("climate", e.target.value as Climate)}
            >
              {Object.entries(climateNames).map(([id, s]) => (
                <option key={id} value={id}>
                  {s}
                </option>
              ))}
            </select>
          </label>
          <label>
            森の密度
            <select
              value={config.woods}
              onChange={(e) => change("woods", Number(e.target.value))}
            >
              <option value={1}>疎ら</option>
              <option value={2}>ほどほど</option>
              <option value={3}>深い森</option>
            </select>
          </label>
          <label>
            道の整備
            <select
              value={config.roads}
              onChange={(e) => change("roads", Number(e.target.value))}
            >
              <option value={1}>険しい道</option>
              <option value={2}>村道</option>
              <option value={3}>整った街道</option>
            </select>
          </label>
          <label>
            水系
            <select
              value={config.river}
              onChange={(e) =>
                change("river", e.target.value as WorldConfig["river"])
              }
            >
              <option value="stream">浅い流れ</option>
              <option value="river">広い川</option>
            </select>
          </label>
          <label>
            市場の町名
            <input
              value={config.townName}
              maxLength={18}
              onChange={(e) => change("townName", e.target.value)}
            />
          </label>
          <label>
            対岸の里名
            <input
              value={config.millName}
              maxLength={18}
              onChange={(e) => change("millName", e.target.value)}
            />
          </label>
        </div>
        <label className="rf-check">
          <input
            type="checkbox"
            checked={config.pinnedTownSeed !== null}
            onChange={(e) =>
              change("pinnedTownSeed", e.target.checked ? config.seed : null)
            }
          />{" "}
          再生成しても市場の町の位置を固定
        </label>
      </details>
      <details className="rf-world-fold">
        <summary>組織・集落・重要人物を設定（{config.rules.length}）</summary>
        {config.rules.map((rule) => {
          const actual = world.landmarks.find((l) => l.id === rule.id);
          return (
            <fieldset className="rf-landmark" key={rule.id}>
              <legend>{rule.name || "新しい拠点"}</legend>
              <div className="rf-world-fields">
                <label>
                  名称
                  <input
                    value={rule.name}
                    maxLength={20}
                    onChange={(e) =>
                      ruleEdit(rule.id, { name: e.target.value })
                    }
                  />
                </label>
                <label>
                  種類
                  <select
                    value={rule.kind}
                    onChange={(e) =>
                      ruleEdit(rule.id, {
                        kind: e.target.value as LandmarkRule["kind"],
                      })
                    }
                  >
                    {Object.entries(kinds).map(([k, v]) => (
                      <option value={k} key={k}>
                        {v}
                      </option>
                    ))}
                  </select>
                </label>
                <label>
                  重要人物
                  <input
                    value={rule.npc}
                    maxLength={16}
                    onChange={(e) => ruleEdit(rule.id, { npc: e.target.value })}
                  />
                </label>
                <label>
                  現れやすい土地
                  <select
                    value={rule.preference}
                    onChange={(e) =>
                      ruleEdit(rule.id, { preference: e.target.value as Biome })
                    }
                  >
                    {Object.entries(biomeNames).map(([k, v]) => (
                      <option value={k} key={k}>
                        {v}
                      </option>
                    ))}
                  </select>
                </label>
                <label>
                  好む気温
                  <select
                    value={rule.temperature || "any"}
                    onChange={(e) =>
                      ruleEdit(rule.id, {
                        temperature: e.target
                          .value as LandmarkRule["temperature"],
                      })
                    }
                  >
                    <option value="any">指定しない</option>
                    <option value="cold">冷涼な土地</option>
                    <option value="warm">温暖な土地</option>
                  </select>
                </label>
                <label>
                  近くの町
                  <select
                    value={rule.anchor}
                    onChange={(e) =>
                      ruleEdit(rule.id, {
                        anchor: e.target.value as LandmarkRule["anchor"],
                      })
                    }
                  >
                    <option value="village">{world.sites[0].name}</option>
                    <option value="mill">{world.sites[3].name}</option>
                  </select>
                </label>
                <label>
                  町からの距離
                  <select
                    value={rule.reach}
                    onChange={(e) =>
                      ruleEdit(rule.id, { reach: Number(e.target.value) })
                    }
                  >
                    <option value={0}>町の中</option>
                    <option value={45}>徒歩45分以内</option>
                    <option value={75}>徒歩75分以内</option>
                    <option value={180}>徒歩3時間以内</option>
                  </select>
                </label>
              </div>
              <label className="rf-check">
                <input
                  type="checkbox"
                  checked={rule.required}
                  onChange={(e) =>
                    ruleEdit(rule.id, { required: e.target.checked })
                  }
                />{" "}
                各世界に必ず一つ配置する
              </label>
              <div className="rf-rule-foot">
                <small>
                  {actual
                    ? "配置先　" +
                      world.sites.find((p) => p.id === actual.placeId)?.name
                    : "この世界では未配置"}
                </small>
                <button
                  type="button"
                  onClick={() =>
                    change(
                      "rules",
                      config.rules.filter((l) => l.id !== rule.id),
                    )
                  }
                >
                  削除
                </button>
              </div>
            </fieldset>
          );
        })}
        <button
          className="rf-world-add"
          type="button"
          disabled={config.rules.length >= 12}
          onClick={() => {
            let i = config.rules.length + 1;
            while (config.rules.some((l) => l.id === "user-" + i)) i++;
            change("rules", [
              ...config.rules,
              {
                id: "user-" + i,
                name: "丘の工房",
                npc: "ユウ",
                kind: "facility",
                required: true,
                preference: "ridge",
                anchor: "mill",
                reach: 75,
              },
            ]);
          }}
        >
          <Plus size={14} /> 拠点と人物を追加
        </button>
      </details>
    </section>
  );
}

function SiteFacts({
  water,
  market,
  frost,
}: {
  water: number;
  market: number;
  frost: number;
}) {
  return (
    <dl className="rf-site-facts">
      <div>
        <dt>水場まで</dt>
        <dd>{water}分</dd>
      </div>
      <div>
        <dt>市場まで</dt>
        <dd>{market ? market + "分" : "町内"}</dd>
      </div>
      <div>
        <dt>初霜まで</dt>
        <dd>{frost > 0 ? "約" + frost + "日" : "霜の季節"}</dd>
      </div>
    </dl>
  );
}

interface ViewProps {
  world: World;
  location: string;
  onTravel: (id: string) => void;
  onProject: (command: string) => void;
  preview?: (
    kind: string,
    target: string,
  ) => { minutes?: number; disabled?: string };
}
export function WorldView({
  world,
  location,
  onTravel,
  onProject,
  preview,
}: ViewProps) {
  const [selection, setSelection] = useState(location);
  const here = world.sites.find((s) => s.id === location) || world.sites[0];
  const target = world.sites.find((s) => s.id === selection) || here;
  const travel =
    here.id !== target.id ? preview?.("travel", target.id) : undefined;
  const commands = [
    "bridge",
    "deliver",
    ...world.landmarks.map((l) => "visit:" + l.id),
  ];
  const local = commands
    .map((cmd) => ({ cmd, info: projectInfo(world, cmd)! }))
    .filter((p) => p.info.placeId === target.id);
  return (
    <section className="rf-region-play">
      <div className="rf-map-head">
        <h3>地域の地図</h3>
        <span>
          <MapPin size={13} /> 現在地　{here.name}
        </span>
      </div>
      <Landscape world={world} selected={target.id} onSelect={setSelection} />
      <div className="rf-place-strip">
        <strong>{target.name}</strong>
        <span>{biomeNames[target.biome]}</span>
      </div>
      <SiteFacts
        water={target.water}
        market={target.market}
        frost={target.frost - world.trade.day + 1}
      />
      {here.id !== target.id && (
        <>
          <button
            type="button"
            className="rf-world-go"
            disabled={!!travel?.disabled}
            onClick={() => onTravel(target.id)}
          >
            {target.name}へ移動する（
            {travel?.minutes ?? travelMinutes(world, here.id, target.id)}分）
          </button>
          {travel?.disabled && (
            <small className="rf-map-note">{travel.disabled}</small>
          )}
        </>
      )}
      {world.landmarks
        .filter((l) => l.placeId === target.id)
        .map((l) => (
          <p className="rf-map-note" key={l.id}>
            <Flag size={14} />
            {l.name}　{kinds[l.kind]}・{l.npc}　
            {l.trust ? "信用 " + l.trust : "初対面"}
          </p>
        ))}
      {local.map(({ cmd, info }) => {
        const job =
          here.id === target.id ? preview?.("project", cmd) : undefined;
        const reason = !info.allowed ? info.reason : job?.disabled;
        return (
          <div className="rf-regional-work" key={cmd}>
            <div>
              <b>{info.label}</b>
              <small>
                {job?.minutes ?? info.minutes}分
                {info.wood > 0 ? " ・ 木材" + info.wood : ""}
                {reason ? " ・ " + reason : ""}
              </small>
            </div>
            {here.id === target.id && (
              <button
                type="button"
                disabled={!!reason}
                onClick={() => onProject(cmd)}
              >
                取りかかる
              </button>
            )}
          </div>
        );
      })}
      <details className="rf-world-fold" open>
        <summary>商人の往来</summary>
        <p className="rf-map-note">
          今朝の道　
          {world.trade.road
            .map((id) => places(world).find((s) => s.id === id)?.name)
            .join(" → ")}
        </p>
        <div className="rf-world-totals">
          <span>
            市場の在庫 <b>{world.trade.stock}</b>
          </span>
          <span>
            渡し利用 <b>{world.trade.ferry}</b>
          </span>
          <span>
            橋の利用 <b>{world.trade.bridge}</b>
          </span>
        </div>
      </details>
    </section>
  );
}
