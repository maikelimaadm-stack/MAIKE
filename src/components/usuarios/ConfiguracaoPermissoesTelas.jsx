import React from "react";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";
import { ACTION_KEYS, createRestrictedPagePermission, getPagePermission } from "@/lib/permissions";
import { MAPA_GERAL_PERMISSION_GROUPS, normalizeMapaGeralPermissions } from "@/lib/mapaGeralPermissions";

const ACTION_LABELS = {
  visualizar: "VER",
  novo: "NOVO",
  salvar: "SALVAR",
  editar: "EDITAR",
  excluir: "EXCLUIR",
  importar: "IMPORTAR",
  exportar: "EXPORTAR",
};

export default function ConfiguracaoPermissoesTelas({ formData, onChange, modules }) {
  const modulosPermitidos = formData.modulos_permitidos || [];
  const permissoesTelas = formData.permissoes_telas || [];
  const mobileMenuIds = formData.mobile_menu_ids || [];
  const mapaGeralPermissions = normalizeMapaGeralPermissions(formData.mapa_geral_permissoes);

  const handleToggleModulo = (moduleId) => {
    const nextModules = modulosPermitidos.includes(moduleId)
      ? modulosPermitidos.filter((id) => id !== moduleId)
      : [...modulosPermitidos, moduleId];

    const modulo = modules.find((module) => module.id === moduleId);
    const paginasDoModulo = modulo?.pages || [];
    const pageIds = paginasDoModulo.map((page) => page.id);

    onChange("modulos_permitidos", nextModules);

    const missingPermissions = paginasDoModulo
      .filter((page) => !permissoesTelas.some((item) => item.tela_id === page.id))
      .map((page) => createRestrictedPagePermission(moduleId, modulo.title, page));

    if (missingPermissions.length > 0) {
      onChange("permissoes_telas", [...permissoesTelas, ...missingPermissions]);
    }

    if (!nextModules.includes(moduleId)) {
      onChange(
        "mobile_menu_ids",
        mobileMenuIds.filter((id) => !pageIds.includes(id))
      );
    }
  };

  const handlePagePermission = (module, page, field, checked) => {
    const current = getPagePermission({ permissoes_telas: permissoesTelas }, page.id) || createRestrictedPagePermission(module.id, module.title, page);
    const nextPermission = { ...current, [field]: !!checked };
    const nextPermissions = permissoesTelas.some((item) => item.tela_id === page.id)
      ? permissoesTelas.map((item) => (item.tela_id === page.id ? nextPermission : item))
      : [...permissoesTelas, nextPermission];

    onChange("permissoes_telas", nextPermissions);

    if (field === "visualizar" && !checked) {
      onChange(
        "mobile_menu_ids",
        mobileMenuIds.filter((id) => id !== page.id)
      );
    }
  };

  const handleMobileToggle = (pageId) => {
    if (mobileMenuIds.includes(pageId)) {
      onChange("mobile_menu_ids", mobileMenuIds.filter((id) => id !== pageId));
      return;
    }

    if (mobileMenuIds.length >= 4) {
      toast.error("Selecione no máximo 4 telas para o menu mobile.");
      return;
    }

    onChange("mobile_menu_ids", [...mobileMenuIds, pageId]);
  };

  const handleMapaGeralPermission = (field, checked) => {
    onChange("mapa_geral_permissoes", {
      ...mapaGeralPermissions,
      [field]: !!checked,
    });
  };

  const modulesAtivos = modules.filter((module) => modulosPermitidos.includes(module.id));
  const paginasMobile = modulesAtivos.flatMap((module) =>
    module.pages.filter((page) => {
      const permission = getPagePermission({ permissoes_telas: permissoesTelas }, page.id);
      return permission?.visualizar === true;
    })
  );

  return (
    <div className="space-y-4">
      <div className="border rounded-lg p-3 bg-slate-50">
        <Label className="text-xs font-semibold mb-3 block uppercase">Módulos Permitidos *</Label>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
          {modules.map((module) => (
            <label
              key={module.id}
              className="flex items-center gap-2 p-2 rounded bg-white border cursor-pointer hover:bg-emerald-50 transition-colors"
            >
              <Checkbox
                checked={modulosPermitidos.includes(module.id)}
                onCheckedChange={() => handleToggleModulo(module.id)}
              />
              <span className="text-xs flex-1 uppercase">{module.title}</span>
              {modulosPermitidos.includes(module.id) && (
                <Badge variant="outline" className="text-[10px] bg-emerald-50 text-emerald-700 border-emerald-300">
                  Liberado
                </Badge>
              )}
            </label>
          ))}
        </div>
      </div>

      {modulesAtivos.length > 0 && (
        <div className="border rounded-lg p-3 bg-slate-50">
          <Label className="text-xs font-semibold mb-3 block uppercase">Botões do menu mobile (até 4)</Label>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
            {paginasMobile.map((page) => (
              <label
                key={page.id}
                className="flex items-center gap-2 p-2 rounded bg-white border cursor-pointer hover:bg-blue-50 transition-colors"
              >
                <Checkbox
                  checked={mobileMenuIds.includes(page.id)}
                  onCheckedChange={() => handleMobileToggle(page.id)}
                />
                <span className="text-xs flex-1 uppercase">{page.title}</span>
              </label>
            ))}
          </div>
        </div>
      )}

      {modulesAtivos.map((module) => (
        <div key={module.id} className="border rounded-lg p-3 bg-slate-50 space-y-3">
          <div className="flex items-center justify-between gap-2">
            <Label className="text-xs font-semibold uppercase">{module.title}</Label>
            <Badge variant="outline" className="text-[10px]">{module.pages.length} TELAS</Badge>
          </div>

          <div className="space-y-2">
            {module.pages.map((page) => {
              const permission = getPagePermission({ permissoes_telas: permissoesTelas }, page.id) || createRestrictedPagePermission(module.id, module.title, page);

              return (
                <div key={page.id} className="rounded-lg border bg-white p-3 space-y-2">
                  <div className="flex items-center justify-between gap-2">
                    <div>
                      <p className="text-xs font-semibold uppercase text-slate-900">{page.title}</p>
                      <p className="text-[11px] text-slate-500 uppercase">{page.url}</p>
                    </div>
                    <label className="flex items-center gap-2">
                      <Checkbox
                        checked={permission.visualizar}
                        onCheckedChange={(checked) => handlePagePermission(module, page, "visualizar", checked)}
                      />
                      <span className="text-xs uppercase">Visualizar</span>
                    </label>
                  </div>

                  <div className="grid grid-cols-2 md:grid-cols-6 gap-2">
                    {ACTION_KEYS.filter((action) => action !== "visualizar").map((action) => (
                      <label
                        key={action}
                        className={`flex items-center gap-2 rounded border px-2 py-1.5 ${permission.visualizar ? "bg-white" : "bg-slate-100 opacity-60"}`}
                      >
                        <Checkbox
                          checked={permission[action]}
                          disabled={!permission.visualizar}
                          onCheckedChange={(checked) => handlePagePermission(module, page, action, checked)}
                        />
                        <span className="text-[11px] uppercase">{ACTION_LABELS[action]}</span>
                      </label>
                    ))}
                  </div>

                  {page.id === "pec-mapa-geral" && (
                    <div className={`rounded-lg border p-3 space-y-3 ${permission.visualizar ? "bg-emerald-50 border-emerald-200" : "bg-slate-100 border-slate-200 opacity-60"}`}>
                      <div>
                        <p className="text-xs font-semibold uppercase text-slate-900">Permissões internas do Mapa Geral</p>
                        <p className="text-[11px] text-slate-500 uppercase">Ao liberar a tela, tudo continua bloqueado; abaixo você escolhe o que ele vê e faz dentro dela.</p>
                      </div>

                      {MAPA_GERAL_PERMISSION_GROUPS.map((group) => (
                        <div key={group.title} className="space-y-2">
                          <p className="text-[11px] font-semibold uppercase text-slate-700">{group.title}</p>
                          <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                            {group.items.map((item) => (
                              <label
                                key={item.key}
                                className={`flex items-center gap-2 rounded border px-2 py-1.5 ${permission.visualizar ? "bg-white" : "bg-slate-100 opacity-60"}`}
                              >
                                <Checkbox
                                  checked={mapaGeralPermissions[item.key]}
                                  disabled={!permission.visualizar}
                                  onCheckedChange={(checked) => handleMapaGeralPermission(item.key, checked)}
                                />
                                <span className="text-[11px] uppercase">{item.label}</span>
                              </label>
                            ))}
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      ))}
    </div>
  );
}