import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, unlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import test from "node:test";

import { Profile } from "../lib/record-schema/Profile.mjs";
import { Repository } from "../lib/record-schema/Repository.mjs";

function write(path, source) {
    mkdirSync(resolve(path, ".."), { recursive: true });
    writeFileSync(path, source);
}

test("profile exposes metadata overlays and typed document schemas", () => {
    const profile = Profile.parse(`schema: record-schema-registry-profile
schema_version: 1
rules:
  meta_policies:
    overlay_schema_paths: [overlays/deployment.json]
  structured_document_schemas:
    - doc_type: PLAN
      schema_path: schema/plan.json
      extensions: [json]
      required: true
      max_count: 1
    - doc_type: EVD
      schema_path: schema/evidence-dossier.json
      extensions: [json]
      required: true
      max_count: 1
`);
    assert.deepEqual(profile.getMetaOverlaySchemaPaths(), ["overlays/deployment.json"]);
    assert.deepEqual(profile.getStructuredDocumentSchemas(), [{
        doc_type: "PLAN",
        schema_path: "schema/plan.json",
        extensions: ["json"],
        required: true,
        min_count: null,
        max_count: 1,
    }, {
        doc_type: "EVD",
        schema_path: "schema/evidence-dossier.json",
        extensions: ["json"],
        required: true,
        min_count: null,
        max_count: 1,
    }]);
});

test("repository validates profile-bound structured JSON documents", () => {
    const root = mkdtempSync(resolve(tmpdir(), "record-schema-structured-"));
    const recordDirectory = resolve(root, "records/DEP-00001-test");
    write(resolve(root, "SCHEMA_UPSTREAM.yaml"), `schema: record-schema-upstream
schema_version: 1
profile_path: profiles/deployment.profile.yaml
registry_path: registry/deployment.yaml
`);
    write(resolve(root, "profiles/deployment.profile.yaml"), `schema: record-schema-registry-profile
schema_version: 1
profile_id: deployment-test
rules:
  buckets:
    - bucket: records
      path: records
      record_constraints:
        require_series_code: DEP
        require_meta: true
        require_primary_document: true
        require_documents_primary_ref: true
  structured_document_schemas:
    - doc_type: PLAN
      schema_path: schema/plan.schema.json
      extensions: [json]
      required: true
      max_count: 1
`);
    write(resolve(root, "registry/deployment.yaml"), `schema: record-schema-registry
schema_version: 1
series:
  - code: DEP
    tier: suggested
    name: Deployment
    description: Deployment records.
doc_types:
  - code: DOC
    name: Report
    description: Report.
  - code: PLAN
    name: Plan
    description: Plan.
`);
    write(resolve(root, "schema/plan.schema.json"), JSON.stringify({
        $schema: "https://json-schema.org/draft/2020-12/schema",
        type: "object",
        required: ["schema", "sequence"],
        properties: {
            schema: { const: "deployment-plan" },
            sequence: { type: "integer", minimum: 1 },
        },
        additionalProperties: false,
    }, null, 2));
    write(resolve(root, "schema/record.meta.schema.json"), JSON.stringify({
        type: "object",
        required: ["schema", "schema_version", "id", "series_code", "series", "title", "status"],
        properties: {
            schema: { const: "record-schema" },
            schema_version: { type: "integer" },
            id: { type: "string" },
            series_code: { type: "string" },
            series: { type: "integer" },
            title: { type: "string" },
            status: { type: "object" },
        },
        additionalProperties: true,
    }, null, 2));
    write(resolve(recordDirectory, "DEP-00001_META.yaml"), `schema: record-schema
schema_version: 1
id: DEP-00001
series_code: DEP
series: 1
title: Test deployment
status:
  phase: final
  last_updated: 2026-07-17T00:00:00.000Z
documents:
  primary:
    - path: DEP-00001_DOC-report.md
`);
    write(resolve(recordDirectory, "DEP-00001_DOC-report.md"), "# Report\n\n---\n\nBody\n");
    const planPath = resolve(recordDirectory, "DEP-00001_PLAN-deployment.json");
    write(planPath, JSON.stringify({ schema: "deployment-plan", sequence: 1 }));

    const repository = Repository.fromFolder(root);
    const record = repository.findRecords()[0];
    assert.ok(record);
    assert.deepEqual(repository.validateConfiguredSchemaMaterials(), []);
    assert.deepEqual(repository.validateStructuredDocuments(record), []);

    const duplicatePlanPath = resolve(recordDirectory, "DEP-00001_PLAN-second.json");
    write(duplicatePlanPath, JSON.stringify({ schema: "deployment-plan", sequence: 1 }));
    const duplicateIssues = repository.validateStructuredDocuments(record);
    assert.equal(duplicateIssues.length, 1);
    assert.equal(duplicateIssues[0].code, "structured.count.maximum");
    unlinkSync(duplicatePlanPath);

    write(planPath, JSON.stringify({ schema: "deployment-plan", sequence: 0 }));
    const issues = repository.validateStructuredDocuments(record);
    assert.equal(issues.length, 1);
    assert.equal(issues[0].code, "structured.schema");
});


test("repository rejects unsafe, missing, and contradictory configured schemas", () => {
    const root = mkdtempSync(resolve(tmpdir(), "record-schema-configured-"));
    write(resolve(root, "SCHEMA_UPSTREAM.yaml"), `schema: record-schema-upstream
schema_version: 1
profile_path: profiles/configured.profile.yaml
`);
    write(resolve(root, "profiles/configured.profile.yaml"), `schema: record-schema-registry-profile
schema_version: 1
profile_id: configured-test
rules:
  meta_policies:
    overlay_schema_paths:
      - ../outside.schema.json
      - overlays/missing.schema.json
  structured_document_schemas:
    - doc_type: PLAN
      schema_path: schema/missing.schema.json
      extensions: [json]
      min_count: 2
      max_count: 1
`);

    const repository = Repository.fromFolder(root);
    const issues = repository.validateConfiguredSchemaMaterials();
    assert.deepEqual(issues.map((issue) => issue.code), [
        "configured.schema.path",
        "configured.schema.missing",
        "configured.schema.missing",
        "structured.count.range",
    ]);
});
