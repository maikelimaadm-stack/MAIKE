import React, { useMemo } from "react";
import { getCurrentUser, listarPermissoes, permissaoDoUsuario, ehAdministrador } from "@/services/sessionService";
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import GerenciadorIcones from "../components/configuracoes/GerenciadorIcones";

/**
 * Configurações Gerais — escopo P0.1.
 *
 * Mantém apenas a configuração de ícones (`ConfiguracaoIcone`), que é consumida
 * pelo Mapa Geral para renderizar áreas, pontos, cochos, depósitos e lotes.
 *
 * O editor de menus foi removido: a navegação passou a ter SSOT único em
 * `src/lib/menuConfig.js`, validado por `gate:product-scope`.
 */
export default function ConfiguracoesGerais() {
  const { data: currentUser = null } = useQuery({
    queryKey: ['configuracoes-gerais-user'],
    queryFn: () => getCurrentUser(),
    staleTime: 5 * 60 * 1000
  });

  const { data: permissoes = [] } = useQuery({
    queryKey: ['configuracoes-gerais-permissoes'],
    queryFn: () => listarPermissoes(),
    staleTime: 5 * 60 * 1000
  });

  // A regra de admin vive no service: era a mesma linha aqui e no Layout.
  const permissaoAtual = useMemo(
    () => permissaoDoUsuario(permissoes, currentUser?.email),
    [permissoes, currentUser?.email]
  );

  const isAdmin = ehAdministrador(currentUser, permissaoAtual);

  if (!isAdmin) {
    return (
      <div className="p-4 md:p-6 space-y-4">
        <Card className="shadow-sm border-amber-200 bg-amber-50">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm text-amber-900">Acesso restrito</CardTitle>
            <CardDescription className="text-xs text-amber-700">
              As configurações do sistema são exibidas apenas para administrador.
            </CardDescription>
          </CardHeader>
        </Card>
      </div>);

  }

  return (
    <div className="p-4 md:p-6 space-y-4 h-full overflow-y-auto">
      <div>
        <h1 className="text-xl font-bold text-slate-900">Configurações Gerais</h1>
        <p className="text-xs text-slate-600">Ícones e parâmetros do Mapa Geral</p>
      </div>

      <GerenciadorIcones />

      <Card className="shadow-sm">
        <CardHeader className="pb-3">
          <CardTitle className="text-sm">Regras de Ícones Mistos</CardTitle>
          <CardDescription className="text-xs">Configure ícones para áreas com múltiplas categorias</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="bg-amber-50 border border-amber-200 rounded p-3 mb-3">
            <div className="text-xs font-semibold text-amber-900 mb-1">Como funciona</div>
            <div className="text-[10px] text-amber-700 space-y-1">
              <p>Quando há múltiplos lotes de categorias diferentes na mesma área, o sistema agrupa e mostra o total de cabeças.</p>
              <p>O ícone exibido será o configurado com a categoria <strong>MISTO</strong> na seção Gerenciar Ícones acima.</p>
              <p>No gerenciador acima, adicione um ícone do tipo Lote com categoria MISTO.</p>
            </div>
          </div>

          <div className="bg-blue-50 border border-blue-200 rounded p-3">
            <div className="text-xs font-semibold text-blue-900 mb-2">Exemplo de uso</div>
            <div className="text-[10px] text-blue-700 space-y-1">
              <p>Área com 50 Bezerros + 30 Vacas = mostra 80 cabeças com ícone MISTO.</p>
              <p>Área com apenas 100 Bois = mostra 100 cabeças com o ícone específico de Boi.</p>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>);

}
