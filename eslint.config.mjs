import { defineConfig, globalIgnores } from "eslint/config";
import tseslint from "typescript-eslint";
import eslint from "@eslint/js";

export default defineConfig([
  globalIgnores([
    "**/server/",
    "**/*.log",
    "**/node_modules/",
    "**/.eslintcache",
    "**/.env",
    "**/package-lock.json",
    "**/.vscode",
    "**/tsconfig.tsbuildinfo",
    "**/tests",
    "scripts/",
  ]),
  {
    files: ["**/*.ts", "**/*.mts"],
    extends: [eslint.configs.recommended, tseslint.configs.recommended],
    languageOptions: {
      ecmaVersion: "latest",
      sourceType: "module",
    },
    rules: {
      "no-case-declarations": "off",
      "@typescript-eslint/no-explicit-any": "off",
      "@typescript-eslint/no-unused-vars": "off",
    },
  },
  {
    files: ["lib/modules/**/*.controller.ts"],
    rules: {
      "no-restricted-syntax": [
        "error",
        {
          selector:
            "MethodDefinition[kind='method']:not([key.name='constructor'])",
          message:
            "Controller methods must be arrow functions (e.g. `myMethod = (req,res,next) => {}`), not class methods (e.g. myMethod() {}).",
        },
      ],
    },
  },
]);
