/**
 * Consolidated types extracted from record-schema module files.
 *
 * Sources: Document, DocumentMetadata, Schema, Registry, Profile,
 *          Metafile, FormattingPack, RenderPack, Repository,
 *          FilingPacketGenerator, PackUtils
 *
 * @module record-schema/types
 */

/** @typedef {import("../../types/general.mjs").Metadata} Metadata */

// =============================================================================
// Schema
// =============================================================================

/**
 * @typedef {Object} SchemaError
 * @property {string} path
 * @property {string} message
 */

/** @typedef {Metadata} SchemaDefinition */

// =============================================================================
// Document
// =============================================================================

/**
 * @typedef {Object} FileInfo
 * @property {string} base_name
 * @property {string | null} ext
 * @property {string | null} doc_type
 * @property {string | null} record_id
 * @property {string | null} version
 */

/**
 * @typedef {Object} NormalizeResult
 * @property {boolean} changed
 * @property {string} text
 * @property {string[]} notes
 */

/**
 * @typedef {Object} DocumentLintResult
 * @property {boolean} changed
 * @property {string | null} new_text
 * @property {ValidationIssue[]} issues
 */

/** @typedef {[string, string]} UnicodeReplacementPair */

// =============================================================================
// DocumentMetadata
// =============================================================================

/**
 * @typedef {Object} ExtractResult
 * @property {string} body
 * @property {*} metadata - DocumentMetadata instance or null
 * @property {string | null} raw_block
 */

/**
 * @typedef {Object} EnvelopeResult
 * @property {string} header
 * @property {string} body
 * @property {string | null} footer
 */

/**
 * @typedef {Object} IndOptions
 * @property {string} record_id
 * @property {string} doc_type_code
 * @property {string} [version]
 * @property {string} [effective_date]
 * @property {string} [jurisdiction]
 * @property {number} [doc_index]
 */

// =============================================================================
// Registry
// =============================================================================

/**
 * @typedef {Object} DocTypeEntry
 * @property {string} code
 * @property {string} name
 * @property {string} [description]
 * @property {boolean} [filing]
 * @property {boolean} [exclude_ind]
 * @property {string[]} [allowed_series]
 * @property {string[]} [recommended_extensions]
 * @property {string} [markdown_envelope]
 * @property {string[]} [recommended_header_fields]
 * @property {string} [recommended_slug]
 */

/**
 * @typedef {Object} SeriesEntry
 * @property {string} code
 * @property {string} name
 * @property {string} [description]
 * @property {string} [tier]
 * @property {string[]} [allowed_doc_types]
 * @property {string[]} [recommended_doc_types]
 * @property {boolean} [requires_vote]
 */

/**
 * @typedef {Object} CommitmentKindEntry
 * @property {string} code
 * @property {string} name
 * @property {string} [description]
 * @property {string[]} [required_one_of]
 * @property {string[]} [recommended_fields]
 * @property {string} [recommended_hash_surface]
 */

// =============================================================================
// Profile
// =============================================================================

/**
 * @typedef {Object} BucketConfig
 * @property {string} bucket
 * @property {string} path
 * @property {Metadata} constraints
 */

/**
 * @typedef {Object} RootConfig
 * @property {string[]} [required_paths]
 */

/**
 * @typedef {Object} DocumentPoliciesConfig
 * @property {string[]} [pack_paths]
 */

/**
 * @typedef {Object} RulesConfig
 * @property {BucketConfig[]} [buckets]
 * @property {RootConfig} [root]
 * @property {DocumentPoliciesConfig} [document_policies]
 */

/**
 * @typedef {Object} ProfileData
 * @property {string} [schema]
 * @property {RulesConfig} [rules]
 */

// =============================================================================
// Metafile
// =============================================================================

/**
 * @typedef {Object} StatusInfo
 * @property {string} [phase]
 * @property {string} [confidentiality]
 */

/**
 * @typedef {Object} CommitmentEntry
 * @property {string} [kind]
 * @property {string} [hash_sha256_hex]
 * @property {string} [hash_sha256_base58]
 * @property {string} [content_id]
 */

/**
 * @typedef {Object} DocumentRef
 * @property {string} path
 * @property {string} [label]
 * @property {string} [description]
 * @property {string} [hash_sha256_hex]
 * @property {string} [generated_at]
 */

// =========================================================================
// Pack Entry
// =========================================================================

/**
 * @typedef {Object} PackEntry
 * @property {string} path
 * @property {number} precedence
 * @property {string | null} doc_type
 * @property {string | null} label
 */

/**
 * Raw pack entry shape before normalization.
 * @typedef {Object} RawPackEntry
 * @property {string} [path]
 * @property {boolean} [include]
 * @property {string} [doc_type]
 * @property {number} [precedence]
 * @property {string} [label]
 */

/**
 * @typedef {Object} AssemblyPackEntry
 * @property {string} path
 * @property {string} [doc_type]
 * @property {string} [label]
 * @property {string} [description]
 * @property {number} [precedence]
 * @property {boolean} [include]
 */

/**
 * @typedef {Object} AssemblyPacketInfo
 * @property {string} path
 * @property {string} [label]
 * @property {string} [description]
 * @property {string} [hash_sha256_hex]
 * @property {string} [generated_at]
 * @property {Metadata} [cover]
 */

/**
 * @typedef {Object} AssemblyInfo
 * @property {AssemblyPackEntry[]} [pack]
 * @property {AssemblyPacketInfo} [packet]
 */

/**
 * @typedef {Object} DocumentsInfo
 * @property {DocumentRef[]} [primary]
 * @property {DocumentRef[]} [secondary]
 * @property {DocumentRef[]} [tertiary]
 * @property {DocumentRef[]} [supplemental]
 * @property {DocumentRef} [log]
 * @property {DocumentRef} [index]
 */

/**
 * @typedef {Object} FormattingInfo
 * @property {string} [profile]
 */

/** @typedef {FormattingInfo & Record<string, any>} ExtensionsInfo */

/**
 * @typedef {Object} Timeline
 * @property {string} [opened_at]
 * @property {string} [drafted_at]
 */

/**
 * @typedef {Object} EntityInfo
 * @property {string} [legal_name]
 * @property {string} [short_name]
 */

/**
 * @typedef {Object} DocumentFieldInfo
 * @property {string} [version]
 * @property {string} [document_id]
 * @property {string} [effective_date]
 * @property {string} [title]
 */

/**
 * @typedef {Object} MetafileData
 * @property {string} [id]
 * @property {string} [series_code]
 * @property {string} [series]
 * @property {string} [title]
 * @property {string} [slug]
 * @property {string} [summary]
 * @property {string} [version]
 * @property {string} [entity_name]
 * @property {EntityInfo} [entity]
 * @property {DocumentFieldInfo} [document]
 * @property {StatusInfo} [status]
 * @property {CommitmentEntry[]} [commitments]
 * @property {Timeline} [timeline]
 * @property {DocumentsInfo} [documents]
 * @property {AssemblyInfo} [assembly]
 * @property {ExtensionsInfo} [extensions]
 */

/**
 * @typedef {Object} ValidationIssue
 * @property {string} severity
 * @property {string} code
 * @property {string} message
 * @property {string} file
 * @property {number} [line]
 */

/**
 * @typedef {Object} BucketConstraints
 * @property {string[]} [status_phase_allow]
 * @property {string[]} [status_confidentiality_allow]
 * @property {boolean} [require_commitments]
 * @property {string[]} [require_commitment_kind_allow]
 * @property {boolean} [require_commitment_hash_or_content_id]
 * @property {boolean} [require_documents_primary_ref]
 * @property {boolean} [require_documents_log_ref]
 * @property {boolean} [require_formatting_profile]
 */

// =============================================================================
// Shared – Rulesets / Validation (FormattingPack & RenderPack)
// =============================================================================

/**
 * @typedef {Object} RulesetSelectors
 * @property {string[]} [paths_glob]
 * @property {boolean} [is_root_file]
 * @property {string[]} [doc_types]
 * @property {string[]} [extensions]
 */

/**
 * @typedef {Object} ValidationError
 * @property {string} path
 * @property {string} message
 */

/**
 * @typedef {Object} ValidationResult
 * @property {boolean} valid
 * @property {ValidationError[]} errors
 */

// =============================================================================
// FormattingPack
// =============================================================================

/**
 * @typedef {Object} LineWidthRule
 * @property {number} max
 * @property {string[]} [ignore_blocks]
 */

/**
 * @typedef {Object} DefaultSettings
 * @property {string} [language_locale]
 * @property {string} [dialect_pack]
 * @property {LineWidthRule} [line_width]
 * @property {string} [formatting_profile]
 * @property {string} [header_shape_id]
 * @property {string} [footer_shape_id]
 * @property {string} [body_shape_id]
 * @property {string} [metadata_shape_id]
 * @property {string} [style_profile_id]
 * @property {string} [markdown_style_profile_id]
 * @property {string} [markdown_envelope_id]
 * @property {string} [markdown_hash_surface]
 * @property {string} [header_template_path]
 * @property {string} [footer_template_path]
 * @property {boolean} [require_metadata_block]
 * @property {boolean} [require_disclaimer_footer]
 * @property {string[]} [metadata_required_fields]
 * @property {string[]} [metadata_optional_fields]
 */

/**
 * @typedef {Object} ShapeField
 * @property {string} name
 * @property {boolean} [required]
 * @property {string} [pattern]
 * @property {string} [description]
 */

/**
 * @typedef {Object} ShapeDef
 * @property {string} kind
 * @property {string} [location]
 * @property {string} [description]
 * @property {string[]} [required_leading_lines]
 * @property {string[]} [required_trailing_lines]
 * @property {string} [pattern]
 * @property {string} [template_id]
 * @property {ShapeField[]} [fields]
 */

/**
 * @typedef {Object} DialectPair
 * @property {string} preferred
 * @property {string[]} forbid
 */

/**
 * @typedef {Object} DialectPack
 * @property {string} [locale]
 * @property {string} [description]
 * @property {string} [spelling_dictionary]
 * @property {Record<string, string>} [preferred_terms]
 * @property {string[]} [forbidden_terms]
 * @property {DialectPair[]} [pairs]
 */

/**
 * @typedef {Object} StyleProfile
 * @property {string} [description]
 * @property {string} [heading_style]
 * @property {string} [list_style]
 * @property {string} [emphasis_style]
 * @property {string} [code_fence_style]
 * @property {number} [blank_lines_before_heading]
 * @property {boolean} [trailing_punctuation]
 */

/**
 * @typedef {Object} FormattingProfile
 * @property {string} [description]
 * @property {{
 *     curly_quotes?: string[];
 *     dashes?: string[];
 *     ellipsis?: string[];
 *     special_spaces?: string[]
 * }} [disallowed_characters]
 * @property {{
 *     quotes?: string;
 *     dashes?: {
 *         compound?: string;
 *         parenthetical?: string;
 *         range?: string
 *     };
 *     ellipsis?: string
 * }} [substitutions]
 * @property {string[]} [allowed_non_ascii]
 * @property {string} [emoji_policy]
 * @property {boolean} [unicode_allowed]
 */

/**
 * @typedef {Object} TemplateDef
 * @property {string} [description]
 * @property {string[]} content
 */

/**
 * @typedef {Object} RulesetEnforce
 * @property {LineWidthRule} [line_width]
 * @property {string} [language_locale]
 * @property {string} [dialect_pack]
 * @property {string} [formatting_profile]
 * @property {string} [header_shape_id]
 * @property {string} [footer_shape_id]
 * @property {string} [body_shape_id]
 * @property {string} [metadata_shape_id]
 * @property {string} [style_profile_id]
 * @property {string} [markdown_style_profile_id]
 * @property {string} [markdown_envelope_id]
 * @property {string} [markdown_hash_surface]
 * @property {string} [header_template_path]
 * @property {string} [footer_template_path]
 * @property {boolean} [require_metadata_block]
 * @property {boolean} [require_disclaimer_footer]
 * @property {string[]} [metadata_required_fields]
 * @property {string[]} [metadata_optional_fields]
 */

/**
 * @typedef {Object} PackRuleset
 * @property {string} id
 * @property {string} [severity]
 * @property {RulesetSelectors} selectors
 * @property {RulesetEnforce} enforce
 */

/**
 * @typedef {Object} FormattingDocumentPolicy
 * @property {DefaultSettings} [defaults]
 * @property {Record<string, DialectPack>} [dialect_packs]
 * @property {Record<string, ShapeDef>} [shapes]
 * @property {Record<string, StyleProfile>} [style_profiles]
 * @property {Record<string, FormattingProfile>} [formatting_profiles]
 * @property {PackRuleset[]} [rulesets]
 * @property {Record<string, TemplateDef>} [templates]
 * @property {string} [precedence_notes]
 */

/**
 * @typedef {Object} FormattingPackData
 * @property {string} schema
 * @property {number} schema_version
 * @property {string} pack_id
 * @property {string} [description]
 * @property {string[]} [imports]
 * @property {FormattingDocumentPolicy} [document_policies]
 */

/**
 * @typedef {Object} LintIssue
 * @property {string} severity
 * @property {string} code
 * @property {string} message
 * @property {string} file
 * @property {number} [line]
 */

// =============================================================================
// RenderPack
// =============================================================================

/**
 * @typedef {Object} RenderDefaults
 * @property {string} [output_encoding]
 * @property {string} [output_newlines]
 * @property {string} [output_format]
 * @property {string} [render_profile_id]
 * @property {string} [chart_theme]
 */

/**
 * @typedef {Object} RenderTarget
 * @property {string} format
 * @property {string} [page_size]
 * @property {string} [orientation]
 * @property {Metadata} [margins]
 * @property {Record<string, string>} [fonts]
 * @property {number} [base_font_size]
 * @property {number} [title_font_size]
 * @property {Record<string, number>} [heading_scales]
 * @property {number} [line_spacing]
 * @property {number} [paragraph_spacing_factor]
 * @property {number} [list_indent_per_level]
 * @property {number} [code_block_indent]
 * @property {Metadata} [horizontal_rule]
 * @property {Metadata} [table]
 * @property {Metadata} [inline_formatting]
 * @property {string} [delimiter]
 * @property {string} [quote_char]
 * @property {string} [line_terminator]
 * @property {boolean} [include_header]
 * @property {string} [null_value]
 * @property {string} [date_format]
 * @property {string} [doctype]
 * @property {boolean} [inline_styles]
 * @property {number} [indent]
 * @property {boolean} [sort_keys]
 * @property {number} [line_width]
 */

/**
 * @typedef {Object} RenderProfile
 * @property {string} [description]
 * @property {string} [target]
 * @property {string} [extends]
 * @property {Metadata} [overrides]
 */

/**
 * @typedef {Object} ChartStyleProperties
 * @property {string} [fill]
 * @property {string} [stroke]
 * @property {number} [stroke_width]
 * @property {string} [stroke_dasharray]
 * @property {string} [font_family]
 * @property {string | number} [font_size]
 * @property {string | number} [font_weight]
 * @property {string} [text_color]
 * @property {number} [opacity]
 * @property {string} [shape]
 */

/**
 * @typedef {Object} ChartEdgeStyleProperties
 * @property {string} [stroke]
 * @property {number} [stroke_width]
 * @property {string} [stroke_dasharray]
 * @property {"normal" | "open" | "cross" | "none"} [arrow_head]
 * @property {"normal" | "open" | "cross" | "none"} [arrow_tail]
 * @property {"linear" | "basis" | "cardinal" | "step"} [curve]
 */

/**
 * @typedef {Object} ChartTheme
 * @property {string} [description]
 * @property {ChartStyleProperties} [node_defaults]
 * @property {ChartEdgeStyleProperties} [edge_defaults]
 * @property {ChartStyleProperties} [subgraph_defaults]
 * @property {ChartStyleProperties} [participant_defaults]
 * @property {ChartStyleProperties} [state_defaults]
 */

/**
 * @typedef {Object} ChartClass
 * @property {string[]} [extends]
 * @property {string} [fill]
 * @property {string} [stroke]
 * @property {number} [stroke_width]
 * @property {string} [stroke_dasharray]
 * @property {string} [font_family]
 * @property {string | number} [font_size]
 * @property {string | number} [font_weight]
 * @property {string} [text_color]
 * @property {number} [opacity]
 * @property {string} [shape]
 * @property {string | number} [border_radius]
 * @property {string | number | Record<string,unknown>} [padding]
 */

/**
 * @typedef {Object} ChartEdgeClass
 * @property {string[]} [extends]
 * @property {string} [stroke]
 * @property {number} [stroke_width]
 * @property {string} [stroke_dasharray]
 * @property {"normal" | "open" | "cross" | "none"} [arrow_head]
 * @property {"normal" | "open" | "cross" | "none"} [arrow_tail]
 * @property {string | number} [label_font_size]
 * @property {string} [label_color]
 * @property {string} [label_background]
 * @property {"linear" | "basis" | "cardinal" | "step"} [curve]
 */

/**
 * @typedef {Object} ChartTargetOptions
 * @property {number | "auto"} [width]
 * @property {number | "auto"} [height]
 * @property {number} [scale]
 * @property {number} [padding]
 * @property {string} [background]
 * @property {number} [max_width]
 * @property {"unicode" | "ascii"} [box_chars]
 * @property {"html_entities" | "unicode" | "none"} [escape_mode]
 * @property {string} [mermaid_theme]
 * @property {string} [font_family]
 * @property {boolean} [embed_fonts]
 * @property {boolean} [minify]
 */

/**
 * @typedef {Object} ChartTarget
 * @property {string} engine
 * @property {string} [theme]
 * @property {string[]} [style_packs]
 * @property {ChartTargetOptions} [options]
 */

/**
 * @typedef {Object} RulesetRender
 * @property {string} [target]
 * @property {string[]} [targets]
 * @property {string} [render_profile_id]
 * @property {string} [profile]
 * @property {string} [chart_theme]
 * @property {string} [output_format]
 * @property {string} [output_dir]
 * @property {string} [output_suffix]
 * @property {Metadata} [options]
 */

/**
 * @typedef {Object} RenderRuleset
 * @property {string} id
 * @property {string} [severity]
 * @property {RulesetSelectors} selectors
 * @property {RulesetRender} render
 */

/**
 * @typedef {Object} RenderDocumentPolicy
 * @property {RenderDefaults} [defaults]
 * @property {Record<string, RenderTarget>} [targets]
 * @property {Record<string, RenderProfile>} [render_profiles]
 * @property {Record<string, ChartTheme>} [chart_themes]
 * @property {Record<string, ChartClass>} [chart_classes]
 * @property {Record<string, ChartEdgeClass>} [chart_edge_classes]
 * @property {Record<string, ChartTarget>} [chart_targets]
 * @property {RenderRuleset[]} [rulesets]
 * @property {Metadata} [spacing_policy]
 * @property {string} [precedence_notes]
 */

/**
 * @typedef {Object} PageConfig
 * @property {string} [size]
 * @property {Metadata} [orientation]
 * @property {Metadata} [margins]
 * @property {number} [width]
 * @property {number} [height]
 */

/**
 * @typedef {Object} DraftWatermarkConfig
 * @property {boolean} [enabled]
 * @property {string} [text]
 * @property {number} [gray]
 * @property {number} [angle_deg]
 * @property {number} [font_size]
 */

/**
 * @typedef {Object} CoverRenderConfig
 * @property {boolean} [suppress_header]
 * @property {boolean} [suppress_footer]
 * @property {boolean} [suppress_page_numbering]
 * @property {boolean} [reserve_header_footer_space]
 * @property {DraftWatermarkConfig} [draft_watermark]
 * @property {Metadata} [cover_layout]
 * @property {Metadata} [layout]
 */

/** @typedef {"left" | "center" | "right"} HorizontalAlign */

/**
 * @typedef {Object} CoverPageElement
 * @property {"text" | "title-block" | "image" | "spacer" | "rule" | "kv-block"} type
 * @property {string | Metadata} [content]
 * @property {Metadata} [style]
 * @property {number} [height]
 * @property {string} [vertical_align]
 * @property {string} [title]
 * @property {string} [conjunction]
 * @property {string} [entity_name]
 * @property {number} [subtitle_font_size]
 * @property {number} [entity_font_size]
 * @property {number} [start_frac]
 * @property {number} [end_frac]
 * @property {Array<{ label: string, value: string }>} [rows]
 * @property {string} [separator]
 * @property {number} [column_gap]
 * @property {string} [label_align]
 * @property {number} [line_spacer]
 * @property {number} [line_width]
 * @property {number} [gray]
 */

/**
 * @typedef {Object} CoverPageOptions
 * @property {{ enabled?: boolean, text?: string, gray?: number, angle_deg?: number, font_size?: number }} [watermark]
 * @property {boolean} [suppress_header]
 * @property {boolean} [suppress_footer]
 * @property {boolean} [suppress_page_numbering]
 * @property {boolean} [reserve_header_footer_space]
 */

/**
 * @typedef {Object} CoverPageConfig
 * @property {CoverPageElement[]} elements
 * @property {PageConfig} [page_config]
 * @property {boolean} [counts_in_page_numbers]
 * @property {string} [background_color]
 * @property {CoverPageOptions} [options]
 */

/**
 * @typedef {Object} PacketEntityExtraction
 * @property {string[]} fields
 * @property {string} [title_pattern]
 */

/**
 * @typedef {Object} SigningPageSignatory
 * @property {Record<string, string>} [values]
 * @property {string} [name]
 * @property {string} [title]
 * @property {string} [date]
 * @property {string} [by]
 * @property {string} [signature]
 */

/**
 * @typedef {Object} SigningPageParty
 * @property {string} label
 * @property {string[]} [fields]
 * @property {SigningPageSignatory[]} signatories
 * @property {string} [name]
 * @property {string} [title]
 */

/**
 * @typedef {Object} SigningPageConfig
 * @property {boolean} [enabled]
 * @property {string} [witness_clause]
 * @property {string} [execution_note]
 * @property {string} [acknowledgment_title]
 * @property {string} [acknowledgment_text]
 * @property {Record<string, number>} [layout]
 * @property {SigningPageParty[]} parties
 */

/**
 * @typedef {Object} PacketConfig
 * @property {string} [default_entity_name]
 * @property {string} [default_document_title]
 * @property {string} [header_text]
 * @property {string} [series_prefix]
 * @property {"plain" | "entity-suffix"} [header_title_format]
 * @property {"always" | "never" | "first-only"} [section_page_break]
 * @property {Record<string, string>} [path_to_title]
 * @property {string[]} [name_patterns]
 * @property {PacketEntityExtraction} [entity_extraction]
 * @property {string} [document_kind_default]
 * @property {Record<string, string>} [document_kind_map]
 * @property {Metadata} [cover_templates]
 * @property {CoverRenderConfig} [cover_config]
 * @property {CoverRenderConfig} [cover] - Deprecated alias for cover_config
 * @property {SigningPageConfig} [signing_page]
 */

/**
 * @typedef {Object} ResolvedWatermarkConfig
 * @property {boolean} enabled
 * @property {string} text
 * @property {number} [gray]
 * @property {number} [angle_deg]
 * @property {number} [font_size]
 */

/**
 * @typedef {Object} ResolvedCoverConfig
 * @property {boolean} suppress_header
 * @property {boolean} suppress_footer
 * @property {boolean} suppress_page_numbering
 * @property {boolean} reserve_header_footer_space
 * @property {ResolvedWatermarkConfig} watermark
 * @property {Metadata} [cover_layout]
 */

/**
 * @typedef {Object} ResolvedPacketConfig
 * @property {string} default_entity_name
 * @property {string} default_document_title
 * @property {string} header_text
 * @property {string} series_prefix
 * @property {"plain" | "entity-suffix"} header_title_format
 * @property {"always" | "never" | "first-only"} section_page_break
 * @property {Record<string, string>} path_to_title
 * @property {string[]} name_patterns
 * @property {PacketEntityExtraction} entity_extraction
 * @property {string} document_kind_default
 * @property {Record<string, string>} document_kind_map
 * @property {Metadata} cover_templates
 * @property {CoverRenderConfig} cover_config
 * @property {SigningPageConfig | null} signing_page
 */

/**
 * @typedef {Object} ResolvedSigningConfig
 * @property {boolean} enabled
 * @property {string} [witness_clause]
 * @property {string} [execution_note]
 * @property {string} [acknowledgment_title]
 * @property {string} [acknowledgment_text]
 * @property {Record<string, number>} [layout]
 * @property {SigningPageParty[]} parties
 */

/**
 * @typedef {Object} FileDescriptor
 * @property {string} rel_path
 * @property {string | null} [doc_type]
 * @property {string | null} [ext]
 * @property {boolean} [is_root_file]
 */

/**
 * @typedef {Object} RenderPackData
 * @property {string} schema
 * @property {number} schema_version
 * @property {string} pack_id
 * @property {string} [description]
 * @property {string[]} [imports]
 * @property {RenderDocumentPolicy} [document_policies]
 * @property {PacketConfig} [packet_config]
 */

// =============================================================================
// Repository
// =============================================================================

/**
 * @typedef {Object} RecordInfo
 * @property {string} record_id
 * @property {string} dir_name
 * @property {string} abs_path
 * @property {string} rel_path
 * @property {string} bucket
 * @property {*} metafile - Metafile instance or null
 */

/**
 * @typedef {Object} RepositoryLintResult
 * @property {ValidationIssue[]} issues
 * @property {string[]} changed_files
 * @property {{ records: number, files: number, loaded_packs?: string[] }} stats
 */

/**
 * @typedef {Object} LintOptions
 * @property {string | null} [profile_path]
 * @property {string[] | null} [pack_paths]
 * @property {string | null} [registry_path]
 * @property {boolean} [write]
 */

/**
 * @typedef {Object} UpstreamConfig
 * @property {string | null} profile_path - Path to profile file if found
 * @property {string | null} profile_hint - Profile hint from upstream (name/slug), used to find a profile in toolkit fallback
 * @property {string | null} upstream_path - Path to upstream file if found
 * @property {string | null} registry_path - Path to registry YAML if found
 * @property {string[]} pack_paths - Formatting pack paths discovered
 * @property {string[]} render_pack_paths - Render pack paths discovered
 * @property {string[]} provides_ids - Identity ids from upstream provides declarations
 */

/**
 * @typedef {Object} RepositoryDiscoveryResult
 * @property {string} root_dir - The discovered repository root
 * @property {string | null} profile_path - Path to profile file if found
 * @property {string | null} profile_hint - Profile hint from upstream (name/slug), used to find a profile in toolkit fallback
 * @property {string | null} upstream_path - Path to upstream file if found
 * @property {RecordInfo | null} target_record - If started from a record dir, the record info
 * @property {string | null} registry_path - Path to registry YAML if found
 * @property {string[]} pack_paths - Formatting pack paths discovered
 * @property {string[]} render_pack_paths - Render pack paths discovered
 * @property {string[]} provides_ids - Identity ids from upstream provides declarations
 * @property {"meta" | "upstream" | "profile" | "heuristic"} resolved_via - How the repo was resolved
 */

// =============================================================================
// FilingPacketGenerator
// =============================================================================

/** @typedef {"left" | "center" | "right"} TextAlign */

/** @typedef {"agreement" | "short" | "generic"} CoverVariant */

/**
 * @typedef {Object} MetaCoverFormat
 * @property {unknown[]} [elements]
 * @property {string} [title]
 * @property {string} [subtitle]
 * @property {string[]} [subtitles]
 * @property {string} [short_name]
 * @property {string} [party_1]
 * @property {string} [party_2]
 * @property {string} [effective_date]
 * @property {string} [version]
 * @property {string} [document_date]
 * @property {string} [document_id]
 * @property {string} [status]
 * @property {Metadata} [cover_layout]
 * @property {Metadata} [layout]
 * @property {boolean} [include_of_line]
 * @property {string} [conjunction]
 * @property {Object} [metadata]
 * @property {TextAlign} [metadata_align]
 * @property {string[]} [metadata_fields]
 * @property {number} [metadata_font_size]
 * @property {TextAlign} [title_align]
 * @property {string} [confidentiality]
 * @property {string} [notices]
 * @property {string} [schedules]
 * @property {boolean} [suppress_header]
 * @property {boolean} [suppress_footer]
 * @property {boolean} [suppress_page_numbering]
 * @property {boolean} [reserve_header_footer_space]
 * @property {Metadata} [watermark]
 * @property {CoverVariant} [cover_variant]
 */

/**
 * @typedef {Object} CoverTemplateEntry
 * @property {unknown[]} [elements]
 */
