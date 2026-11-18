import React, { useEffect, useMemo, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { DENSIDADE_BASE1 } from "@/components/cadastro/base1/B1Field";
import CadastroFormShell from "@/components/cadastro/base1/CadastroFormShell";
import CadastroFormActions from "@/components/cadastro/base1/CadastroFormActions";
import { AvisoGestao, CampoSelect, CampoTexto, SecaoForm } from "@/components/gestao/GestaoFormParts";
import { CampoDia, CampoNumero } from "@/components/financeiroGestao/CamposLancamento";
import SeletorPaginadoGestao from "@/components/financeiroGestao/SeletorPaginadoGestao";
import { CampoTextoLongo } from "@/components/patrimonio/PatrimonioFormParts";
import { useEmpresaRealSelecionadaId, useFusoDaFazenda } from "@/hooks/useLancamentoAtividadesSessao";
import { notifyInfo, notifySuccess, notifyWarning } from "@/lib/maikeNotify";
import { ROTULO_NATUREZA } from "@/lib/patrimonioDominio";
import {
  LIMITES_DECIMAL_ATIVIDADE,
  LOCALE_ATIVIDADE,
  MAX_NOME_ATIVIDADE,
  MAX_OBSERVACAO_ATIVIDADE,
  MAX_SAFRA_ATIVIDADE,
  STATUS_ABERTA,
  mensagemDeErroAtividade,
  rotuloDaArea,
  rotuloDaTarefa,
  rotuloDoBem,
} from "@/lib/lancamentoAtividadesRegras";
import {
  CAMPO_DO_FORMULARIO_ATIVIDADE,
  RAIZ_CONSULTAS_ATIVIDADES,
  camposAlteradosDaAtividade,
  campoDoFormulario,
  corpoDaAtividade,
  exigenciasDoTipo,
  formularioAtividadeVazio,
  formularioDaAtividade,
  herancaDoTipo,
  herancaGravada,
  normalizarPaginaDeOpcoes,
  validarFormularioAtividade,
} from "@/lib/atividadeApontamentoRegras";
import { listarAreasAtivas } from "@/services/mapaService";
import { listarTarefasDaEmpresa } from "@/services/tarefasMapaService";
import { listarTiposAtividade } from "@/services/tipoAtividadeCadastroService";
import { criarAtividade, editarAtividade, listarOpcoesBens } from "@/services/lancamentoAtividadesService";
import { ehResultadoIncerto } from "@/services/operacaoFinanceiraService";
import SeletorAreasDaAtividade from "@/components/lancamento-atividades/SeletorAreasDaAtividade";
import { areasDaAtividade, corpoDasAreasDaAbertura, errosDasAreasDaAbertura, rotuloDaAreaDaAtividade, temAreas, textoDaColunaArea } from "@/lib/atividadeAreasRegras";

export const FORMULARIO_ATIVIDADE_ID = "formulario-atividade-base1";

/** @param {any} o */
const detalheDoBem = (o) => /** @type {Record<string, string>} */ (ROTULO_NATUREZA)[String(o?.natureza ?? "")] ?? null;

/** @param {{ data?: unknown }} consulta @returns {any[]} */
const listaDe = (consulta) => (Array.isArray(consulta.data) ? consulta.data : []);

/** Tarefa na lista de origem: o título e a situação dela ("ROÇADA DO PASTO 3 (PENDENTE)"). @param {any} t */
const rotuloDaTarefaNaLista = (t) => {
  const rotulo = rotuloDaTarefa(t) || String(t?.id ?? "");
  const situacao = typeof t?.status === "string" && t.status.trim() ? t.status.trim() : "";
  return situacao ? `${rotulo} (${situacao})` : rotulo;
};

/** Valor de um campo travado: o herdado ou, sem ele, o texto que diz por quê. @param {string} valor @param {string} vazio */
const travado = (valor, vazio) => (valor ? valor : vazio);

/**
 * Formulário do CABEÇALHO da atividade (D-PROD-200, Fatia 2): abrir uma
 * atividade nova ou editar a aberta. Grava sozinho (serviço do Lançamento de
 * Atividades, que põe a fazenda selecionada) e devolve a atividade gravada em
 * `onSalvo`.
 *
 * Campos que a pessoa preenche: nome; tipo (só os ATIVOS; na edição o tipo não
 * muda e aparece só leitura); área (as ativas da fazenda); máquina (seletor
 * paginado do servidor); safra; data de início (padrão hoje na fazenda, nunca
 * futura); data prevista de fim; área planejada; tarefa de origem (os
 * lançamentos de tarefa da fazenda) e observação.
 *
 * HERDADO, só leitura, nunca no corpo: o grupo, o centro de custo, o centro de
 * resultado e a unidade de produção vêm do TIPO (na abertura, a prévia do que
 * o servidor copia: centro só ativo e da mesma fazenda, unidade só ativa; na
 * edição, o snapshot gravado), e o setor vem da ÁREA (trocar a área refaz o
 * setor no servidor).
 *
 * O que o tipo exige (`exige_area`, `exige_safra`, `exige_maquina`) fica marcado
 * como obrigatório e é avisado antes de enviar; quem decide é o servidor, que
 * confere de novo na abertura e na edição. A edição é um PATCH mínimo com a
 * `versao` lida (sem mudança, nada é enviado), e só vale para a atividade
 * ABERTA. A recusa do servidor aparece no campo apontado e num aviso.
 *
 * @param {{
 *   atividade?: any,
 *   onSalvo: (atividade: any) => void,
 *   onCancelar: () => void,
 *   variant?: "card" | "embedded",
 * }} props `variant` "embedded": sem o cartão e o título (quando a tela já os tem).
 */
export default function FormularioAtividade({ atividade = null, onSalvo, onCancelar, variant = "card" }) {
  const existente = Boolean(atividade?.id);
  const empresaId = useEmpresaRealSelecionadaId();
  const { hoje, fuso, semFuso } = useFusoDaFazenda(empresaId);
  const naoAberta = existente && atividade?.status !== STATUS_ABERTA;
  const somenteLeitura = !empresaId || naoAberta;

  const [form, setForm] = useState(() => (existente ? formularioDaAtividade(atividade) : formularioAtividadeVazio(hoje)));
  // D-PROD-249: as ÁREAS da abertura (várias áreas por atividade), cada uma com a área planejada (padrão = o tamanho).
  const [areasEscolhidas, setAreasEscolhidas] = useState(/** @type {import("@/lib/atividadeAreasRegras").LinhaDaAbertura[]} */ ([]));
  // Na edição, a atividade com áreas muda as áreas pelo card "Áreas da atividade" (o formulário só as mostra).
  const comAreas = existente && temAreas(atividade);
  const [erros, setErros] = useState(/** @type {Record<string, string>} */ ({}));
  const [erroGeral, setErroGeral] = useState(/** @type {string|null} */ (null));
  const [enviando, setEnviando] = useState(false);
  const emCurso = useRef(false);
  // A data de início da atividade NOVA acompanha o "hoje" da fazenda (o fuso chegando, a virada do dia) até a pessoa mexer nela.
  const inicioEditado = useRef(existente);

  useEffect(() => {
    if (inicioEditado.current || !hoje) return;
    setForm((f) => (f.data_inicio === hoje ? f : { ...f, data_inicio: hoje }));
  }, [hoje]);

  // Área, máquina e tarefa são da fazenda: trocar a fazenda com o formulário aberto volta os três ao gravado.
  const empresaDoFormulario = useRef(empresaId);
  useEffect(() => {
    if (empresaDoFormulario.current === empresaId) return;
    empresaDoFormulario.current = empresaId;
    const gravado = existente ? formularioDaAtividade(atividade) : null;
    setForm((f) => ({ ...f, area_id: gravado?.area_id ?? "", bem: gravado?.bem ?? null, lancamento_tarefa_id: gravado?.lancamento_tarefa_id ?? "" }));
    setAreasEscolhidas([]);
    setErros({});
    setErroGeral(null);
  }, [empresaId, existente, atividade]);

  const tiposQuery = useQuery({
    queryKey: ["tipos-atividade", RAIZ_CONSULTAS_ATIVIDADES],
    queryFn: () => listarTiposAtividade(),
    staleTime: 30 * 1000,
  });
  const areasQuery = useQuery({
    queryKey: ["areas", empresaId, RAIZ_CONSULTAS_ATIVIDADES],
    queryFn: () => listarAreasAtivas(empresaId),
    enabled: Boolean(empresaId),
    staleTime: 30 * 1000,
  });
  const tarefasQuery = useQuery({
    queryKey: ["tarefas-mapa", RAIZ_CONSULTAS_ATIVIDADES, empresaId],
    queryFn: () => listarTarefasDaEmpresa(empresaId, { order: "-updated_date" }),
    enabled: Boolean(empresaId),
    staleTime: 30 * 1000,
  });

  const tipos = listaDe(tiposQuery);
  const areas = listaDe(areasQuery);
  const tarefas = listaDe(tarefasQuery);

  // O tipo: na abertura, o escolhido (só os ativos são oferecidos); na edição, o gravado, que não muda —
  // dele só se leem as exigências atuais (o servidor confere as flags de novo na edição).
  const tipoId = existente ? String(atividade?.tipo_atividade_id ?? "") : form.tipo_atividade_id;
  const tipo = tipos.find((t) => String(t?.id) === tipoId) ?? null;
  const exigencias = exigenciasDoTipo(tipo);
  const nomeDoTipo = existente ? String(atividade?.tipo_atividade_nome ?? "") : String(tipo?.nome_tipo ?? "");
  const nomeDoGrupo = existente ? String(atividade?.grupo_atividade_nome ?? "") : String(tipo?.grupo_atividade_nome ?? "");
  const heranca = existente ? herancaGravada(atividade) : herancaDoTipo(tipo, empresaId);
  // Por que um padrão do tipo NÃO vem (inativo, de outra fazenda): a pessoa vê antes de abrir.
  const notasDaHeranca = /** @type {string[]} */ (
    [heranca.centro_custo.nota, heranca.centro_resultado.nota, heranca.unidade_producao.nota].filter((n) => typeof n === "string" && n !== "")
  );

  const opcoesTipo = useMemo(
    () =>
      tipos
        .filter((t) => t && t.id != null && t.ativo !== false)
        .map((t) => ({ value: String(t.id), label: String(t.nome_tipo ?? "") || String(t.id) })),
    [tipos],
  );

  // Só áreas ATIVAS da fazenda; a área gravada que ficou inativa continua visível (marcada) na edição.
  const areaGravadaId = existente ? String(atividade?.area_id ?? "") : "";
  const opcoesArea = useMemo(() => {
    const lista = areas.filter((a) => a && a.id != null && a.ativo !== false).map((a) => ({ value: String(a.id), label: rotuloDaArea(a) || String(a.id) }));
    if (areaGravadaId && !lista.some((o) => o.value === areaGravadaId)) {
      const rotulo = rotuloDaArea(atividade?.area) || "Área gravada";
      lista.unshift({ value: areaGravadaId, label: areasQuery.isSuccess ? `${rotulo} (INATIVA)` : rotulo });
    }
    return lista;
  }, [areas, areaGravadaId, atividade, areasQuery.isSuccess]);

  // Setor HERDADO da área: o gravado enquanto a área for a gravada; trocou a área, o da área nova (o servidor refaz).
  const areaEscolhida = areas.find((a) => String(a?.id) === form.area_id) ?? null;
  let setor = "";
  if (form.area_id) {
    setor =
      existente && form.area_id === areaGravadaId
        ? String(atividade?.setor_nome ?? "")
        : typeof areaEscolhida?.setor_nome === "string"
          ? areaEscolhida.setor_nome
          : "";
  }

  // Tarefa de origem: os lançamentos de tarefa da fazenda; a gravada continua visível mesmo fora da lista.
  const tarefaGravadaId = existente ? String(atividade?.lancamento_tarefa_id ?? "") : "";
  const opcoesTarefa = useMemo(() => {
    const lista = tarefas.filter((t) => t && t.id != null).map((t) => ({ value: String(t.id), label: rotuloDaTarefaNaLista(t) }));
    if (tarefaGravadaId && !lista.some((o) => o.value === tarefaGravadaId)) {
      lista.unshift({ value: tarefaGravadaId, label: rotuloDaTarefa(atividade?.lancamento_tarefa) || "Tarefa gravada" });
    }
    return lista;
  }, [tarefas, tarefaGravadaId, atividade]);

  const bloqueado = somenteLeitura || enviando;

  /** @param {Partial<import("@/lib/atividadeApontamentoRegras").FormularioAtividade>} mudanca @param {string[]} campos */
  const mudar = (mudanca, campos) => {
    setForm((f) => ({ ...f, ...mudanca }));
    setErros((e) => (campos.some((c) => e[c]) ? Object.fromEntries(Object.entries(e).filter(([k]) => !campos.includes(k))) : e));
    setErroGeral(null);
  };

  /** @param {unknown} erro */
  const tratarErro = (erro) => {
    if (ehResultadoIncerto(erro)) {
      const texto = existente
        ? "Não recebemos a resposta do servidor: a alteração PODE ter sido gravada. Confira a atividade antes de salvar de novo."
        : "Não recebemos a resposta do servidor: a atividade PODE ter sido aberta. Confira a lista de atividades antes de abrir de novo.";
      setErroGeral(texto);
      notifyWarning("Resultado incerto", texto);
      return;
    }
    const mensagem = mensagemDeErroAtividade(erro, "Não foi possível salvar a atividade. Nada foi gravado.");
    const campo = campoDoFormulario(erro, CAMPO_DO_FORMULARIO_ATIVIDADE);
    if (campo) setErros((e) => ({ ...e, [campo]: mensagem }));
    setErroGeral(mensagem);
    notifyWarning("Atenção", mensagem);
  };

  const salvar = async () => {
    if (emCurso.current || somenteLeitura) return;
    if (!empresaId) {
      notifyWarning("Atenção", "Selecione uma fazenda antes de gravar.");
      return;
    }
    if (semFuso) {
      notifyWarning("Atenção", "Configure o fuso horário da fazenda (Empresa → Fuso horário) antes de gravar a atividade.");
      return;
    }
    if (!fuso) {
      notifyInfo("Aguarde", "Lendo o fuso horário da fazenda para conferir as datas. Tente de novo em instantes.");
      return;
    }
    // D-PROD-249: na abertura, a exigência de área do tipo vale para a lista de áreas (ao menos uma); com áreas, a edição não mexe nelas.
    const v = {
      ...validarFormularioAtividade(form, { hoje, novo: !existente, exigencias: { ...exigencias, area: exigencias.area && existente && !comAreas }, nomeDoTipo }),
      ...(existente ? {} : errosDasAreasDaAbertura(areasEscolhidas, { exigeArea: exigencias.area, nomeDoTipo })),
    };
    setErros(v);
    if (Object.keys(v).length) {
      notifyWarning("Atenção", "Revise os campos destacados.");
      return;
    }
    const corpo = corpoDaAtividade(form, { novo: !existente });
    // D-PROD-249: a abertura manda `areas[]` (e nunca `area_id` nem a planejada do cabeçalho); a edição da atividade com
    // áreas não manda nenhum dos dois (as áreas mudam pelo card).
    if (!existente || comAreas) {
      delete corpo.area_id;
      delete corpo.area_planejada;
    }
    if (!existente && areasEscolhidas.length) corpo.areas = corpoDasAreasDaAbertura(areasEscolhidas);
    emCurso.current = true;
    setEnviando(true);
    setErroGeral(null);
    try {
      if (existente) {
        const mudancas = camposAlteradosDaAtividade(atividade, corpo);
        if (!Object.keys(mudancas).length) {
          notifyInfo("Sem alterações", "Nada foi alterado.");
          onCancelar();
          return;
        }
        const salva = await editarAtividade(String(atividade.id), { ...mudancas, versao: atividade.versao });
        notifySuccess("Sucesso", `Atividade${atividade?.numero != null ? ` nº ${atividade.numero}` : ""} atualizada.`);
        onSalvo(salva);
      } else {
        // A porta tira as chaves vazias da abertura: o opcional não informado não vai (o servidor aplica o padrão).
        const salva = /** @type {any} */ (await criarAtividade(corpo));
        notifySuccess("Sucesso", `Atividade${salva?.numero != null ? ` nº ${salva.numero}` : ""} aberta.`);
        onSalvo(salva);
      }
    } catch (erro) {
      tratarErro(erro);
    } finally {
      emCurso.current = false;
      setEnviando(false);
    }
  };

  /** @param {React.FormEvent<HTMLFormElement>} e */
  const handleSubmit = (e) => {
    e.preventDefault();
    void salvar();
  };

  let aviso = null;
  if (!empresaId) aviso = "Selecione uma fazenda para abrir ou editar atividades: a área, a máquina e os centros são da fazenda.";
  else if (naoAberta) aviso = "Só a atividade aberta pode ser editada. Para corrigir uma atividade concluída, reabra-a antes.";
  else if (semFuso) aviso = "Configure o fuso horário da fazenda (Empresa → Fuso horário) antes de gravar: o servidor recusa sem ele.";

  const erroDasListas = tiposQuery.error ?? areasQuery.error ?? tarefasQuery.error ?? null;
  const formBody = (
    <form
      id={FORMULARIO_ATIVIDADE_ID}
      onSubmit={handleSubmit}
      className="b1 mg-b1-form-grid w-full min-h-0"
      noValidate
      data-testid="b1-form-atividade"
      data-densidade={DENSIDADE_BASE1}
      data-somente-leitura={somenteLeitura ? "" : undefined}
    >
      {aviso ? (
        <div className="col-span-12">
          <AvisoGestao testId="atividade-aviso">{aviso}</AvisoGestao>
        </div>
      ) : null}
      {erroDasListas ? (
        <div className="col-span-12">
          <AvisoGestao testId="atividade-listas-erro">
            {mensagemDeErroAtividade(erroDasListas, "Não foi possível carregar as listas do formulário. Verifique a conexão e tente de novo.")}{" "}
            <button
              type="button"
              className="underline"
              onClick={() => {
                if (tiposQuery.isError) tiposQuery.refetch();
                if (areasQuery.isError) areasQuery.refetch();
                if (tarefasQuery.isError) tarefasQuery.refetch();
              }}
            >
              Tentar novamente
            </button>
          </AvisoGestao>
        </div>
      ) : null}

      <SecaoForm titulo="Atividade" />
      <CampoTexto
        label="Nome da atividade"
        value={form.nome}
        onChange={(v) => mudar({ nome: v }, ["nome"])}
        readOnly={bloqueado}
        required
        span={12}
        maxLength={MAX_NOME_ATIVIDADE}
        placeholder="Ex.: Cigarrinha Pasto 01"
        keepCase
        error={erros.nome}
      />
      {existente ? (
        <CampoTexto label="Tipo de atividade" value={nomeDoTipo} onChange={() => {}} readOnly span={6} />
      ) : (
        <CampoSelect
          label="Tipo de atividade"
          value={form.tipo_atividade_id}
          // As exigências mudam com o tipo: os avisos de área, safra e máquina do tipo anterior saem.
          onChange={(v) => mudar({ tipo_atividade_id: v }, ["tipo_atividade_id", "area_id", "safra_ciclo", "bem"])}
          options={opcoesTipo}
          readOnly={bloqueado}
          required
          span={6}
          error={erros.tipo_atividade_id}
        />
      )}
      <CampoTexto label="Grupo de atividade" value={nomeDoGrupo} onChange={() => {}} readOnly span={6} />

      <SecaoForm titulo="Onde e com o quê" />
      {!existente ? (
        <SeletorAreasDaAtividade
          areasDoMapa={areas}
          linhas={areasEscolhidas}
          onChange={(l) => {
            setAreasEscolhidas(l);
            setErros((e) => Object.fromEntries(Object.entries(e).filter(([k]) => k !== "areas" && !k.startsWith("area:"))));
            setErroGeral(null);
          }}
          erros={erros}
          obrigatorio={exigencias.area}
          readOnly={bloqueado}
          carregando={areasQuery.isLoading}
        />
      ) : comAreas ? (
        <div className="col-span-12 min-w-0" data-testid="atividade-areas-somente-leitura">
          <CampoTexto
            label={`Áreas (${areasDaAtividade(atividade).length})`}
            value={`${textoDaColunaArea(atividade)} — ${areasDaAtividade(atividade).map(rotuloDaAreaDaAtividade).join(", ")}`}
            onChange={() => {}}
            readOnly
            span={12}
          />
          <p className="mt-1 text-[12px] text-[var(--mg-text-2,#475569)]">As áreas, a área planejada de cada uma e o início e a conclusão mudam no card &quot;Áreas da atividade&quot;.</p>
        </div>
      ) : (
        <>
          <CampoSelect
            label="Área"
            value={form.area_id}
            onChange={(v) => mudar({ area_id: v }, ["area_id"])}
            options={opcoesArea}
            placeholder={exigencias.area ? undefined : "Sem área"}
            readOnly={bloqueado}
            required={exigencias.area}
            span={6}
            error={erros.area_id}
          />
          <CampoTexto label="Setor (da área)" value={travado(setor, form.area_id ? "Área sem setor" : "")} onChange={() => {}} readOnly span={6} />
        </>
      )}
      <SeletorPaginadoGestao
        rotulo="Máquina"
        testId="atividade-maquina"
        chave={[RAIZ_CONSULTAS_ATIVIDADES, "bens", empresaId]}
        buscar={async ({ q, cursor, limit }) => normalizarPaginaDeOpcoes(await listarOpcoesBens({ q, cursor, limit }))}
        value={form.bem}
        onChange={(o) => mudar({ bem: o ? { id: String(o.id), rotulo: rotuloDoBem(o) || String(o.id) } : null }, ["bem"])}
        rotuloDaOpcao={rotuloDoBem}
        detalheDaOpcao={detalheDoBem}
        readOnly={bloqueado}
        obrigatorio={exigencias.maquina}
        permitirLimpar
        erro={erros.bem}
        span={6}
        maiusculas={false}
      />
      <CampoTexto
        label="Safra"
        value={form.safra_ciclo}
        onChange={(v) => mudar({ safra_ciclo: v }, ["safra_ciclo"])}
        readOnly={bloqueado}
        required={exigencias.safra}
        span={6}
        maxLength={MAX_SAFRA_ATIVIDADE}
        placeholder="Ex.: 2026/27"
        keepCase
        error={erros.safra_ciclo}
      />

      <SecaoForm titulo="Herdado do tipo" />
      <CampoTexto
        label="Centro de custo"
        value={travado(heranca.centro_custo.rotulo, tipoId ? "Sem centro de custo" : "")}
        onChange={() => {}}
        readOnly
        span={6}
      />
      <CampoTexto
        label="Centro de resultado"
        value={travado(heranca.centro_resultado.rotulo, tipoId ? "Sem centro de resultado" : "")}
        onChange={() => {}}
        readOnly
        span={6}
      />
      <CampoTexto
        label="Unidade de produção"
        value={travado(heranca.unidade_producao.rotulo, tipoId ? "Sem unidade de produção" : "")}
        onChange={() => {}}
        readOnly
        span={6}
      />
      {notasDaHeranca.length || (!existente && !tipoId) ? (
        <div className="col-span-12">
          <AvisoGestao tone="blue" testId="atividade-heranca">
            {!existente && !tipoId ? <span className="block">Escolha o tipo: os centros e a unidade de produção vêm dele; o setor vem da área.</span> : null}
            {notasDaHeranca.map((n) => (
              <span key={n} className="block">
                {n}
              </span>
            ))}
          </AvisoGestao>
        </div>
      ) : null}

      <SecaoForm titulo="Período" />
      <CampoDia
        label="Data de início"
        value={form.data_inicio}
        onChange={(v) => {
          inicioEditado.current = true;
          mudar({ data_inicio: v }, ["data_inicio", "data_prevista_fim"]);
        }}
        max={hoje || undefined}
        readOnly={bloqueado}
        required
        span={4}
        error={erros.data_inicio}
        testId="atividade-data-inicio"
      />
      <CampoDia
        label="Data prevista de fim"
        value={form.data_prevista_fim}
        onChange={(v) => mudar({ data_prevista_fim: v }, ["data_prevista_fim"])}
        min={form.data_inicio || undefined}
        readOnly={bloqueado}
        span={4}
        error={erros.data_prevista_fim}
        testId="atividade-data-prevista-fim"
      />
      {existente && !comAreas ? (
        <CampoNumero
          label="Área planejada (ha)"
          value={form.area_planejada}
          onChange={(v) => mudar({ area_planejada: v }, ["area_planejada"])}
          locale={LOCALE_ATIVIDADE}
          limites={LIMITES_DECIMAL_ATIVIDADE}
          readOnly={bloqueado}
          span={4}
          error={erros.area_planejada}
          testId="atividade-area-planejada"
        />
      ) : null}

      <SecaoForm titulo="Origem e observação" />
      <CampoSelect
        label="Tarefa de origem"
        value={form.lancamento_tarefa_id}
        onChange={(v) => mudar({ lancamento_tarefa_id: v }, ["lancamento_tarefa_id"])}
        options={opcoesTarefa}
        placeholder="Sem tarefa de origem"
        readOnly={bloqueado}
        span={12}
        error={erros.lancamento_tarefa_id}
      />
      <CampoTextoLongo
        label="Observação"
        value={form.observacao}
        onChange={(v) => mudar({ observacao: v }, ["observacao"])}
        readOnly={bloqueado}
        maxLength={MAX_OBSERVACAO_ATIVIDADE}
      />

      {erroGeral ? (
        <div className="col-span-12">
          <AvisoGestao testId="atividade-erro">{erroGeral}</AvisoGestao>
        </div>
      ) : null}

      <div className="col-span-12">
        <CadastroFormActions
          onCancel={onCancelar}
          submitLabel={enviando ? "Salvando…" : existente ? "Salvar" : "Abrir atividade"}
          isSubmitting={enviando || somenteLeitura}
        />
      </div>
    </form>
  );

  return (
    // O botão de gravar segue a ação que abriu o formulário (criar ou editar atividade): a heurística de texto do Layout não vale.
    <div data-permissao-explicita="" className="contents">
      <CadastroFormShell
        embedded={variant === "embedded"}
        title={existente ? `Editar atividade${atividade?.numero != null ? ` nº ${atividade.numero}` : ""}` : "Abrir atividade"}
      >
        {formBody}
      </CadastroFormShell>
    </div>
  );
}
