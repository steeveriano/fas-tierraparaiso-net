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

// GET /health
app.get('/health', (_req, res) => {
  res.json({ status: 'ok', ts: new Date().toISOString() });
});

app.listen(PORT, () => console.log(`FAS corriendo en puerto ${PORT}`));
