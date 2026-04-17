require('dotenv').config();
const express = require('express');
const crypto = require('crypto');
const path = require('path');
const { createClient } = require('@supabase/supabase-js');

const app = express();
app.set('trust proxy', 1);
const PORT = process.env.PORT || 3000;

app.use(express.json());
app.use('/public', express.static(path.join(__dirname, 'public')));

const rateLimit = require('express-rate-limit');
app.use('/send-otp', rateLimit({ windowMs: 60_000, max: 3,  standardHeaders: true, legacyHeaders: false, validate: { xForwardedForHeader: false } }));
app.use('/verify',   rateLimit({ windowMs: 60_000, max: 10, standardHeaders: true, legacyHeaders: false, validate: { xForwardedForHeader: false } }));
app.use('/capture',  rateLimit({ windowMs: 60_000, max: 5,  standardHeaders: true, legacyHeaders: false, validate: { xForwardedForHeader: false } }));

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

// GET /health
app.get('/health', (_req, res) => {
  res.json({ status: 'ok', ts: new Date().toISOString() });
});

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
      attempts: 0,
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

// POST /verify
app.post('/verify', async (req, res) => {
  try {
    const { whatsapp, otp, gw_address, gw_port, gw_id, mac, ip } = req.body;

    if (!whatsapp || !/^\d{10}$/.test(whatsapp)) {
      return res.status(400).json({ error: 'Número WhatsApp inválido' });
    }
    if (!otp || !/^\d{6}$/.test(String(otp))) {
      return res.status(400).json({ error: 'Código OTP inválido' });
    }

    const stored = otpStore.get(whatsapp);
    if (!stored || stored.expires < Date.now()) {
      return res.status(400).json({ error: 'OTP expirado o no encontrado' });
    }
    if (stored.otp !== String(otp)) {
      stored.attempts += 1;
      if (stored.attempts >= 3) {
        otpStore.delete(whatsapp);
        return res.status(400).json({ error: 'Demasiados intentos fallidos. Solicita un nuevo código.' });
      }
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

    res.json({ ok: true });
  } catch (err) {
    console.error('[verify]', err.message);
    res.status(500).json({ error: 'Error al verificar OTP' });
  }
});

// POST /capture — registra número, autoriza en gateway, guarda sesión
app.post('/capture', async (req, res) => {
  try {
    const { whatsapp, gw_address, gw_port, gw_id, mac, ip } = req.body;
    if (!whatsapp || !/^\d{10}$/.test(whatsapp)) {
      return res.status(400).json({ error: 'Número WhatsApp inválido' });
    }
    const token = crypto.randomUUID();
    const phone = `+57${whatsapp}`;

    await fetch(`http://${gw_address}:${gw_port}/wifidog/auth?token=${token}`)
      .catch(err => console.error('[gateway]', err.message));

    const { error: dbError } = await supabase.from('wifi_sessions').insert({
      mac, ip, gw_id, whatsapp: phone, token, authorized_at: new Date().toISOString(),
    });
    if (dbError) console.error('[supabase]', dbError.message);

    try {
      const contactId = await ghlUpsertContact(phone);
      await ghlAddTag(contactId, 'wifi-eden');
    } catch (ghlErr) {
      console.error('[ghl-tag]', ghlErr.message);
    }

    res.json({ ok: true });
  } catch (err) {
    console.error('[capture]', err.message);
    res.status(500).json({ error: 'Error al capturar sesión' });
  }
});

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

function portalHTML({ gw_address, gw_port, gw_id, mac, ip, url }) {
  return `<!DOCTYPE html>
<html lang="es">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1,maximum-scale=1">
<title>WiFi El Edén Hotel Resort</title>
<style>
*,*::before,*::after{box-sizing:border-box;margin:0;padding:0}
:root{--green:#2d5a3d;--green-dk:#1a3a2a;--brown:#3d2b1f;--brown-l:#8b7355;--border:#c5b596}
html,body{min-height:100%;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;background:#fff}
.screen{display:none;flex-direction:column;min-height:100vh;padding:36px 24px 28px}
.screen.active{display:flex}
.screen-body{flex:1;display:flex;flex-direction:column;align-items:center;gap:20px;text-align:center}
.logo-tp{height:42px;width:auto;object-fit:contain}
.screen-title{font-size:26px;font-weight:700;color:var(--brown);line-height:1.2}
.screen-sub{font-size:14px;color:var(--brown-l);line-height:1.5;max-width:300px}
.btn-wa-big{display:flex;align-items:center;justify-content:center;gap:12px;width:100%;background:#25D366;color:white;border:none;border-radius:14px;padding:18px 24px;font-size:17px;font-weight:700;text-decoration:none;cursor:pointer;font-family:inherit;transition:background .2s}
.btn-wa-big:hover{background:#1da851}
.wa-circle{width:28px;height:28px;background:rgba(255,255,255,.25);border-radius:50%;display:flex;align-items:center;justify-content:center;font-size:16px;flex-shrink:0}
.warning{background:#fff3cd;border:1px solid #ffc107;border-radius:10px;padding:12px 16px;font-size:13px;color:#856404;line-height:1.4;width:100%;text-align:center}
.btn-gray{background:#f0ede8;color:var(--brown-l);border:none;border-radius:12px;padding:14px 20px;font-size:14px;font-weight:500;cursor:pointer;width:100%;font-family:inherit;transition:background .2s}
.btn-gray:hover{background:#e8e4de}
.video-container{width:100%;border-radius:14px;overflow:hidden;background:#000;position:relative;aspect-ratio:16/9}
.video-container video{width:100%;height:100%;object-fit:cover;display:block}
.play-overlay{position:absolute;inset:0;display:flex;align-items:center;justify-content:center;background:rgba(0,0,0,.35);cursor:pointer;border:none;font-size:52px;color:white;transition:background .2s;width:100%}
.play-overlay:hover{background:rgba(0,0,0,.5)}
.countdown-badge{background:rgba(0,0,0,.7);color:white;border-radius:20px;padding:6px 14px;font-size:13px;font-weight:600;align-self:center}
.btn-continue{background:var(--green);color:white;border:none;border-radius:12px;padding:15px;font-size:16px;font-weight:600;cursor:pointer;width:100%;font-family:inherit}
.gradient-title{font-size:48px;font-weight:800;line-height:1;background:linear-gradient(135deg,#e91e8c,#f7941d,#fcee21,#39b54a,#27aae1,#652d90);-webkit-background-clip:text;-webkit-text-fill-color:transparent;background-clip:text}
.input-wrap{display:flex;align-items:center;border:1.5px solid var(--border);border-radius:12px;overflow:hidden;background:white;transition:border-color .2s;width:100%}
.input-wrap:focus-within{border-color:var(--green)}
.prefix{padding:13px 14px;font-size:14px;color:#6b5a3e;border-right:1px solid #e8dcc8;background:#f5f0e8;white-space:nowrap;font-weight:500;user-select:none}
.phone-input{flex:1;padding:13px 12px;font-size:16px;color:var(--brown);border:none;outline:none;background:white;font-family:inherit}
.phone-input::placeholder{color:#bba98a}
.btn-connect{display:flex;align-items:center;justify-content:center;gap:8px;background:linear-gradient(135deg,var(--green),var(--green-dk));color:white;border:none;border-radius:12px;padding:16px;font-size:16px;font-weight:700;cursor:pointer;width:100%;font-family:inherit;transition:opacity .2s}
.btn-connect:disabled{opacity:.5;cursor:not-allowed}
.error-msg{font-size:12px;color:#c0392b;display:none;text-align:center}
.screen-footer{border-top:1px solid #ede8e0;margin-top:24px;padding-top:16px;display:flex;flex-direction:column;align-items:center;gap:6px}
.footer-text{font-size:10px;color:var(--brown-l);letter-spacing:.5px;text-align:center}
.logo-eden{height:28px;width:auto;object-fit:contain}
</style>
</head>
<body>

<!-- PANTALLA 1: Activar WhatsApp -->
<div class="screen active" id="s1">
  <div class="screen-body">
    <img class="logo-tp" src="/public/logo-tp.png" alt="tierraparaiso.net"
      onerror="this.outerHTML='<span style=\\'font-weight:700;color:#2d5a3d;font-size:16px\\'>tierraparaiso.net</span>'">
    <h1 class="screen-title">Activa tu WiFi gratis</h1>
    <p class="screen-sub">Para acceder al internet gratuito primero escríbenos por WhatsApp</p>
    <a class="btn-wa-big" href="https://wa.me/573334318008?text=Hola%2C%20quiero%20activar%20mi%20WiFi%20en%20El%20Ed%C3%A9n" target="_blank" rel="noopener noreferrer">
      <div class="wa-circle">💬</div>
      Escríbenos por WhatsApp
    </a>
    <div class="warning">⚠️ Si no nos escribes no podemos habilitarte el acceso a internet</div>
    <button class="btn-gray" onclick="goTo(2)">Ya te escribí → Ver experiencias</button>
  </div>
  <div class="screen-footer">
    <div class="footer-text">Operador de El Edén Hotel Resort</div>
    <img class="logo-eden" src="/public/logo-eden.png" alt="El Edén"
      onerror="this.outerHTML='<span style=\\'font-size:11px;font-weight:700;color:#2d5a3d\\'>EL EDÉN</span>'">
    <div class="footer-text">SANTA ELENA · VALLE DEL CAUCA</div>
  </div>
</div>

<!-- PANTALLA 2: Video promo -->
<div class="screen" id="s2">
  <div class="screen-body">
    <h2 class="screen-title" style="font-size:20px">Conoce tierraparaiso.net</h2>
    <div class="video-container">
      <video id="promoVideo" src="/public/promo.mp4" playsinline preload="metadata"></video>
      <button class="play-overlay" id="playBtn" onclick="startVideo()">▶</button>
    </div>
    <div class="countdown-badge" id="cdBadge" style="display:none">Continuar en <span id="cdNum">8</span>s</div>
    <button class="btn-continue" id="btnContinue" style="display:none" onclick="goTo(3)">Continuar →</button>
  </div>
  <div class="screen-footer">
    <div class="footer-text">Operador de El Edén Hotel Resort</div>
    <img class="logo-eden" src="/public/logo-eden.png" alt="El Edén"
      onerror="this.outerHTML='<span style=\\'font-size:11px;font-weight:700;color:#2d5a3d\\'>EL EDÉN</span>'">
    <div class="footer-text">SANTA ELENA · VALLE DEL CAUCA</div>
  </div>
</div>

<!-- PANTALLA 3: Conectarse -->
<div class="screen" id="s3">
  <div class="screen-body">
    <div class="gradient-title">Bienvenido</div>
    <p class="screen-sub">Acceso a Internet para Invitados de tierraparaiso.net</p>
    <div class="input-wrap">
      <div class="prefix">🇨🇴 +57</div>
      <input class="phone-input" id="phone" type="tel" inputmode="numeric"
        placeholder="300 000 0000" maxlength="10" autocomplete="tel">
    </div>
    <div class="error-msg" id="phoneError">Número inválido. Ingresa 10 dígitos colombianos.</div>
    <button class="btn-connect" id="btnConnect" onclick="capture()">
      📶 Conectarme al WiFi
    </button>
  </div>
  <div class="screen-footer">
    <div class="footer-text">Operador de El Edén Hotel Resort</div>
    <img class="logo-eden" src="/public/logo-eden.png" alt="El Edén"
      onerror="this.outerHTML='<span style=\\'font-size:11px;font-weight:700;color:#2d5a3d\\'>EL EDÉN</span>'">
    <div class="footer-text">SANTA ELENA · VALLE DEL CAUCA</div>
  </div>
</div>

<script>
const GW={address:${JSON.stringify(gw_address)},port:${JSON.stringify(gw_port)},gw_id:${JSON.stringify(gw_id)},mac:${JSON.stringify(mac)},ip:${JSON.stringify(ip)},url:${JSON.stringify(url)}};
let cdTimer=null;

function goTo(n){
  document.querySelectorAll('.screen').forEach(s=>s.classList.remove('active'));
  document.getElementById('s'+n).classList.add('active');
  window.scrollTo(0,0);
  if(n===2)resetVideo();
}

function resetVideo(){
  const v=document.getElementById('promoVideo');
  v.pause();v.currentTime=0;
  document.getElementById('playBtn').style.display='';
  document.getElementById('cdBadge').style.display='none';
  document.getElementById('btnContinue').style.display='none';
  if(cdTimer)clearInterval(cdTimer);
}

function startVideo(){
  const v=document.getElementById('promoVideo');
  document.getElementById('playBtn').style.display='none';
  v.play();
  const badge=document.getElementById('cdBadge');
  const numEl=document.getElementById('cdNum');
  badge.style.display='';
  let t=8;numEl.textContent=t;
  if(cdTimer)clearInterval(cdTimer);
  cdTimer=setInterval(()=>{
    numEl.textContent=--t;
    if(t<=0){clearInterval(cdTimer);badge.style.display='none';document.getElementById('btnContinue').style.display='';}
  },1000);
}

document.getElementById('promoVideo').addEventListener('ended',()=>{
  if(cdTimer)clearInterval(cdTimer);
  goTo(3);
});

async function capture(){
  const raw=document.getElementById('phone').value.replace(/\\D/g,'');
  const err=document.getElementById('phoneError');
  if(raw.length!==10){err.style.display='block';return;}
  err.style.display='none';
  const btn=document.getElementById('btnConnect');
  btn.disabled=true;btn.textContent='Conectando…';
  try{
    const res=await fetch('/capture',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({whatsapp:raw,...GW})});
    if(!res.ok)throw new Error();
    window.location.href=GW.url||'https://www.google.com';
  }catch(e){
    err.textContent='Error al conectar. Intenta de nuevo.';err.style.display='block';
    btn.disabled=false;btn.textContent='📶 Conectarme al WiFi';
  }
}
</script>
</body>
</html>`;
}

app.listen(PORT, () => console.log(`FAS corriendo en puerto ${PORT}`));
