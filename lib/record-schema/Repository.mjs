/**
 * Repository class representing a project (github repo or local folder)
 * @module classes/Repository
 */

import { readFileSync, readdirSync, existsSync, writeFileSync } from "node:fs";
import { resolve, dirname, basename } from "node:path";
import { fileURLToPath } from "node:url";

import { Schema } from "./Schema.mjs";
import { Registry } from "./Registry.mjs";
import { Profile } from "./Profile.mjs";
import { FormattingPack } from "./FormattingPack.mjs";
import { RenderPack } from "./RenderPack.mjs";
import { Metafile } from "./Metafile.mjs";
import { Document } from "./Document.mjs";
import { parseYaml } from "../parsing/yaml.mjs";
import { readJson, readText, writeText } from "../util/files.mjs";

/**
 * @typedef {import("../types/general.mjs").Metadata} Metadata
 * @typedef {import("./types/general.mjs").ValidationIssue} ValidationIssue
 * @typedef {import("./types/general.mjs").RecordInfo} RecordInfo
 * @typedef {import("./types/general.mjs").RepositoryLintResult} RepositoryLintResult
 * @typedef {import("./types/general.mjs").LintOptions} LintOptions
 * @typedef {import("./types/general.mjs").UpstreamConfig} UpstreamConfig
 * @typedef {import("./types/general.mjs").RepositoryDiscoveryResult} RepositoryDiscoveryResult
 * @typedef {import("./types/general.mjs").RenderDocumentPolicy} RenderDocumentPolicy
 **/

/**
 * Well-known profile/upstream file names to search for
 */
const UPSTREAM_FILENAMES = [
    "SCHEMA_UPSTREAM.yaml",
    "SCHEMA_UPSTREAM.yml",
    "schema_upstream.yaml",
    "schema_upstream.yml"
];

const PROFILE_SUFFIX_PATTERNS = [".profile.yaml", ".profile.yml"];

const REGISTRY_FILENAMES = [
    "registry.yaml",
    "registry.yml",
    "core-series.yaml",
    "doc-types.yaml"
];

/**
 * Repository representing a project root
 */
export class Repository {
    /**
     * @param {string} root_dir
     */
    constructor(root_dir) {
        /** @type {string} */
        this.root_dir = resolve(root_dir);

        /** @type {string | null} */
        this._toolkit_dir = null;

        /** @type {Profile | null} */
        this._profile = null;

        /** @type {Registry | null} */
        this._registry = null;

        /** @type {Schema | null} */
        this._record_meta_schema = null;
        /** @type {Schema | null} */

        this._doc_meta_schema = null;
        /** @type {Schema | null} */

        this._profile_schema = null;
        /** @type {Schema | null} */

        this._registry_schema = null;
        /** @type {import("./FormattingPack.mjs").DocumentPolicy | null} */
        this._policy = null;

        /** @type {string[] | null} */
        this._loaded_pack_paths = null;

        /** @type {RenderDocumentPolicy | null} */
        this._render_policy = null;

        /** @type {Metadata | null} */
        this._packet_config = null;

        /** @type {RecordInfo | null} */
        this._target_record = null;
    }

    // =========================================================================
    // Static Factory Methods
    // =========================================================================

    /**
     * Open a repository at the given path
     * @param {string} root_dir
     * @returns {Repository}
     */
    static open(root_dir) {
        return new Repository(root_dir);
    }

    /**
     * Primary entry point: open a repository from any folder reference.
     *
     * Resolution order:
     *   1. Check startDir for _META.yaml → record dir, traverse up for root + upstream
     *   2. Traverse up looking for SCHEMA_UPSTREAM.yaml → parse it for profile/registry/packs
     *   3. Traverse up looking for *.profile.yaml directly
     *   4. Fall back to heuristics (.git, package.json, etc.)
     *
     * After resolution, automatically loads profile, registry, formatting packs,
     * and render packs so the repo is fully hydrated and ready to use.
     *
     * @param {string} startDir - Any directory (record dir, repo root, or nested)
     * @param {Object} [options]
     * @param {number} [options.maxDepth=10] - Max directories to traverse up
     * @param {boolean} [options.verbose=false] - Enable verbose discovery tracing
     * @returns {Repository}
     */
    static fromFolder(startDir, options = {}) {
        const { maxDepth = 10, verbose = false } = options;
        const discovery = Repository.discoverRepository(startDir, {
            maxDepth,
            verbose
        });

        const repo = new Repository(discovery.root_dir);

        // Hydrate everything we found
        Repository._hydrateFromDiscovery(repo, discovery, verbose);

        return repo;
    }

    /**
     * Open repository with automatic root discovery
     * Traverses up to find the actual repository root and loads profile
     * @param {string} startDir - Starting directory (can be record dir or repo root)
     * @param {Object} [options]
     * @param {number} [options.maxDepth=10] - Max directories to traverse up
     * @param {boolean} [options.verbose=false] - Enable verbose discovery tracing
     * @returns {Repository}
     */
    static openWithDiscovery(startDir, options = {}) {
        // Delegate to fromFolder — openWithDiscovery is now an alias
        return Repository.fromFolder(startDir, options);
    }

    /**
     * Discover repository root and configuration from a starting directory.
     *
     * Tier 1: _META.yaml in startDir → we're in a record, walk up for root
     * Tier 2: SCHEMA_UPSTREAM.yaml → parse for profile, registry, pack paths
     * Tier 3: *.profile.yaml → root with profile but no upstream
     * Tier 4: .git / package.json / yarn.lock → heuristic root
     *
     * @param {string} startDir
     * @param {Object} [options]
     * @param {number} [options.maxDepth=10]
     * @param {boolean} [options.verbose=false]
     * @returns {RepositoryDiscoveryResult}
     */
    static discoverRepository(startDir, options = {}) {
        const { maxDepth = 10, verbose = false } = options;
        const absStart = resolve(startDir);

        /**
         * @param {string} msg
         */
        const trace = (msg) => {
            if (verbose) {
                console.log(`[VERBOSE] ${msg}`);
            }
        };

        trace(`=== Repository Discovery ===`);
        trace(`startDir: ${absStart}`);

        /** @type {RepositoryDiscoveryResult} */
        const result = {
            root_dir: absStart,
            profile_path: null,
            profile_hint: null,
            upstream_path: null,
            target_record: null,
            registry_path: null,
            pack_paths: [],
            render_pack_paths: [],
            provides_ids: [],
            resolved_via: "heuristic"
        };

        // =====================================================================
        // Tier 1: Check if startDir is a record directory (_META.yaml present)
        // =====================================================================
        const recordInfo = Repository._detectRecordDirectory(absStart);
        if (recordInfo) {
            result.target_record = recordInfo;
            trace(
                `Tier 1: detected record dir: ${
                    recordInfo.record_id
                } (meta=${!!recordInfo.metafile})`
            );
        } else {
            trace(`Tier 1: not a record directory`);
        }

        // =====================================================================
        // Tier 2+3+4: Traverse up looking for root markers
        // =====================================================================
        let currentDir = absStart;
        let depth = 0;

        while (depth < maxDepth) {
            trace(`Tier 2/3/4 scan: depth=${depth} dir=${currentDir}`);

            // Tier 2: SCHEMA_UPSTREAM.yaml — authoritative source
            const upstream_path = Repository._findUpstreamFile(currentDir);
            if (upstream_path) {
                trace(`Tier 2: found SCHEMA_UPSTREAM at ${upstream_path}`);
                result.root_dir = currentDir;
                result.upstream_path = upstream_path;
                result.resolved_via = "upstream";

                // Parse upstream for all config paths
                const upstreamConfig = Repository._parseUpstreamConfig(
                    currentDir,
                    upstream_path
                );

                trace(
                    `  upstream.profile_path: ${
                        upstreamConfig.profile_path ?? "(null)"
                    }`
                );
                trace(
                    `  upstream.profile_hint: ${
                        upstreamConfig.profile_hint ?? "(null)"
                    }`
                );
                trace(
                    `  upstream.registry_path: ${
                        upstreamConfig.registry_path ?? "(null)"
                    }`
                );
                trace(
                    `  upstream.pack_paths: ${
                        upstreamConfig.pack_paths.length > 0
                            ? upstreamConfig.pack_paths.join(", ")
                            : "(none)"
                    }`
                );
                trace(
                    `  upstream.render_pack_paths: ${
                        upstreamConfig.render_pack_paths.length > 0
                            ? upstreamConfig.render_pack_paths.join(", ")
                            : "(none)"
                    }`
                );
                trace(
                    `  upstream.provides_ids: ${
                        upstreamConfig.provides_ids.length > 0
                            ? upstreamConfig.provides_ids.join(", ")
                            : "(none)"
                    }`
                );

                if (upstreamConfig.profile_path) {
                    result.profile_path = upstreamConfig.profile_path;
                }
                if (upstreamConfig.profile_hint) {
                    result.profile_hint = upstreamConfig.profile_hint;
                }
                if (upstreamConfig.registry_path) {
                    result.registry_path = upstreamConfig.registry_path;
                }
                if (upstreamConfig.pack_paths.length > 0) {
                    result.pack_paths = upstreamConfig.pack_paths;
                }
                if (upstreamConfig.render_pack_paths.length > 0) {
                    result.render_pack_paths = upstreamConfig.render_pack_paths;
                }
                if (upstreamConfig.provides_ids.length > 0) {
                    result.provides_ids = upstreamConfig.provides_ids;
                }

                // If upstream didn't yield packs, fall back to convention discovery
                if (
                    result.pack_paths.length === 0 &&
                    result.render_pack_paths.length === 0
                ) {
                    trace(
                        `  upstream yielded no packs — running convention discovery`
                    );
                    Repository._discoverByConvention(currentDir, result, trace);
                }

                break;
            }

            // Tier 3: *.profile.yaml — root with profile
            const profilePath = Repository._findProfileFile(currentDir);
            if (profilePath) {
                trace(`Tier 3: found profile at ${profilePath}`);
                result.root_dir = currentDir;
                result.profile_path = profilePath;
                result.resolved_via = "profile";

                // Try to find registry and packs by convention
                Repository._discoverByConvention(currentDir, result, trace);

                break;
            }

            // Tier 4: Heuristic repo root (.git, package.json, etc.)
            if (Repository._isLikelyRepoRoot(currentDir)) {
                trace(`Tier 4: heuristic root at ${currentDir}`);
                result.root_dir = currentDir;
                result.resolved_via = "heuristic";

                // Try convention-based discovery
                Repository._discoverByConvention(currentDir, result, trace);

                break;
            }

            // Move up
            const parentDir = dirname(currentDir);
            if (parentDir === currentDir) {
                break;
            }
            currentDir = parentDir;
            depth++;
        }

        // If we found a target record via Tier 1, mark resolved_via accordingly
        // (only if we didn't find a higher-priority marker)
        if (result.target_record && result.resolved_via === "heuristic") {
            // We started in a record dir but found no upstream/profile/repo root above
            // The parent of the record dir is the best guess for root
            const parentOfRecord = dirname(absStart);
            if (parentOfRecord !== absStart) {
                result.root_dir = parentOfRecord;
            }
            result.resolved_via = "meta";
            trace(
                `post-loop: fell back to meta resolution, root_dir=${result.root_dir}`
            );
        }

        // Update target record rel_path relative to discovered root
        if (result.target_record && result.root_dir !== absStart) {
            result.target_record.rel_path = Repository._relPosix(
                result.root_dir,
                result.target_record.abs_path
            );
        }

        // If profile was found, try to extract pack paths from it
        if (result.profile_path && result.pack_paths.length === 0) {
            const profile = Profile.loadIfExists(result.profile_path);
            if (profile && profile.hasPackPaths()) {
                const profilePackPaths = profile.getPackPaths();
                trace(
                    `profile.getPackPaths(): ${JSON.stringify(
                        profilePackPaths
                    )}`
                );
                for (let i = 0, len = profilePackPaths.length; i < len; i++) {
                    const abs = resolve(result.root_dir, profilePackPaths[i]);
                    trace(
                        `  checking pack path: ${
                            profilePackPaths[i]
                        } → ${abs} exists=${existsSync(abs)}`
                    );
                    if (existsSync(abs)) {
                        result.pack_paths.push(profilePackPaths[i]);
                    }
                }
            } else {
                trace(`profile has no pack_paths`);
            }
        }

        trace(`=== Discovery Result ===`);
        trace(`  resolved_via: ${result.resolved_via}`);
        trace(`  root_dir: ${result.root_dir}`);
        trace(`  profilePath: ${result.profile_path ?? "(null)"}`);
        trace(`  upstream_path: ${result.upstream_path ?? "(null)"}`);
        trace(`  registryPath: ${result.registry_path ?? "(null)"}`);
        trace(
            `  packPaths: ${
                result.pack_paths.length > 0
                    ? result.pack_paths.join(", ")
                    : "(none)"
            }`
        );
        trace(
            `  renderPackPaths: ${
                result.render_pack_paths.length > 0
                    ? result.render_pack_paths.join(", ")
                    : "(none)"
            }`
        );
        trace(
            `  providesIds: ${
                result.provides_ids.length > 0
                    ? result.provides_ids.join(", ")
                    : "(none)"
            }`
        );
        trace(
            `  targetRecord: ${
                result.target_record ? result.target_record.record_id : "(null)"
            }`
        );

        return result;
    }

    /**
     * Check if a directory is a valid repository
     * @param {string} root_dir
     * @returns {boolean}
     */
    static isRepository(root_dir) {
        return existsSync(root_dir);
    }

    // =========================================================================
    // Discovery Helpers (Private Static)
    // =========================================================================

    /**
     * Detect if directory is a record directory
     * @param {string} dir
     * @returns {RecordInfo | null}
     * @private
     */
    static _detectRecordDirectory(dir) {
        const dir_name = basename(dir);
        const record_id = Metafile.dirNameToRecordId(dir_name);

        if (!record_id) {
            // Also check for META file directly (handles non-standard dir names)
            const metaFile = Repository._findMetaFile(dir);
            if (metaFile) {
                const meta = Metafile.loadIfExists(metaFile);
                if (meta && meta.getId()) {
                    return {
                        record_id: meta.getId() || "UNKNOWN",
                        dir_name,
                        abs_path: dir,
                        rel_path: dir_name,
                        bucket: "unknown",
                        metafile: meta
                    };
                }
            }
            return null;
        }

        const metafile = Metafile.loadFromRecord(dir, record_id);

        return {
            record_id,
            dir_name,
            abs_path: dir,
            rel_path: dir_name,
            bucket: "unknown",
            metafile
        };
    }

    /**
     * Find *_META.yaml file in directory
     * @param {string} dir
     * @returns {string | null}
     * @private
     */
    static _findMetaFile(dir) {
        let entries;
        try {
            entries = readdirSync(dir, { withFileTypes: true });
        } catch {
            return null;
        }

        for (let i = 0, len = entries.length; i < len; i++) {
            const e = entries[i];
            if (!e.isFile()) {
                continue;
            }
            if (e.name.endsWith("_META.yaml") || e.name.endsWith("_META.yml")) {
                return resolve(dir, e.name);
            }
        }

        return null;
    }

    /**
     * Find SCHEMA_UPSTREAM file
     * @param {string} dir
     * @returns {string | null}
     * @private
     */
    static _findUpstreamFile(dir) {
        for (let i = 0, len = UPSTREAM_FILENAMES.length; i < len; i++) {
            const candidate = resolve(dir, UPSTREAM_FILENAMES[i]);
            if (existsSync(candidate)) {
                return candidate;
            }
        }
        return null;
    }

    /**
     * Find profile file in directory
     * @param {string} dir
     * @returns {string | null}
     * @private
     */
    static _findProfileFile(dir) {
        let entries;
        try {
            entries = readdirSync(dir, { withFileTypes: true });
        } catch {
            return null;
        }

        for (let i = 0, len = entries.length; i < len; i++) {
            const e = entries[i];
            if (!e.isFile()) {
                continue;
            }
            for (
                let j = 0, jLen = PROFILE_SUFFIX_PATTERNS.length;
                j < jLen;
                j++
            ) {
                if (e.name.endsWith(PROFILE_SUFFIX_PATTERNS[j])) {
                    return resolve(dir, e.name);
                }
            }
        }

        return null;
    }

    /**
     * Resolve a profile hint against a profiles directory.
     * The hint is treated as a name/slug, NOT a path.
     *
     * @param {string} profilesDir
     * @param {string} hint
     * @returns {string | null}
     * @private
     */
    static _resolveProfileHint(profilesDir, hint) {
        const base = basename(hint.replace(/\\/g, "/"));
        /** @type {string[]} */
        const candidates = [
            base,
            `${base}.profiles`,
            `${base}.yaml`,
            `${base}.yml`,
            `${base}.profiles.yaml`,
            `${base}.profiles.yml`,
            `${base}.profile.yaml`,
            `${base}.profile.yml`
        ];
        for (let i = 0, len = candidates.length; i < len; i++) {
            const abs = resolve(profilesDir, candidates[i]);
            if (existsSync(abs)) {
                return abs;
            }
        }
        return null;
    }

    /**
     * Select the best-matching profile file in a profiles directory based on record info + profile regex constraints.
     *
     * @param {string} profilesDir
     * @param {RecordInfo | null} record
     * @param {string[]} providesIds
     * @param {string | null} profileHint
     * @returns {string | null}
     * @private
     */
    static _selectBestProfileFile(
        profilesDir,
        record,
        providesIds,
        profileHint
    ) {
        // 1) Explicit hint
        if (profileHint) {
            const hinted = Repository._resolveProfileHint(
                profilesDir,
                profileHint
            );
            if (hinted) {
                return hinted;
            }
        }

        // 2) Identity-based hint (provides id)
        if (providesIds && providesIds.length > 0) {
            for (let pi = 0, piLen = providesIds.length; pi < piLen; pi++) {
                const id = providesIds[pi];
                const candidateA = resolve(profilesDir, `${id}.profile.yaml`);
                if (existsSync(candidateA)) {
                    return candidateA;
                }
                const candidateB = resolve(profilesDir, `${id}.profile.yml`);
                if (existsSync(candidateB)) {
                    return candidateB;
                }
                const candidateC = resolve(profilesDir, `${id}.profiles.yaml`);
                if (existsSync(candidateC)) {
                    return candidateC;
                }
                const candidateD = resolve(profilesDir, `${id}.profiles.yml`);
                if (existsSync(candidateD)) {
                    return candidateD;
                }
            }
        }

        // 3) Regex/constraint-based selection
        /** @type {{ abs: string, score: number }[]} */
        const scored = [];

        /** @type {string[]} */
        const recordFileNames = [];
        let recordDirName = record?.dir_name || null;
        let recordSeriesCode = record?.metafile?.getSeriesCode() || null;
        if (!recordSeriesCode && typeof record?.record_id === "string") {
            const m = record.record_id.match(/^([A-Z]{2,5})-/);
            recordSeriesCode = m ? m[1] : null;
        }
        if (record && record.abs_path && existsSync(record.abs_path)) {
            let entries;
            try {
                entries = readdirSync(record.abs_path, { withFileTypes: true });
            } catch {
                entries = [];
            }
            for (let i = 0, len = entries.length; i < len; i++) {
                const e = entries[i];
                if (e && e.isFile && e.isFile()) {
                    recordFileNames.push(e.name);
                }
            }
        }

        let entries;
        try {
            entries = readdirSync(profilesDir, { withFileTypes: true });
        } catch {
            return null;
        }

        for (let i = 0, len = entries.length; i < len; i++) {
            const e = entries[i];
            if (!e.isFile()) {
                continue;
            }
            if (
                !e.name.endsWith(".profile.yaml") &&
                !e.name.endsWith(".profile.yml") &&
                !e.name.endsWith(".profiles.yaml") &&
                !e.name.endsWith(".profiles.yml")
            ) {
                continue;
            }

            const abs = resolve(profilesDir, e.name);
            const profile = Profile.loadIfExists(abs);
            if (!profile) {
                continue;
            }

            const buckets = profile.getBuckets("");
            let best = -1;
            for (let b = 0, bLen = buckets.length; b < bLen; b++) {
                const c = buckets[b]?.constraints || {};

                const hasSignal =
                    typeof c.require_series_code === "string" ||
                    typeof c.require_record_directory_regex === "string" ||
                    typeof c.require_file_name_regex === "string";
                if (!hasSignal) {
                    continue;
                }

                // Selection constraints: treat series_code as hard; treat regexes as scoring hints.
                if (typeof c.require_series_code === "string") {
                    if (
                        !recordSeriesCode ||
                        c.require_series_code !== recordSeriesCode
                    ) {
                        continue;
                    }
                }

                let dirRegexMatches = false;
                if (
                    typeof c.require_record_directory_regex === "string" &&
                    recordDirName
                ) {
                    try {
                        const re = new RegExp(c.require_record_directory_regex);
                        dirRegexMatches = re.test(recordDirName);
                    } catch {
                        dirRegexMatches = false;
                    }
                }

                let fileRegexMatches = false;
                if (
                    typeof c.require_file_name_regex === "string" &&
                    recordFileNames.length > 0
                ) {
                    try {
                        const re = new RegExp(c.require_file_name_regex);
                        for (
                            let f = 0, fLen = recordFileNames.length;
                            f < fLen;
                            f++
                        ) {
                            if (re.test(recordFileNames[f])) {
                                fileRegexMatches = true;
                                break;
                            }
                        }
                    } catch {
                        fileRegexMatches = false;
                    }
                }

                // Score
                let score = 0;
                if (typeof c.require_series_code === "string") {
                    score += 100;
                }
                if (
                    typeof c.require_record_directory_regex === "string" &&
                    dirRegexMatches
                ) {
                    score += 50;
                }
                if (
                    typeof c.require_file_name_regex === "string" &&
                    fileRegexMatches
                ) {
                    score += 25;
                }
                // Small tie-breakers: pack intent
                const packPaths = profile.getPackPaths();
                for (let p = 0, pLen = packPaths.length; p < pLen; p++) {
                    if (
                        typeof packPaths[p] === "string" &&
                        packPaths[p].includes("template-agreements")
                    ) {
                        score += 5;
                    }
                }

                if (score > best) {
                    best = score;
                }
            }

            if (best >= 0) {
                scored.push({ abs, score: best });
            }
        }

        if (scored.length === 0) {
            return null;
        }

        scored.sort((a, b) => b.score - a.score || a.abs.localeCompare(b.abs));
        return scored[0].abs;
    }

    /**
     * Parse SCHEMA_UPSTREAM.yaml for all config paths.
     *
     * Supports two formats:
     *
     * Format A (flat — direct config):
     *   profile: path/to/profile.yaml
     *   registry: path/to/registry.yaml
     *   formatting_packs: [path1, path2]
     *   render_packs: [path1, path2]
     *
     * Format B (nested — upstream declaration with optional local overrides):
     *   record_schema:
     *     upstreams: [...]
     *     profile: path/to/profile.yaml
     *     registry: path/to/registry.yaml
     *     formatting_packs: [...]
     *     render_packs: [...]
     *
     * Top-level keys (Format A) take precedence; Format B keys under
     * `record_schema` are used as fallback.
     *
     * @param {string} root_dir
     * @param {string} upstream_path
     * @returns {UpstreamConfig}
     * @private
     */
    static _parseUpstreamConfig(root_dir, upstream_path) {
        /** @type {UpstreamConfig} */
        const out = {
            profile_path: null,
            profile_hint: null,
            registry_path: null,
            upstream_path: null,
            pack_paths: [],
            render_pack_paths: [],
            provides_ids: []
        };

        /** @type {Metadata | null} */
        let data = null;
        try {
            const content = readFileSync(upstream_path, "utf8");
            data = /** @type {Metadata} */ (
                parseYaml(content, { filename: upstream_path })
            );
        } catch {
            return out;
        }

        if (!data || typeof data !== "object") {
            return out;
        }

        // Determine effective config source: prefer `record_schema` (snake_case), fall back to legacy `record_schema` (camelCase)
        /** @type {Metadata} */
        const rs =
            data.record_schema &&
            typeof data.record_schema === "object" &&
            !Array.isArray(data.record_schema)
                ? /** @type {Metadata} */ (data.record_schema)
                : data.recordSchema &&
                  typeof data.recordSchema === "object" &&
                  !Array.isArray(data.recordSchema)
                ? /** @type {Metadata} */ (data.recordSchema)
                : {};

        // Extract provides ids (e.g. "dao-proposals") for identity-based resolution
        const provides = rs.provides || data.provides;
        if (Array.isArray(provides)) {
            for (let i = 0, len = provides.length; i < len; i++) {
                const p = provides[i];
                if (
                    p &&
                    typeof p === "object" &&
                    typeof p.id === "string" &&
                    p.id.length > 0
                ) {
                    out.provides_ids.push(p.id);
                }
            }
        }

        /**
         * Resolve a key from data (top-level) falling back to rs (nested).
         * @param {string} key
         * @returns {unknown}
         */
        const get = (key) => {
            if (data[key] !== undefined) {
                return data[key];
            }
            return rs[key];
        };

        // Profile (prefer explicit path; otherwise hint)
        const profilePathVal = get("profile_path");
        if (typeof profilePathVal === "string") {
            const abs = resolve(root_dir, profilePathVal);
            if (existsSync(abs)) {
                out.profile_path = abs;
            }
        }

        const profileHintVal = get("profile_hint");
        if (typeof profileHintVal === "string" && profileHintVal.length > 0) {
            out.profile_hint = profileHintVal;
        }

        const profileVal = get("profile");
        if (typeof profileVal === "string" && !out.profile_path) {
            // If profile resolves to an existing file relative to the repo root, treat as an explicit profile path.
            // Otherwise treat it as a profile hint (name/slug) to be resolved from toolkit fallback profiles.
            const abs = resolve(root_dir, profileVal);
            if (existsSync(abs)) {
                out.profile_path = abs;
            } else if (!out.profile_hint) {
                out.profile_hint = profileVal;
            }
        }

        // Fallback: find *.profile.yaml in root_dir
        if (!out.profile_path) {
            out.profile_path = Repository._findProfileFile(root_dir);
        }

        // Registry — string or array of strings (prefer explicit registry_path)
        const registryPathVal = get("registry_path");
        const registryVal = get("registry");

        const resolveRegistry = (val) => {
            if (typeof val === "string") {
                const abs = resolve(root_dir, val);
                if (existsSync(abs)) {
                    out.registry_path = abs;
                    return true;
                }
            } else if (Array.isArray(val)) {
                for (let i = 0, len = val.length; i < len; i++) {
                    const p = val[i];
                    if (typeof p === "string") {
                        const abs = resolve(root_dir, p);
                        if (existsSync(abs)) {
                            out.registry_path = abs;
                            return true;
                        }
                    }
                }
            }
            return false;
        };

        if (!resolveRegistry(registryPathVal)) {
            resolveRegistry(registryVal);
        }

        // Formatting packs
        const fmtPacks =
            get("formatting_packs") || get("packs") || get("formattingPacks");
        if (Array.isArray(fmtPacks)) {
            for (let i = 0, len = fmtPacks.length; i < len; i++) {
                const p = fmtPacks[i];
                if (typeof p === "string") {
                    const abs = resolve(root_dir, p);
                    if (existsSync(abs)) {
                        out.pack_paths.push(p);
                    }
                }
            }
        } else if (typeof fmtPacks === "string") {
            const abs = resolve(root_dir, fmtPacks);
            if (existsSync(abs)) {
                out.pack_paths.push(fmtPacks);
            }
        }

        // Render packs
        const rndPacks = get("render_packs") || get("renderPacks");
        if (Array.isArray(rndPacks)) {
            for (let i = 0, len = rndPacks.length; i < len; i++) {
                const p = rndPacks[i];
                if (typeof p === "string") {
                    const abs = resolve(root_dir, p);
                    if (existsSync(abs)) {
                        out.render_pack_paths.push(p);
                    }
                }
            }
        } else if (typeof rndPacks === "string") {
            const abs = resolve(root_dir, rndPacks);
            if (existsSync(abs)) {
                out.render_pack_paths.push(rndPacks);
            }
        }

        return out;
    }

    /**
     * Discover registry and pack paths by convention (well-known filenames).
     * Used when no SCHEMA_UPSTREAM.yaml is present.
     *
     * @param {string} root_dir
     * @param {RepositoryDiscoveryResult} result - Mutated in place
     * @param {((msg: string) => void)} [trace] - Verbose trace function
     * @private
     */
    static _discoverByConvention(root_dir, result, trace) {
        const _trace = trace || (() => {});
        _trace(`  convention scan in: ${root_dir}`);

        // Registry: look for well-known filenames
        if (!result.registry_path) {
            for (let i = 0, len = REGISTRY_FILENAMES.length; i < len; i++) {
                const abs = resolve(root_dir, REGISTRY_FILENAMES[i]);
                if (existsSync(abs)) {
                    result.registry_path = abs;
                    _trace(`  found registry: ${REGISTRY_FILENAMES[i]}`);
                    break;
                }
            }
            if (!result.registry_path) {
                _trace(
                    `  no registry found (checked: ${REGISTRY_FILENAMES.join(
                        ", "
                    )})`
                );
            }
        }

        // Packs: scan for *.pack.json in root or a packs/ subdirectory
        if (
            result.pack_paths.length === 0 &&
            result.render_pack_paths.length === 0
        ) {
            const candidates = Repository._findPackFiles(root_dir);
            _trace(`  pack file candidates: ${candidates.length} found`);
            for (let i = 0, len = candidates.length; i < len; i++) {
                const c = candidates[i];
                _trace(`    candidate: ${c.name} (${c.abs_path})`);
                if (
                    c.name.includes("formatting") ||
                    c.name.includes("format")
                ) {
                    result.pack_paths.push(
                        Repository._relPosix(root_dir, c.abs_path)
                    );
                    _trace(`      → formatting pack`);
                } else if (c.name.includes("render")) {
                    result.render_pack_paths.push(
                        Repository._relPosix(root_dir, c.abs_path)
                    );
                    _trace(`      → render pack (name match)`);
                } else {
                    // Ambiguous pack — try to determine type from content
                    try {
                        const text = readFileSync(c.abs_path, "utf8");
                        if (text.includes("record-schema-render-pack")) {
                            result.render_pack_paths.push(
                                Repository._relPosix(root_dir, c.abs_path)
                            );
                            _trace(`      → render pack (schema match)`);
                        } else if (
                            text.includes("record-schema-formatting-pack")
                        ) {
                            result.pack_paths.push(
                                Repository._relPosix(root_dir, c.abs_path)
                            );
                            _trace(`      → formatting pack (schema match)`);
                        } else {
                            _trace(`      → unknown pack type, skipped`);
                        }
                    } catch {
                        _trace(`      → unreadable, skipped`);
                    }
                }
            }
        }
    }

    /**
     * Find pack JSON files in root dir and well-known subdirectories.
     * Matches:
     *   - *.pack.json (legacy convention)
     *   - *-v*.json in packs/, render/, render/packs/ subdirectories
     *
     * @param {string} root_dir
     * @returns {{ name: string, abs_path: string }[]}
     * @private
     */
    static _findPackFiles(root_dir) {
        /** @type {{ name: string, abs_path: string }[]} */
        const found = [];
        /** @type {Set<string>} */
        const seen = new Set();
        /** @type {string[]} */
        const searchDirs = [root_dir];

        // Well-known pack subdirectories
        const packSubdirs = ["packs", "render", "render/packs"];
        for (let d = 0, dLen = packSubdirs.length; d < dLen; d++) {
            const sub = resolve(root_dir, packSubdirs[d]);
            if (existsSync(sub)) {
                searchDirs.push(sub);
            }
        }

        for (let d = 0, dLen = searchDirs.length; d < dLen; d++) {
            let entries;
            try {
                entries = readdirSync(searchDirs[d], { withFileTypes: true });
            } catch {
                continue;
            }
            for (let i = 0, len = entries.length; i < len; i++) {
                const e = entries[i];
                if (!e.isFile()) {
                    continue;
                }
                const abs = resolve(searchDirs[d], e.name);
                if (seen.has(abs)) {
                    continue;
                }

                // Match *.pack.json (legacy) or *-v*.json (versioned pack convention)
                if (
                    e.name.endsWith(".pack.json") ||
                    (e.name.endsWith(".json") && /-v\d/.test(e.name))
                ) {
                    seen.add(abs);
                    found.push({
                        name: e.name,
                        abs_path: abs
                    });
                }
            }
        }

        return found;
    }

    /**
     * Hydrate a Repository instance from a discovery result.
     * Loads profile, registry, formatting packs, and render packs.
     *
     * If discovery yields no packs/profile/registry, falls back to scanning
     * the toolkit's bundled schema directory (record-schema sibling repo).
     *
     * @param {Repository} repo
     * @param {RepositoryDiscoveryResult} discovery
     * @param {boolean} [verbose=false]
     * @private
     */
    static _hydrateFromDiscovery(repo, discovery, verbose = false) {
        const trace = (/** @type {string} */ msg) => {
            if (verbose) {
                console.log(`[VERBOSE] ${msg}`);
            }
        };

        trace(`=== Hydration ===`);

        // Resolve toolkit's bundled schema directory for fallback
        const toolkitDir = repo.getToolkitDir();
        // record-schema-toolkit typically has a sibling record-schema repo
        // or ships schema assets directly. Check well-known relative paths.
        /** @type {string[]} */
        const schemaSearchDirs = [];

        // Sibling repo: ../record-schema (relative to toolkit)
        const siblingSchema = resolve(toolkitDir, "../record-schema");
        if (existsSync(siblingSchema)) {
            schemaSearchDirs.push(siblingSchema);
        }
        // Bundled: toolkit itself might contain render/ or packs/
        schemaSearchDirs.push(toolkitDir);

        if (verbose && schemaSearchDirs.length > 0) {
            trace(
                `toolkit fallback search dirs: ${schemaSearchDirs.join(", ")}`
            );
        }

        // Identity ids from upstream provides — used to match profiles and packs
        const providesIds = discovery.provides_ids || [];
        if (providesIds.length > 0) {
            trace(`provides identity: ${providesIds.join(", ")}`);
        }

        // 1. Profile
        if (discovery.profile_path) {
            const profile = Profile.loadIfExists(discovery.profile_path);
            if (profile) {
                repo.setProfile(profile);
                trace(`hydrate: loaded profile from ${discovery.profile_path}`);
            } else {
                trace(
                    `hydrate: profile path exists but failed to load: ${discovery.profile_path}`
                );
            }
        } else {
            // Fallback: scan schema dirs for profile
            // If we have a provides id, prefer {id}.profile.yaml
            let found = false;
            const profileHint = discovery.profile_hint || null;
            for (let d = 0, dLen = schemaSearchDirs.length; d < dLen; d++) {
                const profilesDir = resolve(schemaSearchDirs[d], "profiles");
                if (!existsSync(profilesDir)) {
                    continue;
                }

                // Try to select the best profile using (1) explicit upstream hint,
                // (2) provides identity, then (3) record meta + regex constraints.
                const selected = Repository._selectBestProfileFile(
                    profilesDir,
                    discovery.target_record,
                    providesIds,
                    profileHint
                );
                if (selected) {
                    const profile = Profile.loadIfExists(selected);
                    if (profile) {
                        repo.setProfile(profile);
                        trace(
                            `hydrate: loaded profile from toolkit fallback: ${selected}`
                        );
                        found = true;
                    }
                }

                if (found) {
                    break;
                }
            }
            if (!found) {
                trace(`hydrate: no profile path (including toolkit fallback)`);
            }
        }

        // 2. Target record
        if (discovery.target_record) {
            repo._target_record = discovery.target_record;
        }

        // 3. Registry
        if (discovery.registry_path) {
            const rel_path = Repository._relPosix(
                repo.root_dir,
                discovery.registry_path
            );
            repo.loadRegistry(rel_path);
            trace(`hydrate: loaded registry from ${rel_path}`);
        } else {
            // Fallback: scan schema dirs for registry
            let found = false;
            for (let d = 0, dLen = schemaSearchDirs.length; d < dLen; d++) {
                const registryDir = resolve(schemaSearchDirs[d], "registry");
                if (!existsSync(registryDir)) {
                    continue;
                }
                for (
                    let r = 0, rLen = REGISTRY_FILENAMES.length;
                    r < rLen;
                    r++
                ) {
                    const abs = resolve(registryDir, REGISTRY_FILENAMES[r]);
                    if (existsSync(abs)) {
                        repo._registry = Registry.loadIfExists(abs);
                        if (repo._registry) {
                            trace(
                                `hydrate: loaded registry from toolkit fallback: ${abs}`
                            );
                            found = true;
                            break;
                        }
                    }
                }
                // Also check root of schema dir
                if (!found) {
                    for (
                        let r = 0, rLen = REGISTRY_FILENAMES.length;
                        r < rLen;
                        r++
                    ) {
                        const abs = resolve(
                            schemaSearchDirs[d],
                            REGISTRY_FILENAMES[r]
                        );
                        if (existsSync(abs)) {
                            repo._registry = Registry.loadIfExists(abs);
                            if (repo._registry) {
                                trace(
                                    `hydrate: loaded registry from toolkit fallback: ${abs}`
                                );
                                found = true;
                                break;
                            }
                        }
                    }
                }
                if (found) {
                    break;
                }
            }
            if (!found) {
                trace(`hydrate: no registry path (including toolkit fallback)`);
            }
        }

        // 4. Formatting packs
        if (discovery.pack_paths.length > 0) {
            repo.loadPacks(discovery.pack_paths);
            trace(
                `hydrate: loaded ${
                    discovery.pack_paths.length
                } formatting packs: ${discovery.pack_paths.join(", ")}`
            );
        } else {
            trace(`hydrate: no formatting packs`);
        }

        // 5. Render packs
        if (discovery.render_pack_paths.length > 0) {
            repo.loadRenderPacks(discovery.render_pack_paths);
            trace(
                `hydrate: loaded ${
                    discovery.render_pack_paths.length
                } render packs: ${discovery.render_pack_paths.join(", ")}`
            );
        } else {
            // Fallback: scan schema dirs for render packs.
            // If we have provides ids, only load packs that match the identity
            // (e.g. "dao-proposals" → "dao-proposals-v1.json") plus their imports.
            /** @type {{ abs_path: string, schemaDir: string }[]} */
            const fallbackRenderPacks = [];
            /** @type {Set<string>} */
            const seenPackNames = new Set();

            /**
             * Check if a pack filename matches any of the provides ids.
             * Matches: {id}-v*.json (e.g. "dao-proposals-v1.json" matches id "dao-proposals")
             * @param {string} fileName
             * @returns {boolean}
             */
            const matchesProvidesId = (fileName) => {
                for (let pi = 0, piLen = providesIds.length; pi < piLen; pi++) {
                    if (
                        fileName.startsWith(providesIds[pi] + "-v") &&
                        fileName.endsWith(".json")
                    ) {
                        return true;
                    }
                }
                return false;
            };

            // First pass: find identity-matched packs
            /** @type {Set<string>} */
            const identityMatchedPacks = new Set();
            if (providesIds.length > 0) {
                for (let d = 0, dLen = schemaSearchDirs.length; d < dLen; d++) {
                    const candidates = Repository._findPackFiles(
                        schemaSearchDirs[d]
                    );
                    for (let c = 0, cLen = candidates.length; c < cLen; c++) {
                        const packName = basename(candidates[c].abs_path);
                        if (matchesProvidesId(packName)) {
                            identityMatchedPacks.add(candidates[c].abs_path);
                            // Also read the pack to discover its imports
                            try {
                                const text = readFileSync(
                                    candidates[c].abs_path,
                                    "utf8"
                                );
                                const parsed = JSON.parse(text);
                                if (Array.isArray(parsed.imports)) {
                                    for (
                                        let ii = 0,
                                            iiLen = parsed.imports.length;
                                        ii < iiLen;
                                        ii++
                                    ) {
                                        const imp = parsed.imports[ii];
                                        if (typeof imp === "string") {
                                            const impAbs = resolve(
                                                schemaSearchDirs[d],
                                                imp
                                            );
                                            identityMatchedPacks.add(impAbs);
                                        }
                                    }
                                }
                            } catch {
                                // best-effort import resolution
                            }
                        }
                    }
                }
                trace(
                    `hydrate: identity-matched packs (${providesIds.join(
                        ","
                    )}): ${
                        identityMatchedPacks.size > 0
                            ? [...identityMatchedPacks]
                                  .map((p) => basename(p))
                                  .join(", ")
                            : "(none)"
                    }`
                );
            }

            const hasIdentityFilter =
                providesIds.length > 0 && identityMatchedPacks.size > 0;

            for (let d = 0, dLen = schemaSearchDirs.length; d < dLen; d++) {
                const candidates = Repository._findPackFiles(
                    schemaSearchDirs[d]
                );
                for (let c = 0, cLen = candidates.length; c < cLen; c++) {
                    const packName = basename(candidates[c].abs_path);
                    if (seenPackNames.has(packName)) {
                        trace(
                            `hydrate: skipping duplicate render pack: ${candidates[c].abs_path} (already have ${packName})`
                        );
                        continue;
                    }

                    // If we have identity matches, only load those (plus their imports)
                    if (
                        hasIdentityFilter &&
                        !identityMatchedPacks.has(candidates[c].abs_path)
                    ) {
                        trace(
                            `hydrate: skipping non-matching render pack: ${packName} (not in identity set)`
                        );
                        continue;
                    }

                    try {
                        const text = readFileSync(
                            candidates[c].abs_path,
                            "utf8"
                        );
                        if (text.includes("record-schema-render-pack")) {
                            seenPackNames.add(packName);
                            fallbackRenderPacks.push({
                                abs_path: candidates[c].abs_path,
                                schemaDir: schemaSearchDirs[d]
                            });
                            trace(
                                `hydrate: found render pack in toolkit fallback: ${candidates[c].abs_path}`
                            );
                        }
                    } catch {
                        // skip unreadable
                    }
                }
            }
            if (fallbackRenderPacks.length > 0) {
                // Resolve imports relative to the schema dir where the packs were found.
                // Packs may have imports like "render/packs/base-v1.json" relative to schema root.
                // Find the schema root that contains these packs.
                const schemaRoot = fallbackRenderPacks[0].schemaDir;
                const rel_paths = fallbackRenderPacks.map((p) =>
                    Repository._relPosix(schemaRoot, p.abs_path)
                );
                const result = RenderPack.loadMerged(schemaRoot, rel_paths);
                repo._render_policy = result.policy;
                if (result.packet_config) {
                    repo._packet_config = result.packet_config;
                }
                trace(
                    `hydrate: loaded ${fallbackRenderPacks.length} render packs from toolkit fallback (root=${schemaRoot})`
                );
            } else {
                trace(`hydrate: no render packs (including toolkit fallback)`);
            }
        }
    }

    /**
     * Check if directory looks like a repo root
     * @param {string} dir
     * @returns {boolean}
     * @private
     */
    static _isLikelyRepoRoot(dir) {
        const indicators = [
            ".git",
            "package.json",
            "yarn.lock",
            "pnpm-lock.yaml",
            ".gitignore"
        ];

        for (let i = 0, len = indicators.length; i < len; i++) {
            if (existsSync(resolve(dir, indicators[i]))) {
                return true;
            }
        }

        return false;
    }

    // =========================================================================
    // Toolkit / Schema Loading
    // =========================================================================

    /**
     * Get toolkit directory (where schemas live)
     * @returns {string}
     */
    getToolkitDir() {
        if (this._toolkit_dir) {
            return this._toolkit_dir;
        }
        // Default to two levels up from this file
        this._toolkit_dir = resolve(
            dirname(fileURLToPath(import.meta.url)),
            "../.."
        );
        return this._toolkit_dir;
    }

    /**
     * Set toolkit directory
     * @param {string} dir
     */
    setToolkitDir(dir) {
        this._toolkit_dir = resolve(dir);
        // Clear cached schemas
        this._record_meta_schema = null;
        this._doc_meta_schema = null;
        this._profile_schema = null;
        this._registry_schema = null;
    }

    /**
     * Get record meta schema
     * @returns {Schema | null}
     */
    getRecordMetaSchema() {
        if (this._record_meta_schema) {
            return this._record_meta_schema;
        }
        const path = resolve(
            this.getToolkitDir(),
            "schema/record.meta.schema.json"
        );
        this._record_meta_schema = Schema.loadIfExists(path);
        return this._record_meta_schema;
    }

    /**
     * Get document metadata schema
     * @returns {Schema | null}
     */
    getDocMetaSchema() {
        if (this._doc_meta_schema) {
            return this._doc_meta_schema;
        }
        const path = resolve(
            this.getToolkitDir(),
            "schema/document.metadata.schema.json"
        );
        this._doc_meta_schema = Schema.loadIfExists(path);
        return this._doc_meta_schema;
    }

    /**
     * Get profile schema
     * @returns {Schema | null}
     */
    getProfileSchema() {
        if (this._profile_schema) {
            return this._profile_schema;
        }
        const path = resolve(
            this.getToolkitDir(),
            "schema/registry.profile.schema.json"
        );
        this._profile_schema = Schema.loadIfExists(path);
        return this._profile_schema;
    }

    /**
     * Get registry schema
     * @returns {Schema | null}
     */
    getRegistrySchema() {
        if (this._registry_schema) {
            return this._registry_schema;
        }
        const path = resolve(
            this.getToolkitDir(),
            "schema/registry.schema.json"
        );
        this._registry_schema = Schema.loadIfExists(path);
        return this._registry_schema;
    }

    // =========================================================================
    // Profile Loading
    // =========================================================================

    /**
     * Load profile from repository
     * @param {string} rel_path
     * @returns {Profile | null}
     */
    loadProfile(rel_path) {
        this._profile = Profile.loadFromRoot(this.root_dir, rel_path);
        return this._profile;
    }

    /**
     * Get loaded profile
     * @returns {Profile | null}
     */
    getProfile() {
        return this._profile;
    }

    /**
     * Set profile
     * @param {Profile} profile
     */
    setProfile(profile) {
        this._profile = profile;
    }

    // =========================================================================
    // Registry Loading
    // =========================================================================

    /**
     * Load registry from repository
     * @param {string} rel_path
     * @returns {Registry | null}
     */
    loadRegistry(rel_path) {
        const abs_path = resolve(this.root_dir, rel_path);
        this._registry = Registry.loadIfExists(abs_path);
        return this._registry;
    }

    /**
     * Get loaded registry
     * @returns {Registry | null}
     */
    getRegistry() {
        return this._registry;
    }

    /**
     * Set registry
     * @param {Registry} registry
     */
    setRegistry(registry) {
        this._registry = registry;
    }

    // =========================================================================
    // Pack / Policy Loading
    // =========================================================================

    /**
     * Load packs and merge into policy
     * @param {string[]} packPaths
     * @returns {import("./FormattingPack.mjs").DocumentPolicy}
     */
    loadPacks(packPaths) {
        const result = FormattingPack.loadMerged(this.root_dir, packPaths);
        this._policy = result.policy;
        this._loaded_pack_paths = result.packs.map((p) => p.sourcePath || "");
        return this._policy;
    }

    /**
     * Get loaded policy
     * @returns {import("./FormattingPack.mjs").DocumentPolicy | null}
     */
    getPolicy() {
        return this._policy;
    }

    /**
     * Get loaded pack paths
     * @returns {string[]}
     */
    getLoadedPackPaths() {
        return this._loaded_pack_paths || [];
    }

    // =========================================================================
    // Render Pack / Render Policy Loading
    // =========================================================================

    /**
     * Load render packs and merge into render policy
     * @param {string[]} packPaths
     * @returns {RenderDocumentPolicy}
     */
    loadRenderPacks(packPaths) {
        const result = RenderPack.loadMerged(this.root_dir, packPaths);
        this._render_policy = result.policy;
        if (result.packet_config) {
            this._packet_config = result.packet_config;
        }
        return this._render_policy;
    }

    /**
     * Get loaded render policy
     * @returns {RenderDocumentPolicy | null}
     */
    getRenderPolicy() {
        return this._render_policy;
    }

    /**
     * Get packet config from render packs
     * @returns {Metadata | null}
     */
    getPacketConfig() {
        return this._packet_config;
    }

    // =========================================================================
    // Target Record (from discovery)
    // =========================================================================

    /**
     * Get target record if repository was opened from a record directory
     * @returns {RecordInfo | null}
     */
    getTargetRecord() {
        return this._target_record;
    }

    /**
     * Check if repository was opened from within a record directory
     * @returns {boolean}
     */
    hasTargetRecord() {
        return this._target_record !== null;
    }

    // =========================================================================
    // Record Discovery
    // =========================================================================

    /**
     * Find all record directories
     * @param {(record: RecordInfo) => boolean} [predicate] - Optional filter function
     * @returns {RecordInfo[]}
     */
    findRecords(predicate) {
        const profile = this._profile || Profile.empty();
        const buckets = profile.getBuckets(this.root_dir);
        const dirRegex = profile.getDirectoryRegex();

        /** @type {RecordInfo[]} */
        const records = [];
        let re;
        try {
            re = new RegExp(dirRegex);
        } catch {
            re = /^[A-Z]{2,5}-\d{5}-[a-z0-9]+(?:-[a-z0-9]+)*$/;
        }

        for (let i = 0, len = buckets.length; i < len; i++) {
            const b = buckets[i];
            const bucketAbs = resolve(this.root_dir, b.path);
            if (!existsSync(bucketAbs)) {
                continue;
            }

            const dirs = this._findRecordDirs(bucketAbs, re);
            for (let j = 0, jLen = dirs.length; j < jLen; j++) {
                const d = dirs[j];
                const record_id = Metafile.dirNameToRecordId(d.dir_name);
                if (!record_id) {
                    continue;
                }
                const metafile = Metafile.loadFromRecord(d.abs_path, record_id);

                const record = {
                    record_id,
                    dir_name: d.dir_name,
                    abs_path: d.abs_path,
                    rel_path: Repository._relPosix(this.root_dir, d.abs_path),
                    bucket: b.bucket,
                    metafile
                };

                // Apply filter if provided
                if (predicate && !predicate(record)) {
                    continue;
                }

                records.push(record);
            }
        }

        return records;
    }

    /**
     * Find records, including target record if started from record directory
     * This is the preferred method when using openWithDiscovery()
     * @param {(record: RecordInfo) => boolean} [predicate] - Optional filter function
     * @returns {RecordInfo[]}
     */
    findRecordsWithTarget(predicate) {
        // If we have a target record from discovery, prioritize that
        if (this._target_record) {
            // Apply predicate if provided
            if (predicate && !predicate(this._target_record)) {
                return [];
            }
            return [this._target_record];
        }

        // Otherwise fall back to normal discovery
        return this.findRecords(predicate);
    }

    /**
     * Get a specific record by ID
     * @param {string} record_id
     * @returns {RecordInfo | null}
     */
    getRecord(record_id) {
        const records = this.findRecords();
        for (let i = 0, len = records.length; i < len; i++) {
            if (records[i].record_id === record_id) {
                return records[i];
            }
        }
        return null;
    }

    // =========================================================================
    // Document Discovery
    // =========================================================================

    /**
     * Find all documents in a record
     * @param {RecordInfo} record
     * @param {(doc: Document) => boolean} [predicate] - Optional filter function
     * @returns {Document[]}
     */
    findDocumentsInRecord(record, predicate) {
        /** @type {Document[]} */
        const documents = [];
        let entries;
        try {
            entries = readdirSync(record.abs_path, { withFileTypes: true });
        } catch {
            return documents;
        }

        for (let i = 0, len = entries.length; i < len; i++) {
            const e = entries[i];
            if (!e.isFile()) {
                continue;
            }
            if (e.name.startsWith(".")) {
                continue;
            }
            const abs = resolve(record.abs_path, e.name);
            const doc = Document.load(abs);

            // Apply filter if provided
            if (predicate && !predicate(doc)) {
                continue;
            }

            documents.push(doc);
        }

        return documents;
    }

    /**
     * Find root-level documents
     * @returns {Document[]}
     */
    findRootDocuments() {
        /** @type {Document[]} */
        const documents = [];
        let entries;
        try {
            entries = readdirSync(this.root_dir, { withFileTypes: true });
        } catch {
            return documents;
        }

        for (let i = 0, len = entries.length; i < len; i++) {
            const e = entries[i];
            if (!e.isFile()) {
                continue;
            }
            const name = e.name;
            if (
                name === "package.json" ||
                name.startsWith(".") ||
                name.endsWith(".lock")
            ) {
                continue;
            }
            const abs = resolve(this.root_dir, name);
            const doc = Document.load(abs);
            documents.push(doc);
        }

        return documents;
    }

    // =========================================================================
    // Path Utilities
    // =========================================================================

    /**
     * Resolve a relative path to absolute
     * @param {string} rel_path
     * @returns {string}
     */
    resolve(rel_path) {
        return resolve(this.root_dir, rel_path);
    }

    /**
     * Check if a path exists in the repository
     * @param {string} rel_path
     * @returns {boolean}
     */
    exists(rel_path) {
        return existsSync(resolve(this.root_dir, rel_path));
    }

    /**
     * Get relative posix path
     * @param {string} abs_path
     * @returns {string}
     */
    getRelativePath(abs_path) {
        return Repository._relPosix(this.root_dir, abs_path);
    }

    // =========================================================================
    // Validation
    // =========================================================================

    /**
     * Validate required root paths
     * @returns {ValidationIssue[]}
     */
    validateRequiredPaths() {
        /** @type {ValidationIssue[]} */
        const issues = [];
        if (!this._profile) {
            return issues;
        }

        const results = this._profile.checkRequiredPaths(this.root_dir);
        for (let i = 0, len = results.length; i < len; i++) {
            const r = results[i];
            if (!r.exists) {
                issues.push({
                    severity: "error",
                    code: "root.required_path.missing",
                    message: `Missing required path: ${r.path}`,
                    file: r.path
                });
            }
        }

        return issues;
    }

    /**
     * Validate profile against schema
     * @returns {ValidationIssue[]}
     */
    validateProfile() {
        /** @type {ValidationIssue[]} */
        const issues = [];
        if (!this._profile) {
            return issues;
        }

        const schema = this.getProfileSchema();
        if (!schema) {
            return issues;
        }

        const errors = this._profile.validate(schema);
        for (let i = 0, len = errors.length; i < len; i++) {
            issues.push({
                severity: "error",
                code: "profile.invalid",
                message: `${errors[i].path}: ${errors[i].message}`,
                file: this._profile.source_path || "registry.profile"
            });
        }

        return issues;
    }

    /**
     * Validate registry against schema
     * @param {string} registryPath
     * @returns {ValidationIssue[]}
     */
    validateRegistry(registryPath) {
        /** @type {ValidationIssue[]} */
        const issues = [];
        if (!this._registry) {
            return issues;
        }

        const schema = this.getRegistrySchema();
        if (!schema) {
            return issues;
        }

        const docs = this._registry.raw_documents;
        for (let di = 0; di < docs.length; di++) {
            const d = docs[di];
            if (!d || typeof d !== "object") {
                continue;
            }
            const errors = schema.validate(d);
            for (let ei = 0; ei < errors.length; ei++) {
                issues.push({
                    severity: "error",
                    code: "registry.schema",
                    message: `${errors[ei].path}: ${errors[ei].message}`,
                    file: `${registryPath}#doc${di + 1}`
                });
            }
        }

        return issues;
    }

    // =========================================================================
    // File Reading Utilities
    // =========================================================================

    /**
     * Read JSON file from repository
     * @param {string} rel_path
     * @returns {unknown}
     */
    readJson(rel_path) {
        return readJson(resolve(this.root_dir, rel_path));
    }

    /**
     * Read text file from repository
     * @param {string} rel_path
     * @returns {string}
     */
    readText(rel_path) {
        return readText(resolve(this.root_dir, rel_path));
    }

    /**
     * Write text file to repository
     * @param {string} rel_path
     * @param {string} content
     */
    writeText(rel_path, content) {
        writeText(resolve(this.root_dir, rel_path), content);
    }

    // =========================================================================
    // Private Methods
    // =========================================================================

    /**
     * Find record directories matching pattern
     * @param {string} baseDir
     * @param {RegExp} pattern
     * @returns {{ dir_name: string, abs_path: string }[]}
     * @private
     */
    _findRecordDirs(baseDir, pattern) {
        /** @type {{ dir_name: string, abs_path: string }[]} */
        const results = [];
        let entries;
        try {
            entries = readdirSync(baseDir, { withFileTypes: true });
        } catch {
            return results;
        }

        for (let i = 0, len = entries.length; i < len; i++) {
            const e = entries[i];
            if (!e.isDirectory()) {
                continue;
            }
            if (e.name.startsWith(".")) {
                continue;
            }
            if (pattern.test(e.name)) {
                results.push({
                    dir_name: e.name,
                    abs_path: resolve(baseDir, e.name)
                });
            }
        }

        return results;
    }

    /**
     * Get relative posix path
     * @param {string} from
     * @param {string} to
     * @returns {string}
     * @private
     */
    static _relPosix(from, to) {
        const fromParts = from
            .replace(/\\/g, "/")
            .split("/")
            .filter((p) => p.length > 0);
        const toParts = to
            .replace(/\\/g, "/")
            .split("/")
            .filter((p) => p.length > 0);

        let common = 0;
        for (
            let i = 0, len = Math.min(fromParts.length, toParts.length);
            i < len;
            i++
        ) {
            if (fromParts[i] !== toParts[i]) {
                break;
            }
            common++;
        }

        const upCount = fromParts.length - common;
        const ups = [];
        for (let i = 0; i < upCount; i++) {
            ups.push("..");
        }

        return [...ups, ...toParts.slice(common)].join("/");
    }
}
