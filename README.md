# TanàImmo — Test technique

Test technique réalisé pour le poste de **Développeur Web React**.

## Objectif

Ce projet présente mon analyse et mes corrections sur plusieurs problématiques de développement web autour de l'application TanàImmo :

* revue de code React ;
* sécurisation et optimisation d'une API Express/PostgreSQL ;
* sécurisation et fiabilisation d'un webhook de paiement ;
* intégration d'un connecteur CRM robuste ;
* gestion des erreurs, timeouts et retries ;
* analyse d'un incident de production ;
* proposition d'alertes de monitoring.

---

## Structure du projet

```text
.
├── partie 1/
│   ├── listings-route.js
│   └── webhook-payment.js
│
├── partie 2/
│   ├── crmClient.js
│   └── __tests__/
│       └── crmClient.test.js
│
├── partie 3/
│   └── ...
│
├── .env.example
├── .gitignore
├── README.md
└── RESPONSES.md
```

---

# Partie 1 — Revue de code

La première partie porte sur trois problématiques principales.

### A — Composant React

Les principaux problèmes identifiés sont :

* `useEffect` sans tableau de dépendances, provoquant des requêtes répétées ;
* absence de gestion correcte des erreurs du `fetch` ;
* absence de `key` sur les éléments générés avec `.map()` ;
* risque d'erreur lorsque `price` est absent ;
* absence d'état vide lorsque aucune annonce n'est trouvée.

Le problème le plus critique dans le contexte des pics de trafic est la boucle de requêtes provoquée par le `useEffect`.

### B — Route API

Les principaux problèmes traités sont :

* injection SQL ;
* requêtes N+1 ;
* absence de pagination effective ;
* absence de gestion d'erreur ;
* mauvaise exploitation du résultat des requêtes PostgreSQL ;
* validation insuffisante de `city` ;
* utilisation de `SELECT *`.

Les corrections utilisent notamment des requêtes paramétrées, des requêtes groupées et une pagination côté serveur.

### C — Webhook de paiement

Les principaux points corrigés sont :

* réponse trop tardive au prestataire de paiement ;
* absence de vérification de signature ;
* absence d'idempotence ;
* absence de gestion d'erreur ;
* absence de vérification de l'existence de la réservation ;
* couplage du traitement critique avec le CRM.

L'objectif est notamment d'éviter les traitements en double lorsqu'un prestataire réessaie l'envoi d'un événement.

---

# Partie 2 — Connecteur CRM

Le connecteur CRM prend en compte plusieurs mécanismes de robustesse :

* timeout de **5 secondes** par tentative ;
* clé d'idempotence générée une seule fois par appel ;
* distinction entre erreurs définitives et temporaires ;
* retries avec backoff exponentiel et jitter ;
* prise en compte de `Retry-After` pour les réponses `429` ;
* maximum de **3 tentatives** ;
* token CRM récupéré depuis `process.env.CRM_API_TOKEN` et non exposé dans les logs.

Les erreurs `400` et `401` ne sont pas réessayées, tandis que les erreurs `429`, `500`, `502`, `503`, les timeouts et l'absence de réponse peuvent entraîner un retry.

## Tests

Les deux tests demandés sont couverts :

1. `429` puis succès ;
2. `500` trois fois puis abandon.

Je me suis limité à ces deux tests demandés, faute de temps.

Pour lancer les tests :

```bash
npm install
npx jest
```

---

# Partie 3 — Gestion d'incident

Le scénario étudié concerne une situation de production avec un taux d'erreurs `5xx` de **35 %** pendant une campagne SMS.

La stratégie proposée suit plusieurs étapes :

1. vérifier les métriques et les logs ;
2. formuler une hypothèse ;
3. appliquer une mitigation sans attendre d'avoir la confirmation définitive de la cause ;
4. communiquer régulièrement avec le client ;
5. surveiller les métriques après mitigation ;
6. réaliser ensuite un post-mortem et un correctif définitif.

La mitigation privilégie les actions rapidement applicables, notamment la pagination stricte et la désactivation temporaire de l'enrichissement non essentiel.

## Monitoring

Les alertes proposées couvrent notamment :

* taux d'erreurs `5xx` ;
* latence P95 ;
* saturation du pool de connexions PostgreSQL ;
* échecs définitifs du connecteur CRM après épuisement des retries.

Les notifications proposées utilisent Slack et/ou email selon le type d'alerte.

---

# Variables d'environnement

Les variables sensibles ne sont pas stockées directement dans le code.

Un fichier `.env.example` est fourni afin d'indiquer les variables nécessaires à la configuration du projet sans contenir les valeurs secrètes réelles.

Exemple :

```env
CRM_API_TOKEN=
PAYMENT_WEBHOOK_SECRET=

```

# Temps passé

**Environ 2 heures.**

Ce temps comprend l'analyse du sujet, les corrections, l'implémentation, les tests ainsi que la rédaction et la relecture des réponses.

---

# Documents

* `README.md` — présentation et synthèse du projet.
* `RESPONSES.md` — réponses détaillées aux différentes parties du test.
* `.env.example` — exemple de configuration sans secret réel.

---

# Remarque

Certaines décisions de la partie 3 reposent sur les hypothèses précisées dans le scénario du test, notamment concernant les outils de monitoring et les possibilités de mitigation disponibles.

Les choix et hypothèses détaillés sont présentés dans `RESPONSES.md`.
