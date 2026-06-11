# Generación de bots por par (Quant)

Quant deriva Expert Advisors de MT5 por símbolo a partir de una plantilla
semilla aprobada, sin reescribir la lógica de trading.

## Estados de un bot

Un bot atraviesa estados explícitos. La telemetría del chat y `/api/bots-status`
los reportan tal cual; nunca se cuenta un bot como "activo" antes de tiempo.

| Estado | Significado |
| --- | --- |
| `generated_needs_compile` | Fuente `.mq5` generada y válida, sin compilar (`.ex5`). No opera. |
| `source_needs_compile` | Plantilla con fuente pero sin binario compilado. |
| `template_ready` | Fuente + binario `.ex5` presentes. Listo para adjuntar en MT5. |
| `real_candidate_not_deployed` | Candidato real separado; no desplegado. |

`deployedReal` en la telemetría es siempre `0` hasta que exista un mecanismo
verificado de despliegue real (adjuntar el EA al gráfico en el terminal real).

## Pipeline

1. **Generación (automática, en el servidor).** `POST /api/bots-generate`
   con `{ "symbol": "EURUSD" }`. El servicio:
   - reescribe el gate de símbolo del seed (de XAUUSD/GOLD al par destino),
   - asigna un `MAGIC_NUMBER` distinto y determinista por símbolo,
   - retitula el encabezado,
   - escribe `QuantAutoBot_<SYMBOL>/` (`.mq5` + `manifest.json` + `README.md`)
     en `<QUANT_DATA_DIR>/bots/generated/` (persistente entre deploys).

   El seed (`bots/templates/EdiLearningBot_XAUUSD`) usa `_Symbol` en todo el
   cuerpo, así que el derivado es MQL5 válido para el par destino.

2. **Compilación (host Wine MT5).** El `.mq5` generado debe compilarse a `.ex5`
   con MetaEditor en el host donde corre el terminal MT5:

   ```bash
   # En el VPS Wine, dentro del entorno del terminal:
   wine metaeditor64.exe /compile:"<ruta>/QuantAutoBot_EURUSD.mq5" /log
   ```

   Copiar el `.mq5` (y el `.ex5` resultante) a la carpeta `MQL5/Experts` del
   terminal. Mientras no exista `.ex5`, el bot queda en `generated_needs_compile`.

3. **Adjuntar al gráfico (terminal MT5).** Abrir el gráfico del par y adjuntar
   el EA, o cargar un `.chr` con el EA preconfigurado. Este paso ocurre en el
   terminal; el backend no lo simula ni lo reporta como hecho.

## Notas de seguridad

- Cada bot derivado tiene su propio magic, evitando colisión de posiciones.
- Los bots generados son `training` por defecto; el candidato real se mantiene
  separado y no se despliega sin validación.
- El gate de símbolo impide que un EA derivado opere en un par equivocado.
