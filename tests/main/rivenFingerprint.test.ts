import { describe, expect, it } from "vitest";

import { decodeAllRivens } from "../../services/rivenFingerprint";

const MAX_ROLL_INT = 0x3fffffff;

function rivenInventory(lvl?: number): Record<string, unknown> {
  return {
    Upgrades: [
      {
        ItemType: "/Lotus/Upgrades/Mods/Randomized/LotusRifleRandomModRare",
        ItemId: { $oid: "aaaaaaaaaaaaaaaaaaaaaaa1" },
        UpgradeFingerprint: JSON.stringify({
          compat: "/Lotus/Weapons/Tenno/Rifle/Rifle",
          lim: 0,
          lvlReq: 9,
          lvl,
          rerolls: 2,
          pol: "AP_ATTACK",
          buffs: [{ Tag: "WeaponFireDamageMod", Value: Math.round(MAX_ROLL_INT * 0.72) }],
          curses: [{ Tag: "WeaponFireRateMod", Value: Math.round(MAX_ROLL_INT * 0.3) }],
        }),
      },
    ],
  };
}

function fingerprintInventory(options: {
  type: string;
  compat: string;
  lvl: number;
  buffs: { Tag: string; Value: number }[];
  curses: { Tag: string; Value: number }[];
}): Record<string, unknown> {
  return {
    Upgrades: [
      {
        ItemType: `/Lotus/Upgrades/Mods/Randomized/${options.type}`,
        ItemId: { $oid: "aaaaaaaaaaaaaaaaaaaaaaa2" },
        UpgradeFingerprint: JSON.stringify({
          compat: options.compat,
          lim: 0,
          lvlReq: 9,
          lvl: options.lvl,
          rerolls: 2,
          pol: "AP_ATTACK",
          buffs: options.buffs,
          curses: options.curses,
        }),
      },
    ],
  };
}

function assertDisplayValues(
  stats: { name: string; positive: boolean; displayValue: number }[],
  expected: { name: string; positive: boolean; displayValue: number }[],
): void {
  expect(
    stats.map(({ name, positive, displayValue }) => ({ name, positive, displayValue })),
  ).toEqual(expected);
}

describe("decodeAllRivens rank-8 values", () => {
  it("treats an omitted level as unranked without changing the max-rank projection", () => {
    const omitted = decodeAllRivens(rivenInventory()).unveiled[0];
    const unranked = decodeAllRivens(rivenInventory(0)).unveiled[0];
    const maxed = decodeAllRivens(rivenInventory(8)).unveiled[0];

    expect(omitted.currentRank).toBe(0);
    expect(omitted.stats).toEqual(unranked.stats);
    expect(omitted.stats.map((stat) => stat.maxRankValue)).toEqual(
      maxed.stats.map((stat) => stat.displayValue),
    );
    expect(omitted.masteryReq).toBe(9);
    expect(omitted.statPerfectness).toBe(maxed.statPerfectness);
    expect(omitted.overallGrade).toBe(maxed.overallGrade);
    expect(omitted.attributeGrade).toBe(maxed.attributeGrade);
    expect(maxed.currentRank).toBe(8);
  });

  it.each([0, 1, 4, 7, 8])("preserves an explicit rank %i", (rank) => {
    const riven = decodeAllRivens(rivenInventory(rank)).unveiled[0];
    expect(riven.currentRank).toBe(rank);
    expect(riven.maxRank).toBe(8);
  });

  it("decodes listing values at every selectable rank without scaling rounded values", () => {
    const source = decodeAllRivens(rivenInventory(8)).unveiled[0];
    for (let rank = 0; rank <= 8; rank += 1) {
      const atRank = decodeAllRivens(rivenInventory(rank)).unveiled[0];
      expect(source.stats.map((stat) => stat.rankValues?.[rank])).toEqual(
        atRank.stats.map((stat) => stat.displayValue),
      );
      expect(atRank.overallGrade).toBe(source.overallGrade);
      expect(atRank.attributeGrade).toBe(source.attributeGrade);
    }
  });

  it("reports the current-rank value and the rank-8 value side by side", () => {
    const unranked = decodeAllRivens(rivenInventory(0)).unveiled[0];
    const maxed = decodeAllRivens(rivenInventory(8)).unveiled[0];

    expect(unranked).toBeDefined();
    expect(maxed).toBeDefined();

    const buff = unranked.stats.find((stat) => stat.positive);
    const curse = unranked.stats.find((stat) => !stat.positive);
    expect(buff).toBeDefined();
    expect(curse).toBeDefined();

    // An unranked riven shows a ninth of its maxed roll, so the two differ...
    expect(buff?.displayValue).toBeLessThan(buff?.maxRankValue ?? 0);
    // ...and the projection matches what the same roll decodes to at rank 8.
    expect(buff?.maxRankValue).toBe(maxed.stats.find((stat) => stat.positive)?.displayValue);
    expect(curse?.maxRankValue).toBe(maxed.stats.find((stat) => !stat.positive)?.displayValue);
  });

  it("leaves an already-maxed riven's projection equal to its live values", () => {
    const maxed = decodeAllRivens(rivenInventory(8)).unveiled[0];

    for (const stat of maxed.stats) {
      expect(stat.maxRankValue).toBe(stat.displayValue);
    }
  });

  it("keeps a curse negative at rank 8", () => {
    const curse = decodeAllRivens(rivenInventory(0)).unveiled[0].stats.find((s) => !s.positive);

    expect(curse?.displayValue).toBeLessThan(0);
    expect(curse?.maxRankValue).toBeLessThan(0);
  });
});

describe("current float32 stat model fingerprints", () => {
  it("decodes Initial Combo as a flat value, without the faction multiplier offset", () => {
    const riven = decodeAllRivens(
      fingerprintInventory({
        type: "PlayerMeleeWeaponRandomModRare",
        compat: "/Lotus/Weapons/Tenno/Melee/Swords/StalkerMios/StalkerMios",
        lvl: 8,
        buffs: [
          { Tag: "WeaponMeleeComboInitialBonusMod", Value: 2 ** 29 },
          { Tag: "WeaponCritDamageMod", Value: 2 ** 29 },
        ],
        curses: [],
      }),
    ).unveiled[0];
    expect(riven.stats[0]).toMatchObject({
      name: "Initial Combo",
      displayValue: 29.1,
      multiplier: false,
      grade: "B",
    });
  });

  it("matches the independent rank-8 Soma ++- oracle", () => {
    const riven = decodeAllRivens(
      fingerprintInventory({
        type: "LotusRifleRandomModRare",
        compat: "/Lotus/Weapons/Tenno/Rifle/TennoAR",
        lvl: 8,
        buffs: [
          { Tag: "WeaponDamageAmountMod", Value: 1023126307 },
          { Tag: "WeaponElectricityDamageMod", Value: 741268739 },
        ],
        curses: [{ Tag: "WeaponAmmoMaxMod", Value: 910199365 }],
      }),
    ).unveiled[0];

    assertDisplayValues(riven.stats, [
      { name: "Damage", positive: true, displayValue: 267.2 },
      { name: "Electricity", positive: true, displayValue: 138.7 },
      { name: "Ammo Maximum", positive: false, displayValue: -31.7 },
    ]);
  });

  it("matches rank-8 and rank-0 Lacera ++- oracle values", () => {
    const base = {
      type: "PlayerMeleeWeaponRandomModRare",
      compat: "/Lotus/Weapons/Tenno/Melee/Swords/StalkerMios/StalkerMios",
      buffs: [
        { Tag: "WeaponCritDamageMod", Value: 363944839 },
        { Tag: "WeaponStunChanceMod", Value: 87457298 },
      ],
      curses: [{ Tag: "WeaponMeleeFinisherDamageMod", Value: 86463855 }],
    };
    const rank8 = decodeAllRivens(fingerprintInventory({ ...base, lvl: 8 })).unveiled[0];
    const rank0 = decodeAllRivens(fingerprintInventory({ ...base, lvl: 0 })).unveiled[0];

    assertDisplayValues(rank8.stats, [
      { name: "Critical Damage", positive: true, displayValue: 129.3 },
      { name: "Status Chance", positive: true, displayValue: 122.5 },
      { name: "Finisher Damage", positive: false, displayValue: -65.1 },
    ]);
    assertDisplayValues(rank0.stats, [
      { name: "Critical Damage", positive: true, displayValue: 14.4 },
      { name: "Status Chance", positive: true, displayValue: 13.6 },
      { name: "Finisher Damage", positive: false, displayValue: -7.2 },
    ]);
  });

  it("decodes a spliced Ammo Efficiency roll using the same float32 model", () => {
    const riven = decodeAllRivens(
      fingerprintInventory({
        type: "LotusRifleRandomModRare",
        compat: "/Lotus/Weapons/Tenno/Rifle/TennoAR",
        lvl: 8,
        buffs: [
          { Tag: "WeaponCritChanceMod", Value: 676457348 },
          { Tag: "WeaponAmmoEfficiency", Value: 676457348 },
        ],
        curses: [{ Tag: "WeaponRecoilReductionMod", Value: 676457348 }],
      }),
    ).unveiled[0];

    assertDisplayValues(riven.stats, [
      { name: "Critical Chance", positive: true, displayValue: 228.5 },
      { name: "Ammo Efficiency", positive: true, displayValue: 68.6 },
      { name: "Weapon Recoil", positive: false, displayValue: 54.8 },
    ]);
  });
});

const CHALLENGES = "/Lotus/Types/Challenges/Seasons/";
const COMPLICATIONS = "/Lotus/Types/Challenges/Complications/";

function veiledInventory(challenges: Record<string, unknown>[]): Record<string, unknown> {
  return {
    Upgrades: challenges.map((challenge) => ({
      ItemType: "/Lotus/Upgrades/Mods/Randomized/LotusPistolRandomModRare",
      UpgradeFingerprint: JSON.stringify({ challenge }),
    })),
  };
}

describe("decodeAllRivens veiled challenge groups", () => {
  it("drops the count and complication so the same task shares one group", () => {
    const veiled = decodeAllRivens(
      veiledInventory([
        { Type: `${CHALLENGES}RandomizedHeadshot`, Progress: 3, Required: 40 },
        {
          Type: `${CHALLENGES}DJRandomizedHeadshot`,
          Required: 15,
          Complication: `${COMPLICATIONS}ResetOnDamageTaken`,
        },
        { Type: `${CHALLENGES}RandomizedFisherman`, Required: 8 },
        { Type: `${CHALLENGES}LimitedSynthesis` },
      ]),
    ).veiled;

    expect(veiled.map((entry) => entry.challengeDesc)).toEqual([
      "Kill 40 Enemies with Headshots",
      "Kill 15 Enemies with Headshots without taking damage",
      "Catch 8 fish without missing a throw",
      "Synthesize a Simaris target without using Traps or Abilities while having a Hobbled Dragon Key equipped",
    ]);
    expect(veiled.map((entry) => entry.challengeGroup)).toEqual([
      "Kill Enemies with Headshots",
      "Kill Enemies with Headshots",
      "Catch fish without missing a throw",
      "Synthesize a Simaris target without using Traps or Abilities while having a Hobbled Dragon Key equipped",
    ]);
  });

  it("names an unknown challenge the way its description does", () => {
    const [entry] = decodeAllRivens(
      veiledInventory([{ Type: `${CHALLENGES}RandomizedTameKavats`, Required: 2 }]),
    ).veiled;

    expect(entry.challengeGroup).toBe("Randomized Tame Kavats");
    expect(entry.challengeDesc).toBe("Randomized Tame Kavats");
  });

  it("leaves a riven without a challenge type ungrouped", () => {
    const [entry] = decodeAllRivens(veiledInventory([{ Progress: 0, Required: 5 }])).veiled;

    expect(entry.challengeType).toBeUndefined();
    expect(entry.challengeGroup).toBeUndefined();
  });
});
