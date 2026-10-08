import { config } from "@apuracao/config/eslint";

/** @type {import("eslint").Linter.Config[]} */
export default [...config, { ignores: ["cdk.out/**"] }];
