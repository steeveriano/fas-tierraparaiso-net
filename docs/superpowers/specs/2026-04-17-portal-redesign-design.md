# FAS Portal Cautivo — Diseño Completo
*Fecha: 2026-04-17*

## Resumen

Rediseño completo del captive portal WiFi de El Edén Hotel Resort. El servidor FAS (Free Authentication Server) implementa el protocolo WiFiDog para routers Reyee/Ruijie, con autenticación por OTP vía WhatsApp de GHL, registro en Supabase y captura de leads en GHL CRM.

---

## Visual

### Estilo: "Tierra Cálida"
- **Fondo**: Video MP4 local (descargado de Vimeo `1175995970`) servido desde `/public/background.mp4`. Fallback a `piscina-noche.jpg` si el video falla.
- **Overlay**: Gradiente sutil `rgba(0,0,0,0.2)` arriba → `rgba(0,0,0,0.5)` abajo
- **Card**: Panel flotante pegado al fondo de pantalla, `border-radius: 24px 24px 0 0`, fondo `rgba(250,246,238,0.97)` con `backdrop-filter: blur(12px)`
- **Paleta**: Tierra cálida — crema `#faf6ee`, verde oscuro `#2d5a3d`, dorado `#d4af37`, marrón `#3d2b1f`
- **Tipografía**: System sans-serif para UI, Georgia serif para el nombre del hotel

### Logos (ambos pasos)
- **tierraparaiso.net**: `https://tierraparaiso.net/assets/logo-CrwWEQjs.png` — `h-28px`
- **El Edén Hotel Resort**: `logo-eden.png` copiado de sales, servido desde `/public/logo-eden.png` — `h-32px`
- Separados por línea vertical `#c5b596`

### Badge de zona (top-left)
Texto dinámico según `gw_id` del query param:
```
eden-lobby       → 🏨 Lobby
eden-piscina     → 🏊 Piscina
eden-restaurante → 🍽 Restaurante
eden-habitaciones → 🛏 Habitaciones
(default)        → 📶 WiFi El Edén
```

---

## Flujo de pantallas

### Paso 1 — Ingreso (`GET /portal`)
Recibe: `gw_address`, `gw_port`, `gw_id`, `mac`, `ip`, `url`

Muestra:
- Logos + nombre del hotel + ubicación ("Santa Elena · Valle del Cauca")
- Label "Tu número de WhatsApp"
- Input con prefijo `🇨🇴 +57` fijo (colombiano)
- Botón verde: "Enviar código por WhatsApp" con ícono WhatsApp
- Footer: "Acceso WiFi cortesía de tierraparaiso.net"

Acción: `POST /send-otp` con `{ whatsapp, gw_address, gw_port, gw_id, mac, ip }`

### Paso 2 — Verificación OTP (`/portal` con estado OTP)
Muestra:
- Mismos logos
- Subtítulo: "Código enviado a +57 3XX XXX XXXX"
- 6 cajas PIN individuales (tipo OTP estilo bancario)
- Countdown reenvío (60s)
- Botón "Verificar y conectarme"
- Link "← Cambiar número"

Acción: `POST /verify` con `{ whatsapp, otp, gw_address, gw_port, gw_id, mac, ip, token }`

### Paso 3 — Éxito
Card con checkmark verde, mensaje "¡Bienvenido a El Edén!" y countdown de redirección automática al gateway (3s).

---

## Arquitectura backend

### Endpoints

| Método | Ruta | Descripción |
|--------|------|-------------|
| `GET` | `/portal` | Página principal del portal |
| `POST` | `/send-otp` | Genera OTP, lo envía vía GHL WhatsApp |
| `POST` | `/verify` | Valida OTP, autoriza en gateway, registra en Supabase + GHL |
| `GET` | `/health` | `{ status: "ok", ts: ISO }` |

### Generación de OTP
- 6 dígitos aleatorios con `crypto.randomInt`
- Almacenados en memoria (Map) con TTL de 5 minutos: `Map<whatsapp, { otp, expires, gw_address, gw_port, gw_id, mac, ip }>`
- Un solo OTP activo por número — reemplaza el anterior si se reenvía

### Token WiFiDog
- Generado con `crypto.randomUUID()` al momento de verificación exitosa
- Notificación al gateway: `GET http://{gw_address}:{gw_port}/wifidog/auth?token={token}`
- No se reutiliza

### Integración GHL — WhatsApp OTP
- `POST https://services.leadconnectorhq.com/conversations/messages`
- Headers: `Authorization: Bearer {GHL_API_KEY}`, `Version: 2021-04-15`
- Body: `{ type: "WhatsApp", message: "Tu código WiFi de El Edén es: {otp}. Válido por 5 minutos.", contactId: "{ghl_contact_id}" }`
- Flujo: primero upsert del contacto para obtener `contactId`, luego envío del mensaje
- Requiere: `GHL_API_KEY`, `GHL_LOCATION_ID`, `GHL_WHATSAPP_NUMBER`

### Integración Supabase — tabla `wifi_sessions`
Al verificar exitosamente, `INSERT` en `wifi_sessions`:
```
id (uuid), mac, ip, gw_id, whatsapp, token, authorized_at, created_at
```

### Integración GHL — CRM Contact
`POST /contacts/upsert` con `phone: whatsapp` para crear/actualizar contacto.
Tag automático: `wifi-eden`.

---

## Assets estáticos

Servidos desde `/public/`:
- `background.mp4` — video descargado de Vimeo 1175995970 (MP4, optimizado, ≤10 MB)
- `piscina-noche.jpg` — copiado de `salestierraparaisonet/src/assets/piscina-noche.jpg`
- `logo-eden.png` — copiado de `salestierraparaisonet/src/assets/logo-eden.png`

---

## Variables de entorno

```
PORT=3000
NODE_ENV=production
GHL_API_KEY=
GHL_LOCATION_ID=              # ID de la sub-cuenta GHL de El Edén
GHL_WHATSAPP_NUMBER=          # número desde el que GHL envía (formato E.164)
SUPABASE_URL=
SUPABASE_SERVICE_KEY=
```

> Twilio eliminado del stack — GHL maneja tanto OTP WhatsApp como CRM.

---

## Estructura de archivos

```
fas-tierraparaiso-net/
├── index.js          # servidor Express (único archivo)
├── public/
│   ├── background.mp4
│   ├── piscina-noche.jpg
│   └── logo-eden.png
├── .env.example
├── .gitignore
├── package.json
└── README.md
```

Todo el servidor en un solo `index.js` con Express. Sin frameworks de plantillas — HTML inline con template literals.

---

## Restricciones confirmadas
- El FAS nunca almacena contraseñas
- OTP válido 5 minutos, en memoria (se pierde al reiniciar — aceptable para WiFi)
- Token WiFiDog válido por sesión, no reutilizable
- El número WhatsApp colombiano siempre lleva prefijo `+57`
- `logo-eden.png` se carga desde assets locales del proyecto sales, NO desde URL externa
