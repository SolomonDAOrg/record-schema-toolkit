/**
 * Runtime loader for compiled `.mjs` language parser adapters.
 * @module language-rules/ParserAdapterRegistry
 */

import { existsSync } from "node:fs";
import { basename, dirname, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { isObject } from "../util/objects.mjs";

/**
 * @typedef {object} ParserResult
 * @property {Record<string, unknown> | null} ast
 * @property {LanguageRuleParserDiagnostic[]} diagnostics
 * @property {string | null} parser_path
 */

/**
 * @typedef {object} LanguageRuleParserDiagnostic
 * @property {string} code
 * @property {string} message
 * @property {string} severity
 * @property {string} file
 */

export class ParserAdapterRegistry {
    /**
     * @param {object} [options]
     * @param {string | null} [options.parser_root]
     * @param {boolean} [options.require_parsers]
     */
    constructor(options = {}) {
        /** @type {string | null} */
        this.parser_root = options.parser_root
            ? resolve(options.parser_root)
            : null;

        /** @type {boolean} */
        this.require_parsers = options.require_parsers === true;

        /** @type {Map<string, Promise<Record<string, unknown>>>} */
        this.module_cache = new Map();
    }

    /**
     * @param {import("./LanguageClassifier.mjs").ClassifiedSourceFile} sourceFile
     * @param {string} text
     * @returns {Promise<ParserResult>}
     */
    async parse(sourceFile, text) {
        const parserPaths = this._candidateParserPaths(sourceFile);
        for (let i = 0, len = parserPaths.length; i < len; i++) {
            const parserPath = parserPaths[i];
            if (!existsSync(parserPath)) {
                continue;
            }
            try {
                const mod = await this._importModule(parserPath);
                const createParser = mod.createParser;
                if (typeof createParser !== "function") {
                    return {
                        ast: null,
                        parser_path: parserPath,
                        diagnostics: [
                            {
                                code: "parser.adapter.invalid",
                                severity: "error",
                                message: `Parser adapter has no createParser export: ${parserPath}`,
                                file: sourceFile.rel_path
                            }
                        ]
                    };
                }
                const parser = createParser(
                    { path: sourceFile.abs_path, text },
                    this._parserOptions(sourceFile)
                );
                if (!isObject(parser) || typeof parser.parse !== "function") {
                    return {
                        ast: null,
                        parser_path: parserPath,
                        diagnostics: [
                            {
                                code: "parser.adapter.invalid",
                                severity: "error",
                                message: `Parser adapter did not return a parser with parse(): ${parserPath}`,
                                file: sourceFile.rel_path
                            }
                        ]
                    };
                }
                const ast = parser.parse();
                return {
                    ast: isObject(ast) ? ast : null,
                    parser_path: parserPath,
                    diagnostics: []
                };
            } catch (err) {
                return {
                    ast: null,
                    parser_path: parserPath,
                    diagnostics: [
                        {
                            code: "parser.adapter.exception",
                            severity: "error",
                            message:
                                err instanceof Error
                                    ? err.message
                                    : String(err),
                            file: sourceFile.rel_path
                        }
                    ]
                };
            }
        }
        return {
            ast: null,
            parser_path: null,
            diagnostics: [
                {
                    code: "parser.adapter.missing",
                    severity: this.require_parsers ? "error" : "warn",
                    message: `No compiled .mjs parser adapter found for ${sourceFile.language_id} (${sourceFile.extension})`,
                    file: sourceFile.rel_path
                }
            ]
        };
    }

    /**
     * @param {string} absPath
     * @returns {Promise<Record<string, unknown>>}
     */
    _importModule(absPath) {
        const cached = this.module_cache.get(absPath);
        if (cached) {
            return cached;
        }
        const promise = import(pathToFileURL(absPath).href);
        this.module_cache.set(absPath, promise);
        return promise;
    }

    /**
     * @param {import("./LanguageClassifier.mjs").ClassifiedSourceFile} sourceFile
     * @returns {string[]}
     */
    _candidateParserPaths(sourceFile) {
        if (!this.parser_root) {
            return [];
        }
        /** @type {string[]} */
        const out = [];
        const add = (/** @type {string} */ candidate) => {
            const normalized = candidate
                .replace(/\.ts$/i, ".mjs")
                .replace(/\.js$/i, ".mjs");
            const abs = resolve(this.parser_root ?? ".", normalized);
            if (!out.includes(abs)) {
                out.push(abs);
            }
        };
        for (let i = 0, len = sourceFile.parser_adapters.length; i < len; i++) {
            const adapter = sourceFile.parser_adapters[i];
            add(adapter);
            if (adapter.startsWith("parsers/")) {
                add(adapter.slice("parsers/".length));
            }
            if (
                basename(adapter).toLowerCase() === "parser.ts" ||
                basename(adapter).toLowerCase() === "parser.mjs"
            ) {
                add(resolve(dirname(adapter), "Parser.mjs"));
                const withoutPrefix = adapter.startsWith("parsers/")
                    ? adapter.slice("parsers/".length)
                    : adapter;
                add(resolve(dirname(withoutPrefix), "Parser.mjs"));
            }
        }
        const fallbackName =
            sourceFile.language_id === "css-family"
                ? "css"
                : sourceFile.language_id;
        add(`${fallbackName}/Parser.mjs`);
        add(`parsers/${fallbackName}/Parser.mjs`);
        return out;
    }

    /**
     * @param {import("./LanguageClassifier.mjs").ClassifiedSourceFile} sourceFile
     * @returns {Record<string, unknown>}
     */
    _parserOptions(sourceFile) {
        if (sourceFile.language_family === "ecmascript") {
            return {
                includeNonExported: true,
                parseArrowSignatures: true,
                parseDeclareStatements: true,
                collectTypedefs: true,
                parseFunctionBodies: true
            };
        }
        if (sourceFile.language_family === "stylesheet") {
            return {
                modeOverrides: {
                    dialect: sourceFile.dialect_id
                },
                captureCst: true
            };
        }
        if (sourceFile.language_family === "solidity") {
            return {
                includeTopLevelFunctions: true,
                includeTopLevelVariables: true,
                parseExpressions: true
            };
        }
        return {};
    }
}
