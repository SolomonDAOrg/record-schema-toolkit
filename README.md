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

## CLI

Each command is a standalone script under `bin/`. All paths are repo-relative
unless absolute.

### validate

Validate record schema, registry integrity, and profile rules (read-only).

```bash
node ./bin/validate.mjs
node ./bin/validate.mjs --root . --profile registry.profile.yaml --registry registry.yaml
```

| Option | Alias | Default | Description |
|---|---|---|---|
| `--root` | `-r` | `.` | Repository root |
| `--profile` | `-p` | `registry.profile.yaml` | Registry profile YAML path |
| `--registry` | | `registry.yaml` | Registry YAML path |
| `--json` | | `false` | Machine-readable JSON output |
| `--fail-on-warn` | | `true` | Exit non-zero on warnings |

### lint

Lint records for formatting, style, and metadata issues.

```bash
node ./bin/lint.mjs
node ./bin/lint.mjs --root . --packs base.pack.json,dao.pack.json --registry registry.yaml
```

| Option | Alias | Default | Description |
|---|---|---|---|
| `--root` | `-r` | `.` | Repository root |
| `--packs` | | `[]` | Formatting pack JSON paths (comma-separated) |
| `--registry` | | `null` | Registry YAML path |
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
