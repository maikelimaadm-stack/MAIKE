/**
 * Sessão das telas de Patrimônio e Frota (D-PROD-157): as ações que a
 * permissão efetiva libera na tela e se o usuário é administrador.
 *
 * Mesmas consultas (e chaves) de `useAcoesTelaGestao`: a tela Permissões
 * invalida `["permissao-efetiva"]` ao gravar, e o cache é compartilhado.
 *
 * Famílias e tipos são do TENANT e não pedem empresa (D-PROD-161: vivem dentro
 * do cadastro de Bens e seguem as ações dele); os bens e os abastecimentos pedem
 * a empresa REAL (`useEmpresaRealSelecionadaId`).
 */
import { useQuery } from '@tanstack/react-query';
import { carregarPermissaoEfetiva, getCurrentUser } from '@/services/sessionService';
import { acoesDaTelaAbastecimento, acoesDaTelaPatrimonio, acoesDeCatalogoNoBem } from '@/lib/patrimonioPermissions';

export { useEmpresaRealSelecionadaId } from '@/hooks/useGestaoSessao';

/**
 * Usuário atual e permissão efetiva (as duas consultas compartilhadas).
 * @returns {{ permissao: any, carregando: boolean, administrador: boolean, login: string|null }}
 */
const usePermissaoEfetivaPatrimonio = () => {
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
    permissao,
    carregando: carregandoUsuario || (Boolean(login) && carregandoPermissao),
    // Administrador real OU concessão `is_admin`: a permissão efetiva chega com
    // `is_admin: true` nos dois casos (= `adminOuIsAdmin()` do servidor).
    administrador: /** @type {any} */ (permissao)?.is_admin === true,
    login,
  };
};

/**
 * Ações da tela (`ver`, `criar`, `editar`, `inativar`) e, D-PROD-161, as de
 * famílias, tipos e Produtos aceitos DENTRO do cadastro de Bens
 * (`acoesDeCatalogoNoBem`: `criarCatalogo`, `editarCatalogo`,
 * `inativarCatalogo`, `produtosDoTanque` — sempre sobre a tela de Bens).
 * @param {string} tela id da tela (`TELAS_PATRIMONIO`)
 * @returns {{ ver: boolean, criar: boolean, editar: boolean, inativar: boolean,
 *   criarCatalogo: boolean, editarCatalogo: boolean, inativarCatalogo: boolean, produtosDoTanque: boolean,
 *   carregando: boolean, administrador: boolean, login: string|null }}
 */
export const useAcoesTelaPatrimonio = (tela) => {
  const { permissao, carregando, administrador, login } = usePermissaoEfetivaPatrimonio();
  return { ...acoesDaTelaPatrimonio(permissao, tela), ...acoesDeCatalogoNoBem(permissao), carregando, administrador, login };
};

/**
 * Ações da tela Abastecimentos (D-PROD-159): ver, criar (prévia e confirmação)
 * e cancelar/estornar — espelho de `GUARDAS.patrimonioAbastecimentos`. O fator
 * kg/L saiu (D-PROD-161).
 * @returns {{ ver: boolean, criar: boolean, cancelar: boolean, carregando: boolean, administrador: boolean, login: string|null }}
 */
export const useAcoesTelaAbastecimento = () => {
  const { permissao, carregando, administrador, login } = usePermissaoEfetivaPatrimonio();
  return { ...acoesDaTelaAbastecimento(permissao), carregando, administrador, login };
};
