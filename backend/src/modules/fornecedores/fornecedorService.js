/**
 * Serviço de Fornecedor (P5.4).
 */
import { getPrismaClient } from '../../database/prismaClient.js';
import { exigirAuthContext } from '../../shared/auth/authContext.js';
import { AppError } from '../../shared/errors/AppError.js';
import { registrarEvento } from '../auditoria/auditService.js';
import { exigirSomenteColunasGravaveis } from '../../shared/prisma/colunasGravaveis.js';
import { carregarAutorizacao, acessoTotal } from '../../shared/auth/autorizacaoTela.js';
import { reservarNumero, ESCOPO_TENANT } from '../sequencias/entidadeCodigoService.js';
import {
  listarRegistros,
  buscarRegistro,
  inserirRegistro,
  atualizarRegistroPorId,
  excluirRegistroPorId,
} from './fornecedorRepository.js';
import { comoAuditoriaFornecedor, camposAlterados, exigirDocumentosDoLegado, mascararCpf } from './fornecedorDominio.js';
import { exigirEmpresaDoTenant } from '../gestao/gestaoComum.js';

export { mascararCpf };

export const ENTIDADE_SEQUENCIA = 'Fornecedor';

const erroNaoEncontrado = () => new AppError('FORNECEDOR_NOT_FOUND', 'Fornecedor não encontrado');

/** @param {Record<string, unknown>} registro */
export const comoPublico = (registro) => {
  // eslint-disable-next-line no-unused-vars -- tenant não exposto na API pública
  const { createdAt, updatedAt, cliente_id, ...resto } = registro;
  return {
    ...resto,
    created_date: createdAt instanceof Date ? createdAt.toISOString() : createdAt,
    updated_date: updatedAt instanceof Date ? updatedAt.toISOString() : updatedAt,
  };
};

/**
 * D-PROD-137 (GET-04) — o que o seletor de fornecedor do Cadastro de Lotes usa
 * (FormularioLote: nome, busca por nome/cpf/cnpj/cidade/estado, cidade/estado de
 * origem, `empresa_id` para o filtro da empresa). ALLOWLIST: RG, nascimento,
 * IE, responsável, telefone, e-mail, endereço, CEP, IBGE e observações ficam de
 * fora — nenhuma tela de quem só cadastra lote os mostra.
 */
const CAMPOS_SELETOR = Object.freeze([
  'id', 'empresa_id', 'numero_cadastro', 'tipo_pessoa', 'nome', 'razao_social', 'cnpj', 'cidade', 'estado', 'tipos', 'ativo',
]);


/** @param {Record<string, unknown>} registro */
export const comoItemDoSeletor = (registro) => {
  /** @type {Record<string, unknown>} */
  const saida = {};
  for (const campo of CAMPOS_SELETOR) saida[campo] = registro[campo] ?? null;
  saida.cpf = mascararCpf(registro.cpf);
  const { createdAt, updatedAt } = registro;
  saida.created_date = createdAt instanceof Date ? createdAt.toISOString() : createdAt;
  saida.updated_date = updatedAt instanceof Date ? updatedAt.toISOString() : updatedAt;
  return saida;
};

/**
 * A rota já exige o Cadastro de Lotes (ou acesso total). Registro completo só
 * com acesso total (administrador real ou `is_admin`); a tela de Lotes recebe a
 * projeção do seletor.
 * @param {{auth: import('../../shared/auth/authContext.js').AuthContext}} contexto
 */
export const listar = async (contexto, filtros = {}) => {
  const auth = exigirAuthContext(contexto?.auth);
  const [registros, aut] = await Promise.all([listarRegistros(auth.clienteId, filtros), carregarAutorizacao(contexto)]);
  return registros.map(acessoTotal(aut) ? comoPublico : comoItemDoSeletor);
};

/** @param {{requestId: string, auth: import('../../shared/auth/authContext.js').AuthContext}} contexto */
export const criar = async (contexto, entrada) => {
  const auth = exigirAuthContext(contexto?.auth);
  const prisma = getPrismaClient();
  const criado = await prisma.$transaction(async (tx) => {
    /** @type {Record<string, unknown>} */
    const dados = { ...exigirSomenteColunasGravaveis('Fornecedor', entrada), cliente_id: auth.clienteId };
    // B2/R2: empresa real DESTE tenant, obrigatória (falha fechada: 400 sem, 404 fora).
    dados.empresa_id = await exigirEmpresaDoTenant(tx, auth.clienteId, dados.empresa_id);
    await exigirDocumentosDoLegado(tx, auth.clienteId, /** @type {string} */ (dados.empresa_id), dados);
    if (!dados.numero_cadastro) {
      dados.numero_cadastro = String(
        await reservarNumero(tx, {
          clienteId: auth.clienteId,
          entidade: ENTIDADE_SEQUENCIA,
          escopoTipo: ESCOPO_TENANT,
        })
      );
    }
    const registro = await inserirRegistro(tx, dados);
    await registrarEvento(
      contexto,
      { acao: 'create', entidade: 'Fornecedor', entidadeId: registro.id, dadosNovos: { ...comoAuditoriaFornecedor(registro), via: 'fornecedores' } },
      tx
    );
    return registro;
  });
  return comoPublico(criado);
};

export const atualizar = async (contexto, id, entrada) => {
  const auth = exigirAuthContext(contexto?.auth);
  const prisma = getPrismaClient();
  const atualizado = await prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT id FROM "Fornecedor" WHERE cliente_id = ${auth.clienteId} AND id = ${id} FOR UPDATE`;
    const existente = await buscarRegistro(auth.clienteId, id, tx);
    if (!existente) throw erroNaoEncontrado();
    const dados = exigirSomenteColunasGravaveis('Fornecedor', entrada);
    // B2/R2: identidade e empresa são imutáveis aqui. O mesmo valor atual é
    // aceito como no-op (compatibilidade); mover o fornecedor de empresa ou
    // trocar número/id nunca (deixaria Lote/nota/movimentação apontando para
    // um fornecedor de outra empresa).
    const imutavel = (field) => new AppError('REQUEST_VALIDATION_FAILED', `${field} não pode ser alterado`, { details: { field, reason: 'imutavel' } });
    if (entrada && typeof entrada === 'object' && 'id' in entrada && entrada.id !== id) throw imutavel('id');
    if ('empresa_id' in dados) {
      if (dados.empresa_id !== existente.empresa_id) throw imutavel('empresa_id');
      delete dados.empresa_id;
    }
    if ('numero_cadastro' in dados) {
      if (dados.numero_cadastro !== existente.numero_cadastro) throw imutavel('numero_cadastro');
      delete dados.numero_cadastro;
    }
    await exigirDocumentosDoLegado(tx, auth.clienteId, String(existente.empresa_id), dados, existente);
    const registro = await atualizarRegistroPorId(tx, auth.clienteId, id, dados);
    await registrarEvento(
      contexto,
      {
        acao: 'update',
        entidade: 'Fornecedor',
        entidadeId: id,
        dadosAnteriores: comoAuditoriaFornecedor(existente),
        dadosNovos: { ...comoAuditoriaFornecedor(registro), via: 'fornecedores', campos_alterados: camposAlterados(existente, registro) },
      },
      tx
    );
    return registro;
  });
  return comoPublico(atualizado);
};

export const excluir = async (contexto, id) => {
  const auth = exigirAuthContext(contexto?.auth);
  const prisma = getPrismaClient();
  await prisma.$transaction(async (tx) => {
    // Trava o parceiro ANTES das contagens (o mesmo padrão de `atualizar` e da
    // exclusão da empresa): quem está gravando um bem, lote ou lançamento com
    // ele segura a linha (FOR KEY SHARE/FK) e esta exclusão espera o commit;
    // as contagens seguintes já o veem e o 409 sai no lugar do 403 da FK.
    await tx.$queryRaw`SELECT id FROM "Fornecedor" WHERE cliente_id = ${auth.clienteId} AND id = ${id} FOR UPDATE`;
    const existente = await buscarRegistro(auth.clienteId, id, tx);
    if (!existente) throw erroNaoEncontrado();
    // D-PROD-146 (R1): parceiro com histórico não some (o nome tem de continuar
    // resolvendo em Lote, nota e movimentação); a tela Parceiros inativa.
    // D-PROD-155 (§8.5): lançamento financeiro (rascunho inclusive, que não gera
    // movimento) e títulos também seguram o parceiro — sem isto, a FK RESTRICT
    // devolvia o enganoso 403 TENANT_SCOPE_VIOLATION.
    // D-PROD-157: bem patrimonial que o tem como proprietário OU fornecedor
    // também o segura (mesma FK RESTRICT; mesmo 409, nunca 403).
    // D-PROD-207: linha de serviço de atividade com ele como prestador também (mesma FK RESTRICT).
    const [lotes, notas, movimentacoes, operacoesFinanceiras, titulos, bens, servicosAtividade] = await Promise.all([
      tx.lote.count({ where: { cliente_id: auth.clienteId, fornecedor_id: id } }),
      tx.estoqueLoteNota.count({ where: { cliente_id: auth.clienteId, fornecedor_id: id } }),
      tx.movimentacaoEstoque.count({ where: { cliente_id: auth.clienteId, fornecedor_id: id } }),
      tx.operacaoFinanceira.count({ where: { cliente_id: auth.clienteId, parceiro_id: id } }),
      tx.tituloFinanceiro.count({ where: { cliente_id: auth.clienteId, parceiro_id: id } }),
      tx.bemPatrimonial.count({ where: { cliente_id: auth.clienteId, OR: [{ proprietario_parceiro_id: id }, { fornecedor_parceiro_id: id }] } }),
      tx.atividadeApontamentoServico.count({ where: { cliente_id: auth.clienteId, fornecedor_parceiro_id: id } }),
    ]);
    if (lotes + notas + movimentacoes + operacoesFinanceiras + titulos + bens + servicosAtividade > 0) {
      throw new AppError('PARCEIRO_EM_USO', 'fornecedor com histórico não pode ser excluído; inative-o na tela Parceiros', {
        // D-PROD-207: a contagem das linhas de serviço só aparece quando há (os `details` de antes não mudam).
        details: { lotes, notas, movimentacoes, operacoes_financeiras: operacoesFinanceiras, titulos, bens, ...(servicosAtividade ? { servicos_atividade: servicosAtividade } : {}) },
      });
    }
    await excluirRegistroPorId(tx, auth.clienteId, id);
    await registrarEvento(
      contexto,
      { acao: 'delete', entidade: 'Fornecedor', entidadeId: id, dadosAnteriores: { ...comoAuditoriaFornecedor(existente), via: 'fornecedores' } },
      tx
    );
  });
};
