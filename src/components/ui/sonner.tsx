import { useEffect, useState } from "react";
import { dismissToast, subscribeToasts, type ToastItem } from "@/lib/toast";
import { Button } from "@/components/ui/button";

function Toaster() {
  const [items, setItems] = useState<ToastItem[]>([]);

  useEffect(() => subscribeToasts(setItems), []);

  if (items.length === 0) return null;

  return (
    <div className="pointer-events-none fixed right-4 bottom-4 z-50 flex w-80 flex-col gap-2">
      {items.map((item) => (
        <div key={item.id} className="pointer-events-auto rounded-lg border bg-card p-3 shadow-lg">
          <p className="text-sm font-medium">{item.title}</p>
          {item.description && <p className="text-xs text-muted-foreground">{item.description}</p>}
          <div className="mt-2 flex justify-end gap-2">
            {item.action && (
              <Button
                size="sm"
                variant="outline"
                onClick={() => {
                  item.action?.onClick();
                  dismissToast(item.id);
                }}
              >
                {item.action.label}
              </Button>
            )}
            <Button size="sm" variant="ghost" onClick={() => dismissToast(item.id)}>
              Dismiss
            </Button>
          </div>
        </div>
      ))}
    </div>
  );
}

export { Toaster };
