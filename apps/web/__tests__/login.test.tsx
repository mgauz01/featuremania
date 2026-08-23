import { render, screen } from '@testing-library/react'
import { expect, test } from 'vitest'
import LoginPage from '@/app/login/page'

test('renders GitHub login button', () => {
  render(<LoginPage />)
  expect(screen.getByRole('button', { name: /sign in with github/i })).toBeInTheDocument()
})
