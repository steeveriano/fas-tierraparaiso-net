const express = require('express');
const app = express();
const PORT = process.env.PORT || 3000;

app.get('/portal', (req, res) => {
  const { gw_address, gw_port, gw_id, mac, ip, url } = req.query;
  res.send(`
    <html>
      <body style="font-family:sans-serif;text-align:center;padding:40px">
        <h1>WiFi El Edén Hotel Resort</h1>
        <p>Bienvenido. Ingresa tu número de WhatsApp para conectarte.</p>
        <p><small>MAC: ${mac} | GW: ${gw_id}</small></p>
      </body>
    </html>
  `);
});

app.get('/health', (req, res) => res.json({ status: 'ok' }));

app.listen(PORT, () => console.log(`FAS corriendo en puerto ${PORT}`));
