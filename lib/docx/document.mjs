import { DocxPackage, RELATIONSHIP_TYPES } from "./package/Package.mjs";
import { XML_DECLARATION, WORD_NAMESPACE, DOCUMENT_NAMESPACES, escapeXml, twips } from "./xml.mjs";
import { paragraph, stylesDocument } from "./styles.mjs";
import { Numbering } from "./numbering.mjs";
import { PAGE_SIZES } from "../ast/constants/core.mjs";

/** @typedef {import("../ast/types/core.mjs").PageConfig} PageConfig */
/** @typedef {import("../ast/types/core.mjs").SectionConfig} SectionConfig */
/** @typedef {{ title?: string, author?: string, subject?: string, creator?: string, producer?: string, includeDates?: boolean }} DocumentMetadata */
/** @typedef {{ content: string, configuration: SectionConfig, headerReferences?: string, footerReferences?: string, firstPage?: boolean, pageConfiguration?: PageConfig }} DocumentSection */

/** @param {PageConfig} configuration @returns {{width: number, height: number, margins: {top: number, right: number, bottom: number, left: number}}} */
export function pageDimensions(configuration) {
    const page = PAGE_SIZES[configuration.size ?? "a4"];
    if (!page) throw new Error("Unknown page size: " + configuration.size);
    let width = configuration.width ?? page.width;
    let height = configuration.height ?? page.height;
    if (configuration.orientation === "landscape" && width < height) [width, height] = [height, width];
    if (configuration.orientation === "portrait" && width > height) [width, height] = [height, width];
    // Render-pack margins may also contain metadata such as unit: "pt".
    const margins = {
        top: configuration.margins?.top ?? 50,
        right: configuration.margins?.right ?? 50,
        bottom: configuration.margins?.bottom ?? 50,
        left: configuration.margins?.left ?? 50
    };
    if (!(width > 0 && height > 0) || !Object.values(margins).every(value => Number.isFinite(value) && value >= 0) ||
        margins.left + margins.right >= width || margins.top + margins.bottom >= height) throw new Error("Invalid DOCX page dimensions or margins");
    return {width, height, margins};
}

/** @param {DocumentSection} section @param {PageConfig} defaults @returns {string} */
function sectionProperties(section, defaults) {
    const configuration = section.configuration;
    const dimensions = pageDimensions(section.pageConfiguration ?? configuration.pageConfig ?? defaults);
    const {width, height, margins} = dimensions;
    const formats = {arabic: "decimal", roman: "lowerRoman", "roman-upper": "upperRoman", alpha: "lowerLetter", "alpha-upper": "upperLetter"};
    return "<w:sectPr>" + (section.headerReferences ?? "") + (section.footerReferences ?? "") +
        '<w:type w:val="' + (configuration.startsOddPage ? "oddPage" : configuration.startsNewPage === false ? "continuous" : "nextPage") + '"/>' +
        '<w:pgSz w:w="' + twips(width) + '" w:h="' + twips(height) + '"' + (width > height ? ' w:orient="landscape"' : "") + '/><w:pgMar w:top="' +
        twips(margins.top) + '" w:right="' + twips(margins.right) + '" w:bottom="' + twips(margins.bottom) + '" w:left="' + twips(margins.left) +
        '" w:header="' + twips(Math.min(24, margins.top / 2)) + '" w:footer="' + twips(Math.min(24, margins.bottom / 2)) + '" w:gutter="0"/>' +
        '<w:pgNumType w:fmt="' + formats[configuration.pageNumberStyle ?? "arabic"] + '"' +
        "" + "/>" +
        (section.firstPage ? "<w:titlePg/>" : "") + "</w:sectPr>";
}

export class DocxDocument {
    /** @param {PageConfig} pageConfiguration @param {import("./styles.mjs").RunStyle} style */
    constructor(pageConfiguration, style) {
        this.pageConfiguration = pageConfiguration;
        this.style = style;
        this.archive = new DocxPackage();
        this.numbering = new Numbering();
        this.identifier = 0;
        this.evenAndOddHeaders = false;
        /** @type {DocumentSection[]} */
        this.sections = [];
    }

    /** @param {"header" | "footer"} location @param {string} content @returns {string} */
    addFurniture(location, content) {
        const name = location + (++this.identifier) + ".xml";
        this.archive.addPart("word/" + name, XML_DECLARATION + "<w:" + (location === "header" ? "hdr" : "ftr") + " " + DOCUMENT_NAMESPACES + ">" +
            (content || paragraph("")) + "</w:" + (location === "header" ? "hdr" : "ftr") + ">", "application/vnd.openxmlformats-officedocument.wordprocessingml." + location + "+xml");
        return this.archive.relate("word/document.xml", RELATIONSHIP_TYPES[location], name);
    }

    /** @param {DocumentMetadata} [metadata] @returns {Buffer} */
    build(metadata = {}) {
        const sections = this.sections.length ? this.sections : [{content: paragraph(""), configuration: {id: "body"}}];
        let content = "";
        for (let index = 0; index < sections.length; index++) {
            const section = sections[index];
            content += section.content || paragraph("");
            const properties = sectionProperties(section, this.pageConfiguration);
            content += index === sections.length - 1 ? properties : "<w:p><w:pPr>" + properties + "</w:pPr></w:p>";
        }
        this.archive.addPart("word/document.xml", XML_DECLARATION + "<w:document " + DOCUMENT_NAMESPACES + "><w:body>" + content + "</w:body></w:document>",
            "application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml");
        this.archive.relate("", RELATIONSHIP_TYPES.document, "word/document.xml");
        const parts = [
            ["styles", stylesDocument(this.style)],
            ["numbering", this.numbering.build()],
            ["settings", XML_DECLARATION + '<w:settings xmlns:w="' + WORD_NAMESPACE + '">' + (this.evenAndOddHeaders ? "<w:evenAndOddHeaders/>" : "") +
                '<w:updateFields w:val="true"/><w:compat><w:compatSetting w:name="compatibilityMode" w:uri="http://schemas.microsoft.com/office/word" w:val="15"/></w:compat></w:settings>']
        ];
        for (const [name, xml] of parts) {
            this.archive.addPart("word/" + name + ".xml", xml, "application/vnd.openxmlformats-officedocument.wordprocessingml." + name + "+xml");
            this.archive.relate("word/document.xml", RELATIONSHIP_TYPES[name], name + ".xml");
        }
        const core = XML_DECLARATION + '<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">' +
            "<dc:title>" + escapeXml(metadata.title ?? "") + "</dc:title><dc:creator>" + escapeXml(metadata.author ?? "") + "</dc:creator><dc:subject>" +
            escapeXml(metadata.subject ?? "") + "</dc:subject>" + (metadata.includeDates === false ? "" : '<dcterms:created xsi:type="dcterms:W3CDTF">' + new Date().toISOString() + "</dcterms:created>") + "</cp:coreProperties>";
        this.archive.addPart("docProps/core.xml", core, "application/vnd.openxmlformats-package.core-properties+xml");
        this.archive.relate("", RELATIONSHIP_TYPES.core, "docProps/core.xml");
        this.archive.addPart("docProps/app.xml", XML_DECLARATION + '<Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/extended-properties"><Application>' +
            escapeXml(metadata.creator ?? "record-schema-toolkit") + "</Application></Properties>", "application/vnd.openxmlformats-officedocument.extended-properties+xml");
        this.archive.relate("", RELATIONSHIP_TYPES.application, "docProps/app.xml");
        return this.archive.build();
    }
}
