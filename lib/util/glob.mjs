import { toPosixPath } from "./files.mjs";

/**
 * Convert a glob pattern to RegExp.
 * Supports: *, ?, **
 * @param {string} glob
 * @returns {RegExp}
 */
function globToRegExp(glob) {
    const g = toPosixPath(glob);
    let out = "^";
    let i = 0;
    while (i < g.length) {
        const ch = g[i];
        if (ch === "*") {
            if (g[i + 1] === "*") {
                // **
                i += 2;
                // Optional trailing slash after **
                if (g[i] === "/") {
                    i += 1;
                    out += "(?:.*\\/)?";
                } else {
                    out += ".*";
                }
                continue;
            }
            out += "[^/]*";
            i += 1;
            continue;
        }
        if (ch === "?") {
            out += "[^/]";
            i += 1;
            continue;
        }
        // Escape regex special chars
        if ("\\.^$+{}()|[]".includes(ch)) {
            out += "\\" + ch;
        } else {
            out += ch;
        }
        i += 1;
    }
    out += "$";
    return new RegExp(out);
}

/**
 * Match a path against a glob pattern
 * @param {string} path
 * @param {string} glob
 * @returns {boolean}
 */
function matchGlob(path, glob) {
    const re = globToRegExp(glob);
    return re.test(toPosixPath(path));
}

export { matchGlob, globToRegExp };
