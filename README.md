# VoKalia

VoKalia est un espace de communautés pour discuter par écrit ou en vocal. Ce premier lot Web reprend la direction Studio Vocal et s’adapte au bureau comme au téléphone.

- Créer un serveur avec une bannière, des mots-clés et des catégories de salons.
- Découvrir les serveurs publics ou rejoindre un serveur privé par invitation. Un nouveau serveur est privé par défaut.
- Écrire dans un salon ou envoyer un message privé à un membre connecté.
- Voir les membres en ligne sur le serveur, avec une seule entrée par compte, même avec plusieurs onglets.
- Rejoindre un salon vocal avec le micro coupé au départ, quand le service audio est configuré.

## Ouvrir le projet en local

Dans le dossier du dépôt `VoKalia`, utilise Node.js 22.12 ou plus récent.

```sh
npm ci
npm run dev
```

Vite affiche l’adresse à ouvrir. L’écran d’accueil est disponible dès ce stade. Pour accéder à l’espace connecté, configure Supabase et Google.

## Raccorder Supabase

1. Dans le [SQL Editor du projet VoKalia](https://supabase.com/dashboard/project/rntlvolklgwxrwdgzowo/sql/new), ouvre une nouvelle requête, colle le contenu de [supabase/setup.sql](supabase/setup.sql) et clique sur **Run**. Ce script initialise les tables et les règles d’accès en une transaction. Exécute-le une seule fois.
2. Copie `.env.example` dans `.env.local` et renseigne `VITE_SUPABASE_PUBLISHABLE_KEY` avec la clé publique `sb_publishable_…` du projet. Le code Web est distribué aux navigateurs, donc garde les clés administrateur et les jetons personnels hors de ce fichier.
3. Active le fournisseur Google dans Supabase Auth. Dans Google Cloud, configure l’URL de rappel fournie par Supabase. Dans la [configuration des URL de Supabase Auth](https://supabase.com/dashboard/project/rntlvolklgwxrwdgzowo/auth/url-configuration), autorise l’adresse exacte de l’application avec sa barre oblique finale, par exemple `http://localhost:5173/`. Redémarre Vite après avoir ajouté la clé publique. [Procédure Google](https://supabase.com/docs/guides/auth/social-sign-in/auth-google) · [URL de redirection](https://supabase.com/docs/guides/auth/redirect-urls)

La base exige une adresse e-mail confirmée. Après une coupure brutale, la présence expire en 65 secondes et la liste se rafraîchit toutes les 10 secondes.

## Activer le vocal Web

La fonction [voice-token](supabase/functions/voice-token/index.ts) vérifie la session Supabase et l’accès au salon avant d’émettre un jeton LiveKit limité à ce salon et au micro. Depuis le dépôt, déploie-la avec `supabase functions deploy voice-token --project-ref rntlvolklgwxrwdgzowo` une fois le CLI authentifié. Renseigne `LIVEKIT_URL` (URL `wss://`), `LIVEKIT_API_KEY`, `LIVEKIT_API_SECRET` et `VK_WEB_ORIGINS` dans les secrets de la fonction. Pour `VK_WEB_ORIGINS`, donne les origines autorisées, séparées par des virgules, sans chemin ni barre oblique finale. Passe ensuite `VITE_VOICE_ENABLED` à `true` et redémarre ou reconstruis le Web. [Secrets Edge Functions](https://supabase.com/docs/guides/functions/secrets) · [Jetons LiveKit](https://docs.livekit.io/home/server/generating-tokens/)

## Vérifier

```sh
npm test
npm run build
```

Les tests exécutent le script dans PostgreSQL embarqué et vérifient les accès avec plusieurs identités. La connexion Google hébergée et un appel réel restent à tester après configuration. Le client Android et la vérification du vocal écran verrouillé restent à réaliser.
