import { DEFAULT_SPACING_BEFORE } from "../constants/core.mjs";
import { isNumber, isString } from "../../util/general.mjs";

/** @typedef {import("../types/core.mjs").BaseNode} BaseNode */
/** @typedef {import("../types/core.mjs").NodeType} NodeType */
/** @typedef {import("../types/core.mjs").SpacingPolicy} SpacingPolicy */

/** @param {{baseFontSize?: number, spacingPolicy?: SpacingPolicy}} configuration @param {BaseNode} node @param {NodeType | null} previousNodeType @param {(message: string) => void} [trace] @returns {number} */
export function getVerticalSpacing(
    configuration,
    node,
    previousNodeType,
    trace = () => {}
) {
    const fontSize = configuration.baseFontSize ?? 10;
    const em = fontSize;

    // Explicit per-node spacingBefore overrides policy/defaults (interpreted as em unless *Pt field used)
    const nodeStyle =
        /** @type {any} */ (node).textStyle ??
        node.attrs?.textStyle ??
        node.attrs?.style;
    const spacingBeforePt =
        nodeStyle?.spacingBeforePt ??
        nodeStyle?.beforeSpacingPt ??
        node.attrs?.spacingBeforePt ??
        node.attrs?.beforeSpacingPt ??
        null;

    if (isNumber(spacingBeforePt)) {
        return spacingBeforePt;
    }

    const spacingBeforeEm =
        nodeStyle?.spacingBefore ??
        nodeStyle?.beforeSpacing ??
        node.attrs?.spacingBefore ??
        node.attrs?.beforeSpacing ??
        null;

    if (isNumber(spacingBeforeEm)) {
        return spacingBeforeEm * em;
    }

    if (isString(spacingBeforeEm) && spacingBeforeEm.trim().length > 0) {
        const v = Number(spacingBeforeEm);
        if (Number.isFinite(v)) {
            return v * em;
        }
    }

    // A list straight after an item's own line is that item's nested list: it continues
    // the item, so no gap opens above it whatever the pack's list spacing is.
    if (node.type === "list" && previousNodeType === "list-item") {
        return 0;
    }

    const policy = configuration.spacingPolicy;

    if (policy) {
        const resolved = resolveBeforeSpacing(
            policy,
            previousNodeType,
            node.type,
            em,
            trace
        );

        if (resolved !== null) {
            return resolved;
        }
    }

    // Legacy defaults using constants (only used when spacingPolicy is not provided)
    if (!previousNodeType) {
        // First element on page - no extra spacing needed
        // newPage already accounts for header offset
        return 0;
    }

    switch (node.type) {
        case "heading":
            // Headings need significantly more space if following content
            if (
                previousNodeType === "paragraph" ||
                previousNodeType === "list" ||
                previousNodeType === "code-block" ||
                previousNodeType === "table" ||
                previousNodeType === "blockquote" ||
                previousNodeType === "notice"
            ) {
                return DEFAULT_SPACING_BEFORE.heading_after_content * em;
            }
            // Heading after heading (subtitle) needs less
            if (previousNodeType === "heading") {
                return DEFAULT_SPACING_BEFORE.heading_after_heading * em;
            }
            // Heading after HR — mirror the HR's own before-spacing so
            // the gap above and below the rule line are identical.
            if (previousNodeType === "horizontal-rule") {
                return DEFAULT_SPACING_BEFORE.horizontal_rule_default * em;
            }
            // Default spacing for headings
            return DEFAULT_SPACING_BEFORE.heading_default * em;

        case "paragraph":
            if (previousNodeType === "heading") {
                return DEFAULT_SPACING_BEFORE.paragraph_after_heading * em;
            }
            return DEFAULT_SPACING_BEFORE.paragraph_default * em;

        case "list":
            return DEFAULT_SPACING_BEFORE.list_default * em;

        case "table":
            return DEFAULT_SPACING_BEFORE.table_default * em;

        case "blockquote":
            return DEFAULT_SPACING_BEFORE.blockquote_default * em;

        case "code-block":
            return DEFAULT_SPACING_BEFORE.code_block_default * em;

        case "horizontal-rule":
            return DEFAULT_SPACING_BEFORE.horizontal_rule_default * em;

        case "notice":
            // Notices have internal padding, so less external spacing needed
            if (previousNodeType === "heading") {
                return 0.3 * em;
            }
            return 0.75 * em;

        case "signature-block":
            return DEFAULT_SPACING_BEFORE.signature_block_default * em;

        case "article":
        case "section":
            return DEFAULT_SPACING_BEFORE.article_default * em;

        default:
            return 0;
    }
}

/**
 * Resolve before-spacing from a spacing policy.
 *
 * Pair-rule shape (recommended):
 * { prev: "heading", next: "paragraph", em: 0.5, priority?: 10 }
 *
 * Supported aliases:
 * - prev: previous | from | after
 * - next: current | to | before
 * - pt: points | spacingPt
 * - em: spacingEm | spacing
 *
 * @param {SpacingPolicy} policy
 * @param {NodeType | null} prevType
 * @param {NodeType} nextType
 * @param {number} em
 * @param {(message: string) => void} [trace]
 * @returns {number | null}
 */
export function resolveBeforeSpacing(
    policy,
    prevType,
    nextType,
    em,
    trace = () => {}
) {
    /** @type {ReadonlyArray<any>} */
    const rules = policy.beforeRules ?? [];

    /** @type {Readonly<Record<string, number>> | undefined} */
    const perTypeDefaults = policy.defaultBeforeEmByType;

    let bestPriority = -Infinity;
    /** @type {any | null} */
    let bestRule = null;

    for (let i = 0, len = rules.length; i < len; i++) {
        const rule = rules[i];

        const rulePrev = rule.prev ?? rule.previous ?? rule.from ?? rule.after;
        const ruleNext = rule.next ?? rule.current ?? rule.to ?? rule.before;

        if (
            !matchesSpacingSelector(rulePrev, prevType) ||
            !matchesSpacingSelector(ruleNext, nextType)
        ) {
            continue;
        }

        const priority = isNumber(rule.priority) ? rule.priority : 0;
        if (priority > bestPriority) {
            bestPriority = priority;
            bestRule = rule;
        }
    }

    if (bestRule) {
        const pt =
            bestRule.pt ??
            bestRule.points ??
            bestRule.spacingPt ??
            bestRule.spacing_pt ??
            null;

        if (isNumber(pt)) {
            trace(
                `    spacingPolicy: matched pair rule prev=${prevType} next=${nextType} → ${pt}pt (priority=${bestPriority})`
            );
            return pt;
        }

        const emVal =
            bestRule.em ??
            bestRule.spacingEm ??
            bestRule.spacing_em ??
            bestRule.spacing ??
            bestRule.beforeEm ??
            bestRule.before_em ??
            null;

        if (isNumber(emVal)) {
            trace(
                `    spacingPolicy: matched pair rule prev=${prevType} next=${nextType} → ${emVal}em = ${(
                    emVal * em
                ).toFixed(1)}pt (priority=${bestPriority})`
            );
            return emVal * em;
        }

        // Matched rule explicitly provides no spacing -> 0
        trace(
            `    spacingPolicy: matched pair rule prev=${prevType} next=${nextType} → 0pt (no value, priority=${bestPriority})`
        );
        return 0;
    }

    if (perTypeDefaults) {
        const v = perTypeDefaults[nextType];
        if (isNumber(v)) {
            return v * em;
        }
    }

    return null;
}

/**
 * @param {any} selector
 * @param {NodeType | null} actual
 * @returns {boolean}
 */
export function matchesSpacingSelector(selector, actual) {
    if (selector === undefined || selector === "*" || selector === "any") {
        return true;
    }
    if (selector === null) {
        return actual === null;
    }
    if (Array.isArray(selector)) {
        for (let i = 0, len = selector.length; i < len; i++) {
            if (selector[i] === actual) {
                return true;
            }
        }
        return false;
    }
    return selector === actual;
}
