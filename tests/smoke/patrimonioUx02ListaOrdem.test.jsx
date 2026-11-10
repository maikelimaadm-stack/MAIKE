/**
 * D-PROD-160 (Patrimônio UX-02), revisão final L1 — ordem padrão da lista de
 * abastecimentos x paginação do servidor.
 *
 * O A1 pagina por `createdAt desc` (100 por página) e a grade ordena no
 * cliente só as linhas já carregadas. A data do abastecimento pode ser
 * retroativa, então ordenar por Data por padrão punha no topo uma data que não
 * é a mais recente e fazia a página seguinte "pular" para o topo. A ordem
 * padrão é o Nº desc: o Nº é reservado na criação e acompanha `createdAt`, ou
 * seja, a mesma ordem em que o servidor entrega as páginas. Ordenar por Data
 * continua disponível no cabeçalho (o Nº desempata no mesmo dia).
 *
 * Tela real (página, motor Base1, service, API, porta e nativeHttpClient) sobre
 * o backend falso, com página forçada pequena (`paginaLista`).
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { screen, fireEvent, act, cleanup, waitFor } from '@testing-library/react';
import { semearAbastecimento } from './fixtures/abastecimentosFakeCore.js';
import { montar, permissaoCom, prepararAmbiente } from './fixtures/abastecimentosTela.jsx';
import { ABASTECIMENTOS_COLUNAS } from '@/components/patrimonio/TabelaAbastecimentos';

const sessao = vi.hoisted(() => ({ permissao: /** @type {any} */ (null), clienteId: 'cli-1' }));

vi.mock('@/lib/AuthContext', () => ({ useAuth: () => ({ clienteId: sessao.clienteId, user: { id: 'u1' } }) }));
vi.mock('@/services/sessionService', async (importOriginal) => ({
  ...(await importOriginal()),
  getCurrentUser: vi.fn(async () => ({ login: 'operador', cliente_id: sessao.clienteId })),
  carregarPermissaoEfetiva: vi.fn(async () => sessao.permissao),
}));
vi.mock('@/services/mapaCacheService', async (importOriginal) => ({
  ...(await importOriginal()),
  refreshMapaCacheEntry: vi.fn(async () => []),
}));

let amb;

beforeEach(async () => {
  sessao.permissao = permissaoCom({ novo: true });
  amb = await prepararAmbiente(vi);
});

afterEach(() => {
  cleanup();
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

const semear = (data_operacional, medidor_leitura) =>
  semearAbastecimento(amb.estado, {
    bem_id: 'b1', tanque_id: 'tq1', produto_id: 'p1', local_estoque_id: 'l1', quantidade: '10', data_operacional, medidor_leitura,
  });

/** Ids das linhas da tabela, de cima para baixo (a coluna Nº é opcional: o id vem da célula da máquina). */
const idsNaTela = () =>
  screen.getAllByRole('row').slice(1).map((l) => l.querySelector('[data-testid^="abastecimento-bem-"]')?.getAttribute('data-testid').replace('abastecimento-bem-', '') ?? '');
const datasNaTela = () => screen.getAllByRole('row').slice(1).map((l) => (l.textContent.match(/\d{2}\/06\/2026/) ?? [''])[0]);
const carregarMais = async () => {
  const [botao] = await screen.findAllByLabelText('Carregar mais registros');
  await act(async () => fireEvent.click(botao));
};
const cabecalho = (nome) => {
  const th = screen.getAllByRole('columnheader').find((c) => c.textContent.trim().startsWith(nome));
  return th.querySelector('button') || th;
};

describe('UX-02 L1 — ordem padrão da lista = ordem do servidor (Nº desc)', () => {
  it('página pequena + registro retroativo criado por último: o topo é o último lançado e a página seguinte entra no FIM', async () => {
    // nº1 é o mais recente pela data (10/06), mas foi lançado primeiro; os demais são notas retroativas lançadas depois.
    await semear('2026-06-10', '1535.0');
    await semear('2026-06-05', '1525.0');
    await semear('2026-06-08', '1530.0');
    await semear('2026-06-01', '1521.0'); // retroativo (data antiga) criado por ÚLTIMO
    amb.estado.paginaLista = 2;
    await montar();
    await screen.findByTestId('abastecimento-bem-ab-4');

    // 1ª página do servidor (createdAt desc): nº4, nº3 — a tela mostra na MESMA ordem.
    const pedidos = amb.backend.chamadas.filter((c) => c.method === 'GET' && c.path === '/patrimonio-abastecimentos');
    expect(pedidos).toHaveLength(1);
    expect(idsNaTela()).toEqual(['ab-4', 'ab-3']);
    expect(datasNaTela()).toEqual(['01/06/2026', '08/06/2026']);

    await carregarMais();
    await screen.findByTestId('abastecimento-bem-ab-1');
    // A 2ª página (nº2, nº1) entra no fim; nada "pula" para o topo.
    expect(idsNaTela()).toEqual(['ab-4', 'ab-3', 'ab-2', 'ab-1']);
    expect(datasNaTela()).toEqual(['01/06/2026', '08/06/2026', '05/06/2026', '10/06/2026']);
  });

  it('clicar em Data ordena por data (menor → maior, depois maior → menor); no mesmo dia o Nº desempata', async () => {
    await semear('2026-06-10', '1535.0');
    await semear('2026-06-05', '1525.0');
    await semear('2026-06-10', '1540.0'); // mesmo dia do nº1, lançado depois
    await semear('2026-06-01', '1521.0');
    amb.estado.paginaLista = 2;
    await montar();
    await screen.findByTestId('abastecimento-bem-ab-4');
    await carregarMais();
    await screen.findByTestId('abastecimento-bem-ab-1');
    expect(idsNaTela()).toEqual(['ab-4', 'ab-3', 'ab-2', 'ab-1']);

    await act(async () => fireEvent.click(cabecalho('Data')));
    await waitFor(() => expect(idsNaTela()).toEqual(['ab-4', 'ab-2', 'ab-1', 'ab-3']));
    expect(datasNaTela()).toEqual(['01/06/2026', '05/06/2026', '10/06/2026', '10/06/2026']);

    await act(async () => fireEvent.click(cabecalho('Data')));
    await waitFor(() => expect(idsNaTela()).toEqual(['ab-3', 'ab-1', 'ab-2', 'ab-4']));
    expect(datasNaTela()).toEqual(['10/06/2026', '10/06/2026', '05/06/2026', '01/06/2026']);
  });
});

/**
 * Revisão final L2 — larguras padrão no tablet (820 px). O jsdom não faz
 * layout: aqui fica o ORÇAMENTO, com as medidas tiradas no Chromium com a
 * fonte da tela (DM Sans; 14 px em ≤ 1023 px, `mk-unificado.css`; cabeçalho
 * 600). A prova na tela real é o E2E-1 (`conferirLista`: rótulos e células de
 * Data/Quantidade/Medidor/Situação sem corte e coluna Produto ≥ 128 px em 820 px).
 * Célula: padding 0 9px + borda 1px (`cadastro-base1.css`) = 19 px. Cabeçalho:
 * + gap 4 + botão do menu 20 = 43 px. Grade útil em 820 px ≈ 712 px − 36 da
 * seleção − 15 da barra de rolagem vertical ≈ 660 → orçamento de 655.
 *
 * Prioridade (rodada 2): o PRODUTO vale mais que o rótulo inteiro do cabeçalho
 * "Máquina/Veículo". Com 97 px o Produto mostrava 81 px de texto na tela e
 * "Diesel S10 granel", "Diesel S10 posto" e "Gasolina comum" viravam
 * "Diesel S10 …" — sumia a palavra que distingue os Produtos, e no tablet não
 * há hover para o `title`.
 * A célula da máquina já diz qual é a máquina, então o rótulo "Máquina/Veículo"
 * (pede 157) é a ÚNICA exceção aceita: no tablet ele sai com reticências.
 *
 * D-PROD-161: "Litros" e "KG" viraram UMA coluna "Quantidade" (número + "L" ou
 * "kg"). Ela pede o rótulo inteiro (~80 px de texto: 76,5 medidos com a fonte
 * estática do ensaio × 1,05, a razão entre os 6 rótulos acima e a mesma medida)
 * e "999,9999 kg" (82,7, medida igual à de "999,9999 L" = 75,2 acima). Quem
 * cede os 27 px é a Máquina/Veículo (124 → 97), cuja célula continua mostrando
 * o código da frota, que vem primeiro.
 */
describe('UX-02 L2 (revisto pela D-PROD-161) — larguras padrão cabem em 820 px sem cortar o Produto, a Data, a Quantidade nem os números', () => {
  const ROTULO = { data_operacional: 31.7, bem: 113.8, produto: 54.0, quantidade: 80.3, leitura: 56.3, status: 59.3 };
  /** Cabeçalho que pode cortar no tablet (decisão do orquestrador, rodada 2). */
  const ROTULO_PODE_CORTAR = ['bem'];
  const MAIOR_VALOR = {
    data_operacional: ['04/04/2026', 81.1], // a data mais larga de 2026 (dígitos proporcionais)
    // Nomes comuns de Produto, medidos no Chromium (scrollWidth). O orçamento é
    // de 111 px de texto: cabem inteiros; "DIESEL S10 GRANEL" (127, maiúsculas)
    // e "Diesel S10 estoque novo" (157) continuam cortando, com `title`.
    produto: ['texto de 111 px ("Gasolina comum" 109, "Diesel S10 granel" 108, "Etanol hidratado" 107, "Diesel S10 posto" 106)', 111],
    quantidade: ['999,9999 kg', 82.7], // a unidade mais larga ("kg"); "999,9999 L" pede 75,2
    leitura: ['123.456 km', 72.6],
    status: ['Confirmado', 80.7], // o selo, com padding e borda
  };

  it('soma ≤ 655 px; cada coluna cabe o rótulo inteiro (+43, exceto Máquina/Veículo) e o maior valor esperado (+19)', () => {
    const padrao = ABASTECIMENTOS_COLUNAS.filter((c) => c.default);
    expect(padrao.map((c) => c.id)).toEqual(['data_operacional', 'bem', 'produto', 'quantidade', 'leitura', 'status']);
    expect(padrao.reduce((s, c) => s + c.width, 0)).toBeLessThanOrEqual(655);
    const faltas = padrao.flatMap((c) => {
      const f = [];
      if (!ROTULO_PODE_CORTAR.includes(c.id) && c.width < ROTULO[c.id] + 43) f.push(`${c.label} ${c.width} px: o rótulo pede ${(ROTULO[c.id] + 43).toFixed(1)}`);
      const v = MAIOR_VALOR[c.id];
      if (v && c.width < v[1] + 19) f.push(`${c.label} ${c.width} px: ${v[0].startsWith('texto') ? v[0] : `"${v[0]}"`} pede ${(v[1] + 19).toFixed(1)}`);
      return f;
    });
    expect(faltas).toEqual([]);
  });
});
