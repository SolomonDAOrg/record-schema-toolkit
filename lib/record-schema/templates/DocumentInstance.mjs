import { resolve, dirname } from "node:path";
import { createHash } from "node:crypto";
import { Document } from "../Document.mjs";
import { Metafile } from "../Metafile.mjs";
import { DataTable } from "../DataTable.mjs";
import { parseYaml } from "../../parsing/yaml.mjs";
import { applyMetadataBinding } from "./metadata-bindings.mjs";

/** @typedef {import("./types.mjs").TemplateContract} TemplateContract */
/** @typedef {import("./types.mjs").InstanceData} InstanceData */
/** @typedef {import("../Repository.mjs").Repository} Repository */
/** @typedef {import("../Repository.mjs").RecordInfo} RecordInfo */
/** @typedef {import("../../ast/nodes/BaseNode.mjs").BaseNode} BaseNode */

/** A validated, immutable selection of one series template and one YAML stage. */
export class DocumentInstance {
    /** @param {Repository} repository @param {RecordInfo} record @param {{instance?: string; stage?: string}} [options] */
    static load(repository, record, options = {}) {
        const contract = record.metafile?.data.template;
        if (!contract) {
            if (options.instance || options.stage) throw new Error("This series has no template binding contract.");
            return null;
        }
        const contractSchema = repository.loadSchemaMaterial("schema/document.template.schema.json");
        const instanceSchema = repository.loadSchemaMaterial("schema/document.instance.schema.json");
        if (!contractSchema || !instanceSchema) throw new Error("Document binding schemas are missing from the declared schema materials.");
        const contractErrors = contractSchema.validate(contract);
        if (contractErrors.length) throw new Error("Invalid template contract: " + JSON.stringify(contractErrors));
        const selected = options.instance || contract.default_instance;
        if (!Object.hasOwn(contract.instances, selected)) throw new Error("Unknown document instance: " + selected);
        const resource = Document.fromText("", record.metafile.source_path);
        const path = contract.instances[selected];
        const bytes = resource.loadResource(path);
        const data = parseYaml(new TextDecoder("utf-8", {fatal: true}).decode(bytes));
        const errors = instanceSchema.validate(data);
        if (errors.length) throw new Error("Invalid document instance: " + JSON.stringify(errors));
        const stage = options.stage || data.default_stage;
        if (!Object.hasOwn(data.stages, stage)) throw new Error("Undefined instance stage: " + stage);
        const instance = new DocumentInstance(contract, data, stage, resolve(dirname(record.metafile.source_path), path), record.metafile);
        const metadataSchema = repository.loadSchemaMaterial("schema/record.meta.schema.json");
        if (!metadataSchema) throw new Error("Record metadata schema is missing.");
        const metadataErrors = metadataSchema.validate(instance.metafile.data);
        if (metadataErrors.length) throw new Error("Invalid bound metadata: " + JSON.stringify(metadataErrors));
        return instance;
    }

    /** @param {TemplateContract} contract @param {InstanceData} data @param {string} stage @param {string} sourcePath @param {Metafile} metafile */
    constructor(contract, data, stage, sourcePath, metafile) {
        this.contract = contract;
        this.stage = stage;
        this.sourcePath = sourcePath;
        const templateVersion = metafile.data.document?.version ?? metafile.data.version;
        if (data.template.record_id !== metafile.data.id || data.template.version !== templateVersion)
            throw new Error("Instance template identity/version does not match the series META.");
        const overlay = data.stages[stage];
        if (!overlay) throw new Error("Undefined instance stage: " + stage);
        this.documentId = data.document_id + "/" + overlay.document.version;
        /** @type {Record<string,string|boolean>} */
        this.values = Object.create(null);
        /** @type {Record<string,string>} */
        this.text = Object.create(null);
        /** @type {Set<string>} */
        this.unresolved = new Set();
        /** @type {Map<string, import("../DataTable.mjs").ParsedDataTable>} */
        this.tables = new Map();
        /** @type {Set<string>} */
        this.usedSignatures = new Set();
        const fields = {...data.fields, ...overlay.fields};
        for (const key of Object.keys(fields))
            if (!Object.hasOwn(contract.fields, key)) throw new Error("Undeclared instance field: " + key);
        for (const [name, field] of Object.entries(contract.fields)) {
            if (!Object.hasOwn(fields, name) || fields[name] === "") {
                if (field.required && stage === "for_execution") throw new Error("Required execution field is missing: " + name);
                if (field.required && !field.draft_placeholder) throw new Error("Missing required field has no draft placeholder: " + name);
                this.unresolved.add(name);
                this.text[name] = stage === "draft" ? field.draft_placeholder ?? "" : "";
                continue;
            }
            const value = fields[name];
            if (field.type === "boolean") {
                if (typeof value !== "boolean") throw new Error("Expected boolean field: " + name);
                this.text[name] = value ? field.true_label : field.false_label;
            } else {
                if (typeof value !== "string" || /[\r\n\u0000-\u001f]/.test(value))
                    throw new Error("Expected a single-line text value: " + name);
                if (value.includes("{{")) throw new Error("Field values cannot contain template tokens: " + name);
                if (field.type === "enum" && !field.values.includes(value))
                    throw new Error("Field value is outside its declared enum: " + name);
                this.text[name] = field.type === "date" || field.type === "decimal"
                    ? DataTable.formatValue(value, {...field, header: name, align: "left", width: "auto"})
                    : value;
            }
            this.values[name] = value;
        }
        const bindings = {...data.datasets, ...overlay.datasets};
        for (const name of Object.keys(bindings))
            if (!Object.hasOwn(contract.datasets, name)) throw new Error("Undeclared dataset slot: " + name);
        const resource = Document.fromText("", sourcePath);
        for (const [name, definition] of Object.entries(contract.datasets)) {
            if (!Object.hasOwn(bindings, name)) throw new Error("Unbound dataset slot: " + name);
            const binding = bindings[name];
            const bytes = resource.loadResource(binding.path);
            if (createHash("sha256").update(bytes).digest("hex") !== binding.sha256)
                throw new Error("Dataset checksum mismatch: " + name);
            this.tables.set(name, DataTable.parse(binding.path, JSON.stringify(definition), bytes));
        }
        const metadata = structuredClone(metafile.data);
        metadata.assembly ??= {};
        metadata.assembly.packet ??= {};
        metadata.assembly.packet.cover ??= {};
        Object.assign(metadata.assembly.packet, {
            document_id: data.document_id,
            version: overlay.document.version,
            path: overlay.document.path
        });
        const destinations = new Set();
        for (const binding of contract.metadata) {
            if (destinations.has(binding.target)) throw new Error("Duplicate metadata destination: " + binding.target);
            destinations.add(binding.target);
            if (!Object.hasOwn(contract.fields, binding.field)) throw new Error("Undeclared metadata field: " + binding.field);
            if (this.unresolved.has(binding.field)) {
                if (stage === "for_execution") throw new Error("Unbound execution metadata: " + binding.target);
                continue;
            }
            applyMetadataBinding(metadata, binding.target, this.values[binding.field]);
        }
        if (metadata.status.phase !== (stage === "draft" ? "draft" : "execution"))
            throw new Error("Bound status.phase must agree with the selected instance stage.");
        this.metafile = new Metafile(metadata, metafile.source_path);
        // This binds the selected values and the exact contract. PDF byte hashes are separate.
        this.bindingHash = createHash("sha256").update(JSON.stringify({
            template: data.template, contract, stage, document: this.documentId,
            fields, datasets: bindings
        })).digest("hex");
        Object.freeze(this.values);
        Object.freeze(this.text);
    }

    /** Bind literal text after Markdown parsing; values cannot inject Markdown structure. @param {string} text */
    bindText(text) {
        const bound = text.replace(/\{\{field:([A-Za-z][A-Za-z0-9]*)\}\}/g, (_match, name) => {
            if (!Object.hasOwn(this.text, name)) throw new Error("Unknown template field: " + name);
            return this.text[name];
        });
        if (bound.includes("{{field:")) throw new Error("Malformed or split template field token.");
        return bound;
    }

    /** @param {BaseNode} node */
    bindSource(node) {
        if (node.type === "table" && node.attrs.dataTableSource) return;
        if (node.type === "text") {
            const text = node.getTextContent();
            if (text.includes("{{field:")) {
                if (node.formats?.length) throw new Error("Template field spans cannot contain positional formats.");
                node.setTextContent(this.bindText(text));
            }
        }
        for (const child of node.children) this.bindSource(child);
    }

    /** @param {string} slot */
    dataset(slot) {
        const table = this.tables.get(slot);
        if (!table) throw new Error("Unknown dataset slot: " + slot);
        return table;
    }

    /** @param {string} slot */
    signature(slot) {
        if (!Object.hasOwn(this.contract.signatures, slot)) throw new Error("Unknown signing slot: " + slot);
        if (this.usedSignatures.has(slot)) throw new Error("Signing slot used more than once: " + slot);
        this.usedSignatures.add(slot);
        const definition = this.contract.signatures[slot];
        const value = (field) => {
            if (!field) return "";
            if (!Object.hasOwn(this.text, field)) throw new Error("Undeclared signing field: " + field);
            return this.text[field];
        };
        return {
            directive: "signature-block", variant: "single", fieldName: slot,
            partyLabel: this.bindText(definition.party_label),
            fields: ["Signature", "Name", "Capacity", "Date"],
            values: {Name: value(definition.name_field), Capacity: value(definition.capacity_field), Date: value(definition.date_field)}
        };
    }

    assertSigningSlots() {
        for (const [slot, definition] of Object.entries(this.contract.signatures))
            if (definition.required && !this.usedSignatures.has(slot)) throw new Error("Required signing slot is absent from the packet: " + slot);
    }
}
