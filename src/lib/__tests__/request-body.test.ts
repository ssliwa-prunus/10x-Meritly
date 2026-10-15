import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from "vitest";
import { discardUnreadBody } from "@/lib/request-body";

// Oracle: an early middleware response must release the request body it never read (the local
// miniflare proxy otherwise breaks the next request on the connection; cancel() alone did not help
// there, reading through did), must not read an unknown-size or large upload, and must not touch a
// body that is absent or already consumed.

let consoleWarn: MockInstance;

beforeEach(() => {
  consoleWarn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
});

afterEach(() => {
  vi.restoreAllMocks();
});

const FORM = "name=Smoke+Role&weight=1";

const post = (body: string, length?: string) =>
  new Request("http://localhost/api/admin/job-roles", {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      ...(length === undefined ? {} : { "Content-Length": length }),
    },
    body,
  });

describe("discardUnreadBody", () => {
  it.each([String(FORM.length), "0", String(64 * 1024)])(
    "reads through a body of declared length %s",
    async (length) => {
      const request = post(FORM, length);
      const read = vi.spyOn(request, "arrayBuffer");
      await discardUnreadBody(request);
      expect(read).toHaveBeenCalledOnce();
      expect(request.bodyUsed).toBe(true);
      expect(consoleWarn).not.toHaveBeenCalled();
    },
  );

  it.each([
    ["larger than 64 KiB", String(64 * 1024 + 1)],
    ["of unknown length", undefined],
    ["with a malformed length", "12abc"],
    ["with a negative length", "-1"],
  ])("cancels instead of reading a body %s", async (_label, length) => {
    const request = post(FORM, length);
    const body = request.body;
    if (body === null) throw new Error("test setup: expected a body");
    const read = vi.spyOn(request, "arrayBuffer");
    const cancel = vi.spyOn(body, "cancel");
    await discardUnreadBody(request);
    expect(read).not.toHaveBeenCalled();
    expect(cancel).toHaveBeenCalledOnce();
  });

  it("leaves a request without a body alone", async () => {
    const request = new Request("http://localhost/my-bonuses");
    await discardUnreadBody(request);
    expect(request.body).toBeNull();
    expect(request.bodyUsed).toBe(false);
  });

  it("leaves an already-read body alone, without throwing or logging", async () => {
    const request = post(FORM, String(FORM.length));
    await request.text();
    await expect(discardUnreadBody(request)).resolves.toBeUndefined();
    expect(consoleWarn).not.toHaveBeenCalled();
  });

  it("logs a failed read at warn level instead of throwing", async () => {
    const request = post(FORM, String(FORM.length));
    vi.spyOn(request, "arrayBuffer").mockRejectedValue(new TypeError("connection reset"));
    await expect(discardUnreadBody(request)).resolves.toBeUndefined();
    expect(consoleWarn).toHaveBeenCalledWith("discardUnreadBody failed", { message: "connection reset" });
  });
});
