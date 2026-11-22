/**
 * Package Detection Worker — runs weekly to detect installed packages.
 *
 * Job name: "packages:detect"
 * Queue: data-collection
 */

// Re-export for dispatcher
export { runPackageDetectProcessor } from "../processors/package-detect-processor";
