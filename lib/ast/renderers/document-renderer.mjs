import { createTwoPassPdfRenderer } from "./TwoPassPdfRenderer.mjs";
import { createDocxRenderer } from "./DocxRenderer.mjs";

/** @typedef {"pdf" | "docx"} DocumentOutputFormat */

/** @param {DocumentOutputFormat} format @param {import("./types/document.mjs").DocumentRendererConfig} configuration @returns {import("../pipelines/DocumentPipeline.mjs").DocumentRenderer} */
export function createDocumentRenderer(format, configuration) {
    switch (format) {
        case "pdf": return createTwoPassPdfRenderer(configuration);
        case "docx": return createDocxRenderer(configuration);
        default: throw new Error("Unsupported document output format: " + format);
    }
}
