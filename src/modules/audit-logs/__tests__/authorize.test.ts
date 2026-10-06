import type { NextFunction, Request, Response } from "express";
import { describe, expect, it, vi } from "vitest";

import { PERMISSIONS } from "@/enums";
import { authorize, canAccess } from "@/middleware/authorize";

function buildRes(): Response {
  const res = {
    status: vi.fn().mockReturnThis(),
    json: vi.fn().mockReturnThis(),
  } as unknown as Response;
  return res;
}

function buildReq(permissions: string[] | undefined): Request {
  return {
    user: permissions === undefined ? undefined : { permissions },
  } as unknown as Request;
}

describe("canAccess", () => {
  it("all permissions grant any required permission (super-admin pattern)", () => {
    const allPerms = Object.values(PERMISSIONS);
    expect(canAccess(allPerms, "audit-logs:view")).toBe(true);
    expect(canAccess(allPerms, "audit-logs:manage")).toBe(true);
  });

  it("exact match passes", () => {
    expect(canAccess(["audit-logs:view"], "audit-logs:view")).toBe(true);
  });

  it("higher level satisfies lower (manage covers view)", () => {
    expect(canAccess(["audit-logs:manage"], "audit-logs:view")).toBe(true);
  });

  it("lower level does NOT satisfy higher (view does not cover manage)", () => {
    expect(canAccess(["audit-logs:view"], "audit-logs:manage")).toBe(false);
  });

  it("denies when permissions array is empty", () => {
    expect(canAccess([], "audit-logs:view")).toBe(false);
  });

  it("denies when permission is for a different domain", () => {
    expect(canAccess(["products:manage"], "audit-logs:view")).toBe(false);
  });

  it("respects multi-segment domain (stripe-payment:products:view)", () => {
    expect(
      canAccess(
        ["stripe-payment:products:view"],
        "stripe-payment:products:view",
      ),
    ).toBe(true);
    expect(
      canAccess(
        ["stripe-payment:products:manage"],
        "stripe-payment:products:view",
      ),
    ).toBe(true);
  });
});

describe("authorize middleware", () => {
  it("calls next when user has all permissions (super-admin pattern)", () => {
    const req = buildReq(Object.values(PERMISSIONS));
    const res = buildRes();
    const next = vi.fn();
    authorize(PERMISSIONS.AUDIT_LOGS_VIEW)(req, res, next as NextFunction);
    expect(next).toHaveBeenCalledOnce();
    expect(res.status).not.toHaveBeenCalled();
  });

  it("calls next when user has exact required permission", () => {
    const req = buildReq([PERMISSIONS.AUDIT_LOGS_VIEW]);
    const res = buildRes();
    const next = vi.fn();
    authorize(PERMISSIONS.AUDIT_LOGS_VIEW)(req, res, next as NextFunction);
    expect(next).toHaveBeenCalledOnce();
  });

  it("returns 403 when user lacks the required permission", () => {
    const req = buildReq([PERMISSIONS.PRODUCTS_VIEW]);
    const res = buildRes();
    const next = vi.fn();
    authorize(PERMISSIONS.AUDIT_LOGS_VIEW)(req, res, next as NextFunction);
    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(403);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ success: false }),
    );
  });

  it("returns 403 when user has only :view but route requires :manage", () => {
    const req = buildReq([PERMISSIONS.AUDIT_LOGS_VIEW]);
    const res = buildRes();
    const next = vi.fn();
    authorize(PERMISSIONS.AUDIT_LOGS_MANAGE)(req, res, next as NextFunction);
    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(403);
  });

  it("returns 403 when req.user is undefined", () => {
    const req = buildReq(undefined);
    const res = buildRes();
    const next = vi.fn();
    authorize(PERMISSIONS.AUDIT_LOGS_VIEW)(req, res, next as NextFunction);
    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(403);
  });

  it("allows when any of multiple required permissions matches", () => {
    const req = buildReq([PERMISSIONS.AUDIT_LOGS_VIEW]);
    const res = buildRes();
    const next = vi.fn();
    authorize(PERMISSIONS.AUDIT_LOGS_MANAGE, PERMISSIONS.AUDIT_LOGS_VIEW)(
      req,
      res,
      next as NextFunction,
    );
    expect(next).toHaveBeenCalledOnce();
  });
});
