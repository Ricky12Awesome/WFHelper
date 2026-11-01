// Post-44.1.3 coefficients and float math, checked against Tome-Wyrm's calculator.
// Data provenance is in rivenStatModel.json; MIT notice is in assets/licenses.
import data from "../config/shared/rivenStatModel.json";
import { statTagToDisplayName } from "../config/shared/rivenStatDisplayNames";

export type RivenWeaponClass = "rifle" | "shotgun" | "pistol" | "archgun" | "melee";
export interface RivenStatModel {
  id: string;
  name: string;
  meleeName?: string;
  b: Partial<Record<RivenWeaponClass, number>>;
  unit: "pct" | "pctNeg" | "mult" | "sec" | "m" | "flat";
  polarity: "both" | "posOnly" | "negOnly";
  spliced: boolean;
  prefix: string | null;
  suffix: string | null;
}

export const RIVEN_DISPOSITION = 1.2;
const RIVEN_STAT_MODELS = data.stats as RivenStatModel[];
const normalizeName = (name: string): string => name.toLowerCase().replace(/[^a-z]/g, "");
const byName = new Map(
  RIVEN_STAT_MODELS.flatMap((stat) =>
    [stat.name, stat.meleeName]
      .filter((name): name is string => !!name)
      .map((name) => [normalizeName(name), stat] as const),
  ),
);
byName.set("recoil", byName.get("weaponrecoil")!);
byName.set("flightspeed", byName.get("projectilespeed")!);
byName.set("slideattack", byName.get("criticalchanceforslideattack")!);

export function rivenStatForName(name: string): RivenStatModel | null {
  return byName.get(normalizeName(name)) ?? null;
}

export function rivenStatForTag(tag: string): RivenStatModel | null {
  return rivenStatForName(statTagToDisplayName(tag));
}

export function rivenClassForType(type: string): RivenWeaponClass | null {
  if (/ShotgunRandomMod/.test(type)) return "shotgun";
  if (/ModularPistolRandomMod|PistolRandomMod/.test(type)) return "pistol";
  if (/ArchgunRandomMod/.test(type)) return "archgun";
  if (/MeleeWeaponRandomMod|ModularMeleeRandomMod/.test(type)) return "melee";
  if (/RifleRandomMod/.test(type)) return "rifle";
  return null;
}

/** Shape multipliers, including the sign of a curse. Invalid/partial cards have no shape. */
function rivenShapeMultiplier(buffs: number, curses: number, positive: boolean): number | null {
  if ((buffs !== 2 && buffs !== 3) || (curses !== 0 && curses !== 1)) return null;
  if (!positive) return curses === 1 ? (buffs === 2 ? -0.495 : -0.75) : null;
  return buffs === 2 ? (curses ? 1.2375 : 0.99) : curses ? 0.9375 : 0.75;
}

/** Game arithmetic rounds each multiplication to float32, before display formatting. */
export function rivenDisplayValue(
  stat: RivenStatModel,
  cls: RivenWeaponClass,
  buffs: number,
  curses: number,
  positive: boolean,
  roll: number,
  rank = 8,
): number | null {
  const base = stat.b[cls];
  const shape = rivenShapeMultiplier(buffs, curses, positive);
  if (
    base === undefined ||
    shape === null ||
    (positive ? stat.polarity === "negOnly" : stat.polarity === "posOnly")
  )
    return null;
  const f = Math.fround;
  const raw = f(
    f(f(f(f(base * 10) * (rank + 1)) * RIVEN_DISPOSITION) * shape) * f(0.9 + 0.2 * roll),
  );
  if (stat.unit === "pct") return raw * 100;
  if (stat.unit === "pctNeg") return -raw * 100;
  if (stat.unit === "mult") return 1 + raw;
  return raw;
}

/** The interval of rolls that can round to a card's shown value; impossible values stay unknown. */
export function rivenRollInterval(
  stat: RivenStatModel,
  cls: RivenWeaponClass,
  buffs: number,
  curses: number,
  positive: boolean,
  shown: number,
  rank = 8,
): { low: number; high: number; mid: number; possible: boolean } | null {
  const start = rivenDisplayValue(stat, cls, buffs, curses, positive, 0, rank);
  const end = rivenDisplayValue(stat, cls, buffs, curses, positive, 1, rank);
  if (start === null || end === null || start === end || !Number.isFinite(shown)) return null;
  const halfStep = stat.unit === "mult" ? 0.005 : 0.05;
  const a = (shown - halfStep - start) / (end - start);
  const b = (shown + halfStep - start) / (end - start);
  const low = Math.max(0, Math.min(1, Math.min(a, b)));
  const high = Math.max(0, Math.min(1, Math.max(a, b)));
  return { low, high, mid: (low + high) / 2, possible: Math.max(a, b) >= 0 && Math.min(a, b) <= 1 };
}
