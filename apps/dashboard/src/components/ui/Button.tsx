// The button. Four looks: accent (the one main action on a screen), secondary (the default),
// ghost (quiet, for small actions) and danger-quiet (for things that remove or end something).
// `buttonVariants` also styles links that should look like buttons: <Button asChild><Link .../></Button>.
import { Slot } from "@radix-ui/react-slot";
import { cva, type VariantProps } from "class-variance-authority";
import type { ComponentProps } from "react";
import { cn } from "@/lib/cn";

export const buttonVariants = cva(
  "inline-flex shrink-0 cursor-pointer items-center justify-center gap-2 rounded-md font-medium whitespace-nowrap " +
    "transition-colors disabled:pointer-events-none disabled:opacity-50 aria-disabled:pointer-events-none aria-disabled:opacity-50",
  {
    variants: {
      variant: {
        accent: "bg-accent text-accent-contrast hover:bg-accent-hover",
        secondary: "border border-line bg-surface text-text hover:bg-surface-muted",
        ghost: "text-text hover:bg-surface-muted",
        "danger-quiet": "text-danger hover:bg-danger-soft",
      },
      size: {
        default: "h-9 px-4 text-sm",
        small: "h-8 px-3 text-sm",
      },
    },
    defaultVariants: { variant: "secondary", size: "default" },
  },
);

type ButtonProps = ComponentProps<"button"> &
  VariantProps<typeof buttonVariants> & {
    // Style the child (a link, say) as a button instead of rendering a <button>.
    asChild?: boolean;
  };

export function Button({ className, variant, size, asChild = false, type = "button", ...props }: ButtonProps) {
  const classes = cn(buttonVariants({ variant, size }), className);
  if (asChild) return <Slot className={classes} {...props} />;
  // type="button" by default, so a button inside a form does not submit it by accident.
  return <button type={type} className={classes} {...props} />;
}
