import test from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { LanguageRuleEngine } from "../lib/language-rules/LanguageRuleEngine.mjs";
import { LanguageRuleSetRepository } from "../lib/language-rules/LanguageRuleSetRepository.mjs";

function makeTempRoot() {
    return mkdtempSync(
        resolve(tmpdir(), "record-schema-toolkit-language-rules-")
    );
}

function writeRuleSet(root, category, fileName, yaml) {
    const dir = resolve(
        root,
        "rules",
        category,
        fileName.replace(/\.yaml$/, "")
    );
    mkdirSync(dir, { recursive: true });
    writeFileSync(resolve(dir, fileName), yaml);
}

test("loads concrete language rule-set documents recursively", () => {
    const root = makeTempRoot();
    writeRuleSet(
        root,
        "linting",
        "SLR-00002_LNT-solomon-linting.yaml",
        `schema: language-rule-set
schema_version: 1
category_type: linting
rule_set_id: solomon-linting
name: Solomon linting rules
defaults:
  severity: error
  enabled: true
linting_rules:
- rule_id: source-indentation-four-spaces
  name: Use four-space indentation
  lint_kind: indentation
  target:
    file_extensions:
    - ts
  enforce:
    disallow_tabs: true
    indent_width: 4
`
    );
    const repo = LanguageRuleSetRepository.open(root);
    assert.equal(repo.getRuleSets().length, 1);
    assert.equal(repo.getRules().length, 1);
    assert.deepEqual(repo.getTargetExtensions(), ["ts"]);
});

test("applies text and parser-backed language rules", async () => {
    const root = makeTempRoot();
    const rulesRoot = resolve(root, "rules-repo");
    const sourceRoot = resolve(root, "source");
    const parserRoot = resolve(root, "compiled-parsers");
    mkdirSync(rulesRoot, { recursive: true });
    mkdirSync(sourceRoot, { recursive: true });
    mkdirSync(resolve(parserRoot, "typescript"), { recursive: true });

    writeRuleSet(
        rulesRoot,
        "language-targets",
        "SLR-00001_LAN-targets.yaml",
        `schema: language-rule-set
schema_version: 1
category_type: language-targets
rule_set_id: targets
name: Targets
defaults:
  severity: error
  enabled: true
language_target_rules:
- rule_id: target-typescript
  name: TypeScript
  target_kind: language
  language_family: ecmascript
  language_id: typescript
  dialect_ids:
  - typescript
  parser_adapters:
  - parsers/typescript/Parser.ts
  file_extensions:
  - ts
  target:
    language_ids:
    - typescript
    file_extensions:
    - ts
`
    );
    writeRuleSet(
        rulesRoot,
        "linting",
        "SLR-00002_LNT-linting.yaml",
        `schema: language-rule-set
schema_version: 1
category_type: linting
rule_set_id: linting
name: Linting
defaults:
  severity: error
  enabled: true
linting_rules:
- rule_id: source-indentation-four-spaces
  name: Use four-space indentation
  lint_kind: indentation
  target:
    file_extensions:
    - ts
  enforce:
    disallow_tabs: true
    indent_width: 4
- rule_id: typescript-exported-return-types
  name: Require return types
  lint_kind: return-types
  target:
    language_ids:
    - typescript
    file_extensions:
    - ts
  enforce:
    require_for_exported_functions: true
`
    );
    writeRuleSet(
        rulesRoot,
        "style",
        "SLR-00003_STY-style.yaml",
        `schema: language-rule-set
schema_version: 1
category_type: style
rule_set_id: style
name: Style
defaults:
  severity: error
  enabled: true
style_rules:
- rule_id: export-function-declaration
  name: Use export function declaration
  style_kind: declaration-form
  target:
    file_extensions:
    - ts
  canonical_form: export function name() {}
- rule_id: no-default-exports
  name: No default exports
  style_kind: module-export-form
  target:
    file_extensions:
    - ts
  canonical_form: named export
`
    );
    writeFileSync(
        resolve(sourceRoot, "example.ts"),
        `\texport const bad = () => 1;\n`
    );
    writeFileSync(
        resolve(parserRoot, "typescript", "Parser.mjs"),
        `export function createParser(src) {
    return {
        parse() {
            return {
                nodes: [
                    { kind: "ExportConstObject", name: "bad", start: 1, end: src.text.length, arrowSignature: {} },
                    { kind: "ExportDefault", name: "default", start: 1, end: 15 }
                ],
                comments: [],
                strings: [],
                numbers: []
            };
        }
    };
}
`
    );

    const engine = new LanguageRuleEngine({
        rules_root: rulesRoot,
        source_root: sourceRoot,
        parser_root: parserRoot,
        fix: false,
        require_parsers: true
    });
    const result = await engine.run();
    const codes = result.diagnostics.map((item) => item.code).sort();
    assert.equal(result.stats.files, 1);
    assert.equal(result.stats.parsed, 1);
    assert.ok(codes.includes("language-rule.indentation.tabs"));
    assert.ok(codes.includes("language-rule.return-type.missing"));
    assert.ok(
        codes.includes("language-rule.style.export-function-declaration")
    );
    assert.ok(codes.includes("language-rule.style.no-default-export"));
});
