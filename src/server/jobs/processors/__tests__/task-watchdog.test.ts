import { describe, it, expect, vi, beforeEach } from "vitest";

vi.stubEnv("REDIS_URL", "redis://localhost:6379");

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
    planStep: {
      update: vi.fn(),
    },
  },
}));

vi.mock("@/server/jobs/queues", () => ({
  decomposeQueue: { add: vi.fn() },
  planTaskQueue: { add: vi.fn() },
}));

describe("task-watchdog", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // Helper: mock the 3 findMany calls in order (PLANNING tasks, RUNNING runs, stuck enqueued tasks)
  function mockFinds(
    prisma: { planTask: { findMany: ReturnType<typeof vi.fn> }; taskRun: { findMany: ReturnType<typeof vi.fn> } },
    planning: unknown[] = [],
    runs: unknown[] = [],
    enqueued: unknown[] = []
  ) {
    vi.mocked(prisma.planTask.findMany)
      .mockResolvedValueOnce(planning as never) // 1st call: PLANNING stuck
      .mockResolvedValueOnce(enqueued as never); // 2nd call: RUNNING with no runs
    vi.mocked(prisma.taskRun.findMany).mockResolvedValueOnce(runs as never);
  }

  it("retries a stuck PLANNING task on first timeout", async () => {
    const { prisma } = await import("@/lib/db");
    const { decomposeQueue } = await import("@/server/jobs/queues");
    const { runTaskWatchdog } = await import("../task-watchdog");

    mockFinds(prisma, [{ id: "task-1", title: "Stuck", failureReason: null }]);
    vi.mocked(prisma.planTask.update).mockResolvedValue({} as never);
    vi.mocked(prisma.monthlyPlan.findUniqueOrThrow).mockResolvedValue({ clientId: "client-1" } as never);
    vi.mocked(decomposeQueue.add).mockResolvedValue({} as never);

    const result = await runTaskWatchdog("plan-1");

    expect(result.retried).toContain("task-1");
    expect(result.failed).toHaveLength(0);
    expect(decomposeQueue.add).toHaveBeenCalledWith("task:decompose", expect.objectContaining({ taskId: "task-1" }));
  });

  it("marks task FAILED on second PLANNING timeout", async () => {
    const { prisma } = await import("@/lib/db");
    const { runTaskWatchdog } = await import("../task-watchdog");

    mockFinds(prisma, [{ id: "task-2", title: "Double stuck", failureReason: "RETRY: re-enqueued by watchdog" }]);
    vi.mocked(prisma.planTask.update).mockResolvedValue({} as never);

    const result = await runTaskWatchdog("plan-1");

    expect(result.failed).toContain("task-2");
    expect(result.retried).toHaveLength(0);
  });

  it("fails stuck TaskRun and its parent task and step", async () => {
    const { prisma } = await import("@/lib/db");
    const { runTaskWatchdog } = await import("../task-watchdog");

    mockFinds(prisma, [], [
      { id: "run-1", taskId: "task-3", stepId: "step-1", task: { title: "Running forever" } },
    ]);

    vi.mocked(prisma.taskRun.update).mockResolvedValue({} as never);
    vi.mocked(prisma.planStep.update).mockResolvedValue({} as never);
    vi.mocked(prisma.planTask.update).mockResolvedValue({} as never);

    const result = await runTaskWatchdog("plan-1");

    expect(result.failed).toContain("task-3");
    expect(prisma.taskRun.update).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: "run-1" },
      data: expect.objectContaining({ status: "FAILED" }),
    }));
    expect(prisma.planStep.update).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: "step-1" },
      data: { status: "FAILED" },
    }));
  });

  it("re-enqueues lost job (RUNNING task with no active run)", async () => {
    const { prisma } = await import("@/lib/db");
    const { planTaskQueue } = await import("@/server/jobs/queues");
    const { runTaskWatchdog } = await import("../task-watchdog");

    mockFinds(prisma, [], [], [
      { id: "task-4", title: "Lost job", failureReason: null },
    ]);

    vi.mocked(prisma.planTask.update).mockResolvedValue({} as never);
    vi.mocked(planTaskQueue.add).mockResolvedValue({} as never);

    const result = await runTaskWatchdog("plan-1");

    expect(result.retried).toContain("task-4");
    expect(planTaskQueue.add).toHaveBeenCalledWith("execute", expect.objectContaining({ taskId: "task-4" }), expect.objectContaining({ delay: 5000 }));
  });

  it("fails lost job on second retry", async () => {
    const { prisma } = await import("@/lib/db");
    const { runTaskWatchdog } = await import("../task-watchdog");

    mockFinds(prisma, [], [], [
      { id: "task-5", title: "Lost twice", failureReason: "RETRY:enqueued by watchdog" },
    ]);

    vi.mocked(prisma.planTask.update).mockResolvedValue({} as never);

    const result = await runTaskWatchdog("plan-1");

    expect(result.failed).toContain("task-5");
    expect(prisma.planTask.update).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: "task-5" },
      data: expect.objectContaining({ status: "FAILED", failureReason: expect.stringContaining("LOST_JOB") }),
    }));
  });

  it("does nothing when no stuck tasks or runs", async () => {
    const { prisma } = await import("@/lib/db");
    const { runTaskWatchdog } = await import("../task-watchdog");

    mockFinds(prisma);

    const result = await runTaskWatchdog("plan-1");

    expect(result.retried).toHaveLength(0);
    expect(result.failed).toHaveLength(0);
  });
});
