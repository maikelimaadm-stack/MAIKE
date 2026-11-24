/**
 * Porta nativa de CategoriaManejo (P5.4).
 */
import { nativeRequest } from '../_core/nativeHttpClient.js';
import { faixaIdadeDaLista } from '@/domain/lotes/categoriaOficialDerivada';
import {
  createOfflineEntityAdapter,
  offlineStorageDisponivel,
} from '@/lib/offline/offlineEntityRuntime';
import { registrarLeiturasOffline } from '@/lib/offline/leiturasOffline';

const RESOURCE = 'CategoriaManejo';
const CAMINHO = '/categorias-manejo';
/**
 * Seletores próprios do cadastro (D-PROD-195), como `/apontamentos-atividade-opcoes`:
 * quem cria ou edita categoria (inclusive pelo cadastro rápido do lote) lista as
 * curvas da fazenda sem precisar da tela de Curvas de Ganho.
 */
const CAMINHO_OPCOES = '/categorias-manejo-opcoes';
export const ENTIDADE_OFFLINE = 'CategoriaManejo';

const ctx = (operation) => ({ operation, resource: RESOURCE });

/**
 * Campos que o cadastro grava. Raça, categoria oficial (texto), ganho de peso
 * anual, os doze GMDs mensais e o vínculo com o ícone oficial
 * (`catalogo_categoria_visual_id`, D-PROD-187) saíram do cadastro: mesmo que
 * um corpo antigo (fila offline gravada antes desta versão) ainda os traga,
 * eles não são enviados.
 */
export const CAMPOS_GRAVAVEIS = Object.freeze([
  'empresa_id',
  'nome',
  'sigla',
  'especie',
  'sexo',
  'idade_minima_meses',
  'idade_maxima_meses',
  // D-PROD-195: a curva de ganho da MESMA fazenda é obrigatória (o servidor recusa ausente ou vazia no POST).
  'curva_ganho_id',
  // D-PROD-198: peso objetivo (kg/cabeça), opcional.
  'peso_objetivo_kg',
  'ativo',
]);

/** @param {Record<string, unknown>} dados */
export const corpoDeEnvio = (dados) =>
  Object.fromEntries(
    CAMPOS_GRAVAVEIS.filter((campo) => Object.prototype.hasOwnProperty.call(dados ?? {}, campo)).map(
      (campo) => [campo, /** @type {Record<string, unknown>} */ (dados)[campo]]
    )
  );

const CHAVES_IDADE = Object.freeze(['idade_minima_meses', 'idade_maxima_meses']);

/**
 * Corpo do PATCH. Uma edição gravada na fila offline pela versão anterior
 * sempre trazia o par de idades (inclusive nulo/nulo ou par livre, como 0/12),
 * que o servidor agora recusa (faixa fora da lista fixa, D-PROD-186) — e um
 * item recusado trava a fila inteira. Se o par enviado não é uma faixa da
 * lista, as duas idades saem do corpo: o resto da edição é aplicado e a faixa
 * gravada fica como está. O formulário atual só manda idade quando a faixa
 * escolhida mudou, e sempre uma faixa da lista.
 * @param {Record<string, unknown>} dados
 */
export const corpoDeEdicao = (dados) => {
  const corpo = corpoDeEnvio(dados);
  const temIdade = CHAVES_IDADE.some((c) => Object.prototype.hasOwnProperty.call(corpo, c));
  if (temIdade && !faixaIdadeDaLista(corpo.idade_minima_meses, corpo.idade_maxima_meses)) {
    for (const c of CHAVES_IDADE) delete corpo[c];
  }
  return corpo;
};

const queryDeFiltro = (criterio) => {
  if (!criterio || typeof criterio !== 'object') return '';
  const params = new URLSearchParams();
  for (const [chave, valor] of Object.entries(criterio)) {
    if (valor === undefined || valor === null || valor === '') continue;
    params.set(chave, String(valor));
  }
  const texto = params.toString();
  return texto ? `?${texto}` : '';
};

const operacoesNativas = Object.freeze({
  list: (ordenacao) => {
    void ordenacao;
    return nativeRequest(CAMINHO, { autenticado: true }, ctx('listCategoriaManejo'));
  },

  create: (dados) =>
    nativeRequest(CAMINHO, { method: 'POST', body: corpoDeEnvio(dados), autenticado: true }, ctx('createCategoriaManejo')),
  update: (id, dados) =>
    nativeRequest(
      `${CAMINHO}/${encodeURIComponent(id)}`,
      { method: 'PATCH', body: corpoDeEdicao(dados), autenticado: true },
      ctx('updateCategoriaManejo')
    ),
  delete: (id) =>
    nativeRequest(
      `${CAMINHO}/${encodeURIComponent(id)}`,
      { method: 'DELETE', autenticado: true },
      ctx('deleteCategoriaManejo')
    ),
});

/**
 * Curvas de ganho da fazenda para o seletor da categoria (D-PROD-195): só
 * online, fora da fila offline (é leitura). Devolve `[{ id, nome, ativo }]` em
 * ordem de nome, ativas e inativas (a gravada pode ter sido inativada).
 * @param {string} empresaId
 */
export const listarOpcoesCurvasGanho = (empresaId) =>
  nativeRequest(
    `${CAMINHO_OPCOES}/curvas-ganho?${new URLSearchParams({ empresa_id: String(empresaId) }).toString()}`,
    { autenticado: true },
    ctx('listOpcoesCurvasGanhoCategoriaManejo'),
  );

/**
 * Criar categoria é SÓ ONLINE desde a D-PROD-195: a curva de ganho é obrigatória
 * e as opções de curva vêm do servidor (`listarOpcoesCurvasGanho`, fora da fila).
 * Por isso o adaptador offline usa `criacao: 'somente_online'` (D-PROD-195 R2):
 *  - a criação vai direto ao servidor (sem conexão, falha na hora) e o registro
 *    confirmado entra no cache offline;
 *  - um POST gravado na fila pela versão anterior (sem `curva_ganho_id`, que o
 *    servidor recusa com `curva_obrigatoria`) fica RETIDO no replay
 *    (`OFFLINE_ENTITY_UNSUPPORTED`), sem ser enviado nem apagado, e não aparece
 *    nas listas; um lote criado offline que aponte para essa categoria fica
 *    retido junto (em qualquer ordem da fila), e a edição de um lote real que
 *    a cite vai sem esse campo — nada vai ao servidor com o id offline; o resto
 *    da fila segue.
 * Listar, editar e excluir seguem com o comportamento offline de sempre.
 */
export const categoriaManejoPort = offlineStorageDisponivel()
  ? createOfflineEntityAdapter({
      entityName: ENTIDADE_OFFLINE,
      operations: operacoesNativas,
      enabled: true,
      criacao: 'somente_online',
    })
  : operacoesNativas;

// D-PROD-291: leituras que as telas deste módulo fazem ao abrir — baixadas antes
// de o app abrir pela primeira vez (o caminho fica aqui, na porta do módulo).
registrarLeiturasOffline([
  '/categorias-manejo',
  '/categorias-manejo-opcoes/curvas-ganho?empresa_id={empresa}',
]);
