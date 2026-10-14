// @ts-check

/**
 * Unit tests for the Profile class.
 *
 * Covers: construction, static factories (parse / empty / load / loadIfExists /
 * loadFromRoot), validate / isValid, getBuckets / getBucket, getRequiredPaths /
 * isRequiredPath / checkRequiredPaths, getPackPaths / hasPackPaths,
 * getDirectoryRegex / matchesDirectoryPattern, getRules, and get (dot-path).
 *
 * @module tests/classes/Profile_test
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { Profile } from "../../lib/record-schema/Profile.mjs";
import { Schema } from "../../lib/record-schema/Schema.mjs";

// ============================================================================
// Fixtures
// ============================================================================

/**
 * Full-featured profile YAML.
 * @type {string}
 */
const YAML_FULL = `\
schema: record-schema-profile
rules:
  root:
    required_paths:
      - README.md
      - LICENSE
      - registry.yaml
  records:
    directory_regex: "^[A-Z]{2,5}-\\\\d{5}-[a-z0-9]+(?:-[a-z0-9]+)*$"
  buckets:
    - bucket: proposals
      path: records/proposals
      record_constraints:
        require_series: [DP]
        require_doc_type: [PROP]
    - bucket: charter
      path: records/charter
      record_constraints:
        require_series: [CHA]
  document_policies:
    pack_paths:
      - packs/standard.pack.yaml
      - packs/signing.pack.yaml
`;

/**
 * Minimal profile with no optional sections.
 * @type {string}
 */
const YAML_MINIMAL = `\
schema: record-schema-profile
rules: {}
`;

/**
 * Create a temp dir with a write helper and cleanup.
 * @returns {{ dir: string, write: (name: string, content: string) => string, cleanup: () => void }}
 */
function makeTmpDir() {
    const dir = join(
        tmpdir(),
        "profile-test-" + Math.random().toString(36).slice(2)
    );
    mkdirSync(dir, { recursive: true });
    return {
        dir,
        write(name, content) {
            const p = join(dir, name);
            writeFileSync(p, content, "utf8");
            return p;
        },
        cleanup() {
            rmSync(dir, { recursive: true });
        }
    };
}

// ============================================================================
// Construction
// ============================================================================

describe("Profile - construction", () => {
    it("stores data and defaults source_path to null", () => {
        const p = new Profile({ rules: {} });
        assert.deepEqual(p.data, { rules: {} });
        assert.equal(p.source_path, null);
    });

    it("stores provided source_path", () => {
        const p = new Profile({}, "/path/profile.yaml");
        assert.equal(p.source_path, "/path/profile.yaml");
    });
});

// ============================================================================
// empty()
// ============================================================================

describe("Profile.empty", () => {
    it("returns Profile with empty data and null source_path", () => {
        const p = Profile.empty();
        assert.ok(p instanceof Profile);
        assert.deepEqual(p.data, {});
        assert.equal(p.source_path, null);
    });
});

// ============================================================================
// parse()
// ============================================================================

describe("Profile.parse", () => {
    it("parses full YAML into data", () => {
        const p = Profile.parse(YAML_FULL);
        assert.ok(p instanceof Profile);
        assert.ok(p.data !== null && typeof p.data === "object");
    });

    it("stores source_path when provided", () => {
        const p = Profile.parse(YAML_MINIMAL, "/some/profile.yaml");
        assert.equal(p.source_path, "/some/profile.yaml");
    });

    it("parses minimal YAML without throwing", () => {
        const p = Profile.parse(YAML_MINIMAL);
        assert.ok(p instanceof Profile);
    });

    it("rules are accessible after parse", () => {
        const p = Profile.parse(YAML_FULL);
        assert.ok(p.getRules() !== undefined);
    });
});

// ============================================================================
// load / loadIfExists / loadFromRoot
// ============================================================================

describe("Profile.load / loadIfExists / loadFromRoot", () => {
    it("load reads and parses YAML file", () => {
        const tmp = makeTmpDir();
        const path = tmp.write("profile.yaml", YAML_FULL);
        const p = Profile.load(path);
        assert.ok(p instanceof Profile);
        assert.equal(p.source_path, path);
        assert.ok(p.getBuckets("").length > 0);
        tmp.cleanup();
    });

    it("load throws on missing file", () => {
        assert.throws(() => Profile.load("/no/such/profile.yaml"));
    });

    it("loadIfExists returns Profile for existing file", () => {
        const tmp = makeTmpDir();
        const path = tmp.write("profile.yaml", YAML_MINIMAL);
        const p = Profile.loadIfExists(path);
        assert.ok(p instanceof Profile);
        tmp.cleanup();
    });

    it("loadIfExists returns null for missing file", () => {
        assert.equal(Profile.loadIfExists("/no/such/profile.yaml"), null);
    });

    it("loadFromRoot resolves relative path from root", () => {
        const tmp = makeTmpDir();
        tmp.write("registry.profile.yaml", YAML_FULL);
        const p = Profile.loadFromRoot(tmp.dir, "registry.profile.yaml");
        assert.ok(p instanceof Profile);
        tmp.cleanup();
    });

    it("loadFromRoot returns null when file missing", () => {
        const tmp = makeTmpDir();
        const p = Profile.loadFromRoot(tmp.dir, "missing.yaml");
        assert.equal(p, null);
        tmp.cleanup();
    });
});

// ============================================================================
// validate / isValid
// ============================================================================

describe("Profile - validate / isValid", () => {
    it("validates data against schema — valid", () => {
        const p = Profile.parse(YAML_MINIMAL);
        const s = new Schema({ type: "object" });
        assert.deepEqual(p.validate(s), []);
        assert.equal(p.isValid(s), true);
    });

    it("returns errors for invalid data", () => {
        const p = Profile.parse(YAML_MINIMAL);
        const s = new Schema({
            type: "object",
            required: ["must_have_this_key"]
        });
        const errors = p.validate(s);
        assert.ok(errors.length > 0);
        assert.equal(p.isValid(s), false);
    });
});

// ============================================================================
// getBuckets
// ============================================================================

describe("Profile - getBuckets", () => {
    it("returns parsed buckets from rules.buckets", () => {
        const p = Profile.parse(YAML_FULL);
        const buckets = p.getBuckets(".");
        assert.equal(buckets.length, 2);
        const names = buckets.map((b) => b.bucket);
        assert.ok(names.includes("proposals"));
        assert.ok(names.includes("charter"));
    });

    it("each bucket has bucket, path, constraints fields", () => {
        const p = Profile.parse(YAML_FULL);
        const buckets = p.getBuckets(".");
        for (const b of buckets) {
            assert.ok(typeof b.bucket === "string");
            assert.ok(typeof b.path === "string");
            assert.ok(typeof b.constraints === "object");
        }
    });

    it("returns default root bucket when no buckets defined", () => {
        const p = Profile.parse(YAML_MINIMAL);
        const buckets = p.getBuckets(".");
        assert.equal(buckets.length, 1);
        assert.equal(buckets[0].bucket, "root");
        assert.equal(buckets[0].path, ".");
        assert.deepEqual(buckets[0].constraints, {});
    });

    it("returns default root bucket for empty profile", () => {
        const p = Profile.empty();
        const buckets = p.getBuckets(".");
        assert.equal(buckets[0].bucket, "root");
    });

    it("skips bucket entries missing bucket or path fields", () => {
        const yaml = `\
rules:
  buckets:
    - bucket: good
      path: records/good
    - path: records/no-bucket-key
    - bucket: no-path-key
`;
        const p = Profile.parse(yaml);
        const buckets = p.getBuckets(".");
        assert.equal(buckets.length, 1);
        assert.equal(buckets[0].bucket, "good");
    });

    it("constraints default to empty object when record_constraints absent", () => {
        const yaml = `\
rules:
  buckets:
    - bucket: simple
      path: records/simple
`;
        const p = Profile.parse(yaml);
        const buckets = p.getBuckets(".");
        assert.deepEqual(buckets[0].constraints, {});
    });
});

// ============================================================================
// getBucket
// ============================================================================

describe("Profile - getBucket", () => {
    it("returns bucket config by name", () => {
        const p = Profile.parse(YAML_FULL);
        const b = p.getBucket("proposals");
        assert.ok(b !== undefined);
        assert.equal(b.path, "records/proposals");
    });

    it("returns undefined for unknown bucket name", () => {
        const p = Profile.parse(YAML_FULL);
        assert.equal(p.getBucket("nonexistent"), undefined);
    });

    it("returns the default root bucket by name on minimal profile", () => {
        const p = Profile.parse(YAML_MINIMAL);
        const b = p.getBucket("root");
        assert.ok(b !== undefined);
        assert.equal(b.bucket, "root");
    });
});

// ============================================================================
// getRequiredPaths / isRequiredPath / checkRequiredPaths
// ============================================================================

describe("Profile - required paths", () => {
    it("getRequiredPaths returns array of required paths", () => {
        const p = Profile.parse(YAML_FULL);
        const paths = p.getRequiredPaths();
        assert.ok(Array.isArray(paths));
        assert.ok(paths.includes("README.md"));
        assert.ok(paths.includes("LICENSE"));
        assert.ok(paths.includes("registry.yaml"));
    });

    it("getRequiredPaths returns empty array when not defined", () => {
        const p = Profile.parse(YAML_MINIMAL);
        assert.deepEqual(p.getRequiredPaths(), []);
    });

    it("isRequiredPath returns true for a required path", () => {
        const p = Profile.parse(YAML_FULL);
        assert.equal(p.isRequiredPath("README.md"), true);
    });

    it("isRequiredPath returns false for non-required path", () => {
        const p = Profile.parse(YAML_FULL);
        assert.equal(p.isRequiredPath("CONTRIBUTING.md"), false);
    });

    it("isRequiredPath returns false when no required paths defined", () => {
        const p = Profile.empty();
        assert.equal(p.isRequiredPath("README.md"), false);
    });

    it("checkRequiredPaths returns existence results for each required path", () => {
        const tmp = makeTmpDir();
        tmp.write("README.md", "# Hello");
        // LICENSE intentionally not created
        const profileYaml = `\
rules:
  root:
    required_paths:
      - README.md
      - LICENSE
`;
        const p = Profile.parse(profileYaml);
        const results = p.checkRequiredPaths(tmp.dir);
        assert.equal(results.length, 2);

        const readme = results.find((r) => r.path === "README.md");
        const license = results.find((r) => r.path === "LICENSE");
        assert.ok(readme !== undefined && readme.exists === true);
        assert.ok(license !== undefined && license.exists === false);
        tmp.cleanup();
    });

    it("checkRequiredPaths returns empty array when no required paths", () => {
        const p = Profile.parse(YAML_MINIMAL);
        const results = p.checkRequiredPaths("/any/dir");
        assert.deepEqual(results, []);
    });
});

// ============================================================================
// getPackPaths / hasPackPaths
// ============================================================================

describe("Profile - pack paths", () => {
    it("getPackPaths returns pack paths array", () => {
        const p = Profile.parse(YAML_FULL);
        const paths = p.getPackPaths();
        assert.ok(Array.isArray(paths));
        assert.ok(paths.includes("packs/standard.pack.yaml"));
        assert.ok(paths.includes("packs/signing.pack.yaml"));
        assert.equal(paths.length, 2);
    });

    it("getPackPaths returns empty array when not defined", () => {
        const p = Profile.parse(YAML_MINIMAL);
        assert.deepEqual(p.getPackPaths(), []);
    });

    it("hasPackPaths returns true when paths defined", () => {
        const p = Profile.parse(YAML_FULL);
        assert.equal(p.hasPackPaths(), true);
    });

    it("hasPackPaths returns false when not defined", () => {
        const p = Profile.parse(YAML_MINIMAL);
        assert.equal(p.hasPackPaths(), false);
    });

    it("hasPackPaths returns false for empty profile", () => {
        assert.equal(Profile.empty().hasPackPaths(), false);
    });
});

// ============================================================================
// getDirectoryRegex / matchesDirectoryPattern
// ============================================================================

describe("Profile - directory pattern", () => {
    it("getDirectoryRegex returns pattern from profile", () => {
        const p = Profile.parse(YAML_FULL);
        const regex = p.getDirectoryRegex();
        assert.ok(typeof regex === "string");
        assert.ok(regex.length > 0);
    });

    it("getDirectoryRegex returns default pattern when not configured", () => {
        const p = Profile.empty();
        const regex = p.getDirectoryRegex();
        assert.ok(typeof regex === "string");
        assert.ok(regex.includes("A-Z"));
    });

    it("matchesDirectoryPattern returns true for valid record dir name", () => {
        const p = Profile.parse(YAML_FULL);
        assert.equal(p.matchesDirectoryPattern("DP-00001-my-proposal"), true);
        assert.equal(
            p.matchesDirectoryPattern("CHA-00001-founding-charter"),
            true
        );
    });

    it("matchesDirectoryPattern returns false for invalid dir name", () => {
        const p = Profile.parse(YAML_FULL);
        assert.equal(p.matchesDirectoryPattern("not-a-record"), false);
        assert.equal(p.matchesDirectoryPattern("DP-1-short"), false);
        assert.equal(p.matchesDirectoryPattern("dp-00001-lowercase"), false);
        assert.equal(p.matchesDirectoryPattern(""), false);
    });

    it("matchesDirectoryPattern uses custom regex from profile when defined", () => {
        const yaml = `\
rules:
  records:
    directory_regex: "^custom-\\\\d+$"
`;
        const p = Profile.parse(yaml);
        assert.equal(p.matchesDirectoryPattern("custom-123"), true);
        assert.equal(p.matchesDirectoryPattern("DP-00001-other"), false);
    });

    it("matchesDirectoryPattern returns false when regex is invalid", () => {
        const yaml = `\
rules:
  records:
    directory_regex: "[invalid("
`;
        const p = Profile.parse(yaml);
        // Should not throw
        assert.equal(p.matchesDirectoryPattern("anything"), false);
    });
});

// ============================================================================
// getRules
// ============================================================================

describe("Profile - getRules", () => {
    it("returns rules object from parsed profile", () => {
        const p = Profile.parse(YAML_FULL);
        const rules = p.getRules();
        assert.ok(rules !== undefined);
        assert.ok(typeof rules === "object");
    });

    it("returns undefined for empty profile", () => {
        const p = Profile.empty();
        assert.equal(p.getRules(), undefined);
    });

    it("returns empty object for minimal profile with empty rules", () => {
        const p = Profile.parse(YAML_MINIMAL);
        const rules = p.getRules();
        assert.ok(rules !== undefined);
        assert.deepEqual(rules, {});
    });
});

// ============================================================================
// get (dot-path accessor)
// ============================================================================

describe("Profile - get (dot-path)", () => {
    it("retrieves a top-level key", () => {
        const p = Profile.parse(YAML_FULL);
        const rules = p.get("rules");
        assert.ok(rules !== undefined);
    });

    it("retrieves a nested key via dot path", () => {
        const p = Profile.parse(YAML_FULL);
        const required = p.get("rules.root.required_paths");
        assert.ok(Array.isArray(required));
        assert.ok(/** @type {string[]} */ (required).includes("README.md"));
    });

    it("returns undefined for missing path", () => {
        const p = Profile.parse(YAML_MINIMAL);
        assert.equal(p.get("rules.nonexistent.key"), undefined);
    });

    it("returns undefined for empty profile", () => {
        const p = Profile.empty();
        assert.equal(p.get("rules"), undefined);
    });
});

// ============================================================================
// Extensions
// ============================================================================

describe("Profile - extensions", () => {
    it("exposes arbitrary extension values without interpreting them", () => {
        const objectValue = { enabled: true };
        const arrayValue = ["alpha", 2];
        const profile = new Profile({
            extensions: {
                custom_object: objectValue,
                custom_scalar: "value",
                custom_array: arrayValue,
                custom_null: null
            }
        });

        assert.deepEqual(profile.getExtensions(), {
            custom_object: objectValue,
            custom_scalar: "value",
            custom_array: arrayValue,
            custom_null: null
        });
        assert.equal(profile.getExtension("custom_object"), objectValue);
        assert.equal(profile.getExtension("custom_scalar"), "value");
        assert.equal(profile.getExtension("custom_array"), arrayValue);
        assert.equal(profile.getExtension("custom_null"), null);
        assert.equal(profile.getExtension("missing"), undefined);
    });

    it("enumerates every extension in declaration order", () => {
        const profile = new Profile({
            extensions: {
                first: 1,
                second: false,
                third: { value: "three" }
            }
        });

        assert.deepEqual(profile.getExtensionEntries(), [
            { name: "first", value: 1 },
            { name: "second", value: false },
            { name: "third", value: { value: "three" } }
        ]);
    });

    it("does not expose inherited object properties as extensions", () => {
        const profile = new Profile({ extensions: {} });
        assert.equal(profile.getExtension("toString"), undefined);
    });

    it("returns an empty extension map for malformed profile data", () => {
        const profile = Profile.parse("extensions:\n  - invalid\n");
        assert.deepEqual(profile.getExtensions(), {});
        assert.deepEqual(profile.getExtensionEntries(), []);
    });
});
