import { getPresentEncounterAt } from "./encounters";
import type { GameState, LocationId } from "./types";

export type SleepSite = {
  id: string;
  name: string;
  location: LocationId;
  kind: "base" | "travel";
  energyPerMinute: number;
  hpPerMinute: number;
  healsWounds: boolean;
  description: string;
};

const baseSite = (location: LocationId, name: string): SleepSite => ({
  id: `base-${location}`, name, location, kind: "base",
  energyPerMinute: 0.2, hpPerMinute: 0.04, healsWounds: true,
  description: "拠点で眠れる場所。食事と途中の仕事を確かめてから休めます。",
});

/** Static shelter profiles do not turn a travelling place into a base. */
export const SLEEP_SITES: readonly Readonly<SleepSite>[] = Object.freeze([
  baseSite("home", "共同の居間"),
  baseSite("kitchen", "小さな台所"),
  baseSite("bedroom", "寝床と私室"),
  baseSite("garden", "裏庭"),
  {
    id: "lodge-bunk", name: "舟宿の寝床", location: "lodge", kind: "travel",
    energyPerMinute: 0.2, hpPerMinute: 0.04, healsWounds: true,
    description: "板間の寝床。4時間以上まとまって眠れば傷も休まり、目覚めたら舟宿で料理や木彫りを続けられます。",
  },
  {
    id: "village-rest", name: "集落の休み所", location: "village", kind: "travel",
    energyPerMinute: 0.16, hpPerMinute: 0.02, healsWounds: false,
    description: "集落の端の雨よけで体を休められます。食事と手当用品は自分で持ち込みます。",
  },
  {
    id: "woodland-rest", name: "木陰の雨よけ", location: "shelter", kind: "travel",
    energyPerMinute: 0.16, hpPerMinute: 0.02, healsWounds: false,
    description: "石垣沿いの低い雨よけで眠れます。食事と手当用品は自分で持ち込みます。",
  },
].map((site) => Object.freeze(site as SleepSite)));

/** Reading a site never shares writable configuration or creates saved state. */
export function getSleepSite(location: LocationId): SleepSite | undefined {
  const site = SLEEP_SITES.find((candidate) => candidate.location === location);
  return site ? { ...site } : undefined;
}

/** Runtime eligibility is separate from hunger, clock shortcuts and save history. */
export function inspectSleep(s: GameState, residentId: string): { site?: SleepSite; error?: string } {
  const resident = s.residents.find((person) => person.id === residentId);
  if (!resident) return { error: "眠る住民が見つかりません。" };
  const site = getSleepSite(resident.location);
  const fail = (error: string) => ({ ...(site ? { site } : {}), error });
  if (s.ended) return fail("この試行は終了しています。保存から再開してください。");
  if (resident.hp <= 0)
    return fail(`${resident.name}は意識を失っています。先に救助と手当を確認してください。`);
  if (!site && resident.location === "reedbank")
    return fail("上流の葦原では眠れません。葦原から小道を進むと、舟宿の工房の寝床で休めます。");
  if (!site)
    return fail(`${resident.name}のいる場所には眠れる雨よけがありません。近隣の集落か木陰の迂回路へ移動するか、拠点へ帰ってください。`);
  if ((getPresentEncounterAt(s, resident.location)?.hp ?? 0) > 0)
    return fail(`${resident.name}のいる場所には交戦の危険があります。安全な場所へ移動してから眠ってください。`);
  if (site.kind === "travel") {
    if ([resident.action, resident.suspended].some((action) => action
      && ["move", "rescue", "attack", "defend"].includes(action.kind)))
      return fail(`${resident.name}には移動・救助・交戦の指示があります。終えるか取り消してから眠ってください。`);
    if (resident.hp <= 35 && s.residents.some((carrier) => carrier.id !== resident.id && carrier.hp > 0
      && carrier.location === resident.location && [carrier.action, carrier.suspended]
        .some((action) => action?.kind === "rescue" && action.target === resident.id)))
      return fail(`${resident.name}は救助・運搬中です。運搬を終えるか、救助する住民の指示を取り消してから眠ってください。`);
  }
  return { site };
}
