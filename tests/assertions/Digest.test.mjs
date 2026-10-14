import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import {
    mkdtempSync,
    readFileSync,
    rmSync,
    symlinkSync,
    unlinkSync,
    writeFileSync
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { materializeAssertions } from "../../lib/record-schema/assertions/AssertionMaterializer.mjs";
import { runAssertions } from "../../lib/record-schema/assertions/AssertionRunner.mjs";

const pack = {
    schema: "record-schema-assertion-pack",
    schema_version: 2,
    pack_id: "test.digest",
    sources: { tracked: { include: ["*.bin"], parse: "none" } },
    rules: [
        {
            id: "DIGEST",
            kind: "digest",
            message: "inventory drift",
            manifest: "manifest.json",
            tracks: "tracked",
            entries: "inventory.files",
            count_path: "inventory.count",
            root_path: "inventory.root",
            commitment: { domain: 7, path_length: "u16le" },
            materialize: { operation: "digest_manifest" }
        }
    ]
};

function fixture(run) {
    const root = mkdtempSync(join(tmpdir(), "record-digest-"));
    try {
        writeFileSync(join(root, "pack.json"), JSON.stringify(pack));
        writeFileSync(join(root, "b.bin"), Buffer.from([0, 255, 13, 10]));
        writeFileSync(join(root, "a.bin"), "abc");
        writeFileSync(
            join(root, "manifest.json"),
            '{"unrelated":"retained"}\n'
        );
        run(root);
    } finally {
        rmSync(root, { recursive: true, force: true });
    }
}

test("digest materialization preserves raw bytes and matches an independent commitment", () =>
    fixture((root) => {
        const options = { packs: ["pack.json"] };
        assert.ok(runAssertions(root, options).findings.length > 0);
        const preview = materializeAssertions(root, options);
        assert.deepEqual(preview.errors, []);
        assert.equal(
            readFileSync(join(root, "manifest.json"), "utf8"),
            '{"unrelated":"retained"}\n'
        );
        const manifest = JSON.parse(preview.outputs[0].content);
        const abcHash =
            "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad";
        const binaryHash = createHash("sha256")
            .update(Buffer.from([0, 255, 13, 10]))
            .digest("hex");
        const rootHash = createHash("sha256")
            .update(
                Buffer.concat([
                    Buffer.from([7, 5, 0]),
                    Buffer.from("a.bin"),
                    Buffer.from(abcHash, "hex"),
                    Buffer.from([5, 0]),
                    Buffer.from("b.bin"),
                    Buffer.from(binaryHash, "hex")
                ])
            )
            .digest("hex");
        assert.deepEqual(manifest, {
            unrelated: "retained",
            inventory: {
                files: [
                    { path: "a.bin", sha256: abcHash },
                    { path: "b.bin", sha256: binaryHash }
                ],
                count: 2,
                root: rootHash
            }
        });
        assert.deepEqual(
            materializeAssertions(root, { ...options, write: true }).errors,
            []
        );
        assert.deepEqual(runAssertions(root, options).findings, []);
        assert.equal(
            materializeAssertions(root, options).outputs[0].changed,
            false
        );
        writeFileSync(join(root, "a.bin"), "abcd");
        assert.ok(
            runAssertions(root, options).findings.some((f) =>
                f.message.includes("inventory mismatch")
            )
        );
    }));

test("digest rejects duplicate entries, unsupported algorithms and self inclusion", () =>
    fixture((root) => {
        const options = { packs: ["pack.json"] };
        materializeAssertions(root, { ...options, write: true });
        const manifest = JSON.parse(
            readFileSync(join(root, "manifest.json"), "utf8")
        );
        manifest.inventory.files.push(manifest.inventory.files[0]);
        writeFileSync(join(root, "manifest.json"), JSON.stringify(manifest));
        assert.ok(
            runAssertions(root, options).findings.some((f) =>
                f.message.includes("duplicate")
            )
        );
        writeFileSync(
            join(root, "pack.json"),
            JSON.stringify({
                ...pack,
                rules: [{ ...pack.rules[0], algorithm: "md5" }]
            })
        );
        assert.match(
            runAssertions(root, options).findings[0].message,
            /only sha256/
        );
        writeFileSync(
            join(root, "pack.json"),
            JSON.stringify({
                ...pack,
                sources: { tracked: { include: ["manifest.json"] } }
            })
        );
        assert.match(
            runAssertions(root, options).findings[0].message,
            /cannot track itself/
        );
    }));

test("materialization refuses symlink outputs and never changes their targets", () =>
    fixture((root) => {
        writeFileSync(join(root, "target.json"), '{"untouched":true}\n');
        unlinkSync(join(root, "manifest.json"));
        symlinkSync("target.json", join(root, "manifest.json"));
        const result = materializeAssertions(root, {
            packs: ["pack.json"],
            write: true
        });
        assert.ok(result.errors.some((e) => e.includes("symbolic link")));
        assert.equal(
            readFileSync(join(root, "target.json"), "utf8"),
            '{"untouched":true}\n'
        );
    }));

test("digest materialization hashes the final staged bytes", () =>
    fixture((root) => {
        writeFileSync(join(root, "a.bin"), "value: { first: 1,second: 2 }\n");
        const rules = [
            ...pack.rules,
            {
                id: "FORMAT",
                kind: "format",
                message: "format drift",
                source: { include: "a.bin" },
                formatter: "yaml_flow_mapping_spacing",
                materialize: { operation: "rewrite" }
            }
        ];
        writeFileSync(
            join(root, "pack.json"),
            JSON.stringify({ ...pack, rules })
        );
        const options = { packs: ["pack.json"] };
        const result = materializeAssertions(root, { ...options, write: true });
        assert.deepEqual(result.errors, []);
        assert.deepEqual(runAssertions(root, options).findings, []);
        const manifest = JSON.parse(
            readFileSync(join(root, "manifest.json"), "utf8")
        );
        assert.equal(
            manifest.inventory.files[0].sha256,
            createHash("sha256")
                .update(readFileSync(join(root, "a.bin")))
                .digest("hex")
        );
    }));
