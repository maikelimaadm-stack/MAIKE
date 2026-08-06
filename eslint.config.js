import globals from "globals";
import pluginJs from "@eslint/js";
import pluginReact from "eslint-plugin-react";
import pluginReactHooks from "eslint-plugin-react-hooks";

/**
 * Cobertura do lint (DBT-10, fechado na P1.4).
 *
 * Até a P1.3 o lint via `src/components`, `src/pages`, `src/apis`, `src/config`,
 * o `Layout` e **um** service — `empresaService.js`, nominalmente. Todo o resto
 * de `src/`, todo `scripts/` e todo `tests/` ficavam fora. Na prática, a
 * fundação nativa da P1 — services, domínio puro, libs, gates e testes — era o
 * código menos verificado do repositório.
 *
 * Agora as três árvores entram inteiras. Sem `ignores` para esconder diretório,
 * sem desligar regra em massa e sem espalhar `eslint-disable`: o que muda por
 * bloco é só o conjunto de globais, porque navegador, Node e Vitest/JSDOM não
 * têm o mesmo ambiente.
 */

/** Regras comuns às três árvores. */
const REGRAS_BASE = {
  // A dívida de variável não usada pertence à catraca de tipos, não ao lint:
  // `gate:types` já a mede e impede crescer. Ligá-la aqui produziria centenas
  // de erros sem acrescentar informação nova — e a P1.3 já mediu isso.
  "no-unused-vars": "off",
};

const REGRAS_REACT = {
  ...REGRAS_BASE,
  "react/prop-types": "off",
  "react/react-in-jsx-scope": "off",
  "react/no-unknown-property": [
    "error",
    { ignore: ["cmdk-input-wrapper", "toast-close"] },
  ],
  "react-hooks/rules-of-hooks": "error",
};

export default [
  {
    // Todo o código de aplicação roda no navegador.
    files: ["src/**/*.{js,mjs,cjs,jsx}"],
    languageOptions: {
      globals: globals.browser,
      sourceType: "module",
      ecmaVersion: "latest",
    },
    ...pluginJs.configs.recommended,
  },
  {
    files: ["src/**/*.{js,mjs,cjs,jsx}"],
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
    rules: REGRAS_REACT,
  },
  {
    // Gates e utilitários de build rodam em Node.
    files: ["scripts/**/*.{js,mjs,cjs}"],
    languageOptions: {
      globals: globals.node,
      sourceType: "module",
      ecmaVersion: "latest",
    },
    ...pluginJs.configs.recommended,
    rules: {
      // Aqui a exigência é maior: o código é novo e pequeno.
      "no-unused-vars": "error",
    },
  },
  {
    // Testes: Vitest e `node:test` sobre JSDOM, com globais dos dois mundos.
    files: ["tests/**/*.{js,mjs,cjs,jsx}", "scripts/tests/**/*.{js,mjs,cjs}"],
    languageOptions: {
      globals: {
        ...globals.node,
        ...globals.browser,
        ...globals.vitest,
      },
      sourceType: "module",
      ecmaVersion: "latest",
      parserOptions: {
        ecmaFeatures: { jsx: true },
      },
    },
    ...pluginJs.configs.recommended,
    plugins: {
      react: pluginReact,
    },
    rules: REGRAS_BASE,
  },
];
