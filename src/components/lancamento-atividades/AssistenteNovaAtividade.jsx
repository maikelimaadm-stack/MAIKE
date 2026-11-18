import React, { useEffect, useMemo, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { ArrowLeft, Check } from "lucide-react";
import { DENSIDADE_BASE1 } from "@/components/cadastro/base1/B1Field";
import { AvisoGestao, CampoSelect, CampoTexto, SecaoForm } from "@/components/gestao/GestaoFormParts";
import { CampoDia } from "@/components/financeiroGestao/CamposLancamento";
import SeletorPaginadoGestao from "@/components/financeiroGestao/SeletorPaginadoGestao";
import { CampoTextoLongo } from "@/components/patrimonio/PatrimonioFormParts";
import { BOTAO_PRIMARIO, BOTAO_SECUNDARIO } from "@/components/patrimonio/DialogosAbastecimento";
import { useEmpresaRealSelecionadaId, useFusoDaFazenda } from "@/hooks/useLancamentoAtividadesSessao";
import { notifyInfo, notifySuccess, notifyWarning } from "@/lib/maikeNotify";
import { ROTULO_NATUREZA } from "@/lib/patrimonioDominio";
import {
  MAX_NOME_ATIVIDADE,
  MAX_OBSERVACAO_ATIVIDADE,
  MAX_SAFRA_ATIVIDADE,
  mensagemDeErroAtividade,
  rotuloDaArea,
  rotuloDaTarefa,
  rotuloDoBem,
} from "@/lib/lancamentoAtividadesRegras";
import {
  CAMPO_DO_FORMULARIO_ATIVIDADE,
  RAIZ_CONSULTAS_ATIVIDADES,
  campoDoFormulario,
  corpoDaAtividade,
  exigenciasDoTipo,
  formularioAtividadeVazio,
  herancaDoTipo,
  normalizarPaginaDeOpcoes,
  validarFormularioAtividade,
} from "@/lib/atividadeApontamentoRegras";
import { corpoDasAreasDaAbertura, errosDasAreasDaAbertura, alternarAreaNaAbertura, hectaresCanonicos } from "@/lib/atividadeAreasRegras";
import { formatarDecimalLinha } from "@/lib/atividadeLinhasRegras";
import { GRUPO_LAVOURA, GRUPO_OUTRA, GRUPO_PASTO, grupoDaArea, rotuloDoGrupoDeArea, textoDoQuePodeRegistrar } from "@/lib/atividadeFluxoCampo";
import { listarAreasAtivas } from "@/services/mapaService";
import { listarTarefasDaEmpresa } from "@/services/tarefasMapaService";
import { listarTiposAtividade } from "@/services/tipoAtividadeCadastroService";
import { criarAtividade, listarOpcoesBens } from "@/services/lancamentoAtividadesService";
import { ehResultadoIncerto } from "@/services/operacaoFinanceiraService";

/** @param {any} o */
const detalheDoBem = (o) => /** @type {string|null} */ (ROTULO_NATUREZA[String(o?.natureza ?? "")] ?? null);

/** @param {{ data?: unknown }} consulta */
const listaDe = (consulta) => (Array.isArray(consulta.data) ? consulta.data : []);

/** @param {any} t */
const rotuloDaTarefaNaLista = (t) => {
  const rotulo = rotuloDaTarefa(t) || String(t?.id ?? "");
  const situacao = typeof t?.status === "string" && t.status.trim() ? t.status.trim() : "";
  return situacao ? `${rotulo} (${situacao})` : rotulo;
};

const BOTAO = `${BOTAO_PRIMARIO} min-h-12 w-full justify-center text-[15px]`;
const BOTAO_VOLTAR = `${BOTAO_SECUNDARIO} min-h-12 justify-center`;

/**
 * Abrir uma atividade em três passos (D-PROD-250): o tipo, as áreas, a confirmação.
 * As áreas nascem sem começar. Safra e máquina só aparecem na frente quando o tipo exige;
 * o resto (fim previsto, tarefa, observação, centros) fica em "Mais detalhes".
 *
 * @param {{ onSalvo: (atividade: any) => void, onCancelar: () => void }} props
 */
export default function AssistenteNovaAtividade({ onSalvo, onCancelar }) {
  const empresaId = useEmpresaRealSelecionadaId();
  const { hoje, fuso, semFuso } = useFusoDaFazenda(empresaId);
  const [passo, setPasso] = useState(/** @type {1|2|3} */ (1));
  const [form, setForm] = useState(() => formularioAtividadeVazio(hoje));
  const [areasEscolhidas, setAreasEscolhidas] = useState(/** @type {import("@/lib/atividadeAreasRegras").LinhaDaAbertura[]} */ ([]));
  const [erros, setErros] = useState(/** @type {Record<string, string>} */ ({}));
  const [erroGeral, setErroGeral] = useState(/** @type {string|null} */ (null));
  const [mais, setMais] = useState(false);
  const [enviando, setEnviando] = useState(false);
  const emCurso = useRef(false);
  const inicioEditado = useRef(false);
  const nomeEditado = useRef(false);

  useEffect(() => {
    if (inicioEditado.current || !hoje) return;
    setForm((f) => (f.data_inicio === hoje ? f : { ...f, data_inicio: hoje }));
  }, [hoje]);

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
    enabled: Boolean(empresaId) && passo === 3,
    staleTime: 30 * 1000,
  });

  const tipos = listaDe(tiposQuery).filter((t) => t && t.id != null && t.ativo !== false);
  const areas = listaDe(areasQuery).filter((a) => a && a.id != null && a.ativo !== false);
  const tarefas = listaDe(tarefasQuery);
  const tipo = tipos.find((t) => String(t.id) === form.tipo_atividade_id) ?? null;
  const exigencias = exigenciasDoTipo(tipo);
  const nomeDoTipo = String(tipo?.nome_tipo ?? "");
  const heranca = herancaDoTipo(tipo, empresaId);
  const notasDaHeranca = [heranca.centro_custo.nota, heranca.centro_resultado.nota, heranca.unidade_producao.nota].filter((n) => typeof n === "string" && n !== "");

  useEffect(() => {
    if (nomeEditado.current || !nomeDoTipo) return;
    setForm((f) => (f.nome === nomeDoTipo ? f : { ...f, nome: nomeDoTipo }));
  }, [nomeDoTipo]);

  const grupos = useMemo(() => {
    /** @type {Record<'pasto'|'lavoura'|'outra', any[]>} */
    const mapa = { pasto: [], lavoura: [], outra: [] };
    for (const a of areas) mapa[grupoDaArea(a)].push(a);
    return [GRUPO_PASTO, GRUPO_LAVOURA, GRUPO_OUTRA].map((id) => ({ id, areas: mapa[id] })).filter((g) => g.areas.length > 0);
  }, [areas]);

  const opcoesTarefa = useMemo(
    () => tarefas.filter((t) => t && t.id != null).map((t) => ({ value: String(t.id), label: rotuloDaTarefaNaLista(t) })),
    [tarefas],
  );

  /** @param {Partial<import("@/lib/atividadeApontamentoRegras").FormularioAtividade>} mudanca @param {string[]} campos */
  const mudar = (mudanca, campos) => {
    setForm((f) => ({ ...f, ...mudanca }));
    setErros((e) => (campos.some((c) => e[c]) ? Object.fromEntries(Object.entries(e).filter(([k]) => !campos.includes(k))) : e));
    setErroGeral(null);
  };

  const seguir = () => {
    if (passo === 1) {
      if (!form.tipo_atividade_id) {
        setErros({ tipo_atividade_id: "Escolha o tipo de trabalho." });
        return;
      }
      setErros({});
      setPasso(2);
      return;
    }
    if (passo === 2) {
      const v = errosDasAreasDaAbertura(areasEscolhidas, { exigeArea: exigencias.area, nomeDoTipo });
      setErros(v);
      if (Object.keys(v).length) {
        notifyWarning("Atenção", v.areas || "Revise as áreas.");
        return;
      }
      setPasso(3);
    }
  };

  const salvar = async () => {
    if (emCurso.current) return;
    if (!empresaId) {
      notifyWarning("Atenção", "Selecione uma fazenda antes de abrir a atividade.");
      return;
    }
    if (semFuso) {
      notifyWarning("Atenção", "Configure o fuso horário da fazenda (Empresa → Fuso horário) antes de abrir a atividade.");
      return;
    }
    if (!fuso) {
      notifyInfo("Aguarde", "Lendo o fuso horário da fazenda para conferir as datas. Tente de novo em instantes.");
      return;
    }
    const v = {
      ...validarFormularioAtividade(form, { hoje, novo: true, exigencias: { ...exigencias, area: false }, nomeDoTipo }),
      ...errosDasAreasDaAbertura(areasEscolhidas, { exigeArea: exigencias.area, nomeDoTipo }),
    };
    setErros(v);
    if (Object.keys(v).length) {
      notifyWarning("Atenção", "Revise os campos destacados.");
      if (v.tipo_atividade_id) setPasso(1);
      else if (v.areas) setPasso(2);
      return;
    }
    const corpo = corpoDaAtividade(form, { novo: true });
    delete corpo.area_id;
    delete corpo.area_planejada;
    if (areasEscolhidas.length) corpo.areas = corpoDasAreasDaAbertura(areasEscolhidas);
    emCurso.current = true;
    setEnviando(true);
    setErroGeral(null);
    try {
      const salva = /** @type {any} */ (await criarAtividade(corpo));
      notifySuccess("Sucesso", `Atividade${salva?.numero != null ? ` nº ${salva.numero}` : ""} aberta.`);
      onSalvo(salva);
    } catch (erro) {
      if (ehResultadoIncerto(erro)) {
        const msg = "Não recebemos a resposta do servidor: a atividade PODE ter sido aberta. Confira a lista antes de abrir de novo.";
        setErroGeral(msg);
        notifyWarning("Resultado incerto", msg);
      } else {
        const mensagem = mensagemDeErroAtividade(erro, "Não foi possível abrir a atividade. Nada foi gravado.");
        const campo = campoDoFormulario(erro, CAMPO_DO_FORMULARIO_ATIVIDADE);
        if (campo) setErros((e) => ({ ...e, [campo]: mensagem }));
        setErroGeral(mensagem);
        notifyWarning("Atenção", mensagem);
      }
    } finally {
      emCurso.current = false;
      setEnviando(false);
    }
  };

  let aviso = null;
  if (!empresaId) aviso = "Selecione uma fazenda para abrir a atividade.";
  else if (semFuso) aviso = "Configure o fuso horário da fazenda (Empresa → Fuso horário) antes de abrir a atividade.";

  const ha = (/** @type {any} */ a) => {
    const c = hectaresCanonicos(a?.tamanho_hectares);
    return c ? `${formatarDecimalLinha(c)} ha` : "";
  };

  return (
    <div className="mx-auto w-full max-w-xl min-w-0" data-testid="assistente-nova-atividade" data-passo={passo}>
      <p className="mb-1 text-[12px] font-semibold uppercase tracking-wide text-emerald-700" data-testid="assistente-passo">
        Passo {passo} de 3
      </p>
      {aviso ? <AvisoGestao testId="assistente-aviso">{aviso}</AvisoGestao> : null}
      {erroGeral ? <AvisoGestao testId="atividade-erro">{erroGeral}</AvisoGestao> : null}

      {passo === 1 ? (
        <section className="min-w-0" aria-labelledby="assistente-tipo-t">
          <h2 id="assistente-tipo-t" className="text-lg font-semibold text-[var(--mg-text-1,#0f172a)]">
            Que trabalho é este?
          </h2>
          <p className="mb-3 text-[13px] text-[var(--mg-text-2,#475569)]">Escolha um tipo já cadastrado. Toque só uma vez.</p>
          {tiposQuery.isError ? (
            <AvisoGestao testId="assistente-tipos-erro">
              Não foi possível ler os tipos.{" "}
              <button type="button" className="underline" onClick={() => tiposQuery.refetch()}>
                Tentar novamente
              </button>
            </AvisoGestao>
          ) : null}
          {erros.tipo_atividade_id ? <p className="mb-2 text-[13px] text-red-700">{erros.tipo_atividade_id}</p> : null}
          <ul className="flex flex-col gap-2" data-testid="assistente-tipos">
            {tipos.map((t) => {
              const id = String(t.id);
              const on = form.tipo_atividade_id === id;
              return (
                <li key={id}>
                  <button
                    type="button"
                    className={`b1-aba-cartao w-full min-h-[64px] px-3 py-3 text-left ${on ? "ring-2 ring-emerald-600" : ""}`}
                    aria-pressed={on}
                    onClick={() => mudar({ tipo_atividade_id: id }, ["tipo_atividade_id"])}
                    data-testid={`assistente-tipo-${id}`}
                  >
                    <span className="block text-[15px] font-semibold">{String(t.nome_tipo ?? "")}</span>
                    <span className="mt-0.5 block text-[12.5px] text-[var(--mg-text-2,#475569)]">{textoDoQuePodeRegistrar(t)}</span>
                  </button>
                </li>
              );
            })}
          </ul>
          {tiposQuery.isSuccess && tipos.length === 0 ? (
            <AvisoGestao tone="blue" testId="assistente-sem-tipo">
              Nenhum tipo ativo. Cadastre o tipo em Tipos de atividade antes de abrir o trabalho.
            </AvisoGestao>
          ) : null}
        </section>
      ) : null}

      {passo === 2 ? (
        <section className="min-w-0" aria-labelledby="assistente-areas-t">
          <h2 id="assistente-areas-t" className="text-lg font-semibold text-[var(--mg-text-1,#0f172a)]">
            Em quais áreas?
          </h2>
          <p className="mb-3 text-[13px] text-[var(--mg-text-2,#475569)]">Pastos ou lavouras. Marque todas que entram neste trabalho. Nenhuma começa sozinha.</p>
          {areasQuery.isError ? (
            <AvisoGestao testId="assistente-areas-erro">
              Não foi possível ler as áreas.{" "}
              <button type="button" className="underline" onClick={() => areasQuery.refetch()}>
                Tentar novamente
              </button>
            </AvisoGestao>
          ) : null}
          {erros.areas ? (
            <p className="mb-2 text-[13px] text-red-700" data-testid="assistente-areas-erro-texto">
              {erros.areas}
            </p>
          ) : null}
          {grupos.map((g) => (
            <div key={g.id} className="mb-3" data-testid={`assistente-grupo-${g.id}`}>
              <p className="mb-1.5 text-[11px] font-semibold uppercase tracking-wide text-[var(--mg-text-2,#475569)]">{rotuloDoGrupoDeArea(g.id)}</p>
              <ul className="flex flex-col gap-2">
                {g.areas.map((a) => {
                  const id = String(a.id);
                  const on = areasEscolhidas.some((l) => l.area_id === id);
                  return (
                    <li key={id}>
                      <button
                        type="button"
                        className={`b1-aba-cartao flex w-full min-h-[56px] items-center gap-3 px-3 py-2.5 text-left ${on ? "ring-2 ring-emerald-600" : ""}`}
                        aria-pressed={on}
                        onClick={() => setAreasEscolhidas((linhas) => alternarAreaNaAbertura(linhas, a))}
                        data-testid={`assistente-area-${id}`}
                      >
                        <span className="min-w-0 flex-1">
                          <span className="block text-[15px] font-semibold">{rotuloDaArea(a) || id}</span>
                          <span className="block text-[12.5px] text-[var(--mg-text-2,#475569)]">
                            {[a.setor_nome, ha(a)].filter(Boolean).join(" · ")}
                          </span>
                        </span>
                        <span className={`grid h-6 w-6 place-items-center rounded-md border ${on ? "border-emerald-600 bg-emerald-600 text-white" : "border-[var(--mg-divider,#cbd5e1)]"}`} aria-hidden>
                          {on ? <Check className="h-4 w-4" /> : null}
                        </span>
                      </button>
                    </li>
                  );
                })}
              </ul>
            </div>
          ))}
          <p className="text-[13px] font-medium" data-testid="assistente-areas-contagem">
            {areasEscolhidas.length === 0 ? "Nenhuma área marcada" : `${areasEscolhidas.length} ${areasEscolhidas.length === 1 ? "área marcada" : "áreas marcadas"}`}
          </p>
        </section>
      ) : null}

      {passo === 3 ? (
        <section className="min-w-0" aria-labelledby="assistente-confirma-t">
          <h2 id="assistente-confirma-t" className="text-lg font-semibold text-[var(--mg-text-1,#0f172a)]">
            Confira e abra
          </h2>
          <p className="mb-3 text-[13px] text-[var(--mg-text-2,#475569)]">Se estiver certo, toque em Abrir atividade. As áreas não começam sozinhas.</p>
          <form
            className="b1 mg-b1-form-grid"
            data-densidade={DENSIDADE_BASE1}
            data-testid="b1-form-atividade"
            noValidate
            onSubmit={(e) => {
              e.preventDefault();
              void salvar();
            }}
          >
            <CampoTexto
              label="Nome"
              value={form.nome}
              onChange={(v) => {
                nomeEditado.current = true;
                mudar({ nome: v }, ["nome"]);
              }}
              required
              span={12}
              maxLength={MAX_NOME_ATIVIDADE}
              error={erros.nome}
            />
            <CampoDia
              label="Começa em"
              value={form.data_inicio}
              onChange={(v) => {
                inicioEditado.current = true;
                mudar({ data_inicio: v }, ["data_inicio"]);
              }}
              max={hoje || undefined}
              required
              span={12}
              error={erros.data_inicio}
              testId="atividade-data-inicio"
            />
            {exigencias.safra ? (
              <CampoTexto
                label="Safra"
                value={form.safra_ciclo}
                onChange={(v) => mudar({ safra_ciclo: v }, ["safra_ciclo"])}
                required
                span={12}
                maxLength={MAX_SAFRA_ATIVIDADE}
                placeholder="Ex.: 2026/27"
                keepCase
                error={erros.safra_ciclo}
              />
            ) : null}
            {exigencias.maquina ? (
              <SeletorPaginadoGestao
                rotulo="Máquina"
                testId="atividade-maquina"
                chave={[RAIZ_CONSULTAS_ATIVIDADES, "bens", empresaId]}
                buscar={async ({ q, cursor, limit }) => normalizarPaginaDeOpcoes(await listarOpcoesBens({ q, cursor, limit }))}
                value={form.bem}
                onChange={(o) => mudar({ bem: o ? { id: String(o.id), rotulo: rotuloDoBem(o) || String(o.id) } : null }, ["bem"])}
                rotuloDaOpcao={rotuloDoBem}
                detalheDaOpcao={detalheDoBem}
                obrigatorio
                permitirLimpar
                erro={erros.bem}
                span={12}
                maiusculas={false}
              />
            ) : null}
            <div className="col-span-12">
              <p className="text-[13px] font-semibold">Áreas</p>
              <p className="text-[13px] text-[var(--mg-text-2,#475569)]" data-testid="assistente-resumo-areas">
                {areasEscolhidas.length === 0
                  ? "Nenhuma área. Você pode abrir assim e incluir a área depois."
                  : areasEscolhidas
                      .map((l) => rotuloDaArea(areas.find((a) => String(a.id) === l.area_id)) || l.area_id)
                      .join(", ")}
              </p>
              <p className="text-[12.5px] text-[var(--mg-text-2,#475569)]">Nenhuma começa sozinha. Você escolhe quando começar cada uma no campo.</p>
            </div>
            <div className="col-span-12">
              <button type="button" className="text-[13px] font-semibold text-emerald-800 underline" aria-expanded={mais} onClick={() => setMais((v) => !v)} data-testid="assistente-mais">
                {mais ? "Ocultar mais detalhes" : "Mais detalhes"}
              </button>
            </div>
            {mais ? (
              <>
                <SecaoForm titulo="Mais detalhes" />
                {!exigencias.safra ? (
                  <CampoTexto
                    label="Safra"
                    value={form.safra_ciclo}
                    onChange={(v) => mudar({ safra_ciclo: v }, ["safra_ciclo"])}
                    span={12}
                    maxLength={MAX_SAFRA_ATIVIDADE}
                    placeholder="Ex.: 2026/27"
                    keepCase
                    error={erros.safra_ciclo}
                  />
                ) : null}
                {!exigencias.maquina ? (
                  <SeletorPaginadoGestao
                    rotulo="Máquina do cabeçalho"
                    testId="atividade-maquina"
                    chave={[RAIZ_CONSULTAS_ATIVIDADES, "bens", empresaId]}
                    buscar={async ({ q, cursor, limit }) => normalizarPaginaDeOpcoes(await listarOpcoesBens({ q, cursor, limit }))}
                    value={form.bem}
                    onChange={(o) => mudar({ bem: o ? { id: String(o.id), rotulo: rotuloDoBem(o) || String(o.id) } : null }, ["bem"])}
                    rotuloDaOpcao={rotuloDoBem}
                    detalheDaOpcao={detalheDoBem}
                    permitirLimpar
                    erro={erros.bem}
                    span={12}
                    maiusculas={false}
                  />
                ) : null}
                <CampoDia
                  label="Fim previsto"
                  value={form.data_prevista_fim}
                  onChange={(v) => mudar({ data_prevista_fim: v }, ["data_prevista_fim"])}
                  span={12}
                  error={erros.data_prevista_fim}
                  testId="atividade-data-prevista-fim"
                />
                <CampoSelect
                  label="Tarefa de origem"
                  value={form.lancamento_tarefa_id}
                  onChange={(v) => mudar({ lancamento_tarefa_id: v }, ["lancamento_tarefa_id"])}
                  options={opcoesTarefa}
                  placeholder="Sem tarefa de origem"
                  span={12}
                />
                <CampoTexto label="Centro de custo" value={heranca.centro_custo.rotulo || "Sem centro de custo"} onChange={() => {}} readOnly span={12} />
                <CampoTexto label="Centro de resultado" value={heranca.centro_resultado.rotulo || "Sem centro de resultado"} onChange={() => {}} readOnly span={12} />
                <CampoTexto label="Unidade de produção" value={heranca.unidade_producao.rotulo || "Sem unidade de produção"} onChange={() => {}} readOnly span={12} />
                {notasDaHeranca.length ? (
                  <div className="col-span-12">
                    <AvisoGestao tone="blue" testId="atividade-heranca">
                      {notasDaHeranca.map((n) => (
                        <span key={n} className="block">
                          {n}
                        </span>
                      ))}
                    </AvisoGestao>
                  </div>
                ) : null}
                <CampoTextoLongo
                  label="Observação"
                  value={form.observacao}
                  onChange={(v) => mudar({ observacao: v }, ["observacao"])}
                  maxLength={MAX_OBSERVACAO_ATIVIDADE}
                />
              </>
            ) : null}
          </form>
        </section>
      ) : null}

      <div className="mt-4 flex flex-col-reverse gap-2 sm:flex-row sm:justify-between">
        <button type="button" className={BOTAO_VOLTAR} onClick={() => (passo === 1 ? onCancelar() : setPasso(/** @type {1|2|3} */ (passo - 1)))} disabled={enviando}>
          <ArrowLeft className="h-4 w-4" aria-hidden />
          {passo === 1 ? "Cancelar" : "Voltar"}
        </button>
        {passo < 3 ? (
          <button type="button" className={BOTAO} onClick={seguir} data-testid="assistente-continuar">
            Continuar
          </button>
        ) : (
          <button type="button" className={BOTAO} onClick={() => void salvar()} disabled={enviando} data-testid="assistente-abrir">
            {enviando ? "Abrindo…" : "Abrir atividade"}
          </button>
        )}
      </div>
    </div>
  );
}
