/**
 * Núcleo da importação de ícones oficiais do catálogo global (D-PROD-69).
 *
 * Usa SOMENTE a API administrativa server-side já existente
 * (`/catalogo-global/admin/*`, protegida por `exigirOperadorProduto`), para
 * herdar validação real de MIME/tamanho, CAS por `revisao_esperada`,
 * auditoria e compensação de Storage. Nada aqui escreve no banco direto.
 *
 * `http({ method, url, payload })` é injetado: a CLI usa fetch; o teste usa
 * `app.inject`. Os bytes das imagens são enviados SEM transformação.
 */

import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { dirname, isAbsolute, resolve } from 'node:path';

export const LIMITE_PADRAO_BYTES = 512 * 1024;
const CODIGO = /^[a-z0-9_]+$/;
const COR = /^#[0-9a-fA-F]{6}$/;

/** Mesma detecção por assinatura do backend (`detectarMimeReal`). */
export const mimePorAssinatura = (b) => {
  if (b.length >= 8 && b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47) return 'image/png';
  if (b.length >= 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return 'image/jpeg';
  if (b.length >= 12 && b.toString('ascii', 0, 4) === 'RIFF' && b.toString('ascii', 8, 12) === 'WEBP') return 'image/webp';
  if (b.length >= 6 && (b.toString('ascii', 0, 6) === 'GIF87a' || b.toString('ascii', 0, 6) === 'GIF89a')) return 'image/gif';
  return null;
};

/**
 * Lê e valida o manifesto e os arquivos locais. Não toca em rede.
 *
 * @param {string} caminhoManifesto
 * @param {{ maxBytes?: number }} [opcoes]
 */
export const carregarManifesto = async (caminhoManifesto, { maxBytes = LIMITE_PADRAO_BYTES } = {}) => {
  const base = dirname(resolve(caminhoManifesto));
  const bruto = JSON.parse(await readFile(caminhoManifesto, 'utf8'));
  const erros = [];
  const tipo = bruto?.tipo ?? {};
  if (!CODIGO.test(String(tipo.codigo ?? ''))) erros.push('tipo.codigo inválido (use ^[a-z0-9_]+$)');
  if (!String(tipo.nome ?? '').trim()) erros.push('tipo.nome obrigatório');
  const itens = Array.isArray(bruto?.itens) ? bruto.itens : [];
  if (itens.length === 0) erros.push('itens vazio');
  const vistos = new Set();
  const lidos = [];
  for (const [i, item] of itens.entries()) {
    const rot = `itens[${i}]`;
    const codigo = String(item?.categoria?.codigo ?? '');
    if (!CODIGO.test(codigo)) erros.push(`${rot}.categoria.codigo inválido`);
    if (vistos.has(codigo)) erros.push(`${rot}: categoria "${codigo}" repetida no manifesto`);
    vistos.add(codigo);
    if (!String(item?.categoria?.nome ?? '').trim()) erros.push(`${rot}.categoria.nome obrigatório`);
    if (item?.cor_fallback != null && !COR.test(item.cor_fallback)) erros.push(`${rot}.cor_fallback inválida (#RRGGBB)`);
    const caminho = String(item?.imagem ?? '');
    if (!caminho) {
      erros.push(`${rot}.imagem obrigatória`);
      continue;
    }
    const absoluto = isAbsolute(caminho) ? caminho : resolve(base, caminho);
    let buffer;
    try {
      buffer = await readFile(absoluto);
    } catch {
      erros.push(`${rot}: arquivo não encontrado (${caminho})`);
      continue;
    }
    const mime = mimePorAssinatura(buffer);
    if (!mime) erros.push(`${rot}: formato não aceito (só PNG/JPEG/WebP/GIF; SVG recusado) — ${caminho}`);
    if (buffer.length > maxBytes) erros.push(`${rot}: ${buffer.length} bytes acima do limite de ${maxBytes} — ${caminho}`);
    lidos.push({
      categoria: { codigo, nome: String(item.categoria.nome).trim() },
      cor_fallback: item.cor_fallback ?? null,
      arquivo: caminho,
      buffer,
      mime,
      sha256: createHash('sha256').update(buffer).digest('hex'),
    });
  }
  return { tipo: { codigo: String(tipo.codigo ?? ''), nome: String(tipo.nome ?? '').trim() }, itens: lidos, erros };
};

/** Mesma precedência do frontend: maior revisão, empate → menor id. */
const iconeVigente = (icones, tipoId, categoriaId) =>
  icones
    .filter((i) => i.tipo_id === tipoId && i.categoria_id === categoriaId)
    .sort((a, b) => Number(b.revisao ?? 0) - Number(a.revisao ?? 0) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))[0] ??
  null;

/** sha16 do path versionado `v{rev}/{sha16}-{id}.ext`, quando a URL pública existe. */
const sha16DaUrl = (url) => (typeof url === 'string' ? (/\/v\d+\/([0-9a-f]{16})-/.exec(url)?.[1] ?? null) : null);

const exigirOk = (r, contexto) => {
  if (r.status >= 200 && r.status < 300) return r.body;
  const codigo = r.body?.code ?? 'ERRO';
  throw new Error(`${contexto}: HTTP ${r.status} ${codigo}${r.body?.message ? ` — ${r.body.message}` : ''}`);
};

/**
 * Lê o estado PUBLICADO atual e monta o plano. Não escreve.
 *
 * @param {{ tipo: any, itens: any[] }} manifesto
 * @param {(req: { method: string, url: string, payload?: any }) => Promise<{ status: number, body: any }>} http
 */
export const planejar = async (manifesto, http) => {
  const tipos = exigirOk(await http({ method: 'GET', url: '/catalogo-global/tipos' }), 'ler tipos');
  const categorias = exigirOk(await http({ method: 'GET', url: '/catalogo-global/categorias' }), 'ler categorias');
  const icones = exigirOk(await http({ method: 'GET', url: '/catalogo-global/icones' }), 'ler ícones');
  const tipo = tipos.find((t) => t.codigo === manifesto.tipo.codigo) ?? null;
  const passos = manifesto.itens.map((item) => {
    const categoria = tipo ? categorias.find((c) => c.tipo_id === tipo.id && c.codigo === item.categoria.codigo) ?? null : null;
    const icone = categoria ? iconeVigente(icones, tipo.id, categoria.id) : null;
    let acao;
    if (!icone) acao = 'criar_e_publicar';
    else if (sha16DaUrl(icone.asset_principal_url) === item.sha256.slice(0, 16)) acao = 'nada';
    else acao = 'trocar_imagem';
    return { item, categoria, icone, acao };
  });
  return { tipo, passos };
};

/**
 * Aplica o plano pela API admin, relendo a revisão antes de CADA escrita (CAS).
 * Conflito (409) interrompe: reexecutar é seguro (idempotente pelo estado publicado).
 *
 * @param {{ tipo: any, itens: any[] }} manifesto
 * @param {(req: { method: string, url: string, payload?: any }) => Promise<{ status: number, body: any }>} http
 * @param {(linha: string) => void} [log]
 */
export const aplicar = async (manifesto, http, log = () => {}) => {
  const revisao = async () => exigirOk(await http({ method: 'GET', url: '/catalogo-global/manifest' }), 'manifest').revisao;
  const escrever = async (method, url, payload, contexto) =>
    exigirOk(await http({ method, url, payload: { ...payload, revisao_esperada: await revisao() } }), contexto);

  const plano = await planejar(manifesto, http);
  let tipo = plano.tipo;
  if (!tipo) {
    tipo = await escrever('POST', '/catalogo-global/admin/tipos', manifesto.tipo, 'criar tipo');
    log(`tipo criado: ${tipo.codigo} (${tipo.id})`);
  }
  const resultado = [];
  for (const passo of plano.passos) {
    const { item } = passo;
    if (passo.acao === 'nada') {
      log(`${item.categoria.codigo}: já publicado com a mesma imagem — nada a fazer`);
      resultado.push({ categoria: item.categoria.codigo, acao: 'nada', icone_id: passo.icone.id, categoria_id: passo.categoria.id });
      continue;
    }
    let categoria = passo.categoria;
    if (!categoria) {
      categoria = await escrever('POST', '/catalogo-global/admin/categorias', { tipo_id: tipo.id, ...item.categoria }, 'criar categoria');
      log(`${item.categoria.codigo}: categoria criada (${categoria.id})`);
    }
    const asset = await escrever(
      'POST',
      '/catalogo-global/admin/assets',
      { mime_type: item.mime, conteudo_base64: item.buffer.toString('base64') },
      `enviar ${item.arquivo}`
    );
    if (passo.icone) {
      // Troca de imagem: MESMO id lógico, só asset/revisão mudam; segue publicado.
      await escrever(
        'PATCH',
        `/catalogo-global/admin/icones/${encodeURIComponent(passo.icone.id)}`,
        { asset_principal_id: asset.id, ...(item.cor_fallback ? { cor_fallback: item.cor_fallback } : {}) },
        'trocar imagem'
      );
      log(`${item.categoria.codigo}: imagem trocada no ícone ${passo.icone.id}`);
      resultado.push({ categoria: item.categoria.codigo, acao: 'trocar_imagem', icone_id: passo.icone.id, categoria_id: categoria.id });
      continue;
    }
    const icone = await escrever(
      'POST',
      '/catalogo-global/admin/icones',
      { tipo_id: tipo.id, categoria_id: categoria.id, asset_principal_id: asset.id, cor_fallback: item.cor_fallback },
      'criar ícone'
    );
    await escrever('POST', `/catalogo-global/admin/icones/${encodeURIComponent(icone.id)}/publicar`, {}, 'publicar ícone');
    log(`${item.categoria.codigo}: ícone ${icone.id} criado e publicado`);
    resultado.push({ categoria: item.categoria.codigo, acao: 'criar_e_publicar', icone_id: icone.id, categoria_id: categoria.id });
  }
  return { tipo_id: tipo.id, resultado };
};
