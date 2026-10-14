import { twips } from "../../../docx/xml.mjs";
import { paragraph, textRun } from "../../../docx/styles.mjs";
import { pageDimensions } from "../../../docx/document.mjs";
import { imageRun } from "../../../docx/media.mjs";

/** @typedef {import("./content.mjs").DocxContentRenderer} DocxContentRenderer */
/** @typedef {import("../../types/core.mjs").CoverPageNode} CoverPageNode */
/** @typedef {import("../../types/core.mjs").ComposedSection} ComposedSection */
/** @typedef {import("../../types/core.mjs").PageComposition} PageComposition */
/** @typedef {import("../../layout/LayoutEngine.mjs").LayoutEngine} LayoutEngine */
/** @typedef {import("../types/document.mjs").SigningPageConfig} SigningPageConfig */

/** @param {number} height @returns {string} */
function spacer(height) {
    return (
        '<w:p><w:pPr><w:spacing w:before="0" w:after="0" w:line="' +
        Math.max(1, twips(height)) +
        '" w:lineRule="exact"/></w:pPr></w:p>'
    );
}

/** @param {DocxContentRenderer} renderer @param {CoverPageNode} cover @returns {string} */
export function renderCover(renderer, cover) {
    const options = {
        ...renderer.configuration.coverConfig,
        ...cover.config.options
    };
    const page = pageDimensions(
        cover.config.pageConfig ?? renderer.configuration.pageConfig
    );
    let result = "";
    if (cover.config.backgroundColor ?? options.backgroundColor) {
        result += paragraph(
            renderer.textBox("", {
                x: 0,
                top: 0,
                width: page.width,
                height: page.height,
                fill: cover.config.backgroundColor ?? options.backgroundColor
            })
        );
    }
    if (options.pageFrame?.enabled) {
        const insetX =
            options.pageFrame.insetX ?? options.pageFrame.inset ?? 20;
        const insetY =
            options.pageFrame.insetY ?? options.pageFrame.inset ?? 20;
        result += paragraph(
            renderer.textBox("", {
                x: insetX,
                top: insetY,
                width: page.width - insetX * 2,
                height: page.height - insetY * 2,
                border: options.pageFrame.color ?? "#000000"
            })
        );
    }
    if (options.watermark?.enabled) {
        const watermark = options.watermark;
        const text = paragraph(
            textRun(watermark.text ?? "DRAFT", {
                fontFamily: "Arial",
                fontSize: watermark.fontSize ?? 64,
                color: "#dddddd"
            }),
            { align: "center", lineHeight: 1 }
        );
        const shape = renderer.textBox(text, {
            x: 60,
            top: page.height / 2 - 50,
            width: page.width - 120,
            height: 100
        });
        result += paragraph(
            shape.replace(
                "mso-position-horizontal-relative:page",
                "rotation:" +
                    (watermark.angleDeg ?? -35) +
                    ";mso-position-horizontal-relative:page"
            )
        );
    }
    for (const element of cover.elements) {
        const style = renderer.style(
            element.type === "spacer" ? {} : element.style ?? {}
        );
        switch (element.type) {
            case "spacer":
                result += spacer(element.height ?? 12);
                break;
            case "text":
                result += paragraph(
                    renderer.variable(element.content ?? "", style),
                    style
                );
                if (element.height)
                    result += spacer(
                        Math.max(
                            0,
                            element.height - style.fontSize * style.lineHeight
                        )
                    );
                break;
            case "title-block":
                result += paragraph(
                    textRun(element.title ?? "", { ...style, bold: true }),
                    { ...style, align: style.align ?? "center" }
                );
                if (element.conjunction)
                    result += paragraph(
                        textRun(element.conjunction, {
                            ...style,
                            fontSize: element.subtitleFontSize ?? 12,
                            color: element.conjunctionColor
                        }),
                        { ...style, align: style.align ?? "center" }
                    );
                if (element.entityName)
                    result += paragraph(
                        textRun(element.entityName, {
                            ...style,
                            fontSize: element.entityFontSize ?? 20,
                            color: element.entityColor
                        }),
                        { ...style, align: style.align ?? "center" }
                    );
                break;
            case "rule":
                result += paragraph("", style, {
                    border: {
                        width: element.lineWidth ?? 0.5,
                        color: element.color ?? element.stroke ?? "#000000"
                    }
                });
                if (element.afterSpacer) result += spacer(element.afterSpacer);
                break;
            case "kv-block":
                for (const row of element.rows ?? []) {
                    result += paragraph(
                        textRun(row.label + (element.separator ?? ": "), {
                            ...style,
                            bold: true
                        }) + renderer.variable(row.value, style),
                        style,
                        { after: element.lineSpacer ?? 4 }
                    );
                }
                break;
            case "box":
                result += paragraph(
                    renderer.variable(element.content ?? "", style),
                    style,
                    {
                        border: {
                            width:
                                element.lineWidth ??
                                element.style?.borderWidth ??
                                0.5,
                            color:
                                element.borderColor ??
                                element.style?.borderColor
                        },
                        shade: element.style?.backgroundColor
                    }
                );
                if (element.afterSpacer) result += spacer(element.afterSpacer);
                break;
            case "image": {
                const source =
                    element.content && typeof element.content !== "string"
                        ? String(renderer.variables[element.content.name] ?? "")
                        : String(element.content ?? "");
                result += paragraph(
                    imageRun(
                        renderer.document.archive,
                        renderer.part,
                        { src: source, height: element.height },
                        ++renderer.document.identifier,
                        renderer.width
                    ),
                    style
                );
                break;
            }
            default:
                throw new Error(
                    "Unsupported DOCX cover element: " +
                        /** @type {import("../../types/core.mjs").ResolvedCoverElement} */ (
                            element
                        ).type
                );
        }
    }
    return result;
}

/** @param {DocxContentRenderer} renderer @param {SigningPageConfig} configuration @returns {string} */
export function renderSigningPage(renderer, configuration) {
    const style = renderer.style();
    let content = "";
    /** @type {Array<[string | undefined, boolean]>} */
    const paragraphs = [
        [
            configuration.witnessClause ??
                "IN WITNESS WHEREOF, the parties hereto have executed this Agreement effective as of the Effective Date.",
            false
        ],
        [configuration.executionNote, false],
        [configuration.acknowledgmentTitle, true],
        [configuration.acknowledgmentText, false]
    ];
    for (const [text, bold] of paragraphs) {
        if (text)
            content += paragraph(textRun(text, { ...style, bold }), style, {
                after: 10,
                keepNext: true
            });
    }
    for (const party of configuration.parties) {
        content += renderer.signature(
            {
                attrs: {
                    directive: "signature-block",
                    partyLabel: party.label,
                    fields: party.fields,
                    signatories: party.signatories
                }
            },
            style
        );
    }
    if (configuration.effectiveDate)
        content += paragraph(
            textRun(configuration.effectiveDate, style),
            style
        );
    return content;
}

/** @param {DocxContentRenderer} renderer @param {ReadonlyArray<ComposedSection>} sections @param {PageComposition} configuration @param {LayoutEngine} engine @returns {string} */
export function renderPositionedPage(
    renderer,
    sections,
    configuration,
    engine
) {
    const page = pageDimensions(renderer.configuration.pageConfig);
    const sources = engine.layoutPageComposition(
        { ...configuration, mode: "fixed" },
        sections,
        page.width,
        page.height
    );
    let content = "";
    for (const decoration of configuration.decorations ?? [])
        content += renderer.textBox("", decoration);
    const logo = configuration.letterheadLogo;
    if (logo?.enabled !== false && logo?.path) {
        const scale = logo.scale ?? 1;
        const image = imageRun(
            renderer.document.archive,
            renderer.part,
            {
                src: logo.path,
                width: logo.width * scale,
                height: logo.height * scale
            },
            ++renderer.document.identifier,
            logo.width * scale
        );
        content += renderer.textBox(paragraph(image), {
            x: logo.x,
            top: logo.top,
            width: logo.width * scale,
            height: logo.height * scale
        });
    }
    const previousWidth = renderer.width;
    const literalFields = renderer.literalFields;
    renderer.literalFields = configuration.placeholderMode !== "fields";
    for (const original of configuration.regions) {
        const region = { ...original };
        if (
            logo?.enabled !== false &&
            logo?.path &&
            logo.shiftSourceHeadings.includes(region.sourceHeading)
        ) {
            const shift = Math.max(
                0,
                logo.x +
                    logo.width * (logo.scale ?? 1) +
                    (logo.gap ?? 12) -
                    region.x
            );
            region.x += shift;
            region.width -= shift;
            if (!(region.width > 0))
                throw new Error(
                    "Letterhead logo leaves no space for source region"
                );
        }
        renderer.width = region.width;
        const source = sources.get(region.sourceHeading);
        const style = renderer.style({
            fontSize: region.fontSize,
            lineHeight: region.lineSpacing ?? 1.3,
            color: region.color,
            bold: region.bold,
            align: region.align
        });
        let body = region.showHeading
            ? paragraph(
                  textRun(source.heading, {
                      ...style,
                      bold: true,
                      fontSize: region.headingFontSize ?? 8,
                      color: region.headingColor ?? region.color
                  }),
                  style,
                  { after: region.headingGap ?? 7 }
              )
            : "";
        body += renderer.blocks(source.nodes, style);
        content += renderer.textBox(body, region);
    }
    renderer.width = previousWidth;
    renderer.literalFields = literalFields;
    if (configuration.pagination) {
        const pagination = configuration.pagination;
        content += renderer.textBox(
            paragraph(
                textRun("Page ") +
                    renderer.variable({ type: "variable", name: "page" }) +
                    textRun(" of ") +
                    renderer.variable({ type: "variable", name: "totalPages" }),
                { fontSize: pagination.fontSize, color: pagination.color }
            ),
            { ...pagination, height: pagination.fontSize * 1.35 }
        );
    }
    return paragraph(content, { fontSize: 1, lineHeight: 1 });
}
