# App Android e iOS (Capacitor)

O MAIKE roda como app nativo pelo Capacitor 8: o mesmo frontend (`dist/`) vai empacotado dentro do app, então ele **abre sem internet**. Os dados continuam vindo da API de produção.

## Configuração

- `capacitor.config.json`: `appId` `com.makgestao.app`, nome "MAK Gestão", `webDir` `dist`.
- Projetos nativos: `android/` e `ios/` (gerados por `npx cap add`). O que é gerado em build (`android/app/src/main/assets/public`, `android/**/build`, `ios/App/App/public`, `ios/App/Pods`) fica fora do Git.
- Origens do app no backend: `https://localhost` (Android) e `capacitor://localhost` (iOS) precisam estar em `FRONTEND_ORIGINS` na Vercel. Sem isso, o CORS responde 404 e o app não loga.

## APK assinado pelo GitHub (caminho normal)

O workflow `.github/workflows/app-android.yml` gera o APK já assinado com a chave fixa e publica numa Release `app-vX.Y.Z` do GitHub. Para baixar: aba **Releases** do repositório → a versão mais nova → `MAK-Gestao-X.Y.Z.apk`.

- Roda sozinho quando `app-version.json` muda na `main`, ou à mão em Actions → app-android → Run workflow.
- Nunca sobrescreve uma versão publicada: versão nova = subir `versionName` e `versionCode`.
- Só publica se o APK estiver assinado com o certificado da chave fixa (impressão digital SHA-256 no próprio workflow).
- Segredos do repositório (Settings → Secrets and variables → Actions): `MAKGESTAO_KEYSTORE_BASE64` (o `.jks` em base64), `MAKGESTAO_KEYSTORE_PASSWORD` e `VITE_GOOGLE_MAPS_API_KEY`.

## Gerar o APK de teste à mão (Android)

Pré-requisitos: Node 22+, JDK 21 e Android SDK (plataforma 36, build-tools 36) com `ANDROID_HOME` apontando para ele.

Variáveis de build (não versionar; R4):

- `VITE_MAIKE_API_URL=https://www.makgestao.com`: só a origem (o app acrescenta `/api/native`). Dentro do app (Capacitor) vale sempre esta URL, e não a origem da página (`https://localhost`), regra em `src/config/runtimeConfig.js`;
- `VITE_GOOGLE_MAPS_API_KEY`: a mesma chave do site (satélite).

## Versão e assinatura

- A versão fica em `app-version.json` (`versionName` e `versionCode`). A cada versão nova, suba os dois; o `versionCode` só cresce.
- O APK de uso é assinado com a chave fixa `makgestao-release.jks` (alias `makgestao`). A chave e a senha **nunca** entram no repositório: vêm de `MAKGESTAO_KEYSTORE` (caminho do arquivo) e `MAKGESTAO_KEYSTORE_PASSWORD`. Perder a chave obriga a desinstalar o app em todos os aparelhos.

```bash
npm run app:build
```

```bash
cd android && ./gradlew assembleRelease
```

O APK sai em `android/app/build/outputs/apk/release/app-release.apk` e instala por arquivo no Android, por cima da versão anterior assinada com a mesma chave.

## iOS

`npm run app:build` atualiza `ios/`. O build do iOS (IPA) só roda num Mac com Xcode: abrir `ios/App/App.xcworkspace`, escolher a equipe de assinatura e rodar no aparelho ou exportar.

## Permissões

- Android (`AndroidManifest.xml`): internet, localização (GPS do mapa: ponto, área e "onde estou") e câmera (fotos dos formulários). O Android pergunta na primeira vez que a função é usada.
- iOS (`Info.plist`): textos de localização, câmera e fotos.
- Permissão nova é mudança nativa: exige APK novo (não vai pela atualização automática).

## Login (D-PROD-289)

- No app o login fica guardado no aparelho até a pessoa tocar em "Sair" (a opção "Manter conectado" não aparece: vale sempre).
- Com internet, o app troca o login por um novo de 30 dias (`POST /auth/renovar`). Quem abre o app ao menos uma vez a cada 30 dias com internet não precisa entrar de novo.
- Suspender a conta, trocar a senha ou o papel derruba a sessão do app na próxima vez que ele falar com o servidor.

## Sem internet (D-PROD-289)

- **Baixar dados:** depois do primeiro login no app aparece "Dados para usar sem internet" → "Baixar agora". Baixa mapa, áreas, lotes, cadastros e as telas já abertas. Com internet, o app atualiza sozinho a cada 6 h; o menu do usuário → "Dados sem internet" baixa ou atualiza quando quiser.
- **Abre:** telas, código e ícones estão dentro do app, e o login guardado vale (aviso "Sem internet — mostrando dados salvos").
- **Mapa:** sem internet, fundo liso local com áreas, pontos e lotes por cima. Satélite sem internet não existe (licença do Google).
- **Mostra:** tudo o que foi baixado ou visto com internet (leituras guardadas no aparelho, por fazenda).
- **Quando a rede volta:** o app confere o login no servidor sozinho.
- **Ainda precisa de internet:** o primeiro login e **gravar** (lançar, editar, excluir). Registrar sem internet e enviar depois é a próxima etapa.
