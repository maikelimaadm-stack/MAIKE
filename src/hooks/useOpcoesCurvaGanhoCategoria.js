/**
 * Curvas de ganho da fazenda para o seletor da Categoria de Manejo (D-PROD-195).
 *
 * Fazenda REAL (`useEmpresaRealSelecionadaId`): o fallback do `clienteId` não é
 * fazenda e o servidor responderia EMPRESA_NOT_FOUND. Sem fazenda, nenhuma
 * consulta. Lê a rota própria do cadastro (`/categorias-manejo-opcoes/…`), não a
 * da tela de Curvas de Ganho.
 */
import { useQuery } from '@tanstack/react-query';
import { useEmpresaRealSelecionadaId } from '@/hooks/useGestaoSessao';
import { listarCurvasGanhoParaCategoria } from '@/services/categoriaManejoService';

/** Raiz da chave: gravar ou excluir curva invalida `["curvas-ganho"]`; esta é separada de propósito. */
export const QUERY_OPCOES_CURVAS_GANHO_CATEGORIA = 'categorias-manejo-opcoes-curvas-ganho';

/**
 * @returns {{ empresaId: string|null, curvas: Array<{ id: string, nome: string, ativo: boolean }>, carregando: boolean, erro: boolean }}
 */
export const useOpcoesCurvaGanhoCategoria = () => {
  const empresaId = useEmpresaRealSelecionadaId();
  const consulta = useQuery({
    queryKey: [QUERY_OPCOES_CURVAS_GANHO_CATEGORIA, empresaId],
    queryFn: () => listarCurvasGanhoParaCategoria(/** @type {string} */ (empresaId)),
    enabled: Boolean(empresaId),
    staleTime: 30 * 1000,
  });
  return {
    empresaId,
    curvas: Array.isArray(consulta.data) ? consulta.data : [],
    carregando: Boolean(empresaId) && consulta.isLoading,
    erro: consulta.isError,
  };
};
