#property strict
#property version   "1.12"
#property description "Quant VPS bridge for MT5 account status, rates and controlled order commands"

#include <Trade/Trade.mqh>

input string BridgeStatusFile = "quant_bridge_status.json";
input string BridgeCommandFile = "quant_bridge_command.txt";
input string BridgeLastResultFile = "quant_bridge_last_result.json";
input int PollSeconds = 5;
input bool AllowBridgeCommands = true;
input bool AllowDemoOrderSend = true;
input bool AllowRealOrderSend = false;
input bool AllowRealOrderCheck = true;
input string RealOrderFlagFile = "quant_bridge_real_order_enabled.flag";
input string BridgeRatesSymbols = "XAUUSD,EURUSD,GBPUSD,USDJPY,AUDCAD,USDCAD,AUDUSD,NZDUSD,USDCHF,BTCUSD,ETHUSD";
input string BridgeRatesTimeframes = "M1,M5,M15,H1,H4,D1";
input int BridgeRatesBars = 120;

CTrade Trade;
string LastCommandId = "";

string Esc(string value)
{
   StringReplace(value, "\\", "\\\\");
   StringReplace(value, "\"", "\\\"");
   StringReplace(value, "\r", " ");
   StringReplace(value, "\n", " ");
   return value;
}

string BoolJson(bool value) { return value ? "true" : "false"; }

string TrimCopy(string value)
{
   StringTrimLeft(value);
   StringTrimRight(value);
   return value;
}

ENUM_TIMEFRAMES TfFromName(string name)
{
   string tf = TrimCopy(name);
   StringToUpper(tf);
   if(tf == "M1") return PERIOD_M1;
   if(tf == "M5") return PERIOD_M5;
   if(tf == "M15") return PERIOD_M15;
   if(tf == "M30") return PERIOD_M30;
   if(tf == "H1") return PERIOD_H1;
   if(tf == "H4") return PERIOD_H4;
   if(tf == "D1") return PERIOD_D1;
   if(tf == "W1") return PERIOD_W1;
   if(tf == "MN1" || tf == "MONTH1") return PERIOD_MN1;
   return PERIOD_M1;
}

int TfPeriodMinutes(string name)
{
   string tf = TrimCopy(name);
   StringToUpper(tf);
   if(tf == "M1") return 1;
   if(tf == "M5") return 5;
   if(tf == "M15") return 15;
   if(tf == "M30") return 30;
   if(tf == "H1") return 60;
   if(tf == "H4") return 240;
   if(tf == "D1") return 1440;
   if(tf == "W1") return 10080;
   if(tf == "MN1" || tf == "MONTH1") return 43200;
   return 1;
}

string RatesPacketJson(string symbol, string tfName)
{
   string sym = TrimCopy(symbol);
   string tf = TrimCopy(tfName);
   StringToUpper(tf);
   int period = TfPeriodMinutes(tf);
   if(StringLen(sym) <= 0)
      return StringFormat("{\"timeframe\":\"%s\",\"period\":%d,\"error\":\"empty_symbol\",\"candles\":[]}", Esc(tf), period);

   if(!SymbolSelect(sym, true))
      return StringFormat("{\"timeframe\":\"%s\",\"period\":%d,\"error\":\"symbol_select_failed_%d\",\"candles\":[]}", Esc(tf), period, GetLastError());

   int bars = MathMax(1, MathMin(BridgeRatesBars, 300));
   MqlRates rates[];
   ArraySetAsSeries(rates, true);
   int copied = CopyRates(sym, TfFromName(tf), 0, bars, rates);
   if(copied <= 0)
      return StringFormat("{\"timeframe\":\"%s\",\"period\":%d,\"error\":\"copy_rates_failed_%d\",\"candles\":[]}", Esc(tf), period, GetLastError());

   string candles = "[";
   bool first = true;
   for(int i = copied - 1; i >= 0; i--)
   {
      if(!first) candles += ",";
      first = false;
      candles += StringFormat("{\"t\":%I64d,\"o\":%.8f,\"h\":%.8f,\"l\":%.8f,\"c\":%.8f,\"v\":%I64d}",
         rates[i].time, rates[i].open, rates[i].high, rates[i].low, rates[i].close, rates[i].tick_volume);
   }
   candles += "]";
   return StringFormat("{\"timeframe\":\"%s\",\"period\":%d,\"candles\":%s}", Esc(tf), period, candles);
}

string RatesBookJson()
{
   string symbols[];
   string timeframes[];
   int symbolCount = StringSplit(BridgeRatesSymbols, ',', symbols);
   int tfCount = StringSplit(BridgeRatesTimeframes, ',', timeframes);
   if(symbolCount <= 0 || tfCount <= 0) return "{}";

   string book = "{";
   bool firstSymbol = true;
   int maxSymbols = MathMin(symbolCount, 40);
   int maxTfs = MathMin(tfCount, 9);
   for(int i = 0; i < maxSymbols; i++)
   {
      string sym = TrimCopy(symbols[i]);
      if(StringLen(sym) <= 0) continue;
      if(!firstSymbol) book += ",";
      firstSymbol = false;
      book += StringFormat("\"%s\":{", Esc(sym));
      bool firstTf = true;
      for(int j = 0; j < maxTfs; j++)
      {
         string tf = TrimCopy(timeframes[j]);
         StringToUpper(tf);
         if(StringLen(tf) <= 0) continue;
         if(!firstTf) book += ",";
         firstTf = false;
         book += StringFormat("\"%s\":%s", Esc(tf), RatesPacketJson(sym, tf));
      }
      book += "}";
   }
   book += "}";
   return book;
}

void WriteTextFile(string name, string text)
{
   int h = FileOpen(name, FILE_WRITE | FILE_TXT | FILE_ANSI);
   if(h == INVALID_HANDLE)
   {
      Print("QuantBridge FileOpen failed ", name, " err=", GetLastError());
      return;
   }
   FileWriteString(h, text);
   FileClose(h);
}

string ReadTextFile(string name)
{
   int h = FileOpen(name, FILE_READ | FILE_TXT | FILE_ANSI);
   if(h == INVALID_HANDLE) return "";
   string text = "";
   while(!FileIsEnding(h)) text += FileReadString(h) + "\n";
   FileClose(h);
   return text;
}

string Kv(string text, string key)
{
   string prefix = key + "=";
   string lines[];
   int count = StringSplit(text, '\n', lines);
   for(int i = 0; i < count; i++)
   {
      string line = lines[i];
      StringTrimLeft(line);
      StringTrimRight(line);
      if(StringFind(line, prefix) == 0) return StringSubstr(line, StringLen(prefix));
   }
   return "";
}

double Num(string value, double fallback = 0.0)
{
   if(StringLen(value) <= 0) return fallback;
   return StringToDouble(value);
}

long IntNum(string value, long fallback = 0)
{
   if(StringLen(value) <= 0) return fallback;
   return StringToInteger(value);
}

bool DemoAccount()
{
   string server = AccountInfoString(ACCOUNT_SERVER);
   string lower = server;
   StringToLower(lower);
   return AccountInfoInteger(ACCOUNT_TRADE_MODE) == ACCOUNT_TRADE_MODE_DEMO || StringFind(lower, "demo") >= 0;
}

bool TextTruthy(string value)
{
   string v = value;
   StringTrimLeft(v);
   StringTrimRight(v);
   StringToLower(v);
   return v == "1" || v == "true" || v == "yes" || v == "on" || v == "enabled";
}

bool RuntimeBoolFlag(string fileName)
{
   if(fileName == "")
      return false;
   int handle = FileOpen(fileName, FILE_READ | FILE_TXT | FILE_ANSI);
   if(handle == INVALID_HANDLE)
      return false;
   string value = FileReadString(handle);
   FileClose(handle);
   return TextTruthy(value);
}

bool EffectiveRealOrderSend()
{
   return AllowRealOrderSend || RuntimeBoolFlag(RealOrderFlagFile);
}

bool EffectiveRealOrderCheck()
{
   return AllowRealOrderCheck || EffectiveRealOrderSend();
}

bool BridgeCommandsEnabled()
{
   return AllowBridgeCommands && (DemoAccount() || EffectiveRealOrderSend() || EffectiveRealOrderCheck());
}

bool CommandAllowed(string action)
{
   if(DemoAccount())
      return AllowDemoOrderSend;
   if(action == "CHECK")
      return EffectiveRealOrderCheck();
   return EffectiveRealOrderSend();
}

string PositionJson(int index)
{
   ulong ticket = PositionGetTicket(index);
   if(ticket == 0) return "{}";
   string symbol = PositionGetString(POSITION_SYMBOL);
   long type = PositionGetInteger(POSITION_TYPE);
   string side = type == POSITION_TYPE_BUY ? "BUY" : "SELL";
   double volume = PositionGetDouble(POSITION_VOLUME);
   double open = PositionGetDouble(POSITION_PRICE_OPEN);
   double current = PositionGetDouble(POSITION_PRICE_CURRENT);
   double profit = PositionGetDouble(POSITION_PROFIT);
   double sl = PositionGetDouble(POSITION_SL);
   double tp = PositionGetDouble(POSITION_TP);
   long timeOpen = PositionGetInteger(POSITION_TIME);
   string comment = PositionGetString(POSITION_COMMENT);
   return StringFormat("{\"ticket\":%I64u,\"symbol\":\"%s\",\"side\":\"%s\",\"volume\":%.8f,\"priceOpen\":%.8f,\"priceCurrent\":%.8f,\"profit\":%.8f,\"sl\":%.8f,\"tp\":%.8f,\"time\":%I64d,\"comment\":\"%s\"}",
      ticket, Esc(symbol), side, volume, open, current, profit, sl, tp, timeOpen, Esc(comment));
}

void WriteStatus()
{
   bool connected = (bool)TerminalInfoInteger(TERMINAL_CONNECTED);
   bool tradeAllowed = (bool)TerminalInfoInteger(TERMINAL_TRADE_ALLOWED);
   bool mqlTradeAllowed = (bool)MQLInfoInteger(MQL_TRADE_ALLOWED);
   long login = AccountInfoInteger(ACCOUNT_LOGIN);
   string server = AccountInfoString(ACCOUNT_SERVER);
   string currency = AccountInfoString(ACCOUNT_CURRENCY);
   long tradeMode = AccountInfoInteger(ACCOUNT_TRADE_MODE);
   double balance = AccountInfoDouble(ACCOUNT_BALANCE);
   double equity = AccountInfoDouble(ACCOUNT_EQUITY);
   double margin = AccountInfoDouble(ACCOUNT_MARGIN);
   double marginFree = AccountInfoDouble(ACCOUNT_MARGIN_FREE);
   double profit = AccountInfoDouble(ACCOUNT_PROFIT);
   double bid = SymbolInfoDouble(_Symbol, SYMBOL_BID);
   double ask = SymbolInfoDouble(_Symbol, SYMBOL_ASK);
   int total = PositionsTotal();
   string positions = "[";
   for(int i = 0; i < total; i++)
   {
      if(i > 0) positions += ",";
      positions += PositionJson(i);
   }
   positions += "]";
   string rates = RatesBookJson();
   string json = StringFormat("{\"ok\":true,\"source\":\"QuantBridge.mq5\",\"ts\":%I64d,\"symbol\":\"%s\",\"period\":%d,\"connected\":%s,\"tradeAllowed\":%s,\"mqlTradeAllowed\":%s,\"allowDemoOrderSend\":%s,\"allowRealOrderSend\":%s,\"allowRealOrderCheck\":%s,\"login\":%I64d,\"server\":\"%s\",\"currency\":\"%s\",\"tradeMode\":%I64d,\"balance\":%.8f,\"equity\":%.8f,\"margin\":%.8f,\"marginFree\":%.8f,\"profit\":%.8f,\"bid\":%.8f,\"ask\":%.8f,\"positionsTotal\":%d,\"positions\":%s,\"rates\":%s}",
      TimeCurrent(), Esc(_Symbol), Period(), BoolJson(connected), BoolJson(tradeAllowed), BoolJson(mqlTradeAllowed), BoolJson(AllowDemoOrderSend), BoolJson(EffectiveRealOrderSend()), BoolJson(EffectiveRealOrderCheck()), login, Esc(server), Esc(currency), tradeMode, balance, equity, margin, marginFree, profit, bid, ask, total, positions, rates);
   WriteTextFile(BridgeStatusFile, json);
}

void WriteResult(string id, string json)
{
   string resultFile = "quant_bridge_result_" + id + ".json";
   WriteTextFile(resultFile, json);
   WriteTextFile(BridgeLastResultFile, json);
}

void ProcessCommand()
{
   string text = ReadTextFile(BridgeCommandFile);
   if(StringLen(text) <= 0) return;
   string id = Kv(text, "id");
   if(StringLen(id) <= 0) return;
   if(id == LastCommandId)
   {
      FileDelete(BridgeCommandFile);
      return;
   }
   LastCommandId = id;
   FileDelete(BridgeCommandFile);

   string action = Kv(text, "action");
   if(action != "ORDER" && action != "CLOSE" && action != "CHECK")
   {
      WriteResult(id, StringFormat("{\"ok\":false,\"reason\":\"unsupported_action\",\"commandId\":\"%s\"}", Esc(id)));
      return;
   }

   string symbol = Kv(text, "symbol");
   string side = Kv(text, "side");
   string type = Kv(text, "type");
   double volume = Num(Kv(text, "volume"));
   double price = Num(Kv(text, "price"));
   int deviation = (int)IntNum(Kv(text, "deviation"), 20);
   long magic = IntNum(Kv(text, "magic"), 260530);
   string comment = Kv(text, "comment");

   if(!CommandAllowed(action))
   {
      string reason = DemoAccount() ? "demo_order_not_allowed" : "real_order_not_allowed";
      WriteResult(id, StringFormat("{\"ok\":false,\"reason\":\"%s\",\"commandId\":\"%s\",\"demo\":%s,\"allowRealOrderSend\":%s}", reason, Esc(id), BoolJson(DemoAccount()), BoolJson(EffectiveRealOrderSend())));
      return;
   }
   if(!TerminalInfoInteger(TERMINAL_CONNECTED) || !TerminalInfoInteger(TERMINAL_TRADE_ALLOWED) || !MQLInfoInteger(MQL_TRADE_ALLOWED))
   {
      WriteResult(id, StringFormat("{\"ok\":false,\"reason\":\"terminal_trade_not_allowed\",\"commandId\":\"%s\"}", Esc(id)));
      return;
   }

   if(action == "CLOSE")
   {
      ulong ticket = (ulong)IntNum(Kv(text, "ticket"), 0);
      if(ticket <= 0)
      {
         WriteResult(id, StringFormat("{\"ok\":false,\"reason\":\"invalid_close_ticket\",\"commandId\":\"%s\"}", Esc(id)));
         return;
      }
      if(!PositionSelectByTicket(ticket))
      {
         WriteResult(id, StringFormat("{\"ok\":false,\"reason\":\"position_not_found\",\"commandId\":\"%s\",\"ticket\":%I64u}", Esc(id), ticket));
         return;
      }
      string closeSymbol = PositionGetString(POSITION_SYMBOL);
      double closeVolume = PositionGetDouble(POSITION_VOLUME);
      long closeType = PositionGetInteger(POSITION_TYPE);
      string closeSide = closeType == POSITION_TYPE_BUY ? "BUY" : "SELL";
      Trade.SetExpertMagicNumber(magic);
      Trade.SetDeviationInPoints(deviation);
      bool closeOk = Trade.PositionClose(ticket, deviation);
      long closeRetcode = Trade.ResultRetcode();
      string closeResult = StringFormat("{\"ok\":%s,\"commandId\":\"%s\",\"action\":\"CLOSE\",\"retcode\":%I64d,\"ticket\":%I64u,\"deal\":%I64u,\"comment\":\"%s\",\"symbol\":\"%s\",\"side\":\"%s\",\"volume\":%.8f,\"account\":{\"login\":%I64d,\"server\":\"%s\",\"tradeMode\":%I64d}}",
         BoolJson(closeOk), Esc(id), closeRetcode, ticket, Trade.ResultDeal(), Esc(Trade.ResultComment()), Esc(closeSymbol), closeSide, closeVolume, AccountInfoInteger(ACCOUNT_LOGIN), Esc(AccountInfoString(ACCOUNT_SERVER)), AccountInfoInteger(ACCOUNT_TRADE_MODE));
      WriteResult(id, closeResult);
      WriteStatus();
      return;
   }

   if(StringLen(symbol) < 3 || volume <= 0 || (side != "BUY" && side != "SELL"))
   {
      WriteResult(id, StringFormat("{\"ok\":false,\"reason\":\"invalid_order_payload\",\"commandId\":\"%s\"}", Esc(id)));
      return;
   }

   SymbolSelect(symbol, true);
   double ask = SymbolInfoDouble(symbol, SYMBOL_ASK);
   double bid = SymbolInfoDouble(symbol, SYMBOL_BID);
   double marketPrice = side == "BUY" ? ask : bid;
   if(action == "CHECK")
   {
      MqlTradeRequest request;
      MqlTradeCheckResult check;
      ZeroMemory(request);
      ZeroMemory(check);
      request.action = type == "LIMIT" ? TRADE_ACTION_PENDING : TRADE_ACTION_DEAL;
      request.symbol = symbol;
      request.volume = volume;
      request.type = side == "BUY" ? ORDER_TYPE_BUY : ORDER_TYPE_SELL;
      request.deviation = deviation;
      request.magic = magic;
      request.comment = comment;
      request.type_time = ORDER_TIME_GTC;
      request.type_filling = ORDER_FILLING_IOC;
      request.price = type == "LIMIT" ? price : marketPrice;
      if(type == "LIMIT")
         request.type = side == "BUY" ? ORDER_TYPE_BUY_LIMIT : ORDER_TYPE_SELL_LIMIT;
      bool checkOk = OrderCheck(request, check);
      string checkResult = StringFormat("{\"ok\":%s,\"commandId\":\"%s\",\"action\":\"CHECK\",\"retcode\":%I64d,\"comment\":\"%s\",\"symbol\":\"%s\",\"side\":\"%s\",\"volume\":%.8f,\"type\":\"%s\",\"balance\":%.8f,\"equity\":%.8f,\"margin\":%.8f,\"marginFree\":%.8f,\"account\":{\"login\":%I64d,\"server\":\"%s\",\"tradeMode\":%I64d}}",
         BoolJson(checkOk), Esc(id), check.retcode, Esc(check.comment), Esc(symbol), side, volume, type, check.balance, check.equity, check.margin, check.margin_free, AccountInfoInteger(ACCOUNT_LOGIN), Esc(AccountInfoString(ACCOUNT_SERVER)), AccountInfoInteger(ACCOUNT_TRADE_MODE));
      WriteResult(id, checkResult);
      return;
   }

   Trade.SetExpertMagicNumber(magic);
   Trade.SetDeviationInPoints(deviation);
   bool ok = false;
   if(type == "LIMIT")
   {
      if(price <= 0)
      {
         WriteResult(id, StringFormat("{\"ok\":false,\"reason\":\"limit_price_required\",\"commandId\":\"%s\"}", Esc(id)));
         return;
      }
      ok = side == "BUY"
         ? Trade.BuyLimit(volume, price, symbol, 0, 0, ORDER_TIME_GTC, 0, comment)
         : Trade.SellLimit(volume, price, symbol, 0, 0, ORDER_TIME_GTC, 0, comment);
   }
   else
   {
      ok = side == "BUY"
         ? Trade.Buy(volume, symbol, 0, 0, 0, comment)
         : Trade.Sell(volume, symbol, 0, 0, 0, comment);
   }
   long retcode = Trade.ResultRetcode();
   string result = StringFormat("{\"ok\":%s,\"commandId\":\"%s\",\"retcode\":%I64d,\"ticket\":%I64u,\"deal\":%I64u,\"comment\":\"%s\",\"symbol\":\"%s\",\"side\":\"%s\",\"volume\":%.8f,\"type\":\"%s\",\"account\":{\"login\":%I64d,\"server\":\"%s\",\"tradeMode\":%I64d}}",
      BoolJson(ok), Esc(id), retcode, Trade.ResultOrder(), Trade.ResultDeal(), Esc(Trade.ResultComment()), Esc(symbol), side, volume, type, AccountInfoInteger(ACCOUNT_LOGIN), Esc(AccountInfoString(ACCOUNT_SERVER)), AccountInfoInteger(ACCOUNT_TRADE_MODE));
   WriteResult(id, result);
}

int OnInit()
{
   EventSetTimer(MathMax(1, PollSeconds));
   Print("QuantBridge initialized status bridge; commands=", BoolJson(BridgeCommandsEnabled()));
   WriteStatus();
   if(BridgeCommandsEnabled()) ProcessCommand();
   return INIT_SUCCEEDED;
}

void OnDeinit(const int reason)
{
   EventKillTimer();
   Print("QuantBridge stopped reason=", reason);
}

void OnTimer()
{
   WriteStatus();
   if(BridgeCommandsEnabled()) ProcessCommand();
}
