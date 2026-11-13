/**
 * Sessão da tela Apontamentos de Atividade (D-PROD-190): empresa REAL
 * selecionada e as ações que a permissão efetiva libera na tela.
 *
 * Mesmas consultas (e chaves) de `useAcoesTelaGestao`: a tela Permissões
 * invalida `["permissao-efetiva"]` ao gravar, e o cache é compartilhado.
 */
import { useQuery } from '@tanstack/react-query';
import { carregarPermissaoEfetiva, getCurrentUser } from '@/services/sessionService';
import { acoesDaTelaApontamento } from '@/lib/apontamentoAtividadePermissions';

export { useEmpresaRealSelecionadaId } from '@/hooks/useGestaoSessao';

/**
 * @returns {{ ver: boolean, criar: boolean, editar: boolean, cancelar: boolean, carregando: boolean, login: string|null }}
 */
export const useAcoesTelaApontamento = () => {
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
  return {
    ...acoesDaTelaApontamento(permissao),
    carregando: carregandoUsuario || (Boolean(login) && carregandoPermissao),
    login,
  };
};
