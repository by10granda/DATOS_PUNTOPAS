import { setTimeout as delay } from 'node:timers/promises';

export async function sendReportDocument({ token, chatId, report, fetchImpl = fetch, timeoutMs = 25_000, sleep = delay }) {
  const failure = () => new Error('No se pudo enviar el reporte a Telegram.');
  if (typeof token !== 'string' || !token.trim() || /\s/.test(token)
    || typeof chatId !== 'string' || !/^-?[1-9]\d*$/.test(chatId)
    || !Buffer.isBuffer(report?.buffer) || !report.buffer.length) throw failure();

  try {
    const signal = AbortSignal.timeout(timeoutMs);
    const caption = (Array.isArray(report.captionLines) ? report.captionLines : [
      `Sucursal: ${report.branch}`,
      `Periodo: ${report.dateStart} a ${report.dateEnd} (4 meses, actual incluido)`,
      `Productos criticos: ${report.count}`,
      'Cobertura: 15 dias',
      `Corte: ${report.generatedAt}`,
      `Stock desconocido omitido: ${report.skippedUnknownStock}`,
    ]).join('\n');
    for (let attempt = 0; attempt < 2; attempt += 1) {
      const form = new FormData();
      form.set('chat_id', chatId);
      form.set('caption', caption);
      form.set('document', new Blob([report.buffer], {
        type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      }), report.filename);
      const response = await fetchImpl(`https://api.telegram.org/bot${token}/sendDocument`, {
        method: 'POST', body: form, signal, redirect: 'error',
      });
      // Only an explicit Telegram rate-limit rejection is safe to retry.
      if (!response.ok && response.status !== 429) throw failure();
      const body = await response.json();
      const retryAfter = body?.parameters?.retry_after;
      if (attempt === 0 && response.status === 429 && body?.ok === false
        && body?.error_code === 429 && Number.isInteger(retryAfter) && retryAfter >= 0 && retryAfter <= 5) {
        await sleep(retryAfter * 1000, undefined, { signal });
        continue;
      }
      const messageId = body?.result?.message_id;
      if (!response.ok || body?.ok !== true || !Number.isSafeInteger(messageId) || messageId <= 0) throw failure();
      return messageId;
    }
    throw failure();
  } catch {
    // Never propagate fetch errors: their messages can contain the secret URL.
    throw failure();
  }
}
