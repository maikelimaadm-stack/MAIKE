import { createClientFromRequest } from 'npm:@base44/sdk@0.8.21';

const TARGET_EMAILS = [
  'maike.lima.adm@gmail.com',
  'maike.fazendapalmital@gmail.com',
];

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const permissoes = await base44.asServiceRole.entities.Permissao.list();

    const results = [];

    for (const email of TARGET_EMAILS) {
      const existente = permissoes.find((item) => item.user_email === email);
      const payload = {
        user_email: email,
        modulos_permitidos: [],
        permissoes_telas: [],
        mobile_menu_ids: [],
        is_admin: true,
      };

      if (existente) {
        const updated = await base44.asServiceRole.entities.Permissao.update(existente.id, payload);
        results.push({ email, action: 'updated', id: updated.id });
      } else {
        const created = await base44.asServiceRole.entities.Permissao.create(payload);
        results.push({ email, action: 'created', id: created.id });
      }
    }

    return Response.json({ success: true, results });
  } catch (error) {
    return Response.json({ success: false, error: error.message }, { status: 500 });
  }
});