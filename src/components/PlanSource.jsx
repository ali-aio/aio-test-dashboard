import React from 'react'
import { testType } from '../lib/plan.js'

/** Who put a cycle in the plan: "Auto" (read from the readings by the server, src/lib/autoPlan.js)
 *  or "By hand" with the person's name. The Auto reason, and what a person had set before Auto
 *  replaced it, are on hover. */
export default function PlanSource({ decl }) {
  if (!decl) return null
  const a = decl.auto
  if (a) {
    const was = a.was && testType(a.was.testType)?.name
    const title = [a.basis, was ? `Replaced ${was}${a.was.by ? ` (set by ${a.was.by})` : ''}.` : '',
      a.final ? '' : 'Still running: the test may change when it ends.', 'Edit it to make it yours; Auto then leaves it alone.'].filter(Boolean).join(' ')
    return <span className="pill plan-src plan-auto" title={title}>Auto{was ? ` · was ${was}` : ''}{a.final ? '' : ' · running'}</span>
  }
  return <span className="pill plan-src" title="Set on the Cycle plan by a person">By hand{decl.by ? ` · ${decl.by}` : ''}</span>
}
