/* eslint-disable */
import js from "@eslint/js";
import prettierConfig from "eslint-config-prettier";
import importPlugin from "eslint-plugin-import";
import prettier from "eslint-plugin-prettier";

export default [
    js.configs.recommended,
    // Global ignores
    {
        ignores: ["**/dist/**", "**/build/**", "**/node_modules/**"]
    },
    {
        files: ["**/*.{mjs,js,jsx}"],
        ignores: ["**/*.d.ts", "**/dist/**", "**/build/**", "**/node_modules/**", "**/prettier-config/**"],
        languageOptions: {
            parserOptions: {
                ecmaVersion: 2022,
                sourceType: "module"
            },
            ecmaVersion: 2022,
            sourceType: "module",
            globals: {
                process: "readonly",
                Buffer: "readonly",
                __dirname: "readonly",
                __filename: "readonly",
                global: "readonly",
                console: "readonly",
                setTimeout: "readonly",
                setInterval: "readonly",
                clearTimeout: "readonly",
                clearInterval: "readonly",
                setImmediate: "readonly",
                clearImmediate: "readonly",
                URL: "readonly",
                TextEncoder: "readonly",
                TextDecoder: "readonly"
            }
        },
        plugins: {
            prettier: prettier,
            import: importPlugin
        },
        rules: {
            "linebreak-style": ["error", "unix"],
            "no-case-declarations": "off",
            "no-unused-vars": [
                "error",
                {
                    argsIgnorePattern: "^_",
                    varsIgnorePattern: "^_",
                    caughtErrorsIgnorePattern: "^_"
                }
            ],
            "import/no-named-as-default-member": "off",
            "import/no-extraneous-dependencies": "error",
            "prettier/prettier": "error",
            "import/no-unresolved": "off",
            "import/default": "off",
            eqeqeq: ["error", "always"],
            "no-console": "off",
            "prefer-const": "error",
            "no-var": "error",
            "object-shorthand": "error",
            "prefer-template": "error",
            "import/order": [
                "error",
                {
                    groups: ["builtin", "external", "internal", "parent", "sibling", "index"],
                    "newlines-between": "always",
                    alphabetize: {
                        order: "asc",
                        caseInsensitive: true
                    }
                }
            ],
            "sort-imports": [
                "error",
                {
                    ignoreCase: true,
                    ignoreDeclarationSort: true,
                    ignoreMemberSort: false
                }
            ],
            // Side effect specific rules
            "no-implicit-globals": "error",
            "import/no-namespace": "off", // Allow namespace imports
            "import/no-unused-modules": "error", // Helps detect unused code
            "import/no-deprecated": "warn",
            "import/no-amd": "error",
            "import/no-commonjs": "error"
        },
        settings: {
            "import/resolver": {
                node: true
            }
        }
    },
    prettierConfig
];
