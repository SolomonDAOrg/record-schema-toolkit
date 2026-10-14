import {
    logBanner,
    logExampleStart,
    logExampleResult,
    logSummary,
    ensureOutputDir
} from "./util.mjs";
import { renderTablesExample } from "./tables.mjs";
import { renderFormattingExample } from "./formatting.mjs";
import { renderLegalExample } from "./legal.mjs";
import { renderTechnicalReport } from "./technical-report.mjs";

export { createTablesExample, renderTablesExample } from "./tables.mjs";
export {
    createFormattingExample,
    renderFormattingExample
} from "./formatting.mjs";
export { createLegalExample, renderLegalExample } from "./legal.mjs";
export {
    createTechnicalReport,
    renderTechnicalReport
} from "./technical-report.mjs";

export function main(outputDir = "output") {
    ensureOutputDir(outputDir);

    logBanner("Two-Pass PDF Generation Examples");

    logExampleStart(1, 4, "tables example");
    const tablesResult = renderTablesExample(outputDir);
    logExampleResult("tables-example.pdf", tablesResult);

    logExampleStart(2, 4, "formatting example");
    const formattingResult = renderFormattingExample(outputDir);
    logExampleResult("formatting-example.pdf", formattingResult);

    logExampleStart(3, 4, "legal example");
    const legalResult = renderLegalExample(outputDir);
    logExampleResult("legal-example.pdf", legalResult);

    logExampleStart(4, 4, "technical report");
    const technicalReportResult = renderTechnicalReport(outputDir);
    logExampleResult("technical-report.pdf", technicalReportResult);

    logSummary([
        tablesResult,
        formattingResult,
        legalResult,
        technicalReportResult
    ]);
}
