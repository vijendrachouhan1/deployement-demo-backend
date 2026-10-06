import mongoose from "mongoose";
import { describe, expect, it } from "vitest";

import { deterministicJson } from "@/db/plugins/audit/utils/deterministic-json";

describe("deterministicJson", () => {
  it("sorts object keys", () => {
    const out = deterministicJson({ b: 2, a: 1, c: 3 });
    expect(out).toBe('{"a":1,"b":2,"c":3}');
  });

  it("drops undefined values", () => {
    const out = deterministicJson({ a: 1, b: undefined, c: 3 });
    expect(out).toBe('{"a":1,"c":3}');
  });

  it("tags BigInt", () => {
    const out = deterministicJson({ n: BigInt("9007199254740993") });
    expect(out).toBe('{"n":{"$bigint":"9007199254740993"}}');
  });

  it("tags Date as ISO-8601 UTC", () => {
    const out = deterministicJson({ at: new Date("2026-05-21T10:00:00.000Z") });
    expect(out).toBe('{"at":{"$date":"2026-05-21T10:00:00.000Z"}}');
  });

  it("throws on NaN", () => {
    expect(() => deterministicJson({ x: Number.NaN })).toThrow(/NaN/);
  });

  it("throws on Infinity", () => {
    expect(() => deterministicJson({ x: Number.POSITIVE_INFINITY })).toThrow(
      /Infinity/,
    );
  });

  it("throws on Symbol", () => {
    expect(() => deterministicJson({ x: Symbol("y") })).toThrow(/Symbol/);
  });

  it("excludes _sig / _prevSig / _id / createdAt / updatedAt", () => {
    const out = deterministicJson({
      _id: "abc",
      _sig: "x",
      _prevSig: "y",
      createdAt: new Date(),
      updatedAt: new Date(),
      action: "user.login",
    });
    expect(out).toBe('{"action":"user.login"}');
  });

  it("preserves array order, recurses into objects", () => {
    const out = deterministicJson({
      items: [{ z: 1, a: 2 }, { b: 3 }],
    });
    expect(out).toBe('{"items":[{"a":2,"z":1},{"b":3}]}');
  });

  it("tags Mongoose ObjectId via $oid", () => {
    const oid = new mongoose.Types.ObjectId("60c72b2f9b1d8e1a4c8b4567");
    const out = deterministicJson({ ref: oid });
    expect(out).toBe('{"ref":{"$oid":"60c72b2f9b1d8e1a4c8b4567"}}');
  });

  it("throws on Map / Set / Buffer / RegExp / Function", () => {
    expect(() => deterministicJson({ x: new Map() })).toThrow(/Map/);
    expect(() => deterministicJson({ x: new Set() })).toThrow(/Set/);
    expect(() => deterministicJson({ x: Buffer.from("hi") })).toThrow(/Buffer/);
    expect(() => deterministicJson({ x: /foo/ })).toThrow(/RegExp/);
    expect(() => deterministicJson({ x: () => 0 })).toThrow(/Function/);
  });

  it("throws on circular reference", () => {
    const obj: Record<string, unknown> = {};
    obj.self = obj;
    expect(() => deterministicJson(obj)).toThrow(/circular/);
  });
});
