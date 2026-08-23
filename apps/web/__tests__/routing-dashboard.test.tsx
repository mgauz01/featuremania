import { render, screen } from '@testing-library/react'
import { expect, test } from 'vitest'
import RoutingDashboard from '@/components/RoutingDashboard'

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
})
