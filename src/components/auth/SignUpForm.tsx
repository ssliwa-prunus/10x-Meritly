import React, { useState } from "react";
import { Mail, Lock, UserPlus } from "lucide-react";
import { FormField } from "@/components/auth/FormField";
import { PasswordToggle } from "@/components/auth/PasswordToggle";
import { SubmitButton } from "@/components/SubmitButton";
import { ServerError } from "@/components/auth/ServerError";
import { format, plural, type Locale, type Messages } from "@/lib/i18n";

const MIN_PASSWORD_LENGTH = 6;

interface Props {
  serverError?: string | null;
  /** Plain-string labels from t.auth.signUpForm (island props must be serialisable). */
  labels: Messages["auth"]["signUpForm"];
  /** Active locale, for resolving the plural forms in labels.charsNeeded on the client. */
  locale: Locale;
}

export default function SignUpForm({ serverError, labels, locale }: Props) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);
  const [errors, setErrors] = useState<{ email?: string; password?: string; confirmPassword?: string }>({});

  function validate() {
    const next: typeof errors = {};

    if (!email.trim()) {
      next.email = labels.emailRequired;
    } else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      next.email = labels.emailInvalid;
    }

    if (!password) {
      next.password = labels.passwordRequired;
    } else if (password.length < MIN_PASSWORD_LENGTH) {
      next.password = format(labels.passwordTooShort, { min: MIN_PASSWORD_LENGTH });
    }

    if (!confirmPassword) {
      next.confirmPassword = labels.confirmRequired;
    } else if (password !== confirmPassword) {
      next.confirmPassword = labels.passwordMismatch;
    }

    setErrors(next);
    return Object.keys(next).length === 0;
  }

  function clearError(field: keyof typeof errors) {
    if (errors[field]) setErrors((prev) => ({ ...prev, [field]: undefined }));
  }

  function handleSubmit(e: React.SubmitEvent<HTMLFormElement>) {
    if (!validate()) {
      e.preventDefault();
    }
  }

  const missingChars = MIN_PASSWORD_LENGTH - password.length;
  const passwordHint =
    !errors.password && password.length > 0 && missingChars > 0 ? (
      <p className="mt-1 text-xs text-blue-100/50">
        {format(plural(locale, missingChars, labels.charsNeeded), { count: missingChars })}
      </p>
    ) : undefined;

  return (
    <form method="POST" action="/api/auth/signup" className="space-y-4" onSubmit={handleSubmit} noValidate>
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
        placeholder={format(labels.passwordPlaceholder, { min: MIN_PASSWORD_LENGTH })}
        error={errors.password}
        hint={passwordHint}
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

      <FormField
        id="confirmPassword"
        name="confirmPassword"
        label={labels.confirmLabel}
        type={showConfirmPassword ? "text" : "password"}
        value={confirmPassword}
        onChange={(v) => {
          setConfirmPassword(v);
          clearError("confirmPassword");
        }}
        placeholder={labels.confirmPlaceholder}
        error={errors.confirmPassword}
        icon={<Lock className="size-4" />}
        endContent={
          <PasswordToggle
            visible={showConfirmPassword}
            showLabel={labels.showPassword}
            hideLabel={labels.hidePassword}
            onToggle={() => {
              setShowConfirmPassword(!showConfirmPassword);
            }}
          />
        }
      />

      <ServerError message={serverError} />

      <SubmitButton className="w-full" pendingText={labels.pending} icon={<UserPlus className="size-4" />}>
        {labels.submit}
      </SubmitButton>
    </form>
  );
}
