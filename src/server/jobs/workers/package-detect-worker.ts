/**
 * Package Detection Worker — runs weekly to detect installed packages.
 *
 * Job name: "packages:detect"
 * Queue: data-collection
 */

import { createWorker } from "./base-worker";
import { runPackageDetectProcessor } from "../processors/package-detect-processor";

export const packageDetectWorker = createWorker(
  "data-collection",
  async (job) => {
    if (job.name !== "packages:detect") return;
    return runPackageDetectProcessor();
  },
  { concurrency: 1 }
);
