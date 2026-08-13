import { readFileSync } from "node:fs";
import { runAssertions } from "./AssertionRunner.mjs";

function run() {
    const payload = JSON.parse(readFileSync(0, "utf8"));
    const result = runAssertions(payload.rootDirectory, payload.options);
    process.stdout.write(JSON.stringify(result));
}

try {
    run();
} catch (error) {
    const message = error instanceof Error ? error.stack : String(error);
    process.stderr.write(`${message}\n`);
    process.exitCode = 1;
}
