import { posix } from "node:path";
import { writeZip } from "./zip.mjs";
import { XML_DECLARATION, RELATIONSHIP_NAMESPACE, escapeXml } from "../xml.mjs";

/** @typedef {{ id: string, type: string, target: string, external: boolean }} Relationship */

export class DocxPackage {
    constructor() {
        /** @type {Map<string, Uint8Array>} */
        this.parts = new Map();
        /** @type {Map<string, string>} */
        this.contentTypes = new Map();
        /** @type {Map<string, Relationship[]>} */
        this.relationships = new Map();
    }

    /** @param {string} path @param {string | Uint8Array} content @param {string} contentType */
    addPart(path, content, contentType) {
        if (this.parts.has(path)) throw new Error("Duplicate DOCX part: " + path);
        this.parts.set(path, Buffer.from(content));
        this.contentTypes.set(path, contentType);
    }

    /** @param {string} source @param {string} type @param {string} target @param {boolean} [external] @returns {string} */
    relate(source, type, target, external = false) {
        const relationships = this.relationships.get(source) ?? [];
        const existing = relationships.find(item => item.type === type && item.target === target && item.external === external);
        if (existing) return existing.id;
        const id = "rId" + (relationships.length + 1);
        relationships.push({ id, type, target, external });
        this.relationships.set(source, relationships);
        return id;
    }

    /** @returns {Buffer} */
    build() {
        const parts = new Map(this.parts);
        for (const [source, relationships] of this.relationships) {
            const name = source ? posix.join(posix.dirname(source), "_rels", posix.basename(source) + ".rels") : "_rels/.rels";
            for (const relationship of relationships) {
                if (!relationship.external && !parts.has(posix.normalize(posix.join(posix.dirname(source), relationship.target)))) {
                    throw new Error("Missing DOCX relationship target: " + relationship.target);
                }
            }
            const xml = XML_DECLARATION + '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
                relationships.map(item => '<Relationship Id="' + item.id + '" Type="' + escapeXml(item.type) + '" Target="' + escapeXml(item.target) + '"' + (item.external ? ' TargetMode="External"' : "") + "/>").join("") + "</Relationships>";
            parts.set(name, Buffer.from(xml));
        }
        const contentTypes = XML_DECLARATION + '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
            [...this.contentTypes].map(([path, type]) => '<Override PartName="/' + escapeXml(path) + '" ContentType="' + escapeXml(type) + '"/>').join("") + "</Types>";
        parts.set("[Content_Types].xml", Buffer.from(contentTypes));
        return writeZip(parts);
    }
}

export const RELATIONSHIP_TYPES = {
    document: RELATIONSHIP_NAMESPACE + "/officeDocument",
    styles: RELATIONSHIP_NAMESPACE + "/styles",
    settings: RELATIONSHIP_NAMESPACE + "/settings",
    numbering: RELATIONSHIP_NAMESPACE + "/numbering",
    header: RELATIONSHIP_NAMESPACE + "/header",
    footer: RELATIONSHIP_NAMESPACE + "/footer",
    hyperlink: RELATIONSHIP_NAMESPACE + "/hyperlink",
    image: RELATIONSHIP_NAMESPACE + "/image",
    core: "http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties",
    application: RELATIONSHIP_NAMESPACE + "/extended-properties"
};
