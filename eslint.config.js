import importPlugin from "eslint-plugin-import";
import tsPlugin from "@typescript-eslint/eslint-plugin";
import tsParser from "@typescript-eslint/parser";
import globals from "globals";

const packageZones = [
  {
    target: "./packages/lexicon",
    from: "./packages",
    except: ["./lexicon"],
    message: "@hypo/lexicon is the dependency root and cannot import another workspace package.",
  },
  {
    target: "./packages/domain",
    from: "./packages",
    except: ["./domain", "./lexicon"],
    message: "@hypo/domain may depend only on @hypo/lexicon.",
  },
  {
    target: "./packages/catalog",
    from: "./packages",
    except: ["./catalog", "./lexicon"],
    message: "@hypo/catalog may depend only on @hypo/lexicon.",
  },
  {
    target: "./packages/pds",
    from: "./packages",
    except: ["./pds", "./lexicon"],
    message: "@hypo/pds may depend only on @hypo/lexicon.",
  },
  {
    target: "./packages/sync",
    from: "./packages",
    except: ["./sync", "./pds", "./lexicon"],
    message: "@hypo/sync may depend only on @hypo/pds and @hypo/lexicon.",
  },
  {
    target: "./packages/schema-runtime",
    from: "./packages",
    except: ["./schema-runtime"],
    message: "@hypo/schema-runtime is an isolated Panproto boundary and cannot import another workspace package.",
  },
  {
    target: "./packages/store",
    from: "./packages",
    except: ["./store", "./sync", "./pds", "./lexicon"],
    message: "@hypo/store may depend only on @hypo/sync, @hypo/pds, and @hypo/lexicon.",
  },
];

export default [
  {
    ignores: [
      "coverage/**",
      "dist/**",
      "docs/site/.docusaurus/**",
      "docs/site/build/**",
      "docs/site/static/ios-api/**",
      "node_modules/**",
      "apps/ios/**/.build/**",
      "packages/lexicon/src/generated.ts",
      "packages/lexicon/src/namespaces.ts",
      // Vitest/esbuild accepts this file's repeated top-level import binding,
      // but ESLint's parser rejects it before rules can run.
      "tests/sceneSearch.test.js",
    ],
  },
  {
    files: ["**/*.{js,mjs}"],
    languageOptions: {
      ecmaVersion: "latest",
      sourceType: "module",
      globals: {
        ...globals.browser,
        ...globals.node,
      },
    },
    plugins: {
      import: importPlugin,
    },
    rules: {
      "no-unused-vars": [
        "warn",
        {
          argsIgnorePattern: "^_",
          caughtErrorsIgnorePattern: "^_",
          ignoreRestSiblings: true,
          varsIgnorePattern: "^_",
        },
      ],
      eqeqeq: ["error", "always", { null: "ignore" }],
      "import/first": "warn",
      "import/newline-after-import": "warn",
      "import/no-absolute-path": "error",
      "import/no-duplicates": "warn",
      "import/no-self-import": "error",
      "import/no-unresolved": [
        "error",
        {
          caseSensitive: true,
          commonjs: true,
          ignore: ["^[^./]"],
        },
      ],
      "import/no-restricted-paths": ["error", { zones: packageZones }],
    },
  },
  {
    files: ["**/*.{ts,mts,cts,tsx}"],
    languageOptions: {
      parser: tsParser,
      parserOptions: {
        ecmaVersion: "latest",
        sourceType: "module",
      },
      globals: {
        ...globals.browser,
        ...globals.node,
      },
    },
    plugins: {
      "@typescript-eslint": tsPlugin,
      import: importPlugin,
    },
    rules: {
      "@typescript-eslint/no-unused-vars": [
        "warn",
        {
          argsIgnorePattern: "^_",
          caughtErrorsIgnorePattern: "^_",
          ignoreRestSiblings: true,
          varsIgnorePattern: "^_",
        },
      ],
      "import/first": "warn",
      "import/newline-after-import": "warn",
      "import/no-absolute-path": "error",
      "import/no-duplicates": "warn",
      "import/no-restricted-paths": ["error", { zones: packageZones }],
      "import/no-self-import": "error",
    },
  },
];
