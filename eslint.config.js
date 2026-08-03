import globals from "globals";
import pluginJs from "@eslint/js";
import pluginReact from "eslint-plugin-react";
import pluginReactHooks from "eslint-plugin-react-hooks";

export default [
  {
    files: [
      "src/components/**/*.{js,mjs,cjs,jsx}",
      "src/pages/**/*.{js,mjs,cjs,jsx}",
      "src/Layout.jsx",
      // Fundação nativa da P1.1 — código novo nasce coberto (DBT-10).
      "src/apis/**/*.{js,mjs,cjs,jsx}",
      "src/config/**/*.{js,mjs,cjs,jsx}",
      "src/services/empresaService.js",
    ],
    languageOptions: { globals: globals.browser },
    ...pluginJs.configs.recommended,
  },
  {
    files: [
      "src/components/**/*.{js,mjs,cjs,jsx}",
      "src/pages/**/*.{js,mjs,cjs,jsx}",
      "src/Layout.jsx",
      "src/apis/**/*.{js,mjs,cjs,jsx}",
      "src/config/**/*.{js,mjs,cjs,jsx}",
      "src/services/empresaService.js",
    ],
    ...pluginReact.configs.flat.recommended,
    settings: {
      react: {
        version: "detect",
      },
    },
    plugins: {
      react: pluginReact,
      "react-hooks": pluginReactHooks,
    },
    rules: {
      "no-unused-vars": "off",
      "react/prop-types": "off",
      "react/react-in-jsx-scope": "off",
      "react/no-unknown-property": [
        "error",
        { ignore: ["cmdk-input-wrapper", "toast-close"] },
      ],
      "react-hooks/rules-of-hooks": "error",
    },
  },
  {
    // Scripts de gate e testes da P1.1 rodam em Node, não no navegador.
    files: [
      "scripts/gates/gate-api-boundary.mjs",
      "scripts/gates/lib/api-boundary.mjs",
      "scripts/tests/gates/api-boundary.test.mjs",
    ],
    languageOptions: {
      globals: globals.node,
      sourceType: "module",
      ecmaVersion: "latest",
    },
    ...pluginJs.configs.recommended,
    rules: {
      "no-unused-vars": "error",
    },
  },
];
