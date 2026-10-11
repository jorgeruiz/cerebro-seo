import { describe, it, expect, vi, beforeEach } from "vitest";

// Stub REDIS_URL before imports
vi.stubEnv("REDIS_URL", "redis://localhost:6379");

// Mock prisma
vi.mock("@/lib/db", () => ({
  prisma: {
    planTask: {
      findMany: vi.fn(),
      update: vi.fn(),
    },
    monthlyPlan: {
      findUniqueOrThrow: vi.fn(),
    },
    taskRun: {
      findMany: vi.fn(),
      update: vi.fn(),
    },
  },
}));

// Mock queue — now uses decomposeQueue instead of aiAnalysisQueue
vi.mock("@/server/jobs/queues", () => ({
  decomposeQueue: {
    add: vi.fn(),
  },
}));

describe("task-watchdog", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("retries a stuck PLANNING task on first timeout", async () => {
    const { prisma } = await import("@/lib/db");
    const { decomposeQueue } = await import("@/server/jobs/queues");
    const { runTaskWatchdog } = await import("../task-watchdog");

    vi.mocked(prisma.planTask.findMany)
      .mockResolvedValueOnce([
        { id: "task-1", title: "Stuck task", failureReason: null } as never,
      ])
      .mockResolvedValueOnce([]); // RUNNING query returns empty
    vi.mocked(prisma.planTask.update).mockResolvedValue({} as never);
    vi.mocked(prisma.monthlyPlan.findUniqueOrThrow).mockResolvedValue({
      clientId: "client-1",
    } as never);
    vi.mocked(decomposeQueue.add).mockResolvedValue({} as never);

    const result = await runTaskWatchdog("plan-1");

    expect(result.retried).toContain("task-1");
    expect(result.failed).toHaveLength(0);
    expect(decomposeQueue.add).toHaveBeenCalledWith("task:decompose", expect.objectContaining({
      taskId: "task-1",
    }));
  });

  it("marks task FAILED on second PLANNING timeout", async () => {
    const { prisma } = await import("@/lib/db");
    const { runTaskWatchdog } = await import("../task-watchdog");

    vi.mocked(prisma.planTask.findMany)
      .mockResolvedValueOnce([
        { id: "task-2", title: "Double stuck", failureReason: "RETRY: re-enqueued by watchdog" } as never,
      ])
      .mockResolvedValueOnce([]); // RUNNING query returns empty
    vi.mocked(prisma.planTask.update).mockResolvedValue({} as never);

    const result = await runTaskWatchdog("plan-1");

    expect(result.failed).toContain("task-2");
    expect(result.retried).toHaveLength(0);
    expect(prisma.planTask.update).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: "task-2" },
      data: expect.objectContaining({ status: "FAILED" }),
    }));
  });

  it("marks stuck RUNNING task as FAILED and closes open TaskRuns", async () => {
    const { prisma } = await import("@/lib/db");
    const { runTaskWatchdog } = await import("../task-watchdog");

    vi.mocked(prisma.planTask.findMany)
      .mockResolvedValueOnce([]) // PLANNING query empty
      .mockResolvedValueOnce([
        { id: "task-3", title: "Running forever" } as never,
      ]); // RUNNING query returns stuck task

    vi.mocked(prisma.planTask.update).mockResolvedValue({} as never);
    vi.mocked(prisma.taskRun.findMany).mockResolvedValue([
      { id: "run-1" } as never,
      { id: "run-2" } as never,
    ]);
    vi.mocked(prisma.taskRun.update).mockResolvedValue({} as never);

    const result = await runTaskWatchdog("plan-1");

    expect(result.failed).toContain("task-3");
    expect(result.retried).toHaveLength(0);

    // Task updated to FAILED
    expect(prisma.planTask.update).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: "task-3" },
      data: expect.objectContaining({
        status: "FAILED",
        failureReason: expect.stringContaining("EXECUTION_TIMEOUT"),
      }),
    }));

    // Both TaskRuns closed
    expect(prisma.taskRun.update).toHaveBeenCalledTimes(2);
    expect(prisma.taskRun.update).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: "run-1" },
      data: expect.objectContaining({
        status: "FAILED",
        error: "EXECUTION_TIMEOUT",
      }),
    }));
  });

  it("does nothing when no stuck tasks", async () => {
    const { prisma } = await import("@/lib/db");
    const { runTaskWatchdog } = await import("../task-watchdog");

    vi.mocked(prisma.planTask.findMany).mockResolvedValue([]);

    const result = await runTaskWatchdog("plan-1");

    expect(result.retried).toHaveLength(0);
    expect(result.failed).toHaveLength(0);
  });
});
