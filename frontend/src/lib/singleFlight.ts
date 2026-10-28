import { useState } from 'react'

export type FlightResult<T> = { ran: false } | { ran: true; value: T }

/**
 * Lets only one async action run at a time; a call made while one is in flight is ignored.
 *
 * A "busy" React state is not enough: state updates are applied on the next render, so a fast double-click (or pressing Enter twice) runs the
 * handler again with the old "not busy" value and sends a second request. For a single-use link that second request is answered "already used",
 * which would flip a success screen to an error. This flag is set synchronously, before the first await.
 */
export function createSingleFlight() {
  let busy = false
  return async function run<T>(action: () => Promise<T>): Promise<FlightResult<T>> {
    if (busy) return { ran: false }
    busy = true
    try {
      return { ran: true, value: await action() }
    } finally {
      busy = false
    }
  }
}

/** One guard per mounted screen. */
export function useSingleFlight() {
  const [run] = useState(createSingleFlight)
  return run
}
