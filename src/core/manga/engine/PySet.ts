/**
 * The order CPython 3.11 iterates a set of small non-negative ints built by adding them in `inserted`
 * order. networkx returns connected components as sets, and the manga plugin's text-line merge depends
 * on that order, so the port reproduces CPython's open addressing: a hash of int n is n, linear probes
 * of 9 then perturbed probing, and a resize to the next power of two above four times the size once a
 * table is three-fifths full.
 */
export const pySetOrder = (inserted: ReadonlyArray<number>): ReadonlyArray<number> => {
  const linearProbes = 9
  const perturbShift = 5
  let table: Array<number | undefined> = Array.from({ length: 8 })
  let fill = 0

  const place = (slots: Array<number | undefined>, value: number) => {
    const mask = slots.length - 1
    let index = value & mask
    let perturb = value

    for (;;) {
      const probes = index + linearProbes <= mask ? linearProbes : 0

      for (let step = 0; step <= probes; step += 1) {
        if (slots[index + step] === undefined) {
          slots[index + step] = value

          return
        }
      }

      perturb = Math.floor(perturb / 2 ** perturbShift)
      index = (index * 5 + 1 + perturb) & mask
    }
  }

  for (const value of inserted) {
    if (table.includes(value)) {
      continue
    }

    place(table, value)
    fill += 1

    if (fill * 5 >= (table.length - 1) * 3) {
      let size = 8

      while (size <= fill * 4) {
        size *= 2
      }

      const resized: Array<number | undefined> = Array.from({ length: size })

      for (const kept of table) {
        if (kept !== undefined) {
          place(resized, kept)
        }
      }

      table = resized
    }
  }

  return table.filter((value): value is number => value !== undefined)
}
