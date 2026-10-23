import React, { useMemo } from "react";
import { Badge } from "@/components/ui/badge";
import { MoreVertical, Shield, User, Lock, Smartphone } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Button } from "@/components/ui/button";
import { getPermissionDisplayName } from "@/lib/userDisplayName";

export default function TabelaUsuarios({
  usuarios = [],
  permissoes = [],
  currentUser,
  onEdit,
  onDelete,
  isLoading,
  searchQuery = "",
  chromeLayout = false,
  selectedIds = [],
  onSelectionChange,
}) {
  const getPermissaoUsuario = (userEmail) => permissoes.find((item) => item.user_email === userEmail);

  const filteredUsuarios = useMemo(() => {
    const q = (searchQuery || "").trim().toLowerCase();
    if (!q) return usuarios;
    return usuarios.filter((usuario) => {
      const nomeExibido = getPermissionDisplayName(getPermissaoUsuario(usuario.email), usuario).toLowerCase();
      return (
        nomeExibido.includes(q) ||
        usuario.full_name?.toLowerCase().includes(q) ||
        usuario.email?.toLowerCase().includes(q)
      );
    });
  }, [usuarios, permissoes, searchQuery]);

  const toggleSelect = (id) => {
    if (!onSelectionChange) return;
    const next = selectedIds.includes(id) ? selectedIds.filter((x) => x !== id) : [...selectedIds, id];
    onSelectionChange(next);
  };

  const getResumoAcesso = (userEmail) => {
    const permissao = getPermissaoUsuario(userEmail);
    if (!permissao) {
      return { modulos: "Todos", telas: "Todas", mobile: "Padrão" };
    }
    if (permissao.is_admin) {
      return { modulos: "Todos", telas: "Todas", mobile: "Livre" };
    }
    const telasVisiveis = (permissao.permissoes_telas || []).filter((item) => item.visualizar !== false).length;
    return {
      modulos: permissao.modulos_permitidos?.length || 0,
      telas: telasVisiveis,
      mobile: permissao.mobile_menu_ids?.length || 0,
    };
  };

  const table = (
    <div className="cadastro-grade-viewport relative w-full overflow-auto">
      <table className="w-full min-w-[900px] border-separate border-spacing-0 text-xs table-fixed">
        <thead>
          <tr className="sticky top-0 z-40 bg-white">
            <th className="h-7 w-[25px] border-r border-b border-gray-200 p-0" />
            <th className="h-7 px-2 text-left font-medium border-r border-b border-gray-200">Usuário</th>
            <th className="h-7 px-2 text-left font-medium border-r border-b border-gray-200">Email</th>
            <th className="h-7 px-2 text-left font-medium border-r border-b border-gray-200">Perfil Base44</th>
            <th className="h-7 px-2 text-left font-medium border-r border-b border-gray-200">Nível de Acesso</th>
            <th className="h-7 px-2 text-center font-medium border-r border-b border-gray-200">Módulos</th>
            <th className="h-7 px-2 text-center font-medium border-r border-b border-gray-200">Telas</th>
            <th className="h-7 px-2 text-center font-medium border-r border-b border-gray-200">Mobile</th>
            <th className="h-7 w-[25px] border-r border-b border-gray-200 p-0" />
          </tr>
        </thead>
        <tbody>
          {isLoading ? (
            <tr>
              <td colSpan={9} className="text-center py-8 text-slate-400 border border-gray-300">
                Carregando...
              </td>
            </tr>
          ) : filteredUsuarios.length === 0 ? (
            <tr>
              <td colSpan={9} className="text-center py-8 text-slate-400 border border-gray-300">
                Nenhum usuário
              </td>
            </tr>
          ) : (
            filteredUsuarios.map((usuario) => {
              const permissao = getPermissaoUsuario(usuario.email);
              const isCurrentUser = currentUser?.email === usuario.email;
              const resumo = getResumoAcesso(usuario.email);
              const rowId = usuario.id || usuario.email;

              return (
                <tr
                  key={rowId}
                  className="hover:bg-gray-100 border-b cursor-pointer"
                  onDoubleClick={() => onEdit?.(usuario)}
                >
                  <td className="h-7 p-0 text-center border-r border-b border-gray-300" onClick={(e) => e.stopPropagation()}>
                    <input
                      type="checkbox"
                      className="h-4 w-4 rounded-full border-2 border-gray-400"
                      checked={selectedIds.includes(rowId)}
                      onChange={() => toggleSelect(rowId)}
                      aria-label={`Selecionar ${usuario.email}`}
                    />
                  </td>
                  <td className="h-7 px-2 font-semibold border-r border-b border-gray-300">
                    <div className="flex items-center gap-2">
                      <User className="w-3.5 h-3.5 text-slate-400 shrink-0" />
                      {getPermissionDisplayName(permissao, usuario)}
                      {isCurrentUser ? (
                        <Badge variant="outline" className="text-[10px] bg-blue-50 text-blue-700 border-blue-300">
                          Você
                        </Badge>
                      ) : null}
                    </div>
                  </td>
                  <td className="h-7 px-2 border-r border-b border-gray-300">{usuario.email}</td>
                  <td className="h-7 px-2 border-r border-b border-gray-300">
                    <Badge variant="outline" className={`text-xs ${usuario.role === "admin" ? "bg-purple-100 text-purple-800 border-purple-300" : "bg-slate-100 text-slate-700 border-slate-300"}`}>
                      {usuario.role === "admin" ? "Admin Base44" : "Usuário"}
                    </Badge>
                  </td>
                  <td className="h-7 px-2 border-r border-b border-gray-300">
                    {permissao?.is_admin ? (
                      <Badge className="bg-violet-100 text-violet-800 border-violet-300 text-xs">
                        <Shield className="w-3 h-3 mr-1 inline" />
                        Administrador
                      </Badge>
                    ) : permissao ? (
                      <Badge variant="outline" className="bg-emerald-100 text-emerald-800 border-emerald-300 text-xs">
                        <Lock className="w-3 h-3 mr-1 inline" />
                        Restrito
                      </Badge>
                    ) : (
                      <Badge variant="outline" className="bg-orange-100 text-orange-800 border-orange-300 text-xs">
                        Acesso total padrão
                      </Badge>
                    )}
                  </td>
                  <td className="h-7 px-2 text-center border-r border-b border-gray-300">
                    <Badge variant="outline" className="text-xs font-mono">{resumo.modulos}</Badge>
                  </td>
                  <td className="h-7 px-2 text-center border-r border-b border-gray-300">
                    <Badge variant="outline" className="text-xs font-mono">{resumo.telas}</Badge>
                  </td>
                  <td className="h-7 px-2 text-center border-r border-b border-gray-300">
                    <Badge variant="outline" className="text-xs font-mono inline-flex items-center gap-1">
                      <Smartphone className="w-3 h-3" />
                      {resumo.mobile}
                    </Badge>
                  </td>
                  <td className="h-7 p-0 text-center border-r border-b border-gray-300" onClick={(e) => e.stopPropagation()}>
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button variant="ghost" size="icon" className="h-6 w-6">
                          <MoreVertical className="w-3.5 h-3.5 text-slate-600" />
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="start">
                        <DropdownMenuItem onClick={() => onEdit(usuario)} className="text-xs">
                          Editar Permissões
                        </DropdownMenuItem>
                        <DropdownMenuSeparator />
                        <DropdownMenuItem onClick={() => onDelete(usuario.email)} className="text-xs text-red-600" disabled={isCurrentUser}>
                          Remover Permissões
                        </DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </td>
                </tr>
              );
            })
          )}
        </tbody>
      </table>
    </div>
  );

  if (chromeLayout) {
    return <div className="overflow-hidden">{table}</div>;
  }

  return (
    <div className="cadastro-b1 rounded-md border border-slate-300 bg-white shadow-sm overflow-hidden">
      {table}
    </div>
  );
}
