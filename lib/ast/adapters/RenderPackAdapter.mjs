/**
 * RenderPackAdapter - Adapts RenderPack rules to FormatAST
 *
 * This is the ONLY place snake_case ↔ camelCase conversion happens.
 * record-schema library speaks snake_case; AST library speaks camelCase.
 *
 * @module format-ast/adapters/RenderPackAdapter
 */

import { isArray } from "../../util/general.mjs";
import { isObject } from "../../util/objects.mjs";

/**
 * @typedef {import("../../types/general.mjs").Metadata} Metadata
 * @typedef {import("../types/core.mjs").TextStyle} TextStyle
 * @typedef {import("../types/core.mjs").Margins} Margins
 * @typedef {import("../types/core.mjs").SpacingPolicy} SpacingPolicy
 * @typedef {import("../types/core.mjs").RenderPackData} RenderPackData
 * @typedef {import("../types/core.mjs").RenderDocumentPolicy} RenderDocumentPolicy
 * @typedef {import("../types/core.mjs").RenderTarget} RenderTarget
 * @typedef {import("../types/core.mjs").RenderProfile} RenderProfile
 * @typedef {import("../types/core.mjs").ResolvedRenderConfig} ResolvedRenderConfig
 * @typedef {import("../types/core.mjs").MarginsConfig} MarginsConfig
 * @typedef {import("../types/core.mjs").HorizontalRuleConfig} HorizontalRuleConfig
 * @typedef {import("../types/core.mjs").FontsConfig} FontsConfig
 * @typedef {import("../types/core.mjs").RenderRuleset} RenderRuleset
 */

// =============================================================================
// Key conversion utilities
// =============================================================================

/**
 * Convert snake_case key to camelCase.
 * @param {string} key
 * @returns {string}
 */
function snakeToCamel(key) {
    return key.replace(/_([a-z])/g, (_, c) => c.toUpperCase());
}

/**
 * Convert camelCase key to snake_case.
 * @param {string} key
 * @returns {string}
 */
function camelToSnake(key) {
    return key
        .replace(/([a-z0-9])([A-Z])/g, "$1_$2")
        .replace(/([A-Z]+)([A-Z][a-z])/g, "$1_$2")
        .toLowerCase();
}

/**
 * @param {string} key
 * @returns {boolean}
 */
function shouldNormalizeKey(key) {
    // identifiers / file paths / registry keys
    if (key.includes("/") || key.includes(".") || key.includes("-")) {
        return false;
    }
    // doc type / kind keys like MMA, IND
    if (/^[A-Z0-9_]+$/.test(key)) {
        return false;
    }
    return /[A-Z]/.test(key);
}

/** @type {Set<string>} */
const MAP_PROPS = new Set([
    "targets",
    "render_profiles",
    "path_to_title",
    "document_kind_map",
    "cover_templates"
]);

/**
 * Deep-convert object keys from camelCase → snake_case.
 * Preserves map keys (targets, render_profiles, etc.).
 *
 * @param {unknown} value
 * @returns {unknown}
 */
function normalizeToSnake(value) {
    /**
     * @param {unknown} v
     * @param {boolean} do_keys
     * @returns {unknown}
     */
    const walk = (v, do_keys) => {
        if (isArray(v)) {
            const out = [];
            for (let i = 0, len = v.length; i < len; i++) {
                out.push(walk(v[i], true));
            }
            return out;
        }
        if (!isObject(v)) {
            return v;
        }

        /** @type {Record<string, unknown>} */
        const out = {};
        for (const key of Object.keys(v)) {
            const raw_val = v[key];
            const out_key =
                do_keys && shouldNormalizeKey(key) ? camelToSnake(key) : key;
            // Preserve map keys under known map properties.
            if (MAP_PROPS.has(out_key)) {
                if (isObject(raw_val)) {
                    /** @type {Record<string, unknown>} */
                    const map_out = {};
                    for (const map_key of Object.keys(raw_val)) {
                        map_out[map_key] = walk(raw_val[map_key], true);
                    }
                    out[out_key] = map_out;
                } else {
                    out[out_key] = raw_val;
                }
                continue;
            }
            out[out_key] = walk(raw_val, true);
        }
        return out;
    };

    return walk(value, true);
}

/**
 * Deep-convert object keys from snake_case → camelCase.
 * Used when passing resolved config to AST renderers.
 *
 * @param {unknown} value
 * @returns {unknown}
 */
export function toCamelCase(value) {
    if (isArray(value)) {
        const out = [];
        for (let i = 0, len = value.length; i < len; i++) {
            out.push(toCamelCase(value[i]));
        }
        return out;
    }
    if (!isObject(value)) {
        return value;
    }

    /** @type {Record<string, unknown>} */
    const out = {};
    for (const key of Object.keys(value)) {
        const camel = key.includes("_") ? snakeToCamel(key) : key;
        out[camel] = toCamelCase(value[key]);
    }
    return out;
}

// =============================================================================
// RenderPackAdapter
// =============================================================================

/**
 * Adapts RenderPack configuration to FormatAST types.
 *
 * Input:  raw pack data (may have camelCase legacy keys) → normalized to snake_case
 * Output: resolved configs converted to camelCase for AST renderers
 */
export class RenderPackAdapter {
    /**
     * @param {RenderPackData} pack
     */
    constructor(pack) {
        /** @type {RenderPackData} */
        this.pack = /** @type {RenderPackData} */ (normalizeToSnake(pack));

        /** @type {RenderDocumentPolicy} */
        this.policy = this.pack.document_policies || {};
    }

    // =========================================================================
    // Target Resolution
    // =========================================================================

    /**
     * Get raw target by ID
     * @param {string} target_id
     * @returns {RenderTarget | undefined}
     */
    getTarget(target_id) {
        return this.policy.targets?.[target_id];
    }

    /**
     * Get raw profile by ID
     * @param {string} profile_id
     * @returns {RenderProfile | undefined}
     */
    getProfile(profile_id) {
        return this.policy.render_profiles?.[profile_id];
    }

    /**
     * Resolve full config from profile (target + extends chain + overrides)
     * @param {string} profile_id
     * @returns {ResolvedRenderConfig | null}
     */
    resolveProfile(profile_id) {
        const profile = this.getProfile(profile_id);
        if (!profile) {
            return null;
        }

        const target = this.getTarget(profile.target);
        if (!target) {
            return null;
        }

        /** @type {ResolvedRenderConfig} */
        let config = { ...target };

        if (profile.extends) {
            const parent_config = this.resolveProfile(profile.extends);
            if (parent_config) {
                config = this._mergeConfigs(parent_config, config);
            }
        }

        if (profile.overrides) {
            config = this._mergeConfigs(config, profile.overrides);
        }

        return config;
    }

    /**
     * Resolve config from target directly (no profile)
     * @param {string} target_id
     * @returns {ResolvedRenderConfig | null}
     */
    resolveTarget(target_id) {
        const target = this.getTarget(target_id);
        if (!target) {
            return null;
        }
        return { ...target };
    }

    /**
     * Merge two configs (shallow merge, deep merge for nested objects)
     * @private
     * @param {Metadata} base
     * @param {Metadata} overlay
     * @returns {ResolvedRenderConfig}
     */
    _mergeConfigs(base, overlay) {
        /** @type {Metadata} */
        const result = { ...base };

        for (const key of Object.keys(overlay)) {
            const base_val = base[key];
            const overlay_val = overlay[key];

            if (isObject(base_val) && isObject(overlay_val)) {
                result[key] = {
                    .../** @type {object} */ (base_val),
                    .../** @type {object} */ (overlay_val)
                };
            } else {
                result[key] = overlay_val;
            }
        }

        return /** @type {ResolvedRenderConfig} */ (result);
    }

    // =========================================================================
    // Text Styles (computed from resolved config)
    // =========================================================================

    /**
     * Get base text style from resolved config
     * @param {ResolvedRenderConfig} config
     * @returns {TextStyle}
     */
    getBaseTextStyle(config) {
        /** @type {TextStyle} */
        const style = {};

        if (config.fonts?.regular) {
            style.fontFamily = config.fonts.regular;
        }
        if (config.base_font_size !== undefined) {
            style.fontSize = config.base_font_size;
        }
        if (config.line_spacing !== undefined) {
            style.lineHeight = config.line_spacing;
        }

        return style;
    }

    /**
     * Get heading style for level from resolved config
     * @param {ResolvedRenderConfig} config
     * @param {number} level - Heading level 1-6
     * @returns {TextStyle}
     */
    getHeadingStyle(config, level) {
        /** @type {TextStyle} */
        const style = {};

        if (config.fonts?.bold) {
            style.fontFamily = config.fonts.bold;
        }
        style.bold = true;

        const base_font_size = config.base_font_size || 10;
        const scale_key = `h${level}`;
        const scale = config.heading_scales?.[scale_key] || 1;
        style.fontSize = base_font_size * scale;

        if (level === 1 && config.title_font_size !== undefined) {
            style.fontSize = config.title_font_size;
        }

        return style;
    }

    /**
     * Get code/monospace style from resolved config
     * @param {ResolvedRenderConfig} config
     * @returns {TextStyle}
     */
    getCodeStyle(config) {
        /** @type {TextStyle} */
        const style = {};

        if (config.fonts?.monospace) {
            style.fontFamily = config.fonts.monospace;
        }
        if (config.base_font_size !== undefined) {
            style.fontSize = config.base_font_size * 0.9;
        }

        return style;
    }

    // =========================================================================
    // Page Configuration
    // =========================================================================

    /**
     * @param {ResolvedRenderConfig} config
     * @returns {MarginsConfig | undefined}
     */
    getMargins(config) {
        return config.margins;
    }

    /**
     * @param {ResolvedRenderConfig} config
     * @returns {HorizontalRuleConfig | undefined}
     */
    getHorizontalRuleConfig(config) {
        return config.horizontal_rule;
    }

    /**
     * @param {ResolvedRenderConfig} config
     * @returns {FontsConfig | undefined}
     */
    getFonts(config) {
        return config.fonts;
    }

    /**
     * @param {ResolvedRenderConfig} config
     * @returns {SpacingPolicy | undefined}
     */
    getSpacingPolicy(config) {
        const policy = config.spacing_policy;
        return policy && typeof policy === "object" ? policy : undefined;
    }

    // =========================================================================
    // Packet Config Helpers
    // =========================================================================

    /**
     * Safe access to packet_config from the loaded pack.
     * @returns {Metadata | null}
     */
    getPacketConfig() {
        const pc = /** @type {any} */ (this.pack).packet_config;
        return pc && typeof pc === "object" ? pc : null;
    }

    /**
     * Convert TOC level styles from snake_case (pack) → camelCase (renderer).
     *
     * @param {Record<number, Metadata> | undefined} level_styles
     * @returns {Record<number, Metadata> | null}
     */
    normalizeTocLevelStyles(level_styles) {
        if (!level_styles || !isObject(level_styles)) {
            return null;
        }

        /** @type {Record<number, Metadata>} */
        const out = {};
        for (const key of Object.keys(level_styles)) {
            const raw = level_styles[/** @type {any} */ (key)];
            if (!isObject(raw)) {
                out[/** @type {any} */ (key)] = raw;
                continue;
            }
            out[/** @type {any} */ (key)] = /** @type {Metadata} */ (
                toCamelCase(raw)
            );
        }
        return out;
    }

    // =========================================================================
    // Camel conversion for renderer output
    // =========================================================================

    /**
     * Convert a resolved cover config (snake_case from RenderPack) to camelCase
     * for consumption by TwoPassPdfRenderer.
     *
     * @param {import("../../record-schema/RenderPack.mjs").ResolvedCoverConfig} cover_config
     * @returns {{ suppressHeader?: boolean, suppressFooter?: boolean, suppressPageNumbering?: boolean, reserveHeaderFooterSpace?: boolean, watermark?: Metadata, coverLayout?: Metadata }}
     */
    coverConfigForRenderer(cover_config) {
        return {
            suppressHeader: cover_config.suppress_header,
            suppressFooter: cover_config.suppress_footer,
            suppressPageNumbering: cover_config.suppress_page_numbering,
            reserveHeaderFooterSpace: cover_config.reserve_header_footer_space,
            watermark: cover_config.watermark
                ? {
                      enabled: cover_config.watermark.enabled,
                      text: cover_config.watermark.text,
                      gray: cover_config.watermark.gray,
                      angleDeg: cover_config.watermark.angle_deg,
                      fontSize: cover_config.watermark.font_size
                  }
                : undefined,
            coverLayout: cover_config.cover_layout
        };
    }

    /**
     * Convert a snake_case CoverPageConfig (from CoverPageGenerator) to the
     * camelCase shape expected by the AST pipeline / TwoPassPdfRenderer.
     *
     * @param {import("../../record-schema/types/general.mjs").CoverPageConfig} cover_page
     * @returns {import("../types/core.mjs").CoverPageConfig}
     */
    coverPageForRenderer(cover_page) {
        /** @type {unknown[]} */
        const elements = [];
        if (isArray(cover_page.elements)) {
            for (let i = 0, len = cover_page.elements.length; i < len; i++) {
                elements.push(toCamelCase(cover_page.elements[i]));
            }
        }
        /** @type {Metadata} */
        const out = { elements };
        if (cover_page.page_config !== undefined) {
            out.pageConfig = toCamelCase(cover_page.page_config);
        }
        if (cover_page.counts_in_page_numbers !== undefined) {
            out.countsInPageNumbers = cover_page.counts_in_page_numbers;
        }
        if (cover_page.background_color !== undefined) {
            out.backgroundColor = cover_page.background_color;
        }
        if (cover_page.options !== undefined) {
            out.options = toCamelCase(cover_page.options);
        }
        return /** @type {import("../types/core.mjs").CoverPageConfig} */ (out);
    }

    /**
     * Convert a resolved signing config (snake_case from RenderPack) to camelCase
     * for consumption by TwoPassPdfRenderer.
     *
     * @param {import("../../record-schema/RenderPack.mjs").ResolvedSigningConfig} signing_config
     * @returns {import("../renderers/TwoPassPdfRenderer.mjs").SigningPageConfig}
     */
    signingConfigForRenderer(signing_config) {
        /** @type {import("../renderers/TwoPassPdfRenderer.mjs").SigningPageConfig} */
        const out = {
            enabled: signing_config.enabled,
            parties: signing_config.parties
        };
        if (signing_config.witness_clause !== undefined) {
            out.witnessClause = signing_config.witness_clause;
        }
        if (signing_config.execution_note !== undefined) {
            out.executionNote = signing_config.execution_note;
        }
        if (signing_config.acknowledgment_title !== undefined) {
            out.acknowledgmentTitle = signing_config.acknowledgment_title;
        }
        if (signing_config.acknowledgment_text !== undefined) {
            out.acknowledgmentText = signing_config.acknowledgment_text;
        }
        if (signing_config.layout !== undefined) {
            out.layout = signing_config.layout;
        }
        return out;
    }

    // =========================================================================
    // Rulesets
    // =========================================================================

    /**
     * Get matching ruleset for file
     * @param {{ rel_path: string, doc_type: string | null, ext: string | null }} file
     * @returns {RenderRuleset | null}
     */
    getMatchingRuleset(file) {
        const rulesets = this.policy.rulesets;
        if (!rulesets || !Array.isArray(rulesets)) {
            return null;
        }

        for (let i = 0, len = rulesets.length; i < len; i++) {
            const ruleset = rulesets[i];
            if (this._rulesetMatches(ruleset, file)) {
                return ruleset;
            }
        }

        return null;
    }

    /**
     * Resolve config for file (applies defaults + all matching rulesets in order,
     * then resolves profile/target).
     *
     * Rulesets are applied in order; later matches override earlier
     * (matches RenderPack.resolveFilePolicy behavior).
     *
     * @param {{ rel_path: string, doc_type: string | null, ext: string | null, is_root_file?: boolean }} file
     * @returns {ResolvedRenderConfig | null}
     */
    resolveForFile(file) {
        const rulesets = this.policy.rulesets;
        const defaults = this.policy.defaults;

        /** @type {Metadata} */
        let effective =
            defaults && typeof defaults === "object" && !Array.isArray(defaults)
                ? { ...defaults }
                : {};

        if (rulesets && Array.isArray(rulesets)) {
            for (let i = 0, len = rulesets.length; i < len; i++) {
                const ruleset = rulesets[i];
                if (!ruleset || typeof ruleset !== "object") {
                    continue;
                }
                if (!this._rulesetMatches(ruleset, file)) {
                    continue;
                }
                const render = /** @type {any} */ (ruleset).render;
                if (
                    render &&
                    typeof render === "object" &&
                    !Array.isArray(render)
                ) {
                    effective = this._mergeRender(effective, render);
                }
            }
        }

        const profile_id =
            typeof effective.render_profile_id === "string" &&
            effective.render_profile_id.length > 0
                ? effective.render_profile_id
                : typeof effective.profile === "string" &&
                  effective.profile.length > 0
                ? effective.profile
                : null;

        if (profile_id) {
            return this.resolveProfile(profile_id);
        }

        const target_id =
            typeof effective.target === "string" && effective.target.length > 0
                ? effective.target
                : Array.isArray(effective.targets) &&
                  effective.targets.length > 0
                ? String(effective.targets[0])
                : null;

        if (target_id) {
            return this.resolveTarget(target_id);
        }

        return null;
    }

    /**
     * Merge render directives (shallow merge; deep merge for .options).
     * @private
     * @param {Metadata} base
     * @param {Metadata} overlay
     * @returns {Metadata}
     */
    _mergeRender(base, overlay) {
        /** @type {Metadata} */
        const out = { ...base };

        for (const key of Object.keys(overlay)) {
            const overlay_val = overlay[key];
            if (key === "options") {
                const base_val = out[key];
                if (isObject(base_val) && isObject(overlay_val)) {
                    out[key] = {
                        .../** @type {object} */ (base_val),
                        .../** @type {object} */ (overlay_val)
                    };
                    continue;
                }
            }
            out[key] = overlay_val;
        }

        return out;
    }

    /**
     * @private
     * @param {string} rel_path
     * @param {string} glob
     * @returns {boolean}
     */
    _globMatches(rel_path, glob) {
        const re = this._globToRegExp(glob);
        return re.test(rel_path);
    }

    /**
     * Minimal glob-to-RegExp converter.
     * Supports: *, ?, **, and ** + '/' prefixes.
     *
     * @private
     * @param {string} glob
     * @returns {RegExp}
     */
    _globToRegExp(glob) {
        const g = String(glob).replace(/\\/g, "/");
        let out = "^";

        for (let i = 0; i < g.length; i++) {
            const c = g[i];

            if (c === "*") {
                const next = g[i + 1];
                if (next === "*") {
                    i++;
                    if (g[i + 1] === "/") {
                        i++;
                        out += "(?:.*\\/)?";
                    } else {
                        out += ".*";
                    }
                } else {
                    out += "[^/]*";
                }
                continue;
            }

            if (c === "?") {
                out += "[^/]";
                continue;
            }

            if ("\\.^$+()[]{}|".includes(c)) {
                out += `\\${c}`;
            } else {
                out += c;
            }
        }

        out += "$";
        return new RegExp(out);
    }

    /**
     * Check if ruleset matches file.
     * Accepts snake_case file descriptors (canonical for record-schema).
     *
     * @private
     * @param {RenderRuleset} ruleset
     * @param {{ rel_path: string, doc_type: string | null, ext: string | null, is_root_file?: boolean }} file
     * @returns {boolean}
     */
    _rulesetMatches(ruleset, file) {
        const sel = ruleset.selectors;
        if (!sel) {
            return true;
        }

        const rel_path =
            typeof file.rel_path === "string"
                ? file.rel_path.replace(/\\/g, "/")
                : "";

        const is_root_file =
            typeof file.is_root_file === "boolean"
                ? file.is_root_file
                : rel_path.length > 0
                ? !rel_path.includes("/")
                : false;

        if (sel.is_root_file === true && !is_root_file) {
            return false;
        }

        if (Array.isArray(sel.paths_glob) && sel.paths_glob.length > 0) {
            let ok = false;
            for (let i = 0, len = sel.paths_glob.length; i < len; i++) {
                const glob = sel.paths_glob[i];
                if (typeof glob !== "string" || glob.length === 0) {
                    continue;
                }
                if (this._globMatches(rel_path, glob)) {
                    ok = true;
                    break;
                }
            }
            if (!ok) {
                return false;
            }
        }

        if (Array.isArray(sel.doc_types) && sel.doc_types.length > 0) {
            if (!file.doc_type || !sel.doc_types.includes(file.doc_type)) {
                return false;
            }
        }

        if (Array.isArray(sel.extensions) && sel.extensions.length > 0) {
            if (!file.ext) {
                return false;
            }
            const ext_lower = String(file.ext).replace(/^\./, "").toLowerCase();
            if (
                !sel.extensions.some(
                    (e) =>
                        String(e).replace(/^\./, "").toLowerCase() === ext_lower
                )
            ) {
                return false;
            }
        }

        return true;
    }
}

/**
 * Create adapter from pack data
 * @param {RenderPackData} pack
 * @returns {RenderPackAdapter}
 */
export function createRenderPackAdapter(pack) {
    return new RenderPackAdapter(pack);
}
