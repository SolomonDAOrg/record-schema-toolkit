import assert from "node:assert/strict";
import test from "node:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";

import { Repository } from "../lib/record-schema/Repository.mjs";
import { Registry } from "../lib/record-schema/Registry.mjs";

function makeTemporaryTree(prefix) {
    const rootDirectory = mkdtempSync(join(tmpdir(), prefix));
    return {
        rootDirectory,
        write(relativePath, text) {
            const absolutePath = join(rootDirectory, relativePath);
            mkdirSync(dirname(absolutePath), { recursive: true });
            writeFileSync(absolutePath, text, "utf8");
            return absolutePath;
        },
        cleanup() {
            rmSync(rootDirectory, { recursive: true, force: true });
        }
    };
}

test("Repository.fromFolder accepts a generic external schema-material root", () => {
    const project = makeTemporaryTree("record-schema-project-");
    const schemaMaterials = makeTemporaryTree("record-schema-materials-");
    project.write(
        "SCHEMA_UPSTREAM.yaml",
        [
            "schema: record-schema-upstream",
            "record_schema:",
            "  provides:",
            "    - id: example-domain",
            "      name: Example Domain",
            "      kind: schema",
            ""
        ].join("\n")
    );
    schemaMaterials.write(
        "profiles/example-domain.profile.yaml",
        [
            "schema: record-schema-profile",
            "rules:",
            "  meta_policies:",
            "    overlay_schema_paths:",
            "      - overlays/example-domain.record.meta.schema.json",
            "extensions:",
            "  arbitrary-domain-extension:",
            "    policy: caller-defined",
            ""
        ].join("\n")
    );
    schemaMaterials.write(
        "schema/record.meta.schema.json",
        JSON.stringify({
            $id: "https://example.test/record.meta.schema.json",
            type: "object",
            required: ["base_value"]
        })
    );
    schemaMaterials.write(
        "overlays/example-domain.record.meta.schema.json",
        JSON.stringify({
            allOf: [
                {
                    $ref: "https://example.test/record.meta.schema.json"
                }
            ],
            type: "object",
            required: ["extension_value"]
        })
    );

    const repository = Repository.fromFolder(project.rootDirectory, {
        schemaMaterialRoots: [schemaMaterials.rootDirectory]
    });
    const profile = repository.getProfile();

    assert.ok(profile);
    assert.equal(
        profile.source_path,
        resolve(
            schemaMaterials.rootDirectory,
            "profiles/example-domain.profile.yaml"
        )
    );
    assert.deepEqual(
        profile.getExtension("arbitrary-domain-extension"),
        { policy: "caller-defined" }
    );
    assert.deepEqual(repository.getSchemaMaterialRoots().slice(0, 2), [
        resolve(project.rootDirectory),
        resolve(schemaMaterials.rootDirectory)
    ]);
    const schemas = repository.getRecordMetaSchemas();
    assert.equal(schemas.length, 2);
    assert.deepEqual(
        schemas[1].validate({ base_value: true, extension_value: true }),
        []
    );
    assert.deepEqual(repository.validateConfiguredSchemaMaterials(), []);

    project.cleanup();
    schemaMaterials.cleanup();
});

test("active repository schemas take precedence over external schema roots", () => {
    const project = makeTemporaryTree("record-schema-precedence-project-");
    const schemaMaterials = makeTemporaryTree(
        "record-schema-precedence-materials-"
    );
    const toolkitRoot = makeTemporaryTree("record-schema-toolkit-root-");
    project.write(
        "schema/record.meta.schema.json",
        JSON.stringify({ marker: "project" })
    );
    schemaMaterials.write(
        "schema/record.meta.schema.json",
        JSON.stringify({ marker: "external" })
    );

    const repository = Repository.open(project.rootDirectory);
    repository.setToolkitDir(toolkitRoot.rootDirectory);
    repository.addSchemaMaterialRoot(schemaMaterials.rootDirectory);
    const schema = repository.getRecordMetaSchema();

    assert.ok(schema);
    assert.equal(schema.definition.marker, "project");

    project.cleanup();
    schemaMaterials.cleanup();
    toolkitRoot.cleanup();
});

test("repository schemas resolve canonical $id references locally", () => {
    const project = makeTemporaryTree("record-schema-reference-project-");
    const toolkitRoot = makeTemporaryTree("record-schema-reference-toolkit-");
    project.write(
        "schema/record.meta.schema.json",
        JSON.stringify({
            $id: "https://example.test/record.meta.schema.json",
            type: "object",
            required: ["base_value"],
            properties: {
                base_value: { type: "string" }
            }
        })
    );
    project.write(
        "overlays/example.record.meta.schema.json",
        JSON.stringify({
            $id: "https://example.test/overlays/example.record.meta.schema.json",
            allOf: [
                {
                    $ref: "https://example.test/record.meta.schema.json"
                }
            ],
            type: "object",
            required: ["extension_value"],
            properties: {
                extension_value: { type: "integer" }
            }
        })
    );
    project.write(
        "example.profile.yaml",
        [
            "schema: record-schema-profile",
            "rules:",
            "  meta_policies:",
            "    overlay_schema_paths:",
            "      - overlays/example.record.meta.schema.json",
            ""
        ].join("\n")
    );

    const repository = Repository.open(project.rootDirectory);
    repository.setToolkitDir(toolkitRoot.rootDirectory);
    repository.loadProfile("example.profile.yaml");
    const schemas = repository.getRecordMetaSchemas();

    assert.equal(schemas.length, 2);
    assert.deepEqual(
        schemas[1].validate({ base_value: "present", extension_value: 1 }),
        []
    );
    assert.ok(
        schemas[1]
            .validate({ extension_value: 1 })
            .some((error) => error.path === "base_value")
    );

    project.cleanup();
    toolkitRoot.cleanup();
});

test("registry validation reports each merged file and local document index", () => {
    const project = makeTemporaryTree("record-schema-registry-sources-");
    const firstRegistryPath = project.write(
        "registry/first.yaml",
        "schema: record-schema-registry\nseries: []\n"
    );
    const secondRegistryPath = project.write(
        "registry/second.yaml",
        "schema: record-schema-registry\ndoc_types: []\n"
    );
    project.write(
        "schema/registry.schema.json",
        JSON.stringify({
            type: "object",
            required: ["required_for_test"]
        })
    );

    const repository = Repository.open(project.rootDirectory);
    repository.setRegistry(
        Registry.loadMerged([firstRegistryPath, secondRegistryPath])
    );
    const issues = repository.validateRegistry();

    assert.deepEqual(
        issues.map((issue) => issue.file),
        ["registry/first.yaml#doc1", "registry/second.yaml#doc1"]
    );
    project.cleanup();
});

test("registry source document indexes include non-registry YAML documents", () => {
    const project = makeTemporaryTree("record-schema-registry-indexes-");
    const registryPath = project.write(
        "registry/mixed.yaml",
        [
            "schema: unrelated-document",
            "---",
            "schema: record-schema-registry",
            "series: []",
            ""
        ].join("\n")
    );
    project.write(
        "schema/registry.schema.json",
        JSON.stringify({
            type: "object",
            required: ["required_for_test"]
        })
    );

    const repository = Repository.open(project.rootDirectory);
    repository.setRegistry(Registry.loadMerged([registryPath]));
    const issues = repository.validateRegistry();

    assert.deepEqual(
        issues.map((issue) => issue.file),
        ["registry/mixed.yaml#doc2"]
    );
    project.cleanup();
});
