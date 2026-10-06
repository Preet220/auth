import { Sun, Moon } from 'lucide-react';
import { useTheme } from '@/lib/useTheme';

export function ThemeToggle({ className = '' }: { className?: string }) {
  const { theme, toggle } = useTheme();
  return (
    <button
      onClick={toggle}
      aria-label="Toggle theme"
      className={`relative inline-flex h-9 w-9 items-center justify-center rounded-lg transition-colors hover:bg-[var(--surface-hover)] ${className}`}
    >
      {theme === 'light' ? (
        <Moon className="h-5 w-5 text-[var(--text-muted)]" />
      ) : (
        <Sun className="h-5 w-5 text-[var(--text-muted)]" />
      )}
    </button>
  );
}
