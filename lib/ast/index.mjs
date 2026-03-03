/**
 * Format AST - Extensible document AST for multi-format rendering
 * @module format-ast
 */

// =============================================================================
// Types
// =============================================================================

export {
    NODE_CATEGORIES,
    BASE_NODE_TYPES,
    PROSE_NODE_TYPES,
    TABULAR_NODE_TYPES,
    LEGAL_NODE_TYPES,
    PAGE_SIZES
} from "./constants/core.mjs";

// =============================================================================
// Base Nodes
// =============================================================================

export {
    BaseNode,
    TextNode,
    ContainerNode,
    BreakNode,
    resetNodeIdCounter,
    createText,
    createContainer,
    createPageBreak,
    createSectionBreak
} from "./nodes/BaseNode.mjs";

// =============================================================================
// Prose Nodes
// =============================================================================

export {
    ProseNode,
    HeadingNode,
    ParagraphNode,
    ListNode,
    ListItemNode,
    BlockquoteNode,
    CodeBlockNode,
    HorizontalRuleNode,
    ImageNode,
    LinkNode,
    InlineFormatNode,
    createHeading,
    createParagraph,
    createList,
    createListItem,
    createBlockquote,
    createCodeBlock,
    createHorizontalRule,
    createImage,
    createLink,
    createBold,
    createItalic,
    createUnderline,
    createInlineCode
} from "./nodes/ProseNode.mjs";

// =============================================================================
// Tabular Nodes
// =============================================================================

export {
    TabularNode,
    TableNode,
    RowNode,
    CellNode,
    createTable,
    createRow,
    createHeaderRow,
    createCell,
    createHeaderCell,
    createTableFromData,
    createTableFromObjects
} from "./nodes/TabularNode.mjs";

// =============================================================================
// Legal Nodes
// =============================================================================

export {
    ArticleNode,
    SectionNode,
    ClauseNode,
    DefinitionNode,
    RecitalNode,
    SignatureBlockNode,
    NoticeNode,
    ScheduleNode,
    ExhibitNode,
    createArticle,
    createSection,
    createClause,
    createDefinition,
    createRecital,
    createSignatureBlock,
    createNotice,
    createSchedule,
    createExhibit
} from "./nodes/LegalNode.mjs";

// =============================================================================
// Documents
// =============================================================================

export {
    BaseDocument,
    ProseDocument,
    TabularDocument,
    LegalDocument,
    createDocument,
    createProseDocument,
    createTabularDocument,
    createLegalDocument
} from "./documents/BaseDocument.mjs";

// =============================================================================
// Renderers
// =============================================================================

export {
    BaseRenderer,
    NodeHandlerRegistry
} from "./renderers/BaseRenderer.mjs";

export { CsvRenderer, createCsvRenderer } from "./renderers/CsvRenderer.mjs";

// =============================================================================
// Adapters
// =============================================================================

export {
    FormattingPackAdapter,
    createFormattingPackAdapter
} from "./adapters/FormattingPackAdapter.mjs";

// =============================================================================
// Complete diagram/chart rendering subsystem for record-schema-toolkit
// =============================================================================

// =============================================================================
// Constants
// =============================================================================

export {
    DIAGRAM_CATEGORY,
    CHART_NODE_TYPES,
    CHART_TYPES,
    CHART_DIRECTIONS,
    NODE_SHAPES,
    ARROW_TYPES,
    LINE_STYLES,
    MESSAGE_TYPES,
    CARDINALITY,
    KEY_TYPES,
    CHART_RENDER_TARGETS,
    CHART_DEFAULTS
} from "./constants/chart.mjs";

// =============================================================================
// Node Classes
// =============================================================================

export {
    resetChartNodeIdCounter,
    BaseChartNode,
    ChartContainerNode,
    ChartNodeItem,
    ChartEdgeItem,
    ChartSubgraphNode,
    ChartParticipantNode,
    ChartMessageNode,
    ChartNoteNode,
    ChartLoopNode,
    ChartStateNode,
    ChartTransitionNode,
    ChartEntityNode,
    ChartAttributeNode,
    ChartRelationshipNode,
    ChartTreeNode,
    // Factory functions
    createChartContainer,
    createChartNode,
    createChartEdge,
    createChartSubgraph,
    createChartParticipant,
    createChartMessage,
    createChartNote,
    createChartLoop,
    createChartState,
    createChartTransition,
    createChartEntity,
    createChartAttribute,
    createChartRelationship,
    createChartTreeNode
} from "./nodes/ChartNode.mjs";

// =============================================================================
// Document
// =============================================================================

export {
    ChartDocument,
    createFlowchartDocument,
    createSequenceDocument,
    createStateDocument,
    createEntityDocument,
    createTreeDocument
} from "./documents/ChartDocument.mjs";

// =============================================================================
// Converter
// =============================================================================

export {
    convertChartToDocument,
    createChartToAstConverter,
    ChartToAstConverter
} from "./converters/ChartToAstConverter.mjs";

// =============================================================================
// Render Pack Adapters
// =============================================================================

export { ChartRenderPackAdapter } from "./adapters/ChartRenderPackAdapter.mjs";

// =============================================================================
// Chart Renderers
// =============================================================================

export { BaseChartRenderer } from "./renderers/chart/BaseChartRenderer.mjs";
export { ChartAsciiRenderer } from "./renderers/chart/ChartAsciiRenderer.mjs";
export { ChartMermaidRenderer } from "./renderers/chart/ChartMermaidRenderer.mjs";
export { ChartSvgRenderer } from "./renderers/chart/ChartSvgRenderer.mjs";
