# FAS Portal Cautivo — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Construir el FAS completo para el captive portal WiFi de El Edén Hotel Resort — diseño "Tierra Cálida" con video de fondo local, OTP vía GHL WhatsApp, registro en Supabase y captura de leads en GHL CRM.

**Architecture:** Servidor Express single-file (`index.js`) que sirve portal HTML con template literals, gestiona OTPs en memoria (Map con TTL 5 min), notifica al gateway WiFiDog, registra sesiones en Supabase y envía WhatsApp vía API GHL v2. Assets estáticos servidos desde `/public`.

**Tech Stack:** Node.js 20, Express 4, @supabase/supabase-js, dotenv, fetch nativo (Node 20)

---

## Estructura de archivos

```
fas-tierraparaiso-net/
├── index.js                  ← servidor Express completo (reescritura total)
├── public/
│   ├── background.mp4        ← video descargado de Vimeo 1175995970
│   ├── piscina-noche.jpg     ← copiado de salestierraparaisonet/src/assets/
│   ├── logo-eden.png         ← copiado de salestierraparaisonet/src/assets/
│   └── logo-tp.png           ← descargado de tierraparaiso.net CDN
├── .env.example
├── .gitignore
├── package.json              ← agregar dependencias
└── README.md
```

---

## Task 1: Setup — dependencias y archivos de configuración

**Files:**
- Modify: `package.json`
- Create: `.gitignore`
- Create: `.env.example`

- [ ] **Step 1: Actualizar package.json con dependencias**

Reemplazar el contenido de `package.json`:

```json
{
  "name": "fas-tierraparaiso",
  "version": "1.0.0",
  "main": "index.js",
  "scripts": {
    "start": "node index.js",
    "dev": "node --watch index.js"
  },
  "dependencies": {
    "@supabase/supabase-js": "^2.45.0",
    "dotenv": "^16.4.0",
    "express": "^4.18.0"
  }
}
```

- [ ] **Step 2: Instalar dependencias**

```bash
npm install
```

Esperado: se crea/actualiza `node_modules/` y `package-lock.json`.

- [ ] **Step 3: Crear .gitignore**

```
node_modules/
.env
public/background.mp4
```

> `background.mp4` se excluye del repo por peso (~5 MB). Se documenta en README cómo obtenerlo.

- [ ] **Step 4: Crear .env.example**

```
PORT=3000
NODE_ENV=production

# GHL (GoHighLevel)
GHL_API_KEY=
GHL_LOCATION_ID=
GHL_WHATSAPP_NUMBER=

# Supabase
SUPABASE_URL=
SUPABASE_SERVICE_KEY=
```

- [ ] **Step 5: Commit**

```bash
git add package.json package-lock.json .gitignore .env.example
git commit -m "chore: dependencias y archivos de configuración"
```

---

## Task 2: Assets estáticos

**Files:**
- Create: `public/piscina-noche.jpg`
- Create: `public/logo-eden.png`
- Create: `public/logo-tp.png`
- Create: `public/background.mp4` (manual — ver instrucciones)

- [ ] **Step 1: Crear directorio public**

```bash
mkdir -p public
```

- [ ] **Step 2: Copiar assets desde proyecto sales**

```bash
cp /home/steeve/salestierraparaisonet/src/assets/piscina-noche.jpg public/
cp /home/steeve/salestierraparaisonet/src/assets/logo-eden.png public/
```

- [ ] **Step 3: Descargar logo de tierraparaiso.net**

```bash
curl -L "https://tierraparaiso.net/assets/logo-CrwWEQjs.png" -o public/logo-tp.png
```

Esperado: archivo `public/logo-tp.png` de ~10-50 KB.

- [ ] **Step 4: Obtener video de fondo (Vimeo 1175995970)**

Opción A — con yt-dlp (si disponible):
```bash
yt-dlp "https://vimeo.com/1175995970" -f "bestvideo[ext=mp4][height<=720]" -o "public/background.mp4"
```

Opción B — descarga manual:
1. Abrir https://vimeo.com/1175995970 en el navegador
2. Usar extensión "Video DownloadHelper" o similar
3. Guardar como `public/background.mp4` (preferir 720p MP4, ≤10 MB)

Verificar que el archivo existe:
```bash
ls -lh public/background.mp4
```
Esperado: archivo MP4 entre 3 MB y 15 MB.

- [ ] **Step 5: Commit (sin el video)**

```bash
git add public/piscina-noche.jpg public/logo-eden.png public/logo-tp.png
git commit -m "feat: assets estáticos (logos e imagen de fallback)"
```

> `background.mp4` no se commitea — está en .gitignore.

---

## Task 3: Servidor Express — esqueleto y ruta /health

**Files:**
- Rewrite: `index.js`

- [ ] **Step 1: Reescribir index.js con esqueleto**

```js
require('dotenv').config();
const express = require('express');
const crypto = require('crypto');
const path = require('path');
const { createClient } = require('@supabase/supabase-js');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());
app.use('/public', express.static(path.join(__dirname, 'public')));

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

// OTP store en memoria: whatsapp (10 dígitos) → { otp, expires, gw_address, gw_port, gw_id, mac, ip }
const otpStore = new Map();
setInterval(() => {
  const now = Date.now();
  for (const [key, val] of otpStore) {
    if (val.expires < now) otpStore.delete(key);
  }
}, 60_000);

const ZONE_LABELS = {
  'eden-lobby':        '🏨 Lobby',
  'eden-piscina':      '🏊 Piscina',
  'eden-restaurante':  '🍽 Restaurante',
  'eden-habitaciones': '🛏 Habitaciones',
};

// ── Rutas (se implementan en tareas siguientes) ──────────────────────
// GET  /portal     → Task 4
// POST /send-otp   → Task 5
// POST /verify     → Task 6

// GET /health
app.get('/health', (_req, res) => {
  res.json({ status: 'ok', ts: new Date().toISOString() });
});

app.listen(PORT, () => console.log(`FAS corriendo en puerto ${PORT}`));
```

- [ ] **Step 2: Verificar que el servidor arranca**

```bash
node index.js
```

Esperado: `FAS corriendo en puerto 3000`

En otra terminal:
```bash
curl http://localhost:3000/health
```
Esperado: `{"status":"ok","ts":"2026-..."}"`

- [ ] **Step 3: Commit**

```bash
git add index.js
git commit -m "feat: esqueleto Express con /health"
```

---

## Task 4: Ruta GET /portal — HTML completo

**Files:**
- Modify: `index.js` — agregar función `portalHTML()` y ruta `GET /portal`

- [ ] **Step 1: Agregar función portalHTML() antes del app.listen**

Insertar la función `portalHTML` y la ruta en `index.js`. El bloque completo a agregar (antes de `app.listen`):

```js
// GET /portal — página principal del captive portal
app.get('/portal', (req, res) => {
  const {
    gw_address = '', gw_port = '', gw_id = '',
    mac = '', ip = '', url = ''
  } = req.query;
  const zoneBadge = ZONE_LABELS[gw_id] || '📶 WiFi El Edén';
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.send(portalHTML({ gw_address, gw_port, gw_id, mac, ip, url, zoneBadge }));
});

function portalHTML({ gw_address, gw_port, gw_id, mac, ip, url, zoneBadge }) {
  return `<!DOCTYPE html>
<html lang="es">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1,maximum-scale=1">
<title>WiFi El Edén Hotel Resort</title>
<style>
*,*::before,*::after{box-sizing:border-box;margin:0;padding:0}
:root{
  --cream:#faf6ee;--green:#2d5a3d;--green-dk:#1a3a2a;
  --gold:#d4af37;--brown:#3d2b1f;--brown-m:#6b5a3e;
  --brown-l:#8b7355;--border:#c5b596
}
html,body{height:100%;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;overflow:hidden}
.video-wrap{position:fixed;inset:0;z-index:0}
video.bg{width:100%;height:100%;object-fit:cover}
.video-wrap img.fallback{display:none;width:100%;height:100%;object-fit:cover;animation:kb 20s ease-in-out infinite alternate}
.overlay{position:absolute;inset:0;background:linear-gradient(to bottom,rgba(0,0,0,.2) 0%,rgba(0,0,0,.1) 40%,rgba(0,0,0,.55) 100%)}
@keyframes kb{from{transform:scale(1)}to{transform:scale(1.06)}}
.topbar{position:fixed;top:0;left:0;right:0;z-index:10;padding:16px 20px;display:flex;justify-content:space-between;align-items:center}
.badge{background:rgba(255,255,255,.15);backdrop-filter:blur(8px);border:1px solid rgba(255,255,255,.2);border-radius:20px;padding:5px 12px;font-size:11px;color:white;letter-spacing:.5px}
.badge.gold{background:rgba(212,175,55,.2);border-color:rgba(212,175,55,.4);color:#f0d060}
.card{position:fixed;bottom:0;left:0;right:0;z-index:10;background:rgba(250,246,238,.97);backdrop-filter:blur(16px);border-radius:24px 24px 0 0;padding:28px 24px 40px;display:flex;flex-direction:column;gap:18px;max-height:88vh;overflow-y:auto}
.logos{display:flex;align-items:center;justify-content:center;gap:14px}
.logo-tp{height:28px;width:auto;object-fit:contain}
.logo-div{width:1px;height:26px;background:var(--border)}
.logo-eden{height:32px;width:auto;object-fit:contain}
.hotel-name{font-size:16px;font-weight:600;color:var(--brown);font-family:Georgia,'Times New Roman',serif;text-align:center;line-height:1.3}
.hotel-loc{font-size:10px;color:var(--brown-l);letter-spacing:2px;text-transform:uppercase;text-align:center}
.divider{height:1px;background:linear-gradient(90deg,transparent,var(--border),transparent)}
.form-group{display:flex;flex-direction:column;gap:6px}
.form-label{font-size:10px;font-weight:700;color:var(--brown-m);letter-spacing:1.5px;text-transform:uppercase}
.input-wrap{display:flex;align-items:center;border:1.5px solid var(--border);border-radius:12px;overflow:hidden;background:white;transition:border-color .2s}
.input-wrap:focus-within{border-color:var(--green)}
.prefix{padding:12px 14px;font-size:14px;color:var(--brown-m);border-right:1px solid #e8dcc8;background:#f5f0e8;white-space:nowrap;font-weight:500;user-select:none}
.phone-input{flex:1;padding:12px;font-size:16px;color:var(--brown);border:none;outline:none;background:white;font-family:inherit}
.phone-input::placeholder{color:#bba98a}
.hint{font-size:11px;color:var(--brown-l)}
.otp-wrap{display:flex;gap:8px;justify-content:center}
.otp-box{width:46px;height:54px;border:2px solid var(--border);border-radius:10px;background:white;font-size:22px;font-weight:700;color:var(--brown);text-align:center;outline:none;transition:border-color .2s;caret-color:transparent}
.otp-box:focus{border-color:var(--green)}
.otp-box.filled{border-color:var(--green);background:#f0f7f3;color:var(--green)}
.btn{display:flex;align-items:center;justify-content:center;gap:10px;background:linear-gradient(135deg,var(--green),var(--green-dk));color:white;border:none;border-radius:12px;padding:15px;font-size:15px;font-weight:600;cursor:pointer;letter-spacing:.3px;transition:opacity .2s,transform .1s;font-family:inherit}
.btn:active{transform:scale(.98)}
.btn:disabled{opacity:.5;cursor:not-allowed}
.wa-icon{width:20px;height:20px;background:#25D366;border-radius:50%;display:flex;align-items:center;justify-content:center;font-size:12px;flex-shrink:0}
.action-row{display:flex;justify-content:space-between;font-size:12px;color:var(--brown-l)}
.action-link{background:none;border:none;cursor:pointer;font-size:12px;color:var(--brown-l);font-family:inherit;text-decoration:underline}
.action-link:hover{color:var(--green)}
.action-link:disabled{opacity:.4;cursor:not-allowed;text-decoration:none}
.footer-brand{font-size:10px;color:var(--brown-l);text-align:center;line-height:1.7}
.footer-brand strong{color:var(--brown-m)}
.info-box{background:rgba(45,90,61,.07);border:1px solid rgba(45,90,61,.15);border-radius:10px;padding:12px;font-size:12px;color:var(--brown-m);line-height:1.5}
.error-msg{font-size:12px;color:#c0392b;display:none}
.success-content{display:flex;flex-direction:column;align-items:center;gap:16px;padding:12px 0}
.checkmark{width:68px;height:68px;background:var(--green);border-radius:50%;display:flex;align-items:center;justify-content:center;font-size:30px;color:white}
.step{display:none;flex-direction:column;gap:18px}
.step.active{display:flex}
</style>
</head>
<body>

<div class="video-wrap">
  <video class="bg" autoplay muted loop playsinline
    onerror="this.style.display='none';this.nextElementSibling.style.display='block'">
    <source src="/public/background.mp4" type="video/mp4">
  </video>
  <img class="fallback" src="/public/piscina-noche.jpg" alt="">
  <div class="overlay"></div>
</div>

<div class="topbar">
  <span class="badge">📶 WiFi Gratis</span>
  <span class="badge gold">${zoneBadge}</span>
</div>

<div class="card">
  <div style="display:flex;flex-direction:column;align-items:center;gap:8px">
    <div class="logos">
      <img class="logo-tp" src="/public/logo-tp.png" alt="tierraparaiso.net"
        onerror="this.outerHTML='<span style=\\'font-size:12px;font-weight:700;color:#2d5a3d\\'>tierraparaiso.net</span>'">
      <div class="logo-div"></div>
      <img class="logo-eden" src="/public/logo-eden.png" alt="El Edén"
        onerror="this.outerHTML='<span style=\\'font-size:11px;font-weight:700;color:#2d5a3d;padding:4px 6px;background:#f5f0e8;border-radius:6px\\'>EL EDÉN</span>'">
    </div>
    <div class="hotel-name">El Edén Hotel Resort</div>
    <div class="hotel-loc">Santa Elena · Valle del Cauca</div>
  </div>

  <div class="divider"></div>

  <!-- PASO 1: WhatsApp -->
  <div class="step active" id="step1">
    <div class="form-group">
      <label class="form-label" for="phone">Tu número de WhatsApp</label>
      <div class="input-wrap">
        <div class="prefix">🇨🇴 +57</div>
        <input class="phone-input" id="phone" type="tel" inputmode="numeric"
          placeholder="300 000 0000" maxlength="10" autocomplete="tel">
      </div>
      <div class="error-msg" id="phoneError">Número inválido. Ingresa 10 dígitos colombianos.</div>
      <div class="hint">Recibirás un código de verificación por WhatsApp</div>
    </div>
    <button class="btn" id="btnSend" onclick="sendOtp()">
      <div class="wa-icon">💬</div>
      Enviar código por WhatsApp
    </button>
    <div class="footer-brand">
      Acceso WiFi cortesía de<br>
      <strong>tierraparaiso.net</strong> · Operador de El Edén Hotel Resort
    </div>
  </div>

  <!-- PASO 2: OTP -->
  <div class="step" id="step2">
    <div class="info-box">
      Código enviado a +57 <strong id="displayPhone"></strong> vía WhatsApp
    </div>
    <div class="form-group" style="align-items:center;gap:10px">
      <label class="form-label">Código de 6 dígitos</label>
      <div class="otp-wrap" id="otpWrap">
        <input class="otp-box" maxlength="1" inputmode="numeric" pattern="[0-9]">
        <input class="otp-box" maxlength="1" inputmode="numeric" pattern="[0-9]">
        <input class="otp-box" maxlength="1" inputmode="numeric" pattern="[0-9]">
        <input class="otp-box" maxlength="1" inputmode="numeric" pattern="[0-9]">
        <input class="otp-box" maxlength="1" inputmode="numeric" pattern="[0-9]">
        <input class="otp-box" maxlength="1" inputmode="numeric" pattern="[0-9]">
      </div>
      <div class="error-msg" id="otpError">Código incorrecto o expirado.</div>
      <div class="hint">El código expira en 5 minutos</div>
    </div>
    <button class="btn" id="btnVerify" onclick="verifyOtp()" disabled>
      ✓ Verificar y conectarme
    </button>
    <div class="action-row">
      <button class="action-link" onclick="goBack()">← Cambiar número</button>
      <button class="action-link" id="btnResend" onclick="resendOtp()" disabled>
        Reenviar (<span id="countdown">60</span>s)
      </button>
    </div>
    <div class="footer-brand">
      Acceso WiFi cortesía de<br>
      <strong>tierraparaiso.net</strong> · Operador de El Edén Hotel Resort
    </div>
  </div>

  <!-- PASO 3: Éxito -->
  <div class="step" id="step3">
    <div class="success-content">
      <div class="checkmark">✓</div>
      <div class="hotel-name">¡Bienvenido a El Edén!</div>
      <div class="hint" style="text-align:center">
        Ya tienes acceso a internet.<br>Redirigiendo en <span id="redirectCount">3</span> segundos…
      </div>
    </div>
    <div class="footer-brand">
      Acceso WiFi cortesía de<br>
      <strong>tierraparaiso.net</strong> · Operador de El Edén Hotel Resort
    </div>
  </div>
</div>

<script>
const GW={address:'${gw_address}',port:'${gw_port}',gw_id:'${gw_id}',mac:'${mac}',ip:'${ip}',url:'${url}'};
let currentPhone='',countdownTimer=null;

const boxes=document.querySelectorAll('.otp-box');
boxes.forEach((box,i)=>{
  box.addEventListener('input',e=>{
    const v=e.target.value.replace(/\\D/g,'');
    e.target.value=v;
    if(v&&i<boxes.length-1)boxes[i+1].focus();
    syncBoxClasses();checkVerifyBtn();
  });
  box.addEventListener('keydown',e=>{
    if(e.key==='Backspace'&&!e.target.value&&i>0){
      boxes[i-1].focus();boxes[i-1].value='';syncBoxClasses();checkVerifyBtn();
    }
  });
  box.addEventListener('paste',e=>{
    const p=e.clipboardData.getData('text').replace(/\\D/g,'').slice(0,6);
    if(p.length===6){boxes.forEach((b,j)=>{b.value=p[j]||'';});syncBoxClasses();checkVerifyBtn();boxes[5].focus();}
    e.preventDefault();
  });
});

function syncBoxClasses(){boxes.forEach(b=>b.classList.toggle('filled',b.value.length>0));}
function getOtp(){return Array.from(boxes).map(b=>b.value).join('');}
function checkVerifyBtn(){document.getElementById('btnVerify').disabled=getOtp().length!==6;}
function showStep(n){document.querySelectorAll('.step').forEach(s=>s.classList.remove('active'));document.getElementById('step'+n).classList.add('active');}
function goBack(){if(countdownTimer)clearInterval(countdownTimer);showStep(1);}

async function sendOtp(){
  const raw=document.getElementById('phone').value.replace(/\\D/g,'');
  const err=document.getElementById('phoneError');
  if(raw.length!==10){err.textContent='Número inválido. Ingresa 10 dígitos colombianos.';err.style.display='block';return;}
  err.style.display='none';
  currentPhone=raw;
  const btn=document.getElementById('btnSend');
  btn.disabled=true;btn.textContent='Enviando…';
  try{
    const res=await fetch('/send-otp',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({whatsapp:raw,...GW})});
    if(!res.ok)throw new Error(await res.text());
    document.getElementById('displayPhone').textContent=raw.replace(/(\\d{3})(\\d{3})(\\d{4})/,'$1 $2 $3');
    showStep(2);boxes[0].focus();startCountdown(60);
  }catch(e){
    err.textContent='Error al enviar. Intenta de nuevo.';err.style.display='block';
  }finally{
    btn.disabled=false;btn.innerHTML='<div class="wa-icon">💬</div> Enviar código por WhatsApp';
  }
}

async function verifyOtp(){
  const otp=getOtp();
  const err=document.getElementById('otpError');
  err.style.display='none';
  const btn=document.getElementById('btnVerify');
  btn.disabled=true;btn.textContent='Verificando…';
  try{
    const res=await fetch('/verify',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({whatsapp:currentPhone,otp,...GW})});
    const data=await res.json();
    if(!res.ok)throw new Error(data.error||'Error');
    if(countdownTimer)clearInterval(countdownTimer);
    showStep(3);
    let n=3;
    const t=setInterval(()=>{
      document.getElementById('redirectCount').textContent=--n;
      if(n<=0){clearInterval(t);window.location.href=data.redirect||GW.url||'https://www.google.com';}
    },1000);
  }catch(e){
    err.style.display='block';
    boxes.forEach(b=>{b.value='';b.classList.remove('filled');});
    boxes[0].focus();checkVerifyBtn();
  }finally{
    btn.textContent='✓ Verificar y conectarme';
  }
}

async function resendOtp(){
  const btn=document.getElementById('btnResend');
  btn.disabled=true;
  const raw=currentPhone;
  try{
    const res=await fetch('/send-otp',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({whatsapp:raw,...GW})});
    if(!res.ok)throw new Error();
    startCountdown(60);
  }catch(e){
    document.getElementById('otpError').textContent='Error al reenviar. Intenta de nuevo.';
    document.getElementById('otpError').style.display='block';
    btn.disabled=false;
  }
}

function startCountdown(s){
  if(countdownTimer)clearInterval(countdownTimer);
  const resendBtn=document.getElementById('btnResend');
  resendBtn.disabled=true;
  let t=s;
  document.getElementById('countdown').textContent=t;
  countdownTimer=setInterval(()=>{
    document.getElementById('countdown').textContent=--t;
    if(t<=0){clearInterval(countdownTimer);resendBtn.disabled=false;resendBtn.textContent='Reenviar código';}
  },1000);
}
</script>
</body>
</html>`;
}
```

- [ ] **Step 2: Verificar que /portal responde**

```bash
node index.js &
curl "http://localhost:3000/portal?gw_address=192.168.1.1&gw_port=2060&gw_id=eden-piscina&mac=AA:BB:CC:DD:EE:FF&ip=192.168.1.100&url=https://google.com" | head -20
```

Esperado: respuesta HTML con `<!DOCTYPE html>` y `El Edén Hotel Resort`.

```bash
kill %1
```

- [ ] **Step 3: Commit**

```bash
git add index.js
git commit -m "feat: GET /portal con HTML completo — diseño Tierra Cálida"
```

---

## Task 5: POST /send-otp — OTP + GHL WhatsApp

**Files:**
- Modify: `index.js` — agregar helpers GHL y ruta POST /send-otp

- [ ] **Step 1: Agregar helpers GHL en index.js (antes de las rutas)**

Agregar después de la definición de `ZONE_LABELS`:

```js
// ── GHL API helpers ──────────────────────────────────────────────────

async function ghlRequest(method, endpoint, body) {
  const res = await fetch(`https://services.leadconnectorhq.com${endpoint}`, {
    method,
    headers: {
      'Authorization': `Bearer ${process.env.GHL_API_KEY}`,
      'Content-Type': 'application/json',
      'Version': '2021-04-15',
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`GHL ${method} ${endpoint} → ${res.status}: ${text}`);
  }
  return res.json();
}

async function ghlUpsertContact(phone) {
  const data = await ghlRequest('POST', '/contacts/upsert', {
    locationId: process.env.GHL_LOCATION_ID,
    phone,
    source: 'WiFi El Edén',
  });
  return data.contact?.id ?? data.id;
}

async function ghlSendWhatsApp(contactId, message) {
  await ghlRequest('POST', '/conversations/messages', {
    type: 'WhatsApp',
    contactId,
    message,
  });
}

async function ghlAddTag(contactId, tag) {
  await ghlRequest('POST', `/contacts/${contactId}/tags`, { tags: [tag] });
}
```

- [ ] **Step 2: Agregar ruta POST /send-otp (antes de GET /portal)**

```js
// POST /send-otp
app.post('/send-otp', async (req, res) => {
  try {
    const { whatsapp, gw_address, gw_port, gw_id, mac, ip } = req.body;

    if (!whatsapp || !/^\d{10}$/.test(whatsapp)) {
      return res.status(400).json({ error: 'Número WhatsApp inválido' });
    }

    const otp = String(crypto.randomInt(100000, 999999));
    const phone = `+57${whatsapp}`;

    const contactId = await ghlUpsertContact(phone);
    await ghlSendWhatsApp(
      contactId,
      `Tu código WiFi de El Edén es: *${otp}*. Válido por 5 minutos. 📶`
    );

    otpStore.set(whatsapp, {
      otp,
      expires: Date.now() + 5 * 60 * 1000,
      gw_address,
      gw_port,
      gw_id,
      mac,
      ip,
    });

    res.json({ ok: true });
  } catch (err) {
    console.error('[send-otp]', err.message);
    res.status(500).json({ error: 'Error al enviar OTP' });
  }
});
```

- [ ] **Step 3: Commit**

```bash
git add index.js
git commit -m "feat: POST /send-otp con GHL WhatsApp y OTP en memoria"
```

---

## Task 6: POST /verify — validación, gateway, Supabase, GHL

**Files:**
- Modify: `index.js` — agregar ruta POST /verify

- [ ] **Step 1: Agregar ruta POST /verify (antes de GET /portal)**

```js
// POST /verify
app.post('/verify', async (req, res) => {
  try {
    const { whatsapp, otp, gw_address, gw_port, gw_id, mac, ip } = req.body;

    const stored = otpStore.get(whatsapp);
    if (!stored || stored.expires < Date.now()) {
      return res.status(400).json({ error: 'OTP expirado o no encontrado' });
    }
    if (stored.otp !== String(otp)) {
      return res.status(400).json({ error: 'OTP incorrecto' });
    }

    otpStore.delete(whatsapp);
    const token = crypto.randomUUID();
    const phone = `+57${whatsapp}`;

    // Notificar al gateway WiFiDog
    const gwUrl = `http://${gw_address}:${gw_port}/wifidog/auth?token=${token}`;
    await fetch(gwUrl).catch(err => console.error('[gateway]', err.message));

    // Registrar sesión en Supabase
    const { error: dbError } = await supabase.from('wifi_sessions').insert({
      mac,
      ip,
      gw_id,
      whatsapp: phone,
      token,
      authorized_at: new Date().toISOString(),
    });
    if (dbError) console.error('[supabase]', dbError.message);

    // Actualizar contacto en GHL con tag wifi-eden
    try {
      const contactId = await ghlUpsertContact(phone);
      await ghlAddTag(contactId, 'wifi-eden');
    } catch (ghlErr) {
      console.error('[ghl-tag]', ghlErr.message);
    }

    res.json({ ok: true, redirect: gwUrl });
  } catch (err) {
    console.error('[verify]', err.message);
    res.status(500).json({ error: 'Error al verificar OTP' });
  }
});
```

- [ ] **Step 2: Commit**

```bash
git add index.js
git commit -m "feat: POST /verify — gateway WiFiDog, Supabase, GHL tag"
```

---

## Task 7: README y verificación final

**Files:**
- Create: `README.md`

- [ ] **Step 1: Crear README.md**

```markdown
# FAS — tierraparaiso.net Captive Portal

Servidor de autenticación externa (FAS) para el portal cautivo WiFi de El Edén Hotel Resort. Protocolo WiFiDog + OTP WhatsApp via GHL.

## Requisitos

- Node.js 20+
- Cuenta GHL con WhatsApp conectado
- Proyecto Supabase con tabla `wifi_sessions`
- Video `public/background.mp4` (ver abajo)

## Setup

\`\`\`bash
cp .env.example .env
# Rellenar variables en .env
npm install
\`\`\`

## Video de fondo

El video no está en el repo. Descargarlo manualmente de Vimeo ID `1175995970` y guardarlo como `public/background.mp4` (preferir 720p MP4, ≤10 MB).

Si yt-dlp está disponible:
\`\`\`bash
yt-dlp "https://vimeo.com/1175995970" -f "bestvideo[ext=mp4][height<=720]" -o "public/background.mp4"
\`\`\`

## Tabla Supabase

Ejecutar en el SQL Editor de Supabase:

\`\`\`sql
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
\`\`\`

## Desarrollo local

\`\`\`bash
npm run dev
# Portal en: http://localhost:3000/portal?gw_address=127.0.0.1&gw_port=2060&gw_id=eden-piscina&mac=AA:BB:CC:00:00:01&ip=192.168.1.100&url=https://google.com
\`\`\`

## Deploy (VPS Vultr)

\`\`\`bash
ssh root@216.238.125.237
cd /opt/tierraparaiso
git -C fas pull
docker restart fas
\`\`\`

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
```

- [ ] **Step 2: Verificación smoke test completa**

Crear archivo `.env` con variables de prueba (sin GHL/Supabase reales):

```bash
cat > .env << 'EOF'
PORT=3000
NODE_ENV=development
GHL_API_KEY=test
GHL_LOCATION_ID=test
GHL_WHATSAPP_NUMBER=+573000000000
SUPABASE_URL=https://ducujnpbkikfylwzylet.supabase.co
SUPABASE_SERVICE_KEY=test
EOF
```

Iniciar servidor:
```bash
node index.js &
```

Verificar todos los endpoints:
```bash
# Health
curl http://localhost:3000/health
# Esperado: {"status":"ok","ts":"..."}

# Portal — verificar HTML completo
curl "http://localhost:3000/portal?gw_address=127.0.0.1&gw_port=2060&gw_id=eden-piscina&mac=AA:BB:CC:00:00:01&ip=192.168.1.100&url=https://google.com" | grep -c "El Edén"
# Esperado: 2 (aparece en hotel-name y footer)

# send-otp sin variables reales → 500 (correcto, GHL no configurado)
curl -s -o /dev/null -w "%{http_code}" -X POST http://localhost:3000/send-otp \
  -H "Content-Type: application/json" \
  -d '{"whatsapp":"3001234567","gw_address":"127.0.0.1","gw_port":"2060","gw_id":"eden-piscina","mac":"AA:BB","ip":"192.168.1.100"}'
# Esperado: 500 (GHL key inválida — el flujo llega hasta el intento de llamada)

# Validación de formato — número inválido → 400
curl -s -w "\n%{http_code}" -X POST http://localhost:3000/send-otp \
  -H "Content-Type: application/json" \
  -d '{"whatsapp":"123"}'
# Esperado: {"error":"Número WhatsApp inválido"}\n400

kill %1
```

- [ ] **Step 3: Commit final**

```bash
git add index.js README.md .env.example .gitignore
git commit -m "feat: FAS completo — portal cautivo El Edén Hotel Resort"
git push
```

---

## Notas de integración post-deploy

### Tabla Supabase
Antes del primer uso real, ejecutar en Supabase SQL Editor:
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

### GHL WhatsApp
- El número en `GHL_WHATSAPP_NUMBER` debe estar conectado como canal WhatsApp en la sub-cuenta `GHL_LOCATION_ID`
- El contacto se crea automáticamente con tag `wifi-eden` al primer acceso
- El mensaje OTP aparece en la conversación del contacto en GHL

### Verificación en producción
```
https://wifi.tierraparaiso.net/health
```
Debe retornar `{"status":"ok"}` antes de activar en los routers.
