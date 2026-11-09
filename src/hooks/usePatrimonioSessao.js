/**
 * Sessão das telas de Patrimônio e Frota (D-PROD-157): as ações que a
 * permissão efetiva libera na tela e se o usuário é administrador.
 *
 * Mesmas consultas (e chaves) de `useAcoesTelaGestao`: a tela Permissões
 * invalida `["permissao-efetiva"]` ao gravar, e o cache é compartilhado.
 *
 * Catálogos (famílias, tipos, perfis, combustíveis) são do TENANT e não pedem
 * empresa; os bens pedem a empresa REAL (`useEmpresaRealSelecionadaId`).
 */
import { useQuery } from '@tanstack/react-query';
import { carregarPermissaoEfetiva, getCurrentUser } from '@/services/sessionService';
import { acoesDaTelaPatrimonio } from '@/lib/patrimonioPermissions';

export { useEmpresaRealSelecionadaId } from '@/hooks/useGestaoSessao';

/**
 * @param {string} tela id da tela (`TELAS_PATRIMONIO`)
 * @returns {{ ver: boolean, criar: boolean, editar: boolean, inativar: boolean, carregando: boolean, administrador: boolean, login: string|null }}
 */
export const useAcoesTelaPatrimonio = (tela) => {
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
    ...acoesDaTelaPatrimonio(permissao, tela),
    carregando: carregandoUsuario || (Boolean(login) && carregandoPermissao),
    // Administrador real OU concessão `is_admin`: a permissão efetiva chega com
    // `is_admin: true` nos dois casos (= `adminOuIsAdmin()` do servidor).
    administrador: /** @type {any} */ (permissao)?.is_admin === true,
    login,
  };
};
