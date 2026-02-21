# Domain Monitor — Documentación Técnica Completa

> **Última actualización:** 2026-02-21
> Este documento cubre cada parte del sistema: arquitectura, esquema de base de datos, todos los endpoints de API, cada servicio, middleware, opciones de configuración, comportamiento del frontend y preguntas frecuentes.
>
> **Creado por [J.C. Sancho](https://github.com/sanchodevs)**

---

## Tabla de Contenidos

1. [Descripción General del Proyecto](#1-descripción-general-del-proyecto)
2. [Stack Tecnológico](#2-stack-tecnológico)
3. [Estructura de Directorios](#3-estructura-de-directorios)
4. [Configuración y Variables de Entorno](#4-configuración-y-variables-de-entorno)
5. [Inicio del Servidor y Ciclo de Vida](#5-inicio-del-servidor-y-ciclo-de-vida)
6. [Capa de Base de Datos](#6-capa-de-base-de-datos)
7. [Servicios](#7-servicios)
8. [Middleware](#8-middleware)
9. [Rutas de API — Referencia Completa](#9-rutas-de-api--referencia-completa)
10. [Protocolo WebSocket](#10-protocolo-websocket)
11. [Esquemas de Validación](#11-esquemas-de-validación)
12. [Tipos TypeScript](#12-tipos-typescript)
13. [Frontend (SPA)](#13-frontend-spa)
14. [Página de Estado Pública](#14-página-de-estado-pública)
15. [Sistema de Registro de Auditoría](#15-sistema-de-registro-de-auditoría)
16. [Modelo de Seguridad](#16-modelo-de-seguridad)
17. [Sistema de Logging](#17-sistema-de-logging)
18. [Despliegue con Docker](#18-despliegue-con-docker)
19. [Diagramas de Flujo de Datos](#19-diagramas-de-flujo-de-datos)
20. [Preguntas Frecuentes](#20-preguntas-frecuentes)

---

## 1. Descripción General del Proyecto

**Domain Monitor** es una aplicación Node.js/TypeScript autoalojada que ofrece una vista unificada de todos tus nombres de dominio. Obtiene datos de registro WHOIS, verifica la salud DNS/HTTP/SSL, monitorea el tiempo de actividad, dispara alertas antes de que los dominios expiren y escribe un registro de auditoría completo de cada acción realizada.

La aplicación es un **servidor Express de proceso único** respaldado por una base de datos **SQLite** integrada. No hay un paso de compilación del frontend separado — la carpeta `public/` se sirve como archivos estáticos directamente. Las actualizaciones en tiempo real se envían a los navegadores mediante una conexión **WebSocket**. Todo el trabajo en segundo plano (actualizaciones programadas, pings de tiempo de actividad, limpieza de logs) se ejecuta como temporizadores en proceso y trabajos `node-cron`.

---

## 2. Stack Tecnológico

| Capa | Librería / Herramienta | Versión | Propósito |
|------|----------------------|---------|-----------|
| Runtime | Node.js | 18+ | Entorno de ejecución JavaScript |
| Lenguaje | TypeScript | 5.3+ | Tipado estático; compilado a ESM con `tsc` |
| Framework web | Express | 4.x | Enrutamiento HTTP, pipeline de middleware |
| Base de datos | better-sqlite3 | 12.x | Bindings SQLite síncronos — sin overhead async |
| Cliente HTTP | Axios | 1.x | Llamadas a la API WHOIS, entrega de webhooks, Slack/Signal |
| Autenticación | bcrypt | 6.x | Hash de contraseñas para usuarios locales |
| Email | Nodemailer | 7.x | Transporte SMTP para alertas de expiración/tiempo de actividad |
| Programación | node-cron | 3.x | Trabajos en segundo plano con sintaxis cron |
| WHOIS fallback | whois-json | 2.x | Consultas WHOIS directas cuando la API no está disponible |
| WebSocket | ws | 8.x | Push en tiempo real del servidor al navegador |
| Validación de entrada | Zod | 4.x | Validación de cuerpos y queries de requests basada en esquemas |
| Headers de seguridad | Helmet | 8.x | Headers HTTP de seguridad (CSP, HSTS, etc.) |
| Rate limiting | express-rate-limit | 8.x | Throttling de requests por IP |
| Subida de archivos | Multer | 2.x | Manejo multipart/form-data para importación CSV |
| Parsing CSV | csv-parse | 6.x | Parsear archivos CSV importados |
| Logging | Pino + pino-pretty + pino-roll | 10.x | Logging JSON estructurado con rotación de archivos opcional |
| Gráficos | Chart.js | 4.x | Gráfico de barras de línea de tiempo de expiración (cargado desde CDN) |
| Iconos | Font Awesome 6 | CDN | Iconos de interfaz de usuario |
| Testing | Vitest | latest | Pruebas unitarias |
| Runner de desarrollo | tsx | latest | Ejecución TypeScript sin paso de compilación |

---

## 3. Estructura de Directorios

```
domain-monitor/
├── src/                          # Todo el código fuente TypeScript (compilado → dist/)
│   ├── index.ts                  # Re-exporta server.ts (punto de entrada)
│   ├── server.ts                 # Configuración de la app Express, inicio, apagado
│   │
│   ├── config/
│   │   ├── index.ts              # Lee variables de entorno, exporta objeto config tipado
│   │   └── schema.ts             # Esquemas Zod para cuerpos de requests y queries
│   │
│   ├── database/
│   │   ├── db.ts                 # Abre la conexión SQLite (modo WAL, FK ON)
│   │   ├── index.ts              # Sentencias CREATE TABLE + todas las migraciones
│   │   ├── domains.ts            # CRUD de dominios, paginación, borrado suave, restauración
│   │   ├── groups.ts             # CRUD de grupos con conteo de dominios
│   │   ├── tags.ts               # CRUD de etiquetas y asociaciones dominio↔etiqueta
│   │   ├── audit.ts              # logAudit(), queryAuditLog(), funciones helper
│   │   ├── sessions.ts           # Almacén de sesiones y limpieza
│   │   ├── settings.ts           # Configuraciones clave/valor con caché en memoria
│   │   ├── apikeys.ts            # Almacenamiento de claves API con cifrado AES
│   │   ├── health.ts             # Consultas domain_health y helpers batch
│   │   ├── users.ts              # CRUD multi-usuario con contraseñas bcrypt
│   │   ├── webhooks.ts           # Configuración de webhooks y log de entregas
│   │   └── alert_rules.ts        # CRUD de reglas de alerta
│   │
│   ├── routes/
│   │   ├── index.ts              # Monta todos los sub-routers bajo /api
│   │   ├── auth.ts               # /api/auth — login, logout, me, status
│   │   ├── domains.ts            # /api/domains — CRUD completo + operaciones bulk
│   │   ├── groups.ts             # /api/groups
│   │   ├── tags.ts               # /api/tags
│   │   ├── refresh.ts            # /api/refresh
│   │   ├── health.ts             # /api/health
│   │   ├── uptime.ts             # /api/uptime
│   │   ├── settings.ts           # /api/settings
│   │   ├── import.ts             # /api/import
│   │   ├── export.ts             # /api/export
│   │   ├── audit.ts              # /api/audit
│   │   ├── apikeys.ts            # /api/apikeys
│   │   ├── users.ts              # /api/users
│   │   ├── webhooks.ts           # /api/webhooks
│   │   ├── metrics.ts            # /api/metrics
│   │   ├── rss.ts                # /rss
│   │   └── status.ts             # /api/status
│   │
│   ├── services/
│   │   ├── whois.ts              # Lookups WHOIS (múltiples proveedores)
│   │   ├── healthcheck.ts        # Verificaciones DNS/HTTP/SSL
│   │   ├── uptime.ts             # Bucle de monitoreo de tiempo de actividad
│   │   ├── scheduler.ts          # Gestión de trabajos node-cron
│   │   ├── email.ts              # Envío de email SMTP con Nodemailer
│   │   ├── slack.ts              # Webhook entrante de Slack
│   │   ├── signal.ts             # Notificaciones push ntfy/Signal
│   │   ├── webhooks.ts           # Entrega de webhooks salientes
│   │   ├── websocket.ts          # Broadcast WebSocket
│   │   └── cleanup.ts            # Limpieza de retención de logs
│   │
│   ├── middleware/
│   │   ├── auth.ts               # Verificación de autenticación de sesión
│   │   ├── logging.ts            # Logger de requests (Pino)
│   │   ├── rateLimit.ts          # Configuración express-rate-limit
│   │   └── errorHandler.ts       # Manejadores de 404 y errores
│   │
│   └── types/
│       ├── domain.ts             # Tipos Domain, Health, Group, Tag
│       ├── api.ts                # AuthenticatedRequest + tipos de respuesta
│       └── audit.ts              # Tipos AuditEntry, AuditRow
│
├── public/                       # Frontend (servido de forma estática)
│   ├── index.html                # Shell de la SPA principal
│   ├── app.js                    # SPA JavaScript vanilla (~5500 líneas)
│   ├── styles.css                # Estilos globales
│   └── status.html               # Página de estado pública autocontenida
│
├── scripts/
│   └── generate-docs.js          # Genera docs/index.html y docs/es/index.html
│
├── docs/
│   ├── index.html                # Documentación técnica en inglés (auto-generada)
│   └── es/
│       └── index.html            # Documentación técnica en español (auto-generada)
│
├── tests/                        # Pruebas unitarias Vitest
├── DOCUMENTATION.md              # Documentación técnica completa (inglés)
├── DOCUMENTACION.md              # Documentación técnica completa (español)
├── package.json
├── tsconfig.json
└── docker-compose.yml
```

---

## 4. Configuración y Variables de Entorno

### 4.1 Variables de Entorno

Crea un archivo `.env` en la raíz del proyecto. Todas las variables son opcionales a menos que se indique lo contrario.

#### Configuración del Servidor

| Variable | Por defecto | Descripción |
|----------|-------------|-------------|
| `PORT` | `3000` | Puerto en el que escucha el servidor HTTP |
| `NODE_ENV` | `development` | `production` activa CSP completa, HSTS y otras protecciones |
| `DB_PATH` | `./domains.db` | Ruta al archivo de base de datos SQLite |

#### API WHOIS (Requerida)

| Variable | Descripción |
|----------|-------------|
| `APILAYER_KEY` | Clave de API de APILayer para consultas WHOIS. Obtén una gratuita en apilayer.com |

#### Autenticación

| Variable | Por defecto | Descripción |
|----------|-------------|-------------|
| `AUTH_ENABLED` | `false` | Establece `true` para requerir inicio de sesión |
| `ADMIN_USERNAME` | `admin` | Nombre de usuario del administrador inicial |
| `ADMIN_PASSWORD` | — | Contraseña del administrador (requerida si AUTH_ENABLED=true) |
| `SESSION_SECRET` | aleatorio | Secreto para firmar cookies de sesión |
| `SESSION_TTL_HOURS` | `24` | Tiempo de vida de la sesión en horas |

#### Email SMTP

| Variable | Por defecto | Descripción |
|----------|-------------|-------------|
| `SMTP_HOST` | — | Hostname del servidor SMTP (ej. smtp.gmail.com) |
| `SMTP_PORT` | `587` | Puerto SMTP (587 para STARTTLS, 465 para SSL) |
| `SMTP_SECURE` | `false` | `true` para conexiones SSL directas (puerto 465) |
| `SMTP_USER` | — | Nombre de usuario SMTP |
| `SMTP_PASS` | — | Contraseña SMTP (usa App Password de Gmail) |
| `SMTP_FROM` | — | Dirección "De" (ej. `Domain Monitor <alerts@example.com>`) |

#### Notificaciones Push

| Variable | Descripción |
|----------|-------------|
| `SLACK_WEBHOOK_URL` | URL de webhook entrante de Slack para alertas |
| `NTFY_URL` | URL del servidor ntfy (ej. `https://ntfy.sh`) |
| `NTFY_TOPIC` | Tópico ntfy para recibir notificaciones |
| `NTFY_TOKEN` | Token de autenticación ntfy (opcional) |

#### Logging

| Variable | Por defecto | Descripción |
|----------|-------------|-------------|
| `LOG_LEVEL` | `info` | `debug`, `info`, `warn` o `error` |
| `LOG_TO_FILE` | `false` | `true` para escribir logs en archivo |
| `LOG_DIR` | `./logs` | Directorio donde se escriben los archivos de log |

### 4.2 Configuraciones en la Aplicación

Accesibles desde el panel de Configuraciones (icono de engranaje). Se almacenan en la tabla `settings` de SQLite.

| Clave | Descripción | Por defecto |
|-------|-------------|-------------|
| `refresh_schedule` | Expresión cron para actualización WHOIS | `0 2 * * 0` (Dom 2am) |
| `alert_schedule` | Expresión cron para alertas de email | `0 9 * * *` (Diario 9am) |
| `alert_days` | Días antes de expiración para alertar | `7,14,30` |
| `email_enabled` | Activar alertas de email | `false` |
| `email_recipients` | Destinatarios separados por comas | — |
| `uptime_enabled` | Activar monitoreo de tiempo de actividad | `true` |
| `uptime_interval` | Minutos entre pings de tiempo de actividad | `5` |
| `uptime_threshold` | Fallos consecutivos antes de alertar | `2` |
| `audit_retention_days` | Días para mantener logs de auditoría | `90` |
| `health_retention_days` | Días para mantener registros de salud | `30` |
| `auto_cleanup_enabled` | Activar limpieza automática de logs | `true` |

---

## 5. Inicio del Servidor y Ciclo de Vida

### 5.1 Secuencia de Inicio

```
1. validateConfig()           — valida que las variables de entorno necesarias estén presentes
2. runMigrations()            — ejecuta migraciones SQL acumulativas en SQLite
3. initializeSettings()       — rellena valores por defecto en la tabla settings si faltan
4. Express app = express()    — crea la instancia de la aplicación
5. HTTP server = createServer(app)
6. wsService.initialize(server) — adjunta el servidor WebSocket al servidor HTTP
7. onRefreshUpdate(cb)        — conecta actualizaciones de progreso WHOIS al broadcast WS
8. Middleware:
   - helmet()                 — headers de seguridad
   - express.json()           — parseo de cuerpo JSON
   - cookieParser()           — parseo de cookies de sesión
   - requestLogger            — logging de requests con Pino
9. Rutas estáticas:           — sirve index.html con inyección de año, luego public/
10. Rutas de API              — /api/auth (sin auth), luego /api/* (con auth opcional)
11. initialize():
    - initializeAuth()        — carga/crea usuario admin si AUTH_ENABLED
    - initializeEmail()       — verifica conexión SMTP
    - initializeScheduler()   — registra trabajos cron
    - startSessionCleanup()   — programa limpieza de sesiones expiradas
    - startUptimeMonitoring() — inicia bucle de pings de tiempo de actividad
    - startAutoCleanup()      — programa retención de logs
12. migrateFromJSON()         — importa dominios.json heredados si existe
13. server.listen(PORT)       — acepta conexiones entrantes
```

### 5.2 Apagado Graceful

En `SIGTERM` o `SIGINT`:
1. `stopUptimeMonitoring()` — limpia el intervalo de pings
2. `stopAutoCleanup()` — limpia el intervalo de limpieza
3. `server.close()` — deja de aceptar nuevas conexiones, espera a que finalicen las existentes
4. `wsService.close()` — cierra todas las conexiones WebSocket
5. `closeDatabase()` — libera el handle de la base de datos SQLite
6. `process.exit(0)`

---

## 6. Capa de Base de Datos

### 6.1 Conexión (`src/database/db.ts`)

Abre una conexión SQLite con:
- **Modo WAL** (`PRAGMA journal_mode = WAL`) — escrituras concurrentes eficientes
- **Claves foráneas** (`PRAGMA foreign_keys = ON`) — integridad referencial aplicada
- **Modo estricto** en algunas tablas para cumplimiento de tipos

La conexión es un singleton exportado como `db`. Toda la capa de base de datos usa `better-sqlite3` síncronamente — sin callbacks, sin Promises, sin async/await. Esto simplifica el manejo de errores y elimina las condiciones de carrera.

### 6.2 Tablas y Esquema

#### `domains`
Registros de dominio principales.

```sql
CREATE TABLE IF NOT EXISTS domains (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  domain          TEXT NOT NULL UNIQUE,
  registrar       TEXT,
  created_date    TEXT,
  expiry_date     TEXT,
  name_servers    TEXT,          -- array JSON serializado
  name_servers_prev TEXT,        -- array JSON serializado (para detección de cambios NS)
  last_checked    TEXT,          -- timestamp ISO 8601
  error           TEXT,          -- mensaje de error del último intento WHOIS
  group_id        INTEGER REFERENCES groups(id) ON DELETE SET NULL,
  deleted_at      TEXT           -- NULL = activo; timestamp ISO = borrado suave
);
```

**Índices:** `domain` (único), `group_id`, `deleted_at`, `expiry_date`.

#### `groups`
Organización de dominios en grupos con etiquetas de color.

```sql
CREATE TABLE IF NOT EXISTS groups (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  name        TEXT NOT NULL UNIQUE,
  color       TEXT NOT NULL DEFAULT '#6366f1',
  description TEXT,
  created_at  TEXT NOT NULL DEFAULT (datetime('now'))
);
```

#### `tags`
Etiquetas para dominios (muchos-a-muchos).

```sql
CREATE TABLE IF NOT EXISTS tags (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  name       TEXT NOT NULL UNIQUE,
  color      TEXT NOT NULL DEFAULT '#6366f1',
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
```

#### `domain_tags`
Tabla pivot para la relación muchos-a-muchos dominio↔etiqueta.

```sql
CREATE TABLE IF NOT EXISTS domain_tags (
  domain_id INTEGER NOT NULL REFERENCES domains(id) ON DELETE CASCADE,
  tag_id    INTEGER NOT NULL REFERENCES tags(id) ON DELETE CASCADE,
  PRIMARY KEY (domain_id, tag_id)
);
```

#### `domain_health`
Resultados de verificaciones de salud DNS/HTTP/SSL.

```sql
CREATE TABLE IF NOT EXISTS domain_health (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  domain_id       INTEGER NOT NULL REFERENCES domains(id) ON DELETE CASCADE,
  checked_at      TEXT NOT NULL DEFAULT (datetime('now')),
  dns_resolved    INTEGER,  -- 1=OK, 0=fallo
  dns_ip          TEXT,     -- IP resuelta
  http_status     INTEGER,  -- código de estado HTTP
  http_error      TEXT,     -- mensaje de error HTTP si lo hay
  ssl_valid       INTEGER,  -- 1=válido, 0=inválido/faltante
  ssl_expiry      TEXT,     -- fecha de expiración del certificado
  ssl_error       TEXT,     -- error SSL si lo hay
  response_time_ms INTEGER  -- tiempo de respuesta total
);
```

**Índice:** `(domain_id, checked_at)`.

#### `uptime_checks`
Historial de pings de tiempo de actividad.

```sql
CREATE TABLE IF NOT EXISTS uptime_checks (
  id               INTEGER PRIMARY KEY AUTOINCREMENT,
  domain_id        INTEGER NOT NULL REFERENCES domains(id) ON DELETE CASCADE,
  checked_at       TEXT NOT NULL DEFAULT (datetime('now')),
  status           TEXT NOT NULL,  -- 'up' | 'down' | 'unknown'
  response_time_ms INTEGER,
  http_status      INTEGER,
  error            TEXT
);
```

**Índice:** `(domain_id, checked_at)`.

#### `settings`
Almacén de configuraciones clave/valor.

```sql
CREATE TABLE IF NOT EXISTS settings (
  key        TEXT PRIMARY KEY,
  value      TEXT NOT NULL,
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
```

#### `audit_log`
Registro de auditoría inmutable de todas las acciones.

```sql
CREATE TABLE IF NOT EXISTS audit_log (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  entity_type  TEXT NOT NULL,   -- 'domain' | 'group' | 'tag' | 'settings' | ...
  entity_id    TEXT,            -- identificador del objeto afectado
  action       TEXT NOT NULL,   -- 'create' | 'delete' | 'update' | 'refresh' | ...
  old_value    TEXT,            -- JSON del valor anterior (para actualizaciones)
  new_value    TEXT,            -- JSON del nuevo valor
  ip_address   TEXT,            -- IP del solicitante
  user_agent   TEXT,            -- User-Agent del solicitante
  performed_by TEXT,            -- nombre de usuario del actor
  created_at   TEXT NOT NULL DEFAULT (datetime('now'))
);
```

**Índices:** `entity_type`, `action`, `created_at`.

#### `sessions`
Sesiones de autenticación de usuarios.

```sql
CREATE TABLE IF NOT EXISTS sessions (
  id         TEXT PRIMARY KEY,  -- UUID generado
  user_id    INTEGER,
  username   TEXT,
  expires_at TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
```

Las sesiones expiradas se limpian automáticamente cada hora mediante `startSessionCleanup()`.

#### `api_keys`
Claves de API de proveedores WHOIS almacenadas con cifrado AES-256.

```sql
CREATE TABLE IF NOT EXISTS api_keys (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  name       TEXT NOT NULL,
  key_value  TEXT NOT NULL,      -- cifrado AES-256-CBC
  provider   TEXT NOT NULL,      -- 'apilayer' | 'whoisxml' | 'custom'
  enabled    INTEGER DEFAULT 1,
  priority   INTEGER DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
```

#### `users`
Cuentas de usuario locales.

```sql
CREATE TABLE IF NOT EXISTS users (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  username     TEXT NOT NULL UNIQUE,
  password     TEXT NOT NULL,    -- hash bcrypt
  role         TEXT DEFAULT 'viewer',  -- 'admin' | 'editor' | 'viewer'
  created_at   TEXT NOT NULL DEFAULT (datetime('now')),
  last_login   TEXT
);
```

#### `webhooks`
Configuraciones de webhooks salientes.

```sql
CREATE TABLE IF NOT EXISTS webhooks (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  name       TEXT NOT NULL,
  url        TEXT NOT NULL,
  events     TEXT NOT NULL,      -- JSON array: ['domain.created', 'domain.expired', ...]
  secret     TEXT,               -- HMAC-SHA256 para verificación de payload
  enabled    INTEGER DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
```

#### `webhook_logs`
Historial de entregas de webhooks.

```sql
CREATE TABLE IF NOT EXISTS webhook_logs (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  webhook_id  INTEGER REFERENCES webhooks(id) ON DELETE CASCADE,
  event       TEXT NOT NULL,
  payload     TEXT NOT NULL,     -- JSON del payload enviado
  status_code INTEGER,
  response    TEXT,
  error       TEXT,
  delivered_at TEXT NOT NULL DEFAULT (datetime('now'))
);
```

#### `alert_rules`
Definiciones de condiciones de alerta.

```sql
CREATE TABLE IF NOT EXISTS alert_rules (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  domain_id   INTEGER REFERENCES domains(id) ON DELETE CASCADE,  -- NULL = global
  type        TEXT NOT NULL,   -- 'expiry' | 'downtime' | 'dns_change' | 'ssl_expiry'
  threshold   INTEGER,         -- días (para reglas de expiración)
  channels    TEXT NOT NULL,   -- JSON array: ['email', 'slack', 'ntfy']
  enabled     INTEGER DEFAULT 1,
  created_at  TEXT NOT NULL DEFAULT (datetime('now'))
);
```

#### `uptime_alerts`
Seguimiento del estado de alertas de tiempo de actividad (para evitar alertas duplicadas).

```sql
CREATE TABLE IF NOT EXISTS uptime_alerts (
  domain_id    INTEGER PRIMARY KEY REFERENCES domains(id) ON DELETE CASCADE,
  alerted_at   TEXT,
  alert_status TEXT   -- 'down' | 'recovered'
);
```

### 6.3 Estrategia de Migraciones

Todas las migraciones se ejecutan en `runMigrations()` en `src/database/index.ts` mediante SQL idempotente:

- Las tablas se crean con `CREATE TABLE IF NOT EXISTS`
- Las columnas se añaden con `PRAGMA table_info()` + `ALTER TABLE ADD COLUMN IF NOT EXISTS`
- Los índices se crean con `CREATE INDEX IF NOT EXISTS`
- Las migraciones se ejecutan en secuencia al inicio del servidor — sin archivos de versión separados

---

## 7. Servicios

### 7.1 Servicio WHOIS (`src/services/whois.ts`)

Orquesta la obtención de datos de registro WHOIS con múltiples proveedores de fallback.

**Cadena de proveedores:**
1. **APILayer** — API REST con tu `APILAYER_KEY`. Devuelve datos estructurados JSON.
2. **whois-json** — Consulta directa al servidor WHOIS del TLD. Parseo de texto sin procesar.
3. **RDAP** — Para TLDs como `.info` que usan RDAP (Registration Data Access Protocol).

**Campos devueltos:** `registrar`, `created_date`, `expiry_date`, `name_servers`, `error`.

**`onRefreshUpdate(callback)`** — registra un callback que recibe eventos de progreso durante actualizaciones bulk. Usado por el servidor WebSocket para transmitir actualizaciones en tiempo real.

### 7.2 Servicio de Comprobación de Salud (`src/services/healthcheck.ts`)

Realiza tres comprobaciones por dominio:

- **DNS** — `dns.resolve4(domain)` en Node.js. Devuelve el primer IPv4 resuelto.
- **HTTP** — petición HEAD con Axios, timeout de 5 segundos. Registra el código de estado.
- **SSL** — conexión TLS en puerto 443 con `tls.connect()`. Lee la fecha de expiración del certificado.

Los resultados se insertan en `domain_health`. Un broadcast WebSocket `health_update` se envía después de cada comprobación.

### 7.3 Servicio de Tiempo de Actividad (`src/services/uptime.ts`)

Bucle de monitoreo en segundo plano:
- Inicia con `startUptimeMonitoring()`, que programa un intervalo en base al ajuste `uptime_interval`
- En cada tick, recorre todos los dominios activos y realiza peticiones HEAD
- Registra los resultados en `uptime_checks`
- Calcula el porcentaje de tiempo de actividad en los últimos 24h/7d/30d
- Si el dominio cambia de `up` a `down` (y se supera el threshold), dispara notificaciones

### 7.4 Servicio Scheduler (`src/services/scheduler.ts`)

Gestiona trabajos cron usando `node-cron`:

| Trabajo | Cron por defecto | Acción |
|---------|-----------------|--------|
| WHOIS Refresh | `0 2 * * 0` | Llama a `refreshAllDomains()` |
| Alertas de email | `0 9 * * *` | Comprueba expiración, envía emails |
| Limpieza de datos | `0 3 * * *` | Llama a `runAutoCleanup()` |

El schedule se puede actualizar en tiempo de ejecución mediante `reinitializeScheduler()` cuando se guardan las configuraciones.

### 7.5 Servicio de Email (`src/services/email.ts`)

Usa Nodemailer con transporte SMTP:
- **`initializeEmail()`** — verifica la conexión SMTP al inicio
- **`sendExpiryAlerts(domains)`** — envía email HTML con lista de dominios a punto de expirar
- **`sendUptimeAlert(domain, status)`** — notifica cuando un dominio cae o se recupera
- **`sendTestEmail(to)`** — endpoint de prueba desde Settings

Soporta todos los proveedores SMTP: Gmail (App Password), SendGrid, Mailgun, servidores personalizados.

### 7.6 Servicio Slack (`src/services/slack.ts`)

Entrega notificaciones a Slack mediante webhooks entrantes:
- Formatea mensajes como bloques de Slack con iconos de estado color-codificados
- Usado para alertas de tiempo de actividad y expiración

### 7.7 Servicio Signal/ntfy (`src/services/signal.ts`)

Envía notificaciones push al servidor ntfy configurado:
- Soporta autenticación con bearer token (`NTFY_TOKEN`)
- La prioridad del mensaje se establece en base a la urgencia de la alerta

### 7.8 Servicio Webhooks (`src/services/webhooks.ts`)

Entrega webhooks salientes a URLs configuradas:
- Construye payload JSON con `event`, `domain`, `timestamp`, `data`
- Firma el payload con HMAC-SHA256 usando el `secret` del webhook (header `X-Signature`)
- Registra cada intento en `webhook_logs` (éxito o fallo)
- Reintenta en fallidos con backoff exponencial

### 7.9 Servicio WebSocket (`src/services/websocket.ts`)

Gestiona el broadcasting en tiempo real:
- Adjunto al mismo servidor HTTP en el path `/ws`
- Eventos emitidos: `connected`, `refresh_progress`, `refresh_complete`, `domain_updated`, `domain_added`, `health_update`, `uptime_update`
- El objeto singleton `wsService` es importado por rutas y otros servicios para emitir eventos

### 7.10 Servicio de Limpieza (`src/services/cleanup.ts`)

Elimina registros de logs antiguos según los ajustes de retención:
- `audit_log` — elimina registros más antiguos que `audit_retention_days`
- `domain_health` — elimina registros más antiguos que `health_retention_days`
- `uptime_checks` — elimina registros más antiguos que `health_retention_days`
- `webhook_logs` — elimina registros más antiguos que 30 días

---

## 8. Middleware

### 8.1 Autenticación (`src/middleware/auth.ts`)

Dos funciones de middleware:

**`optionalAuthMiddleware`** — intenta parsear la sesión de la cookie. Si es válida, establece `req.username` y `req.userId`. Si no, sigue sin error.

**`authMiddleware`** — igual que `optionalAuthMiddleware`, pero devuelve `401 Unauthorized` si no hay sesión válida. Aplicado a todas las rutas `/api/*` cuando `AUTH_ENABLED=true`.

**`initializeAuth()`** — ejecutado al inicio. Si `AUTH_ENABLED=true` y no existe ningún usuario admin, crea el usuario admin usando `ADMIN_USERNAME`/`ADMIN_PASSWORD` del entorno.

### 8.2 Logging de Requests (`src/middleware/logging.ts`)

Registra cada request HTTP con Pino:
- Método, path, código de estado, tiempo de respuesta (ms)
- Excluye `/api/health` de los logs para reducir el ruido

### 8.3 Rate Limiting (`src/middleware/rateLimit.ts`)

Usando `express-rate-limit`:
- **`standardLimiter`** — aplicado a todas las rutas `/api/*`: 100 requests por IP por 15 minutos
- Responde con `429 Too Many Requests` al superar el límite

### 8.4 Manejo de Errores (`src/middleware/errorHandler.ts`)

- **`notFoundHandler`** — catch-all para rutas no encontradas, devuelve `404 { error: "Not found" }`
- **`errorHandler`** — captura todos los errores Express no manejados, registra con Pino, devuelve `500 { error: "Internal server error" }`

---

## 9. Rutas de API — Referencia Completa

### 9.1 Autenticación (`/api/auth`)

#### `POST /api/auth/login`
**Cuerpo:** `{ username: string, password: string }`
**Respuesta:** `{ success: true, username: string }`
Verifica credenciales con bcrypt, crea sesión, establece cookie `session_id`.

#### `POST /api/auth/logout`
**Respuesta:** `{ success: true }`
Elimina la sesión de la DB, borra la cookie.

#### `GET /api/auth/me`
**Respuesta:** `{ username: string, role: string }` o `401`.

#### `GET /api/auth/status`
**Respuesta:** `{ auth_enabled: boolean }`
Endpoint público para que el frontend sepa si mostrar la pantalla de login.

---

### 9.2 Dominios (`/api/domains`)

#### `GET /api/domains`
Lista dominios con paginación, búsqueda y filtros.

**Query params:**
| Parámetro | Tipo | Descripción |
|-----------|------|-------------|
| `include` | `all` \| `active` | `all` incluye borrados suavemente. Por defecto: `active` |
| `page` | number | Número de página (empieza en 1) |
| `limit` | number | Elementos por página (máx 500) |
| `search` | string | Filtra por nombre de dominio, registrar, nameservers |
| `status` | string | `expired`, `expiring15`, `expiring30`, `expiring90`, `healthy` |
| `group_id` | number | Filtra por grupo |
| `tag_id` | number | Filtra por etiqueta |
| `registrar` | string | Filtra por registrar |
| `sort` | string | Campo por el que ordenar |
| `order` | `asc` \| `desc` | Dirección de ordenación |

**Respuesta:**
```json
{
  "domains": [...],
  "total": 150,
  "page": 1,
  "limit": 50,
  "pages": 3
}
```

#### `POST /api/domains`
**Cuerpo:** `{ domain: string, group_id?: number }`
Valida el formato del dominio, comprueba duplicados, inserta, inicia obtención de WHOIS en segundo plano.

#### `GET /api/domains/:id`
Devuelve dominio con datos de salud y tiempo de actividad actuales.

#### `DELETE /api/domains/:domain`
Borrado suave — establece `deleted_at` al timestamp actual. Registra en audit_log.

#### `GET /api/domains/deleted`
Lista todos los dominios borrados suavemente (donde `deleted_at IS NOT NULL`).

#### `POST /api/domains/:id/restore`
Restablece `deleted_at` a NULL. Registra en audit_log.

#### `POST /api/domains/:id/validate-ns`
Copia `name_servers` a `name_servers_prev` para reconocer el cambio de NS actual.

#### `POST /api/domains/:id/group`
**Cuerpo:** `{ group_id: number | null }`
Asigna o elimina la asignación de grupo.

#### `PUT /api/domains/:id/tags`
**Cuerpo:** `{ tag_ids: number[] }`
Reemplaza todas las asociaciones de etiquetas con el conjunto proporcionado.

---

### 9.3 Grupos (`/api/groups`)

#### `GET /api/groups`
Lista todos los grupos con `domain_count`.

#### `POST /api/groups`
**Cuerpo:** `{ name: string, color: string, description?: string }`

#### `PUT /api/groups/:id`
**Cuerpo:** `{ name?: string, color?: string, description?: string }`

#### `DELETE /api/groups/:id`
Elimina el grupo. Los dominios del grupo obtienen `group_id = NULL`.

---

### 9.4 Etiquetas (`/api/tags`)

#### `GET /api/tags`
Lista todas las etiquetas.

#### `POST /api/tags`
**Cuerpo:** `{ name: string, color: string }`

#### `DELETE /api/tags/:id`

#### `POST /api/domains/:id/tags/:tagId`
Añade una etiqueta a un dominio.

#### `DELETE /api/domains/:id/tags/:tagId`
Elimina una etiqueta de un dominio.

---

### 9.5 Actualización WHOIS (`/api/refresh`)

#### `GET /api/refresh/status`
Devuelve el estado actual de progreso de actualización:
```json
{ "running": true, "total": 150, "completed": 42, "current": "example.com", "errors": 2 }
```

#### `POST /api/refresh`
Inicia una actualización WHOIS bulk de todos los dominios activos. Ejecuta en segundo plano; las actualizaciones de progreso se emiten vía WebSocket.

#### `POST /api/refresh/:domain`
Actualiza un único dominio. Espera a que se complete y devuelve los datos actualizados.

---

### 9.6 Verificaciones de Salud (`/api/health`)

#### `GET /api/health`
Estado de salud de la aplicación:
```json
{ "status": "ok", "uptime": 12345, "database": "ok", "version": "2.0.0" }
```

#### `GET /api/health/summary`
Conteos de salud de dominios:
```json
{ "dns_ok": 120, "dns_fail": 5, "http_ok": 118, "http_fail": 7, "ssl_ok": 115, "ssl_fail": 10 }
```

#### `GET /api/health/domain/:id`
Historial de comprobaciones de salud para un dominio.

#### `POST /api/health/domain/:id`
Ejecuta una comprobación de salud para un dominio de forma síncrona.

#### `POST /api/health/check-all`
Inicia comprobaciones de salud para todos los dominios activos en segundo plano.

---

### 9.7 Tiempo de Actividad (`/api/uptime`)

#### `GET /api/uptime/stats`
Estadísticas de tiempo de actividad de todos los dominios:
```json
[{ "domain_id": 1, "domain": "example.com", "uptime_24h": 99.8, "uptime_7d": 99.5, "current_status": "up", "response_time_avg": 145 }]
```

#### `GET /api/uptime/domain/:id`
Historial de tiempo de actividad para un dominio (últimas 24h de pings).

#### `POST /api/uptime/domain/:id`
Activa una comprobación de tiempo de actividad manual.

#### `POST /api/uptime/restart`
Reinicia el servicio de monitoreo (útil después de cambiar el intervalo en Settings).

---

### 9.8 Importación / Exportación (`/api/import`, `/api/export`)

#### `GET /api/import/template`
Descarga una plantilla CSV con columnas: `domain,group_name,tags`.

#### `POST /api/import/csv`
Cuerpo multipart/form-data con campo `file`. Parsea el CSV, omite duplicados, inserta dominios nuevos.

**Respuesta:**
```json
{ "imported": 45, "skipped": 5, "errors": ["bad-domain: formato inválido"] }
```

#### `GET /api/export/csv`
Descarga todos los dominios activos como CSV.

#### `GET /api/export/json`
Descarga todos los dominios activos como JSON.

---

### 9.9 Configuraciones (`/api/settings`)

#### `GET /api/settings`
Devuelve todas las configuraciones como objeto clave/valor.

#### `PUT /api/settings`
**Cuerpo:** objeto clave/valor con configuraciones a actualizar.
Invalida el caché de configuraciones en memoria. Si se cambian los schedules, reinicia el scheduler.

#### `POST /api/settings/email/test`
Envía un email de prueba a los destinatarios configurados. Devuelve éxito/error.

---

### 9.10 Log de Auditoría (`/api/audit`)

#### `GET /api/audit`
**Query params:** `limit` (por defecto 100), `entity_type`, `action`, `performed_by`, `from`, `to`

**Respuesta:**
```json
[{
  "id": 1,
  "entity_type": "domain",
  "entity_id": "example.com",
  "action": "create",
  "old_value": null,
  "new_value": "{\"domain\":\"example.com\"}",
  "ip_address": "127.0.0.1",
  "performed_by": "admin",
  "created_at": "2026-02-21T10:30:00.000Z"
}]
```

---

### 9.11 Usuarios (`/api/users`)

#### `GET /api/users`
Lista todos los usuarios (sin contraseñas en la respuesta).

#### `POST /api/users`
**Cuerpo:** `{ username: string, password: string, role: "admin" | "editor" | "viewer" }`

#### `PUT /api/users/:id`
**Cuerpo:** `{ username?: string, password?: string, role?: string }`

#### `DELETE /api/users/:id`
No se puede eliminar el último usuario admin.

---

### 9.12 Claves de API (`/api/apikeys`)

#### `GET /api/apikeys`
Lista claves de API (valores cifrados no expuestos).

#### `POST /api/apikeys`
**Cuerpo:** `{ name: string, key_value: string, provider: string, priority?: number }`
Cifra `key_value` con AES-256 antes de almacenar.

#### `PUT /api/apikeys/:id`
Actualiza metadatos. Si se proporciona `key_value`, lo vuelve a cifrar.

#### `DELETE /api/apikeys/:id`

---

### 9.13 Webhooks (`/api/webhooks`)

#### `GET /api/webhooks`
Lista webhooks configurados.

#### `POST /api/webhooks`
**Cuerpo:** `{ name: string, url: string, events: string[], secret?: string }`

Eventos disponibles: `domain.created`, `domain.deleted`, `domain.expired`, `domain.expiring`, `domain.down`, `domain.recovered`, `domain.ns_changed`.

#### `PUT /api/webhooks/:id`

#### `DELETE /api/webhooks/:id`

#### `GET /api/webhooks/:id/log`
Historial de entregas de un webhook.

---

### 9.14 Métricas (`/api/metrics`)

Devuelve métricas en formato texto compatible con Prometheus:

```
# HELP domain_monitor_domains_total Total domains tracked
# TYPE domain_monitor_domains_total gauge
domain_monitor_domains_total 150

# HELP domain_monitor_domains_expired Expired domains
# TYPE domain_monitor_domains_expired gauge
domain_monitor_domains_expired 3
```

---

### 9.15 RSS Feed (`/rss`)

Devuelve un feed RSS 2.0 con los eventos de dominio recientes del log de auditoría. Compatible con cualquier lector de feeds.

---

### 9.16 Estado Público (`/api/status`)

Devuelve datos de estado para la página `status.html`:

```json
{
  "status": "operational",
  "updated_at": "2026-02-21T10:00:00.000Z",
  "summary": { "total": 150, "healthy": 140, "errors": 5, "expiring_30d": 8, "expired": 2 },
  "groups": [{
    "id": 1, "name": "Production", "color": "#22c55e",
    "domains": 45, "status": "operational",
    "health": { "dns_ok": 44, "dns_fail": 1, "http_ok": 43, "http_fail": 2, "ssl_ok": 44, "ssl_fail": 1 },
    "expiry": { "expiring_30d": 3, "expired": 0 }
  }]
}
```

---

## 10. Protocolo WebSocket

Conéctate a `ws://localhost:3000/ws` (o `wss://` en producción).

### Mensajes del Servidor → Cliente

Todos los mensajes son `JSON.parse`-ados objetos con `type` y `payload`.

| Tipo | Payload | Cuándo se envía |
|------|---------|----------------|
| `connected` | `{ message: "Connected to Domain Monitor" }` | Al conectar |
| `refresh_progress` | `{ total, completed, current, errors }` | Durante actualización WHOIS bulk |
| `refresh_complete` | `{ total, errors, duration_ms }` | Cuando termina la actualización |
| `domain_updated` | Objeto dominio completo | Después de actualización WHOIS o comprobación de salud |
| `domain_added` | Objeto dominio | Cuando se añade un nuevo dominio |
| `health_update` | `{ domain_id, ...health_data }` | Después de comprobación de salud |
| `uptime_update` | `{ domain_id, status, response_time_ms }` | Después de ping de tiempo de actividad |

---

## 11. Esquemas de Validación

Definidos en `src/config/schema.ts` con Zod. Ejemplos:

```typescript
// Añadir un dominio
const AddDomainSchema = z.object({
  domain: z.string().min(1).max(253).regex(/^[a-zA-Z0-9][a-zA-Z0-9-_.]*\.[a-zA-Z]{2,}$/),
  group_id: z.number().int().positive().optional()
});

// Crear un grupo
const CreateGroupSchema = z.object({
  name: z.string().min(1).max(50),
  color: z.string().regex(/^#[0-9a-fA-F]{6}$/),
  description: z.string().max(200).optional()
});

// Parámetros de consulta para listar dominios
const DomainQuerySchema = z.object({
  include: z.enum(['active', 'all']).optional().default('active'),
  page: z.coerce.number().int().min(1).optional().default(1),
  limit: z.coerce.number().int().min(1).max(500).optional().default(50),
  search: z.string().optional(),
  status: z.string().optional(),
  group_id: z.coerce.number().int().optional(),
  sort: z.string().optional(),
  order: z.enum(['asc', 'desc']).optional().default('asc')
});
```

---

## 12. Tipos TypeScript

### `Domain` (`src/types/domain.ts`)

```typescript
interface Domain {
  id?: number;
  domain: string;
  registrar: string;
  created_date: string;
  expiry_date: string;
  name_servers: string[];
  name_servers_prev: string[];
  last_checked: string | null;
  error: string | null;
  group_id?: number | null;
  deleted_at?: string | null;
  // Campos enriquecidos del join
  group_name?: string;
  group_color?: string;
  tags?: Tag[];
  health?: DomainHealth;
  uptime?: UptimeStats;
}

interface DomainHealth {
  dns_resolved: boolean;
  dns_ip?: string;
  http_status?: number;
  ssl_valid: boolean;
  ssl_expiry?: string;
  checked_at: string;
}

interface UptimeStats {
  current_status: 'up' | 'down' | 'unknown';
  uptime_24h: number;
  uptime_7d: number;
  response_time_avg: number;
}
```

### `AuditEntry` (`src/types/audit.ts`)

```typescript
interface AuditEntry {
  id?: number;
  entity_type: string;
  entity_id?: string;
  action: string;
  old_value?: string;
  new_value?: string;
  ip_address?: string;
  user_agent?: string;
  performed_by?: string;
  created_at?: string;
}
```

### `AuthenticatedRequest` (`src/types/api.ts`)

```typescript
interface AuthenticatedRequest extends Request {
  username?: string;
  userId?: number;
  sessionId?: string;
}
```

---

## 13. Frontend (SPA)

### 13.1 Descripción General

El frontend es una **Aplicación de Página Única (SPA)** de JavaScript vanilla en `public/app.js` (~5500 líneas). Sin React, sin Vue — solo JavaScript DOM directo, Chart.js y Font Awesome.

El estado se gestiona mediante el objeto global `state`:
```javascript
const state = {
  domains: [],          // array de dominios completo
  groups: [],           // todos los grupos
  tags: [],             // todas las etiquetas
  settings: {},         // configuraciones de la app
  pagination: { enabled: false, page: 1, limit: 50, total: 0 },
  filters: { search: '', status: '', group: '', registrar: '', tag: '' },
  sort: { field: 'domain', direction: 'asc' },
  charts: {},           // referencias a instancias de Chart.js
  ws: null,             // instancia WebSocket
};
```

### 13.2 Sistema de Rutas Hash

La SPA usa hash routing:

| Hash | Vista mostrada |
|------|---------------|
| `#dashboard` | Panel principal con widgets |
| `#domains` | Tabla de dominios |
| `#audit` | Log de auditoría |
| `#settings` | Panel de configuraciones |
| `#settings/groups` | Sub-tab de grupos |
| `#settings/tags` | Sub-tab de etiquetas |
| `#settings/email` | Sub-tab de email |
| `#settings/uptime` | Sub-tab de tiempo de actividad |
| `#settings/users` | Sub-tab de usuarios |
| `#settings/webhooks` | Sub-tab de webhooks |

### 13.3 Widgets del Dashboard

Los widgets son divs `draggable="true"` con atributo `data-widget-id`. El orden se persiste en `localStorage` como JSON array de IDs. Los widgets disponibles:

| `data-widget-id` | Función de actualización | Descripción |
|-----------------|--------------------------|-------------|
| `uptime-status` | `updateUptimeStatusWidget()` | Up/Down/Unknown conteos grandes |
| `critical-alerts` | parte de `load()` | Lista alertas urgentes |
| `groups-status` | `updateGroupsStatusWidget()` | Estado por grupo |
| `mammoth` | `updateMammothWidget()` | Métricas del grupo Mammoth |
| `timeline` | `updateCharts()` | Gráfico de línea de tiempo Chart.js |
| `activity` | `updateActivityLog()` | Feed de actividad reciente |

### 13.4 Función `load()`

La función principal que obtiene y renderiza todos los datos:

1. `GET /api/domains` — obtiene dominios (paginados o todos)
2. `GET /api/groups` — obtiene grupos (en caché si ya están en state)
3. `GET /api/tags` — obtiene etiquetas
4. Calcula estadísticas de expiración (expired/exp15/exp30/exp90/exp6m)
5. Calcula alertas críticas desde `state.domains` (lista completa, deduplicadas por clave `dominio:tipo`)
6. `renderDomains(displayDomains)` — construye filas de tabla
7. `updateCharts(state.domains)` — actualiza gráfico de línea de tiempo
8. `updateGroupsStatusWidget(state.domains)` — actualiza widget de grupos
9. `updateMammothWidget(state.domains)` — actualiza widget Mammoth
10. `updateActivityLog()` — obtiene y muestra log de auditoría reciente

### 13.5 Actualizaciones en Tiempo Real

El cliente WebSocket en `initWebSocket()` escucha mensajes y actualiza selectivamente el DOM:

- `domain_updated` — actualiza la fila de un solo dominio en la tabla y recalcula estadísticas
- `domain_added` — llama a `load()` para obtener la lista completa actualizada
- `refresh_progress` — actualiza la barra de progreso en el widget de alertas críticas
- `health_update` — actualiza los indicadores de salud en la fila del dominio
- `uptime_update` — actualiza la barra de latidos y el estado en la fila del dominio

### 13.6 Sistema de Log de Auditoría del Frontend

**`formatAuditLog(log)`** — convierte entradas de auditoría sin procesar en mensajes legibles:

| Tipo de entidad + Acción | Mensaje generado |
|--------------------------|-----------------|
| `domain` + `create` | "Added domain example.com" |
| `domain` + `delete` | "Deleted domain example.com" |
| `domain` + `refresh` | "Refreshed WHOIS for example.com" |
| `group` + `create` | "Created group Production" |
| `settings` + `update` | "Updated settings" |

**`loadAuditLog()`** — renderiza entradas usando `formatAuditLog()`, muestra el username del actor (campo `performed_by`) con icono de usuario.

---

## 14. Página de Estado Pública

`public/status.html` es una página HTML autocontenida que muestra el estado del sistema a visitantes externos sin necesidad de autenticación.

### Características

- **Sin dependencias de framework** — JavaScript vanilla, sin React/Vue
- **Sin credenciales de autenticación** — llama al endpoint público `/api/status`
- **Se refresca automáticamente** — cada 60 segundos vuelve a obtener datos
- **Soporte de modo oscuro** — respeta `prefers-color-scheme`

### Estructura de la Página

1. **Banner de estado** — "Operational" / "Warning" / "Degraded" con icono de color
2. **Cuadrícula de estadísticas** — Total / Healthy / Expiring 30d / Expired / Errors (5 tarjetas)
3. **Sección de grupos** — por cada grupo:
   - Nombre del grupo (punto de color) + conteo de dominios + pastilla de estado
   - Fila de salud: DNS OK/Fail • HTTP OK/Fail • SSL OK/Fail
   - Fila de expiración: X expirando en 30d, Y expirados
   - Enlace "Ver en la app →"
4. **Sección de enlaces rápidos** — Dashboard, Dominios, Log de Auditoría, Configuraciones
5. **Footer** — nota de auto-refresco, timestamp de última actualización

---

## 15. Sistema de Registro de Auditoría

Cada acción que modifica datos registra una entrada en `audit_log` mediante la función `logAudit()`.

### `logAudit(entry: AuditEntry)`

```typescript
logAudit({
  entity_type: 'domain',
  entity_id: 'example.com',
  action: 'create',
  new_value: JSON.stringify(domainData),
  ip_address: req.ip,
  user_agent: req.headers['user-agent'],
  performed_by: (req as AuthenticatedRequest).username
});
```

### Funciones Helper

| Función | Qué registra |
|---------|-------------|
| `auditDomainCreate(domain, data, ip, ua, by)` | Creación de dominio |
| `auditDomainDelete(domain, oldData, ip, ua, by)` | Borrado de dominio |
| `auditBulkRefresh(count, domains, by)` | Actualización WHOIS bulk |
| `auditBulkHealthCheck(count, domains, by)` | Comprobación de salud bulk |
| `auditImport(count, skipped, ip, ua, by)` | Importación CSV |

### Tipos de Acción

`create`, `delete`, `update`, `restore`, `refresh`, `health_check`, `import`, `export`, `login`, `logout`, `validate_ns`, `bulk_refresh`, `bulk_health_check`

### Retención

Configurada mediante `audit_retention_days` en Settings (por defecto: 90 días). La limpieza se ejecuta según `auto_cleanup_enabled`.

---

## 16. Modelo de Seguridad

### Headers HTTP

En producción (`NODE_ENV=production`), Helmet aplica:
- **Content Security Policy** — limita la ejecución de scripts/estilos a fuentes de confianza
- **Strict-Transport-Security** — 1 año, incluye subdominios (HSTS)
- **X-Frame-Options** — `SAMEORIGIN` (anti-clickjacking)
- **X-Content-Type-Options** — `nosniff`

En desarrollo, Helmet se aplica con mínimas restricciones para evitar interferir con el servidor local.

### Autenticación

- Sesiones basadas en cookies con ID de sesión UUID almacenado en SQLite
- Las contraseñas se hashean con bcrypt (factor de coste 12)
- Las sesiones expiran según `SESSION_TTL_HOURS`
- Las sesiones expiradas se limpian cada hora

### Claves de API

Las claves de API de proveedores WHOIS se almacenan cifradas con AES-256-CBC. La clave de cifrado se deriva del `SESSION_SECRET` del entorno.

### Rate Limiting

100 requests por IP por ventana de 15 minutos en todas las rutas `/api/*`. Responde `429` con header `Retry-After`.

### Validación de Entradas

Todos los cuerpos de requests y query params se validan con esquemas Zod antes de llegar a los handlers de ruta. Las entradas inválidas devuelven `400 Bad Request` con detalles del error.

---

## 17. Sistema de Logging

Usando **Pino** con `pino-pretty` para desarrollo y JSON estructurado para producción.

### Niveles de Log

| Nivel | Uso |
|-------|-----|
| `debug` | Flujo detallado de operaciones (activado con `LOG_LEVEL=debug`) |
| `info` | Eventos normales del sistema (inicio del servidor, trabajos cron) |
| `warn` | Fallos recuperables (timeout WHOIS, fallo de entrega de email) |
| `error` | Errores que afectan funcionalidad (DB bloqueada, SMTP no disponible) |

### Rotación de Archivos de Log

Si `LOG_TO_FILE=true`, `pino-roll` rota los archivos de log diariamente en el directorio `LOG_DIR`.

```bash
# Ver logs en tiempo real (si LOG_TO_FILE=true)
tail -f logs/app.log | npx pino-pretty

# Con Docker
docker-compose logs -f
```

---

## 18. Despliegue con Docker

### `docker-compose.yml`

```yaml
version: '3.8'
services:
  domain-monitor:
    build: .
    ports:
      - "3000:3000"
    volumes:
      - ./data:/app/data      # Persistencia de la base de datos SQLite
      - ./logs:/app/logs      # Logs (si LOG_TO_FILE=true)
    environment:
      - NODE_ENV=production
      - APILAYER_KEY=${APILAYER_KEY}
      - AUTH_ENABLED=true
      - ADMIN_USERNAME=${ADMIN_USERNAME}
      - ADMIN_PASSWORD=${ADMIN_PASSWORD}
      - SESSION_SECRET=${SESSION_SECRET}
    restart: unless-stopped
```

### Construcción Personalizada

```bash
# Construir imagen
docker build -t domain-monitor .

# Ejecutar con variables de entorno
docker run -d \
  -p 3000:3000 \
  -v $(pwd)/data:/app/data \
  -e APILAYER_KEY=tu_clave \
  -e AUTH_ENABLED=true \
  -e ADMIN_PASSWORD=secreto \
  domain-monitor
```

### Configuración de Proxy Inverso (Nginx)

```nginx
server {
    listen 80;
    server_name monitor.example.com;

    location / {
        proxy_pass http://localhost:3000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";  # Requerido para WebSocket
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}
```

---

## 19. Diagramas de Flujo de Datos

### Flujo: Añadir un Dominio

```
Usuario escribe "example.com" → hace clic en Añadir
       │
       ▼
Frontend: POST /api/domains { domain: "example.com" }
       │
       ▼
Server: valida formato → comprueba unicidad → inserta en DB
       │
       ▼
WS Broadcast: domain_added → todos los navegadores conectados actualizan
       │
       ▼
Background: inicia obtención WHOIS (APILayer → fallback whois-json → RDAP)
       │
       ├─► Comprobación de salud: DNS + HTTP + SSL
       │
       └─► DB: actualiza dominio con todos los datos obtenidos
              │
              ▼
          WS Broadcast: domain_updated → UI se refresca con datos completos
```

### Flujo: Trabajo Cron de Actualización WHOIS

```
node-cron: dispara "0 2 * * 0"
       │
       ▼
scheduler.ts: llama refreshAllDomains()
       │
       ▼
Bucle sobre todos los dominios activos:
  ├─► whois.ts: obtiene datos WHOIS (con reintentos)
  ├─► DB: actualiza registro del dominio
  ├─► WS: emite refresh_progress { total, completed, current }
  └─► Email/Slack: comprueba expiración, envía alertas si necesario
       │
       ▼
WS: emite refresh_complete { total, errors, duration_ms }
```

### Flujo: Ping de Tiempo de Actividad

```
Intervalo (cada N minutos)
       │
       ▼
uptime.ts: recorre todos los dominios activos
       │
       ▼
Para cada dominio:
  ├─► HEAD request con timeout de 5s
  ├─► DB: inserta registro uptime_check
  ├─► WS: emite uptime_update
  └─► Si estado cambia (up→down o down→up):
       ├─► Email/Slack/ntfy: envía alerta
       ├─► Webhooks: dispara evento domain.down o domain.recovered
       └─► DB: actualiza uptime_alerts
```

---

## 20. Preguntas Frecuentes

### Instalación y Configuración

**P: ¿Cómo obtengo una clave de API WHOIS?**
R: Ve a [apilayer.com/marketplace/whois-api](https://apilayer.com/marketplace/whois-api). El plan gratuito incluye 500 requests/mes. Coloca la clave en `APILAYER_KEY` en tu archivo `.env`.

**P: ¿Puedo ejecutar Domain Monitor sin una clave de API WHOIS?**
R: Sí, pero los datos WHOIS serán menos fiables. El sistema recurre automáticamente a consultas WHOIS directas y RDAP, que pueden estar limitadas por los registros de TLD.

**P: ¿Funciona detrás de un proxy inverso?**
R: Sí. Asegúrate de que el proxy reenvía el header `Upgrade` para soporte WebSocket. Consulta el ejemplo de configuración Nginx en la Sección 18.

**P: ¿Cómo activo la autenticación?**
R: Establece `AUTH_ENABLED=true`, `ADMIN_USERNAME=admin`, `ADMIN_PASSWORD=tu_contraseña` en `.env`. Reinicia el servidor.

**P: ¿Dónde se almacenan los datos?**
R: En el archivo SQLite especificado por `DB_PATH` (por defecto `./domains.db`). Haz copia de seguridad de este archivo para no perder datos.

**P: ¿Puedo importar dominios que ya tengo en una hoja de cálculo?**
R: Sí. Ve a Settings > Import/Export, descarga la plantilla CSV, rellena tus dominios y sube el archivo. También puedes pegar dominios directamente en el modo de adición bulk.

---

### Funcionalidades

**P: ¿Con qué frecuencia se actualizan los datos WHOIS?**
R: Por defecto los domingos a las 2am (configurable en Settings > General). También puedes actualizar manualmente cualquier dominio con el icono de refresco, o todos a la vez con el botón Refresh All.

**P: ¿Qué hace el campo "NS Status"?**
R: Compara los nameservers actuales con los nameservers "validados previamente". Si son diferentes aparece "Changed". Haz clic en Validate para reconocer el cambio actual. Esto ayuda a detectar secuestros de DNS.

**P: ¿Puedo monitorear sitios sin registrar los dominios?**
R: Los dominios se registran para su seguimiento WHOIS, pero las comprobaciones de salud y uptime funcionan sobre la base del nombre de dominio. No necesitas ser el propietario del registro del dominio para monitorearlo.

**P: ¿Cómo funcionan los grupos?**
R: Los grupos son carpetas de color que organizan dominios. Un dominio solo puede pertenecer a un grupo. Los grupos aparecen en los filtros de la tabla, en el widget del dashboard y en la página de estado.

**P: ¿Cuál es la diferencia entre Tags y Grupos?**
R: Un dominio puede tener múltiples etiquetas pero solo un grupo. Usa grupos para la categoría principal (por cliente, por proyecto) y etiquetas para atributos adicionales (producción, crítico, renovación automática).

**P: ¿Qué es el widget "Mammoth"?**
R: Un widget dedicado para el grupo específicamente nombrado "Mammoth". Si tienes un grupo con ese nombre, el widget muestra conteos de Up/Down/Unknown más chips de salud DNS/HTTP/SSL. Si el grupo no existe, el widget muestra "Group not found".

**P: ¿Cómo funciona el widget "Sites per Group"?**
R: Muestra una fila por cada grupo con al menos un dominio. Cada fila tiene el nombre del grupo, conteo de dominios y una pastilla verde "OK" o ámbar "Issues" (basada en si algún dominio tiene errores o está expirado).

---

### Alertas y Notificaciones

**P: ¿Cómo configuro alertas de email?**
R: Ve a Settings > Email. Activa las alertas de email, introduce las direcciones de destinatarios (separadas por comas), establece los días de aviso (ej. 7,14,30) y haz clic en Test Email para verificar.

**P: Para Gmail ¿cómo obtengo una App Password?**
R: Ve a tu cuenta Google > Seguridad > Verificación en dos pasos (debe estar activada) > App passwords. Genera una contraseña para "Mail" y úsala como `SMTP_PASS`.

**P: ¿Cómo configuro alertas de Slack?**
R: En tu espacio de trabajo de Slack, crea una Incoming Webhook App, copia la URL del webhook y pégala en Settings > Notifications > Slack Webhook URL.

**P: ¿Qué es ntfy/Signal?**
R: [ntfy.sh](https://ntfy.sh) es un servicio de notificaciones push. Puedes usar la instancia pública gratuita o autoalojar la tuya. Domain Monitor publicará en el tópico que configures, y puedes recibir esas notificaciones en la app móvil de ntfy o integrarlas con Signal a través de bridges.

**P: ¿Qué son los webhooks salientes?**
R: Webhooks salientes envían solicitudes HTTP POST a una URL de tu elección cuando ocurren eventos (dominio creado, dominio caído, dominio expirado, etc.). Úsalos para integrar con cualquier sistema externo: PagerDuty, sistemas de tickets, automatizaciones propias.

**P: ¿Cómo funciona la firma de webhook?**
R: Si configuras un `secret` para un webhook, cada payload se firma con HMAC-SHA256. La firma se envía en el header `X-Signature`. Verifica esto en tu endpoint receptor para asegurar que la solicitud proviene de Domain Monitor.

---

### Técnico

**P: ¿Por qué SQLite en lugar de PostgreSQL?**
R: SQLite es perfectamente adecuado para este caso de uso (una sola instancia, escrituras moderadas, sin conexiones concurrentes de múltiples procesos). Elimina la necesidad de ejecutar un servidor de base de datos separado, simplificando enormemente el despliegue y las copias de seguridad.

**P: ¿Puedo ejecutar múltiples instancias del servidor?**
R: No sin modificaciones. SQLite no admite múltiples escritores concurrentes desde diferentes procesos. Para alta disponibilidad, úsalo detrás de un balanceador de carga con sticky sessions y una sola instancia de servidor, o migra a PostgreSQL.

**P: ¿Cómo hago una copia de seguridad de los datos?**
R: Copia el archivo `domains.db` mientras el servidor está apagado, o usa el comando integrado `sqlite3 domains.db ".backup backup.db"` que es seguro durante la ejecución gracias al modo WAL.

**P: ¿Cómo actualizo a una versión nueva?**
R:
1. `git pull origin master`
2. `npm install` (en caso de nuevas dependencias)
3. `npm run build`
4. Reinicia el servidor

Las migraciones de base de datos se ejecutan automáticamente al inicio del servidor.

**P: ¿Qué hace exactamente `performed_by` en el log de auditoría?**
R: Cada entrada del log de auditoría registra el nombre de usuario del usuario autenticado que realizó la acción. Si la autenticación está desactivada, `performed_by` es null. Esto permite ver quién añadió, eliminó o modificó qué en un entorno multiusuario.

**P: ¿Cómo funciona la deduplicación de alertas críticas?**
R: Las alertas críticas del dashboard se calculan a partir de la lista de dominios completa (`state.domains`), no solo de la página actual. Esto significa que cambiar de página no cambia el conjunto de alertas. Además, las alertas se deduplicado por `dominio:tipo` para que el mismo dominio no aparezca en la lista dos veces por el mismo problema.

**P: ¿Cómo funciona la autenticación con roles de usuario?**
R: Los usuarios tienen roles `admin`, `editor` o `viewer`. Los administradores pueden hacer todo. Los editores pueden gestionar dominios y ejecutar comprobaciones. Los visualizadores solo pueden leer datos. El sistema de roles se aplica a nivel de middleware en cada endpoint de API.

**P: ¿Qué pasa si la API WHOIS alcanza su cuota?**
R: El sistema automáticamente recurre a `whois-json` (consultas WHOIS directas). Algunos TLDs pueden no estar disponibles con el fallback. Puedes añadir múltiples claves de API en Settings > API Keys para aumentar la cuota total.

**P: ¿Cómo funciona el borrado suave?**
R: Cuando eliminas un dominio, el campo `deleted_at` se establece al timestamp actual en lugar de borrar la fila. El dominio desaparece de las vistas normales. Puedes ver y restaurar dominios borrados en Settings > Deleted Domains.

**P: ¿Cómo puedo acceder a la documentación técnica completa?**
R: Navega a `http://localhost:3000/docs` para la documentación en inglés o `http://localhost:3000/docs/es/` para la documentación en español. Ambas tienen barra lateral de navegación, modo oscuro y búsqueda de texto completo.

**P: ¿Cómo funciona el modo paginado?**
R: Cuando tienes más dominios de los que caben en pantalla, se activa la paginación. Los filtros y la búsqueda aplican sobre todos los dominios del servidor. Las estadísticas del panel superior muestran totales de toda la colección. Las alertas críticas siempre se calculan sobre la lista completa sin importar en qué página estés.
