import { describe, expect, it } from "vitest";
import { bonusReportFilename, buildBonusReportCsv, parseBonusReportFilter, reportGrandTotal } from "@/lib/bonus-report";
import type { BonusReportRow } from "@/types";

// Oracle: the aggregate-bonus-report plan (context/changes/aggregate-bonus-report/plan.md, Phase 2
// and Critical Implementation Details). Filter: empty means null, real calendar dates only, from > to
// is range_reversed. CSV: BOM, ";", CRLF after every row, comma decimals with two places, text cells
// starting with =, +, -, @, tab or CR prefixed with "'", cells with ;, ", CR or LF quoted with "
// doubled. Grand total exact to the grosz.

const params = (query: string) => new URLSearchParams(query);

let seq = 0;
function row(overrides: Partial<BonusReportRow> = {}): BonusReportRow {
  seq += 1;
  return {
    employee_id: `emp-${seq}`,
    employee_name: "Anna Nowak",
    milestone_count: 1,
    total_bonus: 100,
    ...overrides,
  };
}

const HEADERS = { name: "Pracownik", milestones: "Kamienie milowe", total: "Suma premii" };
const BOM = "﻿";

/** Data rows of a CSV document (header row and trailing empty string dropped). */
const dataLines = (csv: string) => csv.slice(BOM.length).split("\r\n").slice(1, -1);

describe("parseBonusReportFilter", () => {
  it("no params: both bounds null", () => {
    expect(parseBonusReportFilter(params(""))).toEqual({ data: { from: null, to: null } });
  });

  it("empty strings mean null", () => {
    expect(parseBonusReportFilter(params("from=&to="))).toEqual({ data: { from: null, to: null } });
  });

  it("whitespace-only means null", () => {
    expect(parseBonusReportFilter(params("from=%20&to=%20"))).toEqual({ data: { from: null, to: null } });
  });

  it("valid range", () => {
    expect(parseBonusReportFilter(params("from=2026-01-01&to=2026-03-31"))).toEqual({
      data: { from: "2026-01-01", to: "2026-03-31" },
    });
  });

  it("trims surrounding whitespace", () => {
    expect(parseBonusReportFilter(params("from=%202026-01-01%20"))).toEqual({
      data: { from: "2026-01-01", to: null },
    });
  });

  it("only from", () => {
    expect(parseBonusReportFilter(params("from=2026-01-01"))).toEqual({ data: { from: "2026-01-01", to: null } });
  });

  it("only to", () => {
    expect(parseBonusReportFilter(params("to=2026-03-31"))).toEqual({ data: { from: null, to: "2026-03-31" } });
  });

  it.each([
    "2026-1-01",
    "01.02.2026",
    "2026/01/01",
    "abc",
    "2026-01-01T00:00",
    "x2026-01-01",
    "2026-01-011",
    "+002026-01-01",
    "20260101",
  ])("invalid format %s: invalid_date", (value) => {
    expect(parseBonusReportFilter(params(`from=${encodeURIComponent(value)}`))).toEqual({ error: "invalid_date" });
    expect(parseBonusReportFilter(params(`to=${encodeURIComponent(value)}`))).toEqual({ error: "invalid_date" });
  });

  it.each(["2026-02-30", "2026-13-01", "2026-00-10", "2025-02-29"])("impossible date %s: invalid_date", (value) => {
    expect(parseBonusReportFilter(params(`from=${value}`))).toEqual({ error: "invalid_date" });
  });

  it("leap day is a real date", () => {
    expect(parseBonusReportFilter(params("from=2028-02-29"))).toEqual({ data: { from: "2028-02-29", to: null } });
  });

  it("from after to: range_reversed", () => {
    expect(parseBonusReportFilter(params("from=2026-03-02&to=2026-03-01"))).toEqual({ error: "range_reversed" });
  });

  it("invalid date wins over a reversed range", () => {
    expect(parseBonusReportFilter(params("from=2026-12-31&to=2026-02-30"))).toEqual({ error: "invalid_date" });
  });

  it("equal bounds are allowed (one day)", () => {
    expect(parseBonusReportFilter(params("from=2026-03-01&to=2026-03-01"))).toEqual({
      data: { from: "2026-03-01", to: "2026-03-01" },
    });
  });
});

describe("reportGrandTotal", () => {
  it("empty: 0", () => {
    expect(reportGrandTotal([])).toBe(0);
  });

  it("sums exactly to the grosz: 0.10 + 0.20 = 0.30", () => {
    expect(reportGrandTotal([row({ total_bonus: 0.1 }), row({ total_bonus: 0.2 })])).toBe(0.3);
  });

  it("sums every row", () => {
    expect(
      reportGrandTotal([row({ total_bonus: 1234.5 }), row({ total_bonus: 0 }), row({ total_bonus: 765.49 })]),
    ).toBe(1999.99);
  });
});

describe("buildBonusReportCsv", () => {
  it("starts with a BOM, header row from the passed labels, CRLF after every row", () => {
    const csv = buildBonusReportCsv(
      [row({ employee_name: "Anna Nowak", milestone_count: 3, total_bonus: 1234.5 })],
      HEADERS,
    );
    expect(csv).toBe(`${BOM}Pracownik;Kamienie milowe;Suma premii\r\nAnna Nowak;3;1234,50\r\n`);
  });

  it("no rows: header only", () => {
    expect(buildBonusReportCsv([], { name: "Name", milestones: "Milestones", total: "Total" })).toBe(
      `${BOM}Name;Milestones;Total\r\n`,
    );
  });

  it.each([
    [1234.5, "1234,50"],
    [0, "0,00"],
    [0.05, "0,05"],
    [1000000, "1000000,00"],
    [99.99, "99,99"],
    [0.1 + 0.2, "0,30"],
    [-12.3, "-12,30"],
  ])("amount %s is written as %s", (amount, expected) => {
    const [line] = dataLines(
      buildBonusReportCsv([row({ employee_name: "A", milestone_count: 2, total_bonus: amount })], HEADERS),
    );
    expect(line).toBe(`A;2;${expected}`);
  });

  it("one row per employee, in the given order", () => {
    const csv = buildBonusReportCsv(
      [row({ employee_name: "B" }), row({ employee_name: "A", milestone_count: 0, total_bonus: 0 })],
      HEADERS,
    );
    expect(dataLines(csv)).toEqual(["B;1;100,00", "A;0;0,00"]);
  });

  it.each([
    ["Nowak; Anna", '"Nowak; Anna"'],
    ['Anna "Ania" Nowak', '"Anna ""Ania"" Nowak"'],
    ["Anna\nNowak", '"Anna\nNowak"'],
    ["Anna\r\nNowak", '"Anna\r\nNowak"'],
  ])("name %j is quoted as %j", (name, expected) => {
    const csv = buildBonusReportCsv([row({ employee_name: name, total_bonus: 1 })], HEADERS);
    expect(csv).toBe(`${BOM}Pracownik;Kamienie milowe;Suma premii\r\n${expected};1;1,00\r\n`);
  });

  it.each([
    ["=SUM(A1:A9)", "'=SUM(A1:A9)"],
    ["+48 123", "'+48 123"],
    ["-1", "'-1"],
    ["@cmd", "'@cmd"],
    ["\tTab", "'\tTab"],
  ])("formula-like name %j is prefixed: %j", (name, expected) => {
    const [line] = dataLines(buildBonusReportCsv([row({ employee_name: name, total_bonus: 1 })], HEADERS));
    expect(line).toBe(`${expected};1;1,00`);
  });

  it("leading CR is prefixed, then quoted", () => {
    const csv = buildBonusReportCsv([row({ employee_name: "\rX", total_bonus: 1 })], HEADERS);
    expect(csv).toBe(`${BOM}Pracownik;Kamienie milowe;Suma premii\r\n"'\rX";1;1,00\r\n`);
  });

  it("prefix and quoting combine: prefix first, then quote", () => {
    const [line] = dataLines(
      buildBonusReportCsv([row({ employee_name: '=HYPERLINK("x";"y")', total_bonus: 1 })], HEADERS),
    );
    expect(line).toBe(`"'=HYPERLINK(""x"";""y"")";1;1,00`);
  });

  it("a formula character inside the name is left alone", () => {
    const [line] = dataLines(
      buildBonusReportCsv([row({ employee_name: "Anna-Maria Nowak", total_bonus: 1 })], HEADERS),
    );
    expect(line).toBe("Anna-Maria Nowak;1;1,00");
  });

  it("header labels go through the same escaping", () => {
    const csv = buildBonusReportCsv([], { name: "=Name", milestones: "Mile;stones", total: 'To"tal' });
    expect(csv).toBe(`${BOM}'=Name;"Mile;stones";"To""tal"\r\n`);
  });
});

describe("bonusReportFilename", () => {
  it("no bounds", () => {
    expect(bonusReportFilename({ from: null, to: null })).toBe("meritly-bonus-report.csv");
  });

  it("both bounds", () => {
    expect(bonusReportFilename({ from: "2026-01-01", to: "2026-03-31" })).toBe(
      "meritly-bonus-report-from-2026-01-01-to-2026-03-31.csv",
    );
  });

  it("only from", () => {
    expect(bonusReportFilename({ from: "2026-01-01", to: null })).toBe("meritly-bonus-report-from-2026-01-01.csv");
  });

  it("only to", () => {
    expect(bonusReportFilename({ from: null, to: "2026-03-31" })).toBe("meritly-bonus-report-to-2026-03-31.csv");
  });
});
