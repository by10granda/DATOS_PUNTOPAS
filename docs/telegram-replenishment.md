# Reportes de reposicion por Telegram

## Alcance

Cada ejecucion genera y envia un Excel para **una** sucursal: `ALMACEN PAS`,
`VARIEDADES PAS` o `STIHL`. Usa los cuatro meses calendario incluyendo el actual,
cobertura de 15 dias y omite stock desconocido. Solo en `VARIEDADES PAS` se excluye
el cemento `00000609`. Esas reglas y el corte en `America/Guayaquil` pertenecen a
`lib/replenishment.js`; el transporte no recalcula precios ni modifica la UI.

El endpoint utiliza `buildDashboard` con filtros neutros para obtener las mismas
filas y precios del dashboard, y una unica carga de SIAPE con
`strictSalesPagination: true` y `onRawSales`. El callback debe entregar todas las
ventas crudas despues de paginar y antes del filtro actual. Si falta el callback
o la paginacion estricta falla, no se envia. No se hace una segunda consulta de
ventas ni se fuerza una recarga de cache.

## Seleccion Y Pronostico

Rotacion significa cantidad neta vendida positiva durante los cuatro meses de
consulta. Las devoluciones se descuentan y cada venta se asigna a su mes
calendario real; el mes actual se identifica como parcial.

Se comparan media movil de 28 dias (SMA28), suavizado exponencial (SES) y TSB para
demanda intermitente. Con al menos 56 dias observados se elige por menor error
absoluto medio en los ultimos 28 dias, prediciendo antes de incorporar cada
observacion. En series cortas se usa la media neta. La demanda para cobertura
nunca es inferior a la media neta del periodo; esto evita omitir faltantes por
un pronostico reciente excesivamente bajo. No es un servicio de IA externo ni
una garantia de demanda futura, y no se conoce el historial de dias agotados.

Se incluyen todos los rotantes con stock conocido <= 0 o cuya cobertura sea
estrictamente menor a 15 dias. Se ordenan primero los agotados, despues por
menor cobertura y mayor venta. El stock desconocido no se interpreta como cero:
su conteo aparece en el Excel y en el mensaje para revision.

Cada archivo contiene codigo, descripcion, total vendido, cuatro columnas
mensuales, proveedor, costo con IVA, precio actual, stock total y margen actual.
Los datos faltantes se escriben como `NO HAY`; los ceros reales se conservan.
Los precios y el margen se toman del programa existente sin cambiar sus formulas.
El margen se guarda en Excel como fraccion con formato porcentual estandar:
un valor del programa de 33 se almacena como 0.33 y se muestra como 33.00%.

## Configuracion Segura

1. Crear un bot desde la cuenta oficial verificada `@BotFather`. Guardar su token
en un gestor de secretos y en `TELEGRAM_BOT_TOKEN` del entorno de despliegue.
No pegar tokens ni identificadores de chat en conversaciones, repositorios,
capturas, tickets o logs. Este cambio no crea ni modifica archivos `.env`.
2. El destinatario autorizado debe abrir el bot y enviar `/start` en un chat
privado. Un numero de telefono no permite deducir un `chat_id`.
3. Consultar `getUpdates` solo para identificar ese chat privado legitimo,
con autorizacion del destinatario. Revisar localmente el remitente y confirmar
con el usuario que es el destino correcto. Nunca vincular automaticamente el
primer chat recibido. Si hay varios chats, no elegir por orden de llegada.
4. Establecer `TELEGRAM_CHAT_ID` al identificador numerico confirmado, sin `+`,
espacios ni nombre `@usuario`. Aunque el validador acepta IDs negativos de Telegram,
este procedimiento de alta describe exclusivamente un chat privado autorizado.
Un numero de telefono sin `+` puede parecer numerico: la validacion sintactica no
reemplaza la confirmacion humana del destino.
5. Crear `CRON_SECRET` aleatorio de al menos 32 bytes y guardarlo como secreto
de Vercel. Se puede generar localmente con
`node -e "process.stdout.write(require('node:crypto').randomBytes(32).toString('hex'))"`.
No usar un valor de ejemplo ni publicarlo. Vercel lo enviara como
`Authorization: Bearer ...` en las solicitudes del cron.
6. Configurar las credenciales SIAPE existentes para las tres sucursales y usar
Node.js 24, que proporciona `fetch`, `FormData`, `Blob` y `AbortSignal.timeout`.
Activar `TELEGRAM_REPORT_ENABLED=true` solo despues de verificar el destinatario.
El resto de valores deja el envio desactivado.

### Consultar El Chat

Este comando PowerShell usa secretos ya presentes en el entorno del proceso,
sin cargar `.env` ni incluir el token en argumentos, historial o salida. No activar
trazas HTTP, debug del runtime ni transcript. Ejecutarlo localmente en una sesion
privada, no en CI o un terminal compartido. Su salida contiene IDs: no compartirla.
Si el bot tiene un webhook activo, `getUpdates` no funciona hasta resolver esa
configuracion con el responsable del bot; no eliminar webhooks automaticamente.

```powershell
@'
try {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  if (!token) throw new Error();
  const response = await fetch(`https://api.telegram.org/bot${token}/getUpdates`, {
    signal: AbortSignal.timeout(25000), redirect: 'error',
  });
  const data = await response.json();
  if (!response.ok || data.ok !== true) throw new Error();
  const chats = data.result.flatMap((update) => {
    const chat = update.message?.chat;
    return chat?.type === 'private'
      ? [{ id: String(chat.id), username: chat.username, firstName: chat.first_name }]
      : [];
  });
  console.log(JSON.stringify(chats, null, 2));
} catch {
  console.error('No se pudo consultar el chat. Revisar configuracion de forma privada.');
  process.exitCode = 1;
}
'@ | node --input-type=module
```

No registrar la URL construida: el token forma parte de la ruta exigida por la API
de Telegram. El endpoint nunca acepta destinos, telefonos ni tokens del request.

## Horario Y Primer Envio

Se agregan tres crons separados, todos `0 12 * * *` en UTC: equivalen a las 07:00
de `America/Guayaquil`. Los tres crons anteriores permanecen sin cambios. Cada
funcion tiene `maxDuration: 60` y exige `query.branch`, sin opcion de todas las
sucursales. Los crons de Vercel se ejecutan en produccion; comprobar que el plan
admita el total de crons configurados.

En Hobby, Vercel puede ejecutar dentro de la hora **07:00-07:59**, no necesariamente
a las 07:00 exactas. Si hace falta precision de minuto, evaluar Pro o un scheduler
externo autenticado y sus garantias; esto no es una promesa de puntualidad.
Referencia: https://vercel.com/docs/cron-jobs/usage-and-pricing

Para el primer envio, ejecutar un POST autenticado por sucursal. Con el origen de
produccion en `REPORT_BASE_URL` y el secreto ya disponible en el entorno del
proceso, este comando envia las tres solicitudes secuencialmente, sin secretos
literales y sin imprimir datos comerciales de las respuestas:

```powershell
@'
try {
  const base = new URL(process.env.REPORT_BASE_URL);
  if (base.protocol !== 'https:' || base.username || base.password || !process.env.CRON_SECRET) throw new Error();
  for (const branch of ['ALMACEN PAS', 'VARIEDADES PAS', 'STIHL']) {
    const url = new URL('/api/telegram-stock-report', base);
    url.searchParams.set('branch', branch);
    const response = await fetch(url, {
      method: 'POST', redirect: 'error',
      headers: { Authorization: `Bearer ${process.env.CRON_SECRET}` },
      signal: AbortSignal.timeout(65000),
    });
    console.log(branch, response.status);
    if (!response.ok) break;
  }
} catch {
  console.error('Fallo la solicitud manual; verificar el destino antes de repetir.');
  process.exitCode = 1;
}
'@ | node --input-type=module
```

Confirmar antes que `REPORT_BASE_URL` sea el dominio propio correcto. No compartir
este secreto con un dominio ajeno. Tambien se admite GET autenticado para cron.
No pasar el secreto en query ni usar el body para configuracion. Solo se acepta
`branch` en query; no se admite `refresh`, fechas ni seleccion libre de destino.

## Respuestas Y Fallos

- Sin Bearer correcto: `401` antes de consultar SIAPE o revelar datos.
- Desactivado y autenticado: `200 {"skipped":"disabled"}`, sin carga ni envio.
- Sucursal o parametros invalidos: `400`; metodo distinto de GET/POST: `405`.
- Exito: `200` con `branch`, `count`, `filename`, `messageId`; nunca el Excel o sus filas.
- Configuracion, origen, construccion o envio fallidos: `502` con mensaje minimo.
Los logs de aplicacion solo contienen la sucursal validada y la fase, sin errores
crudos, URLs, credenciales ni respuesta remota.

Telegram recibe multipart `sendDocument` con un plazo total de envio de 25 segundos.
Solo se acepta JSON `ok: true` y un `result.message_id` entero positivo seguro.
Un HTTP 2xx con `ok: false` no es exito. Se reintenta **una** vez exclusivamente
tras HTTP 429 con rechazo JSON confirmado `ok: false`, `error_code: 429` y
`retry_after` entero entre 0 y 5 segundos. No se reintenta automaticamente ante
red, timeout, HTTP 5xx ni otras respuestas ambiguas para evitar duplicados.

No hay garantia exactly-once, cache de deduplicacion ni persistencia de entregas.
Una nueva invocacion vuelve a enviar incluso si el reporte no cambio. Un timeout
puede ocurrir despues de una entrega efectiva: revisar el chat antes de repetir
un POST. Para deduplicacion durable se necesita un almacen externo y un diseno
explicito de estados; una cache en memoria de serverless no lo resuelve.

## Pruebas Y Dependencias

Ejecutar standalone con Node 24, desde la raiz:

```powershell
node --test server/telegram-report.test.js
```

Las pruebas no cargan `.env`, no contactan SIAPE ni Telegram y usan Buffer de Excel
simulado para el transporte, mas una integracion local con Excel real sin filas.
La factory inyecta carga, construccion de filas, rango, reporte, envio y
reloj. `sendReportDocument` permite inyectar fetch, espera y timeout.

Las pruebas de `server/replenishment.test.js` validan los calculos y el XLSX;
`server/report-sources.test.js` comprueba el callback, la paginacion estricta y
la igualdad de resultados del dashboard con y sin observador. Las pantallas y
los calculos actuales no se modifican. La extension opcional del cargador solo
actua cuando el nuevo reporte la solicita.
