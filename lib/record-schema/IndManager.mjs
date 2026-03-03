/**
 * Manager for Internal Document Numbers (IND)
 * @module services/IndManager
 */

import { readFileSync, writeFileSync } from "node:fs";
import { DocumentMetadata } from "./DocumentMetadata.mjs";

export class IndManager {
    /**
     * @param {import("../record-schema/Registry.mjs").Registry} registry
     */
    constructor(registry) {
        this.registry = registry;
    }

    /**
     * Generate an IND string
     * @param {string} record_id
     * @param {string} doc_type_code
     * @param {string} [version]
     * @returns {string}
     */
    generateInd(record_id, doc_type_code, version) {
        const v = version ? `-v${version}` : "";
        return `${record_id}-${doc_type_code}${v}`;
    }

    /**
     * Check if IND should be excluded from PDF for a given document type
     * @param {string} doc_type_code
     * @returns {boolean}
     */
    shouldExclude(doc_type_code) {
        if (!this.registry) {
            return false;
        }
        return this.registry.shouldExcludeIndFromPdf(doc_type_code);
    }

    /**
     * Applies or updates the IND (Document-ID) in a Markdown file.
     * Uses DocumentMetadata to ensure consistent formatting and marker usage.
     * * @param {string} filePath - Path to the markdown file
     * @param {string} indValue - The IND string to write (e.g. "XX-00000-MEM")
     * @returns {boolean} - True if file was modified
     */
    applyIndToPath(filePath, indValue) {
        let content;
        try {
            content = readFileSync(filePath, "utf8");
        } catch (err) {
            console.error(`Failed to read file ${filePath}: ${err.message}`);
            return false;
        }

        // 1. Parse existing structure using DocumentMetadata
        const extraction = DocumentMetadata.extractTrailing(content);
        let meta = extraction.metadata;
        let body = extraction.body;

        // 2. Initialize metadata if missing
        if (!meta) {
            meta = new DocumentMetadata({});
            // Ensure separation from body content
            if (!body.endsWith("\n\n")) {
                if (body.endsWith("\n")) body += "\n";
                else body += "\n\n";
            }
        }

        // 3. Check for existing value (idempotency check)
        // Access data directly as DocumentMetadata stores it in .data property
        const existingInd = meta.getString("Document-ID");
        if (existingInd === indValue) {
            return false;
        }

        // 4. Update the Document-ID
        meta.data["Document-ID"] = indValue;

        // 5. Reconstruct and Write
        // Use serializeWithMarkers() to wrap with correct BEGIN/END blocks
        const newBlock = meta.serializeWithMarkers();
        const newContent = body + newBlock;

        writeFileSync(filePath, newContent, "utf8");
        return true;
    }
}
