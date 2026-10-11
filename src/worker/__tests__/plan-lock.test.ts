import { describe, it, expect, vi, beforeEach } from "vitest";

vi.stubEnv("REDIS_URL", "redis://localhost:6379");

// Mock redis
const mockRedis = {
  set: vi.fn(),
  get: vi.fn(),
  expire: vi.fn(),
  eval: vi.fn(),
  exists: vi.fn(),
};

vi.mock("@/lib/redis", () => ({ redis: mockRedis }));

describe("plan-lock", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
  });

  it("acquires lock when key is free", async () => {
    mockRedis.set.mockResolvedValue("OK");

    const { acquirePlanLock } = await import("../plan-lock");
    const lock = await acquirePlanLock("plan-1");

    expect(lock.acquired).toBe(true);
    expect(lock.holder).toBeDefined();
    expect(mockRedis.set).toHaveBeenCalledWith(
      "plan-lock:plan-1",
      expect.any(String),
      "EX",
      expect.any(Number),
      "NX"
    );

    await lock.release();
    vi.useRealTimers();
  });

  it("fails to acquire when lock is held", async () => {
    mockRedis.set.mockResolvedValue(null);
    mockRedis.get.mockResolvedValue("other-holder");

    const { acquirePlanLock } = await import("../plan-lock");
    const lock = await acquirePlanLock("plan-1");

    expect(lock.acquired).toBe(false);
    expect(lock.holder).toBe("other-holder");

    vi.useRealTimers();
  });

  it("release deletes key via compare-and-delete", async () => {
    mockRedis.set.mockResolvedValue("OK");
    mockRedis.eval.mockResolvedValue(1);

    const { acquirePlanLock } = await import("../plan-lock");
    const lock = await acquirePlanLock("plan-1");

    await lock.release();

    expect(mockRedis.eval).toHaveBeenCalledWith(
      expect.stringContaining("redis.call"),
      1,
      "plan-lock:plan-1",
      lock.holder
    );

    vi.useRealTimers();
  });

  it("isPlanLocked returns true when key exists", async () => {
    mockRedis.exists.mockResolvedValue(1);

    const { isPlanLocked } = await import("../plan-lock");
    const result = await isPlanLocked("plan-1");

    expect(result).toBe(true);
  });
});
