/**
 * Service de Setores (P1.3 · persistência nativa desde a P4.1, D-PROD-25).
 *
 * A página fazia CRUD direto no SDK e decidia bloqueio de exclusão lendo o
 * texto do erro (`message.includes("não é possível excluir")`). A P1.3 trocou
 * isso por código estável; a P4.1 troca o destino do dado.
 *
 * ─── O que saiu daqui: `proximoNumeroSetor` ────────────────────────────────
 *
 * Este arquivo calculava `numero_setor = MAX + 1` sobre a lista carregada. O
 * defeito não é de estilo — é que a lista é uma **fotografia**: dois
 * navegadores criando setor ao mesmo tempo leem o mesmo `MAX`, pedem o mesmo
 * número, e o segundo grava por cima da unicidade que ninguém verificava. O
 * contrato ModeloBase1 proíbe a estratégia por nome
 * (`max_plus_one_numbering`), e desde a P4.1 quem numera é
 * `EntidadeCodigoSequencia`, no backend, dentro da transação da criação.
 *
 * A função foi **removida**, não deixada sem uso: função de numeração parada no
 * módulo é convite para alguém chamá-la de novo.
 *
 * ─── O que a normalização continua fazendo aqui ────────────────────────────
 *
 * Nome e campos de texto em maiúsculas, decimal com vírgula, opcional vazio
 * como `null`. É convenção de apresentação do cadastro, não invariante de
 * dados, e por isso segue no frontend — duplicá-la no backend criaria duas
 * versões da mesma regra, que divergiriam na primeira vez que uma mudasse.
 */

import { listSetores, createSetor, updateSetor, sincronizarReferenciasSetor } from '@/apis/setores';
import { ApiError, API_ERROR_CODES } from '@/apis/_core/ApiError';
import { parseDecimalPtBR, parseInteiroPtBR } from '@/domain/numeroPtBR';

/** @param {any[]} items @param {string} empresaId @returns {any[]} */
const daEmpresa = (items, empresaId) => items.filter((item) => item.empresa_id === empresaId);

/** @returns {Promise<any[]>} */
export const listarSetoresDaEmpresa = async (empresaId) => daEmpresa(await listSetores(), empresaId);

const maiusculoOuNulo = (valor) => {
  const texto = String(valor ?? '').toUpperCase().trim();
  return texto || null;
};

/**
 * Payload normalizado do setor.
 *
 * Preservado exatamente do que a página fazia: nome e campos de texto em
 * maiúsculas, numéricos opcionais como `null` quando vazios.
 */
/**
 * @param {object} dados
 * @param {{empresaId?: string}} [opcoes]
 * @returns {object}
 */
export const normalizarSetor = (dados, { empresaId } = {}) => {
  const payload = {
    ...dados,
    nome: dados.nome?.toUpperCase(),
    sigla: maiusculoOuNulo(dados.sigla),
    responsavel: maiusculoOuNulo(dados.responsavel),
    endereco: maiusculoOuNulo(dados.endereco),
    cidade: maiusculoOuNulo(dados.cidade),
    observacoes: maiusculoOuNulo(dados.observacoes),
    // DBT-25 fechado na P1.4: `parseFloat('12,5')` devolvia 12 e a metade
    // decimal sumia sem aviso. `parseDecimalPtBR` entende vírgula e ponto.
    area_total: parseDecimalPtBR(dados.area_total),
    capacidade_animais: parseInteiroPtBR(dados.capacidade_animais),
  };
  if (empresaId) payload.empresa_id = empresaId;
  return payload;
};

/**
 * Cria o setor.
 *
 * Sem número: `numero_setor` é atribuído pelo backend, na mesma transação da
 * gravação. O objeto normalizado ainda pode carregar campos que a tela juntou
 * (`id`, `created_date`); quem os descarta antes da rede é
 * `src/apis/setores/setorNativePort.js`, que monta o corpo por lista literal.
 *
 * @param {object} dados
 * @param {{empresaId?: string}} [opcoes]
 */
export const criarSetor = async (dados, { empresaId } = {}) =>
  createSetor(normalizarSetor(dados, { empresaId }));

/**
 * Atualiza o setor e, **somente quando o nome mudou**, sincroniza as
 * referências denormalizadas. Sincronizar sempre custaria uma chamada de
 * function a cada edição de área ou capacidade, sem nada para propagar.
 */
/**
 * @param {string} id
 * @param {object} dados
 * @param {{registroAnterior?: object}} [opcoes]
 */
export const atualizarSetor = async (id, dados, { registroAnterior } = {}) => {
  const payload = normalizarSetor(dados);
  const atualizado = await updateSetor(id, payload);
  if ((registroAnterior?.nome || '') !== (atualizado?.nome || '')) {
    await sincronizarReferenciasSetor({ registro: atualizado, registroAnterior });
  }
  return atualizado;
};

/**
 * Exclusão de setor — **fechada** nesta fase, e por decisão, não por omissão.
 *
 * A guarda de vínculo de Setor consulta `AreaPastagem`, `LancamentoTarefa`,
 * `MovimentacaoMapa` e `MovimentacaoPecuaria`, por id **e** por nome
 * denormalizado. As quatro continuam na Base44; o Setor não. Nenhuma das saídas
 * disponíveis é aceitável:
 *
 *   apagar no nativo e conferir vínculo na Base44 → dois sistemas decidindo
 *     uma operação destrutiva, sem transação em volta. Basta uma das metades
 *     falhar para sobrar área apontando para setor que não existe mais;
 *   apagar sem conferir → destrói a integridade que hoje existe;
 *   deixar o frontend "provar" que pode apagar → o cliente decidindo a própria
 *     autorização, que é a definição de porta aberta.
 *
 * A quarta saída é recusar. Recusa **sem requisição**: não há rota de exclusão
 * no backend, e mandar uma chamada que sempre falha só produziria um erro pior.
 *
 * O código é próprio de propósito. `SETOR_DELETE_BLOCKED` significa "existem
 * registros vinculados", e usá-lo aqui afirmaria um vínculo que ninguém
 * verificou — mentira útil que esconderia o motivo real quando a P4.2 abrir a
 * exclusão de verdade.
 *
 * @param {string} id
 * @returns {Promise<never>}
 */
export const excluirSetor = async (id) => {
  throw new ApiError(API_ERROR_CODES.SETOR_DELETE_UNAVAILABLE, {
    operation: 'excluirSetor',
    resource: 'Setor',
    details: { id: typeof id === 'string' ? id : null },
  });
};
