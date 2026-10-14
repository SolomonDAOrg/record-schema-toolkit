// @ts-check

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { CLI } from "../lib/cli/cli.mjs";

// ============================================================================
// Tests: CLI.hasFlag
// ============================================================================

describe("CLI.hasFlag", () => {
    it("detects long flag with -- prefix", () => {
        const argv = ["node", "script.js", "--verbose"];
        assert.equal(CLI.hasFlag("verbose", argv), true);
    });

    it("detects short flag with - prefix", () => {
        const argv = ["node", "script.js", "-v"];
        assert.equal(CLI.hasFlag("v", argv), true);
    });

    it("returns false when flag not present", () => {
        const argv = ["node", "script.js", "--other"];
        assert.equal(CLI.hasFlag("verbose", argv), false);
    });

    it("handles flag already with prefix", () => {
        const argv = ["node", "script.js", "--verbose"];
        assert.equal(CLI.hasFlag("--verbose", argv), true);
    });

    it("respects -- terminator", () => {
        const argv = ["node", "script.js", "--", "--verbose"];
        assert.equal(CLI.hasFlag("verbose", argv), false);
    });

    it("detects flag before -- terminator", () => {
        const argv = ["node", "script.js", "--verbose", "--", "--other"];
        assert.equal(CLI.hasFlag("verbose", argv), true);
    });

    it("returns false for empty argv", () => {
        assert.equal(CLI.hasFlag("verbose", []), false);
    });
});

// ============================================================================
// Tests: CLI.checkFlag
// ============================================================================

describe("CLI.checkFlag", () => {
    it("checks single flag as string", () => {
        const argv = ["node", "script.js", "--verbose"];
        assert.equal(CLI.checkFlag("verbose", argv), true);
        assert.equal(CLI.checkFlag("quiet", argv), false);
    });

    it("checks multiple flags as array", () => {
        const argv = ["node", "script.js", "-v"];
        assert.equal(CLI.checkFlag(["verbose", "v"], argv), true);
    });

    it("returns true if any flag matches", () => {
        const argv = ["node", "script.js", "--quiet"];
        assert.equal(CLI.checkFlag(["verbose", "v", "quiet", "q"], argv), true);
    });

    it("returns false if no flags match", () => {
        const argv = ["node", "script.js", "--other"];
        assert.equal(CLI.checkFlag(["verbose", "v"], argv), false);
    });

    it("handles empty flags array", () => {
        const argv = ["node", "script.js", "--verbose"];
        assert.equal(CLI.checkFlag([], argv), false);
    });
});

// ============================================================================
// Tests: CLI.getFlagValue
// ============================================================================

describe("CLI.getFlagValue", () => {
    it("gets value after long flag", () => {
        const argv = ["node", "script.js", "--config", "path/to/config.json"];
        assert.equal(CLI.getFlagValue("config", argv), "path/to/config.json");
    });

    it("gets value after short flag", () => {
        const argv = ["node", "script.js", "-c", "config.json"];
        assert.equal(CLI.getFlagValue("c", argv), "config.json");
    });

    it("returns null when flag not present", () => {
        const argv = ["node", "script.js", "--other", "value"];
        assert.equal(CLI.getFlagValue("config", argv), null);
    });

    it("returns null when flag is last argument", () => {
        const argv = ["node", "script.js", "--config"];
        assert.equal(CLI.getFlagValue("config", argv), null);
    });

    it("checks multiple flag names", () => {
        const argv = ["node", "script.js", "-c", "config.json"];
        assert.equal(CLI.getFlagValue(["config", "c"], argv), "config.json");
    });

    it("returns first matching flag value", () => {
        const argv = [
            "node",
            "script.js",
            "-c",
            "short.json",
            "--config",
            "long.json"
        ];
        // Should return first match
        assert.equal(CLI.getFlagValue(["config", "c"], argv), "long.json");
    });

    it("respects -- terminator", () => {
        const argv = ["node", "script.js", "--", "--config", "value"];
        assert.equal(CLI.getFlagValue("config", argv), null);
    });

    it("gets value before -- terminator", () => {
        const argv = [
            "node",
            "script.js",
            "--config",
            "value",
            "--",
            "--other"
        ];
        assert.equal(CLI.getFlagValue("config", argv), "value");
    });

    it("handles flag already with prefix", () => {
        const argv = ["node", "script.js", "--config", "value"];
        assert.equal(CLI.getFlagValue("--config", argv), "value");
    });
});

// ============================================================================
// Tests: CLI.getFlagNumber
// ============================================================================

describe("CLI.getFlagNumber", () => {
    it("parses integer value", () => {
        const argv = ["node", "script.js", "--count", "42"];
        assert.equal(CLI.getFlagNumber("count", 0, argv), 42);
    });

    it("parses float and floors it", () => {
        const argv = ["node", "script.js", "--count", "3.7"];
        assert.equal(CLI.getFlagNumber("count", 0, argv), 3);
    });

    it("returns default when flag not present", () => {
        const argv = ["node", "script.js"];
        assert.equal(CLI.getFlagNumber("count", 10, argv), 10);
    });

    it("returns default for non-numeric value", () => {
        const argv = ["node", "script.js", "--count", "abc"];
        assert.equal(CLI.getFlagNumber("count", 5, argv), 5);
    });

    it("returns default for negative value", () => {
        const argv = ["node", "script.js", "--count", "-5"];
        assert.equal(CLI.getFlagNumber("count", 0, argv), 0);
    });

    it("returns default for NaN", () => {
        const argv = ["node", "script.js", "--count", "NaN"];
        assert.equal(CLI.getFlagNumber("count", 7, argv), 7);
    });

    it("returns default for Infinity", () => {
        const argv = ["node", "script.js", "--count", "Infinity"];
        assert.equal(CLI.getFlagNumber("count", 7, argv), 7);
    });

    it("accepts zero as valid value", () => {
        const argv = ["node", "script.js", "--count", "0"];
        assert.equal(CLI.getFlagNumber("count", 10, argv), 0);
    });

    it("checks multiple flag names", () => {
        const argv = ["node", "script.js", "-n", "25"];
        assert.equal(CLI.getFlagNumber(["count", "n"], 0, argv), 25);
    });
});

// ============================================================================
// Tests: CLI.parseArgs
// ============================================================================

describe("CLI.parseArgs", () => {
    describe("flags parsing", () => {
        it("parses boolean flags", () => {
            const schema = {
                flags: {
                    verbose: { aliases: ["v"], default: false }
                }
            };
            const argv = ["--verbose"];
            const { options } = CLI.parseArgs(schema, argv);
            assert.equal(options.verbose, true);
        });

        it("uses default when flag not present", () => {
            const schema = {
                flags: {
                    verbose: { default: false },
                    debug: { default: true }
                }
            };
            const { options } = CLI.parseArgs(schema, []);
            assert.equal(options.verbose, false);
            assert.equal(options.debug, true);
        });

        it("detects flag by alias", () => {
            const schema = {
                flags: {
                    verbose: { aliases: ["v"], default: false }
                }
            };
            const argv = ["-v"];
            const { options } = CLI.parseArgs(schema, argv);
            assert.equal(options.verbose, true);
        });
    });

    describe("values parsing", () => {
        it("parses string values", () => {
            const schema = {
                values: {
                    config: { aliases: ["c"], default: null, type: "string" }
                }
            };
            const argv = ["--config", "path/to/config.json"];
            const { options } = CLI.parseArgs(schema, argv);
            assert.equal(options.config, "path/to/config.json");
        });

        it("parses boolean string values", () => {
            const schema = {
                values: {
                    enabled: { type: "boolean", default: false }
                }
            };

            const argv1 = ["--enabled", "true"];
            assert.equal(CLI.parseArgs(schema, argv1).options.enabled, true);

            const argv2 = ["--enabled", "false"];
            assert.equal(CLI.parseArgs(schema, argv2).options.enabled, false);

            const argv3 = ["--enabled", "yes"];
            assert.equal(CLI.parseArgs(schema, argv3).options.enabled, true);

            const argv4 = ["--enabled", "no"];
            assert.equal(CLI.parseArgs(schema, argv4).options.enabled, false);
        });

        it("parses array values from comma-separated string", () => {
            const schema = {
                values: {
                    tags: { type: "array", default: [] }
                }
            };
            const argv = ["--tags", "one,two,three"];
            const { options } = CLI.parseArgs(schema, argv);
            assert.deepEqual(options.tags, ["one", "two", "three"]);
        });

        it("trims array values", () => {
            const schema = {
                values: {
                    tags: { type: "array", default: [] }
                }
            };
            const argv = ["--tags", " one , two , three "];
            const { options } = CLI.parseArgs(schema, argv);
            assert.deepEqual(options.tags, ["one", "two", "three"]);
        });

        it("filters empty array values", () => {
            const schema = {
                values: {
                    tags: { type: "array", default: [] }
                }
            };
            const argv = ["--tags", "one,,two,  ,three"];
            const { options } = CLI.parseArgs(schema, argv);
            assert.deepEqual(options.tags, ["one", "two", "three"]);
        });
    });

    describe("numbers parsing", () => {
        it("parses numeric values", () => {
            const schema = {
                numbers: {
                    count: { aliases: ["n"], default: 0 }
                }
            };
            const argv = ["--count", "42"];
            const { options } = CLI.parseArgs(schema, argv);
            assert.equal(options.count, 42);
        });

        it("reports error for non-numeric value", () => {
            const schema = {
                numbers: {
                    count: { default: 0 }
                }
            };
            const argv = ["--count", "abc"];
            const { errors } = CLI.parseArgs(schema, argv);
            assert.ok(errors.length > 0);
            assert.ok(errors[0].includes("Invalid number"));
        });

        it("validates minimum constraint", () => {
            const schema = {
                numbers: {
                    count: { default: 0, min: 1 }
                }
            };
            const argv = ["--count", "0"];
            const { errors } = CLI.parseArgs(schema, argv);
            assert.ok(errors.length > 0);
            assert.ok(errors[0].includes(">="));
        });

        it("validates maximum constraint", () => {
            const schema = {
                numbers: {
                    count: { default: 0, max: 10 }
                }
            };
            const argv = ["--count", "15"];
            const { errors } = CLI.parseArgs(schema, argv);
            assert.ok(errors.length > 0);
            assert.ok(errors[0].includes("<="));
        });

        it("accepts value within constraints", () => {
            const schema = {
                numbers: {
                    count: { default: 0, min: 1, max: 10 }
                }
            };
            const argv = ["--count", "5"];
            const { options, errors } = CLI.parseArgs(schema, argv);
            assert.equal(errors.length, 0);
            assert.equal(options.count, 5);
        });
    });

    describe("unknown flags detection", () => {
        it("reports unknown flags", () => {
            const schema = {
                flags: { verbose: { default: false } }
            };
            const argv = ["--verbose", "--unknown"];
            const { errors } = CLI.parseArgs(schema, argv);
            assert.ok(errors.length > 0);
            assert.ok(errors[0].includes("Unknown option"));
            assert.ok(errors[0].includes("--unknown"));
        });

        it("ignores --help and -h", () => {
            const schema = {};
            const argv = ["--help", "-h"];
            const { errors } = CLI.parseArgs(schema, argv);
            assert.equal(errors.length, 0);
        });

        it("recognizes aliases as known flags", () => {
            const schema = {
                flags: { verbose: { aliases: ["v"], default: false } }
            };
            const argv = ["-v"];
            const { errors } = CLI.parseArgs(schema, argv);
            assert.equal(errors.length, 0);
        });
    });

    describe("defaults override", () => {
        it("applies defaults override", () => {
            const schema = {
                flags: { verbose: { default: false } },
                values: { config: { default: null } }
            };
            const override = { verbose: true, config: "override.json" };
            const { options } = CLI.parseArgs(schema, [], override);
            assert.equal(options.verbose, true);
            assert.equal(options.config, "override.json");
        });

        it("argv values override defaults override", () => {
            const schema = {
                values: { config: { default: null } }
            };
            const override = { config: "override.json" };
            const argv = ["--config", "argv.json"];
            const { options } = CLI.parseArgs(schema, argv, override);
            assert.equal(options.config, "argv.json");
        });

        it("ignores unknown keys in defaults override", () => {
            const schema = {
                flags: { verbose: { default: false } }
            };
            const override = { verbose: true, unknown: "ignored" };
            const { options } = CLI.parseArgs(schema, [], override);
            assert.equal(options.verbose, true);
            assert.ok(!("unknown" in options));
        });
    });

    describe("complex schema", () => {
        it("parses complex schema with all types", () => {
            const schema = {
                flags: {
                    verbose: { aliases: ["v"], default: false },
                    debug: { aliases: ["d"], default: false }
                },
                values: {
                    config: { aliases: ["c"], default: null },
                    output: { aliases: ["o"], default: "out" }
                },
                numbers: {
                    threads: { aliases: ["t"], default: 4, min: 1, max: 32 }
                }
            };
            const argv = ["-v", "--config", "my.json", "-t", "8"];
            const { options, errors } = CLI.parseArgs(schema, argv);

            assert.equal(errors.length, 0);
            assert.equal(options.verbose, true);
            assert.equal(options.debug, false);
            assert.equal(options.config, "my.json");
            assert.equal(options.output, "out");
            assert.equal(options.threads, 8);
        });
    });
});

// ============================================================================
// Tests: Edge cases
// ============================================================================

describe("CLI edge cases", () => {
    it("handles empty schema", () => {
        const { options, errors } = CLI.parseArgs({}, []);
        assert.deepEqual(options, {});
        assert.deepEqual(errors, []);
    });

    it("handles argv with only positional arguments", () => {
        const schema = { flags: { verbose: { default: false } } };
        const argv = ["file1.txt", "file2.txt"];
        const { options, errors } = CLI.parseArgs(schema, argv);
        assert.equal(options.verbose, false);
        assert.equal(errors.length, 0);
    });

    it("handles flag without aliases", () => {
        const schema = {
            flags: { verbose: { default: false } }
        };
        const argv = ["--verbose"];
        const { options } = CLI.parseArgs(schema, argv);
        assert.equal(options.verbose, true);
    });

    it("handles value type defaulting to string", () => {
        const schema = {
            values: { name: { default: null } }
        };
        const argv = ["--name", "test"];
        const { options } = CLI.parseArgs(schema, argv);
        assert.equal(options.name, "test");
    });

    it("handles missing default in schema", () => {
        const schema = {
            flags: { verbose: {} },
            values: { config: {} },
            numbers: { count: {} }
        };
        const { options } = CLI.parseArgs(schema, []);
        assert.equal(options.verbose, false);
        assert.equal(options.config, null);
        assert.equal(options.count, 0);
    });
});
