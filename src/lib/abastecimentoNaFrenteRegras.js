/**
 * O abastecimento DENTRO da frente (D-PROD-359): as linhas de "Lançado hoje" que vêm dos abastecimentos CONFIRMADOS da
 * máquina da frente. Juntam-se DEPOIS de `lancamentosDoDia`: não mudam essa função nem o cálculo das horas da frente.
 */
import { ehExterno, formatarQuantidadeCurta } from '@/lib/abastecimentoRegras';
import { horaNoFuso } from '@/lib/aberturaServicoRegras';

/** O título da linha (como as outras de "Lançado hoje": "Insumo", "Mão de obra"…). */
export const TITULO_ABASTECIMENTO_NA_FRENTE = 'Abastecimento';

/** O instante do registro (a criação): `created_date` (o serviço) ou `createdAt`/`criado_em`. Sem data, vai para o fim. @param {any} r */
const instanteDoRegistro = (r) => {
  const ms = Date.parse(String(r?.created_date ?? r?.createdAt ?? r?.criado_em ?? ''));
  return Number.isFinite(ms) ? ms : Number.POSITIVE_INFINITY;
};

/**
 * A linha de apoio: "Óleo diesel S10 · Tanque da sede" (estoque) ou "Óleo diesel S10 · Posto externo". Sem um dos dois,
 * só o que houver.
 * @param {any} r
 */
export const subDoAbastecimento = (r) => {
  const produto = String(r?.produto?.nome ?? '').trim();
  const local = ehExterno(r) ? 'Posto externo' : String(r?.local_estoque?.nome ?? '').trim();
  return [produto, local].filter(Boolean).join(' · ');
};

/**
 * As linhas de "Lançado hoje" dos abastecimentos (o mesmo formato de `lancamentosDoDia`). Só CONFIRMADO: cancelado não
 * aparece. A quantidade vai na unidade GRAVADA (L ou kg), como "80 L".
 * @param {any[]} registros os abastecimentos lidos (a lista do serviço, do dia da frente)
 * @param {string | null} fuso o fuso da fazenda (a hora da linha)
 */
export const linhasDosAbastecimentosDoDia = (registros, fuso) =>
  (Array.isArray(registros) ? registros : [])
    .filter((r) => r && typeof r === 'object' && r.status === 'CONFIRMADO')
    .map((r) => {
      const iso = r.created_date ?? r.createdAt ?? r.criado_em;
      return {
        chave: `abastecimento:${r.id}`,
        hora: horaNoFuso(iso, fuso),
        tipo: 'abastecimento',
        titulo: TITULO_ABASTECIMENTO_NA_FRENTE,
        sub: subDoAbastecimento(r),
        quantidade: formatarQuantidadeCurta(r.quantidade, r.unidade),
        instante: instanteDoRegistro(r),
      };
    });

/**
 * Junta as linhas dos abastecimentos às de `lancamentosDoDia`, na ordem do horário. Não altera nenhuma das duas listas.
 * @param {any[]} linhasDoDia @param {any[]} linhasDeAbastecimento
 */
export const juntarNaOrdemDoDia = (linhasDoDia, linhasDeAbastecimento) => [...linhasDoDia, ...linhasDeAbastecimento].sort((a, b) => a.instante - b.instante);
