export interface DebouncedAction {
  schedule(action: () => Promise<void>): void;
  cancel(): void;
  flush(): Promise<void>;
}

export function createDebouncedAction(delayMs: number): DebouncedAction {
  let timer: ReturnType<typeof setTimeout> | undefined;
  let pendingAction: (() => Promise<void>) | undefined;

  const cancel = () => {
    if (timer !== undefined) clearTimeout(timer);
    timer = undefined;
  };

  const flush = async () => {
    cancel();
    const action = pendingAction;
    pendingAction = undefined;
    if (action) await action();
  };

  return {
    schedule(action) {
      cancel();
      pendingAction = action;
      timer = setTimeout(() => {
        timer = undefined;
        void flush();
      }, delayMs);
    },
    cancel() {
      cancel();
      pendingAction = undefined;
    },
    flush,
  };
}
