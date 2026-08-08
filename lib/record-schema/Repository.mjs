/**
 * Repository class representing a project (github repo or local folder)
 * @module classes/Repository
 */

import {
    readFileSync,
    readdirSync,
    existsSync,
    writeFileSync,
    lstatSync,
    realpathSync
} from "node:fs";
import {
    resolve,
    dirname,
    basename,
    extname,
    relative,
    isAbsolute,
    sep
} from "node:path";
import { fileURLToPath } from "node:url";

import { Schema } from "./Schema.mjs";
import { Registry } from "./Registry.mjs";
import { Profile } from "./Profile.mjs";
import { LanguageRuleRegistry } from "./LanguageRuleRegistry.mjs";
import { FormattingPack } from "./FormattingPack.mjs";
import { RenderPack } from "./RenderPack.mjs";
import { Metafile } from "./Metafile.mjs";
import { Document } from "./Document.mjs";
import { parseYaml } from "../parsing/yaml.mjs";
import { readJson, readText, writeText } from "../util/files.mjs";
import { isString } from "../util/general.mjs";

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

        /** @type {string[]} */
        this._schema_material_roots = [];

        /** @type {Map<string, string>} */
        this._schema_reference_paths = new Map();

        /** @type {Set<string>} */
        this._indexed_schema_material_roots = new Set();

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

        /** @type {import("./RenderPack.mjs").RenderPack[] | null} */
        this._loaded_render_packs = null;

        /** @type {string[] | null} */
        this._loaded_render_pack_paths = null;

        /** @type {string[] | null} */
        this._loaded_render_pack_roots = null;

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
     * @param {string[]} [options.schemaMaterialRoots] - Additional schema-material roots
     * @returns {Repository}
     */
    static fromFolder(startDir, options = {}) {
        const {
            maxDepth = 10,
            verbose = false,
            schemaMaterialRoots = []
        } = options;
        const discovery = Repository.discoverRepository(startDir, {
            maxDepth,
            verbose
        });

        const repo = new Repository(discovery.root_dir);
        for (let i = 0, len = schemaMaterialRoots.length; i < len; i++) {
            repo.addSchemaMaterialRoot(schemaMaterialRoots[i]);
        }

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
            registry_paths: [],
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
                    `  upstream.registry_paths: ${
                        upstreamConfig.registry_paths &&
                        upstreamConfig.registry_paths.length > 0
                            ? upstreamConfig.registry_paths.join(", ")
                            : "(none)"
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
                if (
                    upstreamConfig.registry_paths &&
                    upstreamConfig.registry_paths.length > 0
                ) {
                    result.registry_paths = upstreamConfig.registry_paths;
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
                    (result.pack_paths.length === 0 &&
                        result.render_pack_paths.length === 0) ||
                    !result.registry_paths ||
                    result.registry_paths.length === 0
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
            `  registryPaths: ${
                result.registry_paths && result.registry_paths.length > 0
                    ? result.registry_paths.join(", ")
                    : "(none)"
            }`
        );
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
        const direct = Repository._findProfileFileInDirectory(dir);
        if (direct) {
            return direct;
        }

        const profilesDir = resolve(dir, "profiles");
        if (existsSync(profilesDir)) {
            return Repository._findProfileFileInDirectory(profilesDir);
        }

        return null;
    }

    /**
     * @param {string} dir
     * @returns {string | null}
     * @private
     */
    static _findProfileFileInDirectory(dir) {
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
     * Find registry YAML files in a repository root.
     * @param {string} dir
     * @returns {string[]}
     * @private
     */
    static _findRegistryFiles(dir) {
        /** @type {string[]} */
        const found = [];
        for (let i = 0, len = REGISTRY_FILENAMES.length; i < len; i++) {
            const abs = resolve(dir, REGISTRY_FILENAMES[i]);
            if (existsSync(abs)) {
                found.push(abs);
            }
        }

        const registryDir = resolve(dir, "registry");
        let entries;
        try {
            entries = readdirSync(registryDir, { withFileTypes: true });
        } catch {
            return found;
        }

        for (let i = 0, len = entries.length; i < len; i++) {
            const e = entries[i];
            if (!e.isFile()) {
                continue;
            }
            if (!e.name.endsWith(".yaml") && !e.name.endsWith(".yml")) {
                continue;
            }
            const abs = resolve(registryDir, e.name);
            if (!found.includes(abs)) {
                found.push(abs);
            }
        }

        found.sort((a, b) => {
            const aName = basename(a);
            const bName = basename(b);
            const aScore = aName.includes("registry") ? 0 : 1;
            const bScore = bName.includes("registry") ? 0 : 1;
            return aScore - bScore || aName.localeCompare(bName);
        });
        return found;
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
            /** @type {Array<{ name: string, isFile: () => boolean }>} */
            let entries = [];
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

        /** @type {Array<{ name: string, isFile: () => boolean }>} */
        let entries = [];
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
            registry_paths: [],
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

        /**
         * @param {unknown} val
         */
        const resolveRegistries = (val) => {
            if (typeof val === "string") {
                const abs = resolve(root_dir, val);
                if (existsSync(abs)) {
                    out.registry_paths.push(abs);
                }
            } else if (Array.isArray(val)) {
                for (let i = 0, len = val.length; i < len; i++) {
                    const p = val[i];
                    if (typeof p === "string") {
                        const abs = resolve(root_dir, p);
                        if (existsSync(abs)) {
                            out.registry_paths.push(abs);
                        }
                    }
                }
            }
        };

        resolveRegistries(registryPathVal);
        if (out.registry_paths.length === 0) {
            resolveRegistries(registryVal);
        }
        if (out.registry_paths.length > 0) {
            out.registry_path = out.registry_paths[0];
        }

        // Formatting packs (do NOT require existence under root_dir; may be schema-relative)
        const fmtPacks =
            get("formatting_packs") || get("packs") || get("formattingPacks");
        if (Array.isArray(fmtPacks)) {
            for (let i = 0, len = fmtPacks.length; i < len; i++) {
                const p = fmtPacks[i];
                if (typeof p === "string") {
                    /*const abs = resolve(root_dir, p);
                    if (existsSync(abs)) {
                        out.pack_paths.push(p);
                    }*/

                    out.pack_paths.push(p);
                }
            }
        } else if (typeof fmtPacks === "string") {
            /*const abs = resolve(root_dir, fmtPacks);
            if (existsSync(abs)) {
                out.pack_paths.push(fmtPacks);
            }*/
            out.pack_paths.push(fmtPacks);
        }

        // Render packs (do NOT require existence under root_dir; may be schema-relative)
        const rndPacks = get("render_packs") || get("renderPacks");
        if (Array.isArray(rndPacks)) {
            for (let i = 0, len = rndPacks.length; i < len; i++) {
                const p = rndPacks[i];
                if (typeof p === "string") {
                    /*const abs = resolve(root_dir, p);
                    if (existsSync(abs)) {
                        out.render_pack_paths.push(p);
                    }*/

                    out.render_pack_paths.push(p);
                }
            }
        } else if (typeof rndPacks === "string") {
            /*const abs = resolve(root_dir, rndPacks);
            if (existsSync(abs)) {
                out.render_pack_paths.push(rndPacks);
            }*/

            out.render_pack_paths.push(rndPacks);
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

        // Registry: look for well-known filenames and registry/*.yaml files
        if (
            !result.registry_path &&
            (!result.registry_paths || result.registry_paths.length === 0)
        ) {
            const registryPaths = Repository._findRegistryFiles(root_dir);
            if (registryPaths.length > 0) {
                result.registry_paths = registryPaths;
                result.registry_path = registryPaths[0];
                _trace(`  found registry files: ${registryPaths.length}`);
            } else {
                _trace(
                    `  no registry found (checked: ${REGISTRY_FILENAMES.join(
                        ", "
                    )} and registry/*.yaml)`
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
        const packSubdirs = [
            "packs",
            "render",
            "render/packs",
            "formatting",
            "formatting/packs"
        ];
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

        // Resolve explicitly configured and bundled schema roots for fallback.
        const schemaMaterialRoots = repo.getSchemaMaterialRoots();
        /** @type {string[]} */
        const schemaSearchDirs = [];
        for (let i = 0, len = schemaMaterialRoots.length; i < len; i++) {
            if (schemaMaterialRoots[i] !== repo.root_dir) {
                schemaSearchDirs.push(schemaMaterialRoots[i]);
            }
        }

        if (verbose && schemaSearchDirs.length > 0) {
            trace(
                `schema-material fallback search dirs: ${schemaSearchDirs.join(
                    ", "
                )}`
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
                            `hydrate: loaded profile from schema-material fallback: ${selected}`
                        );
                        found = true;
                    }
                }

                if (found) {
                    break;
                }
            }
            if (!found) {
                trace(
                    `hydrate: no profile path (including schema-material fallback)`
                );
            }
        }

        // 2. Target record
        if (discovery.target_record) {
            repo._target_record = discovery.target_record;
        }

        // 3. Registry
        if (discovery.registry_paths && discovery.registry_paths.length > 0) {
            repo.loadRegistryFiles(discovery.registry_paths);
            trace(
                `hydrate: loaded merged registry from ${discovery.registry_paths.length} file(s)`
            );
        } else if (discovery.registry_path) {
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
                                `hydrate: loaded registry from schema-material fallback: ${abs}`
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
                                    `hydrate: loaded registry from schema-material fallback: ${abs}`
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
                trace(
                    `hydrate: no registry path (including schema-material fallback)`
                );
            }
        }

        // 4. Formatting packs (try repo root, then toolkit schema roots)
        if (discovery.pack_paths.length > 0) {
            let loaded = false;
            const roots = [repo.root_dir].concat(schemaSearchDirs);
            for (let r = 0, rLen = roots.length; r < rLen; r++) {
                const root = roots[r];
                let ok = true;
                for (
                    let i = 0, len = discovery.pack_paths.length;
                    i < len;
                    i++
                ) {
                    if (!existsSync(resolve(root, discovery.pack_paths[i]))) {
                        ok = false;
                        break;
                    }
                }
                if (ok) {
                    const res = FormattingPack.loadMerged(
                        root,
                        discovery.pack_paths
                    );
                    repo._policy = res.policy;
                    repo._loaded_pack_paths = res.packs.map((p) => {
                        const pack = /** @type {{ sourcePath?: string }} */ (p);
                        return pack.sourcePath || "";
                    });
                    loaded = true;
                    break;
                }
            }
            trace(
                `hydrate: loaded ${
                    discovery.pack_paths.length
                } formatting packs: ${discovery.pack_paths.join(", ")}`
            );
        } else {
            // Fallback: scan schema dirs for formatting packs (same pattern as render pack fallback).
            /** @type {{ abs_path: string, schemaDir: string }[]} */
            const fallbackFmtPacks = [];
            /** @type {Set<string>} */
            const seenFmtPackNames = new Set();

            for (let d = 0, dLen = schemaSearchDirs.length; d < dLen; d++) {
                const candidates = Repository._findPackFiles(
                    schemaSearchDirs[d]
                );
                for (let c = 0, cLen = candidates.length; c < cLen; c++) {
                    const packName = basename(candidates[c].abs_path);
                    if (seenFmtPackNames.has(packName)) {
                        continue;
                    }
                    if (providesIds.length > 0) {
                        let identityMatched = false;
                        for (
                            let identityIndex = 0,
                                identityLength = providesIds.length;
                            identityIndex < identityLength;
                            identityIndex++
                        ) {
                            if (
                                packName.startsWith(
                                    `${providesIds[identityIndex]}-v`
                                )
                            ) {
                                identityMatched = true;
                                break;
                            }
                        }
                        if (!identityMatched) {
                            continue;
                        }
                    }
                    try {
                        const text = readFileSync(
                            candidates[c].abs_path,
                            "utf8"
                        );
                        if (text.includes("record-schema-formatting-pack")) {
                            seenFmtPackNames.add(packName);
                            fallbackFmtPacks.push({
                                abs_path: candidates[c].abs_path,
                                schemaDir: schemaSearchDirs[d]
                            });
                            trace(
                                `hydrate: found formatting pack in schema-material fallback: ${candidates[c].abs_path}`
                            );
                        }
                    } catch {
                        // skip unreadable
                    }
                }
            }

            if (fallbackFmtPacks.length > 0) {
                const schemaRoot = fallbackFmtPacks[0].schemaDir;
                const rel_paths = fallbackFmtPacks.map((p) =>
                    Repository._relPosix(schemaRoot, p.abs_path)
                );
                const res = FormattingPack.loadMerged(schemaRoot, rel_paths);
                repo._policy = res.policy;
                repo._loaded_pack_paths = res.packs.map((p) => {
                    const pack = /** @type {{ sourcePath?: string }} */ (p);
                    return pack.sourcePath || "";
                });
                trace(
                    `hydrate: loaded ${fallbackFmtPacks.length} formatting packs from schema-material fallback (root=${schemaRoot})`
                );
            } else {
                trace(
                    `hydrate: no formatting packs (including schema-material fallback)`
                );
            }
        }

        // 5. Render packs — resolve each declared path against the first root
        //    where it exists, then merge. This handles packs that span multiple
        //    roots (e.g. base packs in record-schema, custom packs in the repo).
        if (discovery.render_pack_paths.length > 0) {
            const roots = [repo.root_dir].concat(schemaSearchDirs);
            /** @type {string[]} */
            const resolved_abs = [];
            for (
                let i = 0, len = discovery.render_pack_paths.length;
                i < len;
                i++
            ) {
                const rel = discovery.render_pack_paths[i];
                for (let r = 0, rLen = roots.length; r < rLen; r++) {
                    const abs = resolve(roots[r], rel);
                    if (existsSync(abs)) {
                        resolved_abs.push(abs);
                        break;
                    }
                }
            }
            if (resolved_abs.length > 0) {
                const import_root = repo.root_dir;
                const res = RenderPack.loadMerged(
                    import_root,
                    resolved_abs,
                    schemaSearchDirs
                );
                repo._setLoadedRenderPackResult(res, import_root);
                trace(
                    `hydrate: loaded ${resolved_abs.length}/${
                        discovery.render_pack_paths.length
                    } render packs: ${resolved_abs.join(", ")}`
                );
            } else {
                trace(
                    `hydrate: render packs not found for paths: ${discovery.render_pack_paths.join(
                        ", "
                    )}`
                );
            }
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
                repo._setLoadedRenderPackResult(result, schemaRoot);
                trace(
                    `hydrate: loaded ${fallbackRenderPacks.length} render packs from schema-material fallback (root=${schemaRoot})`
                );
            } else {
                trace(
                    `hydrate: no render packs (including schema-material fallback)`
                );
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
        this._clearSchemaReferenceIndex();
        // Clear cached schemas
        this._record_meta_schema = null;
        this._doc_meta_schema = null;
        this._profile_schema = null;
        this._registry_schema = null;
    }

    /**
     * Add a schema-material search root.
     * @param {string} rootDirectory
     */
    addSchemaMaterialRoot(rootDirectory) {
        if (!isString(rootDirectory) || rootDirectory.trim().length === 0) {
            return;
        }
        const absoluteRoot = resolve(rootDirectory);
        if (!this._schema_material_roots.includes(absoluteRoot)) {
            this._schema_material_roots.push(absoluteRoot);
            this._clearSchemaReferenceIndex();
            this._record_meta_schema = null;
            this._doc_meta_schema = null;
            this._profile_schema = null;
            this._registry_schema = null;
        }
    }

    /**
     * Resolve schema material roots in deterministic precedence order.
     * The active repository is first so archived registries remain self-contained.
     * @returns {string[]}
     */
    getSchemaMaterialRoots() {
        const toolkitDir = this.getToolkitDir();
        const candidates = [this.root_dir]
            .concat(this._schema_material_roots)
            .concat([toolkitDir, resolve(toolkitDir, "../record-schema")]);
        /** @type {string[]} */
        const roots = [];
        const seen = new Set();
        for (let i = 0, len = candidates.length; i < len; i++) {
            const candidate = resolve(candidates[i]);
            if (!seen.has(candidate) && existsSync(candidate)) {
                seen.add(candidate);
                roots.push(candidate);
            }
        }
        return roots;
    }

    /**
     * Load the first available schema material at a well-known relative path.
     * @param {string} relativePath
     * @returns {Schema | null}
     */
    loadSchemaMaterial(relativePath) {
        const roots = this.getSchemaMaterialRoots();
        for (let i = 0, len = roots.length; i < len; i++) {
            const schema = this._loadSchemaPath(
                resolve(roots[i], relativePath)
            );
            if (schema) {
                return schema;
            }
        }
        return null;
    }

    /**
     * Load one schema and register its canonical $id for local reference use.
     * @param {string} absolutePath
     * @returns {Schema | null}
     * @private
     */
    _loadSchemaPath(absolutePath) {
        const schema = Schema.loadIfExists(absolutePath, {
            referenceResolver: this.resolveSchemaReference.bind(this)
        });
        if (schema) {
            this._registerSchemaReference(
                schema.definition,
                schema.source_path
            );
        }
        return schema;
    }

    /**
     * Resolve a canonical schema URI from the configured local material roots.
     * No network access is performed.
     * @param {string} reference
     * @param {string | null} [_sourcePath]
     * @returns {{ definition: import("./types/general.mjs").SchemaDefinition, source_path: string | null } | null}
     */
    resolveSchemaReference(reference, _sourcePath = null) {
        let schemaPath = this._schema_reference_paths.get(reference) || null;
        if (!schemaPath) {
            this._indexSchemaReferences();
            schemaPath = this._schema_reference_paths.get(reference) || null;
        }
        if (!schemaPath) {
            return null;
        }
        try {
            const definition = readJson(schemaPath);
            if (
                definition === null ||
                typeof definition !== "object" ||
                Array.isArray(definition)
            ) {
                return null;
            }
            return {
                definition,
                source_path: schemaPath
            };
        } catch {
            return null;
        }
    }

    /**
     * Register one schema's canonical identifier without overriding a
     * higher-precedence material root.
     * @param {unknown} definition
     * @param {string | null} sourcePath
     * @private
     */
    _registerSchemaReference(definition, sourcePath) {
        if (
            !sourcePath ||
            definition === null ||
            typeof definition !== "object" ||
            Array.isArray(definition)
        ) {
            return;
        }
        const schemaDefinition = /** @type {Record<string, unknown>} */ (
            definition
        );
        const identifier = schemaDefinition["$id"];
        if (
            typeof identifier === "string" &&
            identifier.length > 0 &&
            !this._schema_reference_paths.has(identifier)
        ) {
            this._schema_reference_paths.set(identifier, sourcePath);
        }
    }

    /**
     * Lazily index canonical schema identifiers in root precedence order.
     * @private
     */
    _indexSchemaReferences() {
        const roots = this.getSchemaMaterialRoots();
        for (let i = 0, len = roots.length; i < len; i++) {
            const rootDirectory = roots[i];
            if (this._indexed_schema_material_roots.has(rootDirectory)) {
                continue;
            }
            this._indexSchemaReferenceRoot(rootDirectory);
            this._indexed_schema_material_roots.add(rootDirectory);
        }
    }

    /**
     * Index JSON files below one schema-material root without following
     * symlinked descendants.
     * @param {string} rootDirectory
     * @private
     */
    _indexSchemaReferenceRoot(rootDirectory) {
        /** @type {string[]} */
        const pendingDirectories = [rootDirectory];
        const excludedDirectoryNames = new Set([
            ".git",
            ".yarn",
            "node_modules",
            "dist",
            "build",
            "coverage"
        ]);
        while (pendingDirectories.length > 0) {
            const currentDirectory = pendingDirectories.pop();
            if (!currentDirectory) {
                continue;
            }
            let entries;
            try {
                entries = readdirSync(currentDirectory, {
                    withFileTypes: true
                });
            } catch {
                continue;
            }
            entries.sort((left, right) => left.name.localeCompare(right.name));
            for (let i = 0, len = entries.length; i < len; i++) {
                const entry = entries[i];
                if (entry.isSymbolicLink()) {
                    continue;
                }
                const absolutePath = resolve(currentDirectory, entry.name);
                if (entry.isDirectory()) {
                    if (!excludedDirectoryNames.has(entry.name)) {
                        pendingDirectories.push(absolutePath);
                    }
                    continue;
                }
                if (!entry.isFile() || extname(entry.name) !== ".json") {
                    continue;
                }
                try {
                    this._registerSchemaReference(
                        readJson(absolutePath),
                        absolutePath
                    );
                } catch {
                    continue;
                }
            }
        }
    }

    /**
     * Clear canonical schema identifier caches after root changes.
     * @private
     */
    _clearSchemaReferenceIndex() {
        this._schema_reference_paths.clear();
        this._indexed_schema_material_roots.clear();
    }

    /**
     * Resolve a profile-declared schema path while preventing repository escape.
     * @param {string} relativePath
     * @returns {string | null}
     */
    resolveContainedSchemaMaterialPath(relativePath) {
        return this._resolveContainedSchemaMaterialPath(
            this.root_dir,
            relativePath
        );
    }

    /**
     * Resolve a profile-declared schema path relative to the schema-material
     * root that owns the profile.
     * @param {Profile | null} profile
     * @param {string} relativePath
     * @returns {string | null}
     */
    resolveProfileSchemaMaterialPath(profile, relativePath) {
        return this._resolveContainedSchemaMaterialPath(
            this._getProfileSchemaMaterialRoot(profile),
            relativePath
        );
    }

    /**
     * Resolve a relative schema path while preventing escape from one root.
     * @param {string} rootDirectory
     * @param {string} relativePath
     * @returns {string | null}
     * @private
     */
    _resolveContainedSchemaMaterialPath(rootDirectory, relativePath) {
        if (
            !isString(relativePath) ||
            relativePath.trim().length === 0 ||
            isAbsolute(relativePath)
        ) {
            return null;
        }
        const absoluteRoot = resolve(rootDirectory);
        const absolutePath = resolve(absoluteRoot, relativePath);
        const relativePathFromRoot = relative(absoluteRoot, absolutePath);
        if (
            relativePathFromRoot.length === 0 ||
            relativePathFromRoot === ".." ||
            relativePathFromRoot.startsWith(`..${sep}`) ||
            isAbsolute(relativePathFromRoot)
        ) {
            return null;
        }
        return absolutePath;
    }

    /**
     * Check that a resolved schema material is a contained regular non-symlink file.
     * @param {string} absolutePath
     * @returns {boolean}
     */
    isContainedRegularSchemaMaterialPath(absolutePath) {
        return this._isContainedRegularSchemaMaterialPath(
            this.root_dir,
            absolutePath
        );
    }

    /**
     * Check a profile-owned schema path against the profile's material root.
     * @param {Profile | null} profile
     * @param {string} absolutePath
     * @returns {boolean}
     */
    isContainedRegularProfileSchemaMaterialPath(profile, absolutePath) {
        return this._isContainedRegularSchemaMaterialPath(
            this._getProfileSchemaMaterialRoot(profile),
            absolutePath
        );
    }

    /**
     * Check that a path is a regular non-symlink file contained by one root.
     * @param {string} rootDirectory
     * @param {string} absolutePath
     * @returns {boolean}
     * @private
     */
    _isContainedRegularSchemaMaterialPath(rootDirectory, absolutePath) {
        if (!existsSync(absolutePath)) {
            return false;
        }
        try {
            const stats = lstatSync(absolutePath);
            if (stats.isSymbolicLink() || !stats.isFile()) {
                return false;
            }
            const repositoryRealPath = realpathSync(rootDirectory);
            const materialRealPath = realpathSync(absolutePath);
            const relativeRealPath = relative(
                repositoryRealPath,
                materialRealPath
            );
            return (
                relativeRealPath.length > 0 &&
                relativeRealPath !== ".." &&
                !relativeRealPath.startsWith(`..${sep}`) &&
                !isAbsolute(relativeRealPath)
            );
        } catch {
            return false;
        }
    }

    /**
     * Find the configured schema-material root that contains one profile.
     * Profiles without a source file are owned by the active repository.
     * @param {Profile | null} profile
     * @returns {string}
     * @private
     */
    _getProfileSchemaMaterialRoot(profile) {
        if (!profile?.source_path || !existsSync(profile.source_path)) {
            return this.root_dir;
        }
        let profileRealPath;
        try {
            profileRealPath = realpathSync(profile.source_path);
        } catch {
            return this.root_dir;
        }
        const roots = this.getSchemaMaterialRoots();
        for (let i = 0, len = roots.length; i < len; i++) {
            let rootRealPath;
            try {
                rootRealPath = realpathSync(roots[i]);
            } catch {
                continue;
            }
            const relativeProfilePath = relative(rootRealPath, profileRealPath);
            if (
                relativeProfilePath.length > 0 &&
                relativeProfilePath !== ".." &&
                !relativeProfilePath.startsWith(`..${sep}`) &&
                !isAbsolute(relativeProfilePath)
            ) {
                return roots[i];
            }
        }
        return this.root_dir;
    }

    /**
     * Validate profile-declared schema paths and structured-document multiplicity ranges.
     * @returns {ValidationIssue[]}
     */
    validateConfiguredSchemaMaterials() {
        return this.validateConfiguredSchemaMaterialsForProfile(this._profile);
    }

    /**
     * Validate schema paths and multiplicity ranges declared by one profile.
     * @param {Profile | null} profile
     * @returns {ValidationIssue[]}
     */
    validateConfiguredSchemaMaterialsForProfile(profile) {
        /** @type {ValidationIssue[]} */
        const issues = [];
        if (!profile) {
            return issues;
        }
        const schemaMaterialRoot = this._getProfileSchemaMaterialRoot(profile);

        /**
         * @param {string} configuredPath
         */
        const validateSchemaPath = (configuredPath) => {
            const absolutePath = this._resolveContainedSchemaMaterialPath(
                schemaMaterialRoot,
                configuredPath
            );
            if (!absolutePath) {
                issues.push({
                    severity: "error",
                    code: "configured.schema.path",
                    message: `Configured schema path must remain inside the profile's schema-material root: ${configuredPath}`,
                    file: configuredPath
                });
                return;
            }
            if (!existsSync(absolutePath)) {
                issues.push({
                    severity: "error",
                    code: "configured.schema.missing",
                    message: `Configured schema file not found: ${configuredPath}`,
                    file: configuredPath
                });
                return;
            }
            if (
                !this._isContainedRegularSchemaMaterialPath(
                    schemaMaterialRoot,
                    absolutePath
                )
            ) {
                issues.push({
                    severity: "error",
                    code: "configured.schema.path",
                    message: `Configured schema path must resolve to a regular non-symlink file contained by the profile's schema-material root: ${configuredPath}`,
                    file: configuredPath
                });
            }
        };

        const overlayPaths = profile.getMetaOverlaySchemaPaths();
        for (let i = 0, len = overlayPaths.length; i < len; i++) {
            validateSchemaPath(overlayPaths[i]);
        }

        const bindings = profile.getStructuredDocumentSchemas();
        for (let i = 0, len = bindings.length; i < len; i++) {
            const binding = bindings[i];
            validateSchemaPath(binding.schema_path);
            if (
                binding.min_count !== null &&
                binding.max_count !== null &&
                binding.min_count > binding.max_count
            ) {
                issues.push({
                    severity: "error",
                    code: "structured.count.range",
                    message: `Structured document count range is invalid for ${binding.doc_type}: min_count ${binding.min_count} exceeds max_count ${binding.max_count}`,
                    file: binding.schema_path
                });
            }
        }

        return issues;
    }

    /**
     * Report which base schema materials could not be resolved from any schema
     * material root. Every one of these is validated with an `if (!schema)
     * return` guard, so an unresolvable base schema does not fail - it silently
     * removes a layer of checking and the run still reports success. A caller
     * needs to be able to tell "nothing was wrong" apart from "nothing was
     * checked".
     * @returns {{ relative_path: string, purpose: string }[]}
     */
    getUnresolvedBaseSchemaMaterials() {
        const required = [
            {
                relative_path: "schema/record.meta.schema.json",
                purpose: "record META documents",
                resolved: this.getRecordMetaSchema()
            },
            {
                relative_path: "schema/registry.profile.schema.json",
                purpose: "the registry profile",
                resolved: this.getProfileSchema()
            },
            {
                relative_path: "schema/registry.schema.json",
                purpose: "registry documents",
                resolved: this.getRegistrySchema()
            },
            {
                relative_path: "schema/document.metadata.schema.json",
                purpose: "document metadata blocks",
                resolved: this.getDocMetaSchema()
            }
        ];
        const missing = [];
        for (let i = 0, len = required.length; i < len; i++) {
            if (required[i].resolved) continue;
            missing.push({
                relative_path: required[i].relative_path,
                purpose: required[i].purpose
            });
        }
        return missing;
    }

    /**
     * Get record meta schema
     * @returns {Schema | null}
     */
    getRecordMetaSchema() {
        if (this._record_meta_schema) {
            return this._record_meta_schema;
        }
        this._record_meta_schema = this.loadSchemaMaterial(
            "schema/record.meta.schema.json"
        );
        return this._record_meta_schema;
    }

    /**
     * Get base and profile-declared META schemas.
     * @returns {Schema[]}
     */
    getRecordMetaSchemas() {
        return this.getRecordMetaSchemasForProfile(this._profile);
    }

    /**
     * Get base and profile-declared META schemas for one profile.
     * @param {Profile | null} profile
     * @returns {Schema[]}
     */
    getRecordMetaSchemasForProfile(profile) {
        /** @type {Schema[]} */
        const schemas = [];
        const base = this.getRecordMetaSchema();
        if (base) {
            schemas.push(base);
        }
        if (!profile) {
            return schemas;
        }
        const schemaMaterialRoot = this._getProfileSchemaMaterialRoot(profile);
        const overlayPaths = profile.getMetaOverlaySchemaPaths();
        for (let i = 0, len = overlayPaths.length; i < len; i++) {
            const overlayPath = overlayPaths[i];
            const absolutePath = this._resolveContainedSchemaMaterialPath(
                schemaMaterialRoot,
                overlayPath
            );
            if (
                !absolutePath ||
                !this._isContainedRegularSchemaMaterialPath(
                    schemaMaterialRoot,
                    absolutePath
                )
            ) {
                continue;
            }
            const schema = this._loadSchemaPath(absolutePath);
            if (schema) {
                schemas.push(schema);
            }
        }
        return schemas;
    }

    /**
     * Get document metadata schema
     * @returns {Schema | null}
     */
    getDocMetaSchema() {
        if (this._doc_meta_schema) {
            return this._doc_meta_schema;
        }
        this._doc_meta_schema = this.loadSchemaMaterial(
            "schema/document.metadata.schema.json"
        );
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
        this._profile_schema = this.loadSchemaMaterial(
            "schema/registry.profile.schema.json"
        );
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
        this._registry_schema = this.loadSchemaMaterial(
            "schema/registry.schema.json"
        );
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
     * Load and merge registry files by absolute path.
     * @param {string[]} abs_paths
     * @returns {Registry | null}
     */
    loadRegistryFiles(abs_paths) {
        const paths = [];
        for (let i = 0, len = abs_paths.length; i < len; i++) {
            if (existsSync(abs_paths[i])) {
                paths.push(abs_paths[i]);
            }
        }
        if (paths.length === 0) {
            this._registry = null;
            return null;
        }
        this._registry = Registry.loadMerged(paths);
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
        this._loaded_pack_paths = result.packs.map((p) => {
            const pack = /** @type {{ sourcePath?: string }} */ (p);
            return pack.sourcePath || "";
        });
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
        if (!Array.isArray(packPaths) || packPaths.length === 0) {
            if (
                Array.isArray(this._loaded_render_packs) &&
                this._loaded_render_packs.length > 0
            ) {
                return this._render_policy || {};
            }
            this._loaded_render_packs = [];
            this._loaded_render_pack_paths = [];
            this._loaded_render_pack_roots = [resolve(this.root_dir)];
            this._render_policy = this._render_policy || {};
            return this._render_policy;
        }

        const result = RenderPack.loadMerged(this.root_dir, packPaths);
        this._setLoadedRenderPackResult(result, this.root_dir);
        return this._render_policy || {};
    }

    /**
     * Store merged render-pack load state on the repository.
     * @param {{ packs?: import("./RenderPack.mjs").RenderPack[], policy: RenderDocumentPolicy, packet_config?: Metadata }} result
     * @param {string} root_dir
     */
    _setLoadedRenderPackResult(result, root_dir) {
        this._render_policy = result.policy;
        this._packet_config = result.packet_config || null;
        this._loaded_render_packs = Array.isArray(result.packs)
            ? result.packs.slice()
            : [];
        this._loaded_render_pack_paths = this._loaded_render_packs
            .map((pack) =>
                typeof pack?.source_path === "string" ? pack.source_path : ""
            )
            .filter((path) => path.length > 0);

        /** @type {string[]} */
        const roots = [];
        if (typeof root_dir === "string" && root_dir.length > 0) {
            roots.push(resolve(root_dir));
        }
        for (
            let i = 0, len = this._loaded_render_pack_paths.length;
            i < len;
            i++
        ) {
            roots.push(dirname(this._loaded_render_pack_paths[i]));
        }

        /** @type {string[]} */
        const unique_roots = [];
        for (let i = 0, len = roots.length; i < len; i++) {
            const next_root = roots[i];
            if (unique_roots.includes(next_root)) {
                continue;
            }
            unique_roots.push(next_root);
        }
        this._loaded_render_pack_roots = unique_roots;
    }

    /**
     * Get loaded render packs in merge order.
     * @returns {import("./RenderPack.mjs").RenderPack[]}
     */
    getLoadedRenderPacks() {
        return this._loaded_render_packs || [];
    }

    /**
     * Get loaded render pack source paths.
     * @returns {string[]}
     */
    getLoadedRenderPackPaths() {
        return this._loaded_render_pack_paths || [];
    }

    /**
     * Get render-pack root directories available for record-level pack resolution.
     * @returns {string[]}
     */
    getLoadedRenderPackRoots() {
        if (
            this._loaded_render_pack_roots &&
            this._loaded_render_pack_roots.length > 0
        ) {
            return this._loaded_render_pack_roots.slice();
        }
        return [this.root_dir];
    }

    /**
     * Resolve a record-level render selection from META.yaml data.
     * Supports extensions.rendering.* and assembly.packet.render.* overrides.
     *
     * @param {import("./Metafile.mjs").Metafile | Metadata | null | undefined} metafile_or_data
     * @returns {{ pack_ids: string[], pack_paths: string[], family: string | null, default_profile: string | null }}
     */
    static extractRenderSelection(metafile_or_data) {
        const raw =
            metafile_or_data instanceof Metafile
                ? metafile_or_data.data
                : metafile_or_data && typeof metafile_or_data === "object"
                ? typeof (
                      /** @type {{ data?: unknown }} */ (metafile_or_data).data
                  ) === "object" &&
                  /** @type {{ data?: unknown }} */ (metafile_or_data).data !==
                      null
                    ? /** @type {{ data: Metadata }} */ (metafile_or_data).data
                    : metafile_or_data
                : null;

        /**
         * @param {unknown} value
         * @returns {{ pack_ids: string[], pack_paths: string[], family: string | null, default_profile: string | null }}
         */
        const parseSelection = (value) => {
            /** @type {{ pack_ids: string[], pack_paths: string[], family: string | null, default_profile: string | null }} */
            const out = {
                pack_ids: [],
                pack_paths: [],
                family: null,
                default_profile: null
            };

            if (!value || typeof value !== "object") {
                return out;
            }

            /** @type {Metadata} */
            const obj = /** @type {Metadata} */ (value);

            /**
             * @param {string[] } bucket
             * @param {string} next_value
             */
            const pushUnique = (bucket, next_value) => {
                const trimmed = next_value.trim();
                if (trimmed.length === 0 || bucket.includes(trimmed)) {
                    return;
                }
                bucket.push(trimmed);
            };

            /**
             * @param {unknown} next_value
             * @param {"path" | "id" | "auto"} mode
             */
            const addValue = (next_value, mode = "auto") => {
                if (typeof next_value !== "string") {
                    return;
                }
                const trimmed = next_value.trim();
                if (trimmed.length === 0) {
                    return;
                }
                const is_path_like =
                    trimmed.includes("/") ||
                    trimmed.includes("\\") ||
                    trimmed.endsWith(".json");
                if (mode === "path" || (mode === "auto" && is_path_like)) {
                    pushUnique(out.pack_paths, trimmed);
                    return;
                }
                pushUnique(out.pack_ids, trimmed);
            };

            addValue(obj.pack_id, "id");
            addValue(obj.pack, "auto");
            addValue(obj.pack_path, "path");

            if (Array.isArray(obj.pack_ids)) {
                for (let i = 0, len = obj.pack_ids.length; i < len; i++) {
                    addValue(obj.pack_ids[i], "id");
                }
            }
            if (Array.isArray(obj.pack_paths)) {
                for (let i = 0, len = obj.pack_paths.length; i < len; i++) {
                    addValue(obj.pack_paths[i], "path");
                }
            }
            if (Array.isArray(obj.packs)) {
                for (let i = 0, len = obj.packs.length; i < len; i++) {
                    addValue(obj.packs[i], "auto");
                }
            }

            if (
                typeof obj.family === "string" &&
                obj.family.trim().length > 0
            ) {
                out.family = obj.family.trim();
            }
            if (
                typeof obj.render_family === "string" &&
                obj.render_family.trim().length > 0
            ) {
                out.family = obj.render_family.trim();
            }
            if (
                typeof obj.default_profile === "string" &&
                obj.default_profile.trim().length > 0
            ) {
                out.default_profile = obj.default_profile.trim();
            }
            if (
                typeof obj.profile_id === "string" &&
                obj.profile_id.trim().length > 0
            ) {
                out.default_profile = obj.profile_id.trim();
            }

            return out;
        };

        const raw_record = /** @type {Record<string, unknown>} */ (raw || {});
        const extensions_record = /** @type {Record<string, unknown>} */ (
            raw_record.extensions || {}
        );
        const assembly_record = /** @type {Record<string, unknown>} */ (
            raw_record.assembly || {}
        );
        const packet_record = /** @type {Record<string, unknown>} */ (
            assembly_record.packet || {}
        );

        const extensions_rendering = parseSelection(
            extensions_record.rendering
        );
        const packet_render = parseSelection(packet_record.render);

        /** @type {{ pack_ids: string[], pack_paths: string[], family: string | null, default_profile: string | null }} */
        const merged = {
            pack_ids:
                packet_render.pack_ids.length > 0
                    ? packet_render.pack_ids
                    : extensions_rendering.pack_ids,
            pack_paths:
                packet_render.pack_paths.length > 0
                    ? packet_render.pack_paths
                    : extensions_rendering.pack_paths,
            family: packet_render.family || extensions_rendering.family,
            default_profile:
                packet_render.default_profile ||
                extensions_rendering.default_profile
        };

        if (!merged.family) {
            /** @type {string[]} */
            const family_hints = [];

            const authority_record = /** @type {Record<string, unknown>} */ (
                raw_record.authority || {}
            );
            const authority_class = authority_record.class;
            if (typeof authority_class === "string") {
                family_hints.push(authority_class);
            }

            if (typeof raw_record.title === "string") {
                family_hints.push(raw_record.title);
            }
            if (typeof raw_record.slug === "string") {
                family_hints.push(raw_record.slug);
            }

            const document_record = /** @type {Record<string, unknown>} */ (
                raw_record.document || {}
            );
            if (typeof document_record.title === "string") {
                family_hints.push(document_record.title);
            }

            const documents_record = /** @type {Record<string, unknown>} */ (
                raw_record.documents || {}
            );
            const primary_record = /** @type {Record<string, unknown>} */ (
                documents_record.primary || {}
            );
            if (typeof primary_record.path === "string") {
                family_hints.push(primary_record.path);
            }
            if (typeof primary_record.label === "string") {
                family_hints.push(primary_record.label);
            }

            const family_hint_text = family_hints.join(" ").toLowerCase();
            if (
                family_hint_text.includes("guidance") ||
                family_hint_text.includes("faq") ||
                family_hint_text.includes("handbook") ||
                family_hint_text.includes("playbook") ||
                family_hint_text.includes("manual")
            ) {
                merged.family = "internal-guidance";
            } else if (
                family_hint_text.includes("agreement") ||
                family_hint_text.includes("memorandum") ||
                family_hint_text.includes("license")
            ) {
                merged.family = "legal-agreement";
            }
        }

        return merged;
    }

    /**
     * Resolve a record-aware render pack.
     *
     * Precedence:
     *   1. assembly.packet.render.pack_paths / extensions.rendering.pack_paths
     *   2. assembly.packet.render.pack_ids / extensions.rendering.pack_ids
     *   3. assembly.packet.render.family / extensions.rendering.family
     *   4. loaded repository-level render packs
     *
     * @param {import("./Metafile.mjs").Metafile | Metadata | null | undefined} [metafile_or_data]
     * @returns {import("./RenderPack.mjs").RenderPack | null}
     */
    getResolvedRenderPack(metafile_or_data = undefined) {
        const target_meta =
            metafile_or_data !== undefined
                ? metafile_or_data
                : this._target_record?.metafile || null;

        const loaded_packs = this.getLoadedRenderPacks();
        if (loaded_packs.length === 0) {
            return null;
        }

        const selection = Repository.extractRenderSelection(target_meta);

        if (selection.pack_paths.length > 0) {
            const candidate_roots = this.getLoadedRenderPackRoots();
            for (let i = 0, len = candidate_roots.length; i < len; i++) {
                const root = candidate_roots[i];
                let all_found = true;
                for (
                    let p = 0, pLen = selection.pack_paths.length;
                    p < pLen;
                    p++
                ) {
                    if (!existsSync(resolve(root, selection.pack_paths[p]))) {
                        all_found = false;
                        break;
                    }
                }
                if (!all_found) {
                    continue;
                }
                const merged_result = RenderPack.loadMerged(
                    root,
                    selection.pack_paths
                );
                return merged_result.pack;
            }
        }

        /**
         * @param {string} value
         * @returns {string}
         */
        const normalizeKey = (value) =>
            value
                .trim()
                .toLowerCase()
                .replace(/[^a-z0-9]+/g, "-")
                .replace(/^-+|-+$/g, "");

        /**
         * @param {import("./RenderPack.mjs").RenderPack[]} packs
         * @param {string[]} pack_ids
         * @returns {import("./RenderPack.mjs").RenderPack[]}
         */
        const selectByIds = (packs, pack_ids) => {
            const wanted = new Set();
            for (let i = 0, len = pack_ids.length; i < len; i++) {
                const normalized = normalizeKey(pack_ids[i]);
                if (normalized.length > 0) {
                    wanted.add(normalized);
                }
            }
            if (wanted.size === 0) {
                return [];
            }

            /** @type {Map<string, import("./RenderPack.mjs").RenderPack>} */
            const by_source = new Map();
            for (let i = 0, len = packs.length; i < len; i++) {
                const source_path = packs[i].source_path;
                if (typeof source_path === "string" && source_path.length > 0) {
                    by_source.set(resolve(source_path), packs[i]);
                }
            }

            /** @type {Set<string>} */
            const include_sources = new Set();
            /** @type {Set<string>} */
            const include_ids = new Set();

            /**
             * @param {import("./RenderPack.mjs").RenderPack} pack
             */
            const includePack = (pack) => {
                const pack_id = normalizeKey(pack.getId());
                if (pack_id.length > 0) {
                    if (include_ids.has(pack_id)) {
                        return;
                    }
                    include_ids.add(pack_id);
                }

                const source_path = pack.source_path;
                if (typeof source_path === "string" && source_path.length > 0) {
                    const normalized_source = resolve(source_path);
                    if (include_sources.has(normalized_source)) {
                        return;
                    }
                    include_sources.add(normalized_source);

                    const pack_dir = dirname(normalized_source);
                    const imports = pack.getImports();
                    for (let i = 0, len = imports.length; i < len; i++) {
                        const import_abs = resolve(pack_dir, imports[i]);
                        const imported_pack = by_source.get(import_abs);
                        if (imported_pack) {
                            includePack(imported_pack);
                        }
                    }
                }
            };

            /**
             * @param {import("./RenderPack.mjs").RenderPack} pack
             * @returns {boolean}
             */
            const matchesWantedId = (pack) => {
                const pack_id = normalizeKey(pack.getId());
                if (wanted.has(pack_id)) {
                    return true;
                }

                const source_path =
                    typeof pack.source_path === "string"
                        ? pack.source_path
                        : "";
                if (source_path.length === 0) {
                    return false;
                }

                const file_name = basename(source_path);
                const stem = file_name.replace(extname(file_name), "");
                const stem_normalized = normalizeKey(stem);
                if (wanted.has(stem_normalized)) {
                    return true;
                }

                const without_version = stem_normalized.replace(
                    /-v\d+(?:-\d+)*$/,
                    ""
                );
                if (without_version.length > 0 && wanted.has(without_version)) {
                    return true;
                }

                for (const next_wanted of wanted) {
                    if (
                        next_wanted === without_version ||
                        next_wanted === stem_normalized ||
                        (without_version.length > 0 &&
                            next_wanted.startsWith(without_version)) ||
                        (next_wanted.length > 0 &&
                            without_version.startsWith(next_wanted))
                    ) {
                        return true;
                    }
                }

                return false;
            };

            for (let i = 0, len = packs.length; i < len; i++) {
                const pack = packs[i];
                if (matchesWantedId(pack)) {
                    includePack(pack);
                }
            }

            return packs.filter((pack) => {
                const source_path = pack.source_path;
                if (typeof source_path === "string" && source_path.length > 0) {
                    return include_sources.has(resolve(source_path));
                }
                return include_ids.has(normalizeKey(pack.getId()));
            });
        };

        /**
         * @param {import("./RenderPack.mjs").RenderPack[]} packs
         * @param {string} family
         * @returns {import("./RenderPack.mjs").RenderPack[]}
         */
        const selectByFamily = (packs, family) => {
            const family_tokens = normalizeKey(family)
                .split("-")
                .filter((token) => token.length > 0);
            if (family_tokens.length === 0) {
                return [];
            }

            let best_score = 0;
            /** @type {string[]} */
            const matched_ids = [];

            for (let i = 0, len = packs.length; i < len; i++) {
                const pack = packs[i];
                const label = `${pack.getId()} ${basename(
                    pack.source_path || ""
                )} ${pack.getDescription() || ""}`
                    .toLowerCase()
                    .replace(/[^a-z0-9]+/g, " ");
                let score = 0;
                for (let t = 0, tLen = family_tokens.length; t < tLen; t++) {
                    if (label.includes(family_tokens[t])) {
                        score += 1;
                    }
                }
                if (score === 0) {
                    continue;
                }
                if (score > best_score) {
                    best_score = score;
                    matched_ids.length = 0;
                    matched_ids.push(pack.getId());
                } else if (score === best_score) {
                    matched_ids.push(pack.getId());
                }
            }

            if (matched_ids.length === 0) {
                return [];
            }
            return selectByIds(packs, matched_ids);
        };

        /**
         * Keep base/common support packs layered underneath the selected family pack.
         * @param {import("./RenderPack.mjs").RenderPack[]} packs
         * @param {import("./RenderPack.mjs").RenderPack[]} selected
         * @returns {import("./RenderPack.mjs").RenderPack[]}
         */
        const withSupportPacks = (packs, selected) => {
            if (!Array.isArray(selected) || selected.length === 0) {
                return packs;
            }

            /** @type {Set<string>} */
            const selected_sources = new Set();
            /** @type {Set<string>} */
            const selected_ids = new Set();
            for (let i = 0, len = selected.length; i < len; i++) {
                const next_pack = selected[i];
                if (
                    typeof next_pack?.source_path === "string" &&
                    next_pack.source_path.length > 0
                ) {
                    selected_sources.add(resolve(next_pack.source_path));
                }
                selected_ids.add(normalizeKey(next_pack.getId()));
            }

            /** @type {import("./RenderPack.mjs").RenderPack[]} */
            const merged = [];
            for (let i = 0, len = packs.length; i < len; i++) {
                const next_pack = packs[i];
                const source_path =
                    typeof next_pack?.source_path === "string"
                        ? resolve(next_pack.source_path)
                        : "";
                const id_label = normalizeKey(next_pack.getId());
                const descriptor = `${id_label} ${basename(
                    next_pack.source_path || ""
                )} ${next_pack.getDescription() || ""}`.toLowerCase();
                const is_support_pack =
                    descriptor.includes("base") ||
                    descriptor.includes("common") ||
                    descriptor.includes("shared");
                if (
                    selected_sources.has(source_path) ||
                    selected_ids.has(id_label) ||
                    is_support_pack
                ) {
                    merged.push(next_pack);
                }
            }
            return merged.length > 0 ? merged : selected;
        };

        /** @type {import("./RenderPack.mjs").RenderPack[]} */
        let selected_packs = [];
        if (selection.pack_ids.length > 0) {
            selected_packs = selectByIds(loaded_packs, selection.pack_ids);
        }
        if (selected_packs.length === 0 && selection.family) {
            selected_packs = selectByFamily(loaded_packs, selection.family);
        }
        if (selected_packs.length === 0) {
            selected_packs = loaded_packs;
        } else {
            selected_packs = withSupportPacks(loaded_packs, selected_packs);
        }

        const merged_result = RenderPack.mergePacks(selected_packs);
        return merged_result.pack;
    }

    /**
     * Get loaded render policy. When a target record is active, return the
     * record-aware policy rather than the repository-wide union.
     * @returns {RenderDocumentPolicy | null}
     */
    /**
     * Get loaded render policy
     * @returns {RenderDocumentPolicy | null}
     */
    getRenderPolicy() {
        const pack = this.getResolvedRenderPack();
        if (pack) {
            return pack.getDocumentPolicies();
        }
        return this._render_policy;
    }

    /**
     * Get packet config from render packs
     * @returns {Metadata | null}
     */
    getPacketConfig() {
        const pack = this.getResolvedRenderPack();
        if (pack) {
            return pack.getPacketConfig() || this._packet_config;
        }
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
    // Formatting
    // =========================================================================

    /**
     * Format all text documents within a given scan directory.
     *
     * Scope resolution (in priority order):
     *   1. scanDir is a record directory      → format only that record.
     *   2. scanDir equals root_dir            → all buckets + root docs.
     *   3. Otherwise (series / bucket dir)    → scan scanDir directly for records.
     *
     * Canonical ASCII normalization is gated per-file on the resolved
     * formatting_profile.  If unicode_allowed: true the file's Unicode
     * punctuation is intentional and MUST NOT be stripped.
     *
     * @param {Object} [options]
     * @param {string} [options.scanDir] - Absolute path to scan; defaults to root_dir
     * @param {boolean} [options.dryRun] - When true, skip writing files
     * @returns {{ rel_path: string, original_text: string, new_text: string }[]}
     */
    formatDocuments(options = {}) {
        const scanDir = resolve(options.scanDir || this.root_dir);
        const dryRun = options.dryRun === true;
        const policy = this._policy;

        /**
         * @param {Document} doc
         * @param {string} rel_path
         * @param {boolean} [is_root_file]
         * @param {{ formatting_profile?: string, language_locale?: string }} [metaOverrides]
         * @returns {{ rel_path: string, original_text: string, new_text: string } | null}
         */
        const formatDoc = (
            doc,
            rel_path,
            is_root_file = false,
            metaOverrides
        ) => {
            if (!doc.isText()) {
                return null;
            }

            const original_text = doc.text;
            let current = doc;
            let modified = false;

            const fileInfo = doc.getFileInfo();
            const actions = FormattingPack.resolveFormatActions(
                policy,
                {
                    rel_path,
                    doc_type: fileInfo.doc_type,
                    ext: fileInfo.ext,
                    is_root_file
                },
                metaOverrides
            );

            // 1. Baseline: BOM strip, CRLF->LF, trailing whitespace
            if (actions.normalizeBaseline) {
                const baseline = current.normalizeBaseline();
                if (baseline.text !== current.text) {
                    current = baseline;
                    modified = true;
                }
            }

            // 2. Canonical ASCII: driven entirely by pack policy
            if (actions.normalizeCanonicalAscii) {
                const result = current.normalizeCanonicalAscii();
                if (result.changed) {
                    current = current.withText(result.text);
                    modified = true;
                }
            }

            // 3. Reflow: wrap long paragraph lines to configured max width.
            if (actions.reflowMaxWidth !== null) {
                const result = current.reflow(actions.reflowMaxWidth, {
                    continuationIndent: actions.continuationIndent
                });
                if (result.changed) {
                    current = current.withText(result.text);
                    modified = true;
                }
            }

            if (!modified) {
                return null;
            }

            if (!dryRun) {
                doc.withText(current.text).save();
            }

            return { rel_path, original_text, new_text: current.text };
        };

        /** @type {{ rel_path: string, original_text: string, new_text: string }[]} */
        const results = [];

        // ------------------------------------------------------------------
        // Scope 1: scanDir is itself a record directory
        // ------------------------------------------------------------------
        const recordInfo = Repository._detectRecordDirectory(scanDir);
        if (recordInfo) {
            const metaOverrides = Repository._metaOverridesFrom(
                recordInfo.metafile
            );
            const docs = this.findDocumentsInRecord(recordInfo);
            for (let i = 0, len = docs.length; i < len; i++) {
                const r = formatDoc(
                    docs[i],
                    this.getRelativePath(docs[i].source_path || ""),
                    false,
                    metaOverrides
                );
                if (r) {
                    results.push(r);
                }
            }
            return results;
        }

        const profile = this._profile || Profile.empty();
        const dirRegex = profile.getDirectoryRegex();
        /** @type {RegExp} */
        let re;
        try {
            re = new RegExp(dirRegex);
        } catch {
            re = /^[A-Z]{2,5}-\d{5}(?:-[A-Za-z0-9][A-Za-z0-9_-]*)?$/;
        }

        /** @type {RecordInfo[]} */
        let records;

        if (scanDir === this.root_dir) {
            // ------------------------------------------------------------------
            // Scope 2: full repo — use all profile buckets
            // ------------------------------------------------------------------
            records = this.findRecords();
        } else {
            // ------------------------------------------------------------------
            // Scope 3: series / bucket dir — scan it directly
            // ------------------------------------------------------------------
            const dirs = this._findRecordDirs(scanDir, re);
            records = [];
            for (let i = 0, len = dirs.length; i < len; i++) {
                const d = dirs[i];
                const record_id = Metafile.dirNameToRecordId(d.dir_name);
                if (!record_id) {
                    continue;
                }
                const metafile = Metafile.loadFromRecord(d.abs_path, record_id);
                records.push({
                    record_id,
                    dir_name: d.dir_name,
                    abs_path: d.abs_path,
                    rel_path: Repository._relPosix(this.root_dir, d.abs_path),
                    bucket: "scoped",
                    metafile
                });
            }
        }

        for (let i = 0, len = records.length; i < len; i++) {
            const metaOverrides = Repository._metaOverridesFrom(
                records[i].metafile
            );
            const docs = this.findDocumentsInRecord(records[i]);
            for (let j = 0, jLen = docs.length; j < jLen; j++) {
                const r = formatDoc(
                    docs[j],
                    this.getRelativePath(docs[j].source_path || ""),
                    false,
                    metaOverrides
                );
                if (r) {
                    results.push(r);
                }
            }
        }

        // Root docs (README, LICENSE etc.) only for full-repo scans
        if (scanDir === this.root_dir) {
            const rootDocs = this.findRootDocuments();
            for (let i = 0, len = rootDocs.length; i < len; i++) {
                const r = formatDoc(
                    rootDocs[i],
                    this.getRelativePath(rootDocs[i].source_path || ""),
                    true
                );
                if (r) {
                    results.push(r);
                }
            }
        }

        return results;
    }

    /**
     * Extract META.yaml-level formatting overrides for resolveFilePolicy layer 4.
     * @param {import("./Metafile.mjs").Metafile | null | undefined} metafile
     * @returns {{ formatting_profile?: string, language_locale?: string }}
     * @private
     */
    static _metaOverridesFrom(metafile) {
        if (!metafile) {
            return {};
        }
        /** @type {{ formatting_profile?: string, language_locale?: string }} */
        const out = {};
        const fmtProfile = metafile.getFormattingProfile();
        if (typeof fmtProfile === "string" && fmtProfile.length > 0) {
            out.formatting_profile = fmtProfile;
        }
        const locale = metafile.data?.extensions?.language?.locale;
        if (typeof locale === "string" && locale.length > 0) {
            out.language_locale = locale;
        }
        return out;
    }

    /**
     * Lint all documents in scope, returning issues per file.
     *
     * Scope resolution mirrors formatDocuments:
     *   - scanDir is a record dir  → lint that record only
     *   - scanDir === root_dir     → all records + root docs
     *   - otherwise                → records directly under scanDir
     *
     * @param {Object} [options]
     * @param {string} [options.scanDir] - Absolute path to scan; defaults to root_dir
     * @returns {import("./FormattingPack.mjs").LintIssue[]}
     */
    lintDocuments(options = {}) {
        const scanDir = resolve(options.scanDir || this.root_dir);
        const policy = this._policy;
        if (!policy) {
            return [];
        }

        /** @type {import("./FormattingPack.mjs").LintIssue[]} */
        const issues = [];

        /**
         * @param {import("./Document.mjs").Document} doc
         * @param {string} rel_path
         * @param {boolean} [is_root_file]
         * @param {{ formatting_profile?: string, language_locale?: string }} [metaOverrides]
         */
        const lintDoc = (
            doc,
            rel_path,
            is_root_file = false,
            metaOverrides
        ) => {
            if (!doc.isText()) {
                return;
            }
            const fileInfo = doc.getFileInfo();
            const docIssues = FormattingPack.lintDocument(
                policy,
                doc,
                rel_path,
                {
                    doc_type: fileInfo.doc_type,
                    ext: fileInfo.ext,
                    is_root_file
                },
                metaOverrides
            );
            for (let i = 0, len = docIssues.length; i < len; i++) {
                issues.push(docIssues[i]);
            }
        };

        const recordInfo = Repository._detectRecordDirectory(scanDir);
        if (recordInfo) {
            const metaOverrides = Repository._metaOverridesFrom(
                recordInfo.metafile
            );
            const docs = this.findDocumentsInRecord(recordInfo);
            for (let i = 0, len = docs.length; i < len; i++) {
                lintDoc(
                    docs[i],
                    this.getRelativePath(docs[i].source_path || ""),
                    false,
                    metaOverrides
                );
            }
            return issues;
        }

        const profile = this._profile || Profile.empty();
        const dirRegex = profile.getDirectoryRegex();
        /** @type {RegExp} */
        let re;
        try {
            re = new RegExp(dirRegex);
        } catch {
            re = /^[A-Z]{2,5}-\d{5}(?:-[A-Za-z0-9][A-Za-z0-9_-]*)?$/;
        }

        /** @type {RecordInfo[]} */
        let records;

        if (scanDir === this.root_dir) {
            records = this.findRecords();
        } else {
            const dirs = this._findRecordDirs(scanDir, re);
            records = [];
            for (let i = 0, len = dirs.length; i < len; i++) {
                const d = dirs[i];
                const record_id = Metafile.dirNameToRecordId(d.dir_name);
                if (!record_id) {
                    continue;
                }
                const metafile = Metafile.loadFromRecord(d.abs_path, record_id);
                records.push({
                    record_id,
                    dir_name: d.dir_name,
                    abs_path: d.abs_path,
                    rel_path: Repository._relPosix(this.root_dir, d.abs_path),
                    bucket: "scoped",
                    metafile
                });
            }
        }

        for (let i = 0, len = records.length; i < len; i++) {
            const metaOverrides = Repository._metaOverridesFrom(
                records[i].metafile
            );
            const docs = this.findDocumentsInRecord(records[i]);
            for (let j = 0, jLen = docs.length; j < jLen; j++) {
                lintDoc(
                    docs[j],
                    this.getRelativePath(docs[j].source_path || ""),
                    false,
                    metaOverrides
                );
            }
        }

        if (scanDir === this.root_dir) {
            const rootDocs = this.findRootDocuments();
            for (let i = 0, len = rootDocs.length; i < len; i++) {
                lintDoc(
                    rootDocs[i],
                    this.getRelativePath(rootDocs[i].source_path || ""),
                    true
                );
            }
        }

        return issues;
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
     * Validate profile-bound JSON/YAML record documents against JSON Schemas.
     * @param {RecordInfo} record
     * @returns {ValidationIssue[]}
     */
    validateStructuredDocuments(record) {
        return this.validateStructuredDocumentsForProfile(
            record,
            this._profile
        );
    }

    /**
     * Validate structured record documents using one selected profile.
     * @param {RecordInfo} record
     * @param {Profile | null} profile
     * @returns {ValidationIssue[]}
     */
    validateStructuredDocumentsForProfile(record, profile) {
        /** @type {ValidationIssue[]} */
        const issues = [];
        if (!profile) {
            return issues;
        }
        const schemaMaterialRoot = this._getProfileSchemaMaterialRoot(profile);
        const bindings = profile.getStructuredDocumentSchemas();
        if (bindings.length === 0) {
            return issues;
        }
        const documents = this.findDocumentsInRecord(record);
        for (let i = 0, len = bindings.length; i < len; i++) {
            const binding = bindings[i];
            const schemaPath = this._resolveContainedSchemaMaterialPath(
                schemaMaterialRoot,
                binding.schema_path
            );
            if (
                !schemaPath ||
                !this._isContainedRegularSchemaMaterialPath(
                    schemaMaterialRoot,
                    schemaPath
                )
            ) {
                continue;
            }
            const schema = this._loadSchemaPath(schemaPath);
            if (!schema) {
                continue;
            }
            let matched = 0;
            for (let j = 0, jLen = documents.length; j < jLen; j++) {
                const document = documents[j];
                const info = document.getFileInfo();
                if (info.doc_type !== binding.doc_type) {
                    continue;
                }
                const extension = (info.ext || "").toLowerCase();
                if (
                    binding.extensions.length > 0 &&
                    !binding.extensions.includes(extension)
                ) {
                    continue;
                }
                matched++;
                const sourcePath = document.source_path || "";
                let value;
                try {
                    if (extension === "json") {
                        value = readJson(sourcePath);
                    } else if (extension === "yaml" || extension === "yml") {
                        value = parseYaml(readFileSync(sourcePath, "utf8"), {
                            filename: sourcePath
                        });
                    } else {
                        issues.push({
                            severity: "error",
                            code: "structured.format.unsupported",
                            message: `Unsupported structured document extension: ${extension}`,
                            file: this.getRelativePath(sourcePath)
                        });
                        continue;
                    }
                } catch (error) {
                    issues.push({
                        severity: "error",
                        code: "structured.parse",
                        message:
                            error instanceof Error
                                ? error.message
                                : "Structured document parse failed",
                        file: this.getRelativePath(sourcePath)
                    });
                    continue;
                }
                const errors = schema.validate(value);
                for (let k = 0, kLen = errors.length; k < kLen; k++) {
                    issues.push({
                        severity: "error",
                        code: "structured.schema",
                        message: `${errors[k].path}: ${errors[k].message}`,
                        file: this.getRelativePath(sourcePath)
                    });
                }
            }
            const minimumCount =
                binding.min_count ?? (binding.required ? 1 : 0);
            if (matched < minimumCount) {
                issues.push({
                    severity: "error",
                    code: "structured.count.minimum",
                    message: `${binding.doc_type} structured document count ${matched} is below minimum ${minimumCount}`,
                    file: record.rel_path
                });
            }
            if (binding.max_count !== null && matched > binding.max_count) {
                issues.push({
                    severity: "error",
                    code: "structured.count.maximum",
                    message: `${binding.doc_type} structured document count ${matched} exceeds maximum ${binding.max_count}`,
                    file: record.rel_path
                });
            }
        }
        return issues;
    }

    /**
     * Validate language-rule primary YAML documents against category schemas.
     * @param {RecordInfo} record
     * @returns {ValidationIssue[]}
     */
    validateLanguageRuleDocuments(record) {
        const helper = new LanguageRuleRegistry(
            this.root_dir,
            this._registry,
            this._profile
        );
        if (!helper.hasLanguageRuleConfig()) {
            return [];
        }
        return helper.validateRecord(record);
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
     * @param {string} [registryPath]
     * @returns {ValidationIssue[]}
     */
    validateRegistry(registryPath = "registry.yaml") {
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
        const sourceDocumentCounts = new Map();
        for (let di = 0; di < docs.length; di++) {
            const d = docs[di];
            const sourcePath = this._registry.getRawDocumentSource(di);
            const sourceKey = sourcePath || registryPath;
            const sourceDocumentIndex =
                (sourceDocumentCounts.get(sourceKey) || 0) + 1;
            sourceDocumentCounts.set(sourceKey, sourceDocumentIndex);
            if (!d || typeof d !== "object") {
                continue;
            }
            if (d.schema !== "record-schema-registry") {
                continue;
            }
            const sourceDisplayPath = sourcePath
                ? this.getRelativePath(sourcePath)
                : registryPath;
            const errors = schema.validate(d);
            for (let ei = 0; ei < errors.length; ei++) {
                issues.push({
                    severity: "error",
                    code: "registry.schema",
                    message: `${errors[ei].path}: ${errors[ei].message}`,
                    file: `${sourceDisplayPath}#doc${sourceDocumentIndex}`
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
        this._findRecordDirsInto(baseDir, pattern, results);
        return results;
    }

    /**
     * @param {string} baseDir
     * @param {RegExp} pattern
     * @param {{ dir_name: string, abs_path: string }[]} results
     * @private
     */
    _findRecordDirsInto(baseDir, pattern, results) {
        let entries;
        try {
            entries = readdirSync(baseDir, { withFileTypes: true });
        } catch {
            return;
        }

        for (let i = 0, len = entries.length; i < len; i++) {
            const e = entries[i];
            if (!e.isDirectory()) {
                continue;
            }
            if (e.name.startsWith(".")) {
                continue;
            }
            if (e.name === "node_modules" || e.name === "dist") {
                continue;
            }
            const abs = resolve(baseDir, e.name);
            if (pattern.test(e.name)) {
                results.push({
                    dir_name: e.name,
                    abs_path: abs
                });
                continue;
            }
            this._findRecordDirsInto(abs, pattern, results);
        }
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
