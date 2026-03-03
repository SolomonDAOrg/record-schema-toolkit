# Attribution

This repository contains NodeJS tooling for for the **Record Schema** convention.

See [LICENSE](./LICENSE) for the governing terms.

## Non-endorsement; no trademark

Attribution is informational only and does not imply endorsement, partnership, or operational control.

No trademark, brand, or production-use rights are granted by attribution; see `LICENSE`.


## Customary attribution

If you copy, vendor, or redistribute substantial portions of these Schema Materials, keep the License notice
and add a short attribution line somewhere visible (README, docs index, or similar), e.g.:

> Based on "Record Schema" (C) 2026 SOLOMON DAO LLC, licensed for Non-Governance Use under the SOLOMON DAO LLC SCHEMA REGISTRY REPOSITORY LICENSE (PERMISSIVE). Governance Use requires the SOLOMON DAO LLC PUBLIC GOVERNANCE REPOSITORY LICENSE (MetaDAO Cohorts only unless separately licensed).

Where possible, link "Record Schema" to the upstream repository you sourced it from.

## Declaring upstream hierarchy (machine-readable)

To make dependency/lineage explicit, add a `SCHEMA_UPSTREAM.yaml` at your repo root:

```yaml
schema: record-schema-upstream
schema_version: 1

record_schema:
  upstreams:
    - name: Record Schema
      repo: "https://github.com/SolomonDAOrg/record-schema"
      revision: "REPLACE_WITH_GIT_TAG_OR_SHA"
      license: "SOLOMON DAO LLC SCHEMA REGISTRY REPOSITORY LICENSE (PERMISSIVE; NON-GOVERNANCE USE ONLY)"
    
    - name: Record Schema Tooling
      repo: "https://github.com/SolomonDAOrg/record-schema-toolkit"
      revision: "REPLACE_WITH_GIT_TAG_OR_SHA"
      license: "SOLOMON DAO LLC SCHEMA REGISTRY REPOSITORY LICENSE (PERMISSIVE; NON-GOVERNANCE USE ONLY)"
  
  provides:
    - name: "REPLACE_WITH_PROFILE_OR_REGISTRY_NAME"
      kind: "profile|registry|tooling"
      id: "REPLACE_WITH_STABLE_ID"

  # Optional local resolution hints for tooling:
  # profile: "path/to/profile.yaml"             # or profile id/hint
  # registry: "path/to/registry.yaml"
  # formatting_packs:
  #   - "formatting/packs/base-v1.json"
  # render_packs:
  #   - "render/packs/base-v1.json"
```

If your repository uses Record Schema for Governance Use (as defined in LICENSE), do not rely on the permissive license string above; instead, reference the applicable governance license identifier and ensure you are authorized (MetaDAO Cohort or separately licensed).

Tooling can build a repository dependency graph by reading `record_schema.upstreams`.
