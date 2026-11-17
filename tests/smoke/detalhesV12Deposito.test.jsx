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
 *  DV-3. aviso do v12 quando o saldo chega ao mínimo (abaixo / no mínimo);
 *        acima do mínimo, sem aviso.
 *  DV-4. rodapé Entrada · Saída · Histórico com as permissões de hoje (sem a
 *        permissão a pílula não aparece); as pílulas abrem a transferência e o
 *        histórico completo nos diálogos de hoje.
 *  DV-5. pastos atendidos: um item por cocho vinculado (ordem de nome), meta
 *        "pastos · produto padrão", bolinha do farol da última leitura e o
 *        ícone do marcador com o nível do SSOT; com `onAbrirCocho`, chevron e
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

const dados = vi.hoisted(() => ({ lotesNota: [], produtos: [], movimentacoes: [], pontos: [], areas: [], cache: {}, pendente: false }));

vi.mock('@/hooks/useEmpresaSelecionadaId', () => ({ useEmpresaSelecionadaId: () => 'emp-1' }));
vi.mock('@/services/estoqueMapaService', () => ({
  listarTodosLotesNota: vi.fn(async () => (dados.pendente ? new Promise(() => {}) : dados.lotesNota)),
  listarTodosProdutos: vi.fn(async () => dados.produtos),
  listarTodasMovimentacoes: vi.fn(async () => dados.movimentacoes),
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
// O jsdom não lê um `data:` URL longo em `background-image`: o ícone vira um marcador legível
// com os argumentos (fração do SSOT e "marcador do mapa").
vi.mock('@/assets/icones/cocho-descoberto', async (importOriginal) => ({
  ...(await importOriginal()),
  urlIconeCocho: (fracao, marcador) => `icone-cocho:${fracao}:${marcador}`,
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
const historico = () => screen.getByRole('list', { name: 'Histórico do depósito' });
const cartoesDoHistorico = () => Array.from(historico().querySelectorAll('.mk-dp-tl__card'));
const linhasDoCartao = (cartao) => Array.from(cartao.querySelectorAll('.mk-dp-tl__row')).map((r) => `${r.querySelector('dt').textContent}: ${r.querySelector('dd').textContent}`);
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
    await waitFor(() => expect(historico()).toBeTruthy());
    const estranhas = Array.from(corpo().querySelectorAll('[class]'))
      .flatMap((el) => String(el.getAttribute('class')).split(/\s+/))
      .filter((c) => c && !/^(mk-dp|lucide|is-)/.test(c));
    expect(estranhas).toEqual([]);
  });
});

describe('DV-2 — seções na ordem do v12', () => {
  it('nível, saldo por produto, pastos atendidos, informações e histórico; o bloco do nível com o texto do v12', async () => {
    await montar();
    await waitFor(() => expect(cartoesDoHistorico()).toHaveLength(2));
    const titulos = within(corpo()).getAllByRole('heading', { level: 3 }).map((h) => h.textContent);
    expect(titulos).toEqual([
      'Nível do depósito', 'Saldo por produto', 'Pastos atendidos', 'Informações do depósito', 'Histórico do depósito', '09 NOV. 2026', '04 NOV. 2026',
    ]);
    // Bloco do nível: rótulo, o percentual do SSOT e as duas linhas do v12.
    const nivel = within(secao()).getByTestId('nivel-do-deposito');
    expect(nivel.classList.contains('mk-dp-nivel')).toBe(true);
    expect(within(nivel).getByText('70%')).toBeTruthy();
    expect(within(nivel).getByText('1.400 kg de 2.000 kg (limite operacional)')).toBeTruthy();
    expect(within(nivel).getByText('Necessidade de reposição: 600 kg')).toBeTruthy();
    expect(nivel.querySelector('img[data-deposito-icone]')).toBeTruthy();
    // Grade da região: o medidor e as células de hoje, na ordem.
    const rotulos = Array.from(secao().querySelectorAll('.mk-dp-grade > .mk-dp-cel > dt')).map((dt) => dt.textContent);
    expect(rotulos).toEqual(['Ocupação do limite operacional', 'Estoque mínimo', 'Saldo atual kg', 'Saldo em sacos', 'Necessidade reposição kg']);
    expect(within(secao()).getByRole('meter', { name: 'Ocupação do limite operacional' }).getAttribute('aria-valuenow')).toBe('70');
    expect(within(screen.getByRole('group', { name: 'Estoque mínimo' })).getByText('Mínimo 500 kg · 900 kg acima do mínimo')).toBeTruthy();
    // Saldo por produto: uma linha por produto (sacos embaixo, kg à direita).
    const linha = screen.getByText('SAL MINERAL 80', { selector: '.mk-dp-linha__rot' }).closest('[data-unidade-confirmada]');
    expect(linha.getAttribute('data-unidade-confirmada')).toBe('true');
    expect(linha.querySelector('.mk-dp-linha__sub')?.textContent).toBe('56,00 sacos');
    expect(linha.querySelector('.mk-dp-linha__val')?.textContent).toBe('1.400 kg');
  });

  it('sem limite operacional: o rótulo neutro no lugar do número, a mensagem e o que fazer só no bloco do nível', async () => {
    await montar({ deposito: { ...DEPOSITO, capacidade_cocho_kg: null } });
    const nivel = within(secao()).getByTestId('nivel-do-deposito');
    expect(nivel.querySelector('[data-deposito-rotulo-neutro]')?.textContent).toBe('Sem limite');
    expect(within(nivel).getByText('Limite operacional não configurado; não há percentual.')).toBeTruthy();
    expect(within(nivel).getByText('Configure o limite operacional no cadastro do ponto.')).toBeTruthy();
    // A célula do medidor fica neutra ("—", trilha tracejada), sem repetir a mensagem.
    const medidor = secao().querySelector('.mk-dp-medidor');
    expect(medidor.querySelector('dd')?.textContent).toBe('—');
    expect(medidor.querySelector('[data-medidor-trilha="neutra"]')).toBeTruthy();
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

describe('DV-3 — aviso do mínimo (v12)', () => {
  it('abaixo do mínimo, no mínimo e acima', async () => {
    dados.lotesNota = [loteNota(400)];
    await montar();
    await waitFor(() => expect(within(secao()).getByText('Saldo 400 kg abaixo do mínimo configurado (500 kg).')).toBeTruthy());
    expect(within(secao()).getByText('Saldo 400 kg abaixo do mínimo configurado (500 kg).').closest('.mk-dp-aviso--atencao')).toBeTruthy();
    cleanup();
    dados.lotesNota = [loteNota(500)];
    await montar();
    await waitFor(() => expect(within(secao()).getByText('Saldo 500 kg no mínimo configurado (500 kg).')).toBeTruthy());
    cleanup();
    dados.lotesNota = [loteNota(1400)];
    await montar();
    expect(secao().querySelector('.mk-dp-aviso--atencao')).toBeNull();
    expect(within(secao()).queryByText(/mínimo configurado/)).toBeNull();
  });
});

describe('DV-4 — rodapé de pílulas com as permissões de hoje', () => {
  it('Entrada · Saída · Histórico; sem a permissão a pílula não aparece; sem nenhuma, rodapé vazio', async () => {
    await montar();
    expect(pilulas()).toEqual(['Entrada', 'Saída', 'Histórico']);
    cleanup();
    await montar({ permissions: { movimentar_depositos: false } });
    expect(pilulas()).toEqual(['Histórico']);
    cleanup();
    await montar({ permissions: { visualizar_historico_cocho: false } });
    expect(pilulas()).toEqual(['Entrada', 'Saída']);
    cleanup();
    await montar({ permissions: { movimentar_depositos: false, visualizar_historico_cocho: false } });
    expect(screen.queryByRole('group', { name: 'Ações' })).toBeNull();
    expect(document.querySelector('.mk-dp__rodape')?.childElementCount).toBe(0);
  });

  it('Entrada e Saída abrem a transferência de hoje; Histórico abre o histórico completo', async () => {
    await montar();
    await tocar(screen.getByRole('button', { name: 'Entrada' }));
    expect(await screen.findByRole('heading', { name: 'Entrada no Depósito' })).toBeTruthy();
    expect(screen.getByText('formulário da transferência: entrada')).toBeTruthy();
    cleanup();
    await montar();
    await tocar(screen.getByRole('button', { name: 'Saída' }));
    expect(await screen.findByRole('heading', { name: 'Saída do Depósito' })).toBeTruthy();
    expect(screen.getByText('formulário da transferência: saida')).toBeTruthy();
    cleanup();
    await montar();
    await tocar(screen.getByRole('button', { name: 'Histórico' }));
    const dialogo = await screen.findByRole('dialog', { name: 'Histórico do Depósito' });
    expect(within(dialogo).getByText('histórico completo do depósito')).toBeTruthy();
  });
});

describe('DV-5 — pastos atendidos', () => {
  it('um item por cocho do depósito, em ordem de nome, com meta, farol e o ícone do marcador pelo SSOT', async () => {
    await montar();
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
    // Ícone do MARCADOR do mapa com o nível do SSOT (o mesmo número do marcador); sem lançamento, vazio.
    const fracao02 = calcularNivelCocho({ ponto: C02, eventos: [EVENTO_C02], hoje: HOJE, pontos: PONTOS }).fracaoParaSvg;
    expect(fracao02).toBeGreaterThan(0);
    await waitFor(() => expect(itens[0].querySelector('.mk-dp-item__img')?.style.backgroundImage).toBe(`url("icone-cocho:${fracao02}:true")`));
    expect(itens[1].querySelector('.mk-dp-item__img')?.style.backgroundImage).toBe('url("icone-cocho:0:true")');
    // Sem `onAbrirCocho`, o item só informa: sem botão nem chevron.
    expect(within(lista).queryAllByRole('button')).toHaveLength(0);
    expect(lista.querySelector('.mk-dp-chev')).toBeNull();
  });

  it('com onAbrirCocho: chevron e o toque abre o cocho', async () => {
    const onAbrirCocho = vi.fn();
    await montar({ onAbrirCocho });
    const lista = screen.getByRole('list', { name: 'Pastos atendidos' });
    expect(lista.querySelectorAll('.mk-dp-chev')).toHaveLength(2);
    await tocar(within(lista).getByRole('button', { name: /^Cocho 05/ }));
    expect(onAbrirCocho).toHaveBeenCalledTimes(1);
    expect(onAbrirCocho).toHaveBeenCalledWith(C05);
  });

  it('sem cocho vinculado: "Nenhum cocho vinculado a este depósito."', async () => {
    dados.pontos = [DE_OUTRO_DEPOSITO, DEPOSITO];
    await montar();
    const linha = screen.getByText('Nenhum cocho vinculado a este depósito.').closest('.mk-dp-linha');
    expect(linha.classList.contains('mk-dp-deposito__linha--fraca')).toBe(true);
    expect(screen.queryByRole('list', { name: 'Pastos atendidos' })).toBeNull();
  });
});

describe('DV-6 — informações do depósito', () => {
  it('grade do cadastro, cochos vinculados e observações; sem "Frequência padrão"', async () => {
    await montar();
    const info = informacoes();
    const celulas = Array.from(info.querySelectorAll('.mk-dp-cel')).map((c) => `${c.querySelector('dt').textContent}: ${c.querySelector('dd').textContent}`);
    expect(celulas).toEqual([
      'Número: DP-01', 'Sigla: DS', 'Tipo: Galpão', 'Local de estoque: Galpão Sede', 'Produto padrão: SAL MINERAL 80',
      'Limite operacional: 2.000 kg', 'Estoque mínimo: 500 kg',
    ]);
    const linhas = Array.from(info.querySelectorAll('.mk-dp-linha')).map((l) => `${l.querySelector('.mk-dp-linha__rot').textContent}: ${l.querySelector('.mk-dp-linha__val').textContent}`);
    expect(linhas).toEqual(['Cochos vinculados: Cocho 02, Cocho 05', 'Observações: Conferir a lona do galpão nas chuvas.']);
    expect(info.querySelectorAll('.mk-dp-linha--quebra')).toHaveLength(2);
    expect(screen.queryByText(/Frequência/)).toBeNull();
  });

  it('cadastro vazio: "—" nas células e nas linhas', async () => {
    dados.pontos = [];
    await montar({ deposito: { ...DEPOSITO, numero_ponto: null, sigla: '', tipo: null, produto_padrao: null, observacoes: null, capacidade_cocho_kg: null, estoque_minimo_kg: null } });
    const info = informacoes();
    const valores = Array.from(info.querySelectorAll('.mk-dp-cel dd')).map((dd) => dd.textContent);
    expect(valores).toEqual(['—', '—', '—', 'Galpão Sede', '—', '—', '—']);
    expect(Array.from(info.querySelectorAll('.mk-dp-linha__val')).map((v) => v.textContent)).toEqual(['—', '—']);
  });
});

describe('DV-7 — linha do tempo do depósito', () => {
  it('a regra do histórico completo, sem o L: saída e entrada com as linhas do v12', async () => {
    await montar();
    await waitFor(() => expect(cartoesDoHistorico()).toHaveLength(2));
    const [saida, entrada] = cartoesDoHistorico();
    expect(saida.querySelector('.mk-dp-tl__titulo')?.textContent).toBe('Saída do depósito');
    expect(saida.querySelector('svg')?.getAttribute('class')).toContain('lucide-log-out');
    expect(linhasDoCartao(saida)).toEqual(['Destino: Suplementação · Cocho 02', 'Produto: SAL MINERAL 80', 'Quantidade (kg): 400,00', 'Sacos: 16,00']);
    expect(entrada.querySelector('.mk-dp-tl__titulo')?.textContent).toBe('Entrada no depósito');
    expect(entrada.querySelector('svg')?.getAttribute('class')).toContain('lucide-truck');
    expect(linhasDoCartao(entrada)).toEqual(['Origem: Galpão Central', 'Produto: SAL MINERAL 80', 'Quantidade (kg): 1.000,00', 'Sacos: 40,00', 'Observações: NF 4.512']);
    expect(within(historico()).getAllByRole('heading').map((h) => h.textContent)).toEqual(['09 NOV. 2026', '04 NOV. 2026']);
    // Reversão, o lado "enviada" da transferência e o litro ficam fora (como no histórico / último registro).
    expect(historico().textContent).not.toContain('ÓLEO');
    expect(historico().textContent).not.toContain('50,00');
  });

  it('no máximo 5 cartões (a pílula Histórico abre o resto), na ordem do histórico completo', async () => {
    dados.movimentacoes = Array.from({ length: 7 }, (_, i) =>
      mov(`m${i}`, { ...em(`2026-11-0${i + 1}`), tipo_movimentacao: 'Entrada', quantidade: 10 * (i + 1), local_estoque_destino: LOCAL }));
    await montar();
    await waitFor(() => expect(cartoesDoHistorico()).toHaveLength(5));
    expect(cartoesDoHistorico().map((c) => linhasDoCartao(c)[2])).toEqual(['Quantidade (kg): 70,00', 'Quantidade (kg): 60,00', 'Quantidade (kg): 50,00', 'Quantidade (kg): 40,00', 'Quantidade (kg): 30,00']);
  });

  it('sem "Ver histórico de cocho / depósito": só o último registro (como antes do v12), sem a pílula Histórico', async () => {
    dados.movimentacoes = Array.from({ length: 7 }, (_, i) =>
      mov(`m${i}`, { ...em(`2026-11-0${i + 1}`), tipo_movimentacao: 'Entrada', quantidade: 10 * (i + 1), local_estoque_destino: LOCAL }));
    await montar({ permissions: { visualizar_historico_cocho: false } });
    const ultimo = await screen.findByRole('list', { name: 'Último registro' });
    await waitFor(() => expect(ultimo.querySelectorAll('.mk-dp-tl__card')).toHaveLength(1));
    expect(ultimo.textContent).toContain('70,00');
    expect(screen.getByRole('heading', { name: 'Último registro' })).toBeTruthy();
    expect(screen.queryByRole('list', { name: 'Histórico do depósito' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Histórico' })).toBeNull();
  });

  it('sem movimentação: "Nenhum registro ainda."', async () => {
    dados.movimentacoes = [];
    await montar();
    expect(screen.getByText('Nenhum registro ainda.').closest('.mk-dp-vazio')).toBeTruthy();
    expect(screen.queryByRole('list', { name: 'Histórico do depósito' })).toBeNull();
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
    expect(pilulas()).toEqual(['Entrada', 'Saída', 'Histórico']);
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

  it('ordem: registro mais novo primeiro (created_date); empate, a data da movimentação', () => {
    const a = mov('a', { created_date: '2026-11-05T10:00:00.000Z', data_movimentacao: '2026-11-01T12:00:00.000Z', local_estoque_destino: LOCAL });
    const b = mov('b', { created_date: '2026-11-06T10:00:00.000Z', data_movimentacao: '2026-10-20T12:00:00.000Z', local_estoque_destino: LOCAL });
    const c = mov('c', { created_date: '2026-11-05T10:00:00.000Z', data_movimentacao: '2026-11-03T12:00:00.000Z', local_estoque_destino: LOCAL });
    expect(movimentacoesDoHistoricoDeposito([a, b, c], filtro).map((m) => m.id)).toEqual(['b', 'c', 'a']);
  });
});
