import { renderSignatureBlock } from "./signatures.mjs";
import { paragraph, textRun, fontFamily } from "../../../docx/styles.mjs";
import { escapeXml, color } from "../../../docx/xml.mjs";
import { getVerticalSpacing } from "../../layout/spacing.mjs";
import { renderInline, renderVariableContent } from "./inline.mjs";
import { renderTable } from "./tables.mjs";

/** @typedef {import("../types/document.mjs").DocumentRendererConfig} DocumentRendererConfig */
/** @typedef {import("../../../docx/document.mjs").DocxDocument} DocxDocument */
/** @typedef {import("../../types/core.mjs").BaseNode} BaseNode */
/** @typedef {import("../../../docx/styles.mjs").RunStyle} RunStyle */
/** @typedef {import("../../../docx/styles.mjs").ParagraphOptions} ParagraphOptions */
/** @typedef {import("../../nodes/ProseNode.mjs").HeadingNode} HeadingNode */
/** @typedef {import("../../nodes/ProseNode.mjs").ParagraphNode} ParagraphNode */
/** @typedef {import("../../nodes/ProseNode.mjs").ImageNode} ImageNode */
/** @typedef {import("../../nodes/ProseNode.mjs").ListNode} ListNode */
/** @typedef {import("../../nodes/ProseNode.mjs").BlockquoteNode} BlockquoteNode */
/** @typedef {import("../../nodes/ProseNode.mjs").CodeBlockNode} CodeBlockNode */
/** @typedef {import("../../nodes/ProseNode.mjs").HorizontalRuleNode} HorizontalRuleNode */
/** @typedef {import("../../nodes/LegalNode.mjs").ArticleNode} ArticleNode */
/** @typedef {import("../../nodes/LegalNode.mjs").SectionNode} SectionNode */
/** @typedef {import("../../nodes/LegalNode.mjs").ScheduleNode} ScheduleNode */
/** @typedef {import("../../nodes/LegalNode.mjs").ExhibitNode} ExhibitNode */
/** @typedef {import("../../nodes/LegalNode.mjs").ClauseNode} ClauseNode */
/** @typedef {import("../../nodes/LegalNode.mjs").RecitalNode} RecitalNode */
/** @typedef {import("../../nodes/LegalNode.mjs").DefinitionNode} DefinitionNode */
/** @typedef {import("../../nodes/LegalNode.mjs").NoticeNode} NoticeNode */
/** @typedef {import("../../nodes/TabularNode.mjs").TableNode} TableNode */
/** @typedef {import("../../nodes/BaseNode.mjs").BreakNode} BreakNode */
/** @typedef {{id: number, name: string, emitted: boolean}} Bookmark */

const INLINE_TYPES = new Set(["text", "inline-format", "link", "form-field"]);

export class DocxContentRenderer {
    /** @param {DocxDocument} document @param {DocumentRendererConfig} configuration @param {number} width */
    constructor(document, configuration, width) {
        this.document = document;
        this.configuration = configuration;
        this.width = width;
        this.part = "word/document.xml";
        this.variables = { ...configuration.variables };
        this.literalFields = false;
        this.sectionBookmark = "";
        this.sectionBreakMode = "always";
        /** @type {import("../../types/core.mjs").HorizontalRuleBehavior | undefined} */
        this.horizontalRuleBehavior = undefined;
        /** @type {string | undefined} */
        this.pageStartBookmark = undefined;
        /** @type {number | undefined} */
        this.startPageNumber = undefined;
        this.sectionIncludesFirstPage = false;
        /** @type {Map<string, Bookmark>} */
        this.bookmarks = new Map();
        /** @type {Set<string>} */
        this.warnings = new Set();
    }

    /** @param {string} message */
    warn(message) {
        this.warnings.add(message);
    }

    /** @param {RunStyle} [style] @returns {RunStyle} */
    style(style = {}) {
        const fonts = this.configuration.fonts ?? {};
        const selected = style.monospace
            ? fonts.monospace ?? "Courier"
            : style.bold && style.italic
            ? fonts.boldItalic ?? fonts.regular ?? "Times-Roman"
            : style.bold
            ? fonts.bold ?? fonts.regular ?? "Times-Roman"
            : style.italic
            ? fonts.italic ?? fonts.regular ?? "Times-Roman"
            : fonts.regular ?? "Times-Roman";
        return {
            fontSize: this.configuration.baseFontSize ?? 10,
            lineHeight: this.configuration.lineHeight ?? 1.5,
            ...style,
            fontFamily: fontFamily(
                style.monospace
                    ? fonts.monospace ?? "Courier"
                    : style.fontFamily ?? selected
            )
        };
    }

    /** @param {string} identifier @returns {Bookmark} */
    bookmark(identifier) {
        let bookmark = this.bookmarks.get(identifier);
        if (!bookmark) {
            const id = this.bookmarks.size + 1;
            bookmark = { id, name: "Record" + id, emitted: false };
            this.bookmarks.set(identifier, bookmark);
        }
        return bookmark;
    }

    /** @param {BaseNode} node @returns {string} */
    anchors(node) {
        const anchorId =
            node.type === "heading"
                ? /** @type {HeadingNode} */ (node).anchorId
                : undefined;
        const identifiers = [node.id, anchorId, node.attrs.anchorId].filter(
            (identifier) =>
                typeof identifier === "string" && identifier.length > 0
        );
        return [...new Set(identifiers)]
            .map((identifier) => {
                const bookmark = this.bookmark(identifier);
                if (bookmark.emitted) return "";
                bookmark.emitted = true;
                return (
                    '<w:bookmarkStart w:id="' +
                    bookmark.id +
                    '" w:name="' +
                    bookmark.name +
                    '"/><w:bookmarkEnd w:id="' +
                    bookmark.id +
                    '"/>'
                );
            })
            .join("");
    }

    /** @param {BaseNode[]} nodes @param {RunStyle} [style] @returns {string} */
    inline(nodes, style = {}) {
        return nodes
            .map((node) => renderInline(this, node, this.style(style)))
            .join("");
    }

    /** @param {ReadonlyArray<BaseNode>} nodes @param {RunStyle} [inherited] @param {number} [depth] @returns {string} */
    blocks(nodes, inherited = {}, depth = 0) {
        let content = "";
        let inline = [];
        let previous = null;
        const flush = () => {
            if (inline.length) {
                content += paragraph(
                    this.inline(inline, inherited),
                    this.style(inherited)
                );
                inline = [];
            }
        };
        for (const node of nodes) {
            if (
                INLINE_TYPES.has(node.type) ||
                (node.type === "image" &&
                    /** @type {ImageNode} */ (node).display === "inline") ||
                (node.type === "break" &&
                    /** @type {BreakNode} */ (node).breakType !== "page")
            ) {
                inline.push(node);
                continue;
            }
            flush();
            const options = {
                before: getVerticalSpacing(this.configuration, node, previous)
            };
            content += this.block(node, inherited, options, depth);
            previous = node.type;
        }
        flush();
        return content;
    }

    /** @param {BaseNode} node @param {RunStyle} inherited @param {ParagraphOptions} options @param {number} depth @returns {string} */
    block(node, inherited, options = {}, depth = 0) {
        const style = this.style({ ...inherited, ...node.textStyle });
        const keep = node.keepRules ?? {};
        const properties = {
            ...options,
            keepNext: keep.keepWithNext,
            keepTogether: keep.keepTogether,
            pageBreakBefore:
                keep.pageBreakBefore &&
                !(
                    this.sectionBreakMode === "part-only" &&
                    node.type === "section"
                )
        };
        let content = "";
        switch (node.type) {
            case "paragraph": {
                const paragraphNode = /** @type {ParagraphNode} */ (node);
                const label = paragraphNode.attrs.runInLabel;
                const prefix = label
                    ? textRun(
                          String(label) +
                              (paragraphNode.attrs.runInLabelSeparator ?? " "),
                          style
                      )
                    : "";
                content = paragraph(
                    this.anchors(paragraphNode) +
                        prefix +
                        this.inline(paragraphNode.children, style),
                    { ...style, align: paragraphNode.align ?? style.align },
                    {
                        ...properties,
                        firstLine: paragraphNode.indent,
                        hanging: paragraphNode.hangingIndent
                    }
                );
                break;
            }
            case "heading": {
                const headingNode = /** @type {HeadingNode} */ (node);
                const level = headingNode.level ?? 1;
                const headingStyle = this.style({
                    ...style,
                    bold: true,
                    fontSize:
                        style.fontSize *
                        (this.configuration.headingScales?.["h" + level] ??
                            this.configuration.headingScales?.[level] ??
                            [1.6, 1.35, 1.2, 1.1, 1, 1][level - 1]),
                    ...this.configuration.headingStyles?.["h" + level],
                    ...this.configuration.headingStyles?.[level],
                    ...headingNode.textStyle
                });
                content = paragraph(
                    this.anchors(headingNode) +
                        (headingNode.numbering
                            ? textRun(headingNode.numbering + " ", headingStyle)
                            : "") +
                        this.inline(headingNode.children, headingStyle),
                    headingStyle,
                    {
                        ...properties,
                        heading:
                            headingNode.includeInToc === false
                                ? undefined
                                : level,
                        keepNext: true
                    }
                );
                break;
            }
            case "table":
                content =
                    paragraph(
                        this.anchors(node),
                        { fontSize: 1, lineHeight: 1 },
                        properties
                    ) +
                    renderTable(this, /** @type {TableNode} */ (node), style);
                break;
            case "list": {
                const listNode = /** @type {ListNode} */ (node);
                const numbering = this.document.numbering.add(listNode);
                const level = Math.min(8, depth + (listNode.indentLevel ?? 0));
                content = paragraph(
                    this.anchors(listNode),
                    { fontSize: 1, lineHeight: 1 },
                    properties
                );
                for (const item of listNode.children) {
                    const children = [...item.children];
                    const first = children[0];
                    let body;
                    if (first?.type === "paragraph") {
                        body = first.children;
                        children.shift();
                    } else {
                        body = [];
                        while (
                            children.length &&
                            INLINE_TYPES.has(children[0].type)
                        )
                            body.push(children.shift());
                    }
                    content += paragraph(
                        this.anchors(item) + this.inline(body, style),
                        style,
                        {
                            numbering,
                            level,
                            keepNext: item.keepRules?.keepWithNext
                        }
                    );
                    content += this.blocks(children, style, level + 1);
                }
                break;
            }
            case "list-item":
                content = paragraph(
                    this.anchors(node) + this.inline(node.children, style),
                    style,
                    properties
                );
                break;
            case "blockquote":
                content = this.blocks(
                    node.children,
                    { ...style, italic: true },
                    depth
                );
                if (/** @type {BlockquoteNode} */ (node).attribution)
                    content += paragraph(
                        textRun(
                            "— " +
                                /** @type {BlockquoteNode} */ (node)
                                    .attribution,
                            style
                        ),
                        { ...style, align: "right" }
                    );
                break;
            case "code-block":
                content = paragraph(
                    this.anchors(node) +
                        textRun(
                            /** @type {CodeBlockNode} */ (node).code,
                            this.style({ ...style, monospace: true })
                        ),
                    style,
                    { ...properties, shade: "#f4f4f4" }
                );
                break;
            case "horizontal-rule":
                content =
                    (this.horizontalRuleBehavior ??
                        this.configuration.horizontalRule?.behavior) ===
                    "page-break"
                        ? paragraph('<w:r><w:br w:type="page"/></w:r>')
                        : paragraph("", style, {
                              ...properties,
                              border: {
                                  width:
                                      /** @type {HorizontalRuleNode} */ (node)
                                          .thickness ?? 0.5,
                                  color:
                                      /** @type {HorizontalRuleNode} */ (node)
                                          .color ?? "#000000"
                              }
                          });
                break;
            case "break":
            case "section-break":
                content = paragraph('<w:r><w:br w:type="page"/></w:r>');
                break;
            case "image":
                content = paragraph(
                    this.anchors(node) + renderInline(this, node, style),
                    style,
                    properties
                );
                break;
            case "article":
            case "section":
            case "schedule":
            case "exhibit": {
                const directive = node.attrs.directive;
                if (directive) {
                    const directiveStyle =
                        this.configuration.directiveStyles?.[directive] ?? {};
                    content = this.blocks(
                        node.children,
                        { ...style, ...directiveStyle },
                        depth
                    );
                    break;
                }
                const section =
                    /** @type {ArticleNode | SectionNode | ScheduleNode | ExhibitNode} */ (
                        node
                    );
                const numbered =
                    node.type === "article" || node.type === "section"
                        ? /** @type {ArticleNode | SectionNode} */ (node)
                              .numbered
                        : true;
                const number = numbered === false ? "" : section.number ?? "";
                const prefix =
                    node.type === "article"
                        ? "Article "
                        : node.type === "schedule"
                        ? "Schedule "
                        : node.type === "exhibit"
                        ? "Exhibit "
                        : "";
                const title =
                    (number ? prefix + number : "") +
                    (number && section.title ? ": " : "") +
                    (section.title ?? "");
                if (title) {
                    const headingStyle = {
                        ...style,
                        bold: true,
                        fontSize:
                            style.fontSize *
                            (node.type === "article" ? 1.4 : 1.15)
                    };
                    content += paragraph(
                        this.anchors(node) + textRun(title, headingStyle),
                        headingStyle,
                        {
                            ...properties,
                            heading: node.type === "article" ? 1 : 2,
                            keepNext: true
                        }
                    );
                } else
                    content += paragraph(
                        this.anchors(node),
                        { fontSize: 1, lineHeight: 1 },
                        properties
                    );
                content += this.blocks(node.children, style, depth);
                break;
            }
            case "definition":
                content = paragraph(
                    this.anchors(node) +
                        textRun(
                            "“" +
                                /** @type {DefinitionNode} */ (node).term +
                                "” ",
                            { ...style, bold: true }
                        ) +
                        this.inline(node.children, style),
                    style,
                    properties
                );
                break;
            case "clause":
            case "recital": {
                const label =
                    node.type === "recital"
                        ? /** @type {RecitalNode} */ (node).label
                        : /** @type {ClauseNode} */ (node).numbered === false
                        ? ""
                        : /** @type {ClauseNode} */ (node).number;
                const inline = node.children.every(
                    (child) =>
                        INLINE_TYPES.has(child.type) || child.type === "break"
                );
                content = paragraph(
                    this.anchors(node) +
                        textRun(label ? label + " " : "", {
                            ...style,
                            bold: true
                        }) +
                        (inline ? this.inline(node.children, style) : ""),
                    style,
                    { ...properties, keepNext: !inline }
                );
                if (!inline)
                    content += this.blocks(node.children, style, depth);
                break;
            }
            case "notice":
                if (/** @type {NoticeNode} */ (node).title)
                    content += paragraph(
                        textRun(/** @type {NoticeNode} */ (node).title, {
                            ...style,
                            bold: true
                        }),
                        style,
                        { ...properties, keepNext: true }
                    );
                content += this.blocks(node.children, style, depth);
                break;
            case "signature-block":
                content = this.signature(node, style);
                break;
            case "container":
            case "document-group":
            case "mixed-content":
                content = this.blocks(node.children, style, depth);
                break;
            default:
                if (INLINE_TYPES.has(node.type))
                    content = paragraph(
                        renderInline(this, node, style),
                        style,
                        properties
                    );
                else throw new Error("Unsupported DOCX node: " + node.type);
        }
        if (keep.pageBreakAfter)
            content += paragraph('<w:r><w:br w:type="page"/></w:r>');
        return content;
    }

    /** @param {import("./signatures.mjs").SignatureSource} node @param {RunStyle} style @returns {string} */
    signature(node, style) {
        return renderSignatureBlock(this, node, style);
    }

    /** @param {import("../../types/core.mjs").HeaderFooterContent} content @param {RunStyle} [style] @returns {string} */
    variable(content, style = {}) {
        return renderVariableContent(this, content, this.style(style));
    }

    /** @param {string} content @param {{x: number, top: number, width: number, height: number, fill?: string, border?: string}} box @returns {string} */
    textBox(content, box) {
        const identifier = ++this.document.identifier;
        const position =
            "position:absolute;margin-left:" +
            box.x +
            "pt;margin-top:" +
            box.top +
            "pt;width:" +
            box.width +
            "pt;height:" +
            box.height +
            "pt;mso-position-horizontal-relative:page;mso-position-vertical-relative:page";
        return (
            '<w:r><w:pict><v:rect id="Shape' +
            identifier +
            '" style="' +
            escapeXml(position) +
            '" filled="' +
            (box.fill ? "t" : "f") +
            '" stroked="' +
            (box.border ? "t" : "f") +
            '"' +
            (box.fill ? ' fillcolor="#' + color(box.fill) + '"' : "") +
            (box.border ? ' strokecolor="#' + color(box.border) + '"' : "") +
            '><v:textbox inset="0,0,0,0"><w:txbxContent>' +
            (content || paragraph("")) +
            '</w:txbxContent></v:textbox><w10:wrap type="none"/></v:rect></w:pict></w:r>'
        );
    }
}
