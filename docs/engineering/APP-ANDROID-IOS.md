# App Android e iOS (Capacitor)

O MAIKE roda como app nativo pelo Capacitor 8: o mesmo frontend (`dist/`) vai empacotado dentro do app, então ele **abre sem internet**. Os dados continuam vindo da API de produção.

## Configuração

- `capacitor.config.json`: `appId` `com.makgestao.app`, nome "MAK Gestão", `webDir` `dist`.
- Projetos nativos: `android/` e `ios/` (gerados por `npx cap add`). O que é gerado em build (`android/app/src/main/assets/public`, `android/**/build`, `ios/App/App/public`, `ios/App/Pods`) fica fora do Git.
- Origens do app no backend: `https://localhost` (Android) e `capacitor://localhost` (iOS) precisam estar em `FRONTEND_ORIGINS` na Vercel. Sem isso, o CORS responde 404 e o app não loga.

## Gerar o APK de teste (Android)

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

## Sem internet

- Abre: telas, código e ícones estão dentro do app.
- Mostra: os dados do mapa já guardados no aparelho (`mapaCacheService`, IndexedDB).
- Precisa de internet: o primeiro login, satélite de áreas nunca abertas e gravar no servidor.
