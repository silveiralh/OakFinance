// Data de hoje no fuso do cliente (RN-02), trocada à meia-noite: virada do dia e do mês sem recarregar (RN-48).
import { type ISODate, todayIn } from '@oakfinance/domain';
import { useEffect, useState } from 'react';

const TIME_ZONE = 'America/Sao_Paulo';

/** Milissegundos até a próxima meia-noite no fuso. */
export function msUntilNextDay(now: Date, timeZone = TIME_ZONE): number {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone,
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(now);
  const get = (type: string) => Number(parts.find((p) => p.type === type)?.value ?? 0);
  const elapsed =
    ((get('hour') * 60 + get('minute')) * 60 + get('second')) * 1000 + now.getMilliseconds();
  return Math.max(1, 86_400_000 - elapsed);
}

/** Data de hoje no fuso do cliente, trocada à meia-noite (virada do dia e do mês). */
export function useToday(fixed?: ISODate): ISODate {
  const [today, setToday] = useState(() => fixed ?? todayIn(TIME_ZONE, new Date()));
  useEffect(() => {
    if (fixed) {
      setToday(fixed);
      return;
    }
    let timer: ReturnType<typeof setTimeout>;
    const schedule = () => {
      timer = setTimeout(() => {
        setToday(todayIn(TIME_ZONE, new Date()));
        schedule();
      }, msUntilNextDay(new Date()) + 50);
    };
    setToday(todayIn(TIME_ZONE, new Date()));
    schedule();
    return () => clearTimeout(timer);
  }, [fixed]);
  return today;
}
