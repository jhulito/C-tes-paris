#!/bin/bash
cd "$(dirname "$0")"
if ! command -v node >/dev/null 2>&1; then
  echo "Node.js n'est pas installé. Télécharge la version LTS sur https://nodejs.org puis relance ce fichier."
  open https://nodejs.org
  read -p "Appuie sur Entrée pour fermer."
  exit 1
fi
if [ ! -d node_modules ]; then
  echo "Première installation, patiente 1 à 2 minutes..."
  npm install && npx playwright install chromium || { read -p "Erreur. Appuie sur Entrée."; exit 1; }
fi
[ -f .env ] || cp .env.example .env
echo
echo "Laisse cette fenêtre ouverte tant que tu utilises l'app (le Mac ne se mettra pas en veille)."
caffeinate -i node src/server.js
