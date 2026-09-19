/** @typedef {import("../types/core.mjs").HeadingPageBreaks} HeadingPageBreaks */
/** @typedef {import("../types/core.mjs").FormattingRule} FormattingRule */
/** @typedef {import("../nodes/ProseNode.mjs").HeadingNode} HeadingNode */

/** @param {HeadingPageBreaks} configuration @returns {FormattingRule} */
export function createHeadingPageBreakRule(configuration) {
    const levels = new Set(configuration.levels);
    const excluded = new Set(configuration.excludeText ?? []);
    return {
        id: "heading-page-break",
        description: "Start configured heading levels on a new page.",
        match: node => node.type === "heading" &&
            levels.has(/** @type {HeadingNode} */ (node).level) &&
            !excluded.has(node.getTextContent()),
        transform: node => ({
            ...node,
            keepRules: {...node.keepRules, pageBreakBefore: true}
        })
    };
}
