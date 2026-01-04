# Performance Fix: Memory Allocations

## Problem

After ~1 hour of running, Ralph consumes 1.8GB+ RAM and 100% CPU. Stack sampling shows OpenTUI's `libopentui.dylib` is stuck in a tight loop creating text buffers:

```
createTextBuffer → text-buffer.UnifiedTextBuffer.init → heap.PageAllocator.alloc → mmap
createTextBufferView → init
event-emitter.EventEmitter.Listener.append
```

## Root Cause

The TUI re-renders create **new objects on every render cycle** instead of reusing existing ones. OpenTUI then allocates new text buffers for each "new" element.

### Primary Offender: `log.tsx:163-170`

```tsx
const itemsWithSpinner = () => {
  const items: Array<{ type: "event"; event: ToolEvent } | { type: "spinner" }> = 
    props.events.map(event => ({ type: "event" as const, event }));  // NEW ARRAY + NEW OBJECTS EVERY RENDER
  if (props.isRunning) {
    items.push({ type: "spinner" as const });  // ANOTHER NEW OBJECT
  }
  return items;
};
```

Every render:
1. Creates a new array
2. Creates new wrapper objects `{ type: "event", event }` for each of 200 events
3. `<Index>` sees 200+ "new" items, triggers full re-render
4. OpenTUI allocates fresh text buffers for everything

### Secondary Issues

| File | Line | Issue |
|------|------|-------|
| `log.tsx` | 163-170 | `itemsWithSpinner()` allocates new array + wrapper objects |
| `log.tsx` | 92-98 | `createMemo` used for side effects (should be `createEffect`) |
| `index.ts` | 236 | `trimEvents([...prev.events, event])` creates new array via spread |
| `index.ts` | 243-247 | `.map()` creates new array to update one separator |
| `header.tsx` | 67-80 | `repeat()` creates new strings each render |
| `app.tsx` | 158-162 | Elapsed timer updates every 2s even when nothing changed |

## Solution

**Don't allocate. Reuse existing objects.**

## Backlog

### Phase 1: Fix Critical Allocations (Log Component)

- [x] Remove `itemsWithSpinner()` wrapper function from `log.tsx`
- [x] Change `<Index each={itemsWithSpinner()}>` to `<For each={props.events}>`
- [x] Render events directly without wrapper objects `{ type: "event", event }`
- [x] Move `<Spinner>` outside the loop, render conditionally with `<Show when={props.isRunning}>`
- [x] Remove the spinner placeholder object from the items array entirely

### Phase 2: Fix Spinner Animation

- [ ] Change `createMemo` to `createEffect` in `Spinner` component for start/stop logic
- [ ] Ensure interval is only created once, not on every reactive update

### Phase 3: Fix Event Array Mutations (index.ts)

- [ ] In `onEvent` callback: push to existing array instead of spread `[...prev.events, event]`
- [ ] In `onEvent` callback: trim in-place with `splice()` instead of `slice()` creating new array
- [ ] In `onIterationComplete` callback: mutate existing separator event instead of `.map()` creating new array
- [ ] Consider using a single mutable events array instead of creating new arrays on each update

### Phase 4: Fix Header String Allocations

- [ ] Memoize progress bar filled string with `createMemo`
- [ ] Memoize progress bar empty string with `createMemo`
- [ ] Only recompute when `tasksComplete` or `totalTasks` actually change

### Phase 5: Fix Elapsed Timer

- [ ] Only update elapsed signal when component is visible/active
- [ ] Consider longer interval (5s) or skip updates when paused
- [ ] Use `requestAnimationFrame` pattern instead of `setInterval` if available

### Phase 6: State Update Batching Review

- [ ] Verify `batchedUpdater` is actually coalescing updates (add logging)
- [ ] Consider increasing debounce from 50ms to 100ms during high event throughput
- [ ] Ensure `flushNow()` is called appropriately for critical updates only

### Phase 7: Testing & Validation

- [ ] Run Ralph for 1+ hour after fixes
- [ ] Monitor RSS memory with `ps -o rss -p <pid>` every 5 minutes
- [ ] Monitor CPU usage stays below 10% when idle
- [ ] Verify memory stays flat (no growth trend)
- [ ] Document baseline metrics in this file

## Success Criteria

| Metric | Before | Target |
|--------|--------|--------|
| RSS @ 1 hour | 1.8 GB | < 200 MB |
| CPU when idle | 100% | < 5% |
| CPU during iteration | 100% | < 30% |
| Memory growth rate | ~1 GB/hour | ~0 (flat) |

## References

- Stack sample: `/tmp/ralph-sample.txt`
- Solid.js `<For>` vs `<Index>`: For is for dynamic lists, Index is for static lists with changing values
- OpenTUI text buffer lifecycle: buffers created per-element, not pooled
