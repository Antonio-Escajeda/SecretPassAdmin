# secret-service-argon2id

Servicio interno para compartir secretos de un solo uso con cifrado zero-knowledge.
Extiende la versión base con soporte de passphrase opcional usando Argon2id.

## Comandos rápidos

### Levantar sin túnel

```bash
docker compose up -d
```

### Levantar con túnel temporal de Cloudflare

```bash
docker compose --profile tunnel up -d
```

### Ver la URL pública actual del túnel

```bash
docker compose logs cloudflared --tail 50 | rg 'trycloudflare.com'
```

### Bajar todo

```bash
docker compose down
```

### Wrappers opcionales

```bash
./up.sh
./up.sh tunnel
./down.sh
```

## Principio fundamental

El servidor **nunca ve el texto plano**. Todo el cifrado ocurre en el navegador del creador y todo el descifrado ocurre en el navegador del receptor. La clave de descifrado viaja únicamente en el fragmento `#` de la URL, que los navegadores nunca envían en las peticiones HTTP.

```http
https://secretos.empresa.local/s/abc123#clave-secreta
                                        ↑
                          nunca llega al servidor
```

---

## Características implementadas

### Seguridad

- **Zero-knowledge completo** — el servidor almacena únicamente ciphertext. Si alguien roba Redis, los backups o los logs, no puede leer ningún secreto.
- **AES-256-GCM** — cifrado autenticado con Web Crypto API nativa del navegador, sin librerías externas.
- **Un solo uso con GETDEL atómico** — Redis borra el secreto en la misma operación en que lo entrega. Dos receptores simultáneos nunca pueden leer el mismo secreto.
- **Página intermedia anti-bot** — el secreto no se consume al abrir el enlace. Requiere que el usuario haga clic en "Revelar secreto". Esto evita que Slack, Teams, Outlook u otros escáneres de links consuman el secreto automáticamente.
- **Clave eliminada del URL bar** — después de cargar la clave del fragmento, se llama a `history.replaceState` para limpiar la URL visible, reduciendo exposición accidental.
- **Passphrase opcional con Argon2id** — protección adicional de dos factores: aunque alguien intercepte el enlace completo, sin la contraseña no puede descifrar el secreto.
- **Mitigación de timing attacks** — el endpoint `POST /api/secrets/:id/reveal` siempre ejecuta `GETDEL` en Redis, incluso para IDs con formato inválido (usando la clave `secret:__invalid__`). Esto elimina la diferencia de tiempo observable entre un ID malformado y uno válido no encontrado, previniendo enumeración por canal lateral.

### Passphrase con Argon2id

Protección opcional de dos factores. El creador activa el checkbox "Proteger con contraseña" y define una passphrase que comparte con el receptor por un canal separado (teléfono, en persona, etc).

**Cómo funciona:**

```markdown
urlKey     → en el fragmento # de la URL
salt       → almacenado en Redis (no es secreto)
passphrase → compartida fuera de banda

finalKey = Argon2id(passphrase + ":" + urlKey, salt, m=19456, t=2, p=1)
```

- El servidor almacena `{ ciphertext, iv, salt, hasPassphrase }`. Nunca ve la passphrase.
- El receptor abre el enlace → hace clic en "Revelar" → si `hasPassphrase = true`, aparece un formulario para ingresar la contraseña → solo entonces se descifra localmente.
- Argon2id es memory-hard: cada intento de crackeo requiere 19 MiB de RAM, lo que hace imposible el uso de GPUs para paralelizar ataques de fuerza bruta.

**Por qué Argon2id y no PBKDF2:**

PBKDF2 no es memory-hard. Una GPU moderna puede ejecutar cientos de miles de derivaciones PBKDF2-SHA-256 en paralelo porque cada instancia requiere poca RAM. Argon2id fue diseñado específicamente para que cada intento de derivación ocupe una cantidad fija y significativa de memoria (19 MiB en esta configuración). Paralelizar el crackeo requiere multiplicar la RAM disponible por el número de intentos simultáneos, lo que hace inviable el ataque con hardware convencional.

**Parámetros Argon2id:**

| Parámetro | Valor | Descripción |
| --- | --- | --- |
| `m` | 19456 KiB | Memoria requerida por derivación |
| `t` | 2 | Número de pasadas |
| `p` | 1 | Paralelismo |

**Comparativa de modelos:**

| | Sin passphrase | Con passphrase Argon2id |
| --- | --- | --- |
| Seguridad | Link = acceso | Link + contraseña = acceso |
| Fricción | Ninguna | Receptor ingresa contraseña |
| Resistencia a crackeo | N/A | Memory-hard (19 MiB por intento) |
| Recomendado para | Credenciales internas | Datos muy sensibles |

### Expiración

Dos modos seleccionables al crear el secreto:

- **Duración** — define cuántas horas y minutos desde ahora.
- **Fecha exacta** — selecciona fecha en calendario + hora + minuto.

El máximo y el mínimo son configurables en una sola línea al tope de `CreateSecret.ts`:

```typescript
const MAX_DAYS = 7;    // máximo: días desde ahora
const MIN_MINUTES = 5; // mínimo: minutos desde ahora
```

### Auditoría

Eventos estructurados escritos directamente a `process.stdout` como JSON. Los logs **nunca contienen** texto plano, ciphertext, claves ni fragmentos de URL. Los IDs de secreto se hashean con SHA-256 truncado a 16 caracteres.

Eventos registrados:

| Evento | Cuándo |
| --- | --- |
| `secret.created` | Secreto creado exitosamente |
| `secret.revealed` | Secreto consumido por el receptor |
| `secret.not_found` | ID no encontrado o ya consumido |
| `secret.invalid_payload` | Payload inválido en creación o ID inválido en lectura |
| `secret.rate_limited` | Límite de tasa superado |

Ejemplo de log:

```json
{ "event": "secret.created", "secretIdHash": "4a1e9f2c8b3d1a7e", "ttlSeconds": 3600, "ip": "10.10.4.55" }
```

### Rate limiting

Límites por IP, por endpoint:

| Endpoint | Límite |
| --- | --- |
| `POST /api/secrets` | 50 por hora |
| `POST /api/secrets/:id/reveal` | 300 por hora |
| Global (safety net) | 500 por minuto |

### Métricas

Endpoint `/metrics` con contadores Prometheus, listo para conectar a Grafana.

### Headers de seguridad

Todas las respuestas incluyen:

```http
Cache-Control: no-store
Pragma: no-cache
Referrer-Policy: no-referrer
X-Content-Type-Options: nosniff
Permissions-Policy: camera=(), microphone=(), geolocation=()
Content-Security-Policy: default-src 'self'; frame-ancestors 'none'
```

---

## Stack

### Backend

| Tecnología | Rol |
| --- | --- |
| Node.js 20 | Runtime |
| TypeScript | Lenguaje |
| `node:http` nativo | Servidor HTTP con router propio (sin framework) |
| Redis 7 | Almacenamiento con TTL |
| `node:net` (RESP2) | Cliente Redis implementado desde cero, sin dependencias |
| Validación manual TS | Validación de payloads (sin librerías externas) |
| `process.stdout.write` | Logging estructurado JSON (sin librerías externas) |
| `node:crypto.randomBytes` | Generación de IDs de alta entropía (sin librerías externas) |

**Dependencias de runtime: 0.** Solo devDependencies: `tsx`, `typescript`, `vitest`.

### Frontend

| Tecnología | Rol |
| --- | --- |
| DOM imperativo vanilla TypeScript | UI (sin framework) |
| Vite | Bundler |
| TypeScript | Lenguaje |
| Web Crypto API | Cifrado/descifrado AES-256-GCM (nativo, sin librerías) |
| `argon2id` (WebAssembly) | KDF memory-hard para derivación de clave con passphrase |

**Dependencias de runtime: 1** (`argon2id@1.0.1`). Solo devDependencies: `vite`, `typescript`, `vitest`.

### Infraestructura

| Tecnología | Rol |
| --- | --- |
| Docker Compose | Orquestación local |
| nginx | Reverse proxy + servidor de archivos estáticos |
| Redis 7 Alpine | Sin persistencia a disco (`--appendonly no`) |

---

## Dependencias detalladas

### `apps/api/package.json`

```jsonc
{
  "dependencies": {
    // Sin dependencias de runtime.
    // Todo usa módulos nativos de Node.js: node:http, node:net, node:crypto, node:fs.
  },
  "devDependencies": {
    // Lenguaje — tipado estático sobre JavaScript
    "typescript": "^5.x",

    // Ejecuta archivos TypeScript directamente sin compilar a JS (solo desarrollo)
    "tsx": "^4.x",

    // Framework de testing
    "vitest": "^2.x"
  }
}
```

### `apps/web/package.json`

```jsonc
{
  "dependencies": {
    // KDF memory-hard para derivación de clave con passphrase.
    // Argon2id compilado a WebAssembly — se ejecuta en el navegador.
    // Un intento de crackeo requiere 19 MiB de RAM, imposibilitando ataques GPU.
    "argon2id": "^1.0.1"
  },
  "devDependencies": {
    // Bundler — empaqueta el frontend para producción y sirve en desarrollo
    "vite": "^5.x",

    // Lenguaje — tipado estático sobre JavaScript
    "typescript": "^5.x",

    // Framework de testing
    "vitest": "^2.x"
  }
}
```

---

## Arquitectura

```txt
Puerto 80 (público)
      ↓
   nginx
   ├── /           → Vanilla TS SPA (estático)
   └── /api/*      → proxy → api:3000 (red interna Docker)
                                ↓
                            Redis (red interna, sin puerto expuesto)
```

---

## Estructura del proyecto

```txt
secret-service/
├── apps/
│   ├── api/
│   │   ├── src/
│   │   │   ├── server.ts          # node:http — router propio, sin framework
│   │   │   ├── config.ts          # Variables de entorno con validación manual
│   │   │   ├── redis.ts           # Cliente RESP2 sobre node:net (sin ioredis)
│   │   │   ├── schemas.ts         # Validación de payloads en TypeScript puro
│   │   │   ├── audit.ts           # Eventos de auditoría → process.stdout.write
│   │   │   └── routes/
│   │   │       └── secrets.routes.ts  # POST /api/secrets, POST /api/secrets/:id/reveal
│   │   ├── Dockerfile
│   │   ├── package.json
│   │   └── tsconfig.json
│   └── web/
│       ├── src/
│       │   ├── crypto.ts          # encryptSecret / decryptSecret (Web Crypto API)
│       │   ├── api.ts             # createSecretOnServer / revealSecretFromServer
│       │   ├── app.ts             # Routing por pathname (DOM imperativo, sin React)
│       │   ├── main.ts
│       │   └── pages/
│       │       ├── CreateSecret.ts    # Formulario + cifrado local
│       │       └── ViewSecret.ts      # Página intermedia + descifrado
│       ├── nginx.conf
│       ├── Dockerfile
│       ├── package.json
│       └── vite.config.ts
├── docker-compose.yml
└── .env.example
```

---

## Levantar el proyecto

### Sin túnel

```bash
cd secret-service
docker compose up -d
```

Levanta:

- `redis`
- `api`
- `web`

Abre `http://localhost` en el navegador.

### Con túnel público temporal (Cloudflare Quick Tunnel)

```bash
docker compose --profile tunnel up -d
```

Levanta:

- `redis`
- `api`
- `web`
- `cloudflared`

La URL pública temporal se puede consultar con:

```bash
docker compose logs cloudflared --tail 50 | rg 'trycloudflare.com'
```

### Bajar todo

```bash
docker compose down
```

### Scripts auxiliares

También podés usar los wrappers del proyecto:

```bash
./up.sh
./up.sh tunnel
./down.sh
```

---

## Testing

El proyecto tiene tests automatizados con [Vitest](https://vitest.dev/), cubriendo validación de schemas, rutas HTTP (con Redis mockeado), funciones criptográficas y auditoría.

### Ejecutar tests

```bash
# API
cd apps/api && npm test

# Frontend (crypto)
cd apps/web && npm test

# Con cobertura
npm run test:coverage

# Modo watch (desarrollo)
npm run test:watch
```

---

## Variables de entorno

| Variable | Default | Descripción |
| --- | --- | --- |
| `NODE_ENV` | `development` | Entorno |
| `PORT` | `3000` | Puerto de la API |
| `REDIS_URL` | `redis://localhost:6379` | URL de conexión a Redis |
| `MAX_SECRET_BYTES` | `65536` | Tamaño máximo del secreto (64 KB) |
| `MIN_TTL_SECONDS` | `60` | TTL mínimo aceptado |
| `MAX_TTL_SECONDS` | `604800` | TTL máximo aceptado (7 días) |

---

## Flujo de creación

1. Usuario escribe el secreto en el navegador.
2. El navegador genera una clave AES-256 aleatoria y un IV de 96 bits.
3. El navegador cifra el secreto localmente.
4. Si el usuario activó la passphrase, el navegador usa Argon2id para derivar la clave final combinando passphrase y urlKey.
5. El navegador envía **solo** `{ ciphertext, iv, ttlSeconds }` al servidor (más `salt` si hay passphrase).
6. El servidor guarda el ciphertext en Redis con TTL y devuelve un `id`.
7. El navegador construye la URL: `https://host/s/{id}#{key}` y la muestra al usuario.

## Flujo de lectura

1. Receptor abre la URL.
2. El frontend extrae la clave del fragmento `#` y la guarda en memoria.
3. Se llama a `history.replaceState` para limpiar la clave del URL bar.
4. Se muestra la página intermedia: *"Este secreto se destruirá al revelarlo"*.
5. Al hacer clic en "Revelar", el frontend hace `POST /api/secrets/:id/reveal`.
6. El backend ejecuta `GETDEL` — devuelve el ciphertext y lo borra en una operación atómica.
7. Si `hasPassphrase = true`, el frontend solicita la contraseña al receptor y deriva la clave con Argon2id antes de descifrar.
8. El frontend descifra localmente con la clave en memoria.
9. Se muestra el texto plano. Nunca se almacena en localStorage ni cookies.

---

## Roadmap

### Fase 1 — MVP seguro (completado)

- Cifrado zero-knowledge en cliente
- Redis con TTL nativo
- Un solo uso (GETDEL atómico)
- Página intermedia anti-bot
- Dos modos de expiración
- Docker Compose completo

### Fase 2 — Seguridad empresarial (completado / parcial)

- Auditoría estructurada sin datos sensibles
- Rate limiting por endpoint
- Métricas Prometheus (`/metrics`)
- SSO con Azure Entra ID (Microsoft 365) — pendiente

### Fase 3 — Operación

- Dashboard en Grafana con métricas y eventos de auditoría
- Alertas de abuso (picos de `secret.not_found`)
- Integración con SIEM (Wazuh)

### Fase 4 — Funciones avanzadas (completado / parcial)

- (OK) Passphrase opcional con Argon2id: `finalKey = Argon2id(passphrase + ":" + urlKey, salt, m=19456, t=2, p=1)`
- (OK) Eliminación total de dependencias de runtime en el backend (0 deps)
- Restricción de acceso por dominio corporativo
- Visibilidad solo para usuarios autenticados con Entra ID
- API para pipelines CI/CD

---

## Referencias

### Criptografía

| Referencia | Descripción |
| --- | --- |
| [Web Crypto API — Node.js](https://nodejs.org/api/webcrypto.html) | API de criptografía nativa de Node.js |
| [SubtleCrypto — MDN](https://developer.mozilla.org/en-US/docs/Web/API/SubtleCrypto) | Interfaz principal usada para `generateKey`, `encrypt`, `decrypt`, `importKey`, `exportKey` |
| [SubtleCrypto.encrypt() — MDN](https://developer.mozilla.org/en-US/docs/Web/API/SubtleCrypto/encrypt) | Detalle de AES-GCM y parámetros del algoritmo |
| [Argon2id — RFC 9106](https://www.rfc-editor.org/rfc/rfc9106) | Especificación del algoritmo Argon2id |
| [argon2id npm](https://www.npmjs.com/package/argon2id) | Implementación WebAssembly usada en el frontend |
| [OWASP Password Storage Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/Password_Storage_Cheat_Sheet.html) | Guía de referencia para almacenamiento seguro de contraseñas — base de la elección de Argon2id y sus parámetros |
| [crypto.getRandomValues() — MDN](https://developer.mozilla.org/en-US/docs/Web/API/Crypto/getRandomValues) | Generación del IV de 96 bits y salt de 16 bytes |

### Backend (NdeJS)

| Referencia | Descripción |
| --- | --- |
| [node:http — Node.js](https://nodejs.org/api/http.html) | Módulo nativo para el servidor HTTP |
| [node:net — Node.js](https://nodejs.org/api/net.html) | Módulo nativo usado para el cliente Redis RESP2 |
| [node:crypto — Node.js](https://nodejs.org/api/crypto.html) | Generación de IDs con `randomBytes` |

### Redis

| Referencia | Descripción |
| --- | --- |
| [GETDEL — Redis](https://redis.io/commands/getdel/) | Operación atómica usada para lectura única del secreto |
| [SET EX — Redis](https://redis.io/commands/set/) | Almacenamiento del secreto con TTL nativo |
| [RESP2 — Redis protocol](https://redis.io/docs/reference/protocol-spec/) | Protocolo de serialización implementado sobre `node:net` |

### Frontend (Vite)

| Referencia | Descripción |
| --- | --- |
| [history.replaceState() — MDN](https://developer.mozilla.org/en-US/docs/Web/API/History/replaceState) | Limpieza del fragmento `#key` del URL bar tras la carga |
| [Vite](https://vitejs.dev/guide/) | Bundler del frontend |
