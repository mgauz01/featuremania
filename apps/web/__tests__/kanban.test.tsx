import { fireEvent, render, screen, within } from '@testing-library/react'
import { expect, test } from 'vitest'
import KanbanBoard from '@/components/KanbanBoard'

test('renders board with issues', () => {
  const issues = [{ id: 1, title: 'Test issue', score: 5.2 }]
  render(<KanbanBoard issues={issues} />)
  expect(screen.getByText('Test issue')).toBeInTheDocument()
})

test('places issues without status in Backlog and sorts by score descending', () => {
  render(
    <KanbanBoard
      issues={[
        { id: 1, title: 'Low score', score: 1.1 },
        { id: 2, title: 'High score', score: 9.9 },
      ]}
    />,
  )

  const backlog = screen.getByRole('region', { name: 'Backlog' })
  const titles = within(backlog)
    .getAllByRole('heading', { level: 3 })
    .map((heading) => heading.textContent)

  expect(titles).toEqual(['High score', 'Low score'])
})

test('filters by repository and hides stale issues', () => {
  render(
    <KanbanBoard
      issues={[
        {
          id: 1,
          title: 'Fresh featuremania issue',
          score: 8,
          repo: 'otari-games/featuremania',
          last_activity_at: new Date().toISOString(),
        },
        {
          id: 2,
          title: 'Fresh api issue',
          score: 7,
          repo: 'otari-games/api',
          last_activity_at: new Date().toISOString(),
        },
        {
          id: 3,
          title: 'Stale featuremania issue',
          score: 6,
          repo: 'otari-games/featuremania',
          last_activity_at: '2020-01-01T00:00:00.000Z',
        },
      ]}
    />,
  )

  fireEvent.change(screen.getByLabelText('Filter by repository'), {
    target: { value: 'otari-games/featuremania' },
  })
  expect(screen.getByText('Fresh featuremania issue')).toBeInTheDocument()
  expect(screen.queryByText('Fresh api issue')).not.toBeInTheDocument()

  fireEvent.click(screen.getByLabelText('Hide stale'))
  expect(screen.queryByText('Stale featuremania issue')).not.toBeInTheDocument()
  expect(screen.getByText('Fresh featuremania issue')).toBeInTheDocument()
})
