export interface ToastAction {
  label: string;
  onClick: () => void;
}

export interface ToastItem {
  id: string;
  title: string;
  description?: string;
  action?: ToastAction;
}

type Listener = (toasts: ToastItem[]) => void;

let toasts: ToastItem[] = [];
const listeners = new Set<Listener>();

function emit() {
  for (const listener of listeners) {
    listener(toasts);
  }
}

export function toast(
  title: string,
  options?: { description?: string; action?: ToastAction; duration?: number },
): string {
  const id = crypto.randomUUID();
  toasts = [...toasts, { id, title, description: options?.description, action: options?.action }];
  emit();
  window.setTimeout(() => dismissToast(id), options?.duration ?? 5000);
  return id;
}

export function dismissToast(id: string) {
  toasts = toasts.filter((item) => item.id !== id);
  emit();
}

export function subscribeToasts(listener: Listener): () => void {
  listeners.add(listener);
  listener(toasts);
  return () => {
    listeners.delete(listener);
  };
}
