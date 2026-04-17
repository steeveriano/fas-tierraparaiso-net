# FAS — tierraparaiso.net Captive Portal

Servidor de autenticación externa (FAS) para el portal cautivo WiFi de El Edén Hotel Resort. Protocolo WiFiDog + OTP WhatsApp via GHL.

## Requisitos

- Node.js 20+
- Cuenta GHL con WhatsApp conectado
- Proyecto Supabase con tabla `wifi_sessions`
- Video `public/background.mp4` (ver abajo)

## Setup

```bash
cp .env.example .env
# Rellenar variables en .env
npm install
```

## Video de fondo

El video no está en el repo. Descargarlo manualmente de Vimeo ID `1175995970` y guardarlo como `public/background.mp4` (preferir 720p MP4, ≤10 MB).

Si yt-dlp está disponible:
```bash
yt-dlp "https://vimeo.com/1175995970" -f "bestvideo[ext=mp4][height<=720]" -o "public/background.mp4"
```

## Tabla Supabase

Ejecutar en el SQL Editor de Supabase:

```sql
CREATE TABLE wifi_sessions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  mac text NOT NULL,
  ip text NOT NULL,
  gw_id text NOT NULL,
  whatsapp text NOT NULL,
  token text NOT NULL,
  authorized_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
```

## Desarrollo local

```bash
npm run dev
# Portal en: http://localhost:3000/portal?gw_address=127.0.0.1&gw_port=2060&gw_id=eden-piscina&mac=AA:BB:CC:00:00:01&ip=192.168.1.100&url=https://google.com
```

## Deploy (VPS Vultr)

```bash
ssh root@216.238.125.237
cd /opt/tierraparaiso
git -C fas pull
docker restart fas
```

## Variables de entorno

| Variable | Descripción |
|----------|-------------|
| `PORT` | Puerto del servidor (default: 3000) |
| `GHL_API_KEY` | API key de GoHighLevel |
| `GHL_LOCATION_ID` | ID de la sub-cuenta GHL de El Edén |
| `GHL_WHATSAPP_NUMBER` | Número WhatsApp conectado en GHL (E.164) |
| `SUPABASE_URL` | URL del proyecto Supabase |
| `SUPABASE_SERVICE_KEY` | Service role key de Supabase |

## Endpoints

| Método | Ruta | Descripción |
|--------|------|-------------|
| GET | `/portal` | Página del captive portal |
| POST | `/send-otp` | Envía OTP por WhatsApp via GHL |
| POST | `/verify` | Valida OTP, autoriza en gateway |
| GET | `/health` | Estado del servidor |
