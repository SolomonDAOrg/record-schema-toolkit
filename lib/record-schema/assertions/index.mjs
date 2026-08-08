/**
 * Corpus assertion layer.
 * @module record-schema/assertions
 */

export {
    compilePath,
    evaluatePath,
    evaluatePathValues,
    evaluatePathFirst
} from "./Path.mjs";
export { evaluatePredicate, looseEqual, coerceNumber } from "./Predicate.mjs";
export { renderTemplate, renderKey } from "./Template.mjs";
export { evaluateExpression } from "./Expression.mjs";
export { decodeLayout, parseHex } from "./Decoder.mjs";
export { CorpusIndex } from "./CorpusIndex.mjs";
export { parseMarkdownForAssertions } from "./MarkdownCorpusParser.mjs";
export { lexEmbeddedLanguage } from "./EmbeddedLanguage.mjs";
export {
    buildDigestEntries,
    computeDigestCommitment,
    hexToBytes,
    bytesToHex
} from "./Manifest.mjs";
export {
    AssertionPack,
    RULE_KINDS,
    validateAssertionPackDocuments
} from "./AssertionPack.mjs";
export { AssertionEngine } from "./AssertionEngine.mjs";
export {
    runAssertions,
    assertionPacksFromProfile
} from "./AssertionRunner.mjs";
export {
    materializeAssertions,
    materializeAssertionsWithContext
} from "./AssertionMaterializer.mjs";
export {
    generateAssertionReport,
    runAssertionReport,
    renderAssertionReport
} from "./AssertionReporter.mjs";

export { diagnoseAssertions } from "./AssertionDoctor.mjs";
export { generateAssertionReportWithContext } from "./AssertionReport.mjs";
