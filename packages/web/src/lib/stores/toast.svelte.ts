let items = $state<{ id: number; message: string }[]>([]);
let nextId = 0;

export const toastStore = {
  get items() { return items; },
  show(message: string, durationMs = 2500) {
    const id = nextId++;
    items = [...items, { id, message }];
    setTimeout(() => {
      items = items.filter(t => t.id !== id);
    }, durationMs);
  },
};
