import { AuthFormLayout } from '@/components/auth/auth-page-header'
import { RegisterForm } from './_components/register-form'

export default function RegisterPage() {
  return (
    <AuthFormLayout
      title="Create an account"
      description="Get started with your developer knowledge hub."
    >
      <RegisterForm />
    </AuthFormLayout>
  )
}
