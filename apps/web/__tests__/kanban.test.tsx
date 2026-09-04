import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { fireEvent, render, screen, within } from '@testing-library/react'
import { expect, test, vi } from 'vitest'
import KanbanBoard from '@/components/KanbanBoard'

test('renders board with issues', () => {
  const issues = [{ id: 1, title: 'Test issue', score: 5.2 }]
  render(<KanbanBoard issues={issues} />)
  expect(screen.getByText('Test issue')).toBeInTheDocument()
})

test('places cards inside a scrollable column body', () => {
  render(<KanbanBoard issues={[{ id: 1, title: 'Test issue', score: 5.2 }]} />)
  const backlog = screen.getByRole('region', { name: 'Backlog' })
  const inner = backlog.querySelector('.kanban-column-inner')
  expect(inner).not.toBeNull()
  expect(inner).toContainElement(screen.getByText('Test issue'))
  expect(screen.getByText(/columns follow github/i)).toBeInTheDocument()
})

test('shows a work index that opens reasoning in a popup', () => {
  const issues = [{
    id: 1,
    title: 'Test issue',
    score: 5.2,
    score_reason: 'Five closing-PR commits lift this score; comments are zero.',
  }]
  render(<KanbanBoard issues={issues} />)
  expect(screen.getByText('Test issue')).toBeInTheDocument()
  expect(screen.queryByText('Why this score?')).not.toBeInTheDocument()
  const badge = screen.getByRole('button', { name: 'Work index 5.20' })
  expect(badge).toHaveTextContent('5.20')
  fireEvent.click(badge)
  const dialog = screen.getByRole('dialog', { name: 'Why this score' })
  expect(dialog).toHaveTextContent('Five closing-PR commits lift this score; comments are zero.')
  expect(dialog).toHaveTextContent('5.200')
})

test('explains the deterministic score when Otari reasoning is unavailable', () => {
  const issues = [{
    id: 1,
    title: 'Reasonless issue',
    score: 0.6,
    commits_on_closing_prs: 1,
    subtasks_count: 0,
    comments_count: 2,
  }]
  render(<KanbanBoard issues={issues} />)
  fireEvent.click(screen.getByRole('button', { name: 'Work index 0.60' }))
  const dialog = screen.getByRole('dialog', { name: 'Why this score' })
  expect(dialog).toHaveTextContent(
    'It comes from 1 closing-PR commit, 0 subtasks, and 2 comments, reduced by the 30-day half-life since the last activity.',
  )
  expect(dialog).not.toHaveTextContent('Otari did not explain this score.')
})

test('says the score is a work index, not percent complete', () => {
  render(<KanbanBoard issues={[{ id: 1, title: 'Test issue', score: 1.34 }]} />)
  fireEvent.click(screen.getByRole('button', { name: 'Work index 1.34' }))
  const dialog = screen.getByRole('dialog', { name: 'Why this score' })
  expect(dialog).toHaveTextContent('1.34 is a work index, not a percent complete and not a done mark.')
  expect(dialog).toHaveTextContent('There is no finish line at 1.00')
  expect(dialog).not.toHaveTextContent('%')
})

test('typesets the formula instead of printing source-code text', () => {
  render(<KanbanBoard issues={[{ id: 1, title: 'Test issue', score: 0.6 }]} />)
  fireEvent.click(screen.getByRole('button', { name: 'Work index 0.60' }))
  const dialog = screen.getByRole('dialog', { name: 'Why this score' })
  expect(
    within(dialog).getByRole('math', { name: /Score equals work times recency\.$/ }),
  ).toBeInTheDocument()
  expect(dialog.querySelector('.katex')).not.toBeNull()
  expect(dialog).not.toHaveTextContent('log1p')
})

test('substitutes this card numbers into the formula', () => {
  render(
    <KanbanBoard
      issues={[{
        id: 1,
        title: 'Test issue',
        score: 0.589,
        commits_on_closing_prs: 14,
        subtasks_count: 0,
        comments_count: 0,
      }]}
    />,
  )
  fireEvent.click(screen.getByRole('button', { name: 'Work index 0.59' }))
  const dialog = screen.getByRole('dialog', { name: 'Why this score' })
  expect(
    within(dialog).getByRole('math', {
      name: 'For this card, work equals 1.354, recency equals 0.435, and score equals 0.589.',
    }),
  ).toBeInTheDocument()
})

test('shows 0.51 instead of rounding a work index to 0.00', () => {
  render(<KanbanBoard issues={[{ id: 1, title: 'Half score', score: 0.5125 }]} />)
  expect(screen.getByRole('button', { name: 'Work index 0.51' })).toHaveTextContent('0.51')
})

test('places a ticket with linked-PR commits in In Progress when status is missing', () => {
  render(
    <KanbanBoard
      issues={[{ id: 1, title: 'Hot', score: 1.34, commits_on_closing_prs: 18 }]}
    />,
  )
  expect(within(screen.getByRole('region', { name: 'In Progress' })).getByText('Hot')).toBeInTheDocument()
  expect(within(screen.getByRole('region', { name: 'Backlog' })).queryByText('Hot')).toBeNull()
})

test('Kanban columns fill the board width', () => {
  const css = readFileSync(resolve(__dirname, '../app/globals.css'), 'utf8')
  expect(css).toMatch(/\.kanban-columns[\s\S]*?grid-template-columns:\s*repeat\(5,\s*minmax\(0,\s*1fr\)\)/)
  expect(css).not.toMatch(/\.kanban-columns[\s\S]*?minmax\(11rem,\s*16rem\)/)
  expect(css).toMatch(/\.live-board-refresh[\s\S]*?width:\s*100%/)
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

test('work-index click does not select the card', () => {
  const onToggle = vi.fn()
  render(
    <KanbanBoard
      issues={[{ id: 1, title: 'Test issue', score: 1, issueKey: 'acme/app#1' }]}
      selectedKeys={[]}
      onToggleSelect={onToggle}
    />,
  )
  fireEvent.click(screen.getByRole('button', { name: 'Work index 1.00' }))
  expect(onToggle).not.toHaveBeenCalled()
  expect(screen.getByRole('checkbox', { name: 'Select acme/app#1' })).not.toBeChecked()
  expect(document.querySelector('.issue-card')).not.toHaveAttribute('draggable')
})

test('Featuremania cards omit the work index and are not selectable', () => {
  render(
    <KanbanBoard
      issues={[
        {
          id: -1,
          title: 'Auth cleanup',
          score: 0,
          kind: 'featuremania',
          issueKey: 'fm:group:x',
          childKeys: ['acme/app#1'],
          groupMode: 'parent',
          status: 'backlog',
        },
      ]}
      sourceIssues={[{ id: 1, title: 'Login leak', score: 1, issueKey: 'acme/app#1' }]}
      onToggleSelect={() => undefined}
      onUndoGroup={() => undefined}
    />,
  )
  expect(screen.queryByRole('button', { name: /Work index/ })).not.toBeInTheDocument()
  expect(screen.queryByRole('checkbox', { name: /Select/ })).not.toBeInTheDocument()
  expect(screen.getByText('Login leak')).toBeInTheDocument()
  expect(screen.getByRole('button', { name: 'Undo grouping' })).toBeInTheDocument()
})
