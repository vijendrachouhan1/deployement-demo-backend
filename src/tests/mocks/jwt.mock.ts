import { vi } from "vitest";

export const mockJwtHelper = {
  generateToken: vi.fn(),
  verifyToken: vi.fn(),
};
