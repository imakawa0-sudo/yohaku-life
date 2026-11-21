export const skillNames = {
  wood: "木工",
  cook: "料理",
  trade: "交渉",
  care: "手当て",
} as const;
export type Skill = keyof typeof skillNames;
export const skillKeys = Object.keys(skillNames) as Skill[];
export const personalityNames = {
  social: "人と過ごすのが好き",
  quiet: "一人で過ごすのが好き",
  curious: "新しいものが好き",
} as const;
export const bodyNames = {
  ordinary: "標準",
  cold: "寒さに弱い",
  sturdy: "頑健",
} as const;
export const backgroundNames = {
  artisan: "職人の家",
  trader: "行商の家",
  local: "土地の暮らし",
} as const;
export const appearanceOptions = {
  face: { oval: "面長", round: "丸顔", angular: "角張った輪郭" },
  skin: {
    ivory: "淡い杏色",
    peach: "桃色がかった肌",
    wheat: "小麦色",
    bronze: "赤褐色",
    umber: "深い褐色",
  },
  hair: {
    crop: "短髪",
    bob: "おかっぱ",
    wave: "長い髪",
    knot: "まとめ髪",
    braid: "三つ編み",
  },
  hairColor: {
    ink: "墨黒",
    chestnut: "栗色",
    ash: "灰褐色",
    honey: "亜麻色",
    silver: "白銀",
  },
  age: { young: "若年", adult: "壮年", elder: "老年" },
  build: { slight: "細身", medium: "中肉", broad: "がっしり" },
  eyes: { soft: "柔らかな目", straight: "切れ長の目", open: "丸い目" },
  mark: {
    none: "なし",
    freckles: "そばかす",
    scar: "頬の傷",
    glasses: "丸眼鏡",
  },
  clothing: {
    shirt: "襟つきシャツ",
    apron: "仕事着と前掛け",
    wrap: "巻き襟の上着",
    coat: "旅の外套",
  },
  dye: {
    moss: "苔色",
    indigo: "藍色",
    brick: "弁柄色",
    rust: "黄土色",
    plum: "葡萄色",
    flax: "生成り",
  },
} as const;
export type Appearance = {
  [K in keyof typeof appearanceOptions]: keyof (typeof appearanceOptions)[K];
};
export interface Persona {
  id: string;
  name: string;
  appearance: Appearance;
  personality: keyof typeof personalityNames;
  body: keyof typeof bodyNames;
  background: keyof typeof backgroundNames;
  likes: Skill;
  dislikes: Skill | null;
  skills: Record<Skill, number>;
  talent: Skill;
}
const givenNames = [
  "ユイ",
  "シオン",
  "ツムギ",
  "アサ",
  "スイ",
  "ナオ",
  "エマ",
  "アオ",
  "ハルカ",
  "イツキ",
  "ミナト",
  "チセ",
  "リツ",
  "ソウ",
  "コハル",
  "トキ",
];
export const startingSkills: Record<
  Persona["background"],
  Record<Skill, number>
> = {
  artisan: { wood: 4, cook: 1, trade: 1, care: 0 },
  trader: { wood: 0, cook: 1, trade: 4, care: 1 },
  local: { wood: 1, cook: 2, trade: 0, care: 3 },
};
function randomSource(seed: number) {
  let state = seed >>> 0;
  return () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state / 4294967296;
  };
}
function pick<T>(items: readonly T[], random: () => number): T {
  return items[Math.floor(random() * items.length)];
}
function option<T extends object>(values: T, random: () => number): keyof T {
  return pick(Object.keys(values) as (keyof T)[], random);
}
export function makePersona(index: number, seed: number): Persona {
  const random = randomSource((seed ^ Math.imul(index + 1, 2654435761)) >>> 0);
  const name = pick(givenNames, random);
  const appearance: Appearance = {
    face: option(appearanceOptions.face, random),
    skin: option(appearanceOptions.skin, random),
    hair: option(appearanceOptions.hair, random),
    hairColor: option(appearanceOptions.hairColor, random),
    age: option(appearanceOptions.age, random),
    build: option(appearanceOptions.build, random),
    eyes: option(appearanceOptions.eyes, random),
    mark: option(appearanceOptions.mark, random),
    clothing: option(appearanceOptions.clothing, random),
    dye: option(appearanceOptions.dye, random),
  };
  const personality = option(personalityNames, random);
  const body = option(bodyNames, random);
  const background = option(backgroundNames, random);
  const likes = pick(skillKeys, random);
  const dislikes = pick(
    [...skillKeys.filter((key) => key !== likes), null],
    random,
  );
  const talent = pick(skillKeys, random);
  return {
    id: `person-${index + 1}`,
    name,
    appearance,
    personality,
    body,
    background,
    likes,
    dislikes,
    talent,
    skills: { ...startingSkills[background] },
  };
}
export function freshSeed(): number {
  return crypto.getRandomValues(new Uint32Array(1))[0];
}
function record(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}
function isKey(options: object, value: unknown): boolean {
  return typeof value === "string" && Object.hasOwn(options, value);
}
export function isPersona(value: unknown): value is Persona {
  if (!record(value) || !record(value.appearance) || !record(value.skills))
    return false;
  const { appearance, skills } = value;
  return (
    typeof value.id === "string" &&
    value.id.length > 0 &&
    typeof value.name === "string" &&
    value.name.trim().length > 0 &&
    value.name.length <= 48 &&
    Object.entries(appearanceOptions).every(([key, choices]) =>
      isKey(choices, appearance[key]),
    ) &&
    isKey(personalityNames, value.personality) &&
    isKey(bodyNames, value.body) &&
    isKey(backgroundNames, value.background) &&
    isKey(skillNames, value.likes) &&
    isKey(skillNames, value.talent) &&
    (value.dislikes === null ||
      (isKey(skillNames, value.dislikes) && value.dislikes !== value.likes)) &&
    skillKeys.every(
      (key) =>
        typeof skills[key] === "number" &&
        Number.isFinite(skills[key]) &&
        (skills[key] as number) >= 0,
    )
  );
}
