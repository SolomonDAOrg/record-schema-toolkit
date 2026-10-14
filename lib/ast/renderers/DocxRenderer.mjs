import { DocxDocument, pageDimensions } from "../../docx/document.mjs";
import { paragraph } from "../../docx/styles.mjs";
import { imageRun } from "../../docx/media.mjs";
import { DocxContentRenderer } from "./docx/content.mjs";
import { addFurniture } from "./docx/furniture.mjs";
import { renderToc } from "./docx/toc.mjs";
import {
    renderCover,
    renderSigningPage,
    renderPositionedPage
} from "./docx/composition.mjs";
import { LayoutEngine } from "../layout/LayoutEngine.mjs";

/** @typedef {import("./types/document.mjs").DocumentRendererConfig} DocumentRendererConfig */
/** @typedef {import("../types/core.mjs").ComposedSection} ComposedSection */
/** @typedef {import("../types/core.mjs").CoverPageNode} CoverPageNode */
/** @typedef {import("../types/core.mjs").TocNode} TocNode */
/** @typedef {import("../types/core.mjs").RenderResult} RenderResult */
/** @typedef {import("../types/core.mjs").RenderCapabilities} RenderCapabilities */
/** @typedef {import("../../docx/document.mjs").DocumentSection} DocumentSection */
/** @typedef {import("./DustCoverRenderer.mjs").DustCoverPage} DustCoverPage */

const MIME_TYPE =
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document";

export class DocxRenderer {
    /** @param {DocumentRendererConfig} configuration */
    constructor(configuration) {
        this.configuration = configuration;
    }
    getName() {
        return "DocxRenderer";
    }
    getMimeType() {
        return MIME_TYPE;
    }
    getExtension() {
        return "docx";
    }

    /** @returns {RenderCapabilities} */
    getCapabilities() {
        return {
            supportsInlineFormatting: true,
            supportsTables: true,
            supportsImages: true,
            supportsHeadersFooters: true,
            supportsPageBreaks: true,
            supportsColors: true,
            supportsBorders: true,
            supportsTwoPass: false,
            supportsHyperlinks: true,
            supportedNodeTypes: [
                "text",
                "container",
                "break",
                "heading",
                "paragraph",
                "list",
                "list-item",
                "blockquote",
                "code-block",
                "horizontal-rule",
                "image",
                "link",
                "form-field",
                "inline-format",
                "table",
                "row",
                "cell",
                "header-row",
                "header-cell",
                "article",
                "section",
                "clause",
                "definition",
                "recital",
                "notice",
                "signature-block",
                "schedule",
                "exhibit",
                "cover-page",
                "toc"
            ]
        };
    }

    /** @param {ReadonlyArray<ComposedSection>} sections @param {CoverPageNode | null} [coverPage] @param {TocNode | null} [toc] @param {DustCoverPage | null} [dustCoverPage] @returns {RenderResult} */
    render(sections, coverPage, toc, dustCoverPage) {
        const configuration = this.configuration;
        let renderer;
        try {
            const page = pageDimensions(configuration.pageConfig);
            const document = new DocxDocument(configuration.pageConfig, {});
            renderer = new DocxContentRenderer(
                document,
                configuration,
                page.width - page.margins.left - page.margins.right
            );
            document.style = renderer.style();
            renderer.warn(
                "DOCX pagination and field values are calculated by Word; pageCount is 0 until the document is laid out."
            );
            if (configuration.embeddedFonts)
                renderer.warn(
                    "DOCX uses declared font family names; embedded PDF font programs are not transferred."
                );
            if (configuration.spacingPolicy?.basis === "ink")
                renderer.warn(
                    "DOCX applies paragraph spacing; Word determines glyph ink placement."
                );
            const engine = new LayoutEngine();
            const dust = dustCoverPage ?? configuration.dustCoverPage;
            const composition = configuration.pageComposition;
            if (composition && (coverPage || toc || dust))
                throw new Error(
                    "Page composition cannot be combined with a separate cover or table of contents."
                );
            if (
                composition?.mode === "fixed" &&
                (configuration.signingPage ||
                    configuration.defaultHeaders?.length ||
                    configuration.defaultFooters?.length ||
                    sections.some(
                        (section) =>
                            section.config.headers?.length ||
                            section.config.footers?.length
                    ))
            ) {
                throw new Error(
                    "Fixed page composition owns its complete page furniture"
                );
            }
            let numberingStarted = false;
            /** @param {DocumentSection} section @param {ReadonlyArray<import("../types/core.mjs").HeaderFooterConfig>} [headers] @param {ReadonlyArray<import("../types/core.mjs").HeaderFooterConfig>} [footers] */
            const addSection = (section, headers = [], footers = []) => {
                const sectionAnchor = renderer.bookmark(
                    section.configuration.id
                );
                if (!sectionAnchor.emitted) {
                    sectionAnchor.emitted = true;
                    section.content =
                        paragraph(
                            '<w:bookmarkStart w:id="' +
                                sectionAnchor.id +
                                '" w:name="' +
                                sectionAnchor.name +
                                '"/><w:bookmarkEnd w:id="' +
                                sectionAnchor.id +
                                '"/>',
                            { fontSize: 1, lineHeight: 1 }
                        ) + section.content;
                }
                renderer.sectionBookmark = sectionAnchor.name;
                renderer.sectionIncludesFirstPage = !numberingStarted;
                const coverExcluded =
                    section.configuration.id === "cover" &&
                    (configuration.coverConfig?.suppressPageNumbering ===
                        true ||
                        configuration.coverConfig?.suppressFooter === true ||
                        coverPage?.config.countsInPageNumbers === false);
                if (
                    !numberingStarted &&
                    section.configuration.id !== "dust-cover" &&
                    !coverExcluded
                ) {
                    section.content =
                        paragraph(
                            '<w:bookmarkStart w:id="2147483645" w:name="NumberingStart"/><w:bookmarkEnd w:id="2147483645"/>',
                            { fontSize: 1, lineHeight: 1 }
                        ) + section.content;
                    numberingStarted = true;
                }
                addFurniture(renderer, section, headers, footers);
                document.sections.push(section);
            };
            if (dust) {
                if (!dust.sourceSvg)
                    throw new Error(
                        "DOCX dust covers require the original SVG source from processDustCover."
                    );
                const image = imageRun(
                    document.archive,
                    renderer.part,
                    {
                        src: "",
                        sourceBytes: Buffer.from(dust.sourceSvg),
                        width: page.width,
                        height: page.height
                    },
                    ++document.identifier,
                    page.width
                );
                addSection({
                    content: paragraph(
                        renderer.textBox(paragraph(image), {
                            x: 0,
                            top: 0,
                            width: page.width,
                            height: page.height
                        })
                    ),
                    configuration: { id: "dust-cover" }
                });
            }
            if (coverPage) {
                const options = {
                    ...configuration.coverConfig,
                    ...coverPage.config.options
                };
                const section = {
                    content: renderCover(renderer, coverPage),
                    configuration: { id: "cover" },
                    pageConfiguration: coverPage.config.pageConfig
                };
                addSection(
                    section,
                    options.suppressHeader
                        ? []
                        : configuration.defaultHeaders ?? [],
                    options.suppressFooter || options.suppressPageNumbering
                        ? []
                        : configuration.defaultFooters ?? []
                );
            }
            if (toc) {
                addSection(
                    {
                        content: renderToc(renderer, toc, sections),
                        configuration: {
                            ...toc.config.sectionConfig,
                            id: "toc"
                        }
                    },
                    configuration.defaultHeaders ?? [],
                    configuration.defaultFooters ?? []
                );
            }
            let flowing = sections;
            if (composition) {
                const partition =
                    composition.mode === "first-page"
                        ? engine.partitionPageComposition(composition, sections)
                        : null;
                const first = partition ? [partition.firstPage] : sections;
                const content = renderPositionedPage(
                    renderer,
                    first,
                    { ...composition, mode: "fixed" },
                    engine
                );
                addSection({
                    content,
                    configuration: { id: "positioned", startsNewPage: true }
                });
                renderer.warn(
                    "DOCX positioned regions are editable text boxes; Word determines text fitting within each region."
                );
                flowing = partition ? [partition.continuation] : [];
            }
            /** @type {ComposedSection[]} */
            const signing = [];
            for (const source of flowing) {
                const body = [];
                for (const node of source.content) {
                    if (node.attrs.directive === "signing-page")
                        signing.push({ ...source, content: node.children });
                    else body.push(node);
                }
                const sectionPage = pageDimensions(
                    source.config.pageConfig ?? configuration.pageConfig
                );
                renderer.width =
                    sectionPage.width -
                    sectionPage.margins.left -
                    sectionPage.margins.right;
                renderer.variables = {
                    ...configuration.variables,
                    sectionName: source.name ?? "",
                    sectionTitle: source.name ?? ""
                };
                renderer.sectionBreakMode = source.config.breakMode ?? "always";
                renderer.horizontalRuleBehavior =
                    source.config.horizontalRuleBehavior ??
                    configuration.horizontalRule?.behavior;
                const anchor = renderer.bookmark(source.id);
                anchor.emitted = true;
                renderer.sectionBookmark = anchor.name;
                renderer.pageStartBookmark = source.config.restartPageNumbers
                    ? anchor.name
                    : "NumberingStart";
                renderer.startPageNumber = source.config.restartPageNumbers
                    ? source.config.startPageNumber ?? 1
                    : 1;
                const section = {
                    content:
                        paragraph(
                            '<w:bookmarkStart w:id="' +
                                anchor.id +
                                '" w:name="' +
                                anchor.name +
                                '"/><w:bookmarkEnd w:id="' +
                                anchor.id +
                                '"/>',
                            { fontSize: 1, lineHeight: 1 }
                        ) + renderer.blocks(body),
                    configuration: { ...source.config }
                };
                addSection(
                    section,
                    source.config.headers ?? configuration.defaultHeaders ?? [],
                    source.config.footers ?? configuration.defaultFooters ?? []
                );
            }
            if (
                signing.length > 1 ||
                (signing.length &&
                    configuration.signingPage?.enabled !== false &&
                    configuration.signingPage?.parties?.length)
            ) {
                throw new Error(
                    "A document must have one signing page source: either a signing-page directive or signingPage configuration."
                );
            }
            const bodyEnd = () => {
                if (!document.sections.length)
                    addSection({ content: "", configuration: { id: "body" } });
                document.sections.at(-1).content += paragraph(
                    '<w:bookmarkStart w:id="2147483646" w:name="BodyEnd"/><w:bookmarkEnd w:id="2147483646"/>',
                    { fontSize: 1, lineHeight: 1 }
                );
            };
            if (configuration.pageNumbering?.includeSigningPage !== true)
                bodyEnd();
            if (
                signing.length ||
                (configuration.signingPage?.enabled !== false &&
                    configuration.signingPage?.parties?.length)
            ) {
                renderer.width =
                    page.width - page.margins.left - page.margins.right;
                const content = signing.length
                    ? renderer.blocks(signing[0].content)
                    : renderSigningPage(renderer, configuration.signingPage);
                addSection(
                    {
                        content,
                        configuration: { id: "signing", startsNewPage: true }
                    },
                    [],
                    configuration.pageNumbering?.includeSigningPage
                        ? configuration.defaultFooters ?? []
                        : []
                );
            }
            if (configuration.pageNumbering?.includeSigningPage === true)
                bodyEnd();
            for (const [identifier, bookmark] of renderer.bookmarks) {
                if (!bookmark.emitted)
                    renderer.warn(
                        "DOCX bookmark target was not found: " + identifier
                    );
            }
            return {
                success: true,
                output: document.build(configuration.metadata),
                mimeType: MIME_TYPE,
                warnings: [...renderer.warnings],
                errors: [],
                pageCount: 0
            };
        } catch (error) {
            return {
                success: false,
                output: null,
                mimeType: MIME_TYPE,
                warnings: renderer ? [...renderer.warnings] : [],
                errors: [error.message],
                pageCount: 0
            };
        }
    }
}

/** @param {DocumentRendererConfig} configuration @returns {DocxRenderer} */
export function createDocxRenderer(configuration) {
    return new DocxRenderer(configuration);
}
