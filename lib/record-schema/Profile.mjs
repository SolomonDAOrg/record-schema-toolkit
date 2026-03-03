/**
 * Profile class for YAML profile files (dao-proposals.profile.yaml)
 * @module classes/Profile
 */

import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import { parseYaml } from "../parsing/yaml.mjs";
import { Schema } from "./Schema.mjs";
import { isObject, extractValue } from "../util/objects.mjs";
import { isString, arrayOr, stringOr } from "../util/general.mjs";

/** @typedef {import("../types/general.mjs").Metadata} Metadata */
/** @typedef {import("./types/general.mjs").BucketConfig} BucketConfig */
/** @typedef {import("./types/general.mjs").RootConfig} RootConfig */
/** @typedef {import("./types/general.mjs").DocumentPoliciesConfig} DocumentPoliciesConfig */
/** @typedef {import("./types/general.mjs").RulesConfig} RulesConfig */
/** @typedef {import("./types/general.mjs").ProfileData} ProfileData */
/** @typedef {import("./types/general.mjs").SchemaError} SchemaError */

/**
 * Profile file representing repository configuration
 */
export class Profile {
    /**
     * @param {ProfileData} data
     * @param {string | null} [source_path]
     */
    constructor(data, source_path = null) {
        /** @type {ProfileData} */
        this.data = data;

        /** @type {string | null} */
        this.source_path = source_path;
    }

    // =========================================================================
    // Static Factory Methods
    // =========================================================================

    /**
     * Load profile from YAML file
     * @param {string} abs_path
     * @returns {Profile}
     */
    static load(abs_path) {
        return new Profile(
            /** @type {ProfileData} */ (
                parseYaml(readFileSync(abs_path, "utf8"), {
                    filename: abs_path
                })
            ),
            abs_path
        );
    }

    /**
     * Load profile from YAML file if it exists
     * @param {string} abs_path
     * @returns {Profile | null}
     */
    static loadIfExists(abs_path) {
        if (!existsSync(abs_path)) {
            return null;
        }
        return Profile.load(abs_path);
    }

    /**
     * Load profile relative to root directory
     * @param {string} root_dir
     * @param {string} rel_path
     * @returns {Profile | null}
     */
    static loadFromRoot(root_dir, rel_path) {
        const abs_path = resolve(root_dir, rel_path);
        return Profile.loadIfExists(abs_path);
    }

    /**
     * Parse profile from YAML string
     * @param {string} src
     * @param {string | null} [source_path]
     * @returns {Profile}
     */
    static parse(src, source_path = null) {
        const data = /** @type {ProfileData} */ (
            parseYaml(src, { filename: source_path || undefined })
        );
        return new Profile(data, source_path);
    }

    /**
     * Create empty profile
     * @returns {Profile}
     */
    static empty() {
        return new Profile({}, null);
    }

    // =========================================================================
    // Validation
    // =========================================================================

    /**
     * Validate profile against schema
     * @param {Schema} schema
     * @returns {SchemaError[]}
     */
    validate(schema) {
        return schema.validate(this.data);
    }

    /**
     * Check if profile is valid against schema
     * @param {Schema} schema
     * @returns {boolean}
     */
    isValid(schema) {
        return this.validate(schema).length === 0;
    }

    // =========================================================================
    // Bucket Methods
    // =========================================================================

    /**
     * Get resolved buckets from profile
     * @param {string} _root_dir - Root directory (unused, for API consistency)
     * @returns {BucketConfig[]}
     */
    getBuckets(_root_dir) {
        const buckets = arrayOr(this.data?.rules?.buckets);
        /** @type {BucketConfig[]} */
        const out = [];
        for (let i = 0, len = buckets.length; i < len; i++) {
            const b = buckets[i];
            if (!isObject(b)) {
                continue;
            }
            // @ts-ignore
            const bucket = b.bucket;
            // @ts-ignore
            const path = b.path;
            // @ts-ignore
            const constraints = b.record_constraints;
            if (isString(bucket) && isString(path)) {
                out.push({ bucket, path, constraints: constraints || {} });
            }
        }
        if (out.length > 0) {
            return out;
        }
        return [{ bucket: "root", path: ".", constraints: {} }];
    }

    /**
     * Get bucket by name
     * @param {string} name
     * @returns {BucketConfig|undefined}
     */
    getBucket(name) {
        const buckets = this.getBuckets("");
        for (let i = 0, len = buckets.length; i < len; i++) {
            if (buckets[i].bucket === name) {
                return buckets[i];
            }
        }
        return undefined;
    }

    // =========================================================================
    // Root Config Methods
    // =========================================================================

    /**
     * Get required root paths
     * @returns {string[]}
     */
    getRequiredPaths() {
        return arrayOr(this.data?.rules?.root?.required_paths);
    }

    /**
     * Check if a path is required at root
     * @param {string} path
     * @returns {boolean}
     */
    isRequiredPath(path) {
        const required = this.getRequiredPaths();
        for (let i = 0, len = required.length; i < len; i++) {
            if (required[i] === path) {
                return true;
            }
        }
        return false;
    }

    /**
     * Validate required root paths exist
     * @param {string} root_dir
     * @returns {{ path: string, exists: boolean }[]}
     */
    checkRequiredPaths(root_dir) {
        const required = this.getRequiredPaths();
        /** @type {{ path: string, exists: boolean }[]} */
        const results = [];
        for (let i = 0, len = required.length; i < len; i++) {
            const p = required[i];
            if (!isString(p)) {
                continue;
            }
            const abs = resolve(root_dir, p);
            results.push({ path: p, exists: existsSync(abs) });
        }
        return results;
    }

    // =========================================================================
    // Document Policies Methods
    // =========================================================================

    /**
     * Get pack paths for document policies
     * @returns {string[]}
     */
    getPackPaths() {
        return arrayOr(this.data?.rules?.document_policies?.pack_paths);
    }

    /**
     * Check if profile has pack paths defined
     * @returns {boolean}
     */
    hasPackPaths() {
        return this.getPackPaths().length > 0;
    }

    // =========================================================================
    // Directory Matching
    // =========================================================================

    /**
     * Get directory regex pattern for record matching
     * @returns {string}
     */
    getDirectoryRegex() {
        return stringOr(
            // @ts-ignore
            this.data?.rules?.records?.directory_regex,
            "^[A-Z]{2,5}-\\d{5}-[a-z0-9]+(?:-[a-z0-9]+)*$"
        );
    }

    /**
     * Check if directory name matches record pattern
     * @param {string} dir_name
     * @returns {boolean}
     */
    matchesDirectoryPattern(dir_name) {
        const pattern = this.getDirectoryRegex();
        try {
            const re = new RegExp(pattern);
            return re.test(dir_name);
        } catch {
            return false;
        }
    }

    // =========================================================================
    // Raw Access
    // =========================================================================

    /**
     * Get raw rules object
     * @returns {RulesConfig|undefined}
     */
    getRules() {
        return this.data?.rules;
    }

    /**
     * Get arbitrary nested value
     * @param {string} path - Dot-separated path
     * @returns {unknown}
     */
    get(path) {
        return extractValue(this.data, path);
    }
}
