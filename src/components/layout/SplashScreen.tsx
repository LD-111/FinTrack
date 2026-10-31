import { cn } from "@/lib/utils";

type SplashScreenProps = {
  exiting: boolean;
  onExited: () => void;
};

export function SplashScreen({ exiting, onExited }: SplashScreenProps) {
  return (
    <div
      className={cn(
        "splash-overlay fixed inset-0 z-50 flex items-center justify-center bg-sidebar transition-opacity duration-[400ms] ease-out",
        exiting ? "opacity-0" : "opacity-100",
      )}
      onTransitionEnd={(event) => {
        if (event.propertyName === "opacity" && event.target === event.currentTarget && exiting) {
          onExited();
        }
      }}
    >
      <div className="splash-mark flex flex-col items-center gap-4">
        <img src="/fintrack_logo.png" alt="" className="size-24" />
        <p className="text-2xl font-semibold tracking-tight text-sidebar-foreground">FinTrack</p>
      </div>
    </div>
  );
}
