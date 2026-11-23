#!/usr/bin/env node
/**
 * D-PROD-277 — Qual é o próximo número de decisão LIVRE?
 *
 * Olha dois lugares e devolve o maior:
 *   1. o marcador `<!-- Próxima decisão: D-PROD-NNN -->` do DECISIONS.md da `origin/main`;
 *   2. os títulos das PRs ABERTAS do repositório: um D-PROD-NNN que já aparece num título está reservado.
 *
 * Uso (regra A5 de docs/constitution/08-REGRAS-DE-IA.md): rodar ANTES de abrir a PR / escrever a decisão
 * e DE NOVO antes do merge. Se o número mudou, renumerar só aquele momento.
 *
 *   node scripts/dev/proxima-decisao.mjs            # imprime "D-PROD-NNN" e o motivo
 *   node scripts/dev/proxima-decisao.mjs --sem-prs  # só o marcador da main (sem consultar o GitHub)
 *
 * Só leitura: não grava nada. Sem rede (ou sem `gh`), avisa e usa só o marcador.
 */
import { execFileSync } from "node:child_process";

const REPO = process.env.MAIKE_REPO || "maikelimaadm-stack/MAIKE";
const semPrs = process.argv.includes("--sem-prs");

const rodar = (cmd, args) => execFileSync(cmd, args, { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], maxBuffer: 64 * 1024 * 1024 });

export function numeroDoMarcador(texto) {
  const achados = [...String(texto).matchAll(/<!--\s*Próxima decisão:\s*D-PROD-(\d+)\s*-->/g)];
  if (achados.length !== 1) throw new Error(`esperado 1 marcador "Próxima decisão" no DECISIONS.md, achei ${achados.length}`);
  return Number(achados[0][1]);
}

export function numerosDosTitulos(titulos) {
  const nums = [];
  for (const t of titulos) for (const m of String(t).matchAll(/D-PROD-(\d+)/g)) nums.push(Number(m[1]));
  return nums;
}

export function proximaLivre(marcador, reservados) {
  let n = marcador;
  const usados = new Set(reservados);
  while (usados.has(n)) n += 1;
  return n;
}

function main() {
  try { rodar("git", ["fetch", "origin", "main", "-q"]); } catch { console.error("aviso: não consegui atualizar a origin/main; usando a cópia local"); }
  const decisions = rodar("git", ["show", "origin/main:docs/engineering/DECISIONS.md"]);
  const marcador = numeroDoMarcador(decisions);

  let titulos = [];
  if (!semPrs) {
    try {
      const out = rodar("gh", ["api", "-X", "GET", "search/issues", "-f", `q=repo:${REPO} is:pr is:open`, "--jq", ".items[] | \"#\\(.number) \\(.title)\""]);
      titulos = out.split("\n").filter(Boolean);
    } catch {
      console.error("aviso: não consegui ler as PRs abertas (sem rede ou sem gh); conferindo só o marcador");
    }
  }
  const reservados = numerosDosTitulos(titulos).filter((n) => n >= marcador);
  const livre = proximaLivre(marcador, reservados);

  console.log(`D-PROD-${livre}`);
  console.error(`marcador da main: D-PROD-${marcador}`);
  for (const t of titulos) if (numerosDosTitulos([t]).some((n) => n >= marcador)) console.error(`reservado por PR aberta: ${t}`);
  if (livre !== marcador) console.error(`o marcador está reservado; use D-PROD-${livre}`);
}

if (import.meta.url === `file://${process.argv[1]}`) main();
