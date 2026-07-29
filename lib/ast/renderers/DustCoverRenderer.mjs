/**
 * Dust Cover Processor
 *
 * Parses a dust-cover SVG string with a hand-rolled minimal XML tokenizer,
 * resolves Google Fonts \@import rules by fetching font CSS + binary files,
 * and returns a DustCoverPage ready for native PDF rendering via
 * TwoPassPdfRenderer.renderDustCoverPage().
 *
 * No external SVG parser or rasteriser is required.
 * Requires Node >= 18 (global fetch).
 *
 * @module generators/DustCoverProcessor
 */

import { parseSvg } from "../../parsing/svg.mjs";
import {
    GoogleFontFetcher,
    normaliseFontFamily,
    parseFontWeight,
    parseFontStyle
} from "../../util/GoogleFontFetcher.mjs";
import { parseTtfFont } from "../../pdf/font-embed.mjs";
import { parseWoff2 } from "../../pdf/woff2-embed.mjs";
import { parseJpeg, parsePng } from "../../pdf/image-embed.mjs";

/**
 * @typedef {import("../../parsing/svg.mjs").SvgElement} SvgElement
 * @typedef {import("../../pdf/content-stream.mjs").PdfContentStreamBuilder} PdfContentStreamBuilder
 * @typedef {import("../../pdf/document.mjs").PdfDocumentBuilder} PdfDocumentBuilder
 * @typedef {import("../../ast/renderers/TwoPassPdfRenderer.mjs").PdfBuildState} PdfBuildState
 */

// =============================================================================
// Type definitions
// =============================================================================

/**
 * Pre-parsed dust cover page ready to hand to the PDF renderer.
 *
 * @typedef {Object} DustCoverPage
 * @property {SvgElement} root       - Parsed SVG element tree.
 * @property {number} svgMinX   - viewBox min-x (SVG user units).
 * @property {number} svgMinY   - viewBox min-y (SVG user units).
 * @property {number} svgWidth   - viewBox width (SVG user units).
 * @property {number} svgHeight  - viewBox height (SVG user units).
 * @property {Map<string, { bytes: Uint8Array, format: string }>} fonts  - font-family -> bytes + format (woff2/ttf/otf).
 * @property {boolean} [verbose]  - Log fetch operations.
 */

/**
 * @typedef {Object} ProcessDustCoverOptions
 * @property {string | null} [cacheDir] - Disk cache dir for font binaries.
 *                                        Default ".solomon-font-cache". Pass null to disable.
 * @property {boolean} [verbose]  - Log fetch operations.
 * @property {ReadonlyArray<string>} [allowedFontHosts] - Allowlist for CSS/font fetch hosts.
 *   Defaults to ["fonts.googleapis.com", "fonts.gstatic.com"].
 */

// =============================================================================
// Defs extraction (linearGradients, clipPaths)
// =============================================================================

/**
 * @typedef {{ stops: Array<{ offset: number, color: string }> }} LinearGradientDef
 * @typedef {{ x: number, y: number, width: number, height: number }}  ClipRectDef
 * @typedef {{ gradients: Map<string, LinearGradientDef>, clips: Map<string, ClipRectDef> }} SvgDefs
 */

/**
 * @param {string | undefined} style
 * @returns {string | null}
 */
function _stopColorFromStyle(style) {
    if (!style) {
        return null;
    }
    const m = /stop-color:\s*(#[0-9a-fA-F]+|[a-z]+)/.exec(style);
    return m ? m[1] : null;
}

/**
 * Walk the tree and collect linearGradient + clipPath definitions.
 * @param {SvgElement} root
 * @returns {SvgDefs}
 */
function _extractDefs(root) {
    /** @type {Map<string, LinearGradientDef>} */
    const gradients = new Map();
    /** @type {Map<string, ClipRectDef>} */
    const clips = new Map();

    /** @param {SvgElement} el */
    function walk(el) {
        for (let i = 0, len = el.children.length; i < len; i++) {
            const child = el.children[i];
            if (child.tag === "lineargradient") {
                const id = child.attrs["id"];
                if (id) {
                    const stops = [];
                    for (
                        let j = 0, jlen = child.children.length;
                        j < jlen;
                        j++
                    ) {
                        const s = child.children[j];
                        if (s.tag !== "stop") {
                            continue;
                        }
                        const raw = s.attrs["offset"] ?? "0%";
                        const offset = raw.endsWith("%")
                            ? Number.parseFloat(raw) / 100
                            : Number.parseFloat(raw);
                        const color =
                            s.attrs["stop-color"] ??
                            _stopColorFromStyle(s.attrs["style"]) ??
                            "#000000";
                        stops.push({ offset, color });
                    }
                    gradients.set(id, { stops });
                }
            } else if (child.tag === "clippath") {
                const id = child.attrs["id"];
                if (id) {
                    for (
                        let j = 0, jlen = child.children.length;
                        j < jlen;
                        j++
                    ) {
                        const r = child.children[j];
                        if (r.tag === "rect") {
                            clips.set(id, {
                                x: Number.parseFloat(r.attrs["x"] ?? "0"),
                                y: Number.parseFloat(r.attrs["y"] ?? "0"),
                                width: Number.parseFloat(
                                    r.attrs["width"] ?? "0"
                                ),
                                height: Number.parseFloat(
                                    r.attrs["height"] ?? "0"
                                )
                            });
                            break;
                        }
                    }
                }
            } else {
                walk(child);
            }
        }
    }

    walk(root);
    return { gradients, clips };
}

// =============================================================================
// Colour helpers
// =============================================================================

/**
 * @param {string} hex
 * @returns {{ r: number, g: number, b: number }}
 */
function _hexToRgb(hex) {
    const s = hex.startsWith("#") ? hex.slice(1) : hex;
    const n = Number.parseInt(
        s.length === 3 ? s[0] + s[0] + s[1] + s[1] + s[2] + s[2] : s,
        16
    );
    return { r: (n >> 16) & 0xff, g: (n >> 8) & 0xff, b: n & 0xff };
}

/**
 * @param {{ r: number, g: number, b: number }} rgb
 * @returns {string}
 */
function _rgbToHex({ r, g, b }) {
    const h = (v) => Math.round(v).toString(16).padStart(2, "0");
    return `#${h(r)}${h(g)}${h(b)}`;
}

/**
 * Approximate a linearGradient as the colour at its midpoint (t = 0.5).
 * The gradients in this SVG are near-monochrome, so midpoint colour is accurate.
 *
 * @param {LinearGradientDef} grad
 * @returns {string}
 */
function _gradientMidpoint(grad) {
    const { stops } = grad;
    if (stops.length === 0) {
        return "#000000";
    }
    if (stops.length === 1) {
        return stops[0].color;
    }

    let lo = stops[0],
        hi = stops[stops.length - 1];
    for (let i = 0, len = stops.length - 1; i < len; i++) {
        if (stops[i].offset <= 0.5 && stops[i + 1].offset >= 0.5) {
            lo = stops[i];
            hi = stops[i + 1];
            break;
        }
    }

    const span = hi.offset - lo.offset;
    const t = span === 0 ? 0 : (0.5 - lo.offset) / span;
    const ca = _hexToRgb(lo.color);
    const cb = _hexToRgb(hi.color);
    return _rgbToHex({
        r: ca.r + (cb.r - ca.r) * t,
        g: ca.g + (cb.g - ca.g) * t,
        b: ca.b + (cb.b - ca.b) * t
    });
}

// =============================================================================
// PDF Gradient Shading Builders
// =============================================================================

/** @param {number} v @returns {string} */
function _fmtN(v) {
    if (Number.isInteger(v)) {
        return String(v);
    }
    const s = v.toFixed(4);
    let end = s.length - 1;
    while (end > 0 && s[end] === "0") {
        end--;
    }
    if (s[end] === ".") {
        end--;
    }
    return s.slice(0, end + 1);
}

/**
 * Build a PDF Function dict for a stop list (Type 3 stitching of Type 2 segments).
 * @param {Array<{ offset: number, color: string }>} stops
 * @returns {string}
 */
function _buildShadingFunction(stops) {
    if (stops.length === 0) {
        return `<< /FunctionType 2 /Domain [0 1] /C0 [0 0 0] /C1 [0 0 0] /N 1 >>`;
    }
    if (stops.length === 1) {
        const { r, g, b } = _hexToRgb(stops[0].color);
        const c = `${_fmtN(r / 255)} ${_fmtN(g / 255)} ${_fmtN(b / 255)}`;
        return `<< /FunctionType 2 /Domain [0 1] /C0 [${c}] /C1 [${c}] /N 1 >>`;
    }
    const segments = [];
    for (let i = 0, len = stops.length - 1; i < len; i++) {
        const c0 = _hexToRgb(stops[i].color);
        const c1 = _hexToRgb(stops[i + 1].color);
        segments.push(
            `<< /FunctionType 2 /Domain [0 1]` +
                ` /C0 [${_fmtN(c0.r / 255)} ${_fmtN(c0.g / 255)} ${_fmtN(
                    c0.b / 255
                )}]` +
                ` /C1 [${_fmtN(c1.r / 255)} ${_fmtN(c1.g / 255)} ${_fmtN(
                    c1.b / 255
                )}]` +
                ` /N 1 >>`
        );
    }
    const bounds = stops
        .slice(1, -1)
        .map((s) => _fmtN(s.offset))
        .join(" ");
    const encode = stops
        .slice(0, -1)
        .map(() => "0 1")
        .join(" ");
    return (
        `<< /FunctionType 3 /Domain [0 1]` +
        ` /Functions [${segments.join(" ")}]` +
        ` /Bounds [${bounds}]` +
        ` /Encode [${encode}] >>`
    );
}

/**
 * Build a PDF axial shading dict spanning y-axis from (0,0) to (0,1)
 * in shading space. Caller applies cm to position/scale over the glyph box.
 * @param {Array<{ offset: number, color: string }>} stops
 * @returns {string}
 */
function _buildShadingDict(stops) {
    const fn = _buildShadingFunction(stops);
    return (
        `<< /ShadingType 2 /ColorSpace /DeviceRGB` +
        ` /Coords [0 0 0 1] /Extend [false false] /Function ${fn} >>`
    );
}

/**
 * Register a gradient shading once per (document, gradientId).
 * @param {{ doc: PdfDocumentBuilder }} state
 * @param {string} gradId
 * @param {{ stops: Array<{ offset: number, color: string }> }} gradDef
 * @returns {string} shading resource name
 */
function _ensureShading(state, gradId, gradDef) {
    const name = `DcSh_${gradId.replace(/[^A-Za-z0-9]/g, "_")}`;
    if (!state.doc.shadings.has(name)) {
        state.doc.registerShading(name, _buildShadingDict(gradDef.stops));
    }
    return name;
}

// =============================================================================
// Google Fonts — @import URL extraction from SVG style blocks
// =============================================================================

const RE_IMPORT_URL = /@import\s+url\(['"]?(https?:\/\/[^'")\s]+)['"]?\)\s*;?/g;

const INHERITED_SVG_STYLE_KEYS = [
    "fill",
    "stroke",
    "stroke-width",
    "font-family",
    "font-size",
    "font-weight",
    "font-style",
    "text-anchor",
    "dominant-baseline",
    "letter-spacing"
];

/**
 * @param {string | undefined | null} styleText
 * @returns {Record<string, string>}
 */
function _parseInlineStyle(styleText) {
    /** @type {Record<string, string>} */
    const out = {};
    const raw = String(styleText ?? "").trim();
    if (raw.length === 0) {
        return out;
    }
    const parts = raw.split(";");
    for (let i = 0, len = parts.length; i < len; i++) {
        const part = parts[i].trim();
        if (part.length === 0) {
            continue;
        }
        const colon = part.indexOf(":");
        if (colon <= 0) {
            continue;
        }
        const key = part.slice(0, colon).trim().toLowerCase();
        const value = part.slice(colon + 1).trim();
        if (key.length > 0 && value.length > 0) {
            out[key] = value;
        }
    }
    return out;
}

/**
 * @param {Record<string, string> | null | undefined} parentStyle
 * @param {SvgElement} el
 * @returns {Record<string, string>}
 */
function _resolveElementStyle(parentStyle, el) {
    const resolved = { ...(parentStyle ?? {}) };
    for (let i = 0, len = INHERITED_SVG_STYLE_KEYS.length; i < len; i++) {
        const key = INHERITED_SVG_STYLE_KEYS[i];
        const attrValue = el.attrs[key];
        if (attrValue !== undefined) {
            resolved[key] = attrValue;
        }
    }
    const inlineStyle = _parseInlineStyle(el.attrs["style"]);
    const inlineKeys = Object.keys(inlineStyle);
    for (let i = 0, len = inlineKeys.length; i < len; i++) {
        const key = inlineKeys[i];
        resolved[key] = inlineStyle[key];
    }
    return resolved;
}

/**
 * @param {string | number | undefined | null} value
 * @param {number} fallback
 * @param {number} [relativeTo]
 * @returns {number}
 */
function _parseSvgLength(value, fallback, relativeTo) {
    const raw = String(value ?? "").trim();
    if (raw.length === 0) {
        return fallback;
    }
    const n = Number.parseFloat(raw);
    if (!Number.isFinite(n)) {
        return fallback;
    }
    if (raw.endsWith("em")) {
        return n * (relativeTo ?? 0);
    }
    if (raw.endsWith("%")) {
        return ((relativeTo ?? 0) * n) / 100;
    }
    if (raw.endsWith("pt")) {
        return (n * 96) / 72;
    }
    return n;
}

/**
 * @param {SvgElement} root
 * @returns {Map<string, { weight: number, style: "normal" | "italic" }>}
 */
function _collectRequestedFontFaces(root) {
    /** @type {Map<string, { weight: number, style: "normal" | "italic" }>} */
    const out = new Map();

    /**
     * @param {SvgElement} el
     * @param {Record<string, string>} inheritedStyle
     */
    function walk(el, inheritedStyle) {
        const resolvedStyle = _resolveElementStyle(inheritedStyle, el);
        if (el.tag === "text" || el.tag === "tspan") {
            const family = normaliseFontFamily(resolvedStyle["font-family"]);
            if (family.length > 0) {
                const weight = parseFontWeight(resolvedStyle["font-weight"]);
                const style = parseFontStyle(resolvedStyle["font-style"]);
                const prev = out.get(family);
                if (
                    !prev ||
                    weight > prev.weight ||
                    (prev.style !== "italic" && style === "italic")
                ) {
                    out.set(family, { weight, style });
                }
            }
        }
        for (let i = 0, len = el.children.length; i < len; i++) {
            walk(el.children[i], resolvedStyle);
        }
    }

    walk(root, {});
    return out;
}

// =============================================================================
// viewBox extraction
// =============================================================================

/**
 * @param {SvgElement} root
 * @returns {{ width: number, height: number }}
 */

const PRESERVE_SPACE_SENTINEL = "";

/**
 * Replace whitespace-only text nodes inside <tspan>/<text> with a sentinel so
 * a trimming XML tokenizer cannot discard them. The sentinel is decoded back to
 * normal spaces during layout/render.
 *
 * This specifically fixes patterns like:
 *   <tspan dx="5" dy="0"> </tspan>
 * used as explicit spacer runs between words.
 *
 * @param {string} value
 * @returns {string}
 */
function _encodePreservedWhitespace(value) {
    if (!value) {
        return "";
    }
    let out = "";
    for (let i = 0, len = value.length; i < len; i++) {
        const ch = value.charAt(i);
        if (ch === " " || ch === "	") {
            out += PRESERVE_SPACE_SENTINEL;
        } else {
            out += ch;
        }
    }
    return out;
}

/**
 * @param {string | undefined | null} value
 * @returns {string}
 */
function _decodePreservedWhitespace(value) {
    if (!value) {
        return "";
    }
    return String(value).replaceAll(PRESERVE_SPACE_SENTINEL, " ");
}

/**
 * Preprocess whitespace-only tspan/text payloads so the SVG parser cannot trim
 * them away. This is intentionally narrow: it only targets nodes whose entire
 * text payload is XML whitespace.
 *
 * @param {string} svgContent
 * @returns {string}
 */
function _preprocessSvgWhitespace(svgContent) {
    return svgContent.replace(
        /<(tspan|text)\b([^>]*)>([\t\n\r ]+)<\/\1>/gi,
        (_match, tag, attrs, rawText) => {
            return `<${tag}${attrs}>${_encodePreservedWhitespace(
                rawText
            )}</${tag}>`;
        }
    );
}
function _extractViewBox(root) {
    for (let i = 0, len = root.children.length; i < len; i++) {
        const el = root.children[i];
        if (el.tag !== "svg") {
            continue;
        }
        const vb = el.attrs["viewbox"] ?? el.attrs["viewBox"];
        if (vb) {
            const parts = vb.trim().split(/[\s,]+/);
            if (parts.length >= 4) {
                return {
                    minX: Number.parseFloat(parts[0]),
                    minY: Number.parseFloat(parts[1]),
                    width: Number.parseFloat(parts[2]),
                    height: Number.parseFloat(parts[3])
                };
            }
        }
        return {
            minX: 0,
            minY: 0,
            width: Number.parseFloat(el.attrs["width"] ?? "0"),
            height: Number.parseFloat(el.attrs["height"] ?? "0")
        };
    }
    return { minX: 0, minY: 0, width: 0, height: 0 };
}

// =============================================================================
// Public API — processDustCover
// =============================================================================

/**
 * Parse and prepare a dust-cover SVG for native PDF rendering.
 *
 * @param {string} svgContent
 * @param {ProcessDustCoverOptions} [options]
 * @returns {DustCoverPage}
 */
export function processDustCover(svgContent, options) {
    const cacheDir =
        options?.cacheDir !== undefined
            ? options.cacheDir
            : ".solomon-font-cache";
    const verbose = options?.verbose ?? false;
    const allowedHosts = options?.allowedFontHosts ?? [
        "fonts.googleapis.com",
        "fonts.gstatic.com"
    ];

    const fetcher = new GoogleFontFetcher({
        cacheDir: cacheDir ?? null,
        verbose,
        allowedHosts
    });

    const preparedSvgContent = _preprocessSvgWhitespace(svgContent);
    const root = parseSvg(preparedSvgContent);
    const {
        minX: svgMinX,
        minY: svgMinY,
        width: svgWidth,
        height: svgHeight
    } = _extractViewBox(root);
    const requestedFaces = _collectRequestedFontFaces(root);

    const importUrls = [];
    let _m;
    RE_IMPORT_URL.lastIndex = 0;
    while ((_m = RE_IMPORT_URL.exec(svgContent)) !== null) {
        importUrls.push(_m[1].replace(/&amp;/g, "&"));
    }
    const fonts = fetcher.fetch(importUrls, requestedFaces);

    return { root, svgMinX, svgMinY, svgWidth, svgHeight, fonts, verbose };
}

// =============================================================================
// PDF rendering — called from TwoPassPdfRenderer.renderDustCoverPage()
// =============================================================================

/**
 * Render a DustCoverPage onto a PDF content stream builder using native PDF ops.
 *
 * Font registration:
 *   Calls `state.doc.registerFont(alias, bytes)` to register an embedded font
 *   under a stable alias (the SVG font-family). The PDF builder is expected to
 *   return a resource name usable with `builder.setFont()`.
 *
 * Image embedding:
 *   Base64 inline images are embedded as XObjects using
 *   `state.doc.embedImageXObject(name, bytes)` and rendered via
 *   `builder.drawXObject(name, x, y, w, h)` when present.
 *
 * @param {DustCoverPage} dustCoverPage
 * @param {PdfContentStreamBuilder} builder - PdfContentStreamBuilder instance.
 * @param {PdfBuildState} state
 * @returns {void}
 */

export function renderSvgToPdf(dustCoverPage, builder, state) {
    const {
        root,
        svgMinX = 0,
        svgMinY = 0,
        svgWidth,
        svgHeight,
        fonts
    } = dustCoverPage;
    const verbose = dustCoverPage.verbose === true;
    const { pageWidth, pageHeight } = state;

    function v(msg) {
        if (verbose) {
            console.log(`[DustCover] ${msg}`);
        }
    }

    /** @type {Map<string, string>} */
    const fontResourceByFamily = new Map();
    /** @type {Map<string, import("../../pdf/font-embed.mjs").TtfParsed>} */
    const fontMetricsByFamily = new Map();

    if (fonts) {
         v(`fonts size=${fonts.size} families=[${Array.from(fonts.keys()).join(", ")}]`);
        fonts.forEach((info, family) => {
            v(`  "${family}" format=${info.format} bytes=${info.bytes?.length ?? 0}`);
        });

        fonts.forEach((info, family) => {
            const normalized = normaliseFontFamily(family);
            try {
                const resName = state.doc.registerFont(normalized, info.bytes);
                if (typeof resName === "string" && resName.trim().length > 0) {
                    fontResourceByFamily.set(normalized, resName);
                }
                try {
                    const metrics =
                        info.format === "woff2"
                            ? parseWoff2(info.bytes)
                            : parseTtfFont(info.bytes);
                    fontMetricsByFamily.set(normalized, metrics);
                    v(`registered font "${normalized}" -> ${resName}`);
                } catch (metricErr) {
                    v(
                        `font metrics warning "${normalized}": ${
                            metricErr instanceof Error
                                ? metricErr.message
                                : String(metricErr)
                        }`
                    );
                }
            } catch (err) {
                v(
                    `font registration warning "${normalized}": ${
                        err instanceof Error ? err.message : String(err)
                    }`
                );
            }
        });
    }

    const helvetica =
        typeof state.doc.getFontName === "function"
            ? state.doc.getFontName("Helvetica")
            : "Helvetica";

    const scaleX = svgWidth > 0 ? pageWidth / svgWidth : 1;
    const scaleY = svgHeight > 0 ? pageHeight / svgHeight : 1;
    const defs = _extractDefs(root);

    const px = (sx) => (sx - svgMinX) * scaleX;
    const py = (sy) => pageHeight - (sy - svgMinY) * scaleY;
    const psx = (v0) => v0 * scaleX;
    const psy = (v0) => v0 * scaleY;
    const psl = (v0) => v0 * Math.max(Math.abs(scaleX), Math.abs(scaleY));

    function resolveColor(val) {
        if (!val || val === "none") {
            return null;
        }
        const u = /^url\(#([^)]+)\)$/.exec(val);
        if (u) {
            const grad = defs.gradients.get(u[1]);
            return grad ? _gradientMidpoint(grad) : "#000000";
        }
        return val;
    }

    function applyFill(color) {
        const { r, g, b } = _hexToRgb(
            color.startsWith("#") ? color : `#${color}`
        );
        builder.setFillColor(r / 255, g / 255, b / 255);
    }

    function applyStroke(color) {
        const { r, g, b } = _hexToRgb(
            color.startsWith("#") ? color : `#${color}`
        );
        builder.setStrokeColor(r / 255, g / 255, b / 255);
    }

    function parseTransform(t) {
        let tx = 0;
        let ty = 0;
        let scaleX = 1;
        let scaleY = 1;
        if (!t) {
            return { tx, ty, scaleX, scaleY };
        }
        const tr = /translate\(\s*([-\d.]+)(?:[\s,]+([-\d.]+))?\s*\)/.exec(t);
        if (tr) {
            tx = Number.parseFloat(tr[1]);
            ty = tr[2] !== undefined ? Number.parseFloat(tr[2]) : 0;
        }
        const sc = /scale\(\s*([-\d.]+)(?:[\s,]+([-\d.]+))?\s*\)/.exec(t);
        if (sc) {
            scaleX = Number.parseFloat(sc[1]);
            scaleY = sc[2] !== undefined ? Number.parseFloat(sc[2]) : scaleX;
        }
        return { tx, ty, scaleX, scaleY };
    }

    function collectText(el) {
        let s = _decodePreservedWhitespace(el.text);
        for (let i = 0, len = el.children.length; i < len; i++) {
            const c = el.children[i];
            if (c.tag === "tspan") {
                s += collectText(c);
            }
        }
        return s;
    }

    function collectTextRuns(el) {
        const runs = [];
        if (el.children.length === 0) {
            const txt = _decodePreservedWhitespace(el.text);
            if (txt.length > 0) {
                runs.push({ text: txt, dx: "0", dy: "0", x: null, y: null });
            }
            return runs;
        }
        const ownText = _decodePreservedWhitespace(el.text);
        if (ownText.length > 0) {
            runs.push({ text: ownText, dx: "0", dy: "0", x: null, y: null });
        }
        for (let i = 0, len = el.children.length; i < len; i++) {
            const child = el.children[i];
            if (child.tag !== "tspan") {
                continue;
            }
            const nested = collectText(child);
            if (nested.length === 0) {
                continue;
            }
            runs.push({
                text: nested,
                dx: child.attrs["dx"] ?? "0",
                dy: child.attrs["dy"] ?? "0",
                x: child.attrs["x"] !== undefined ? child.attrs["x"] : null,
                y: child.attrs["y"] !== undefined ? child.attrs["y"] : null
            });
        }
        if (runs.length === 0) {
            const txt = collectText(el);
            if (txt.length > 0) {
                runs.push({ text: txt, dx: "0", dy: "0", x: null, y: null });
            }
        }
        return runs;
    }

    function resolveFont(family) {
        const normalized = normaliseFontFamily(family);
        const mapped =
            normalized.length > 0 ? fontResourceByFamily.get(normalized) : null;
        const metrics =
            normalized.length > 0
                ? fontMetricsByFamily.get(normalized) ?? null
                : null;
        if (mapped) {
            return { resourceName: mapped, family: normalized, metrics };
        }
        if (normalized.length > 0) {
            v(`font fallback "${normalized}" -> Helvetica`);
        }
        return { resourceName: helvetica, family: "Helvetica", metrics: null };
    }

    function measureGlyphAdvanceSvg(ch, fontSize, metrics) {
        if (!ch || fontSize <= 0) {
            return 0;
        }
        const code = ch.charCodeAt(0) & 0xff;
        if (metrics) {
            const widthUnits = metrics.charWidths[code] || 0;
            if (widthUnits > 0) {
                return (widthUnits / 1000) * fontSize;
            }
        }
        if (ch === " ") {
            return fontSize * 0.33;
        }
        if (ch === "	") {
            return fontSize * 1.32;
        }
        return fontSize * 0.55;
    }

    function measureTextSvg(text, fontSize, metrics) {
        if (!text || fontSize <= 0) {
            return 0;
        }
        let width = 0;
        for (let i = 0, len = text.length; i < len; i++) {
            width += measureGlyphAdvanceSvg(text.charAt(i), fontSize, metrics);
        }
        return width;
    }

    function layoutTextGlyphsSvg(
        runs,
        fontSize,
        letterSpacing,
        metrics,
        rawFontSize,
        xScale = 1,
        yScale = 1
    ) {
        const glyphs = [];
        let cursorX = 0;
        let cursorY = 0;
        let previousGlyphContinues = false;
        let maxRight = 0;

        for (let i = 0, len = runs.length; i < len; i++) {
            const run = runs[i];
            if (run.x !== null) {
                cursorX = _parseSvgLength(run.x, 0, rawFontSize) * xScale;
                previousGlyphContinues = false;
            }
            if (run.y !== null) {
                cursorY = _parseSvgLength(run.y, 0, rawFontSize) * yScale;
                previousGlyphContinues = false;
            }
            cursorX += _parseSvgLength(run.dx, 0, rawFontSize) * xScale;
            cursorY += _parseSvgLength(run.dy, 0, rawFontSize) * yScale;

            for (let j = 0, jlen = run.text.length; j < jlen; j++) {
                const sourceChar = run.text.charAt(j);
                const ch =
                    sourceChar === PRESERVE_SPACE_SENTINEL ? " " : sourceChar;
                if (previousGlyphContinues) {
                    cursorX += letterSpacing;
                }
                const advanceSvg = measureGlyphAdvanceSvg(
                    ch,
                    fontSize,
                    metrics
                );
                glyphs.push({
                    ch,
                    x: cursorX,
                    y: cursorY,
                    advanceSvg,
                    isWhitespace: /^\s$/.test(ch)
                });
                const rightX = cursorX + advanceSvg;
                if (rightX > maxRight) {
                    maxRight = rightX;
                }
                cursorX = rightX;
                previousGlyphContinues = true;
            }
        }

        return { glyphs, width: maxRight, endX: cursorX, endY: cursorY };
    }

    function fitImageBox(
        boxWidth,
        boxHeight,
        sourceWidth,
        sourceHeight,
        preserveAspectRatio
    ) {
        const par = String(preserveAspectRatio ?? "").trim();
        if (
            par.length === 0 ||
            par === "none" ||
            sourceWidth <= 0 ||
            sourceHeight <= 0 ||
            boxWidth <= 0 ||
            boxHeight <= 0
        ) {
            return { x: 0, y: 0, width: boxWidth, height: boxHeight };
        }

        const align = par.split(/\s+/)[0] || "xMidYMid";
        const mode = par.includes("slice") ? "slice" : "meet";
        const scaleFit =
            mode === "slice"
                ? Math.max(boxWidth / sourceWidth, boxHeight / sourceHeight)
                : Math.min(boxWidth / sourceWidth, boxHeight / sourceHeight);
        const drawWidth = sourceWidth * scaleFit;
        const drawHeight = sourceHeight * scaleFit;
        let dx = 0;
        let dy = 0;

        if (align.includes("xMid")) {
            dx = (boxWidth - drawWidth) / 2;
        } else if (align.includes("xMax")) {
            dx = boxWidth - drawWidth;
        }

        if (align.includes("YMid")) {
            dy = (boxHeight - drawHeight) / 2;
        } else if (align.includes("YMax")) {
            dy = boxHeight - drawHeight;
        }

        return { x: dx, y: dy, width: drawWidth, height: drawHeight };
    }

    function renderEl(el, gTx, gTy, gScaleX, gScaleY, inheritedStyle) {
        const resolvedStyle = _resolveElementStyle(inheritedStyle, el);
        switch (el.tag) {
            case "svg":
            case "#root":
            case "defs":
            case "style": {
                for (let i = 0, len = el.children.length; i < len; i++) {
                    renderEl(
                        el.children[i],
                        gTx,
                        gTy,
                        gScaleX,
                        gScaleY,
                        resolvedStyle
                    );
                }
                break;
            }

            case "rect": {
                const x = _parseSvgLength(el.attrs["x"], 0) * gScaleX + gTx;
                const y = _parseSvgLength(el.attrs["y"], 0) * gScaleY + gTy;
                const w = _parseSvgLength(el.attrs["width"], 0) * gScaleX;
                const h = _parseSvgLength(el.attrs["height"], 0) * gScaleY;
                const fill = resolveColor(resolvedStyle["fill"] ?? "black");
                const stroke = resolveColor(resolvedStyle["stroke"] ?? null);
                const lw =
                    _parseSvgLength(resolvedStyle["stroke-width"], 1) *
                    Math.max(Math.abs(gScaleX), Math.abs(gScaleY));
                const pdfX = px(x);
                const pdfY = py(y + h);
                const pdfW = psx(w);
                const pdfH = psy(h);

                builder.saveState();
                if (fill && fill !== "none") {
                    applyFill(fill);
                    builder.rectangle(pdfX, pdfY, pdfW, pdfH).fill();
                }
                if (stroke && stroke !== "none") {
                    applyStroke(stroke);
                    builder.setLineWidth(psl(lw));
                    builder.rectangle(pdfX, pdfY, pdfW, pdfH).stroke();
                }
                builder.restoreState();
                break;
            }

            case "line": {
                const x1 = _parseSvgLength(el.attrs["x1"], 0) * gScaleX + gTx;
                const y1 = _parseSvgLength(el.attrs["y1"], 0) * gScaleY + gTy;
                const x2 = _parseSvgLength(el.attrs["x2"], 0) * gScaleX + gTx;
                const y2 = _parseSvgLength(el.attrs["y2"], 0) * gScaleY + gTy;
                const stroke = resolveColor(resolvedStyle["stroke"] ?? "black");
                const lw =
                    _parseSvgLength(resolvedStyle["stroke-width"], 1) *
                    Math.max(Math.abs(gScaleX), Math.abs(gScaleY));

                if (!stroke) {
                    break;
                }
                builder.saveState();
                applyStroke(stroke);
                builder.setLineWidth(psl(lw));
                builder.moveTo(px(x1), py(y1)).lineTo(px(x2), py(y2)).stroke();
                builder.restoreState();
                break;
            }

            case "text": {
                const rawFontSize = _parseSvgLength(
                    resolvedStyle["font-size"],
                    12
                );
                const fontSizeSvgX = rawFontSize * Math.abs(gScaleX);
                const fontSizeSvgY = rawFontSize * Math.abs(gScaleY);
                const fontSizePdfX = psx(fontSizeSvgX);
                const fontSizePdfY = psy(fontSizeSvgY);
                const baseX =
                    _parseSvgLength(el.attrs["x"], 0, rawFontSize) * gScaleX +
                    gTx;
                const baseY =
                    _parseSvgLength(el.attrs["y"], 0, rawFontSize) * gScaleY +
                    gTy;
                const fontInfo = resolveFont(resolvedStyle["font-family"]);
                const textAnchor = resolvedStyle["text-anchor"] ?? "start";
                const domBaseline =
                    resolvedStyle["dominant-baseline"] ?? "auto";
                const letterSpacingSvg =
                    _parseSvgLength(
                        resolvedStyle["letter-spacing"],
                        0,
                        rawFontSize
                    ) * Math.abs(gScaleX);
                const fillColor = resolveColor(
                    resolvedStyle["fill"] ?? "black"
                );
                const rawFill = resolvedStyle["fill"] ?? "black";
                const runs = collectTextRuns(el);

                if (
                    runs.length === 0 ||
                    !fillColor ||
                    fontSizePdfX <= 0 ||
                    fontSizePdfY <= 0
                ) {
                    break;
                }

                const textLayout = layoutTextGlyphsSvg(
                    runs,
                    fontSizeSvgX,
                    letterSpacingSvg,
                    fontInfo.metrics,
                    rawFontSize,
                    gScaleX,
                    gScaleY
                );
                let startX = baseX;
                const blockWidth = textLayout.width;
                if (textAnchor === "middle") {
                    startX -= blockWidth / 2;
                } else if (textAnchor === "end") {
                    startX -= blockWidth;
                }

                const isTopAnchoredBaseline =
                    domBaseline === "hanging" ||
                    domBaseline === "text-before-edge" ||
                    domBaseline === "before-edge";
                let baselineShiftSvg = 0;
                let topMetricUnits = 0;
                let bottomMetricUnits = 0;
                let topMetricSvg = fontSizeSvgY * 0.8;
                let bottomMetricSvg = 0;
                if (fontInfo.metrics) {
                    const ascenderUnits =
                        fontInfo.metrics.ascender > 0
                            ? fontInfo.metrics.ascender
                            : 0;
                    const capHeightUnits =
                        fontInfo.metrics.capHeight > 0
                            ? fontInfo.metrics.capHeight
                            : 0;
                    topMetricUnits =
                        ascenderUnits > 0
                            ? ascenderUnits
                            : capHeightUnits > 0
                            ? capHeightUnits
                            : fontInfo.metrics.unitsPerEm * 0.8;
                    bottomMetricUnits =
                        fontInfo.metrics.descender < 0
                            ? Math.abs(fontInfo.metrics.descender)
                            : 0;
                    topMetricSvg =
                        (topMetricUnits / fontInfo.metrics.unitsPerEm) *
                        fontSizeSvgY;
                    bottomMetricSvg =
                        (bottomMetricUnits / fontInfo.metrics.unitsPerEm) *
                        fontSizeSvgY;
                }
                if (isTopAnchoredBaseline) {
                    if (fontInfo.metrics) {
                        const ascenderUnits =
                            fontInfo.metrics.ascender > 0
                                ? fontInfo.metrics.ascender
                                : 0;
                        const capHeightUnits =
                            fontInfo.metrics.capHeight > 0
                                ? fontInfo.metrics.capHeight
                                : 0;
                        let hangingTopUnits = topMetricUnits;
                        if (ascenderUnits > 0 && capHeightUnits > 0) {
                            // Pure ascender puts the title too low.
                            // Pure cap-height puts it too high and can clip.
                            // A weighted midpoint matches SVG hanging/top-edge
                            // semantics better for all-caps display faces.
                            hangingTopUnits =
                                capHeightUnits +
                                (ascenderUnits - capHeightUnits) * 0.35;
                        } else if (capHeightUnits > 0) {
                            hangingTopUnits = capHeightUnits;
                        }
                        baselineShiftSvg =
                            (hangingTopUnits / fontInfo.metrics.unitsPerEm) *
                            fontSizeSvgY;
                    } else {
                        baselineShiftSvg = fontSizeSvgY * 0.74;
                        topMetricSvg = fontSizeSvgY * 0.8;
                        bottomMetricSvg = fontSizeSvgY * 0.2;
                    }
                }

                // Detect gradient fill — url(#gradId)
                const gradUrlMatch = /^url\(#([^)]+)\)$/.exec(rawFill);
                const gradDef = gradUrlMatch
                    ? defs.gradients.get(gradUrlMatch[1])
                    : null;

                if (gradDef && fontInfo.metrics) {
                    // -------------------------------------------------------
                    // Gradient letterform fill via text rendering mode 7.
                    // Mode 7 clips the graphics state to the glyph outline
                    // (invisible text). An axial shading fills inside that clip.
                    // One q/BT…ET/cm/sh/Q block per character so each glyph
                    // gets its own top-to-bottom gradient.
                    // -------------------------------------------------------
                    const shadName = _ensureShading(
                        state,
                        gradUrlMatch[1],
                        gradDef
                    );

                    const pdfTopMetric = psy(topMetricSvg);
                    const pdfBottomMetric = psy(bottomMetricSvg);

                    for (
                        let i = 0, len = textLayout.glyphs.length;
                        i < len;
                        i++
                    ) {
                        const glyph = textLayout.glyphs[i];
                        if (glyph.isWhitespace) {
                            continue;
                        }
                        const ch = glyph.ch;
                        const code = ch.charCodeAt(0) & 0xff;
                        const drawX = startX + glyph.x;
                        const drawY = baseY + glyph.y;
                        const pdfX = px(drawX);
                        const pdfY = py(drawY) - psy(baselineShiftSvg);
                        const pdfCharTop = isTopAnchoredBaseline
                            ? py(drawY)
                            : pdfY + pdfTopMetric;
                        const pdfCharH = isTopAnchoredBaseline
                            ? psy(baselineShiftSvg + bottomMetricSvg)
                            : pdfTopMetric + pdfBottomMetric;
                        const rawW = fontInfo.metrics.charWidths[code] || 550;
                        const pdfCharW = (rawW / 1000) * fontSizePdfX;

                        const pdfTextScaleX =
                            fontSizePdfY !== 0
                                ? fontSizePdfX / fontSizePdfY
                                : 1;

                        builder.saveState();
                        builder.rectangle(
                            pdfX,
                            pdfCharTop - pdfCharH,
                            pdfCharW,
                            pdfCharH
                        );
                        builder.operations.push("W n");
                        builder
                            .beginText()
                            .setFont(fontInfo.resourceName, fontSizePdfY)
                            .setTextRenderingMode(7)
                            .setTextMatrix(pdfTextScaleX, 0, 0, 1, pdfX, pdfY)
                            .showText(ch)
                            .endText();
                        builder
                            .transform(
                                pdfCharW,
                                0,
                                0,
                                -pdfCharH,
                                pdfX,
                                pdfCharTop
                            )
                            .paintShading(shadName)
                            .restoreState();
                    }
                } else {
                    // -------------------------------------------------------
                    // Solid fill path (flat colour or gradient fallback)
                    // -------------------------------------------------------

                    const pdfTextScaleX =
                        fontSizePdfY !== 0 ? fontSizePdfX / fontSizePdfY : 1;

                    builder.saveState();
                    applyFill(fillColor);
                    builder
                        .beginText()
                        .setFont(fontInfo.resourceName, fontSizePdfY);

                    for (
                        let i = 0, len = textLayout.glyphs.length;
                        i < len;
                        i++
                    ) {
                        const glyph = textLayout.glyphs[i];
                        if (glyph.isWhitespace) {
                            continue;
                        }
                        builder
                            .setTextMatrix(
                                pdfTextScaleX,
                                0,
                                0,
                                1,
                                px(startX + glyph.x),
                                py(baseY + glyph.y) - psy(baselineShiftSvg)
                            )
                            .showText(glyph.ch);
                    }
                }

                builder.endText();
                builder.restoreState();
                break;
            }

            case "image": {
                const svgX = _parseSvgLength(el.attrs["x"], 0) * gScaleX + gTx;
                const svgY = _parseSvgLength(el.attrs["y"], 0) * gScaleY + gTy;
                const w = _parseSvgLength(el.attrs["width"], 0) * gScaleX;
                const h = _parseSvgLength(el.attrs["height"], 0) * gScaleY;
                const href = el.attrs["href"] ?? el.attrs["xlink:href"] ?? "";

                if (!href || w === 0 || h === 0) {
                    break;
                }

                if (href.startsWith("data:image/")) {
                    const comma = href.indexOf(",");
                    if (comma !== -1) {
                        try {
                            const raw = href.slice(0, comma);
                            const b64 = href.slice(comma + 1);
                            const isPng = raw.includes("image/png");
                            const isJpeg =
                                raw.includes("image/jpeg") ||
                                raw.includes("image/jpg");

                            if (!isPng && !isJpeg) {
                                break;
                            }

                            const imgBytes = Uint8Array.from(
                                Buffer.from(b64, "base64")
                            );
                            const parsed = isPng
                                ? parsePng(imgBytes)
                                : parseJpeg(imgBytes);
                            const fit = fitImageBox(
                                w,
                                h,
                                parsed.width,
                                parsed.height,
                                el.attrs["preserveAspectRatio"]
                            );

                            const id = `DustImg_${
                                el.attrs["id"] ??
                                Math.random().toString(36).slice(2)
                            }`;
                            state.doc.embedImageXObject(id, imgBytes);
                            v(
                                `image ${id}: source=${parsed.width}x${
                                    parsed.height
                                } box=${w}x${h} draw=${fit.width}x${
                                    fit.height
                                } par=${
                                    el.attrs["preserveAspectRatio"] ??
                                    "(default)"
                                }`
                            );

                            builder.drawImage(
                                id,
                                px(svgX + fit.x),
                                py(svgY + fit.y + fit.height),
                                psx(fit.width),
                                psy(fit.height)
                            );
                        } catch (err) {
                            v(
                                `image warning: ${
                                    err instanceof Error
                                        ? err.message
                                        : String(err)
                                }`
                            );
                        }
                    }
                }
                break;
            }

            case "g": {
                const t = parseTransform(el.attrs["transform"]);
                const cx = gTx + t.tx * gScaleX;
                const cy = gTy + t.ty * gScaleY;
                const csx = gScaleX * t.scaleX;
                const csy = gScaleY * t.scaleY;
                for (let i = 0, len = el.children.length; i < len; i++) {
                    renderEl(el.children[i], cx, cy, csx, csy, resolvedStyle);
                }
                break;
            }

            default: {
                for (let i = 0, len = el.children.length; i < len; i++) {
                    renderEl(
                        el.children[i],
                        gTx,
                        gTy,
                        gScaleX,
                        gScaleY,
                        resolvedStyle
                    );
                }
                break;
            }
        }
    }

    renderEl(root, 0, 0, 1, 1, {});
}
