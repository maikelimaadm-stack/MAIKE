import { useQuery } from "@tanstack/react-query";
import { podeCancelarLancamentosEstoque } from "@/lib/mapaGeralPermissions";

/**
 * D-PROD-267 — quem vê "Cancelar transferência" no histórico do depósito:
 * administrador real, concessão `is_admin` ou a chave gravadora do Mapa Geral
 * `cancelar_lancamentos_estoque` (`=== true`), pela regra única
 * `podeCancelarLancamentosEstoque(usuario, permissao)`. Mesma permissão efetiva
 * (e as mesmas chaves de cache) do Mapa Geral e da exclusão de movimentação do
 * lote: a tela Permissões invalida `["permissao-efetiva"]` ao gravar. Só
 * interface: o servidor reautoriza no GET e no POST.
 *
 * A sessão é carregada sob demanda (import dinâmico): o detalhe do depósito não
 * passa a depender, ao carregar, de todo o módulo de sessão. Qualquer falha de
 * leitura = sem permissão (fail-closed).
 *
 * `escopo` (tenant + usuário) separa, no mesmo aparelho, a operação pendente de
 * um usuário da de outro.
 * @returns {{ pode: boolean, usuario: any, escopo: string }}
 */
export function usePodeCancelarLancamentosEstoque() {
  const { data: usuario = null } = useQuery({
    queryKey: ["usuario-atual-exclusao"],
    queryFn: async () => {
      const sessao = await import("@/services/sessionService");
      return (await sessao.getCurrentUser()) ?? null;
    },
    staleTime: 60_000,
    retry: false,
  });
  const admin = usuario?.administrador_fazenda === true;
  const login = usuario?.login || usuario?.email || null;
  const { data: permissao = null } = useQuery({
    queryKey: ["permissao-efetiva", login, admin],
    queryFn: async () => {
      const sessao = await import("@/services/sessionService");
      return (await sessao.carregarPermissaoEfetiva(usuario)) ?? null;
    },
    enabled: Boolean(login) && !admin,
    staleTime: 30_000,
    refetchOnWindowFocus: true,
    retry: false,
  });
  return {
    pode: podeCancelarLancamentosEstoque(usuario, permissao),
    usuario,
    escopo: `${usuario?.cliente_id ?? "-"}:${usuario?.id ?? usuario?.usuario_id ?? "-"}`,
  };
}
