import React, { useState } from "react";
import { Mail, Lock, LogIn } from "lucide-react";
import { FormField } from "@/components/auth/FormField";
import { PasswordToggle } from "@/components/auth/PasswordToggle";
import { SubmitButton } from "@/components/SubmitButton";
import { ServerError } from "@/components/auth/ServerError";
import type { Messages } from "@/lib/i18n";

interface Props {
  serverError?: string | null;
  /** Same-origin path to return to after sign-in, already validated by the page. */
  next?: string | null;
  /** Plain-string labels from t.auth.signInForm (island props must be serialisable). */
  labels: Messages["auth"]["signInForm"];
}

export default function SignInForm({ serverError, next, labels }: Props) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [errors, setErrors] = useState<{ email?: string; password?: string }>({});

  function validate() {
    const found: typeof errors = {};
    if (!email.trim()) {
      found.email = labels.emailRequired;
    } else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      found.email = labels.emailInvalid;
    }
    if (!password) {
      found.password = labels.passwordRequired;
    }
    setErrors(found);
    return Object.keys(found).length === 0;
  }

  function clearError(field: keyof typeof errors) {
    if (errors[field]) setErrors((prev) => ({ ...prev, [field]: undefined }));
  }

  function handleSubmit(e: React.SubmitEvent<HTMLFormElement>) {
    if (!validate()) {
      e.preventDefault();
    }
  }

  return (
    <form method="POST" action="/api/auth/signin" className="space-y-4" onSubmit={handleSubmit} noValidate>
      {next && <input type="hidden" name="next" value={next} />}
      <FormField
        id="email"
        type="email"
        label={labels.emailLabel}
        value={email}
        onChange={(v) => {
          setEmail(v);
          clearError("email");
        }}
        placeholder={labels.emailPlaceholder}
        error={errors.email}
        icon={<Mail className="size-4" />}
      />

      <FormField
        id="password"
        label={labels.passwordLabel}
        type={showPassword ? "text" : "password"}
        value={password}
        onChange={(v) => {
          setPassword(v);
          clearError("password");
        }}
        placeholder={labels.passwordPlaceholder}
        error={errors.password}
        icon={<Lock className="size-4" />}
        endContent={
          <PasswordToggle
            visible={showPassword}
            showLabel={labels.showPassword}
            hideLabel={labels.hidePassword}
            onToggle={() => {
              setShowPassword(!showPassword);
            }}
          />
        }
      />

      <ServerError message={serverError} />

      <SubmitButton className="w-full" pendingText={labels.pending} icon={<LogIn className="size-4" />}>
        {labels.submit}
      </SubmitButton>
    </form>
  );
}
