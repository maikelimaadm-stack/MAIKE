import React, { useEffect, useMemo, useRef, useState } from "react";
import { useQueries, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowLeftRight, Check, CheckCheck, Loader2 } from "lucide-react";
import B1Janela from "@/components/cadastro/base1/B1Janela";
import { DENSIDADE_BASE1 } from "@/components/cadastro/base1/B1Field";
import { MobileSheetPortalCtx, useCelular } from "@/components/common/MobileSheet";
import { AvisoGestao, CampoSelect, CampoTexto, SecaoForm } from "@/components/gestao/GestaoFormParts";
import { CampoDia, ValorCalculado } from "@/components/financeiroGestao/CamposLancamento";
import { B1ChaveRow } from "@/components/cadastro/base1/Base1Ui";
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
import { TIPOS_FIXOS_ATIVIDADE, operacoesDoTipoFixo, rotuloDoTipoFixo, tipoFixoDaOperacao } from "@/lib/tiposFixosAtividade";
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
  atividadeDoRegistro,
  areaDaRecusa,
  areaNovaDoRegistro,
  comItem,
  corpoDasAreasDoRegistro,
  destinoDoRegistro,
  destinoSemArea,
  erroDaChaveDaLinha,
  erroDaDataDeTermino,
  errosDasAreasDoRegistro,
  formularioVazioDaSecao,
  itemDaRecusa,
  itensVaziosDoRegistro,
  linhasDoCorpoDoRegistro,
  mensagemDaRecusaDoRegistro,
  tamanhoDaArea,
  temChaveDaLinha,
  totaisDasAreasDoRegistro,
} from "@/lib/registroDeCampoRegras";
import { somar } from "@/lib/dinheiroDecimal";
import {
  CODIGO_SERVICO_PARADO,
  diaCurto,
  hectaresDepoisDoRegistro,
  preenchimentoDoLancarDia,
  resumoAntesDeSalvar,
  situacaoDepoisDeSalvar,
  textoDoDiaDoRegistro,
} from "@/lib/servicoVariosDias";
import {
  definirFazendaDaTela,
  listarApontamentos,
  listarAreasDaFazenda,
  listarAtividades,
  listarOpcoesOperadores,
  obterResumoDaArea,
  registrarCampo,
} from "@/services/lancamentoAtividadesService";
import { listarCulturas } from "@/services/culturaCadastroService";
import {
  FORMAS_PLANTIO,
  UNIDADES_FEITAS,
  camposDoServico,
  camposDoTipo,
  capinsDoCadastro,
  consorciosDoCadastro,
  corpoDoPlantio,
  dicaDaCultura,
  diaPorExtenso,
  lerVc,
  localDoTexto,
  pastoLiberadoEm,
  rotuloDaUnidadeFeita,
  safraDoDia,
} from "@/lib/camposPorTipo";
import { CODIGO_ENVIO_PENDENTE, codigoDoServidor, ehResultadoIncerto } from "@/services/operacaoFinanceiraService";
import { NAO_FAZ_PARTE, fazParteDe, reformasDoRegistro } from "@/lib/reformaRegras";

/** D-PROD-274 — a linha de ajuda embaixo do campo ("preenchida pela data", "opcional", "vem do cadastro da operação"). */
const NOTA_DO_CAMPO = "mt-1 min-w-0 break-words px-1 text-[12px] text-[var(--mg-text-2,#475569)]";

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
 * D-PROD-265 (maquete "Nova realização de <Tipo>") — DOIS PASSOS na mesma janela: (1) "Nova realização" mostra os 7 tipos
 * fixos em CARTÕES (ícone + nome; botões, Enter/clique escolhe); (2) o formulário "Nova realização de <Tipo>", com
 * "Trocar tipo" ao lado do título (volta aos cartões; áreas, datas e linhas ficam, só a operação sai — ela é do tipo). Sem
 * o select de Tipo no corpo. Seções, nesta ordem: Área, Operação, Datas (Data de início = `data_operacional`; Data de
 * término opcional, `data_termino`, só vai no corpo preenchida), Insumos, Máquinas, Equipe, Serviço de terceiro,
 * Planejamento (só leitura: onde o registro entra) e Informações complementares (Operador e Observação). Com `tipo`
 * preso, a janela abre direto no formulário, sem "Trocar tipo".
 *
 * D-PROD-267 (serviço de vários dias) — `continuar` (a linha do serviço na lista, com o `andamento`): o "+ Lançar dia". A
 * janela abre direto no formulário do tipo do serviço, com a operação dele, as áreas em aberto (os hectares de hoje
 * vazios), as máquinas com o implemento e a equipe do ÚLTIMO dia lançado (um editor por vez, na ordem: a inicial do
 * medidor é a leitura de agora, "inicial = final do último dia"; a quantidade da equipe vazia); a data de início é hoje.
 * Insumos não vêm. "Como fica depois de salvar?" (antes do rodapé): [Em andamento] [Concluída], com o padrão pelo término
 * (vazio = Em andamento) até a pessoa escolher, e o resumo numa frase; Concluída manda `concluir: true`. A recusa
 * `ATIVIDADE_SERVICO_PARADO` vira a pergunta "Este serviço está parado desde dd/mm. É continuação?" e o reenvio leva
 * `nova_atividade` (false = continuar; true = serviço novo).
 *
 * D-PROD-274 (MAIKE-ENTREGA2) — os campos de cada tipo (`camposPorTipo.js`; quem decide é o servidor):
 *  - Plantio de pastagem: "Capim plantado" (obrigatório, do Cadastro de Culturas, com a espécie e a cultivar embaixo),
 *    "Safra" (só leitura, preenchida pela data), forma de plantio, semente incrustada, plantio de cobertura e "Junto com
 *    (consórcio)", todos opcionais; o VC % na linha da semente (pontos de VC/ha) e o aviso "sem semente";
 *  - Fertilização: a "Safra" (só leitura);
 *  - Aplicação: "Alvo" (da operação, só leitura), "Nº do receituário" (opcional) e "Pasto liberado em" (o término, ou o
 *    início, mais a maior carência dos produtos; só calculado);
 *  - Manutenção e Outros: a área é opcional ("Nenhuma área") e, sem ela, "Local" é obrigatório; a Manutenção tem a
 *    "Quantidade feita" (a produção do dia) e a "Unidade" (a da operação, ou KM, M ou UNIDADES).
 * Ajustes do teste de ponta a ponta: a prévia do Plantio diz o capim; a prévia sem área lê o serviço aberto do local
 * (`GET /atividades?local=…`, a busca do servidor) e diz "Entra em …" ou "Nova atividade será criada: …"; o aviso de
 * sucesso da Aplicação diz o "Pasto liberado em" da resposta; "Concluída" fica desligada para quem não pode editar (a
 * permissão do "Concluir"; o servidor também recusa, 403).
 *
 * D-PROD-275 (MAIKE-ENTREGA3) — "Faz parte de" na seção Planejamento (só leitura, como o destino): com uma reforma ABERTA
 * que tem as áreas do registro (o resumo da área traz as reformas), a linha "Faz parte de: Reforma · … ✓" já vem marcada,
 * com o "tirar" (um serviço que não é da reforma, como uma cerca); com duas, uma lista para escolher (uma delas ou "Não faz
 * parte de reforma"); o serviço que continua e já faz parte de uma reforma mostra a dela (o servidor nunca troca a
 * ligação). O corpo leva `planejamento_id` só quando marcado. Sem área (Manutenção e Outros com o local), nada.
 *
 * @param {{
 *   tipo?: any | null,
 *   tipos?: any[],   // as operações (tipos de atividade) ativas
 *   area?: any | null,
 *   areas?: any[],
 *   continuar?: any | null,
 *   onFechar: () => void,
 *   onGravou?: (resposta: any) => void,
 * }} props `area` presa (detalhes da área, Manejos: vem marcada e não sai); `tipo` (operação) preso só se alguém precisar;
 *   sem eles, a pessoa escolhe entre os 7 tipos fixos, as operações de `tipos` e as `areas` (sem `areas`, a janela lê as
 *   áreas ativas da fazenda).
 */
export default function JanelaRegistroDeCampo({
  tipo: tipoPreso = null,
  tipos: todosOsTipos = [],
  area: areaPreso = null,
  areas: areasDoPai = [],
  continuar = null,
  onFechar,
  onGravou = undefined,
}) {
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
  // D-PROD-267: no "+ Lançar dia", a operação do serviço (e o tipo dela) já vem escolhida.
  const operacaoDoServico = continuar ? todosOsTipos.find((t) => String(t?.id) === String(continuar.tipo_atividade_id ?? "")) ?? null : null;
  const [tipoFixo, setTipoFixo] = useState(() =>
    tipoPreso ? tipoFixoDaOperacao(tipoPreso) : operacaoDoServico ? tipoFixoDaOperacao(operacaoDoServico) : String(continuar?.andamento?.tipo_fixo ?? ""),
  );
  const [tipoEscolhido, setTipoEscolhido] = useState(() => (continuar?.tipo_atividade_id ? String(continuar.tipo_atividade_id) : ""));
  // D-PROD-265: o passo da janela — os cartões dos tipos ("tipo") ou o formulário do tipo escolhido ("form").
  const [passo, setPasso] = useState(/** @type {"tipo" | "form"} */ (tipoPreso || (continuar && tipoFixo) ? "form" : "tipo"));
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
    /** @returns {import("@/lib/registroDeCampoRegras").AreaDoRegistro[]} */ () => {
      if (areaPreso?.id) return [areaNovaDoRegistro(areaPreso)];
      // D-PROD-267: as áreas em aberto do serviço, com os hectares de hoje vazios (a pessoa digita).
      if (continuar) return preenchimentoDoLancarDia({ atividade: continuar }).areaIds.map((id) => ({ area_id: id, percentual: "", hectares: "" }));
      return [];
    },
  );
  /** A área do mapa pelo id. @param {string} id */
  const areaDe = (id) => areasDoMapa.find((a) => String(a?.id) === String(id)) ?? null;
  // D-PROD-258: as quatro seções são sempre oferecidas. Só as chaves que EXIGEM dado (operação antiga) ainda valem.
  // D-PROD-274: a safra não é mais digitada (o servidor tira o ano agrícola do dia quando ela não vem).
  const flags = {
    exigeMaquina: tipo?.exige_maquina === true,
    permiteImplemento: true,
  };
  // D-PROD-274: os campos de cada tipo (Plantio, Fertilização, Aplicação, Manutenção e Outros).
  const campos = camposDoTipo(tipoFixo, tipo);
  const [doServico0] = useState(() => camposDoServico(continuar));
  const [culturaId, setCulturaId] = useState(doServico0.culturaId);
  const [forma, setForma] = useState(doServico0.forma);
  const [incrustada, setIncrustada] = useState(/** @type {boolean|null} */ (doServico0.incrustada));
  const [cobertura, setCobertura] = useState(/** @type {boolean|null} */ (doServico0.cobertura));
  const [consorcioId, setConsorcioId] = useState(doServico0.consorcioId);
  const [receituario, setReceituario] = useState("");
  const [local, setLocal] = useState(doServico0.local);
  const [quantidadeFeita, setQuantidadeFeita] = useState("");
  const [unidadeFeita, setUnidadeFeita] = useState(doServico0.unidade);
  // D-PROD-275: o "Faz parte de" — o "tirar" (com uma reforma) e a escolha (com duas ou mais).
  const [reformaTirada, setReformaTirada] = useState(false);
  const [reformaEscolhida, setReformaEscolhida] = useState("");
  const culturasLidas = useQuery({
    queryKey: [RAIZ_CONSULTAS_ATIVIDADES, "culturas", empresaId],
    queryFn: () => listarCulturas(String(empresaId)),
    enabled: Boolean(empresaId) && campos.plantio,
    staleTime: 60 * 1000,
  });
  const culturas = useMemo(() => (Array.isArray(culturasLidas.data) ? culturasLidas.data : []), [culturasLidas.data]);
  const capins = useMemo(() => capinsDoCadastro(culturas), [culturas]);
  const capim = culturas.find((c) => String(c?.id) === String(culturaId)) ?? null;
  // A unidade da quantidade feita: a da operação (cadastro), quando há; senão a escolhida no formulário.
  const unidadeDaOperacao = typeof tipo?.unidade_producao?.sigla === "string" && tipo.unidade_producao.sigla ? tipo.unidade_producao.sigla.toUpperCase() : "";

  // ─── O dia: hoje na fazenda por padrão, nunca depois ──────────────────
  const [dia, setDia] = useState(hoje || "");
  const diaMexido = useRef(false);
  // D-PROD-265: o último dia do serviço (opcional; vazio = um dia só).
  const [termino, setTermino] = useState("");
  // D-PROD-267: "Como fica depois de salvar?" — null = o padrão pelo término, até a pessoa escolher.
  const [escolhaDaSituacao, setEscolhaDaSituacao] = useState(/** @type {'EM_ANDAMENTO'|'CONCLUIDA'|null} */ (null));
  // D-PROD-274 (ajuste do teste de ponta a ponta): "Concluída" pede a permissão do "Concluir" (editar ou salvar, a mesma
  // guarda do servidor). Sem ela, fica sempre Em andamento (o término preenchido não marca Concluída).
  const podeConcluir = acoes?.editar === true;
  const situacaoDepois = podeConcluir ? situacaoDepoisDeSalvar(termino, escolhaDaSituacao) : "EM_ANDAMENTO";
  // D-PROD-267: a recusa "serviço parado" (a pergunta) e a fila das máquinas e da equipe do último dia (um editor por vez).
  const [parado, setParado] = useState(/** @type {{ ultimo_dia: string|null, atividade_nome: string|null } | null} */ (null));
  const filas = useRef(/** @type {{ maquinas: any[], mao_obra: any[] }} */ ({ maquinas: [], mao_obra: [] }));
  useEffect(() => {
    if (!diaMexido.current && hoje) setDia(hoje);
  }, [hoje]);

  // ─── O dia e as linhas (D-PROD-262: itens das tabelas e um editor por seção) ─
  const [operador, setOperador] = useState(/** @type {{ id: string, rotulo: string } | null} */ (null));
  const [observacao, setObservacao] = useState("");
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
    setParado(null);
  };

  /** Abre o editor da seção: vazio (item novo) ou com um item da tabela, já com os erros apontados. @param {ColecaoDoRegistro} colecao @param {ItemDoRegistro|null} [item] @param {Record<string, string>} [errosDoCampo] */
  const abrirEditor = (colecao, item = null, errosDoCampo = {}) => {
    ultimaAbertura.current += 1;
    const id = ultimaAbertura.current;
    setEditores((e) => ({ ...e, [colecao]: { id, chave: item?.chave ?? null, form: item ? item.form : formularioVazioDaSecao(colecao), erros: errosDoCampo, saltoPedido: item?.saltoPedido === true } }));
  };
  /**
   * Fecha o editor da seção; no "+ Lançar dia", o próximo item do último dia (máquina ou pessoa) abre em seguida.
   * @param {ColecaoDoRegistro} colecao
   */
  const fecharEditor = (colecao) => {
    const fila = colecao === "maquinas" || colecao === "mao_obra" ? filas.current[colecao] : [];
    const proximo = fila.length ? fila[0] : null;
    if (proximo) filas.current = { ...filas.current, [colecao]: fila.slice(1) };
    setEditores((e) => ({ ...e, [colecao]: null }));
    if (proximo) abrirEditor(colecao, /** @type {any} */ ({ chave: null, form: proximo }));
  };
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
      // D-PROD-274: o VC (%) da semente, quando digitado, tem de ser válido (só no Plantio de pastagem).
      const vc = campos.plantio ? lerVc(ed.form?.vc) : { erro: null };
      if (vc.erro) e.vc = vc.erro;
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

  // ─── D-PROD-267: o último dia do serviço ("+ Lançar dia") ─────────────
  const doServico = useQuery({
    queryKey: [RAIZ_CONSULTAS_ATIVIDADES, "lancar-dia", empresaId, continuar?.id ?? null],
    queryFn: () => listarApontamentos(String(continuar?.id)),
    enabled: Boolean(continuar?.id && empresaId && acoes?.ver),
    staleTime: 15 * 1000,
    refetchOnWindowFocus: false,
  });
  const preenchido = useRef(false);
  useEffect(() => {
    if (!continuar || preenchido.current || !doServico.data) return;
    preenchido.current = true;
    const p = preenchimentoDoLancarDia({ atividade: continuar, apontamentos: /** @type {any} */ (doServico.data)?.items ?? [] });
    const [maquina, ...outrasMaquinas] = p.maquinas;
    const [pessoa, ...outrasPessoas] = p.equipe;
    filas.current = { maquinas: outrasMaquinas, mao_obra: outrasPessoas };
    if (maquina) abrirEditor("maquinas", /** @type {any} */ ({ chave: null, form: maquina }));
    if (pessoa) abrirEditor("mao_obra", /** @type {any} */ ({ chave: null, form: pessoa }));
  }, [continuar, doServico.data]);

  // ─── Onde o registro entra (só leitura: quem decide é o servidor) ─────
  const resumos = useQueries({
    queries: areasDoRegistro.map((l) => ({
      queryKey: [QUERY_ATIVIDADES_DA_AREA, "resumo", empresaId, l.area_id],
      queryFn: () => obterResumoDaArea(String(l.area_id)),
      enabled: Boolean(empresaId && acoes?.ver),
      staleTime: 15 * 1000,
    })),
  });
  const semAreaAgora = campos.areaOpcional && !areasDoRegistro.length;
  // D-PROD-274: sem área, o serviço ABERTO da operação no MESMO local (a busca do servidor, pela lista com `local`). O
  // local digitado espera a pessoa parar de digitar (uma leitura por pausa, não por tecla).
  const localDigitado = localDoTexto(local);
  const [localDaBusca, setLocalDaBusca] = useState(localDigitado);
  useEffect(() => {
    if (localDigitado === localDaBusca) return undefined;
    const t = setTimeout(() => setLocalDaBusca(localDigitado), 350);
    return () => clearTimeout(t);
  }, [localDigitado, localDaBusca]);
  const servicosNoLocal = useQuery({
    queryKey: [RAIZ_CONSULTAS_ATIVIDADES, "abertas-no-local", empresaId, tipo?.id ? String(tipo.id) : null, localDaBusca],
    queryFn: () => listarAtividades({ status: "ABERTA", tipo_atividade_id: String(tipo?.id), local: localDaBusca, limit: 5 }),
    enabled: Boolean(semAreaAgora && empresaId && acoes?.ver && tipo?.id && localDaBusca),
    staleTime: 15 * 1000,
  });
  const abertasNoLocal =
    localDaBusca === localDigitado && servicosNoLocal.isSuccess && Array.isArray(/** @type {any} */ (servicosNoLocal.data)?.items)
      ? /** @type {any[]} */ (/** @type {any} */ (servicosNoLocal.data).items)
      : null;
  const destino = semAreaAgora
    ? destinoSemArea({ tipo, local, dia, abertas: abertasNoLocal })
    : destinoDoRegistro({
        tipo,
        areas: areasDoRegistro.map((l) => ({ id: l.area_id, nome: areaDe(l.area_id)?.nome ?? "" })),
        dia,
        resumos: resumos.map((r) => (r.isSuccess ? r.data : null)),
        culturaId: campos.plantio ? culturaId || null : null,
        // D-PROD-274: o capim na frase (dois plantios na mesma área têm o mesmo nome).
        capim: campos.plantio && capim ? String(capim.nome ?? "") : null,
      });

  // ─── D-PROD-275: "Faz parte de" (a reforma aberta das áreas do registro) ─
  const resumosLidos = resumos.map((r) => (r.isSuccess ? r.data : null));
  const atividadeAchada = semAreaAgora
    ? null
    : atividadeDoRegistro({
        tipo,
        areas: areasDoRegistro.map((l) => ({ id: l.area_id, nome: areaDe(l.area_id)?.nome ?? "" })),
        resumos: resumosLidos,
        culturaId: campos.plantio ? culturaId || null : null,
      });
  // O serviço que continua (o "+ Lançar dia", ou a atividade aberta achada) e já faz parte de uma reforma: fica nela.
  const continuaOServico = continuar && (!atividadeAchada || String(atividadeAchada.alvo?.atividade_id) === String(continuar.id));
  const reformaLigada = continuaOServico ? continuar?.planejamento_id ?? null : atividadeAchada && !atividadeAchada.varias ? atividadeAchada.alvo?.planejamento_id ?? null : null;
  const faz = semAreaAgora || !areasDoRegistro.length
    ? fazParteDe({ candidatas: [] })
    : fazParteDe({
        candidatas: reformasDoRegistro({ areaIds: areasDoRegistro.map((l) => l.area_id), resumos: resumosLidos }),
        ligadaId: reformaLigada,
        ligadaNome: continuaOServico ? continuar?.planejamento?.nome ?? null : null,
        tirada: reformaTirada,
        escolhaId: reformaEscolhida,
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
  const montarEnvio = (/** @type {{ novaAtividade?: boolean }} */ decisao = {}) => {
    /** @type {Record<string, string>} */
    const e = {};
    if (!tipoFixo) e.tipoFixo = "Escolha o tipo.";
    if (!tipo?.id) e.tipo = "Escolha a operação.";
    // D-PROD-274: Manutenção e Outros sem área → o local é obrigatório; com área, a regra de sempre.
    const semArea = campos.areaOpcional && !areasDoRegistro.length;
    if (semArea) {
      if (!localDoTexto(local)) e.local = "Sem área, informe o local do serviço.";
    } else Object.assign(e, errosDasAreasDoRegistro(areasDoRegistro));
    if (campos.plantio && !culturaId) e.capim = "Escolha o capim plantado.";
    // D-PROD-275: com duas reformas abertas na área, a escolha é obrigatória (uma delas ou "Não faz parte de reforma").
    if (!semArea && faz.falta) e.reforma = "Escolha de qual reforma este serviço faz parte (ou \"Não faz parte de reforma\").";
    if (campos.quantidadeFeita && quantidadeFeita.trim() && !unidadeDaOperacao && !unidadeFeita) e.unidade = "Escolha a unidade.";
    // Os hectares são de cada área (`areas[]`): o dia não leva `area_executada_dia`. D-PROD-274: a quantidade feita
    // (Manutenção) é a produção do dia.
    const doDia = { ...formularioApontamentoVazio(dia), operador, area_executada_dia: "", observacao, quantidade_produzida_dia: campos.quantidadeFeita ? quantidadeFeita : "" };
    const vDia = validarFormularioApontamento(doDia, { hoje });
    Object.assign(e, vDia);
    const eTermino = erroDaDataDeTermino(dia, termino, hoje);
    if (eTermino) e.data_termino = eTermino;
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
    // A unidade só vai quando a operação não tem unidade de produção (a da operação já é a da atividade).
    const unidade = campos.quantidadeFeita && apontamento.quantidade_produzida_dia && !unidadeDaOperacao ? unidadeFeita : "";
    return {
      corpo: {
        ...apontamento,
        // D-PROD-274: sem área (Manutenção e Outros), o local no lugar das áreas.
        ...(semArea ? { local: localDoTexto(local) } : { areas: corpoDasAreasDoRegistro(areasDoRegistro) }),
        ...(campos.plantio ? { plantio: corpoDoPlantio({ culturaId, forma, incrustada, cobertura, consorcioId }) } : {}),
        ...(campos.aplicacao && receituario.trim() ? { numero_receituario: receituario.trim() } : {}),
        ...(unidade ? { unidade_producao_sigla: unidade } : {}),
        // D-PROD-275: "Faz parte de" — só quando marcado (sem ele, o corpo — e o recibo — é o de antes).
        ...(!semArea && faz.enviar ? { planejamento_id: faz.enviar } : {}),
        tipo_atividade_id: String(tipo.id),
        // D-PROD-265: só preenchida (sem ela, o corpo — e o recibo — é o de antes).
        ...(termino ? { data_termino: termino } : {}),
        // D-PROD-267: "Concluída" conclui as áreas do registro (e a atividade, com todas concluídas); a resposta ao "parado".
        ...(situacaoDepois === "CONCLUIDA" ? { concluir: true } : {}),
        ...(typeof decisao.novaAtividade === "boolean" ? { nova_atividade: decisao.novaAtividade } : {}),
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
    // As áreas ficam; os hectares voltam a 100% do tamanho (D-PROD-267: no "+ Lançar dia", vazios — os de hoje).
    setAreasDoRegistro((ls) => ls.map((l) => (continuar ? { area_id: l.area_id, percentual: "", hectares: "" } : areaDe(l.area_id) ? areaNovaDoRegistro(areaDe(l.area_id)) : l)));
    setOperador(null);
    setObservacao("");
    setTermino("");
    // D-PROD-274: o capim, os dados do plantio e o local ficam (o próximo registro costuma ser igual); o resto sai.
    setReceituario("");
    setQuantidadeFeita("");
    // D-PROD-275: o "Faz parte de" volta ao padrão (marcado com uma reforma; escolher com duas).
    setReformaTirada(false);
    setReformaEscolhida("");
    setEscolhaDaSituacao(null);
    setParado(null);
    filas.current = { maquinas: [], mao_obra: [] };
    setErros({});
    setChaveForm((k) => k + 1);
  };

  const salvar = async (/** @type {boolean} */ fechar, /** @type {{ novaAtividade?: boolean }} */ decisao = {}) => {
    if (enviando) return;
    fecharDepois.current = fechar;
    setParado(null);
    const envio = montarEnvio(decisao);
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
      // D-PROD-274: Manutenção e Outros sem área não mandam `areas`; o aviso diz o local.
      const enviadas = Array.isArray(envio.corpo.areas) ? envio.corpo.areas : [];
      const onde = enviadas.length === 0
        ? envio.corpo.local || "local informado"
        : enviadas.length === 1
          ? areaDe(enviadas[0].area_id)?.nome ?? "1 área"
          : `${enviadas.length} áreas`;
      // D-PROD-274: na Aplicação, o "Pasto liberado em" da resposta (o servidor calcula; sem carência, nada).
      const liberadoEm = typeof resposta?.registro?.pasto_liberado_em === "string" ? diaPorExtenso(resposta.registro.pasto_liberado_em) : "";
      notifySuccess("Sucesso", `${tipo.nome_tipo} registrada em ${onde}.${campos.aplicacao && liberadoEm ? ` Pasto liberado em ${liberadoEm}.` : ""}`);
      const alerta = Array.isArray(resposta?.alertas) ? resposta.alertas[0] : null;
      if (alerta) notifyWarning("Atenção", mensagemDoAlertaAtividade(alerta));
      onGravou?.(resposta);
      if (fecharDepois.current) onFechar();
      else limparFormulario();
      return;
    }
    const erro = r.erro;
    // D-PROD-267: o serviço está parado há mais de 30 dias — a pergunta aparece no lugar do aviso de recusa.
    if (codigoDoServidor(erro) === CODIGO_SERVICO_PARADO) {
      const d = /** @type {any} */ (erro)?.details ?? {};
      setParado({ ultimo_dia: typeof d.ultimo_dia === "string" ? d.ultimo_dia : null, atividade_nome: typeof d.atividade_nome === "string" ? d.atividade_nome : null });
      setEstado({ fase: "pronto" });
      return;
    }
    // A recusa que aponta um item (a posição no array enviado) vai para a linha dele, e o editor abre nela com o campo.
    const alvo = itemDaRecusa(erro, enviado.current?.linhas);
    const mensagem = mensagemDoEnvio(erro);
    // D-PROD-263: a recusa de uma área que não aponta linha nenhuma fica embaixo da área, na tabela das áreas.
    const daArea = areaDaRecusa(erro, enviado.current?.corpo?.areas);
    if (daArea && !alvo) setErros((x) => ({ ...x, [`area:${daArea.area_id}`]: mensagem }));
    // D-PROD-275: a reforma recusada (concluída, cancelada ou sem a área): a frase fica no "Faz parte de" e os resumos se releem.
    if (/** @type {any} */ (erro)?.details?.field === "planejamento_id") {
      setErros((x) => ({ ...x, reforma: mensagem }));
      void queryClient.invalidateQueries({ queryKey: [QUERY_ATIVIDADES_DA_AREA] });
    }
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

  // ─── Passo 1: o tipo (D-PROD-265) ─────────────────────────────────────
  /** Escolhe o tipo fixo e vai ao formulário: trocar de tipo limpa só a operação (ela é do tipo). @param {string} valor */
  const escolherTipoFixo = (valor) => {
    if (valor !== tipoFixo) {
      setTipoEscolhido("");
      setErros((e) => semCampos(e, ["tipoFixo", "tipo"]));
      mexeu();
    }
    setTipoFixo(valor);
    setPasso("form");
  };
  const trocarTipo = () => {
    if (enviando) return;
    setPasso("tipo");
  };

  // ─── Corpo ───────────────────────────────────────────────────────────
  const rotuloDoTipo = tipoFixo ? rotuloDoTipoFixo(tipoFixo) : "";
  const Icone = iconeDoTipoAtividade({ nome_tipo: rotuloDoTipo, categoria: tipoFixo });
  const titulo =
    passo === "form" && tipoFixo ? (
      <span className="b1-tipo-titulo" data-testid="registro-de-campo-titulo">
        <span className="b1-tipo-titulo__icone" aria-hidden>
          <Icone size={16} strokeWidth={1.75} />
        </span>
        <span className="min-w-0">Nova realização de {rotuloDoTipo}</span>
      </span>
    ) : (
      <span data-testid="registro-de-campo-titulo">Nova realização</span>
    );
  const acoesDoTitulo =
    passo === "form" && !tipoPreso && !continuar ? (
      <button type="button" className={`${BOTAO_SECUNDARIO} tb-btn-outline b1-realizacao__trocar`} onClick={trocarTipo} disabled={enviando} data-testid="registro-de-campo-trocar-tipo">
        <ArrowLeftRight className="h-3.5 w-3.5" aria-hidden />
        Trocar tipo
      </button>
    ) : null;
  const podeGravar = acoes?.lancarApontamento === true && Boolean(empresaId) && Boolean(fuso);
  const avisoStatus = !acoes?.carregando && acoes?.lancarApontamento !== true
    ? "Sem permissão para registrar atividades."
    : empresaId && !fuso
      ? "Configure o fuso horário da fazenda (Empresa → Fuso horário) antes de registrar: o servidor recusa sem ele."
      : null;

  const cartoes = (
    <div className="b1-realizacao__passo" data-testid="registro-de-campo-tipos">
      <p className="b1-realizacao__ajuda">Escolha o tipo de serviço.</p>
      <ul className="b1-realizacao__cartoes" aria-label="Tipos de serviço">
        {TIPOS_FIXOS_ATIVIDADE.map((t) => {
          const IconeDoCartao = iconeDoTipoAtividade({ nome_tipo: t.label, categoria: t.value });
          return (
            <li key={t.value} className="min-w-0">
              <button
                type="button"
                className="b1-realizacao__cartao"
                aria-pressed={t.value === tipoFixo}
                onClick={() => escolherTipoFixo(t.value)}
                data-testid={`registro-tipo-${t.value}`}
              >
                <span className="b1-realizacao__cartao-icone" aria-hidden>
                  <IconeDoCartao size={22} strokeWidth={1.75} />
                </span>
                <span className="b1-realizacao__cartao-nome">{t.label}</span>
              </button>
            </li>
          );
        })}
      </ul>
    </div>
  );

  // ─── D-PROD-274: a safra mostrada, os produtos do registro e o "Pasto liberado em" ─
  const safraMostrada = (continuar && doServico0.safra) || safraDoDia(dia) || "—";
  const produtosDoRegistro = [...itens.produtos.map((i) => i.form), ...(editores.produtos?.form?.produto ? [editores.produtos.form] : [])].filter((f) => f?.produto?.id);
  const liberado = pastoLiberadoEm(termino || dia, produtosDoRegistro.map((f) => f.produto?.carencia_dias));

  // ─── D-PROD-267: o resumo antes de salvar ("Roçada … no Pasto …, hoje, 4 ha, … Vai ficar EM ANDAMENTO (12 de 40 ha).") ─
  const achada = atividadeDoRegistro({
    tipo,
    areas: areasDoRegistro.map((l) => ({ id: l.area_id, nome: areaDe(l.area_id)?.nome ?? "" })),
    resumos: resumos.map((r) => (r.isSuccess ? r.data : null)),
    culturaId: campos.plantio ? culturaId || null : null,
  });
  /** O que o serviço já tem (feitos e área total) antes deste registro. */
  const jaTem = (() => {
    if (continuar && (!achada || String(achada.alvo?.atividade_id) === String(continuar.id))) {
      return { feitos: continuar.andamento?.hectares_feitos ?? null, area: continuar.andamento?.hectares_area ?? null };
    }
    /** @type {string[]} */
    const feitos = [];
    /** @type {string[]} */
    const areasTotal = [];
    areasDoRegistro.forEach((l, i) => {
      const naAlvo = achada
        ? (Array.isArray(resumos[i]?.data?.atividades) ? resumos[i].data.atividades : []).find((/** @type {any} */ a) => String(a.atividade_id) === String(achada.alvo?.atividade_id))
        : null;
      if (naAlvo?.area_executada) feitos.push(String(naAlvo.area_executada));
      const total = naAlvo?.area_planejada ?? tamanhoDaArea(areaDe(l.area_id));
      if (total) areasTotal.push(String(total));
    });
    return { feitos: feitos.length ? somar(feitos, 4) : null, area: areasTotal.length ? somar(areasTotal, 4) : null };
  })();
  const depois = hectaresDepoisDoRegistro({ jaFeitos: jaTem.feitos, areaTotal: jaTem.area, hoje: totaisDasAreas.hectares });
  const medida = (/** @type {any} */ f) => {
    const q = String(f?.quantidade ?? "").trim();
    if (!q) return "";
    if (f?.tipo_medida === "DIARIA") return `${q} ${q === "1" ? "diária" : "diárias"}`;
    if (f?.tipo_medida === "TAREFA") return `${q} ${q === "1" ? "tarefa" : "tarefas"}`;
    return `${q} h`;
  };
  const maquinasDoResumo = [...itens.maquinas.map((i) => i.form), ...(editores.maquinas?.form?.bem ? [editores.maquinas.form] : [])].map((f) => String(f?.bem?.rotulo ?? "")).filter(Boolean);
  const equipeDoResumo = [...itens.mao_obra.map((i) => i.form), ...(editores.mao_obra?.form?.parceiro ? [editores.mao_obra.form] : [])]
    .map((f) => [String(f?.parceiro?.rotulo ?? ""), medida(f)].filter(Boolean).join(" "))
    .filter(Boolean);
  // D-PROD-274: a quantidade feita (Manutenção) entra no resumo ("1,2 km").
  const feitaNoResumo = campos.quantidadeFeita && quantidadeFeita.trim() ? `${quantidadeFeita.trim()} ${rotuloDaUnidadeFeita(unidadeDaOperacao || unidadeFeita)}`.trim() : "";
  const resumo = resumoAntesDeSalvar({
    // D-PROD-274: no Plantio, "Plantio de <capim>".
    operacao: campos.plantio && capim ? `Plantio de ${String(capim.nome ?? "")}` : String(tipo?.nome_tipo ?? ""),
    areas: semAreaAgora ? [localDoTexto(local)].filter(Boolean) : areasDoRegistro.map((l) => String(areaDe(l.area_id)?.nome ?? "")).filter(Boolean),
    quando: textoDoDiaDoRegistro(dia, termino, hoje),
    hectares: totaisDasAreas.hectares,
    maquinas: [feitaNoResumo, ...maquinasDoResumo].filter(Boolean),
    equipe: equipeDoResumo,
    situacao: situacaoDepois,
    feitosDepois: depois.feitos,
    areaTotal: depois.area,
  });

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
        <SecaoForm titulo="Área" />
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
          opcional={campos.areaOpcional}
        />
        {/* D-PROD-274: Manutenção e Outros sem área — o Local (obrigatório sem área). */}
        {campos.areaOpcional && !areasDoRegistro.length ? (
          <CampoTexto
            label="Local"
            value={local}
            onChange={(v) => {
              setLocal(v.toUpperCase());
              mexeu();
              limparErros(["local"]);
            }}
            readOnly={enviando}
            required
            error={erros.local}
            span={12}
            maxLength={120}
            placeholder="EX.: DIVISA NORTE, SEDE"
            dica={<p className={NOTA_DO_CAMPO}>use quando o serviço não é num pasto</p>}
            testId="registro-de-campo-local"
          />
        ) : null}

        <SecaoForm titulo="Operação" />
        {tipoPreso ? (
          <CampoTexto label="Operação" value={tipoPreso.nome_tipo ?? ""} onChange={() => {}} readOnly span={6} keepCase />
        ) : (
          <>
            <CampoSelect
              label="Operação"
              value={tipoEscolhido}
              onChange={(v) => {
                setTipoEscolhido(v);
                esquecerUltimo();
                limparErros(["tipo"]);
              }}
              options={operacoes.map((t) => ({ value: String(t.id), label: t.nome_tipo }))}
              placeholder={operacoes.length ? "Escolha a operação" : "Nenhuma operação neste tipo"}
              readOnly={enviando}
              required
              span={6}
              error={erros.tipo ?? erros.tipoFixo}
            />
            {!operacoes.length ? (
              <p className="col-span-12 min-w-0 break-words text-[12px] text-[var(--mg-text-2,#475569)]" data-testid="registro-de-campo-sem-operacao">
                Nenhuma operação ativa neste tipo. Cadastre em Tipos de Atividade.
              </p>
            ) : null}
          </>
        )}
        {/* D-PROD-274: os campos de cada tipo. */}
        {campos.plantio ? (
          <CampoSelect
            label="Capim plantado"
            value={culturaId}
            onChange={(v) => {
              setCulturaId(v);
              if (v && v === consorcioId) setConsorcioId("");
              mexeu();
              limparErros(["capim"]);
            }}
            options={capins.map((c) => ({ value: String(c.id), label: String(c.nome ?? "") }))}
            placeholder={capins.length ? "Escolha o capim" : culturasLidas.isLoading ? "Lendo o cadastro…" : "Nenhum capim no cadastro"}
            readOnly={enviando}
            required
            span={6}
            error={erros.capim}
            dica={
              <p className={NOTA_DO_CAMPO} data-testid="registro-de-campo-capim-dica">
                {capim ? dicaDaCultura(capim) : capins.length || culturasLidas.isLoading ? "do cadastro de culturas" : "Cadastre o capim em Cadastros › Culturas."}
              </p>
            }
          />
        ) : null}
        {campos.safra ? (
          <ValorCalculado
            label="Safra"
            valor={safraMostrada}
            span={6}
            testId="registro-de-campo-safra"
            dica={<p className={NOTA_DO_CAMPO}>{doServico0.safra && continuar ? "a safra do serviço" : "preenchida pela data"}</p>}
          />
        ) : null}
        {campos.plantio ? (
          <>
            <CampoSelect
              label="Forma de plantio"
              value={forma}
              onChange={(v) => {
                setForma(v);
                mexeu();
              }}
              options={[...FORMAS_PLANTIO]}
              placeholder="Não informada"
              readOnly={enviando}
              span={6}
              dica={<p className={NOTA_DO_CAMPO}>opcional</p>}
            />
            <B1ChaveRow
              label="Semente incrustada"
              span={6}
              checked={incrustada === true}
              onChange={enviando ? undefined : (/** @type {boolean} */ v) => { setIncrustada(v); mexeu(); }}
              disabled={enviando}
              ariaLabel="Semente incrustada"
              dataField="semente_incrustada"
            />
            <B1ChaveRow
              label="Plantio de cobertura"
              span={6}
              checked={cobertura === true}
              onChange={enviando ? undefined : (/** @type {boolean} */ v) => { setCobertura(v); mexeu(); }}
              disabled={enviando}
              ariaLabel="Plantio de cobertura"
              dataField="cobertura"
            />
            <CampoSelect
              label="Junto com (consórcio)"
              value={consorcioId}
              onChange={(v) => {
                setConsorcioId(v);
                mexeu();
              }}
              options={consorciosDoCadastro(culturas, culturaId).map((c) => ({ value: String(c.id), label: String(c.nome ?? "") }))}
              placeholder="Nenhuma lavoura"
              readOnly={enviando}
              span={6}
              dica={<p className={NOTA_DO_CAMPO}>opcional</p>}
            />
          </>
        ) : null}
        {campos.aplicacao ? (
          <>
            <ValorCalculado
              label="Alvo"
              valor={typeof tipo?.alvo === "string" && tipo.alvo ? tipo.alvo : "—"}
              span={6}
              testId="registro-de-campo-alvo"
              dica={
                <p className={NOTA_DO_CAMPO}>
                  {tipo?.alvo ? "vem do cadastro da operação" : tipo?.id ? "sem alvo no cadastro da operação (Cadastros › Tipos de Atividade)" : "vem do cadastro da operação"}
                </p>
              }
            />
            <CampoTexto
              label="Nº do receituário"
              value={receituario}
              onChange={(v) => {
                setReceituario(v);
                esquecerUltimo();
              }}
              readOnly={enviando}
              span={6}
              maxLength={40}
              keepCase
              dica={<p className={NOTA_DO_CAMPO}>opcional</p>}
              testId="registro-de-campo-receituario"
            />
          </>
        ) : null}
        {campos.quantidadeFeita ? (
          <>
            <CampoTexto
              label="Quantidade feita"
              value={quantidadeFeita}
              onChange={(v) => {
                setQuantidadeFeita(v);
                mexeu();
                limparErros(["quantidade_produzida_dia", "unidade"]);
              }}
              readOnly={enviando}
              span={3}
              inputMode="decimal"
              maxLength={16}
              keepCase
              error={erros.quantidade_produzida_dia}
              testId="registro-de-campo-quantidade-feita"
            />
            {unidadeDaOperacao ? (
              <ValorCalculado label="Unidade" valor={unidadeDaOperacao} span={3} testId="registro-de-campo-unidade" dica={<p className={NOTA_DO_CAMPO}>da operação</p>} />
            ) : (
              <CampoSelect
                label="Unidade"
                value={unidadeFeita}
                onChange={(v) => {
                  setUnidadeFeita(v);
                  mexeu();
                  limparErros(["unidade"]);
                }}
                options={[...UNIDADES_FEITAS]}
                placeholder="Escolha"
                readOnly={enviando}
                span={3}
                error={erros.unidade}
              />
            )}
          </>
        ) : null}

        <SecaoForm titulo="Datas" />
        <CampoDia
          label="Data de início"
          value={dia}
          onChange={(v) => {
            if (!v || (hoje && v > hoje)) return;
            diaMexido.current = true;
            setDia(v);
            esquecerUltimo();
            setErros((e) => {
              const semDia = semCampos(e, ["data_operacional", "data_termino"]);
              const eTermino = erroDaDataDeTermino(v, termino, hoje);
              return eTermino ? { ...semDia, data_termino: eTermino } : semDia;
            });
          }}
          max={hoje || undefined}
          required
          span={3}
          error={erros.data_operacional}
          testId="registro-de-campo-data"
        />
        <CampoDia
          label="Data de término"
          value={termino}
          onChange={(v) => {
            setTermino(v || "");
            esquecerUltimo();
            setErros((e) => {
              const semTermino = semCampos(e, ["data_termino"]);
              const eTermino = erroDaDataDeTermino(dia, v || "", hoje);
              return eTermino ? { ...semTermino, data_termino: eTermino } : semTermino;
            });
          }}
          min={dia || undefined}
          max={hoje || undefined}
          readOnly={enviando}
          span={3}
          error={erros.data_termino}
          testId="registro-de-campo-data-termino"
        />
        {/* D-PROD-274: Aplicação — "Pasto liberado em" = término (ou o dia) + a maior carência dos produtos (calculado). */}
        {campos.aplicacao ? (
          <ValorCalculado
            label="Pasto liberado em"
            valor={liberado.dia ? diaPorExtenso(liberado.dia) : "—"}
            span={6}
            testId="registro-de-campo-pasto-liberado"
            dica={
              <p className={NOTA_DO_CAMPO} data-testid="registro-de-campo-pasto-liberado-nota">
                {liberado.dia
                  ? `${termino ? "término" : "início"} + carência do produto (${liberado.carencia} ${liberado.carencia === 1 ? "dia" : "dias"})`
                  : produtosDoRegistro.length
                    ? "sem carência no cadastro do produto"
                    : "término + carência do produto (inclua o produto)"}
              </p>
            }
          />
        ) : null}

        {COLECOES_DO_REGISTRO.map((colecao) => {
          const editor = editores[colecao];
          const lista = itens[colecao];
          // D-PROD-267: no "+ Lançar dia", a leitura inicial da máquina é a final do último dia (a vigente do medidor).
          const notaDaMaquina =
            continuar && colecao === "maquinas" && (lista.length > 0 || editor) ? (
              <p key="nota-maquina" className="col-span-12 min-w-0 text-[12px] text-[var(--mg-text-2,#475569)]" data-testid="registro-de-campo-nota-inicial">
                inicial = final do último dia
              </p>
            ) : null;
          // D-PROD-274: no Plantio sem semente lançada, o aviso (o kg/ha da semente sai da linha do insumo).
          const avisoSemSemente =
            campos.plantio && colecao === "produtos" && !lista.length && !editor ? (
              <p key="sem-semente" className="col-span-12 min-w-0 text-[12px] text-amber-800" data-testid="registro-de-campo-sem-semente">
                Sem semente, não dá para calcular kg/ha.
              </p>
            ) : null;
          return (
            <React.Fragment key={colecao}>
            <SecaoDeLinhasDoRegistro
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
                    comVc={campos.plantio}
                  />
                ) : null
              }
            />
            {notaDaMaquina}
            {avisoSemSemente}
            </React.Fragment>
          );
        })}

        <SecaoForm titulo="Planejamento" />
        <p className="col-span-12 min-w-0 break-words text-[12px] text-[var(--mg-text-2,#475569)]" data-testid={destino ? "registro-de-campo-destino" : "registro-de-campo-destino-vazio"}>
          {destino ?? "Escolha a área e a operação para ver em qual atividade este registro entra."}
        </p>
        <FazParteDe
          faz={faz}
          escolhaId={reformaEscolhida}
          erro={erros.reforma ?? null}
          bloqueado={enviando}
          onTirar={() => {
            setReformaTirada(true);
            limparErros(["reforma"]);
            mexeu();
          }}
          onPorDeVolta={() => {
            setReformaTirada(false);
            limparErros(["reforma"]);
            mexeu();
          }}
          onEscolher={(id) => {
            setReformaEscolhida(id);
            limparErros(["reforma"]);
            mexeu();
          }}
        />

        <SecaoForm titulo="Informações complementares" />
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
        <CampoTextoLongo label="Observação" value={observacao} onChange={(v) => { setObservacao(v); esquecerUltimo(); }} readOnly={enviando} maxLength={MAX_OBSERVACAO_ATIVIDADE} />

        <SecaoForm titulo="Como fica depois de salvar?" />
        <div className="col-span-12 min-w-0 b1-situacao-depois" role="radiogroup" aria-label="Como fica depois de salvar?" data-testid="registro-de-campo-situacao">
          {/** @type {const} */ ([["EM_ANDAMENTO", "Em andamento"], ["CONCLUIDA", "Concluída"]]).map(([valor, rotulo]) => (
            <button
              key={valor}
              type="button"
              role="radio"
              aria-checked={situacaoDepois === valor}
              className="b1-situacao-depois__opcao"
              // D-PROD-274: sem a permissão do "Concluir", "Concluída" não é oferecida (o servidor também recusa, 403).
              disabled={enviando || (valor === "CONCLUIDA" && !podeConcluir)}
              title={valor === "CONCLUIDA" && !podeConcluir ? "Só quem pode editar conclui." : undefined}
              onClick={() => {
                setEscolhaDaSituacao(valor);
                mexeu();
              }}
              data-testid={`registro-de-campo-situacao-${valor === "CONCLUIDA" ? "concluida" : "andamento"}`}
            >
              <span className="b1-situacao-depois__radio" aria-hidden />
              {rotulo}
            </button>
          ))}
        </div>
        {!podeConcluir && !acoes?.carregando ? (
          <p className="col-span-12 -mt-1 min-w-0 text-[12px] text-[var(--mg-text-2,#475569)]" data-testid="registro-de-campo-situacao-sem-permissao">
            Só quem pode editar conclui.
          </p>
        ) : null}
        {resumo.frase || resumo.vai ? (
          <p className="col-span-12 min-w-0 break-words text-[13px] text-[var(--mg-text-2,#475569)]" data-testid="registro-de-campo-resumo">
            {resumo.frase ? `${resumo.frase} ` : ""}
            <strong className="text-[var(--mg-text-1,#1f2937)]">{resumo.vai}</strong>
          </p>
        ) : null}
        {parado ? (
          <div className="col-span-12 min-w-0 b1-parado" role="alertdialog" aria-label="Serviço parado" data-testid="registro-de-campo-parado" ref={(el) => el?.scrollIntoView?.({ block: "nearest" })}>
            <p className="b1-parado__pergunta">
              Este serviço está parado{parado.ultimo_dia ? ` desde ${diaCurto(parado.ultimo_dia)}` : ""}. É continuação?
            </p>
            {parado.atividade_nome ? <p className="b1-parado__nome">{parado.atividade_nome}</p> : null}
            <div className="b1-parado__botoes">
              <button type="button" className={BOTAO_SECUNDARIO} disabled={enviando} onClick={() => void salvar(fecharDepois.current, { novaAtividade: false })} data-testid="registro-de-campo-parado-continuar">
                Continuar este serviço
              </button>
              <button type="button" className={BOTAO_SECUNDARIO} disabled={enviando} onClick={() => void salvar(fecharDepois.current, { novaAtividade: true })} data-testid="registro-de-campo-parado-novo">
                É um serviço novo
              </button>
            </div>
          </div>
        ) : null}
        <div className="col-span-12 min-w-0">
          <AvisoEnvioDaLinha estado={estado} produto={false} lancado="o registro PODE ter sido gravado" onRepetir={() => void salvar(true)} onConsultar={consultar} />
        </div>
      </SecoesDoFormularioContext.Provider>
    </form>
  );

  const podeEnviar = podeGravar && Boolean(tipo?.id) && (areasDoRegistro.length > 0 || campos.areaOpcional) && !enviando;
  const noFormulario = passo === "form";
  return (
    <B1Janela
      aberto
      onFechar={onFechar}
      podeFechar={!enviando}
      aoPedirFechar={() => !alvoFolha?.querySelector(".mk-sheet-root")}
      titulo={titulo}
      acoesDoTitulo={acoesDoTitulo}
      testId="janela-registro-de-campo"
      className={`b1-realizacao${celular ? " b1-janela--tela-cheia" : ""}`}
      contentProps={{ "data-permissao-explicita": "", "data-celular": celular ? "" : undefined, "data-passo": passo, className: celular ? "b1-janela__camada--tela-cheia" : undefined }}
      fora={<div ref={setAlvoFolha} className="contents" />}
      rodape={
        <>
          <button type="button" className={BOTAO_SECUNDARIO} onClick={onFechar} disabled={enviando} data-testid="registro-de-campo-cancelar">
            Cancelar
          </button>
          {noFormulario ? (
            <>
              <button type="button" className={BOTAO_PRIMARIO} onClick={() => void salvar(true)} disabled={!podeEnviar} data-testid="registro-de-campo-salvar">
                {enviando ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <Check className="h-4 w-4" aria-hidden />}
                {enviando ? "Salvando…" : estado.fase === "incerto" ? "Repetir o mesmo envio" : "Salvar"}
              </button>
              <button type="button" className={BOTAO_PRIMARIO} onClick={() => void salvar(false)} disabled={!podeEnviar} data-testid="registro-de-campo-salvar-novo">
                <CheckCheck className="h-4 w-4" aria-hidden />
                Salvar e novo
              </button>
            </>
          ) : null}
        </>
      }
    >
      <MobileSheetPortalCtx.Provider value={alvoFolha}>
        {avisoStatus ? <AvisoGestao testId="registro-de-campo-aviso">{avisoStatus}</AvisoGestao> : null}
        {noFormulario ? form : cartoes}
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

/**
 * D-PROD-275 — a linha "Faz parte de" da seção Planejamento (só leitura): a reforma já marcada com o "tirar", o "pôr de
 * volta", a lista de escolha (duas reformas abertas) ou a reforma de que o serviço que continua já faz parte.
 * @param {{ faz: ReturnType<typeof fazParteDe>, escolhaId: string, erro: string|null, bloqueado: boolean,
 *   onTirar: () => void, onPorDeVolta: () => void, onEscolher: (id: string) => void }} props
 */
function FazParteDe({ faz, escolhaId, erro, bloqueado, onTirar, onPorDeVolta, onEscolher }) {
  if (faz.modo === "nenhuma" || faz.modo === "lendo") return null;
  const NOTA = "col-span-12 min-w-0 break-words text-[12px] text-[var(--mg-text-2,#475569)]";
  const LINK = "ml-1.5 font-medium text-emerald-700 underline underline-offset-2 hover:text-emerald-800 disabled:opacity-50";
  const nome = String(faz.reforma?.nome ?? "");
  const forte = (/** @type {string} */ t) => <strong className="text-[var(--mg-text-1,#1f2937)]">{t}</strong>;
  return (
    <>
      {faz.modo === "ja_ligada" ? (
        <p className={NOTA} data-testid="registro-de-campo-faz-parte" data-modo={faz.modo}>
          Faz parte de: {forte(nome)} ✓ <span>(o serviço já está nesta reforma)</span>
        </p>
      ) : null}
      {faz.modo === "uma" ? (
        <p className={NOTA} data-testid="registro-de-campo-faz-parte" data-modo={faz.modo}>
          Faz parte de: {forte(nome)} ✓
          <button type="button" className={LINK} onClick={onTirar} disabled={bloqueado} data-testid="registro-de-campo-faz-parte-tirar">
            tirar
          </button>
        </p>
      ) : null}
      {faz.modo === "tirada" ? (
        <p className={NOTA} data-testid="registro-de-campo-faz-parte" data-modo={faz.modo}>
          Não faz parte da {nome || "reforma"}.
          <button type="button" className={LINK} onClick={onPorDeVolta} disabled={bloqueado} data-testid="registro-de-campo-faz-parte-por">
            pôr de volta
          </button>
        </p>
      ) : null}
      {faz.modo === "escolher" ? (
        <div className="col-span-12 min-w-0" data-testid="registro-de-campo-faz-parte" data-modo={faz.modo}>
          <p className="mb-1.5 text-[12px] text-[var(--mg-text-2,#475569)]">Faz parte de (a área tem {faz.candidatas.length} reformas abertas):</p>
          <div className="b1-situacao-depois b1-faz-parte-lista" role="radiogroup" aria-label="Faz parte de qual reforma?">
            {[...faz.candidatas.map((p) => ({ id: String(p.id), rotulo: String(p.nome ?? "") })), { id: NAO_FAZ_PARTE, rotulo: "Não faz parte de reforma" }].map((o) => (
              <button
                key={o.id}
                type="button"
                role="radio"
                aria-checked={escolhaId === o.id}
                className="b1-situacao-depois__opcao"
                disabled={bloqueado}
                onClick={() => onEscolher(o.id)}
                data-testid={`registro-de-campo-faz-parte-opcao-${o.id}`}
              >
                <span className="b1-situacao-depois__radio" aria-hidden />
                {o.rotulo}
              </button>
            ))}
          </div>
        </div>
      ) : null}
      {erro ? (
        <p className="col-span-12 -mt-1 text-[12px] text-red-700" role="alert" data-testid="registro-de-campo-faz-parte-erro">
          {erro}
        </p>
      ) : null}
    </>
  );
}

/** Nenhum editor aberto. @returns {Record<ColecaoDoRegistro, EditorDaSecao | null>} */
function editoresFechados() {
  return { produtos: null, maquinas: null, mao_obra: null, servicos: null };
}

/** O objeto sem as chaves dadas (o mesmo, se nenhuma estava lá). @param {Record<string, string>} objeto @param {string[]} chaves */
function semCampos(objeto, chaves) {
  return chaves.some((c) => objeto[c]) ? Object.fromEntries(Object.entries(objeto).filter(([k]) => !chaves.includes(k))) : objeto;
}
