import { mean, maxOf } from './t7cycles.js'
import { compareSerial } from './fmt.js'

const PHASES = ['start', 'middle', 'end']

/** Per-device averages over complete cycle thirds; every cycle has equal weight. */
export function thermalTimingByDevice(cycles, hotAt = 55) {
  const grouped = new Map()
  for (const cycle of cycles) {
    const phases = cycle.tempPhases
    if (!phases || phases.length !== 3 || !phases.every(Number.isFinite)) continue
    if (!grouped.has(cycle.serial)) grouped.set(cycle.serial, [[], [], []])
    phases.forEach((temp, i) => grouped.get(cycle.serial)[i].push(temp))
  }

  return [...grouped].map(([serial, values]) => {
    const phases = values.map(mean)
    const warmest = phases.indexOf(maxOf(phases))
    const hot = phases.map((v, i) => v >= hotAt ? i : -1).filter((i) => i >= 0)
    let pattern
    if (hot.length === 3) pattern = `Hot throughout · warmest at ${PHASES[warmest]}`
    else if (hot.length) pattern = `Hot at ${hot.map((i) => PHASES[i]).join(' and ')}`
    else if (maxOf(phases) - Math.min(...phases) < 1) pattern = 'Similar throughout'
    else pattern = `Warmest at ${PHASES[warmest]}`

    return { serial, phases, cycles: values[0].length, pattern }
  }).sort((a, b) => compareSerial(a.serial, b.serial))
}
