# TanàImmo – Test technique (Développeur Web React)

## Partie 1 – Revue de code et correction de bugs

### Extrait A – Composant React de liste d'annonces
| # | Problème | Gravité | Correction proposée |
|---|----------|---------|----------------------|
| 1 | `useEffect` sans tableau de dépendances : l'effet se relance à **chaque re-render**, et comme il déclenche `setLoading`/`setListings` (donc un re-render), cela crée une **boucle infinie de requêtes** vers l'API | Critique | Ajouter `[city]` comme tableau de dépendances pour ne relancer le fetch que lorsque `city` change |
| 2 | Aucune gestion d'erreur sur le `fetch` : pas de `.catch`, pas de vérification de `r.ok`. Si l'API renvoie une erreur (4xx/5xx) ou est indisponible, l'exception est silencieuse et **`loading` reste bloqué à `true` indéfiniment** | Élevée | Ajouter un `.catch`, vérifier `r.ok` avant `r.json()`, et remettre `loading` à `false` + afficher un état d'erreur dans tous les cas (bloc `finally` ou state d'erreur dédié) |
| 3 | Pas de `key` sur les éléments `<li>` de la liste générée par `.map()` | Moyenne | Ajouter `key={l.id}` sur chaque `<li>` |
| 4 | `l.price.toLocaleString()` plante si `price` est `null`/`undefined` (annonce sans prix renseigné, par ex. terrain à négocier) | Moyenne | Vérifier la présence de `price` avant l'appel, ou utiliser un fallback (`l.price?.toLocaleString() ?? "Prix sur demande"`) |
| 5 | Aucun état vide géré : si `listings` est vide après chargement, rien n'est affiché à l'utilisateur, qui peut penser que l'app est cassée | Faible | Ajouter un message du type « Aucune annonce trouvée » quand `listings.length === 0` |

**Point le plus critique dans le contexte du client** (pics de trafic lors des campagnes SMS) : le problème #1 (boucle infinie de fetch) est particulièrement dangereux ici — il peut à lui seul surcharger l'API dès qu'un composant `ListingList` est monté, amplifiant la charge pile au moment où le client s'attend à des pics de trafic.

### Extrait B – Route API de recherche d'annonces (Express + PostgreSQL)

*(code corrigé livré : `partie 1/listings-route.js`)*

| # | Problème | Gravité | Correction proposée |
|---|----------|---------|----------------------|
| 1 | **Injection SQL** : `city` est interpolé directement dans la requête (`'${city}'`) au lieu d'être passé en paramètre lié | Critique | Utiliser une requête paramétrée : `WHERE city = $1` avec `[city]` |
| 2 | **N+1 queries** : pour chaque annonce retournée, 2 requêtes supplémentaires sont exécutées en boucle et **séquentiellement** (`await` dans un `for`). Avec des pics de trafic et beaucoup de résultats, ça multiplie le temps de réponse et sature la connexion à la base | Critique | Remplacer par des requêtes groupées (`WHERE agency_id = ANY($1)` et `WHERE listing_id = ANY($1)`) exécutées une seule fois chacune, puis recomposer les données en mémoire |
| 3 | **Pas de pagination** : le paramètre `page` est extrait mais jamais utilisé. La requête retourne potentiellement toutes les annonces d'une ville sans `LIMIT`/`OFFSET` | Élevée | Ajouter `LIMIT`/`OFFSET` (ou pagination par curseur) basés sur `page`, avec une taille de page fixe et validée |
| 4 | **Aucune gestion d'erreur** : pas de `try/catch`. Si `db.query` échoue (timeout, connexion perdue, etc.), la requête reste sans réponse ou plante le process | Élevée | Envelopper dans un `try/catch`, retourner un `500` propre en cas d'échec, logger l'erreur sans exposer de détails sensibles au client |
| 5 | `row.agency = await db.query(...)` assigne le **résultat brut de la requête** (objet `{rows: [...]}` avec `pg`) et non la ligne elle-même | Moyenne | Extraire correctement la donnée, ex. `.rows[0]` pour l'agence et `.rows.map(p => p.url)` pour les photos |
| 6 | Aucune validation de `city` (présence, type, longueur) avant utilisation | Faible | Valider `city` en entrée (obligatoire ou non, chaîne, longueur raisonnable) et rejeter avec un `400` si invalide |
| 7 | `SELECT *` renvoie potentiellement des colonnes internes/sensibles au client | Faible | Sélectionner explicitement les colonnes nécessaires à l'affichage public |

**Point le plus critique dans le contexte du client** : les problèmes #1 (injection SQL) et #2 (N+1 queries) sont les plus graves — l'injection SQL est une faille de sécurité exploitable, et le N+1 est ce qui fera s'effondrer les temps de réponse dès les premiers pics de trafic des campagnes SMS.


### Extrait C – Webhook de confirmation de paiement

*(code corrigé livré : `partie 1/webhook-payment.js`)*

| # | Problème | Gravité | Correction proposée |
|---|----------|---------|----------------------|
| 1 | **Temps de traitement trop long avant la réponse** : `db.query` + `sendEmail` + `crm.notifyPayment` (2 à 8 secondes à lui seul) sont tous `await`és avant `res.status(200)`. Le total peut dépasser les 10 secondes tolérées par le prestataire → celui-ci considère l'appel en échec et **réessaie**, ce qui déclenche un traitement en double | Critique | Répondre `200` dès que l'opération critique (mise à jour du booking) est faite, et exécuter l'envoi d'email et la notification CRM en tâche de fond (fire-and-forget), sans bloquer la réponse |
| 2 | **Aucune vérification de signature** : n'importe qui connaissant l'URL peut poster un faux événement `payment.succeeded` et faire passer une réservation à "payée" sans paiement réel | Critique | Vérifier la signature HMAC envoyée par le prestataire (en-tête dédié) avant tout traitement, avec le secret lu depuis une variable d'environnement |
| 3 | **Pas d'idempotence** : comme le prestataire peut réessayer jusqu'à 5 fois, le même événement peut être traité plusieurs fois → email de confirmation envoyé plusieurs fois, notification CRM dupliquée | Élevée | Stocker les `event.id` déjà traités (en mémoire ici) et court-circuiter le traitement si l'événement a déjà été vu |
| 4 | **Aucune gestion d'erreur** : pas de `try/catch`. Si `db.query`, `sendEmail` ou `crm.notifyPayment` lève une exception, la requête ne répond jamais proprement (erreur non gérée), ce qui provoque aussi des réessais côté prestataire | Élevée | Envelopper l'opération critique (mise à jour DB) dans un `try/catch` ; pour les opérations non critiques (email, CRM), capturer les erreurs sans les laisser remonter et bloquer la réponse |
| 5 | `event.booking_id` n'est jamais vérifié : si aucune réservation ne correspond, l'`UPDATE` ne touche silencieusement aucune ligne (0 row affected) mais la route répond quand même `200` | Moyenne | Vérifier le nombre de lignes affectées (`RETURNING id` ou `rowCount`) et logger une alerte si aucune réservation ne correspond |
| 6 | **Couplage fort avec un service tiers lent** : l'appel `crm.notifyPayment` (2-8s, hors du contrôle de TanàImmo) est sur le chemin critique. Si le CRM du client est lent ou en panne, ça bloque/fait échouer toute la confirmation de paiement | Élevée | Découpler la notification CRM du chemin critique (traitement asynchrone), avec éventuellement une file de retry dédiée côté serveur si l'échec doit être rattrapé plus tard |

**Point le plus critique** : les problèmes #1 et #3 se renforcent l'un l'autre — un traitement trop lent déclenche des réessais du prestataire, et sans idempotence, chaque réessai relance intégralement le traitement (emails et notifications CRM en double). C'est le scénario le plus probable de « facture envoyée 3 fois au client » en production.


## Partie 2 – Intégration du connecteur CRM

*(fichiers livrés : `partie 2/crmClient.js`, `partie 2/__tests__/crmClient.test.js`)*

### Choix de conception

- **Timeout** : chaque tentative est bornée à 5s via `AbortController`, pour ne jamais laisser une requête traînante bloquer l'appelant.
- **Idempotence** : une clé (`crypto.randomUUID()`) est générée **une seule fois par appel à `createLead`**, avant la première tentative, et réutilisée sur tous les réessais (envoyée en en-tête `Idempotency-Key`). Ainsi, même si le CRM reçoit la requête plusieurs fois, il peut détecter le doublon côté serveur et ne jamais créer deux fois le même lead.
- **Distinction erreurs définitives / temporaires** :
  - `400` et `401` → erreurs définitives, **aucun réessai** (réessayer une requête invalide ou mal authentifiée ne changera rien).
  - `429`, `500/502/503`, timeout ou absence de réponse → erreurs temporaires, **réessai avec backoff**.
- **Backoff** : exponentiel avec jitter par défaut ; si le CRM renvoie `429` avec un en-tête `Retry-After`, ce délai est prioritaire et respecté tel quel.
- **Nombre max de tentatives** : 3 (1 tentative initiale + 2 réessais), pour rester dans un temps de réponse raisonnable même en cas de pic de trafic.
- **Sécurité du token** : le token est lu depuis `process.env.CRM_API_TOKEN`, n'est jamais inclus dans un message d'erreur ni dans un log — seules des erreurs génériques ("Authentification CRM refusée") sont produites.

### Comment lancer les tests

```bash
npm install --save-dev jest
npx jest
```

Deux tests demandés sont couverts (`429 puis succès` et `500 trois fois puis abandon`). Je me suis limité à ces deux-là, faute de temps.

## Partie 3 – Gestion d'incident

### 3.1 – Scénario (vendredi 21h40, taux d'erreurs 5xx à 35 %)

**0–2 min : Vérification.** Je confirme l'alerte sur le dashboard de monitoring (taux 5xx, latence P95/P99, requêtes/s par endpoint) et je croise avec les logs pour identifier quel(s) endpoint(s) sont touchés et depuis quand exactement.

**2–5 min : Hypothèse.** Le pic coïncide avec le lancement de la campagne SMS à 21h30. Mon hypothèse principale est que l'extrait B (`/api/listings`) est en production : son pattern N+1 non paginé s'effondre sous la charge, sature les connexions PostgreSQL et fait grimper la latence à 9s. Je vérifie le nombre de connexions DB actives/en attente pour confirmer.

**5–15 min : Mitigation immédiate (sans attendre la confirmation définitive de la cause).** Je commence par les actions les plus rapides à appliquer sans déploiement : forcer une pagination stricte et désactiver temporairement l'enrichissement non essentiel (agences/photos) via un feature flag ou une variable de config, pour réduire immédiatement la pression sur la DB. Si un auto-scaling est déjà en place, je vérifie qu'il se déclenche ; sinon, un scaling horizontal manuel est trop lent pour ces 30 minutes et je m'appuie sur les mitigations de configuration en priorité.

**~10–15 min : Communication client.** Dès que j'ai une hypothèse solide et une action de mitigation en cours (pas besoin d'avoir tout résolu) : « On a identifié le point chaud (surcharge base de données sur la recherche d'annonces), un correctif de mitigation est en cours de déploiement, prochain point dans 5 minutes. »

**15–20 min : Déploiement et premier retour.** Je déploie la mitigation et j'observe les premiers signaux (taux d'erreur, latence). Je redonne un point au client à ce stade, même si le signal n'est encore que partiel : « Le taux d'erreurs redescend, on continue à surveiller avant de confirmer que c'est stabilisé. »

**20–30 min : Surveillance continue.** Je ne déclare pas la situation stabilisée sur un seul point de mesure : un taux d'erreur qui redescend une fois peut remonter. Je continue à surveiller sur cette fenêtre avant tout message définitif au client.

**Le lendemain (une fois la situation réellement stabilisée, généralement après encore 15-30 min d'observation continue) :** post-mortem écrit et correctif définitif (cf. Partie 1).

*(Ce point mériterait d'être développé — rédigé rapidement en fin de temps imparti.)*

### 3.2 – Alertes à mettre en place avant le lancement

- **Taux d'erreurs 5xx > 1 % sur 5 min glissantes** → Datadog Monitor (ou Grafana + Alertmanager), notification Slack + email.
- **Latence P95 > 2 s sur 5 min** → même outil de monitoring APM, notification Slack.
- **Connexions PostgreSQL actives > 80 % du pool** → monitoring DB dédié (ex. Datadog Database Monitoring), notification Slack.
- **Échecs définitifs du connecteur CRM (après épuisement des réessais) > 5 sur 10 min** → alerting sur logs structurés (ex. Datadog Log Monitor), notification Slack dédiée à l'équipe technique.
