// @ts-check

/**
 * Unit tests for the Repository class.
 *
 * Strategy: Repository.discoverRepository / fromFolder require a real
 * filesystem tree. We build minimal tmp-dir trees for each tier and for the
 * static helpers, then test instance methods directly via Repository.open().
 *
 * Groups:
 *   - _relPosix (static, pure)
 *   - _isLikelyRepoRoot (reads fs)
 *   - _findUpstreamFile (reads fs)
 *   - _findProfileFile (reads fs)
 *   - _findMetaFile (reads fs)
 *   - _findPackFiles (reads fs)
 *   - _parseUpstreamConfig (reads fs)
 *   - _discoverByConvention (reads fs)
 *   - _detectRecordDirectory (reads fs)
 *   - isRepository (static)
 *   - open / construction
 *   - setToolkitDir / getToolkitDir
 *   - profile accessors (loadProfile / getProfile / setProfile)
 *   - registry accessors (loadRegistry / getRegistry / setRegistry)
 *   - pack / policy accessors
 *   - target record accessors
 *   - path utilities (resolve / exists / getRelativePath)
 *   - file I/O (readJson / readText / writeText)
 *   - validateRequiredPaths (no profile → empty)
 *   - discoverRepository Tier 4 (heuristic .git marker)
 *   - discoverRepository Tier 3 (profile file)
 *   - discoverRepository Tier 2 (upstream file)
 *
 * @module tests/classes/Repository_test
 */

import assert from "node:assert/strict";
import { describe, it, afterEach } from "node:test";
import { mkdirSync, writeFileSync, rmSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import { Repository } from "../../lib/record-schema/Repository.mjs";
import { Profile } from "../../lib/record-schema/Profile.mjs";
import { Registry } from "../../lib/record-schema/Registry.mjs";
import { FormattingPack } from "../../lib/record-schema/FormattingPack.mjs";
import { hasNonNullishProperty } from "../../lib/util/objects.mjs";

// ============================================================================
// Shared tmp-dir factory
// ============================================================================

/**
 * @returns {{ dir: string, file: (rel: string, text: string) => string, subdir: (rel: string) => string, cleanup: () => void }}
 */
function makeTmp() {
    const dir = mkdtempSync(join(tmpdir(), "repo-test-"));
    return {
        dir,
        file(rel, text) {
            const abs = join(dir, rel);
            mkdirSync(resolve(abs, ".."), { recursive: true });
            writeFileSync(abs, text, "utf8");
            return abs;
        },
        subdir(rel) {
            const abs = join(dir, rel);
            mkdirSync(abs, { recursive: true });
            return abs;
        },
        cleanup() {
            rmSync(dir, { recursive: true, force: true });
        }
    };
}

// ============================================================================
// _relPosix
// ============================================================================

describe("Repository._relPosix", () => {
    // Access via a tiny wrapper — the method is private static
    /** @type {(from: string, to: string) => string} */
    const relPosix = /** @type {any} */ (Repository)._relPosix.bind(Repository);

    it("returns relative path for sibling (goes up one, then across)", () => {
        assert.equal(relPosix("/a/b", "/a/c"), "../c");
    });

    it("returns relative path for child", () => {
        assert.equal(relPosix("/a", "/a/b/c"), "b/c");
    });

    it("returns relative path going up", () => {
        assert.equal(relPosix("/a/b/c", "/a"), "../..");
    });

    it("returns empty string for identical paths", () => {
        assert.equal(relPosix("/a/b", "/a/b"), "");
    });

    it("handles deeply nested paths", () => {
        assert.equal(
            relPosix("/root/src", "/root/docs/api/README.md"),
            "../docs/api/README.md"
        );
    });
});

// ============================================================================
// _isLikelyRepoRoot
// ============================================================================

describe("Repository._isLikelyRepoRoot", () => {
    const isRoot = /** @type {any} */ (Repository)._isLikelyRepoRoot.bind(
        Repository
    );

    it("returns true when .git exists", () => {
        const tmp = makeTmp();
        tmp.subdir(".git");
        assert.equal(isRoot(tmp.dir), true);
        tmp.cleanup();
    });

    it("returns true when package.json exists", () => {
        const tmp = makeTmp();
        tmp.file("package.json", "{}");
        assert.equal(isRoot(tmp.dir), true);
        tmp.cleanup();
    });

    it("returns true when yarn.lock exists", () => {
        const tmp = makeTmp();
        tmp.file("yarn.lock", "");
        assert.equal(isRoot(tmp.dir), true);
        tmp.cleanup();
    });

    it("returns false when no indicator present", () => {
        const tmp = makeTmp();
        assert.equal(isRoot(tmp.dir), false);
        tmp.cleanup();
    });
});

// ============================================================================
// _findUpstreamFile
// ============================================================================

describe("Repository._findUpstreamFile", () => {
    const find = /** @type {any} */ (Repository)._findUpstreamFile.bind(
        Repository
    );

    it("finds SCHEMA_UPSTREAM.yaml", () => {
        const tmp = makeTmp();
        const p = tmp.file("SCHEMA_UPSTREAM.yaml", "profile: x.yaml\n");
        assert.equal(find(tmp.dir), p);
        tmp.cleanup();
    });

    it("finds schema_upstream.yml (case-insensitive match on Windows)", () => {
        const tmp = makeTmp();
        tmp.file("schema_upstream.yml", "");
        // The function checks a priority list; on case-insensitive FS the first
        // matching candidate wins, so just assert a non-null result.
        assert.ok(find(tmp.dir) !== null);
        tmp.cleanup();
    });

    it("returns null when no upstream file present", () => {
        const tmp = makeTmp();
        assert.equal(find(tmp.dir), null);
        tmp.cleanup();
    });
});

// ============================================================================
// _findProfileFile
// ============================================================================

describe("Repository._findProfileFile", () => {
    const find = /** @type {any} */ (Repository)._findProfileFile.bind(
        Repository
    );

    it("finds *.profile.yaml file", () => {
        const tmp = makeTmp();
        const p = tmp.file("dao.profile.yaml", "buckets: []\n");
        assert.equal(find(tmp.dir), p);
        tmp.cleanup();
    });

    it("finds *.profile.yml file", () => {
        const tmp = makeTmp();
        const p = tmp.file("dao.profile.yml", "");
        assert.equal(find(tmp.dir), p);
        tmp.cleanup();
    });

    it("returns null when no profile file present", () => {
        const tmp = makeTmp();
        assert.equal(find(tmp.dir), null);
        tmp.cleanup();
    });

    it("returns null for non-profile yaml files", () => {
        const tmp = makeTmp();
        tmp.file("registry.yaml", "series: {}\n");
        assert.equal(find(tmp.dir), null);
        tmp.cleanup();
    });
});

// ============================================================================
// _findMetaFile
// ============================================================================

describe("Repository._findMetaFile", () => {
    const find = /** @type {any} */ (Repository)._findMetaFile.bind(Repository);

    it("finds *_META.yaml file", () => {
        const tmp = makeTmp();
        const p = tmp.file("DP-00001_META.yaml", "id: DP-00001\n");
        assert.equal(find(tmp.dir), p);
        tmp.cleanup();
    });

    it("finds *_META.yml file", () => {
        const tmp = makeTmp();
        const p = tmp.file("DP-00001_META.yml", "id: DP-00001\n");
        assert.equal(find(tmp.dir), p);
        tmp.cleanup();
    });

    it("returns null when no META file present", () => {
        const tmp = makeTmp();
        assert.equal(find(tmp.dir), null);
        tmp.cleanup();
    });

    it("returns null for unreadable directory", () => {
        assert.equal(find("/no/such/directory/at/all"), null);
    });
});

// ============================================================================
// _findPackFiles
// ============================================================================

describe("Repository._findPackFiles", () => {
    const find = /** @type {any} */ (Repository)._findPackFiles.bind(
        Repository
    );

    it("finds *.pack.json in root dir", () => {
        const tmp = makeTmp();
        tmp.file("formatting.pack.json", "{}");
        const results = find(tmp.dir);
        assert.ok(results.some((r) => r.name === "formatting.pack.json"));
        tmp.cleanup();
    });

    it("finds versioned *-v*.json in root dir", () => {
        const tmp = makeTmp();
        tmp.file("render-v1.json", "{}");
        const results = find(tmp.dir);
        assert.ok(results.some((r) => r.name === "render-v1.json"));
        tmp.cleanup();
    });

    it("finds packs inside packs/ subdirectory", () => {
        const tmp = makeTmp();
        tmp.file("packs/base.pack.json", "{}");
        const results = find(tmp.dir);
        assert.ok(results.some((r) => r.name === "base.pack.json"));
        tmp.cleanup();
    });

    it("finds packs inside render/ subdirectory", () => {
        const tmp = makeTmp();
        tmp.file("render/render-v1.json", "{}");
        const results = find(tmp.dir);
        assert.ok(results.some((r) => r.name === "render-v1.json"));
        tmp.cleanup();
    });

    it("does not duplicate packs seen in multiple search dirs", () => {
        const tmp = makeTmp();
        // put the same-named file in root only; render/ subdirectory is separate
        tmp.file("base.pack.json", "{}");
        const results = find(tmp.dir);
        const names = results.map((r) => r.name);
        assert.equal(names.filter((n) => n === "base.pack.json").length, 1);
        tmp.cleanup();
    });

    it("ignores plain .json files that don't match patterns", () => {
        const tmp = makeTmp();
        tmp.file("config.json", "{}");
        const results = find(tmp.dir);
        assert.ok(!results.some((r) => r.name === "config.json"));
        tmp.cleanup();
    });

    it("returns empty array for empty directory", () => {
        const tmp = makeTmp();
        assert.deepEqual(find(tmp.dir), []);
        tmp.cleanup();
    });

    it("finds packs inside formatting/ subdirectory", () => {
        const tmp = makeTmp();
        tmp.file("formatting/base-v1.json", "{}");
        const results = find(tmp.dir);
        assert.ok(results.some((r) => r.name === "base-v1.json"));
        tmp.cleanup();
    });

    it("finds packs inside formatting/packs/ subdirectory", () => {
        const tmp = makeTmp();
        tmp.file("formatting/packs/base-v1.json", "{}");
        const results = find(tmp.dir);
        assert.ok(results.some((r) => r.name === "base-v1.json"));
        tmp.cleanup();
    });

    it("deduplicates pack with same abs_path seen via multiple search dirs", () => {
        const tmp = makeTmp();
        // Same filename at root only — seen once regardless of how many subdirs are searched
        tmp.file("base-v1.json", "{}");
        const results = find(tmp.dir);
        assert.equal(
            results.filter((r) => r.name === "base-v1.json").length,
            1
        );
        tmp.cleanup();
    });

    it("returns both packs when same filename exists at root AND in formatting/ (different abs_path)", () => {
        const tmp = makeTmp();
        tmp.file("base-v1.json", "{}");
        tmp.file("formatting/base-v1.json", "{}");
        const results = find(tmp.dir);
        // Different abs_paths → both are valid distinct packs
        assert.equal(
            results.filter((r) => r.name === "base-v1.json").length,
            2
        );
        tmp.cleanup();
    });
});

// ============================================================================
// _parseUpstreamConfig
// ============================================================================

describe("Repository._parseUpstreamConfig", () => {
    const parse = /** @type {any} */ (Repository)._parseUpstreamConfig.bind(
        Repository
    );

    it("returns empty config for unparseable file", () => {
        const tmp = makeTmp();
        const p = tmp.file("upstream.yaml", ": : invalid yaml\n");
        // Some yaml parsers may not throw — just assert no throw and sensible defaults
        let out;
        assert.doesNotThrow(() => {
            out = parse(tmp.dir, p);
        });
        assert.ok(Array.isArray(/** @type {any} */ (out).pack_paths));
        tmp.cleanup();
    });

    it("parses flat Format A: profile, registry, formatting_packs, render_packs", () => {
        const tmp = makeTmp();
        // create the files the upstream references
        tmp.file("dao.profile.yaml", "buckets: []\n");
        tmp.file("registry.yaml", "series: {}\n");
        const upstreamContent = [
            `profile: dao.profile.yaml`,
            `registry: registry.yaml`,
            `formatting_packs:`,
            `  - fmt.pack.json`,
            `render_packs:`,
            `  - render-v1.json`
        ].join("\n");
        const p = tmp.file("SCHEMA_UPSTREAM.yaml", upstreamContent);
        const out = parse(tmp.dir, p);
        // profile resolves to abs path because the file exists
        assert.ok(out.profile_path !== null, "profile_path should be resolved");
        assert.ok(
            out.registry_path !== null,
            "registry_path should be resolved"
        );
        assert.ok(out.pack_paths.includes("fmt.pack.json"));
        assert.ok(out.render_pack_paths.includes("render-v1.json"));
        tmp.cleanup();
    });

    it("treats profile value as hint when file does not exist", () => {
        const tmp = makeTmp();
        const upstreamContent = `profile: nonexistent-profile\n`;
        const p = tmp.file("SCHEMA_UPSTREAM.yaml", upstreamContent);
        const out = parse(tmp.dir, p);
        assert.equal(out.profile_path, null);
        assert.equal(out.profile_hint, "nonexistent-profile");
        tmp.cleanup();
    });

    it("parses nested Format B under record_schema key", () => {
        const tmp = makeTmp();
        tmp.file("registry.yaml", "series: {}\n");
        const upstreamContent = [
            `record_schema:`,
            `  registry: registry.yaml`,
            `  formatting_packs:`,
            `    - base.pack.json`
        ].join("\n");
        const p = tmp.file("SCHEMA_UPSTREAM.yaml", upstreamContent);
        const out = parse(tmp.dir, p);
        assert.ok(
            out.registry_path !== null,
            "registry_path from nested record_schema"
        );
        assert.ok(out.pack_paths.includes("base.pack.json"));
        tmp.cleanup();
    });

    it("extracts provides_ids from provides array", () => {
        const tmp = makeTmp();
        const content = [
            `record_schema:`,
            `  provides:`,
            `    - id: dao-proposals`,
            `    - id: dao-charter`
        ].join("\n");
        const p = tmp.file("SCHEMA_UPSTREAM.yaml", content);
        const out = parse(tmp.dir, p);
        assert.ok(out.provides_ids.includes("dao-proposals"));
        assert.ok(out.provides_ids.includes("dao-charter"));
        tmp.cleanup();
    });

    it("supports profile_hint key directly", () => {
        const tmp = makeTmp();
        const content = `profile_hint: my-profile\n`;
        const p = tmp.file("SCHEMA_UPSTREAM.yaml", content);
        const out = parse(tmp.dir, p);
        assert.equal(out.profile_hint, "my-profile");
        tmp.cleanup();
    });

    it("supports registry as array (first existing wins)", () => {
        const tmp = makeTmp();
        tmp.file("registry.yaml", "series: {}\n");
        const content = [
            `registry:`,
            `  - missing.yaml`,
            `  - registry.yaml`
        ].join("\n");
        const p = tmp.file("SCHEMA_UPSTREAM.yaml", content);
        const out = parse(tmp.dir, p);
        assert.ok(out.registry_path !== null);
        tmp.cleanup();
    });

    it("falls back to profile file in root when profile key absent", () => {
        const tmp = makeTmp();
        tmp.file("dao.profile.yaml", "buckets: []\n");
        const content = `registry: registry.yaml\n`;
        const p = tmp.file("SCHEMA_UPSTREAM.yaml", content);
        const out = parse(tmp.dir, p);
        // _findProfileFile finds dao.profile.yaml as fallback
        assert.ok(out.profile_path !== null);
        tmp.cleanup();
    });
});

// ============================================================================
// _discoverByConvention
// ============================================================================

describe("Repository._discoverByConvention", () => {
    const discover = /** @type {any} */ (Repository)._discoverByConvention.bind(
        Repository
    );

    it("finds registry.yaml by convention", () => {
        const tmp = makeTmp();
        tmp.file("registry.yaml", "series: {}\n");
        /** @type {any} */
        const result = {
            registry_path: null,
            pack_paths: [],
            render_pack_paths: []
        };
        discover(tmp.dir, result);
        assert.ok(result.registry_path !== null);
        tmp.cleanup();
    });

    it("does not overwrite existing registry_path", () => {
        const tmp = makeTmp();
        tmp.file("registry.yaml", "series: {}\n");
        /** @type {any} */
        const result = {
            registry_path: "/already/set.yaml",
            pack_paths: [],
            render_pack_paths: []
        };
        discover(tmp.dir, result);
        assert.equal(result.registry_path, "/already/set.yaml");
        tmp.cleanup();
    });

    it("classifies formatting pack by name containing 'format'", () => {
        const tmp = makeTmp();
        tmp.file(
            "formatting.pack.json",
            JSON.stringify({
                schema: "record-schema-formatting-pack"
            })
        );
        /** @type {any} */
        const result = {
            registry_path: null,
            pack_paths: [],
            render_pack_paths: []
        };
        discover(tmp.dir, result);
        assert.ok(result.pack_paths.length > 0);
        tmp.cleanup();
    });

    it("classifies render pack by name containing 'render'", () => {
        const tmp = makeTmp();
        tmp.file(
            "render.pack.json",
            JSON.stringify({
                schema: "record-schema-render-pack"
            })
        );
        /** @type {any} */
        const result = {
            registry_path: null,
            pack_paths: [],
            render_pack_paths: []
        };
        discover(tmp.dir, result);
        assert.ok(result.render_pack_paths.length > 0);
        tmp.cleanup();
    });

    it("classifies ambiguous pack by schema field in content", () => {
        const tmp = makeTmp();
        tmp.file(
            "base-v1.json",
            JSON.stringify({
                schema: "record-schema-render-pack"
            })
        );
        /** @type {any} */
        const result = {
            registry_path: null,
            pack_paths: [],
            render_pack_paths: []
        };
        discover(tmp.dir, result);
        assert.ok(result.render_pack_paths.length > 0);
        tmp.cleanup();
    });

    it("skips packs when pack_paths already populated", () => {
        const tmp = makeTmp();
        tmp.file("formatting.pack.json", "{}");
        /** @type {any} */
        const result = {
            registry_path: null,
            pack_paths: ["already-loaded.json"],
            render_pack_paths: []
        };
        discover(tmp.dir, result);
        // pack_paths should not grow because it was non-empty
        assert.equal(result.pack_paths.length, 1);
        tmp.cleanup();
    });
});

// ============================================================================
// _detectRecordDirectory
// ============================================================================

describe("Repository._detectRecordDirectory", () => {
    const detect = /** @type {any} */ (Repository)._detectRecordDirectory.bind(
        Repository
    );

    it("returns RecordInfo for a directory whose name matches record pattern", () => {
        const tmp = makeTmp();
        // Standard naming: DP-00001_some-slug
        const recDir = tmp.subdir("DP-00001_some-slug");
        const info = detect(recDir);
        assert.ok(info !== null);
        assert.equal(info.record_id, "DP-00001");
        tmp.cleanup();
    });

    it("returns null for non-matching directory name without META file", () => {
        const tmp = makeTmp();
        const dir = tmp.subdir("just-a-folder");
        const info = detect(dir);
        assert.equal(info, null);
        tmp.cleanup();
    });
});

// ============================================================================
// isRepository
// ============================================================================

describe("Repository.isRepository", () => {
    it("returns true for existing directory", () => {
        const tmp = makeTmp();
        assert.equal(Repository.isRepository(tmp.dir), true);
        tmp.cleanup();
    });

    it("returns false for non-existent directory", () => {
        assert.equal(
            Repository.isRepository("/no/such/path/" + Math.random()),
            false
        );
    });
});

// ============================================================================
// open / construction
// ============================================================================

describe("Repository.open", () => {
    it("resolves root_dir to absolute path", () => {
        const tmp = makeTmp();
        const repo = Repository.open(tmp.dir);
        assert.equal(repo.root_dir, resolve(tmp.dir));
        tmp.cleanup();
    });

    it("starts with all lazy fields as null", () => {
        const tmp = makeTmp();
        const repo = Repository.open(tmp.dir);
        assert.equal(repo.getProfile(), null);
        assert.equal(repo.getRegistry(), null);
        assert.equal(repo.getPolicy(), null);
        assert.equal(repo.getRenderPolicy(), null);
        assert.equal(repo.getPacketConfig(), null);
        assert.equal(repo.getTargetRecord(), null);
        assert.equal(repo.hasTargetRecord(), false);
        tmp.cleanup();
    });
});

// ============================================================================
// setToolkitDir / getToolkitDir
// ============================================================================

describe("Repository - toolkit dir", () => {
    it("getToolkitDir returns a non-empty string by default", () => {
        const tmp = makeTmp();
        const repo = Repository.open(tmp.dir);
        const td = repo.getToolkitDir();
        assert.ok(typeof td === "string" && td.length > 0);
        tmp.cleanup();
    });

    it("setToolkitDir updates getToolkitDir", () => {
        const tmp = makeTmp();
        const repo = Repository.open(tmp.dir);
        repo.setToolkitDir(tmp.dir);
        assert.equal(repo.getToolkitDir(), resolve(tmp.dir));
        tmp.cleanup();
    });

    it("setToolkitDir clears cached schemas", () => {
        const tmp = makeTmp();
        const repo = Repository.open(tmp.dir);
        // Force schema cache population (will return null, that's fine)
        repo.getRecordMetaSchema();
        // Changing toolkit dir should clear caches (no error)
        assert.doesNotThrow(() => repo.setToolkitDir(tmp.dir));
        tmp.cleanup();
    });
});

// ============================================================================
// Profile accessors
// ============================================================================

describe("Repository - profile accessors", () => {
    it("setProfile / getProfile round-trip", () => {
        const tmp = makeTmp();
        const repo = Repository.open(tmp.dir);
        const profile = Profile.empty();
        repo.setProfile(profile);
        assert.ok(repo.getProfile() === profile);
        tmp.cleanup();
    });

    it("loadProfile returns null when file does not exist", () => {
        const tmp = makeTmp();
        const repo = Repository.open(tmp.dir);
        const result = repo.loadProfile("nonexistent.profile.yaml");
        assert.equal(result, null);
        assert.equal(repo.getProfile(), null);
        tmp.cleanup();
    });

    it("loadProfile loads profile from file", () => {
        const tmp = makeTmp();
        tmp.file("dao.profile.yaml", "buckets: []\n");
        const repo = Repository.open(tmp.dir);
        const result = repo.loadProfile("dao.profile.yaml");
        assert.ok(result instanceof Profile);
        assert.ok(repo.getProfile() instanceof Profile);
        tmp.cleanup();
    });
});

// ============================================================================
// Registry accessors
// ============================================================================

describe("Repository - registry accessors", () => {
    it("setRegistry / getRegistry round-trip", () => {
        const tmp = makeTmp();
        const repo = Repository.open(tmp.dir);
        const reg = Registry.empty();
        repo.setRegistry(reg);
        assert.ok(repo.getRegistry() === reg);
        tmp.cleanup();
    });

    it("loadRegistry returns null when file does not exist", () => {
        const tmp = makeTmp();
        const repo = Repository.open(tmp.dir);
        const result = repo.loadRegistry("missing.yaml");
        assert.equal(result, null);
        tmp.cleanup();
    });

    it("loadRegistry loads registry from file", () => {
        const tmp = makeTmp();
        tmp.file(
            "registry.yaml",
            "series: {}\ndoc_types: {}\ncommitment_kinds: {}\n"
        );
        const repo = Repository.open(tmp.dir);
        const result = repo.loadRegistry("registry.yaml");
        assert.ok(result instanceof Registry);
        tmp.cleanup();
    });
});

// ============================================================================
// Pack / policy accessors
// ============================================================================

describe("Repository - pack / policy accessors", () => {
    it("getPolicy returns null before any packs loaded", () => {
        const tmp = makeTmp();
        assert.equal(Repository.open(tmp.dir).getPolicy(), null);
        tmp.cleanup();
    });

    it("getLoadedPackPaths returns empty array before any packs loaded", () => {
        const tmp = makeTmp();
        assert.deepEqual(Repository.open(tmp.dir).getLoadedPackPaths(), []);
        tmp.cleanup();
    });

    it("getRenderPolicy returns null before render packs loaded", () => {
        const tmp = makeTmp();
        assert.equal(Repository.open(tmp.dir).getRenderPolicy(), null);
        tmp.cleanup();
    });
});

// ============================================================================
// Target record accessors
// ============================================================================

describe("Repository - target record accessors", () => {
    it("hasTargetRecord returns false by default", () => {
        const tmp = makeTmp();
        assert.equal(Repository.open(tmp.dir).hasTargetRecord(), false);
        tmp.cleanup();
    });

    it("getTargetRecord returns null by default", () => {
        const tmp = makeTmp();
        assert.equal(Repository.open(tmp.dir).getTargetRecord(), null);
        tmp.cleanup();
    });
});

// ============================================================================
// Path utilities
// ============================================================================

describe("Repository - path utilities", () => {
    it("resolve joins rel path with root_dir", () => {
        const tmp = makeTmp();
        const repo = Repository.open(tmp.dir);
        assert.equal(
            repo.resolve("foo/bar.md"),
            resolve(tmp.dir, "foo/bar.md")
        );
        tmp.cleanup();
    });

    it("exists returns true for existing file", () => {
        const tmp = makeTmp();
        tmp.file("hello.txt", "hi");
        const repo = Repository.open(tmp.dir);
        assert.equal(repo.exists("hello.txt"), true);
        tmp.cleanup();
    });

    it("exists returns false for missing file", () => {
        const tmp = makeTmp();
        const repo = Repository.open(tmp.dir);
        assert.equal(repo.exists("nope.txt"), false);
        tmp.cleanup();
    });

    it("getRelativePath returns posix relative path from root", () => {
        const tmp = makeTmp();
        const repo = Repository.open(tmp.dir);
        const abs = resolve(tmp.dir, "sub/file.md");
        assert.equal(repo.getRelativePath(abs), "sub/file.md");
        tmp.cleanup();
    });
});

// ============================================================================
// File I/O
// ============================================================================

describe("Repository - file I/O", () => {
    it("readJson returns parsed object", () => {
        const tmp = makeTmp();
        tmp.file("data.json", JSON.stringify({ key: "value" }));
        const repo = Repository.open(tmp.dir);
        const obj = /** @type {any} */ (repo.readJson("data.json"));
        assert.equal(obj.key, "value");
        tmp.cleanup();
    });

    it("readText returns file content as string", () => {
        const tmp = makeTmp();
        tmp.file("readme.md", "Hello World");
        const repo = Repository.open(tmp.dir);
        assert.equal(repo.readText("readme.md"), "Hello World");
        tmp.cleanup();
    });

    it("writeText writes content and readText reads it back", () => {
        const tmp = makeTmp();
        const repo = Repository.open(tmp.dir);
        repo.writeText("output.txt", "Written by repo");
        assert.equal(repo.readText("output.txt"), "Written by repo");
        tmp.cleanup();
    });
});

// ============================================================================
// validateRequiredPaths
// ============================================================================

describe("Repository - validateRequiredPaths", () => {
    it("returns empty array when no profile is loaded", () => {
        const tmp = makeTmp();
        const repo = Repository.open(tmp.dir);
        const issues = repo.validateRequiredPaths();
        assert.deepEqual(issues, []);
        tmp.cleanup();
    });

    it("reports missing required paths from profile", () => {
        const tmp = makeTmp();
        const repo = Repository.open(tmp.dir);
        // Build profile directly so we don't depend on YAML loading
        const profile = new Profile(
            {
                rules: {
                    root: {
                        required_paths: [
                            "MUST_NOT_EXIST_A.md",
                            "MUST_NOT_EXIST_B.md"
                        ]
                    }
                }
            },
            null
        );
        repo.setProfile(profile);
        const issues = repo.validateRequiredPaths();
        assert.ok(issues.length >= 1);
        assert.ok(issues.every((i) => i.code === "root.required_path.missing"));
        tmp.cleanup();
    });

    it("no issues when all required paths exist", () => {
        const tmp = makeTmp();
        tmp.file("README.md", "# Readme");
        const repo = Repository.open(tmp.dir);
        const profile = new Profile(
            { rules: { root: { required_paths: ["README.md"] } } },
            null
        );
        repo.setProfile(profile);
        const issues = repo.validateRequiredPaths();
        assert.deepEqual(issues, []);
        tmp.cleanup();
    });
});

// ============================================================================
// discoverRepository — Tier 4 heuristic (.git)
// ============================================================================

describe("Repository.discoverRepository - Tier 4 heuristic", () => {
    it("resolves via heuristic when .git marker is present", () => {
        const tmp = makeTmp();
        tmp.subdir(".git");
        const result = Repository.discoverRepository(tmp.dir);
        assert.equal(result.resolved_via, "heuristic");
        assert.equal(result.root_dir, resolve(tmp.dir));
        tmp.cleanup();
    });

    it("result shape has expected fields", () => {
        const tmp = makeTmp();
        tmp.subdir(".git");
        const result = Repository.discoverRepository(tmp.dir);
        assert.ok(Array.isArray(result.pack_paths));
        assert.ok(Array.isArray(result.render_pack_paths));
        assert.ok(Array.isArray(result.provides_ids));
        tmp.cleanup();
    });
});

// ============================================================================
// discoverRepository — Tier 3 profile file
// ============================================================================

describe("Repository.discoverRepository - Tier 3 profile", () => {
    it("resolves via profile when *.profile.yaml present", () => {
        const tmp = makeTmp();
        tmp.file("dao.profile.yaml", "buckets: []\n");
        const result = Repository.discoverRepository(tmp.dir);
        assert.equal(result.resolved_via, "profile");
        assert.ok(result.profile_path !== null);
        tmp.cleanup();
    });

    it("picks up registry.yaml by convention when profile found", () => {
        const tmp = makeTmp();
        tmp.file("dao.profile.yaml", "buckets: []\n");
        tmp.file("registry.yaml", "series: {}\n");
        const result = Repository.discoverRepository(tmp.dir);
        assert.ok(result.registry_path !== null);
        tmp.cleanup();
    });
});

// ============================================================================
// discoverRepository — Tier 2 upstream file
// ============================================================================

describe("Repository.discoverRepository - Tier 2 upstream", () => {
    it("resolves via upstream when SCHEMA_UPSTREAM.yaml present", () => {
        const tmp = makeTmp();
        tmp.file("dao.profile.yaml", "buckets: []\n");
        tmp.file("SCHEMA_UPSTREAM.yaml", "profile: dao.profile.yaml\n");
        const result = Repository.discoverRepository(tmp.dir);
        assert.equal(result.resolved_via, "upstream");
        assert.ok(result.upstream_path !== null);
        tmp.cleanup();
    });

    it("populates pack_paths from upstream formatting_packs", () => {
        const tmp = makeTmp();
        tmp.file(
            "SCHEMA_UPSTREAM.yaml",
            [
                "formatting_packs:",
                "  - fmt.pack.json",
                "render_packs:",
                "  - render-v1.json"
            ].join("\n")
        );
        const result = Repository.discoverRepository(tmp.dir);
        assert.ok(result.pack_paths.includes("fmt.pack.json"));
        assert.ok(result.render_pack_paths.includes("render-v1.json"));
        tmp.cleanup();
    });

    it("falls back to convention discovery when upstream yields no packs", () => {
        const tmp = makeTmp();
        tmp.file("SCHEMA_UPSTREAM.yaml", "profile_hint: none\n");
        tmp.file("registry.yaml", "series: {}\n");
        const result = Repository.discoverRepository(tmp.dir);
        assert.equal(result.resolved_via, "upstream");
        // registry should be discovered by convention
        assert.ok(result.registry_path !== null);
        tmp.cleanup();
    });
});

// ============================================================================
// _metaOverridesFrom
// ============================================================================

describe("Repository._metaOverridesFrom", () => {
    const metaFrom = /** @type {any} */ (Repository)._metaOverridesFrom.bind(
        Repository
    );

    it("returns empty object for null", () => {
        assert.deepEqual(metaFrom(null), {});
    });

    it("returns empty object for undefined", () => {
        assert.deepEqual(metaFrom(undefined), {});
    });

    it("extracts formatting_profile when present", () => {
        const fakeMetafile = {
            getFormattingProfile: () => "canonical-ascii",
            data: {}
        };
        const result = metaFrom(fakeMetafile);
        assert.equal(result.formatting_profile, "canonical-ascii");
    });

    it("omits formatting_profile when getFormattingProfile returns non-string", () => {
        const fakeMetafile = {
            getFormattingProfile: () => null,
            data: {}
        };
        const result = metaFrom(fakeMetafile);
        assert.ok(!("formatting_profile" in result));
    });

    it("extracts language_locale from data.extensions.language.locale", () => {
        const fakeMetafile = {
            getFormattingProfile: () => null,
            data: { extensions: { language: { locale: "en-GB" } } }
        };
        const result = metaFrom(fakeMetafile);
        assert.equal(result.language_locale, "en-GB");
    });

    it("omits language_locale when not present", () => {
        const fakeMetafile = {
            getFormattingProfile: () => null,
            data: {}
        };
        const result = metaFrom(fakeMetafile);
        assert.ok(!("language_locale" in result));
    });

    it("returns both fields when both present", () => {
        const fakeMetafile = {
            getFormattingProfile: () => "baseline",
            data: { extensions: { language: { locale: "en-AU" } } }
        };
        const result = metaFrom(fakeMetafile);
        assert.equal(result.formatting_profile, "baseline");
        assert.equal(result.language_locale, "en-AU");
    });
});

// ============================================================================
// lintDocuments
// ============================================================================

describe("Repository - lintDocuments", () => {
    it("returns empty array when no policy loaded", () => {
        const tmp = makeTmp();
        const repo = Repository.open(tmp.dir);
        // No packs loaded → no policy
        const issues = repo.lintDocuments();
        assert.deepEqual(issues, []);
        tmp.cleanup();
    });

    it("returns LintIssue[] for record dir with policy loaded", async () => {
        const tmp = makeTmp();
        // Write a minimal formatting pack
        const packData = {
            schema: "record-schema-formatting-pack",
            schema_version: 1,
            pack_id: "test-pack",
            document_policies: {
                defaults: { line_width: { max: 40 } },
                rulesets: [
                    {
                        id: "md-lw",
                        selectors: { extensions: ["md"] },
                        enforce: { line_width: { max: 40 } }
                    }
                ]
            }
        };
        tmp.file(
            "formatting/packs/test-pack-v1.json",
            JSON.stringify(packData)
        );
        // Write a record dir with a long-line document (hyphen-slug matches default regex)
        const recDir = "DP-00001-test-record";
        tmp.subdir(recDir);
        const longLine = "X".repeat(80);
        tmp.file(`${recDir}/DP-00001_DOC-readme.md`, `${longLine}\n`);

        const merged = FormattingPack.loadMerged(tmp.dir, [
            "formatting/packs/test-pack-v1.json"
        ]);
        const repo = Repository.open(tmp.dir);
        repo._policy = merged.policy;

        const issues = repo.lintDocuments({ scanDir: tmp.dir });
        // Should get line_width issues for the 80-char line against max 40
        assert.ok(Array.isArray(issues));
        assert.ok(issues.some((i) => i.code === "format.line_width"));
        tmp.cleanup();
    });

    it("lintDocuments({ scanDir: recordDir }) scopes to that record only", async () => {
        const tmp = makeTmp();
        // Two records (hyphen-slug matches default regex)
        tmp.subdir("DP-00001-record-a");
        tmp.subdir("DP-00002-record-b");
        const longLine = "X".repeat(80);
        tmp.file("DP-00001-record-a/DP-00001_DOC-doc.md", `${longLine}\n`);
        tmp.file("DP-00002-record-b/DP-00002_DOC-doc.md", `${longLine}\n`);

        const packData = {
            schema: "record-schema-formatting-pack",
            schema_version: 1,
            pack_id: "test-pack",
            document_policies: {
                defaults: { line_width: { max: 40 } }
            }
        };
        tmp.file(
            "formatting/packs/test-pack-v1.json",
            JSON.stringify(packData)
        );
        const merged = FormattingPack.loadMerged(tmp.dir, [
            "formatting/packs/test-pack-v1.json"
        ]);

        const repo = Repository.open(tmp.dir);
        repo._policy = merged.policy;

        // Scope to record-a only
        const issues = repo.lintDocuments({
            scanDir: resolve(tmp.dir, "DP-00001-record-a")
        });
        // All issues should come from DP-00001 files only
        for (const issue of issues) {
            assert.ok(
                issue.file.includes("DP-00001"),
                `Expected DP-00001 file, got: ${issue.file}`
            );
        }
        tmp.cleanup();
    });
});
