/**
 * D-PROD-254 — REGISTRO DE CAMPO: `POST /atividades/registrar`.
 *
 * Quem está na área (Detalhes da área no mapa ou a tela Atividades) registra o trabalho feito ("Gradeação, trator TP-02,
 * 6,5 h, 7 ha") sem planejar antes. Numa transação só:
 *
 *  1. empresa do tenant, "hoje" no fuso da fazenda, dia não futuro, área do mapa (da fazenda, ativa) e tipo (ativo);
 *  2. trava consultiva por (cliente, empresa, tipo, área, mês do dia) — `pg_advisory_xact_lock` ANTES da busca: dois
 *     registros paralelos da mesma área/tipo/mês se enfileiram e o segundo encontra a atividade criada pelo primeiro;
 *  3. ENTRA na atividade ABERTA do mesmo tipo, da mesma fazenda, com `data_inicio` no MESMO mês do dia do registro
 *     ([1º do mês, 1º do mês seguinte), calculado da string do dia) que contenha a área com status PLANEJADA ou
 *     EM_ANDAMENTO (área CONCLUIDA não casa: abre outra). Havendo mais de uma, entra na de `updatedAt` mais recente
 *     (desempate: `id` maior). Sem nenhuma, CRIA `<Tipo> · <Área> · <mmm/aa>` (`abrirNa`, a regra de abertura de sempre:
 *     área já EM_ANDAMENTO desde o dia do registro, planejada = tamanho da área; tipo que exige máquina usa a primeira
 *     máquina das linhas; safra vem do corpo);
 *  4. área PLANEJADA da atividade existente é iniciada (mesmo efeito de "Iniciar área");
 *  5. o apontamento + linhas são gravados pela MESMA função do `POST …/apontamentos` (`lancarNaTransacao`).
 *
 * Idempotência: `operation_id` obrigatório (recibo `atividade_registrar_v1`; reenvio igual → 200 `replay: true`;
 * corpo diferente → 409). Permissão = a de lançar apontamento (`atividadeApontamentos.criar`). Tenant só do auth_context.
 */

import { exigirAuthContext } from '../../shared/auth/authContext.js';
import { atividadeReferenciaInvalida } from '../../shared/errors/AppError.js';
import { fingerprintDePayload } from '../../shared/idempotency/operacaoIdempotenteService.js';
import { exigirEmpresaDoTenant, invalido } from '../gestao/gestaoComum.js';
import { STATUS_ATIVIDADE, comoData, diaDe, exigirDiaNaoFuturo, idOuNulo, tempoDaFazenda, travarAtividade } from './atividadeComum.js';
import {
  VAZIO,
  camposDoCorpo,
  canonico,
  comReciboOpcional,
  exigirData,
  lancarNaTransacao,
  linhasDoCorpo,
  linhasNovasDoFingerprint,
  origemDoCorpo,
} from './atividadeApontamentoService.js';
import { STATUS_AREA, exigirAreaDoMapa, iniciarAreaNaTransacao } from './atividadeAreaService.js';
import { ehTipoAbastecimento } from '../tiposAtividade/tipoAtividadePadroes.js';
import { lerTipoAtividade } from './atividadeRepository.js';
import { NOME_MAXIMO, abrirNa } from './atividadeService.js';

export const TIPO_OPERACAO_REGISTRAR = 'atividade_registrar_v1';

const MESES = Object.freeze(['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez']);

/** `2026-11-17` → `nov/26`. @param {string} dia */
export const mesAbreviado = (dia) => `${MESES[Number(dia.slice(5, 7)) - 1]}/${dia.slice(2, 4)}`;

/**
 * `<Tipo> · <Área> · <mmm/aa>`, sempre dentro de `NOME_MAXIMO`: passando, a ÁREA é truncada primeiro; se o tipo
 * sozinho já não couber (o tipo aceita até 255 caracteres e o nome da atividade até `NOME_MAXIMO`), o tipo também é truncado.
 * @param {string} tipo @param {string} area @param {string} dia
 */
export const nomeDoRegistro = (tipo, area, dia) => {
  const sep = ' · ';
  const pos = `${sep}${mesAbreviado(dia)}`;
  const AREA_MINIMA = 1;
  const tetoTipo = NOME_MAXIMO - pos.length - sep.length - AREA_MINIMA;
  const t = tipo.length > tetoTipo ? tipo.slice(0, tetoTipo).trimEnd() : tipo;
  const sobra = NOME_MAXIMO - t.length - sep.length - pos.length;
  const a = area.length > sobra ? area.slice(0, Math.max(sobra, AREA_MINIMA)).trimEnd() : area;
  return `${t}${sep}${a}${pos}`.slice(0, NOME_MAXIMO);
};

/** Primeiro dia do mês do dia e do mês seguinte (strings → `Date` UTC de coluna `@db.Date`). @param {string} dia */
export const limitesDoMes = (dia) => {
  const ano = Number(dia.slice(0, 4));
  const mes = Number(dia.slice(5, 7));
  const prox = mes === 12 ? `${ano + 1}-01-01` : `${String(ano).padStart(4, '0')}-${String(mes + 1).padStart(2, '0')}-01`;
  return { de: comoData(`${dia.slice(0, 7)}-01`), ate: comoData(prox) };
};

/**
 * @param {{requestId: string, auth: import('../../shared/auth/authContext.js').AuthContext}} contexto
 * @param {Record<string, any>} corpo
 */
export const registrarCampo = async (contexto, corpo) => {
  const cli = exigirAuthContext(contexto?.auth).clienteId;
  const areaId = idOuNulo(corpo.area_id, 'area_id');
  const tipoId = idOuNulo(corpo.tipo_atividade_id, 'tipo_atividade_id');
  if (!areaId) throw invalido('area_id é obrigatório', { field: 'area_id', reason: 'obrigatorio' });
  if (!tipoId) throw invalido('tipo_atividade_id é obrigatório', { field: 'tipo_atividade_id', reason: 'obrigatorio' });
  const safra = corpo.safra_ciclo === undefined || corpo.safra_ciclo === null ? null : String(corpo.safra_ciclo).trim() || null;
  /** @type {import('./atividadeApontamentoService.js').EstadoDoDia} */
  const estado = { ...VAZIO, ...camposDoCorpo(corpo) };
  exigirData(estado);
  const dia = /** @type {string} */ (estado.data_operacional);
  const origem = origemDoCorpo(corpo.origem);
  const linhas = linhasDoCorpo(corpo);
  if (!linhas.operationId) throw invalido('operation_id é obrigatório', { field: 'operation_id', reason: 'obrigatorio' });

  return comReciboOpcional(contexto, {
    operationId: linhas.operationId,
    tipoOperacao: TIPO_OPERACAO_REGISTRAR,
    fingerprint: () =>
      fingerprintDePayload({
        v: 1, empresa_id: corpo.empresa_id, area_id: areaId, tipo_atividade_id: tipoId, safra_ciclo: safra, estado, origem,
        produtos: linhas.produtos, maquinas: canonico(linhas.maquinas), ...linhasNovasDoFingerprint(linhas),
      }),
    executar: async (tx) => {
      const empresaId = await exigirEmpresaDoTenant(tx, cli, corpo.empresa_id);
      const tempo = await tempoDaFazenda(tx, cli, empresaId); // Empresa FOR SHARE
      exigirDiaNaoFuturo(tempo, dia, 'data_operacional');
      const mapa = await exigirAreaDoMapa(tx, cli, empresaId, areaId);
      const area = await tx.areaPastagem.findUnique({ where: { cliente_id_id: { cliente_id: cli, id: areaId } }, select: { nome: true } });
      const tipo = await lerTipoAtividade(tx, cli, tipoId);
      if (!tipo) throw atividadeReferenciaInvalida('tipo_atividade_id', 'inexistente');
      if (!tipo.ativo) throw atividadeReferenciaInvalida('tipo_atividade_id', 'inativo');
      // Emenda 1: abastecimento é da máquina (tanque, litros, horímetro), não um registro genérico por área.
      if (ehTipoAbastecimento(tipo.nome_tipo)) throw atividadeReferenciaInvalida('tipo_atividade_id', 'abastecimento');

      // A corrida: quem chega depois espera aqui e então ENXERGA a atividade criada pelo primeiro.
      const chave = `atividade-registro:${cli}:${empresaId}:${tipoId}:${areaId}:${dia.slice(0, 7)}`;
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${chave}, 0))`;

      const { de, ate } = limitesDoMes(dia);
      const achada = await tx.atividade.findFirst({
        where: {
          cliente_id: cli, empresa_id: empresaId, tipo_atividade_id: tipoId, status: STATUS_ATIVIDADE.ABERTA,
          data_inicio: { gte: de, lt: ate },
          areas: { some: { area_id: areaId, status: { in: [STATUS_AREA.PLANEJADA, STATUS_AREA.EM_ANDAMENTO] } } },
        },
        orderBy: [{ updatedAt: 'desc' }, { id: 'desc' }],
        select: { id: true, nome: true, data_inicio: true },
      });

      let atividadeId;
      let atividadeNome;
      let criada = false;
      let iniciada = false;
      if (achada) {
        atividadeId = achada.id;
        atividadeNome = achada.nome;
        if (!(await travarAtividade(tx, cli, empresaId, atividadeId))) throw atividadeReferenciaInvalida('tipo_atividade_id', 'inexistente');
        const linhaDaArea = await tx.atividadeArea.findFirst({ where: { cliente_id: cli, empresa_id: empresaId, atividade_id: atividadeId, area_id: areaId } });
        if (linhaDaArea?.status === STATUS_AREA.PLANEJADA) {
          await iniciarAreaNaTransacao(tx, contexto, { clienteId: cli, empresaId, atividadeId, area: linhaDaArea, dia, inicioDaAtividade: diaDe(achada.data_inicio) });
          iniciada = true;
        }
      } else {
        criada = true;
        const bemDaPrimeiraMaquina = Array.isArray(corpo.maquinas) && corpo.maquinas[0]?.bem_id ? String(corpo.maquinas[0].bem_id) : null;
        const aberta = await abrirNa(tx, contexto, {
          clienteId: cli,
          empresaId,
          tempo,
          tipoAtividadeId: tipoId,
          estado: {
            nome: nomeDoRegistro(tipo.nome_tipo, area?.nome ?? '', dia),
            area_id: areaId,
            area_planejada: mapa.tamanho,
            data_inicio: dia,
            safra_ciclo: safra,
            bem_id: bemDaPrimeiraMaquina,
          },
          acao: 'atividade.abrir',
          auditoriaExtra: { origem_registro_de_campo: true },
        });
        atividadeId = aberta.id;
        atividadeNome = aberta.nome;
      }
      const alvo = await tx.atividadeArea.findFirst({ where: { cliente_id: cli, empresa_id: empresaId, atividade_id: atividadeId, area_id: areaId }, select: { id: true } });
      const r = await lancarNaTransacao(tx, contexto, {
        clienteId: cli, empresaId, tempo, atividadeId, estado: { ...estado, atividade_area_id: alvo?.id ?? null }, origem, linhas,
      });
      return {
        ...r,
        registro: { atividade_criada: criada, atividade_id: atividadeId, atividade_nome: atividadeNome, atividade_area_id: alvo?.id ?? null, area_iniciada: iniciada },
      };
    },
  });
};
