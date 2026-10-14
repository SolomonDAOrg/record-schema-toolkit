import { complexField } from "../../../docx/fields.mjs";
import { paragraph, textRun } from "../../../docx/styles.mjs";

/** @typedef {import("./content.mjs").DocxContentRenderer} DocxContentRenderer */
/** @typedef {import("../../types/core.mjs").TocNode} TocNode */
/** @typedef {import("../../types/core.mjs").TocLevelStyle} TocLevelStyle */
/** @typedef {import("../../types/core.mjs").ComposedSection} ComposedSection */

/** @param {Record<string | number, TocLevelStyle>} styles @param {number} level @returns {TocLevelStyle | undefined} */
function levelStyleFor(styles, level) {
    return (
        styles["heading_" + level] ??
        styles["heading-" + level] ??
        styles["heading" + level] ??
        styles["h" + level] ??
        styles[level]
    );
}

/** @param {DocxContentRenderer} renderer @param {TocNode} toc @param {ReadonlyArray<ComposedSection>} sections @returns {string} */
export function renderToc(renderer, toc, sections) {
    /** @type {Array<Pick<import("../../types/core.mjs").TocEntry, "nodeId" | "title" | "level" | "style">>} */
    let entries = toc.entries;
    if (toc.config.sectionDocuments?.length) {
        entries = [];
        const nodeIds = (node) => [node.id, ...node.children.flatMap(nodeIds)];
        for (const section of sections) {
            const document = toc.config.sectionDocuments.find(
                (item) => item.sectionId === section.id
            );
            if (!document) continue;
            entries.push({
                nodeId: section.id,
                title: document.title ?? document.name,
                level: 1
            });
            const identifiers = new Set(section.content.flatMap(nodeIds));
            entries.push(
                ...toc.entries
                    .filter((entry) => identifiers.has(entry.nodeId))
                    .map((entry) => ({ ...entry, level: entry.level + 1 }))
            );
        }
    }
    let content = paragraph(
        textRun(
            toc.config.title ?? "Table of Contents",
            renderer.style({
                bold: true,
                fontSize: 18,
                ...toc.config.titleStyle
            })
        ),
        renderer.style(),
        { keepNext: true }
    );
    for (const entry of entries) {
        const bookmark = renderer.bookmark(entry.nodeId);
        const styles = renderer.configuration.tocConfig?.levelStyles ?? {};
        const levelStyle =
            levelStyleFor(styles, entry.level) ??
            levelStyleFor(styles, 1) ??
            {};
        const style = renderer.style({
            ...entry.style?.textStyle,
            bold: true,
            fontSize:
                (entry.style?.textStyle?.fontSize ??
                    renderer.configuration.baseFontSize ??
                    10) * (levelStyle.fontSizeScale ?? 1)
        });
        const showPage =
            toc.config.showPageNumbers !== false &&
            entry.style?.showPageNumber !== false;
        const link =
            '<w:hyperlink w:anchor="' +
            bookmark.name +
            '">' +
            textRun(entry.title, style) +
            "</w:hyperlink>";
        const leaders = /** @type {const} */ ({
            dots: "dot",
            dashes: "hyphen",
            line: "underscore",
            none: "none"
        });
        const lineHeight = style.fontSize * style.lineHeight;
        const pageNumber = showPage
            ? textRun("\t", { ...style, bold: false }) +
              complexField([
                  "= ",
                  { instruction: ["PAGEREF " + bookmark.name + " \\* Arabic"] },
                  " - ",
                  { instruction: ["PAGEREF NumberingStart \\* Arabic"] },
                  " + 1"
              ])
            : "";
        content += paragraph(link + pageNumber, style, {
            tabs: [
                {
                    position: renderer.width,
                    align: "right",
                    leader: leaders[entry.style?.leaderStyle ?? "dots"]
                }
            ],
            indent:
                entry.style?.indent ??
                levelStyle.indent ??
                (entry.level - 1) * 18,
            before: lineHeight * (levelStyle.spacingBefore ?? 0),
            after: lineHeight * Math.max(0, (levelStyle.spacingAfter ?? 1) - 1)
        });
    }
    return content;
}
