/**
 * Sessão da tela Lançamento de Atividades (D-PROD-200): empresa REAL
 * selecionada, o fuso da fazenda (o "hoje") e as ações que a permissão
 * efetiva libera na tela `op-atividades`.
 *
 * Mesmas consultas (e chaves) de `useAcoesTelaGestao` e do Layout: a tela
 * Permissões invalida `["permissao-efetiva"]` ao gravar, e o cache de
 * `["empresas"]` é o mesmo do seletor de fazenda.
 */
import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { carregarPermissaoEfetiva, getCurrentUser } from '@/services/sessionService';
import { listEmpresas } from '@/services/empresaService';
import { hojeNoFuso } from '@/lib/diaCivil';
import { acoesDaTelaAtividades, podeTrocarCapimDaArea } from '@/lib/lancamentoAtividadesPermissions';

export { useEmpresaRealSelecionadaId } from '@/hooks/useGestaoSessao';

/**
 * @returns {{ ver: boolean, criar: boolean, editar: boolean, cancelar: boolean, reabrir: boolean,
 *   lancarApontamento: boolean, editarApontamento: boolean, cancelarApontamento: boolean,
 *   trocarCapimDaArea: boolean, carregando: boolean, login: string|null }}
 *   D-PROD-276: `trocarCapimDaArea` — a troca do capim na conclusão da reforma (o editar do Cadastro do Mapa).
 */
export const useAcoesTelaAtividades = () => {
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
    ...acoesDaTelaAtividades(permissao),
    trocarCapimDaArea: podeTrocarCapimDaArea(permissao),
    carregando: carregandoUsuario || (Boolean(login) && carregandoPermissao),
    login,
  };
};

/**
 * Fuso da FAZENDA (IANA, da Empresa) e o "hoje" nele. Sem fuso o servidor
 * recusa toda escrita que usa o "hoje" (`EMPRESA_FUSO_NAO_CONFIGURADO`): a tela
 * fecha as gravações e avisa (`semFuso`).
 * @param {string|null} empresaId
 * @returns {{ fuso: string|null, fusoOk: boolean, semFuso: boolean, hoje: string }}
 */
export const useFusoDaFazenda = (empresaId) => {
  const empresasQuery = useQuery({
    queryKey: ['empresas'],
    queryFn: () => listEmpresas(),
    enabled: Boolean(empresaId),
    staleTime: 5 * 60 * 1000,
    refetchOnWindowFocus: false,
  });
  const fuso = useMemo(() => {
    const lista = /** @type {any[]} */ (Array.isArray(empresasQuery.data) ? empresasQuery.data : []);
    const empresa = lista.find((e) => String(e?.id) === String(empresaId));
    return typeof empresa?.fuso_horario === 'string' && empresa.fuso_horario ? empresa.fuso_horario : null;
  }, [empresasQuery.data, empresaId]);
  return {
    fuso,
    fusoOk: Boolean(fuso),
    semFuso: Boolean(empresaId) && empresasQuery.isSuccess && !fuso,
    hoje: hojeNoFuso(fuso),
  };
};
