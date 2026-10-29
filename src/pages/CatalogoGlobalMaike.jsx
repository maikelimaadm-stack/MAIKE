/**
 * Painel interno do catálogo global de ícones do produto MAIKE (D-PROD-57).
 *
 * Fora do menu e separado das Configurações Gerais dos clientes. A rota é
 * acessível por URL direta, mas quem decide é o backend: `/admin/visao` só
 * responde a OperadorProdutoMaike (tenant comum, mesmo admin, recebe 403).
 *
 * Toda escrita manda `revisao_esperada`; em 409 a tela avisa, recarrega e não
 * sobrescreve a alteração de outro operador. As imagens são enviadas como o
 * proprietário as forneceu — nenhum redimensionamento ou conversão aqui.
 */

import React, { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import CadastroWorkspace from "@/components/cadastro/CadastroWorkspace";
import { Button } from "@/components/ui/button";
import { notifySuccess, notifyWarning, notifyError } from "@/lib/maikeNotify";
import { getApiErrorMessage } from "@/apis/_core/ApiError";
import {
  carregarVisaoAdminCatalogo,
  obterRevisaoCatalogo,
  criarTipoCatalogo,
  criarCategoriaCatalogo,
  criarIconeCatalogo,
  atualizarIconeCatalogo,
  publicarIconeCatalogo,
  desativarIconeCatalogo,
  enviarImagemCatalogo,
  ehSemPermissaoCatalogo,
  ehConflitoRevisaoCatalogo,
} from "@/services/catalogoGlobalService";

export const CHAVE_VISAO = ["catalogo-global", "admin", "visao"];
const CODIGO_REGEX = /^[a-z0-9_]+$/;
const SELECT_CLS =
  "h-9 w-full rounded-md border border-input bg-background px-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring";

const INPUT_CLS =
  "h-9 w-full rounded-md border border-input bg-transparent px-3 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring";
const BADGE_CLS = "inline-flex items-center rounded-md border px-2.5 py-0.5 text-xs font-semibold";

/** Mesmo visual do Card do design system, com tipos explícitos. */
function Painel({ titulo, descricao, className = "", children }) {
  return (
    <section className={`rounded-xl border bg-card text-card-foreground shadow ${className}`}>
      <header className="space-y-1 p-6 pb-2">
        <h2 className="text-sm font-semibold leading-none">{titulo}</h2>
        {descricao ? <p className="text-xs text-muted-foreground">{descricao}</p> : null}
      </header>
      <div className="p-6 pt-0">{children}</div>
    </section>
  );
}

const ESTADO_ROTULO = { rascunho: "Rascunho", publicado: "Publicado", inativo: "Inativo" };
const ESTADO_CLS = {
  rascunho: "bg-amber-100 text-amber-900 border-amber-200",
  publicado: "bg-emerald-100 text-emerald-900 border-emerald-200",
  inativo: "bg-slate-100 text-slate-600 border-slate-200",
};

function Previa({ url, rotulo, cor = null }) {
  return (
    <div
      className="flex h-12 w-12 shrink-0 items-center justify-center overflow-hidden rounded-md border bg-white"
      title={rotulo}
      style={!url && cor ? { backgroundColor: cor } : undefined}
    >
      {url ? (
        <img src={url} alt={rotulo} className="h-full w-full object-contain" />
      ) : (
        <span className="px-1 text-center text-[9px] leading-tight text-slate-500">{cor ? "" : "sem imagem"}</span>
      )}
    </div>
  );
}

function SeletorImagem({ id, rotulo, arquivo, onChange, limites, disabled }) {
  const previa = useMemo(() => (arquivo ? URL.createObjectURL(arquivo) : null), [arquivo]);
  return (
    <div className="flex items-center gap-2">
      <Previa url={previa} rotulo={rotulo} />
      <div className="min-w-0 flex-1">
        <label htmlFor={id} className="block text-xs font-medium text-slate-700">
          {rotulo}
        </label>
        <input
          id={id}
          type="file"
          accept={limites?.mimes?.join(",")}
          disabled={disabled}
          onChange={(e) => onChange(e.target.files?.[0] ?? null)}
          className="block w-full text-xs file:mr-2 file:rounded file:border file:bg-white file:px-2 file:py-1"
        />
        {arquivo ? (
          <p className="truncate text-[11px] text-slate-500">
            {arquivo.name} · {Math.round(arquivo.size / 1024)} KB
          </p>
        ) : null}
      </div>
    </div>
  );
}

export default function CatalogoGlobalMaike() {
  const queryClient = useQueryClient();
  const visaoQuery = useQuery({ queryKey: CHAVE_VISAO, queryFn: carregarVisaoAdminCatalogo, retry: false });
  const visao = /** @type {any} */ (visaoQuery.data);

  const [tipoFiltro, setTipoFiltro] = useState("");
  const [novoTipo, setNovoTipo] = useState({ codigo: "", nome: "" });
  const [novaCategoria, setNovaCategoria] = useState({ tipo_id: "", codigo: "", nome: "" });
  const [novoIcone, setNovoIcone] = useState({ tipo_id: "", categoria_id: "", cor_fallback: "" });
  const [arquivoPrincipal, setArquivoPrincipal] = useState(/** @type {File|null} */ (null));
  const [arquivoSubicone, setArquivoSubicone] = useState(/** @type {File|null} */ (null));
  const [trocaImagem, setTrocaImagem] = useState(/** @type {Record<string, File|null>} */ ({}));

  const recarregar = () => queryClient.invalidateQueries({ queryKey: CHAVE_VISAO });

  /** Executa uma ação com tratamento uniforme de CAS/permissão; sucesso só após confirmação. */
  const acao = useMutation({
    mutationFn: async (/** @type {{ executar: () => Promise<unknown>, sucesso: string }} */ { executar }) =>
      executar(),
    onSuccess: (_r, { sucesso }) => {
      notifySuccess("Catálogo atualizado", sucesso);
      recarregar();
    },
    onError: (erro) => {
      if (ehConflitoRevisaoCatalogo(erro)) {
        notifyWarning(
          "Catálogo alterado por outro operador",
          "Nada foi sobrescrito. A tela foi recarregada com a versão atual; revise e tente de novo.",
        );
      } else if (ehSemPermissaoCatalogo(erro)) {
        notifyError("Sem permissão", "Apenas o operador do produto MAIKE pode alterar o catálogo oficial.");
      } else {
        notifyError("Não foi possível concluir", getApiErrorMessage(erro, String(erro?.message || "Erro inesperado.")));
      }
      recarregar();
    },
  });

  const tipos = visao?.tipos ?? [];
  const categorias = visao?.categorias ?? [];
  const icones = visao?.icones ?? [];
  const limites = visao?.limites;
  const nomeTipo = (id) => tipos.find((t) => t.id === id)?.nome ?? "—";
  const nomeCategoria = (id) => categorias.find((c) => c.id === id)?.nome ?? "—";
  const iconesVisiveis = tipoFiltro ? icones.filter((i) => i.tipo_id === tipoFiltro) : icones;
  const ocupado = acao.isPending;

  if (visaoQuery.isLoading) {
    return (
      <CadastroWorkspace title="Catálogo global de ícones" subtitle="Carregando…">
        <p className="text-sm text-slate-500" role="status">
          Carregando catálogo…
        </p>
      </CadastroWorkspace>
    );
  }

  if (visaoQuery.isError) {
    const semPermissao = ehSemPermissaoCatalogo(visaoQuery.error);
    return (
      <CadastroWorkspace title="Catálogo global de ícones" subtitle="Produto MAIKE — uso interno">
        <Painel
          titulo={semPermissao ? "Acesso restrito" : "Não foi possível carregar"}
          descricao={
            semPermissao
              ? "Este painel é exclusivo do operador do produto MAIKE. Administradores das fazendas configuram suas preferências em Configurações Gerais."
              : getApiErrorMessage(visaoQuery.error, "Verifique a conexão com o backend e tente novamente.")
          }
          className={semPermissao ? "border-amber-200 bg-amber-50" : "border-red-200 bg-red-50"}
        >
          {!semPermissao ? (
            <Button size="sm" variant="outline" onClick={() => visaoQuery.refetch()}>
              Tentar novamente
            </Button>
          ) : null}
        </Painel>
      </CadastroWorkspace>
    );
  }

  const criarTipo = (e) => {
    e.preventDefault();
    const dados = { codigo: novoTipo.codigo.trim(), nome: novoTipo.nome.trim() };
    acao.mutate(
      { executar: () => criarTipoCatalogo(dados, visao.revisao), sucesso: `Tipo "${dados.nome}" criado.` },
      { onSuccess: () => setNovoTipo({ codigo: "", nome: "" }) },
    );
  };

  const criarCategoria = (e) => {
    e.preventDefault();
    const dados = {
      tipo_id: novaCategoria.tipo_id,
      codigo: novaCategoria.codigo.trim(),
      nome: novaCategoria.nome.trim(),
    };
    acao.mutate(
      { executar: () => criarCategoriaCatalogo(dados, visao.revisao), sucesso: `Categoria "${dados.nome}" criada.` },
      { onSuccess: () => setNovaCategoria((c) => ({ ...c, codigo: "", nome: "" })) },
    );
  };

  const criarIcone = (e) => {
    e.preventDefault();
    acao.mutate(
      {
        // Cada escrita avança a revisão; o fluxo relê a revisão entre os passos
        // e usa CAS em todos — se outro operador mexer no meio, para com 409.
        executar: async () => {
          let revisao = visao.revisao;
          let assetPrincipalId = null;
          let assetSubiconeId = null;
          if (arquivoPrincipal) {
            assetPrincipalId = (await enviarImagemCatalogo(arquivoPrincipal, revisao, limites)).id;
            revisao = await obterRevisaoCatalogo();
          }
          if (arquivoSubicone) {
            assetSubiconeId = (await enviarImagemCatalogo(arquivoSubicone, revisao, limites)).id;
            revisao = await obterRevisaoCatalogo();
          }
          return criarIconeCatalogo(
            {
              tipo_id: novoIcone.tipo_id,
              categoria_id: novoIcone.categoria_id,
              asset_principal_id: assetPrincipalId,
              asset_subicone_id: assetSubiconeId,
              cor_fallback: novoIcone.cor_fallback.trim() || null,
            },
            revisao,
          );
        },
        sucesso: "Ícone criado como rascunho. Publique quando estiver pronto.",
      },
      {
        onSuccess: () => {
          setNovoIcone((n) => ({ ...n, categoria_id: "", cor_fallback: "" }));
          setArquivoPrincipal(null);
          setArquivoSubicone(null);
        },
      },
    );
  };

  const trocarImagem = (icone) => {
    const arquivo = trocaImagem[icone.id];
    if (!arquivo) return;
    acao.mutate(
      {
        executar: async () => {
          const asset = await enviarImagemCatalogo(arquivo, visao.revisao, limites);
          const revisao = await obterRevisaoCatalogo();
          return atualizarIconeCatalogo(icone.id, { asset_principal_id: asset.id }, revisao);
        },
        sucesso: "Imagem do ícone atualizada (mesmo id lógico, novo arquivo versionado).",
      },
      { onSuccess: () => setTrocaImagem((t) => ({ ...t, [icone.id]: null })) },
    );
  };

  const categoriasDoTipo = (tipoId) => categorias.filter((c) => c.tipo_id === tipoId && c.ativo);
  const novoTipoValido = CODIGO_REGEX.test(novoTipo.codigo.trim()) && novoTipo.nome.trim();
  const novaCategoriaValida =
    novaCategoria.tipo_id && CODIGO_REGEX.test(novaCategoria.codigo.trim()) && novaCategoria.nome.trim();
  const novoIconeValido = novoIcone.tipo_id && novoIcone.categoria_id && (arquivoPrincipal || novoIcone.cor_fallback.trim());

  return (
    <CadastroWorkspace
      title="Catálogo global de ícones"
      subtitle={`Produto MAIKE — uso interno · revisão ${visao.revisao}`}
    >
      <div className="h-full space-y-4 overflow-y-auto pb-6">
        <Painel
          titulo="Ícones oficiais"
          descricao={`Compartilhados por todos os clientes. Formatos: ${limites?.mimes?.join(", ") ?? "—"} · até ${
            limites ? Math.round(limites.max_bytes / 1024) : "—"
          } KB por imagem.`}
        >
          <div className="space-y-3">
            <div className="flex flex-wrap items-center gap-2">
              <label htmlFor="filtro-tipo" className="text-xs text-slate-600">
                Tipo
              </label>
              <select
                id="filtro-tipo"
                className={`${SELECT_CLS} max-w-[220px]`}
                value={tipoFiltro}
                onChange={(e) => setTipoFiltro(e.target.value)}
              >
                <option value="">Todos</option>
                {tipos.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.nome}
                  </option>
                ))}
              </select>
            </div>

            {iconesVisiveis.length === 0 ? (
              <p className="rounded-md border border-dashed p-4 text-center text-sm text-slate-500">
                Nenhum ícone cadastrado{tipoFiltro ? " para este tipo" : ""}.
              </p>
            ) : (
              <ul className="divide-y rounded-md border" aria-label="Ícones do catálogo">
                {iconesVisiveis.map((icone) => (
                  <li key={icone.id} className="flex flex-col gap-2 p-3 sm:flex-row sm:items-center">
                    <div className="flex items-center gap-2">
                      <Previa url={icone.asset_principal?.public_url} rotulo="Ícone principal" cor={icone.cor_fallback} />
                      {icone.asset_subicone ? (
                        <Previa url={icone.asset_subicone.public_url} rotulo="Subícone" />
                      ) : null}
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium">{nomeCategoria(icone.categoria_id)}</p>
                      <p className="text-xs text-slate-500">
                        {nomeTipo(icone.tipo_id)} · rev. {icone.revisao}
                        {icone.asset_principal && !icone.asset_principal.public_url
                          ? " · URL pública indisponível (Storage não configurado)"
                          : ""}
                      </p>
                    </div>
                    <span className={`${BADGE_CLS} ${ESTADO_CLS[icone.estado] ?? ""}`}>
                      {ESTADO_ROTULO[icone.estado] ?? icone.estado}
                    </span>
                    <div className="flex flex-wrap items-center gap-2">
                      {icone.estado !== "inativo" ? (
                        <>
                          <input
                            aria-label={`Nova imagem para ${nomeCategoria(icone.categoria_id)}`}
                            type="file"
                            accept={limites?.mimes?.join(",")}
                            disabled={ocupado}
                            onChange={(e) => setTrocaImagem((t) => ({ ...t, [icone.id]: e.target.files?.[0] ?? null }))}
                            className="max-w-[180px] text-xs"
                          />
                          <Button
                            size="sm"
                            variant="outline"
                            disabled={ocupado || !trocaImagem[icone.id]}
                            onClick={() => trocarImagem(icone)}
                          >
                            Trocar imagem
                          </Button>
                        </>
                      ) : null}
                      {icone.estado === "rascunho" ? (
                        <Button
                          size="sm"
                          disabled={ocupado || !icone.asset_principal}
                          title={icone.asset_principal ? undefined : "Envie a imagem principal antes de publicar"}
                          onClick={() =>
                            acao.mutate({
                              executar: () => publicarIconeCatalogo(icone.id, visao.revisao),
                              sucesso: "Ícone publicado para todos os clientes.",
                            })
                          }
                        >
                          Publicar
                        </Button>
                      ) : null}
                      {icone.estado !== "inativo" ? (
                        <Button
                          size="sm"
                          variant="outline"
                          disabled={ocupado}
                          onClick={() =>
                            acao.mutate({
                              executar: () => desativarIconeCatalogo(icone.id, visao.revisao),
                              sucesso: "Ícone desativado (o registro e a imagem são preservados).",
                            })
                          }
                        >
                          Desativar
                        </Button>
                      ) : null}
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </Painel>

        <div className="grid gap-4 lg:grid-cols-2">
          <Painel titulo="Novo ícone" descricao="Tipo + categoria + imagem(ns). Nasce como rascunho.">
              <form className="space-y-3" onSubmit={criarIcone}>
                <div className="grid gap-2 sm:grid-cols-2">
                  <select
                    aria-label="Tipo do ícone"
                    className={SELECT_CLS}
                    value={novoIcone.tipo_id}
                    onChange={(e) => setNovoIcone({ ...novoIcone, tipo_id: e.target.value, categoria_id: "" })}
                  >
                    <option value="">Tipo…</option>
                    {tipos.filter((t) => t.ativo).map((t) => (
                      <option key={t.id} value={t.id}>
                        {t.nome}
                      </option>
                    ))}
                  </select>
                  <select
                    aria-label="Categoria do ícone"
                    className={SELECT_CLS}
                    value={novoIcone.categoria_id}
                    disabled={!novoIcone.tipo_id}
                    onChange={(e) => setNovoIcone({ ...novoIcone, categoria_id: e.target.value })}
                  >
                    <option value="">Categoria…</option>
                    {categoriasDoTipo(novoIcone.tipo_id).map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.nome}
                      </option>
                    ))}
                  </select>
                </div>
                <SeletorImagem
                  id="novo-icone-principal"
                  rotulo="Imagem principal"
                  arquivo={arquivoPrincipal}
                  onChange={setArquivoPrincipal}
                  limites={limites}
                  disabled={ocupado}
                />
                <SeletorImagem
                  id="novo-icone-subicone"
                  rotulo="Subícone (opcional)"
                  arquivo={arquivoSubicone}
                  onChange={setArquivoSubicone}
                  limites={limites}
                  disabled={ocupado}
                />
                <input
                  className={INPUT_CLS}
                  aria-label="Cor de fallback"
                  placeholder="Cor de fallback (ex.: #16a34a)"
                  maxLength={32}
                  value={novoIcone.cor_fallback}
                  onChange={(e) => setNovoIcone({ ...novoIcone, cor_fallback: e.target.value })}
                />
                <Button type="submit" size="sm" disabled={ocupado || !novoIconeValido}>
                  {ocupado ? "Enviando…" : "Criar ícone"}
                </Button>
              </form>
          </Painel>

          <Painel titulo="Tipos e categorias" descricao="Código: letras minúsculas, números e _ (estável, não muda).">
            <div className="space-y-4">
              {tipos.length === 0 ? (
                <p className="text-sm text-slate-500">Nenhum tipo cadastrado.</p>
              ) : (
                <ul className="space-y-2 text-sm" aria-label="Tipos do catálogo">
                  {tipos.map((t) => (
                    <li key={t.id}>
                      <span className="font-medium">{t.nome}</span>{" "}
                      <span className="text-xs text-slate-500">({t.codigo}{t.ativo ? "" : " · inativo"})</span>
                      <div className="mt-1 flex flex-wrap gap-1">
                        {categorias
                          .filter((c) => c.tipo_id === t.id)
                          .map((c) => (
                            <span key={c.id} className={`${BADGE_CLS} font-normal`}>
                              {c.nome}
                            </span>
                          ))}
                      </div>
                    </li>
                  ))}
                </ul>
              )}

              <form className="grid gap-2 sm:grid-cols-[1fr_1fr_auto]" onSubmit={criarTipo}>
                <input
                  className={INPUT_CLS}
                  aria-label="Código do novo tipo"
                  placeholder="código (ex.: lote)"
                  value={novoTipo.codigo}
                  onChange={(e) => setNovoTipo({ ...novoTipo, codigo: e.target.value })}
                />
                <input
                  className={INPUT_CLS}
                  aria-label="Nome do novo tipo"
                  placeholder="Nome"
                  value={novoTipo.nome}
                  onChange={(e) => setNovoTipo({ ...novoTipo, nome: e.target.value })}
                />
                <Button type="submit" size="sm" variant="outline" disabled={ocupado || !novoTipoValido}>
                  Criar tipo
                </Button>
              </form>

              <form className="grid gap-2 sm:grid-cols-2" onSubmit={criarCategoria}>
                <select
                  aria-label="Tipo da nova categoria"
                  className={`${SELECT_CLS} sm:col-span-2`}
                  value={novaCategoria.tipo_id}
                  onChange={(e) => setNovaCategoria({ ...novaCategoria, tipo_id: e.target.value })}
                >
                  <option value="">Tipo…</option>
                  {tipos.filter((t) => t.ativo).map((t) => (
                    <option key={t.id} value={t.id}>
                      {t.nome}
                    </option>
                  ))}
                </select>
                <input
                  className={INPUT_CLS}
                  aria-label="Código da nova categoria"
                  placeholder="código (ex.: bezerro_0_12)"
                  value={novaCategoria.codigo}
                  onChange={(e) => setNovaCategoria({ ...novaCategoria, codigo: e.target.value })}
                />
                <input
                  className={INPUT_CLS}
                  aria-label="Nome da nova categoria"
                  placeholder="Nome"
                  value={novaCategoria.nome}
                  onChange={(e) => setNovaCategoria({ ...novaCategoria, nome: e.target.value })}
                />
                <Button
                  type="submit"
                  size="sm"
                  variant="outline"
                  className="sm:col-span-2 sm:justify-self-start"
                  disabled={ocupado || !novaCategoriaValida}
                >
                  Criar categoria
                </Button>
              </form>
            </div>
          </Painel>
        </div>
      </div>
    </CadastroWorkspace>
  );
}
