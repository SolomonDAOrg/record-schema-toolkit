/**
 * Shared utilities for FormattingPack and RenderPack
 * @module classes/PackUtils
 */

/** @typedef {import("../types/general.mjs").Metadata} Metadata */

/**
 * Simple glob matching (converts glob pattern to RegExp)
 * @param {string} path
 * @param {string} glob
 * @returns {boolean}
 */
function matchGlob(path, glob) {
    const escaped = glob
        .replace(/[.+^${}()|[\]\\]/g, "\\$&")
        .replace(/\*\*/g, "<<<GLOBSTAR>>>")
        .replace(/\*/g, "[^/]*")
        .replace(/<<<GLOBSTAR>>>/g, ".*")
        .replace(/\?/g, ".");
    const re = new RegExp(`^${escaped}$`);
    return re.test(path);
}

/**
 * Check if a ruleset's selectors match a file descriptor
 * @param {{ selectors?: { is_root_file?: boolean, extensions?: string[], doc_types?: string[], paths_glob?: string[] } }} ruleset
 * @param {{ rel_path: string, doc_type: string|null, ext: string|null, is_root_file: boolean }} file
 * @returns {boolean}
 */
function rulesetMatchesFile(ruleset, file) {
    const sel = ruleset.selectors || {};

    if (sel.is_root_file === true && !file.is_root_file) {
        return false;
    }

    if (Array.isArray(sel.extensions)) {
        if (!file.ext) {
            return false;
        }
        let ok = false;
        for (let i = 0, len = sel.extensions.length; i < len; i++) {
            const ex = sel.extensions[i];
            if (typeof ex === "string" && ex.toLowerCase() === file.ext) {
                ok = true;
                break;
            }
        }
        if (!ok) {
            return false;
        }
    }

    if (Array.isArray(sel.doc_types)) {
        if (!file.doc_type) {
            return false;
        }
        let ok = false;
        for (let i = 0, len = sel.doc_types.length; i < len; i++) {
            const dt = sel.doc_types[i];
            if (typeof dt === "string" && dt === file.doc_type) {
                ok = true;
                break;
            }
        }
        if (!ok) {
            return false;
        }
    }

    if (Array.isArray(sel.paths_glob)) {
        let ok = false;
        for (let i = 0, len = sel.paths_glob.length; i < len; i++) {
            const g = sel.paths_glob[i];
            if (typeof g === "string" && matchGlob(file.rel_path, g)) {
                ok = true;
                break;
            }
        }
        if (!ok) {
            return false;
        }
    }

    return true;
}

/**
 * Get path from a pack entry (string or { path: string })
 * @param {unknown} entry
 * @returns {string|null}
 */
function getEntryPath(entry) {
    if (typeof entry === "string") {
        return entry;
    }
    if (entry && typeof entry === "object") {
        const obj = /** @type {Metadata} */ (entry);
        if (typeof obj.path === "string") {
            return obj.path;
        }
    }
    return null;
}

/**
 * Check if a pack entry should be included
 * @param {unknown} entry
 * @returns {boolean}
 */
export function shouldIncludeEntry(entry) {
    if (typeof entry === "string") {
        return true;
    }
    if (entry && typeof entry === "object") {
        const obj = /** @type {Metadata} */ (entry);
        return obj.include !== false;
    }
    return false;
}

/**
 * Get pack entry precedence for sorting
 * @param {unknown} entry
 * @param {number} index
 * @returns {number}
 */
function getEntryPrecedence(entry, index) {
    if (entry && typeof entry === "object") {
        const obj = /** @type {Metadata} */ (entry);
        if (typeof obj.precedence === "number") {
            return obj.precedence;
        }
    }
    return index * 10;
}

/**
 * Collect keys that look like camelCase (lowercase letter followed by uppercase).
 *
 * NOTE: This intentionally does NOT flag keys like "en-US" (locale IDs) because they are not camelCase.
 *
 * @param {unknown} value
 * @param {string} [basePath]
 * @returns {{ path: string, key: string }[]}
 */
function collectCamelCaseKeys(value, basePath = "") {
    /** @type {{ path: string, key: string }[]} */
    const out = [];

    /**
     * @param {unknown} v
     * @param {string} p
     */
    function visit(v, p) {
        if (!v || typeof v !== "object") {
            return;
        }
        if (Array.isArray(v)) {
            for (let i = 0, len = v.length; i < len; i++) {
                visit(v[i], `${p}[${i}]`);
            }
            return;
        }
        const obj = /** @type {Metadata} */ (v);
        const keys = Object.keys(obj);
        for (let i = 0, len = keys.length; i < len; i++) {
            const k = keys[i];
            if (/[a-z][A-Z]/.test(k)) {
                const kp = p ? `${p}.${k}` : k;
                out.push({ path: kp, key: k });
            }
            const np = p ? `${p}.${k}` : k;
            visit(obj[k], np);
        }
    }

    visit(value, basePath);
    return out;
}

/**
 * Assert that an object tree contains no camelCase keys.
 *
 * This enforces the project convention: JSON/YAML config must use underscore_case.
 *
 * @param {unknown} value
 * @param {string} sourceLabel
 */
function assertNoCamelCaseKeys(value, sourceLabel) {
    const bad = collectCamelCaseKeys(value);
    if (bad.length === 0) {
        return;
    }

    const max = 10;
    /** @type {string[]} */
    const samples = [];
    for (let i = 0, len = bad.length; i < len && i < max; i++) {
        samples.push(bad[i].path);
    }
    const more = bad.length > max ? ` (+${bad.length - max} more)` : "";
    const where =
        sourceLabel && sourceLabel.length > 0 ? `${sourceLabel}: ` : "";
    throw new Error(
        `${where}camelCase keys are disallowed; use underscore_case. Found: ${samples.join(
            ", "
        )}${more}`
    );
}

export {
    assertNoCamelCaseKeys,
    collectCamelCaseKeys,
    matchGlob,
    rulesetMatchesFile,
    getEntryPath,
    getEntryPrecedence
};
