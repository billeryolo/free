// Formatting for the survey record: real units, sensible precision.

const nf = (d) => new Intl.NumberFormat('en-US', { maximumFractionDigits: d, minimumFractionDigits: d });
const int = new Intl.NumberFormat('en-US', { maximumFractionDigits: 0 });

export const fmt = {
  int: (v) => int.format(Math.round(v)),
  fixed: (v, d = 1) => nf(d).format(v),
  pct: (v) => `${Math.round(v * 100)}%`,
};

export function formatPressure(bar) {
  if (bar <= 0) return 'None';
  if (bar >= 500) return 'No solid surface';
  if (bar < 0.1) return `${fmt.int(bar * 1000)} mbar`;
  return `${fmt.fixed(bar, bar < 10 ? 2 : 0)} bar`;
}

export function formatTemp(k) {
  return `${fmt.int(k)} K`;
}

export function formatCelsius(k) {
  const c = k - 273.15;
  return `${c < 0 ? '−' : ''}${fmt.int(Math.abs(c))} °C`;
}

export function formatYear(days) {
  if (days < 2) return `${fmt.fixed(days * 24, 1)} h`;
  if (days > 1500) return `${fmt.fixed(days / 365.25, 1)} Earth years`;
  return `${fmt.int(days)} days`;
}

export function hydrosphereLabel(world) {
  if (world.style === 5) return 'Ocean';
  if (world.cls === 'volcanic') return 'Lava seas';
  if (world.cls === 'frozen') return 'Frozen seas';
  if (!world.surface.uLiquid) return 'Lowland basins';
  return 'Ocean';
}

export function hydrosphereValue(world, fraction) {
  if (world.style === 5) return { main: 'None', sub: 'Fluid envelope' };
  const p = fmt.pct(fraction);
  if (world.cls === 'volcanic') return { main: `${p} molten`, sub: 'Silicate lava seas' };
  if (world.cls === 'frozen') return { main: `${p} ice-covered`, sub: 'Subsurface ocean likely' };
  if (world.cls === 'toxic') return { main: `${p} of surface`, sub: 'Acidic brine seas' };
  if (!world.surface.uLiquid) return { main: 'Dry', sub: `${p} low basins` };
  return { main: `${p} of surface`, sub: 'Liquid water' };
}
