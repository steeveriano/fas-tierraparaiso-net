# FAS tierraparaiso.net — Captive Portal

## Propósito
Servidor de autenticación externa (FAS) para el portal cautivo WiFi de El Edén Hotel Resort y propiedades del ecosistema tierraparaiso.net. Implementa protocolo WiFiDog para integración con Ruijie Cloud.

## Stack
- Node.js 20 + Express
- Protocolo: WiFiDog
- Deploy: Docker en VPS Vultr São Paulo (216.238.125.237)
- Proxy: Traefik v2.11 con SSL Let's Encrypt
- URL producción: https://wifi.tierraparaiso.net

## Flujo WiFiDog
1. Huésped conecta al WiFi
2. Reyee intercepta y redirige a: https://wifi.tierraparaiso.net/portal?gw_address=X&gw_port=X&gw_id=X&mac=X&ip=X&url=X
3. FAS muestra página de bienvenida
4. Huésped ingresa número WhatsApp
5. FAS envía OTP vía GHL WhatsApp
6. Huésped verifica OTP
7. FAS notifica al gateway: http://gw_address:gw_port/wifidog/auth?token=X
8. Gateway concede acceso a internet
9. Lead registrado en Supabase + GHL

## Arquitectura del ecosistema (contexto)
- sales.tierraparaiso.net — Identity Provider único del ecosistema (React/Vite/Netlify)
- op.tierraparaiso.net — App operativa (React/Vite/Netlify)
- Supabase proyecto compartido: ducujnpbkikfylwzylet (São Paulo)
- El FAS NO crea usuarios en Supabase — registra sesiones WiFi en tabla separada
- El FAS NO interactúa con sales ni op directamente

## Tabla Supabase que usará el FAS
- Nombre: wifi_sessions
- Campos: id, mac, ip, gw_id, whatsapp, token, authorized_at, created_at
- Esta tabla aún no existe — debe crearse antes del primer deploy real

## Zonas del hotel (gw_id por router)
- eden-lobby
- eden-piscina
- eden-restaurante
- eden-habitaciones
- eden-zona1 (completar con nombres reales)

## Integraciones
- GHL WhatsApp OTP (GoHighLevel)
- Supabase (proyecto ducujnpbkikfylwzylet, São Paulo)
- GHL CRM (agente Emma)

## Variables de entorno requeridas
PORT=3000
NODE_ENV=production
SUPABASE_URL=
SUPABASE_SERVICE_KEY=
GHL_API_KEY=
GHL_LOCATION_ID=
GHL_WHATSAPP_NUMBER=

## Deploy
ssh root@216.238.125.237
cd /opt/tierraparaiso
git -C fas pull
docker restart fas

## Reglas de marca
- NUNCA usar "TierraParaíso" sola
- Usar tierraparaiso.net en contexto operativo
- El hotel se llama "El Edén Hotel Resort" (con tilde)

## Restricciones críticas
- El FAS nunca almacena contraseñas
- El número WhatsApp es el identificador del lead
- Un token WiFiDog es válido por sesión, no reutilizable
- NUNCA hacer deploy sin validar que el contenedor arranca correctamente
- NUNCA declarar funcionalidad como "done" sin prueba real en producción

## gstack (recommended)

This project uses [gstack](https://github.com/garrytan/gstack) for AI-assisted workflows.
Install it for the best experience:

```bash
git clone --depth 1 https://github.com/garrytan/gstack.git ~/.claude/skills/gstack
cd ~/.claude/skills/gstack && ./setup --team
```

Skills like /qa, /ship, /review, /investigate, and /browse become available after install.
Use /browse for all web browsing. Use ~/.claude/skills/gstack/... for gstack file paths.
