interface Waiting {
  readonly start: () => void
  state: 'waiting' | 'running' | 'done'
}

export const thumbnailQueue = (atOnce: number) => {
  const waiting: Array<Waiting> = []
  let running = 0

  const next = () => {
    while (running < atOnce) {
      const job = waiting.shift()

      if (job === undefined) {
        return
      }

      if (job.state === 'waiting') {
        job.state = 'running'
        running += 1
        job.start()
      }
    }
  }

  return {
    wait: (start: () => void) => {
      const job: Waiting = { start, state: 'waiting' }

      waiting.push(job)
      next()

      return {
        finish: () => {
          if (job.state === 'running') {
            running -= 1
          }

          job.state = 'done'
          next()
        },
      }
    },
  }
}

const sizeStep = 64

export const thumbnailSize = (width: number, height: number, scale: number) =>
  Math.max(sizeStep, Math.ceil((Math.max(width, height) * scale) / sizeStep) * sizeStep)
