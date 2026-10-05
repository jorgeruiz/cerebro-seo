# SPEC — Plan mensual (Cerebro SEO)

> Contrato de diseño del módulo. Cada sesión de Claude Code parte de este documento.
> Si una sesión necesita desviarse, se detiene y lo reporta antes de implementar.

## 0. Propósito y principios

El Plan mensual convierte el diagnóstico SEO de un cliente en cambios reales en su sitio Next.js, con la máxima automatización segura. Es el primer paso hacia el **sitio vivo**: un sitio que se mejora solo según sus métricas.

Principios:

1. **Todo dentro de Cerebro SEO.** Sin Constructor ni Orquestador. Notion solo se toca vía el bridge de Cerebro web.
2. **Una sola fuente de recomendaciones:** el Análisis Claude.
3. **Nada llega a producción sin aprobación humana.** Una rama por plan; se revisa completa y se publica con un solo merge.
4. **Un solo motor de ejecución** (Claude Agent SDK en el servicio `cerebro-seo-worker`) para tareas de IA y para la terminal.
5. **Dos etapas:** el 100% mide la *ejecución* (tareas hechas en la rama o anuladas). La revisión y el merge son una etapa posterior del plan, no cuentan para la barra.

Fuera de alcance por ahora (visión futura): cron del día 1, selección automática de tareas por Claude, ejecución sin aprobación.

## 1. Flujo de punta a punta

| # | Dónde | Quién | Qué pasa |
|---|---|---|---|
| 1 | Cliente → Análisis | Jorge / Félix | Genera el Análisis Claude: diagnóstico (dónde estamos, oportunidades, si vamos bien) + **tareas candidatas**: 4–8 de contenido y 4–8 de código, ordenadas por prioridad vs. easy win. Cada una con modo **IA / Híbrida / Humana**. |
| 2 | Análisis | Jorge / Félix | Selecciona candidatas (puede cambiar el modo) → **"Mandar al plan"**. |
| 3 | Segundo plano | Claude | Por cada tarea seleccionada: plan paso a paso, tipo de cada paso (IA / humano) y prompt autosuficiente para cada paso de IA, con criterios de aceptación. Job en BullMQ con reintentos; nunca queda a medias. |
| 4 | Cliente → Plan mensual | Jorge / Félix | Dos columnas: **tareas** (desplegables con sus pasos) y **terminal web** a la derecha. |
| 5 | Plan mensual | Jorge / Félix | Tarea IA → "Ejecutar": corre sus pasos uno a uno con progreso visible. Una tarea a la vez por cliente. |
| 6 | Plan mensual | Jorge / Félix | Tarea híbrida → "Ejecutar": corre los pasos de IA y se detiene en el paso humano; se resuelve (en la terminal o fuera) y se marca el paso como hecho; continúa. |
| 7 | Terminal | Jorge / Félix | Tarea humana → se trabaja directo en la terminal sobre la rama de la tarea y se marca como lista. |
| 8 | Plan mensual | Sistema | Tarea con pasos terminados → su commit queda en la rama del plan → **Hecha**. La barra total avanza. |
| 9 | Plan mensual | Jorge / Félix | Tarea que falla o es más compleja de lo previsto → **Anular** (con motivo; si dejó commit, se revierte). Cuenta para el 100% y queda como pendiente para el siguiente Análisis. |
| 10 | Plan mensual | Jorge / Félix | Plan al 100% → **En revisión**: un solo PR `plan → main` con un solo preview que muestra todos los cambios. Se corrige desde la terminal sobre la rama del plan o se revierte el commit de una tarea. |
| 11 | Plan mensual | Jorge / Félix | **Merge** (una vez) → producción → plan **Publicado**: resumen final con links a producción y costo → registros en Bitácora y Estrategia Mensual de Notion vía Cerebro. |

## 2. Estado actual (Sesión 1 — completa)

- Servicio `cerebro-seo-worker` (`Dockerfile.worker`, `src/worker/*`), cola `plan-task-execution` con concurrency 1.
- Agent SDK (`@anthropic-ai/claude-agent-sdk`, `query()`), `canUseTool` con lista blanca y negación por defecto.
- Flujo por tarea: clonar/actualizar repo → clasificar memoria del sitio → agente → build del worker → commit → push `cr/{id}` → PR → preview. *(S2 lo cambia a rama por plan, ver sección 4.)*
- Modelos `MonthlyPlan`, `PlanTask`, `TaskRun`; campos de mapeo en `Site` (`githubRepo`, `vercelProjectId`, `defaultBranch`).
- Scripts `import-site-repos.ts` y `run-task.ts`.

## 3. Modelo de datos objetivo

Cambios respecto a la Sesión 1 (se hacen en S2 con una sola migración validada con `prisma migrate diff`):

**MonthlyPlan**
- Agregar `cycleId` → relación con `MonthlyCycle` existente (el plan es la capa de ejecución del ciclo; no se duplica el ciclo). Validar en S2 que el `@@unique([clientId, month])` sea consistente con `MonthlyCycle`.
- Agregar `analysisId` (Análisis del que salió) y `completedAt`.
- Estados: `PLANNING | ACTIVE | IN_REVIEW | PUBLISHED`.
- Agregar `branchName`, `prNumber?`, `prUrl?`, `previewUrl?`, `mergedAt?`, `mergedById?`.

**PlanTask** (ajustes)
- `lane AUTO|ASSISTED|MANUAL` → `mode AI | HYBRID | HUMAN`.
- Agregar: `kind CONTENT | CODE`, `priority` (int), `effort` (`LOW|MEDIUM|HIGH`), `sourceCandidateId`, `commitShas String[]`, `resultUrls String[]` (URLs en producción, se llenan al publicar), `voidReason?`, `completedById?`, `completedAt?`.
- Quitar de PlanTask `branchName`, `prNumber`, `prUrl`, `previewUrl` (pasan a MonthlyPlan).
- Estados: `PLANNING → READY → RUNNING → WAITING_HUMAN → DONE`, más `FAILED` y `VOIDED`.

**PlanStep** (nuevo)
- `id, taskId, order, title, type (AI | HUMAN), prompt? (solo AI), acceptanceCriteria String[], status (PENDING | RUNNING | DONE | FAILED | WAITING_HUMAN | SKIPPED), completedById?, notes?, timestamps`.

**TaskRun** (ajustes)
- Agregar `stepId?` (corrida de un paso de IA) y `kind AUTO | TERMINAL` (ya existe).
- Agregar `changedRoutes String[]` (rutas que el agente reporta haber creado o modificado).

**Progreso**
- Tarea: pasos `DONE|SKIPPED` / total de pasos.
- Plan (barra de ejecución): tareas `DONE|VOIDED` / total de tareas. La revisión y el merge se muestran como estado del plan, no en la barra.

## 4. Reglas de ejecución

1. **Una rama por plan:** `plan/{cliente-slug}-{YYYY-MM}`, un solo PR contra `main`. Cada tarea = uno o más commits etiquetados con su `taskId` en el mensaje (`[task:<id>] título`), para poder revertirla sola.
2. **Sincronización con main:** antes de cada tarea y antes del merge final, el worker trae `main` a la rama del plan (merge, no rebase). Si hay conflicto, la tarea pasa a `WAITING_HUMAN` para resolverlo en la terminal.
3. **Una escritura a la vez por plan** (candado en Redis con TTL): una tarea de IA o la terminal, nunca ambas.
4. **Elegibilidad del cliente:** solo clientes activos con servicio SEO contratado (desde Notion vía el bridge) y sitio con `Site.platform = NEXTJS` en producción. Con `WORDPRESS` o `MIGRACION` (producción aún en WordPress, p. ej. migración no autorizada por el cliente) no se ejecutan pasos de IA: las métricas miden el sitio WordPress del dominio, no el repo. Se puede preparar el repo (memoria del sitio, bootstrap), pero el Plan mensual queda deshabilitado hasta que la producción sea Next.js.
5. **Memoria del sitio incompleta** (`TEMPLATE|ABSENT`): los pasos de IA no corren; la tarea pasa a `WAITING_HUMAN` con el motivo.
6. **Publicación:** un solo merge `plan → main` vía la API de GitHub (merge commit, no squash, para conservar los commits por tarea), solo si el build pasa y el preview está listo. Publicar antes del 100% es posible como excepción (botón secundario).
7. **Links a producción:** cada paso de IA termina con un bloque estructurado de `changedRoutes`; el worker arma las URLs con el dominio del `Site`. Tras el merge del plan, se verifica que cada URL responda 200 antes de mostrarla como publicada.
8. **Permisos:** ADMIN (`ADMIN_EMAILS`) ejecuta, aprueba, anula y usa la terminal. EDITOR solo ve.
9. **Costos:** cada corrida registra costo y tokens en `TaskRun` y `ApiUsage`. Límite por paso (`AGENT_MAX_BUDGET_USD`) y por tarea.
10. **El proceso web nunca ejecuta agentes.** Solo encola, transmite eventos y lee estado.

## 5. Sesiones

### S2 — Análisis unificado + "Mandar al plan"

- Análisis Claude genera diagnóstico + candidatas (4–8 contenido, 4–8 código) con `kind`, `mode`, prioridad, esfuerzo y justificación. Salida JSON validada con Zod.
- Entrada adicional del Análisis: tareas `VOIDED` y `FAILED` del plan anterior, y resultados de hipótesis del ciclo cerrado.
- Retirar Próximos Pasos (`NextStepPlan`, Advisor, `NextStepsPanel`) previo inventario de dependencias; migrar lo útil al Análisis.
- Decidir la relación con el módulo `ContentPlan` (input del Análisis o fusión); reportar antes de tocarlo.
- UI en Análisis: lista de candidatas con selección, cambio de modo y botón **"Mandar al plan"**.
- Job en segundo plano (cola existente de IA, no el worker de agentes): descompone cada tarea en `PlanStep` con prompts. Reintentos por tarea; un error en una tarea no bloquea las demás.
- Migración de schema de la sección 3.
- Gate de elegibilidad (sección 4, regla 4): `Site.platform` (de la sesión de filtros de clientes) + activo + servicio SEO. "Mandar al plan" y "Ejecutar" se deshabilitan con el motivo visible.
- Worker: cambiar de rama por tarea a rama por plan (sección 4, reglas 1–3), con commits etiquetados por `taskId` y sincronización con `main`.

**Aceptación:** generar un Análisis real, seleccionar 6 tareas, mandarlas al plan y ver en BD las 6 tareas con pasos y prompts, sin intervención.

### S3 — Página Plan mensual

- Ruta `clientes/[id]/plan-mensual`. Columna izquierda: tareas agrupadas por modo, desplegables con pasos, estados, barra por tarea y barra total. Columna derecha: espacio reservado para la terminal (S4).
- Acciones por tarea: **Ejecutar** (IA/híbrida), **Marcar paso humano como hecho**, **Marcar tarea humana como hecha**, **Anular** (con motivo; revierte sus commits si los hay).
- Acciones del plan: al 100% → **Pasar a revisión** (crea o actualiza el PR único y muestra el preview); en revisión → **Revertir tarea** y **Merge**.
- El worker ejecuta pasos en orden; ante un paso `HUMAN` se detiene en `WAITING_HUMAN`.
- Progreso en vivo (SSE o polling corto) con log resumido del paso en curso y el error si falla.
- Merge del plan vía la API de GitHub + verificación de URLs + `resultUrls`.

**Aceptación:** en un cliente real, una tarea IA, una híbrida y una anulada llevan el plan al 100%; el plan pasa a revisión con un solo preview, se hace un merge y aparecen links a producción funcionando.

### S4 — Terminal web

- Panel derecho de Plan mensual. Trabaja siempre sobre la **rama del plan**; si hay una tarea seleccionada, sus commits se etiquetan con su `taskId`; si no, como `[plan:review]`.
- Sesión del Agent SDK en el worker con `persistSession` y reanudación por `session_id` (transcripts en el volumen). Comunicación web ↔ worker vía Redis (pub/sub o streams) y SSE hacia el navegador.
- Streaming de mensajes del agente, input del usuario, y aprobación en UI para herramientas fuera de la lista blanca (vía `canUseTool`).
- Botón **Guardar en la rama** (commit + push; actualiza el PR y el preview).
- Respeta el candado por plan y los límites de costo y tiempo por sesión.

**Aceptación:** Félix completa una tarea humana y corrige el plan en revisión desde la terminal sin usar Claude Code local.

### S5 — Cierre del plan

- Vista de resumen al publicar: tareas hechas con links a producción, anuladas con motivo, costo total.
- Registros en Notion vía nuevos endpoints del bridge de Cerebro web, al publicar: una entrada de Bitácora por tarea y la actualización de Estrategia Mensual. Idempotentes.
- **Revertir tarea publicada:** el worker crea un PR que revierte los commits de esa tarea.
- `MonthlyPlan → PUBLISHED` y enlace con el cierre del `MonthlyCycle`.

**Aceptación:** un plan real publicado con registros visibles en Notion.

## 6. Decisiones abiertas (resolver en la sesión indicada)

- S2: relación final con `ContentPlan`.
- S2: confirmar `MonthlyPlan` ↔ `MonthlyCycle` sin duplicar responsabilidades.
- S4: transporte de streaming (SSE + Redis streams propuesto).
- Futuro: migrar `GITHUB_PAT_CLIENT_REPOS` a una GitHub App; cron del día 1; selección automática de tareas.
