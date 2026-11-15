// One request at a time for an action the person takes once: Approve, Skip, Request edit, Record as applied.
// `isPending` and a button's `disabled` change only when the screen next renders, so a double-click or a key
// pressed twice used to send the request twice. TanStack Query then runs only the latest call's callbacks:
// the first success was lost and the refusal of the second was shown. This ref is set at once and cleared
// when the request settles, so a repeat in between is ignored.
//   const approveOnce = useOneAtATime(approve.mutate);
//   approveOnce(dataSheetHash, { onSuccess: goToNextOrToday });
import type { MutateOptions } from "@tanstack/react-query";
import { useRef } from "react";

type Mutate<TData, TError, TVariables, TContext> = (
  variables: TVariables,
  options?: MutateOptions<TData, TError, TVariables, TContext>,
) => void;

export function useOneAtATime<TData, TError, TVariables, TContext>(
  mutate: Mutate<TData, TError, TVariables, TContext>,
): Mutate<TData, TError, TVariables, TContext> {
  const isSending = useRef(false);
  return (variables, options) => {
    if (isSending.current) return;
    isSending.current = true;
    mutate(variables, {
      ...options,
      onSettled: (...settled) => {
        isSending.current = false;
        options?.onSettled?.(...settled);
      },
    });
  };
}
