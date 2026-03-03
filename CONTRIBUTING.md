# Contributing

## Terms

By submitting a Contribution, you agree to the terms in `LICENSE`, including the contribution license grant.

Note: this repository's permissive grant is for **Non-Governance Use**. Do not submit Governance Materials
(templates/packs/docs primarily for DAO governance) unless the file clearly self-declares the Governance License
via structured metadata (see `LICENSE`, Section 5).

Do not submit:

- confidential information or security-sensitive details;
- material you do not have the rights to license; or
- changes that imply endorsement, operational control, or agency over any implementation.

Repository contribution, review, or maintainership is administrative only and does not confer any membership,
authority, or relationship with the IP holder.


## Goals

- Keep the core convention small and stable.
- Keep registries non-limiting and additive.
- Avoid dependencies in tooling.

## What to change

### Spec changes

If you change the convention itself:

- Update `SPEC.md`.
- Update any affected JSON Schemas under `schema/`.
- Keep normative wording consistent (`MUST`, `SHOULD`, `MAY`) and avoid tightening the base naming
  regexes (profiles can add constraints; the base spec should stay broadly compatible).

### Formatting changes

If you change formatting or normalization rules:

- Update `FORMATTING.md`.
- If the change belongs in a reusable policy pack, update `formatting/packs/*.json`.
- If the change belongs in a reusable shape/template, update `formatting/templates/**`.

### Registry changes

If you add or adjust suggestions:

- Update the YAML files under `registry/` (series codes, doc types, commitment kinds).
- Do not turn registries into hard constraints. Unknown codes remain valid unless a profile opts in.

### Template changes

If you add or update starter packs:

- Keep templates minimal and generic.
- Ensure examples remain compatible with the naming rules in `SPEC.md`.
- Avoid baking in repo-specific governance assumptions unless the template explicitly targets a
  profile.

## Versioning

- Bump `schema_version` only for **breaking** schema changes (for example: new required fields or
  incompatible type changes).
- Additive fields and additional registries should not require a version bump.

## Formatting hygiene

Before opening a PR, ensure modified text files follow the baseline rules in `FORMATTING.md`:

- UTF-8 without BOM
- LF newlines only
- No trailing whitespace

If you touch canonical surfaces governed by `canonical-ascii`, ensure smart punctuation and other
disallowed characters are removed.
