/**
 * D-PROD-159 — FE7: fatores de conversão kg/L na tela Abastecimentos (backend
 * falso). Lista com vigente e histórico; "Novo fator" só com
 * `configurar_conversao`; declaração obrigatória; fator 0 < f ≤ 10 (texto, sem
 * float); `conversao_vigente_id` = vigente lida para o par; 409
 * `vigente_divergente` relê e o próximo envio aponta para a vigente atual;
 * encerrar com confirmação.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { screen, fireEvent, waitFor, within, act, cleanup } from '@testing-library/react';
import { escolherNoSeletor, montar, permissaoCom, prepararAmbiente } from './fixtures/abastecimentosTela.jsx';

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
  sessao.permissao = permissaoCom({ configurar_conversao: true });
  amb = await prepararAmbiente(vi);
});

afterEach(() => {
  cleanup();
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

const criacoes = () => amb.backend.chamadas.filter((c) => c.method === 'POST' && c.path === '/patrimonio-conversoes-combustivel');

const abrirFatores = async () => {
  await montar();
  fireEvent.click(await screen.findByTestId('abastecimento-fatores'));
  const painel = await screen.findByTestId('conversoes-combustivel');
  await within(painel).findByTestId('conversoes-lista');
  return painel;
};

const digitarFator = (painel, valor) => {
  const campo = within(painel).getByTestId('conversao-fator');
  fireEvent.change(campo, { target: { value: valor } });
  fireEvent.blur(campo);
};

describe('FE7 — fatores kg/L', () => {
  it('só visualizar: lista vigentes e histórico, sem "Novo fator" nem Alterar/Encerrar', async () => {
    sessao.permissao = permissaoCom({ novo: true });
    const painel = await abrirFatores();
    const linhas = within(within(painel).getByTestId('conversoes-lista')).getAllByRole('row');
    expect(linhas.map((l) => l.textContent)).toEqual([
      expect.stringContaining('Combustível'),
      expect.stringMatching(/Etanol.*Etanol hidratado.*1.*0,789100.*Vigente/),
      expect.stringMatching(/Diesel S10.*Diesel S10 granel.*1.*0,840000.*Vigente/),
    ]);
    expect(within(painel).queryByTestId('conversao-nova')).toBeNull();
    expect(within(painel).queryByTestId('conversao-encerrar-f1')).toBeNull();
    expect(within(painel).queryByTestId('conversao-alterar-f1')).toBeNull();
    expect(amb.backend.chamadas.find((c) => c.path === '/patrimonio-conversoes-combustivel').query).toEqual({ empresa_id: 'emp-1', situacao: 'TODAS', limit: '50' });
  });

  it('novo fator: declaração obrigatória, teto 10 local, corpo EXATO com conversao_vigente_id null', async () => {
    const painel = await abrirFatores();
    fireEvent.click(within(painel).getByTestId('conversao-nova'));
    await escolherNoSeletor(painel, 'conversao-tipo', /Gasolina/);
    await escolherNoSeletor(painel, 'conversao-produto', /Gasolina comum/);
    expect(within(painel).getByTestId('conversao-vigente')).toHaveTextContent('Este par não tem fator vigente: salvar cria uma nova versão.');
    digitarFator(painel, '12');
    fireEvent.click(within(painel).getByTestId('conversao-salvar'));
    expect(await within(painel).findByText('Informe um fator maior que zero e até 10.')).toBeTruthy();
    expect(within(painel).getByText('Marque a declaração de que o estoque está em KG.')).toBeTruthy();
    expect(criacoes()).toEqual([]);
    digitarFator(painel, '0,745');
    fireEvent.click(within(painel).getByTestId('conversao-declaracao'));
    await act(async () => fireEvent.click(within(painel).getByTestId('conversao-salvar')));
    await waitFor(() => expect(criacoes()).toHaveLength(1));
    expect(criacoes()[0].body).toEqual({ empresa_id: 'emp-1', tipo_combustivel_id: 'c2', produto_id: 'p2', kg_por_litro: '0.745', declara_estoque_em_kg: true, conversao_vigente_id: null });
    await waitFor(() => expect(within(painel).getByTestId('conversoes-lista')).toHaveTextContent(/Gasolina comum.*0,745000.*Vigente/));
    expect(within(painel).queryByTestId('conversao-form')).toBeNull();
  });

  it('alterar = nova versão: envia a vigente do par; 409 vigente_divergente relê e o 2º envio aponta para a atual', async () => {
    const painel = await abrirFatores();
    fireEvent.click(within(painel).getByTestId('conversao-alterar-f1'));
    expect(within(painel).getByTestId('conversao-vigente')).toHaveTextContent('Fator vigente: 0,840000 kg/L (versão 1). Salvar encerra este e cria a versão 2.');
    digitarFator(painel, '0,85');
    fireEvent.click(within(painel).getByTestId('conversao-declaracao'));
    // Outro usuário trocou o fator do par enquanto este editava.
    const f1 = amb.estado.conversoes.find((c) => c.id === 'f1');
    Object.assign(f1, { ativo: false, versao: 2 });
    amb.estado.conversoes.push({ id: 'f-outro', tipo: 'c1', produto: 'p1', sequencia: 2, kg_por_litro: '0.830000', ativo: true, versao: 1, encerrado_em: null, criado_por: { id: 'u9', login: 'outro' } });
    await act(async () => fireEvent.click(within(painel).getByTestId('conversao-salvar')));
    expect(await within(painel).findByTestId('conversao-erro')).toHaveTextContent('O fator vigente deste par mudou enquanto você editava. A lista foi relida: confira e salve de novo. Nada foi gravado.');
    expect(criacoes()[0].body.conversao_vigente_id).toBe('f1');
    await act(async () => fireEvent.click(within(painel).getByTestId('conversao-salvar')));
    await waitFor(() => expect(criacoes()).toHaveLength(2));
    expect(criacoes()[1].body).toEqual({ empresa_id: 'emp-1', tipo_combustivel_id: 'c1', produto_id: 'p1', kg_por_litro: '0.85', declara_estoque_em_kg: true, conversao_vigente_id: 'f-outro' });
    await waitFor(() => expect(within(painel).getByTestId('conversoes-lista')).toHaveTextContent(/Diesel S10 granel3 ?0,850000Vigente/));
    expect(within(painel).getByTestId('conversao-f1')).toHaveTextContent('Encerrado');
  });

  it('encerrar pede confirmação e manda {empresa_id, versao}', async () => {
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    const painel = await abrirFatores();
    await act(async () => fireEvent.click(within(painel).getByTestId('conversao-encerrar-f3')));
    await waitFor(() => expect(amb.backend.chamadas.some((c) => c.path === '/patrimonio-conversoes-combustivel/f3/encerrar')).toBe(true));
    expect(amb.backend.chamadas.find((c) => c.path === '/patrimonio-conversoes-combustivel/f3/encerrar').body).toEqual({ empresa_id: 'emp-1', versao: 1 });
    await waitFor(() => expect(within(painel).getByTestId('conversao-f3')).toHaveTextContent('Encerrado'));
  });

  it('FE-04: encerrar com a versão lida desatualizada (409 PATRIMONIO_VERSAO_CONFLITO) fala do FATOR, não do abastecimento, e relê', async () => {
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    const painel = await abrirFatores();
    // Outra pessoa mexeu no fator depois de a lista ser lida.
    amb.estado.conversoes.find((c) => c.id === 'f1').versao = 2;
    const leiturasAntes = amb.backend.chamadas.filter((c) => c.method === 'GET' && c.path === '/patrimonio-conversoes-combustivel').length;
    await act(async () => fireEvent.click(within(painel).getByTestId('conversao-encerrar-f1')));
    await waitFor(() => expect(amb.backend.chamadas.some((c) => c.path === '/patrimonio-conversoes-combustivel/f1/encerrar')).toBe(true));
    expect(amb.backend.chamadas.find((c) => c.path === '/patrimonio-conversoes-combustivel/f1/encerrar').body).toEqual({ empresa_id: 'emp-1', versao: 1 });
    expect(await screen.findByText('O fator mudou desde que a lista foi lida (outra pessoa alterou ou encerrou). A lista foi relida; nada foi alterado.')).toBeTruthy();
    expect(document.body.textContent).not.toContain('O abastecimento mudou desde que você o abriu');
    await waitFor(() => expect(amb.backend.chamadas.filter((c) => c.method === 'GET' && c.path === '/patrimonio-conversoes-combustivel').length).toBeGreaterThan(leiturasAntes));
    expect(amb.estado.conversoes.find((c) => c.id === 'f1').ativo).toBe(true);
  });

  it('FE-05: par sem fator vigente mas com versão encerrada não promete "versão 1"; o toast mostra a versão que o servidor criou', async () => {
    Object.assign(amb.estado.conversoes.find((c) => c.id === 'f1'), { ativo: false, versao: 2, encerrado_em: '2026-11-01T10:00:00.000Z' });
    const painel = await abrirFatores();
    fireEvent.click(within(painel).getByTestId('conversao-nova'));
    await escolherNoSeletor(painel, 'conversao-tipo', /Diesel S10/);
    await escolherNoSeletor(painel, 'conversao-produto', /Diesel S10 granel/);
    expect(within(painel).getByTestId('conversao-vigente')).toHaveTextContent('Este par não tem fator vigente: salvar cria uma nova versão.');
    expect(within(painel).getByTestId('conversao-vigente').textContent).not.toMatch(/versão 1/);
    digitarFator(painel, '0,85');
    fireEvent.click(within(painel).getByTestId('conversao-declaracao'));
    await act(async () => fireEvent.click(within(painel).getByTestId('conversao-salvar')));
    await waitFor(() => expect(criacoes()).toHaveLength(1));
    expect(amb.estado.conversoes.at(-1).sequencia).toBe(2);
    expect(await screen.findByText('Fator 0,850000 kg/L vigente (versão 2).')).toBeTruthy();
  });
});
