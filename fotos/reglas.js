/* ==========================================================================
   REGLAS.JS — Reglas de la galería con QR (Invitara)
   --------------------------------------------------------------------------
   Funciones puras: no tocan la página ni la hoja. Las usa:
   - la página de subida (subir.js), para avisar antes de enviar;
   - el Apps Script (apps-script/Code.gs), que tiene una COPIA EXACTA del
     bloque marcado abajo, porque el servidor no confía en la página;
   - las pruebas de Node (pruebas/unitarias/).
   Si cambias algo entre las marcas, corre
   node herramientas/sincronizar-reglas.js  (una prueba avisa si se te olvida).
   ========================================================================== */

(function (raiz, fabrica) {
  var api = fabrica();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else raiz.InvitaraReglas = api;
})(typeof self !== 'undefined' ? self : this, function () {
  // ===== INICIO REGLAS COMPARTIDAS (copiar igual a Code.gs) =====

  var LIMITES = {
    nombre: 60,
    mesa: 12,
    mensaje: 300,
    fotosPorVez: 30,
    ladoMaximo: 2000,
    bytesFoto: 8 * 1024 * 1024,
    bytesMiniatura: 300 * 1024,
    fotosPorHora: 300
  };

  var MESES = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio',
    'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];

  var MENSAJE_CERRADA = 'La galería ya cerró. ¡Gracias por compartir!';

  /** Quita espacios de más y recorta a un largo máximo. */
  function recortar(texto, maximo) {
    if (texto === undefined || texto === null) return '';
    return String(texto).replace(/\s+/g, ' ').trim().slice(0, maximo);
  }

  /** Igual que recortar, pero respeta los saltos de línea (para el mensaje). */
  function recortarMensaje(texto, maximo) {
    if (texto === undefined || texto === null) return '';
    return String(texto)
      .replace(/\r\n?/g, '\n')
      .split('\n').map(function (linea) { return linea.replace(/[ \t]+/g, ' ').trim(); }).join('\n')
      .replace(/\n{3,}/g, '\n\n')
      .trim()
      .slice(0, maximo);
  }

  /** "07" → "7", " Novios " → "Novios". Solo letras, números y espacios. */
  function normalizarMesa(valor) {
    var texto = recortar(valor, 40).replace(/[^0-9A-Za-zÁÉÍÓÚÜÑáéíóúüñ ]/g, '').trim();
    if (/^\d+$/.test(texto)) texto = String(parseInt(texto, 10));
    return texto.slice(0, LIMITES.mesa);
  }

  /** Acepta "SÍ", "Si", "sí", true… como abierto. Todo lo demás es cerrado. */
  function estaAbierto(valor) {
    if (valor === true) return true;
    var texto = String(valor === undefined || valor === null ? '' : valor).trim().toLowerCase();
    return texto === 'sí' || texto === 'si' || texto === 'true';
  }

  /** "2026-12-12" → { anio, mes, dia } o null si no es una fecha válida. */
  function leerFecha(fechaISO) {
    var partes = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(fechaISO || '').trim());
    if (!partes) return null;
    var anio = +partes[1], mes = +partes[2], dia = +partes[3];
    var prueba = new Date(Date.UTC(anio, mes - 1, dia));
    if (prueba.getUTCMonth() !== mes - 1 || prueba.getUTCDate() !== dia) return null;
    return { anio: anio, mes: mes, dia: dia };
  }

  /**
   * La fecha de cierre cuenta COMPLETA (hasta las 11:59 pm hora del centro de México).
   * México ya no cambia de horario: la Ciudad de México está en UTC-6 todo el año.
   * Sin fecha de cierre (vacía o inválida) nunca cierra sola.
   */
  function fechaCierreVencida(fechaISO, ahora) {
    var f = leerFecha(fechaISO);
    if (!f) return false;
    var finDelDia = Date.UTC(f.anio, f.mes - 1, f.dia + 1, 6, 0, 0);
    var momento = ahora instanceof Date ? ahora.getTime() : (ahora === undefined ? Date.now() : +ahora);
    return momento >= finDelDia;
  }

  /** "2026-12-12" → "12 de diciembre de 2026" */
  function fechaEnTexto(fechaISO) {
    var f = leerFecha(fechaISO);
    if (!f) return String(fechaISO || '');
    return f.dia + ' de ' + MESES[f.mes - 1] + ' de ' + f.anio;
  }

  /** config: { abierto, fechaCierre } → { abierto, mensaje } */
  function estadoGaleria(config, ahora) {
    config = config || {};
    if (!estaAbierto(config.abierto) || fechaCierreVencida(config.fechaCierre, ahora)) {
      return { abierto: false, mensaje: MENSAJE_CERRADA };
    }
    return { abierto: true, mensaje: '' };
  }

  /** Quita el "data:image/jpeg;base64," y los espacios. Devuelve '' si no es base64. */
  function limpiarBase64(texto) {
    if (typeof texto !== 'string') return '';
    var limpio = texto.replace(/^data:[^,]*,/, '').replace(/\s+/g, '');
    return /^[A-Za-z0-9+/]+={0,2}$/.test(limpio) ? limpio : '';
  }

  /** Bytes que ocupa el archivo ya decodificado, calculado desde el texto base64. */
  function tamanoBase64(texto) {
    var largo = String(texto || '').length;
    if (!largo) return 0;
    var relleno = /==$/.test(texto) ? 2 : (/=$/.test(texto) ? 1 : 0);
    return Math.floor(largo * 3 / 4) - relleno;
  }

  /** Revisa que los primeros bytes sean los de un JPEG (FF D8 FF). Acepta bytes con o sin signo. */
  function esJPEG(bytes) {
    if (!bytes || bytes.length < 4) return false;
    return (bytes[0] & 0xff) === 0xff && (bytes[1] & 0xff) === 0xd8 && (bytes[2] & 0xff) === 0xff;
  }

  /**
   * Revisa una foto antes de guardarla (todo lo que se puede revisar sin decodificarla).
   * datos:  { nombre, mesa, mensaje, archivo, miniatura }
   * config: { abierto, fechaCierre }
   * Devuelve { ok, error, cerrada, limpio: { nombre, mesa, mensaje, archivo, miniatura } }.
   */
  function validarFoto(datos, config, ahora) {
    datos = datos || {};
    var estado = estadoGaleria(config, ahora);
    if (!estado.abierto) return { ok: false, cerrada: true, error: estado.mensaje };

    var archivo = limpiarBase64(datos.archivo);
    if (!archivo) return { ok: false, error: 'No llegó la foto. Elígela otra vez e intenta de nuevo.' };
    if (tamanoBase64(archivo) >= LIMITES.bytesFoto) {
      return { ok: false, error: 'La foto pesa más de 8 MB. Elige otra o tómala de nuevo.' };
    }

    // La miniatura es opcional: si viene mal, se ignora y la galería usa la de Google.
    var miniatura = limpiarBase64(datos.miniatura);
    if (miniatura && tamanoBase64(miniatura) > LIMITES.bytesMiniatura) miniatura = '';

    return {
      ok: true,
      error: '',
      limpio: {
        nombre: recortar(datos.nombre, LIMITES.nombre),
        mesa: normalizarMesa(datos.mesa),
        mensaje: recortarMensaje(datos.mensaje, LIMITES.mensaje),
        archivo: archivo,
        miniatura: miniatura
      }
    };
  }

  // ===== FIN REGLAS COMPARTIDAS =====

  return {
    LIMITES: LIMITES,
    MENSAJE_CERRADA: MENSAJE_CERRADA,
    recortar: recortar,
    recortarMensaje: recortarMensaje,
    normalizarMesa: normalizarMesa,
    estaAbierto: estaAbierto,
    leerFecha: leerFecha,
    fechaCierreVencida: fechaCierreVencida,
    fechaEnTexto: fechaEnTexto,
    estadoGaleria: estadoGaleria,
    limpiarBase64: limpiarBase64,
    tamanoBase64: tamanoBase64,
    esJPEG: esJPEG,
    validarFoto: validarFoto
  };
});
