# record-schema-toolkit

Zero-dependency (Node built-ins only) validator + linter + formatter for the **record-schema** specification.

## Features

- Record discovery + validation
  - directory naming: `^[A-Z]{2,5}-\d{5}-[a-z0-9]+(?:-[a-z0-9]+)*$`
  - required baseline files (`*_META.yaml` + at least one primary doc)
  - file naming inside records
- Metadata validation
  - record metadata (`*_META.yaml`) via `schema/record.meta.schema.json`
  - trailing document metadata blocks (`-----BEGIN DOCUMENT METADATA-----`) via `schema/document.metadata.schema.json`
  - sidecar metadata (`file.ext.metadata`) for non-embeddable artefacts
- Formatting packs + profiles
  - loads packs with `imports`
  - applies rulesets by selector: `doc_types`, `extensions`, `paths_glob`, `is_root_file`
  - enforces: canonical-ascii normalization, line-width, required header/footer shapes

## CLI

All paths are repo-relative unless absolute.

### Lint

```bash
node ./bin/recordlint.mjs lint --root .
node ./bin/recordlint.mjs lint --root . --profile registry.profile.yaml
```

### Format

Dry-run (prints diff-like summary):

```bash
node ./bin/recordlint.mjs format --root . --profile registry.profile.yaml
```

Write fixes to disk:

```bash
node ./bin/recordlint.mjs format --root . --profile registry.profile.yaml --write
```

### Options

- `--root <path>`: repository root (default: `.`)
- `--profile <path>`: registry profile YAML/JSON (optional)
- `--packs <p1,p2,...>`: override pack list (optional, used when no profile)
- `--registry <path>`: registry YAML file (default: `registry/combined-registry-types.yaml` if present)
- `--json`: emit machine-readable JSON report
- `--write`: write changes (format only)
- `--fail-on-warn`: exit non-zero if warnings exist

## Exit codes

- `0`: no errors (and no warnings if `--fail-on-warn`)
- `2`: errors found
- `3`: invalid configuration/profile/schema

## Included assets

- `schema/*.json`: JSON schemas extracted from the spec
- `formatting/packs/*.json`: example packs (base + dao-proposals)
- `formatting/templates/**`: example templates (LICENSE header/footer, MEM disclaimer)
- `registry/combined-registry-types.yaml`: example registry entries

## License

Copyright (C) 2026 **SOLOMON DAO LLC**, a Marshall Islands DAO LLC organized
under the Decentralized Autonomous Organizations Act of 2022 as amended.

This repository is licensed for **Non-Governance Use** under the **SOLOMON DAO LLC SCHEMA REGISTRY REPOSITORY LICENSE (PERMISSIVE)**.

Any **Governance Use** is governed by the **SOLOMON DAO LLC PUBLIC GOVERNANCE REPOSITORY LICENSE** and is restricted to **MetaDAO Cohorts** unless separately licensed by DAO governance.
See [LICENSE](./LICENSE) for full terms. See [ATTRIBUTION](./ATTRIBUTION.md) for customary attribution.
