export const ZONA_HORARIA = "America/Argentina/Buenos_Aires";

const formato = new Intl.DateTimeFormat("en-CA", {
  timeZone: ZONA_HORARIA,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
  hourCycle: "h23",
});

function partes(fecha: Date) {
  return Object.fromEntries(
    formato.formatToParts(fecha).map(({ type, value }) => [type, value]),
  );
}

export function fechaDelEstablecimiento(fecha: Date): string {
  const p = partes(fecha);
  return `${p.year}-${p.month}-${p.day}`;
}

export function minutosDelEstablecimiento(fecha: Date): number {
  const p = partes(fecha);
  return Number(p.hour) * 60 + Number(p.minute);
}

export function sumarDiasFecha(fecha: string, dias: number): string {
  const referencia = new Date(`${fecha}T00:00:00Z`);
  referencia.setUTCDate(referencia.getUTCDate() + dias);
  return referencia.toISOString().slice(0, 10);
}

export function diaSemanaFecha(fecha: string): number {
  return new Date(`${fecha}T00:00:00Z`).getUTCDay();
}

/** Convierte una hora civil del establecimiento sin depender de process.env.TZ. */
export function instanteDelEstablecimiento(fecha: string, minutos = 0): Date {
  const objetivo = new Date(`${fecha}T00:00:00Z`).getTime() + minutos * 60000;
  let instante = objetivo;
  for (let i = 0; i < 4; i++) {
    const p = partes(new Date(instante));
    const representado = new Date(
      `${p.year}-${p.month}-${p.day}T${p.hour}:${p.minute}:${p.second}Z`,
    ).getTime();
    const diferencia = objetivo - representado;
    if (diferencia === 0) return new Date(instante);
    instante += diferencia;
  }
  throw new Error("La hora indicada no existe en la zona del establecimiento");
}
