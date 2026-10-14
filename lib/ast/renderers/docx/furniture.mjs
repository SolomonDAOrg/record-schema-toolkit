import { renderPageTracking } from "./page-tracking.mjs";
import { pageDimensions } from "../../../docx/document.mjs";
import { paragraph, textRun } from "../../../docx/styles.mjs";

/** @typedef {import("./content.mjs").DocxContentRenderer} DocxContentRenderer */
/** @typedef {import("../../types/core.mjs").HeaderFooterConfig} HeaderFooterConfig */
/** @typedef {import("../../../docx/document.mjs").DocumentSection} DocumentSection */
/** @typedef {import("../../../docx/styles.mjs").ParagraphTab} ParagraphTab */

/** @param {DocxContentRenderer} renderer @param {HeaderFooterConfig | undefined} configuration @param {number} width @returns {string} */
function furnitureContent(renderer, configuration, width) {
    if (!configuration) return paragraph("");
    const columns = /** @type {const} */ (["left", "center", "right"]);
    const style = renderer.style({ fontSize: 9, lineHeight: 1 });
    /** @type {ParagraphTab[]} */
    const tabs = [];
    let content = "";
    for (const name of columns) {
        const column = configuration.columns[name];
        if (!column) continue;
        if (name !== "left") {
            // Empty center columns must not advance past the start of a right-aligned title.
            tabs.push({
                position: name === "center" ? width / 2 : width,
                align: name
            });
            content += textRun("\t", style);
        }
        content += renderer.variable(column.content, {
            fontSize: 9,
            ...column.style
        });
    }
    return paragraph(content, style, {
        tabs,
        border: configuration.border,
        borderSide: configuration.location === "footer" ? "top" : "bottom",
        borderSpace: 12
    });
}

/** @param {DocxContentRenderer} renderer @param {DocumentSection} section @param {ReadonlyArray<HeaderFooterConfig>} headers @param {ReadonlyArray<HeaderFooterConfig>} footers */
export function addFurniture(renderer, section, headers, footers) {
    const page = pageDimensions(
        section.pageConfiguration ??
            section.configuration.pageConfig ??
            renderer.configuration.pageConfig
    );
    const width = page.width - page.margins.left - page.margins.right;
    const choices = [headers, footers];
    for (const [index, configurations] of choices.entries()) {
        const location = index === 0 ? "header" : "footer";
        const ordered = [...configurations].sort(
            (a, b) => (b.priority ?? 0) - (a.priority ?? 0)
        );
        for (const item of ordered) {
            if (
                !(
                    typeof item.pages === "string" &&
                    [
                        "all",
                        "first",
                        "not-first",
                        "odd",
                        "even",
                        "section-first",
                        "section-not-first"
                    ].includes(item.pages)
                )
            ) {
                throw new Error(
                    "DOCX headers and footers cannot use page selector: " +
                        String(item.pages)
                );
            }
        }
        const selected = (type) =>
            ordered.find(
                (item) =>
                    item.pages === "all" ||
                    (type === "first" &&
                        ((typeof item.pages === "string" &&
                            ["section-first", "odd"].includes(item.pages)) ||
                            (item.pages === "first" &&
                                renderer.sectionIncludesFirstPage))) ||
                    (item.pages === "not-first" &&
                        !renderer.sectionIncludesFirstPage) ||
                    (type === "default" &&
                        typeof item.pages === "string" &&
                        ["not-first", "section-not-first", "odd"].includes(
                            item.pages
                        )) ||
                    (type === "even" &&
                        typeof item.pages === "string" &&
                        ["not-first", "section-not-first", "even"].includes(
                            item.pages
                        ))
            );
        const firstPage = ordered.some(
            (item) =>
                typeof item.pages === "string" &&
                [
                    "first",
                    "not-first",
                    "section-first",
                    "section-not-first"
                ].includes(item.pages)
        );
        const oddEven = ordered.some(
            (item) => item.pages === "odd" || item.pages === "even"
        );
        if (firstPage) section.firstPage = true;
        if (oddEven) renderer.document.evenAndOddHeaders = true;
        const references = ["default", "even", "first"]
            .map((type) => {
                const tracking =
                    location === "footer"
                        ? renderPageTracking(renderer, section, page)
                        : "";
                const relationship = renderer.document.addFurniture(
                    location,
                    furnitureContent(renderer, selected(type), width) +
                        (tracking
                            ? paragraph(tracking, {
                                  fontSize: 1,
                                  lineHeight: 1
                              })
                            : "")
                );
                return (
                    "<w:" +
                    location +
                    'Reference w:type="' +
                    type +
                    '" r:id="' +
                    relationship +
                    '"/>'
                );
            })
            .join("");
        if (location === "header") section.headerReferences = references;
        else section.footerReferences = references;
    }
}
