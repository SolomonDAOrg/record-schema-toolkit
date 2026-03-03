/**
 * Chart AST Types
 * Types for diagram/chart parsing
 * @module format-ast/types/chart
 */

// =============================================================================
// Node Category
// =============================================================================

/** @typedef {"flowchart" | "sequence" | "state" | "entity" | "tree"} ChartType */

/** @typedef {"TD" | "TB" | "LR" | "RL" | "BT"} ChartDirection */

/** @typedef {"rect" | "round" | "stadium" | "diamond" | "hexagon" | "parallelogram" | "trapezoid" | "circle" | "cylinder" | "subroutine" | "asymmetric" | "note"} NodeShape */

/** @typedef {"normal" | "open" | "cross" | "none"} ArrowType */
/** @typedef {"solid" | "dashed" | "dotted" | "thick"} LineStyle */

/** @typedef {"sync" | "async" | "reply"} MessageType */

/** @typedef {"1:1" | "1:N" | "N:1" | "N:M" | "0..1:1" | "0..1:N" | "1:0..1" | "N:0..1"} Cardinality */

/** @typedef {"primary" | "foreign" | "unique" | "index" | "none"} KeyType */

/** @typedef {"svg" | "png" | "ascii" | "mermaid"} ChartRenderTarget */

// =============================================================================
// Type Definitions
// =============================================================================

/**
 * @typedef {Object} ChartThemeDefaults
 * @property {string} [fill]
 * @property {string} [stroke]
 * @property {number} [strokeWidth]
 * @property {string} [strokeDasharray]
 * @property {string} [textColor]
 * @property {string} [fontFamily]
 * @property {number} [fontSize]
 */

/**
 * @typedef {Object} ChartTheme
 * @property {string} [description]
 * @property {ChartThemeDefaults} [node_defaults]
 * @property {{ stroke?: string, strokeWidth?: number, arrowHead?: string }} [edge_defaults]
 * @property {{ fill?: string, stroke?: string, strokeDasharray?: string }} [subgraph_defaults]
 */

/**
 * @typedef {Object} ChartClass
 * @property {string} [fill]
 * @property {string} [stroke]
 * @property {number} [stroke_width]
 * @property {string} [stroke_dasharray]
 * @property {string} [text_color]
 * @property {string} [font_family]
 * @property {number|string} [font_size]
 * @property {number|string} [font_weight]
 * @property {number} [opacity]
 * @property {number|string} [border_radius]
 * @property {string|number|Record<string,unknown>} [padding]
 * @property {string} [shape]
 * @property {string[]} [extends]
 */

/**
 * @typedef {Object} ChartEdgeClass
 * @property {string} [stroke]
 * @property {number} [stroke_width]
 * @property {string} [stroke_dasharray]
 * @property {string} [text_color]
 * @property {number|string} [font_size]
 */

/**
 * @typedef {Object} ChartTargetConfig
 * @property {string} engine
 * @property {string} [theme]
 * @property {Record<string, unknown>} [options]
 */

/**
 * @typedef {Object} ChartRenderProfile
 * @property {string} [description]
 * @property {ChartRenderTarget[]} [chart_targets]
 * @property {string} [chart_theme]
 */

/**
 * @typedef {Object} ChartRuleset
 * @property {string} id
 * @property {{ extensions?: string[], doc_types?: string[] }} [selectors]
 * @property {{ chart_targets?: ChartRenderTarget[], chart_theme?: string, output_dir?: string }} [render]
 */

/**
 * @typedef {Object} ChartRenderPackData
 * @property {string} schema
 * @property {number} schema_version
 * @property {string} pack_id
 * @property {string} [description]
 * @property {string[]} [imports]
 * @property {ChartDocumentPolicies} [document_policies]
 */

/**
 * @typedef {Object} ChartDocumentPolicies
 * @property {Record<string, ChartTheme>} [chart_themes]
 * @property {Record<string, ChartClass>} [chart_classes]
 * @property {Record<string, ChartEdgeClass>} [chart_edge_classes]
 * @property {Record<string, ChartTargetConfig>} [chart_targets]
 * @property {Record<string, ChartRenderProfile>} [render_profiles]
 * @property {ChartRuleset[]} [rulesets]
 */

/**
 * @typedef {Object} ResolvedChartStyle
 * @property {string} [fill]
 * @property {string} [stroke]
 * @property {number} [strokeWidth]
 * @property {string} [strokeDasharray]
 * @property {string} [textColor]
 * @property {string} [fontFamily]
 * @property {number} [fontSize]
 * @property {number|string} [fontWeight]
 * @property {number} [opacity]
 * @property {number} [borderRadius]
 * @property {import("./core.mjs").Padding} [padding]
 * @property {string} [shape]
 */

/**
 * @typedef {Object} ResolvedEdgeStyle
 * @property {string} [stroke]
 * @property {number} [strokeWidth]
 * @property {string} [strokeDasharray]
 * @property {string} [textColor]
 * @property {number} [fontSize]
 * @property {string} [fontFamily]
 */

/**
 * @typedef {Object} ResolvedChartConfig
 * @property {ChartRenderTarget[]} targets
 * @property {string} theme
 * @property {ChartTheme} themeData
 * @property {Record<string, ChartTargetConfig>} targetConfigs
 */

// =============================================================================
// Base Style Types
// =============================================================================

/**
 * @typedef {Object} ChartNodeStyle
 * @property {string} [fill] - Fill color
 * @property {string} [stroke] - Stroke color
 * @property {number} [strokeWidth] - Stroke width
 * @property {string} [strokeDasharray] - Dash pattern
 * @property {string} [textColor] - Text color
 * @property {string} [fontFamily] - Font family
 * @property {number} [fontSize] - Font size
 */

/**
 * @typedef {Object} ChartEdgeStyle
 * @property {string} [stroke] - Stroke color
 * @property {number} [strokeWidth] - Stroke width
 * @property {string} [strokeDasharray] - Dash pattern
 * @property {string} [textColor] - Label text color
 * @property {number} [fontSize] - Label font size
 */

// =============================================================================
// Chart Document Types
// =============================================================================

/**
 * @typedef {Object} ChartDocumentMeta
 * @property {string} [title]
 * @property {string} [description]
 * @property {string} [author]
 * @property {string} [recordId]
 * @property {string} [created]
 * @property {string} [updated]
 */

// =============================================================================
// Chart Render Types
// =============================================================================

/**
 * @typedef {Object} ChartRenderConfig
 * @property {ChartRenderTarget[]} [targets]
 * @property {string} [theme]
 * @property {number} [padding]
 * @property {string} [background]
 * @property {number} [scale]
 * @property {number} [maxWidth]
 * @property {"unicode" | "ascii"} [boxChars]
 */

/**
 * @typedef {Object} ChartRenderResult
 * @property {boolean} success
 * @property {string | Uint8Array | null} output
 * @property {string} mimeType
 * @property {string} [filename]
 * @property {string[]} warnings
 * @property {string[]} errors
 * @property {string=} stack
 */

/**
 * @typedef {Object} ChartRenderOptions
 * @property {string} [filename]
 * @property {string} [theme]
 * @property {number} [padding]
 * @property {string} [background]
 * @property {number} [scale]
 * @property {number} [maxWidth]
 * @property {"unicode" | "ascii"} [boxChars]
 * @property {"html_entities" | "none"} [escapeMode]
 */

/**
 * @typedef {Object} NodePosition
 * @property {number} x
 * @property {number} y
 * @property {number} width
 * @property {number} height
 */

/**
 * @typedef {Object} NodeSizeInfo
 * @property {number} width
 * @property {number} height
 * @property {string[]} lines - Wrapped text lines
 * @property {number} lineHeight
 * @property {number} fontSize
 * @property {{ top: number, right: number, bottom: number, left: number }} padding
 */

/**
 * @typedef {NodePosition & { lines?: string[], lineHeight?: number, fontSize?: number }} ExtendedNodePosition
 */
