// @ts-check

/**
 * Unit tests for the FormPack class.
 *
 * Covers: load/loadIfExists, path resolution, import order and form override,
 * accessors, and validate() — including the target-collision and unknown-kind
 * reports that the pack's JSON Schema cannot express.
 *
 * @module tests/classes/FormPack_test
 */

import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";

import { FormPack } from "../../lib/record-schema/FormPack.mjs";
import { Repository } from "../../lib/record-schema/Repository.mjs";

/**
 * @returns {{ dir: string, write: (name: string, data: unknown) => string, cleanup: () => void }}
 */
function workspace() {
    const dir = mkdtempSync(join(tmpdir(), "form-pack-"));
    return {
        dir,
        write(name, data) {
            const path = join(dir, name);
            writeFileSync(path, JSON.stringify(data));
            return path;
        },
        cleanup() {
            rmSync(dir, { recursive: true, force: true });
        }
    };
}

/**
 * @param {Object} [overrides]
 * @returns {Object}
 */
function pack(overrides = {}) {
    return {
        schema: "record-schema-form-pack",
        schema_version: 1,
        pack_id: "example-pack",
        forms: {
            "example-form": {
                document: { path: "forms/a.pdf", sha256: "a".repeat(64) },
                xfa: "remove",
                unresolved: "skip",
                bindings: [{ bind: "text", field: "Name", target: "t1" }]
            }
        },
        ...overrides
    };
}

describe("loading", () => {
    it("reads a pack and remembers where it came from", () => {
        const space = workspace();
        try {
            const path = space.write("a.json", pack());
            const loaded = FormPack.load(path);
            assert.equal(loaded.data.pack_id, "example-pack");
            assert.equal(loaded.source_path, path);
        } finally {
            space.cleanup();
        }
    });

    it("returns null rather than throwing for a missing pack", () => {
        assert.equal(FormPack.loadIfExists("/nonexistent/pack.json"), null);
    });

    it("resolves a relative path against the search roots in order", () => {
        const first = workspace();
        const second = workspace();
        try {
            second.write("only-here.json", pack());
            assert.equal(
                FormPack.resolvePath(first.dir, "only-here.json", [second.dir]),
                join(second.dir, "only-here.json")
            );
            assert.equal(
                FormPack.resolvePath(first.dir, "absent.json", [second.dir]),
                join(first.dir, "absent.json"),
                "falls back to the root when nothing exists"
            );
        } finally {
            first.cleanup();
            second.cleanup();
        }
    });
});

describe("accessors", () => {
    it("reports the forms it declares", () => {
        const loaded = new FormPack(pack());
        assert.deepEqual(loaded.formIds(), ["example-form"]);
        assert.equal(loaded.getForm("example-form").xfa, "remove");
    });

    it("names the forms it has when asked for one it does not", () => {
        assert.throws(
            () => new FormPack(pack()).getForm("absent"),
            /no form named absent; this pack declares example-form/
        );
    });

    it("reports imports", () => {
        assert.deepEqual(new FormPack(pack()).getImports(), []);
        assert.equal(new FormPack(pack()).hasImports(), false);
        const importing = new FormPack(pack({ imports: ["base.json"] }));
        assert.deepEqual(importing.getImports(), ["base.json"]);
        assert.equal(importing.hasImports(), true);
    });
});

describe("merging", () => {
    it("takes a form from the pack that imported last", () => {
        const space = workspace();
        try {
            space.write("base.json", pack({ pack_id: "base-pack" }));
            const override = pack({
                pack_id: "override-pack",
                imports: ["base.json"]
            });
            override.forms["example-form"].xfa = "keep";
            override.forms["other-form"] = {
                document: { path: "forms/b.pdf", sha256: "b".repeat(64) },
                xfa: "remove",
                unresolved: "blank",
                bindings: [{ bind: "text", field: "Other", target: "t2" }]
            };
            space.write("override.json", override);

            const merged = FormPack.loadMerged(space.dir, ["override.json"]);
            assert.deepEqual(
                merged.packs.map((p) => p.data.pack_id),
                ["base-pack", "override-pack"]
            );
            assert.equal(merged.forms["example-form"].xfa, "keep");
            assert.deepEqual(Object.keys(merged.forms).sort(), [
                "example-form",
                "other-form"
            ]);
        } finally {
            space.cleanup();
        }
    });

    it("replaces a form whole rather than merging its bindings", () => {
        const space = workspace();
        try {
            space.write("base.json", pack({ pack_id: "base-pack" }));
            const override = pack({
                pack_id: "override-pack",
                imports: ["base.json"]
            });
            override.forms["example-form"].bindings = [
                { bind: "text", field: "Replaced", target: "t9" }
            ];
            space.write("override.json", override);

            const merged = FormPack.loadMerged(space.dir, ["override.json"]);
            assert.deepEqual(merged.forms["example-form"].bindings, [
                { bind: "text", field: "Replaced", target: "t9" }
            ]);
        } finally {
            space.cleanup();
        }
    });

    it("visits a shared import once", () => {
        const space = workspace();
        try {
            space.write("base.json", pack({ pack_id: "base-pack" }));
            space.write(
                "left.json",
                pack({ pack_id: "left-pack", imports: ["base.json"] })
            );
            space.write(
                "right.json",
                pack({ pack_id: "right-pack", imports: ["base.json"] })
            );
            const merged = FormPack.loadMerged(space.dir, [
                "left.json",
                "right.json"
            ]);
            assert.deepEqual(
                merged.packs.map((p) => p.data.pack_id),
                ["base-pack", "left-pack", "right-pack"]
            );
        } finally {
            space.cleanup();
        }
    });
});

describe("validate", () => {
    it("accepts a well-formed pack", () => {
        assert.deepEqual(new FormPack(pack()).validate(), {
            valid: true,
            errors: []
        });
    });

    it("reports a wrong schema name, version and pack id", () => {
        const result = new FormPack(
            pack({ schema: "other", schema_version: 0, pack_id: "X" })
        ).validate();
        assert.equal(result.valid, false);
        assert.deepEqual(result.errors.map((error) => error.path).sort(), [
            "pack_id",
            "schema",
            "schema_version"
        ]);
    });

    it("reports imports that are not strings", () => {
        const result = new FormPack(pack({ imports: [""] })).validate();
        assert.equal(result.errors[0].path, "imports[0]");
    });

    it("names an unknown binding kind rather than failing opaquely", () => {
        const data = pack();
        data.forms["example-form"].bindings = [
            { bind: "sideways", field: "Name", target: "t1" }
        ];
        const result = new FormPack(data).validate();
        assert.match(
            result.errors[0].message,
            /Unknown binding kind "sideways"; expected one of text, segments, check, button_group, choice/
        );
    });

    it("reports two bindings competing for one PDF field", () => {
        const data = pack();
        data.forms["example-form"].bindings = [
            { bind: "text", field: "Name", target: "shared" },
            { bind: "text", field: "Other", target: "shared" }
        ];
        const result = new FormPack(data).validate();
        assert.match(
            result.errors[0].message,
            /Target shared is written by 2 bindings/
        );
    });

    it("counts every target a segments or button_group binding writes", () => {
        const data = pack();
        data.forms["example-form"].bindings = [
            {
                bind: "segments",
                field: "Number",
                segments: [
                    { target: "shared", length: 2 },
                    { target: "b", length: 7 }
                ]
            },
            {
                bind: "button_group",
                field: "Kind",
                options: [
                    { value: "one", target: "shared", on_state: "1" },
                    { value: "two", target: "c", on_state: "2" }
                ]
            }
        ];
        const result = new FormPack(data).validate();
        assert.match(
            result.errors[0].message,
            /Target shared is written by 2 bindings/
        );
    });

    it("reports a duplicate option value", () => {
        const data = pack();
        data.forms["example-form"].bindings = [
            {
                bind: "button_group",
                field: "Kind",
                options: [
                    { value: "one", target: "a", on_state: "1" },
                    { value: "one", target: "b", on_state: "2" }
                ]
            }
        ];
        const result = new FormPack(data).validate();
        assert.match(result.errors[0].message, /Duplicate option value "one"/);
    });

    it("reports a forms entry that is not an object", () => {
        const result = new FormPack(pack({ forms: [] })).validate();
        assert.equal(result.errors[0].path, "forms");
    });
});

describe("upstream discovery", () => {
    it("reads form_packs from SCHEMA_UPSTREAM.yaml", () => {
        const space = workspace();
        try {
            writeFileSync(
                join(space.dir, "SCHEMA_UPSTREAM.yaml"),
                [
                    "schema: record-schema-upstream",
                    "schema_version: 1",
                    "",
                    "record_schema:",
                    "  form_packs:",
                    "    - forms/packs/irs-w9-2024-03.json",
                    "  render_packs:",
                    "    - render/packs/base-v1.json",
                    ""
                ].join("\n")
            );
            const discovered = Repository.discoverRepository(space.dir);
            assert.equal(discovered.resolved_via, "upstream");
            assert.deepEqual(discovered.form_pack_paths, [
                "forms/packs/irs-w9-2024-03.json"
            ]);
            assert.deepEqual(
                discovered.render_pack_paths,
                ["render/packs/base-v1.json"],
                "the render packs are untouched"
            );
        } finally {
            space.cleanup();
        }
    });

    it("leaves form_pack_paths empty when nothing declares one", () => {
        const space = workspace();
        try {
            writeFileSync(
                join(space.dir, "SCHEMA_UPSTREAM.yaml"),
                "schema: record-schema-upstream\nschema_version: 1\n"
            );
            assert.deepEqual(
                Repository.discoverRepository(space.dir).form_pack_paths,
                []
            );
        } finally {
            space.cleanup();
        }
    });
});
