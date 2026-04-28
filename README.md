# secret-service-PBKDF2

Servicio interno para compartir secretos de un solo uso con cifrado zero-knowledge.
Extiende la versión base con soporte de passphrase opcional usando PBKDF2 (Modelo B).

## Principio fundamental

El servidor **nunca ve el texto plano**. Todo el cifrado ocurre en el navegador del creador y todo el descifrado ocurre en el navegador del receptor. La clave de descifrado viaja únicamente en el fragmento `#` de la URL, que los navegadores nunca envían en las peticiones HTTP.

```
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
- **Passphrase opcional con PBKDF2** — protección adicional de dos factores: aunque alguien intercepte el enlace completo, sin la contraseña no puede descifrar el secreto.
- **Mitigación de timing attacks** — el endpoint `POST /api/secrets/:id/reveal` siempre ejecuta `GETDEL` en Redis, incluso para IDs con formato inválido (usando la clave `secret:__invalid__`). Esto elimina la diferencia de tiempo observable entre un ID malformado y uno válido no encontrado, previniendo enumeración por canal lateral.

### Passphrase con PBKDF2 (Modelo B)

Protección opcional de dos factores. El creador activa el checkbox "Proteger con contraseña" y define una passphrase que comparte con el receptor por un canal separado (teléfono, en persona, etc).

**Cómo funciona:**

```
urlKey  → en el fragmento # de la URL
salt    → almacenado en Redis (no es secreto)
passphrase → compartida fuera de banda

finalKey = PBKDF2(passphrase + ":" + urlKey, salt, 310_000 iter, SHA-256, AES-GCM-256)
```

- El servidor almacena `{ ciphertext, iv, salt, hasPassphrase }`. Nunca ve la passphrase.
- El receptor abre el enlace → hace clic en "Revelar" → si `hasPassphrase = true`, aparece un formulario para ingresar la contraseña → solo entonces se descifra localmente.
- 310.000 iteraciones PBKDF2 siguiendo la recomendación NIST para SHA-256.

**Parámetros configurables en `CreateSecret.tsx`:**

```typescript
const PASSPHRASE_DEFAULT = false; // true = activado por defecto para todos
```

**Comparativa de modelos:**

| | Modelo A (base) | Modelo B (PBKDF2) |
|---|---|---|
| Seguridad | Link = acceso | Link + contraseña = acceso |
| Fricción | Ninguna | Receptor ingresa contraseña |
| Recomendado para | Credenciales internas | Datos muy sensibles |

### Expiración

Dos modos seleccionables al crear el secreto:

- **Duración** — define cuántas horas y minutos desde ahora.
- **Fecha exacta** — selecciona fecha en calendario + hora + minuto.

El máximo y el mínimo son configurables en una sola línea al tope de `CreateSecret.tsx`:

```typescript
const MAX_DAYS = 7;    // máximo: días desde ahora
const MIN_MINUTES = 5; // mínimo: minutos desde ahora
```

### Auditoría

Eventos estructurados con Pino. Los logs **nunca contienen** texto plano, ciphertext, claves ni fragmentos de URL. Los IDs de secreto se hashean con SHA-256 truncado a 16 caracteres.

Eventos registrados:

| Evento | Cuándo |
|---|---|
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
|---|---|
| `POST /api/secrets` | 50 por hora |
| `POST /api/secrets/:id/reveal` | 300 por hora |
| Global (safety net) | 500 por minuto |

### Métricas

Endpoint `/metrics` con contadores Prometheus, listo para conectar a Grafana.

### Headers de seguridad

Todas las respuestas incluyen:

```
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
|---|---|
| Node.js 20 | Runtime |
| TypeScript | Lenguaje |
| Fastify 4 | Framework HTTP |
| Redis 7 | Almacenamiento con TTL |
| Zod | Validación de payloads |
| Pino | Logging estructurado |
| nanoid | Generación de IDs de alta entropía |

### Frontend
| Tecnología | Rol |
|---|---|
| React 18 | UI |
| Vite 5 | Bundler |
| TypeScript | Lenguaje |
| Web Crypto API | Cifrado/descifrado (nativo, sin librerías) |

### Infraestructura
| Tecnología | Rol |
|---|---|
| Docker Compose | Orquestación local |
| nginx | Reverse proxy + servidor de archivos estáticos |
| Redis 7 Alpine | Sin persistencia a disco (`--appendonly no`) |

---

## Dependencias detalladas

### `apps/api/package.json`

```jsonc
{
  "dependencies": {
    // Framework HTTP — maneja rutas, plugins y el ciclo de vida de las peticiones
    "fastify": "^4.28.1",

    // Agrega headers de seguridad HTTP: CSP, X-Frame-Options, HSTS, etc.
    "@fastify/helmet": "^11.1.1",

    // Limita la cantidad de peticiones por IP/endpoint para prevenir abuso
    "@fastify/rate-limit": "^9.1.0",

    // Controla qué orígenes pueden hacer peticiones a la API (deshabilitado en MVP)
    "@fastify/cors": "^9.0.1",

    // Cliente Redis — se usa para SET con TTL y GETDEL atómico
    "ioredis": "^5.3.2",

    // Validación de esquemas con TypeScript — verifica ciphertext, iv, ttlSeconds, salt
    "zod": "^3.23.8",

    // Logger estructurado JSON con soporte de redact para no loguear datos sensibles
    "pino": "^9.3.2",

    // Genera IDs aleatorios de 32 caracteres para identificar cada secreto
    "nanoid": "^5.0.7",

    // Expone endpoint /metrics con contadores Prometheus para monitoreo
    "fastify-metrics": "^11.0.0"
  },
  "devDependencies": {
    // Lenguaje — tipado estático sobre JavaScript
    "typescript": "^5.5.4",

    // Ejecuta archivos TypeScript directamente sin compilar a JS (solo desarrollo)
    "tsx": "^4.16.2",

    // Tipos de Node.js para TypeScript (crypto, process, etc.)
    "@types/node": "^22.4.0"
  }
}
```

### `apps/web/package.json`

```jsonc
{
  "dependencies": {
    // Librería UI — componentes, estado, ciclo de vida
    "react": "^18.3.1",

    // Renderiza React en el DOM del navegador
    "react-dom": "^18.3.1"

    // Nota: todo el cifrado usa Web Crypto API nativa del navegador.
    // No hay ninguna librería externa de criptografía.
  },
  "devDependencies": {
    // Bundler — empaqueta el frontend para producción y sirve en desarrollo
    "vite": "^5.4.1",

    // Plugin que habilita JSX y Fast Refresh de React en Vite
    "@vitejs/plugin-react": "^4.3.1",

    // Lenguaje — tipado estático sobre JavaScript
    "typescript": "^5.5.4",

    // Tipos de React para TypeScript
    "@types/react": "^18.3.3",

    // Tipos de React DOM para TypeScript
    "@types/react-dom": "^18.3.0"
  }
}
```

---

## Arquitectura

```
Puerto 80 (público)
      ↓
   nginx
   ├── /           → React SPA (estático)
   └── /api/*      → proxy → api:3000 (red interna Docker)
                                ↓
                            Redis (red interna, sin puerto expuesto)
```

---

## Estructura del proyecto

```
secret-service/
├── apps/
│   ├── api/
│   │   ├── src/
│   │   │   ├── server.ts          # Fastify + plugins de seguridad
│   │   │   ├── config.ts          # Variables de entorno con Zod
│   │   │   ├── redis.ts           # Cliente ioredis
│   │   │   ├── schemas.ts         # Validación de payloads
│   │   │   ├── audit.ts           # Eventos de auditoría estructurados
│   │   │   └── routes/
│   │   │       └── secrets.routes.ts  # POST /api/secrets, POST /api/secrets/:id/reveal
│   │   ├── Dockerfile
│   │   ├── package.json
│   │   └── tsconfig.json
│   └── web/
│       ├── src/
│       │   ├── crypto.ts          # encryptSecret / decryptSecret (Web Crypto API)
│       │   ├── api.ts             # createSecretOnServer / revealSecretFromServer
│       │   ├── App.tsx            # Routing por pathname
│       │   ├── main.tsx
│       │   └── pages/
│       │       ├── CreateSecret.tsx   # Formulario + cifrado local
│       │       └── ViewSecret.tsx     # Página intermedia + descifrado
│       ├── nginx.conf
│       ├── Dockerfile
│       ├── package.json
│       └── vite.config.ts
├── docker-compose.yml
└── .env.example
```

---

## Levantar el proyecto

```bash
cd secret-service
docker compose up --build
```

Abre `http://localhost` en el navegador.

---

## Testing

El proyecto tiene 29+ tests automatizados con [Vitest](https://vitest.dev/), cubriendo validación de schemas, rutas HTTP (con Redis mockeado), funciones criptográficas y auditoría.

### Ejecutar tests

```bash
# API — 15 tests
cd apps/api && npm test

# Frontend (crypto) — 14 tests
cd apps/web && npm test

# Con cobertura
npm run test:coverage

# Modo watch (desarrollo)
npm run test:watch

# UI interactiva
npm run test:ui
```

---

## Variables de entorno

| Variable | Default | Descripción |
|---|---|---|
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
4. El navegador envía **solo** `{ ciphertext, iv, ttlSeconds }` al servidor.
5. El servidor guarda el ciphertext en Redis con TTL y devuelve un `id`.
6. El navegador construye la URL: `https://host/s/{id}#{key}` y la muestra al usuario.

## Flujo de lectura

1. Receptor abre la URL.
2. El frontend extrae la clave del fragmento `#` y la guarda en memoria.
3. Se llama a `history.replaceState` para limpiar la clave del URL bar.
4. Se muestra la página intermedia: *"Este secreto se destruirá al revelarlo"*.
5. Al hacer clic en "Revelar", el frontend hace `POST /api/secrets/:id/reveal`.
6. El backend ejecuta `GETDEL` — devuelve el ciphertext y lo borra en una operación atómica.
7. El frontend descifra localmente con la clave en memoria.
8. Se muestra el texto plano. Nunca se almacena en localStorage ni cookies.

---

## Roadmap

### Fase 1 — MVP seguro (OK)
- Cifrado zero-knowledge en cliente
- Redis con TTL nativo
- Un solo uso (GETDEL atómico)
- Página intermedia anti-bot
- Dos modos de expiración
- Docker Compose completo

### Fase 2 — Seguridad empresarial (OK) (parcial)
- Auditoría estructurada sin datos sensibles
- Rate limiting por endpoint
- Métricas Prometheus (`/metrics`)
- SSO con Azure Entra ID (Microsoft 365) — pendiente

### Fase 3 — Operación
- Dashboard en Grafana con métricas y eventos de auditoría
- Alertas de abuso (picos de `secret.not_found`)
- Integración con SIEM (Wazuh)

### Fase 4 — Funciones avanzadas (OK) (parcial)
- (OK) Passphrase opcional con PBKDF2: `finalKey = PBKDF2(passphrase + ":" + urlKey, salt, 310000)`
- Restricción de acceso por dominio corporativo
- Visibilidad solo para usuarios autenticados con Entra ID
- API para pipelines CI/CD

---

## Referencias

### Criptografía

| Referencia | Descripción |
|---|---|
| [Web Crypto API — Node.js](https://nodejs.org/api/webcrypto.html) | API de criptografía nativa de Node.js |
| [SubtleCrypto — MDN](https://developer.mozilla.org/en-US/docs/Web/API/SubtleCrypto) | Interfaz principal usada para `generateKey`, `encrypt`, `decrypt`, `importKey`, `exportKey` |
| [SubtleCrypto.encrypt() — MDN](https://developer.mozilla.org/en-US/docs/Web/API/SubtleCrypto/encrypt) | Detalle de AES-GCM y parámetros del algoritmo |
| [SubtleCrypto.deriveKey() — MDN](https://developer.mozilla.org/en-US/docs/Web/API/SubtleCrypto/deriveKey) | Derivación de clave con PBKDF2 |
| [SubtleCrypto.importKey() — MDN](https://developer.mozilla.org/en-US/docs/Web/API/SubtleCrypto/importKey) | Importación de clave PBKDF2 desde passphrase |
| [crypto.getRandomValues() — MDN](https://developer.mozilla.org/en-US/docs/Web/API/Crypto/getRandomValues) | Generación del IV de 96 bits y salt de 16 bytes |

### Backend

| Referencia | Descripción |
|---|---|
| [Fastify](https://fastify.dev/docs/latest/) | Framework HTTP — rutas, plugins, hooks |
| [Zod](https://zod.dev) | Validación de payloads con esquemas TypeScript |
| [Pino](https://getpino.io) | Logging estructurado con redact de campos sensibles |

### Redis

| Referencia | Descripción |
|---|---|
| [GETDEL — Redis](https://redis.io/commands/getdel/) | Operación atómica usada para lectura única del secreto |
| [SET EX — Redis](https://redis.io/commands/set/) | Almacenamiento del secreto con TTL nativo |

### Frontend

| Referencia | Descripción |
|---|---|
| [history.replaceState() — MDN](https://developer.mozilla.org/en-US/docs/Web/API/History/replaceState) | Limpieza del fragmento `#key` del URL bar tras la carga |
| [Vite](https://vitejs.dev/guide/) | Bundler del frontend React |
