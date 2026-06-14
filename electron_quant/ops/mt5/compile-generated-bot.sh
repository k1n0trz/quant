#!/usr/bin/env bash
#
# Compile a Quant-generated MT5 bot (.mq5 -> .ex5) with MetaEditor under Wine,
# on the VPS host that runs the MT5 terminal. Verified working on the demo Wine
# prefix (vmi3283931). Run as a user with access to the quant Wine prefix
# (typically: sudo -u quant ...), e.g.
#
#   sudo -u quant bash compile-generated-bot.sh EURUSD
#
# After a successful compile the .ex5 lands in MQL5/Experts/Quant and is copied
# back into the bot's generated folder; update the manifest's sourceFiles so the
# registry reports it as compiled (template_ready).
#
# Notes learned the hard way:
#  - MetaEditor /compile is asynchronous: it returns before the .ex5 is written.
#    Poll for the output file (up to ~40s) instead of trusting the exit code.
#  - Run one compile at a time; a stray MetaEditor process from a previous run
#    can make the next compile silently produce nothing. pkill it first.
set -euo pipefail

SYMBOL="${1:?usage: compile-generated-bot.sh <SYMBOL>}"
PREFIX="${WINEPREFIX:-/var/lib/quant/mt5/kinotrance}"
GEN_ROOT="${QUANT_BOTS_GENERATED:-/var/lib/quant/bots/generated}"
MT5="$PREFIX/drive_c/Program Files/MetaTrader 5"
EXPERTS="$MT5/MQL5/Experts/Quant"
BOT_DIR="$GEN_ROOT/QuantAutoBot_${SYMBOL}"
MQ5="$BOT_DIR/QuantAutoBot_${SYMBOL}.mq5"

export WINEPREFIX="$PREFIX"
export DISPLAY="${DISPLAY:-:77}"
export WINEDEBUG="${WINEDEBUG:--all}"

[ -f "$MQ5" ] || { echo "source not found: $MQ5" >&2; exit 1; }
mkdir -p "$EXPERTS"
cp "$MQ5" "$EXPERTS/QuantAutoBot_${SYMBOL}.mq5"

# Clear any stuck MetaEditor instance, then compile.
pkill -f MetaEditor64 2>/dev/null || true
sleep 2
WIN_SRC="C:\\Program Files\\MetaTrader 5\\MQL5\\Experts\\Quant\\QuantAutoBot_${SYMBOL}.mq5"
/usr/bin/wine "C:\\Program Files\\MetaTrader 5\\MetaEditor64.exe" /compile:"$WIN_SRC" || true

EX5="$EXPERTS/QuantAutoBot_${SYMBOL}.ex5"
for _ in $(seq 1 14); do
  sleep 3
  [ -f "$EX5" ] && break
done
[ -f "$EX5" ] || { echo "compile FAILED: no .ex5 for $SYMBOL" >&2; exit 2; }

cp "$EX5" "$BOT_DIR/QuantAutoBot_${SYMBOL}.ex5"
echo "compiled $SYMBOL -> $(stat -c %s "$EX5") bytes ($EX5)"
