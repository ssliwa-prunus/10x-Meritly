import { describe, expect, it } from "vitest";
import { decimalField, hasAtMostTwoDecimals, toHundredths } from "@/lib/forms";

describe("toHundredths", () => {
  it("rounds float noise to integer hundredths", () => {
    expect(toHundredths(0.3 + 0.3 + 0.25 + 0.15)).toBe(100);
    expect(toHundredths(1.005)).toBe(100);
  });
});

describe("hasAtMostTwoDecimals", () => {
  it.each([0, 1, 0.1, 0.25, 1.3, 9999999999.99])("accepts %s", (value) => {
    expect(hasAtMostTwoDecimals(value)).toBe(true);
  });

  it.each([0.001, 0.125, 1.333])("rejects %s", (value) => {
    expect(hasAtMostTwoDecimals(value)).toBe(false);
  });
});

describe("decimalField", () => {
  const issue = (input: unknown) => decimalField().safeParse(input).error?.issues[0]?.message;

  it("parses a trimmed decimal string", () => {
    expect(decimalField().parse(" 0.25 ")).toBe(0.25);
  });

  it.each([
    [undefined, "required"],
    ["", "required"],
    ["   ", "required"],
    ["abc", "not_a_number"],
    ["0.125", "too_many_decimals"],
  ])("rejects %j with %s", (input, code) => {
    expect(issue(input)).toBe(code);
  });
});
