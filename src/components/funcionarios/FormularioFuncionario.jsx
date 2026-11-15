import React, { useState } from "react";
import { DENSIDADE_BASE1 } from "@/components/cadastro/base1/B1Field";
import { B1ChaveRow } from "@/components/cadastro/base1/Base1Ui";
import CadastroFormShell from "@/components/cadastro/base1/CadastroFormShell";
import { CampoSelect, CampoTexto, SecaoForm } from "@/components/gestao/GestaoFormParts";
import { CampoNumero } from "@/components/financeiroGestao/CamposLancamento";
import { notifyWarning } from "@/lib/maikeNotify";
import { LIMITES, lerNumeroLocal, paraTextoDeEdicao } from "@/lib/dinheiroDecimal";
import { TIPOS_FUNCIONARIO } from "@/services/funcionarioCadastroService";

export const FORMULARIO_FUNCIONARIO_ID = "formulario-funcionario-base1";

const LOCALE = "pt-BR";
/** O decimal da API: até 10 inteiros e 4 casas, não negativo. */
const LIMITES_CUSTO = LIMITES.QUANTIDADE;

/**
 * Custo digitado no formato local → texto canônico (`null` = vazio).
 * @param {string} texto
 * @returns {{ valor: string|null, erro: string|null }}
 */
const lerCusto = (texto) => {
  const digitado = String(texto ?? "").trim();
  if (!digitado) return { valor: null, erro: null };
  const lida = lerNumeroLocal(digitado, LOCALE, LIMITES_CUSTO);
  if (lida.ok) return { valor: /** @type {string} */ (lida.valor), erro: null };
  if (lida.motivo === "casas") return { valor: null, erro: `Use no máximo ${LIMITES_CUSTO.casas} casas decimais.` };
  if (lida.motivo === "limite") return { valor: null, erro: "Valor acima do limite permitido." };
  return { valor: null, erro: "Valor inválido: use o formato 1.234,56 (sem sinal)." };
};

/**
 * Formulário do cadastro de Funcionários da fazenda (D-PROD-204).
 *
 * Campos: Nome, Cargo, Tipo (Mensalista / Diarista / Tarefeiro), Custo por hora
 * e Custo por diária (opcionais, ≥ 0; a linha de mão de obra copia o da medida).
 * Não é folha: sem salário, encargos, ponto ou pagamento. A situação (Ativo) só
 * muda pelas ações Inativar / Reativar da tela. A fazenda não é campo: é a
 * selecionada no topo.
 *
 * @param {{
 *   onSubmit: (dados: object) => void,
 *   initialData?: any,
 *   readOnly?: boolean,
 * }} props
 */
export default function FormularioFuncionario({ onSubmit, initialData = null, readOnly = false }) {
  const [form, setForm] = useState(() => ({
    nome: initialData?.nome || "",
    cargo: initialData?.cargo || "",
    tipo: initialData?.tipo || "",
    custo_hora: paraTextoDeEdicao(initialData?.custo_hora, LOCALE, { casasMax: LIMITES_CUSTO.casas }),
    custo_diaria: paraTextoDeEdicao(initialData?.custo_diaria, LOCALE, { casasMax: LIMITES_CUSTO.casas }),
  }));
  const [erros, setErros] = useState(/** @type {Record<string, string>} */ ({}));

  /** @param {keyof typeof form} campo @param {string} valor */
  const set = (campo, valor) => {
    setErros((prev) => (prev[campo] ? Object.fromEntries(Object.entries(prev).filter(([k]) => k !== campo)) : prev));
    setForm((prev) => ({ ...prev, [campo]: valor }));
  };

  /** @param {React.FormEvent<HTMLFormElement>} e */
  const enviar = (e) => {
    e.preventDefault();
    if (readOnly) return;
    /** @type {Record<string, string>} */
    const novos = {};
    if (!form.nome.trim()) novos.nome = "Obrigatório";
    if (!form.tipo) novos.tipo = "Obrigatório";
    const hora = lerCusto(form.custo_hora);
    const diaria = lerCusto(form.custo_diaria);
    if (hora.erro) novos.custo_hora = hora.erro;
    if (diaria.erro) novos.custo_diaria = diaria.erro;
    if (Object.keys(novos).length) {
      setErros(novos);
      notifyWarning("Atenção", novos.nome || novos.tipo ? "Preencha os campos obrigatórios: Nome e Tipo." : "Confira os custos informados.");
      return;
    }
    onSubmit({
      nome: form.nome.trim().toUpperCase(),
      cargo: form.cargo.trim().toUpperCase() || null,
      tipo: form.tipo,
      custo_hora: hora.valor,
      custo_diaria: diaria.valor,
    });
  };

  return (
    <CadastroFormShell embedded title={initialData?.id ? "Editar funcionário" : "Novo funcionário"}>
      <div className="mg-b1-record-form">
        <form id={FORMULARIO_FUNCIONARIO_ID} onSubmit={enviar} className="b1 mg-b1-form-grid w-full min-h-0" noValidate data-testid="b1-form-funcionario" data-densidade={DENSIDADE_BASE1}>
          <SecaoForm titulo="Identificação" />
          <CampoTexto label="Nome" required span={6} value={form.nome} onChange={(v) => set("nome", v)} readOnly={readOnly} maxLength={255} error={erros.nome} placeholder="NOME" />
          <CampoTexto label="Cargo" span={6} value={form.cargo} onChange={(v) => set("cargo", v)} readOnly={readOnly} maxLength={120} placeholder="EX.: TRATORISTA" />
          <CampoSelect
            label="Tipo"
            required
            span={4}
            value={form.tipo}
            onChange={(v) => set("tipo", v)}
            options={[...TIPOS_FUNCIONARIO]}
            readOnly={readOnly}
            error={erros.tipo}
          />
          <CampoNumero
            label="Custo por hora (R$)"
            value={form.custo_hora}
            onChange={(v) => set("custo_hora", v)}
            locale={LOCALE}
            limites={LIMITES_CUSTO}
            readOnly={readOnly}
            span={4}
            error={erros.custo_hora}
            testId="funcionario-custo-hora"
          />
          <CampoNumero
            label="Custo por diária (R$)"
            value={form.custo_diaria}
            onChange={(v) => set("custo_diaria", v)}
            locale={LOCALE}
            limites={LIMITES_CUSTO}
            readOnly={readOnly}
            span={4}
            error={erros.custo_diaria}
            testId="funcionario-custo-diaria"
          />
          {initialData?.id ? (
            <>
              <SecaoForm titulo="Situação" />
              <B1ChaveRow label="Ativo" span={6} checked={initialData.ativo !== false} disabled ariaLabel="Funcionário ativo" />
            </>
          ) : null}
        </form>
      </div>
    </CadastroFormShell>
  );
}
