import { fireEvent, render, screen } from '@testing-library/react'
import { signIn } from 'next-auth/react'
import { expect, test, vi } from 'vitest'
import LoginPage from '@/app/login/page'
import LoginButton from '@/components/LoginButton'

vi.mock('next-auth/react', () => ({
  signIn: vi.fn(),
}))

test('renders GitHub login button', () => {
  render(<LoginPage />)
  expect(screen.getByRole('button', { name: /sign in with github/i })).toBeInTheDocument()
})

test('sign-in sends the operator to /board/1 after GitHub SSO', () => {
  render(<LoginButton />)
  fireEvent.click(screen.getByRole('button', { name: /sign in with github/i }))
  expect(signIn).toHaveBeenCalledWith('github', { callbackUrl: '/board/1' })
})

