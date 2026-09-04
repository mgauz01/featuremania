import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
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
  const fold = document.querySelector('.routing-dashboard-fold')
  expect(fold).not.toBeNull()
  expect(fold).not.toHaveAttribute('open')
  expect(screen.getByRole('region', { name: 'Live routing dashboard' })).toBeInTheDocument()
  expect(screen.getByText('deepseek-v3')).toBeInTheDocument()
  expect(screen.getByText('summary')).toBeInTheDocument()
  expect(screen.getByText('prompt-injection')).toBeInTheDocument()
  expect(screen.queryByText('Loading usage…')).not.toBeInTheDocument()
  expect(document.querySelector('.routing-dashboard-table-wrap')).not.toBeNull()

  const css = readFileSync(resolve(__dirname, '../app/globals.css'), 'utf8')
  expect(css).toMatch(/\.routing-dashboard-table-wrap[\s\S]*?max-height:\s*14rem/)
  expect(css).toMatch(/\.routing-dashboard-table-wrap[\s\S]*?overflow:\s*auto/)
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
