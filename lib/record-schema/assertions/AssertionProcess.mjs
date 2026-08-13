import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const ASSERTION_WORKER_PATH = fileURLToPath(
    new URL("./AssertionWorker.mjs", import.meta.url)
);
const MAX_ASSERTION_OUTPUT_BYTES = 128 * 1024 * 1024;

/**
 * Run corpus assertions in a disposable process so its index and parsed corpus
 * are released before another validation phase allocates its own repository.
 *
 * @param {string} rootDirectory
 * @param {import("./AssertionRunner.mjs").AssertionRunOptions} options
 * @returns {import("./AssertionRunner.mjs").AssertionRunResult}
 */
export function runAssertionsIsolated(rootDirectory, options) {
    const execution = spawnSync(process.execPath, [ASSERTION_WORKER_PATH], {
        input: JSON.stringify({ rootDirectory, options }),
        encoding: "utf8",
        maxBuffer: MAX_ASSERTION_OUTPUT_BYTES,
        windowsHide: true
    });

    if (execution.error !== undefined) {
        throw execution.error;
    }
    if (execution.status !== 0) {
        const detail = execution.stderr.trim();
        throw new Error(
            detail.length > 0
                ? `assertion process failed: ${detail}`
                : `assertion process exited with status ${execution.status}`
        );
    }

    try {
        return JSON.parse(execution.stdout);
    } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        throw new Error(`assertion process returned invalid JSON: ${message}`);
    }
}
