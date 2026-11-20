import { useQuery } from "@tanstack/react-query";
import { getCurrentUser, carregarPermissaoEfetiva } from "@/services/sessionService";

/**
 * D-PROD-266 (etapa 1) — quem vê o "Excluir" do evento do histórico da tarefa.
 *
 * É a guarda do servidor e nada além dela: `DELETE /historicos-lancamento-tarefa/:id`
 * usa `GUARDAS.tarefa = porAcessoTotal()` (`backend/src/shared/auth/guardasRotas.js`),
 * que libera só o administrador real da fazenda ou a concessão `is_admin`
 * (`acessoTotal` em `backend/src/shared/auth/autorizacaoTela.js`). Antes o botão
 * aparecia para todo mundo que abria a tarefa no mapa (`visualizar_tarefas` +
 * tela Gestão de Tarefas) e o servidor respondia 403.
 *
 * Só interface: o servidor continua reautorizando o DELETE.
 *
 * @param {any} usuario `getCurrentUser()` (o papel `administrador_fazenda` vem do servidor)
 * @param {any} permissao `carregarPermissaoEfetiva(usuario)` (ou null)
 * @returns {boolean}
 */
export const podeExcluirEventoDaTarefa = (usuario, permissao) =>
  usuario?.administrador_fazenda === true || permissao?.is_admin === true;

/**
 * A mesma regra, lida da sessão. As chaves de consulta são as do Mapa Geral
 * (`['mapa-geral-user']` e `['permissao-efetiva', login, admin]`), então o
 * detalhe da tarefa reaproveita o que o mapa já leu, e a tela Permissões, que
 * invalida `['permissao-efetiva']` ao gravar, também revalida este botão.
 * Enquanto não sabe (carregando, falha), devolve `false`: o botão não aparece.
 *
 * @returns {boolean}
 */
export function usePodeExcluirEventoTarefa() {
  const { data: usuario = null } = useQuery({
    queryKey: ["mapa-geral-user"],
    queryFn: () => getCurrentUser(),
    staleTime: 5 * 60 * 1000,
  });
  const admin = usuario?.administrador_fazenda === true;
  const login = usuario?.login || usuario?.email || null;
  const { data: permissao = null } = useQuery({
    queryKey: ["permissao-efetiva", login, admin],
    queryFn: () => carregarPermissaoEfetiva(usuario),
    // Administrador real não precisa da linha de permissão (tem tudo).
    enabled: Boolean(login) && !admin,
    staleTime: 30 * 1000,
    refetchOnWindowFocus: true,
  });
  return podeExcluirEventoDaTarefa(usuario, permissao);
}
