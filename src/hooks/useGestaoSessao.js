/**
 * Sessão das telas de Gestão Rural (D-PROD-145): empresa REAL selecionada e as
 * ações que a permissão efetiva libera na tela.
 *
 * Empresa: `useEmpresaSelecionadaId` cai no `clienteId` do JWT quando não há
 * empresa (e o Layout chega a gravar esse fallback). Isso NÃO é empresa: o
 * servidor responderia EMPRESA_NOT_FOUND. Aqui o fallback vira `null`, a tela
 * avisa "Selecione uma empresa" e nada é gravado.
 */
import { useQuery } from '@tanstack/react-query';
import { useAuth } from '@/lib/AuthContext';
import { useEmpresaSelecionadaId } from '@/hooks/useEmpresaSelecionadaId';
import { carregarPermissaoEfetiva, getCurrentUser } from '@/services/sessionService';
import { acoesDaTelaGestao } from '@/lib/gestaoPermissions';

/** @returns {string|null} */
export const useEmpresaRealSelecionadaId = () => {
  const selecionada = useEmpresaSelecionadaId();
  const { clienteId } = useAuth();
  if (!selecionada) return null;
  if (clienteId && selecionada === clienteId) return null;
  return selecionada;
};

/**
 * Mesma consulta (e chave) da permissão efetiva usada em Bebedouros/Mapa: a tela
 * Permissões invalida `["permissao-efetiva"]` ao gravar.
 * @param {string} tela
 */
export const useAcoesTelaGestao = (tela) => {
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
  return { ...acoesDaTelaGestao(permissao, tela), carregando: carregandoUsuario || (Boolean(login) && carregandoPermissao) };
};
