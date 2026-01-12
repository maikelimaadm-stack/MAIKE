import { createClientFromRequest } from 'npm:@base44/sdk@0.8.6';
import JSZip from 'npm:jszip@3.10.1';

function collectFileRefs(obj, basePath = '') {
  const refs = [];
  const walk = (node, path) => {
    if (node === null || node === undefined) return;
    if (typeof node === 'string') {
      const s = node.trim();
      if (/^https?:\/\//i.test(s) || /:\/\//.test(s)) {
        refs.push({ path, ref: s });
      }
      return;
    }
    if (Array.isArray(node)) {
      node.forEach((v, i) => walk(v, `${path}[${i}]`));
      return;
    }
    if (typeof node === 'object') {
      for (const [k, v] of Object.entries(node)) {
        walk(v, path ? `${path}.${k}` : k);
      }
    }
  };
  walk(obj, basePath);
  return refs;
}

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });

    const entityNames = [
      'Pesagem','Fornecedor','Produto','UnidadeMedida','Categoria','LocalEstoque','Empresa','Safra','CustoSafra','HistoricoEntrega','MovimentacaoEstoque','CentroCusto','LancamentoFinanceiro','BaixaFinanceira','PlanoContas','GrupoFinanceiro','LivroFiscal','Cidade','ContaBancaria','MovimentacaoBancaria',
      'AtivoFixo','FormaPagamento','Permissao','AreaPastagem','MovimentacaoPecuaria','EventoSanitario','PontoReferencia','Lote','ConfiguracaoIcone','LinhaGeografica','PontoSuplementacao','SuplementacaoEvento','SuplementacaoLote','FatorConsumoCategoria','CategoriaManejo','Maquina','ManutencaoMaquina','AbastecimentoMaquina','OperacaoAgricola','ControleArea','TarefaMapa','Setor','PesagemIndividual','Apartacao','LoteApartacao','FichaPersonalizada','SanidadeAnimal','ConfiguracaoSanidade','ItemSanidade','ProdutoCotacao','LoteAnimaisCotacao','AplicacaoMedicamento','PlanoAcao','Implemento','GrupoAtividade','TipoTarefa','LancamentoTarefa','Embarque','DocumentoEmbarque','EstoqueLoteNota'
    ];

    const zip = new JSZip();
    const data = {};
    const schemas = {};
    const manifest = [];

    // Coletar dados e refs
    for (const name of entityNames) {
      try {
        let list = [];
        try { list = await base44.entities[name].list(); } catch (_) {
          try { list = await base44.asServiceRole.entities[name].list(); } catch (_) { list = []; }
        }
        data[name] = list || [];
        try { schemas[name] = await base44.entities[name].schema(); } catch (_) {}
      } catch (_) { /* entidade pode não existir */ }
    }

    // Adiciona data.json e schemas.json
    zip.file('data/data.json', JSON.stringify({ exported_at: new Date().toISOString(), by: { id: user.id, email: user.email }, data }, null, 2));
    zip.file('data/schemas.json', JSON.stringify(schemas, null, 2));

    // Coletar referências de arquivos
    const fileMap = new Map(); // key: resolved url => { saveAs, original, meta }
    for (const [entity, records] of Object.entries(data)) {
      for (const rec of records) {
        const refs = collectFileRefs(rec, entity);
        for (const r of refs) {
          const original = r.ref;
          let fetchUrl = original;
          // se for um URI (ex.: private://), criar signed URL
          if (!/^https?:\/\//i.test(original)) {
            try {
              const { signed_url } = await base44.asServiceRole.integrations.Core.CreateFileSignedUrl({ file_uri: original });
              if (signed_url) fetchUrl = signed_url;
            } catch (_) { /* ignora se não conseguir assinar */ }
          }
          try {
            const urlObj = new URL(fetchUrl);
            const pathParts = urlObj.pathname.split('/').filter(Boolean);
            const filenameGuess = pathParts[pathParts.length - 1] || 'arquivo';
            const saveAs = `files/${entity}/${rec.id || 'sem_id'}/${filenameGuess}`;
            if (!fileMap.has(fetchUrl)) {
              fileMap.set(fetchUrl, { saveAs, original, entity, recordId: rec.id || null, field_path: r.path });
            }
          } catch (_) {
            // não é URL válida, ignora
          }
        }
      }
    }

    // Baixar arquivos e adicionar ao zip
    for (const [url, info] of fileMap.entries()) {
      try {
        const resp = await fetch(url);
        if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
        const buf = new Uint8Array(await resp.arrayBuffer());
        zip.file(info.saveAs, buf);
        manifest.push({ entity: info.entity, record_id: info.recordId, field_path: info.field_path, original: info.original, saved_as: info.saveAs });
      } catch (e) {
        manifest.push({ entity: info.entity, record_id: info.recordId, field_path: info.field_path, original: info.original, saved_as: null, error: String(e?.message || e) });
      }
    }

    zip.file('data/manifest.json', JSON.stringify({ files: manifest }, null, 2));

    const zipBytes = await zip.generateAsync({ type: 'uint8array', compression: 'DEFLATE' });

    return new Response(zipBytes, {
      status: 200,
      headers: {
        'Content-Type': 'application/zip',
        'Content-Disposition': `attachment; filename=backup_pacote_${new Date().toISOString().slice(0,10)}.zip`
      }
    });
  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
});