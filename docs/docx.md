# DOCX output

Use the existing render command with `--format docx`:

```bash
node ./bin/render.mjs --root ./DOC-00001-example --format docx
node ./bin/render.mjs --root ./DOC-00001-example --packet --format docx
node ./bin/render.mjs --root ./DOC-00001-example --packet --format docx --packet-name delivery/example.docx
```

PDF remains the default. Both modes use the same source loading, metadata
bindings, data-table formatting, formatting rules, render-pack selection,
cover generation and packet composition. No external package or office
application is required to generate DOCX.

Individual documents are written to `{record}/docx/{source-basename}.docx`.
`--output` changes the parent output directory as it does for PDF.
Packet output uses the configured packet path with a `.docx` extension.
An explicit `--packet-name` must end in `.docx`. Existing files require
`--overwrite`; DOCX mode does not overwrite the corresponding PDF.
`--update-meta` records the generated DOCX packet path and its hash.

## Programmatic rendering

```javascript
import { createDocxRenderer } from "./lib/ast/renderers/DocxRenderer.mjs";
import { createDocumentPipeline } from "./lib/ast/pipelines/DocumentPipeline.mjs";

const renderer = createDocxRenderer({
    pageConfig: { size: "a4" },
    baseFontSize: 10,
    metadata: { title: "Example", includeDates: false }
});
const result = createDocumentPipeline()
    .setRenderer(renderer)
    .processSingle(source);
if (!result.success) throw new Error(result.errors.join("; "));
const bytes = result.renderResult.output;
```

`createDocumentRenderer("pdf" | "docx", configuration)` selects either renderer.
`FilingPacketGenerator.generate(record, { format: "docx" })` selects DOCX for
packets. The format option is also accepted for bound document instances; the
original binding and signing-slot checks still run.

## Word representation

Text, headings, inline formatting, nested lists, tables, merged cells,
hyperlinks, bookmarks, images, form controls and signature rows are native
Word content. Table headers repeat across pages. The existing DataTable class
continues to resolve and format external tabular sources. Content-sized columns
use the same width allocation and font-size rules as PDF; Word receives a fixed
table grid. All TOC entry levels are bold, with configured sizes and indentation.
Signature panels retain borders and title bands, single blocks use open signature
lines, and split blocks retain both parties in adjacent columns with editable fields.

Covers, document sections, contents entries and the final signing page retain
their source order. Header and footer parts are explicit for every section,
including blank furniture on suppressed cover/signing pages. Page references
and totals use Word fields. The final signing page is excluded from the total
unless `page_numbering.include_signing_page` is enabled.

Fixed and first-page compositions use positioned editable text boxes.
First-page compositions keep the declared flowing continuation. Source
selection, missing regions, duplicate regions and region geometry are checked
by the existing layout engine.

Page tracking uses a Word `DISPLAYBARCODE` field with physical `PAGE` and
`NUMPAGES` fields, placed at the right paper margin. Word controls barcode
sizing and field evaluation.

For physical page numbers, set `pageNumbering: { docxMode: "physical" }` in
renderer configuration. This uses standard Word `PAGE`, `NUMPAGES` and `PAGEREF`
fields, including cover and signing pages in the count. The default `relative`
mode retains the configured cover and signing-page exclusions. Use structured
header/footer variables, such as `{ type: "variable", name: "page" }` and
`{ type: "variable", name: "totalPages" }`, for page fields.

## Format boundaries

- Word computes wrapping, text-box fitting and pagination. DOCX output is not
  an exact visual reproduction of PDF. The toolkit returns `pageCount: 0`
  because it has not paginated the document in Word.
- Page-reference and barcode fields request recalculation on opening.
  Field results are not precomputed. In Word, update fields before printing
  or exporting. Applications without these Word field implementations may
  leave the results blank.
- Declared font family names are retained, with standard PDF fonts mapped to
  Word families. PDF font programs are not embedded in DOCX; fonts must be
  available to the reader. SVG artwork requires a Word version with SVG support.
- Flow spacing, margins and paragraph styling use Word primitives. PDF ink
  spacing, table auto-shrinking, cover geometry and decorative details can
  differ. Positioned region overflow is not certified without Word layout.
- Header/footer selectors support `all`, `first`, `not-first`, `odd`,
  `even`, `section-first` and `section-not-first`. Word odd/even furniture
  follows physical page parity. Last-page selectors, explicit page arrays
  and JavaScript predicates fail explicitly.
- Form fields become editable Word content controls. Read-only controls
  retain their lock setting. PDF required-field and maximum-length
  enforcement are not reproduced. Signature fields remain signing
  placeholders, not PDF digital signatures. The PDF sign, verify and prefill
  commands continue to operate on PDF.
- Unknown AST nodes and unsupported resources fail rendering rather than
  being silently discarded.

The package writer uses Node built-ins and emits a ZIP containing
WordprocessingML parts, explicit content types and part relationships.
