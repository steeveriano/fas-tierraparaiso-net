#!/usr/bin/env bash
# deploy.sh — FAS tierraparaiso.net → VPS Vultr São Paulo
# Uso: bash deploy.sh
# Requisitos: ssh-key configurada para root@216.238.125.237

set -euo pipefail

VPS="root@216.238.125.237"
REMOTE_DIR="/opt/tierraparaiso/fas"
LOCAL_DIR="$(cd "$(dirname "$0")" && pwd)"

echo "▶ Deploying FAS → $VPS:$REMOTE_DIR"

# ── 1. Crear estructura remota si no existe ───────────────────────────
ssh "$VPS" "mkdir -p $REMOTE_DIR/public"

# ── 2. Copiar archivos de aplicación ─────────────────────────────────
echo "▶ Copiando archivos..."
scp "$LOCAL_DIR/index.js"           "$VPS:$REMOTE_DIR/"
scp "$LOCAL_DIR/package.json"       "$VPS:$REMOTE_DIR/"
scp "$LOCAL_DIR/package-lock.json"  "$VPS:$REMOTE_DIR/"

# ── 3. Copiar assets estáticos (sin background.mp4 — ver nota) ───────
scp "$LOCAL_DIR/public/logo-tp.png"        "$VPS:$REMOTE_DIR/public/"
scp "$LOCAL_DIR/public/logo-eden.png"      "$VPS:$REMOTE_DIR/public/"
scp "$LOCAL_DIR/public/piscina-noche.jpg"  "$VPS:$REMOTE_DIR/public/"

# ── 4. Instalar dependencias en el servidor ───────────────────────────
echo "▶ Instalando dependencias (npm ci)..."
ssh "$VPS" "cd $REMOTE_DIR && npm ci --omit=dev"

# ── 5. Reiniciar contenedor ───────────────────────────────────────────
echo "▶ Reiniciando contenedor fas..."
ssh "$VPS" "docker restart fas"

# ── 6. Verificar que el contenedor quedó healthy ──────────────────────
echo "▶ Verificando /health..."
sleep 3
ssh "$VPS" "curl -sf http://localhost:3000/health || (echo 'ERROR: /health falló' && exit 1)"

echo ""
echo "✓ Deploy completo. Verifica en producción:"
echo "  https://wifi.tierraparaiso.net/health"

# ─────────────────────────────────────────────────────────────────────
# NOTA — background.mp4 (video de fondo):
#   El video NO está en el repo (gitignored por tamaño).
#   Si es la primera vez que se despliega, súbelo manualmente:
#
#     scp /ruta/local/background.mp4 root@216.238.125.237:/opt/tierraparaiso/fas/public/
#
#   Si ya está en el servidor, este script NO lo sobreescribe.
# ─────────────────────────────────────────────────────────────────────
