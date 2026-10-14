import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

import { createContainer, createText } from "../../lib/ast/nodes/BaseNode.mjs";

import {
    createHeading,
    createParagraph,
    createList,
    createBlockquote,
    createCodeBlock,
    createHorizontalRule,
    createLink,
    createBold,
    createItalic,
    createUnderline,
    createInlineCode,
    ParagraphNode
} from "../../lib/ast/nodes/ProseNode.mjs";

import {
    createTableFromData,
    createTableFromObjects,
    TableNode
} from "../../lib/ast/nodes/TabularNode.mjs";

import {
    createArticle,
    createDefinition,
    createNotice,
    createSignatureBlock
} from "../../lib/ast/nodes/LegalNode.mjs";

import {
    createDocumentPipeline,
    createHeadingStyleRule,
    createLegalKeepTogetherRule,
    createArticlePageBreakRule
} from "../../lib/ast/pipelines/DocumentPipeline.mjs";

import { TwoPassPdfRenderer } from "../../lib/ast/renderers/TwoPassPdfRenderer.mjs";
import { createLegalDocumentConfig } from "../../lib/ast/composers/DocumentComposer.mjs";

export const defaultPageConfig = Object.freeze({
    size: "letter",
    margins: { top: 72, bottom: 72, left: 72, right: 72 }
});

export const defaultHeadingStyles = Object.freeze({
    1: { fontSize: 18, bold: true },
    2: { fontSize: 14, bold: true },
    3: { fontSize: 12, bold: true }
});

export function createDefaultRenderer(overrides = {}) {
    return new TwoPassPdfRenderer({
        pageConfig: defaultPageConfig,
        baseFontSize: 10,
        lineHeight: 1.4,
        ...overrides
    });
}

export function createStandardPipeline(config = {}) {
    const formattingRules = Array.isArray(config.formattingRules)
        ? config.formattingRules
        : [];

    const headingStyles = config.headingStyles ?? defaultHeadingStyles;

    return createDocumentPipeline()
        .addFormattingRules([
            ...formattingRules,
            createHeadingStyleRule(headingStyles)
        ])
        .setCompositionConfig({
            defaultPageConfig,
            sections: [],
            ...(config.compositionConfig ?? {})
        })
        .setRenderer(createDefaultRenderer(config.rendererConfig ?? {}));
}

export function ensureOutputDir(outputDir = "output") {
    mkdirSync(outputDir, { recursive: true });
    return outputDir;
}

export function writePdfOutput(filename, result, outputDir = "output") {
    ensureOutputDir(outputDir);

    if (!result.success || !result.renderResult?.output) {
        return false;
    }

    const outputPath = resolve(outputDir, filename);
    writeFileSync(outputPath, result.renderResult.output);
    return true;
}

export function createCenteredPageFooter(content) {
    return [
        {
            location: "footer",
            pages: "all",
            columns: {
                center: { content }
            }
        }
    ];
}

export function createDatedHeader(title) {
    return [
        {
            location: "header",
            pages: "not-first",
            columns: {
                left: { content: title },
                right: {
                    content: {
                        type: "variable",
                        name: "date",
                        format: "YYYY-MM-DD"
                    }
                }
            }
        }
    ];
}

export function logBanner(title) {
    console.log("=".repeat(70));
    console.log(title);
    console.log("=".repeat(70));
}

export function logExampleStart(index, total, label) {
    console.log(`\n[${index}/${total}] Generating ${label}...`);
}

export function logExampleResult(filename, result) {
    if (result.success && result.renderResult?.output) {
        console.log(
            `   ✓ ${filename} (${result.renderResult.pageCount} pages)`
        );
        return;
    }

    console.log("   ✗ Failed:", result.errors);
}

export function logSummary(results) {
    console.log(`\n${"=".repeat(70)}`);
    console.log("Generation Complete");
    console.log("=".repeat(70));

    const successCount = results.filter((result) => result.success).length;
    console.log(
        `\nSuccessfully generated ${successCount}/${results.length} PDFs`
    );

    const totalWarnings = results.reduce(
        (sum, result) => sum + (result.warnings?.length ?? 0),
        0
    );

    if (totalWarnings > 0) {
        console.log(`Total warnings: ${totalWarnings}`);
    }
}

export {
    createContainer,
    createText,
    createHeading,
    createParagraph,
    createList,
    createBlockquote,
    createCodeBlock,
    createHorizontalRule,
    createLink,
    createBold,
    createItalic,
    createUnderline,
    createInlineCode,
    ParagraphNode,
    createTableFromData,
    createTableFromObjects,
    TableNode,
    createArticle,
    createDefinition,
    createNotice,
    createSignatureBlock,
    createDocumentPipeline,
    createHeadingStyleRule,
    createLegalKeepTogetherRule,
    createArticlePageBreakRule,
    TwoPassPdfRenderer,
    createLegalDocumentConfig
};
