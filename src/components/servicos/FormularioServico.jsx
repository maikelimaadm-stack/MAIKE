import React, { useEffect, useMemo, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { DENSIDADE_BASE1 } from "@/components/cadastro/base1/B1Field";
import { B1ChaveRow } from "@/components/cadastro/base1/Base1Ui";
import CadastroFormShell from "@/components/cadastro/base1/CadastroFormShell";
import { AvisoGestao, CampoSelect, CampoTexto, SecaoForm } from "@/components/gestao/GestaoFormParts";
import { CampoNumero } from "@/components/financeiroGestao/CamposLancamento";
import { notifyWarning } from "@/lib/maikeNotify";
import { LIMITES, lerNumeroLocal, paraTextoDeEdicao } from "@/lib/dinheiroDecimal";
import { rotuloDoCentro } from "@/lib/lancamentoAtividadesRegras";
import { getApiErrorMessage } from "@/apis/_core/ApiError";
import { listarCentrosCustoDoServico, listarUnidadesDoServico } from "@/services/servicoCadastroService";

export const FORMULARIO_SERVICO_ID = "formulario-servico-base1";

const LOCALE = "pt-BR";
/** O decimal da API: até 10 inteiros e 4 casas, não negativo. */
const LIMITES_VALOR = LIMITES.QUANTIDADE;

/** @param {any} u */
export const rotuloDaUnidade = (u) =>
  u && typeof u === "object" ? [u.sigla, u.descricao].filter((v) => typeof v === "string" && v.trim()).join(" - ") : "";

/** @param {{ data?: unknown }} consulta @returns {any[]} */
const listaDe = (consulta) => (Array.isArray(consulta.data) ? consulta.data : []);

/**
 * Formulário do cadastro de Serviços da fazenda (D-PROD-203).
 *
 * Campos: Nome, Unidade de medida (do cadastro de Unidades de Medida: as ATIVAS
 * e, se ficou inativa, a gravada, marcada), Centro de custo padrão (os ATIVOS da
 * fazenda e o gravado) e Valor de referência (opcional, ≥ 0; a linha de serviço
 * começa com ele). A situação só muda pelas ações Inativar / Reativar da tela.
 *
 * @param {{
 *   onSubmit: (dados: object) => void,
 *   initialData?: any,
 *   readOnly?: boolean,
 *   empresaId?: string | null,
 * }} props
 */
export default function FormularioServico({ onSubmit, initialData = null, readOnly = false, empresaId = null }) {
  const [form, setForm] = useState(() => ({
    nome: initialData?.nome || "",
    unidade_medida_id: initialData?.unidade_medida_id || "",
    centro_custo_padrao_id: initialData?.centro_custo_padrao_id || "",
    valor_referencia: paraTextoDeEdicao(initialData?.valor_referencia, LOCALE, { casasMax: LIMITES_VALOR.casas }),
  }));
  const [erros, setErros] = useState(/** @type {Record<string, string>} */ ({}));

  // O centro é da fazenda: trocar a fazenda com o formulário aberto volta o gravado.
  const empresaDaLista = useRef(empresaId);
  useEffect(() => {
    if (empresaDaLista.current === empresaId) return;
    empresaDaLista.current = empresaId;
    setForm((atual) => ({ ...atual, centro_custo_padrao_id: initialData?.centro_custo_padrao_id || "" }));
  }, [empresaId, initialData]);

  // Opções só na edição; na leitura, o rótulo vem do resumo que o servidor inclui.
  const editavel = !readOnly;
  const unidadesQuery = useQuery({
    queryKey: ["unidades_medida", "opcoes-servico"],
    queryFn: () => listarUnidadesDoServico(),
    enabled: editavel,
    staleTime: 30 * 1000,
  });
  const centrosQuery = useQuery({
    queryKey: ["servicos-opcoes", "centros-custo", empresaId],
    queryFn: () => listarCentrosCustoDoServico(/** @type {string} */ (empresaId)),
    enabled: editavel && Boolean(empresaId),
    staleTime: 30 * 1000,
  });

  const unidadeGravadaId = initialData?.unidade_medida_id || "";
  const centroGravadoId = initialData?.centro_custo_padrao_id || "";

  const opcoesUnidade = useMemo(() => {
    const opcoes = listaDe(unidadesQuery)
      .filter((u) => u && u.id != null && u.ativo !== false && u._isOffline !== true && !String(u.id).startsWith("offline_"))
      .map((u) => ({ value: String(u.id), label: rotuloDaUnidade(u) || String(u.id) }));
    if (unidadeGravadaId && !opcoes.some((o) => o.value === unidadeGravadaId)) {
      const gravada = initialData?.unidade_medida ?? null;
      const rotulo = rotuloDaUnidade(gravada) || "Unidade gravada";
      opcoes.unshift({ value: unidadeGravadaId, label: gravada?.ativo === false ? `${rotulo} (INATIVA)` : rotulo });
    }
    return opcoes;
  }, [unidadesQuery.data, unidadeGravadaId, initialData]);

  const opcoesCentro = useMemo(() => {
    const opcoes = listaDe(centrosQuery).map((c) => ({ value: String(c.id), label: rotuloDoCentro(c) || String(c.id) }));
    if (centroGravadoId && !opcoes.some((o) => o.value === centroGravadoId)) {
      const gravado = initialData?.centro_custo_padrao ?? null;
      const rotulo = rotuloDoCentro(gravado) || "Centro gravado";
      opcoes.unshift({ value: centroGravadoId, label: gravado?.ativo === false ? `${rotulo} (INATIVO)` : rotulo });
    }
    return opcoes;
  }, [centrosQuery.data, centroGravadoId, initialData]);

  const erroDasListas = editavel ? unidadesQuery.error ?? centrosQuery.error ?? null : null;

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
    if (!form.unidade_medida_id) novos.unidade_medida_id = "Obrigatório";
    let valor = null;
    const digitado = String(form.valor_referencia ?? "").trim();
    if (digitado) {
      const lida = lerNumeroLocal(digitado, LOCALE, LIMITES_VALOR);
      if (lida.ok) valor = lida.valor;
      else
        novos.valor_referencia =
          lida.motivo === "casas"
            ? `Use no máximo ${LIMITES_VALOR.casas} casas decimais.`
            : lida.motivo === "limite"
              ? "Valor acima do limite permitido."
              : "Valor inválido: use o formato 1.234,56 (sem sinal).";
    }
    if (Object.keys(novos).length) {
      setErros(novos);
      notifyWarning(
        "Atenção",
        novos.nome || novos.unidade_medida_id ? "Preencha os campos obrigatórios: Nome e Unidade de medida." : "Confira o valor de referência.",
      );
      return;
    }
    onSubmit({
      nome: form.nome.trim().toUpperCase(),
      unidade_medida_id: form.unidade_medida_id,
      centro_custo_padrao_id: form.centro_custo_padrao_id || null,
      valor_referencia: valor,
    });
  };

  return (
    <CadastroFormShell embedded title={initialData?.id ? "Editar serviço" : "Novo serviço"}>
      <div className="mg-b1-record-form">
        <form id={FORMULARIO_SERVICO_ID} onSubmit={enviar} className="b1 mg-b1-form-grid w-full min-h-0" noValidate data-testid="b1-form-servico" data-densidade={DENSIDADE_BASE1}>
          <SecaoForm titulo="Identificação" />
          {erroDasListas ? (
            <div className="col-span-12">
              <AvisoGestao testId="servico-erro-opcoes">{getApiErrorMessage(erroDasListas, "Não foi possível carregar as opções.")}</AvisoGestao>
            </div>
          ) : null}
          <CampoTexto label="Nome" required span={12} value={form.nome} onChange={(v) => set("nome", v)} readOnly={readOnly} maxLength={255} error={erros.nome} placeholder="EX.: APLICAÇÃO AÉREA" />
          <CampoSelect
            label="Unidade de medida"
            required
            span={4}
            value={form.unidade_medida_id}
            onChange={(v) => set("unidade_medida_id", v)}
            options={opcoesUnidade}
            readOnly={readOnly}
            error={erros.unidade_medida_id}
          />
          <CampoSelect
            label="Centro de custo padrão"
            span={4}
            value={form.centro_custo_padrao_id}
            onChange={(v) => set("centro_custo_padrao_id", v)}
            options={opcoesCentro}
            placeholder="Sem centro de custo padrão"
            readOnly={readOnly || !empresaId}
          />
          <CampoNumero
            label="Valor de referência (R$)"
            value={form.valor_referencia}
            onChange={(v) => set("valor_referencia", v)}
            locale={LOCALE}
            limites={LIMITES_VALOR}
            readOnly={readOnly}
            span={4}
            error={erros.valor_referencia}
            testId="servico-valor-referencia"
          />
          {initialData?.id ? (
            <>
              <SecaoForm titulo="Situação" />
              <B1ChaveRow label="Ativo" span={6} checked={initialData.ativo !== false} disabled ariaLabel="Serviço ativo" />
            </>
          ) : null}
        </form>
      </div>
    </CadastroFormShell>
  );
}
