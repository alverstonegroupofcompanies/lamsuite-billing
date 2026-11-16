const isRepeatedDigit = (value: string): boolean => /^(\d)\1+$/.test(value);

const isSequential = (value: string): boolean => {
  const digits = Array.from(value).map(Number);
  const ascending = digits.every((digit, index) => index === 0 || digit === digits[index - 1] + 1);
  const descending = digits.every((digit, index) => index === 0 || digit === digits[index - 1] - 1);
  return ascending || descending;
};

/** Returns an operator-facing error, or null when the password is acceptable. */
export function validatePassword(password: string): string | null {
  if (password.trim().length < 8) {
    return "Password must be at least 8 characters.";
  }
  return null;
}

/** Returns an operator-facing error, or null when the PIN is acceptable. */
export function validatePin(pin: string): string | null {
  const trimmed = pin.trim();
  if (!/^\d{4,6}$/.test(trimmed)) {
    return "PIN must be 4 to 6 numeric digits.";
  }
  if (isRepeatedDigit(trimmed)) {
    return "PIN cannot be the same digit repeated.";
  }
  if (isSequential(trimmed)) {
    return "PIN cannot be a simple sequence such as 1234.";
  }
  return null;
}
