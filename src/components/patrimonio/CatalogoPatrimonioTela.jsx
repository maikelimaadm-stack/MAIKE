import React, { useCallback, useMemo, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  RECURSOS_CATALOGO,
  alterarSituacaoCatalogo,
  atualizarCatalogo,
  criarCatalogo,
  detalharCatalogo,
  instalarCatalogoPadrao,
  listarCatalogoPagina,
  resumoCatalogoPadrao,
} from "@/services/patrimonioCatalogoService";
import { associarProdutosAoCombustivel, buscarCombustivelPorCodigo, localizarCombustivelCriado } from "@/services/combustivelProdutoService";
import { ehResultadoIncerto } from "@/services/operacaoFinanceiraService";
import { listEmpresas } from "@/services/empresaService";
import { notifyInfo, notifySuccess, notifyWarning } from "@/lib/maikeNotify";
import { confirmar } from "@/lib/maikeConfirmar";
import CadastroBase1Screen from "@/components/cadastro/base1/CadastroBase1Screen";
import GradePatrimonio from "@/components/patrimonio/GradePatrimonio";
import { FAMILIAS_CAMPOS_CARD, GRADE_FAMILIAS } from "@/components/patrimonio/TabelaFamilias";
import { GRADE_TIPOS, TIPOS_CAMPOS_CARD } from "@/components/patrimonio/TabelaTipos";
import { GRADE_PERFIS, PERFIS_CAMPOS_CARD } from "@/components/patrimonio/TabelaPerfisMedicao";
import { COMBUSTIVEIS_CAMPOS_CARD, GRADE_COMBUSTIVEIS } from "@/components/patrimonio/TabelaCombustiveis";
import FormularioFamilia, { FORMULARIO_FAMILIA_ID } from "@/components/patrimonio/FormularioFamilia";
import FormularioTipo, { FORMULARIO_TIPO_ID } from "@/components/patrimonio/FormularioTipo";
import FormularioPerfilMedicao, { FORMULARIO_PERFIL_MEDICAO_ID } from "@/components/patrimonio/FormularioPerfilMedicao";
import FormularioCombustivel, { FORMULARIO_COMBUSTIVEL_ID } from "@/components/patrimonio/FormularioCombustivel";
import ProdutosDoCombustivel from "@/components/patrimonio/ProdutosDoCombustivel";
import { FiltroOpcoes } from "@/components/patrimonio/PatrimonioFormParts";
import { AvisoGestao, FiltroSituacao, ativoDoFiltro } from "@/components/gestao/GestaoFormParts";
import { useCadastroBase1Controller } from "@/hooks/useCadastroBase1Controller";
import { useAcoesTelaPatrimonio, useEmpresaRealSelecionadaId } from "@/hooks/usePatrimonioSessao";
import { TELAS_PATRIMONIO } from "@/lib/patrimonioPermissions";
import { NATUREZAS_PATRIMONIO, ROTULO_NATUREZA } from "@/lib/patrimonioDominio";
import { ehConflitoDeVersaoPatrimonio, ehNaoEncontradoPatrimonio, mensagemErroPatrimonio } from "@/lib/patrimonioErros";

/** Raiz das consultas dos catálogos (lista, detalhe do tipo) e dos seletores de patrimônio. */
const QUERY_RAIZ = "patrimonio-catalogo";
const QUERY_OPCOES = ["lancamentos-financeiros-gestao", "opcoes", "patrimonio"];

/** Configuração de cada tela de catálogo (mesma forma; rótulos, colunas e formulário próprios). */
export const CONFIG_CATALOGOS = Object.freeze({
  familias: Object.freeze({
    tela: TELAS_PATRIMONIO.FAMILIAS,
    titulo: "Famílias Patrimoniais",
    rotulo: "família patrimonial",
    plural: "famílias patrimoniais",
    novo: "Nova família patrimonial",
    vazio: "Nenhuma família patrimonial encontrada",
    criado: "Família patrimonial criada",
    atualizado: "Família patrimonial atualizada",
    inativado: "Família patrimonial inativada",
    reativado: "Família patrimonial reativada",
    efeitoInativar: "Ela deixa de ser oferecida para novos tipos e bens; os bens já cadastrados continuam legíveis. Nada é apagado.",
    efeitoReativar: "Ela volta a ser oferecida para novos tipos e bens.",
    exportFileName: "familias-patrimoniais.csv",
    formId: FORMULARIO_FAMILIA_ID,
    Formulario: FormularioFamilia,
    grade: GRADE_FAMILIAS,
    camposCard: FAMILIAS_CAMPOS_CARD,
  }),
  tipos: Object.freeze({
    tela: TELAS_PATRIMONIO.TIPOS,
    titulo: "Tipos Patrimoniais",
    rotulo: "tipo patrimonial",
    plural: "tipos patrimoniais",
    novo: "Novo tipo patrimonial",
    vazio: "Nenhum tipo patrimonial encontrado",
    criado: "Tipo patrimonial criado",
    atualizado: "Tipo patrimonial atualizado",
    inativado: "Tipo patrimonial inativado",
    reativado: "Tipo patrimonial reativado",
    efeitoInativar: "Ele deixa de ser oferecido para novos bens; os bens já cadastrados continuam legíveis. Nada é apagado.",
    efeitoReativar: "Ele volta a ser oferecido para novos bens.",
    exportFileName: "tipos-patrimoniais.csv",
    formId: FORMULARIO_TIPO_ID,
    Formulario: FormularioTipo,
    grade: GRADE_TIPOS,
    camposCard: TIPOS_CAMPOS_CARD,
  }),
  "perfis-medicao": Object.freeze({
    tela: TELAS_PATRIMONIO.PERFIS_MEDICAO,
    titulo: "Perfis de Medição",
    rotulo: "perfil de medição",
    plural: "perfis de medição",
    novo: "Novo perfil de medição",
    vazio: "Nenhum perfil de medição encontrado",
    criado: "Perfil de medição criado",
    atualizado: "Perfil de medição atualizado",
    inativado: "Perfil de medição inativado",
    reativado: "Perfil de medição reativado",
    efeitoInativar: "Ele deixa de ser oferecido para novas medições; as medições já gravadas continuam legíveis. Nada é apagado.",
    efeitoReativar: "Ele volta a ser oferecido para novas medições.",
    exportFileName: "perfis-medicao.csv",
    formId: FORMULARIO_PERFIL_MEDICAO_ID,
    Formulario: FormularioPerfilMedicao,
    grade: GRADE_PERFIS,
    camposCard: PERFIS_CAMPOS_CARD,
  }),
  combustiveis: Object.freeze({
    tela: TELAS_PATRIMONIO.COMBUSTIVEIS,
    titulo: "Combustíveis",
    rotulo: "combustível",
    plural: "combustíveis",
    novo: "Novo combustível",
    vazio: "Nenhum combustível encontrado",
    criado: "Combustível criado",
    atualizado: "Combustível atualizado",
    inativado: "Combustível inativado",
    reativado: "Combustível reativado",
    efeitoInativar: "Ele deixa de ser oferecido para novos tanques; os tanques que já o usam continuam legíveis. Nada é apagado.",
    efeitoReativar: "Ele volta a ser oferecido para novos tanques.",
    exportFileName: "combustiveis.csv",
    formId: FORMULARIO_COMBUSTIVEL_ID,
    Formulario: FormularioCombustivel,
    grade: GRADE_COMBUSTIVEIS,
    camposCard: COMBUSTIVEIS_CAMPOS_CARD,
  }),
});

const OPCOES_FILTRO_NATUREZA = [{ value: "TODAS", label: "Todas as naturezas" }, ...NATUREZAS_PATRIMONIO.map((n) => ({ value: n, label: ROTULO_NATUREZA[n] }))];

/** @param {string} s */
const capital = (s) => s.charAt(0).toUpperCase() + s.slice(1);

/**
 * Resumo da instalação do catálogo padrão (criados, já existentes, conflitos).
 * @param {{ resumo: { criados: string, existentes: string, conflitos: string[] }, onFechar: () => void }} props
 */
function ResumoCatalogoPadrao({ resumo, onFechar }) {
  return (
    <AvisoGestao tone="blue" testId="patrimonio-catalogo-padrao-resumo">
      <p className="font-semibold">Catálogo padrão instalado.</p>
      <p>Criados: {resumo.criados}.</p>
      <p>Já existiam: {resumo.existentes}.</p>
      {resumo.conflitos.length ? (
        <>
          <p>Conflitos ({resumo.conflitos.length}) — nada foi alterado nesses itens:</p>
          <ul className="list-disc pl-5">
            {resumo.conflitos.map((c) => (
              <li key={c}>{c}</li>
            ))}
          </ul>
        </>
      ) : (
        <p>Sem conflitos.</p>
      )}
      <button type="button" className="mt-1 underline" onClick={onFechar}>
        Fechar resumo
      </button>
    </AvisoGestao>
  );
}

/** Erro local da criação de combustível com resultado incerto: a mensagem já é a final. */
const erroDeCriacao = (/** @type {string} */ mensagem) => Object.assign(new Error(mensagem), { mensagemCriacao: mensagem });

const SUFIXO_CRIACAO_INCERTA = " A resposta do servidor não chegou, mas o combustível foi gravado.";
const MENSAGEM_NAO_GRAVADO = "O combustível não foi gravado. Salve de novo.";
const MENSAGEM_NAO_CONFIRMADO =
  "Não foi possível confirmar se o combustível foi gravado. Confira a lista antes de salvar de novo: o código não se repete.";
const MENSAGEM_JA_EXISTE = "Já existe um combustível com este código. Confira a lista; nada foi criado nem associado.";
const AVISO_FAZENDA_MUDOU_NA_CRIACAO =
  "Combustível criado, mas nenhum Produto foi associado. A fazenda mudou: os Produtos escolhidos eram da fazenda anterior e foram retirados. Escolha de novo.";

const MENSAGEM_VERSAO_RECARREGADA =
  "Este cadastro foi alterado por outra pessoa enquanto você editava. O registro foi recarregado com a versão atual: confira e refaça a alteração. Nada foi gravado.";

/**
 * Tela Motor Base1 de um catálogo de Patrimônio e Frota (D-PROD-157): lista
 * keyset com busca no servidor e filtro de situação (e de natureza, nas
 * famílias); formulário próprio de cada catálogo.
 *
 * Catálogos são do TENANT: não pedem empresa. Sem exclusão física e sem chave
 * Ativo no formulário: inativar/reativar é ação do menu (com confirmação) e
 * exige a ação extra `inativar`. Nas Famílias, o administrador instala o
 * catálogo padrão (idempotente) e vê o resumo. Nos Combustíveis, o registro
 * aberto (leitura E edição) mostra os Produtos associados NA fazenda
 * selecionada (R2), e a criação escolhe os Produtos antes de salvar (UX-02,
 * D-PROD-160): cria o combustível, associa cada Produto pelos endpoints
 * existentes e mostra o resultado explícito — nunca "sucesso" com falha, e
 * repetir só reenvia os Produtos que falharam ao MESMO combustível.
 *
 * @param {{ recurso: 'familias'|'tipos'|'perfis-medicao'|'combustiveis' }} props
 */
export default function CatalogoPatrimonioTela({ recurso }) {
  const cfg = CONFIG_CATALOGOS[recurso];
  const queryClient = useQueryClient();
  const acoes = useAcoesTelaPatrimonio(cfg.tela);
  // Só os Combustíveis usam a empresa: os produtos vinculados são POR fazenda (R2).
  const empresaId = useEmpresaRealSelecionadaId();
  const ehCombustiveis = recurso === RECURSOS_CATALOGO.COMBUSTIVEIS;
  // A fazenda AGORA (a criação compara com a fazenda dos Produtos escolhidos).
  const empresaAtualRef = useRef(empresaId);
  empresaAtualRef.current = empresaId;
  // Nome da fazenda para "Fazenda: …" (mesma consulta/chave do Layout e de Abastecimentos).
  const empresasQuery = useQuery({
    queryKey: ["empresas"],
    queryFn: () => listEmpresas(),
    enabled: ehCombustiveis && Boolean(empresaId),
    staleTime: 5 * 60 * 1000,
    refetchOnWindowFocus: false,
  });
  /** @param {string|null} id */
  const nomeDaEmpresa = (id) => {
    const empresa = id ? (Array.isArray(empresasQuery.data) ? empresasQuery.data : []).find((e) => String(e?.id) === String(id)) : null;
    return typeof empresa?.nome === "string" && empresa.nome.trim() ? empresa.nome.trim() : null;
  };
  const empresaNome = ehCombustiveis ? nomeDaEmpresa(empresaId) : null;
  // "Não associados" por empresa+combustível (da criação e da seção do registro):
  // sobrevivem à remontagem da seção e reaparecem ao voltar para a mesma fazenda e registro.
  const [falhasPorRegistro, setFalhasPorRegistro] = useState(
    /** @type {Record<string, Array<{ id: string, nome: string, codigo: string|null, mensagem: string }>>} */ ({}),
  );
  /** @param {string} emp @param {string} tipo @param {Array<{ id: string, nome: string, codigo: string|null, mensagem: string }>} falhas */
  const guardarFalhasDoRegistro = (emp, tipo, falhas) =>
    setFalhasPorRegistro((atual) => {
      const chave = `${emp}:${tipo}`;
      if (falhas.length) return { ...atual, [chave]: falhas };
      if (!(chave in atual)) return atual;
      const resto = { ...atual };
      delete resto[chave];
      return resto;
    });
  const [situacao, setSituacao] = useState("ativos");
  const [natureza, setNatureza] = useState("TODAS");
  const [resumoPadrao, setResumoPadrao] = useState(/** @type {ReturnType<typeof resumoCatalogoPadrao>|null} */ (null));
  const submitRef = useRef(/** @type {(data: object) => void} */ (() => {}));
  const ehFamilias = recurso === RECURSOS_CATALOGO.FAMILIAS;

  const fetchPage = useCallback(
    ({ limit, cursor, q }) =>
      listarCatalogoPagina(recurso, {
        limit,
        cursor,
        q: q || undefined,
        ativo: ativoDoFiltro(situacao),
        natureza: ehFamilias && natureza !== "TODAS" ? natureza : undefined,
      }),
    [recurso, ehFamilias, situacao, natureza],
  );

  const controller = useCadastroBase1Controller({
    storageKey: cfg.grade.storageKey,
    columnIds: cfg.camposCard,
    listEnabled: acoes.ver,
    queryKey: [QUERY_RAIZ, recurso, "page", situacao, natureza],
    fetchPage,
    duplicateLabelField: "nome",
    searchPlaceholder: `Buscar ${cfg.plural}…`,
    exportFileName: cfg.exportFileName,
    exportColumns: cfg.grade.colunas,
    getExportFieldValue: cfg.grade.getFieldValue,
    getRecordTitle: (item) => (item?.id ? item.nome || capital(cfg.rotulo) : cfg.novo),
    // Rascunho de "Duplicar" herda o código do original: código só de registro gravado.
    getRecordCode: (item) => (item?.id && item?.codigo ? String(item.codigo) : undefined),
    getSearchHaystack: (r) => [r.codigo, r.nome, r.descricao].filter((v) => v != null).join(" "),
    mapSearchSuggestion: (r) => ({ id: String(r.id), label: r.nome || capital(cfg.rotulo), secondary: r.codigo || undefined }),
    matchRowId: (r, id) => String(r.id) === String(id),
    getRowId: (r) => String(r.id),
    findRowById: (rows, id) => rows.find((r) => String(r.id) === String(id)),
    onSubmitRecord: (data) => submitRef.current(data),
    // Sem exclusão física: a grade não oferece "Excluir" (inativar é ação própria).
    onRequestDeleteMutation: () => {},
  });

  const invalidar = () => {
    queryClient.invalidateQueries({ queryKey: [QUERY_RAIZ, recurso] });
    queryClient.invalidateQueries({ queryKey: QUERY_OPCOES });
  };

  const mostrarRegistro = (registro) => {
    controller.recordHelpers.recordBeforeNewRef.current = null;
    controller.setEditingItem(registro);
    controller.setIsEditing(false);
    controller.recordHelpers.bumpFormEpoch();
  };

  // Registro aberto AGORA (a releitura assíncrona não pode sobrescrever outro).
  const abertoRef = useRef(/** @type {string|null} */ (null));
  abertoRef.current = controller.showForm && controller.editingItem?.id ? String(controller.editingItem.id) : null;

  const tratarErro = (err, fallback) => {
    if (ehNaoEncontradoPatrimonio(err)) {
      invalidar();
      controller.recordHelpers.closeForm();
    } else if (ehConflitoDeVersaoPatrimonio(err)) {
      // Outra pessoa gravou antes: a lista e o registro aberto são relidos com
      // a versão atual (o formulário volta a ela; sem isso cada nova gravação
      // reenviaria a versão velha e daria 409 em laço). Mesmo padrão dos Bens.
      invalidar();
      const id = abertoRef.current;
      if (id) {
        detalharCatalogo(recurso, id).then(
          (atual) => {
            if (abertoRef.current === id && atual && typeof atual === "object") mostrarRegistro(atual);
          },
          () => {},
        );
        notifyWarning("Atenção", MENSAGEM_VERSAO_RECARREGADA);
        return;
      }
    }
    notifyWarning("Atenção", mensagemErroPatrimonio(err, fallback));
  };

  /**
   * Combustível: cria e associa os Produtos escolhidos (resultado por Produto).
   * Antes do POST confere o código: já existe → nada é criado nem associado.
   * Criação incerta (rede/prazo/falha interna) → procura pelo código único;
   * só é deste pedido o que não existia na conferência (mesmo nome, ativo) →
   * segue como criado (sem 2º POST); não achou → "não foi gravado"; achou
   * outro → "já existe"; leitura falhou ou conferência sem resposta → pede
   * conferência. Nunca recria às cegas nem dá como criado o que já existia.
   * @param {Record<string, any>} data
   */
  const criarCombustivel = async (data) => {
    const pendentes = Array.isArray(data.produtos_pendentes) ? data.produtos_pendentes : [];
    const empresaDosPendentes = typeof data.empresa_pendentes === "string" && data.empresa_pendentes ? data.empresa_pendentes : null;
    const codigo = String(data.codigo ?? "");
    /** @type {any} */
    let existente = null;
    let ausenteAntes = false;
    try {
      existente = await buscarCombustivelPorCodigo(codigo);
      ausenteAntes = !existente;
    } catch {
      // Sem resposta: o POST segue (o servidor barra o código repetido), mas uma
      // resposta perdida não poderá dar o achado como deste pedido.
    }
    if (existente) throw erroDeCriacao(MENSAGEM_JA_EXISTE);
    /** @type {any} */
    let criado;
    let incerto = false;
    try {
      criado = await criarCatalogo(recurso, data);
    } catch (err) {
      if (!ehResultadoIncerto(err)) throw err;
      /** @type {Awaited<ReturnType<typeof localizarCombustivelCriado>>} */
      let achado;
      try {
        achado = await localizarCombustivelCriado({ codigo, nome: String(data.nome ?? ""), ausenteAntes });
      } catch {
        throw erroDeCriacao(MENSAGEM_NAO_CONFIRMADO);
      }
      if (achado.situacao === "ausente") throw erroDeCriacao(MENSAGEM_NAO_GRAVADO);
      if (achado.situacao === "outro") throw erroDeCriacao(MENSAGEM_JA_EXISTE);
      if (achado.situacao !== "criado") throw erroDeCriacao(MENSAGEM_NAO_CONFIRMADO);
      criado = achado.combustivel;
      incerto = true;
    }
    const tipoId = criado && typeof criado === "object" && criado.id ? String(criado.id) : null;
    if (!pendentes.length || !tipoId) return { criado, incerto, associacao: null, fazendaMudou: false };
    if (!empresaDosPendentes || empresaDosPendentes !== empresaAtualRef.current) return { criado, incerto, associacao: null, fazendaMudou: true };
    // Nome da fazenda capturado no envio: o aviso a nomeia se a tela mudar de fazenda no meio.
    const empresaNomeDosPendentes = nomeDaEmpresa(empresaDosPendentes);
    const resultado = await associarProdutosAoCombustivel(empresaDosPendentes, tipoId, pendentes);
    return {
      criado,
      incerto,
      associacao: { empresaId: empresaDosPendentes, empresaNome: empresaNomeDosPendentes, tipoId, total: pendentes.length, ...resultado },
      fazendaMudou: false,
    };
  };

  /** @param {any} r resultado de `criarCombustivel` */
  const avisarCriacaoDeCombustivel = (r) => {
    const sufixo = r.incerto ? SUFIXO_CRIACAO_INCERTA : "";
    if (r.fazendaMudou) {
      notifyWarning("Atenção", `${AVISO_FAZENDA_MUDOU_NA_CRIACAO}${sufixo}`);
      return;
    }
    const a = r.associacao;
    if (!a) {
      notifySuccess("Sucesso", `${cfg.criado}${r.incerto ? `.${sufixo}` : ""}`);
      return;
    }
    // A fazenda do topo mudou durante a associação: os vínculos foram para a de
    // origem (certo), então o aviso a nomeia em vez de dizer "nesta fazenda".
    const outraFazenda = a.empresaId !== empresaAtualRef.current;
    const origem = a.empresaNome ? `na fazenda anterior (${a.empresaNome})` : "na fazenda anterior";
    if (!a.falhas.length) {
      const base = `Combustível criado com ${a.total} produto(s) associado(s) ${outraFazenda ? origem : "nesta fazenda"}`;
      const conferir = outraFazenda ? " Para conferir, volte para essa fazenda no topo da tela." : "";
      notifySuccess("Sucesso", outraFazenda || r.incerto ? `${base}.${conferir}${sufixo}` : base);
      return;
    }
    // Alguma falha: NUNCA sucesso. O registro abre com "Não associados" (na fazenda de origem).
    notifyWarning(
      "Atenção",
      outraFazenda
        ? `Combustível criado, mas ${a.falhas.length} de ${a.total} produto(s) não foram associados ${origem}. Volte para essa fazenda no topo da tela para ver "Não associados" e tentar de novo.${sufixo}`
        : `Combustível criado, mas ${a.falhas.length} de ${a.total} produto(s) não foram associados. Veja "Não associados" e tente de novo.${sufixo}`,
    );
  };

  const createMutation = useMutation({
    /** @param {{ data: object }} v */
    mutationFn: async ({ data }) =>
      ehCombustiveis
        ? criarCombustivel(/** @type {Record<string, any>} */ (data))
        : { criado: await criarCatalogo(recurso, /** @type {Record<string, any>} */ (data)), incerto: false, associacao: null, fazendaMudou: false },
    onSuccess: (r) => {
      invalidar();
      const criado = r.criado;
      if (ehCombustiveis && r.associacao) guardarFalhasDoRegistro(r.associacao.empresaId, r.associacao.tipoId, r.associacao.falhas);
      if (criado && typeof criado === "object" && "id" in criado && criado.id) {
        mostrarRegistro(criado);
        controller.recordHelpers.chrome.onSelectionChange([String(criado.id)]);
      } else {
        controller.recordHelpers.closeForm();
      }
      if (ehCombustiveis) avisarCriacaoDeCombustivel(r);
      else notifySuccess("Sucesso", cfg.criado);
    },
    onError: (err) => {
      const local = /** @type {any} */ (err)?.mensagemCriacao;
      if (typeof local === "string" && local) {
        // Criação incerta: o formulário continua aberto com os Produtos escolhidos.
        invalidar();
        notifyWarning("Atenção", local);
        return;
      }
      tratarErro(err, `Não foi possível salvar o cadastro (${cfg.rotulo}).`);
    },
  });

  const updateMutation = useMutation({
    /** @param {{ original: any, data: object }} v */
    mutationFn: ({ original, data }) => atualizarCatalogo(recurso, original, /** @type {Record<string, any>} */ (data)),
    onSuccess: ({ alterado, registro }) => {
      if (!alterado) {
        controller.setIsEditing(false);
        notifyInfo("Sem alterações", "Nada foi alterado.");
        return;
      }
      invalidar();
      mostrarRegistro(registro);
      notifySuccess("Sucesso", cfg.atualizado);
    },
    onError: (err) => tratarErro(err, `Não foi possível salvar o cadastro (${cfg.rotulo}).`),
  });

  const situacaoMutation = useMutation({
    /** @param {{ alvo: any, ativo: boolean }} v */
    mutationFn: ({ alvo, ativo }) => alterarSituacaoCatalogo(recurso, alvo, ativo),
    onSuccess: (registro, { alvo, ativo }) => {
      invalidar();
      const aberto = controller.showForm && String(controller.editingItem?.id) === String(alvo.id);
      if (aberto && registro && typeof registro === "object") mostrarRegistro(registro);
      notifySuccess("Sucesso", ativo ? cfg.reativado : cfg.inativado);
    },
    onError: (err, { ativo }) => tratarErro(err, ativo ? "Não foi possível reativar." : "Não foi possível inativar."),
  });

  const padraoMutation = useMutation({
    mutationFn: () => instalarCatalogoPadrao(),
    onSuccess: (resultado) => {
      queryClient.invalidateQueries({ queryKey: [QUERY_RAIZ] });
      queryClient.invalidateQueries({ queryKey: QUERY_OPCOES });
      setResumoPadrao(resumoCatalogoPadrao(resultado));
      notifySuccess("Catálogo padrão", "Instalação concluída. Confira o resumo acima da lista.");
    },
    onError: (err) => notifyWarning("Atenção", mensagemErroPatrimonio(err, "Não foi possível instalar o catálogo padrão.")),
  });

  submitRef.current = (data) => {
    const original = controller.editingItem;
    if (original?.id) {
      if (!acoes.editar) return;
      updateMutation.mutate({ original, data });
    } else {
      if (!acoes.criar) return;
      createMutation.mutate({ data });
    }
  };

  /** @param {any} alvo @param {boolean} ativo */
  const pedirSituacao = async (alvo, ativo) => {
    const verbo = ativo ? "Reativar" : "Inativar";
    const ok = await confirmar({
      titulo: `${verbo} ${cfg.rotulo}`,
      descricao: `${verbo} "${alvo.nome || cfg.rotulo}"? ${ativo ? cfg.efeitoReativar : cfg.efeitoInativar}`,
      textoConfirmar: verbo,
      perigo: !ativo,
    });
    if (ok) situacaoMutation.mutate({ alvo, ativo });
  };

  const pedirCatalogoPadrao = async () => {
    const ok = await confirmar({
      titulo: "Instalar catálogo padrão",
      descricao:
        "Cria só o que ainda falta, pelo código: famílias, tipos, perfis de medição e combustíveis de uso comum. Nada do que já existe é alterado; itens com o mesmo código e outra classificação aparecem como conflito.",
      textoConfirmar: "Instalar",
    });
    if (ok) padraoMutation.mutate();
  };

  const saving = createMutation.isPending || updateMutation.isPending || situacaoMutation.isPending;
  const registroAtual = controller.editingItem;

  // Alvo de inativar/reativar: o registro aberto (fora da edição) ou a única linha selecionada.
  const alvo = useMemo(() => {
    if (controller.showForm) return registroAtual?.id && !controller.isEditing ? registroAtual : null;
    const ids = controller.chrome.selectedIds;
    if (ids.length !== 1) return null;
    return controller.visibleRows.find((r) => String(r.id) === String(ids[0])) ?? null;
  }, [controller.showForm, controller.isEditing, registroAtual, controller.chrome.selectedIds, controller.visibleRows]);

  /** @type {Array<{ key: string, label: string, disabled?: boolean, onSelect: () => void }>} */
  const acoesDoMenu = [];
  if (acoes.inativar && alvo && Number.isInteger(alvo.versao)) {
    const reativar = alvo.ativo === false;
    acoesDoMenu.push({
      key: reativar ? "reativar" : "inativar",
      label: `${reativar ? "Reativar" : "Inativar"} ${cfg.rotulo}`,
      disabled: situacaoMutation.isPending,
      onSelect: () => {
        pedirSituacao(alvo, reativar);
      },
    });
  }
  if (ehFamilias && acoes.administrador) {
    acoesDoMenu.push({
      key: "catalogo-padrao",
      label: "Instalar catálogo padrão",
      disabled: padraoMutation.isPending,
      onSelect: () => {
        pedirCatalogoPadrao();
      },
    });
  }

  const listErrorMessage = useMemo(
    () => mensagemErroPatrimonio(controller.listaQueryError, `Não foi possível carregar ${cfg.plural}. Verifique sua conexão e tente novamente.`),
    [controller.listaQueryError, cfg.plural],
  );

  const semPermissao = !acoes.carregando && !acoes.ver;
  const Formulario = cfg.Formulario;

  // Combustíveis: no registro GRAVADO (leitura e edição), os Produtos associados
  // NESTA fazenda. `key` empresa+combustível: trocar de registro ou de fazenda zera a seção.
  const tipoAberto = ehCombustiveis && registroAtual?.id ? String(registroAtual.id) : null;
  const falhasDoAberto = tipoAberto && empresaId ? (falhasPorRegistro[`${empresaId}:${tipoAberto}`] ?? null) : null;
  const produtosVinculados =
    ehCombustiveis && acoes.ver && tipoAberto ? (
      <ProdutosDoCombustivel
        key={`${empresaId ?? "sem-empresa"}:${tipoAberto}`}
        empresaId={empresaId}
        empresaNome={empresaNome}
        combustivel={{ id: tipoAberto, nome: registroAtual.nome ?? null, ativo: registroAtual.ativo !== false, unidade: registroAtual.unidade ?? null }}
        acoes={{ criar: acoes.criar, inativar: acoes.inativar }}
        editando={controller.isEditing}
        falhasGuardadas={falhasDoAberto}
        // Empresa e combustível do CLIQUE (a seção pode ter remontado antes da resposta).
        onFalhasChange={({ empresaId: emp, tipoId: tipo, falhas }) => guardarFalhasDoRegistro(emp, tipo, falhas)}
      />
    ) : null;

  /** Cancelar a edição de um registro gravado descarta o digitado: o formulário remonta do registro. */
  const cancelarEdicao = () => {
    if (controller.isEditing && controller.editingItem?.id) controller.recordHelpers.bumpFormEpoch();
    controller.cancelForm();
  };

  return (
    // Os botões já seguem a regra EXATA do servidor (novo|salvar, editar|salvar,
    // inativar) — a heurística de texto do Layout não se aplica.
    <div data-permissao-explicita="" className="contents">
      <CadastroBase1Screen
        permissaoExplicita
        workspaceTitle={cfg.titulo}
        searchPlaceholder={`Buscar ${cfg.plural}…`}
        formId={cfg.formId}
        columnsForCardsToolbar={cfg.grade.colunas}
        controller={{ ...controller, saving, cancelForm: cancelarEdicao }}
        listErrorMessage={listErrorMessage}
        recordCode={registroAtual?.id && registroAtual?.codigo ? String(registroAtual.codigo) : undefined}
        listBanner={
          semPermissao || resumoPadrao ? (
            <>
              {semPermissao ? <AvisoGestao testId="patrimonio-sem-permissao">Você não tem permissão para visualizar {cfg.titulo}.</AvisoGestao> : null}
              {resumoPadrao ? <ResumoCatalogoPadrao resumo={resumoPadrao} onFechar={() => setResumoPadrao(null)} /> : null}
            </>
          ) : null
        }
        showCreate={acoes.criar}
        showDuplicate={acoes.criar}
        showEdit={acoes.editar}
        showDelete={false}
        extraToolbar={
          <>
            {ehFamilias ? <FiltroOpcoes rotulo="Filtrar por natureza" value={natureza} onChange={setNatureza} opcoes={OPCOES_FILTRO_NATUREZA} /> : null}
            <FiltroSituacao value={situacao} onChange={setSituacao} />
          </>
        }
        additionalMoreActions={acoesDoMenu.length ? acoesDoMenu : null}
        deleteDialog={{
          title: `Inativar ${cfg.rotulo}`,
          confirmText: "Inativar",
          descriptionOne: cfg.efeitoInativar,
          descriptionMany: () => cfg.efeitoInativar,
        }}
        recordForm={
          <>
            <Formulario
              key={`${registroAtual?.id ?? `${recurso}-novo`}-${controller.formEpoch}`}
              readOnly={!controller.isEditing}
              initialData={registroAtual}
              onSubmit={controller.handleSubmit}
              {...(ehCombustiveis ? { empresaId, empresaNome, salvando: createMutation.isPending } : {})}
            />
            {produtosVinculados}
          </>
        }
        listSlot={
          <GradePatrimonio
            definicao={cfg.grade}
            rows={controller.visibleRows}
            onEdit={controller.handleEdit}
            isLoading={controller.isLoading}
            emptyText={cfg.vazio}
            showConfigColunas={controller.showConfigColunas}
            setShowConfigColunas={controller.setShowConfigColunas}
            matchesSearch={controller.matchesSearch}
            resetFiltersKey={controller.chrome.resetFiltersKey}
            onSelectionChange={controller.chrome.onSelectionChange}
            onFiltersActiveChange={controller.chrome.setFiltersActive}
            viewMode={controller.chrome.viewMode === "cards" ? "cards" : "table"}
            cardFields={controller.cardsPrefs.cardFields}
            cardsPerRow={controller.cardsPrefs.cardsPerRow}
            configureColumnsAnchorRef={controller.configureColumnsAnchorRef}
          />
        }
      />
    </div>
  );
}
