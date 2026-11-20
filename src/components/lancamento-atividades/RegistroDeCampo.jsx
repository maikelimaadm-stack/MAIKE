import React, { useEffect, useMemo, useRef, useState } from "react";
import { useQueries, useQuery, useQueryClient } from "@tanstack/react-query";
import { Check, CheckCheck, Loader2 } from "lucide-react";
import B1Janela from "@/components/cadastro/base1/B1Janela";
import { DENSIDADE_BASE1 } from "@/components/cadastro/base1/B1Field";
import { MobileSheetPortalCtx, useCelular } from "@/components/common/MobileSheet";
import { AvisoGestao, CampoSelect, CampoTexto, SecaoForm } from "@/components/gestao/GestaoFormParts";
import { CampoDia } from "@/components/financeiroGestao/CamposLancamento";
import SeletorPaginadoGestao from "@/components/financeiroGestao/SeletorPaginadoGestao";
import { CampoTextoLongo } from "@/components/patrimonio/PatrimonioFormParts";
import { BOTAO_PRIMARIO, BOTAO_SECUNDARIO } from "@/components/patrimonio/DialogosAbastecimento";
import { AvisoEnvioDaLinha, SecoesDoFormularioContext, useEnvioDaLinha } from "@/components/lancamento-atividades/JanelasDaLinha";
import { EditorDaLinhaDoRegistro, SecaoDeLinhasDoRegistro } from "@/components/lancamento-atividades/LinhasDoRegistro";
import AreasDoRegistro from "@/components/lancamento-atividades/AreasDoRegistro";
import { useAcoesTelaAtividades, useEmpresaRealSelecionadaId, useFusoDaFazenda } from "@/hooks/useLancamentoAtividadesSessao";
import { useAuth } from "@/lib/AuthContext";
import { tiposRegistraveisNaArea } from "@/lib/atividadeFluxoCampo";
import { iconeDoTipoAtividade } from "@/lib/iconesTipoAtividade";
import { TIPOS_FIXOS_ATIVIDADE, operacoesDoTipoFixo, tipoFixoDaOperacao } from "@/lib/tiposFixosAtividade";
import { notifySuccess, notifyWarning } from "@/lib/maikeNotify";
import { MAX_OBSERVACAO_ATIVIDADE, mensagemDoAlertaAtividade, rotuloDaArea, rotuloDoUsuario } from "@/lib/lancamentoAtividadesRegras";
import { RAIZ_CONSULTAS_ATIVIDADES, corpoDoApontamento, formularioApontamentoVazio, normalizarPaginaDeOpcoes, validarFormularioApontamento } from "@/lib/atividadeApontamentoRegras";
import {
  campoDaLinhaRecusada,
  chaveLocaisDoProduto,
  ehSaltoDoMedidor,
  formularioMaquinaVazio,
  validarLinhaMaoObra,
  validarLinhaMaquina,
  validarLinhaProduto,
  validarLinhaServico,
} from "@/lib/atividadeLinhasRegras";
import {
  COLECOES_DO_REGISTRO,
  QUERY_ATIVIDADES_DA_AREA,
  areaDaRecusa,
  areaNovaDoRegistro,
  comItem,
  corpoDasAreasDoRegistro,
  destinoDoRegistro,
  erroDaChaveDaLinha,
  errosDasAreasDoRegistro,
  formularioVazioDaSecao,
  itemDaRecusa,
  itensVaziosDoRegistro,
  linhasDoCorpoDoRegistro,
  mensagemDaRecusaDoRegistro,
  temChaveDaLinha,
  totaisDasAreasDoRegistro,
} from "@/lib/registroDeCampoRegras";
import { definirFazendaDaTela, listarAreasDaFazenda, listarOpcoesOperadores, obterResumoDaArea, registrarCampo } from "@/services/lancamentoAtividadesService";
import { CODIGO_ENVIO_PENDENTE, codigoDoServidor, ehResultadoIncerto } from "@/services/operacaoFinanceiraService";

/**
 * D-PROD-254 — o formulário ÚNICO de registrar trabalho de campo, o mesmo nos detalhes da área (Mapa Geral: área presa)
 * e no "Registrar" do Lançamento de Atividades (a pessoa escolhe a área e o tipo). Uma janela Base1 de um nível só
 * (680px no desktop; `b1-janela--tela-cheia` no celular), em grupos (`SecaoForm` + `mg-b1-form-grid`).
 *
 * D-PROD-258 — dois passos: primeiro o TIPO FIXO (os 7 serviços de pasto), depois a OPERAÇÃO (o "tipo de atividade" do
 * cadastro, filtrado pelo tipo escolhido). O servidor segue sendo quem recusa o que a operação não aceitar.
 *
 * D-PROD-262 (fase 2, maquete "Nova realização") — as QUATRO seções (Insumos, Máquinas, Equipe e Serviço de terceiro) são
 * TABELAS, todas opcionais, com até 20 itens cada (o máximo do servidor). "+ Incluir …" abre um editor DENTRO da seção (um
 * por seção, sem segunda janela) com os MESMOS campos das janelas da linha (`JanelasDaLinha`: máquina com implemento e
 * medidor, produto com saldo e dose/ha, mão de obra, serviço); "Incluir" valida com a regra da linha e o item vira linha da
 * tabela; clicar na linha a abre de novo ("Atualizar"). A máquina guarda o medidor e a decisão da justificativa do
 * "Incluir"; o insumo recalcula a dose/ha pelos hectares de agora. Salvar com um editor preenchido inclui o item antes; o
 * editor vazio não conta. A recusa do servidor (`linha_indice`/`indice` = a posição no array enviado) fica na linha da
 * tabela e abre o editor nela, com o campo apontado. Nenhuma regra de negócio é copiada. Hectares feitos e operador são do
 * dia; a observação fica em "Informações complementares".
 *
 * Um envio só (`POST /atividades/registrar`, via `registrarCampo`): o servidor acha a atividade ABERTA do tipo que já tem a
 * área no mês — ou abre uma — e grava o registro do dia com as linhas numa transação. O cliente nunca encadeia chamadas.
 *
 * D-PROD-263 (fase 3) — VÁRIAS ÁREAS num registro (maquete "Nova realização"): o campo "Áreas" (busca + caixas) e a tabela
 * Área · Tamanho · % · Hectares · ✕ com o Total (`AreasDoRegistro`). O corpo leva `areas: [{ area_id, hectares }]` (os
 * hectares de cada área; "Hectares feitos" saiu de "Resultado") e as linhas com os TOTAIS do dia: o servidor reparte cada
 * linha pelos hectares e grava um apontamento por área, numa atividade só. A dose/ha e o total dos insumos usam os
 * hectares TOTAIS. A área presa (Detalhes da área) vem marcada e não sai; outras podem entrar. A recusa de uma área
 * (`details.area_indice`) diz qual, na linha certa (a posição da linha no corpo) ou na própria área.
 *
 * @param {{
 *   tipo?: any | null,
 *   tipos?: any[],   // as operações (tipos de atividade) ativas
 *   area?: any | null,
 *   areas?: any[],
 *   onFechar: () => void,
 *   onGravou?: (resposta: any) => void,
 * }} props `area` presa (detalhes da área, Manejos: vem marcada e não sai); `tipo` (operação) preso só se alguém precisar;
 *   sem eles, a pessoa escolhe entre os 7 tipos fixos, as operações de `tipos` e as `areas` (sem `areas`, a janela lê as
 *   áreas ativas da fazenda).
 */
export default function JanelaRegistroDeCampo({ tipo: tipoPreso = null, tipos: todosOsTipos = [], area: areaPreso = null, areas: areasDoPai = [], onFechar, onGravou = undefined }) {
  const queryClient = useQueryClient();
  // Abastecimento é da máquina (emenda 1): nunca é tipo de registro de campo.
  const tipos = useMemo(() => tiposRegistraveisNaArea(todosOsTipos), [todosOsTipos]);
  const empresaId = useEmpresaRealSelecionadaId();
  // O service injeta a fazenda (a tela de Atividades faz o mesmo; no mapa é aqui).
  definirFazendaDaTela(empresaId);
  const acoes = useAcoesTelaAtividades();
  const { fuso, hoje } = useFusoDaFazenda(empresaId);
  const { clienteId } = useAuth();
  const celular = useCelular();
  const escopo = `${clienteId || "sem-tenant"}:${acoes?.login || "sem-login"}`;

  // ─── Tipo e áreas (presos ou escolhidos) ─────────────────────────────
  const [tipoFixo, setTipoFixo] = useState(() => (tipoPreso ? tipoFixoDaOperacao(tipoPreso) : ""));
  const [tipoEscolhido, setTipoEscolhido] = useState("");
  const operacoes = useMemo(() => operacoesDoTipoFixo(tipos, tipoFixo), [tipos, tipoFixo]);
  const tipo = tipoPreso ?? operacoes.find((t) => String(t.id) === tipoEscolhido) ?? null;
  // D-PROD-263: as áreas da fazenda para marcar (as do pai; sem elas — o mapa —, as ativas lidas aqui), com a presa.
  const areasLidas = useQuery({
    queryKey: [RAIZ_CONSULTAS_ATIVIDADES, "areas", empresaId],
    queryFn: () => listarAreasDaFazenda(),
    enabled: Boolean(empresaId) && acoes?.ver === true && !areasDoPai.length,
    staleTime: 30 * 1000,
  });
  const areasDoMapa = useMemo(() => {
    const base = areasDoPai.length ? areasDoPai : (/** @type {any[]} */ (Array.isArray(areasLidas.data) ? areasLidas.data : [])).filter((a) => a?.tipo_cultura !== "Infraestrutura");
    return areaPreso?.id && !base.some((a) => String(a?.id) === String(areaPreso.id)) ? [areaPreso, ...base] : base;
  }, [areasDoPai, areasLidas.data, areaPreso]);
  const [areasDoRegistro, setAreasDoRegistro] = useState(
    /** @returns {import("@/lib/registroDeCampoRegras").AreaDoRegistro[]} */ () => (areaPreso?.id ? [areaNovaDoRegistro(areaPreso)] : []),
  );
  /** A área do mapa pelo id. @param {string} id */
  const areaDe = (id) => areasDoMapa.find((a) => String(a?.id) === String(id)) ?? null;
  // D-PROD-258: as quatro seções são sempre oferecidas. Só as chaves que EXIGEM dado (operação antiga) ainda valem.
  const flags = {
    exigeMaquina: tipo?.exige_maquina === true,
    exigeSafra: tipo?.exige_safra === true,
    permiteImplemento: true,
  };

  // ─── O dia: hoje na fazenda por padrão, nunca depois ──────────────────
  const [dia, setDia] = useState(hoje || "");
  const diaMexido = useRef(false);
  useEffect(() => {
    if (!diaMexido.current && hoje) setDia(hoje);
  }, [hoje]);

  // ─── O dia e as linhas (D-PROD-262: itens das tabelas e um editor por seção) ─
  const [operador, setOperador] = useState(/** @type {{ id: string, rotulo: string } | null} */ (null));
  const [observacao, setObservacao] = useState("");
  const [safra, setSafra] = useState("");
  const [erros, setErros] = useState(/** @type {Record<string, string>} */ ({}));
  const [itens, setItens] = useState(itensVaziosDoRegistro);
  const [editores, setEditores] = useState(editoresFechados);
  /** A recusa do servidor em cada item (chave → mensagem), mostrada embaixo da linha da tabela. */
  const [errosDasLinhas, setErrosDasLinhas] = useState(/** @type {Record<string, string>} */ ({}));
  const [alvoFolha, setAlvoFolha] = useState(/** @type {HTMLElement | null} */ (null));
  const fecharDepois = useRef(true);
  const [chaveForm, setChaveForm] = useState(0);
  /** O que cada editor aberto leu (medidor, saldo), pelo `id` da abertura: um editor velho nunca vale para o novo. */
  const lidoNosEditores = useRef(/** @type {Partial<Record<ColecaoDoRegistro, LidoNoEditor>>} */ ({}));
  const ultimaAbertura = useRef(0);
  const ultimoItem = useRef(0);
  // A dose/ha dos insumos: os hectares TOTAIS do registro (sem nenhum válido, o tamanho somado das áreas).
  const totaisDasAreas = totaisDasAreasDoRegistro(areasDoRegistro, areasDoMapa);
  const areaDoDia = totaisDasAreas.hectares ?? totaisDasAreas.tamanho;

  /** @param {string[]} campos */
  const limparErros = (campos) => setErros((e) => semCampos(e, campos));
  /** A pessoa mexeu no conteúdo do registro: o próximo envio é o conteúdo NOVO e o aviso de recusa sai. */
  const mexeu = () => {
    esquecerUltimo();
    setEstado((e) => (e.fase === "erro" ? { fase: "pronto" } : e));
  };

  /** Abre o editor da seção: vazio (item novo) ou com um item da tabela, já com os erros apontados. @param {ColecaoDoRegistro} colecao @param {ItemDoRegistro|null} [item] @param {Record<string, string>} [errosDoCampo] */
  const abrirEditor = (colecao, item = null, errosDoCampo = {}) => {
    ultimaAbertura.current += 1;
    const id = ultimaAbertura.current;
    setEditores((e) => ({ ...e, [colecao]: { id, chave: item?.chave ?? null, form: item ? item.form : formularioVazioDaSecao(colecao), erros: errosDoCampo, saltoPedido: item?.saltoPedido === true } }));
  };
  /** @param {ColecaoDoRegistro} colecao */
  const fecharEditor = (colecao) => setEditores((e) => ({ ...e, [colecao]: null }));
  /** Um campo do editor mudou (o mesmo `mudar` das janelas da linha). @param {ColecaoDoRegistro} colecao */
  const mudarNoEditor = (colecao) => (/** @type {Record<string, any>} */ mudanca, /** @type {string[]} */ campos) => {
    setEditores((e) => {
      const ed = e[colecao];
      if (!ed) return e;
      // Trocar a máquina esquece a justificativa que o servidor pediu para a anterior.
      return { ...e, [colecao]: { ...ed, form: { ...ed.form, ...mudanca }, erros: semCampos(ed.erros, campos), saltoPedido: campos.includes("bem") ? false : ed.saltoPedido } };
    });
    mexeu();
  };
  /** O que os ganchos do medidor e do saldo escrevem no formulário do editor (só o da mesma abertura). @param {ColecaoDoRegistro} colecao @param {number} id */
  const setFormDoEditor = (colecao, id) => (/** @type {(f: any) => any} */ f) =>
    setEditores((e) => {
      const ed = e[colecao];
      return ed && ed.id === id ? { ...e, [colecao]: { ...ed, form: f(ed.form) } } : e;
    });

  /**
   * Confere o editor da seção: com o campo-chave escolhido, valida com a regra da linha e com o que o editor leu (o medidor
   * da máquina, o saldo do insumo) e devolve o item; sem ele, nada (o editor vazio não conta).
   * @param {ColecaoDoRegistro} colecao @param {EditorDaSecao} ed
   * @returns {{ item: ItemDoRegistro|null, erros: Record<string, string>|null }}
   */
  const avaliarEditor = (colecao, ed) => {
    if (!temChaveDaLinha(colecao, ed.form)) return { item: null, erros: null };
    const lido = lidoNosEditores.current[colecao]?.id === ed.id ? lidoNosEditores.current[colecao] : null;
    const novaChave = () => {
      ultimoItem.current += 1;
      return `${colecao}-${ultimoItem.current}`;
    };
    /** @param {Record<string, string>} e @param {() => ItemDoRegistro} item */
    const resultado = (e, item) => (Object.keys(e).length ? { item: null, erros: e } : { item: item(), erros: null });
    if (colecao === "maquinas") {
      const medidor = lido?.medidor ?? null;
      if (!medidor) return { item: null, erros: { bem: "Aguarde a leitura do medidor da máquina." } };
      const pede = lido?.pedeJustificativa === true;
      const e = validarLinhaMaquina(ed.form, { medidor, permiteImplemento: flags.permiteImplemento, pedeJustificativa: pede });
      return resultado(e, () => ({ chave: ed.chave ?? novaChave(), form: ed.form, medidor, comJustificativa: pede, saltoPedido: ed.saltoPedido }));
    }
    if (colecao === "produtos") {
      const { erros: e } = validarLinhaProduto(ed.form, { disponivel: lido?.disponivel ?? null });
      return resultado(e, () => ({ chave: ed.chave ?? novaChave(), form: ed.form, localNome: lido?.localNome ?? null }));
    }
    const e = colecao === "mao_obra" ? validarLinhaMaoObra(ed.form) : validarLinhaServico(ed.form);
    return resultado(e, () => ({ chave: ed.chave ?? novaChave(), form: ed.form }));
  };

  /** "Incluir" / "Atualizar" do editor: o item entra na tabela (ou é trocado no lugar) e o editor fecha. @param {ColecaoDoRegistro} colecao */
  const incluirDoEditor = (colecao) => {
    const ed = editores[colecao];
    if (!ed) return;
    const r = avaliarEditor(colecao, ed);
    if (!r.item) {
      // Sem o campo-chave, "Incluir" aponta só ele ("Escolha a máquina.", …).
      const errosDoEditor = r.erros ?? erroDaChaveDaLinha(colecao, ed.form);
      setEditores((e) => {
        const atual = e[colecao];
        return atual && atual.id === ed.id ? { ...e, [colecao]: { ...atual, erros: errosDoEditor } } : e;
      });
      return;
    }
    const item = r.item;
    setItens((x) => ({ ...x, [colecao]: comItem(x[colecao], item) }));
    setErrosDasLinhas((x) => semCampos(x, [item.chave]));
    fecharEditor(colecao);
    mexeu();
  };

  /** ✕ da linha: o item sai da tabela (e o editor fecha, se era ele). @param {ColecaoDoRegistro} colecao @param {ItemDoRegistro} item */
  const removerItem = (colecao, item) => {
    setItens((x) => ({ ...x, [colecao]: x[colecao].filter((i) => i.chave !== item.chave) }));
    setErrosDasLinhas((x) => semCampos(x, [item.chave]));
    setEditores((e) => (e[colecao]?.chave === item.chave ? { ...e, [colecao]: null } : e));
    mexeu();
  };

  // ─── Onde o registro entra (só leitura: quem decide é o servidor) ─────
  const resumos = useQueries({
    queries: areasDoRegistro.map((l) => ({
      queryKey: [QUERY_ATIVIDADES_DA_AREA, "resumo", empresaId, l.area_id],
      queryFn: () => obterResumoDaArea(String(l.area_id)),
      enabled: Boolean(empresaId && acoes?.ver),
      staleTime: 15 * 1000,
    })),
  });
  const destino = destinoDoRegistro({
    tipo,
    areas: areasDoRegistro.map((l) => ({ id: l.area_id, nome: areaDe(l.area_id)?.nome ?? "" })),
    dia,
    resumos: resumos.map((r) => (r.isSuccess ? r.data : null)),
  });

  // ─── Envio ───────────────────────────────────────────────────────────
  /** O envio que saiu por último: o corpo e os itens na ordem de cada array (a recusa aponta a posição neles). */
  const enviado = useRef(/** @type {EnvioDoRegistro | null} */ (null));
  const { estado, setEstado, disparar, esquecerUltimo } = useEnvioDaLinha(
    (/** @type {EnvioDoRegistro} */ envio, /** @type {{ retentativa: boolean }} */ o) => {
      // A retentativa reenvia o MESMO envio (corpo e itens) do envio sem resposta.
      enviado.current = envio;
      return registrarCampo(envio.corpo, { escopo, retentativa: o.retentativa });
    },
    (e) => mensagemDoEnvio(e),
  );
  const enviando = estado.fase === "enviando";

  /**
   * A frase da recusa do servidor; com várias áreas, a recusa de UMA delas diz qual ("Na área …: …").
   * @param {unknown} erro
   */
  const mensagemDoEnvio = (erro) => {
    const base = mensagemDaRecusaDoRegistro(erro, itemDaRecusa(erro, enviado.current?.linhas));
    const enviadas = enviado.current?.corpo?.areas;
    const daArea = areaDaRecusa(erro, enviadas);
    const nome = daArea ? rotuloDaArea(areaDe(daArea.area_id)) : "";
    return daArea && nome && Array.isArray(enviadas) && enviadas.length > 1 ? `Na área ${nome}: ${base}` : base;
  };

  /**
   * Valida o dia e os editores abertos e devolve o envio (ou null, com os erros nos campos). O editor com o campo-chave
   * escolhido entra sozinho na tabela (ou mostra os erros e nada sai); o vazio não conta.
   * @returns {EnvioDoRegistro | null}
   */
  const montarEnvio = () => {
    /** @type {Record<string, string>} */
    const e = {};
    if (!tipoFixo) e.tipoFixo = "Escolha o tipo.";
    if (!tipo?.id) e.tipo = "Escolha a operação.";
    Object.assign(e, errosDasAreasDoRegistro(areasDoRegistro));
    // Os hectares são de cada área (`areas[]`): o dia não leva `area_executada_dia`.
    const doDia = { ...formularioApontamentoVazio(dia), operador, area_executada_dia: "", observacao };
    const vDia = validarFormularioApontamento(doDia, { hoje });
    Object.assign(e, vDia);
    if (flags.exigeSafra && !safra.trim()) e.safra = "Informe a safra / ciclo (o tipo exige).";
    let falhou = Object.keys(e).length > 0;
    let finais = itens;
    const novosEditores = { ...editores };
    for (const colecao of COLECOES_DO_REGISTRO) {
      const ed = editores[colecao];
      if (!ed) continue;
      const r = avaliarEditor(colecao, ed);
      if (r.item) {
        finais = { ...finais, [colecao]: comItem(finais[colecao], r.item) };
        novosEditores[colecao] = null;
      } else if (r.erros) {
        novosEditores[colecao] = { ...ed, erros: r.erros };
        falhou = true;
      }
    }
    // Operação antiga que exige máquina: pelo menos uma máquina na tabela (o editor da máquina abre apontando o campo).
    if (flags.exigeMaquina && !finais.maquinas.length) {
      const ed = novosEditores.maquinas;
      if (!ed) {
        ultimaAbertura.current += 1;
        novosEditores.maquinas = { id: ultimaAbertura.current, chave: null, form: formularioMaquinaVazio(), erros: erroDaChaveDaLinha("maquinas", formularioMaquinaVazio()), saltoPedido: false };
      } else if (!Object.keys(ed.erros).length) novosEditores.maquinas = { ...ed, erros: erroDaChaveDaLinha("maquinas", ed.form) };
      falhou = true;
    }
    setErros(e);
    if (finais !== itens) setItens(finais);
    setEditores(novosEditores);
    if (falhou) return null;
    const apontamento = Object.fromEntries(
      Object.entries(corpoDoApontamento(doDia)).filter(([k, v]) => k !== "atividade_area_id" && k !== "turno" && k !== "area_executada_dia" && v !== null && v !== ""),
    );
    return {
      corpo: {
        ...apontamento,
        areas: corpoDasAreasDoRegistro(areasDoRegistro),
        tipo_atividade_id: String(tipo.id),
        ...(flags.exigeSafra ? { safra_ciclo: safra.trim() } : {}),
        ...linhasDoCorpoDoRegistro(finais),
      },
      linhas: finais,
    };
  };

  const limparFormulario = () => {
    setItens(itensVaziosDoRegistro());
    setEditores(editoresFechados());
    setErrosDasLinhas({});
    lidoNosEditores.current = {};
    // As áreas ficam; os hectares voltam a 100% do tamanho.
    setAreasDoRegistro((ls) => ls.map((l) => (areaDe(l.area_id) ? areaNovaDoRegistro(areaDe(l.area_id)) : l)));
    setOperador(null);
    setObservacao("");
    setErros({});
    setChaveForm((k) => k + 1);
  };

  const salvar = async (/** @type {boolean} */ fechar) => {
    if (enviando) return;
    fecharDepois.current = fechar;
    const envio = montarEnvio();
    if (!envio) {
      notifyWarning("Atenção", "Revise os campos destacados.");
      return;
    }
    setErrosDasLinhas({});
    const r = await disparar(envio);
    if (!r) return;
    if (r.ok) {
      const resposta = r.resposta;
      queryClient.invalidateQueries({ queryKey: [RAIZ_CONSULTAS_ATIVIDADES] });
      queryClient.invalidateQueries({ queryKey: [QUERY_ATIVIDADES_DA_AREA] });
      const enviadas = envio.corpo.areas;
      notifySuccess("Sucesso", `${tipo.nome_tipo} registrada em ${enviadas.length === 1 ? areaDe(enviadas[0].area_id)?.nome ?? "1 área" : `${enviadas.length} áreas`}.`);
      const alerta = Array.isArray(resposta?.alertas) ? resposta.alertas[0] : null;
      if (alerta) notifyWarning("Atenção", mensagemDoAlertaAtividade(alerta));
      onGravou?.(resposta);
      if (fecharDepois.current) onFechar();
      else limparFormulario();
      return;
    }
    const erro = r.erro;
    // A recusa que aponta um item (a posição no array enviado) vai para a linha dele, e o editor abre nela com o campo.
    const alvo = itemDaRecusa(erro, enviado.current?.linhas);
    const mensagem = mensagemDoEnvio(erro);
    // D-PROD-263: a recusa de uma área que não aponta linha nenhuma fica embaixo da área, na tabela das áreas.
    const daArea = areaDaRecusa(erro, enviado.current?.corpo?.areas);
    if (daArea && !alvo) setErros((x) => ({ ...x, [`area:${daArea.area_id}`]: mensagem }));
    if (alvo) {
      const campo = campoDaLinhaRecusada(erro);
      const item = ehSaltoDoMedidor(erro) ? { ...alvo.item, saltoPedido: true } : alvo.item;
      if (item !== alvo.item) setItens((x) => ({ ...x, [alvo.colecao]: comItem(x[alvo.colecao], item) }));
      setErrosDasLinhas((x) => ({ ...x, [item.chave]: mensagem }));
      abrirEditor(alvo.colecao, item, campo ? { [campo]: mensagem } : {});
    }
    if (codigoDoServidor(erro) === "ESTOQUE_SALDO_INSUFICIENTE") {
      const produtoId = alvo?.colecao === "produtos" ? alvo.item.form?.produto?.id ?? null : null;
      void queryClient.invalidateQueries({ queryKey: produtoId ? chaveLocaisDoProduto(empresaId, produtoId) : [RAIZ_CONSULTAS_ATIVIDADES, "locais"] });
    }
    if (!ehResultadoIncerto(erro) && /** @type {any} */ (erro)?.code !== CODIGO_ENVIO_PENDENTE) notifyWarning("Atenção", mensagem);
  };

  /** "Consultar" depois de um envio sem resposta: o Histórico da área mostra se o registro entrou. */
  const consultar = () => {
    queryClient.invalidateQueries({ queryKey: [RAIZ_CONSULTAS_ATIVIDADES] });
    queryClient.invalidateQueries({ queryKey: [QUERY_ATIVIDADES_DA_AREA] });
    setEstado((e) => ({ ...e, consulta: "Confira o Histórico da área: se o registro não aparecer, repita o mesmo envio — ele não será duplicado." }));
  };

  // ─── Corpo ───────────────────────────────────────────────────────────
  const Icone = iconeDoTipoAtividade(tipo);
  const titulo = tipo ? (
    <span className="b1-tipo-titulo">
      <span className="b1-tipo-titulo__icone" aria-hidden>
        <Icone size={16} strokeWidth={1.75} />
      </span>
      {tipo.nome_tipo}
    </span>
  ) : (
    "Registrar serviço"
  );
  const podeGravar = acoes?.lancarApontamento === true && Boolean(empresaId) && Boolean(fuso);
  const avisoStatus = !acoes?.carregando && acoes?.lancarApontamento !== true
    ? "Sem permissão para registrar atividades."
    : empresaId && !fuso
      ? "Configure o fuso horário da fazenda (Empresa → Fuso horário) antes de registrar: o servidor recusa sem ele."
      : null;

  const form = (
    <form
      key={chaveForm}
      id="formulario-registro-de-campo"
      onSubmit={(e) => {
        e.preventDefault();
        void salvar(true);
      }}
      className="b1 mg-b1-form-grid b1-form-embutido"
      data-densidade={DENSIDADE_BASE1}
      noValidate
      data-testid="registro-de-campo-form"
    >
      <SecoesDoFormularioContext.Provider value={{ topo: null, opcional: true }}>
        <SecaoForm titulo="Registro" />
        {tipoPreso ? null : (
          <>
            <CampoSelect
              label="Tipo"
              value={tipoFixo}
              onChange={(v) => {
                setTipoFixo(v);
                setTipoEscolhido("");
                esquecerUltimo();
                limparErros(["tipoFixo", "tipo"]);
              }}
              options={TIPOS_FIXOS_ATIVIDADE.map((t) => ({ value: t.value, label: t.label }))}
              placeholder="Escolha o tipo"
              required
              span={3}
              error={erros.tipoFixo}
            />
            <CampoSelect
              label="Operação"
              value={tipoEscolhido}
              onChange={(v) => {
                setTipoEscolhido(v);
                esquecerUltimo();
                limparErros(["tipo"]);
              }}
              options={operacoes.map((t) => ({ value: String(t.id), label: t.nome_tipo }))}
              placeholder={!tipoFixo ? "Escolha o tipo primeiro" : operacoes.length ? "Escolha a operação" : "Nenhuma operação neste tipo"}
              readOnly={!tipoFixo || enviando}
              required
              span={6}
              error={erros.tipo}
            />
            {tipoFixo && !operacoes.length ? (
              <p className="col-span-12 min-w-0 break-words text-[12px] text-[var(--mg-text-2,#475569)]" data-testid="registro-de-campo-sem-operacao">
                Nenhuma operação ativa neste tipo. Cadastre em Tipos de Atividade.
              </p>
            ) : null}
          </>
        )}
        <CampoDia
          label="Data"
          value={dia}
          onChange={(v) => {
            if (!v || (hoje && v > hoje)) return;
            diaMexido.current = true;
            setDia(v);
            esquecerUltimo();
            limparErros(["data_operacional"]);
          }}
          max={hoje || undefined}
          required
          span={3}
          error={erros.data_operacional}
          testId="registro-de-campo-data"
        />
        {flags.exigeSafra ? (
          <CampoTexto label="Safra / ciclo" value={safra} onChange={(v) => { setSafra(v); esquecerUltimo(); limparErros(["safra"]); }} required span={6} maxLength={32} keepCase error={erros.safra} />
        ) : null}
        <AreasDoRegistro
          areasDoMapa={areasDoMapa}
          linhas={areasDoRegistro}
          onChange={(ls) => {
            setAreasDoRegistro(ls);
            mexeu();
            setErros((e) => Object.fromEntries(Object.entries(e).filter(([k]) => k !== "areas" && !k.startsWith("area:") && !k.startsWith("pct:"))));
          }}
          erros={erros}
          travada={areaPreso?.id ? String(areaPreso.id) : null}
          celular={celular}
          readOnly={enviando}
          carregando={!areasDoPai.length && areasLidas.isLoading}
        />
        {destino ? (
          <p className="col-span-12 min-w-0 break-words text-[12px] text-[var(--mg-text-2,#475569)]" data-testid="registro-de-campo-destino">
            {destino}
          </p>
        ) : null}

        {COLECOES_DO_REGISTRO.map((colecao) => {
          const editor = editores[colecao];
          const lista = itens[colecao];
          return (
            <SecaoDeLinhasDoRegistro
              key={colecao}
              colecao={colecao}
              itens={lista}
              editor={editor}
              editorPreenchido={Boolean(editor && temChaveDaLinha(colecao, editor.form))}
              areaDoDia={areaDoDia}
              celular={celular}
              bloqueado={enviando}
              errosDasLinhas={errosDasLinhas}
              onNovo={() => abrirEditor(colecao)}
              onAbrir={(item) => abrirEditor(colecao, item)}
              onRemover={(item) => removerItem(colecao, item)}
              editorAberto={
                editor ? (
                  <EditorDaLinhaDoRegistro
                    key={editor.id}
                    colecao={colecao}
                    editor={editor}
                    numero={editor.chave ? lista.findIndex((i) => i.chave === editor.chave) + 1 : 0}
                    mudar={mudarNoEditor(colecao)}
                    setForm={setFormDoEditor(colecao, editor.id)}
                    onLido={(lido) => {
                      lidoNosEditores.current[colecao] = lido;
                    }}
                    areaDoDia={areaDoDia}
                    dia={dia || null}
                    permiteImplemento={flags.permiteImplemento}
                    bloqueado={enviando}
                    onIncluir={() => incluirDoEditor(colecao)}
                    onCancelar={() => fecharEditor(colecao)}
                  />
                ) : null
              }
            />
          );
        })}

        <SecaoForm titulo="Resultado" />
        <SeletorPaginadoGestao
          rotulo="Operador"
          testId="registro-de-campo-operador"
          chave={[RAIZ_CONSULTAS_ATIVIDADES, "operadores", empresaId]}
          buscar={async ({ q, cursor, limit }) => normalizarPaginaDeOpcoes(await listarOpcoesOperadores({ q, cursor, limit }))}
          value={operador}
          onChange={(o) => {
            setOperador(o ? { id: String(o.id), rotulo: rotuloDoUsuario(o) || String(o.id) } : null);
            esquecerUltimo();
          }}
          rotuloDaOpcao={rotuloDoUsuario}
          readOnly={enviando}
          permitirLimpar
          span={6}
          maiusculas={false}
        />
        <SecaoForm titulo="Informações complementares" />
        <CampoTextoLongo label="Observação" value={observacao} onChange={(v) => { setObservacao(v); esquecerUltimo(); }} readOnly={enviando} maxLength={MAX_OBSERVACAO_ATIVIDADE} />
        <div className="col-span-12 min-w-0">
          <AvisoEnvioDaLinha estado={estado} produto={false} lancado="o registro PODE ter sido gravado" onRepetir={() => void salvar(true)} onConsultar={consultar} />
        </div>
      </SecoesDoFormularioContext.Provider>
    </form>
  );

  const podeEnviar = podeGravar && Boolean(tipo?.id) && areasDoRegistro.length > 0 && !enviando;
  return (
    <B1Janela
      aberto
      onFechar={onFechar}
      podeFechar={!enviando}
      aoPedirFechar={() => !alvoFolha?.querySelector(".mk-sheet-root")}
      titulo={titulo}
      testId="janela-registro-de-campo"
      className={celular ? "b1-janela--tela-cheia" : ""}
      contentProps={{ "data-permissao-explicita": "", "data-celular": celular ? "" : undefined, className: celular ? "b1-janela__camada--tela-cheia" : undefined }}
      fora={<div ref={setAlvoFolha} className="contents" />}
      rodape={
        <>
          <button type="button" className={BOTAO_SECUNDARIO} onClick={onFechar} disabled={enviando} data-testid="registro-de-campo-cancelar">
            Cancelar
          </button>
          <button type="button" className={BOTAO_PRIMARIO} onClick={() => void salvar(true)} disabled={!podeEnviar} data-testid="registro-de-campo-salvar">
            {enviando ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <Check className="h-4 w-4" aria-hidden />}
            {enviando ? "Salvando…" : estado.fase === "incerto" ? "Repetir o mesmo envio" : "Salvar"}
          </button>
          <button type="button" className={BOTAO_PRIMARIO} onClick={() => void salvar(false)} disabled={!podeEnviar} data-testid="registro-de-campo-salvar-novo">
            <CheckCheck className="h-4 w-4" aria-hidden />
            Salvar e novo
          </button>
        </>
      }
    >
      <MobileSheetPortalCtx.Provider value={alvoFolha}>
        {avisoStatus ? <AvisoGestao testId="registro-de-campo-aviso">{avisoStatus}</AvisoGestao> : null}
        {form}
      </MobileSheetPortalCtx.Provider>
    </B1Janela>
  );
}

/**
 * @typedef {import("@/lib/registroDeCampoRegras").ColecaoDoRegistro} ColecaoDoRegistro
 * @typedef {import("@/lib/registroDeCampoRegras").ItemDoRegistro} ItemDoRegistro
 * @typedef {import("@/lib/registroDeCampoRegras").ItensDoRegistro} ItensDoRegistro
 * @typedef {import("@/components/lancamento-atividades/LinhasDoRegistro").EditorDaSecao} EditorDaSecao
 * @typedef {import("@/components/lancamento-atividades/LinhasDoRegistro").LidoNoEditor} LidoNoEditor
 * @typedef {{ corpo: Record<string, any>, linhas: ItensDoRegistro }} EnvioDoRegistro
 *   O que sai num envio: o corpo de `POST /atividades/registrar` e os itens de cada seção na ordem do array enviado.
 */

/** Nenhum editor aberto. @returns {Record<ColecaoDoRegistro, EditorDaSecao | null>} */
function editoresFechados() {
  return { produtos: null, maquinas: null, mao_obra: null, servicos: null };
}

/** O objeto sem as chaves dadas (o mesmo, se nenhuma estava lá). @param {Record<string, string>} objeto @param {string[]} chaves */
function semCampos(objeto, chaves) {
  return chaves.some((c) => objeto[c]) ? Object.fromEntries(Object.entries(objeto).filter(([k]) => !chaves.includes(k))) : objeto;
}
