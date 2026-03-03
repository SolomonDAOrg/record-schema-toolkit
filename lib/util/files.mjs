import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { basename, join, resolve } from "node:path";

/**
 * @param {string} dir
 * @param {(name: string) => boolean} predicate
 * @returns {string[]}
 */
function findDirsRec(dir, predicate) {
    /** @type {string[]} */
    const out = [];
    /** @type {string[]} */
    const stack = [dir];
    while (stack.length > 0) {
        const cur = stack.pop();
        if (!cur) continue;
        let entries;
        try {
            entries = readdirSync(cur, { withFileTypes: true });
        } catch {
            continue;
        }
        for (let i = 0, len = entries.length; i < len; i++) {
            const e = entries[i];
            if (!e.isDirectory()) continue;
            const name = e.name;
            if (
                name === ".git" ||
                name === "node_modules" ||
                name === ".yarn" ||
                name === "dist" ||
                name === "build"
            )
                continue;
            const abs = join(cur, name);
            if (predicate(name)) {
                out.push(abs);
                continue;
            }
            stack.push(abs);
        }
    }
    return out;
}

/**
 * @param {string} dirName
 * @returns {string | null}
 */
function dirNameToRecordId(dirName) {
    const parts = dirName.split("-");
    if (parts.length < 3) {
        return null;
    }
    const code = parts[0];
    const num = parts[1];
    if (!/^[A-Z]{2,5}$/.test(code)) {
        return null;
    }
    if (!/^\d{5}$/.test(num)) {
        return null;
    }
    return `${code}-${num}`;
}

/**
 * Read JSON file
 * @param {string} path
 * @returns {any}
 */
function readJson(path) {
    return JSON.parse(readFileSync(path, "utf8"));
}

/**
 * Read text file
 * @param {string} path
 * @returns {string}
 */
function readText(path) {
    return readFileSync(path, "utf8");
}

/**
 * Write text file
 * @param {string} path
 * @param {string} content
 */
function writeText(path, content) {
    writeFileSync(path, content, "utf8");
}

/**
 * Convert a path to POSIX format (forward slashes)
 * @param {string} path
 * @returns {string}
 */
function toPosixPath(path) {
    let posixPath = path;
    for (let i = 0, len = posixPath.length; i < len; i++) {
        if (posixPath.charCodeAt(i) === 0x5c) {
            posixPath = posixPath.slice(0, i) + "/" + posixPath.slice(i + 1);
        }
    }
    while (posixPath.startsWith("./")) {
        posixPath = posixPath.slice(2);
    }
    if (posixPath.endsWith("/")) {
        posixPath = posixPath.slice(0, posixPath.length - 1);
    }
    return posixPath;
}

/**
 * Get relative POSIX path from root to absolute path
 * @param {string} root
 * @param {string} abs
 * @returns {string}
 */
function relPosix(root, abs) {
    const r = resolve(root);
    const a = resolve(abs);
    let rel = a.startsWith(r) ? a.slice(r.length) : a;
    if (rel.startsWith("/") || rel.startsWith("\\")) {
        rel = rel.slice(1);
    }
    return toPosixPath(rel);
}

export {
    dirNameToRecordId,
    findDirsRec,
    readJson,
    readText,
    writeText,
    relPosix,
    toPosixPath
};
