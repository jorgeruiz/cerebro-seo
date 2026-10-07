import { describe, it, expect, vi } from "vitest";

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
  },
}));

// Mock queue
vi.mock("@/server/jobs/queues", () => ({
  aiAnalysisQueue: {
    add: vi.fn(),
  },
}));

describe("task-watchdog", () => {
  it("retries a stuck PLANNING task on first timeout", async () => {
    const { prisma } = await import("@/lib/db");
    const { aiAnalysisQueue } = await import("@/server/jobs/queues");
    const { runTaskWatchdog } = await import("../task-watchdog");

    vi.mocked(prisma.planTask.findMany).mockResolvedValue([
      { id: "task-1", title: "Stuck task", failureReason: null } as never,
    ]);
    vi.mocked(prisma.planTask.update).mockResolvedValue({} as never);
    vi.mocked(prisma.monthlyPlan.findUniqueOrThrow).mockResolvedValue({
      clientId: "client-1",
    } as never);
    vi.mocked(aiAnalysisQueue.add).mockResolvedValue({} as never);

    const result = await runTaskWatchdog("plan-1");

    expect(result.retried).toContain("task-1");
    expect(result.failed).toHaveLength(0);
    expect(aiAnalysisQueue.add).toHaveBeenCalledWith("task:decompose", expect.objectContaining({
      taskId: "task-1",
    }));
  });

  it("marks task FAILED on second timeout", async () => {
    const { prisma } = await import("@/lib/db");
    const { runTaskWatchdog } = await import("../task-watchdog");

    vi.mocked(prisma.planTask.findMany).mockResolvedValue([
      { id: "task-2", title: "Double stuck", failureReason: "RETRY: re-enqueued by watchdog" } as never,
    ]);
    vi.mocked(prisma.planTask.update).mockResolvedValue({} as never);

    const result = await runTaskWatchdog("plan-1");

    expect(result.failed).toContain("task-2");
    expect(result.retried).toHaveLength(0);
    expect(prisma.planTask.update).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: "task-2" },
      data: expect.objectContaining({ status: "FAILED" }),
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
