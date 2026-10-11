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

    vi.mocked(prisma.planTask.findMany).mockResolvedValueOnce([
      { id: "task-1", title: "Stuck task", failureReason: null } as never,
    ]);
    vi.mocked(prisma.taskRun.findMany).mockResolvedValueOnce([]); // no stuck runs
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

    vi.mocked(prisma.planTask.findMany).mockResolvedValueOnce([
      { id: "task-2", title: "Double stuck", failureReason: "RETRY: re-enqueued by watchdog" } as never,
    ]);
    vi.mocked(prisma.taskRun.findMany).mockResolvedValueOnce([]);
    vi.mocked(prisma.planTask.update).mockResolvedValue({} as never);

    const result = await runTaskWatchdog("plan-1");

    expect(result.failed).toContain("task-2");
    expect(result.retried).toHaveLength(0);
  });

  it("fails stuck TaskRun and its parent task and step", async () => {
    const { prisma } = await import("@/lib/db");
    const { runTaskWatchdog } = await import("../task-watchdog");

    vi.mocked(prisma.planTask.findMany).mockResolvedValueOnce([]); // no stuck PLANNING

    vi.mocked(prisma.taskRun.findMany).mockResolvedValueOnce([
      {
        id: "run-1",
        taskId: "task-3",
        stepId: "step-1",
        task: { title: "Running forever" },
      } as never,
    ]);

    vi.mocked(prisma.taskRun.update).mockResolvedValue({} as never);
    vi.mocked(prisma.planStep.update).mockResolvedValue({} as never);
    vi.mocked(prisma.planTask.update).mockResolvedValue({} as never);

    const result = await runTaskWatchdog("plan-1");

    expect(result.failed).toContain("task-3");

    // Run closed with EXECUTION_TIMEOUT
    expect(prisma.taskRun.update).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: "run-1" },
      data: expect.objectContaining({ status: "FAILED", error: expect.stringContaining("EXECUTION_TIMEOUT") }),
    }));

    // Step marked FAILED
    expect(prisma.planStep.update).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: "step-1" },
      data: { status: "FAILED" },
    }));

    // Task marked FAILED
    expect(prisma.planTask.update).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: "task-3" },
      data: expect.objectContaining({ status: "FAILED" }),
    }));
  });

  it("deduplicates: two stuck runs for same task = one FAILED task", async () => {
    const { prisma } = await import("@/lib/db");
    const { runTaskWatchdog } = await import("../task-watchdog");

    vi.mocked(prisma.planTask.findMany).mockResolvedValueOnce([]);
    vi.mocked(prisma.taskRun.findMany).mockResolvedValueOnce([
      { id: "run-1", taskId: "task-3", stepId: "step-1", task: { title: "Task" } } as never,
      { id: "run-2", taskId: "task-3", stepId: "step-2", task: { title: "Task" } } as never,
    ]);

    vi.mocked(prisma.taskRun.update).mockResolvedValue({} as never);
    vi.mocked(prisma.planStep.update).mockResolvedValue({} as never);
    vi.mocked(prisma.planTask.update).mockResolvedValue({} as never);

    const result = await runTaskWatchdog("plan-1");

    expect(result.failed).toHaveLength(1);
    // planTask.update called once for the task (not twice)
    expect(prisma.planTask.update).toHaveBeenCalledTimes(1);
    // But both runs closed
    expect(prisma.taskRun.update).toHaveBeenCalledTimes(2);
  });

  it("does nothing when no stuck tasks or runs", async () => {
    const { prisma } = await import("@/lib/db");
    const { runTaskWatchdog } = await import("../task-watchdog");

    vi.mocked(prisma.planTask.findMany).mockResolvedValueOnce([]);
    vi.mocked(prisma.taskRun.findMany).mockResolvedValueOnce([]);

    const result = await runTaskWatchdog("plan-1");

    expect(result.retried).toHaveLength(0);
    expect(result.failed).toHaveLength(0);
  });
});
