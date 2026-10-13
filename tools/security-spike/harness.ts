// Synthetic-only controls: no user-supplied profile or password input.
const password = 'SYNTHETIC test password';
const output = document.querySelector<HTMLOutputElement>('#status')!;
type Status = {
  ok: boolean;
  code?: string;
  registered?: boolean;
  unlocked?: boolean;
  revision?: string;
  boot?: string;
};
let current: Status = { ok: false };
async function refresh() {
  current = (await chrome.runtime.sendMessage({ op: 'status' })) as Status;
  output.textContent = current.ok
    ? `registered=${!!current.registered} unlocked=${!!current.unlocked} boot=${current.boot}`
    : `ERROR ${current.code ?? 'UNKNOWN'}`;
}
for (const button of document.querySelectorAll<HTMLButtonElement>(
  'button[data-op]',
)) {
  button.addEventListener('click', () => {
    void (async () => {
      try {
        const op = button.dataset.op;
        if (op !== 'status') {
          const reply = (await chrome.runtime.sendMessage({
            op,
            ...(['create', 'unlock'].includes(op ?? '') ? { password } : {}),
            ...(op === 'unlock'
              ? {
                  keep: document.querySelector<HTMLInputElement>('#keep')!
                    .checked,
                }
              : {}),
            ...(op === 'use' ? { expected: current.revision } : {}),
          })) as Status;
          if (!reply.ok) {
            output.textContent = `ERROR ${reply.code ?? 'UNKNOWN'}`;
            return;
          }
        }
        await refresh();
      } catch {
        output.textContent = 'ERROR TRANSPORT';
      }
    })();
  });
}
void refresh().catch(() => {
  output.textContent = 'ERROR TRANSPORT';
});
