/**
 * @typedef {object} ExtractedConfigArgs
 * @property {string=} configPath
 * Raw config path extracted from CLI args (may be relative).
 */

import { isTruthy } from "../util/general.mjs";

// ---- CLI Argument Helpers --------------------------------------------------

class CLI {
    constructor() {}

    /**
     * Check if a single flag exists in argv
     * @param {string} flag - Flag name to check for
     * @param {string[]} argv - Arguments array (defaults to process.argv)
     * @returns {boolean}
     */
    static hasFlag(flag, argv = process.argv) {
        const prefix = flag.startsWith("-")
            ? ""
            : flag.length === 1
            ? "-"
            : "--";
        const position = argv.indexOf(prefix + flag);
        const terminatorPosition = argv.indexOf("--");
        return (
            position !== -1 &&
            (terminatorPosition === -1 || position < terminatorPosition)
        );
    }

    /**
     * Check if a flag exists in argv
     * @param {string|string[]} flags - Flag name(s) to check for
     * @param {string[]} argv - Arguments array (defaults to process.argv)
     * @returns {boolean}
     */
    static checkFlag(flags, argv = process.argv) {
        const flagsArray = Array.isArray(flags) ? flags : [flags];

        for (let i = 0, len = flagsArray.length; i < len; i++) {
            const flag = flagsArray[i];
            if (CLI.hasFlag(flag, argv)) return true;
        }
        return false;
    }

    /**
     * Get the value of a flag from argv
     * @param {string|string[]} flags - Flag name(s) to look for
     * @param {string[]} argv - Arguments array (defaults to process.argv)
     * @returns {string|null} - The value after the flag, or null if not found
     */
    static getFlagValue(flags, argv = process.argv) {
        const flagsArray = Array.isArray(flags) ? flags : [flags];

        for (let i = 0, len = flagsArray.length; i < len; i++) {
            const flag = flagsArray[i];
            const prefix = flag.startsWith("-")
                ? ""
                : flag.length === 1
                ? "-"
                : "--";
            const fullFlag = prefix + flag;
            const position = argv.indexOf(fullFlag);

            if (position !== -1 && position + 1 < argv.length) {
                const terminatorPosition = argv.indexOf("--");
                if (
                    terminatorPosition === -1 ||
                    position < terminatorPosition
                ) {
                    return argv[position + 1];
                }
            }
        }
        return null;
    }

    /**
     * Get a numeric value from a flag
     * @param {string|string[]} flags - Flag name(s) to look for
     * @param {number} defaultValue - Default value if flag not found or invalid
     * @param {string[]} argv - Arguments array (defaults to process.argv)
     * @returns {number}
     */
    static getFlagNumber(flags, defaultValue = 0, argv = process.argv) {
        const value = CLI.getFlagValue(flags, argv);
        if (value === null) return defaultValue;

        const num = Number(value);
        return Number.isFinite(num) && num >= 0
            ? Math.floor(num)
            : defaultValue;
    }

    /**
     * Parse command line arguments into a structured options object
     * @param {Object} schema - Schema defining expected arguments
     * @param {string[]} argv - Arguments array (defaults to process.argv.slice(2))
     * @returns {Object} - Parsed options
     *
     * Schema format:
     * {
     *   flags: {
     *     flagName: { aliases: ['f'], description: 'Description', default: false },
     *   },
     *   values: {
     *     valueName: { aliases: ['v'], description: 'Description', default: null, type: 'string' },
     *   },
     *   numbers: {
     *     numberName: { aliases: ['n'], description: 'Description', default: 0, min: 0, max: 100 },
     *   }
     * }
     */
    static parseArgs(
        schema = {},
        argv = process.argv.slice(2),
        defaultsOverride = null
    ) {
        const options = {};
        const errors = [];

        // Set defaults
        const { flags = {}, values = {}, numbers = {} } = schema;
        // const helpValues = { ...values };

        for (const [name, config] of Object.entries(flags)) {
            options[name] =
                config.default !== undefined ? config.default : false;
        }

        for (const [name, config] of Object.entries(values)) {
            options[name] =
                config.default !== undefined ? config.default : null;
        }

        for (const [name, config] of Object.entries(numbers)) {
            options[name] = config.default !== undefined ? config.default : 0;
        }

        if (defaultsOverride && typeof defaultsOverride === "object") {
            const keys = Object.keys(defaultsOverride);
            for (let i = 0, len = keys.length; i < len; i++) {
                const k = keys[i];
                if (!Object.prototype.hasOwnProperty.call(options, k)) continue;
                const v = defaultsOverride[k];
                if (v === undefined) continue;
                options[k] = v;
            }
        }

        // Parse flags
        for (const [name, config] of Object.entries(flags)) {
            const flagNames = [name, ...(config.aliases || [])];
            if (CLI.checkFlag(flagNames, argv)) {
                options[name] = true;
            }
        }

        // Parse values
        for (const [name, config] of Object.entries(values)) {
            const flagNames = [name, ...(config.aliases || [])];
            const value = CLI.getFlagValue(flagNames, argv);
            if (value !== null) {
                if (config.type === "string" || !config.type) {
                    options[name] = value;
                } else if (
                    config.type === "boolean" ||
                    config.type === "bool"
                ) {
                    options[name] = isTruthy(value);
                } else if (config.type === "array") {
                    // Support comma-separated values
                    options[name] = value
                        .split(",")
                        .map((v) => v.trim())
                        .filter((v) => v.length > 0);
                }
            }
        }

        // Parse numbers
        for (const [name, config] of Object.entries(numbers)) {
            const flagNames = [name, ...(config.aliases || [])];
            const value = CLI.getFlagValue(flagNames, argv);
            if (value !== null) {
                const num = Number(value);
                if (!Number.isFinite(num)) {
                    errors.push(`Invalid number for --${name}: ${value}`);
                    continue;
                }

                const finalNum = num;
                if (config.min !== undefined && finalNum < config.min) {
                    errors.push(
                        `--${name} must be >= ${config.min}, got ${finalNum}`
                    );
                    continue;
                }
                if (config.max !== undefined && finalNum > config.max) {
                    errors.push(
                        `--${name} must be <= ${config.max}, got ${finalNum}`
                    );
                    continue;
                }

                options[name] = finalNum;
            }
        }

        // Check for unknown flags
        for (let i = 0; i < argv.length; i++) {
            const arg = argv[i];
            if (!arg.startsWith("-")) continue;

            const flagName = arg.replace(/^-+/, "");
            let isKnown = false;

            // Check in all schema sections
            for (const [name, config] of Object.entries({
                ...flags,
                ...values,
                ...numbers
            })) {
                const aliases = config.aliases || [];
                if (name === flagName || aliases.includes(flagName)) {
                    isKnown = true;
                    break;
                }
            }

            if (!isKnown && flagName !== "help" && flagName !== "h") {
                errors.push(`Unknown option: ${arg}`);
            }
        }

        return { options, errors };
    }

    /**
     * Print formatted help for command line options
     * @param {Object} options - Contains all of the optional options
     * @param {string=} options.scriptName - Script name
     * @param {string=} options.description - Script description
     * @param {Object=} options.schema - Schema used for parseArgs
     * @param {Object=} options.examples - Examples object with usage examples
     * @param {Object=} options.features - Features
     * @param {Object=} options.footer - Footer/s
     * @param {Object=} options.dependencies - Dependency list
     */
    static printHelp(options = {}) {
        const innerGutterMinWidth = 4;

        const {
            scriptName,
            description,
            schema,
            examples,
            features,
            footer,
            dependencies
        } = options;

        console.log(description || "Script");

        console.log(description || "Script");
        console.log("");
        console.log(`Usage: ${scriptName} [options]`);
        console.log("");

        const { flags = {}, values = {}, numbers = {} } = schema;
        const allOptions = { ...flags, ...values, ...numbers };

        if (Object.keys(allOptions).length > 0) {
            console.log("Options:");

            // Calculate max width for alignment
            let maxWidth = 0;
            for (const [name, config] of Object.entries(allOptions)) {
                const aliases = config.aliases || [];
                const allNames = [name, ...aliases];
                const flagStr = allNames
                    .map((n) => (n.length === 1 ? `-${n}` : `--${n}`))
                    .join(", ");
                const hasValue = values[name] || numbers[name];
                const fullStr = hasValue ? `${flagStr} <value>` : flagStr;
                maxWidth = Math.max(maxWidth, fullStr.length);
            }

            // Print options
            for (const [name, config] of Object.entries(allOptions)) {
                const aliases = config.aliases || [];
                const allNames = [name, ...aliases];
                const flagStr = allNames
                    .map((n) => (n.length === 1 ? `-${n}` : `--${n}`))
                    .join(", ");
                const hasValue = values[name] || numbers[name];
                const fullStr = hasValue ? `${flagStr} <value>` : flagStr;
                const padding = " ".repeat(
                    Math.max(2, maxWidth - fullStr.length + 2)
                );

                let desc = config.description || "";
                if (
                    config.default !== undefined &&
                    config.default !== false &&
                    config.default !== null
                ) {
                    desc += ` ${`(default: ${config.default})`}`;
                }
                if (
                    numbers[name] &&
                    (config.min !== undefined || config.max !== undefined)
                ) {
                    const range = [];
                    if (config.min !== undefined)
                        range.push(`min: ${config.min}`);
                    if (config.max !== undefined)
                        range.push(`max: ${config.max}`);
                    if (range.length > 0) desc += ` ${`(${range.join(", ")})`}`;
                }

                console.log(`  ${fullStr}${padding}${desc}`);
            }

            console.log(
                `  ${"--help, -h"}${" ".repeat(
                    maxWidth - 10
                )}Show this help message`
            );
            console.log("");
        }

        if (features && Array.isArray(features) && features.length) {
            console.log("Features:");

            if (Array.isArray(features[0])) {
                let maxInnerLineWidth = 0;

                for (let i = 0, len = features.length; i < len; i++) {
                    const feature = features[i];

                    const innerLineWidth = feature[0].length;

                    if (maxInnerLineWidth < innerLineWidth) {
                        maxInnerLineWidth = innerLineWidth;
                    }
                }

                for (let i = 0, len = features.length; i < len; i++) {
                    const feature = features[i];

                    const spaces =
                        maxInnerLineWidth +
                        innerGutterMinWidth -
                        feature[0].length;

                    console.log(
                        `  ${feature[0]}${" ".repeat(spaces)}${feature[1]}`
                    );
                }
            } else {
                for (let i = 0, len = features.length; i < len; i++) {
                    const feature = features[i];

                    console.log(`  ${feature}`);
                }
            }

            console.log("");
        }

        if (examples && Object.keys(examples).length > 0) {
            console.log("Examples:");
            for (const [desc, command] of Object.entries(examples)) {
                console.log(`  ${desc}:`);
                console.log(`    ${command}`);
                console.log("");
            }
        }

        if (footer && Array.isArray(footer) && footer.length) {
            for (let i = 0, len = footer.length; i < len; i++) {
                const footerBlock = footer[i];

                console.log(`${footerBlock[0]}`);

                for (let j = 0, len2 = footerBlock[1].length; j < len2; j++) {
                    const footerItem = footerBlock[1][j];

                    console.log(`  ${footerItem}`);
                }

                console.log("");
            }
        }

        if (
            dependencies &&
            Array.isArray(dependencies) &&
            dependencies.length
        ) {
            for (let i = 0, len = dependencies.length; i < len; i++) {
                console.log(`${dependencies[i]}`);
                console.log("");
            }
        }
    }

    /**
     * Handle common CLI patterns: help, validation, error handling
     * @param {Object} cliOptions - Contains all of the CLI options
     * @param {string=} cliOptions.scriptName - Script name
     * @param {string=} cliOptions.description - Script description
     * @param {Object=} cliOptions.schema - Schema used for parseArgs
     * @param {Object=} cliOptions.examples - Examples object with usage examples
     * @param {Object=} cliOptions.features - Features
     * @param {Object=} cliOptions.footer - Footer/s
     * @param {Object=} cliOptions.dependencies - Dependency list
     * @returns {Object} - Parsed options or exits on error/help
     */
    static handleCLI(cliOptions, argv = process.argv.slice(2)) {
        // Check for help first
        if (CLI.checkFlag(["help", "h"], argv)) {
            CLI.printHelp(cliOptions);
            process.exit(0);
        }

        let argvClean = argv;
        let configDefaults = null;
        const configErrors = [];

        const parsed = CLI.parseArgs(
            cliOptions.schema,
            argvClean,
            configDefaults
        );
        const errors = [...configErrors, ...parsed.errors];

        if (errors.length > 0) {
            console.log(`Errors:`);
            for (let i = 0, len = errors.length; i < len; i++) {
                console.log(`  • ${errors[i]}`);
            }
            console.log("");
            CLI.printHelp(cliOptions);
            process.exit(1);
        }

        return parsed.options;
    }

    /**
     * Exit with error message
     * @param {string} message - Error message
     * @param {number} code - Exit code (default: 1)
     */
    static exitWithError(message, code = 1) {
        console.log(`Errors: ${message}`);
        process.exit(code);
    }

    /**
     * Exit with success message
     * @param {string} message - Success message
     * @param {number} code - Exit code (default: 0)
     */
    static exitWithSuccess(message, code = 0) {
        console.log(`Success: ${message}`);
        process.exit(code);
    }
}

export { CLI };
