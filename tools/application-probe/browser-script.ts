/** Runs in each document. No values, textContent dumps, key presses, or click payloads. */
export function installObserver() {
  const global = window as unknown as {
    __probeEvent: (event: unknown) => Promise<void>;
    __probeInspect: () => unknown[];
  };
  const ids = new WeakMap<Element, number>();
  let next = 0;
  const helpers = {
    id(el: Element) {
      if (!ids.has(el)) ids.set(el, ++next);
      return ids.get(el)!;
    },
    isField(
      el: unknown,
    ): el is HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement {
      return (
        (el instanceof HTMLInputElement &&
          !['hidden', 'button', 'submit', 'reset', 'image', 'file'].includes(
            el.type,
          )) ||
        el instanceof HTMLSelectElement ||
        el instanceof HTMLTextAreaElement
      );
    },
  };
  const actions = {
    focusin: 'focus',
    input: 'input',
    change: 'change',
    focusout: 'blur',
  } as const;
  for (const [event, action] of Object.entries(actions)) {
    document.addEventListener(
      event,
      (event) => {
        const el = event.composedPath()[0];
        if (!helpers.isField(el) || !event.isTrusted) return;
        void global
          .__probeEvent({
            action,
            localId: helpers.id(el),
            epochMs: performance.timeOrigin + performance.now(),
          })
          .catch(() => {});
      },
      true,
    );
  }
  global.__probeInspect = () =>
    Array.from(document.querySelectorAll('input,select,textarea'))
      .filter(helpers.isField)
      .map((el) => ({
        localId: helpers.id(el),
        element: el.tagName.toLowerCase(),
        type: el.type,
        name: el.getAttribute('name'),
        id: el.id,
        autocomplete: el.getAttribute('autocomplete'),
        'aria-label': el.getAttribute('aria-label'),
        label: el.labels?.[0]?.textContent?.trim(),
        placeholder: el.getAttribute('placeholder'),
        required: el.required,
        disabled: el.disabled,
        patternPresent: el.hasAttribute('pattern'),
        maxLengthPresent: el.hasAttribute('maxlength'),
        invalid: el.getAttribute('aria-invalid') === 'true',
      }));
}
