/**
 * Service de configuração de ícones (P1.4).
 *
 * O gerenciador vive na tela de Configurações, mas a entidade pertence ao mapa:
 * é ele quem desenha área, ponto, cocho, depósito e lote com esses ícones. Por
 * isso a API reutilizada é `@/apis/mapa`, ampliada, e não um módulo novo.
 *
 * A exclusão é **lógica**: `ativo: false`. O comportamento é o mesmo de antes —
 * a listagem já filtrava inativos.
 */

import { listIcones, createIcone, updateIcone } from '@/apis/mapa';

/** Chave de cache usada pela tela. Mantida igual à da P0 para não invalidar nada. */
export const ICONES_QUERY_KEY = ['configuracao-icones-global'];

/** Categoria sintética usada quando a área tem lotes de categorias diferentes. */
export const CATEGORIA_MISTO = 'MISTO';

/** Ícones ativos, na mesma ordem que o provider devolve. */
export const listarIconesAtivos = async () => {
  const todos = await listIcones();
  return todos.filter((icone) => icone.ativo !== false);
};

/** Cria o ícone já marcado como ativo. */
export const criarIcone = (dados) => createIcone({ ...dados, ativo: true });

export const atualizarIcone = (id, dados) => updateIcone(id, dados);

/** Exclusão lógica: o registro permanece, some da listagem. */
export const desativarIcone = (id) => updateIcone(id, { ativo: false });
