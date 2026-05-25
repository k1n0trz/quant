# Quant VPS Deploy

Este documento describe el flujo seguro para desplegar Quant al VPS sin conectarse manualmente en cada release.

## Recursos

- URL test Cloud Run: `https://quant-122728831361.us-central1.run.app`
- URL VPS: `http://37.60.227.190/`
- GitHub: `https://github.com/k1n0trz/quant`
- Proyecto GCloud de Quant: `quant-495219`

## Modelo de Deploy

El flujo recomendado es:

```text
GitHub Actions manual -> SSH VPS -> git checkout SHA -> npm ci -> systemd restart -> /healthz
```

El workflow es manual (`workflow_dispatch`) y por defecto corre en modo validacion solamente:

- `ssh_deploy=false`: valida checkout, lockfile, syntax y smoke tests.
- `ssh_deploy=true`: ademas hace deploy por SSH al VPS.

No hay deploy automatico por push.

## Archivos Relevantes

- Workflow: `.github/workflows/deploy-vps.yml`
- App headless por defecto: `electron_quant`
- Healthcheck publico: `/healthz`
- Lockfile: `electron_quant/package-lock.json`

## GitHub Secrets Necesarios

Configurar en GitHub, nunca en el repo:

| Secret | Uso |
| --- | --- |
| `VPS_HOST` | IP o hostname del VPS |
| `VPS_USER` | Usuario SSH de deploy |
| `VPS_SSH_KEY` | Clave privada SSH dedicada a GitHub Actions |
| `VPS_PORT` | Puerto SSH, opcional si es `22` |

No guardar claves de trading en GitHub Secrets para este flujo. Las variables sensibles de Quant viven en el VPS.

## Setup One-Time Del VPS

Crear usuario de deploy, idealmente no root:

```bash
sudo adduser --disabled-password --gecos "" quant
sudo mkdir -p /opt/quant /var/lib/quant /etc/quant
sudo chown -R quant:quant /opt/quant /var/lib/quant
```

Clonar el repo como `quant`:

```bash
sudo -u quant git clone https://github.com/k1n0trz/quant.git /opt/quant/quant
```

Crear `/etc/quant/quant.env` manualmente en el VPS:

```bash
QUANT_WEB_PORT=47829
QUANT_DATA_DIR=/var/lib/quant
WEB_AUTH_ENABLED=true
WEB_AUTH_EMAIL=...
WEB_AUTH_PASSWORD=...
REAL_TRADING=false
REAL_TRADING_ACK=
REAL_TRADING_MAX_NOTIONAL_USDT=25
MT5_CONNECTOR_ENABLED=false
DEFAULT_PROVIDER=deepseek
```

Mantener `REAL_TRADING=false` hasta autorizacion explicita.

## systemd

Unidad sugerida en `/etc/systemd/system/quant.service`:

```ini
[Unit]
Description=Quant headless web server
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
User=quant
Group=quant
WorkingDirectory=/opt/quant/quant/electron_quant
EnvironmentFile=/etc/quant/quant.env
ExecStart=/usr/bin/node main.js
Restart=on-failure
RestartSec=5
LimitNOFILE=4096
StandardOutput=journal
StandardError=journal
NoNewPrivileges=true
PrivateTmp=true
ProtectSystem=full
ProtectHome=true
ReadWritePaths=/var/lib/quant /opt/quant/quant

[Install]
WantedBy=multi-user.target
```

Activar:

```bash
sudo systemctl daemon-reload
sudo systemctl enable quant.service
sudo systemctl start quant.service
curl -fsS http://127.0.0.1:47829/healthz
```

## Sudoers Minimo Para Deploy

Si `VPS_USER` no es root, darle permiso acotado para reiniciar solo Quant:

```text
quant ALL=(root) NOPASSWD: /bin/systemctl restart quant.service, /bin/systemctl status quant.service, /usr/bin/journalctl -u quant.service -n 80 --no-pager
```

Ajustar paths (`/bin/systemctl`, `/usr/bin/systemctl`) segun el VPS.

## Como Ejecutar El Workflow

En GitHub:

1. Actions.
2. Deploy Quant to VPS.
3. Run workflow.
4. Elegir:
   - `ref`: branch, tag o SHA.
   - `ssh_deploy=false` para validar.
   - `ssh_deploy=true` para desplegar.

Primero correr con `ssh_deploy=false`.

## Rollback

Ejecutar el mismo workflow con un SHA anterior en `ref`.

Rollback manual en el VPS:

```bash
cd /opt/quant/quant
sudo -u quant git log --oneline -10
sudo -u quant git checkout <sha-anterior>
cd electron_quant
sudo -u quant npm ci --omit=dev --ignore-scripts --no-audit --no-fund
sudo systemctl restart quant.service
curl -fsS http://127.0.0.1:47829/healthz
```

## MT5

En VPS Linux mantener:

```bash
MT5_CONNECTOR_ENABLED=false
```

MT5 real debe planearse en fase separada, probablemente Windows VPS o arquitectura dedicada. No mezclarlo con el primer deploy web/headless.

## Reglas De Seguridad

- No subir `.env`.
- No usar root SSH para GitHub Actions si se puede evitar.
- No guardar claves Binance/DeepSeek en GitHub para este deploy.
- `REAL_TRADING=false` por defecto.
- `/healthz` no expone secretos ni paths.
- El workflow es manual; no se dispara por push.
