/** UX §5.5: fundo estático; não reage a dados, horário nem rolagem. */
export function AppBackdrop() {
  return <div className="backdrop" aria-hidden="true" data-testid="app-backdrop" />;
}
