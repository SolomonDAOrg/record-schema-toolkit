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

import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { parseSvg } from "../../parsing/svg.mjs";

/**
 * @typedef {import("../../parsing/svg.mjs").SvgElement} SvgElement
 */

// =============================================================================
// Type definitions
// =============================================================================

/**
 * Pre-parsed dust cover page ready to hand to the PDF renderer.
 *
 * @typedef {Object} DustCoverPage
 * @property {SvgElement} root       - Parsed SVG element tree.
 * @property {number} svgWidth   - viewBox width (SVG user units).
 * @property {number} svgHeight  - viewBox height (SVG user units).
 * @property {Map<string, string>} fontPaths  - font-family -> temp file path.
 */

/**
 * @typedef {Object} ProcessDustCoverOptions
 * @property {string | null} [cacheDir] - Disk cache dir for font binaries.
 *                                        Default ".solomon-font-cache". Pass null to disable.
 * @property {boolean} [verbose]  - Log fetch operations.
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
// Google Fonts fetching
// =============================================================================

const RE_IMPORT_URL = /@import\s+url\(['"]?(https?:\/\/[^'")\s]+)['"]?\)\s*;?/g;
const RE_FONT_FACE = /@font-face\s*\{([^}]+)\}/g;
const RE_FAMILY_RULE = /font-family:\s*['"]?([^;'"]+)['"]?/;
const RE_SRC_URL = /url\(['"]?(https?:\/\/[^'")\s]+)['"]?\)/;

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
 * @param {Record<string, string>} [headers]
 * @returns {Promise<Buffer>}
 */
async function _fetchBuf(url, headers) {
    const res = await fetch(url, {
        headers: {
            "User-Agent": "Mozilla/5.0 (compatible; SolomonDocsPipeline/1.0)",
            ...(headers ?? {})
        }
    });
    if (!res.ok) {
        throw new Error(`HTTP ${res.status}: ${url}`);
    }
    return Buffer.from(await res.arrayBuffer());
}

/**
 * Fetch a font binary, using the disk cache when available.
 * @param {string} url
 * @param {string | null} cacheDir
 * @param {boolean} verbose
 * @returns {Promise<Buffer>}
 */
async function _fetchFont(url, cacheDir, verbose) {
    const cp = _cachePath(cacheDir, url);
    if (cp) {
        try {
            if (existsSync(cp)) {
                if (verbose) {
                    console.log(`[DustCover] font cache hit: ${url}`);
                }
                return readFileSync(cp);
            }
        } catch {
            /* ignore */
        }
    }
    if (verbose) {
        console.log(`[DustCover] fetching font: ${url}`);
    }
    const buf = await _fetchBuf(url);
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
 * Fetch all Google Fonts families referenced in SVG \@import rules.
 * Returns a map of font-family -> absolute temp file path for PDFKit.registerFont().
 *
 * Only the first URL per @font-face block is fetched (woff2 preferred by Google's
 * CSS response for modern UA headers).
 *
 * @param {string} svgContent
 * @param {string | null} cacheDir
 * @param {boolean} verbose
 * @returns {Promise<Map<string, string>>}
 */
async function _fetchGoogleFonts(svgContent, cacheDir, verbose) {
    /** @type {Map<string, string>} */
    const out = new Map();

    const importUrls = [];
    let m;
    RE_IMPORT_URL.lastIndex = 0;
    while ((m = RE_IMPORT_URL.exec(svgContent)) !== null) {
        importUrls.push(m[1].replace(/&amp;/g, "&"));
    }

    for (let u = 0, ulen = importUrls.length; u < ulen; u++) {
        let cssText;
        try {
            if (verbose) {
                console.log(`[DustCover] fetching CSS: ${importUrls[u]}`);
            }
            cssText = (
                await _fetchBuf(importUrls[u], { Accept: "text/css,*/*;q=0.1" })
            ).toString("utf8");
        } catch (err) {
            console.warn(`[DustCover] warn: ${err.message}`);
            continue;
        }

        RE_FONT_FACE.lastIndex = 0;
        let face;
        while ((face = RE_FONT_FACE.exec(cssText)) !== null) {
            const body = face[1];

            const famMatch = RE_FAMILY_RULE.exec(body);
            if (!famMatch) {
                continue;
            }
            const family = famMatch[1].replace(/['"]/g, "").trim();
            if (out.has(family)) {
                continue;
            }

            const srcMatch = RE_SRC_URL.exec(body);
            if (!srcMatch) {
                continue;
            }
            const fontUrl = srcMatch[1];

            try {
                const buf = await _fetchFont(fontUrl, cacheDir, verbose);
                const ext = fontUrl.endsWith(".woff2")
                    ? "woff2"
                    : fontUrl.endsWith(".woff")
                    ? "woff"
                    : fontUrl.endsWith(".ttf")
                    ? "ttf"
                    : "otf";
                const safe = family.replace(/[^a-zA-Z0-9_-]/g, "_");
                const tmpPath = join(tmpdir(), `solomon_dust_${safe}.${ext}`);
                writeFileSync(tmpPath, buf);
                out.set(family, tmpPath);
                if (verbose) {
                    console.log(`[DustCover] font "${family}" -> ${tmpPath}`);
                }
            } catch (err) {
                console.warn(
                    `[DustCover] warn: font "${family}": ${err.message}`
                );
            }
        }
    }

    return out;
}

// =============================================================================
// viewBox extraction
// =============================================================================

/**
 * @param {SvgElement} root
 * @returns {{ width: number, height: number }}
 */
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
                    width: Number.parseFloat(parts[2]),
                    height: Number.parseFloat(parts[3])
                };
            }
        }
        return {
            width: Number.parseFloat(el.attrs["width"] ?? "0"),
            height: Number.parseFloat(el.attrs["height"] ?? "0")
        };
    }
    return { width: 0, height: 0 };
}

// =============================================================================
// Public API — processDustCover
// =============================================================================

/**
 * Parse and prepare a dust-cover SVG for native PDF rendering.
 *
 * @param {string} svgContent
 * @param {ProcessDustCoverOptions} [options]
 * @returns {Promise<DustCoverPage>}
 */
export async function processDustCover(svgContent, options) {
    const cacheDir =
        options?.cacheDir !== undefined
            ? options.cacheDir
            : ".solomon-font-cache";
    const verbose = options?.verbose ?? false;

    if (cacheDir) {
        try {
            mkdirSync(cacheDir, { recursive: true });
        } catch {
            /* ignore */
        }
    }

    const root = parseSvg(svgContent);
    const { width: svgWidth, height: svgHeight } = _extractViewBox(root);
    const fontPaths = await _fetchGoogleFonts(
        svgContent,
        cacheDir ?? null,
        verbose
    );

    return { root, svgWidth, svgHeight, fontPaths };
}

// =============================================================================
// PDF rendering — called from TwoPassPdfRenderer.renderDustCoverPage()
// =============================================================================

/**
 * Render a DustCoverPage onto a PDF content stream builder using native PDF ops.
 *
 * Font registration:
 *   Calls `state.doc.registerFont(alias, path)` using the two-argument form.
 *   If PdfDocumentBuilder.registerFont currently only accepts one argument
 *   (a path with the family name embedded), add the two-argument overload:
 *
 *       registerFont(name, src) {
 *           if (src !== undefined) {
 *               this._doc.registerFont(name, src);
 *           } else {
 *               this._doc.registerFont(name);
 *           }
 *       }
 *
 * Image embedding (optional):
 *   If PdfDocumentBuilder exposes `embedImageXObject(name, buf)` and
 *   PdfContentStreamBuilder exposes `drawXObject(name, x, y, w, h)`, base64
 *   inline images will be embedded.  When absent they are silently skipped —
 *   the surrounding border rect remains visible as a placeholder.
 *
 * @param {DustCoverPage} dustCoverPage
 * @param {object}        builder   - PdfContentStreamBuilder instance.
 * @param {{ doc: any, pageWidth: number, pageHeight: number }} state
 * @returns {void}
 */
export function renderSvgToPdf(dustCoverPage, builder, state) {
    const { root, svgWidth, svgHeight, fontPaths } = dustCoverPage;
    const { pageWidth, pageHeight } = state;

    // Register dust-cover fonts with PDFKit
    fontPaths.forEach((path, family) => {
        try {
            state.doc.registerFont(family, path);
        } catch {
            /* non-fatal fallback to Helvetica */
        }
    });

    // Uniform scale + centering offsets.
    // SVG: origin top-left, y increases downward.
    // PDF: origin bottom-left, y increases upward.
    const scale =
        svgWidth > 0 && svgHeight > 0
            ? Math.min(pageWidth / svgWidth, pageHeight / svgHeight)
            : 1;
    const offsetX = (pageWidth - svgWidth * scale) / 2;
    const offsetY = (pageHeight - svgHeight * scale) / 2;

    const defs = _extractDefs(root);

    /** SVG user-unit x -> PDF x */
    const px = (/** @type {number} */ sx) => offsetX + sx * scale;
    /** SVG user-unit y -> PDF y */
    const py = (/** @type {number} */ sy) => pageHeight - offsetY - sy * scale;
    /** Scale a length value */
    const ps = (/** @type {number} */ v) => v * scale;

    /**
     * Resolve a fill/stroke attribute to a hex string, or null for "none".
     * url(#id) references resolve through linearGradient defs.
     *
     * @param {string | undefined} val
     * @returns {string | null}
     */
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

    /** @param {string} color */
    function applyFill(color) {
        const { r, g, b } = _hexToRgb(
            color.startsWith("#") ? color : `#${color}`
        );
        builder.setFillColor(r / 255, g / 255, b / 255);
    }

    /** @param {string} color */
    function applyStroke(color) {
        const { r, g, b } = _hexToRgb(
            color.startsWith("#") ? color : `#${color}`
        );
        builder.setStrokeColor(r / 255, g / 255, b / 255);
    }

    /**
     * Decode a `transform` attribute into translate + scale components.
     * Handles translate(x y|x,y) and scale(s|sx,sy).
     *
     * @param {string | undefined} t
     * @returns {{ tx: number, ty: number, scaleX: number, scaleY: number }}
     */
    function parseTransform(t) {
        let tx = 0,
            ty = 0,
            scaleX = 1,
            scaleY = 1;
        if (!t) {
            return { tx, ty, scaleX, scaleY };
        }
        const tr = /translate\(\s*([-\d.]+)[\s,]+([-\d.]+)\s*\)/.exec(t);
        if (tr) {
            tx = Number.parseFloat(tr[1]);
            ty = Number.parseFloat(tr[2]);
        }
        const sc = /scale\(\s*([-\d.]+)(?:[\s,]+([-\d.]+))?\s*\)/.exec(t);
        if (sc) {
            scaleX = Number.parseFloat(sc[1]);
            scaleY = sc[2] !== undefined ? Number.parseFloat(sc[2]) : scaleX;
        }
        return { tx, ty, scaleX, scaleY };
    }

    /**
     * Collect all visible text from a <text> / <tspan> subtree.
     * Per-character tspan wrapping (dx=0 dy=0) is flattened into a single string.
     *
     * @param {SvgElement} el
     * @returns {string}
     */
    function collectText(el) {
        let s = el.text;
        for (let i = 0, len = el.children.length; i < len; i++) {
            const c = el.children[i];
            if (c.tag === "tspan") {
                s += c.text + collectText(c);
            }
        }
        return s;
    }

    /**
     * Resolve font-family to a registered alias, or fall back to Helvetica.
     * @param {string | undefined} family
     * @returns {string}
     */
    function resolveFont(family) {
        if (!family) {
            return "Helvetica";
        }
        const first = family.split(",")[0].trim().replace(/['"]/g, "");
        return fontPaths.has(first) ? first : "Helvetica";
    }

    /**
     * Recursively render SVG elements onto the PDF content stream.
     *
     * gTx / gTy accumulate SVG-space translations from ancestor <g> elements
     * so coordinate conversion happens once at draw time.
     *
     * @param {SvgElement} el
     * @param {number} gTx  - Accumulated SVG-space X translation.
     * @param {number} gTy  - Accumulated SVG-space Y translation.
     */
    function renderEl(el, gTx, gTy) {
        switch (el.tag) {
            case "svg":
            case "#root":
            case "defs":
            case "style": {
                for (let i = 0, len = el.children.length; i < len; i++) {
                    renderEl(el.children[i], gTx, gTy);
                }
                break;
            }

            case "rect": {
                const x = Number.parseFloat(el.attrs["x"] ?? "0") + gTx;
                const y = Number.parseFloat(el.attrs["y"] ?? "0") + gTy;
                const w = Number.parseFloat(el.attrs["width"] ?? "0");
                const h = Number.parseFloat(el.attrs["height"] ?? "0");

                const fill = resolveColor(el.attrs["fill"] ?? "black");
                const stroke = resolveColor(el.attrs["stroke"] ?? null);
                const lw = Number.parseFloat(el.attrs["stroke-width"] ?? "1");

                // PDF rect origin is the bottom-left corner of the rectangle
                const pdfX = px(x);
                const pdfY = py(y + h);
                const pdfW = ps(w);
                const pdfH = ps(h);

                builder.saveState();
                if (fill && fill !== "none") {
                    applyFill(fill);
                    builder.rectangle(pdfX, pdfY, pdfW, pdfH).fill();
                }
                if (stroke && stroke !== "none") {
                    applyStroke(stroke);
                    builder.setLineWidth(ps(lw));
                    builder.rectangle(pdfX, pdfY, pdfW, pdfH).stroke();
                }
                builder.restoreState();
                break;
            }

            case "line": {
                const x1 = Number.parseFloat(el.attrs["x1"] ?? "0") + gTx;
                const y1 = Number.parseFloat(el.attrs["y1"] ?? "0") + gTy;
                const x2 = Number.parseFloat(el.attrs["x2"] ?? "0") + gTx;
                const y2 = Number.parseFloat(el.attrs["y2"] ?? "0") + gTy;
                const stroke = resolveColor(el.attrs["stroke"] ?? "black");
                const lw = Number.parseFloat(el.attrs["stroke-width"] ?? "1");

                if (!stroke) {
                    break;
                }
                builder.saveState();
                applyStroke(stroke);
                builder.setLineWidth(ps(lw));
                builder.moveTo(px(x1), py(y1)).lineTo(px(x2), py(y2)).stroke();
                builder.restoreState();
                break;
            }

            case "text": {
                const svgX = Number.parseFloat(el.attrs["x"] ?? "0") + gTx;
                const svgY = Number.parseFloat(el.attrs["y"] ?? "0") + gTy;

                const fontSize = Number.parseFloat(
                    el.attrs["font-size"] ?? "12"
                );
                const fontName = resolveFont(el.attrs["font-family"]);
                const textAnchor = el.attrs["text-anchor"] ?? "start";
                const domBaseline = el.attrs["dominant-baseline"] ?? "auto";
                const fillColor = resolveColor(el.attrs["fill"] ?? "black");
                const text = collectText(el);

                if (!text || !fillColor) {
                    break;
                }

                // Approximate text width for anchor alignment.
                // 0.55 em per character is a safe mean across most fonts.
                const approxW = text.length * ps(fontSize) * 0.55;
                let pdfX = px(svgX);
                if (textAnchor === "middle") {
                    pdfX -= approxW / 2;
                } else if (textAnchor === "end") {
                    pdfX -= approxW;
                }

                // dominant-baseline="hanging": y marks the top of the em box.
                // PDF text origin is the baseline, so shift downward by ~1 em.
                const baselineShift =
                    domBaseline === "hanging" ? ps(fontSize) : 0;
                const pdfY = py(svgY) - baselineShift;

                builder.saveState();
                applyFill(fillColor);
                builder
                    .beginText()
                    .setFont(fontName, ps(fontSize))
                    .setTextMatrix(1, 0, 0, 1, pdfX, pdfY)
                    .showText(text)
                    .endText();
                builder.restoreState();
                break;
            }

            case "image": {
                const svgX = Number.parseFloat(el.attrs["x"] ?? "0") + gTx;
                const svgY = Number.parseFloat(el.attrs["y"] ?? "0") + gTy;
                const w = Number.parseFloat(el.attrs["width"] ?? "0");
                const h = Number.parseFloat(el.attrs["height"] ?? "0");
                const href = el.attrs["href"] ?? el.attrs["xlink:href"] ?? "";

                if (!href || w === 0 || h === 0) {
                    break;
                }

                if (href.startsWith("data:image/")) {
                    const comma = href.indexOf(",");
                    if (comma !== -1) {
                        try {
                            const imgBuf = Buffer.from(
                                href.slice(comma + 1),
                                "base64"
                            );
                            // Embed only when PdfDocumentBuilder and PdfContentStreamBuilder
                            // expose XObject support.  See renderDustCoverPage notes.
                            if (
                                typeof state.doc.embedImageXObject ===
                                    "function" &&
                                typeof builder.drawXObject === "function"
                            ) {
                                const id = `DustImg_${
                                    el.attrs["id"] ??
                                    Math.random().toString(36).slice(2)
                                }`;
                                state.doc.embedImageXObject(id, imgBuf);
                                builder.drawXObject(
                                    id,
                                    px(svgX),
                                    py(svgY + h),
                                    ps(w),
                                    ps(h)
                                );
                            }
                        } catch {
                            /* non-fatal */
                        }
                    }
                }
                break;
            }

            case "g": {
                // Accumulate SVG-space translations; scale(1) is a no-op.
                const t = parseTransform(el.attrs["transform"]);
                const cx = gTx + t.tx;
                const cy = gTy + t.ty;
                for (let i = 0, len = el.children.length; i < len; i++) {
                    renderEl(el.children[i], cx, cy);
                }
                break;
            }

            default: {
                // Pass through unknown elements — walk children
                for (let i = 0, len = el.children.length; i < len; i++) {
                    renderEl(el.children[i], gTx, gTy);
                }
                break;
            }
        }
    }

    renderEl(root, 0, 0);
}
