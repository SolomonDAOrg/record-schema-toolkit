/** @typedef {import("../../types/core.mjs").PageComposition} PageComposition */
/** @typedef {import("../../types/core.mjs").PageConfig} PageConfig */
/** @typedef {import("../../types/core.mjs").HeaderFooterConfig} HeaderFooterConfig */
/** @typedef {import("../../types/core.mjs").SpacingPolicy} SpacingPolicy */
/** @typedef {import("../../types/core.mjs").CoverRenderConfig} CoverRenderConfig */
/** @typedef {import("../../types/core.mjs").HorizontalRuleBehavior} HorizontalRuleBehavior */
/** @typedef {import("../../types/core.mjs").TableRenderConfig} TableRenderConfig */
/** @typedef {import("../../types/core.mjs").TextStyle} TextStyle */
/** @typedef {import("../../types/core.mjs").MarkdownEnvelopeStyle} MarkdownEnvelopeStyle */
/** @typedef {import("../../types/core.mjs").BoxStyle} BoxStyle */
/** @typedef {import("../../types/core.mjs").FormFieldsStyle} FormFieldsStyle */
/** @typedef {import("../../types/core.mjs").TocLevelStyle} TocLevelStyle */
/** @typedef {import("../../../pdf/page-tracking/types.mjs").PageTrackingConfig} PageTrackingConfig */
/** @typedef {import("../DustCoverRenderer.mjs").DustCoverPage} DustCoverPage */

/**
 * @typedef {Object} SigningPartySignatory
 * @property {string=} name - Signatory name (rendered below the signature line)
 * @property {string} [title] - Signatory title/role
 * @property {string} [signature] - Optional prefilled signature text (rare; usually left blank)
 * @property {string} [date] - Optional prefilled date text
 * @property {Record<string, string>} [values] - Arbitrary row values keyed by field label (e.g. {"Name":"..."})
 */

/**
 * @typedef {Object} SigningParty
 * @property {string} label - Party label (e.g. "COMPANY:", "MEMBER:")
 * @property {string[]} [fields] - Ordered row labels for each signatory block (default: Signature, Name, Title, Date)
 * @property {SigningPartySignatory[]} signatories - One or more signatories for this party
 */

/**
 * @typedef {Object} SigningPageConfig
 * @property {boolean} [enabled] - Whether to render the signing page (default: false)
 * @property {string} [witnessClause] - Override the witness clause text
 * @property {string} [executionNote] - Optional execution/capacity note rendered below witness clause
 * @property {string} [acknowledgmentTitle] - Optional bold acknowledgment heading rendered above acknowledgment text
 * @property {string} [acknowledgmentText] - Optional acknowledgment/affirmation body text rendered before signature rows
 * @property {Record<string, unknown>} [layout] - Optional spacing/layout overrides for signature rows and text blocks
 * @property {SigningParty[]} parties - Parties with their signatories
 * @property {string} [effectiveDate] - Effective date text (rendered if provided)
 */

/**
 * @typedef {Object} DocumentRendererConfig
 * @property {PageComposition} [pageComposition]
 * @property {{includeSigningPage?: boolean, docxMode?: "relative" | "physical"}} [pageNumbering] - Include the final execution page in numbering and render its footer when enabled.
 * @property {PageConfig} pageConfig
 * @property {ReadonlyArray<HeaderFooterConfig>} [defaultHeaders]
 * @property {ReadonlyArray<HeaderFooterConfig>} [defaultFooters]
 * @property {{ regular?: string; bold?: string; italic?: string; boldItalic?: string; monospace?: string }} [fonts]
 * @property {Record<string, unknown>} [embeddedFonts]
 * @property {Record<string, string>} [fontRoleDefaults]
 * @property {number} [baseFontSize]
 * @property {number} [lineHeight]
 * @property {Record<string, number>} [headingScales]
 * @property {SpacingPolicy} [spacingPolicy] - Context-aware spacing rules (pair rules, defaults)
 * @property {Readonly<Record<string, string | number>>} [variables]
 * @property {CoverRenderConfig} [coverConfig] - Cover-page specific rendering overrides
 * @property {{ behavior?: HorizontalRuleBehavior }} [horizontalRule]
 * @property {TableRenderConfig} [table] - Table styling overrides
 * @property {PageTrackingConfig} [pageTracking]
 * @property {Record<string, TextStyle>} [headingStyles]
 * @property {MarkdownEnvelopeStyle} [markdownEnvelopeStyle]
 * @property {BoxStyle} [noticeStyle]
 * @property {BoxStyle} [signatureBlockStyle]
 * @property {Record<string, BoxStyle & FormFieldsStyle & { headerBackgroundColor?: string | number; titleColor?: string; titleBackgroundColor?: string | number; fieldLabelWidth?: number; signatureRowHeight?: number; rowHeight?: number; rowGap?: number; bodyGap?: number; headerGap?: number; postGap?: number; titleFontScale?: number, valueColor?: string, columnGap?: number, separatorWidth?: number, separatorColor?: string }>} [directiveStyles]
 * @property {{ levelStyles?: Record<string | number, TocLevelStyle> }} [tocConfig]
 * @property {{
 *  title?: string;
 *  author?: string;
 *  subject?: string;
 *  creator?: string;
 *  producer?: string;
 *  includeDates?: boolean;
 * }} [metadata] - Document metadata (Author, Title, etc.)
 * @property {boolean} [verbose] - Enable verbose trace logging for layout, bleed, wrapping
 * @property {SigningPageConfig} [signingPage] - Final signing/execution page (excluded from pagination by default)
 * @property {DustCoverPage} [dustCoverPage] - Optional outer dust cover
 * @property {{ mode?: "off" | "centered-title-block"; maxNodes?: number; stopAtMetadata?: boolean; stopAtHorizontalRule?: boolean }} [leadingSection] - Optional leading-section title-block alignment controls
 */

