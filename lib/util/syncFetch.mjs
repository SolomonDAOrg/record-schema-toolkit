import {
    MessageChannel,
    Worker,
    receiveMessageOnPort
} from "node:worker_threads";
import { hasNonNullishProperty } from "./objects.mjs";

/** @typedef {{ status: number, body: string }} SyncFetchResult */
/** @typedef {{ error: string }} SyncFetchError */
/** @typedef {{ status: number; ok: boolean; buf: Uint8Array }} SyncFetchBufferResult */

const DEFAULT_TIMEOUT_MS = 30000;

/**
 * @param {string} url
 * @param {Record<string, string> | undefined} headers
 * @param {number} timeoutMs
 * @returns {SyncFetchBufferResult | SyncFetchError}
 */
function runSyncFetchWorker(url, headers, timeoutMs) {
    const stateBuffer = new SharedArrayBuffer(4);
    const state = new Int32Array(stateBuffer);
    const { port1, port2 } = new MessageChannel();

    const worker = new Worker(
        `
        const { workerData } = require("node:worker_threads");

        const state = new Int32Array(workerData.stateBuffer);

        (async function run() {
            try {
                const abortController = new AbortController();
                const timeoutId = setTimeout(() => {
                    abortController.abort(
                        new Error("syncFetch timeout after " + workerData.timeoutMs + "ms")
                    );
                }, workerData.timeoutMs);

                try {
                    const response = await fetch(workerData.url, {
                        headers: workerData.headers,
                        signal: abortController.signal
                    });
                    const buf = new Uint8Array(await response.arrayBuffer());

                    workerData.resultPort.postMessage(
                        {
                            status: response.status,
                            ok: response.ok,
                            buf
                        },
                        [buf.buffer]
                    );
                } finally {
                    clearTimeout(timeoutId);
                }
            } catch (error) {
                workerData.resultPort.postMessage({
                    error: error instanceof Error ? error.message : String(error)
                });
            } finally {
                Atomics.store(state, 0, 1);
                Atomics.notify(state, 0, 1);
            }
        })();
        `,
        {
            eval: true,
            workerData: {
                url,
                headers: {
                    "User-Agent":
                        "Mozilla/5.0 (compatible; SolomonDocsPipeline/1.0)",
                    ...(headers ?? {})
                },
                timeoutMs,
                stateBuffer,
                resultPort: port2
            },
            transferList: [port2]
        }
    );

    worker.on("error", () => {});

    const waitResult = Atomics.wait(state, 0, 0, timeoutMs + 1000);

    if (waitResult === "timed-out") {
        port1.close();
        void worker.terminate();
        throw new Error(`syncFetch worker timed out: ${url}`);
    }

    const received = receiveMessageOnPort(port1);

    port1.close();
    void worker.terminate();

    if (!received || received.message == null) {
        throw new Error(`syncFetch worker returned no message: ${url}`);
    }

    return /** @type {SyncFetchBufferResult | SyncFetchError} */ (
        received.message
    );
}

/**
 * Synchronously fetch a URL, blocking the current thread until complete.
 *
 * @param {string} url
 * @returns {SyncFetchResult}
 */
function syncFetch(url) {
    const result = runSyncFetchWorker(url, undefined, DEFAULT_TIMEOUT_MS);

    if (hasNonNullishProperty(result, "error")) {
        throw new Error(/** @type {SyncFetchError} */ (result).error);
    }

    const okResult = /** @type {SyncFetchBufferResult} */ (result);

    return {
        status: okResult.status,
        body: new TextDecoder("utf-8").decode(okResult.buf)
    };
}

/**
 * Fetch a URL and return the raw response body as bytes.
 * @param {string} url
 * @param {Record<string, string>} [headers]
 * @returns {Uint8Array}
 * @throws {Error} on non-2xx response
 */
function syncFetchBuffer(url, headers) {
    const result = runSyncFetchWorker(url, headers, DEFAULT_TIMEOUT_MS);

    if (hasNonNullishProperty(result, "error")) {
        throw new Error(/** @type {SyncFetchError} */ (result).error);
    }

    const okResult = /** @type {SyncFetchBufferResult} */ (result);

    if (!okResult.ok) {
        throw new Error(`HTTP ${okResult.status}: ${url}`);
    }

    return new Uint8Array(okResult.buf);
}

export { syncFetch, syncFetchBuffer };
