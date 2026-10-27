# Reporte de margen bajo por Telegram

## Alcance

`/api/telegram-margin-report` genera un archivo independiente por sucursal para
`ALMACEN PAS`, `VARIEDADES PAS` o `STIHL`. Incluye todos los productos cuyo
`StockTotal` conocido sea mayor que cero y cuyo `MargenActual%` conocido este
entre 1% y 10%, ambos limites incluidos. No exige ventas ni rotacion y no excluye
el codigo `00000609` en ninguna sucursal.

El Excel conserva las mismas 12 columnas del reporte de reposicion: codigo,
descripcion, venta neta total, los cuatro meses calendario incluyendo el actual
parcial, proveedor, costo con IVA, precio actual, stock total y margen actual.
Un producto sin ventas se presenta con total y meses en cero. Los campos
desconocidos se muestran como `NO HAY`; un cero conocido sigue siendo valido.
Los valores financieros provienen directamente de `buildDashboard`, sin cambiar
sus formulas, y el porcentaje se almacena como fraccion Excel con formato
`0.00%`. El orden es margen ascendente, stock descendente y codigo ascendente.

La carga de SIAPE es unica, usa `strictSalesPagination: true` y requiere
`onRawSales`. Cualquier dato crudo invalido o paginacion incompleta aborta el
reporte, aun si la venta no corresponde a un producto seleccionado.

## Configuracion

El endpoint exige `Authorization: Bearer <CRON_SECRET>` y solo admite GET o POST
con un unico query `branch` exacto. No acepta fechas, destino ni credenciales en
el request. El envio solo se habilita cuando
`TELEGRAM_MARGIN_REPORT_ENABLED=true`.

Configurar `TELEGRAM_BOT_TOKEN` y, cuando el nuevo destinatario haya abierto el
bot y su identidad haya sido confirmada por una persona autorizada,
`TELEGRAM_MARGIN_CHAT_ID` con un solo `chat_id` numerico. No usar
`TELEGRAM_CHAT_ID`: esa variable pertenece al reporte de reposicion. Un telefono
o nombre `@usuario` no identifica un chat y no debe vincularse automaticamente.
No registrar tokens, IDs, URLs de Telegram ni respuestas comerciales.

Hay tres crons separados a `0 12 * * *` UTC, equivalentes a las 07:00 de Ecuador:

- `/api/telegram-margin-report?branch=ALMACEN%20PAS`
- `/api/telegram-margin-report?branch=VARIEDADES%20PAS`
- `/api/telegram-margin-report?branch=STIHL`

Los crons y destinatarios del reporte de reposicion permanecen sin cambios.

## Pruebas

Desde la raiz:

```powershell
node --test server/margin-report.test.js
```

Las pruebas usan XLSX real y dobles locales; no consultan SIAPE ni Telegram.
