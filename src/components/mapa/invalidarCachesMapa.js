/**
 * Chaves do cache do Mapa Geral (`mapaCacheService`) que cada prefixo de
 * queryKey passado pelos cadastros afeta. Só estas chaves são marcadas para a
 * próxima leitura ir ao servidor: marcar todas fazia cada cadastro disparar
 * ~12 GETs forçados (inclusive com o servidor em cooldown).
 */
const CHAVES_DO_MAPA_POR_PREFIXO = {
  areas: ["areas"],
  pontos: ["pontos"],
  "mapa-pontos": ["pontos"],
  bebedouros: ["pontos"],
  "bebedouros-form": ["pontos"],
  "pontos-suplementacao": ["pontosSuplementacao"],
  "pontos-suplementacao-form": ["pontosSuplementacao"],
  "pontos-supl": ["pontosSuplementacao"],
  "mapa-pontos-supl": ["pontosSuplementacao"],
  "locais-estoque": ["pontosSuplementacao"],
  "saldo-deposito": ["pontosSuplementacao"],
  linhas: ["linhas"],
  "mapa-estoque-lotes": ["estoqueLotes"],
  "estoque-lotes-transferencia": ["estoqueLotes"],
  "lotes-nota-suplementacao": ["estoqueLotes"],
  produtos: ["produtos"],
};

/** Nomes do próprio cache do mapa também valem como prefixo. */
const CHAVES_DO_MAPA = new Set(Object.values(CHAVES_DO_MAPA_POR_PREFIXO).flat());

let geracaoInvalidacao = 0;
/** @type {Map<string, number>} última geração marcada por chave do cache do mapa */
const geracaoMarcada = new Map();
/** @type {Map<string, number>} geração já atendida por chave do cache do mapa */
const geracaoAtendida = new Map();

/**
 * Invalida as leituras do Mapa Geral e das telas de cadastro do mapa depois de
 * criar, editar ou excluir área, ponto, linha, cocho, depósito ou bebedouro.
 *
 * O Mapa Geral lê tudo pela chave `['mapa-cache', <entidade>, <empresa>, ...]`
 * com `staleTime` de 5 minutos; sem esta invalidação ele voltava mostrando o
 * dado antigo depois de um cadastro feito em outra tela.
 *
 * Invalidar o React Query não basta: a leitura do Mapa Geral devolve primeiro
 * a cópia do IndexedDB e o refresh em segundo plano respeita o intervalo
 * mínimo de 60 s (`MIN_REFRESH_INTERVAL_MS`), então voltava a cópia velha. Por
 * isso a chamada também marca uma nova "geração" nas chaves do mapa afetadas
 * pelos `prefixosExtras` (ex.: `'areas'` → `areas`; `'mapa-pontos-supl'` →
 * `pontosSuplementacao`): a próxima leitura DESSAS chaves
 * (`mapaPrecisaBuscarNoServidor`) vai ao servidor com `force`. Prefixo que não
 * corresponde a nenhuma chave do mapa só invalida o React Query.
 *
 * @param {import('@tanstack/react-query').QueryClient} queryClient
 * @param {string[]} [prefixosExtras] primeiros elementos de queryKey a invalidar além do cache do mapa
 */
export function invalidarCachesDoMapa(queryClient, prefixosExtras = []) {
  if (!queryClient) return Promise.resolve();
  const afetadas = new Set();
  for (const prefixo of prefixosExtras) {
    for (const chave of CHAVES_DO_MAPA_POR_PREFIXO[prefixo] || []) afetadas.add(chave);
    if (CHAVES_DO_MAPA.has(prefixo)) afetadas.add(prefixo);
  }
  if (afetadas.size) {
    geracaoInvalidacao += 1;
    for (const chave of afetadas) geracaoMarcada.set(chave, geracaoInvalidacao);
  }
  const prefixos = new Set(["mapa-cache", ...prefixosExtras]);
  return queryClient.invalidateQueries({
    predicate: (query) => Array.isArray(query.queryKey) && prefixos.has(query.queryKey[0]),
  });
}

/**
 * Houve cadastro/exclusão que afeta esta chave do mapa desde a última leitura
 * dela? Devolve `true` uma única vez por chave e por invalidação (consome a
 * marca): quem chama deve então buscar no servidor com `force`. Fica no módulo
 * (e não no componente) porque o Mapa Geral é desmontado enquanto o usuário
 * está no cadastro.
 *
 * @param {string} cacheKey
 * @returns {boolean}
 */
export function mapaPrecisaBuscarNoServidor(cacheKey) {
  const marcada = geracaoMarcada.get(cacheKey) ?? 0;
  const atendida = geracaoAtendida.get(cacheKey) ?? 0;
  if (atendida >= marcada) return false;
  geracaoAtendida.set(cacheKey, marcada);
  return true;
}

/**
 * Chaves do cache do Mapa (`mapaCacheService`) que mostram dado derivado do
 * rebanho (posições, saldo e ocupação da área, pesos, movimentações, descanso).
 */
export const CHAVES_DO_MAPA_DO_REBANHO = Object.freeze(["lotes", "areas", "movimentacoes", "movimentacoesHistorico", "descansoPastos"]);

/**
 * Primeiros elementos de queryKey (React Query) que leem dado do rebanho em
 * qualquer tela: Mapa Geral, Detalhes do Lote, histórico do pasto e do lote,
 * Cadastro de Lotes e suplementação.
 */
export const CONSULTAS_DO_REBANHO = Object.freeze([
  "mapa-cache",
  "mapa-lotes",
  "mapa-areas",
  "detalhes-lote-movimentacoes",
  "lotes",
  "lotes-cadastro",
  "posicoes-rebanho",
  "historico-movimentacoes",
  "historico-registros-lote",
  "historico-abate-curral",
  "historico-lotes-excluidos",
  "elegibilidade-exclusao-movimentacao",
  "lote-correcao-entrada",
  "renomeacoes-lote",
  "rebanho-area-suplementacao",
  "suplementacao-lote",
  "areas",
]);

const CANAL_ENTRE_ABAS = "maike-rebanho";
let canal = null;
const abrirCanal = () => {
  if (canal || typeof BroadcastChannel === "undefined") return canal;
  try {
    canal = new BroadcastChannel(CANAL_ENTRE_ABAS);
  } catch {
    canal = null;
  }
  return canal;
};

/**
 * Depois de QUALQUER gravação no rebanho (movimentação, pesagem, mudança de
 * categoria, junção, morte, abate, nascimento, entrada, correção, exclusão de
 * movimento, edição de posição): relê do servidor, com `force`, as chaves do
 * mapa derivadas do rebanho (o que também grava o IndexedDB), e só então marca
 * como velhas todas as consultas que mostram esse dado. Assim nenhuma tela
 * relê a cópia antiga do IndexedDB nem espera o intervalo de 60 s / staleTime
 * de 5 min (D-PROD-250).
 *
 * Se a leitura do servidor falhar, a chave fica marcada (geração) e a próxima
 * leitura dela no Mapa Geral volta a forçar (e o `atualizar-mapa` sai sem
 * `jaBuscado`). Avisa as outras abas da MESMA sessão (BroadcastChannel, com o
 * `clienteId`) e dispara `atualizar-mapa` para os históricos e para o Mapa Geral
 * redesenhar.
 *
 * @param {import('@tanstack/react-query').QueryClient} queryClient
 * @param {string|null|undefined} empresaId
 * @param {{ propagar?: boolean }} [opcoes] `propagar: false` quando o aviso veio de outra aba
 */
export async function aposEscritaNoRebanho(queryClient, empresaId, { propagar = true } = {}) {
  if (!queryClient) return;
  const servico = await import("@/services/mapaCacheService");
  let falharam = [];
  if (empresaId) {
    // Só conta como relido o que veio do SERVIDOR: em falha de rede o serviço
    // devolve a cópia do aparelho (origem 'cache'), e essa chave fica marcada
    // para a próxima leitura forçar de novo.
    const resultados = await Promise.all(
      CHAVES_DO_MAPA_DO_REBANHO.map((chave) =>
        Promise.resolve()
          .then(() => servico.refreshMapaCacheEntryDetalhado(chave, empresaId, { force: true }))
          .then(
          (r) => r?.origem === "rede",
          () => false
        )
      )
    );
    falharam = CHAVES_DO_MAPA_DO_REBANHO.filter((_, i) => !resultados[i]);
    if (falharam.length) {
      geracaoInvalidacao += 1;
      for (const chave of falharam) geracaoMarcada.set(chave, geracaoInvalidacao);
    }
  }
  const prefixos = new Set(CONSULTAS_DO_REBANHO);
  await queryClient.invalidateQueries({
    predicate: (query) => Array.isArray(query.queryKey) && prefixos.has(query.queryKey[0]),
  });
  try {
    // `jaBuscado` só quando TODAS as chaves vieram do servidor; senão o Mapa Geral
    // força de novo (D-PROD-250).
    window.dispatchEvent(
      new CustomEvent("atualizar-mapa", { detail: { cacheKeys: [...CHAVES_DO_MAPA_DO_REBANHO], jaBuscado: Boolean(empresaId) && falharam.length === 0 } })
    );
  } catch {
    /* sem window (teste/SSR) */
  }
  if (propagar && empresaId) {
    const { getOfflineTenant } = await import("@/lib/offline/offlineTenant");
    const clienteId = getOfflineTenant();
    // Sem sessão conhecida não avisa ninguém: o aviso é só para as abas da MESMA sessão.
    if (clienteId) {
      try {
        abrirCanal()?.postMessage({ tipo: "rebanho-alterado", clienteId, empresaId });
      } catch {
        /* best-effort */
      }
    }
  }
}

/**
 * Escuta as gravações no rebanho feitas em OUTRA aba do mesmo navegador e
 * atualiza esta. Chamar uma vez na raiz do app. Devolve a função que desliga.
 *
 * @param {import('@tanstack/react-query').QueryClient} queryClient
 * @returns {() => void}
 */
export function escutarRebanhoEntreAbas(queryClient) {
  const c = abrirCanal();
  if (!c) return () => {};
  const aoReceber = async (evento) => {
    const dados = evento?.data;
    if (dados?.tipo !== "rebanho-alterado" || !dados.clienteId || !dados.empresaId) return;
    // O canal é da ORIGEM (todas as abas do domínio): só atende aviso da mesma
    // sessão (tenant) e com sessão aberta, senão esta aba leria a empresa de
    // outro tenant com o próprio token e gravaria a resposta (vazia) por cima
    // do cache dela (D-PROD-250).
    const [{ getOfflineTenant }, { hasNativeToken }] = await Promise.all([
      import("@/lib/offline/offlineTenant"),
      import("@/lib/auth/nativeTokenStorage"),
    ]);
    if (!hasNativeToken() || getOfflineTenant() !== dados.clienteId) return;
    await aposEscritaNoRebanho(queryClient, dados.empresaId, { propagar: false });
  };
  c.addEventListener("message", aoReceber);
  return () => c.removeEventListener("message", aoReceber);
}
