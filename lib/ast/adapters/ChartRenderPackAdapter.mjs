/**
 * ChartRenderPackAdapter - Adapts render pack chart styles to chart AST
 * Resolves themes, classes, and target configs from render packs
 * @module format-ast/chart/ChartRenderPackAdapter
 */

import { CHART_RENDER_TARGETS } from "../constants/chart.mjs";

/**
 * @typedef {import("../types/chart.mjs").ChartRenderTarget} ChartRenderTarget
 * @typedef {import("../types/chart.mjs").ChartRenderPackData} ChartRenderPackData
 * @typedef {import("../types/chart.mjs").ChartDocumentPolicies} ChartDocumentPolicies
 * @typedef {import("../types/chart.mjs").ChartTheme} ChartTheme
 * @typedef {import("../types/chart.mjs").ChartRuleset} ChartRuleset
 * @typedef {import("../types/chart.mjs").ResolvedEdgeStyle} ResolvedEdgeStyle
 * @typedef {import("../types/chart.mjs").ResolvedChartConfig} ResolvedChartConfig
 * @typedef {import("../types/chart.mjs").ResolvedChartStyle} ResolvedChartStyle
 * @typedef {import("../types/chart.mjs").ChartClass} ChartClass
 * @typedef {import("../types/chart.mjs").ChartEdgeClass} ChartEdgeClass
 * @typedef {import("../types/chart.mjs").ChartTargetConfig} ChartTargetConfig
 * @typedef {import("../types/chart.mjs").ChartRenderProfile} ChartRenderProfile
 */

// =============================================================================
// ChartRenderPackAdapter
// =============================================================================

/**
 * Adapter for chart-specific render pack configuration
 */
export class ChartRenderPackAdapter {
    /**
     * @param {ChartRenderPackData | ChartRenderPackData[]} packs - Single pack or array (later overrides earlier)
     */
    constructor(packs) {
        /** @type {ChartRenderPackData[]} */
        this.packs = Array.isArray(packs) ? packs : [packs];

        /** @type {ChartDocumentPolicies} */
        this._merged = this._mergePacks();
    }

    /**
     * Merge multiple packs (later overrides earlier)
     * @returns {ChartDocumentPolicies}
     */
    _mergePacks() {
        /** @type {ChartDocumentPolicies} */
        const merged = {
            chart_themes: {},
            chart_classes: {},
            chart_edge_classes: {},
            chart_targets: {},
            render_profiles: {},
            rulesets: []
        };

        for (let i = 0, len = this.packs.length; i < len; i++) {
            const pack = this.packs[i];
            const policies = pack.document_policies;
            if (!policies) {
                continue;
            }

            // Merge themes
            if (policies.chart_themes) {
                for (const key of Object.keys(policies.chart_themes)) {
                    merged.chart_themes[key] = {
                        ...merged.chart_themes[key],
                        ...policies.chart_themes[key]
                    };
                }
            }

            // Merge classes
            if (policies.chart_classes) {
                for (const key of Object.keys(policies.chart_classes)) {
                    merged.chart_classes[key] = {
                        ...merged.chart_classes[key],
                        ...policies.chart_classes[key]
                    };
                }
            }

            // Merge edge classes
            if (policies.chart_edge_classes) {
                for (const key of Object.keys(policies.chart_edge_classes)) {
                    merged.chart_edge_classes[key] = {
                        ...merged.chart_edge_classes[key],
                        ...policies.chart_edge_classes[key]
                    };
                }
            }

            // Merge targets
            if (policies.chart_targets) {
                for (const key of Object.keys(policies.chart_targets)) {
                    merged.chart_targets[key] = {
                        ...merged.chart_targets[key],
                        ...policies.chart_targets[key]
                    };
                }
            }

            // Merge profiles
            if (policies.render_profiles) {
                for (const key of Object.keys(policies.render_profiles)) {
                    merged.render_profiles[key] = {
                        ...merged.render_profiles[key],
                        ...policies.render_profiles[key]
                    };
                }
            }

            // Append rulesets
            if (policies.rulesets) {
                merged.rulesets.push(...policies.rulesets);
            }
        }

        return merged;
    }

    // =========================================================================
    // Theme Access
    // =========================================================================

    /**
     * Get theme by name
     * @param {string} themeName
     * @returns {ChartTheme | null}
     */
    getTheme(themeName) {
        return this._merged.chart_themes?.[themeName] || null;
    }

    /**
     * Get all theme names
     * @returns {string[]}
     */
    getThemeNames() {
        return Object.keys(this._merged.chart_themes || {});
    }

    /**
     * Get default theme name
     * @returns {string}
     */
    getDefaultThemeName() {
        return "default";
    }

    // =========================================================================
    // Class Access
    // =========================================================================

    /**
     * Get node class definition
     * @param {string} className
     * @returns {ChartClass | null}
     */
    getClass(className) {
        return this._merged.chart_classes?.[className] || null;
    }

    /**
     * Get edge class definition
     * @param {string} className
     * @returns {ChartEdgeClass | null}
     */
    getEdgeClass(className) {
        return this._merged.chart_edge_classes?.[className] || null;
    }

    /**
     * Resolve class with inheritance (extends)
     * @param {string} className
     * @returns {ResolvedChartStyle}
     */
    resolveClass(className) {
        const classData = this.getClass(className);
        if (!classData) {
            return {};
        }

        // Handle extends
        /** @type {ResolvedChartStyle} */
        let resolved = {};

        if (classData.extends) {
            for (let i = 0, len = classData.extends.length; i < len; i++) {
                const parent = this.resolveClass(classData.extends[i]);
                resolved = { ...resolved, ...parent };
            }
        }

        /** @type {number=} */
        let fontSize;

        if (typeof classData.font_size === "string") {
            fontSize = parseInt(classData.font_size);
        } else {
            fontSize = classData.font_size;
        }

        // Apply own properties
        return {
            ...resolved,
            fill: classData.fill,
            stroke: classData.stroke,
            strokeWidth: classData.stroke_width,
            strokeDasharray: classData.stroke_dasharray,
            textColor: classData.text_color,
            fontFamily: classData.font_family,
            fontSize: fontSize,
            shape: classData.shape
        };
    }

    /**
     * Resolve edge class
     * @param {string} className
     * @returns {ResolvedEdgeStyle}
     */
    resolveEdgeClass(className) {
        const classData = this.getEdgeClass(className);
        if (!classData) {
            return {};
        }

        /** @type {number=} */
        let fontSize;

        if (typeof classData.font_size === "string") {
            fontSize = parseInt(classData.font_size);
        } else {
            fontSize = classData.font_size;
        }

        return {
            stroke: classData.stroke,
            strokeWidth: classData.stroke_width,
            strokeDasharray: classData.stroke_dasharray,
            textColor: classData.text_color,
            fontSize: fontSize
        };
    }

    // =========================================================================
    // Target Access
    // =========================================================================

    /**
     * Get target configuration
     * @param {string} targetName
     * @returns {ChartTargetConfig | null}
     */
    getTargetConfig(targetName) {
        return this._merged.chart_targets?.[targetName] || null;
    }

    /**
     * Get all target names
     * @returns {string[]}
     */
    getTargetNames() {
        return Object.keys(this._merged.chart_targets || {});
    }

    // =========================================================================
    // Profile Access
    // =========================================================================

    /**
     * Get render profile
     * @param {string} profileId
     * @returns {ChartRenderProfile | null}
     */
    getProfile(profileId) {
        return this._merged.render_profiles?.[profileId] || null;
    }

    /**
     * Get all profile IDs
     * @returns {string[]}
     */
    getProfileIds() {
        return Object.keys(this._merged.render_profiles || {});
    }

    // =========================================================================
    // Ruleset Matching
    // =========================================================================

    /**
     * Find matching ruleset for file
     * @param {{ relPath?: string, docType?: string | null, ext?: string | null }} file
     * @returns {ChartRuleset | null}
     */
    getMatchingRuleset(file) {
        const rulesets = this._merged.rulesets;
        if (!rulesets || rulesets.length === 0) {
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
     * Check if ruleset matches file
     * @param {ChartRuleset} ruleset
     * @param {{ relPath?: string, docType?: string | null, ext?: string | null }} file
     * @returns {boolean}
     */
    _rulesetMatches(ruleset, file) {
        const sel = ruleset.selectors;
        if (!sel) {
            return true; // No selectors = matches all
        }

        // Check extensions
        if (sel.extensions && sel.extensions.length > 0) {
            const ext = file.ext?.toLowerCase();
            if (!ext) {
                return false;
            }
            const matches = sel.extensions.some(
                (e) =>
                    ext === e.toLowerCase() ||
                    ext.endsWith(`.${e.toLowerCase()}`)
            );
            if (!matches) {
                return false;
            }
        }

        // Check doc types
        if (sel.doc_types && sel.doc_types.length > 0) {
            if (!file.docType) {
                return false;
            }
            if (!sel.doc_types.includes(file.docType)) {
                return false;
            }
        }

        return true;
    }

    // =========================================================================
    // Resolution
    // =========================================================================

    /**
     * Resolve chart configuration for a file
     * @param {{ relPath?: string, docType?: string | null, ext?: string | null }} file
     * @returns {ResolvedChartConfig}
     */
    resolveForFile(file) {
        const ruleset = this.getMatchingRuleset(file);
        const render = ruleset?.render;

        const themeName = render?.chart_theme || this.getDefaultThemeName();
        const themeData = this.getTheme(themeName) || {};

        const targets = render?.chart_targets || [CHART_RENDER_TARGETS.SVG];

        /** @type {Record<string, ChartTargetConfig>} */
        const targetConfigs = {};
        for (let i = 0, len = targets.length; i < len; i++) {
            const target = targets[i];
            const config = this.getTargetConfig(target);
            if (config) {
                targetConfigs[target] = config;
            }
        }

        return {
            targets,
            theme: themeName,
            themeData,
            targetConfigs
        };
    }

    /**
     * Resolve for render profile
     * @param {string} profileId
     * @returns {ResolvedChartConfig | null}
     */
    resolveForProfile(profileId) {
        const profile = this.getProfile(profileId);
        if (!profile) {
            return null;
        }

        const themeName = profile.chart_theme || this.getDefaultThemeName();
        const themeData = this.getTheme(themeName) || {};

        const targets = profile.chart_targets || [CHART_RENDER_TARGETS.SVG];

        /** @type {Record<string, ChartTargetConfig>} */
        const targetConfigs = {};
        for (let i = 0, len = targets.length; i < len; i++) {
            const target = targets[i];
            const config = this.getTargetConfig(target);
            if (config) {
                targetConfigs[target] = config;
            }
        }

        return {
            targets,
            theme: themeName,
            themeData,
            targetConfigs
        };
    }

    // =========================================================================
    // Style Application
    // =========================================================================

    /**
     * Get node style from theme and optional class
     * @param {string} themeName
     * @param {string} [className]
     * @returns {ResolvedChartStyle}
     */
    getNodeStyle(themeName, className) {
        const theme = this.getTheme(themeName);
        const defaults = theme?.node_defaults || {};

        /** @type {ResolvedChartStyle} */
        let style = {
            fill: defaults.fill,
            stroke: defaults.stroke,
            strokeWidth: defaults.strokeWidth,
            strokeDasharray: defaults.strokeDasharray,
            textColor: defaults.textColor,
            fontFamily: defaults.fontFamily,
            fontSize: defaults.fontSize
        };

        // Apply class overrides
        if (className) {
            const classStyle = this.resolveClass(className);
            style = { ...style, ...classStyle };
        }

        return style;
    }

    /**
     * Get edge style from theme and optional class
     * @param {string} themeName
     * @param {string} [className]
     * @returns {ResolvedEdgeStyle}
     */
    getEdgeStyle(themeName, className) {
        const theme = this.getTheme(themeName);
        const defaults = theme?.edge_defaults || {};

        /** @type {ResolvedEdgeStyle} */
        let style = {
            stroke: defaults.stroke,
            strokeWidth: defaults.strokeWidth
        };

        // Apply class overrides
        if (className) {
            const classStyle = this.resolveEdgeClass(className);
            style = { ...style, ...classStyle };
        }

        return style;
    }

    /**
     * Get subgraph style from theme
     * @param {string} themeName
     * @param {string} [className]
     * @returns {ResolvedChartStyle}
     */
    getSubgraphStyle(themeName, className) {
        const theme = this.getTheme(themeName);
        const defaults = theme?.subgraph_defaults || {};

        /** @type {ResolvedChartStyle} */
        let style = {
            fill: defaults.fill,
            stroke: defaults.stroke,
            strokeDasharray: defaults.strokeDasharray
        };

        // Apply class overrides
        if (className) {
            const classStyle = this.resolveClass(className);
            style = { ...style, ...classStyle };
        }

        return style;
    }

    // =========================================================================
    // Debug
    // =========================================================================

    /**
     * @returns {{ packCount:number, packs:{index:number,label:string}[], themeNames:string[], classCount:number, edgeClassCount:number }}
     */
    getDebugSummary() {
        const packs = this.packs.map((p, index) => {
            const label =
                String(p?.pack_id || `pack#${index}`) || `pack#${index}`;
            return { index, label };
        });
        return {
            packCount: this.packs.length,
            packs,
            themeNames: this.getThemeNames().sort(),
            classCount: Object.keys(this._merged.chart_classes || {}).length,
            edgeClassCount: Object.keys(this._merged.chart_edge_classes || {})
                .length
        };
    }

    /**
     * @param {string} themeName
     * @returns {{ themeName:string, exists:boolean, nodeDefaults:ResolvedChartStyle, edgeDefaults:ResolvedEdgeStyle, subgraphDefaults:ResolvedChartStyle }}
     */
    getDebugResolvedDefaults(themeName) {
        const theme = this.getTheme(themeName);
        const exists = Boolean(theme);
        const t = theme || {};
        return {
            themeName,
            exists,
            nodeDefaults: this.getNodeStyle(themeName),
            edgeDefaults: this.getEdgeStyle(themeName),
            subgraphDefaults: this.getSubgraphStyle(themeName)
        };
    }

    /**
     * @param {string} themeName
     * @returns {string[]}
     */
    getDebugLines(themeName) {
        const s = this.getDebugSummary();
        const d = this.getDebugResolvedDefaults(themeName);
        const lines = [];
        lines.push(
            `renderpack packs=${s.packCount} themes=${s.themeNames.length} classes=${s.classCount} edgeClasses=${s.edgeClassCount}`
        );
        for (let i = 0; i < s.packs.length; i++) {
            lines.push(`  pack[${s.packs[i].index}]=${s.packs[i].label}`);
        }
        lines.push(
            `  theme=${d.themeName} exists=${String(
                d.exists
            )} available=${s.themeNames.join(",")}`
        );
        lines.push(
            `  nodeDefaults fill=${d.nodeDefaults.fill} stroke=${d.nodeDefaults.stroke} strokeWidth=${d.nodeDefaults.strokeWidth} textColor=${d.nodeDefaults.textColor} fontFamily=${d.nodeDefaults.fontFamily} fontSize=${d.nodeDefaults.fontSize}`
        );
        lines.push(
            `  edgeDefaults stroke=${d.edgeDefaults.stroke} strokeWidth=${d.edgeDefaults.strokeWidth}`
        );
        lines.push(
            `  subgraphDefaults fill=${d.subgraphDefaults.fill} stroke=${d.subgraphDefaults.stroke} strokeDasharray=${d.subgraphDefaults.strokeDasharray}`
        );
        return lines;
    }

    // =========================================================================
    // Validation
    // =========================================================================

    /**
     * Validate class references against defined classes
     * @param {Set<string>} classRefs
     * @returns {{ valid: boolean, undefined: string[] }}
     */
    validateClassReferences(classRefs) {
        /** @type {string[]} */
        const undefined_ = [];

        for (const className of classRefs) {
            if (!this.getClass(className) && !this.getEdgeClass(className)) {
                undefined_.push(className);
            }
        }

        return {
            valid: undefined_.length === 0,
            undefined: undefined_
        };
    }
}

// =============================================================================
// Factory Functions
// =============================================================================

/**
 * Create adapter from render pack data
 * @param {ChartRenderPackData | ChartRenderPackData[]} packs
 * @returns {ChartRenderPackAdapter}
 */
export function createChartRenderPackAdapter(packs) {
    return new ChartRenderPackAdapter(packs);
}
