import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

const here = dirname(fileURLToPath(import.meta.url));
const cli = resolve(here, "../../bin/record-schema-toolkit.mjs");

test("dispatcher exposes subcommands and propagates command status", () => {
    const help = spawnSync(process.execPath, [cli, "--help"], { encoding: "utf8" });
    assert.equal(help.status, 0);
    assert.match(help.stdout, /record-schema-toolkit <command>/);
    assert.match(help.stdout, /\n  assert\n/);

    const delegated = spawnSync(process.execPath, [cli, "assert", "--help"], {
        encoding: "utf8"
    });
    assert.equal(delegated.status, 0);
    assert.match(delegated.stdout, /Usage: assert \[options\]/);

    const unknown = spawnSync(process.execPath, [cli, "not-a-command"], {
        encoding: "utf8"
    });
    assert.equal(unknown.status, 2);
    assert.match(unknown.stderr, /Unknown command/);
});
