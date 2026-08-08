# record-schema-toolkit

Zero-dependency (Node built-ins only) validator + linter + formatter for the
[record-schema](https://github.com/SolomonDAOrg/record-schema) specification.

## Features

- Record discovery + validation
  - directory naming: `^[A-Z]{2,5}-\d{5}-[a-z0-9]+(?:-[a-z0-9]+)*$`
  - required baseline files (`*_META.yaml` + at least one primary doc)
  - file naming inside records
- Metadata validation
  - record metadata (`*_META.yaml`) via `schema/record.meta.schema.json`
  - trailing document metadata blocks (`-----BEGIN DOCUMENT METADATA-----`)
    via `schema/document.metadata.schema.json`
  - sidecar metadata (`file.ext.metadata`) for non-embeddable artefacts
- Formatting packs + profiles
  - loads packs with `imports`
  - applies rulesets by selector: `doc_types`, `extensions`, `paths_glob`,
    `is_root_file`
  - enforces: canonical-ascii normalization, line-width, required
    header/footer shapes
- Generic extension and schema-material support
  - preserves profile `extensions` as opaque caller-defined values
  - accepts explicit schema-material roots without binding the toolkit to a
    downstream repository
  - resolves base schemas, profiles, registries, and packs in deterministic
    root order

## CLI

The installed package exposes one umbrella command and standalone binaries
for every subcommand:

```bash
record-schema-toolkit --help
record-schema-toolkit validate --root .
record-schema-toolkit assert --root . --fail-on-vacuous
```

The same commands remain available as standalone scripts under `bin/`. All
paths are repository-relative unless documented otherwise.

### validate

Validate record schema, registry integrity, and profile rules (read-only).

```bash
node ./bin/validate.mjs
node ./bin/validate.mjs --root . --profile registry.profile.yaml --registry registry.yaml
node ./bin/validate.mjs --root ./my-records --schema-roots ../record-schema,../retained-schemas
```

| Option | Alias | Default | Description |
|---|---|---|---|
| `--root` | `-r` | `.` | Repository root |
| `--profile` | `-p` | `registry.profile.yaml` | Registry profile YAML path |
| `--registry` | | `registry.yaml` | Registry YAML path |
| `--schema-roots` | `--schema-root`, `--schema-material-root`, `--schema-material-roots` | `[]` | Additional schema-material roots (comma-separated) |
| `--json` | | `false` | Machine-readable JSON output |
| `--fail-on-warn` | | `true` | Exit non-zero on warnings |
| `--require-base-schemas` | | `false` | Fail when normative base schema material cannot be resolved |
| `--assertions` | | `true` | Execute profile-declared assertion packs after structural validation |
| `--no-assertions` | | `false` | Validate structures and assertion-pack documents without executing rules |
| `--mode` | | `development` | Named assertion execution mode |
| `--production` | | `false` | Alias for `--mode production` |

Profiles may type JSON/YAML record artefacts with `rules.structured_document_schemas`. Deployment evidence profiles can use this to validate a singleton `EVD` dossier containing the normalized artifact, transaction, action, receipt, and disclosure-policy data rendered into a PDF packet:

```yaml
rules:
  structured_document_schemas:
    - doc_type: EVD
      schema_path: schema/deployment-release/deployment-batch-report-data.schema.json
      extensions: [json]
      required: true
      max_count: 1
```

`required: true` supplies a minimum of one unless `min_count` is explicit. `min_count` and `max_count` enforce document multiplicity; machine-authoritative PLAN/MAN/ATT/VER/EVD documents should generally use `max_count: 1`. Configured schema paths must resolve to regular, non-symlink files contained by the active repository.

The validator also applies every `rules.meta_policies.overlay_schema_paths` schema in addition to the base META schema. Base schemas and discovered profiles, registries, and packs are resolved from the active repository first, then explicit `--schema-roots`, then bundled fallback locations. Profile-declared overlay and structured-document schema paths resolve relative to the schema-material root that owns the profile; they reject absolute paths, traversal, symlinks, and non-regular files.

Profile `extensions` are intentionally opaque. `Profile.getExtensions()`, `Profile.getExtension(name)`, and `Profile.getExtensionEntries()` expose caller-defined values without recognizing names, fields, series codes, record families, or downstream paths. Extension shape belongs in schema material; extension-specific semantic validation belongs in the downstream consumer or adapter, not in this toolkit.

When fallback formatting packs are discovered rather than explicitly declared, identity-bearing repositories only load packs whose filenames match an ID declared by `record_schema.provides`. This prevents unrelated packs in a shared schema-material root from being applied implicitly.

When `render --render-pack <path>` is used, that pack is authoritative for packet generation; repository discovery cannot replace it with another render family. Filing packet output directories are created recursively, and the resolved target's page size and orientation are propagated to both layout and PDF rendering.
Backslash-escaped Markdown metacharacters remain literal during inline parsing. Pipe-table parsing consumes the escape only for `\|`; escapes for underscores, asterisks, backticks, brackets, parentheses, and backslashes are preserved for inline parsing so machine evidence values render exactly.

### assert

Run corpus assertion packs: the cross-document checks that only exist between two
documents. `validate` answers questions about one document at a time - naming,
metadata, per-document schema. An assertion pack carries the rest: an ordinal
two records disagree about, a width restated somewhere nothing reads, a record
nothing reaches.

Packs are declared by the repository in `rules.assertion_packs`, so the usual
invocation names none.

```bash
node ./bin/assert.mjs --root .
node ./bin/assert.mjs --root . --stats --fail-on-vacuous
node ./bin/assert.mjs --root . --packs rules/20-closure.rules.yaml --only IMPORT_UNKNOWN
```

| Option | Alias | Default | Description |
|---|---|---|---|
| `--root` | `-r` | `.` | Repository root |
| `--profile` | `-p` | discovered | Registry profile YAML path |
| `--packs` | `--pack`, `--assertions` | profile's declared packs | Assertion pack paths (comma-separated) |
| `--only` | | `[]` | Run only these rule ids |
| `--skip` | | `[]` | Skip these rule ids |
| `--stats` | | `false` | Per-rule accounting (see below) |
| `--fail-on-vacuous` | | `false` | Exit non-zero when a rule examined, joined, or resolved nothing |
| `--advisory` | | `false` | Promote advisory findings to errors |
| `--list` | | `false` | List the rules that would run, then exit |
| `--summary` | | `false` | Finding counts per rule, without the findings |
| `--mode` | | `development` | Named execution mode |
| `--production` | | `false` | Alias for `--mode production` |
| `--json` | | `false` | Machine-readable output; counters remain inside the JSON document even with `--stats` |

`validate` runs the same packs at the end of its own run, so a repository
declaring them needs only the one command. `assert` is for working on rules.

#### Why `--stats` exists

A rule that reports clean has either looked and found nothing, or never looked.
Nothing in the output distinguishes those, and the second is the more common
outcome when a rule is first written. `--stats` reports, per rule:

- **scope** - nodes examined. A ban passes *by* matching nothing, so matches are
  not the signal; scope is. A rule with scope zero was pointed past the corpus.
- **matched** - rows that survived the predicate.
- **joined** - for `agree` rules, keys present on both sides. Both sides can
  select hundreds of rows and share no key at all, which no scope count reveals.
- **uses / defs** - for `resolve` rules, each side separately. A rule selecting
  three hundred declarations and zero uses reports clean, and one combined
  number shows three hundred.

`--fail-on-vacuous` turns all four into an exit status.

Writing a rule and watching it pass proves nothing. Break the thing it checks
and watch it fail.

### materialize

Compute deterministic outputs declared by assertion rules. The default is a
read-only drift check; `--write` is mandatory for filesystem changes. Supported
operations are digest manifests, one-field YAML derivations, reachability
baselines, and semantics-preserving rewrites.

```bash
record-schema-toolkit materialize --root . --only MANIFEST
record-schema-toolkit materialize --root . --only MANIFEST --write
```

`--packs` or the profile selects packs, `--only` limits rule ids, and `--json`
returns the computed outputs and drift state. Every destination is contained by
the repository root.

### report

Render a named report declared in an assertion pack. Reports use the same
selectors, tables, expressions, and reach analysis as validation; they cannot
load repository-specific code.

```bash
record-schema-toolkit report --root . --report storage
record-schema-toolkit report --root . --report storage --verbose
record-schema-toolkit report --root . --report storage --json
```

### doctor

Diagnose the assertion runtime, pack/import graph, rules, reports, and
materializers without relying on a downstream tool directory. `--deep` executes
every corpus rule, report, and read-only materializer; `--production` diagnoses
production-mode selection and severity.

```bash
record-schema-toolkit doctor --root .
record-schema-toolkit doctor --root . --deep --production
```

### lint

Lint records for formatting, style, and metadata issues.

```bash
node ./bin/lint.mjs
node ./bin/lint.mjs --root . --packs base.pack.json,dao.pack.json --registry registry.yaml
node ./bin/lint.mjs --root ./my-records --schema-roots ../record-schema,../retained-schemas
```

| Option | Alias | Default | Description |
|---|---|---|---|
| `--root` | `-r` | `.` | Repository root |
| `--packs` | | `[]` | Formatting pack JSON paths (comma-separated) |
| `--registry` | | `null` | Registry YAML path |
| `--schema-roots` | `--schema-root`, `--schema-material-root`, `--schema-material-roots` | `[]` | Additional schema-material roots (comma-separated) |
| `--json` | | `false` | Machine-readable JSON output |

### format

Normalize encoding, EOL, whitespace, and canonical ASCII across records.

```bash
# Dry run
node ./bin/format.mjs --root . --packs base.pack.json

# Write fixes
node ./bin/format.mjs --root . --packs base.pack.json --dry-run false
```

| Option | Alias | Default | Description |
|---|---|---|---|
| `--root` | `-r` | `.` | Repository root |
| `--packs` | | `[]` | Formatting pack JSON paths |
| `--dry-run` | | `false` | Show changes without writing |

### generate-index

Generate a `{RECORD_ID}_IND-index.md` file for a record directory. 
Reads `_META.yaml` and resolves document types from `assembly.pack` and
filename conventions.

```bash
node ./bin/generate-index.mjs --root ./DP-00001-my-record
node ./bin/generate-index.mjs --root . --record-filter DP-00001 --overwrite
```

| Option | Alias | Default | Description |
|---|---|---|---|
| `--root` | `-r` | `.` | Repository root or record directory |
| `--output` | `-o` | `{record_dir}/{RECORD_ID}_IND-index.md` | Override output path |
| `--record-filter` | | `null` | Filter by Record ID substring |
| `--overwrite` | | `false` | Overwrite existing IND-index file |
| `--no-discovery` | | `false` | Disable automatic repository root discovery |
| `--verbose` | `-v` | `false` | Verbose output |

### render

Render record documents to PDF using RenderPacks. Supports single documents
and filing packets.

```bash
# Render all documents in a record
node ./bin/render.mjs --root ./DP-00001-my-record --render-pack my.renderpack.json

# Generate a filing packet
node ./bin/render.mjs --root . --packet --render-pack my.renderpack.json --record-filter DP-00001

# Generate packet with signing page and IND in footer
node ./bin/render.mjs --root . --packet --signing-page --ind-in-footer --render-pack my.renderpack.json
```

**Flags:**

| Flag | Alias | Default | Description |
|---|---|---|---|
| `--packet` | `--pkt` | `false` | Generate filing packets |
| `--overwrite` | | `false` | Overwrite existing output files |
| `--signing-page` | | `false` | Append signing/execution page |
| `--ind-in-footer` | | `false` | Show IND in PDF footer |
| `--ind-in-header` | | `false` | Show IND in PDF header |
| `--exclude-ind` | | `false` | Exclude IND from PDF output entirely |
| `--generate-ind` | | `false` | Auto-generate IND and write to markdown files |
| `--update-meta` | | `false` | Update META.yaml with packet hash |
| `--no-watermark` | | `false` | Disable draft watermark on cover page |
| `--watermark` | | `false` | Force draft watermark on cover page |
| `--no-discovery` | | `false` | Disable automatic repository root discovery |
| `--disable-page-break-rules` | | `false` | Disable automatic page break rules |
| `--verbose` | `-v` | `false` | Trace render pack, meta, cover, and rule resolution |

**Values:**

| Option | Default | Description |
|---|---|---|
| `--root` / `-r` | `.` | Repository root or record directory |
| `--output` | `{record}/pdf` | Output directory |
| `--render-pack` | `null` | Render pack JSON path |
| `--packet-name` | `{RECORD_ID}_PKT-filing.pdf` | Override packet filename |
| `--record-filter` | `null` | Filter by Record ID substring |
| `--phase-filter` | `null` | Filter by `status.phase` (comma-separated) |
| `--doc-type-filter` | `null` | Filter documents by doc type code |
| `--author` | `null` | Author name for PDF metadata |
| `--cover-title` | `null` | Override cover page title |
| `--cover-entity` | `null` | Override cover page entity name |
| `--cover-subtitle` | `null` | Override cover page subtitle |
| `--cover-effective-date` | `null` | Override cover effective date (ISO) |
| `--cover-version` | `null` | Override cover page version string |
| `--cover-document-id` | `null` | Override cover page document ID |
| `--cover-confidentiality` | `null` | Override cover confidentiality notice |

### chart

Render `.chart.yaml` / `.chart.json` files to SVG, ASCII art, or Mermaid.

```bash
# Single file to SVG
node ./bin/chart.mjs --input my-chart.chart.yaml

# Directory, all formats, with a render pack
node ./bin/chart.mjs --input ./charts --format all --render-pack my.renderpack.json --recursive

# Validate only (no output)
node ./bin/chart.mjs --input my-chart.chart.yaml --validate

# Pipe to stdout
node ./bin/chart.mjs --input my-chart.chart.yaml --format ascii --stdout
```

| Option | Alias | Default | Description |
|---|---|---|---|
| `--input` | `-i` | *(required)* | Input chart file or directory |
| `--output` | `-o` | same as input | Output directory |
| `--format` | `-F` | `svg` | Output format: `svg`, `ascii`, `mermaid`, `all` |
| `--render-pack` | `-p` | `null` | Render pack JSON path for styling |
| `--theme` | `-t` | `default` | Theme name from render pack |
| `--scale` | | `1` | Scale factor for SVG output |
| `--padding` | | `20` | Padding around chart (px) |
| `--background` / `--bg` | | `null` | Background color (e.g. `#ffffff`, `transparent`) |
| `--max-width` | | `120` | Maximum width for ASCII output |
| `--box-chars` | | `unicode` | Box character style: `unicode`, `ascii` |
| `--overwrite` / `-f` | | `false` | Overwrite existing output files |
| `--recursive` / `-R` | | `false` | Recursively find chart files in subdirectories |
| `--stdout` | | `false` | Write to stdout (single file + format only) |
| `--validate` | | `false` | Validate chart files without rendering |
| `--verbose` / `-v` | | `false` | Verbose output |

## Language rule registries

The validator supports the three-layer language-rule model:

```text
record-schema
  -> language-rule-registry
       -> solomon-language-rules or another downstream implementation registry
```

Supported behaviour:

- `SCHEMA_UPSTREAM.yaml` may point at multiple registry YAML files through
  `registry_path` / `registry`. The toolkit merges those files before validating
  records.
- Profiles can live under `profiles/*.profile.yaml`; registry catalogues can live
  under `registry/*.yaml`.
- Record discovery is recursive, so implementation records can live under
  category folders such as `rules/linting/SLR-00002-solomon-linting`.
- `language-rule-registry` category definition records validate primary `CAT`
  YAML files against `schema/language-rule-registry/rule-category-definition.schema.json`.
- Downstream implementation registries validate primary rule-set YAML files by
  category/doc-type using `registry/*language-rule-schema-map.yaml` or the
  upstream category type catalogue.
- External local JSON Schema refs such as
  `base.rule-set.schema.json#/$defs/ruleHeader` are resolved relative to the
  schema file that declared the ref.

Examples:

```bash
node ./bin/validate.mjs --root ../language-rule-registry
node ./bin/validate.mjs --root ../solomon-language-rules
```

## Exit codes

- `0`: success (no errors; no warnings if `--fail-on-warn` is set)
- `1`: errors found (validate, lint) or rendering failures (render, chart)
- `3`: invalid configuration / profile / schema

## License

Copyright (C) 2026 **SOLOMON DAO LLC**, a Marshall Islands DAO LLC organized
under the Decentralized Autonomous Organizations Act of 2022 as amended.

This repository is licensed for **Non-Governance Use** under the **SOLOMON
DAO LLC SCHEMA REGISTRY REPOSITORY LICENSE (PERMISSIVE)**.

Any **Governance Use** is governed by the **SOLOMON DAO LLC PUBLIC GOVERNANCE
REPOSITORY LICENSE** and is restricted to **MetaDAO Cohorts** unless
separately licensed by DAO governance.
See [LICENSE](./LICENSE) for full terms. See [ATTRIBUTION](./ATTRIBUTION.md)
for customary attribution.

## Language rule application

The toolkit applies downstream language-rule registries to source trees.

Layering stays separated:

```text
record-schema
  -> language-rule-registry
       -> solomon-language-rules
            -> target source repository
```

`language-rule-registry` defines the category schemas. `solomon-language-rules` provides concrete rule-set records. The toolkit loads the concrete rule records, scans a source tree, loads compiled parser adapters, and emits diagnostics or safe text fixes.

```bash
node ./bin/apply-language-rules.mjs \
  --rules-root ../solomon-language-rules \
  --source-root ../some-source-repo \
  --parser-root ../parsers/dist \
  --json
```

Parser adapters are expected to be compiled `.mjs` modules exporting `createParser(source, options)`, where `source` is `{ path, text }` and the returned parser exposes `parse()`. Rule records may reference TypeScript source adapter paths such as `parsers/typescript/Parser.ts`; the toolkit resolves those to compiled `.mjs` candidates under `--parser-root`.

The application engine currently wires:

- language target detection from `language_target_rules`
- recursive source scanning by target extensions
- parser loading for TypeScript, JavaScript/JSDoc, Rust, CSS-family, and Solidity-style adapter layouts
- linting diagnostics for indentation, line width, return types, import hygiene, and parser diagnostics
- style diagnostics for exported const arrows and default exports
- naming diagnostics for casing, brevity, vocabulary, and CSS custom properties
- ordering diagnostics for grouped imports
- values diagnostics for source numeric literals and stylesheet raw values
- banned-pattern and utility-catalog literal/semantic-probe detection
- project-structure diagnostics for file naming, max lines, and mixed type/runtime exports
- safe text fixes for leading tab indentation when `--fix` is supplied

The parser source can remain TypeScript in its own package; this toolkit code is `.mjs` only and assumes the parser package will publish compiled `.mjs` output.

### verify-license

Verify the repository `LICENSE`, its `SCHEMA_UPSTREAM.yaml` declaration, and
optionally a local checkout of the canonical
`github.com/SolomonDAOrg/licenses` registry.

```bash
node ./bin/verify-license.mjs --root .
node ./bin/verify-license.mjs \
  --root . \
  --canonical-root ../licenses \
  --json
```

The `license-body-v1` SHA-256 surface begins immediately after the first exact
80-character `=` separator and ends with the exact 80-character `=` separator
following `END OF LICENSE`. The blank line immediately after the first
separator and all intervening legal text are included. Only one leading UTF-8
BOM and CRLF or bare-CR line-ending differences are normalized.

Canonical custom-license filenames are the existing SPDX `LicenseRef` values
with no filename extension. Existing license titles, human-readable header
content, SPDX field spelling, identifiers, `scope_summary`, and legal text are
not rewritten by the verifier.
