-- Tabla de sesiones WiFi del captive portal El Edén Hotel Resort
-- Ejecutar en: Supabase SQL Editor → proyecto ducujnpbkikfylwzylet

CREATE TABLE IF NOT EXISTS public.wifi_sessions (
  id             uuid         PRIMARY KEY DEFAULT gen_random_uuid(),
  mac            text         NOT NULL,
  ip             text         NOT NULL,
  gw_id          text         NOT NULL,
  whatsapp       text         NOT NULL,
  token          text         NOT NULL UNIQUE,
  authorized_at  timestamptz  NOT NULL,
  created_at     timestamptz  NOT NULL DEFAULT now()
);

-- Índices para consultas frecuentes
CREATE INDEX IF NOT EXISTS wifi_sessions_mac_idx      ON public.wifi_sessions (mac);
CREATE INDEX IF NOT EXISTS wifi_sessions_whatsapp_idx ON public.wifi_sessions (whatsapp);
CREATE INDEX IF NOT EXISTS wifi_sessions_created_idx  ON public.wifi_sessions (created_at DESC);

-- RLS habilitado — solo service_role puede escribir (el FAS usa SUPABASE_SERVICE_KEY)
ALTER TABLE public.wifi_sessions ENABLE ROW LEVEL SECURITY;

-- Sin políticas de SELECT/INSERT para roles anon/authenticated:
-- el FAS accede con service_role que bypasea RLS
