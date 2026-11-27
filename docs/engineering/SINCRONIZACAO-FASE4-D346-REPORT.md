# Relatório: sincronização, Fase 4, aviso com o app fechado (D-PROD-346)

**Data:** 2026-11-27 · **Branch:** `claude/nifty-feynman-rh0kdn` · **Decisão:** [D-PROD-346](./DECISIONS.md) · **APK:** 1.0.5 (código 6)

## Pedido

O proprietário pediu a Fase 4 do plano de sincronização: "Quero continue", "Não pare". Antes de pedir, ele perguntou se não bastava atualizar a versão. A resposta foi não: esta fase precisa de uma parte nativa nova, que a atualização automática não troca.

## O que mudou

| Onde | Mudança |
|---|---|
| `android/app/src/main/java/com/makgestao/app/AvisoDeEnvioPlugin.java` (novo) | Plugin `AvisoDeEnvio`: `definirPendentes` (agenda ou cancela o trabalho de 15 min, só com internet) e `pedirPermissao` (avisos no Android 13+). Registra o último uso do app |
| `android/app/src/main/java/com/makgestao/app/AvisoDeEnvioWorker.java` (novo) | Com pendências e o app fora de uso há 10 min ou mais, mostra um aviso que abre o app. Nunca envia nada sozinho |
| `MainActivity.java` · `AndroidManifest.xml` · `android/app/build.gradle` | Registro do plugin, permissão `POST_NOTIFICATIONS` e `androidx.work:work-runtime` |
| `src/lib/app/avisoDeEnvio.js` (novo) · `src/components/offline/DadosOffline.jsx` | Informa ao plugin o que ainda não chegou ao servidor, quando muda. Só com o plugin presente |
| `src/lib/offline/sincronizacao/gatilhosDeSincronizacao.js` | Ao sair do app (`pause`), o que espera envio tenta já |
| `app-version.json` · `scripts/app/versao-do-pacote.mjs` · `docs/engineering/APP-ANDROID-IOS.md` | 1.0.5 (código 6) com `nativoMinimo: 5`: o APK 1.0.4 continua recebendo a atualização automática |

## Verificação

- `tests/smoke/avisoDeEnvioD346.test.js`, AE-01 a AE-04:
  - a quantidade vai ao plugin só quando muda, e a permissão é pedida na primeira pendência;
  - sem o plugin, nada acontece;
  - `nativoMinimo` é 5;
  - a parte nativa: plugin registrado, permissão, trabalho só com internet, aviso que abre o app e não toca de novo.
- `test:smoke`: 4660 de 4660.
- Gates passam.
- **A compilação do APK não roda neste ambiente**, porque ele não tem as ferramentas do Android. O workflow `app-android` compila e assina o APK na PR e confere a assinatura; o merge só acontece com ele verde. Ao mergear, o workflow publica a release `app-v1.0.5`.

## Como fica no celular

1. Baixar e instalar o APK 1.0.5 por cima do 1.0.4. Os dados continuam.
2. Na primeira vez que algo ficar esperando envio, o Android pergunta se o app pode mostrar avisos. Responder **Permitir**.
3. Com o app fechado e registros esperando, quando houver internet aparece "Registros esperando envio". O toque abre o app, que envia.

Quem continuar no 1.0.4 recebe tudo o resto pela atualização automática, só sem o aviso.

## O que ficou para depois

- **Enviar de verdade com o app fechado:** exigiria duplicar as filas na parte nativa.
- **iPhone:** sem o plugin, nada muda nele.
