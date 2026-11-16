# Écarts de cotes — Winamax · Unibet · Betclic

Application web locale qui repère les **écarts de cotes** entre Winamax, Unibet et Betclic pour une même sélection, afin de trouver les cotes mal ajustées (value). Aucune analyse sportive : uniquement les cotes.

Les cotes sont lues sur les pages publiques de **Flashscore.fr** (onglet « Cotes » de chaque match), via un vrai navigateur sans interface (Playwright). Les sites des books ne sont jamais consultés.

## Fonctionnalités

| Onglet | Ce qu'il fait |
|---|---|
| **Écarts** | Toutes les sélections triées par écart (meilleure cote ÷ moins bonne − 1). Meilleure cote en vert, moins bonne en rouge, cote juste, value, variation depuis le scan précédent, historique (📈), export CSV. |
| **Value** | Sélections où la meilleure cote dépasse la *cote juste* (consensus des 3 books, marge retirée) + mise conseillée (Kelly fractionné sur ta bankroll). |
| **Surebets** | Combinaisons « meilleure cote de chaque issue chez des books différents » dont la somme des 1/cote est < 1 (gain garanti), avec répartition des mises. Les quasi-surebets sont aussi listés. |
| **Mouvements** | Plus grosses variations entre la cote d'ouverture et la cote actuelle, par book (repère les books en retard d'ajustement). |
| **Books** | Marge moyenne / TRJ de chaque book sur le résultat du match et part des sélections où il propose la meilleure cote. |
| **Journal** | Suivi de tes paris : bénéfice, ROI, taux de réussite, **CLV** (cote prise vs cote de clôture). Le bouton ＋ pré-remplit depuis les écarts. |
| **Chat** | Discussion avec Claude, qui voit le dernier scan (écarts, value, surebets, marges, mouvements) et ton journal. |
| **Réglages** | Sports, jour (aujourd'hui / demain / après-demain), nombre de matchs, **scan automatique**, seuil d'**alerte** (notifications navigateur), bankroll, fraction de Kelly. |

Marchés comparés (temps réglementaire) : 1N2 / Vainqueur, Remboursé si nul, Double chance, Les 2 équipes marquent, Plus/Moins. Sports : football, tennis, basket, hockey, rugby, handball, volley.

## Installation

Il faut **Node.js 18+** (https://nodejs.org).

```bash
npm install
npx playwright install chromium    # télécharge le navigateur utilisé pour lire Flashscore
cp .env.example .env               # puis colle ta clé ANTHROPIC_API_KEY dans .env (pour le chat)
npm start
```

Ouvre ensuite **http://localhost:3000** et clique sur « Lancer un scan ».

> ⚠️ **Lance l'app depuis une connexion française.** Flashscore n'affiche que les books autorisés dans le pays de connexion : hors de France (ou via un VPN étranger), Winamax n'apparaît pas. L'app affiche un bandeau si un des 3 books manque.

La clé API n'est nécessaire que pour l'onglet Chat (tout le reste fonctionne sans). Elle se crée sur https://console.anthropic.com.

## Comment lire les chiffres

- **Écart %** = meilleure cote / moins bonne cote − 1 pour la même sélection.
- **Cote juste** : pour chaque book on retire sa marge (normalisation des probabilités du marché), puis on fait la moyenne des books → 1 / probabilité.
- **Value %** = meilleure cote × probabilité juste − 1. Positive = la cote paie plus que le consensus du marché.
- **Surebet** : somme des 1/meilleure cote < 1.
- **CLV** = cote prise / cote de clôture − 1 : sur le long terme, battre la cote de clôture est le meilleur indicateur.

Un gros écart n'est pas toujours une erreur : un book peut avoir intégré une info (blessure, compo) avant les autres, ou ne pas avoir encore mis à jour. **Vérifie toujours la cote sur le site du book avant de parier**, les cotes Flashscore peuvent avoir quelques minutes de retard.

## Structure

```
src/server.js     API Express + scan automatique + alertes
src/scraper.js    Lecture des cotes Flashscore (Playwright)
src/analysis.js   Écarts, cote juste, value, surebets, marges, mouvements
src/chat.js       Chat avec Claude (API Anthropic, réponses en streaming)
src/store.js      Stockage local (data/db.json)
public/           Interface (HTML/CSS/JS sans framework)
test/             Tests des calculs (npm test)
```

Variables optionnelles : `PORT`, `CLAUDE_MODEL` (défaut `claude-opus-5-5`), `CLAUDE_EFFORT` (défaut `low`), `HTTPS_PROXY`, `CHROMIUM_PATH`.

## Bon à savoir

- Le scan ouvre une page par match (3 en parallèle par défaut) : compte ~1 à 2 s par match. Reste raisonnable sur le nombre de matchs et la fréquence du scan automatique.
- Si Flashscore change la structure de ses pages, la lecture des cotes peut casser : le fichier à adapter est `src/scraper.js`.
- Jeu responsable : fixe-toi une bankroll et des limites. Les books français peuvent limiter les comptes qui prennent systématiquement les meilleures cotes.
