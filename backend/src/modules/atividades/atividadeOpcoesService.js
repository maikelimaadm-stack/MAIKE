/**
 * Opções dos seletores PRÓPRIOS da tela Lançamento de Atividades (D-PROD-199,
 * contrato §10): quem só tem a tela `op-atividades` não leva 403 das telas de
 * bens ou de usuários. Mesmo formato das opções do apontamento antigo
 * (`opcoesBens`, `opcoesResponsaveis`): só ATIVOS, keyset (nome, id)
 * crescente, busca literal no servidor e envelope `{ itens, has_more,
 * next_cursor }` (limite padrão 50, máx. 100). `empresa_id` é obrigatório e
 * conferido no tenant da sessão.
 *
 * A opção de máquina é só o resumo do bem (`bemPublico`): o centro de custo
 * do cadastro do bem não vai junto, porque na Fatia 2 os centros da atividade
 * vêm do TIPO (snapshot na abertura), nunca do bem.
 *
 * Tipos, áreas e tarefas reusam as rotas que já existem e só pedem login
 * (`/tipos-atividade`, `/areas-pastagem`, `/lancamentos-tarefa`).
 */

import { getPrismaClient } from '../../database/prismaClient.js';
import { exigirAuthContext } from '../../shared/auth/authContext.js';
import { exigirEmpresaDoTenant } from '../gestao/gestaoComum.js';
import { opcoesResponsaveis } from '../patrimonio/bemPatrimonialOpcoesService.js';
import { paginacaoOpcoes } from '../patrimonio/patrimonioComum.js';
import { bemPublico } from './atividadeComum.js';
import { paginarBensAtivos } from './atividadeRepository.js';

/**
 * Máquinas ATIVAS da empresa (`GET /atividades-opcoes/bens`); `natureza`
 * filtra (uma ou várias); `q` em nome, número ou código de frota.
 * @param {{ auth: import('../../shared/auth/authContext.js').AuthContext }} contexto @param {Record<string, any>} [query]
 */
export const opcoesBens = async (contexto, query = {}) => {
  const auth = exigirAuthContext(contexto?.auth);
  const empresaId = await exigirEmpresaDoTenant(getPrismaClient(), auth.clienteId, query.empresa_id);
  const { limit, cursor, q } = paginacaoOpcoes(query);
  const naturezas = Array.isArray(query.natureza) ? query.natureza : typeof query.natureza === 'string' ? [query.natureza] : [];
  return paginarBensAtivos({ clienteId: auth.clienteId, empresaId, naturezas, q, limit, cursor, mapear: (linhas) => linhas.map(bemPublico) });
};

/**
 * Operadores (`GET /atividades-opcoes/operadores`): usuários ATIVOS do tenant,
 * só `{ id, nome }` (o login é credencial e nunca sai); a empresa é só escopo.
 */
export const opcoesOperadores = opcoesResponsaveis;
