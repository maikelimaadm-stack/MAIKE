// @vitest-environment jsdom
/**
 * D-PROD-220 — detalhe do DEPÓSITO no desenho do Detalhes do Lote v12 (tela
 * `telaDeposito`). Os dados e as regras são os de hoje (D-PROD-178, D-PROD-162,
 * D-PROD-161, D-PROD-205); muda a apresentação:
 *
 *  DV-1. casca v12: `.mk-dp` filha direta do `.mk-ll` do diálogo, com o nome do
 *        depósito e o `subtitulo` no cabeçalho; sem `subtitulo`, o local de
 *        estoque; sem os dois, "Depósito". Só classes do v12 no markup novo.
 *  DV-2. seções na ordem do v12: Nível do depósito (bloco do nível + grade com
 *        o medidor), Saldo por produto, Pastos atendidos, Informações do
 *        depósito e Histórico do depósito.
 *  DV-3. estado do estoque mínimo na caixa "Estoque mínimo" (abaixo / no mínimo /
 *        acima), sem faixa de aviso repetida.
 *  DV-10. v13: topo com o saldo sozinho ao lado do ícone, régua 0 → limite com o
 *        mínimo e o saldo, duas caixas (necessidade e mínimo); saldo por produto com
 *        a barra da participação; pastos atendidos com etiqueta da leitura e barra de
 *        nível; histórico com cartões curtos (+/− kg e sacos).
 *  DV-4. rodapé Entrada · Saída · Histórico com as permissões de hoje (sem a
 *        permissão a pílula não aparece); as pílulas abrem a transferência e o
 *        histórico completo nos diálogos de hoje.
 *  DV-5. pastos atendidos: um item por cocho vinculado (ordem de nome), meta
 *        "pastos · produto padrão", bolinha do farol da última leitura e o
 *        subícone do cocho com o nível do SSOT (D-PROD-225); com `onAbrirCocho`, chevron e
 *        toque; sem ele, só informa.
 *  DV-6. informações do depósito: a grade do cadastro (sem "Frequência
 *        padrão": o cadastro do ponto não tem esse campo) e as linhas "Cochos
 *        vinculados" e "Observações".
 *  DV-7. linha do tempo: as últimas 5 movimentações com a MESMA regra do
 *        histórico completo, sem o movimento em L; vazio "Nenhum registro ainda.".
 *  DV-8. carregando dentro da casca.
 *  DV-9. `movimentacoesDoHistoricoDeposito`: o filtro e a ordem do histórico.
 */
import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { hojeNoFuso, somarDias } from '@/lib/diaCivil';
import { calcularNivelCocho } from '@/domain/suplementacao/nivelSuplementacao';
import { COR_FAROL } from '@/domain/suplementacao/leituraCocho';

const dados = vi.hoisted(() => ({ lotesNota: [], produtos: [], movimentacoes: [], pontos: [], areas: [], cache: {}, pendente: false, movimentacoesPendentes: false, movimentacoesComErro: false }));

vi.mock('@/hooks/useEmpresaSelecionadaId', () => ({ useEmpresaSelecionadaId: () => 'emp-1' }));
vi.mock('@/services/estoqueMapaService', () => ({
  listarTodosLotesNota: vi.fn(async () => (dados.pendente ? new Promise(() => {}) : dados.lotesNota)),
  listarTodosProdutos: vi.fn(async () => dados.produtos),
  listarTodasMovimentacoes: vi.fn(async () => {
    if (dados.movimentacoesComErro) throw new Error('rede caiu');
    return dados.movimentacoesPendentes ? new Promise(() => {}) : dados.movimentacoes;
  }),
}));
vi.mock('@/services/mapaService', () => ({
  listarPontosSuplementacaoAtivos: vi.fn(async () => dados.pontos),
  listarAreasAtivas: vi.fn(async () => dados.areas),
  listarIconesPorTipoEntidade: vi.fn(async () => []),
}));
// Cache do mapa (leituras e eventos de suplementação) e o fuso da fazenda (sem fuso: relógio do navegador).
vi.mock('@/services/mapaCacheService', () => ({
  getMapaCachedData: vi.fn(async (chave) => dados.cache[chave] || []),
  refreshMapaCacheEntry: vi.fn(async (chave) => dados.cache[chave] || []),
}));
vi.mock('@/services/empresaService', () => ({ listEmpresas: vi.fn(async () => []) }));
// O jsdom não lê um `data:` URL longo em `background-image`: o ícone vira um texto legível
// com os argumentos (fração do SSOT e o modo "marcador do mapa", desligado nos detalhes).
vi.mock('@/assets/icones/cocho-descoberto', async (importOriginal) => ({
  ...(await importOriginal()),
  urlIconeCocho: (fracao, marcador = false) => `icone-cocho:${fracao}:${marcador}`,
}));
vi.mock('@/components/mapa/FormularioTransferenciaDeposito', () => ({
  default: ({ initialDirection }) => <p>formulário da transferência: {initialDirection}</p>,
}));
vi.mock('@/components/suplementacao/HistoricoDepositoSuplementacao', async (importOriginal) => ({
  ...(await importOriginal()),
  default: () => <p>histórico completo do depósito</p>,
}));

const { default: DetalhesDepositoSuplementacao } = await import('@/components/mapa/DetalhesDepositoSuplementacao');
const { movimentacoesDoHistoricoDeposito } = await import('@/components/suplementacao/HistoricoDepositoSuplementacao');
const { LancLoteDialogo } = await import('@/components/lotes/LancamentoLoteUi');

const EMP = 'emp-1';
const LOCAL = 'loc-sede';
const HOJE = hojeNoFuso(null);
const SAL = { id: 'p-sal', empresa_id: EMP, nome_produto: 'SAL MINERAL 80', unidade_principal_estoque: 'KG', peso_por_saco_kg: 25 };
const DEPOSITO = {
  id: 'd1', empresa_id: EMP, nome_ponto: 'Depósito Sede', categoria_ponto: 'DEPOSITO', status: 'Ativo',
  local_estoque_id: LOCAL, local_estoque_nome: 'Galpão Sede', numero_ponto: 'DP-01', sigla: 'DS', tipo: 'Galpão',
  produto_padrao: 'SAL MINERAL 80', capacidade_cocho_kg: 2000, estoque_minimo_kg: 500, observacoes: 'Conferir a lona do galpão nas chuvas.',
};
const AREAS = [{ id: 'a-p02', nome: 'Pasto 02' }, { id: 'a-p05', nome: 'Pasto 05' }];
const cocho = (id, nome, areaId, produto, extra = {}) => ({
  id, empresa_id: EMP, nome_ponto: nome, categoria_ponto: 'COCHO', status: 'Ativo', deposito_origem_id: 'd1',
  area_vinculada_ids: [areaId], produto_padrao: produto, capacidade_cocho_kg: 300, ...extra,
});
const C05 = cocho('c05', 'Cocho 05', 'a-p05', 'PROTEINADO 40');
const C02 = cocho('c02', 'Cocho 02', 'a-p02', 'SAL MINERAL 80');
const DE_OUTRO_DEPOSITO = cocho('c09', 'Cocho 09', 'a-p05', 'SAL', { deposito_origem_id: 'd2' });
const PONTOS = [C05, C02, DE_OUTRO_DEPOSITO, DEPOSITO];
const loteNota = (qtd) => ({ id: 'l1', empresa_id: EMP, produto_id: SAL.id, produto_nome: SAL.nome_produto, local_estoque_id: LOCAL, quantidade_disponivel: qtd, status: 'Disponivel' });
const leitura = (id, pontoId, escore) => ({ id, empresa_id: EMP, ponto_suplementacao_id: pontoId, data_leitura: HOJE, escore, acesso: 'BOM', estrutura: 'BOA', created_date: `${HOJE}T10:00:00.000Z` });
/** Lançamento de ontem no Cocho 02: 200 kg a 50 kg/dia → o SSOT estima o ciclo (nível > 0). */
const EVENTO_C02 = {
  id: 'e-c02', empresa_id: EMP, ponto_suplementacao_id: 'c02', data_lancamento: somarDias(HOJE, -1), produto: 'SAL MINERAL 80',
  quantidade_total_kg: 200, sobra_kg: 0, dias_periodo: null, consumo_esperado_pv_kg: 50,
};
const mov = (id, extra) => ({ id, empresa_id: EMP, produto_id: SAL.id, produto_nome: SAL.nome_produto, unidade_medida: 'KG', ...extra });
const em = (dia) => ({ data_movimentacao: `${dia}T12:00:00.000Z`, created_date: `${dia}T12:00:00.000Z` });
const MOVS = [
  mov('mv-sai', { ...em('2026-11-09'), tipo_movimentacao: 'Saída', tipo_detalhado: 'suplementacao', quantidade: 400, local_estoque_origem: LOCAL, ponto_suplementacao_id: 'c02' }),
  mov('mv-ent', { ...em('2026-11-04'), tipo_movimentacao: 'Entrada', tipo_detalhado: 'transferencia_recebida', quantidade: 1000, local_estoque_origem: 'loc-x', local_origem: 'Galpão Central', local_estoque_destino: LOCAL, local_destino: 'Galpão Sede', observacoes: 'NF 4.512' }),
  // Fora da linha do tempo, como no histórico completo: o lado "enviada" da mesma
  // transferência (é da origem), a reversão e o movimento rotulado em litros.
  mov('mv-par', { ...em('2026-11-04'), tipo_movimentacao: 'Saída', tipo_detalhado: 'transferencia_enviada', quantidade: 1000, local_estoque_origem: 'loc-x', local_estoque_destino: LOCAL }),
  mov('mv-rev', { ...em('2026-11-10'), tipo_movimentacao: 'Entrada', origem_sistema: 'reversao', quantidade: 50, local_estoque_destino: LOCAL }),
  mov('mv-litro', { ...em('2026-11-11'), tipo_movimentacao: 'Entrada', unidade_medida: 'L', produto_nome: 'ÓLEO', quantidade: 20, local_estoque_destino: LOCAL }),
];

/** Cor CSS que o jsdom devolve para um hex. */
const rgb = (hex) => `rgb(${[1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16)).join(', ')})`;

const montar = async (props = {}, { dialogo = false } = {}) => {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const tela = <DetalhesDepositoSuplementacao deposito={DEPOSITO} onClose={() => {}} {...props} />;
  const r = render(
    <QueryClientProvider client={qc}>
      {dialogo ? (
        <LancLoteDialogo open onOpenChange={() => {}} titulo="Depósito de Suplementação" largo somenteLeitura popupDesde="tablet">
          {tela}
        </LancLoteDialogo>
      ) : (
        tela
      )}
    </QueryClientProvider>,
  );
  await screen.findByRole('region', { name: 'Nível do depósito' });
  return r;
};
const secao = () => screen.getByRole('region', { name: 'Nível do depósito' });
const corpo = () => document.querySelector('.mk-dp__corpo');
const pilulas = () => within(screen.getByRole('group', { name: 'Ações' })).getAllByRole('button').map((b) => b.textContent);
const informacoes = () => screen.getByRole('group', { name: 'Informações do depósito' });
const tocar = async (el) => {
  await act(async () => {
    fireEvent.click(el);
  });
};

beforeEach(() => {
  dados.lotesNota = [loteNota(1400)];
  dados.produtos = [SAL];
  dados.movimentacoes = MOVS;
  dados.pontos = PONTOS;
  dados.areas = AREAS;
  dados.cache = { leiturasCocho: [leitura('lt-02', 'c02', 'ADEQUADO'), leitura('lt-05', 'c05', 'VAZIO')], eventosSuplementacao: [EVENTO_C02] };
  dados.pendente = false;
  dados.movimentacoesPendentes = false;
  dados.movimentacoesComErro = false;
});
afterEach(() => cleanup());

describe('DV-1 — casca v12 e cabeçalho', () => {
  it('no diálogo do mapa: `.mk-dp` filha direta do `.mk-ll`, título = depósito, sub = subtitulo', async () => {
    await montar({ subtitulo: 'Sede · Sede' }, { dialogo: true });
    const raiz = document.querySelector('.mk-ll > .mk-dp');
    expect(raiz).toBeTruthy();
    expect(raiz.contains(secao())).toBe(true);
    expect(document.querySelector('.mk-ll-dlg__titulo')?.textContent).toBe('Depósito Sede');
    expect(document.querySelector('.mk-ll-dlg__lotes')?.textContent).toBe('Sede · Sede');
    // O corpo é a área de cartões do v12; o rodapé, as pílulas.
    expect(corpo().classList.contains('mk-dp__corpo--cards')).toBe(true);
    expect(raiz.querySelector('.mk-dp__rodape .mk-dp-rodape--pilulas')).toBeTruthy();
  });

  it('sem subtitulo: o local de estoque; sem os dois, "Depósito" (cabeçalho próprio, fora do diálogo)', async () => {
    await montar();
    expect(document.querySelector('.mk-dp-cab__titulo')?.textContent).toBe('Depósito Sede');
    expect(document.querySelector('.mk-dp-cab__sub')?.textContent).toBe('Galpão Sede');
    cleanup();
    await montar({ deposito: { ...DEPOSITO, local_estoque_nome: null } });
    expect(document.querySelector('.mk-dp-cab__sub')?.textContent).toBe('Depósito');
  });

  it('o markup novo só usa as classes do v12 (sem Tailwind no corpo)', async () => {
    await montar();
    const estranhas = Array.from(corpo().querySelectorAll('[class]'))
      .flatMap((el) => String(el.getAttribute('class')).split(/\s+/))
      .filter((c) => c && !/^(mk-dp|lucide|is-)/.test(c));
    expect(estranhas).toEqual([]);
  });
});

describe('DV-2 — abas e seções na ordem do v12', () => {
  it('abas Detalhes · Informações · Histórico; na aba Detalhes, nível e saldo por produto (com resumo do saldo)', async () => {
    await montar();
    const abas = screen.getAllByRole('tab').map((t) => t.textContent);
    expect(abas).toEqual(['Detalhes', 'Informações', 'Histórico']);
    const titulos = within(corpo()).getAllByRole('heading', { level: 3 }).map((h) => h.textContent);
    expect(titulos).toEqual([
      'Nível do depósito', 'Saldo por produto',
    ]);
    expect(corpo().parentElement.classList.contains('mk-dp-deposito')).toBe(true);
    const filhos = Array.from(corpo().children);
    expect(filhos[0].classList.contains('mk-dp-dep13')).toBe(true);
    expect(filhos.filter((f) => f.classList.contains('mk-dp-secao')).map((t) => t.querySelector('h3')?.textContent)).toEqual([
      'Saldo por produto',
    ]);
    // Topo (v13): porcentagem dentro da figura do ícone e SÓ o saldo atual ao lado.
    const nivel = within(secao()).getByTestId('nivel-do-deposito');
    expect(within(nivel).getByText('70%')).toBeTruthy();
    expect(within(nivel).queryByText(/Limite operacional:/)).toBeNull();
    expect(within(nivel).getByText('Saldo atual').nextElementSibling?.textContent).toBe('1.400 kg');
    expect(within(nivel).getByText('56,00 sacos')).toBeTruthy();
    expect(within(nivel).queryByText(/Necessidade/)).toBeNull();
    expect(nivel.querySelector('img[data-deposito-icone]')).toBeTruthy();
    // Régua e as duas caixas: necessidade de reposição e estoque mínimo.
    expect(within(secao()).getByRole('meter', { name: 'Ocupação do limite operacional' }).getAttribute('aria-valuenow')).toBe('70');
    const caixas = Array.from(secao().querySelectorAll('.mk-dp-dep13__caixa')).map((c) => c.textContent);
    expect(caixas).toEqual(['Necessidade de reposição600 kg24,00 sacos · até o limite', 'Acima do mínimo900 kgmínimo de 500 kg']);
    // Saldo por produto: uma linha por produto (sacos embaixo, kg à direita) e a barra da participação.
    const linha = screen.getByText('SAL MINERAL 80', { selector: '.mk-dp-linha__rot' }).closest('[data-unidade-confirmada]');
    expect(linha.getAttribute('data-unidade-confirmada')).toBe('true');
    expect(linha.querySelector('.mk-dp-linha__sub')?.textContent).toBe('56,00 sacos');
    expect(linha.querySelector('.mk-dp-linha__val')?.textContent).toBe('1.400 kg');
    expect(linha.querySelector('.mk-dp-dep13__part')?.getAttribute('data-participacao')).toBe('100.0');
    expect(screen.getByText('Abaixo do mínimo o mapa avisa para repor.')).toBeTruthy();
  });

  it('sem limite operacional: o rótulo neutro no lugar do número, a mensagem e o que fazer só no bloco do nível', async () => {
    await montar({ deposito: { ...DEPOSITO, capacidade_cocho_kg: null } });
    const nivel = within(secao()).getByTestId('nivel-do-deposito');
    expect(nivel.querySelector('[data-deposito-rotulo-neutro]')?.textContent).toBe('Sem limite');
    expect(within(nivel).getByText('Limite operacional não configurado; não há percentual.')).toBeTruthy();
    expect(within(nivel).getByText('Configure o limite operacional no cadastro do ponto.')).toBeTruthy();
    // Sem limite: régua neutra (só desenho, sem medidor) e a necessidade sem número.
    expect(within(secao()).queryByRole('meter')).toBeNull();
    expect(secao().querySelector('.mk-dp-dep13__trilho')?.getAttribute('data-variante')).toBe('neutro');
    expect(secao().querySelector('[data-caixa="necessidade"]')?.textContent).toBe('Necessidade de reposição—sem limite operacional');
    expect(within(secao()).getAllByText('Limite operacional não configurado; não há percentual.')).toHaveLength(1);
    expect(secao().textContent).not.toMatch(/\d%/);
  });

  it('sem saldo: "Sem saldo disponível neste depósito." (a linha fraca do v12, no cartão da seção)', async () => {
    dados.lotesNota = [];
    await montar();
    const linha = screen.getByText('Sem saldo disponível neste depósito.').closest('.mk-dp-linha');
    expect(linha.classList.contains('mk-dp-deposito__linha--fraca')).toBe(true);
    expect(linha.closest('.mk-dp-cartao')).toBeTruthy();
  });
});

describe('DV-3 — estado do estoque mínimo sem aviso redundante', () => {
  it('abaixo do mínimo, no mínimo e acima: estado exibido no cartão Estoque mínimo, sem faixa de aviso duplicada', async () => {
    dados.lotesNota = [loteNota(400)];
    await montar();
    await waitFor(() => expect(screen.getByRole('group', { name: 'Estoque mínimo' }).getAttribute('data-estado-minimo')).toBe('abaixo'));
    expect(within(screen.getByRole('group', { name: 'Estoque mínimo' })).getByText('100 kg')).toBeTruthy();
    expect(screen.queryByText('Abaixo do mínimo o mapa avisa para repor.')).toBeNull();
    expect(secao().querySelector('.mk-dp-aviso--atencao')).toBeNull();
    cleanup();
    dados.lotesNota = [loteNota(500)];
    await montar();
    await waitFor(() => expect(within(screen.getByRole('group', { name: 'Estoque mínimo' })).getByText('No mínimo')).toBeTruthy());
    expect(secao().querySelector('.mk-dp-aviso--atencao')).toBeNull();
    cleanup();
    dados.lotesNota = [loteNota(1400)];
    await montar();
    expect(secao().querySelector('.mk-dp-aviso--atencao')).toBeNull();
  });
});

describe('DV-4 — rodapé de pílulas com as permissões de hoje', () => {
  it('Entrada · Saída; sem a permissão a pílula não aparece; sem nenhuma, rodapé vazio', async () => {
    await montar();
    expect(pilulas()).toEqual(['Entrada', 'Saída']);
    cleanup();
    await montar({ permissions: { movimentar_depositos: false } });
    expect(screen.queryByRole('group', { name: 'Ações' })).toBeNull();
    expect(document.querySelector('.mk-dp__rodape')?.childElementCount).toBe(0);
    cleanup();
    await montar({ permissions: { visualizar_historico_cocho: false } });
    expect(pilulas()).toEqual(['Entrada', 'Saída']);
  });

  it('Entrada e Saída abrem a transferência de hoje', async () => {
    await montar();
    await tocar(screen.getByRole('button', { name: 'Entrada' }));
    expect(await screen.findByRole('heading', { name: 'Entrada no Depósito' })).toBeTruthy();
    expect(screen.getByText('formulário da transferência: entrada')).toBeTruthy();
    cleanup();
    await montar();
    await tocar(screen.getByRole('button', { name: 'Saída' }));
    expect(await screen.findByRole('heading', { name: 'Saída do Depósito' })).toBeTruthy();
    expect(screen.getByText('formulário da transferência: saida')).toBeTruthy();
  });
});

describe('DV-5 — pastos atendidos', () => {
  it('um item por cocho do depósito, em ordem de nome, com meta, farol e o subícone do cocho pelo SSOT', async () => {
    await montar();
    await tocar(screen.getByRole('tab', { name: 'Informações' }));
    const lista = screen.getByRole('list', { name: 'Pastos atendidos' });
    const itens = within(lista).getAllByRole('listitem');
    expect(itens.map((li) => li.querySelector('.mk-dp-item__nome')?.textContent)).toEqual(['Cocho 02', 'Cocho 05']);
    expect(itens[0].querySelector('.mk-dp-item__meta')?.textContent).toContain('Pasto 02 · SAL MINERAL 80');
    expect(itens[1].querySelector('.mk-dp-item__meta')?.textContent).toContain('Pasto 05 · PROTEINADO 40');
    // Farol da última leitura (o mesmo cache do mapa): Cocho 02 adequado (verde), Cocho 05 vazio (vermelho).
    await waitFor(() => expect(itens[0].querySelector('.mk-dp-bolinha')?.style.background).toBe(rgb(COR_FAROL.verde)));
    expect(itens[1].querySelector('.mk-dp-bolinha')?.style.background).toBe(rgb(COR_FAROL.vermelho));
    expect(itens[0].querySelector('.mk-dp-item__meta')?.textContent).toContain('Leitura: Cocho adequado');
    expect(itens[1].querySelector('.mk-dp-item__corpo')?.getAttribute('title')).toBe('Leitura: Cocho vazio');
    // O subícone do cocho (o dos detalhes, sem a bolinha do mapa; D-PROD-225) com o nível do SSOT
    // (o mesmo número do marcador); sem lançamento, vazio.
    const fracao02 = calcularNivelCocho({ ponto: C02, eventos: [EVENTO_C02], hoje: HOJE, pontos: PONTOS }).fracaoParaSvg;
    expect(fracao02).toBeGreaterThan(0);
    await waitFor(() => expect(itens[0].querySelector('.mk-dp-item__img')?.style.backgroundImage).toBe(`url("icone-cocho:${fracao02}:false")`));
    expect(itens[1].querySelector('.mk-dp-item__img')?.style.backgroundImage).toBe('url("icone-cocho:0:false")');
    // Sem `onAbrirCocho`, o item só informa: sem botão nem chevron.
    expect(within(lista).queryAllByRole('button')).toHaveLength(0);
    expect(lista.querySelector('.mk-dp-chev')).toBeNull();
  });

  it('com onAbrirCocho: chevron e o toque abre o cocho', async () => {
    const onAbrirCocho = vi.fn();
    await montar({ onAbrirCocho });
    await tocar(screen.getByRole('tab', { name: 'Informações' }));
    const lista = screen.getByRole('list', { name: 'Pastos atendidos' });
    expect(lista.querySelectorAll('.mk-dp-chev')).toHaveLength(2);
    await tocar(within(lista).getByRole('button', { name: /^Cocho 05/ }));
    expect(onAbrirCocho).toHaveBeenCalledTimes(1);
    expect(onAbrirCocho).toHaveBeenCalledWith(C05);
  });

  it('sem cocho vinculado: "Nenhum cocho vinculado a este depósito."', async () => {
    dados.pontos = [DE_OUTRO_DEPOSITO, DEPOSITO];
    await montar();
    await tocar(screen.getByRole('tab', { name: 'Informações' }));
    const linha = screen.getByText('Nenhum cocho vinculado a este depósito.').closest('.mk-dp-linha');
    expect(linha.classList.contains('mk-dp-deposito__linha--fraca')).toBe(true);
    expect(screen.queryByRole('list', { name: 'Pastos atendidos' })).toBeNull();
  });
});

describe('DV-6 — informações do depósito', () => {
  it('grade do cadastro, cochos vinculados e observações; sem "Frequência padrão"', async () => {
    await montar();
    await tocar(screen.getByRole('tab', { name: 'Informações' }));
    const info = informacoes();
    const celulas = Array.from(info.querySelectorAll('.mk-dp-cel')).map((c) => `${c.querySelector('dt').textContent}: ${c.querySelector('dd').textContent}`);
    expect(celulas).toEqual([
      'Número: DP-01', 'Sigla: DS', 'Tipo: Galpão', 'Local de estoque: Galpão Sede', 'Produto padrão: SAL MINERAL 80',
    ]);
    const linhas = Array.from(info.querySelectorAll('.mk-dp-linha')).map((l) => `${l.querySelector('.mk-dp-linha__rot').textContent}: ${l.querySelector('.mk-dp-linha__val').textContent}`);
    expect(linhas).toEqual(['Observações: Conferir a lona do galpão nas chuvas.']);
    expect(info.querySelectorAll('.mk-dp-linha--quebra')).toHaveLength(1);
    expect(screen.queryByText(/Frequência/)).toBeNull();
  });

  it('cadastro vazio: "—" nas células e nas linhas', async () => {
    dados.pontos = [];
    await montar({ deposito: { ...DEPOSITO, numero_ponto: null, sigla: '', tipo: null, produto_padrao: null, observacoes: null, capacidade_cocho_kg: null, estoque_minimo_kg: null } });
    await tocar(screen.getByRole('tab', { name: 'Informações' }));
    const info = informacoes();
    const valores = Array.from(info.querySelectorAll('.mk-dp-cel dd')).map((dd) => dd.textContent);
    expect(valores).toEqual(['—', '—', '—', 'Galpão Sede', '—']);
    expect(Array.from(info.querySelectorAll('.mk-dp-linha__val')).map((v) => v.textContent)).toEqual(['—']);
  });
});

describe('DV-7 — histórico na aba superior', () => {
  it('aba Detalhes não monta registros; aba Histórico mostra a linha do tempo sem repetir botão no rodapé', async () => {
    await montar();
    expect(screen.queryByRole('list', { name: 'Histórico do depósito' })).toBeNull();
    expect(screen.queryByRole('heading', { name: 'Histórico do depósito' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Histórico' })).toBeNull();
    await tocar(screen.getByRole('tab', { name: 'Histórico' }));
    expect(screen.getByRole('button', { name: 'Mostrar: Todos os registros' })).toBeTruthy();
    expect(screen.getByRole('list', { name: 'Histórico do depósito' })).toBeTruthy();
  });

  it('sem permissão, não mostra aba Histórico', async () => {
    await montar({ permissions: { visualizar_historico_cocho: false } });
    expect(screen.queryByRole('tab', { name: 'Histórico' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Histórico' })).toBeNull();
  });
});

describe('DV-10 — v13: pastos atendidos e histórico em cartões curtos', () => {
  it('pastos atendidos: título com a contagem, etiqueta da leitura (cor e texto curto) e barra de nível do cocho', async () => {
    await montar();
    await tocar(screen.getByRole('tab', { name: 'Informações' }));
    expect(screen.getByRole('heading', { name: 'Pastos atendidos · 2 cochos' })).toBeTruthy();
    const itens = within(screen.getByRole('list', { name: 'Pastos atendidos' })).getAllByRole('listitem');
    await waitFor(() => expect(itens[0].querySelector('.mk-dp-dep13__leitura')?.textContent).toBe('Adequado'));
    expect(itens[0].querySelector('.mk-dp-dep13__leitura')?.getAttribute('data-cor')).toBe('verde');
    expect(itens[1].querySelector('.mk-dp-dep13__leitura')?.textContent).toBe('Vazio');
    expect(itens[1].querySelector('.mk-dp-dep13__leitura')?.getAttribute('data-cor')).toBe('vermelho');
    // Nível do SSOT: o Cocho 02 com o percentual do ciclo; o Cocho 05 sem lançamento.
    const n02 = calcularNivelCocho({ ponto: C02, eventos: [EVENTO_C02], hoje: HOJE, pontos: PONTOS });
    await waitFor(() => expect(itens[0].querySelector('.mk-dp-dep13__nivel-txt')?.textContent).toBe(`nível ${n02.rotuloCurto}`));
    expect(itens[0].querySelector('.mk-dp-dep13__nivel-barra > span')?.style.width).toBe(`${Math.round(n02.fracaoParaSvg * 100)}%`);
    expect(itens[1].querySelector('.mk-dp-dep13__nivel-txt')?.textContent).toBe('Sem lançamento');
    expect(itens[1].querySelector('.mk-dp-dep13__nivel-barra > span')?.style.width).toBe('0%');
  });

  it('histórico: entrada "+1.000 kg" (verde) e saída "−400 kg" (vermelho) com os sacos; produto e origem/destino embaixo do título', async () => {
    await montar();
    await tocar(screen.getByRole('tab', { name: 'Histórico' }));
    const lista = screen.getByRole('list', { name: 'Histórico do depósito' });
    expect(lista.classList.contains('mk-dp-tl--curto')).toBe(true);
    const cartoes = Array.from(lista.querySelectorAll('.mk-dp-tl__card--curto'));
    const resumo = (c) => ({
      titulo: c.querySelector('.mk-dp-tl__titulo')?.textContent,
      sub: c.querySelector('.mk-dp-tl__lote')?.textContent,
      qtd: c.querySelector('.mk-dp-tl__qtd > span[aria-hidden]')?.textContent,
      sacos: c.querySelector('.mk-dp-dep13__qtd-sub')?.textContent ?? null,
      tom: c.querySelector('.mk-dp-tl__qtd')?.getAttribute('data-tom'),
      sr: c.querySelector('.mk-dp-tl__qtd .mk-dp-tl__sr')?.textContent,
    });
    expect(cartoes.map(resumo)).toEqual([
      { titulo: 'Entrada no depósito', sub: 'ÓLEO', qtd: '+20 L', sacos: null, tom: 'entrada', sr: 'Entraram 20,00 L' },
      { titulo: 'Saída do depósito', sub: 'SAL MINERAL 80 · Suplementação · Cocho 02', qtd: '−400 kg', sacos: '16,00 sacos', tom: 'saida', sr: 'Saíram 400,00 kg, 16,00 sacos' },
      { titulo: 'Entrada no depósito', sub: 'SAL MINERAL 80 · de Galpão Central', qtd: '+1.000 kg', sacos: '40,00 sacos', tom: 'entrada', sr: 'Entraram 1.000,00 kg, 40,00 sacos' },
    ]);
  });
});

describe('DV-8 — carregando', () => {
  it('dentro da casca v12, com o rodapé', async () => {
    dados.pendente = true;
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={qc}>
        <DetalhesDepositoSuplementacao deposito={DEPOSITO} onClose={() => {}} />
      </QueryClientProvider>,
    );
    const status = await screen.findByRole('status');
    expect(status.textContent).toBe('Carregando detalhes do depósito...');
    expect(status.closest('.mk-dp__corpo')).toBeTruthy();
    expect(screen.queryByRole('region', { name: 'Nível do depósito' })).toBeNull();
    expect(pilulas()).toEqual(['Entrada', 'Saída']);
  });
});

describe('DV-9 — movimentacoesDoHistoricoDeposito (regra do histórico completo)', () => {
  const filtro = { empresaId: EMP, localEstoqueId: LOCAL };
  it('só a empresa e o local; sem reversão; cada lado da transferência e a suplementação no depósito certo', () => {
    const lista = [
      ...MOVS,
      mov('outra-empresa', { ...em('2026-11-12'), empresa_id: 'emp-2', local_estoque_destino: LOCAL }),
      mov('outro-local', { ...em('2026-11-12'), local_estoque_destino: 'loc-y' }),
      mov('reversao-cocho', { ...em('2026-11-12'), tipo_detalhado: 'ajuste_positivo', observacoes: 'Reversão do lançamento do cocho 02', local_estoque_destino: LOCAL }),
      mov('supl-chegando', { ...em('2026-11-12'), tipo_detalhado: 'suplementacao', local_estoque_origem: 'loc-y', local_estoque_destino: LOCAL }),
      mov('recebida-saindo', { ...em('2026-11-12'), tipo_detalhado: 'transferencia_recebida', local_estoque_origem: LOCAL, local_estoque_destino: 'loc-y' }),
    ];
    expect(movimentacoesDoHistoricoDeposito(lista, filtro).map((m) => m.id)).toEqual(['mv-litro', 'mv-sai', 'mv-ent']);
    expect(movimentacoesDoHistoricoDeposito(null, filtro)).toEqual([]);
  });

  it('só exclusão no mapa: registro excluído (Estornada) e os estorno_* do servidor não entram; os outros ficam com o saldo gravado', () => {
    const lista = [
      ...MOVS.map((m) => (m.id === 'mv-ent' ? { ...m, saldo_antes: 400, saldo_depois: 1400 } : m)),
      mov('transf-excluida-saida', { ...em('2026-11-12'), tipo_detalhado: 'transferencia_enviada', status: 'Estornada', local_estoque_origem: LOCAL, local_estoque_destino: 'loc-y' }),
      mov('transf-excluida-entrada', { ...em('2026-11-12'), tipo_detalhado: 'transferencia_recebida', status: 'Estornada', local_estoque_origem: 'loc-y', local_estoque_destino: LOCAL }),
      mov('supl-excluida', { ...em('2026-11-12'), tipo_detalhado: 'suplementacao', status: 'Estornada', local_estoque_origem: LOCAL }),
      mov('est-env', { ...em('2026-11-13'), tipo_detalhado: 'estorno_transferencia_enviada', local_estoque_destino: LOCAL }),
      mov('est-rec', { ...em('2026-11-13'), tipo_detalhado: 'estorno_transferencia_recebida', local_estoque_origem: LOCAL }),
      mov('est-supl', { ...em('2026-11-13'), tipo_detalhado: 'estorno_suplementacao', local_estoque_destino: LOCAL }),
    ];
    const saida = movimentacoesDoHistoricoDeposito(lista, filtro);
    expect(saida.map((m) => m.id)).toEqual(['mv-litro', 'mv-sai', 'mv-ent']);
    expect([saida[2].saldo_antes, saida[2].saldo_depois]).toEqual([400, 1400]);
  });

  it('ordem: registro mais novo primeiro (created_date); empate, a data da movimentação', () => {
    const a = mov('a', { created_date: '2026-11-05T10:00:00.000Z', data_movimentacao: '2026-11-01T12:00:00.000Z', local_estoque_destino: LOCAL });
    const b = mov('b', { created_date: '2026-11-06T10:00:00.000Z', data_movimentacao: '2026-10-20T12:00:00.000Z', local_estoque_destino: LOCAL });
    const c = mov('c', { created_date: '2026-11-05T10:00:00.000Z', data_movimentacao: '2026-11-03T12:00:00.000Z', local_estoque_destino: LOCAL });
    expect(movimentacoesDoHistoricoDeposito([a, b, c], filtro).map((m) => m.id)).toEqual(['b', 'c', 'a']);
  });
});
