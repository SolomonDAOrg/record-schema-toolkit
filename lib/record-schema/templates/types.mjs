/** @typedef {{ required: boolean; draft_placeholder?: string }} FieldRequirement */
/** @typedef {FieldRequirement & { type: "text" }} TextField */
/** @typedef {FieldRequirement & { type: "date"; format: "YYYY-MM-DD" | "DD MMM YYYY" }} DateField */
/** @typedef {FieldRequirement & { type: "decimal"; decimal_places: number; rounding: "half-up" | "reject"; grouping?: boolean }} DecimalField */
/** @typedef {FieldRequirement & { type: "boolean"; true_label: string; false_label: string }} BooleanField */
/** @typedef {FieldRequirement & { type: "enum"; values: string[] }} EnumField */
/** @typedef {TextField | DateField | DecimalField | BooleanField | EnumField} TemplateField */
/** @typedef {{ target: string; field: string }} MetadataBinding */
/** @typedef {{ party_label: string; signer_role: string; required: boolean; name_field?: string; capacity_field?: string; date_field?: string }} SignatureSlot */
/** @typedef {{ fields: Record<string, TemplateField>; metadata: MetadataBinding[]; datasets: Record<string, import("../DataTable.mjs").DataTableDefinition>; signatures: Record<string, SignatureSlot>; instances: Record<string,string>; default_instance: string }} TemplateContract */
/** @typedef {{ path: string; sha256: string }} DatasetBinding */
/** @typedef {{ document: {version: string; path: string}; fields?: Record<string,string|boolean>; datasets?: Record<string,DatasetBinding> }} InstanceStage */
/** @typedef {{ schema: "record-schema-document-instance"; schema_version: 1; template: {record_id: string; version: string}; document_id: string; fields: Record<string,string|boolean>; datasets: Record<string,DatasetBinding>; stages: {draft?: InstanceStage; for_execution?: InstanceStage}; default_stage: "draft" | "for_execution" }} InstanceData */
export {};
