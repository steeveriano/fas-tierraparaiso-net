require('dotenv').config();
const express = require('express');
const crypto = require('crypto');
const path = require('path');
const { createClient } = require('@supabase/supabase-js');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());
app.use('/public', express.static(path.join(__dirname, 'public')));

const rateLimit = require('express-rate-limit');
app.use('/send-otp', rateLimit({ windowMs: 60_000, max: 3, standardHeaders: true, legacyHeaders: false }));
app.use('/verify',   rateLimit({ windowMs: 60_000, max: 10, standardHeaders: true, legacyHeaders: false }));

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
const GW={address:${JSON.stringify(gw_address)},port:${JSON.stringify(gw_port)},gw_id:${JSON.stringify(gw_id)},mac:${JSON.stringify(mac)},ip:${JSON.stringify(ip)},url:${JSON.stringify(url)}};
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
      if(n<=0){clearInterval(t);window.location.href=GW.url||'https://www.google.com';}
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

app.listen(PORT, () => console.log(`FAS corriendo en puerto ${PORT}`));
