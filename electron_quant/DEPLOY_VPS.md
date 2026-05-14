# Deploy Quant en VPS Ubuntu 24.04

Esta guía deja Quant listo para correr en Ubuntu 24.04 con Node.js, PM2, Nginx y `.env`, sin activar trading real.

## 1. Alcance del deploy

Sube o clona únicamente el código fuente del proyecto.

Sí subir:
- `electron_quant/`

No subir:
- `electron_quant/node_modules/`
- `electron_quant/dist/`
- `electron_quant/dist2/`
- `backups/`
- `quant_data/` local de Windows
- `.env`
- cualquier secreto o export manual

## 2. Estructura recomendada en VPS

```bash
/opt/quant/
  electron_quant/
  shared/
    quant_data/
```

## 3. Instalar dependencias del sistema

```bash
sudo apt update
sudo apt install -y curl git nginx
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt install -y nodejs
sudo npm install -g pm2
```

Verificar:

```bash
node -v
npm -v
pm2 -v
nginx -v
```

## 4. Obtener el proyecto

```bash
sudo mkdir -p /opt/quant
sudo chown -R $USER:$USER /opt/quant
cd /opt/quant
git clone https://github.com/k1n0trz/quant.git
cd /opt/quant/quant/electron_quant
mkdir -p /opt/quant/shared/quant_data
```

## 5. Preparar variables de entorno

Usa la plantilla de producción:

```bash
cp .env.production.example .env
nano .env
```

Valores obligatorios para primer arranque:
- `NODE_ENV=production`
- `QUANT_WEB_HOST=127.0.0.1`
- `QUANT_WEB_PORT=47829`
- `QUANT_DATA_DIR=/opt/quant/shared/quant_data`
- `REAL_TRADING=false`
- `TRAINING_BACKEND_LOOP_ENABLED=true`
- `TRAINING_BACKEND_LOOP_SCHEDULER_ENABLED=true`
- `TRAINING_BACKEND_LOOP_INTERVAL_MS=60000`
- `TRAINING_BACKEND_DEMO_ENTRY_ENABLED=true`
- `TRAINING_BACKEND_SIGNAL_CANDIDATES_ENABLED=true`
- `MT5_CONNECTOR_ENABLED=false`
- `WEB_AUTH_ENABLED=true`
- `WEB_AUTH_EMAIL=<tu correo>`
- `WEB_AUTH_PASSWORD=<contraseña fuerte>`

## 6. Instalar dependencias Node

```bash
cd /opt/quant/quant/electron_quant
npm ci --omit=dev
```

Si necesitas correr tests en VPS:

```bash
npm install
```

## 7. Correr tests

```bash
cd /opt/quant/quant/electron_quant
npm run test:backend
```

## 8. Verificar arranque backend

Primero en foreground:

```bash
cd /opt/quant/quant/electron_quant
npm run start:backend
```

Esperado:
- backend escuchando en `127.0.0.1:47829`
- `REAL_TRADING=false`
- primer arranque con `tradingRealEnabled=false`
- `paperMode=true`
- `trainingEnabled=true`
- scheduler backend con auto-start habilitado

Desde otra terminal:

```bash
curl http://127.0.0.1:47829/healthz
```

Respuesta esperada:

```json
{"ok":true,"service":"quant-backend","ts":"..."}
```

Healthcheck por script:

```bash
cd /opt/quant/quant/electron_quant
npm run healthcheck
```

## 9. Iniciar con PM2

```bash
cd /opt/quant/quant/electron_quant
pm2 start ops/pm2/ecosystem.config.cjs
pm2 status
pm2 logs quant-backend --lines 100
pm2 save
pm2 startup systemd
```

## 10. Configurar Nginx reverse proxy

Crear archivo:

```bash
sudo nano /etc/nginx/sites-available/quant
```

Contenido base:

```nginx
server {
    listen 80;
    server_name TU_DOMINIO_O_IP;

    location / {
        proxy_pass http://127.0.0.1:47829;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}
```

Activar:

```bash
sudo ln -s /etc/nginx/sites-available/quant /etc/nginx/sites-enabled/quant
sudo nginx -t
sudo systemctl reload nginx
```

## 11. Comandos operativos exactos

Instalar dependencias:

```bash
cd /opt/quant/quant/electron_quant
npm ci --omit=dev
```

Correr tests:

```bash
cd /opt/quant/quant/electron_quant
npm run test:backend
```

Iniciar backend con PM2:

```bash
cd /opt/quant/quant/electron_quant
pm2 start ops/pm2/ecosystem.config.cjs
```

Consultar healthz:

```bash
curl http://127.0.0.1:47829/healthz
```

Script healthcheck:

```bash
cd /opt/quant/quant/electron_quant
npm run healthcheck
```

## 12. Confirmaciones de seguridad del primer arranque

- `REAL_TRADING=false` por defecto
- `QUANT_WEB_HOST=127.0.0.1`
- `tradingRealEnabled=false` en estado backend
- `paperMode=true`
- `killSwitch=false` por defecto, pero trading real sigue desactivado
- MT5 deshabilitado por defecto
- Binance no debe operar real aunque existan claves, mientras `REAL_TRADING=false`

## 13. Checklist antes de Binance real

No activar todavía. Antes de real:

- rotar todos los secretos expuestos históricamente
- revisar `.env` solo en VPS, nunca en repo
- confirmar `GET /api/risk`
- confirmar `POST /api/connections/binance/test`
- definir límites reales de riesgo
- validar NTP/hora del servidor
- proteger Nginx con TLS
- restringir acceso por firewall
- revisar logs PM2 y `healthz`
- definir backup de `/opt/quant/shared/quant_data`
- probar kill switch y `tradingRealEnabled`
- dejar `MT5_CONNECTOR_ENABLED=false` salvo necesidad concreta
- validar sesión web y credenciales admin fuertes

## 14. Nota operativa

Este deploy prepara Quant para VPS Ubuntu/Linux, pero no cambia la lógica de trading real. El backend queda listo para correr 24/7 detrás de Nginx con PM2 y healthcheck local.
