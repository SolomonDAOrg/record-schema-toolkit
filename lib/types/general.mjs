/**
 * Prefer this over naked Record<string, any>.
 * @template {Record<PropertyKey, any>} [T=Record<PropertyKey, any>]
 * @typedef {T extends Record<PropertyKey, any> ? T : Record<PropertyKey, any>} Metadata
 */

/**
 * @template {Record<PropertyKey, any>} [T=Record<PropertyKey, any>]
 * @typedef {Metadata<T> | null} NullableMetadata
 */

/**
 * @template {Record<PropertyKey, any>} [T=Record<PropertyKey, any>]
 * @typedef {Metadata<T> | null | undefined} NullableOrUndefinedMetadata
 */
