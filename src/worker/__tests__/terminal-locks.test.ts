import { describe, it, expect, vi, beforeEach } from "vitest";

vi.stubEnv("REDIS_URL", "redis://localhost:6379");

// Mock redis
const mockRedis = {
  set: vi.fn(),
  get: vi.fn(),
  expire: vi.fn(),
  eval: vi.fn(),
  exists: vi.fn(),
  del: vi.fn(),
};

vi.mock("@/lib/redis", () => ({ redis: mockRedis }));

describe("plan lock - session-level for terminal", () => {
  beforeEach(() => vi.clearAllMocks());

  it("plan lock acquired in open persists between turns (no release per turn)", async () => {
    // Simulate: lock acquired in open
    mockRedis.set.mockResolvedValue("OK");
    const { acquirePlanLock } = await import("../plan-lock");

    const lock = await acquirePlanLock("plan-1");
    expect(lock.acquired).toBe(true);

    // Between turns, the lock should still exist (NOT released)
    mockRedis.get.mockResolvedValue(lock.holder);
    const key = "plan-lock:plan-1";
    const current = await mockRedis.get(key);
    expect(current).toBe(lock.holder); // still held

    // On close, we release
    await lock.release();
    expect(mockRedis.eval).toHaveBeenCalled(); // compare-and-delete
  });

  it("task AI cannot acquire plan lock while terminal holds it", async () => {
    // Terminal has the lock
    mockRedis.set
      .mockResolvedValueOnce("OK") // terminal acquires
      .mockResolvedValueOnce(null); // task AI tries and fails

    mockRedis.get.mockResolvedValue("terminal-holder-uuid");

    const { acquirePlanLock } = await import("../plan-lock");

    const terminalLock = await acquirePlanLock("plan-1");
    expect(terminalLock.acquired).toBe(true);

    const taskLock = await acquirePlanLock("plan-1");
    expect(taskLock.acquired).toBe(false);
    expect(taskLock.holder).toBe("terminal-holder-uuid");
  });
});

describe("repo lock - collision terminal vs preflight", () => {
  beforeEach(() => vi.clearAllMocks());

  it("terminal turn cannot acquire repo lock while preflight holds it", async () => {
    mockRedis.set
      .mockResolvedValueOnce("OK")   // preflight acquires repo lock
      .mockResolvedValueOnce(null);  // terminal tries and fails

    mockRedis.get.mockResolvedValue("preflight-holder");

    const { acquireRepoLock } = await import("../plan-lock");

    const preflightLock = await acquireRepoLock("jorgeruiz/quicsa-web");
    expect(preflightLock.acquired).toBe(true);

    const terminalLock = await acquireRepoLock("jorgeruiz/quicsa-web");
    expect(terminalLock.acquired).toBe(false);
  });

  it("different repos can be locked simultaneously", async () => {
    mockRedis.set.mockResolvedValue("OK"); // always succeeds

    const { acquireRepoLock } = await import("../plan-lock");

    const lock1 = await acquireRepoLock("jorgeruiz/quicsa-web");
    const lock2 = await acquireRepoLock("jorgeruiz/molino-azteca");

    expect(lock1.acquired).toBe(true);
    expect(lock2.acquired).toBe(true);

    // Different keys
    expect(mockRedis.set).toHaveBeenCalledWith(
      "repo-lock:jorgeruiz/quicsa-web",
      expect.any(String), "EX", expect.any(Number), "NX"
    );
    expect(mockRedis.set).toHaveBeenCalledWith(
      "repo-lock:jorgeruiz/molino-azteca",
      expect.any(String), "EX", expect.any(Number), "NX"
    );
  });
});

describe("build semaphore", () => {
  beforeEach(() => vi.clearAllMocks());

  it("runs function under semaphore and releases", async () => {
    mockRedis.set.mockResolvedValue("OK");
    mockRedis.eval.mockResolvedValue(1);

    const { withBuildSemaphore } = await import("../plan-lock");

    let ran = false;
    await withBuildSemaphore(() => { ran = true; });

    expect(ran).toBe(true);
    expect(mockRedis.set).toHaveBeenCalledWith(
      "build-semaphore",
      expect.any(String), "EX", 300, "NX"
    );
    // Released after
    expect(mockRedis.eval).toHaveBeenCalled();
  });

  it("waits and retries when semaphore is held", async () => {
    // First attempt fails, second succeeds
    mockRedis.set
      .mockResolvedValueOnce(null)  // first: held
      .mockResolvedValueOnce("OK"); // second: acquired
    mockRedis.eval.mockResolvedValue(1);

    const { withBuildSemaphore } = await import("../plan-lock");

    let ran = false;
    // Short wait to avoid test timeout
    await withBuildSemaphore(() => { ran = true; }, 10_000);

    expect(ran).toBe(true);
    expect(mockRedis.set).toHaveBeenCalledTimes(2);
  });
});

describe("inactivity detection", () => {
  it("source code has inactivity checker with configurable timeout", async () => {
    const { readFileSync } = await import("fs");
    const { join } = await import("path");
    const source = readFileSync(join(__dirname, "..", "terminal-handler.ts"), "utf-8");

    expect(source).toContain("TERMINAL_INACTIVITY_MIN");
    expect(source).toContain("TERMINAL_MAX_TIME_MIN");
    expect(source).toContain("checkInactiveSessions");
    expect(source).toContain("wip/terminal-");
    expect(source).toContain("terminal-lock-holder");
  });
});
