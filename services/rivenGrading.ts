// Current Riven roll grades, checked against Tome-Wyrm’s post-44.1.3 calculator.

import { withScope } from "./logger";
import * as rivenData from "./rivenData";
import {
  NUM_BUFFS_ATTEN,
  NUM_BUFFS_CURSE_ATTEN,
  SPECIFIC_FIT_ATTEN,
  BASE_DRAIN,
  NON_PERCENTAGE_TAGS,
} from "./rivenConstants";
import { getGoodRolls, type GoodRollData } from "./rivenBestAttributes";
import { lerp } from "../config/shared/numeric";
import { rivenClassForType, rivenRollInterval, rivenStatForName } from "./rivenStatModel";

const log = withScope("rivenGrading");

interface GradedStat {
  name: string;
  positive: boolean;
  displayPositive?: boolean;
  value: number | null;
  multiplier?: boolean;
  grade: string;
  rollFloat: number;
}

export interface RivenGradeResult {
  stats: GradedStat[];
  overallGrade: string;
  /** Attribute-based riven quality: "Great" | "Good" | "OK" | "Bad" */
  attributeGrade: string;
}

/** Rivens are rank 8 (lvl 0..8). */
export const MAX_RIVEN_MOD_RANK = 8;

/** RivenParser.js thresholds map lerp(-10, 10, rollFloat) to letter grades. */
const GRADE_THRESHOLDS: { min: number; grade: string }[] = [
  { min: 9.5, grade: "S" },
  { min: 7.5, grade: "A+" },
  { min: 5.5, grade: "A" },
  { min: 3.5, grade: "A-" },
  { min: 1.5, grade: "B+" },
  { min: -1.5, grade: "B" },
  { min: -3.5, grade: "B-" },
  { min: -5.5, grade: "C+" },
  { min: -7.5, grade: "C" },
  { min: -9.5, grade: "C-" },
];

// Curses are graded by magnitude too: larger rolls produce stronger splice parents.
export function floatToGrade(rollFloat: number, _isCurse = false): string {
  const score = lerp(-10, 10, rollFloat);
  for (const { min, grade } of GRADE_THRESHOLDS) {
    if (score >= min - 1e-9) return grade;
  }
  return "F";
}

/** Inverts RivenParser.js's buff formula for percentage or raw special-stat values.
 * Forward: base * (1.5*disp*10) * 1.25^curses * lerp(0.9,1.1,roll) * buffsAtten * (lvl+1). */
export function unparseBuff(
  displayedValue: number,
  baseValue: number,
  disposition: number,
  numBuffs: number,
  numCurses: number,
  tag?: string,
  lvl: number = MAX_RIVEN_MOD_RANK,
): number {
  const buffsAtten = NUM_BUFFS_ATTEN[Math.min(numBuffs, NUM_BUFFS_ATTEN.length - 1)];
  const curseAtten = Math.pow(1.25, numCurses);
  const attenuation = SPECIFIC_FIT_ATTEN * disposition * BASE_DRAIN;

  let value: number;
  if (tag && NON_PERCENTAGE_TAGS.has(tag)) {
    value = displayedValue;
  } else {
    value = displayedValue / 100;
  }

  if (baseValue === 0 || attenuation === 0 || buffsAtten === 0 || curseAtten === 0) return 0.5;

  value /= lvl + 1;
  value /= buffsAtten;
  value /= curseAtten;
  value /= attenuation;
  // OCR values are unsigned; abs(baseValue) handles negative-base stats such as recoil.
  value /= Math.abs(baseValue);

  // value is now lerp(0.9, 1.1, rollFloat) -> invert
  return (value - 0.9) / 0.2;
}

/** Inverts RivenParser.js's curse formula after OCR has removed the displayed sign.
 * Forward: -base * (1.5*disp*10) * lerp(0.9,1.1,roll) * curseAtten * buffsAtten * (lvl+1). */
export function unparseCurse(
  displayedValue: number,
  baseValue: number,
  disposition: number,
  numBuffs: number,
  numCurses: number,
  tag?: string,
  lvl: number = MAX_RIVEN_MOD_RANK,
): number {
  const attenuation = SPECIFIC_FIT_ATTEN * disposition * BASE_DRAIN;
  // Note the swapped indexing: buffs table by curse count, curse table by buff count
  const cursesInBuffTable = NUM_BUFFS_ATTEN[Math.min(numCurses, NUM_BUFFS_ATTEN.length - 1)];
  const buffsInCurseTable =
    NUM_BUFFS_CURSE_ATTEN[Math.min(numBuffs, NUM_BUFFS_CURSE_ATTEN.length - 1)];

  let value: number;
  if (tag && NON_PERCENTAGE_TAGS.has(tag)) {
    value = Math.abs(displayedValue);
  } else {
    value = Math.abs(displayedValue) / 100;
  }

  if (baseValue === 0 || attenuation === 0 || cursesInBuffTable === 0 || buffsInCurseTable === 0)
    return 0.5;

  value /= lvl + 1;
  value /= cursesInBuffTable;
  value /= buffsInCurseTable;
  value /= attenuation;
  value /= Math.abs(baseValue);

  return (value - 0.9) / 0.2;
}

interface ScannedStat {
  name: string;
  positive: boolean;
  displayPositive?: boolean;
  value: number | null;
  multiplier?: boolean;
}

// Sibling tags an OCR-garbled stat name can be: "+190.2% Critical Damage" on a
// melee is really Melee Damage.
const STAT_CONFUSION_SIBLINGS: Record<string, string[]> = {
  WeaponDamageAmountMod: ["WeaponMeleeDamageMod", "WeaponCritDamageMod"],
  WeaponMeleeDamageMod: ["WeaponDamageAmountMod", "WeaponCritDamageMod"],
  WeaponCritDamageMod: ["WeaponMeleeDamageMod", "WeaponDamageAmountMod"],
  WeaponCritChanceMod: ["SlideAttackCritChanceMod", "WeaponStunChanceMod"],
  SlideAttackCritChanceMod: ["WeaponCritChanceMod"],
  WeaponStunChanceMod: ["WeaponCritChanceMod"],
};

// Riven type data lists both damage tags with identical bases; cards use one by class.
function weaponDamageTag(tag: string, isMelee: boolean): string {
  if (isMelee && tag === "WeaponDamageAmountMod") return "WeaponMeleeDamageMod";
  if (!isMelee && tag === "WeaponMeleeDamageMod") return "WeaponDamageAmountMod";
  return tag;
}

// Display values round to 0.1%, so a legitimate min/max roll can sit a hair outside [0,1].
const FIT_TOLERANCE = 0.02;
const CORRECTION_MISFIT_THRESHOLD = 0.1;

// A riven card carries at most three buffs and one curse.
const MAX_RIVEN_BUFFS = 3;
const MAX_RIVEN_CURSES = 1;

// Both counts scale every displayed value, so an OCR line the scan dropped reads
// the survivors high; the scanned counts are a lower bound.
function plausibleStatCounts(numBuffs: number, numCurses: number): [number, number][] {
  const counts: [number, number][] = [];
  for (let buffs = numBuffs; buffs <= Math.max(numBuffs, MAX_RIVEN_BUFFS); buffs++) {
    for (let curses = numCurses; curses <= Math.max(numCurses, MAX_RIVEN_CURSES); curses++) {
      counts.push([buffs, curses]);
    }
  }
  return counts;
}

export function correctScannedStats(
  weaponName: string,
  stats: ScannedStat[],
): { stats: ScannedStat[]; corrections: number } {
  const baseDisposition = rivenData.getWeaponDisposition(weaponName);
  const rivenTypeKey = rivenData.resolveRivenType(weaponName);
  if (baseDisposition == null || !rivenTypeKey || stats.length === 0) {
    return { stats, corrections: 0 };
  }

  const isMelee = rivenData.isMeleeWeapon(weaponName);
  const statCounts = plausibleStatCounts(
    stats.filter((s) => s.positive).length,
    stats.filter((s) => !s.positive).length,
  );
  const dispositions = [
    baseDisposition,
    ...rivenData.getFamilyVariants(weaponName).map((v) => v.disposition),
  ];

  // Null when the tag cannot roll on this weapon at all.
  const violationFor = (tag: string, stat: ScannedStat, displayedValue: number): number | null => {
    const entry = rivenData.findUpgradeEntry(rivenTypeKey, tag);
    if (!entry) return null;
    if (stat.positive ? !entry.canBeBuff : !entry.canBeCurse) return null;
    let best = Infinity;
    for (const disp of dispositions) {
      for (const [numBuffs, numCurses] of statCounts) {
        // A chat-linked card shows its values at the mod's own rank, not max.
        for (let lvl = 0; lvl <= MAX_RIVEN_MOD_RANK; lvl++) {
          const f = stat.positive
            ? unparseBuff(displayedValue, entry.baseValue, disp, numBuffs, numCurses, tag, lvl)
            : unparseCurse(displayedValue, entry.baseValue, disp, numBuffs, numCurses, tag, lvl);
          best = Math.min(best, Math.max(0, f - 1) + Math.max(0, -f));
        }
      }
    }
    return best;
  };

  let corrections = 0;

  const measured = stats.map((original) => {
    const scannedTag = rivenData.statNameToTag(original.name);
    let stat = original;
    let tag = scannedTag;
    let renamedFrom: string | null = null;
    if (tag) {
      const normalizedTag = weaponDamageTag(tag, isMelee);
      if (normalizedTag !== tag) {
        renamedFrom = stat.name;
        stat = { ...stat, name: rivenData.getStatDisplayName(normalizedTag, isMelee) };
        tag = normalizedTag;
      }
    }

    const value = stat.value;
    if (tag == null || value == null || !Number.isFinite(value) || stat.multiplier) {
      return { original, stat, renamedFrom, tag, value: null, violation: null, misfits: false };
    }
    const violation = violationFor(tag, stat, value);
    return {
      original,
      stat,
      renamedFrom,
      tag,
      value,
      violation,
      misfits: violation == null || violation > CORRECTION_MISFIT_THRESHOLD,
    };
  });

  const misfitting = measured.filter((m) => m.misfits);
  if (misfitting.length > 1) {
    const detail = misfitting
      .map(
        (m) =>
          `"${m.original.name}" ${m.violation == null ? "cannot roll" : m.violation.toFixed(3)}`,
      )
      .join(", ");
    log.warn(
      `[RivenGrade] ${misfitting.length} of ${measured.length} stats are out of range for ` +
        `"${weaponName}" (${detail}) - weapon or disposition is wrong, keeping the scanned names`,
    );
    return { stats: measured.map((m) => m.original), corrections };
  }

  for (const m of measured) {
    if (!m.renamedFrom) continue;
    log.info(
      `[RivenGrade] "${m.renamedFrom}" cannot roll on "${weaponName}" - renamed "${m.stat.name}"`,
    );
    corrections++;
  }

  const corrected = measured.map(({ stat, tag, value, violation, misfits }) => {
    if (!misfits || tag == null || value == null) return stat;

    const siblings = STAT_CONFUSION_SIBLINGS[tag] ?? [];
    const fitTags = [
      ...new Set(siblings.map((sibling) => weaponDamageTag(sibling, isMelee))),
    ].filter((sibling) => {
      if (sibling === tag) return false;
      const v = violationFor(sibling, stat, value);
      return v != null && v <= FIT_TOLERANCE;
    });

    if (fitTags.length === 1) {
      const newName = rivenData.getStatDisplayName(fitTags[0], isMelee);
      log.info(
        `[RivenGrade] "${stat.name}" ${stat.positive ? "+" : "-"}${value} misfits ` +
          `"${weaponName}" - corrected to "${newName}"`,
      );
      corrections++;
      return { ...stat, name: newName };
    }

    if (violation != null) {
      log.info(
        `[RivenGrade] "${stat.name}" ${stat.positive ? "+" : "-"}${value} is out of ` +
          `range for "${weaponName}" (violation ${violation.toFixed(3)}) - kept as scanned`,
      );
    }
    return stat;
  });

  return { stats: corrected, corrections };
}

type AlecaAttrGrade = "Decisive" | "Good" | "NotHelping" | "Bad";

function gradeFromGoodRolls(
  data: GoodRollData,
  goodTags: string[],
  badTags: string[],
): { positive: AlecaAttrGrade[]; negative: AlecaAttrGrade[]; overall: string } {
  const positive: AlecaAttrGrade[] = goodTags.map(() => "NotHelping");
  const negative: AlecaAttrGrade[] = badTags.map(() => "NotHelping");

  for (let i = 0; i < badTags.length; i++) {
    const tag = badTags[i];
    if (data.acceptedBadAttrs.includes(tag)) {
      negative[i] = "Good";
    } else if (data.goodAttrs.some((g) => g.mandatory.includes(tag) || g.optional.includes(tag))) {
      negative[i] = "Bad";
    } else {
      negative[i] = "NotHelping";
    }
  }

  for (let i = 0; i < goodTags.length; i++) {
    const tag = goodTags[i];
    if (data.goodAttrs.some((g) => g.mandatory.includes(tag))) {
      positive[i] = "Decisive";
    } else if (data.goodAttrs.some((g) => g.optional.includes(tag))) {
      positive[i] = "Good";
    } else {
      positive[i] = "NotHelping";
    }
  }

  const goodSet = new Set(goodTags);
  const matches = data.goodAttrs.filter((g) => {
    if (!g.mandatory.every((m) => goodSet.has(m))) return false;
    const allowed = new Set([...g.mandatory, ...g.optional]);
    return goodTags.every((t) => allowed.has(t));
  });
  const flag = matches.length > 0;
  const num = positive.filter((p) => p === "Decisive" || p === "Good").length;
  const hasBadNeg = negative.some((n) => n === "Bad");
  const hasNotHelpingNeg = negative.some((n) => n === "NotHelping");
  const hasAnyNeg = negative.length > 0;

  let overall: string;
  if (hasBadNeg) {
    overall = (flag && num >= 2) || num >= 3 ? "OK" /* HasPotential */ : "Bad";
  } else if (hasNotHelpingNeg) {
    if (flag || num >= 2) overall = "Good";
    else if (num >= 1) overall = "OK"; /* HasPotential */
    else overall = "Bad";
  } else if (flag) {
    overall = num >= 2 && hasAnyNeg ? "Great" /* Perfect */ : "Good";
  } else if (num >= 2) {
    overall = "Good";
  } else if (num >= 1) {
    overall = "OK";
  } else {
    overall = "Bad";
  }
  return { positive, negative, overall };
}

/** Scores 44bananas' per-weapon good-roll data; unknown weapons return "?". */
export function computeAttributeGrade(
  stats: { name: string; positive: boolean }[],
  weaponName: string,
): string {
  if (
    stats.some(
      (stat) => rivenData.statNameToTag(stat.name) === null || rivenStatForName(stat.name)?.spliced,
    )
  )
    return "?";
  const positives = stats.filter((s) => s.positive);
  const negatives = stats.filter((s) => !s.positive);

  const data = getGoodRolls(weaponName);
  if (!data) return "?";

  const goodTags = positives.map((s) => rivenData.statNameToTag(s.name) ?? s.name);
  const badTags = negatives.map((s) => rivenData.statNameToTag(s.name) ?? s.name);
  return gradeFromGoodRolls(data, goodTags, badTags).overall;
}

/** A stated rank is authoritative. For an OCR card without a rank, infer one
 *  only when at least two supported values agree on it. Never refit disposition
 *  or invent missing traits to turn an impossible roll into a high grade. */
export function gradeRiven(
  weaponName: string,
  stats: ScannedStat[],
  modRank?: number | null,
): RivenGradeResult | null {
  if (stats.length === 0) return null;
  const type = rivenData.resolveRivenType(weaponName);
  const cls = type ? rivenClassForType(type) : null;
  if (!cls) return null;
  const buffs = stats.filter((stat) => stat.positive).length;
  const curses = stats.length - buffs;
  if (buffs > 3 || curses > 1) return null;
  const prepared = stats.map((stat) => {
    const model = rivenStatForName(stat.name);
    let shown = stat.value;
    if (model && shown != null) {
      if (model.unit === "mult") {
        // OCR may read faction damage as a multiplier or as a signed percentage.
        shown = stat.multiplier ? shown : 1 + (stat.positive ? shown : -shown) / 100;
      } else {
        const inverted = model.id === "recoil";
        shown = Math.abs(shown) * (stat.positive !== inverted ? 1 : -1);
      }
    }
    return { stat, model, shown };
  });
  const known = prepared.filter((p) => p.model && p.shown != null && Number.isFinite(p.shown));
  const interval = (p: (typeof prepared)[number], rank: number) =>
    p.model && p.shown != null
      ? rivenRollInterval(p.model, cls, buffs, curses, p.stat.positive, p.shown, rank)
      : null;
  const statedRank = modRank != null && Number.isInteger(modRank) && modRank >= 0 && modRank <= 8;
  let rank = statedRank ? modRank! : 8;
  if (!statedRank && known.length >= 2 && !known.every((p) => interval(p, rank)?.possible)) {
    for (let candidate = 7; candidate >= 0; candidate--) {
      if (!known.every((p) => interval(p, candidate)?.possible)) continue;
      rank = candidate;
      log.info(`[RivenGrade] "${weaponName}" values match rank ${rank}`);
      break;
    }
  }
  const grades: GradedStat[] = [];
  let sum = 0;
  let count = 0;
  const unique = new Set(prepared.map((p) => p.model?.id ?? p.stat.name.toLowerCase()));
  for (const p of prepared) {
    const roll = unique.size === stats.length ? interval(p, rank) : null;
    if (!roll?.possible) {
      grades.push({ ...p.stat, grade: "?", rollFloat: 0.5 });
      continue;
    }
    const lowGrade = floatToGrade(roll.low);
    const highGrade = floatToGrade(roll.high);
    grades.push({
      ...p.stat,
      rollFloat: roll.mid,
      grade: lowGrade === highGrade ? lowGrade : `${lowGrade} / ${highGrade}`,
    });
    sum += roll.mid;
    count++;
  }
  return {
    stats: grades,
    overallGrade: count ? floatToGrade(sum / count) : "?",
    attributeGrade: computeAttributeGrade(stats, weaponName),
  };
}
