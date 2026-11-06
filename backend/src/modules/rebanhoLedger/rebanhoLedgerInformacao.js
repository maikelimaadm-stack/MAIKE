/**
 * Editar Informação da POSIÇÃO do rebanho (grupo de animais numa área) — D-PROD-139.
 *
 * O botão "Editar Informação" do Detalhes do Lote, no controle por posições,
 * mudava nada (toast "renomeie no Cadastro de Lotes"). Aqui ele passa a editar os
 * dados DESCRITIVOS da posição — o que o mapa mostra sobre aquele grupo:
 *
 *   editável na posição      nome, identificador_nome, identificador_sigla, identificador_cor
 *   somente leitura          numero_lote, origem/linhagem, lote_entrada_id, raça, sistema,
 *                            data de entrada (cadastro da entrada)
 *   exige comando de manejo  quantidade, área, peso, categoria, sexo, categoria de manejo
 *                            (transferir, pesar, mudar categoria — motor do ledger)
 *
 * Por que é seguro editar estes quatro campos por posição:
 *  - A identidade da posição (`chave_identidade` = origem + categoria + sexo +
 *    categoria de manejo) NÃO usa nome nem identificação. Trocar o nome não funde,
 *    não separa e não reencontra outra posição; nenhuma outra posição muda.
 *  - Saldo, partidas, pesos, eventos e data operacional não são tocados: não há
 *    evento do ledger nem movimentação por trocar um dado descritivo.
 *  - O cadastro da entrada (`Lote`) não é escrito.
 *
 * Interações conhecidas (documentadas, não são defeito):
 *  - Transferência para uma área onde a mesma identidade ainda não existe cria a
 *    posição de destino com o nome da origem (`moldeDe`) — leva o nome editado.
 *    Se a identidade já existe no destino, o destino mantém o nome dele.
 *  - Renomear o lote no Cadastro de Lotes continua propagando o campo renomeado a
 *    todas as posições daquela entrada (loteService, "nome e identificação do
 *    cadastro acompanham as posições"), sobrescrevendo a edição feita aqui.
 *
 * Contrato: tenant do auth_context; a posição precisa ser do tenant E da empresa
 * informada (senão 404, igual para outro tenant e outra empresa); ledger ativo
 * na empresa (409); posição com cabeças (409 — a vazia não aparece no mapa).
 * Trava a posição (FOR UPDATE) e audita antes/depois na mesma transação.
 */

import { getPrismaClient } from '../../database/prismaClient.js';
import { exigirAuthContext } from '../../shared/auth/authContext.js';
import { registrarEvento } from '../auditoria/auditService.js';
import { ativacaoDaEmpresa, comoPosicaoPublica, invalido, recusa, travarPosicoes } from './rebanhoLedgerNucleo.js';

/** Únicos campos que este comando grava. */
export const CAMPOS_INFORMACAO_POSICAO = Object.freeze(['nome', 'identificador_nome', 'identificador_sigla', 'identificador_cor']);

const LIMITES = Object.freeze({ nome: 255, identificador_nome: 255, identificador_sigla: 32, identificador_cor: 32 });

/** Normaliza: texto aparado; nos opcionais, vazio vira null; o nome é obrigatório. */
const normalizar = (entrada) => {
  /** @type {Record<string, string|null>} */
  const out = {};
  for (const campo of CAMPOS_INFORMACAO_POSICAO) {
    if (!Object.prototype.hasOwnProperty.call(entrada, campo)) continue;
    const bruto = entrada[campo];
    const texto = typeof bruto === 'string' ? bruto.trim() : null;
    if (campo === 'nome') {
      if (!texto) throw invalido('o nome da posição não pode ficar vazio', { field: 'nome' });
      out.nome = texto;
    } else {
      out[campo] = texto ? texto : null;
    }
    if (out[campo] && out[campo].length > LIMITES[campo]) throw invalido(`${campo} excede ${LIMITES[campo]} caracteres`, { field: campo });
  }
  return out;
};

/**
 * @param {{requestId?: string, auth: import('../../shared/auth/authContext.js').AuthContext}} contexto
 * @param {string} posicaoId
 * @param {Record<string, unknown>} entrada corpo já validado pelo schema estrito da rota
 */
export const editarInformacaoPosicao = async (contexto, posicaoId, entrada) => {
  const auth = exigirAuthContext(contexto?.auth);
  const empresaId = String(entrada.empresa_id);
  const patch = normalizar(entrada);
  const prisma = getPrismaClient();
  return prisma.$transaction(async (tx) => {
    if (!(await ativacaoDaEmpresa(tx, auth.clienteId, empresaId))) {
      throw recusa('REBANHO_LEDGER_INATIVO', 'o ledger de posições não está ativo nesta empresa');
    }
    const travadas = await travarPosicoes(tx, auth.clienteId, [posicaoId]);
    const antes = travadas.get(posicaoId);
    // Outro tenant (o FOR UPDATE já filtra por cliente_id) e outra empresa: a mesma resposta.
    if (!antes || antes.empresa_id !== empresaId) {
      throw recusa('POSICAO_REBANHO_NOT_FOUND', 'posição do rebanho não encontrada nesta empresa');
    }
    if (antes.quantidade_cabecas <= 0) {
      throw recusa('POSICAO_REBANHO_VAZIA', 'a posição não tem cabeças; edite o grupo que está na área', { posicao_id: posicaoId });
    }
    const mudancas = Object.fromEntries(Object.entries(patch).filter(([campo, valor]) => (antes[campo] ?? null) !== valor));
    const incluir = { area: { select: { nome: true } }, loteEntrada: { select: { raca_predominante: true, sistema_produtivo: true, data_entrada: true } } };
    if (!Object.keys(mudancas).length) {
      const atual = await tx.posicaoRebanho.findUnique({ where: { cliente_id_id: { cliente_id: auth.clienteId, id: posicaoId } }, include: incluir });
      return { alterados: [], posicao: comoPosicaoPublica(atual) };
    }
    const depois = await tx.posicaoRebanho.update({
      where: { cliente_id_id: { cliente_id: auth.clienteId, id: posicaoId } },
      data: mudancas,
      include: incluir,
    });
    await registrarEvento(
      contexto,
      {
        acao: 'update',
        entidade: 'PosicaoRebanho',
        entidadeId: posicaoId,
        dadosAnteriores: { ...comoPosicaoPublica(antes), campos_alterados: Object.keys(mudancas) },
        dadosNovos: { ...comoPosicaoPublica(depois), comando: 'editar_informacao_posicao' },
      },
      tx
    );
    return { alterados: Object.keys(mudancas), posicao: comoPosicaoPublica(depois) };
  });
};
