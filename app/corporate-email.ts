export function normalizeCorporateEmail(value: unknown): string | null {
  if (typeof value !== 'string' || value.length > 150) return null;
  const email = value.trim().toLowerCase();
  return /^[a-z0-9!#$%&'*+/=?^_`{|}~-]+(?:\.[a-z0-9!#$%&'*+/=?^_`{|}~-]+)*@sutochno\.ru$/.test(
    email,
  )
    ? email
    : null;
}
