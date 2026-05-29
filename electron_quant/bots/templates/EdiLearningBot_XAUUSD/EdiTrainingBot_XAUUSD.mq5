//+------------------------------------------------------------------+
//|                                         EdiTrainingBot_XAUUSD.mq5 |
//|               Expert Advisor especializado para XAUUSD / Gold MT5 |
//+------------------------------------------------------------------+
#property copyright "EdiTrainingBot"
#property version   "1.00"
#property strict

#include <Trade/Trade.mqh>

//------------------------------ Inputs principales
input bool   TRAINING_MODE              = true;
input bool   REAL_TRADING_ENABLED       = false;
input double BASE_LOT                   = 0.01;
input double MAX_LOT                    = 0.03;

//------------------------------ Riesgo
input double MAX_RISK_PERCENT           = 0.25;
input double MAX_TOTAL_DRAWDOWN_PERCENT = 3.0;
input int    MAX_TRADES_PER_DAY         = 12;

//------------------------------ SL/TP por ATR
input int    ATR_PERIOD                 = 14;
input double ATR_SL_MULTIPLIER          = 1.5;
input double ATR_TP_MULTIPLIER          = 2.0;

//------------------------------ Filtros de mercado
input int    MAX_SPREAD_POINTS          = 60;
input int    MAX_SPREAD_POINTS_XAUUSD   = 60;
input int    MIN_ATR_POINTS             = 80;
input int    MAX_ATR_POINTS             = 1400;

const int    COLOMBIA_UTC_OFFSET_HOURS  = -5;
const int    COLOMBIA_DAILY_BREAK_START = 15;
const int    COLOMBIA_DAILY_BREAK_END   = 17;
const int    COLOMBIA_FRIDAY_CLOSE_HOUR = 16;
const int    COLOMBIA_SUNDAY_OPEN_HOUR  = 16;
const int    COLOMBIA_LIQUID_START_HOUR = 7;

//------------------------------ Estrategia base
input int    FAST_EMA                   = 14;
input int    SLOW_EMA                   = 50;

//------------------------------ Motor profesional de confluencia
input bool   USE_MULTI_STRATEGY_ENGINE  = true;
input bool   USE_ADAPTIVE_LEARNING      = true;
input bool   USE_HIGHER_TIMEFRAME_FILTER = true;
input ENUM_TIMEFRAMES CONFIRM_TIMEFRAME = PERIOD_H1;
input int    HTF_FAST_EMA               = 50;
input int    HTF_SLOW_EMA               = 200;
input int    RSI_PERIOD                 = 14;
input int    ADX_PERIOD                 = 14;
input int    BOLLINGER_PERIOD           = 20;
input double BOLLINGER_DEVIATION        = 2.0;
input int    RANGE_LOOKBACK             = 24;
input int    SR_LOOKBACK                = 60;
input int    MOMENTUM_LOOKBACK          = 8;
input int    LIQUIDITY_LOOKBACK         = 16;
input int    ATR_AVERAGE_LOOKBACK       = 80;
input double MIN_CONFLUENCE_SCORE       = 2.05;
input double CONSERVATIVE_CONFLUENCE_SCORE = 3.00;
input double MIN_SCORE_EDGE             = 0.55;
input int    LEARNING_MIN_TRADES_PER_STRATEGY = 5;
input double MIN_ADX_TREND              = 20.0;
input double STRONG_ADX_TREND           = 25.0;
input double MAX_ENTRY_DISTANCE_ATR     = 2.20;
input bool   USE_STRATEGY_DIVERSIFICATION = true;
input double DIVERSIFICATION_PENALTY_PER_OPEN = 0.50;
input double DIVERSIFICATION_MAX_PENALTY = 1.50;
input bool   USE_MEDIUM_TERM_ENGINE     = true;
input ENUM_TIMEFRAMES MEDIUM_TERM_TIMEFRAME = PERIOD_H4;
input int    MEDIUM_TERM_FAST_EMA       = 20;
input int    MEDIUM_TERM_SLOW_EMA       = 50;
input double SWING_ATR_SL_MULTIPLIER    = 2.40;
input double SWING_ATR_TP_MULTIPLIER    = 3.80;
input double BREAKOUT_ATR_SL_MULTIPLIER = 2.00;
input double BREAKOUT_ATR_TP_MULTIPLIER = 3.40;
input double SCALP_ATR_SL_MULTIPLIER    = 1.20;
input double SCALP_ATR_TP_MULTIPLIER    = 1.70;

//------------------------------ Filtro de noticias / APIs externas
input bool   USE_NEWS_FILTER            = false;
input string EXTERNAL_NEWS_URL          = "";
input string EXTERNAL_API_KEY           = "";
input string EXTERNAL_API_KEY_FILE      = "EdiTrainingBot_api_key.txt";
input int    NEWS_REFRESH_MINUTES       = 30;

//------------------------------ DeepInfra AI Advisor
input bool   USE_DEEPINFRA_ADVISOR      = true;
input bool   DEEPINFRA_CONFIRM_TRADES   = false;
input bool   DEEPINFRA_ALLOW_NEAR_MISS_BOOST = true;
input bool   DEEPINFRA_BLOCK_ON_FAILURE = false;
input bool   DEEPINFRA_REQUIRE_FOR_REAL = true;
input string DEEPINFRA_CHAT_URL         = "https://api.deepinfra.com/v1/openai/chat/completions";
input string DEEPINFRA_API_KEY          = "";
input string DEEPINFRA_CONFIG_FILE      = "EdiTrainingBot_deepinfra.env";
input string DEEPINFRA_MODEL            = "deepseek-ai/DeepSeek-V4-Flash";
input double DEEPINFRA_MIN_CONFIDENCE   = 68.0;
input double DEEPINFRA_BOOST_CONFIDENCE = 82.0;
input double DEEPINFRA_NEAR_MISS_BUFFER = 0.55;
input int    DEEPINFRA_TIMEOUT_MS       = 8000;
input int    DEEPINFRA_MAX_TOKENS       = 220;
input double DEEPINFRA_TEMPERATURE      = 0.10;

//------------------------------ Diagnostico visible
input bool   PRINT_STATUS_TO_JOURNAL    = true;
input int    STATUS_PRINT_EVERY_BARS    = 1;

//------------------------------ Operacion
input long   MAGIC_NUMBER               = 2026052801;
input int    DEVIATION_POINTS           = 30;

enum ENUM_BOT_STATE
{
   BOT_ACTIVE = 0,
   BOT_PAUSED = 1,
   BOT_KILL_SWITCH = 2,
   BOT_WAITING_SIGNAL = 3
};

enum ENUM_TRADE_SIGNAL
{
   SIGNAL_NONE = 0,
   SIGNAL_BUY = 1,
   SIGNAL_SELL = -1
};

enum ENUM_NEWS_RISK
{
   NEWS_RISK_LOW = 0,
   NEWS_RISK_MEDIUM = 1,
   NEWS_RISK_HIGH = 2,
   NEWS_RISK_UNKNOWN = 3
};

enum ENUM_MARKET_REGIME
{
   REGIME_UNKNOWN = 0,
   REGIME_TREND = 1,
   REGIME_RANGE = 2,
   REGIME_BREAKOUT = 3,
   REGIME_HIGH_VOLATILITY = 4,
   REGIME_LOW_VOLATILITY = 5
};

enum ENUM_STRATEGY_ID
{
   STRAT_TREND_FOLLOWING = 0,
   STRAT_MOMENTUM = 1,
   STRAT_BREAKOUT = 2,
   STRAT_MEAN_REVERSION = 3,
   STRAT_PULLBACK = 4,
   STRAT_MA_CROSSOVER = 5,
   STRAT_PRICE_ACTION_SR = 6,
   STRAT_LIQUIDITY_SWEEP = 7,
   STRAT_SCALPING_FILTER = 8,
   STRAT_DAY_SESSION = 9,
   STRAT_SWING_HTF = 10,
   STRAT_CARRY_CONTEXT = 11,
   STRAT_PAIRS_CONTEXT = 12,
   STRAT_STAT_ARB_CONTEXT = 13,
   STRAT_VOL_BREAKOUT = 14,
   STRAT_VOL_MEAN_REVERSION = 15,
   STRAT_NEWS_CONTEXT = 16,
   STRAT_MACRO_CONTEXT = 17,
   STRAT_MARKET_MAKING_CONTEXT = 18,
   STRAT_REGIME_ML = 19
};

#define STRATEGY_COUNT 20

struct SDeepInfraDecision
{
   bool valid;
   bool allowTrade;
   ENUM_TRADE_SIGNAL signal;
   double confidence;
   string riskLevel;
   string reason;
   string rawContent;
};

CTrade trade;

const string LOG_FILE_NAME = "EdiTrainingBot_XAUUSD_logs.csv";

int      g_atrHandle       = INVALID_HANDLE;
int      g_fastEmaHandle   = INVALID_HANDLE;
int      g_slowEmaHandle   = INVALID_HANDLE;
int      g_rsiHandle       = INVALID_HANDLE;
int      g_adxHandle       = INVALID_HANDLE;
int      g_bandsHandle     = INVALID_HANDLE;
int      g_htfFastEmaHandle = INVALID_HANDLE;
int      g_htfSlowEmaHandle = INVALID_HANDLE;
int      g_mediumFastEmaHandle = INVALID_HANDLE;
int      g_mediumSlowEmaHandle = INVALID_HANDLE;
datetime g_lastBarTime     = 0;
datetime g_todayStart      = 0;
datetime g_lastNewsUpdate  = 0;
int      g_statusBarCounter = 0;

double   g_initialEquity   = 0.0;
double   g_peakEquity      = 0.0;
double   g_dayStartBalance = 0.0;
double   g_dailyPnl        = 0.0;
double   g_grossProfit     = 0.0;
double   g_grossLoss       = 0.0;
double   g_profitFactor    = 0.0;
double   g_winRate         = 0.0;
double   g_currentDD       = 0.0;
double   g_maxDD           = 0.0;

int      g_totalTrades     = 0;
int      g_wins            = 0;
int      g_losses          = 0;
int      g_tradesToday     = 0;
int      g_consecutiveLosses = 0;

bool     g_conservativeNewsMode = false;

ENUM_BOT_STATE g_botState = BOT_WAITING_SIGNAL;
ENUM_NEWS_RISK g_newsRisk = NEWS_RISK_UNKNOWN;
ENUM_MARKET_REGIME g_lastRegime = REGIME_UNKNOWN;

string   g_lastReason = "Inicio";
string   g_economicSummary = "Sin contexto externo cargado";
string   g_learningFileName = "";
string   g_lastStrategySummary = "";

long     g_lastStrategyMask = 0;
long     g_lastBuyStrategyMask = 0;
long     g_lastSellStrategyMask = 0;
double   g_lastModelScore = 0.0;
double   g_lastBuyScore = 0.0;
double   g_lastSellScore = 0.0;
double   g_lastConfluenceThreshold = 0.0;
double   g_lastScoreEdge = 0.0;
int      g_lastHtfBias = 0;
int      g_lastMediumTermBias = 0;

datetime g_lastDeepInfraCall = 0;
string   g_lastDeepInfraAction = "NONE";
string   g_lastDeepInfraSignal = "NONE";
string   g_lastDeepInfraRisk = "UNKNOWN";
string   g_lastDeepInfraReason = "Sin consulta";
double   g_lastDeepInfraConfidence = 0.0;

int      g_strategyTrades[STRATEGY_COUNT];
int      g_strategyWins[STRATEGY_COUNT];
int      g_strategyLosses[STRATEGY_COUNT];
double   g_strategyGrossProfit[STRATEGY_COUNT];
double   g_strategyGrossLoss[STRATEGY_COUNT];
double   g_strategyWeight[STRATEGY_COUNT];

//+------------------------------------------------------------------+
//| Inicializacion                                                    |
//+------------------------------------------------------------------+
int OnInit()
{
   if(StringFind(_Symbol, "XAUUSD") < 0 && StringFind(_Symbol, "GOLD") < 0)
   {
      Print("EdiTrainingBot_XAUUSD: este EA especializado solo debe usarse en XAUUSD/GOLD. Simbolo actual=", _Symbol);
      return INIT_FAILED;
   }

   trade.SetExpertMagicNumber(MAGIC_NUMBER);
   trade.SetDeviationInPoints(DEVIATION_POINTS);

   g_atrHandle = iATR(_Symbol, _Period, ATR_PERIOD);
   g_fastEmaHandle = iMA(_Symbol, _Period, FAST_EMA, 0, MODE_EMA, PRICE_CLOSE);
   g_slowEmaHandle = iMA(_Symbol, _Period, SLOW_EMA, 0, MODE_EMA, PRICE_CLOSE);
   g_rsiHandle = iRSI(_Symbol, _Period, RSI_PERIOD, PRICE_CLOSE);
   g_adxHandle = iADX(_Symbol, _Period, ADX_PERIOD);
   g_bandsHandle = iBands(_Symbol, _Period, BOLLINGER_PERIOD, 0, BOLLINGER_DEVIATION, PRICE_CLOSE);

   if(USE_HIGHER_TIMEFRAME_FILTER)
   {
      g_htfFastEmaHandle = iMA(_Symbol, CONFIRM_TIMEFRAME, HTF_FAST_EMA, 0, MODE_EMA, PRICE_CLOSE);
      g_htfSlowEmaHandle = iMA(_Symbol, CONFIRM_TIMEFRAME, HTF_SLOW_EMA, 0, MODE_EMA, PRICE_CLOSE);
   }

   if(USE_MEDIUM_TERM_ENGINE)
   {
      g_mediumFastEmaHandle = iMA(_Symbol, MEDIUM_TERM_TIMEFRAME, MEDIUM_TERM_FAST_EMA, 0, MODE_EMA, PRICE_CLOSE);
      g_mediumSlowEmaHandle = iMA(_Symbol, MEDIUM_TERM_TIMEFRAME, MEDIUM_TERM_SLOW_EMA, 0, MODE_EMA, PRICE_CLOSE);
   }

   if(g_atrHandle == INVALID_HANDLE ||
      g_fastEmaHandle == INVALID_HANDLE ||
      g_slowEmaHandle == INVALID_HANDLE ||
      g_rsiHandle == INVALID_HANDLE ||
      g_adxHandle == INVALID_HANDLE ||
      g_bandsHandle == INVALID_HANDLE ||
      (USE_HIGHER_TIMEFRAME_FILTER && (g_htfFastEmaHandle == INVALID_HANDLE || g_htfSlowEmaHandle == INVALID_HANDLE)) ||
      (USE_MEDIUM_TERM_ENGINE && (g_mediumFastEmaHandle == INVALID_HANDLE || g_mediumSlowEmaHandle == INVALID_HANDLE)))
   {
      Print("EdiTrainingBot_XAUUSD: error creando handles de indicadores. ATR/EMA/RSI/ADX/Bandas no disponibles.");
      return INIT_FAILED;
   }

   g_learningFileName = "EdiTrainingBot_XAUUSD_learning_" + SanitizeFilePart(_Symbol) + "_" + TimeframeToString(_Period) + ".csv";
   InitializeLearningStats();
   LoadLearningStats();

   g_initialEquity = AccountInfoDouble(ACCOUNT_EQUITY);
   g_peakEquity = g_initialEquity;
   g_todayStart = StartOfDay(TimeCurrent());
   g_dayStartBalance = AccountInfoDouble(ACCOUNT_BALANCE);

   EnsureLogHeader();
   UpdateStats();

   ENUM_ACCOUNT_TRADE_MODE mode = (ENUM_ACCOUNT_TRADE_MODE)AccountInfoInteger(ACCOUNT_TRADE_MODE);
   Print("EdiTrainingBot_XAUUSD iniciado. Modo cuenta=", AccountTradeModeToString(mode),
         " TRAINING_MODE=", TRAINING_MODE,
         " REAL_TRADING_ENABLED=", REAL_TRADING_ENABLED,
         " Lote base=", DoubleToString(BASE_LOT, 2));

   if(mode != ACCOUNT_TRADE_MODE_DEMO && !REAL_TRADING_ENABLED)
      Print("ADVERTENCIA: cuenta no-demo detectada. Trading real BLOQUEADO porque REAL_TRADING_ENABLED=false.");

   if(mode == ACCOUNT_TRADE_MODE_REAL && TRAINING_MODE)
      Print("ADVERTENCIA: cuenta REAL detectada con TRAINING_MODE=true. El EA bloqueara operaciones reales.");

   Print("Horario Colombia (UTC-5): pausa L-J 15:00-17:00; viernes cerrado desde 15:00 por pausa/cierre semanal; reapertura domingo 16:00.");

   if(USE_NEWS_FILTER)
      Print("Filtro de noticias activo. Para usar WebRequest habilita las URLs en MT5: Herramientas > Opciones > Asesores Expertos > Permitir WebRequest para las URL listadas.");

   if(USE_DEEPINFRA_ADVISOR)
      Print("DeepInfra Advisor activo. Habilita https://api.deepinfra.com en WebRequest y guarda la clave en MQL5/Files/", DEEPINFRA_CONFIG_FILE, " como DEEPINFRA_API_KEY=tu_clave.");

   LogDecision(SIGNAL_NONE, "INIT", 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, "EA inicializado");
   return INIT_SUCCEEDED;
}

//+------------------------------------------------------------------+
//| Desinicializacion                                                 |
//+------------------------------------------------------------------+
void OnDeinit(const int reason)
{
   if(g_atrHandle != INVALID_HANDLE)
      IndicatorRelease(g_atrHandle);
   if(g_fastEmaHandle != INVALID_HANDLE)
      IndicatorRelease(g_fastEmaHandle);
   if(g_slowEmaHandle != INVALID_HANDLE)
      IndicatorRelease(g_slowEmaHandle);
   if(g_rsiHandle != INVALID_HANDLE)
      IndicatorRelease(g_rsiHandle);
   if(g_adxHandle != INVALID_HANDLE)
      IndicatorRelease(g_adxHandle);
   if(g_bandsHandle != INVALID_HANDLE)
      IndicatorRelease(g_bandsHandle);
   if(g_htfFastEmaHandle != INVALID_HANDLE)
      IndicatorRelease(g_htfFastEmaHandle);
   if(g_htfSlowEmaHandle != INVALID_HANDLE)
      IndicatorRelease(g_htfSlowEmaHandle);
   if(g_mediumFastEmaHandle != INVALID_HANDLE)
      IndicatorRelease(g_mediumFastEmaHandle);
   if(g_mediumSlowEmaHandle != INVALID_HANDLE)
      IndicatorRelease(g_mediumSlowEmaHandle);

   SaveLearningStats();
   LogDecision(SIGNAL_NONE, "DEINIT", 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, "EA detenido. reason=" + IntegerToString(reason));
   Print("EdiTrainingBot_XAUUSD detenido. reason=", reason);
}

//+------------------------------------------------------------------+
//| Tick principal                                                    |
//+------------------------------------------------------------------+
void OnTick()
{
   if(!IsNewBar())
      return;

   RefreshDayIfNeeded();
   UpdateStats();

   MqlTick tick;
   if(!SymbolInfoTick(_Symbol, tick))
   {
      Print("EdiTrainingBot_XAUUSD: no se pudo leer el tick actual.");
      return;
   }

   double spreadPoints = GetSpreadPoints(tick);
   double atr = CalculateATR();
   string reason = "";

   if(!CheckAccountSafety(reason))
   {
      LogDecision(SIGNAL_NONE, "BLOCKED", 0.0, tick.bid, tick.ask, spreadPoints, atr, 0.0, 0.0, reason);
      PrintStatus("BLOCKED", SIGNAL_NONE, reason, spreadPoints, atr);
      return;
   }

   if(!CheckDailyLimits(reason))
   {
      LogDecision(SIGNAL_NONE, "BLOCKED", 0.0, tick.bid, tick.ask, spreadPoints, atr, 0.0, 0.0, reason);
      PrintStatus("BLOCKED", SIGNAL_NONE, reason, spreadPoints, atr);
      return;
   }

   if(!CheckSession(reason))
   {
      LogDecision(SIGNAL_NONE, "BLOCKED", 0.0, tick.bid, tick.ask, spreadPoints, atr, 0.0, 0.0, reason);
      PrintStatus("BLOCKED", SIGNAL_NONE, reason, spreadPoints, atr);
      return;
   }

   if(!CheckSpread(spreadPoints, reason))
   {
      LogDecision(SIGNAL_NONE, "BLOCKED", 0.0, tick.bid, tick.ask, spreadPoints, atr, 0.0, 0.0, reason);
      PrintStatus("BLOCKED", SIGNAL_NONE, reason, spreadPoints, atr);
      return;
   }

   if(!CheckVolatility(atr, reason))
   {
      LogDecision(SIGNAL_NONE, "BLOCKED", 0.0, tick.bid, tick.ask, spreadPoints, atr, 0.0, 0.0, reason);
      PrintStatus("BLOCKED", SIGNAL_NONE, reason, spreadPoints, atr);
      return;
   }

   if(!CheckNewsFilter(reason))
   {
      LogDecision(SIGNAL_NONE, "BLOCKED", 0.0, tick.bid, tick.ask, spreadPoints, atr, 0.0, 0.0, reason);
      PrintStatus("BLOCKED", SIGNAL_NONE, reason, spreadPoints, atr);
      return;
   }

   ENUM_TRADE_SIGNAL signal = GetSignal(reason);
   if(signal == SIGNAL_NONE)
   {
      ENUM_TRADE_SIGNAL boostedSignal = SIGNAL_NONE;
      string boostedReason = reason;

      if(TryDeepInfraNearMissBoost(boostedSignal, boostedReason, tick, spreadPoints, atr))
      {
         signal = boostedSignal;
         reason = boostedReason;
      }
      else
      {
         g_botState = BOT_WAITING_SIGNAL;
         LogDecision(SIGNAL_NONE, "WAITING_SIGNAL", 0.0, tick.bid, tick.ask, spreadPoints, atr, 0.0, 0.0, reason);
         PrintStatus("WAITING_SIGNAL", SIGNAL_NONE, reason, spreadPoints, atr);
         return;
      }
   }

   if(!CheckDeepInfraTradeApproval(signal, reason, tick, spreadPoints, atr))
   {
      LogDecision(signal, "BLOCKED_AI", 0.0, tick.bid, tick.ask, spreadPoints, atr, 0.0, 0.0, reason);
      PrintStatus("BLOCKED_AI", signal, reason, spreadPoints, atr);
      return;
   }

   OpenTrade(signal, atr, tick, spreadPoints, reason);
}

//+------------------------------------------------------------------+
//| Registro de cierres                                               |
//+------------------------------------------------------------------+
void OnTradeTransaction(const MqlTradeTransaction &trans,
                        const MqlTradeRequest &request,
                        const MqlTradeResult &result)
{
   if(trans.type != TRADE_TRANSACTION_DEAL_ADD || trans.deal == 0)
      return;

   if(!HistoryDealSelect(trans.deal))
      return;

   long magic = HistoryDealGetInteger(trans.deal, DEAL_MAGIC);
   string symbol = HistoryDealGetString(trans.deal, DEAL_SYMBOL);
   long entry = HistoryDealGetInteger(trans.deal, DEAL_ENTRY);

   if(magic != MAGIC_NUMBER || symbol != _Symbol || entry != DEAL_ENTRY_OUT)
      return;

   double pnl = HistoryDealGetDouble(trans.deal, DEAL_PROFIT)
              + HistoryDealGetDouble(trans.deal, DEAL_SWAP)
              + HistoryDealGetDouble(trans.deal, DEAL_COMMISSION);

   long strategyMask = GetStrategyMaskFromClosedDeal(trans.deal);
   if(strategyMask > 0)
      UpdateLearningFromTrade(strategyMask, pnl);

   UpdateStats();
   string closeReason = "Operacion cerrada. PnL=" + DoubleToString(pnl, 2);
   LogDecision(SIGNAL_NONE, "CLOSED", 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, closeReason);
}

//+------------------------------------------------------------------+
//| Seguridad de cuenta                                               |
//+------------------------------------------------------------------+
bool CheckAccountSafety(string &reason)
{
   ENUM_ACCOUNT_TRADE_MODE mode = (ENUM_ACCOUNT_TRADE_MODE)AccountInfoInteger(ACCOUNT_TRADE_MODE);

   // BLOQUEO DE TRADING REAL:
   // El EA solo puede operar en cuenta real si REAL_TRADING_ENABLED=true
   // y TRAINING_MODE=false. Por defecto ambos parametros protegen la cuenta real.
   if(mode != ACCOUNT_TRADE_MODE_DEMO && !REAL_TRADING_ENABLED)
   {
      reason = "Trading real bloqueado: cuenta no-demo y REAL_TRADING_ENABLED=false";
      g_botState = BOT_PAUSED;
      Print(reason);
      return false;
   }

   if(mode == ACCOUNT_TRADE_MODE_REAL && TRAINING_MODE)
   {
      reason = "Trading real bloqueado: TRAINING_MODE=true en cuenta REAL";
      g_botState = BOT_PAUSED;
      Print(reason);
      return false;
   }

   bool terminalAllowed = (bool)TerminalInfoInteger(TERMINAL_TRADE_ALLOWED);
   bool eaAllowed = (bool)MQLInfoInteger(MQL_TRADE_ALLOWED);
   bool accountAllowed = (bool)AccountInfoInteger(ACCOUNT_TRADE_ALLOWED);

   if(!terminalAllowed || !eaAllowed || !accountAllowed)
   {
      reason = "Trading no permitido. Terminal=" + BoolToText(terminalAllowed) +
               " EA_grafico=" + BoolToText(eaAllowed) +
               " Cuenta=" + BoolToText(accountAllowed);
      g_botState = BOT_PAUSED;
      Print(reason);
      return false;
   }

   double equity = AccountInfoDouble(ACCOUNT_EQUITY);
   if(equity > g_peakEquity)
      g_peakEquity = equity;

   g_currentDD = 0.0;
   if(g_peakEquity > 0.0)
      g_currentDD = ((g_peakEquity - equity) / g_peakEquity) * 100.0;

   if(g_currentDD > g_maxDD)
      g_maxDD = g_currentDD;

   return true;
}

bool CheckDailyLimits(string &reason)
{
   RefreshDayIfNeeded();
   UpdateStats();

   if(g_tradesToday >= MAX_TRADES_PER_DAY)
   {
      g_botState = BOT_PAUSED;
      reason = "Maximo de operaciones diarias alcanzado: " + IntegerToString(g_tradesToday);
      Print(reason);
      return false;
   }

   return true;
}

int GetMaxSpreadPointsForSymbol()
{
   if(_Symbol == "XAUUSD")
      return MAX_SPREAD_POINTS_XAUUSD;

   return MAX_SPREAD_POINTS;
}

bool CheckSpread(const double spreadPoints, string &reason)
{
   int maxSpreadPoints = GetMaxSpreadPointsForSymbol();
   if(spreadPoints > maxSpreadPoints)
   {
      g_botState = BOT_PAUSED;
      reason = "Spread alto. Spread=" + DoubleToString(spreadPoints, 1) +
               " puntos limite=" + IntegerToString(maxSpreadPoints);
      Print(reason);
      return false;
   }

   return true;
}

datetime GetColombiaTime()
{
   return TimeGMT() + (COLOMBIA_UTC_OFFSET_HOURS * 60 * 60);
}

bool IsColombiaMarketOpen(string &closedReason)
{
   closedReason = "";

   MqlDateTime dt;
   TimeToStruct(GetColombiaTime(), dt);

   if(dt.day_of_week == 6 ||
      (dt.day_of_week == 0 && dt.hour < COLOMBIA_SUNDAY_OPEN_HOUR) ||
      (dt.day_of_week == 5 && dt.hour >= COLOMBIA_FRIDAY_CLOSE_HOUR))
   {
      closedReason = "Mercado cerrado por fin de semana";
      return false;
   }

   if(dt.day_of_week == 5 && dt.hour >= COLOMBIA_DAILY_BREAK_START)
   {
      closedReason = "Pausa diaria enlazada con cierre semanal";
      return false;
   }

   if(dt.day_of_week >= 1 && dt.day_of_week <= 4 &&
      dt.hour >= COLOMBIA_DAILY_BREAK_START && dt.hour < COLOMBIA_DAILY_BREAK_END)
   {
      closedReason = "Pausa diaria operativa";
      return false;
   }

   return true;
}

bool CheckSession(string &reason)
{
   string closedReason = "";
   if(IsColombiaMarketOpen(closedReason))
      return true;

   MqlDateTime dt;
   TimeToStruct(GetColombiaTime(), dt);
   g_botState = BOT_PAUSED;
   reason = closedReason + ". Hora Colombia=" + StringFormat("%02d:%02d", dt.hour, dt.min) +
            " calendario=pausa 15:00-17:00; cierre semanal vie 16:00-dom 16:00";
   return false;
}

bool CheckVolatility(const double atr, string &reason)
{
   if(atr <= 0.0)
   {
      g_botState = BOT_PAUSED;
      reason = "ATR invalido; no se puede calcular SL/TP";
      Print(reason);
      return false;
   }

   double atrPoints = atr / _Point;
   if(atrPoints < MIN_ATR_POINTS)
   {
      g_botState = BOT_PAUSED;
      reason = "Volatilidad demasiado baja. ATR=" + DoubleToString(atrPoints, 1) + " puntos";
      return false;
   }

   if(atrPoints > MAX_ATR_POINTS)
   {
      g_botState = BOT_PAUSED;
      reason = "Volatilidad demasiado alta. ATR=" + DoubleToString(atrPoints, 1) + " puntos";
      return false;
   }

   return true;
}

bool CheckNewsFilter(string &reason)
{
   g_conservativeNewsMode = false;

   if(!USE_NEWS_FILTER)
      return true;

   LoadExternalMarketContext();
   ENUM_NEWS_RISK risk = (ENUM_NEWS_RISK)GetNewsRiskLevel();

   if(risk == NEWS_RISK_HIGH)
   {
      g_botState = BOT_PAUSED;
      reason = "Filtro noticias: riesgo alto. No operar.";
      Print(reason);
      return false;
   }

   if(risk == NEWS_RISK_MEDIUM)
   {
      g_conservativeNewsMode = true;
      reason = "Filtro noticias: riesgo medio. Se exige confirmacion mas fuerte.";
      return true;
   }

   if(risk == NEWS_RISK_UNKNOWN)
   {
      g_conservativeNewsMode = true;
      reason = "Filtro noticias: riesgo desconocido. Modo conservador local.";
      return true;
   }

   return true;
}

//+------------------------------------------------------------------+
//| Indicadores y senal                                               |
//+------------------------------------------------------------------+
double CalculateATR()
{
   if(g_atrHandle == INVALID_HANDLE)
      return 0.0;

   double atrBuffer[];
   ArraySetAsSeries(atrBuffer, true);

   if(CopyBuffer(g_atrHandle, 0, 1, 1, atrBuffer) != 1)
      return 0.0;

   return atrBuffer[0];
}

ENUM_TRADE_SIGNAL GetSignal(string &reason)
{
   g_lastStrategyMask = 0;
   g_lastBuyStrategyMask = 0;
   g_lastSellStrategyMask = 0;
   g_lastModelScore = 0.0;
   g_lastBuyScore = 0.0;
   g_lastSellScore = 0.0;
   g_lastConfluenceThreshold = 0.0;
   g_lastScoreEdge = 0.0;
   g_lastHtfBias = 0;
   g_lastMediumTermBias = 0;
   g_lastStrategySummary = "";
   g_lastRegime = REGIME_UNKNOWN;

   if(!USE_MULTI_STRATEGY_ENGINE)
      return GetSimpleEmaSignal(reason);

   double fast[];
   double slow[];
   double rsi[];
   double adx[];
   double upperBand[];
   double lowerBand[];
   double open[];
   double high[];
   double low[];
   double close[];

   ArraySetAsSeries(fast, true);
   ArraySetAsSeries(slow, true);
   ArraySetAsSeries(rsi, true);
   ArraySetAsSeries(adx, true);
   ArraySetAsSeries(upperBand, true);
   ArraySetAsSeries(lowerBand, true);
   ArraySetAsSeries(open, true);
   ArraySetAsSeries(high, true);
   ArraySetAsSeries(low, true);
   ArraySetAsSeries(close, true);

   int barsNeeded = MathMax(MathMax(RANGE_LOOKBACK, SR_LOOKBACK), MathMax(MOMENTUM_LOOKBACK, LIQUIDITY_LOOKBACK)) + 5;
   if(barsNeeded < 60)
      barsNeeded = 60;

   if(CopyBuffer(g_fastEmaHandle, 0, 1, 3, fast) != 3 ||
      CopyBuffer(g_slowEmaHandle, 0, 1, 3, slow) != 3 ||
      CopyBuffer(g_rsiHandle, 0, 1, 3, rsi) != 3 ||
      CopyBuffer(g_adxHandle, 0, 1, 3, adx) != 3 ||
      CopyBuffer(g_bandsHandle, 1, 1, 3, upperBand) != 3 ||
      CopyBuffer(g_bandsHandle, 2, 1, 3, lowerBand) != 3 ||
      CopyOpen(_Symbol, _Period, 1, barsNeeded, open) < barsNeeded ||
      CopyHigh(_Symbol, _Period, 1, barsNeeded, high) < barsNeeded ||
      CopyLow(_Symbol, _Period, 1, barsNeeded, low) < barsNeeded ||
      CopyClose(_Symbol, _Period, 1, barsNeeded, close) < barsNeeded)
   {
      reason = "No hay datos suficientes para motor multi-estrategia";
      return SIGNAL_NONE;
   }

   double atr = CalculateATR();
   double avgAtr = CalculateAverageATR(ATR_AVERAGE_LOOKBACK);
   if(avgAtr <= 0.0)
      avgAtr = atr;

   int htfBias = GetHigherTimeframeBias();
   int mediumTermBias = GetMediumTermBias();
   g_lastHtfBias = htfBias;
   g_lastMediumTermBias = mediumTermBias;
   g_lastRegime = DetectMarketRegime(atr, avgAtr, adx[0], fast[0], slow[0]);

   double buyScore = 0.0;
   double sellScore = 0.0;
   long buyMask = 0;
   long sellMask = 0;
   string details = "";

   bool crossedUp = (fast[1] <= slow[1] && fast[0] > slow[0]);
   bool crossedDown = (fast[1] >= slow[1] && fast[0] < slow[0]);
   bool trendUp = (fast[0] > slow[0]);
   bool trendDown = (fast[0] < slow[0]);
   bool buyConfirm = (close[0] > fast[0] && close[0] > slow[0]);
   bool sellConfirm = (close[0] < fast[0] && close[0] < slow[0]);
   bool htfAllowsBuy = (htfBias >= 0 || !USE_HIGHER_TIMEFRAME_FILTER);
   bool htfAllowsSell = (htfBias <= 0 || !USE_HIGHER_TIMEFRAME_FILTER);
   bool mediumAllowsBuy = (mediumTermBias >= 0 || !USE_MEDIUM_TERM_ENGINE);
   bool mediumAllowsSell = (mediumTermBias <= 0 || !USE_MEDIUM_TERM_ENGINE);
   bool bullishCandle = (close[0] > open[0]);
   bool bearishCandle = (close[0] < open[0]);

   double distanceFromFast = MathAbs(close[0] - fast[0]);
   bool entryNotExtended = (atr > 0.0 && distanceFromFast <= atr * MAX_ENTRY_DISTANCE_ATR);

   if(g_lastRegime == REGIME_TREND && adx[0] >= MIN_ADX_TREND && entryNotExtended)
   {
      if(trendUp && buyConfirm && htfAllowsBuy)
         AddStrategyVote(STRAT_TREND_FOLLOWING, SIGNAL_BUY, 1.15, "trend-following", buyScore, sellScore, buyMask, sellMask, details);
      if(trendDown && sellConfirm && htfAllowsSell)
         AddStrategyVote(STRAT_TREND_FOLLOWING, SIGNAL_SELL, 1.15, "trend-following", buyScore, sellScore, buyMask, sellMask, details);
   }

   double momentum = close[0] - close[MOMENTUM_LOOKBACK];
   if(atr > 0.0 && MathAbs(momentum) >= atr * 0.45)
   {
      if(momentum > 0.0 && rsi[0] >= 55.0 && trendUp && htfAllowsBuy)
         AddStrategyVote(STRAT_MOMENTUM, SIGNAL_BUY, 0.95, "momentum", buyScore, sellScore, buyMask, sellMask, details);
      if(momentum < 0.0 && rsi[0] <= 45.0 && trendDown && htfAllowsSell)
         AddStrategyVote(STRAT_MOMENTUM, SIGNAL_SELL, 0.95, "momentum", buyScore, sellScore, buyMask, sellMask, details);
   }

   double rangeHigh = HighestValue(high, 1, RANGE_LOOKBACK);
   double rangeLow = LowestValue(low, 1, RANGE_LOOKBACK);
   double rangeHeight = rangeHigh - rangeLow;
   bool rangeValid = (rangeHeight > atr * 0.80);
   bool volatilityExpanding = (atr > avgAtr * 1.05);
   if(rangeValid && volatilityExpanding)
   {
      if(close[0] > rangeHigh && htfAllowsBuy)
         AddStrategyVote(STRAT_BREAKOUT, SIGNAL_BUY, 0.90, "breakout", buyScore, sellScore, buyMask, sellMask, details);
      if(close[0] < rangeLow && htfAllowsSell)
         AddStrategyVote(STRAT_BREAKOUT, SIGNAL_SELL, 0.90, "breakout", buyScore, sellScore, buyMask, sellMask, details);
   }

   if(g_lastRegime == REGIME_RANGE && adx[0] < MIN_ADX_TREND)
   {
      if(rsi[0] <= 30.0 && close[0] <= lowerBand[0])
         AddStrategyVote(STRAT_MEAN_REVERSION, SIGNAL_BUY, 0.70, "mean-reversion", buyScore, sellScore, buyMask, sellMask, details);
      if(rsi[0] >= 70.0 && close[0] >= upperBand[0])
         AddStrategyVote(STRAT_MEAN_REVERSION, SIGNAL_SELL, 0.70, "mean-reversion", buyScore, sellScore, buyMask, sellMask, details);
   }

   if(g_lastRegime == REGIME_TREND && atr > 0.0)
   {
      if(trendUp && htfAllowsBuy && low[0] <= fast[0] + atr * 0.25 && bullishCandle && close[0] > fast[0])
         AddStrategyVote(STRAT_PULLBACK, SIGNAL_BUY, 1.00, "pullback", buyScore, sellScore, buyMask, sellMask, details);
      if(trendDown && htfAllowsSell && high[0] >= fast[0] - atr * 0.25 && bearishCandle && close[0] < fast[0])
         AddStrategyVote(STRAT_PULLBACK, SIGNAL_SELL, 1.00, "pullback", buyScore, sellScore, buyMask, sellMask, details);
   }

   if(crossedUp && buyConfirm && htfAllowsBuy)
      AddStrategyVote(STRAT_MA_CROSSOVER, SIGNAL_BUY, 0.75, "ema-cross", buyScore, sellScore, buyMask, sellMask, details);
   if(crossedDown && sellConfirm && htfAllowsSell)
      AddStrategyVote(STRAT_MA_CROSSOVER, SIGNAL_SELL, 0.75, "ema-cross", buyScore, sellScore, buyMask, sellMask, details);

   double support = LowestValue(low, 1, SR_LOOKBACK);
   double resistance = HighestValue(high, 1, SR_LOOKBACK);
   if(atr > 0.0)
   {
      bool bullishRejection = (low[0] <= support + atr * 0.25 && close[0] > open[0] && close[0] > support);
      bool bearishRejection = (high[0] >= resistance - atr * 0.25 && close[0] < open[0] && close[0] < resistance);
      if(bullishRejection && htfBias >= 0)
         AddStrategyVote(STRAT_PRICE_ACTION_SR, SIGNAL_BUY, 0.65, "price-action-sr", buyScore, sellScore, buyMask, sellMask, details);
      if(bearishRejection && htfBias <= 0)
         AddStrategyVote(STRAT_PRICE_ACTION_SR, SIGNAL_SELL, 0.65, "price-action-sr", buyScore, sellScore, buyMask, sellMask, details);
   }

   double sweepLow = LowestValue(low, 1, LIQUIDITY_LOOKBACK);
   double sweepHigh = HighestValue(high, 1, LIQUIDITY_LOOKBACK);
   if(low[0] < sweepLow && close[0] > sweepLow && bullishCandle && htfBias >= 0)
      AddStrategyVote(STRAT_LIQUIDITY_SWEEP, SIGNAL_BUY, 0.70, "liquidity-sweep", buyScore, sellScore, buyMask, sellMask, details);
   if(high[0] > sweepHigh && close[0] < sweepHigh && bearishCandle && htfBias <= 0)
      AddStrategyVote(STRAT_LIQUIDITY_SWEEP, SIGNAL_SELL, 0.70, "liquidity-sweep", buyScore, sellScore, buyMask, sellMask, details);

   if(PeriodSeconds(_Period) <= 300 && GetLastSpreadPoints() <= GetMaxSpreadPointsForSymbol() * 0.50)
   {
      if(trendUp && rsi[0] > 52.0 && close[0] > fast[0] && htfAllowsBuy)
         AddStrategyVote(STRAT_SCALPING_FILTER, SIGNAL_BUY, 0.25, "scalp-filter", buyScore, sellScore, buyMask, sellMask, details);
      if(trendDown && rsi[0] < 48.0 && close[0] < fast[0] && htfAllowsSell)
         AddStrategyVote(STRAT_SCALPING_FILTER, SIGNAL_SELL, 0.25, "scalp-filter", buyScore, sellScore, buyMask, sellMask, details);
   }

   if(IsHighLiquiditySession())
   {
      if(buyScore > sellScore)
         AddStrategyVote(STRAT_DAY_SESSION, SIGNAL_BUY, 0.20, "session-quality", buyScore, sellScore, buyMask, sellMask, details);
      else if(sellScore > buyScore)
         AddStrategyVote(STRAT_DAY_SESSION, SIGNAL_SELL, 0.20, "session-quality", buyScore, sellScore, buyMask, sellMask, details);
   }

   if(htfBias > 0 && mediumAllowsBuy && trendUp && buyConfirm)
      AddStrategyVote(STRAT_SWING_HTF, SIGNAL_BUY, 0.80, "swing-htf", buyScore, sellScore, buyMask, sellMask, details);
   if(htfBias < 0 && mediumAllowsSell && trendDown && sellConfirm)
      AddStrategyVote(STRAT_SWING_HTF, SIGNAL_SELL, 0.80, "swing-htf", buyScore, sellScore, buyMask, sellMask, details);

   if(USE_MEDIUM_TERM_ENGINE && atr > 0.0 && atr <= avgAtr * 1.65)
   {
      if(mediumTermBias > 0 && htfBias >= 0 && trendUp && close[0] > slow[0] && rsi[0] >= 50.0)
         AddStrategyVote(STRAT_SWING_HTF, SIGNAL_BUY, 0.75, "medium-trend-h4", buyScore, sellScore, buyMask, sellMask, details);
      if(mediumTermBias < 0 && htfBias <= 0 && trendDown && close[0] < slow[0] && rsi[0] <= 50.0)
         AddStrategyVote(STRAT_SWING_HTF, SIGNAL_SELL, 0.75, "medium-trend-h4", buyScore, sellScore, buyMask, sellMask, details);
   }

   if(atr > avgAtr * 1.15)
   {
      if(close[0] > upperBand[0] && trendUp && htfAllowsBuy)
         AddStrategyVote(STRAT_VOL_BREAKOUT, SIGNAL_BUY, 0.75, "vol-breakout", buyScore, sellScore, buyMask, sellMask, details);
      if(close[0] < lowerBand[0] && trendDown && htfAllowsSell)
         AddStrategyVote(STRAT_VOL_BREAKOUT, SIGNAL_SELL, 0.75, "vol-breakout", buyScore, sellScore, buyMask, sellMask, details);
   }

   if(g_lastRegime == REGIME_HIGH_VOLATILITY && atr > avgAtr * 1.50)
   {
      if(rsi[0] <= 25.0 && close[0] > lowerBand[0] && bullishCandle)
         AddStrategyVote(STRAT_VOL_MEAN_REVERSION, SIGNAL_BUY, 0.45, "vol-mean-reversion", buyScore, sellScore, buyMask, sellMask, details);
      if(rsi[0] >= 75.0 && close[0] < upperBand[0] && bearishCandle)
         AddStrategyVote(STRAT_VOL_MEAN_REVERSION, SIGNAL_SELL, 0.45, "vol-mean-reversion", buyScore, sellScore, buyMask, sellMask, details);
   }

   if(g_lastRegime == REGIME_TREND || g_lastRegime == REGIME_BREAKOUT)
   {
      if(buyScore > sellScore && trendUp)
         AddStrategyVote(STRAT_REGIME_ML, SIGNAL_BUY, 0.45, "regime-ml", buyScore, sellScore, buyMask, sellMask, details);
      else if(sellScore > buyScore && trendDown)
         AddStrategyVote(STRAT_REGIME_ML, SIGNAL_SELL, 0.45, "regime-ml", buyScore, sellScore, buyMask, sellMask, details);
   }

   double threshold = g_conservativeNewsMode ? CONSERVATIVE_CONFLUENCE_SCORE : MIN_CONFLUENCE_SCORE;
   if(g_lastRegime == REGIME_LOW_VOLATILITY)
      threshold += 0.50;
   if(g_lastRegime == REGIME_HIGH_VOLATILITY)
      threshold += 0.30;

   double buyDiversityPenalty = ApplyOpenExposureDiversityPenalty(SIGNAL_BUY, buyScore);
   double sellDiversityPenalty = ApplyOpenExposureDiversityPenalty(SIGNAL_SELL, sellScore);
   double buyThreshold = AdaptiveThresholdForMask(threshold, buyMask);
   double sellThreshold = AdaptiveThresholdForMask(threshold, sellMask);

   double edge = MathAbs(buyScore - sellScore);
   g_lastModelScore = MathMax(buyScore, sellScore);
   g_lastBuyScore = buyScore;
   g_lastSellScore = sellScore;
   g_lastBuyStrategyMask = buyMask;
   g_lastSellStrategyMask = sellMask;
   g_lastConfluenceThreshold = (buyScore >= sellScore ? buyThreshold : sellThreshold);
   g_lastScoreEdge = edge;
   g_lastStrategySummary = details;

   string baseReason = "Regimen=" + RegimeToString(g_lastRegime) +
                       " buyScore=" + DoubleToString(buyScore, 2) +
                       " sellScore=" + DoubleToString(sellScore, 2) +
                       " edge=" + DoubleToString(edge, 2) +
                       " buyThr=" + DoubleToString(buyThreshold, 2) +
                       " sellThr=" + DoubleToString(sellThreshold, 2) +
                       " divPenaltyB/S=" + DoubleToString(buyDiversityPenalty, 2) + "/" + DoubleToString(sellDiversityPenalty, 2) +
                       " h4Bias=" + IntegerToString(mediumTermBias) +
                       " estrategias=" + details;

   if(g_conservativeNewsMode)
      baseReason = "Modo conservador noticias. " + baseReason;

   if(buyScore >= buyThreshold && edge >= MIN_SCORE_EDGE && buyScore > sellScore)
   {
      g_lastStrategyMask = buyMask;
      g_lastStrategySummary = details;
      reason = "Compra por confluencia. " + baseReason;
      return SIGNAL_BUY;
   }

   if(sellScore >= sellThreshold && edge >= MIN_SCORE_EDGE && sellScore > buyScore)
   {
      g_lastStrategyMask = sellMask;
      g_lastStrategySummary = details;
      reason = "Venta por confluencia. " + baseReason;
      return SIGNAL_SELL;
   }

   reason = "Sin confluencia suficiente. " + baseReason;
   return SIGNAL_NONE;
}

ENUM_TRADE_SIGNAL GetSimpleEmaSignal(string &reason)
{
   double fast[];
   double slow[];
   double close[];

   ArraySetAsSeries(fast, true);
   ArraySetAsSeries(slow, true);
   ArraySetAsSeries(close, true);

   if(CopyBuffer(g_fastEmaHandle, 0, 1, 3, fast) != 3 ||
      CopyBuffer(g_slowEmaHandle, 0, 1, 3, slow) != 3 ||
      CopyClose(_Symbol, _Period, 1, 3, close) != 3)
   {
      reason = "No hay datos suficientes para EMA/close";
      return SIGNAL_NONE;
   }

   bool crossedUp = (fast[1] <= slow[1] && fast[0] > slow[0]);
   bool crossedDown = (fast[1] >= slow[1] && fast[0] < slow[0]);
   bool trendUp = (fast[0] > slow[0]);
   bool trendDown = (fast[0] < slow[0]);
   bool buyConfirm = (close[0] > fast[0] && close[0] > slow[0]);
   bool sellConfirm = (close[0] < fast[0] && close[0] < slow[0]);

   if(g_conservativeNewsMode)
   {
      if(crossedUp && buyConfirm)
      {
         reason = "Compra: cruce EMA alcista confirmado en modo conservador";
         return SIGNAL_BUY;
      }

      if(crossedDown && sellConfirm)
      {
         reason = "Venta: cruce EMA bajista confirmado en modo conservador";
         return SIGNAL_SELL;
      }

      reason = "Sin senal clara: modo conservador exige cruce EMA reciente";
      return SIGNAL_NONE;
   }

   if((crossedUp || trendUp) && buyConfirm)
   {
      reason = crossedUp ? "Compra: cruce EMA alcista confirmado" : "Compra: EMA rapida sobre EMA lenta con precio confirmado";
      return SIGNAL_BUY;
   }

   if((crossedDown || trendDown) && sellConfirm)
   {
      reason = crossedDown ? "Venta: cruce EMA bajista confirmado" : "Venta: EMA rapida bajo EMA lenta con precio confirmado";
      return SIGNAL_SELL;
   }

   reason = "Sin senal clara";
   return SIGNAL_NONE;
}

double CalculateAverageATR(const int lookback)
{
   if(g_atrHandle == INVALID_HANDLE || lookback <= 1)
      return CalculateATR();

   double atrBuffer[];
   ArraySetAsSeries(atrBuffer, true);

   int copied = CopyBuffer(g_atrHandle, 0, 1, lookback, atrBuffer);
   if(copied <= 0)
      return CalculateATR();

   double sum = 0.0;
   int valid = 0;
   for(int i = 0; i < copied; i++)
   {
      if(atrBuffer[i] > 0.0)
      {
         sum += atrBuffer[i];
         valid++;
      }
   }

   if(valid <= 0)
      return CalculateATR();

   return sum / valid;
}

ENUM_MARKET_REGIME DetectMarketRegime(const double atr,
                                      const double avgAtr,
                                      const double adx,
                                      const double fastEma,
                                      const double slowEma)
{
   if(atr <= 0.0 || avgAtr <= 0.0)
      return REGIME_UNKNOWN;

   double emaSeparation = MathAbs(fastEma - slowEma);

   if(atr < avgAtr * 0.65)
      return REGIME_LOW_VOLATILITY;

   if(atr > avgAtr * 1.70)
      return REGIME_HIGH_VOLATILITY;

   if(adx >= STRONG_ADX_TREND && emaSeparation >= atr * 0.12)
      return REGIME_TREND;

   if(atr > avgAtr * 1.15 && adx >= MIN_ADX_TREND)
      return REGIME_BREAKOUT;

   if(adx < MIN_ADX_TREND)
      return REGIME_RANGE;

   return REGIME_UNKNOWN;
}

int GetHigherTimeframeBias()
{
   if(!USE_HIGHER_TIMEFRAME_FILTER)
      return 0;

   if(g_htfFastEmaHandle == INVALID_HANDLE || g_htfSlowEmaHandle == INVALID_HANDLE)
      return 0;

   double htfFast[];
   double htfSlow[];
   ArraySetAsSeries(htfFast, true);
   ArraySetAsSeries(htfSlow, true);

   if(CopyBuffer(g_htfFastEmaHandle, 0, 1, 1, htfFast) != 1 ||
      CopyBuffer(g_htfSlowEmaHandle, 0, 1, 1, htfSlow) != 1)
      return 0;

   if(htfFast[0] > htfSlow[0])
      return 1;
   if(htfFast[0] < htfSlow[0])
      return -1;

   return 0;
}

int GetMediumTermBias()
{
   if(!USE_MEDIUM_TERM_ENGINE)
      return 0;

   if(g_mediumFastEmaHandle == INVALID_HANDLE || g_mediumSlowEmaHandle == INVALID_HANDLE)
      return 0;

   double mediumFast[];
   double mediumSlow[];
   ArraySetAsSeries(mediumFast, true);
   ArraySetAsSeries(mediumSlow, true);

   if(CopyBuffer(g_mediumFastEmaHandle, 0, 1, 1, mediumFast) != 1 ||
      CopyBuffer(g_mediumSlowEmaHandle, 0, 1, 1, mediumSlow) != 1)
      return 0;

   if(mediumFast[0] > mediumSlow[0])
      return 1;
   if(mediumFast[0] < mediumSlow[0])
      return -1;

   return 0;
}

double HighestValue(const double &values[], const int start, const int count)
{
   int total = ArraySize(values);
   if(total <= 0 || start >= total)
      return 0.0;

   int end = MathMin(total, start + count);
   double highest = values[start];
   for(int i = start + 1; i < end; i++)
   {
      if(values[i] > highest)
         highest = values[i];
   }

   return highest;
}

double LowestValue(const double &values[], const int start, const int count)
{
   int total = ArraySize(values);
   if(total <= 0 || start >= total)
      return 0.0;

   int end = MathMin(total, start + count);
   double lowest = values[start];
   for(int i = start + 1; i < end; i++)
   {
      if(values[i] < lowest)
         lowest = values[i];
   }

   return lowest;
}

void AddStrategyVote(const ENUM_STRATEGY_ID strategyId,
                     const ENUM_TRADE_SIGNAL signal,
                     const double conviction,
                     const string label,
                     double &buyScore,
                     double &sellScore,
                     long &buyMask,
                     long &sellMask,
                     string &details)
{
   int idx = (int)strategyId;
   if(idx < 0 || idx >= STRATEGY_COUNT || signal == SIGNAL_NONE)
      return;

   double weight = EffectiveStrategyWeight(idx) * conviction;
   if(weight <= 0.0)
      return;

   long bit = (long)MathPow(2.0, idx);
   if(signal == SIGNAL_BUY)
   {
      buyScore += weight;
      buyMask |= bit;
   }
   else if(signal == SIGNAL_SELL)
   {
      sellScore += weight;
      sellMask |= bit;
   }

   details += label + "=" + DoubleToString(weight, 2) + ";";
}

double ApplyOpenExposureDiversityPenalty(const ENUM_TRADE_SIGNAL signal, double &score)
{
   if(!USE_STRATEGY_DIVERSIFICATION || signal == SIGNAL_NONE || score <= 0.0)
      return 0.0;

   int sameSideOpen = CountOpenPositionsBySignal(signal);
   if(sameSideOpen <= 0)
      return 0.0;

   double penalty = MathMin(DIVERSIFICATION_MAX_PENALTY, sameSideOpen * DIVERSIFICATION_PENALTY_PER_OPEN);
   score = MathMax(0.0, score - penalty);
   return penalty;
}

int CountOpenPositionsBySignal(const ENUM_TRADE_SIGNAL signal)
{
   int count = 0;
   int total = PositionsTotal();

   for(int i = 0; i < total; i++)
   {
      ulong ticket = PositionGetTicket(i);
      if(ticket == 0)
         continue;

      string symbol = PositionGetString(POSITION_SYMBOL);
      long magic = PositionGetInteger(POSITION_MAGIC);
      if(symbol != _Symbol || magic != MAGIC_NUMBER)
         continue;

      long type = PositionGetInteger(POSITION_TYPE);
      if(signal == SIGNAL_BUY && type == POSITION_TYPE_BUY)
         count++;
      else if(signal == SIGNAL_SELL && type == POSITION_TYPE_SELL)
         count++;
   }

   return count;
}

double GetLastSpreadPoints()
{
   MqlTick tick;
   if(!SymbolInfoTick(_Symbol, tick))
      return GetMaxSpreadPointsForSymbol() + 1.0;

   return GetSpreadPoints(tick);
}

bool IsHighLiquiditySession()
{
   MqlDateTime dt;
   TimeToStruct(GetColombiaTime(), dt);

   return (dt.day_of_week >= 1 && dt.day_of_week <= 5 &&
           dt.hour >= COLOMBIA_LIQUID_START_HOUR &&
           dt.hour < COLOMBIA_DAILY_BREAK_START);
}

void PrintStatus(const string action,
                 const ENUM_TRADE_SIGNAL signal,
                 const string reason,
                 const double spreadPoints,
                 const double atr)
{
   if(!PRINT_STATUS_TO_JOURNAL)
      return;

   int everyBars = MathMax(1, STATUS_PRINT_EVERY_BARS);
   g_statusBarCounter++;
   if((g_statusBarCounter % everyBars) != 0)
      return;

   string shortReason = reason;
   if(StringLen(shortReason) > 260)
      shortReason = StringSubstr(shortReason, 0, 260) + "...";

   Print("EdiTrainingBot_XAUUSD status | ",
         "accion=", action,
         " señal=", SignalToString(signal),
         " estado=", BotStateToString(g_botState),
         " regimen=", RegimeToString(g_lastRegime),
         " buyScore=", DoubleToString(g_lastBuyScore, 2),
         " sellScore=", DoubleToString(g_lastSellScore, 2),
         " threshold=", DoubleToString(g_lastConfluenceThreshold, 2),
         " h4Bias=", IntegerToString(g_lastMediumTermBias),
         " openB/S=", IntegerToString(CountOpenPositionsBySignal(SIGNAL_BUY)), "/", IntegerToString(CountOpenPositionsBySignal(SIGNAL_SELL)),
         " spread=", DoubleToString(spreadPoints, 1),
         " atrPts=", DoubleToString(atr / _Point, 1),
         " AI=", g_lastDeepInfraAction, "/", g_lastDeepInfraSignal,
         " conf=", DoubleToString(g_lastDeepInfraConfidence, 1),
         " motivo=", shortReason);
}

//+------------------------------------------------------------------+
//| DeepInfra AI Advisor                                              |
//+------------------------------------------------------------------+
bool TryDeepInfraNearMissBoost(ENUM_TRADE_SIGNAL &boostedSignal,
                               string &reason,
                               const MqlTick &tick,
                               const double spreadPoints,
                               const double atr)
{
   boostedSignal = SIGNAL_NONE;

   if(!USE_DEEPINFRA_ADVISOR || !DEEPINFRA_ALLOW_NEAR_MISS_BOOST || !USE_MULTI_STRATEGY_ENGINE)
      return false;

   if(g_lastConfluenceThreshold <= 0.0)
      return false;

   double dominantScore = MathMax(g_lastBuyScore, g_lastSellScore);
   double nearMissFloor = g_lastConfluenceThreshold - DEEPINFRA_NEAR_MISS_BUFFER;
   if(dominantScore < nearMissFloor || g_lastScoreEdge < (MIN_SCORE_EDGE * 0.70))
      return false;

   ENUM_TRADE_SIGNAL candidate = SIGNAL_NONE;
   long candidateMask = 0;

   if(g_lastBuyScore > g_lastSellScore)
   {
      candidate = SIGNAL_BUY;
      candidateMask = g_lastBuyStrategyMask;
   }
   else if(g_lastSellScore > g_lastBuyScore)
   {
      candidate = SIGNAL_SELL;
      candidateMask = g_lastSellStrategyMask;
   }

   if(candidate == SIGNAL_NONE || candidateMask <= 0)
      return false;

   SDeepInfraDecision decision;
   if(!RequestDeepInfraDecision(candidate, tick, spreadPoints, atr, true, decision))
      return false;

   if(!decision.valid || !decision.allowTrade || decision.signal != candidate)
   {
      reason = reason + " | DeepInfra no autorizo boost: " + decision.reason;
      return false;
   }

   if(IsHighAiRisk(decision.riskLevel) || decision.confidence < DEEPINFRA_BOOST_CONFIDENCE)
   {
      reason = reason + " | DeepInfra boost insuficiente. Confianza=" + DoubleToString(decision.confidence, 1) +
               " riesgo=" + decision.riskLevel + " motivo=" + decision.reason;
      return false;
   }

   boostedSignal = candidate;
   g_lastStrategyMask = candidateMask;
   g_lastModelScore = dominantScore;
   reason = "Boost controlado por DeepInfra. " + reason +
            " | AI action=ALLOW_TRADE signal=" + SignalToString(candidate) +
            " confidence=" + DoubleToString(decision.confidence, 1) +
            " risk=" + decision.riskLevel +
            " ai_reason=" + decision.reason;

   return true;
}

bool CheckDeepInfraTradeApproval(const ENUM_TRADE_SIGNAL signal,
                                 string &reason,
                                 const MqlTick &tick,
                                 const double spreadPoints,
                                 const double atr)
{
   if(!USE_DEEPINFRA_ADVISOR || !DEEPINFRA_CONFIRM_TRADES)
      return true;

   SDeepInfraDecision decision;
   bool ok = RequestDeepInfraDecision(signal, tick, spreadPoints, atr, false, decision);
   bool realMode = ((ENUM_ACCOUNT_TRADE_MODE)AccountInfoInteger(ACCOUNT_TRADE_MODE) == ACCOUNT_TRADE_MODE_REAL);

   if(!ok || !decision.valid)
   {
      string failReason = "DeepInfra no disponible o respuesta invalida: " + g_lastDeepInfraReason;
      if(DEEPINFRA_BLOCK_ON_FAILURE || (realMode && DEEPINFRA_REQUIRE_FOR_REAL))
      {
         reason = reason + " | " + failReason + ". Operacion bloqueada.";
         Print(reason);
         return false;
      }

      reason = reason + " | " + failReason + ". Se continua con senal local por modo demo.";
      return true;
   }

   if(!decision.allowTrade)
   {
      reason = reason + " | DeepInfra bloqueo la operacion: " + decision.reason;
      Print(reason);
      return false;
   }

   if(decision.signal != signal)
   {
      reason = reason + " | DeepInfra contradice la direccion local. AI=" + SignalToString(decision.signal) +
               " local=" + SignalToString(signal) + " motivo=" + decision.reason;
      Print(reason);
      return false;
   }

   if(IsHighAiRisk(decision.riskLevel))
   {
      reason = reason + " | DeepInfra detecto riesgo alto: " + decision.reason;
      Print(reason);
      return false;
   }

   if(decision.confidence < DEEPINFRA_MIN_CONFIDENCE)
   {
      reason = reason + " | DeepInfra confianza insuficiente: " + DoubleToString(decision.confidence, 1) +
               "%. Motivo=" + decision.reason;
      Print(reason);
      return false;
   }

   reason = reason + " | DeepInfra OK: confidence=" + DoubleToString(decision.confidence, 1) +
            " risk=" + decision.riskLevel + " motivo=" + decision.reason;
   return true;
}

bool RequestDeepInfraDecision(const ENUM_TRADE_SIGNAL localSignal,
                              const MqlTick &tick,
                              const double spreadPoints,
                              const double atr,
                              const bool nearMissMode,
                              SDeepInfraDecision &decision)
{
   ResetDeepInfraDecision(decision);

   string apiKey = LoadDeepInfraApiKey();
   if(apiKey == "")
   {
      g_lastDeepInfraReason = "Sin DEEPINFRA_API_KEY configurada";
      return false;
   }

   string model = LoadDeepInfraModel();
   if(model == "")
   {
      g_lastDeepInfraReason = "Sin DEEPINFRA_MODEL configurado";
      return false;
   }

   string payload = BuildDeepInfraPayload(model, localSignal, tick, spreadPoints, atr, nearMissMode);
   char postData[];
   int len = StringToCharArray(payload, postData, 0, WHOLE_ARRAY, CP_UTF8);
   if(len > 0)
      ArrayResize(postData, len - 1);

   char result[];
   string resultHeaders = "";
   string headers = "Content-Type: application/json\r\nAuthorization: Bearer " + apiKey + "\r\n";

   ResetLastError();
   int status = WebRequest("POST", DEEPINFRA_CHAT_URL, headers, DEEPINFRA_TIMEOUT_MS, postData, result, resultHeaders);
   g_lastDeepInfraCall = TimeCurrent();

   if(status == -1)
   {
      int err = GetLastError();
      g_lastDeepInfraReason = "WebRequest DeepInfra fallo. Error=" + IntegerToString(err) +
                              ". Habilita https://api.deepinfra.com en MT5.";
      Print("EdiTrainingBot_XAUUSD: ", g_lastDeepInfraReason);
      return false;
   }

   string response = CharArrayToString(result, 0, -1, CP_UTF8);
   if(status < 200 || status >= 300)
   {
      g_lastDeepInfraReason = "DeepInfra HTTP status=" + IntegerToString(status) +
                              " response=" + StringSubstr(response, 0, 220);
      Print("EdiTrainingBot_XAUUSD: ", g_lastDeepInfraReason);
      return false;
   }

   if(!ParseDeepInfraResponse(response, decision))
   {
      g_lastDeepInfraReason = "No se pudo parsear respuesta DeepInfra: " + StringSubstr(response, 0, 220);
      Print("EdiTrainingBot_XAUUSD: ", g_lastDeepInfraReason);
      return false;
   }

   g_lastDeepInfraAction = decision.allowTrade ? "ALLOW_TRADE" : "BLOCK_TRADE";
   g_lastDeepInfraSignal = SignalToString(decision.signal);
   g_lastDeepInfraRisk = decision.riskLevel;
   g_lastDeepInfraConfidence = decision.confidence;
   g_lastDeepInfraReason = decision.reason;

   return true;
}

void ResetDeepInfraDecision(SDeepInfraDecision &decision)
{
   decision.valid = false;
   decision.allowTrade = false;
   decision.signal = SIGNAL_NONE;
   decision.confidence = 0.0;
   decision.riskLevel = "UNKNOWN";
   decision.reason = "Sin decision";
   decision.rawContent = "";
}

string BuildDeepInfraPayload(const string model,
                             const ENUM_TRADE_SIGNAL localSignal,
                             const MqlTick &tick,
                             const double spreadPoints,
                             const double atr,
                             const bool nearMissMode)
{
   string systemPrompt =
      "Eres un comite cuantitativo de control de riesgo para un Expert Advisor educativo de MT5. "
      "No tienes datos en tiempo real salvo los numeros entregados. No inventes noticias. "
      "No busques maximizar frecuencia; prioriza evitar malas entradas. "
      "Solo puedes confirmar o bloquear una senal local. En near_miss puedes permitir una senal cercana, nunca crear una idea sin datos. "
      "Responde siempre JSON valido con action, signal, confidence, risk_level y reason.";

   string userPrompt = BuildDeepInfraPrompt(localSignal, tick, spreadPoints, atr, nearMissMode);

   string payload = "{";
   payload += "\"model\":\"" + JsonEscape(model) + "\",";
   payload += "\"temperature\":" + DoubleToString(DEEPINFRA_TEMPERATURE, 2) + ",";
   payload += "\"max_tokens\":" + IntegerToString(DEEPINFRA_MAX_TOKENS) + ",";
   payload += "\"response_format\":{";
   payload += "\"type\":\"json_schema\",";
   payload += "\"json_schema\":{";
   payload += "\"name\":\"trade_decision\",";
   payload += "\"strict\":true,";
   payload += "\"schema\":{";
   payload += "\"type\":\"object\",";
   payload += "\"properties\":{";
   payload += "\"action\":{\"type\":\"string\"},";
   payload += "\"signal\":{\"type\":\"string\"},";
   payload += "\"confidence\":{\"type\":\"number\"},";
   payload += "\"risk_level\":{\"type\":\"string\"},";
   payload += "\"reason\":{\"type\":\"string\"}";
   payload += "},";
   payload += "\"required\":[\"action\",\"signal\",\"confidence\",\"risk_level\",\"reason\"],";
   payload += "\"additionalProperties\":false";
   payload += "}}},";
   payload += "\"messages\":[";
   payload += "{\"role\":\"system\",\"content\":\"" + JsonEscape(systemPrompt) + "\"},";
   payload += "{\"role\":\"user\",\"content\":\"" + JsonEscape(userPrompt) + "\"}";
   payload += "]}";

   return payload;
}

string BuildDeepInfraPrompt(const ENUM_TRADE_SIGNAL localSignal,
                            const MqlTick &tick,
                            const double spreadPoints,
                            const double atr,
                            const bool nearMissMode)
{
   string prompt = "";
   prompt += "Tarea: evaluar una senal local de trading. Responde SOLO JSON.\n";
   prompt += "Campos permitidos:\n";
   prompt += "action: ALLOW_TRADE o BLOCK_TRADE\n";
   prompt += "signal: BUY, SELL o NONE\n";
   prompt += "confidence: numero 0-100\n";
   prompt += "risk_level: LOW, MEDIUM, HIGH o UNKNOWN\n";
   prompt += "reason: maximo 160 caracteres, sin saltos largos\n\n";

   prompt += "Reglas estrictas:\n";
   prompt += "- Si la direccion no esta clara, action=BLOCK_TRADE y signal=NONE.\n";
   prompt += "- Si hay contradiccion entre regimen, momentum y senal local, bloquea.\n";
   prompt += "- Si near_miss=true, solo permite si los datos estan casi completos y confianza >= " + DoubleToString(DEEPINFRA_BOOST_CONFIDENCE, 1) + ".\n";
   prompt += "- Nunca recomiendes aumentar lote ni ignorar SL.\n\n";

   prompt += "Datos:\n";
   prompt += "symbol=" + _Symbol + "\n";
   prompt += "timeframe=" + TimeframeToString(_Period) + "\n";
   prompt += "near_miss=" + (nearMissMode ? "true" : "false") + "\n";
   prompt += "local_signal=" + SignalToString(localSignal) + "\n";
   prompt += "regime=" + RegimeToString(g_lastRegime) + "\n";
   prompt += "htf_bias=" + IntegerToString(g_lastHtfBias) + "\n";
   prompt += "medium_term_h4_bias=" + IntegerToString(g_lastMediumTermBias) + "\n";
   prompt += "buy_score=" + DoubleToString(g_lastBuyScore, 2) + "\n";
   prompt += "sell_score=" + DoubleToString(g_lastSellScore, 2) + "\n";
   prompt += "score_edge=" + DoubleToString(g_lastScoreEdge, 2) + "\n";
   prompt += "threshold=" + DoubleToString(g_lastConfluenceThreshold, 2) + "\n";
   prompt += "model_score=" + DoubleToString(g_lastModelScore, 2) + "\n";
   prompt += "spread_points=" + DoubleToString(spreadPoints, 1) + "\n";
   prompt += "max_spread_points=" + IntegerToString(GetMaxSpreadPointsForSymbol()) + "\n";
   prompt += "atr_points=" + DoubleToString(atr / _Point, 1) + "\n";
   prompt += "bid=" + DoubleToString(tick.bid, _Digits) + "\n";
   prompt += "ask=" + DoubleToString(tick.ask, _Digits) + "\n";
   prompt += "daily_pnl=" + DoubleToString(g_dailyPnl, 2) + "\n";
   prompt += "current_drawdown_pct=" + DoubleToString(g_currentDD, 2) + "\n";
   prompt += "trades_today=" + IntegerToString(g_tradesToday) + "\n";
   prompt += "consecutive_losses=" + IntegerToString(g_consecutiveLosses) + "\n";
   prompt += "win_rate=" + DoubleToString(g_winRate, 2) + "\n";
   prompt += "profit_factor=" + DoubleToString(g_profitFactor, 2) + "\n";
   prompt += "news_risk=" + NewsRiskToString(g_newsRisk) + "\n";
   prompt += "strategies=" + g_lastStrategySummary + "\n";

   return prompt;
}

bool ParseDeepInfraResponse(const string response, SDeepInfraDecision &decision)
{
   ResetDeepInfraDecision(decision);

   string content = ExtractJsonStringValue(response, "content");
   if(content == "")
      return false;

   decision.rawContent = content;

   string action = ExtractJsonStringValue(content, "action");
   string signal = ExtractJsonStringValue(content, "signal");
   string risk = ExtractJsonStringValue(content, "risk_level");
   string reason = ExtractJsonStringValue(content, "reason");
   double confidence = ExtractJsonNumberValue(content, "confidence");

   StringToUpper(action);
   StringToUpper(signal);
   StringToUpper(risk);

   if(action == "" || signal == "" || risk == "")
      return false;

   decision.valid = true;
   decision.allowTrade = (action == "ALLOW_TRADE");
   decision.signal = SignalFromAiString(signal);
   decision.riskLevel = risk;
   decision.reason = reason;
   decision.confidence = ClampDouble(confidence, 0.0, 100.0);

   if(!decision.allowTrade)
      decision.signal = SIGNAL_NONE;

   return true;
}

string LoadDeepInfraApiKey()
{
   string fromFile = ReadConfigValue(DEEPINFRA_CONFIG_FILE, "DEEPINFRA_API_KEY");
   if(fromFile == "")
      fromFile = ReadConfigValue(DEEPINFRA_CONFIG_FILE, "DEEPINFRA_TOKEN");

   if(fromFile != "")
      return fromFile;

   if(DEEPINFRA_API_KEY != "")
      return DEEPINFRA_API_KEY;

   string raw = ReadTextFile(DEEPINFRA_CONFIG_FILE);
   if(StringFind(raw, "=") < 0)
      return raw;

   return "";
}

string LoadDeepInfraModel()
{
   string fromFile = ReadConfigValue(DEEPINFRA_CONFIG_FILE, "DEEPINFRA_MODEL");
   if(fromFile != "")
      return fromFile;

   return DEEPINFRA_MODEL;
}

string ReadConfigValue(const string fileName, const string key)
{
   int handle = FileOpen(fileName, FILE_READ | FILE_TXT | FILE_ANSI | FILE_SHARE_READ | FILE_SHARE_WRITE);
   if(handle == INVALID_HANDLE)
      return "";

   string prefix = key + "=";
   string value = "";

   while(!FileIsEnding(handle))
   {
      string line = FileReadString(handle);
      StringTrimLeft(line);
      StringTrimRight(line);

      if(StringFind(line, prefix) == 0)
      {
         value = StringSubstr(line, StringLen(prefix));
         StringTrimLeft(value);
         StringTrimRight(value);
         break;
      }
   }

   FileClose(handle);
   return value;
}

bool IsHighAiRisk(const string riskLevel)
{
   string risk = riskLevel;
   StringToUpper(risk);
   return (risk == "HIGH" || risk == "UNKNOWN");
}

ENUM_TRADE_SIGNAL SignalFromAiString(const string value)
{
   string signal = value;
   StringToUpper(signal);

   if(signal == "BUY")
      return SIGNAL_BUY;
   if(signal == "SELL")
      return SIGNAL_SELL;

   return SIGNAL_NONE;
}

string ExtractJsonStringValue(const string json, const string key)
{
   string needle = "\"" + key + "\"";
   int pos = StringFind(json, needle);
   if(pos < 0)
      return "";

   pos = StringFind(json, ":", pos + StringLen(needle));
   if(pos < 0)
      return "";

   pos++;
   int len = StringLen(json);
   while(pos < len)
   {
      ushort ch = StringGetCharacter(json, pos);
      if(ch != 32 && ch != 9 && ch != 10 && ch != 13)
         break;
      pos++;
   }

   if(pos >= len || StringGetCharacter(json, pos) != 34)
      return "";

   pos++;
   string result = "";
   while(pos < len)
   {
      ushort ch = StringGetCharacter(json, pos);

      if(ch == 92)
      {
         pos++;
         if(pos >= len)
            break;

         ushort next = StringGetCharacter(json, pos);
         if(next == 34)
            result += "\"";
         else if(next == 92)
            result += "\\";
         else if(next == 47)
            result += "/";
         else if(next == 110)
            result += "\n";
         else if(next == 114)
            result += "\r";
         else if(next == 116)
            result += "\t";
         else
            result += StringSubstr(json, pos, 1);
      }
      else if(ch == 34)
      {
         break;
      }
      else
      {
         result += StringSubstr(json, pos, 1);
      }

      pos++;
   }

   return result;
}

double ExtractJsonNumberValue(const string json, const string key)
{
   string needle = "\"" + key + "\"";
   int pos = StringFind(json, needle);
   if(pos < 0)
      return 0.0;

   pos = StringFind(json, ":", pos + StringLen(needle));
   if(pos < 0)
      return 0.0;

   pos++;
   int len = StringLen(json);
   while(pos < len)
   {
      ushort ch = StringGetCharacter(json, pos);
      if(ch != 32 && ch != 9 && ch != 10 && ch != 13 && ch != 34)
         break;
      pos++;
   }

   string number = "";
   while(pos < len)
   {
      ushort ch = StringGetCharacter(json, pos);
      if((ch >= 48 && ch <= 57) || ch == 45 || ch == 43 || ch == 46)
      {
         number += StringSubstr(json, pos, 1);
         pos++;
         continue;
      }
      break;
   }

   return StringToDouble(number);
}

string JsonEscape(const string text)
{
   string result = "";
   int len = StringLen(text);

   for(int i = 0; i < len; i++)
   {
      ushort ch = StringGetCharacter(text, i);
      if(ch == 34)
         result += "\\\"";
      else if(ch == 92)
         result += "\\\\";
      else if(ch == 10)
         result += "\\n";
      else if(ch == 13)
         result += "\\r";
      else if(ch == 9)
         result += "\\t";
      else
         result += StringSubstr(text, i, 1);
   }

   return result;
}

//+------------------------------------------------------------------+
//| Lotes y operaciones                                               |
//+------------------------------------------------------------------+
double CalculateLotSize(const double slPoints, string &reason)
{
   double minVol = SymbolInfoDouble(_Symbol, SYMBOL_VOLUME_MIN);
   double maxVol = SymbolInfoDouble(_Symbol, SYMBOL_VOLUME_MAX);
   double stepVol = SymbolInfoDouble(_Symbol, SYMBOL_VOLUME_STEP);

   if(minVol <= 0.0 || maxVol <= 0.0 || stepVol <= 0.0)
   {
      reason = "No se pudo validar volumen minimo/maximo/step del broker";
      return 0.0;
   }

   double brokerAndConfigMax = MathMin(maxVol, MAX_LOT);
   if(minVol > brokerAndConfigMax)
   {
      reason = "Volumen minimo del broker supera MAX_LOT configurado";
      return 0.0;
   }

   double desired = BASE_LOT;

   bool canScale =
      g_totalTrades >= 30 &&
      g_profitFactor > 1.2 &&
      g_winRate > 50.0 &&
      g_currentDD < MAX_TOTAL_DRAWDOWN_PERCENT &&
      g_dailyPnl >= 0.0 &&
      g_consecutiveLosses == 0 &&
      !g_conservativeNewsMode &&
      LearningQualityAllowsScaling(g_lastStrategyMask);

   if(canScale)
   {
      int levels = MathMin(2, g_totalTrades / 30);
      desired = BASE_LOT + (BASE_LOT * levels);
   }

   if(!canScale || g_dailyPnl < 0.0 || g_consecutiveLosses > 0 || g_currentDD >= (MAX_TOTAL_DRAWDOWN_PERCENT * 0.5))
      desired = BASE_LOT;

   desired = MathMin(desired, brokerAndConfigMax);

   double riskMoney = AccountInfoDouble(ACCOUNT_BALANCE) * (MAX_RISK_PERCENT / 100.0);
   double tickValue = SymbolInfoDouble(_Symbol, SYMBOL_TRADE_TICK_VALUE);
   double tickSize = SymbolInfoDouble(_Symbol, SYMBOL_TRADE_TICK_SIZE);

   if(slPoints <= 0.0 || tickValue <= 0.0 || tickSize <= 0.0)
   {
      reason = "Datos de riesgo invalidos para calcular lote";
      return 0.0;
   }

   double valuePerPointPerLot = tickValue * (_Point / tickSize);
   if(valuePerPointPerLot <= 0.0)
   {
      reason = "Valor por punto invalido para calcular lote";
      return 0.0;
   }

   double riskLot = riskMoney / (slPoints * valuePerPointPerLot);
   if(riskLot < minVol)
   {
      reason = "El lote minimo del broker excede el riesgo maximo por operacion";
      return 0.0;
   }

   desired = MathMin(desired, riskLot);
   double normalized = NormalizeVolume(desired, minVol, brokerAndConfigMax, stepVol);

   if(normalized < minVol || normalized > brokerAndConfigMax)
   {
      reason = "Lote normalizado fuera de limites";
      return 0.0;
   }

   return normalized;
}

void OpenTrade(const ENUM_TRADE_SIGNAL signal, const double atr, const MqlTick &tick, const double spreadPoints, const string entryReason)
{
   string reason = entryReason;

   double slMultiplier = ATR_SL_MULTIPLIER;
   double tpMultiplier = ATR_TP_MULTIPLIER;

   if(StrategyMaskHas(g_lastStrategyMask, STRAT_SWING_HTF))
   {
      slMultiplier = SWING_ATR_SL_MULTIPLIER;
      tpMultiplier = SWING_ATR_TP_MULTIPLIER;
   }
   else if(StrategyMaskHas(g_lastStrategyMask, STRAT_BREAKOUT) ||
           StrategyMaskHas(g_lastStrategyMask, STRAT_VOL_BREAKOUT))
   {
      slMultiplier = BREAKOUT_ATR_SL_MULTIPLIER;
      tpMultiplier = BREAKOUT_ATR_TP_MULTIPLIER;
   }
   else if(StrategyMaskHas(g_lastStrategyMask, STRAT_SCALPING_FILTER))
   {
      slMultiplier = SCALP_ATR_SL_MULTIPLIER;
      tpMultiplier = SCALP_ATR_TP_MULTIPLIER;
   }

   double slDistance = atr * slMultiplier;
   double tpDistance = atr * tpMultiplier;

   long stopsLevel = SymbolInfoInteger(_Symbol, SYMBOL_TRADE_STOPS_LEVEL);
   long freezeLevel = SymbolInfoInteger(_Symbol, SYMBOL_TRADE_FREEZE_LEVEL);
   double minStopDistance = MathMax(stopsLevel, freezeLevel) * _Point;

   if(slDistance <= 0.0 || tpDistance <= 0.0)
   {
      reason = "SL/TP invalidos por ATR";
      LogDecision(signal, "BLOCKED", 0.0, tick.bid, tick.ask, spreadPoints, atr, 0.0, 0.0, reason);
      return;
   }

   if(minStopDistance > 0.0 && slDistance < minStopDistance)
      slDistance = minStopDistance + _Point;
   if(minStopDistance > 0.0 && tpDistance < minStopDistance)
      tpDistance = minStopDistance + _Point;

   double entry = (signal == SIGNAL_BUY) ? tick.ask : tick.bid;
   double sl = 0.0;
   double tp = 0.0;

   if(signal == SIGNAL_BUY)
   {
      sl = NormalizeDouble(entry - slDistance, _Digits);
      tp = NormalizeDouble(entry + tpDistance, _Digits);
   }
   else if(signal == SIGNAL_SELL)
   {
      sl = NormalizeDouble(entry + slDistance, _Digits);
      tp = NormalizeDouble(entry - tpDistance, _Digits);
   }
   else
      return;

   if(sl <= 0.0 || tp <= 0.0 || MathAbs(entry - sl) < minStopDistance || MathAbs(entry - tp) < minStopDistance)
   {
      reason = "No se pudo calcular SL/TP valido respetando stop level del broker";
      LogDecision(signal, "BLOCKED", 0.0, tick.bid, tick.ask, spreadPoints, atr, sl, tp, reason);
      return;
   }

   double slPoints = MathAbs(entry - sl) / _Point;
   double lot = CalculateLotSize(slPoints, reason);
   if(lot <= 0.0)
   {
      LogDecision(signal, "BLOCKED", 0.0, tick.bid, tick.ask, spreadPoints, atr, sl, tp, reason);
      return;
   }

   bool ok = false;
   string tradeComment = BuildTradeComment(signal);
   if(signal == SIGNAL_BUY)
      ok = trade.Buy(lot, _Symbol, 0.0, sl, tp, tradeComment);
   else
      ok = trade.Sell(lot, _Symbol, 0.0, sl, tp, tradeComment);

   if(ok)
   {
      g_botState = BOT_ACTIVE;
      Print("Operacion abierta: ", SignalToString(signal),
            " lot=", DoubleToString(lot, 2),
            " SL=", DoubleToString(sl, _Digits),
            " TP=", DoubleToString(tp, _Digits),
            " motivo=", reason);
      LogDecision(signal, "OPENED", lot, tick.bid, tick.ask, spreadPoints, atr, sl, tp, reason);
   }
   else
   {
      string failReason = "Error abriendo operacion. Retcode=" + IntegerToString((int)trade.ResultRetcode()) + " " + trade.ResultRetcodeDescription();
      Print(failReason);
      LogDecision(signal, "ERROR", lot, tick.bid, tick.ask, spreadPoints, atr, sl, tp, failReason);
   }
}

//+------------------------------------------------------------------+
//| Estadisticas internas                                             |
//+------------------------------------------------------------------+
void UpdateStats()
{
   datetime now = TimeCurrent();
   datetime dayStart = StartOfDay(now);

   g_totalTrades = 0;
   g_wins = 0;
   g_losses = 0;
   g_tradesToday = 0;
   g_dailyPnl = 0.0;
   g_grossProfit = 0.0;
   g_grossLoss = 0.0;
   g_consecutiveLosses = 0;

   if(!HistorySelect(0, now))
      return;

   int totalDeals = HistoryDealsTotal();

   for(int i = 0; i < totalDeals; i++)
   {
      ulong ticket = HistoryDealGetTicket(i);
      if(ticket == 0)
         continue;

      string symbol = HistoryDealGetString(ticket, DEAL_SYMBOL);
      long magic = HistoryDealGetInteger(ticket, DEAL_MAGIC);
      if(symbol != _Symbol || magic != MAGIC_NUMBER)
         continue;

      datetime dealTime = (datetime)HistoryDealGetInteger(ticket, DEAL_TIME);
      long entry = HistoryDealGetInteger(ticket, DEAL_ENTRY);

      if(entry == DEAL_ENTRY_IN && dealTime >= dayStart)
         g_tradesToday++;

      if(entry != DEAL_ENTRY_OUT)
         continue;

      double pnl = HistoryDealGetDouble(ticket, DEAL_PROFIT)
                 + HistoryDealGetDouble(ticket, DEAL_SWAP)
                 + HistoryDealGetDouble(ticket, DEAL_COMMISSION);

      g_totalTrades++;

      if(dealTime >= dayStart)
         g_dailyPnl += pnl;

      if(pnl > 0.0)
      {
         g_wins++;
         g_grossProfit += pnl;
         g_consecutiveLosses = 0;
      }
      else if(pnl < 0.0)
      {
         g_losses++;
         g_grossLoss += MathAbs(pnl);
         g_consecutiveLosses++;
      }
   }

   if(g_totalTrades > 0)
      g_winRate = ((double)g_wins / (double)g_totalTrades) * 100.0;
   else
      g_winRate = 0.0;

   if(g_grossLoss > 0.0)
      g_profitFactor = g_grossProfit / g_grossLoss;
   else if(g_grossProfit > 0.0)
      g_profitFactor = 99.0;
   else
      g_profitFactor = 0.0;

   double equity = AccountInfoDouble(ACCOUNT_EQUITY);
   if(equity > g_peakEquity)
      g_peakEquity = equity;

   if(g_peakEquity > 0.0)
      g_currentDD = ((g_peakEquity - equity) / g_peakEquity) * 100.0;

   if(g_currentDD > g_maxDD)
      g_maxDD = g_currentDD;
}

//+------------------------------------------------------------------+
//| Aprendizaje adaptativo                                            |
//+------------------------------------------------------------------+
void InitializeLearningStats()
{
   for(int i = 0; i < STRATEGY_COUNT; i++)
   {
      g_strategyTrades[i] = 0;
      g_strategyWins[i] = 0;
      g_strategyLosses[i] = 0;
      g_strategyGrossProfit[i] = 0.0;
      g_strategyGrossLoss[i] = 0.0;
      g_strategyWeight[i] = DefaultStrategyWeight(i);
   }
}

double DefaultStrategyWeight(const int strategyId)
{
   switch(strategyId)
   {
      case STRAT_TREND_FOLLOWING:       return 1.15;
      case STRAT_MOMENTUM:              return 1.05;
      case STRAT_BREAKOUT:              return 1.05;
      case STRAT_MEAN_REVERSION:        return 0.50;
      case STRAT_PULLBACK:              return 1.10;
      case STRAT_MA_CROSSOVER:          return 0.60;
      case STRAT_PRICE_ACTION_SR:       return 0.75;
      case STRAT_LIQUIDITY_SWEEP:       return 0.90;
      case STRAT_SCALPING_FILTER:       return 0.25;
      case STRAT_DAY_SESSION:           return 0.25;
      case STRAT_SWING_HTF:             return 0.90;
      case STRAT_CARRY_CONTEXT:         return 0.00;
      case STRAT_PAIRS_CONTEXT:         return 0.00;
      case STRAT_STAT_ARB_CONTEXT:      return 0.00;
      case STRAT_VOL_BREAKOUT:          return 0.95;
      case STRAT_VOL_MEAN_REVERSION:    return 0.35;
      case STRAT_NEWS_CONTEXT:          return 0.00;
      case STRAT_MACRO_CONTEXT:         return 0.00;
      case STRAT_MARKET_MAKING_CONTEXT: return 0.00;
      case STRAT_REGIME_ML:             return 0.60;
   }

   return 0.0;
}

double EffectiveStrategyWeight(const int strategyId)
{
   if(strategyId < 0 || strategyId >= STRATEGY_COUNT)
      return 0.0;

   if(!USE_ADAPTIVE_LEARNING)
      return DefaultStrategyWeight(strategyId);

   return g_strategyWeight[strategyId];
}

void RecalculateAllStrategyWeights()
{
   for(int i = 0; i < STRATEGY_COUNT; i++)
      g_strategyWeight[i] = RecalculateStrategyWeight(i);
}

double RecalculateStrategyWeight(const int strategyId)
{
   double base = DefaultStrategyWeight(strategyId);
   if(base <= 0.0)
      return 0.0;

   if(!USE_ADAPTIVE_LEARNING || g_strategyTrades[strategyId] < LEARNING_MIN_TRADES_PER_STRATEGY)
      return base;

   double winRate = (double)g_strategyWins[strategyId] / (double)g_strategyTrades[strategyId] * 100.0;
   double profitFactor = 0.0;
   if(g_strategyGrossLoss[strategyId] > 0.0)
      profitFactor = g_strategyGrossProfit[strategyId] / g_strategyGrossLoss[strategyId];
   else if(g_strategyGrossProfit[strategyId] > 0.0)
      profitFactor = 99.0;

   double rawFactor = 1.0;
   if(winRate >= 62.0 && profitFactor >= 1.60)
      rawFactor = 1.85;
   else if(winRate >= 56.0 && profitFactor >= 1.30)
      rawFactor = 1.45;
   else if(winRate >= 50.0 && profitFactor >= 1.08)
      rawFactor = 1.18;
   else if(winRate < 40.0 || profitFactor < 0.75)
      rawFactor = 0.45;
   else if(winRate < 48.0 || profitFactor < 0.95)
      rawFactor = 0.70;

   double sampleConfidence = MathMin(1.0, (double)g_strategyTrades[strategyId] / (double)MathMax(1, LEARNING_MIN_TRADES_PER_STRATEGY * 4));
   double factor = 1.0 + ((rawFactor - 1.0) * sampleConfidence);

   return ClampDouble(base * factor, base * 0.25, base * 2.20);
}

double AdaptiveThresholdForMask(const double baseThreshold, const long strategyMask)
{
   if(!USE_ADAPTIVE_LEARNING || strategyMask <= 0)
      return baseThreshold;

   double ratioSum = 0.0;
   int readyStrategies = 0;

   for(int i = 0; i < STRATEGY_COUNT; i++)
   {
      long bit = (long)MathPow(2.0, i);
      if((strategyMask & bit) == 0 || g_strategyTrades[i] < LEARNING_MIN_TRADES_PER_STRATEGY)
         continue;

      double base = DefaultStrategyWeight(i);
      if(base <= 0.0)
         continue;

      ratioSum += g_strategyWeight[i] / base;
      readyStrategies++;
   }

   if(readyStrategies <= 0)
      return baseThreshold;

   double avgRatio = ratioSum / (double)readyStrategies;
   double adjusted = baseThreshold;

   if(avgRatio >= 1.45)
      adjusted -= 0.40;
   else if(avgRatio >= 1.18)
      adjusted -= 0.22;
   else if(avgRatio <= 0.60)
      adjusted += 0.45;
   else if(avgRatio <= 0.82)
      adjusted += 0.25;

   return ClampDouble(adjusted, 1.55, 3.80);
}

bool LoadLearningStats()
{
   if(g_learningFileName == "")
      return false;

   int handle = FileOpen(g_learningFileName, FILE_READ | FILE_CSV | FILE_ANSI | FILE_SHARE_READ | FILE_SHARE_WRITE, ',');
   if(handle == INVALID_HANDLE)
   {
      SaveLearningStats();
      return false;
   }

   while(!FileIsEnding(handle))
   {
      string first = FileReadString(handle);
      if(first == "")
         continue;

      if(first == "strategy_id")
      {
         for(int skip = 0; skip < 7 && !FileIsEnding(handle); skip++)
            FileReadString(handle);
         continue;
      }

      int idx = (int)StringToInteger(first);
      string ignoredName = FileReadString(handle);
      int trades = (int)StringToInteger(FileReadString(handle));
      int wins = (int)StringToInteger(FileReadString(handle));
      int losses = (int)StringToInteger(FileReadString(handle));
      double grossProfit = StringToDouble(FileReadString(handle));
      double grossLoss = StringToDouble(FileReadString(handle));
      double weight = StringToDouble(FileReadString(handle));

      if(idx >= 0 && idx < STRATEGY_COUNT)
      {
         g_strategyTrades[idx] = trades;
         g_strategyWins[idx] = wins;
         g_strategyLosses[idx] = losses;
         g_strategyGrossProfit[idx] = grossProfit;
         g_strategyGrossLoss[idx] = grossLoss;
         g_strategyWeight[idx] = (weight > 0.0 ? weight : DefaultStrategyWeight(idx));
      }
   }

   FileClose(handle);
   RecalculateAllStrategyWeights();
   SaveLearningStats();
   return true;
}

bool SaveLearningStats()
{
   if(g_learningFileName == "")
      return false;

   int handle = FileOpen(g_learningFileName, FILE_WRITE | FILE_CSV | FILE_ANSI | FILE_SHARE_READ | FILE_SHARE_WRITE, ',');
   if(handle == INVALID_HANDLE)
   {
      Print("No se pudo guardar aprendizaje: ", g_learningFileName, " error=", GetLastError());
      return false;
   }

   FileWrite(handle, "strategy_id", "strategy_name", "trades", "wins", "losses", "gross_profit", "gross_loss", "weight");
   for(int i = 0; i < STRATEGY_COUNT; i++)
   {
      FileWrite(handle,
                IntegerToString(i),
                StrategyName(i),
                IntegerToString(g_strategyTrades[i]),
                IntegerToString(g_strategyWins[i]),
                IntegerToString(g_strategyLosses[i]),
                DoubleToString(g_strategyGrossProfit[i], 2),
                DoubleToString(g_strategyGrossLoss[i], 2),
                DoubleToString(g_strategyWeight[i], 4));
   }

   FileClose(handle);
   return true;
}

void UpdateLearningFromTrade(const long strategyMask, const double pnl)
{
   if(strategyMask <= 0)
      return;

   for(int i = 0; i < STRATEGY_COUNT; i++)
   {
      long bit = (long)MathPow(2.0, i);
      if((strategyMask & bit) == 0)
         continue;

      g_strategyTrades[i]++;
      if(pnl > 0.0)
      {
         g_strategyWins[i]++;
         g_strategyGrossProfit[i] += pnl;
      }
      else if(pnl < 0.0)
      {
         g_strategyLosses[i]++;
         g_strategyGrossLoss[i] += MathAbs(pnl);
      }

      g_strategyWeight[i] = RecalculateStrategyWeight(i);
   }

   SaveLearningStats();
}

bool LearningQualityAllowsScaling(const long strategyMask)
{
   if(!USE_MULTI_STRATEGY_ENGINE || !USE_ADAPTIVE_LEARNING)
      return true;

   if(strategyMask <= 0)
      return false;

   bool foundReadyStrategy = false;
   for(int i = 0; i < STRATEGY_COUNT; i++)
   {
      long bit = (long)MathPow(2.0, i);
      if((strategyMask & bit) == 0)
         continue;

      if(g_strategyTrades[i] < LEARNING_MIN_TRADES_PER_STRATEGY)
         continue;

      double winRate = (double)g_strategyWins[i] / (double)g_strategyTrades[i] * 100.0;
      double profitFactor = 0.0;
      if(g_strategyGrossLoss[i] > 0.0)
         profitFactor = g_strategyGrossProfit[i] / g_strategyGrossLoss[i];
      else if(g_strategyGrossProfit[i] > 0.0)
         profitFactor = 99.0;

      if(winRate >= 52.0 && profitFactor >= 1.15)
         foundReadyStrategy = true;
   }

   return foundReadyStrategy;
}

string BuildTradeComment(const ENUM_TRADE_SIGNAL signal)
{
   string side = (signal == SIGNAL_BUY ? "B" : "S");
   return "ETB " + side + " m" + IntegerToString(g_lastStrategyMask) + " r" + IntegerToString((int)g_lastRegime);
}

bool StrategyMaskHas(const long strategyMask, const ENUM_STRATEGY_ID strategyId)
{
   int idx = (int)strategyId;
   if(strategyMask <= 0 || idx < 0 || idx >= STRATEGY_COUNT)
      return false;

   long bit = (long)MathPow(2.0, idx);
   return ((strategyMask & bit) != 0);
}

long GetStrategyMaskFromClosedDeal(const ulong closeDealTicket)
{
   if(!HistoryDealSelect(closeDealTicket))
      return 0;

   string closeComment = HistoryDealGetString(closeDealTicket, DEAL_COMMENT);
   long mask = ExtractMaskFromComment(closeComment);
   if(mask > 0)
      return mask;

   long positionId = HistoryDealGetInteger(closeDealTicket, DEAL_POSITION_ID);
   string entryComment = FindEntryCommentByPosition(positionId);
   return ExtractMaskFromComment(entryComment);
}

string FindEntryCommentByPosition(const long positionId)
{
   if(positionId <= 0)
      return "";

   if(!HistorySelect(0, TimeCurrent()))
      return "";

   int totalDeals = HistoryDealsTotal();
   for(int i = totalDeals - 1; i >= 0; i--)
   {
      ulong ticket = HistoryDealGetTicket(i);
      if(ticket == 0)
         continue;

      if(HistoryDealGetInteger(ticket, DEAL_POSITION_ID) != positionId)
         continue;

      if(HistoryDealGetInteger(ticket, DEAL_ENTRY) == DEAL_ENTRY_IN)
         return HistoryDealGetString(ticket, DEAL_COMMENT);
   }

   return "";
}

long ExtractMaskFromComment(const string comment)
{
   return ExtractLongAfter(comment, "m");
}

long ExtractLongAfter(const string text, const string marker)
{
   int pos = StringFind(text, marker);
   if(pos < 0)
      return 0;

   pos += StringLen(marker);
   int len = StringLen(text);

   while(pos < len)
   {
      ushort ch = StringGetCharacter(text, pos);
      if(ch != 32 && ch != 61 && ch != 58)
         break;
      pos++;
   }

   string digits = "";
   while(pos < len)
   {
      ushort ch = StringGetCharacter(text, pos);
      if(ch < 48 || ch > 57)
         break;
      digits += StringSubstr(text, pos, 1);
      pos++;
   }

   if(digits == "")
      return 0;

   return StringToInteger(digits);
}

//+------------------------------------------------------------------+
//| APIs externas / noticias                                          |
//+------------------------------------------------------------------+
bool LoadExternalMarketContext()
{
   if(!USE_NEWS_FILTER)
   {
      g_newsRisk = NEWS_RISK_LOW;
      g_economicSummary = "Filtro de noticias desactivado";
      return true;
   }

   datetime now = TimeCurrent();
   if(g_lastNewsUpdate > 0 && (now - g_lastNewsUpdate) < NEWS_REFRESH_MINUTES * 60)
      return (g_newsRisk != NEWS_RISK_UNKNOWN);

   g_lastNewsUpdate = now;

   if(EXTERNAL_NEWS_URL == "")
   {
      g_newsRisk = NEWS_RISK_UNKNOWN;
      g_economicSummary = "Sin URL externa configurada; el EA usara modo conservador local";
      return false;
   }

   string apiKey = EXTERNAL_API_KEY;
   if(apiKey == "" && EXTERNAL_API_KEY_FILE != "")
      apiKey = ReadTextFile(EXTERNAL_API_KEY_FILE);

   string headers = "Content-Type: application/json\r\n";
   if(apiKey != "")
      headers += "X-Api-Key: " + apiKey + "\r\n";

   char postData[];
   char result[];
   string resultHeaders = "";
   ArrayResize(postData, 0);

   ResetLastError();
   int status = WebRequest("GET", EXTERNAL_NEWS_URL, headers, 5000, postData, result, resultHeaders);
   if(status == -1)
   {
      int err = GetLastError();
      g_newsRisk = NEWS_RISK_UNKNOWN;
      g_economicSummary = "WebRequest fallo. Error=" + IntegerToString(err);
      Print("EdiTrainingBot_XAUUSD: WebRequest fallo. Error=", err,
            ". Habilita la URL en Herramientas > Opciones > Asesores Expertos > Permitir WebRequest.");
      return false;
   }

   string response = CharArrayToString(result, 0, -1, CP_UTF8);
   g_economicSummary = StringSubstr(response, 0, 300);

   if(status < 200 || status >= 300)
   {
      g_newsRisk = NEWS_RISK_UNKNOWN;
      Print("EdiTrainingBot_XAUUSD: API externa respondio status=", status);
      return false;
   }

   string lower = response;
   StringToLower(lower);

   if(StringFind(lower, "high") >= 0 || StringFind(lower, "alto") >= 0)
      g_newsRisk = NEWS_RISK_HIGH;
   else if(StringFind(lower, "medium") >= 0 || StringFind(lower, "medio") >= 0)
      g_newsRisk = NEWS_RISK_MEDIUM;
   else if(StringFind(lower, "low") >= 0 || StringFind(lower, "bajo") >= 0)
      g_newsRisk = NEWS_RISK_LOW;
   else
      g_newsRisk = NEWS_RISK_UNKNOWN;

   return (g_newsRisk != NEWS_RISK_UNKNOWN);
}

int GetNewsRiskLevel()
{
   return (int)g_newsRisk;
}

string GetEconomicSummary()
{
   return g_economicSummary;
}

//+------------------------------------------------------------------+
//| Logging CSV                                                       |
//+------------------------------------------------------------------+
void EnsureLogHeader()
{
   bool exists = FileIsExist(LOG_FILE_NAME);
   int handle = FileOpen(LOG_FILE_NAME,
                         FILE_READ | FILE_WRITE | FILE_CSV | FILE_ANSI | FILE_SHARE_READ | FILE_SHARE_WRITE,
                         ',');
   if(handle == INVALID_HANDLE)
   {
      Print("No se pudo abrir el archivo de log: ", LOG_FILE_NAME, " error=", GetLastError());
      return;
   }

   if(!exists || FileSize(handle) == 0)
   {
      FileWrite(handle,
                "datetime", "symbol", "mode", "state", "signal", "action",
                "lot", "bid", "ask", "spread", "atr", "sl", "tp",
                "balance", "equity", "total_trades", "wins", "losses",
                "win_rate", "profit_factor", "consecutive_losses",
                "daily_pnl", "current_dd", "max_dd", "news_risk", "reason");
   }

   FileClose(handle);
}

void LogDecision(const ENUM_TRADE_SIGNAL signal,
                 const string action,
                 const double lot,
                 const double bid,
                 const double ask,
                 const double spread,
                 const double atr,
                 const double sl,
                 const double tp,
                 const string reason)
{
   EnsureLogHeader();

   int handle = FileOpen(LOG_FILE_NAME,
                         FILE_READ | FILE_WRITE | FILE_CSV | FILE_ANSI | FILE_SHARE_READ | FILE_SHARE_WRITE,
                         ',');
   if(handle == INVALID_HANDLE)
   {
      Print("No se pudo escribir log CSV. error=", GetLastError());
      return;
   }

   FileSeek(handle, 0, SEEK_END);

   g_lastReason = reason;

   FileWrite(handle,
             TimeToString(TimeCurrent(), TIME_DATE | TIME_SECONDS),
             _Symbol,
             ModeString(),
             BotStateToString(g_botState),
             SignalToString(signal),
             action,
             DoubleToString(lot, 2),
             DoubleToString(bid, _Digits),
             DoubleToString(ask, _Digits),
             DoubleToString(spread, 1),
             DoubleToString(atr, _Digits),
             DoubleToString(sl, _Digits),
             DoubleToString(tp, _Digits),
             DoubleToString(AccountInfoDouble(ACCOUNT_BALANCE), 2),
             DoubleToString(AccountInfoDouble(ACCOUNT_EQUITY), 2),
             IntegerToString(g_totalTrades),
             IntegerToString(g_wins),
             IntegerToString(g_losses),
             DoubleToString(g_winRate, 2),
             DoubleToString(g_profitFactor, 2),
             IntegerToString(g_consecutiveLosses),
             DoubleToString(g_dailyPnl, 2),
             DoubleToString(g_currentDD, 2),
             DoubleToString(g_maxDD, 2),
             NewsRiskToString(g_newsRisk),
             reason);

   FileClose(handle);
}

//+------------------------------------------------------------------+
//| Utilidades                                                        |
//+------------------------------------------------------------------+
bool IsNewBar()
{
   datetime barTime = iTime(_Symbol, _Period, 0);
   if(barTime == 0)
      return false;

   if(barTime != g_lastBarTime)
   {
      g_lastBarTime = barTime;
      return true;
   }

   return false;
}

void RefreshDayIfNeeded()
{
   datetime today = StartOfDay(TimeCurrent());
   if(today != g_todayStart)
   {
      g_todayStart = today;
      g_dayStartBalance = AccountInfoDouble(ACCOUNT_BALANCE);
      g_tradesToday = 0;
      g_dailyPnl = 0.0;
   Print("EdiTrainingBot_XAUUSD: nuevo dia detectado. Se reinician limites diarios.");
   }
}

datetime StartOfDay(const datetime value)
{
   MqlDateTime dt;
   TimeToStruct(value, dt);
   dt.hour = 0;
   dt.min = 0;
   dt.sec = 0;
   return StructToTime(dt);
}

double GetSpreadPoints(const MqlTick &tick)
{
   if(_Point <= 0.0)
      return 0.0;
   return (tick.ask - tick.bid) / _Point;
}

double NormalizeVolume(const double volume, const double minVol, const double maxVol, const double stepVol)
{
   double safeVolume = MathMax(minVol, MathMin(volume, maxVol));
   double steps = MathFloor((safeVolume + 0.00000001) / stepVol);
   double normalized = steps * stepVol;

   if(normalized < minVol)
      normalized = minVol;
   if(normalized > maxVol)
      normalized = MathFloor(maxVol / stepVol) * stepVol;

   int digits = 2;
   if(stepVol > 0.0)
   {
      digits = (int)MathRound(-MathLog10(stepVol));
      if(digits < 0)
         digits = 0;
      if(digits > 8)
         digits = 8;
   }

   return NormalizeDouble(normalized, digits);
}

double ClampDouble(const double value, const double minValue, const double maxValue)
{
   return MathMax(minValue, MathMin(value, maxValue));
}

string StrategyName(const int strategyId)
{
   switch(strategyId)
   {
      case STRAT_TREND_FOLLOWING:       return "Trend Following";
      case STRAT_MOMENTUM:              return "Momentum";
      case STRAT_BREAKOUT:              return "Breakout Trading";
      case STRAT_MEAN_REVERSION:        return "Mean Reversion";
      case STRAT_PULLBACK:              return "Pullback en tendencia";
      case STRAT_MA_CROSSOVER:          return "Moving Average Crossover";
      case STRAT_PRICE_ACTION_SR:       return "Price Action / SR";
      case STRAT_LIQUIDITY_SWEEP:       return "Order Block / Liquidity Sweep";
      case STRAT_SCALPING_FILTER:       return "Scalping Filter";
      case STRAT_DAY_SESSION:           return "Day Trading Session";
      case STRAT_SWING_HTF:             return "Swing / HTF";
      case STRAT_CARRY_CONTEXT:         return "Carry Context";
      case STRAT_PAIRS_CONTEXT:         return "Pairs Context";
      case STRAT_STAT_ARB_CONTEXT:      return "Statistical Arbitrage Context";
      case STRAT_VOL_BREAKOUT:          return "Volatility Breakout";
      case STRAT_VOL_MEAN_REVERSION:    return "Volatility Mean Reversion";
      case STRAT_NEWS_CONTEXT:          return "News/Event Context";
      case STRAT_MACRO_CONTEXT:         return "Macro Context";
      case STRAT_MARKET_MAKING_CONTEXT: return "Market Making Context";
      case STRAT_REGIME_ML:             return "ML / Regime Detection";
   }

   return "Unknown";
}

string RegimeToString(const ENUM_MARKET_REGIME regime)
{
   if(regime == REGIME_TREND)
      return "TREND";
   if(regime == REGIME_RANGE)
      return "RANGE";
   if(regime == REGIME_BREAKOUT)
      return "BREAKOUT";
   if(regime == REGIME_HIGH_VOLATILITY)
      return "HIGH_VOLATILITY";
   if(regime == REGIME_LOW_VOLATILITY)
      return "LOW_VOLATILITY";
   return "UNKNOWN";
}

string TimeframeToString(const ENUM_TIMEFRAMES timeframe)
{
   string value = EnumToString(timeframe);
   StringReplace(value, "PERIOD_", "");
   return value;
}

string SanitizeFilePart(const string raw)
{
   string value = raw;
   StringReplace(value, "\\", "_");
   StringReplace(value, "/", "_");
   StringReplace(value, ":", "_");
   StringReplace(value, "*", "_");
   StringReplace(value, "?", "_");
   StringReplace(value, "\"", "_");
   StringReplace(value, "<", "_");
   StringReplace(value, ">", "_");
   StringReplace(value, "|", "_");
   StringReplace(value, " ", "_");
   return value;
}

string ReadTextFile(const string fileName)
{
   int handle = FileOpen(fileName, FILE_READ | FILE_TXT | FILE_ANSI);
   if(handle == INVALID_HANDLE)
      return "";

   string text = "";
   while(!FileIsEnding(handle))
      text += FileReadString(handle);

   FileClose(handle);
   StringTrimLeft(text);
   StringTrimRight(text);
   return text;
}

string ModeString()
{
   ENUM_ACCOUNT_TRADE_MODE mode = (ENUM_ACCOUNT_TRADE_MODE)AccountInfoInteger(ACCOUNT_TRADE_MODE);
   if(TRAINING_MODE)
      return "TRAINING_" + AccountTradeModeToString(mode);
   return "LIVE_READY_" + AccountTradeModeToString(mode);
}

string AccountTradeModeToString(const ENUM_ACCOUNT_TRADE_MODE mode)
{
   if(mode == ACCOUNT_TRADE_MODE_DEMO)
      return "DEMO";
   if(mode == ACCOUNT_TRADE_MODE_CONTEST)
      return "CONTEST";
   if(mode == ACCOUNT_TRADE_MODE_REAL)
      return "REAL";
   return "UNKNOWN";
}

string BotStateToString(const ENUM_BOT_STATE state)
{
   if(state == BOT_ACTIVE)
      return "ACTIVE";
   if(state == BOT_PAUSED)
      return "PAUSED";
   if(state == BOT_KILL_SWITCH)
      return "KILL_SWITCH";
   if(state == BOT_WAITING_SIGNAL)
      return "WAITING_SIGNAL";
   return "UNKNOWN";
}

string SignalToString(const ENUM_TRADE_SIGNAL signal)
{
   if(signal == SIGNAL_BUY)
      return "BUY";
   if(signal == SIGNAL_SELL)
      return "SELL";
   return "NONE";
}

string NewsRiskToString(const ENUM_NEWS_RISK risk)
{
   if(risk == NEWS_RISK_LOW)
      return "NEWS_RISK_LOW";
   if(risk == NEWS_RISK_MEDIUM)
      return "NEWS_RISK_MEDIUM";
   if(risk == NEWS_RISK_HIGH)
      return "NEWS_RISK_HIGH";
   if(risk == NEWS_RISK_UNKNOWN)
      return "NEWS_RISK_UNKNOWN";
   return "NEWS_RISK_UNKNOWN";
}

string BoolToText(const bool value)
{
   return value ? "true" : "false";
}
//+------------------------------------------------------------------+
