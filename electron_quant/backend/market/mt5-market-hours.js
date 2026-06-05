function getBogotaMarketClock(date = new Date()) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/Bogota',
    weekday: 'short',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false
  }).formatToParts(date).reduce((acc, part) => {
    acc[part.type] = part.value;
    return acc;
  }, {});
  const dayMap = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
  return {
    day: dayMap[parts.weekday] ?? 0,
    hour: Number(parts.hour || 0),
    minute: Number(parts.minute || 0),
    second: Number(parts.second || 0),
    label: `${parts.weekday || '---'} ${parts.hour || '--'}:${parts.minute || '--'}:${parts.second || '--'} America/Bogota`
  };
}

function getMt5MarketSession(date = new Date()) {
  const bogota = getBogotaMarketClock(date);
  const minutes = bogota.hour * 60 + bogota.minute;
  const dailyStart = 15 * 60;
  const dailyEnd = 16 * 60;
  const fridayCut = 16 * 60;
  const sundayResume = 17 * 60;

  const weekendCut =
    (bogota.day === 5 && minutes >= fridayCut)
    || bogota.day === 6
    || (bogota.day === 0 && minutes < sundayResume);
  if (weekendCut) {
    return {
      open: false,
      reason: 'weekend_cut',
      bogota,
      message: 'MT5 cerrado por corte de fin de semana: viernes 16:00 a domingo 17:00 hora Colombia.'
    };
  }

  if (minutes >= dailyStart && minutes < dailyEnd) {
    return {
      open: false,
      reason: 'daily_maintenance',
      bogota,
      message: 'MT5 cerrado por mantenimiento diario: 15:00 a 16:00 hora Colombia.'
    };
  }

  return {
    open: true,
    reason: 'open',
    bogota,
    message: 'MT5 dentro de horario operativo segun ventana Colombia configurada.'
  };
}

module.exports = {
  getBogotaMarketClock,
  getMt5MarketSession
};
