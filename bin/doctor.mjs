#!/usr/bin/env node

import { resolve } from "node:path";
import { CLI } from "../lib/cli/cli.mjs";
import { Repository } from "../lib/record-schema/Repository.mjs";
import { diagnoseAssertions } from "../lib/record-schema/assertions/AssertionDoctor.mjs";
import { assertionPacksFromProfile } from "../lib/record-schema/assertions/AssertionRunner.mjs";

const options = CLI.handleCLI({
    scriptName: "doctor",
    description: "Verify the assertion runtime, packs, reports, and materializers",
    schema: {
        flags: {
            json: { description: "Machine-readable JSON output", default: false },
            production: {
                description: "Diagnose production-mode rule selection",
                default: false
            },
            deep: {
                description: "Execute every corpus rule, report, and materializer",
                default: false
            }
        },
        values: {
            root: {
                aliases: ["r"],
                description: "Repository root",
                default: ".",
                type: "string"
            },
            profile: {
                aliases: ["p"],
                description: "Registry profile YAML path (repo-relative)",
                default: null,
                type: "string"
            },
            packs: {
                aliases: ["pack"],
                description: "Assertion pack paths (comma-separated)",
                default: [],
                type: "array"
            },
            mode: {
                description: "Named assertion mode",
                default: "development",
                type: "string"
            }
        }
    }
});

const rootDirectory = resolve(process.cwd(), options.root);
let packs = options.packs;
let profileError = null;
if (packs.length === 0) {
    try {
        const repository = Repository.fromFolder(rootDirectory, {});
        if (options.profile !== null) repository.loadProfile(options.profile);
        const profile = repository.getProfile();
        packs = profile === null || profile === undefined
            ? []
            : assertionPacksFromProfile(profile.data);
    } catch (error) {
        profileError = error instanceof Error ? error.message : String(error);
    }
}

const result = profileError === null
    ? diagnoseAssertions(rootDirectory, {
          packs,
          mode: options.production ? "production" : options.mode,
          deep: options.deep
      })
    : {
          ok: false,
          checks: [
              {
                  id: "profile",
                  status: "error",
                  message: profileError
              }
          ],
          packs: [],
          unitCount: 0,
          ruleCount: 0,
          findingCount: 0,
          reportCount: 0,
          materializerCount: 0,
          materializerDriftCount: 0,
          errors: [`profile: ${profileError}`]
      };

if (options.json) {
    console.log(JSON.stringify(result, null, 2));
} else {
    for (let i = 0, len = result.checks.length; i < len; i++) {
        const check = result.checks[i];
        console.log(
            `${check.status.toUpperCase().padEnd(7)} ${check.id.padEnd(20)} ${check.message}`
        );
    }
}

if (!result.ok) process.exit(2);
