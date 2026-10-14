/**
 * @typedef {Object} CmsVerification
 * @property {string} certificateSubject
 * @property {string} certificateFingerprint256
 * @property {"not_checked"} trust
 */
/**
 * @typedef {Object} UnsignedPdfSignature
 * @property {string} fieldName
 * @property {false} signed
 */
/**
 * @typedef {CmsVerification & {
 *   fieldName: string,
 *   signed: true,
 *   integrity: "valid",
 *   signedLength: number,
 *   coversCurrentRevision: boolean
 * }} SignedPdfSignature
 */
/** @typedef {UnsignedPdfSignature | SignedPdfSignature} PdfSignatureVerification */
export {};
