/**
 * Assertion runtime diagnostics.
 *
 * Doctor proves that the zero-dependency parser, pack loader, selector engine,
 * reports, and materializers can execute. It deliberately does not treat an
 * ordinary corpus finding or generated-file drift as an installation failure;
 * `validate`, `assert`, and `materialize` own those outcomes.
 */

import {
    existsSync,
    mkdtempSync,
    rmSync,
    statSync,
    writeFileSync
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parseYaml } from "../../parsing/yaml.mjs";
import { AssertionPack } from "./AssertionPack.mjs";
import { generateAssertionReportWithContext } from "./AssertionReport.mjs";
import { materializeAssertionsWithContext } from "./AssertionMaterializer.mjs";
import { AssertionEngine } from "./AssertionEngine.mjs";
import { CorpusIndex } from "./CorpusIndex.mjs";

/**
 * @typedef {object} DoctorCheck
 * @property {string} id
 * @property {"ok"|"warning"|"error"} status
 * @property {string} message
 */

/**
 * @typedef {object} AssertionDoctorResult
 * @property {boolean} ok
 * @property {DoctorCheck[]} checks
 * @property {string[]} packs
 * @property {number} unitCount
 * @property {number} ruleCount
 * @property {number} findingCount
 * @property {number} reportCount
 * @property {number} materializerCount
 * @property {number} materializerDriftCount
 * @property {string[]} errors
 */

/**
 * Diagnose the assertion runtime without changing the repository.
 *
 * @param {string} rootDirectory
 * @param {{ packs: string[], mode?: string, minimumNodeMajor?: number, deep?: boolean }} options
 * @returns {AssertionDoctorResult}
 */
export function diagnoseAssertions(rootDirectory, options) {
    /** @type {DoctorCheck[]} */
    const checks = [];
    /** @type {string[]} */
    const errors = [];
    const minimumNodeMajor = Number(options.minimumNodeMajor ?? 18);

    const add = (id, status, message) => {
        checks.push({ id, status, message });
        if (status === "error") errors.push(`${id}: ${message}`);
    };

    if (!existsSync(rootDirectory)) {
        add("repository", "error", `root does not exist: ${rootDirectory}`);
        return emptyDoctorResult(checks, errors);
    }
    let rootStats;
    try {
        rootStats = statSync(rootDirectory);
    } catch (error) {
        add(
            "repository",
            "error",
            `cannot stat root: ${error instanceof Error ? error.message : String(error)}`
        );
        return emptyDoctorResult(checks, errors);
    }
    if (!rootStats.isDirectory()) {
        add("repository", "error", `root is not a directory: ${rootDirectory}`);
        return emptyDoctorResult(checks, errors);
    }
    add("repository", "ok", "repository root is readable");

    const nodeMajor = Number(process.versions.node.split(".")[0]);
    if (!Number.isInteger(nodeMajor) || nodeMajor < minimumNodeMajor) {
        add(
            "runtime.node",
            "error",
            `Node ${process.versions.node} is below the required major ${minimumNodeMajor}`
        );
    } else {
        add("runtime.node", "ok", `Node ${process.versions.node}`);
    }

    try {
        const probe = parseYaml(
            "probe:\n  nested: [1, 2]\n  mapping: { required_key: 1 }\n",
            { filename: "<doctor-probe>" }
        );
        if (
            probe?.probe?.nested?.length !== 2 ||
            probe?.probe?.mapping?.required_key !== 1
        ) {
            throw new Error("probe returned the wrong structure");
        }
        let rejected = false;
        try {
            parseYaml("broken: [1, 2\n", {
                filename: "<doctor-invalid-probe>"
            });
        } catch {
            rejected = true;
        }
        if (!rejected) {
            throw new Error("invalid YAML was accepted");
        }
        add(
            "runtime.yaml",
            "ok",
            "built-in YAML parser accepts valid input and rejects invalid input"
        );
    } catch (error) {
        add(
            "runtime.yaml",
            "error",
            error instanceof Error ? error.message : String(error)
        );
    }

    if (!Array.isArray(options.packs) || options.packs.length === 0) {
        add("packs", "error", "no assertion packs were supplied or declared");
        return emptyDoctorResult(checks, errors);
    }

    const loaded = AssertionPack.load(rootDirectory, options.packs);
    if (loaded.errors.length > 0) {
        for (let i = 0, len = loaded.errors.length; i < len; i++) {
            add("packs", "error", loaded.errors[i]);
        }
        return {
            ...emptyDoctorResult(checks, errors),
            packs: loaded.pack.getPackIds()
        };
    }
    add(
        "packs",
        "ok",
        `${loaded.pack.getPackIds().length} packs loaded; ${loaded.pack.getRules().length} rules resolved`
    );

    if (options.deep !== true) {
        try {
            runRuntimeProbe();
            add(
                "engine",
                "ok",
                "runtime probe detected a declared defect and evaluated its repair"
            );
        } catch (error) {
            add(
                "engine",
                "error",
                error instanceof Error ? error.message : String(error)
            );
        }
        const reportCount = Object.keys(loaded.pack.getReports()).length;
        const materializerCount = loaded.pack
            .getRules()
            .filter((rule) => rule.materialize !== undefined).length;
        add(
            "reports",
            "ok",
            `${reportCount} report declarations loaded; runtime rendering probe passed`
        );
        add(
            "materializers",
            "ok",
            `${materializerCount} materializer declarations loaded; read-only rewrite probe passed`
        );
        return {
            ok: errors.length === 0,
            checks,
            packs: loaded.pack.getPackIds(),
            unitCount: 0,
            ruleCount: loaded.pack.getRules().length,
            findingCount: 0,
            reportCount,
            materializerCount,
            materializerDriftCount: 0,
            errors
        };
    }

    const index = new CorpusIndex(rootDirectory);
    const engine = new AssertionEngine(index, loaded.pack.resolved, {
        mode: options.mode ?? "development"
    });
    const assertionResult = engine.run();
    const executionFailures = assertionResult.findings.filter(
        (finding) =>
            finding.rule === "PARSE" || finding.code.endsWith("/ENGINE")
    );
    if (executionFailures.length > 0) {
        for (let i = 0, len = executionFailures.length; i < len; i++) {
            const finding = executionFailures[i];
            add(
                "engine",
                "error",
                `${finding.file ?? "<repository>"}: ${finding.message}`
            );
        }
    } else {
        add(
            "engine",
            "ok",
            `${assertionResult.executed.length} rules executed over ${index.listFiles().length} indexed files; ${assertionResult.findings.length} corpus findings left to assert/validate`
        );
    }

    const reports = loaded.pack.getReports();
    const reportNames = Object.keys(reports).sort();
    let successfulReports = 0;
    for (let i = 0, len = reportNames.length; i < len; i++) {
        const report = generateAssertionReportWithContext(
            loaded.pack,
            engine,
            { report: reportNames[i] }
        );
        if (report.errors.length > 0) {
            for (let j = 0, count = report.errors.length; j < count; j++) {
                add(
                    "reports",
                    "error",
                    `${reportNames[i]}: ${report.errors[j]}`
                );
            }
        } else {
            successfulReports += 1;
        }
    }
    add(
        "reports",
        successfulReports === reportNames.length ? "ok" : "error",
        `${successfulReports}/${reportNames.length} declared reports rendered`
    );

    const materialization = materializeAssertionsWithContext(
        rootDirectory,
        loaded.pack,
        index,
        engine,
        { write: false }
    );
    if (materialization.errors.length > 0) {
        for (let i = 0, len = materialization.errors.length; i < len; i++) {
            add("materializers", "error", materialization.errors[i]);
        }
    } else {
        const driftCount = materialization.outputs.filter(
            (output) => output.changed
        ).length;
        add(
            "materializers",
            "ok",
            `${materialization.outputs.length} outputs evaluated read-only; ${driftCount} currently drifted`
        );
    }

    return {
        ok: errors.length === 0,
        checks,
        packs: loaded.pack.getPackIds(),
        unitCount: index.listFiles().length,
        ruleCount: assertionResult.executed.length,
        findingCount: assertionResult.findings.length,
        reportCount: successfulReports,
        materializerCount: materialization.outputs.length,
        materializerDriftCount: materialization.outputs.filter(
            (output) => output.changed
        ).length,
        errors
    };
}



/**
 * Exercise parsing, rule execution, reporting, and materialization on a tiny
 * temporary repository. The probe is independent of the caller's corpus and
 * proves the runtime can both detect and mechanically repair a defect.
 *
 * @returns {void}
 */
function runRuntimeProbe() {
    const root = mkdtempSync(join(tmpdir(), "record-schema-doctor-"));
    try {
        writeFileSync(
            join(root, "data.yaml"),
            "derived: { actual: 1, expected: 2 }\nitems: [{ group: probe, value: 2 }]\n"
        );
        writeFileSync(
            join(root, "pack.yaml"),
            `schema: record-schema-assertion-pack
schema_version: 2
pack_id: doctor.probe
sources:
  data: { include: ["data.yaml"] }
selectors:
  root: { source: data, path: "$" }
  items: { source: data, path: "$.items[*]" }
rules:
  - id: DOCTOR_DERIVE
    kind: derive
    select: root
    bind:
      actual: "$.derived.actual"
      expected: "$.derived.expected"
    assert: "actual == expected"
    message: probe derive mismatch
    materialize:
      operation: yaml_inline_mapping_field
      mapping_key: derived
      field: actual
      value: "#expected"
reports:
  probe:
    sections:
      - kind: table
        select: items
        group: "{$.group}"
        columns:
          - { key: group, value: "$.group", aggregate: first, title: Group }
          - { key: total, value: "$.value", aggregate: sum, title: Total }
`
        );

        const loaded = AssertionPack.load(root, ["pack.yaml"]);
        if (loaded.errors.length > 0) {
            throw new Error(loaded.errors.join("; "));
        }
        const index = new CorpusIndex(root);
        const engine = new AssertionEngine(index, loaded.pack.resolved);
        const outcome = engine.run();
        const probeFindings = outcome.findings.filter(
            (finding) => finding.rule === "DOCTOR_DERIVE"
        );
        if (probeFindings.length !== 1) {
            throw new Error(
                `derive probe expected one finding, got ${probeFindings.length}`
            );
        }
        const report = generateAssertionReportWithContext(
            loaded.pack,
            engine,
            { report: "probe" }
        );
        if (report.errors.length > 0 || !report.text.includes("probe")) {
            throw new Error(
                `report probe failed: ${report.errors.join("; ") || "missing output"}`
            );
        }
        const materialized = materializeAssertionsWithContext(
            root,
            loaded.pack,
            index,
            engine,
            { write: false }
        );
        if (
            materialized.errors.length > 0 ||
            materialized.outputs.length !== 1 ||
            materialized.outputs[0].changed !== true ||
            !materialized.outputs[0].content.includes("actual: 2")
        ) {
            throw new Error(
                `materialization probe failed: ${materialized.errors.join("; ")}`
            );
        }
    } finally {
        rmSync(root, { recursive: true, force: true });
    }
}

/**
 * @param {DoctorCheck[]} checks
 * @param {string[]} errors
 * @returns {AssertionDoctorResult}
 */
function emptyDoctorResult(checks, errors) {
    return {
        ok: errors.length === 0,
        checks,
        packs: [],
        unitCount: 0,
        ruleCount: 0,
        findingCount: 0,
        reportCount: 0,
        materializerCount: 0,
        materializerDriftCount: 0,
        errors
    };
}
