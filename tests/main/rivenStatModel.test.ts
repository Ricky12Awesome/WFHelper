import { describe, expect, it } from "vitest";
import { gradeRiven } from "../../services/rivenGrading";

describe("reported spliced Rivens", () => {
  const bramma = [
    { name: "Critical Chance", positive: true, value: 223.8 },
    { name: "Ammo Efficiency", positive: true, value: 73.3 },
    { name: "Weapon Recoil", positive: false, value: 54.1, displayPositive: true },
  ];
  it("matches the supplied calculator screenshot: B, S, B", () => {
    const result = gradeRiven("Kuva Bramma", bramma, 8)!;
    expect(result.stats.map((stat) => stat.grade)).toEqual(["B", "S", "B"]);
    expect(result.stats[0].rollFloat * 20 - 10).toBeCloseTo(0.4754, 4);
    expect(result.stats[1].rollFloat * 20 - 10).toBeCloseTo(9.6895, 4);
    expect(result.stats[2].rollFloat * 20 - 10).toBeCloseTo(1.1972, 4);
    expect(result.overallGrade).toBe("A-");
    expect(result.attributeGrade).toBe("?");
  });

  it("does not give unknown or out-of-range stats a fabricated grade", () => {
    const unknown = gradeRiven(
      "Kuva Bramma",
      [{ ...bramma[0], name: "Unknown Stat" }, ...bramma.slice(1)],
      8,
    )!;
    const impossible = gradeRiven(
      "Kuva Bramma",
      [{ ...bramma[0], value: 9999 }, ...bramma.slice(1)],
      8,
    )!;
    expect(unknown.stats[0].grade).toBe("?");
    expect(impossible.stats[0].grade).toBe("?");
  });
});
