/** Run a core operation with loading state, error capture, toast and sound. */
import { useCallback, useState } from 'react';
import { toast } from '@/ui/Toasts';
import { play, type SoundName } from '@/ui/sound';
import { useT } from './useT';
import { toBankError } from '@/core/errors';

export function useAction() {
  const { tx } = useT();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const run = useCallback(
    async <T,>(fn: () => Promise<T>, opts: { success?: string; sound?: SoundName; silentError?: boolean } = {}): Promise<T | undefined> => {
      setBusy(true);
      setError(null);
      try {
        const r = await fn();
        if (opts.success) toast({ tone: 'positive', title: opts.success });
        if (opts.sound) play(opts.sound);
        return r;
      } catch (e) {
        setError(e);
        play('error');
        if (!opts.silentError) {
          const be = toBankError(e);
          toast({ tone: 'negative', title: tx(`errors.${be.code}.title`, undefined, be.code), body: tx(`errors.${be.code}.hint`) });
        }
        return undefined;
      } finally {
        setBusy(false);
      }
    },
    [tx],
  );
  return { run, busy, error, setError };
}
