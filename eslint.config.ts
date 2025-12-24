import js from "@eslint/js";
import tseslint from "typescript-eslint";
import stylistic from "@stylistic/eslint-plugin";
import globals from "globals";
import { defineConfig } from "eslint/config";
import type { ESLint } from "eslint";

export default defineConfig([
	js.configs.recommended,
	...tseslint.configs.recommended,
	{
		plugins: {
			"@stylistic": stylistic as ESLint.Plugin,
		},
		rules: {
			// Stylistic formatting rules
			"@stylistic/indent": ["error", "tab"],
			"@stylistic/quotes": ["error", "double", { avoidEscape: true }],
			"@stylistic/semi": ["error", "always"],
			"@stylistic/comma-dangle": ["error", "always-multiline"],
			"@stylistic/object-curly-spacing": ["error", "always"],
			"@stylistic/array-bracket-spacing": ["error", "never"],
			"@stylistic/arrow-spacing": ["error", { before: true, after: true }],
			"@stylistic/block-spacing": ["error", "always"],
			"@stylistic/brace-style": ["error", "1tbs", { allowSingleLine: true }],
			"@stylistic/comma-spacing": ["error", { before: false, after: true }],
			"@stylistic/eol-last": ["error", "always"],
			"@stylistic/key-spacing": ["error", { beforeColon: false, afterColon: true }],
			"@stylistic/keyword-spacing": ["error", { before: true, after: true }],
			"@stylistic/no-multi-spaces": "error",
			"@stylistic/no-multiple-empty-lines": ["error", { max: 1, maxEOF: 0 }],
			"@stylistic/no-trailing-spaces": "error",
			"@stylistic/space-before-blocks": ["error", "always"],
			"@stylistic/space-before-function-paren": ["error", { anonymous: "always", named: "never", asyncArrow: "always" }],
			"@stylistic/space-in-parens": ["error", "never"],
			"@stylistic/space-infix-ops": "error",
			"@stylistic/spaced-comment": ["error", "always"],
			"@stylistic/type-annotation-spacing": "error",
			"@stylistic/member-delimiter-style": ["error", {
				multiline: { delimiter: "semi", requireLast: true },
				singleline: { delimiter: "semi", requireLast: false },
			}],

			// Code quality rules
			"array-callback-return": "error",
			"no-await-in-loop": "warn",
			"no-constructor-return": "error",
			"no-self-compare": "error",
			"no-template-curly-in-string": "warn",
			"no-unused-private-class-members": "warn",
			"no-use-before-define": "off",
			"sort-imports": ["warn", {
				ignoreCase: false,
				ignoreDeclarationSort: true,
				ignoreMemberSort: false,
				memberSyntaxSortOrder: ["none", "all", "multiple", "single"],
				allowSeparatedGroups: true,
			}],
		},
	},
	{
		files: ["**/*.ts"],
		languageOptions: {
			globals: {
				...globals.node,
			},
		},
		rules: {
			"@typescript-eslint/ban-ts-comment": "off",
			"no-unused-vars": "off",
			"@typescript-eslint/no-unused-vars": ["error", {
				argsIgnorePattern: "^_",
				varsIgnorePattern: "^_",
				ignoreRestSiblings: true,
			}],
			"@typescript-eslint/no-use-before-define": ["error", {
				functions: false,
				classes: true,
				variables: true,
			}],
		},
	},
	{
		files: ["**/*.js"],
		languageOptions: {
			globals: {
				...globals.node,
			},
		},
		rules: {
			"no-unused-vars": ["error", {
				argsIgnorePattern: "^_",
				varsIgnorePattern: "^_",
			}],
		},
	},
	{
		ignores: [
			"**/dist/**",
			"**/node_modules/**",
			"**/coverage/**",
			"**/*.md",
		],
	},
]);
