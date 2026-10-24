import React, { useMemo } from "react";
import { Badge } from "@/components/ui/badge";
import { Shield, User, Lock, Smartphone } from "lucide-react";
import CadastroBase1Grade from "@/components/cadastro/base1/CadastroBase1Grade";
import { getPermissionDisplayName } from "@/lib/userDisplayName";

export const USUARIOS_LIST_COLUNAS = [
  { id: "usuario", label: "Usuário", default: true, sortable: true, width: 220 },
  { id: "email", label: "Email", default: true, sortable: true, width: 220 },
  { id: "perfil", label: "Perfil Base44", default: true, sortable: true, width: 130 },
  { id: "nivel", label: "Nível de Acesso", default: true, sortable: true, width: 160 },
  { id: "modulos", label: "Módulos", default: true, sortable: true, align: "center", width: 90 },
  { id: "telas", label: "Telas", default: true, sortable: true, align: "center", width: 80 },
  { id: "mobile", label: "Mobile", default: true, sortable: true, align: "center", width: 90 },
];

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
  viewMode,
  displayLimit,
  onListMetrics,
  cardFields,
  cardsPerRow,
}) {
  const getPermissaoUsuario = (userEmail) => permissoes.find((item) => item.user_email === userEmail);

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
      modulos: String(permissao.modulos_permitidos?.length || 0),
      telas: String(telasVisiveis),
      mobile: String(permissao.mobile_menu_ids?.length || 0),
    };
  };

  const getFieldValue = (usuario, colId) => {
    const permissao = getPermissaoUsuario(usuario.email);
    const resumo = getResumoAcesso(usuario.email);
    if (colId === "usuario") return getPermissionDisplayName(permissao, usuario);
    if (colId === "email") return usuario.email || "";
    if (colId === "perfil") return usuario.role === "admin" ? "Admin Base44" : "Usuário";
    if (colId === "nivel") {
      if (permissao?.is_admin) return "Administrador";
      if (permissao) return "Restrito";
      return "Acesso total padrão";
    }
    if (colId === "modulos") return resumo.modulos;
    if (colId === "telas") return resumo.telas;
    if (colId === "mobile") return resumo.mobile;
    return "";
  };

  const renderCell = (usuario, colId) => {
    const permissao = getPermissaoUsuario(usuario.email);
    const isCurrentUser = currentUser?.email === usuario.email;
    const resumo = getResumoAcesso(usuario.email);

    if (colId === "usuario") {
      return (
        <div className="flex items-center gap-2">
          <User className="w-3.5 h-3.5 text-slate-400 shrink-0" />
          <span className="font-semibold">{getPermissionDisplayName(permissao, usuario)}</span>
          {isCurrentUser ? (
            <Badge variant="outline" className="text-[10px] bg-blue-50 text-blue-700 border-blue-300">
              Você
            </Badge>
          ) : null}
        </div>
      );
    }
    if (colId === "email") return usuario.email || "–";
    if (colId === "perfil") {
      return (
        <Badge
          variant="outline"
          className={`text-xs ${usuario.role === "admin" ? "bg-purple-100 text-purple-800 border-purple-300" : "bg-slate-100 text-slate-700 border-slate-300"}`}
        >
          {usuario.role === "admin" ? "Admin Base44" : "Usuário"}
        </Badge>
      );
    }
    if (colId === "nivel") {
      if (permissao?.is_admin) {
        return (
          <Badge variant="secondary" className="bg-violet-100 text-violet-800 border-violet-300 text-xs">
            <Shield className="w-3 h-3 mr-1 inline" />
            Administrador
          </Badge>
        );
      }
      if (permissao) {
        return (
          <Badge variant="outline" className="bg-emerald-100 text-emerald-800 border-emerald-300 text-xs">
            <Lock className="w-3 h-3 mr-1 inline" />
            Restrito
          </Badge>
        );
      }
      return (
        <Badge variant="outline" className="bg-orange-100 text-orange-800 border-orange-300 text-xs">
          Acesso total padrão
        </Badge>
      );
    }
    if (colId === "modulos") {
      return (
        <Badge variant="outline" className="text-xs font-mono">
          {resumo.modulos}
        </Badge>
      );
    }
    if (colId === "telas") {
      return (
        <Badge variant="outline" className="text-xs font-mono">
          {resumo.telas}
        </Badge>
      );
    }
    if (colId === "mobile") {
      return (
        <Badge variant="outline" className="text-xs font-mono inline-flex items-center gap-1">
          <Smartphone className="w-3 h-3" />
          {resumo.mobile}
        </Badge>
      );
    }
    return "–";
  };

  const matchesSearch = useMemo(
    () => (usuario, q) => {
      const nomeExibido = getPermissionDisplayName(getPermissaoUsuario(usuario.email), usuario).toLowerCase();
      return (
        nomeExibido.includes(q) ||
        usuario.full_name?.toLowerCase().includes(q) ||
        usuario.email?.toLowerCase().includes(q)
      );
    },
    [permissoes],
  );

  if (chromeLayout) {
    return (
      <div className="overflow-hidden">
        <CadastroBase1Grade
          rows={usuarios}
          columns={USUARIOS_LIST_COLUNAS}
          storageKey="colunas_usuarios_v1"
          droppableId="colunas-usuarios"
          getFieldValue={getFieldValue}
          renderCell={renderCell}
          defaultSortKey="usuario"
          emptyText="Nenhum usuário"
          isLoading={isLoading}
          onOpen={onEdit}
          searchQuery={searchQuery}
          onSelectionChange={onSelectionChange}
          viewMode={viewMode}
          displayLimit={displayLimit}
          onListMetrics={onListMetrics}
          cardFields={cardFields}
          cardsPerRow={cardsPerRow}
          cardsTitleColId="usuario"
          rowKey={(usuario) => String(usuario.id || usuario.email)}
          matchesSearch={matchesSearch}
        />
      </div>
    );
  }

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
          </tr>
        </thead>
        <tbody>
          {isLoading ? (
            <tr>
              <td colSpan={8} className="text-center py-8 text-slate-400 border border-gray-300">
                Carregando...
              </td>
            </tr>
          ) : usuarios.length === 0 ? (
            <tr>
              <td colSpan={8} className="text-center py-8 text-slate-400 border border-gray-300">
                Nenhum usuário
              </td>
            </tr>
          ) : (
            usuarios.map((usuario) => {
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
                  <td className="h-7 p-0 text-center border-r border-b border-gray-300" />
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
                  <td className="h-7 px-2 border-r border-b border-gray-300">{renderCell(usuario, "perfil")}</td>
                  <td className="h-7 px-2 border-r border-b border-gray-300">{renderCell(usuario, "nivel")}</td>
                  <td className="h-7 px-2 text-center border-r border-b border-gray-300">{renderCell(usuario, "modulos")}</td>
                  <td className="h-7 px-2 text-center border-r border-b border-gray-300">{renderCell(usuario, "telas")}</td>
                  <td className="h-7 px-2 text-center border-r border-b border-gray-300">{renderCell(usuario, "mobile")}</td>
                </tr>
              );
            })
          )}
        </tbody>
      </table>
    </div>
  );

  return (
    <div className="cadastro-b1 rounded-md border border-slate-300 bg-white shadow-sm overflow-hidden">
      {table}
    </div>
  );
}
