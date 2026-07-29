/**
 * Source file scanner for language-rule application.
 * @module language-rules/SourceFileScanner
 */

import { existsSync, readdirSync } from "node:fs";
import { extname, resolve } from "node:path";
import { matchGlob } from "../util/glob.mjs";
import { toPosixPath } from "../util/files.mjs";

/**
 * @typedef {object} SourceFileEntry
 * @property {string} abs_path
 * @property {string} rel_path
 */

const DEFAULT_IGNORE_DIRS = new Set([
    ".git",
    ".svn",
    ".hg",
    "node_modules",
    ".yarn",
    "dist",
    "build",
    "coverage",
    ".turbo",
    ".next"
]);

export class SourceFileScanner {
    /**
     * @param {string} root_dir
     * @param {string[]} extensions
     * @param {object} [options]
     * @param {string[]} [options.include_globs]
     * @param {string[]} [options.exclude_globs]
     */
    constructor(root_dir, extensions, options = {}) {
        /** @type {string} */
        this.root_dir = resolve(root_dir);
        /** @type {Set<string>} */
        this.extensions = new Set(
            extensions.map((value) => value.replace(/^\./, "").toLowerCase())
        );
        /** @type {string[]} */
        this.include_globs = options.include_globs ?? [];
        /** @type {string[]} */
        this.exclude_globs = options.exclude_globs ?? [];
    }

    /**
     * @returns {SourceFileEntry[]}
     */
    scan() {
        /** @type {SourceFileEntry[]} */
        const out = [];
        if (!existsSync(this.root_dir)) {
            return out;
        }
        /** @type {string[]} */
        const stack = [this.root_dir];
        while (stack.length > 0) {
            const current = stack.pop() ?? this.root_dir;
            let entries;
            try {
                entries = readdirSync(current, { withFileTypes: true });
            } catch {
                continue;
            }
            for (let i = 0, len = entries.length; i < len; i++) {
                const entry = entries[i];
                const abs = resolve(current, entry.name);
                if (entry.isDirectory()) {
                    if (!DEFAULT_IGNORE_DIRS.has(entry.name)) {
                        stack.push(abs);
                    }
                    continue;
                }
                if (!entry.isFile()) {
                    continue;
                }
                const extension = extname(entry.name)
                    .replace(/^\./, "")
                    .toLowerCase();
                if (!this.extensions.has(extension)) {
                    continue;
                }
                const rel = toPosixPath(
                    abs.slice(this.root_dir.length).replace(/^[/\\]+/, "")
                );
                if (!this._matchesGlobs(rel)) {
                    continue;
                }
                out.push({ abs_path: abs, rel_path: rel });
            }
        }
        out.sort((a, b) => a.rel_path.localeCompare(b.rel_path));
        return out;
    }

    /**
     * @param {string} relPath
     * @returns {boolean}
     */
    _matchesGlobs(relPath) {
        if (this.include_globs.length > 0) {
            let matched = false;
            for (let i = 0, len = this.include_globs.length; i < len; i++) {
                if (matchGlob(relPath, this.include_globs[i])) {
                    matched = true;
                    break;
                }
            }
            if (!matched) {
                return false;
            }
        }
        for (let i = 0, len = this.exclude_globs.length; i < len; i++) {
            if (matchGlob(relPath, this.exclude_globs[i])) {
                return false;
            }
        }
        return true;
    }
}
