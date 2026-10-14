import { complexField } from "../../../docx/fields.mjs";
import { paragraph } from "../../../docx/styles.mjs";
import { layoutPageTracking } from "../../../pdf/page-tracking/layout.mjs";
import { twips } from "../../../docx/xml.mjs";

/** @typedef {import("./content.mjs").DocxContentRenderer} DocxContentRenderer */
/** @typedef {import("../../../docx/document.mjs").DocumentSection} DocumentSection */

/** @param {DocxContentRenderer} renderer @param {DocumentSection} section @param {ReturnType<import("../../../docx/document.mjs").pageDimensions>} page @returns {string} */
export function renderPageTracking(renderer, section, page) {
    const configuration = renderer.configuration.pageTracking;
    if (
        !configuration?.enabled ||
        (section.configuration.id === "signing" &&
            configuration.suppressSigning !== false) ||
        (["cover", "dust-cover"].includes(section.configuration.id) &&
            configuration.suppressCover === true)
    )
        return "";
    const identifier = String(
        configuration.identifier ?? renderer.variables.documentId ?? ""
    );
    const layout = layoutPageTracking(configuration, {
        pageWidth: page.width,
        pageHeight: page.height,
        rightMargin: page.margins.right,
        pageNumber: 1,
        totalPages: 1,
        documentId: identifier ?? ""
    });
    if (String(identifier).includes('"') || String(identifier).includes("\\"))
        throw new Error(
            "DOCX barcode identifier cannot contain a quote or backslash"
        );
    const barcode = complexField([
        'DISPLAYBARCODE "' + identifier + "|",
        { instruction: ["PAGE \\* Arabic"] },
        "/",
        { instruction: ["NUMPAGES \\* Arabic"] },
        '" CODE128 \\h ' +
            twips(configuration.barHeight ?? 14) +
            (configuration.showText === false ? "" : " \\t")
    ]);
    const width = Math.min(
        page.height - (configuration.bottomInset ?? 24) - 24,
        Math.max(layout.width, 240)
    );
    const height = layout.height;
    const right = configuration.rightInset ?? 12;
    const bottom = configuration.bottomInset ?? 24;
    const centerX = page.width - right - height / 2;
    const centerY = page.height - bottom - width / 2;
    const box = renderer.textBox(
        paragraph(barcode, {
            fontSize: configuration.fontSize ?? 5,
            lineHeight: 1
        }),
        { x: centerX - width / 2, top: centerY - height / 2, width, height }
    );
    renderer.warn(
        "DOCX page tracking uses Word DISPLAYBARCODE fields; barcode sizing and evaluation are controlled by Word."
    );
    return box.replace(
        "mso-position-horizontal-relative:page",
        "rotation:270;mso-position-horizontal-relative:page"
    );
}
