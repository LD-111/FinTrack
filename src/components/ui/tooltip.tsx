import * as React from "react";

function TooltipProvider({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}

function Tooltip({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}

function TooltipTrigger({
  children,
  asChild: _asChild,
  ...props
}: React.ComponentProps<"span"> & { asChild?: boolean }) {
  return <span {...props}>{children}</span>;
}

function TooltipContent({ children }: { children?: React.ReactNode }) {
  return children ? <span className="sr-only">{children}</span> : null;
}

export { Tooltip, TooltipTrigger, TooltipContent, TooltipProvider };
