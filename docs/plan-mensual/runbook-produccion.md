# Runbook de Produccion — Plan Mensual F1

> Comandos para correr en la consola de Easypanel (Sh del servicio cerebro-seo).
> NUNCA imprimir secretos — los scripts leen desde las variables de entorno del servicio.

---

## 1. Migrar actionTypes legacy

Resuelve aliases deprecated en PlanTask existentes:
- `edit_page_widgets` -> `edit_page_text`
- `upload_media` / `generate_image` -> `add_image`
- `create_landing_from_template` -> `create_landing`
- `verify_tracking` -> `verify_analytics`
- `update_post` -> context-dependent

```bash
# Paso 1: dry-run (solo muestra conteos, no modifica)
npx tsx scripts/migrate-action-types.ts

# Paso 2: aplicar cambios
npx tsx scripts/migrate-action-types.ts --apply
```

Salida esperada:
```
=== Migracion de actionTypes ===
Modo: DRY-RUN | APPLY

Por tipo:
  edit_page_widgets → edit_page_text: 3
  upload_media → add_image: 1
  ...

Total: N tareas a migrar
ClassificationEvents creados: N
```

---

## 2. Exportar fixtures de clasificacion

Exporta 40-60 objetivos reales de la BD como fixtures para evaluar el clasificador.

```bash
npx tsx scripts/export-classification-fixtures.ts
```

Salida: `scripts/eval/production-fixtures.json`

Despues de exportar:
1. Descargar el archivo
2. Revisar campo `expected` (propuesto por el sistema)
3. Corregir los que esten mal
4. Cambiar `status` a `"validado"` en los revisados
5. Subir de vuelta para la evaluacion

---

## 3. Evaluar clasificador

Corre contra los fixtures (validados o no).

```bash
# Modo rapido (gratis, ~65% accuracy — solo senales)
npx tsx scripts/eval-classifier.ts --mode=quick

# Modo completo (LLM, ~$0.01/fixture, ~92% accuracy)
npx tsx scripts/eval-classifier.ts --mode=full

# Con fixtures custom
npx tsx scripts/eval-classifier.ts --mode=full --file=scripts/eval/production-fixtures.json
```

Si el costo pasa de $1 USD, el script pide confirmacion antes de continuar.

Salida:
- Precision global y por actionType
- Tasa de "other"
- Casos fallidos con detalle
- Confusiones frecuentes
- Resultados guardados en `scripts/eval/eval-results-{mode}.json`

---

## 4. Fix actionTypes faltantes

Para tareas que no tienen actionType (creadas antes de F1b):

```bash
# dry-run
npx tsx scripts/fix-action-types.ts

# aplicar
npx tsx scripts/fix-action-types.ts --apply
```

---

## Notas

- Los scripts usan `DATABASE_URL` del entorno del servicio (ya configurado en Easypanel)
- `ANTHROPIC_API_KEY` solo necesaria para eval --mode=full
- Los scripts no modifican secretos ni env vars
- Todos los cambios quedan loggeados en ClassificationEvent (tabla `classification_events`)
