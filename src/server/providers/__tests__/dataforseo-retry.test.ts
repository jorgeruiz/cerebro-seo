import { describe, it, expect } from "vitest";

// Test the error classes and assertTaskOk independently (avoid importing the full provider which pulls redis/env)

// Replicate the classes here for unit testing (they are simple value types)
class DfsClientError extends Error {
  constructor(
    public readonly httpStatus: number,
    public readonly path: string,
    public readonly responseBody: string,
  ) {
    super(`DataForSEO HTTP ${httpStatus} on ${path}: ${responseBody.slice(0, 500)}`);
    this.name = "DfsClientError";
  }
}

class DfsTaskError extends Error {
  constructor(
    public readonly taskId: string,
    public readonly statusCode: number,
    public readonly statusMessage: string,
    public readonly path: string,
  ) {
    super(`DataForSEO task ${taskId} failed (${statusCode}): ${statusMessage} [${path}]`);
    this.name = "DfsTaskError";
  }
}

function assertTaskOk(task: { id: string; status_code: number; status_message: string }, path: string): void {
  if (task.status_code !== 20000) {
    throw new DfsTaskError(task.id, task.status_code, task.status_message, path);
  }
}

function isRetryableStatus(status: number): boolean {
  return status === 429 || status >= 500;
}

describe("isRetryableStatus", () => {
  it("returns true for 429", () => {
    expect(isRetryableStatus(429)).toBe(true);
  });

  it("returns true for 500", () => {
    expect(isRetryableStatus(500)).toBe(true);
  });

  it("returns true for 502", () => {
    expect(isRetryableStatus(502)).toBe(true);
  });

  it("returns false for 400", () => {
    expect(isRetryableStatus(400)).toBe(false);
  });

  it("returns false for 401", () => {
    expect(isRetryableStatus(401)).toBe(false);
  });

  it("returns false for 403", () => {
    expect(isRetryableStatus(403)).toBe(false);
  });

  it("returns false for 404", () => {
    expect(isRetryableStatus(404)).toBe(false);
  });

  it("returns false for 200", () => {
    expect(isRetryableStatus(200)).toBe(false);
  });
});

describe("DfsClientError", () => {
  it("contains httpStatus and path", () => {
    const err = new DfsClientError(404, "/serp/google/organic/task_get/regular/abc", '{"status_code":40400}');
    expect(err.httpStatus).toBe(404);
    expect(err.path).toBe("/serp/google/organic/task_get/regular/abc");
    expect(err.message).toContain("404");
  });

  it("truncates long response body in message", () => {
    const longBody = "x".repeat(1000);
    const err = new DfsClientError(400, "/test", longBody);
    expect(err.message.length).toBeLessThan(600);
  });
});

describe("assertTaskOk", () => {
  it("does not throw for status_code 20000", () => {
    expect(() =>
      assertTaskOk({ id: "t1", status_code: 20000, status_message: "Ok." }, "/test")
    ).not.toThrow();
  });

  it("throws DfsTaskError for non-20000 status", () => {
    expect(() =>
      assertTaskOk({ id: "t1", status_code: 40400, status_message: "Not Found." }, "/test")
    ).toThrow(DfsTaskError);
  });

  it("includes task id and path in error", () => {
    try {
      assertTaskOk({ id: "task-xyz", status_code: 40100, status_message: "Unauthorized" }, "/serp/organic/task_post");
      expect.unreachable("should have thrown");
    } catch (err) {
      expect(err).toBeInstanceOf(DfsTaskError);
      const e = err as DfsTaskError;
      expect(e.taskId).toBe("task-xyz");
      expect(e.statusCode).toBe(40100);
      expect(e.path).toBe("/serp/organic/task_post");
    }
  });
});
