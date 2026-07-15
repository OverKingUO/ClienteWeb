// ===================================================|
// MACRO: Mover objetos                               |
// Versión: 6.0 || Autor: Over (Barack Segoviain)     |
// ===================================================|
//
// ___________________________________________________
// CONFIGURACIÓN DEL USUARIO                          |
//                                                    |
const FILTRAR_POR_HUE: 'SI' | 'NO' = 'SI';
// "NO" → mueve los items sin importar su color       |
//                                                    |
const IDENTIFICAR_GRAPHICS: 'SI' | 'NO' = 'NO';
// "SI" → tira un item al suelo para ver sus graphics |
//                                                    |
// ___________________________________________________|

// METER COMPROBANTE DE SAVE
// METER COMPROBANTE DE VIDA #CHARGHOST

// ====================================================
// BLOQUE 2 — CONSTANTES INTERNAS (NO MODIFICAR)
// ====================================================
const SLEEP_MOVE         = 600;
const SLEEP_CONTENEDOR   = 1200;
const SLEEP_CONFIRMACION = 400;
const SLEEP_SUELO        = 800;   // espera tras tirar al suelo para escanear

// Límite real de UO: un contenedor no admite más de 255 items distintos
// (slots). En items NO stackeables cada unidad ocupa un slot propio, así
// que este límite se alcanza fácilmente. Se comprueba antes de CADA
// movimiento, no solo al principio.
const LIMITE_CONTENEDOR = 255;

// Mensaje que manda el servidor si, por error de cálculo, se intenta meter
// un item en un contenedor que ya está lleno.
const MSG_CONTENEDOR_LLENO = "Demasiados objetos en este contenedor.";


// ====================================================
// BLOQUE 3 — UTILIDADES
// ====================================================

function info(msg: string): void { client.sysMsg(`[MOVER] ${msg}`, 0x3B2); }
function warn(msg: string): void { client.sysMsg(`[MOVER] ⚠ ${msg}`, 0x26); }

function estaEnMochila(serial: number): boolean {
  if (!player.backpack) return false;
  if (serial === player.backpack.serial) return true;
  const obj = client.findObject({ serial }, null, player.backpack);
  return !!obj;
}

// Cuenta cuántos items (slots) hay YA dentro de un contenedor. Es una
// lectura local (sin tráfico de red), así que se puede llamar en cada
// iteración del bucle sin coste.
function contarItemsEnContenedor(serial: number): number {
  const cont = client.findObject({ serial }) as Item | null;
  if (!cont || !Array.isArray((cont as any).contents)) return 0;
  return (cont as any).contents.length;
}

// Busca un item por serial en el suelo (cerca del jugador, rango 2)
function buscarEnSuelo(serial: number): Item | null {
  const obj = client.findObject({ serial });
  if (!obj) return null;
  // Si no está en ningún contenedor (container = 0), está en el suelo
  if ((obj as Item).container === 0 || (obj as Item).container === undefined) return obj as Item;
  return null;
}

// Busca cualquier item con el graphic dado en el suelo cerca del jugador
function buscarGraphicEnSuelo(graphic: number): Item | null {
  return client.findType(graphic, null, null, null, 2) as Item | null;
}


// ====================================================
// BLOQUE 4 — SELECCIÓN DE CONTENEDORES Y OBJETO
// ====================================================

// ── Paso 1: Contenedor origen ───────────────────────────────

info("1/3 — Haz clic en el contenedor ORIGEN...");
const selOrigen = target.query(false);
if (!selOrigen?.serial) { warn("Selección cancelada."); exit(); }
const serialOrigen = selOrigen.serial;

player.use(serialOrigen);
sleep(SLEEP_CONTENEDOR);
info("Origen registrado.");

// ── Paso 2: Objeto a mover ──────────────────────────────────

info("2/3 — Haz clic en el OBJETO que quieres mover (debe estar en el origen)...");
const selObjeto = target.query(false);
if (!selObjeto?.serial) { warn("Selección cancelada."); exit(); }

const graphicInicial = selObjeto.graphic;
const hueObjetivo    = selObjeto.hue ?? 0;
const serialObjeto   = selObjeto.serial;

if (!graphicInicial) {
  warn("No se pudo obtener el graphic del objeto seleccionado.");
  exit();
}

info(`Graphic inicial: 0x${graphicInicial.toString(16).toUpperCase()}${FILTRAR_POR_HUE === 'SI' ? ` | Hue: 0x${hueObjetivo.toString(16).toUpperCase()}` : " | Sin filtro de hue"}`);

// ── Paso 3: Contenedor destino ──────────────────────────────

info("3/3 — Haz clic en el contenedor DESTINO...");
const selDestino = target.query(false);
if (!selDestino?.serial) { warn("Selección cancelada."); exit(); }
const serialDestino = selDestino.serial;

if (serialDestino === serialOrigen) {
  warn("El destino no puede ser el mismo que el origen.");
  exit();
}

player.use(serialDestino);
sleep(SLEEP_CONTENEDOR);
info("Destino registrado.");

const itemsIniciales = contarItemsEnContenedor(serialDestino);
info(`El destino ya tiene ${itemsIniciales}/${LIMITE_CONTENEDOR} items.`);
if (itemsIniciales >= LIMITE_CONTENEDOR) {
  warn("El destino ya está lleno (255 items). Macro detenida.");
  exit();
}


// ====================================================
// BLOQUE 5 — DESCUBRIMIENTO DE GRAPHICS ALTERNATIVOS
// ====================================================
//
// Al caer al suelo algunos items cambian de orientación y por tanto de graphic.
// Para moverlos todos necesitamos conocer todos los graphics posibles.
//
// Clave: el SERIAL del item nunca cambia aunque cambie el graphic.
// Tiramos el item al suelo, lo buscamos por SERIAL para leer su nuevo graphic,
// lo recogemos, lo volvemos a tirar, y repetimos hasta que el graphic vuelva
// al inicial (ciclo completo). Nunca buscamos por graphic en el suelo.
//
// Si IDENTIFICAR_GRAPHICS = "NO", se salta todo esto: no se tira nada al
// suelo y solo se usa el graphic inicial seleccionado.

let todosGraphics: number[];

if (IDENTIFICAR_GRAPHICS === 'SI') {
  const graphicsConocidos: Set<number> = new Set([graphicInicial]);

  info("Comprobando graphics alternativos...");

  // Coger un item del origen (uno solo, cantidad 1)
  let itemParaTirar = client.findType(
    graphicInicial,
    FILTRAR_POR_HUE === 'SI' ? hueObjetivo : null,
    { serial: serialOrigen }, null, 0
  ) as Item | null;

  if (!itemParaTirar) {
    warn("No se encontró el objeto en el origen para comprobar sus graphics.");
    exit();
  }

  // Guardar el serial — es el identificador permanente del item
  const serialDelItem = itemParaTirar.serial;

  // Tirar al suelo junto al jugador
  player.moveItemOnGroundOffset(itemParaTirar, 0, 0, 0, 1);
  sleep(SLEEP_SUELO);

  // Bucle: leer graphic por serial → recoger → tirar → repetir
  let intentos = 0;

  while (intentos < 10) {
    // Buscar el item por serial (funciona en suelo, mochila o contenedor)
    const itemAhora = client.findObject({ serial: serialDelItem }) as Item | null;
    if (!itemAhora) { warn("Perdí el rastro del item. Abortando detección."); break; }

    const graphicActual = itemAhora.graphic;

    if (!graphicsConocidos.has(graphicActual)) {
      graphicsConocidos.add(graphicActual);
      info(`Graphic alternativo: 0x${graphicActual.toString(16).toUpperCase()}`);
    }

    // Si después del primer tiro el graphic volvió al inicial, ciclo completo
    if (intentos > 0 && graphicActual === graphicInicial) {
      info("Ciclo de graphics completo.");
      break;
    }

    // Recoger a la mochila
    player.moveItem(itemAhora, player.backpack!, 0, 0, 0, 1);
    sleep(SLEEP_SUELO);

    // Tirar de nuevo al suelo
    const enMochila = client.findObject({ serial: serialDelItem }) as Item | null;
    if (!enMochila) break;
    player.moveItemOnGroundOffset(enMochila, 0, 0, 0, 1);
    sleep(SLEEP_SUELO);

    intentos++;
  }

  todosGraphics = Array.from(graphicsConocidos);
  info(`Graphics totales: ${todosGraphics.map(g => "0x" + g.toString(16).toUpperCase()).join(", ")}`);

  // Mover el item al destino como primer item transferido
  {
    const itemAhora = client.findObject({ serial: serialDelItem }) as Item | null;
    if (itemAhora) {
      player.moveItem(itemAhora, { serial: serialDestino }, 0, 0, 0, 1);
      sleep(SLEEP_MOVE);
      info("Primer item enviado al destino.");
    }
  }
} else {
  // Sin detección: solo el graphic inicial seleccionado
  todosGraphics = [graphicInicial];
  info("Detección de graphics desactivada — se usará solo el graphic inicial.");
}


// ====================================================
// BLOQUE 6 — CÁLCULO DE DIRECCIÓN Y PESO REAL
// ====================================================

const origenEnMochila  = estaEnMochila(serialOrigen);
const destinoEnMochila = estaEnMochila(serialDestino);
const pesoSube         = !origenEnMochila && destinoEnMochila;

if (pesoSube)  info("El peso subirá al mover. Se calculará el peso real del objeto.");
if (!pesoSube) info("El peso no subirá. Sin límite de peso.");

// Calcular el peso real del objeto si el peso sube
// Lo hacemos moviendo un item al destino y midiendo el delta.
let pesoUnaUnidad = 1; // fallback

if (pesoSube) {
  // Buscar un item en el origen para la medición
  let itemMedicion: Item | null = null;
  for (const g of todosGraphics) {
    const candidato = client.findType(g, FILTRAR_POR_HUE === 'SI' ? hueObjetivo : null, { serial: serialOrigen }, null, 0) as Item | null;
    if (candidato) { itemMedicion = candidato; break; }
  }

  if (itemMedicion) {
    const pesoAntes = player.weight;
    player.moveItem(itemMedicion, { serial: serialDestino }, 0, 0, 0, 1);

    // Esperar a que el peso cambie (máx 2s)
    const inicioMedicion = Date.now();
    while (player.weight === pesoAntes && Date.now() - inicioMedicion < 2000) {
      sleep(100);
    }

    const deltaPeso = player.weight - pesoAntes;

    if (deltaPeso > 0) {
      pesoUnaUnidad = deltaPeso;
      info(`Peso real del objeto: ${pesoUnaUnidad} unidad/es.`);
    } else if (deltaPeso < 0) {
      // El peso bajó — el item cayó al suelo (mochila llena o error)
      warn("El item cayó al suelo durante la medición de peso. Buscando y recuperando...");

      let recuperado = false;
      for (const g of todosGraphics) {
        const enSuelo = client.findType(g, null, null, null, 3) as Item | null;
        if (enSuelo && (enSuelo as any).container === 0) {
          player.moveItem(enSuelo, { serial: serialOrigen }, 0, 0, 0, 1);
          sleep(SLEEP_MOVE);
          recuperado = true;
          break;
        }
      }
      if (!recuperado) warn("No se pudo recuperar el item del suelo. Continúa con precaución.");
    } else {
      // Peso no cambió — el item no llegó al destino
      warn("El item no llegó al destino durante la medición. Puede que esté en el suelo.");
      for (const g of todosGraphics) {
        const enSuelo = client.findType(g, null, null, null, 3) as Item | null;
        if (enSuelo && (enSuelo as any).container === 0) {
          player.moveItem(enSuelo, { serial: serialOrigen }, 0, 0, 0, 1);
          sleep(SLEEP_MOVE);
          break;
        }
      }
    }
  }
}


// ====================================================
// BLOQUE 7 — BÚSQUEDA EN ORIGEN (TODOS LOS GRAPHICS)
// ====================================================

function buscarEnOrigen(): Item[] {
  const resultado: Item[] = [];
  for (const g of todosGraphics) {
    const items = client.findAllItemsOfType(g, null, { serial: serialOrigen }, null, 0) as Item[];
    const filtrados = FILTRAR_POR_HUE === 'SI' ? items.filter(it => it.hue === hueObjetivo) : items;
    resultado.push(...filtrados);
  }
  return resultado;
}


// ====================================================
// BLOQUE 8 — BUCLE DE MOVIMIENTO
// ====================================================

// Si el servidor rechaza el pickup porque el destino está lleno, el item
// puede caer en la mochila del jugador o en el suelo — se busca por su
// SERIAL (funciona en cualquiera de los dos sitios) y se devuelve al origen.
function recuperarPorContenedorLleno(serialItem: number): void {
  warn(`El destino está lleno ("${MSG_CONTENEDOR_LLENO}"). Recuperando el item...`);
  const encontrado = client.findObject({ serial: serialItem }) as Item | null;
  if (!encontrado) {
    warn("No se encontró el item para devolverlo al origen. Revísalo manualmente.");
    return;
  }
  player.moveItem(encontrado, { serial: serialOrigen }, 0, 0, 0, encontrado.amount);
  sleep(SLEEP_MOVE);
  info("Item devuelto al origen.");
}

info("Iniciando movimiento...");
let movidos = 0;
let parado  = false;

while (true) {
  const itemsEnDestino = contarItemsEnContenedor(serialDestino);
  if (itemsEnDestino >= LIMITE_CONTENEDOR) {
    warn(`El destino ha llegado al límite de ${LIMITE_CONTENEDOR} items. Macro detenida.`);
    parado = true;
    break;
  }

  const items = buscarEnOrigen();
  if (items.length === 0) break;

  const item = items[0];
  const serialItemActual = item.serial;

  journal.clear();

  if (pesoSube) {
    // Seguro de peso con el valor real calculado
    if (player.weight + pesoUnaUnidad + 1 >= player.weightMax) {
      warn(`Límite de peso alcanzado (${player.weight}/${player.weightMax}). Macro detenida.`);
      parado = true;
      break;
    }

    const pesoLibreReal      = Math.max(0, player.weightMax - player.weight - 1);
    const unidadesMaxPorPeso = Math.floor(pesoLibreReal / pesoUnaUnidad);
    const aMover             = Math.min(item.amount, Math.max(1, unidadesMaxPorPeso));
    const pesoAntes          = player.weight;

    player.moveItem(item, { serial: serialDestino }, 0, 0, 0, aMover);

    // Esperar a que el peso se actualice
    const inicio = Date.now();
    while (player.weight === pesoAntes && Date.now() - inicio < 2000) {
      sleep(100);
    }
    sleep(SLEEP_CONFIRMACION);

    if (journal.containsText(MSG_CONTENEDOR_LLENO)) {
      recuperarPorContenedorLleno(serialItemActual);
      parado = true;
      break;
    }

    if (player.weight === pesoAntes) {
      // El peso no cambió — el item puede haber caído al suelo
      warn("El item no llegó al destino (posiblemente cayó al suelo). Buscando...");
      let recuperado = false;
      for (const g of todosGraphics) {
        const enSuelo = client.findType(g, null, null, null, 3) as Item | null;
        if (enSuelo && (enSuelo as any).container === 0) {
          info("Item encontrado en el suelo. Devolviéndolo al origen...");
          player.moveItem(enSuelo, { serial: serialOrigen }, 0, 0, 0, 1);
          sleep(SLEEP_MOVE);
          recuperado = true;
          break;
        }
      }
      if (!recuperado) warn("No se encontró el item en el suelo. Macro detenida.");
      parado = true;
      break;
    }

  } else {
    const aMover    = item.amount;
    const serAntes  = item.serial;
    player.moveItem(item, { serial: serialDestino }, 0, 0, 0, aMover);
    sleep(SLEEP_MOVE);

    if (journal.containsText(MSG_CONTENEDOR_LLENO)) {
      recuperarPorContenedorLleno(serialItemActual);
      parado = true;
      break;
    }

    const sigueEnOrigen = client.findObject({ serial: serAntes }, null, { serial: serialOrigen });
    if (sigueEnOrigen) sleep(SLEEP_CONFIRMACION);
  }

  movidos++;
}

// ── Fin ─────────────────────────────────────────────────────

if (!parado) {
  if (movidos === 0) {
    warn("No se encontraron items del tipo indicado en el origen.");
  } else {
    info(`Completado. ${movidos} movimiento/s realizado/s.`);
  }
}
