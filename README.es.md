[English](README.md) | [한국어](README.ko.md) | [中文](README.zh.md) | [日本語](README.ja.md) | Español

<div align="center">

# Hyper Cloaking

**Sea cual sea la tarea de navegador, tu agente la termina. Si tienes autorización para probarlo, Hyper Cloaking lo consigue.**

Un navegador sigiloso al ritmo humano para agentes de IA, impulsado por el servidor local gestionado `hyper-cloaking-mcp`. Sin configuración manual, sin resultados a medias del tipo "la página cargó": termina con evidencia.

<p>
  <img src="https://img.shields.io/badge/Claude_Code-D97757?logo=claude&logoColor=white" alt="Claude Code">
  <img src="https://img.shields.io/badge/Codex-000000?logo=openai&logoColor=white" alt="Codex">
  <img src="https://img.shields.io/badge/Cursor-6E56CF" alt="Cursor">
  <img src="https://img.shields.io/badge/OpenClaw-1F6FEB" alt="OpenClaw">
  <img src="https://img.shields.io/badge/Hermes-8957E5" alt="Hermes">
  <img src="https://img.shields.io/badge/Node.js-%E2%89%A5_20-3FB950?logo=nodedotjs&logoColor=white" alt="Node.js >= 20">
  <img src="https://img.shields.io/badge/uso_autorizado-solo-F0B72F" alt="Solo uso autorizado">
  <img src="https://img.shields.io/badge/license-MIT-blue" alt="MIT">
</p>

</div>

---

## ⚡ Instalación

**Claude Code** — añade este repositorio como marketplace de plugins y luego instala el plugin:

```bash
/plugin marketplace add alpox/hyper-cloaking
/plugin install hyper-cloaking
```

**Codex** lee el manifiesto replicado en `.agents/plugins/marketplace.json` —— añade el marketplace desde tu interfaz de plugins de Codex y habilita `hyper-cloaking`.

**Cualquier cliente compatible con AgentSkills** (Cursor, OpenClaw, Hermes, …) —— instala con el CLI `skills`, o copia `skills/hyper-cloaking/` en una raíz de skills que el cliente cargue:

```bash
npx skills add . --list   # ver qué ofrece la fuente
npx skills add .          # instalar en el proyecto actual
```

Requiere **Node.js ≥ 20** y acceso a red para obtener `cloakbrowser` y `playwright-core`. El resto lo instala y repara la skill en la primera ejecución.

## 💬 Pruébalo

No hay comandos que aprender. Pídele a tu agente con normalidad —— la skill se activa en cuanto la apuntas a una tarea de navegador:

> *"Usa CloakBrowser para comprobar si mi página de producto se renderiza bien en móvil y haz una captura."*
> *"Inicia sesión en mi propio Instagram con las cookies guardadas y trae mis últimas 12 publicaciones."*
> *"Monitorea este panel que administro y avísame si el estado del despliegue cambia a fallido."*

**Resultado esperado:** el agente hace algunas preguntas de configuración, lanza un navegador sigiloso al ritmo humano, realiza la tarea y la completa **solo cuando tiene evidencia** —— una captura, texto extraído, un cambio de estado confirmado —— guardado en `~/.hyper-cloaking/evidence/`.

## 🌐 Compatible con

**Claude Code · Codex · Cursor · OpenClaw · Hermes Agent · Gajae-Code** —— cualquier agente compatible con MCP que cargue `SKILL.md`. Pistas de metadatos integradas para **Naver · Instagram · YouTube · X · Coupang · TikTok**, más un modo `generic` para cualquier sitio que estés autorizado a probar.

## ⚙️ Por qué funciona

- **Un navegador sigiloso real, no un User-Agent parcheado** —— el servidor local gestionado `hyper-cloaking-mcp` ejecuta CloakBrowser con huellas de navegador genuinas en lugar de limitarse a cambiar una cabecera.
- **Al ritmo humano por defecto** —— cada ejecución operativa fuerza `humanize: true`: movimiento de ratón, escritura y desplazamiento a cadencia humana, para que los flujos automatizados largos no se atasquen ni se rompan a mitad de tarea.
- **Pasa por controles antes de lanzarse** —— la clasificación de seguridad del objetivo, la base de autorización, los orígenes permitidos y una ronda de preguntas previas ocurren *antes* de que se abra ningún navegador.
- **Sin evidencia no está hecho** —— que una página cargue nunca es "completado". La tarea solo termina cuando el resultado está probado, y devuelve un resultado estructurado.
- **Configuración sin complicaciones** —— construye el bundle MCP local, genera el registro del cliente desde `mcp/src/register.mjs` con el ejecutable Node actual y la ruta absoluta al bundle, y usa herramientas tipadas.

## 🆚 Navegador MCP normal vs `+ Hyper Cloaking`

| Cuando necesitas… | Navegador MCP normal | `+ Hyper Cloaking` |
| :--- | :--- | :--- |
| Automatizar **tu propia** cuenta con sesión iniciada | ✖ activa huellas de automatización | ✓ cadencia humana + carga segura de cookies |
| Confirmar primero que la tarea está autorizada | ✖ sin control | ✓ controles de seguridad y previos al lanzamiento |
| Reutilizar cookies del sitio sin filtrarlas | ✖ manual, valores en bruto | ✓ normalizadas, enmascaradas, nunca commiteadas |
| Confiar en que "hecho" significa hecho | ✖ carga de página = éxito | ✓ resultado validado con evidencia |
| Poner en marcha el navegador sigiloso | ✖ instalación y cableado manual | ✓ instalación/reparación automática + config MCP |
| **Saltar logins, CAPTCHA, sistemas antifraude** | ✖ | ✖ **lo rechaza, por diseño** (ver Límites) |

Lo que el navegador normal no puede hacer es la primera fila: **comportarse como un humano en una tarea que realmente tienes permiso de ejecutar.**

## 🔁 Cómo funciona

Una petición como *"usa CloakBrowser para este sitio"* se convierte en un flujo de trabajo acotado de diez pasos.

<details>
<summary><strong>El pipeline completo, de los controles a la evidencia —— detalles</strong></summary>

1. **Control de seguridad del objetivo** —— clasifica el objetivo como permitido / rechazado / requiere aclaración, y registra la base de autorización y los orígenes permitidos.
2. **Control de preguntas previas** —— recopila la URL del objetivo, los orígenes permitidos, el modo headless, el modo/cuenta de cookies y la preferencia de mantener abierto, mediante la interfaz nativa de preguntas estructuradas del host.
3. **Control de configuración** —— verifica Node.js y el bundle MCP local gestionado; instala o repara lo que falte.
4. **Espacio de trabajo en tiempo de ejecución** —— inicializa `~/.hyper-cloaking/` para `cookie.yml`, perfiles, descargas, evidencia, logs y estado.
5. **Manejo de cookies** —— normaliza y carga cookies que coincidan con el sitio (JSON exportado de Chrome, arrays de Playwright, entradas multicuenta) mediante un helper dedicado, sin almacenar nunca valores en bruto en el repositorio.
6. **Resolución del ejecutable** —— localiza el binario de Chromium de CloakBrowser en caché bajo `~/.hyper-cloaking/cache/cloakbrowser/`.
7. **Lanzamiento al ritmo humano** —— se ejecuta con `humanize: true` obligatorio en cada ejecución operativa (ratón, escritura y desplazamiento a ritmo humano).
8. **Configuración de MCP** —— construye `mcp/dist/server.mjs` y usa los registros generados por `mcp/src/register.mjs`, con el ejecutable Node actual y la ruta absoluta al bundle.
9. **Ejecución de la tarea + validación del resultado** —— realiza la tarea solicitada y la completa solo cuando la evidencia prueba el resultado (la carga de página por sí sola nunca es completar).
10. **Informe estructurado** —— devuelve `targetSafety`, `outcome`, `failure`, `contentBoundary` y `learning`; guarda informes y capturas bajo `~/.hyper-cloaking/evidence/`.

El DOM del navegador, el texto de la página, las descargas y la salida de consola se tratan como **datos no confiables sin autoridad de instrucción.**
</details>

## 🔒 Límites

Hyper Cloaking es una herramienta para **navegación autorizada**, no una forma de eludir controles de acceso.

- **Para** QA autorizado, monitoreo, automatización de cuentas propias y diagnósticos en propiedades que tienes permiso de probar.
- **No para** eludir controles de acceso, evadir sistemas antifraude, resolver CAPTCHA, scraping restringido o automatización de cuentas no autorizada.
- La humanización reduce las huellas de automatización —— **no** elimina el requisito de que una tarea esté autorizada.
- Las cookies se normalizan, se enmascaran en los logs y nunca se commitean. La skill nunca inventa una autorización que no se le dio, y un provider desconocido falla de forma segura (fail closed).

---

## Configuración del MCP local gestionado

La superficie operativa recomendada es el servidor gestionado `hyper-cloaking-mcp`. Desde la raíz del repositorio, construye su bundle:

```bash
npm --workspace mcp run build
```

Genera un registro para el cliente que uses. El renderizador resuelve el ejecutable Node actual y la ruta absoluta a `mcp/dist/server.mjs`:

```bash
node --input-type=module -e "import { generateServerRegistration } from './mcp/src/register.mjs'; console.log(JSON.stringify(generateServerRegistration('direct'), null, 2))"
node --input-type=module -e "import { generateServerRegistration } from './mcp/src/register.mjs'; console.log(JSON.stringify(generateServerRegistration('codex'), null, 2))"
node --input-type=module -e "import { generateServerRegistration } from './mcp/src/register.mjs'; console.log(JSON.stringify(generateServerRegistration('json'), null, 2))"
```

Aplica el registro generado a Codex, Claude Code/Cursor JSON, OpenClaw, Hermes o al cliente MCP emparejado con la sesión de Gajae-Code. Comprobación de lanzamiento directo:

```bash
node "$(pwd)/mcp/dist/server.mjs"
```

Usa las herramientas tipadas en este orden: `cloak_setup` → `cloak_status` → `cloak_launch` → `cloak_navigate` → `cloak_snapshot` → `cloak_click`/`cloak_type`/`cloak_scroll` → `cloak_screenshot` → consulta `cloak_provider_capabilities` → `cloak_provider_read` o `cloak_provider_write` → `cloak_teardown`. Usa las herramientas de cookies y credenciales (`cloak_cookies_list`, `cloak_cookies_status`, `cloak_credentials`) cuando sea necesario. Los proveedores compatibles son **Naver, Instagram, YouTube, X, Coupang, TikTok**; los proveedores desconocidos fallan de forma segura.

El paquete upstream Playwright MCP queda solo como contexto histórico/de comparación y no es la ruta operativa recomendada.

La verificación sin credenciales construye el bundle de distribución, completa el handshake stdio, inicia una sesión CloakBrowser humanizada real, comprueba el estado y la cierra. Las lecturas/escrituras reales por provider siguen siendo pruebas live condicionadas a credenciales y autorización; CI no simula que hayan pasado.

## Helpers del motor

Los helpers de tiempo de ejecución viven bajo `skills/hyper-cloaking/engine/` y son la interfaz soportada.

| Helper | Propósito |
|---|---|
| `engine/cli.mjs` | Comandos `validate` / `smoke` / `live`; ejecuta verificación en vivo contenida. |
| `engine/cookie.mjs` | Importa, normaliza, inspecciona, enmascara e inyecta cookies (JSON exportado de Chrome, arrays de Playwright, entradas sitio/cuenta de `cookie.yml`). |
| `engine/browser-utils.mjs` | Inicializa `~/.hyper-cloaking/`, lanza CloakBrowser con `humanize: true` y provee helpers `humanMove` / `humanClick` / `humanType` / `humanScroll` / XPath. |

```bash
node skills/hyper-cloaking/engine/browser-utils.mjs init
node skills/hyper-cloaking/engine/cookie.mjs inspect --url https://www.instagram.com/example/ --site instagram --json
node --input-type=module -e "import { generateServerRegistration } from './mcp/src/register.mjs'; console.log(JSON.stringify(generateServerRegistration('claude-code'), null, 2))"
```

<details>
<summary><strong>Providers y módulos de acción de Instagram —— detalles</strong></summary>

**Providers (solo metadatos).** `engine/cli.mjs live --provider <id>` selecciona **solo metadatos** —— pistas de dominio/origen y cookie/perfil para `naver`, `instagram`, `youtube`, `x`, `coupang`, `tiktok` o `generic`. Los providers nunca autorizan orígenes más amplios ni eluden los controles de seguridad, reconocimiento o preguntas previas; un provider desconocido falla de forma segura (fail closed).

**Módulos de acción de Instagram.** Flujos reutilizables basados en un driver JS para automatizar **tu propia** cuenta de Instagram autenticada, ubicados bajo `engine/providers/instagram/`. Requieren un `page` real de Playwright (no el modo Playwright-MCP) e incluyen barreras de seguridad: las escrituras son dry-run por defecto, las respuestas de DM solo apuntan a conversaciones existentes (sin contacto en frío), y las respuestas masivas tienen tope, límite de tasa, confirmación humana y son reanudables.

```js
import { buildInstagramSession, instagramActions } from './engine/providers/instagram/index.mjs';
const session = buildInstagramSession(page, { stateDir: paths.stateDir, interactive: true });
const posts = await instagramActions.getUserPosts(session, 'nasa', { limit: 12 });
await instagramActions.likePost(session, 'https://www.instagram.com/p/ABC/', { dryRun: false });
```
</details>

## Espacio de trabajo en tiempo de ejecución

Todo el estado en tiempo de ejecución vive bajo `~/.hyper-cloaking/` (sobrescribe con `HYPER_CLOAKING_HOME` solo para pruebas en sandbox):

```
~/.hyper-cloaking/
├── cookie.yml       # entradas de cookies sitio/cuenta (nunca commiteadas)
├── profiles/        # perfiles de navegador persistentes
├── downloads/       # archivos descargados
├── evidence/        # informes y capturas
├── logs/            # logs de ejecución
├── state/           # ventanas de límite de tasa, estado reanudable
└── cache/cloakbrowser/   # binarios de Chromium sigiloso descargados
```

## Estructura del repositorio

```
plugins/hyper-cloaking/skills/hyper-cloaking/ # skill canónica (SKILL.md, engine, rules, references)
skills/hyper-cloaking/                # mirror raíz de la skill canónica
.claude/skills/hyper-cloaking/  # mirror de skill de Claude Code
.agents/skills/hyper-cloaking/  # mirror de AgentSkills
.claude-plugin/marketplace.json # manifiesto de marketplace de Claude Code
.agents/plugins/marketplace.json# manifiesto de marketplace de Codex
scripts/validate.mjs            # validación de estructura + paridad de mirrors
```

Los directorios de skill se mantienen replicados byte a byte. Valida la paridad y los metadatos con `npm run validate`.

## Desarrollo

```bash
npm run validate      # comprobaciones de estructura y paridad de mirrors
npm run lint          # oxlint sobre plugins, scripts y tests
npm run format        # escritura con prettier
npm test              # pruebas E2E raíz y pruebas unitarias del motor
npm run ci            # comprobación de CI local completa
node skills/hyper-cloaking/engine/cli.mjs validate --json   # autoverificación del motor (sin red)
```

`npm test` ejecuta la suite E2E raíz (`tests/e2e/`) y las pruebas unitarias del motor reubicadas en `tests/unit/engine/` (que importan el código fuente canónico `plugins/hyper-cloaking/skills/hyper-cloaking/engine/`). `npm run validate` demuestra la paridad byte a byte entre los directorios de skill replicados.
Después de la primera ejecución correcta de GitHub Actions, configura un Ruleset para la rama `main` solo tras confirmar que las comprobaciones de trabajo requeridas se llaman `quality` y `Node 20 compatibility`; este repositorio no aplica esa configuración automáticamente.

---

<div align="center">

**MIT © alpox** —— construido sobre [CloakBrowser](https://github.com/CloakHQ/CloakBrowser) + [Playwright MCP](https://github.com/microsoft/playwright-mcp), solo para navegación autorizada.

</div>
