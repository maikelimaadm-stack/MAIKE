import React from "react";
import B1Field, { B1_FIELD_CTL_CLS, B1TituloGrupo } from "@/components/cadastro/base1/B1Field";
import B1Select from "@/components/cadastro/base1/B1Select";

/**
 * Título de seção do formulário Base1 (ocupa a linha inteira). Desde a D-PROD-165 é o título de grupo do
 * design "Cadastro de Lote" (`B1TituloGrupo`): nome do grupo e uma linha fina até o fim.
 */
export function SecaoForm({ titulo, children = null }) {
  return (
    <B1TituloGrupo titulo={titulo} secao>
      {children}
    </B1TituloGrupo>
  );
}

/**
 * Campo de texto Base1.
 * @param {{ label: string, value: string, onChange: (v: string) => void, readOnly?: boolean, required?: boolean,
 *   error?: string, span?: number, type?: string, placeholder?: string, maxLength?: number, inputMode?: string, keepCase?: boolean,
 *   dica?: React.ReactNode, testId?: string }} props `dica` (D-PROD-269): a linha de ajuda embaixo do campo (sem erro).
 */
export function CampoTexto({
  label,
  value,
  onChange,
  readOnly = false,
  required = false,
  error = undefined,
  span = 6,
  type = "text",
  placeholder = undefined,
  maxLength = undefined,
  inputMode = undefined,
  keepCase = false,
  dica = undefined,
  testId = undefined,
}) {
  return (
    <B1Field label={label} required={required} span={span} hasValue={Boolean(String(value ?? "").trim())} locked={readOnly} disabled={readOnly} error={error} dica={dica}>
      <input
        data-testid={testId}
        type={type}
        value={value ?? ""}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className={keepCase ? B1_FIELD_CTL_CLS.replace(" uppercase", " normal-case") : B1_FIELD_CTL_CLS}
        autoComplete="off"
        readOnly={readOnly}
        maxLength={maxLength}
        inputMode={/** @type {any} */ (inputMode)}
      />
    </B1Field>
  );
}

/**
 * Seletor Base1 (`B1Select`: painel no desktop, folha no celular), no desenho do campo de escolha do motor
 * (D-PROD-172): "Pesquisar…" em toda lista, opções em MAIÚSCULAS e sem a opção vazia — o `placeholder` só diz
 * que o campo aceita ficar vazio, e quem limpa é o ✕ do campo.
 * @param {{ label: string, value: string, onChange: (v: string) => void, options: Array<{ value: string, label: string }>,
 *   readOnly?: boolean, required?: boolean, error?: string, span?: number, placeholder?: string, dica?: React.ReactNode }} props
 *   `dica` (D-PROD-269): a linha de ajuda embaixo do campo (sem erro).
 */
export function CampoSelect({ label, value, onChange, options, readOnly = false, required = false, error = undefined, span = 6, placeholder = undefined, dica = undefined }) {
  return (
    <B1Field label={label} required={required} span={span} hasValue={Boolean(value)} locked={readOnly} disabled={readOnly} error={error} dica={dica}>
      <B1Select
        aria-label={label}
        value={value ?? ""}
        onChange={(e) => onChange(e.target.value)}
        disabled={readOnly}
        className={B1_FIELD_CTL_CLS}
        pesquisa="sempre"
        semOpcaoVazia
        maiusculas
      >
        {placeholder !== undefined ? <option value="">{placeholder}</option> : null}
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </B1Select>
    </B1Field>
  );
}

/** Aviso fixo da tela (empresa ausente, sem permissão…). */
export function AvisoGestao({ children, tone = "amber", testId = undefined }) {
  const cls =
    tone === "blue"
      ? "text-blue-900 bg-blue-50 border-blue-200"
      : "text-amber-800 bg-amber-50 border-amber-200";
  return (
    <div role="status" data-testid={testId} className={`cadastro-b1 mg-card p-3 text-xs border mb-2 ${cls}`}>
      {children}
    </div>
  );
}

/** Situações de um cadastro na consulta ao servidor (ativos / inativos / todos). */
export const OPCOES_SITUACAO_CADASTRO = Object.freeze([
  { value: "ativos", label: "Ativos" },
  { value: "inativos", label: "Inativos" },
  { value: "todos", label: "Todos" },
]);

/**
 * Filtro de situação da tela (consulta ao servidor), como pílula na faixa de filtros do motor — e não mais na barra
 * ao lado do "+ Novo" (D-PROD-172). Padrão "Ativos"; cobre a coluna "Ativo" da grade.
 * @param {string} valor @param {(v: string) => void} onChange
 * @returns {import("@/components/cadastro/base1/FiltrosRapidos").FiltroDaTela}
 */
export const filtroSituacaoDaTela = (valor, onChange) => ({
  id: "situacao",
  rotulo: "Situação",
  nome: "Filtrar por situação",
  opcoes: [...OPCOES_SITUACAO_CADASTRO],
  valor,
  padrao: "ativos",
  onChange,
  coluna: "ativo",
});

/** @param {string} situacao @returns {boolean|undefined} */
export const ativoDoFiltro = (situacao) => (situacao === "ativos" ? true : situacao === "inativos" ? false : undefined);
