/**
 * Sessão da tela Estoque (D-PROD-255): se a permissão efetiva deixa consultar.
 * Mesmas consultas (e chaves) de `usePatrimonioSessao`/`useAcoesTelaGestao`: a tela
 * Permissões invalida `["permissao-efetiva"]` ao gravar e o cache é compartilhado.
 */
import { useQuery } from '@tanstack/react-query';
import { carregarPermissaoEfetiva, getCurrentUser } from '@/services/sessionService';
import { acoesDaTelaEstoque } from '@/lib/estoquePermissions';

export { useEmpresaRealSelecionadaId } from '@/hooks/useGestaoSessao';

/** @returns {{ ver: boolean, entrada: boolean, carregando: boolean, login: string|null }} */
export const useAcoesTelaEstoque = () => {
  const { data: usuarioAtual = null, isLoading: carregandoUsuario } = useQuery({
    queryKey: ['gestao-usuario'],
    queryFn: () => getCurrentUser(),
    staleTime: 5 * 60 * 1000,
  });
  const login = usuarioAtual?.login || usuarioAtual?.email || null;
  const { data: permissao = null, isLoading: carregandoPermissao } = useQuery({
    queryKey: ['permissao-efetiva', login, usuarioAtual?.administrador_fazenda === true],
    queryFn: () => carregarPermissaoEfetiva(usuarioAtual),
    enabled: Boolean(login),
    staleTime: 30 * 1000,
    refetchInterval: 60 * 1000,
    refetchOnWindowFocus: true,
  });
  return { ...acoesDaTelaEstoque(permissao), carregando: carregandoUsuario || (Boolean(login) && carregandoPermissao), login };
};
