/**
 * D-PROD-161 (MAIKE-ESTOQUE-P0-01, R2) — máscaras numéricas do Cadastro de
 * Produtos: o valor GRAVADO tem de ser o valor EXIBIDO.
 *
 * Defeito (reproduzido no Chromium e no banco local): o campo mostra
 * `formatarMoedaInput(parseMoedaInput(texto))` — máscara de centavos, os
 * dígitos divididos por 100 — mas o envio gravava `parseDecimalPtBR(texto)`,
 * outra leitura do MESMO texto. Digitar "3000" no Peso por saco mostra
 * "30,00" e gravava 3; colar "2500" mostra "25,00" e gravava 2500. O Peso por
 * saco vira o fator SACO→KG das compras seguintes (`fator_kg`), então um
 * produto usado no estoque recebia lotes com a quantidade errada.
 *
 * Correção mínima: uma única leitura do campo serve à tela e ao envio.
 *
 *  MP1. digitação tecla a tecla: exibido "30,00" ⇒ enviado 30 (peso por saco);
 *  MP2. colagem de uma vez: exibido "25,00" ⇒ enviado 25 (preço de custo);
 *  MP3. edição de valor existente apagando e digitando: o enviado é o exibido;
 *  MP4. valor lido do servidor sem edição continua igual (número ou texto
 *       decimal canônico do banco);
 *  MP5. campo apagado continua indo como vazio/zero, como antes.
 */
import React from 'react';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup, act } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

vi.mock('@/services/produtoService', async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...actual,
    carregarFontesDoFormulario: vi.fn(async () => ({ categorias: [], unidades: [], locais: [], marcas: [] })),
  };
});
vi.mock('@/hooks/useEmpresaSelecionadaId', () => ({ useEmpresaSelecionadaId: () => 'emp-1' }));
vi.mock('@/lib/maikeNotify', () => ({
  notifySuccess: vi.fn(),
  notifyWarning: vi.fn(),
  notifyError: vi.fn(),
  notifyExclusoesEmpilhadas: vi.fn(),
}));

const { default: FormularioProduto } = await import('@/components/produtos/FormularioProduto');

const BASE = {
  id: 'p1',
  empresa_id: 'emp-1',
  nome_produto: 'NÚCLEO P0',
  codigo_interno: 'N0',
  unidade_medida: 'KG',
  categoria: 'SUPLEMENTOS',
  local_estoque: 'DEPÓSITO CENTRAL',
  unidade_principal_estoque: 'SACO',
  ativo: true,
};

afterEach(() => cleanup());

const montar = (initialData) => {
  const onSubmit = vi.fn();
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={queryClient}>
      <FormularioProduto variant="embedded" toolbarActions isEditing initialData={initialData} onSubmit={onSubmit} onCancel={vi.fn()} />
    </QueryClientProvider>,
  );
  const form = screen.getByTestId('b1-form-produto');
  const campo = (rotulo) => {
    const label = [...form.querySelectorAll('label')].find((l) => l.textContent.replace(/\s*\*\s*$/, '').trim() === rotulo);
    expect(label, `campo "${rotulo}"`).toBeTruthy();
    return label.closest('.mg-field').querySelector('input');
  };
  const enviar = async () => {
    await act(async () => {
      fireEvent.submit(form);
    });
    expect(onSubmit).toHaveBeenCalledTimes(1);
    return onSubmit.mock.calls[0][0];
  };
  return { campo, enviar };
};

/** Como o navegador: cada tecla acrescenta ao texto EXIBIDO e dispara um `input`. */
const digitar = (input, texto) => {
  for (const k of texto) fireEvent.change(input, { target: { value: `${input.value}${k}` } });
};
/** Apaga o último caractere do texto exibido (Backspace com o cursor no fim). */
const apagar = (input, vezes = 1) => {
  for (let i = 0; i < vezes; i += 1) fireEvent.change(input, { target: { value: input.value.slice(0, -1) } });
};

describe('D-PROD-161 — máscaras do Produto: gravado = exibido', () => {
  it('MP1 — digitação tecla a tecla no Peso por saco: "30,00" na tela ⇒ 30 no envio', async () => {
    const { campo, enviar } = montar({ ...BASE, peso_por_saco_kg: null, preco_custo: 2 });
    const peso = campo('Peso por saco (kg)');
    apagar(peso, peso.value.length);
    digitar(peso, '3000');
    expect(peso.value).toBe('30,00');
    const payload = await enviar();
    expect(payload.peso_por_saco_kg).toBe(30);
  });

  it('MP2 — colagem de uma vez no Preço de Custo: "25,00" na tela ⇒ 25 no envio', async () => {
    const { campo, enviar } = montar({ ...BASE, peso_por_saco_kg: 30, preco_custo: 0 });
    const preco = campo('Preço de Custo');
    fireEvent.change(preco, { target: { value: '2500' } });
    expect(preco.value).toBe('25,00');
    const payload = await enviar();
    expect(payload.preco_custo).toBe(25);
    expect(payload.peso_por_saco_kg).toBe(30);
  });

  it('MP3 — editar o valor existente (apagar e digitar): o enviado é o exibido', async () => {
    const { campo, enviar } = montar({ ...BASE, peso_por_saco_kg: 30, preco_custo: 2, estoque_minimo: 10 });
    const peso = campo('Peso por saco (kg)');
    expect(peso.value).toBe('30,00');
    apagar(peso);
    expect(peso.value).toBe('3,00');
    digitar(peso, '5');
    const exibido = peso.value;
    expect(exibido).toBe('30,05');
    const minimo = campo('Estoque Mínimo');
    digitar(minimo, '0');
    expect(minimo.value).toBe('100,00');
    const payload = await enviar();
    expect(payload.peso_por_saco_kg).toBe(30.05);
    expect(payload.estoque_minimo).toBe(100);
    expect(payload.preco_custo).toBe(2);
  });

  it('MP4 — sem edição, o valor lido do servidor volta igual (número ou decimal canônico)', async () => {
    const { campo, enviar } = montar({ ...BASE, peso_por_saco_kg: '30.0000', preco_custo: 2.5, preco_venda: '3.5000' });
    expect(campo('Peso por saco (kg)').value).toBe('30,00');
    expect(campo('Preço de Custo').value).toBe('2,50');
    expect(campo('Preço de Venda').value).toBe('3,50');
    const payload = await enviar();
    expect(payload.peso_por_saco_kg).toBe(30);
    expect(payload.preco_custo).toBe(2.5);
    expect(payload.preco_venda).toBe(3.5);
  });

  it('MP5 — campo apagado vai como antes: preço 0 e peso ausente bloqueiam/zeram igual', async () => {
    const { campo, enviar } = montar({ ...BASE, unidade_principal_estoque: 'KG', peso_por_saco_kg: null, preco_custo: 2 });
    const preco = campo('Preço de Custo');
    apagar(preco, preco.value.length);
    expect(preco.value).toBe('0,00');
    const payload = await enviar();
    expect(payload.preco_custo).toBe(0);
    expect(payload.peso_por_saco_kg).toBeUndefined();
  });
});
