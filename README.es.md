🌐 [日本語](README.md) | [English](README.en.md) | [简体中文](README.zh-CN.md) | [한국어](README.ko.md) | **Español**

# IG Harness

> ### **[Ver la demo en vivo](https://shudesu.github.io/ig-harness-oss/)** 👈

Automatización de Instagram DM completamente open source / marketing automation. **Alternativa gratuita a Proveedor A / Proveedor B**.
Funciona en el plan gratuito de Cloudflare. Costo de servidor: **$0**. Operable íntegramente desde Claude Code.

### ▶️ [Ver en video (YouTube)](https://youtu.be/xzEanXQtlO0)

[![Haz clic para reproducir en YouTube — Guía completa de configuración de IG Harness](https://img.youtube.com/vi/xzEanXQtlO0/maxresdefault.jpg)](https://youtu.be/xzEanXQtlO0)

> 📖 **Guía de configuración (versión completa con capturas de pantalla)**: <https://harness-wiki.pages.dev/article/ig-harness-complete-setup-guide>

**Versión actual**: v0.11.1 · MIT License · TypeScript / Cloudflare Workers + D1 + R2

---

## ¿Por qué IG Harness?

| | Proveedor A | Proveedor B | **IG Harness** |
|---|---|---|---|
| Mensual | $15+ | ¥10,000–30,000/mes | **$0** |
| Comentario → DM automático | ✅ | ✅ | ✅ |
| Follow gate (distribución de bonos) | ✅ | ✅ | ✅ |
| Secuencias de mensajes (drip) | ✅ | ✅ | ✅ |
| Mensajes enriquecidos (tarjetas/botones) | ✅ | ✅ | ✅ |
| Formularios | ✅ | ✅ | ✅ |
| Links de seguimiento | Parcial | ✅ | ✅ |
| API pública | ❌ | ❌ | **Funcionalidad completa** |
| Soporte Claude Code (IA) | ❌ | ❌ | **MCP server incluido** |
| Integración con LINE Official Account | ❌ | ❌ | **UUID cross-link** |
| Multi-cuenta | Contrato aparte | Contrato aparte | **Incluido de serie** |
| Revisión de Meta | No requerida | No requerida | **No requerida (funciona con Standard Access)** |
| Código fuente | Propietario | Propietario | **MIT (este repo)** |

---

## Inicio rápido

### Configuración completa en 1 comando

```bash
npx create-ig-harness
```

El CLI se encarga de todo:
- Autenticación en Cloudflare (wrangler login)
- Creación de la base de datos D1 + bucket R2, aplicación de esquemas y migraciones
- Despliegue del Worker y del panel de administración
- Registro de credenciales de la cuenta Pro de Instagram
- Instrucciones para la integración del Webhook con la Meta App (muestra automáticamente las URLs de Privacy Policy, Data Deletion y Terms)
- Creación del usuario Owner para el primer acceso al panel

Tiempo estimado: ~5 minutos. Al finalizar, el panel (`https://<your-name>-admin.pages.dev`) estará listo para operar de inmediato.

### Requisitos

- Cuenta de Cloudflare (el plan gratuito es suficiente)
- Cuenta Pro de Instagram (Business / Creator) + Meta App
- Node.js 22+ / pnpm

---

## Funcionalidades principales

### Engagement (motor de captación)
- **Engagement gate** — Flujo al estilo Proveedor A: "Comentario → DM → verificación de seguimiento → entrega de bono". Si el usuario no ha seguido la cuenta, se le envía un DM de "síguenos primero" y, una vez confirmado el follow, el bono se entrega automáticamente por DM.
- **Comentario → DM automático** — Entrega de contenido por DM activada por comentarios en publicaciones o reels específicos (opción global o por publicación individual).
- **Respuesta automática a comentarios** — Respuestas automáticas a comentarios por palabra clave (publicación de nivel superior con @mention, funciona con Standard Access).
- **Mención en Stories → DM** — Detección de menciones y envío automático de DM.
- **Trigger por palabra clave en DM** — Activa un gate al recibir un DM con una palabra clave específica.

### Mensajería
- **Secuencias de mensajes** — Envío de DMs diferidos en cadena activados por palabras clave.
- **Follow-up DMs (drip)** — Hasta 3 mensajes adicionales con demora en minutos tras la entrega inicial.
- **Broadcast masivo** — Envío de DMs a todos los seguidores o filtrado por etiqueta, con soporte para programación.
- **Mensajes enriquecidos** — Tarjetas con botones, carruseles y quick replies.

### CRM
- **Gestión de seguidores** — Registro automático vía Webhook, obtención de perfil, metadatos personalizados y etiquetas.
- **Chat del operador** — Respuesta 1:1 directamente desde el panel de administración. Los DMs automáticos y los eventos de botones también se reflejan en el historial de conversación.
- **Caché de fotos de perfil** — Almacenamiento persistente en R2 para evitar la expiración de URLs firmadas de la CDN de Instagram.
- **Formularios** — Recopilación de datos dentro del DM; las respuestas se guardan automáticamente como metadatos.
- **Links de seguimiento** — Medición de clics y análisis de origen de tráfico.

### Integración con LINE Harness
- **Vinculación cross-platform mediante UUID** — A través de un webhook con shared secret, vincula seguidores de IG y amigos de LINE bajo un mismo UUID de forma bidireccional. Basta con enviar una URL única por usuario para que "este usuario de IG = este amigo de LINE" quede registrado automáticamente en ambas bases de datos.
- **Registro del origen de IG** — En entornos multi-cuenta, rastrea desde qué cuenta de IG se originó el registro en LINE.

### Multi-cuenta
- Gestiona **múltiples cuentas de Instagram** desde un único Worker y dashboard.
- **Scope por cuenta** — Seguidores, gates y broadcasts están separados por cuenta.
- **Routing de Webhooks** — El `entry.id` identifica automáticamente la cuenta receptora; las Meta Apps adicionales se gestionan con verificación de firma multi-secret.

### Monitorización operativa
- **`GET /api/health`** — Por cuenta: días restantes del token, estado real de la API (checkpoint / detección de congelamiento), última recepción de webhook, fallos de entrega de DM y estado del cron.
- Combinable con sondas externas para alertas ante anomalías (token expirado, pico de fallos de entrega, sin respuesta).

### Integración con IA
- **MCP Server incluido** (`@ig-harness/mcp-server`) — Control total desde Claude Code mediante lenguaje natural.
- **SDK oficial** (`@ig-harness/sdk`) — SDK tipado en TypeScript, compatible con ESM + CJS.

### Soporte para app iOS
- **`GET /api/capabilities`** — Endpoint de negociación de compatibilidad con la app iOS oficial (the-harness-ios).

---

## Arquitectura

```
[ Instagram Platform ] ⇄ [ Cloudflare Worker (Hono) ] ⇄ [ D1 SQLite ] + [ R2 ]
                                   ⇅
                         [ Cloudflare Pages (Next.js 15) ]
                                   ⇅
                         [ MCP Server / SDK / Claude Code ]
```

- **Worker** (`apps/worker`): API + recepción de Webhooks + distribución de imágenes. Cron cada 5 minutos para procesamiento de envíos, refresco de tokens y sondas de estado.
- **Web** (`apps/web`): Dashboard en Next.js 15.
- **Packages**:
  - `@ig-harness/sdk` — TypeScript SDK
  - `@ig-harness/mcp-server` — MCP server para Claude Code
  - `create-ig-harness` — CLI de configuración
  - `@ig-harness/ig-sdk` — Wrapper ligero de la Instagram Graph API
  - `@ig-harness/db` — Migraciones D1 + helpers
  - `@ig-harness/shared` — Tipos compartidos

---

## Sobre los límites del Standard Access

La Instagram Messaging API funciona con **Standard Access (sin Meta App Review)** para el envío de DMs, engagement gates y respuestas de comentarios simuladas, siempre que gestiones cuentas Pro que tú mismo poseas y administres.

**Solo se necesita Advanced Access (App Review obligatoria) para**:
- Respuestas en hilo real anidadas directamente bajo el comentario padre.
- Operativa multi-tenant donde alojas cuentas de terceros (clientes).

La respuesta a comentarios de IG Harness está implementada como publicación de nivel superior con @mention, por lo que funciona sin salir del Standard Access.

---

## Documentación

- [Guía de configuración (video · YouTube)](https://youtu.be/xzEanXQtlO0)
- [Guía de configuración (con capturas de pantalla)](https://harness-wiki.pages.dev/article/ig-harness-complete-setup-guide)
- [npm: @ig-harness/sdk](https://www.npmjs.com/package/@ig-harness/sdk)
- [npm: @ig-harness/mcp-server](https://www.npmjs.com/package/@ig-harness/mcp-server)
- [npm: create-ig-harness](https://www.npmjs.com/package/create-ig-harness)

---

## Licencia

MIT License. Libre para uso comercial, modificación y redistribución.

---

## Contribuciones

Issues y PRs son bienvenidos. Los PRs al repo OSS deben dirigirse a `Shudesu/ig-harness-oss` (este repo).

---

> **IG Harness** by [@Shudesu](https://github.com/Shudesu) — Automatización de Instagram DM open source para la era de la IA nativa
