/**
 * Opções e reconciliação do abastecimento (D-PROD-359): o que o formulário lê e mantém coerente — os Produtos do bem (opção
 * do SERVIDOR, com os tanques que aceitam cada um), os locais com saldo do Produto escolhido e as regras da escolha: um só
 * Produto já vem escolhido; um só local já vem escolhido; a escolha que saiu das opções é limpa e avisada; e trocar Produto,
 * local ou origem leva a escolha dos lotes de volta à sugestão.
 *
 * Quem usa: o `FormularioAbastecimento` (Abastecimentos e a janela da área, sem mudança de comportamento) e o abastecimento
 * DENTRO da frente do Diário das atividades. A regra é uma só; cada tela desenha o que quer por cima.
 */
import { useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { listarOpcoesAbastecimento, listarProdutosDoBem } from '@/services/abastecimentoService';
import { chaveProdutosDoBem } from '@/hooks/useFluxoAbastecimento';
import { ehExterno, opcaoNoFormulario, produtoAutomatico, situacaoDaEscolha } from '@/lib/abastecimentoRegras';

/** Campos que dependem do bem / do Produto (trocar um limpa os seguintes). */
export const SEM_PRODUTO = Object.freeze({ produto: null, tanque_id: null, local_estoque_id: null });

/** Chave dos locais com saldo de um Produto (prefixo da tela: confirmar/cancelar/recusas invalidam). @param {string|null} empresaId @param {string|null} produtoId */
export const chaveLocais = (empresaId, produtoId) => ['patrimonio-abastecimentos', 'locais', empresaId, produtoId];

/** O que da opção a tela reflete no formulário (unidade, tanques): mudou → reaplica. @param {any} p */
const assinaturaDaOpcao = (p) =>
  JSON.stringify([p?.unidade_principal_estoque ?? null, (Array.isArray(p?.tanques) ? p.tanques : []).map((/** @type {any} */ t) => [t.id, t.capacidade_litros])]);

/**
 * @param {{
 *   empresaId: string|null,
 *   bemId: string|null,                 // o bem cujos Produtos são lidos (o da frente, no Diário; o do formulário, nas outras telas)
 *   form: any,
 *   setForm: (atualizar: (f: any) => any) => void,
 * }} p
 */
export function useOpcoesDoAbastecimento({ empresaId, bemId, form, setForm }) {
  const produtoId = form.produto?.id ? String(form.produto.id) : null;
  const formBemId = form.bem?.id ? String(form.bem.id) : null;
  const externo = ehExterno(form);
  /** A escolha saiu das opções do servidor (aceite retirado, Produto inativo…): a tela avisa. */
  const [indisponivel, setIndisponivel] = useState(false);

  // Decisão da escolha: 1ª página SEM busca, a maior permitida (100). `has_more` manda.
  const produtosQuery = useQuery({
    queryKey: chaveProdutosDoBem(empresaId, bemId),
    queryFn: () => listarProdutosDoBem(empresaId, bemId, { limit: 100 }),
    enabled: Boolean(empresaId && bemId),
    staleTime: 15 * 1000,
  });
  const resposta = /** @type {any} */ (produtosQuery.data ?? null);
  // Só vale a resposta DO BEM atual (nunca a de um bem anterior).
  const respostaDoBem = resposta && bemId && String(resposta.bem?.id ?? '') === bemId ? resposta : null;
  const itens = /** @type {any[]} */ (Array.isArray(respostaDoBem?.itens) ? respostaDoBem.itens : []);
  const resumo = /** @type {any} */ (respostaDoBem?.resumo ?? null);
  const completa = respostaDoBem?.has_more === false;
  /** Nenhum Produto aceito: resposta do bem atual, sem itens, e completa (ou o servidor disse total 0). */
  const semProduto = Boolean(respostaDoBem) && !itens.length && (resumo?.total === 0 || completa);

  const locaisQuery = useQuery({
    queryKey: chaveLocais(empresaId, produtoId),
    queryFn: () => listarOpcoesAbastecimento('locais', empresaId, { produtoId }),
    enabled: Boolean(empresaId && produtoId && !externo),
    staleTime: 15 * 1000,
  });
  const locais = /** @type {any[]} */ (locaisQuery.data?.itens ?? []);

  // Um só Produto (resposta COMPLETA do bem atual): já vem escolhido.
  useEffect(() => {
    const item = produtoAutomatico(respostaDoBem, bemId);
    if (item) setForm((f) => (f.bem?.id && String(f.bem.id) === bemId && !f.produto ? opcaoNoFormulario(f, item) : f));
  }, [respostaDoBem, bemId, formBemId, setForm]);

  // A escolha ainda está nas opções? Saiu (aceite retirado do tanque, Produto inativo…) → limpa e avisa;
  // continua mas o servidor mudou a unidade ou os tanques → reaplica a opção nova.
  useEffect(() => {
    const situacao = situacaoDaEscolha(respostaDoBem, form);
    if (situacao === 'ausente') {
      setIndisponivel(true);
      setForm((f) => (String(f.produto?.id ?? '') === produtoId ? { ...f, ...SEM_PRODUTO } : f));
      return;
    }
    if (situacao !== 'presente') return;
    const item = itens.find((i) => String(i?.produto?.id ?? '') === produtoId);
    if (item && assinaturaDaOpcao({ ...item.produto, tanques: item.tanques }) !== assinaturaDaOpcao(form.produto)) {
      setForm((f) => (String(f.produto?.id ?? '') === produtoId ? opcaoNoFormulario(f, item) : f));
    }
    // Só reage à RESPOSTA do servidor e à troca de escolha (não a cada tecla).
  }, [respostaDoBem, bemId, produtoId]);

  // Local: o único com saldo já vem escolhido; um local que sumiu da lista sai do formulário.
  useEffect(() => {
    if (!produtoId || externo || !locaisQuery.isSuccess) return;
    const atual = form.local_estoque_id ? String(form.local_estoque_id) : null;
    if (atual && !locais.some((l) => String(l.local_estoque_id) === atual)) {
      setForm((f) => (String(f.produto?.id ?? '') === produtoId && String(f.local_estoque_id ?? '') === atual ? { ...f, local_estoque_id: null } : f));
      return;
    }
    if (!atual && locais.length === 1) {
      const local = String(locais[0].local_estoque_id);
      setForm((f) => (String(f.produto?.id ?? '') === produtoId && !f.local_estoque_id ? { ...f, local_estoque_id: local } : f));
    }
  }, [produtoId, externo, form.local_estoque_id, locais, locaisQuery.isSuccess, setForm]);

  // D-PROD-282 em todas as telas: trocar o Produto, o local ou a origem volta a escolha dos lotes para a sugestão.
  useEffect(() => {
    setForm((f) => (f.lotes == null && !f.confirmaVencido ? f : { ...f, lotes: null, confirmaVencido: false }));
  }, [produtoId, form.local_estoque_id, externo, setForm]);

  return { respostaDoBem, itens, resumo, completa, semProduto, produtosQuery, locaisQuery, locais, indisponivel, setIndisponivel };
}
