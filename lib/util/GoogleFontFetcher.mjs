/**
 * GoogleFontFetcher
 *
 * Shared utility for resolving Google Fonts CSS import URLs → fetching +
 * caching font binaries (woff2/ttf/otf).  Used by both the dust-cover SVG
 * renderer and the main document renderer so font fetching behaviour is
 * identical across both paths.
 *
 * Callers supply explicit import URLs (e.g. from an SVG \@import rule or from
 * a config array); this module does not parse SVG or any document format.
 *
 * @module pdf/GoogleFontFetcher
 */

import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { syncFetchBuffer } from "./syncFetch.mjs";

// =============================================================================
// Types
// =============================================================================

/**
 * @typedef {"woff2"|"ttf"|"otf"|"unknown"} FontFormat
 */

/**
 * A successfully fetched font binary with its format tag.
 * @typedef {Object} FetchedFont
 * @property {Uint8Array} bytes
 * @property {FontFormat} format
 */

/**
 * Caller hint for which weight/style to prefer when selecting among multiple
 * faces for the same family.
 * @typedef {Object} RequestedFace
 * @property {number} weight   - CSS numeric weight (e.g. 400, 700).
 * @property {"normal"|"italic"} style
 */

/**
 * Options for {@link GoogleFontFetcher}.
 * @typedef {Object} GoogleFontFetcherOptions
 * @property {string | null} [cacheDir]           - Disk cache dir; null disables caching. Default ".solomon-font-cache".
 * @property {boolean} [verbose]                  - Log fetches to stdout.
 * @property {ReadonlyArray<string>} [allowedHosts] - Allowlist for CSS + font binary hosts.
 */

// =============================================================================
// CSS @font-face regex
// =============================================================================

const RE_FONT_FACE = /@font-face\s*\{([^}]+)\}/g;
const RE_FAMILY_RULE = /font-family:\s*['"]?([^;'"]+)['"]?/;
const RE_SRC_URL = /url\(['"]?(https?:\/\/[^'")\s]+)['"]?\)/;
const RE_FONT_WEIGHT_RULE = /font-weight:\s*([^;]+)/;
const RE_FONT_STYLE_RULE = /font-style:\s*([^;]+)/;
const RE_UNICODE_RANGE = /unicode-range:\s*([^;]+)/;

// =============================================================================
// Helpers
// =============================================================================

/**
 * Normalise a CSS font-family value: strip quotes, HTML entities, take the
 * first item in a comma-separated list, and trim.
 * @param {string | undefined | null} value
 * @returns {string}
 */
function normaliseFontFamily(value) {
    return String(value ?? "")
        .replace(/&quot;/g, '"')
        .replace(/&#34;/g, '"')
        .replace(/&apos;/g, "'")
        .split(",")[0]
        .trim()
        .replace(/['"]/g, "")
        .trim();
}

/**
 * @param {string | undefined | null} value
 * @returns {number}
 */
function parseFontWeight(value) {
    const raw = String(value ?? "")
        .trim()
        .toLowerCase();
    if (raw === "normal") {
        return 400;
    }
    if (raw === "bold") {
        return 700;
    }
    const n = Number.parseInt(raw, 10);
    return Number.isFinite(n) ? n : 400;
}

/**
 * @param {string | undefined | null} value
 * @returns {"normal"|"italic"}
 */
function parseFontStyle(value) {
    return String(value ?? "")
        .trim()
        .toLowerCase() === "italic"
        ? "italic"
        : "normal";
}

/**
 * @param {string | null | undefined} dir
 * @param {string} url
 * @returns {string | null}
 */
function _cachePath(dir, url) {
    if (!dir) {
        return null;
    }
    return join(dir, createHash("sha1").update(url).digest("hex"));
}

/**
 * @param {string} url
 * @param {ReadonlyArray<string>} allowedHosts
 * @returns {boolean}
 */
function _isAllowedHost(url, allowedHosts) {
    try {
        const u = new URL(url);
        return allowedHosts.includes(u.host);
    } catch {
        return false;
    }
}

/**
 * Fetch a font binary from `url`, reading from disk cache on hit and writing on
 * miss.  Non-2xx responses throw.
 * @param {string} url
 * @param {string | null} cacheDir
 * @param {boolean} verbose
 * @returns {Uint8Array}
 */
function _fetchFontBinary(url, cacheDir, verbose) {
    const inMemory = GLOBAL_FONT_BINARY_CACHE.get(url);
    if (inMemory) {
        if (verbose) {
            console.log(`[GoogleFontFetcher] memory hit: ${url}`);
        }
        return inMemory;
    }

    const cp = _cachePath(cacheDir, url);
    if (cp) {
        try {
            if (existsSync(cp)) {
                if (verbose) {
                    console.log(`[GoogleFontFetcher] cache hit: ${url}`);
                }
                const cached = new Uint8Array(readFileSync(cp));
                GLOBAL_FONT_BINARY_CACHE.set(url, cached);
                return cached;
            }
        } catch {
            /* non-fatal */
        }
    }
    if (verbose) {
        console.log(`[GoogleFontFetcher] fetching font: ${url}`);
    }
    const buf = syncFetchBuffer(url);
    GLOBAL_FONT_BINARY_CACHE.set(url, buf);
    if (cp) {
        try {
            writeFileSync(cp, buf);
        } catch {
            /* non-fatal */
        }
    }
    return buf;
}

/**
 * @param {string} url
 * @returns {FontFormat}
 */
function _formatFromUrl(url) {
    if (url.endsWith(".woff2")) {
        return "woff2";
    }
    if (url.endsWith(".ttf")) {
        return "ttf";
    }
    if (url.endsWith(".otf")) {
        return "otf";
    }
    if (url.endsWith(".woff")) {
        return "unknown";
    } // woff1 — not embeddable, skip
    return "unknown";
}

// =============================================================================
// GoogleFontFetcher
// =============================================================================

const GLOBAL_CSS_TEXT_CACHE = new Map();
const GLOBAL_FONT_BINARY_CACHE = new Map();
const GLOBAL_CSS_FAILURE_CACHE = new Map();

const DEFAULT_ALLOWED_HOSTS = Object.freeze([
    "fonts.googleapis.com",
    "fonts.gstatic.com"
]);

class GoogleFontFetcher {
    /**
     * @param {GoogleFontFetcherOptions} [options]
     */
    constructor(options) {
        /** @type {string | null} */
        this.cacheDir =
            options?.cacheDir !== undefined
                ? options.cacheDir
                : ".solomon-font-cache";

        /** @type {boolean} */
        this.verbose = options?.verbose ?? false;

        /** @type {ReadonlyArray<string>} */
        this.allowedHosts = options?.allowedHosts ?? DEFAULT_ALLOWED_HOSTS;

        if (this.cacheDir) {
            try {
                mkdirSync(this.cacheDir, { recursive: true });
            } catch {
                /* ignore */
            }
        }
    }

    /**
     * Fetch all font families referenced in the supplied CSS import URLs.
     *
     * For each family, the best-matching face is selected by:
     *   1. Closest weight to the requested weight (or 400 if not specified).
     *   2. Matching style (normal / italic).
     *   3. Latin unicode-range coverage.
     *   4. Preferred format: woff2 > ttf > otf.
     *
     * @param {ReadonlyArray<string>} importUrls  - Fully-qualified Google Fonts CSS URLs.
     * @param {Map<string, RequestedFace>} [requestedFaces]  - Per-family weight/style hints.
     * @returns {Map<string, FetchedFont>}  - family name → fetched binary.
     */
    fetch(importUrls, requestedFaces) {
        /** @type {Map<string, FetchedFont>} */
        const out = new Map();
        const hints = requestedFaces ?? new Map();

        for (let u = 0, ulen = importUrls.length; u < ulen; u++) {
            const cssUrl = importUrls[u];
            if (!_isAllowedHost(cssUrl, this.allowedHosts)) {
                console.warn(`[GoogleFontFetcher] blocked CSS host: ${cssUrl}`);
                continue;
            }

            let cssText;
            try {
                const cachedFailure = GLOBAL_CSS_FAILURE_CACHE.get(cssUrl);
                if (cachedFailure) {
                    if (this.verbose) {
                        console.log(
                            `[GoogleFontFetcher] cached CSS failure: ${cssUrl}`
                        );
                    }
                    continue;
                }

                const memHit = GLOBAL_CSS_TEXT_CACHE.get(cssUrl);
                if (typeof memHit === "string") {
                    if (this.verbose) {
                        console.log(
                            `[GoogleFontFetcher] CSS memory hit: ${cssUrl}`
                        );
                    }
                    cssText = memHit;
                } else {
                    const cssDiskPath = _cachePath(
                        this.cacheDir,
                        `css:${cssUrl}`
                    );
                    let diskHit = false;
                    if (cssDiskPath) {
                        try {
                            if (existsSync(cssDiskPath)) {
                                cssText = readFileSync(cssDiskPath, "utf8");
                                GLOBAL_CSS_TEXT_CACHE.set(cssUrl, cssText);
                                diskHit = true;
                                if (this.verbose) {
                                    console.log(
                                        `[GoogleFontFetcher] CSS disk hit: ${cssUrl}`
                                    );
                                }
                            }
                        } catch {
                            /* non-fatal */
                        }
                    }
                    if (!diskHit) {
                        if (this.verbose) {
                            console.log(
                                `[GoogleFontFetcher] fetching CSS: ${cssUrl}`
                            );
                        }
                        const cssBytes = syncFetchBuffer(cssUrl, {
                            Accept: "text/css,*/*;q=0.1"
                        });
                        cssText = new TextDecoder("utf-8").decode(cssBytes);
                        GLOBAL_CSS_TEXT_CACHE.set(cssUrl, cssText);
                        if (cssDiskPath) {
                            try {
                                writeFileSync(cssDiskPath, cssText, "utf8");
                            } catch {
                                /* non-fatal */
                            }
                        }
                    }
                }
            } catch (err) {
                GLOBAL_CSS_FAILURE_CACHE.set(cssUrl, true);
                console.warn(
                    `[GoogleFontFetcher] CSS fetch failed: ${
                        err instanceof Error ? err.message : String(err)
                    }`
                );
                continue;
            }

            this._processCss(cssText, hints, out);
        }

        return out;
    }

    /**
     * Parse a @font-face CSS block, select the best face per family, and fetch
     * the binary for families not yet present in `out`.
     *
     * @param {string} cssText
     * @param {Map<string, RequestedFace>} hints
     * @param {Map<string, FetchedFont>} out  - mutated in place
     * @private
     */
    _processCss(cssText, hints, out) {
        /** @type {Map<string, Array<{ weight: number, style: "normal"|"italic", unicodeRange: string, url: string, format: FontFormat }>>} */
        const byFamily = new Map();

        RE_FONT_FACE.lastIndex = 0;
        let m;
        while ((m = RE_FONT_FACE.exec(cssText)) !== null) {
            const body = m[1];

            const famMatch = RE_FAMILY_RULE.exec(body);
            if (!famMatch) {
                continue;
            }
            const family = normaliseFontFamily(famMatch[1]);
            if (family.length === 0) {
                continue;
            }

            const srcMatch = RE_SRC_URL.exec(body);
            if (!srcMatch) {
                continue;
            }
            const fontUrl = srcMatch[1];
            if (!_isAllowedHost(fontUrl, this.allowedHosts)) {
                console.warn(
                    `[GoogleFontFetcher] blocked font host: ${fontUrl}`
                );
                continue;
            }

            const fmt = _formatFromUrl(fontUrl);
            if (fmt === "unknown") {
                continue;
            } // skip woff1 + truly unknown

            const weightMatch = RE_FONT_WEIGHT_RULE.exec(body);
            const styleMatch = RE_FONT_STYLE_RULE.exec(body);
            const rangeMatch = RE_UNICODE_RANGE.exec(body);

            const arr = byFamily.get(family) ?? [];
            arr.push({
                weight: parseFontWeight(weightMatch ? weightMatch[1] : "400"),
                style: parseFontStyle(styleMatch ? styleMatch[1] : "normal"),
                unicodeRange: rangeMatch ? rangeMatch[1].trim() : "",
                url: fontUrl,
                format: fmt
            });
            byFamily.set(family, arr);
        }

        byFamily.forEach((faces, family) => {
            if (out.has(family)) {
                return;
            }

            const requested = hints.get(family) ?? {
                weight: 400,
                style: "normal"
            };

            faces.sort((a, b) => {
                return _faceScore(b, requested) - _faceScore(a, requested);
            });

            const best = faces[0];
            if (!best) {
                return;
            }

            try {
                const bytes = _fetchFontBinary(
                    best.url,
                    this.cacheDir,
                    this.verbose
                );
                out.set(family, { bytes, format: best.format });
                if (this.verbose) {
                    console.log(
                        `[GoogleFontFetcher] "${family}" ready (${best.format}, ` +
                            `${bytes.length} bytes, weight=${best.weight}, style=${best.style})`
                    );
                }
            } catch (err) {
                console.warn(
                    `[GoogleFontFetcher] font "${family}" fetch error: ` +
                        `${err instanceof Error ? err.message : String(err)}`
                );
            }
        });
    }
}

/**
 * Score a candidate face against a requested face for sorting (higher = better).
 * @param {{ weight: number, style: "normal"|"italic", unicodeRange: string, format: FontFormat }} face
 * @param {RequestedFace} requested
 * @returns {number}
 */
function _faceScore(face, requested) {
    let s = 0;
    s -= Math.abs(face.weight - requested.weight);
    if (face.style === requested.style) {
        s += 1000;
    }
    if (
        /U\+0{0,3}0-0{0,2}FF/i.test(face.unicodeRange) ||
        /U\+0020-007F/i.test(face.unicodeRange)
    ) {
        s += 500;
    }
    if (face.format === "woff2") {
        s += 50;
    } else if (face.format === "ttf") {
        s += 40;
    } else if (face.format === "otf") {
        s += 30;
    }
    return s;
}

export {
    normaliseFontFamily,
    parseFontWeight,
    parseFontStyle,
    GoogleFontFetcher
};
