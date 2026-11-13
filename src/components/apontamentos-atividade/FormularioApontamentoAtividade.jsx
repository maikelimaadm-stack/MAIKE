import React, { useEffect, useMemo, useState } from "react";
import { Ban } from "lucide-react";
import B1Field, { B1_FIELD_CTL_CLS, DENSIDADE_BASE1 } from "@/components/cadastro/base1/B1Field";
import B1Select from "@/components/cadastro/base1/B1Select";
import CadastroFormShell from "@/components/cadastro/base1/CadastroFormShell";
import { AvisoGestao, CampoSelect, CampoTexto, SecaoForm } from "@/components/gestao/GestaoFormParts";
import { CampoDia, CampoNumero } from "@/components/financeiroGestao/CamposLancamento";
import SeletorPaginadoGestao from "@/components/financeiroGestao/SeletorPaginadoGestao";
import { CampoTextoLongo } from "@/components/patrimonio/PatrimonioFormParts";
import { BOTAO_PERIGO } from "@/components/patrimonio/DialogosAbastecimento";
import { notifyWarning } from "@/lib/maikeNotify";
import { formatarInstante } from "@/lib/diaCivil";
import { ROTULO_NATUREZA } from "@/lib/patrimonioDominio";
import {
  LIMITES_PRODUCAO,
  LOCALE_APONTAMENTO,
  MAX_OBSERVACAO,
  NATUREZAS_IMPLEMENTO,
  NATUREZAS_MAQUINA,
  NOME_UNIDADE_PRODUCAO,
  STATUS_CANCELADO,
  UNIDADES_PRODUCAO,
  corpoDoFormulario,
  formularioDoRegistro,
  formularioVazio,
  rotuloDaArea,
  rotuloDoBem,
  rotuloDoCentro,
  rotuloDoOperador,
  validarFormulario,
} from "@/lib/apontamentoAtividadeRegras";
import { listarOpcoesApontamento } from "@/services/apontamentoAtividadeService";

export const FORMULARIO_APONTAMENTO_ATIVIDADE_ID = "formulario-apontamento-atividade-base1";

const SELECT_EMPTY = "__VAZIO__";

/** @param {{ texto: string|undefined, testId?: string }} props */
function ErroDoCampo({ texto, testId = undefined }) {
  return texto ? (
    <p className="col-span-12 -mt-1 text-[12px] text-red-700" data-testid={testId}>
      {texto}
    </p>
  ) : null;
}

/** @param {any} o */
const detalheDoBem = (o) => /** @type {Record<string, string>} */ (ROTULO_NATUREZA)[String(o?.natureza ?? "")] ?? null;
/** @param {any} o */
const detalheDoCentro = (o) => (o?.numero != null ? `nº ${o.numero}` : null);

/**
 * @typedef {{ id: string, nome_tipo?: string, grupo_atividade_id?: string, grupo_atividade_nome?: string, ativo?: boolean }} TipoOpcao
 * @typedef {{ id: string, nome?: string, numero_area?: string|number|null, ativo?: boolean }} AreaOpcao
 */

/**
 * Formulário do apontamento de atividade (D-PROD-184) — a EXECUÇÃO de um tipo.
 *
 * Campos, nesta ordem EXATA: 1) Tipo de atividade (só ativos; ao editar, o
 * tipo atual inativo aparece marcado "(INATIVO)"; o grupo vem junto, só
 * leitura); 2) Data; 3) Máquina/veículo → libera o Implemento (trocar ou limpar
 * a máquina limpa o implemento; implemento ≠ máquina); 4) Operador; 5) Área;
 * 6) Hora início / Hora fim; 7) Produção: quantidade + unidade (juntas);
 * 8) Observação. Depois, os centros de custo e de resultado: campos de escolha
 * NORMAIS, opcionais, ESCOLHIDOS pelo usuário — nunca preenchidos a partir do
 * bem (o centro do bem é só do cadastro do bem). Apontamento CANCELADO abre só
 * leitura, com o motivo; o confirmado oferece "Cancelar apontamento".
 *
 * @param {{
 *   initialData?: any,
 *   empresaId: string|null,
 *   tipos?: TipoOpcao[],
 *   areas?: AreaOpcao[],
 *   hoje: string,
 *   fuso: string|null,
 *   readOnly?: boolean,
 *   isSubmitting?: boolean,
 *   onSubmit: (corpo: Record<string, any>) => void,
 *   podeCancelar?: boolean,
 *   onCancelar?: () => void,
 *   erroDoServidor?: { campo: string, mensagem: string } | null,
 * }} props
 */
export default function FormularioApontamentoAtividade({
  initialData = null,
  empresaId,
  tipos = [],
  areas = [],
  hoje,
  fuso,
  readOnly = false,
  isSubmitting = false,
  onSubmit,
  podeCancelar = false,
  onCancelar = undefined,
  erroDoServidor = null,
}) {
  const existente = Boolean(initialData?.id);
  const cancelado = initialData?.status === STATUS_CANCELADO;
  // Cancelado não aceita edição de nenhum campo, venha o pedido de onde vier.
  const somenteLeitura = readOnly || cancelado;
  const bloqueado = somenteLeitura || isSubmitting;
  const [form, setForm] = useState(() => (existente ? formularioDoRegistro(initialData, fuso) : formularioVazio(hoje)));
  const [erros, setErros] = useState(/** @type {Record<string, string>} */ ({}));

  useEffect(() => {
    if (erroDoServidor?.campo) setErros((e) => ({ ...e, [erroDoServidor.campo]: erroDoServidor.mensagem }));
  }, [erroDoServidor]);

  /** @param {Partial<import("@/lib/apontamentoAtividadeRegras").FormularioApontamento>} mudanca @param {string[]} campos */
  const mudar = (mudanca, campos) => {
    setForm((f) => ({ ...f, ...mudanca }));
    setErros((e) => (campos.some((c) => e[c]) ? Object.fromEntries(Object.entries(e).filter(([k]) => !campos.includes(k))) : e));
  };

  // Só tipos ATIVOS. Exceção: o tipo GRAVADO no apontamento continua na lista
  // (marcado INATIVO) — senão o seletor mostraria vazio com o registro gravado
  // nele. Se a lista ainda não chegou, o snapshot do registro o representa.
  const tipoGravadoId = existente ? String(initialData.tipo_atividade_id ?? "") : "";
  const opcoesTipo = useMemo(() => {
    const lista = tipos.filter((t) => t.ativo !== false || (tipoGravadoId && t.id === tipoGravadoId));
    if (tipoGravadoId && !lista.some((t) => t.id === tipoGravadoId)) {
      lista.unshift({
        id: tipoGravadoId,
        nome_tipo: initialData?.tipo_atividade_nome ?? "",
        grupo_atividade_id: initialData?.grupo_atividade_id ?? "",
        grupo_atividade_nome: initialData?.grupo_atividade_nome ?? "",
      });
    }
    return lista;
  }, [tipos, tipoGravadoId, initialData]);

  // O tipo GRAVADO mostra os snapshots do apontamento (renomear depois não reescreve o histórico);
  // um tipo trocado mostra o nome e o grupo atuais dele.
  const mesmoTipo = Boolean(tipoGravadoId) && form.tipo_atividade_id === tipoGravadoId;
  const tipoEscolhido = opcoesTipo.find((t) => t.id === form.tipo_atividade_id) ?? null;
  const nomeDoTipo = mesmoTipo ? String(initialData?.tipo_atividade_nome ?? "") : String(tipoEscolhido?.nome_tipo ?? "");
  const nomeDoGrupo = mesmoTipo ? String(initialData?.grupo_atividade_nome ?? "") : String(tipoEscolhido?.grupo_atividade_nome ?? "");

  // Só áreas ATIVAS da empresa; a área gravada que ficou inativa continua visível (marcada).
  const areaGravadaId = existente ? String(initialData.area_id ?? "") : "";
  const opcoesArea = useMemo(() => {
    const lista = areas.filter((a) => a.ativo !== false).map((a) => ({ value: String(a.id), label: rotuloDaArea(a) || String(a.id) }));
    if (areaGravadaId && !lista.some((a) => a.value === areaGravadaId)) {
      // Fora da lista JÁ carregada = inativa; antes de a lista chegar, só o resumo gravado.
      const rotulo = rotuloDaArea(initialData?.area) || "Área";
      lista.unshift({ value: areaGravadaId, label: areas.length ? `${rotulo} (INATIVA)` : rotulo });
    }
    return lista;
  }, [areas, areaGravadaId, initialData]);

  const bemId = form.bem?.id ?? null;

  /** @param {React.FormEvent<HTMLFormElement>} e */
  const handleSubmit = (e) => {
    e.preventDefault();
    if (somenteLeitura) return;
    const v = validarFormulario(form, { hoje, fuso });
    setErros(v);
    if (Object.keys(v).length) {
      notifyWarning("Atenção", "Revise os campos destacados.");
      return;
    }
    onSubmit(corpoDoFormulario(form, fuso));
  };

  const cancelamento = cancelado ? initialData?.cancelamento ?? null : null;

  const formBody = (
    <form
      id={FORMULARIO_APONTAMENTO_ATIVIDADE_ID}
      onSubmit={handleSubmit}
      className="b1 mg-b1-form-grid w-full min-h-0"
      noValidate
      data-testid="b1-form-apontamento-atividade"
      data-densidade={DENSIDADE_BASE1}
      data-somente-leitura={somenteLeitura ? "" : undefined}
    >
      {cancelado ? (
        <div className="col-span-12">
          <AvisoGestao testId="apontamento-cancelado">
            Apontamento cancelado
            {cancelamento?.cancelado_em ? ` em ${formatarInstante(cancelamento.cancelado_em, LOCALE_APONTAMENTO, fuso)}` : ""}
            {cancelamento?.cancelado_por?.nome ? ` por ${cancelamento.cancelado_por.nome}` : ""}.
            {cancelamento?.motivo ? ` Motivo: ${cancelamento.motivo}` : ""} Ele continua no histórico; nada é apagado e nenhum campo pode ser alterado.
          </AvisoGestao>
        </div>
      ) : null}

      <SecaoForm titulo="Atividade" />
      <B1Field
        label="Tipo de atividade"
        required
        span={6}
        hasValue={Boolean(form.tipo_atividade_id)}
        locked={somenteLeitura}
        disabled={bloqueado}
        error={erros.tipo_atividade_id}
      >
        {somenteLeitura ? (
          <input type="text" readOnly value={nomeDoTipo.toUpperCase()} className={B1_FIELD_CTL_CLS} data-testid="apontamento-tipo-leitura" />
        ) : (
          <B1Select
            value={form.tipo_atividade_id || SELECT_EMPTY}
            onChange={(/** @type {React.ChangeEvent<HTMLSelectElement>} */ e) =>
              mudar({ tipo_atividade_id: e.target.value === SELECT_EMPTY ? "" : e.target.value }, ["tipo_atividade_id"])
            }
            className={B1_FIELD_CTL_CLS}
          >
            <option value={SELECT_EMPTY}>SELECIONE</option>
            {opcoesTipo.map((tipo) => (
              <option key={tipo.id} value={tipo.id}>
                {String((tipo.id === tipoGravadoId ? initialData?.tipo_atividade_nome : null) || tipo.nome_tipo || "").toUpperCase()}
                {tipo.ativo === false ? " (INATIVO)" : ""}
              </option>
            ))}
          </B1Select>
        )}
      </B1Field>
      <B1Field label="Grupo de atividade" span={3} hasValue={Boolean(nomeDoGrupo)} locked disabled>
        <input type="text" readOnly value={nomeDoGrupo.toUpperCase()} className={B1_FIELD_CTL_CLS} data-testid="apontamento-grupo" tabIndex={-1} />
      </B1Field>
      <CampoDia
        label="Data"
        value={form.data_operacional}
        onChange={(v) => mudar({ data_operacional: v }, ["data_operacional"])}
        max={hoje || undefined}
        readOnly={bloqueado}
        required
        span={3}
        error={erros.data_operacional}
        testId="apontamento-data"
      />

      <SecaoForm titulo="Execução" />
      <SeletorPaginadoGestao
        rotulo="Máquina/veículo"
        testId="apontamento-bem"
        chave={["apontamentos-atividade", "bens", empresaId, "maquina"]}
        buscar={({ q, cursor, limit }) => listarOpcoesApontamento("bens", empresaId, { q, cursor, limit, natureza: NATUREZAS_MAQUINA })}
        value={form.bem}
        onChange={(opcao) => {
          // A MESMA máquina de novo não muda nada; trocar ou limpar a máquina limpa o implemento.
          if (opcao?.id != null && bemId && String(opcao.id) === bemId) return;
          mudar({ bem: opcao ? { id: String(opcao.id), rotulo: rotuloDoBem(opcao) } : null, implemento: null }, ["bem", "implemento"]);
        }}
        rotuloDaOpcao={rotuloDoBem}
        detalheDaOpcao={detalheDoBem}
        readOnly={bloqueado}
        permitirLimpar
        erro={erros.bem}
        span={6}
        maiusculas={false}
      />
      <SeletorPaginadoGestao
        rotulo="Implemento"
        testId="apontamento-implemento"
        chave={["apontamentos-atividade", "bens", empresaId, "implemento", bemId]}
        buscar={async ({ q, cursor, limit }) => {
          const pagina = await listarOpcoesApontamento("bens", empresaId, { q, cursor, limit, natureza: NATUREZAS_IMPLEMENTO });
          // Implemento ≠ máquina: o bem escolhido como máquina não é oferecido.
          return { ...pagina, itens: pagina.itens.filter((o) => String(o?.id) !== bemId) };
        }}
        value={form.implemento}
        onChange={(opcao) => mudar({ implemento: opcao ? { id: String(opcao.id), rotulo: rotuloDoBem(opcao) } : null }, ["implemento"])}
        rotuloDaOpcao={rotuloDoBem}
        detalheDaOpcao={detalheDoBem}
        readOnly={somenteLeitura || isSubmitting}
        bloqueadoMotivo={!somenteLeitura && !bemId ? "Escolha a máquina ou o veículo antes do implemento." : null}
        permitirLimpar
        erro={erros.implemento}
        span={6}
        maiusculas={false}
      />
      <SeletorPaginadoGestao
        rotulo="Operador"
        testId="apontamento-operador"
        chave={["apontamentos-atividade", "operadores", empresaId]}
        buscar={({ q, cursor, limit }) => listarOpcoesApontamento("operadores", empresaId, { q, cursor, limit })}
        value={form.operador}
        onChange={(opcao) => mudar({ operador: opcao ? { id: String(opcao.id), rotulo: rotuloDoOperador(opcao) } : null }, ["operador"])}
        rotuloDaOpcao={rotuloDoOperador}
        readOnly={bloqueado}
        permitirLimpar
        erro={erros.operador}
        span={6}
        maiusculas={false}
      />
      <CampoSelect
        label="Área"
        value={form.area_id}
        onChange={(v) => mudar({ area_id: v }, ["area_id"])}
        options={opcoesArea}
        placeholder="Sem área"
        readOnly={bloqueado}
        span={6}
        error={erros.area_id}
      />
      <CampoTexto
        label="Hora início"
        type="time"
        value={form.hora_inicio}
        onChange={(v) => mudar({ hora_inicio: v }, ["hora_inicio", "hora_fim"])}
        readOnly={bloqueado}
        span={3}
        keepCase
        error={erros.hora_inicio}
      />
      <CampoTexto
        label="Hora fim"
        type="time"
        value={form.hora_fim}
        onChange={(v) => mudar({ hora_fim: v }, ["hora_fim"])}
        readOnly={bloqueado}
        span={3}
        keepCase
        error={erros.hora_fim}
      />

      <SecaoForm titulo="Produção" />
      <CampoNumero
        label="Quantidade produzida"
        value={form.quantidade_produzida}
        onChange={(v) => mudar({ quantidade_produzida: v }, ["quantidade_produzida", "unidade_producao"])}
        locale={LOCALE_APONTAMENTO}
        limites={LIMITES_PRODUCAO}
        readOnly={bloqueado}
        span={3}
        error={erros.quantidade_produzida}
        testId="apontamento-quantidade"
      />
      <CampoSelect
        label="Unidade"
        value={form.unidade_producao}
        onChange={(v) => mudar({ unidade_producao: v }, ["unidade_producao", "quantidade_produzida"])}
        options={UNIDADES_PRODUCAO.map((u) => ({ value: u, label: NOME_UNIDADE_PRODUCAO[u] ?? u }))}
        placeholder="Sem produção"
        readOnly={bloqueado}
        span={3}
        error={erros.unidade_producao}
      />
      <p className="col-span-12 -mt-1 min-w-0 break-words text-[11px] text-[var(--mg-text-2,#475569)] md:col-span-6 md:self-center">
        Quantidade e unidade andam juntas (hectare, cabeça, tonelada ou quilômetro).
      </p>
      <CampoTextoLongo
        label="Observação"
        value={form.observacao}
        onChange={(v) => mudar({ observacao: v }, ["observacao"])}
        readOnly={bloqueado}
        maxLength={MAX_OBSERVACAO}
      />
      <ErroDoCampo texto={erros.observacao} />

      <SecaoForm titulo="Centros" />
      <SeletorPaginadoGestao
        rotulo="Centro de custo"
        testId="apontamento-centro-custo"
        chave={["apontamentos-atividade", "centros-custo", empresaId]}
        buscar={({ q, cursor, limit }) => listarOpcoesApontamento("centros-custo", empresaId, { q, cursor, limit })}
        value={form.centro_custo}
        onChange={(opcao) => mudar({ centro_custo: opcao ? { id: String(opcao.id), rotulo: rotuloDoCentro(opcao) } : null }, ["centro_custo"])}
        rotuloDaOpcao={rotuloDoCentro}
        detalheDaOpcao={detalheDoCentro}
        readOnly={bloqueado}
        permitirLimpar
        erro={erros.centro_custo}
        span={6}
        maiusculas={false}
      />
      <SeletorPaginadoGestao
        rotulo="Centro de resultado"
        testId="apontamento-centro-resultado"
        chave={["apontamentos-atividade", "centros-resultado", empresaId]}
        buscar={({ q, cursor, limit }) => listarOpcoesApontamento("centros-resultado", empresaId, { q, cursor, limit })}
        value={form.centro_resultado}
        onChange={(opcao) => mudar({ centro_resultado: opcao ? { id: String(opcao.id), rotulo: rotuloDoCentro(opcao) } : null }, ["centro_resultado"])}
        rotuloDaOpcao={rotuloDoCentro}
        detalheDaOpcao={detalheDoCentro}
        readOnly={bloqueado}
        permitirLimpar
        erro={erros.centro_resultado}
        span={6}
        maiusculas={false}
      />

      {existente && !cancelado && readOnly && podeCancelar && onCancelar ? (
        <div className="col-span-12 flex flex-wrap gap-2 pt-1">
          <button type="button" className={BOTAO_PERIGO} onClick={onCancelar} data-testid="apontamento-cancelar">
            <Ban size={16} aria-hidden /> Cancelar apontamento
          </button>
        </div>
      ) : null}
    </form>
  );

  return (
    <CadastroFormShell embedded title={existente ? "Apontamento de atividade" : "Novo apontamento de atividade"}>
      {formBody}
    </CadastroFormShell>
  );
}
