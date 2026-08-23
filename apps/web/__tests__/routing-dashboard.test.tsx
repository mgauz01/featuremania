import { render, screen } from '@testing-library/react'
import { afterEach, expect, test, vi } from 'vitest'
import RoutingDashboard from '@/components/RoutingDashboard'

afterEach(() => {
  vi.unstubAllGlobals()
})

test('renders live routing events', () => {
  render(
    <RoutingDashboard
      pollMs={0}
      events={[
        {
          model: 'deepseek-v3',
          tokens: 100,
          cost: 0.001,
          feature: 'summary',
          guardrail_block: 'prompt-injection',
        },
      ]}
    />,
  )
  expect(screen.getByRole('region', { name: 'Live routing dashboard' })).toBeInTheDocument()
  expect(screen.getByText('deepseek-v3')).toBeInTheDocument()
  expect(screen.getByText('summary')).toBeInTheDocument()
  expect(screen.getByText('prompt-injection')).toBeInTheDocument()
  expect(screen.queryByText('Loading usage…')).not.toBeInTheDocument()
})

test('shows loading state while the first usage poll is in flight', () => {
  vi.stubGlobal(
    'fetch',
    vi.fn(() => new Promise(() => {})),
  )
  const { unmount } = render(<RoutingDashboard pollUrl="/v1/usage" />)
  expect(screen.getByText('Loading usage…')).toBeInTheDocument()
  expect(screen.queryByText('No enrichment calls yet.')).not.toBeInTheDocument()
  unmount()
})
