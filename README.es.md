[English](README.md) | [한국어](README.ko.md) | [中文](README.zh.md) | [日本語](README.ja.md) | Español

<div align="center">

# Hyper Cloaking

**Sea cual sea la tarea de navegador, tu agente la termina. Si tienes autorización para probarlo, Hyper Cloaking lo consigue.**

Un navegador sigiloso al ritmo humano para agentes de IA, que ejecuta [CloakBrowser](https://github.com/CloakHQ/CloakBrowser) detrás de [Playwright MCP](https://github.com/microsoft/playwright-mcp). Sin configuración manual, sin resultados a medias del tipo "la página cargó": termina con evidencia.

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

**Claude Code · Codex · Cursor · OpenClaw · Hermes Agent · Gajae-Code** —— cualquier agente compatible con MCP que cargue `SKILL.md`. Pistas de metadatos integradas para **Naver · Reddit · Instagram · YouTube · X**, más un modo `generic` para cualquier sitio que estés autorizado a probar.

## ⚙️ Por qué funciona

- **Un navegador sigiloso real, no un User-Agent parcheado** —— ejecuta el Chromium de CloakBrowser detrás de Playwright MCP, con huellas de navegador genuinas en lugar de una simple cabecera cambiada.
- **Al ritmo humano por defecto** —— cada ejecución operativa fuerza `humanize: true`: movimiento de ratón, escritura y desplazamiento a cadencia humana, para que los flujos automatizados largos no se atasquen ni se rompan a mitad de tarea.
- **Pasa por controles antes de lanzarse** —— la clasificación de seguridad del objetivo, la base de autorización, los orígenes permitidos y una ronda de preguntas previas ocurren *antes* de que se abra ningún navegador.
- **Sin evidencia no está hecho** —— que una página cargue nunca es "completado". La tarea solo termina cuando el resultado está probado, y devuelve un resultado estructurado.
- **Configuración sin complicaciones** —— verifica Node.js, `cloakbrowser`, `playwright-core` y Playwright MCP, y luego instala o repara lo que falte.

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
3. **Control de configuración** —— verifica Node.js, `cloakbrowser`, `playwright-core` y Playwright MCP; instala o repara lo que falte.
4. **Espacio de trabajo en tiempo de ejecución** —— inicializa `~/.hyper-cloaking/` para `cookie.yml`, perfiles, descargas, evidencia, logs y estado.
5. **Manejo de cookies** —— normaliza y carga cookies que coincidan con el sitio (JSON exportado de Chrome, arrays de Playwright, entradas multicuenta) mediante un helper dedicado, sin almacenar nunca valores en bruto en el repositorio.
6. **Resolución del ejecutable** —— localiza el binario de Chromium de CloakBrowser en caché bajo `~/.hyper-cloaking/cache/cloakbrowser/`.
7. **Lanzamiento al ritmo humano** —— se ejecuta con `humanize: true` obligatorio en cada ejecución operativa (ratón, escritura y desplazamiento a ritmo humano).
8. **Configuración de MCP** —— emite la configuración para Codex TOML, JSON `mcpServers` (Claude Code / Cursor), OpenClaw `mcp.servers`, Hermes `mcp_servers` o un comando CLI directo, apuntando `@playwright/mcp` al ejecutable de CloakBrowser.
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

## Fragmentos de configuración MCP

Una vez resuelto el binario de Chromium de CloakBrowser, apunta Playwright MCP hacia él. Los lanzamientos por defecto son **headless** y **sandboxed**; quita `--headless` para navegación visible.

**Comando directo**

```bash
npx @playwright/mcp@latest --headless --sandbox \
  --executable-path ~/.hyper-cloaking/cache/cloakbrowser/chromium-146.0.7680.177.3/chrome
```

**Codex (`~/.codex/config.toml`)** —— usa una ruta completamente expandida:

```toml
[mcp_servers.hyper-cloaking]
command = "npx"
args = ["@playwright/mcp@latest", "--headless", "--sandbox", "--executable-path", "/Users/you/.hyper-cloaking/cache/cloakbrowser/chromium-146.0.7680.177.3/chrome"]
```

**Claude Code / Cursor (`mcpServers` JSON)**

```json
{
  "mcpServers": {
    "hyper-cloaking": {
      "command": "npx",
      "args": ["@playwright/mcp@latest", "--headless", "--sandbox", "--executable-path", "/Users/you/.hyper-cloaking/cache/cloakbrowser/chromium-146.0.7680.177.3/chrome"]
    }
  }
}
```

**OpenClaw (`mcp.servers.<name>`)** y **Hermes (`mcp_servers.<name>` en `~/.hermes/config.yaml`)** siguen la misma forma command/args bajo sus respectivas claves de configuración.

Genera cualquiera de estas de forma determinista:

```bash
node skills/hyper-cloaking/engine/cli.mjs mcp-config --json
node skills/hyper-cloaking/engine/cli.mjs mcp-config --client codex --json
node skills/hyper-cloaking/engine/cli.mjs mcp-config --headed
```

## Helpers del motor

Los helpers de tiempo de ejecución viven bajo `skills/hyper-cloaking/engine/` y son la interfaz soportada.

| Helper | Propósito |
|---|---|
| `engine/cli.mjs` | Comandos `validate` / `smoke` / `mcp-config` / `live`; renderiza la config MCP y ejecuta verificación en vivo contenida. |
| `engine/cookie.mjs` | Importa, normaliza, inspecciona, enmascara e inyecta cookies (JSON exportado de Chrome, arrays de Playwright, entradas sitio/cuenta de `cookie.yml`). |
| `engine/browser-utils.mjs` | Inicializa `~/.hyper-cloaking/`, lanza CloakBrowser con `humanize: true` y provee helpers `humanMove` / `humanClick` / `humanType` / `humanScroll` / XPath. |

```bash
node skills/hyper-cloaking/engine/browser-utils.mjs init
node skills/hyper-cloaking/engine/cookie.mjs inspect --url https://www.instagram.com/example/ --site instagram --json
node skills/hyper-cloaking/engine/cli.mjs mcp-config --help
```

<details>
<summary><strong>Providers y módulos de acción de Instagram —— detalles</strong></summary>

**Providers (solo metadatos).** `engine/cli.mjs live --provider <id>` selecciona **solo metadatos** —— pistas de dominio/origen y cookie/perfil para `naver`, `reddit`, `instagram`, `youtube`, `x` o `generic`. Los providers nunca autorizan orígenes más amplios ni eluden los controles de seguridad, reconocimiento o preguntas previas; un provider desconocido falla de forma segura (fail closed).

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
skills/hyper-cloaking/          # skill canónica (SKILL.md, engine, rules, references)
plugins/hyper-cloaking/         # copia empaquetada como plugin para marketplaces
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
npm run lint          # oxlint sobre plugins y scripts
npm run format        # escritura con prettier
npm test              # pruebas E2E raíz y del motor canónico
npm run ci            # comprobación de CI local completa
node skills/hyper-cloaking/engine/cli.mjs validate --json   # autoverificación del motor (sin red)
```

`npm test` ejecuta la suite E2E raíz y las pruebas canónicas de `skills/hyper-cloaking/engine`. `npm run validate` demuestra la paridad byte a byte entre los directorios de skill replicados.
Después de la primera ejecución correcta de GitHub Actions, configura un Ruleset para la rama `main` solo tras confirmar que las comprobaciones de trabajo requeridas se llaman `quality` y `Node 20 compatibility`; este repositorio no aplica esa configuración automáticamente.

---

<div align="center">

**MIT © alpox** —— construido sobre [CloakBrowser](https://github.com/CloakHQ/CloakBrowser) + [Playwright MCP](https://github.com/microsoft/playwright-mcp), solo para navegación autorizada.

</div>
