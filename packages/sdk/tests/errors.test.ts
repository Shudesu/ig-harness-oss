import { describe, it, expect } from 'vitest'
import { InstagramHarnessError, LineHarnessError } from '../src/errors.js'
describe('InstagramHarnessError compatibility', () => {
  it('uses one constructor for both public names', () => {
    expect(LineHarnessError).toBe(InstagramHarnessError)
    const error = new InstagramHarnessError('Not found', 404, 'GET /api/scenarios/xxx')
    expect(error).toBeInstanceOf(LineHarnessError)
    expect(error).toMatchObject({ name: 'InstagramHarnessError', status: 404, endpoint: 'GET /api/scenarios/xxx' })
  })
})
