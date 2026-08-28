/**
 * Testes do `gate:modelobase1-pecuario`.
 *
 * Cada caso monta um contrato **estruturado** num diretório temporário e roda o
 * gate real. Nenhum teste procura palavra em documentação: o que reprova é a
 * forma do JSON, não a prosa em volta dele.
 *
 * MB1-01 a MB1-20.
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { makeTempDir, cleanup, writeFile, runGate, REPO_ROOT } from './helpers.mjs';

const GATE = 'gate-modelobase1-pecuario.mjs';
const CONTRATO = 'config/modelobase1-pecuario.json';

/** O contrato real do repositório é o ponto de partida de todas as mutações. */
const contratoReal = () => JSON.parse(readFileSync(join(REPO_ROOT, CONTRATO), 'utf8'));

/**
 * Roda o gate contra um contrato num diretório temporário.
 * @param {object|string|null} contrato objeto, texto cru, ou `null` para não criar o arquivo
 */
const rodarCom = (contrato) => {
  const dir = makeTempDir('maike-mb1-');
  try {
    if (contrato !== null) {
      writeFile(dir, CONTRATO, typeof contrato === 'string' ? contrato : JSON.stringify(contrato, null, 2) + '\n');
    }
    return runGate(GATE, { cwd: dir });
  } finally {
    cleanup(dir);
  }
};

/** Aplica uma mutação sobre uma cópia profunda do contrato real. */
const mutar = (fn) => {
  const copia = contratoReal();
  fn(copia);
  return copia;
};

describe('gate:modelobase1-pecuario — contrato base pecuário', () => {
  test('MB1-01 contrato válido passa', () => {
    const r = rodarCom(contratoReal());
    assert.equal(r.status, 0, r.output);
    assert.match(r.output, /gate:modelobase1-pecuario — PASSOU/);
  });

  test('MB1-02 arquivo ausente reprova', () => {
    const r = rodarCom(null);
    assert.equal(r.status, 1);
    assert.match(r.output, /P2-MB1-CONTRACT-MISSING/);
    assert.match(r.output, /contrato ausente/);
  });

  test('MB1-03 JSON inválido reprova', () => {
    const r = rodarCom('{ "version": 1, isto não é json');
    assert.equal(r.status, 1);
    assert.match(r.output, /P2-MB1-CONTRACT-INVALID/);
    assert.match(r.output, /não é JSON válido/);
  });

  test('MB1-04 versão divergente reprova', () => {
    const r = rodarCom(mutar((c) => { c.version = 2; }));
    assert.equal(r.status, 1);
    assert.match(r.output, /P2-MB1-CONTRACT-VERSION/);
    assert.match(r.output, /version deve ser 1/);
  });

  test('MB1-04b status não oficial reprova', () => {
    const r = rodarCom(mutar((c) => { c.status = 'draft'; }));
    assert.equal(r.status, 1);
    assert.match(r.output, /P2-MB1-CONTRACT-VERSION/);
    assert.match(r.output, /status deve ser "official"/);
  });

  test('MB1-05 meaning de template visual reprova', () => {
    const r = rodarCom(mutar((c) => { c.meaning = 'visual-template'; }));
    assert.equal(r.status, 1);
    assert.match(r.output, /P2-MB1-CONTRACT-SHAPE/);
    assert.match(r.output, /meaning deve ser "persistence-domain-contract"/);
  });

  test('MB1-05b contractId divergente reprova', () => {
    const r = rodarCom(mutar((c) => { c.contractId = 'modelobase1'; }));
    assert.equal(r.status, 1);
    assert.match(r.output, /contractId deve ser "modelobase1-pecuario"/);
  });

  test('MB1-05c seção obrigatória ausente reprova', () => {
    const r = rodarCom(mutar((c) => { delete c.concurrency; }));
    assert.equal(r.status, 1);
    assert.match(r.output, /P2-MB1-CONTRACT-SHAPE/);
    assert.match(r.output, /seção obrigatória ausente: concurrency/);
  });

  test('MB1-06 cliente_id vindo do request reprova', () => {
    const r = rodarCom(mutar((c) => { c.tenancy.tenantSource = 'body'; }));
    assert.equal(r.status, 1);
    assert.match(r.output, /P2-MB1-TENANCY/);
    assert.match(r.output, /tenancy\.tenantSource deve ser "auth_context"/);
  });

  test('MB1-06b remover body das fontes proibidas reprova', () => {
    const r = rodarCom(
      mutar((c) => {
        c.tenancy.forbiddenTenantSources = c.tenancy.forbiddenTenantSources.filter((f) => f !== 'body');
      })
    );
    assert.equal(r.status, 1);
    assert.match(r.output, /P2-MB1-TENANCY/);
    assert.match(r.output, /forbiddenTenantSources não declara: body/);
  });

  // P2-R1 — as três invariantes que a P2 declarava no contrato mas não protegia
  // no gate. Cada uma remove um valor do SSOT e exige que o gate reprove.
  test('MB1-06c remover headers de forbiddenTenantSources reprova', () => {
    const dir = makeTempDir('maike-mb1-');
    try {
      const invalido =
        JSON.stringify(
          mutar((c) => {
            c.tenancy.forbiddenTenantSources = c.tenancy.forbiddenTenantSources.filter(
              (f) => f !== 'headers'
            );
          }),
          null,
          2
        ) + '\n';
      writeFile(dir, CONTRATO, invalido);

      const r = runGate(GATE, { cwd: dir });
      assert.equal(r.status, 1);
      assert.match(r.output, /P2-MB1-TENANCY/);
      assert.match(r.output, /tenancy\.forbiddenTenantSources não declara: headers/);
      assert.equal(readFileSync(join(dir, CONTRATO), 'utf8'), invalido);
    } finally {
      cleanup(dir);
    }
  });

  test('MB1-06d remover cookie de forbiddenTenantSources reprova', () => {
    const dir = makeTempDir('maike-mb1-');
    try {
      const invalido =
        JSON.stringify(
          mutar((c) => {
            c.tenancy.forbiddenTenantSources = c.tenancy.forbiddenTenantSources.filter(
              (f) => f !== 'cookie'
            );
          }),
          null,
          2
        ) + '\n';
      writeFile(dir, CONTRATO, invalido);

      const r = runGate(GATE, { cwd: dir });
      assert.equal(r.status, 1);
      assert.match(r.output, /P2-MB1-TENANCY/);
      assert.match(r.output, /tenancy\.forbiddenTenantSources não declara: cookie/);
      assert.equal(readFileSync(join(dir, CONTRATO), 'utf8'), invalido);
    } finally {
      cleanup(dir);
    }
  });

  test('MB1-06e remover headers de forbiddenActorSources reprova', () => {
    const dir = makeTempDir('maike-mb1-');
    try {
      const invalido =
        JSON.stringify(
          mutar((c) => {
            c.audit.forbiddenActorSources = c.audit.forbiddenActorSources.filter(
              (f) => f !== 'headers'
            );
          }),
          null,
          2
        ) + '\n';
      writeFile(dir, CONTRATO, invalido);

      const r = runGate(GATE, { cwd: dir });
      assert.equal(r.status, 1);
      assert.match(r.output, /P2-MB1-AUDIT/);
      assert.match(r.output, /audit\.forbiddenActorSources não declara: headers/);
      assert.equal(readFileSync(join(dir, CONTRATO), 'utf8'), invalido);
    } finally {
      cleanup(dir);
    }
  });

  test('MB1-06f o ator não herda cookie — o contrato do tenant é mais fechado', () => {
    // As duas listas são separadas de propósito. `cookie` não está em
    // audit.forbiddenActorSources no SSOT, e o gate não pode exigir mais do que
    // o contrato declara — senão o contrato real reprovaria a si mesmo.
    const c = contratoReal();
    assert.ok(c.tenancy.forbiddenTenantSources.includes('cookie'));
    assert.ok(!c.audit.forbiddenActorSources.includes('cookie'));

    const r = rodarCom(c);
    assert.equal(r.status, 0, r.output);
  });

  test('MB1-07 segunda exceção sem cliente_id reprova', () => {
    const r = rodarCom(mutar((c) => { c.tenancy.modelsWithoutTenantField.push('ConfiguracaoIcone'); }));
    assert.equal(r.status, 1);
    assert.match(r.output, /P2-MB1-TENANCY/);
    assert.match(r.output, /exceção não autorizada: ConfiguracaoIcone/);
  });

  test('MB1-07b catálogo global adicional reprova', () => {
    const r = rodarCom(mutar((c) => { c.tenancy.globalCatalogModels = ['UnidadeMedida']; }));
    assert.equal(r.status, 1);
    assert.match(r.output, /P2-MB1-TENANCY/);
    assert.match(r.output, /globalCatalogModels deve estar vazio/);
  });

  test('MB1-08 unique de negócio sem tenant reprova', () => {
    const r = rodarCom(mutar((c) => { c.tenancy.businessUniqueIncludesTenant = false; }));
    assert.equal(r.status, 1);
    assert.match(r.output, /P2-MB1-TENANCY/);
    assert.match(r.output, /businessUniqueIncludesTenant deve ser true/);
  });

  test('MB1-09 índice tenant sem cliente_id primeiro reprova', () => {
    const r = rodarCom(mutar((c) => { c.tenancy.tenantIndexFirstColumn = 'createdAt'; }));
    assert.equal(r.status, 1);
    assert.match(r.output, /P2-MB1-TENANCY/);
    assert.match(r.output, /tenantIndexFirstColumn deve ser "cliente_id"/);
  });

  test('MB1-09b unique da sequência sem cliente_id na frente reprova', () => {
    const r = rodarCom(
      mutar((c) => {
        c.numbering.sequenceModel.uniqueKey = ['entidade', 'cliente_id', 'escopo_tipo', 'escopo_id'];
      })
    );
    assert.equal(r.status, 1);
    assert.match(r.output, /P2-MB1-NUMBERING/);
    assert.match(r.output, /uniqueKey deve começar por cliente_id/);
  });

  test('MB1-10 max + 1 reprova', () => {
    const r = rodarCom(
      mutar((c) => {
        c.numbering.strategy = 'max_plus_one';
        c.numbering.forbiddenStrategies = ['count_plus_one'];
      })
    );
    assert.equal(r.status, 1);
    assert.match(r.output, /P2-MB1-NUMBERING/);
    assert.match(r.output, /numbering\.strategy deve ser "atomic-database-sequence"/);
    assert.match(r.output, /forbiddenStrategies não declara: max_plus_one/);
  });

  test('MB1-11 count + 1 reprova', () => {
    const r = rodarCom(
      mutar((c) => {
        c.numbering.strategy = 'count_plus_one';
        c.numbering.forbiddenStrategies = ['max_plus_one'];
      })
    );
    assert.equal(r.status, 1);
    assert.match(r.output, /P2-MB1-NUMBERING/);
    assert.match(r.output, /forbiddenStrategies não declara: count_plus_one/);
  });

  test('MB1-11b estratégia proibida declarada como estratégia oficial reprova duas vezes', () => {
    const r = rodarCom(mutar((c) => { c.numbering.strategy = 'max_plus_one'; }));
    assert.equal(r.status, 1);
    assert.match(r.output, /numbering\.strategy não pode ser uma estratégia proibida/);
  });

  test('MB1-12 sequência não transacional reprova', () => {
    const r = rodarCom(
      mutar((c) => {
        c.numbering.transactional = false;
        c.concurrency.numberingTransactional = false;
      })
    );
    assert.equal(r.status, 1);
    assert.match(r.output, /P2-MB1-NUMBERING/);
    assert.match(r.output, /numbering\.transactional deve ser true/);
    assert.match(r.output, /concurrency\.numberingTransactional deve ser true/);
  });

  test('MB1-12b incremento não atômico reprova', () => {
    const r = rodarCom(mutar((c) => { c.numbering.atomicIncrement = false; }));
    assert.equal(r.status, 1);
    assert.match(r.output, /numbering\.atomicIncrement deve ser true/);
  });

  test('MB1-12c NULL em escopo sem representação segura reprova', () => {
    const r = rodarCom(mutar((c) => { delete c.numbering.sequenceModel.nullScopeHazard; }));
    assert.equal(r.status, 1);
    assert.match(r.output, /P2-MB1-NUMBERING/);
    assert.match(r.output, /nullScopeHazard deve documentar o risco de NULL/);
  });

  test('MB1-12d remover empresa de numbering.scopeTypes reprova', () => {
    const dir = makeTempDir('maike-mb1-');
    try {
      const invalido =
        JSON.stringify(
          mutar((c) => {
            c.numbering.scopeTypes = c.numbering.scopeTypes.filter((s) => s !== 'empresa');
          }),
          null,
          2
        ) + '\n';
      writeFile(dir, CONTRATO, invalido);

      const r = runGate(GATE, { cwd: dir });
      assert.equal(r.status, 1);
      assert.match(r.output, /P2-MB1-NUMBERING/);
      assert.match(r.output, /numbering\.scopeTypes não declara: empresa/);
      assert.equal(readFileSync(join(dir, CONTRATO), 'utf8'), invalido);
    } finally {
      cleanup(dir);
    }
  });

  test('MB1-12e remover tenant de numbering.scopeTypes reprova', () => {
    const r = rodarCom(
      mutar((c) => {
        c.numbering.scopeTypes = c.numbering.scopeTypes.filter((s) => s !== 'tenant');
      })
    );
    assert.equal(r.status, 1);
    assert.match(r.output, /numbering\.scopeTypes não declara: tenant/);
  });

  test('MB1-12f a ordem de scopeTypes não é normativa', () => {
    const r = rodarCom(mutar((c) => { c.numbering.scopeTypes = ['empresa', 'tenant']; }));
    assert.equal(r.status, 0, r.output);
  });

  test('MB1-12g escopo decidido fora da capacidade ou fora de P4-P6 reprova', () => {
    const r = rodarCom(
      mutar((c) => {
        c.numbering.scopeDeclaredByCapability = false;
        c.numbering.scopeAssignmentPhase = 'P2';
      })
    );
    assert.equal(r.status, 1);
    assert.match(r.output, /numbering\.scopeDeclaredByCapability deve ser true/);
    assert.match(r.output, /numbering\.scopeAssignmentPhase deve ser "P4-P6"/);
  });

  test('MB1-13 anexo usando URL como identidade reprova', () => {
    const r = rodarCom(
      mutar((c) => {
        c.attachments.identityField = 'file_url';
        c.attachments.urlAsIdentity = true;
      })
    );
    assert.equal(r.status, 1);
    assert.match(r.output, /P2-MB1-ATTACHMENT/);
    assert.match(r.output, /attachments\.identityField deve ser "storage_key"/);
    assert.match(r.output, /attachments\.urlAsIdentity deve ser false/);
  });

  test('MB1-13b anexo sem tenant reprova', () => {
    const r = rodarCom(
      mutar((c) => {
        c.attachments.model.tenantScoped = false;
        c.attachments.model.fields = c.attachments.model.fields.filter((f) => f.name !== 'cliente_id');
      })
    );
    assert.equal(r.status, 1);
    assert.match(r.output, /P2-MB1-ATTACHMENT/);
    assert.match(r.output, /attachments\.model\.tenantScoped deve ser true/);
    assert.match(r.output, /attachments\.model\.fields não declara: cliente_id/);
  });

  test('MB1-13c anexo com binário no PostgreSQL reprova', () => {
    const r = rodarCom(mutar((c) => { c.attachments.binaryInDatabase = true; }));
    assert.equal(r.status, 1);
    assert.match(r.output, /attachments\.binaryInDatabase deve ser false/);
  });

  test('MB1-14 AuditLog sem tenant reprova', () => {
    const r = rodarCom(
      mutar((c) => {
        c.audit.auditLogModel.tenantScoped = false;
        c.audit.auditLogModel.fields = c.audit.auditLogModel.fields.filter((f) => f.name !== 'cliente_id');
      })
    );
    assert.equal(r.status, 1);
    assert.match(r.output, /P2-MB1-AUDIT/);
    assert.match(r.output, /auditLogModel\.tenantScoped deve ser true/);
    assert.match(r.output, /auditLogModel\.fields não declara: cliente_id/);
  });

  test('MB1-14b cliente_id opcional no AuditLog reprova', () => {
    const r = rodarCom(
      mutar((c) => {
        const campo = c.audit.auditLogModel.fields.find((f) => f.name === 'cliente_id');
        campo.required = false;
      })
    );
    assert.equal(r.status, 1);
    assert.match(r.output, /P2-MB1-AUDIT/);
    assert.match(r.output, /cliente_id\.required deve ser true/);
  });

  test('MB1-15 ator de auditoria vindo do body reprova', () => {
    const r = rodarCom(
      mutar((c) => {
        c.audit.actorSource = 'body';
        c.audit.forbiddenActorSources = ['query', 'params'];
      })
    );
    assert.equal(r.status, 1);
    assert.match(r.output, /P2-MB1-AUDIT/);
    assert.match(r.output, /audit\.actorSource deve ser "auth_context"/);
    assert.match(r.output, /forbiddenActorSources não declara: body/);
  });

  test('MB1-15b segredo permitido no payload de auditoria reprova', () => {
    const r = rodarCom(
      mutar((c) => {
        c.audit.forbiddenPayloadContent = ['conteudo_binario'];
      })
    );
    assert.equal(r.status, 1);
    assert.match(r.output, /forbiddenPayloadContent não declara: senha, credencial, segredo/);
  });

  test('MB1-16 código de erro mínimo ausente reprova', () => {
    const r = rodarCom(
      mutar((c) => {
        c.errorCodes = c.errorCodes.filter((e) => e.code !== 'TENANT_SCOPE_VIOLATION');
      })
    );
    assert.equal(r.status, 1);
    assert.match(r.output, /P2-MB1-CONTRACT-SHAPE/);
    assert.match(r.output, /errorCodes não declara: TENANT_SCOPE_VIOLATION/);
  });

  test('MB1-16b código de erro sem status HTTP de erro reprova', () => {
    const r = rodarCom(
      mutar((c) => {
        c.errorCodes.find((e) => e.code === 'SEQUENCE_CONFLICT').http = 200;
      })
    );
    assert.equal(r.status, 1);
    assert.match(r.output, /SEQUENCE_CONFLICT\.http deve ser status HTTP de erro/);
  });

  test('MB1-17 padrão proibido ausente reprova', () => {
    const r = rodarCom(
      mutar((c) => {
        c.prohibitedPatterns = c.prohibitedPatterns.filter(
          (p) => p.id !== 'max_plus_one_numbering' && p.id !== 'client_supplied_primary_id'
        );
      })
    );
    assert.equal(r.status, 1);
    assert.match(r.output, /P2-MB1-PROHIBITED/);
    assert.match(r.output, /prohibitedPatterns não declara: max_plus_one_numbering, client_supplied_primary_id/);
  });

  test('MB1-17b padrão proibido sem descrição reprova', () => {
    const r = rodarCom(
      mutar((c) => {
        c.prohibitedPatterns.find((p) => p.id === 'base44_contract_in_backend').description = '';
      })
    );
    assert.equal(r.status, 1);
    assert.match(r.output, /P2-MB1-PROHIBITED/);
    assert.match(r.output, /precisa de \{id, description\}/);
  });

  test('MB1-18 handoff da P3 incompleto reprova', () => {
    const r = rodarCom(
      mutar((c) => {
        c.p3Handoff.creates = c.p3Handoff.creates.filter((x) => x !== 'AuditLog' && x !== 'RegistroAnexo');
        c.p3Handoff.gates = ['gate:tenancy'];
        c.p3Handoff.operational = [];
      })
    );
    assert.equal(r.status, 1);
    assert.match(r.output, /P2-MB1-HANDOFF/);
    assert.match(r.output, /p3Handoff\.creates não declara: AuditLog, RegistroAnexo/);
    assert.match(r.output, /p3Handoff\.gates não declara: gate:indices/);
    assert.match(r.output, /p3Handoff\.operational não declara: health-check, migrations-versionadas/);
  });

  test('MB1-18b handoff autorizando a P3 dentro da P2 reprova', () => {
    const r = rodarCom(mutar((c) => { c.p3Handoff.authorizedInP2 = true; }));
    assert.equal(r.status, 1);
    assert.match(r.output, /P2-MB1-HANDOFF/);
    assert.match(r.output, /authorizedInP2 deve ser false/);
  });

  test('MB1-19 gate não reescreve arquivo inválido', () => {
    const dir = makeTempDir('maike-mb1-');
    try {
      const invalido = JSON.stringify(mutar((c) => { c.tenancy.tenantSource = 'body'; }), null, 2) + '\n';
      writeFile(dir, CONTRATO, invalido);
      const antes = readFileSync(join(dir, CONTRATO), 'utf8');

      const r = runGate(GATE, { cwd: dir });
      assert.equal(r.status, 1);
      // O gate declara explicitamente que não tem modo de correção.
      assert.match(r.output, /não existe --update, baseline nem correção automática/);

      const depois = readFileSync(join(dir, CONTRATO), 'utf8');
      assert.equal(depois, antes, 'o gate não pode reescrever o contrato');
      assert.equal(depois, invalido, 'o conteúdo precisa continuar byte a byte igual');

      // Nem mesmo com uma flag de correção passada de propósito.
      const comFlag = runGate(GATE, { cwd: dir, args: ['--update'] });
      assert.equal(comFlag.status, 1);
      assert.equal(readFileSync(join(dir, CONTRATO), 'utf8'), invalido);
    } finally {
      cleanup(dir);
    }
  });

  test('MB1-20 contrato real do repositório passa', () => {
    const r = runGate(GATE, { cwd: REPO_ROOT });
    assert.equal(r.status, 0, r.output);
    assert.match(r.output, /PASSOU/);
    assert.match(r.output, /8 códigos de erro/);
    assert.match(r.output, /10 padrões proibidos/);
  });

  test('MB1-20b o contrato real declara identidade e handoff coerentes', () => {
    const c = contratoReal();
    assert.equal(c.identity.prismaGenerator, 'cuid()');
    assert.equal(c.identity.clientSupplied, false);
    assert.equal(c.tenancy.rootModel, 'Cliente');
    assert.deepEqual(c.tenancy.modelsWithoutTenantField, ['Cliente']);
    assert.deepEqual(c.tenancy.globalCatalogModels, []);
    assert.equal(c.p3Handoff.authorizedInP2, false);
    assert.equal(c.p3Handoff.domainMigrationStartsIn, 'P4');
  });
});
