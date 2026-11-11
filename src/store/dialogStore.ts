import { create } from "zustand";

export interface ConfirmOptions {
  title: string;
  message: string;
  confirmLabel?: string;
  cancelLabel?: string;
  danger?: boolean;
  extra?: string;
}

interface DialogState {
  pending: (ConfirmOptions & { resolve: (value: boolean) => void }) | null;
  open: (options: ConfirmOptions) => Promise<boolean>;
  resolve: (value: boolean) => void;
}

export const useDialogStore = create<DialogState>((set, get) => ({
  pending: null,
  open: (options) =>
    new Promise<boolean>((resolve) => {
      set({ pending: { ...options, resolve } });
    }),
  resolve: (value) => {
    get().pending?.resolve(value);
    set({ pending: null });
  },
}));

export function confirmDialog(options: ConfirmOptions): Promise<boolean> {
  return useDialogStore.getState().open(options);
}
